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
