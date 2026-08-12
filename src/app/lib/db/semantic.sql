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
  (attendance_pct IS NOT NULL AND attendance_pct > 0) AS is_recorded
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
  round(avg(attendance_pct), 1)                           AS avg_attendance_all
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

-- ── GHOST / INACTIVE STUDENTS (T-P4, Preview-oriented) ────────────────────────
-- Active students with NO recorded attendance AND NO assessment activity. Meaningful in Preview
-- (activity is gap-filled). In Real, ~17% attendance coverage means "no activity" mostly reflects
-- missing data, so the analysis card for this is Preview-only.
CREATE OR REPLACE VIEW v_ghost_students AS
SELECT s.student_id, s.student_name, s.programme, s.division, s.enrollment_year,
  COALESCE(sa.recorded_months, 0) AS recorded_months,
  COALESCE(ss.n_marks, 0) AS n_marks,
  (COALESCE(sa.recorded_months, 0) = 0 AND COALESCE(ss.n_marks, 0) = 0) AS is_inactive
FROM v_students s
LEFT JOIN v_student_attendance sa USING (student_id)
LEFT JOIN (SELECT student_id, sum(n_marks) AS n_marks FROM v_student_subject GROUP BY student_id) ss USING (student_id)
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
