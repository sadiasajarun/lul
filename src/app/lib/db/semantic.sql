-- ─────────────────────────────────────────────────────────────────────────────
-- SEMANTIC LAYER — business metric definitions, encoded once.
--
-- The AI writes SQL against THESE views, never the raw tables, so "active",
-- "mainstreamed", "attendance" (0 = not recorded), and the student-teacher ratio
-- always mean the same thing. Loaded after the base tables by BOTH the browser
-- engine (duckdb-source.ts) and the Node verifier/eval harness (single source of truth).
--
-- Base tables (from public/data/*.csv): students, attendance, assessments, teachers, centers.
-- ─────────────────────────────────────────────────────────────────────────────

-- Canonical student view with business-defined flags.
CREATE OR REPLACE VIEW v_students AS
SELECT
  s.student_id, n.student_name, s.center_id, s.programme, s.division, s.district, s.upazila,
  s.gender,
  CASE s.gender WHEN 'Girl' THEN 'Female' WHEN 'Boy' THEN 'Male' ELSE s.gender END AS gender_label,
  s.religion, s.ethnicity, s.nutrition, s.disability_type,
  s.father_income_tk, s.income_band, s.enrollment_year,
  -- CHILD LABOUR / HOUSEHOLD CONTEXT. These come from the source profiles and are the strongest
  -- NON-circular signals for explaining absence: a working child, an unschooled parent or insecure
  -- housing are causes a programme can act on, unlike "this child is marked irregular".
  s.work_type, s.work_duration,
  (s.work_type IS NOT NULL AND s.work_type <> '') AS is_working,
  (s.work_type = 'Labour')                        AS is_child_labour,
  s.student_income_tk, s.mother_income_tk, s.household_income_tk,
  CASE WHEN s.household_income_tk IS NULL THEN NULL
       WHEN s.household_income_tk < 5000  THEN '<5000'
       WHEN s.household_income_tk < 10000 THEN '5000-9999'
       WHEN s.household_income_tk < 15000 THEN '10000-14999'
       ELSE '15000+' END                          AS household_income_band,
  s.father_education, s.mother_education,
  (s.father_education = 'No Education' OR s.mother_education = 'No Education') AS parent_no_education,
  s.residency_type,
  (s.residency_type IN ('Rented House', 'Landless')) AS insecure_housing,
  -- Household head's occupation. Only present in the 14-08-26 export; NULL throughout the older
  -- one, where the coverage gate simply drops it as a factor.
  s.guardian_occupation,
  (s.guardian_occupation = 'Day Labour') AS guardian_day_labour,
  s.mainstream_status,
  (COALESCE(s.mainstreamed, 0) = 1) AS is_mainstreamed,
  (s.dropout_reason IS NOT NULL) AS is_dropout,
  s.dropout_reason,
  -- "Active" = still in the programme: not yet mainstreamed AND not dropped out.
  -- Derived (source has no explicit status column) — DEFINITION TO CONFIRM WITH CLIENT.
  (COALESCE(s.mainstreamed, 0) = 0 AND s.dropout_reason IS NULL) AS is_active,
  s.admitted_grade, s.education_start_date
FROM students s
-- Student names live only in the attendance export (profiles have none), so join them in
-- so every student query can show a readable name alongside the id.
LEFT JOIN (SELECT student_id, any_value(student_name) AS student_name FROM attendance GROUP BY student_id) n
  USING (student_id);

-- Teachers with an active flag and a normalised gender label.
CREATE OR REPLACE VIEW v_teachers AS
SELECT
  center_id, teacher_name, division, district, upazila,
  gender,
  CASE gender WHEN 'Woman' THEN 'Female' WHEN 'Man' THEN 'Male' ELSE gender END AS gender_label,
  employment_status,
  (employment_status = 'Active') AS is_active,
  education, experience, religion, marital_status
FROM teachers;

-- Attendance rows. CRITICAL: 0 means NOT RECORDED for this student-month (only ~17% of rows
-- carry a real value), so every attendance metric must use is_recorded, never a blanket average.
CREATE OR REPLACE VIEW v_attendance AS
SELECT
  student_id, student_name, center_id, attendance_pct,
  (attendance_pct IS NOT NULL AND attendance_pct > 0) AS is_recorded,
  -- PROVENANCE. 0 in both real datasets. In Preview it is 1 only where the value was INVENTED —
  -- Preview now takes the measured figure from the newer export wherever one exists, so a Preview
  -- answer can say how much of it is real instead of blanket-labelling everything "estimated".
  (COALESCE(is_estimated, 0) = 1) AS is_estimated
FROM attendance;

-- Per-student attendance with correct semantics: average over RECORDED months only, plus coverage.
CREATE OR REPLACE VIEW v_student_attendance AS
SELECT
  student_id,
  any_value(student_name) AS student_name,
  any_value(center_id)    AS center_id,
  count(*) FILTER (WHERE is_recorded)                     AS recorded_months,
  count(*)                                                AS total_months,
  round(avg(attendance_pct) FILTER (WHERE is_recorded), 1) AS avg_attendance_recorded,
  -- Transparent value: average over ALL months, counting the 0 (not-recorded) months as 0.
  -- Never null — so a learner with only 0s shows 0 (with recorded_months=0), not a blank.
  round(avg(attendance_pct), 1)                           AS avg_attendance_all,
  -- TRUE when this learner's attendance was invented by Preview rather than measured.
  bool_or(is_estimated)                                   AS attendance_estimated
FROM v_attendance
GROUP BY student_id;

-- Monthly attendance trend (PREVIEW/estimated only — empty in Real mode, which has no monthly data).
-- Grain: division × programme × month. Stores n_students + sum_attendance so a weighted average is
-- exact when grouping by any subset: avg = sum(sum_attendance) / sum(n_students).
CREATE OR REPLACE VIEW v_attendance_monthly AS
SELECT
  month_num, month, division, programme, n_students, sum_attendance,
  round(sum_attendance / nullif(n_students, 0), 1) AS avg_attendance_pct
FROM attendance_monthly;

-- PREDICTION (Preview only): linear-trend forecast of NEXT month's attendance, per division ×
-- programme. Fitted over the RECENT window (the last 6 observed months) so the projection follows
-- the CURRENT pattern rather than being flattened by the whole year. slope = regr_slope over
-- month_num; forecast = the fitted line one month past the last observed month.
-- Empty in Real (no monthly data). Data-driven, estimated.
-- METHOD (classical decomposition — the same three steps in both forecast views):
--   1. DESEASONALISE. Attendance has a strong monsoon shape (Jun–Sep dip, Nov–Dec recovery). A
--      seasonal index per month is derived FROM THE DATA (that month's network mean ÷ the overall
--      mean) and divided out. Skipping this is not a detail: regressing the raw series over a short
--      recent window reads the seasonal recovery as growth and calls almost every centre
--      "improving" — and extrapolating it pushes the forecast above 100%.
--   2. REGRESS the deseasonalised series over the RECENT window (last 6 months) → the underlying
--      trend, in %-points per month.
--   3. RESEASONALISE the projection with the NEXT month's index (month 12 → month 1) and clamp to
--      0–100, so the forecast stays a real attendance percentage.
CREATE OR REPLACE VIEW v_attendance_forecast AS
WITH m AS (
  SELECT division, programme, month_num,
         sum(sum_attendance) / nullif(sum(n_students), 0) AS avg_pct
  FROM v_attendance_monthly GROUP BY division, programme, month_num
),
si AS (
  SELECT month_num, avg(avg_pct) / nullif((SELECT avg(avg_pct) FROM m), 0) AS idx
  FROM m GROUP BY month_num
),
d AS (
  SELECT m.division, m.programme, m.month_num, m.avg_pct / nullif(si.idx, 0) AS des
  FROM m JOIN si USING (month_num)
),
w AS (SELECT max(month_num) - 6 AS from_month FROM m),
t AS (
  SELECT d.division, d.programme,
         regr_slope(d.des, d.month_num)     AS slope,
         regr_intercept(d.des, d.month_num) AS intercept,
         max(d.month_num)                   AS last_month,
         count(*)                           AS months
  FROM d, w WHERE d.month_num > w.from_month
  GROUP BY d.division, d.programme
)
SELECT t.division, t.programme,
       round(least(100, greatest(0, (t.intercept + t.slope * t.last_month) * sc.idx)), 1)       AS current_pct,
       round(least(100, greatest(0, (t.intercept + t.slope * (t.last_month + 1)) * sn.idx)), 1) AS forecast_next_month_pct,
       round(t.slope, 2)                                                                        AS monthly_change_pct,
       t.months                                                                                 AS months_used,
       CASE WHEN t.slope > 0.2 THEN 'improving' WHEN t.slope < -0.2 THEN 'declining' ELSE 'stable' END AS trend
FROM t
LEFT JOIN si sc ON sc.month_num = ((t.last_month - 1) % 12) + 1
LEFT JOIN si sn ON sn.month_num = (t.last_month % 12) + 1
WHERE t.months >= 2;

-- Per-CENTRE monthly attendance (Preview only) — the series a centre-level forecast needs.
-- Grain: centre × month. avg = sum_attendance / n_students. Empty in Real mode.
CREATE OR REPLACE VIEW v_center_monthly AS
SELECT center_id, month_num, month, n_students, sum_attendance,
       round(sum_attendance / nullif(n_students, 0), 1) AS avg_attendance_pct
FROM attendance_center_monthly;

-- Every assessment mark joined to the student's programme / division / gender, so subject
-- analytics can be filtered by any qualifier. Long format: one row per student×subject×phase.
CREATE OR REPLACE VIEW v_marks AS
SELECT
  m.student_id, s.student_name, m.center_id, m.programme, m.subject, m.phase, m.mark,
  s.division, s.district, s.gender, s.gender_label
FROM assessments m
LEFT JOIN v_students s USING (student_id);

-- Per student × subject average (over that student's marks). Powers "students with poor Bangla",
-- "students scoring below X in Mathematics", etc.
CREATE OR REPLACE VIEW v_student_subject AS
SELECT
  student_id,
  any_value(student_name) AS student_name,
  any_value(center_id) AS center_id,
  any_value(programme) AS programme,
  subject,
  round(avg(mark), 1) AS avg_mark,
  count(*)            AS n_marks,
  any_value(division) AS division,
  any_value(district) AS district,
  any_value(gender)   AS gender
FROM v_marks
GROUP BY student_id, subject;

-- Student-to-teacher ratio BY DIVISION — the metric the old app answered with a gender split.
-- Denominator is ACTIVE teachers.
CREATE OR REPLACE VIEW v_teacher_ratio_by_division AS
SELECT
  s.division,
  s.students,
  COALESCE(t.active_teachers, 0) AS active_teachers,
  round(s.students * 1.0 / NULLIF(t.active_teachers, 0), 1) AS students_per_teacher
FROM (SELECT division, count(*) AS students FROM students GROUP BY division) s
LEFT JOIN (
  SELECT division, count(*) AS active_teachers FROM teachers WHERE employment_status = 'Active' GROUP BY division
) t USING (division);

-- Enrollment by year (from Education Start Date) — powers "this year vs last year".
CREATE OR REPLACE VIEW v_enrollment_by_year AS
SELECT enrollment_year, count(*) AS enrolled
FROM students
WHERE enrollment_year IS NOT NULL
GROUP BY enrollment_year;

-- One row per centre: size (enrolment), teachers, attendance, and M&E score. Powers
-- "centres with more than N students", "biggest centres", centre quality questions.
-- Division/name come from the M&E centres table when present, else division falls back to the
-- students' division (M&E only covers ~1,398 of ~1,630 student centres, incl. none of the biggest).
CREATE OR REPLACE VIEW v_center_enrollment AS
SELECT
  sc.center_id,
  ce.center_name,
  COALESCE(ce.division, sc.division) AS division,
  ce.district,
  ce.overall_score AS me_score,
  -- The 5 M&E dimensions behind me_score — exposed so "WHY is a centre weak?" can name the driver.
  ce.pedagogy,
  ce.assessments AS assessment_quality,
  ce.documentation,
  ce.learning_environment,
  ce.engagement,
  sc.students,
  COALESCE(tc.teachers, 0) AS teachers,
  ac.avg_attendance_recorded
FROM (
  SELECT center_id, count(*) AS students, mode(division) AS division
  FROM students GROUP BY center_id
) sc
LEFT JOIN centers ce USING (center_id)
LEFT JOIN (SELECT center_id, count(*) AS teachers FROM teachers WHERE center_id IS NOT NULL GROUP BY center_id) tc USING (center_id)
LEFT JOIN (SELECT center_id, round(avg(avg_attendance_recorded), 1) AS avg_attendance_recorded FROM v_student_attendance GROUP BY center_id) ac USING (center_id);

-- PREDICTION (Preview): per-centre FORECAST of next month + likelihood of ranking among the WORST.
-- Each centre is regressed over its OWN recent months (the last 6 in v_center_monthly), so the
-- projection follows that centre's current trajectory — not a division-wide average. Then the
-- projected attendance (60%) is blended with the M&E overall score (40%, scaled 0–5 → 0–1) into
-- likelihood_worst_pct: a RELATIVE, data-driven estimate of poor performance next month — an
-- ESTIMATE, NOT a calibrated statistical probability. Worst-first. Empty in Real (no monthly data).
-- Same three-step method as v_attendance_forecast: deseasonalise → regress the recent window →
-- reseasonalise and clamp. The seasonal index is derived from the centre series itself.
CREATE OR REPLACE VIEW v_center_forecast AS
WITH m AS (
  SELECT center_id, month_num, sum_attendance / nullif(n_students, 0) AS avg_pct
  FROM attendance_center_monthly
),
si AS (
  SELECT month_num, avg(avg_pct) / nullif((SELECT avg(avg_pct) FROM m), 0) AS idx
  FROM m GROUP BY month_num
),
d AS (
  SELECT m.center_id, m.month_num, m.avg_pct / nullif(si.idx, 0) AS des
  FROM m JOIN si USING (month_num)
),
w AS (SELECT max(month_num) - 6 AS from_month FROM m),
t AS (
  SELECT d.center_id,
         regr_slope(d.des, d.month_num)     AS slope,
         regr_intercept(d.des, d.month_num) AS intercept,
         max(d.month_num)                   AS last_month,
         count(*)                           AS months
  FROM d, w WHERE d.month_num > w.from_month
  GROUP BY d.center_id HAVING count(*) >= 2
),
p AS (
  SELECT t.center_id, ce.center_name, ce.division, ce.students, ce.me_score,
         round(least(100, greatest(0, (t.intercept + t.slope * t.last_month) * sc.idx)), 1)       AS current_attendance_pct,
         round(least(100, greatest(0, (t.intercept + t.slope * (t.last_month + 1)) * sn.idx)), 1) AS forecast_next_month_pct,
         round(t.slope, 2)                                                                        AS monthly_change_pct,
         t.months                                                                                 AS months_used,
         CASE WHEN t.slope > 0.2 THEN 'improving' WHEN t.slope < -0.2 THEN 'declining' ELSE 'stable' END AS trend
  FROM t
  LEFT JOIN v_center_enrollment ce USING (center_id)
  LEFT JOIN si sc ON sc.month_num = ((t.last_month - 1) % 12) + 1
  LEFT JOIN si sn ON sn.month_num = (t.last_month % 12) + 1
)
SELECT center_id, center_name, division, students, me_score,
       current_attendance_pct, forecast_next_month_pct, monthly_change_pct, months_used, trend,
       round(100 * (0.6 * (1 - forecast_next_month_pct / 100.0)
                  + 0.4 * (1 - COALESCE(me_score, 2.5) / 5.0)), 1) AS likelihood_worst_pct
FROM p
ORDER BY likelihood_worst_pct DESC;

-- ── SCORE / READING LEVELS BY AREA ────────────────────────────────────────────
-- "How many children are at each reading or score level by area?"
--
-- The bands are the programme's OWN scale, copied from the design tokens where they are marked
-- "these carry meaning. Never improvise":  <40 | 40-49 | 50-59 | 60-79 | >=80.
--
-- IMPORTANT — there is no separate reading assessment in this data. Reading is approximated by the
-- LANGUAGE subjects (Bangla, English) via is_reading; every other subject is a plain score level.
-- Only learners who HAVE a mark appear here (~30% coverage), so counts are of assessed children,
-- never of all enrolled children — say so whenever these numbers are reported.
CREATE OR REPLACE VIEW v_score_levels AS
SELECT
  ss.student_id, ss.student_name, ss.subject, ss.programme, ss.avg_mark,
  st.division, st.district, st.center_id,
  (ss.subject IN ('Bangla', 'English')) AS is_reading,
  CASE
    WHEN ss.avg_mark < 40 THEN 'Below baseline (under 40)'
    WHEN ss.avg_mark < 50 THEN 'Weak (40-49)'
    WHEN ss.avg_mark < 60 THEN 'Approaching (50-59)'
    WHEN ss.avg_mark < 80 THEN 'Competent (60-79)'
    ELSE 'Strong (80+)'
  END AS score_level,
  CASE
    WHEN ss.avg_mark < 40 THEN 1
    WHEN ss.avg_mark < 50 THEN 2
    WHEN ss.avg_mark < 60 THEN 3
    WHEN ss.avg_mark < 80 THEN 4
    ELSE 5
  END AS level_order
FROM v_student_subject ss
JOIN v_students st USING (student_id)
WHERE ss.avg_mark IS NOT NULL;

-- ── CENTRE ECONOMIC PRESSURE (attendance × household hardship) ────────────────
-- Separates centres where low attendance goes together with economic hardship (act with cash
-- support / family outreach) from centres where it does not (act on centre quality instead).
-- Every marker is carried BOTH as the centre's own value and as the network value on the same row,
-- so a quantified comparison ("X% here vs Y% network-wide") can be made without a second query.
--
-- COVERAGE GATE: attendance is only recorded for a minority of learners, so a centre resting on a
-- handful of records must not be ranked beside a well-measured one. attendance_coverage_pct and
-- attendance_confidence expose that; filter attendance_confidence <> 'low' when ranking.
CREATE OR REPLACE VIEW v_center_economic_pressure AS
WITH marks AS (
  SELECT center_id,
         count(*)                                                                              AS students,
         100.0 * avg(CASE WHEN household_income_band IN ('<5000', '5000-9999') THEN 1 ELSE 0 END) AS pct_low_income,
         100.0 * avg(CASE WHEN is_working THEN 1 ELSE 0 END)                                   AS pct_working,
         100.0 * avg(CASE WHEN is_child_labour THEN 1 ELSE 0 END)                              AS pct_child_labour,
         100.0 * avg(CASE WHEN parent_no_education THEN 1 ELSE 0 END)                          AS pct_parent_no_education
  FROM v_students GROUP BY center_id
),
att AS (
  SELECT center_id,
         count(*)                                             AS learners,
         count(*) FILTER (WHERE recorded_months > 0)          AS learners_with_record,
         round(avg(avg_attendance_recorded) FILTER (WHERE recorded_months > 0), 1) AS avg_attendance_recorded
  FROM v_student_attendance GROUP BY center_id
),
net AS (
  SELECT
    100.0 * avg(CASE WHEN household_income_band IN ('<5000', '5000-9999') THEN 1 ELSE 0 END) AS net_low_income,
    100.0 * avg(CASE WHEN is_working THEN 1 ELSE 0 END)                                      AS net_working,
    100.0 * avg(CASE WHEN is_child_labour THEN 1 ELSE 0 END)                                 AS net_child_labour,
    100.0 * avg(CASE WHEN parent_no_education THEN 1 ELSE 0 END)                             AS net_parent_no_education
  FROM v_students
)
SELECT
  ce.center_id, ce.center_name, ce.division, m.students,
  a.avg_attendance_recorded,
  round(100.0 * a.learners_with_record / nullif(a.learners, 0), 1) AS attendance_coverage_pct,
  CASE WHEN a.learners_with_record < 5 OR 100.0 * a.learners_with_record / nullif(a.learners, 0) < 20
       THEN 'low' ELSE 'ok' END                                   AS attendance_confidence,
  (a.avg_attendance_recorded < 85)                                AS below_85,
  round(m.pct_low_income, 1)            AS pct_low_income,
  round(n.net_low_income, 1)            AS network_pct_low_income,
  round(m.pct_working, 1)               AS pct_working,
  round(n.net_working, 1)               AS network_pct_working,
  round(m.pct_child_labour, 1)          AS pct_child_labour,
  round(n.net_child_labour, 1)          AS network_pct_child_labour,
  round(m.pct_parent_no_education, 1)   AS pct_parent_no_education,
  round(n.net_parent_no_education, 1)   AS network_pct_parent_no_education,
  ce.engagement                         AS community_engagement_score,
  -- Elevated on at least one hardship marker, by a margin wide enough to be meaningful (5 points).
  (m.pct_low_income >= n.net_low_income + 5 OR m.pct_working >= n.net_working + 5
   OR m.pct_parent_no_education >= n.net_parent_no_education + 5)                  AS economic_pressure,
  -- How far above the network this centre sits, summed across the markers. Ranks the pressure.
  round(greatest(0, m.pct_low_income - n.net_low_income)
      + greatest(0, m.pct_working - n.net_working)
      + greatest(0, m.pct_parent_no_education - n.net_parent_no_education), 1)     AS economic_pressure_score
FROM v_center_enrollment ce
JOIN marks m USING (center_id)
LEFT JOIN att a USING (center_id)
CROSS JOIN net n;

-- ── PREDICTIVE FOUNDATION (T1) ────────────────────────────────────────────────
-- Data-completeness reference: for each key field, how many students carry a REAL
-- (non-null, non-blank) value vs the total, network-wide. Every predictive score reads
-- this so it can attach an honest confidence/coverage badge. Reflects the ACTIVE DATASET:
-- Real shows the true gaps (attendance ~17%, status mostly blank), Preview near-complete
-- (gap-filled). Blank string ('') counts as NOT present for the text fields.
CREATE OR REPLACE VIEW v_coverage AS
WITH s   AS (SELECT * FROM v_students),
     n   AS (SELECT count(*)::DOUBLE AS total FROM s),
     att AS (SELECT count(*) AS present FROM v_student_attendance WHERE recorded_months > 0),
     mk  AS (SELECT count(DISTINCT student_id) AS present FROM v_marks WHERE mark IS NOT NULL AND mark BETWEEN 0 AND 100)
SELECT field, present, total,
       round(100.0 * present / nullif(total, 0), 1) AS coverage_pct
FROM (
  SELECT 'attendance'         AS field, (SELECT present FROM att) AS present, (SELECT total FROM n) AS total
  UNION ALL SELECT 'assessment',        (SELECT present FROM mk),  (SELECT total FROM n)
  UNION ALL SELECT 'income',            count(*) FILTER (WHERE father_income_tk IS NOT NULL),                        (SELECT total FROM n) FROM s
  UNION ALL SELECT 'income_band',       count(*) FILTER (WHERE income_band IS NOT NULL AND income_band <> ''),       (SELECT total FROM n) FROM s
  UNION ALL SELECT 'mainstream_status', count(*) FILTER (WHERE mainstream_status IS NOT NULL AND mainstream_status <> ''), (SELECT total FROM n) FROM s
  UNION ALL SELECT 'dropout_reason',    count(*) FILTER (WHERE dropout_reason IS NOT NULL AND dropout_reason <> ''), (SELECT total FROM n) FROM s
  UNION ALL SELECT 'disability_type',   count(*) FILTER (WHERE disability_type IS NOT NULL AND disability_type <> ''), (SELECT total FROM n) FROM s
  UNION ALL SELECT 'religion',          count(*) FILTER (WHERE religion IS NOT NULL AND religion <> ''),             (SELECT total FROM n) FROM s
  UNION ALL SELECT 'ethnicity',         count(*) FILTER (WHERE ethnicity IS NOT NULL AND ethnicity <> ''),          (SELECT total FROM n) FROM s
  UNION ALL SELECT 'admitted_grade',    count(*) FILTER (WHERE admitted_grade IS NOT NULL AND admitted_grade <> ''), (SELECT total FROM n) FROM s
  UNION ALL SELECT 'enrollment_year',   count(*) FILTER (WHERE enrollment_year IS NOT NULL),                        (SELECT total FROM n) FROM s
) c
ORDER BY coverage_pct;

-- ── DROPOUT RISK (T2) ─────────────────────────────────────────────────────────
-- Rule-based, explainable risk score (0–100) per student. Built ONLY from leading
-- indicators that exist in the data — income, attendance, assessment, vulnerability —
-- and NEVER from the dropout outcome itself (no circularity). Each factor contributes
-- capped points that sum to the score, and the r_* columns are the plain-language
-- drivers. confidence_pct = how many of the 4 signal groups had real data behind this
-- student (attendance/assessment are sparse in Real, near-complete in Preview).
CREATE OR REPLACE VIEW v_dropout_risk AS
WITH base AS (
  SELECT s.student_id, s.student_name, s.programme, s.division, s.district, s.gender_label,
         s.income_band, s.disability_type, s.ethnicity, s.nutrition,
         s.is_dropout, s.is_active, s.is_mainstreamed, s.mainstream_status,
         sa.avg_attendance_recorded, sa.recorded_months,
         ss.avg_mark, ss.n_marks
  FROM v_students s
  LEFT JOIN v_student_attendance sa USING (student_id)
  LEFT JOIN (SELECT student_id, round(avg(avg_mark),1) AS avg_mark, sum(n_marks) AS n_marks
             FROM v_student_subject GROUP BY student_id) ss USING (student_id)
),
scored AS (
  SELECT *,
    -- Weights TUNED to the data (see npm run check:risk): attendance & marks separate dropouts strongly,
    -- income barely does, so income is capped low (15) and assessment carries the most (35).
    (CASE income_band WHEN '<5000' THEN 15 WHEN '5000-9999' THEN 9 WHEN '10000-14999' THEN 4 WHEN '15000+' THEN 0 ELSE 5 END) AS r_income,
    (CASE WHEN recorded_months > 0 THEN round(30 * (1 - LEAST(GREATEST(avg_attendance_recorded,0),100)/100.0)) ELSE 0 END) AS r_attendance,
    (CASE WHEN n_marks > 0 THEN round(35 * (1 - LEAST(GREATEST(avg_mark,0),100)/100.0)) ELSE 0 END) AS r_assessment,
    ((CASE WHEN disability_type IS NOT NULL AND disability_type <> '' THEN 6 ELSE 0 END)
     + (CASE WHEN nutrition IN ('Bad','Not so good') THEN 7 ELSE 0 END)
     + (CASE WHEN ethnicity IS NOT NULL AND ethnicity <> '' AND ethnicity <> 'Others' THEN 7 ELSE 0 END)) AS r_vulnerability,
    ((CASE WHEN income_band IS NOT NULL THEN 1 ELSE 0 END)
     + (CASE WHEN recorded_months > 0 THEN 1 ELSE 0 END)
     + (CASE WHEN n_marks > 0 THEN 1 ELSE 0 END) + 1) AS signals_present
  FROM base
)
SELECT student_id, student_name, programme, division, district, gender_label, income_band,
       avg_attendance_recorded, avg_mark,
       LEAST(100, r_income + r_attendance + r_assessment + r_vulnerability)::INTEGER AS risk_score,
       r_income::INTEGER AS r_income, r_attendance::INTEGER AS r_attendance,
       r_assessment::INTEGER AS r_assessment, r_vulnerability::INTEGER AS r_vulnerability,
       round(100.0 * signals_present / 4, 0)::INTEGER AS confidence_pct,
       is_active, is_mainstreamed,
       -- CLEAN dropout label: has a dropout reason AND was NOT mainstreamed. Use this, not is_dropout
       -- (which is contaminated — ~101k mainstreamed students also carry a dropout_reason).
       (is_dropout AND COALESCE(mainstream_status, '') <> 'Mainstreamed') AS is_true_dropout
FROM scored;

-- ── CENTER DATA-TRUST (T8) ────────────────────────────────────────────────────
-- Which centres' data is too sparse/stale to trust before acting on their numbers.
-- attendance_coverage_pct = share of the centre's students with any recorded attendance
-- is_evaluated = has an M&E score. trust flags the rest so bad-data centres are fixed first.
CREATE OR REPLACE VIEW v_center_health AS
WITH att AS (
  SELECT center_id, count(*) FILTER (WHERE recorded_months > 0) AS with_att
  FROM v_student_attendance GROUP BY center_id
)
SELECT ce.center_id, ce.center_name, ce.division, ce.students, ce.me_score,
  round(100.0 * COALESCE(a.with_att, 0) / nullif(ce.students, 0), 1) AS attendance_coverage_pct,
  (ce.me_score IS NOT NULL) AS is_evaluated,
  CASE
    WHEN ce.me_score IS NULL OR COALESCE(a.with_att, 0) * 10 < ce.students THEN 'untrustworthy'
    WHEN COALESCE(a.with_att, 0) * 100 < ce.students * 40 THEN 'partial'
    ELSE 'reliable'
  END AS trust
FROM v_center_enrollment ce
LEFT JOIN att a USING (center_id);

-- ── VULNERABILITY STACKING (T8) ───────────────────────────────────────────────
-- Students carrying MULTIPLE risk markers at once (compounding vulnerability = strongest signal).
-- marker_count sums: girl + lowest-income + disability + minority ethnicity + poor nutrition.
CREATE OR REPLACE VIEW v_vulnerability AS
SELECT student_id, student_name, programme, division, gender_label, income_band,
  ((CASE WHEN gender_label = 'Female' THEN 1 ELSE 0 END)
   + (CASE WHEN income_band = '<5000' THEN 1 ELSE 0 END)
   + (CASE WHEN disability_type IS NOT NULL AND disability_type <> '' THEN 1 ELSE 0 END)
   + (CASE WHEN ethnicity IS NOT NULL AND ethnicity <> '' AND ethnicity <> 'Others' THEN 1 ELSE 0 END)
   + (CASE WHEN nutrition IN ('Bad', 'Not so good') THEN 1 ELSE 0 END))::INTEGER AS marker_count,
  is_active
FROM v_students;

-- ── ATTENDANCE RECENCY (Preview only) ─────────────────────────────────────────
-- The source data has NO dates — attendance.csv holds one lifetime % per learner. attendance_gaps
-- adds the missing RECENCY dimension: how long since this learner last attended. Only learners WITH
-- a gap are stored, so anyone absent from it is currently attending → days_since = 0.
CREATE OR REPLACE VIEW v_attendance_recency AS
SELECT s.student_id,
  COALESCE(g.days_since_last_attendance, 0) AS days_since_last_attendance,
  g.last_attended_month,
  g.recent_attendance_pct,
  (COALESCE(g.days_since_last_attendance, 0) >= 14) AS absent_2w,
  (COALESCE(g.days_since_last_attendance, 0) >= 30) AS absent_1m
FROM v_students s
LEFT JOIN attendance_gaps g USING (student_id);

-- ── GHOST / INACTIVE STUDENTS (T-P4, Preview-oriented) ────────────────────────
-- A GHOST is an enrolled-and-active learner who has effectively stopped attending — the silent
-- dropout a register still counts. The rule, on ACTIVE students only, is BOTH of:
--   1. no attendance in the last 2 weeks — days_since_last_attendance >= 14, OR no attendance was
--      EVER recorded (recorded_months = 0, which is absence by definition)
--   2. no assessment marks at all (n_marks = 0)
-- activity_status grades the population so near-misses stay visible:
--   'ghost'   — both signals: gone quiet and never assessed
--   'at_risk' — absent >= 14 days but still has marks/attendance history (fading, not yet gone)
--   'active'  — attending
-- In PREVIEW the 150 DUMMY learners with ids starting 99… are seeded precisely to exercise this
-- rule (every other Preview learner is gap-filled, so nothing else could be a ghost). In REAL there
-- is no recency data at all, so clause 1 degrades to the never-recorded signal — and at ~17%
-- attendance / ~30% marks coverage that mostly reflects MISSING DATA, not true inactivity, so a
-- Real-mode result must always be reported with that caveat.
CREATE OR REPLACE VIEW v_ghost_students AS
SELECT s.student_id, s.student_name, s.programme, s.division, s.center_id, s.enrollment_year,
  COALESCE(sa.recorded_months, 0) AS recorded_months,
  COALESCE(ss.n_marks, 0) AS n_marks,
  COALESCE(rc.days_since_last_attendance, 0) AS days_since_last_attendance,
  rc.last_attended_month,
  (COALESCE(rc.absent_2w, FALSE) OR COALESCE(sa.recorded_months, 0) = 0) AS no_attendance_2w,
  (COALESCE(ss.n_marks, 0) = 0) AS no_assessment,
  (COALESCE(sa.recorded_months, 0) = 0 AND COALESCE(ss.n_marks, 0) = 0) AS is_inactive,
  ((COALESCE(rc.absent_2w, FALSE) OR COALESCE(sa.recorded_months, 0) = 0)
    AND COALESCE(ss.n_marks, 0) = 0) AS is_ghost,
  CASE
    WHEN (COALESCE(rc.absent_2w, FALSE) OR COALESCE(sa.recorded_months, 0) = 0)
         AND COALESCE(ss.n_marks, 0) = 0 THEN 'ghost'
    WHEN COALESCE(rc.absent_2w, FALSE) THEN 'at_risk'
    ELSE 'active'
  END AS activity_status
FROM v_students s
LEFT JOIN v_student_attendance sa USING (student_id)
LEFT JOIN (SELECT student_id, sum(n_marks) AS n_marks FROM v_student_subject GROUP BY student_id) ss USING (student_id)
LEFT JOIN v_attendance_recency rc USING (student_id)
WHERE s.is_active;

-- ── TEACHER ↔ SUBJECT ↔ BATCH (T-P4b, SIMULATED / Preview-only) ────────────────
-- The real data links teachers to a CENTRE only, never to subjects/students. This DERIVES an
-- illustrative teacher->subject->batch mapping (deterministic hash of the name, so it is stable),
-- so the "who teaches the weak subjects" drill-down can be demonstrated. It is SIMULATED, not real,
-- so its analysis card is Preview-only. No new base table — derived from the existing teachers table.
CREATE OR REPLACE VIEW v_teacher_batch AS
SELECT center_id, teacher_name, division,
  CASE hash(teacher_name) % 7
    WHEN 0 THEN 'Bangla' WHEN 1 THEN 'Mathematics' WHEN 2 THEN 'English'
    WHEN 3 THEN 'Science' WHEN 4 THEN 'BGS' WHEN 5 THEN 'Life Skills' ELSE 'Religion'
  END AS subject,
  'Batch ' || ((hash(teacher_name) % 3) + 1)::VARCHAR AS batch,
  experience
FROM teachers
WHERE center_id IS NOT NULL AND teacher_name IS NOT NULL;

-- ── FIELD-OFFICER CONTACTS (T-P4b, SIMULATED / Preview-only) ──────────────────
-- The real data has no contact/reporting reference. This is an illustrative field-officer per
-- division so the "who to contact / report to" decision step can be demonstrated. Simulated.
CREATE OR REPLACE VIEW v_field_contact AS
SELECT * FROM (VALUES
  ('Dhaka',      'Md. Rahman',    '+8801711-010001'),
  ('Mymensingh', 'Shirin Akter',  '+8801711-010002'),
  ('Chattogram', 'A. Karim',      '+8801711-010003'),
  ('Sylhet',     'R. Haque',      '+8801711-010004'),
  ('Rangpur',    'N. Islam',      '+8801711-010005'),
  ('Barishal',   'F. Begum',      '+8801711-010006'),
  ('Khulna',     'T. Chowdhury',  '+8801711-010007'),
  ('Rajshahi',   'M. Ali',        '+8801711-010008')
) AS t(division, field_officer, phone);

-- Editable-data escape hatch: the FULL base table INCLUDING any custom fields the user added via the
-- Data editor (the curated v_students / v_center_enrollment select named columns, so a newly added
-- field surfaces HERE). Query these to read/aggregate user-added fields.
CREATE OR REPLACE VIEW v_student_ext AS SELECT * FROM students;
CREATE OR REPLACE VIEW v_center_ext AS SELECT * FROM centers;
