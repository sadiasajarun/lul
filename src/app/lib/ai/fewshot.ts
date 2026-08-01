// Golden examples: real question → correct DuckDB SQL against the semantic views.
// This single technique lifts text-to-SQL accuracy more than almost anything else — the model
// learns the view names, the synonym mappings, and the honest-metric patterns from these.
// They double as eval-harness seeds (every SQL here is executed and checked in Node).

export interface FewShot {
  q: string;
  sql: string;
  /** Optional teaching note appended after the SQL for the model. */
  note?: string;
}

export const FEW_SHOTS: FewShot[] = [
  { q: 'How many students are there in total?',
    sql: `SELECT count(*) AS total_students FROM v_students` },

  { q: 'What is the female student count?',
    sql: `SELECT count(*) AS female_students FROM v_students WHERE gender_label = 'Female'`,
    note: "map girls/female/women → gender_label = 'Female'." },

  { q: 'Show attendance month by month',
    sql: `SELECT month, round(sum(sum_attendance) / sum(n_students), 1) AS avg_attendance_pct
FROM v_attendance_monthly
GROUP BY month, month_num
ORDER BY month_num`,
    note: 'monthly attendance lives in v_attendance_monthly. When the ACTIVE DATASET note says PREVIEW, it IS populated — ANSWER with this query (figures are estimated); only in REAL mode is it empty/unsupported. Always weight by n_students via sum(sum_attendance)/sum(n_students), and ORDER BY month_num. To break down by division, add it to SELECT and GROUP BY.' },

  { q: 'What percent of students are girls?',
    sql: `SELECT round(100.0 * count(*) FILTER (WHERE gender_label = 'Female') / count(*), 1) AS pct_female FROM v_students` },

  { q: 'How many girls are in Catchup in Dhaka?',
    sql: `SELECT count(*) AS students FROM v_students WHERE gender_label = 'Female' AND programme = 'Catchup' AND division = 'Dhaka'`,
    note: 'honour EVERY qualifier — gender AND programme AND division together.' },

  { q: 'How many students were mainstreamed?',
    sql: `SELECT count(*) AS mainstreamed FROM v_students WHERE is_mainstreamed`,
    note: 'mainstreamed is its own flag — do NOT return total students.' },

  { q: 'What is the active student count?',
    sql: `SELECT count(*) AS active_students FROM v_students WHERE is_active` },

  { q: "What's the student-to-teacher ratio by division?",
    sql: `SELECT division, students, active_teachers, students_per_teacher FROM v_teacher_ratio_by_division ORDER BY students_per_teacher DESC`,
    note: 'use the ratio view — NOT teacher gender split.' },

  { q: 'Top 3 divisions by enrollment',
    sql: `SELECT division, count(*) AS enrolled FROM v_students GROUP BY division ORDER BY enrolled DESC LIMIT 3`,
    note: 'divisions, not students — group by division.' },

  { q: 'Give me the ABAL students who got poor results in Bangla',
    sql: `SELECT student_id, student_name, division, avg_mark AS bangla_avg, n_marks FROM v_student_subject
WHERE programme = 'ABAL' AND subject = 'Bangla' AND avg_mark IS NOT NULL
ORDER BY avg_mark ASC LIMIT 20`,
    note: 'a LIST of students (lowest marks) — include student_name and division, not just the id.' },

  { q: 'What is the average Bangla score in ABAL?',
    sql: `SELECT round(avg(mark), 1) AS avg_bangla, count(*) AS marks FROM v_marks WHERE programme = 'ABAL' AND subject = 'Bangla'`,
    note: 'this one really does want the average (contrast with the poor-students list).' },

  { q: 'Are there any centres with more than 30 students?',
    sql: `SELECT center_id, center_name, division, students, teachers FROM v_center_enrollment WHERE students > 30 ORDER BY students DESC`,
    note: 'centres → include center_name and division (name may be NULL where the centre was not evaluated).' },

  { q: 'How many students enrolled this year vs last year?',
    sql: `SELECT enrollment_year, enrolled FROM v_enrollment_by_year ORDER BY enrollment_year DESC LIMIT 2`,
    note: '"this/last year" → the two most recent enrollment years in the data.' },

  { q: 'Show attendance for student 264814181329',
    sql: `SELECT student_id, student_name, avg_attendance_all AS attendance_pct,
avg_attendance_recorded, recorded_months, total_months
FROM v_student_attendance WHERE student_id = '264814181329'`,
    note: 'per-learner: show avg_attendance_all (0 shown transparently) WITH recorded_months so a not-recorded 0 is visible, not hidden.' },

  { q: 'What is the average attendance?',
    sql: `SELECT round(avg(avg_attendance_recorded), 1) AS mean_attendance,
count(*) FILTER (WHERE avg_attendance_recorded IS NOT NULL) AS students_with_records,
count(*) AS total_students FROM v_student_attendance`,
    note: 'attendance 0 = not recorded; average only over students with records and report coverage.' },

  { q: 'Average family income of dropout students in Barishal',
    sql: `SELECT income_band, count(*) AS students,
round(avg(father_income_tk)) AS approx_avg_income_tk
FROM v_students WHERE is_dropout AND division = 'Barishal'
GROUP BY income_band ORDER BY students DESC`,
    note: 'income is banded/approximate — show the band distribution plus an approximate mean.' },

  { q: 'What are the main dropout reasons?',
    sql: `SELECT dropout_reason, count(*) AS students FROM v_students WHERE is_dropout GROUP BY dropout_reason ORDER BY students DESC` },

  { q: 'Which centres have the worst attendance?',
    sql: `SELECT center_id, division, avg_attendance_recorded FROM v_center_enrollment
WHERE avg_attendance_recorded IS NOT NULL ORDER BY avg_attendance_recorded ASC LIMIT 10` },
];

/** Render the examples as a compact block for the prompt. */
export function renderFewShots(shots: FewShot[] = FEW_SHOTS): string {
  return shots.map((s) => `Q: ${s.q}\nSQL: ${s.sql}${s.note ? `\n-- ${s.note}` : ''}`).join('\n\n');
}
