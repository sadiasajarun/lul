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

  { q: 'Why are students dropping out?',
    sql: `SELECT dropout_reason, count(*) AS students
FROM v_students WHERE dropout_reason IS NOT NULL AND dropout_reason <> ''
GROUP BY dropout_reason ORDER BY students DESC`,
    note: "dropout reasons ARE tracked in v_students.dropout_reason — NEVER refuse 'why are students dropping out'; GROUP BY dropout_reason." },

  { q: 'Which centres need a visit?',
    sql: `SELECT center_id, center_name, division, me_score
FROM v_center_enrollment WHERE me_score IS NOT NULL
ORDER BY me_score ASC LIMIT 15`,
    note: "'need a visit' / 'need support' = the lowest-scoring centres — ORDER BY me_score ASC. Do NOT add restrictive filters that can return zero rows." },

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

  { q: 'Show dropout risk — the highest-risk students',
    sql: `SELECT student_id, student_name, division, risk_score, confidence_pct
FROM v_dropout_risk WHERE is_active ORDER BY risk_score DESC LIMIT 20`,
    note: 'at-risk-now list = is_active AND ORDER BY risk_score DESC; always include student_name + division and report confidence_pct.' },

  { q: 'Predict next month attendance / which divisions are trending down',
    sql: `SELECT division, programme, current_pct, forecast_next_month_pct, monthly_change_pct, trend
FROM v_attendance_forecast ORDER BY forecast_next_month_pct ASC`,
    note: 'the forecast is a linear-trend projection (Preview only, estimated). For "trending down" filter trend = \'declining\' or ORDER BY monthly_change_pct ASC.' },

  { q: "Which centres are most likely to be worst next month? / probability list of next month's worst centres",
    sql: `SELECT center_id, center_name, division, current_attendance_pct, forecast_next_month_pct, monthly_change_pct, trend, likelihood_worst_pct
FROM v_center_forecast ORDER BY likelihood_worst_pct DESC LIMIT 15`,
    note: 'A "predict/probability of worst centre next month" question IS answerable — v_center_forecast regresses each centre\'s OWN recent 6 months (deseasonalised) and blends the projection with M&E into likelihood_worst_pct, a RELATIVE data-driven estimate (Preview only, NOT a calibrated probability). NEVER refuse this — order by likelihood_worst_pct DESC and state it is an estimate.' },

  { q: 'Show me centre 401 / find centre 001 / look up a centre by id or name',
    sql: `SELECT center_id, center_name, division, students, me_score, avg_attendance_recorded
FROM v_center_enrollment
WHERE center_id = '401' OR center_id LIKE '%401' OR center_id LIKE '401%' OR center_name ILIKE '%401%'
ORDER BY center_id LIMIT 15`,
    note: "ENTITY LOOKUP. Centre ids are 9-11 digits (e.g. 263601401), so a short number the user types is almost never an exact id. Match it FOUR ways at once: exact, ends-with, starts-with, and inside the NAME (several centres are literally named 401 Cholo Anonde Shikhi Shikhon Kendro). Never conclude the centre does not exist after only trying an exact match. If several match, list them and ask which one." },

  { q: "Predict next month's attendance for centre 263601401",
    sql: `SELECT center_id, center_name, division, current_attendance_pct, forecast_next_month_pct,
monthly_change_pct, months_used, trend, likelihood_worst_pct
FROM v_center_forecast WHERE center_id = '263601401'`,
    note: "PREVIEW ONLY (Real mode is intercepted before you see it — there are no dated attendance records there). For ONE centre, filter v_center_forecast by center_id. If the id the user typed returns nothing, FIRST run the entity-lookup query above to find the real id, then forecast for that. Always label the figure estimated." },

  { q: 'How many children are at each reading/score level by area?',
    sql: `SELECT division, score_level, count(DISTINCT student_id) AS children
FROM v_score_levels WHERE is_reading
GROUP BY division, score_level, level_order
ORDER BY division, level_order`,
    note: "Bands come from v_score_levels and must NOT be improvised. For a READING question filter is_reading (Bangla/English) and say plainly that there is no separate reading test — language marks are the proxy. Drop the is_reading filter for all subjects, or add a subject filter for one. ORDER BY level_order so the bands run lowest-to-highest. Use count(DISTINCT student_id) because a child appears once per subject. ALWAYS state that these are ASSESSED children only (~30% of learners have a mark), not all enrolled children. Swap division for district or center_id for a finer area." },

  { q: 'Which low-attendance centres also show economic pressure?',
    sql: `SELECT center_id, center_name, division, avg_attendance_recorded, attendance_coverage_pct,
pct_low_income, network_pct_low_income, pct_working, network_pct_working,
pct_parent_no_education, network_pct_parent_no_education, community_engagement_score, economic_pressure_score
FROM v_center_economic_pressure
WHERE below_85 AND economic_pressure AND attendance_confidence <> 'low'
ORDER BY economic_pressure_score DESC LIMIT 20`,
    note: "v_center_economic_pressure already carries BOTH the centre value and the network value for every hardship marker, so the answer can quantify each comparison (X% here vs Y% network-wide) from this one query. ALWAYS filter attendance_confidence <> low-confidence centres — one with almost no recorded attendance must not be ranked beside a well-measured one. Report attendance_coverage_pct. These are ASSOCIATIONS, never causes." },

  { q: 'Which centres are at rising risk of low attendance?',
    sql: `SELECT center_id, center_name, division, current_attendance_pct, forecast_next_month_pct,
monthly_change_pct, trend, likelihood_worst_pct
FROM v_center_forecast WHERE trend = 'declining' ORDER BY monthly_change_pct ASC LIMIT 20`,
    note: 'PREVIEW ONLY. In Real mode this question never reaches you — attendance has no dates there, so a guard returns an explanation instead. In Preview, the monthly series is SIMULATED: label the answer "estimated — not for decisions" and describe DIRECTION of risk, not a dated prediction.' },

  { q: 'Which centres are declining fastest / will get worse next month?',
    sql: `SELECT center_id, center_name, division, current_attendance_pct, forecast_next_month_pct, monthly_change_pct, months_used
FROM v_center_forecast WHERE trend = 'declining' ORDER BY monthly_change_pct ASC LIMIT 15`,
    note: 'trend/direction questions → filter trend and order by monthly_change_pct ASC (most negative = falling fastest). monthly_change_pct already has seasonality removed, so it is the real trajectory.' },

  { q: 'Show ghost / inactive students',
    sql: `SELECT student_id, student_name, division, programme, days_since_last_attendance, recorded_months, n_marks
FROM v_ghost_students WHERE is_ghost ORDER BY days_since_last_attendance DESC LIMIT 30`,
    note: 'GHOST = no attendance in the last 2 weeks (or never recorded) AND no assessment marks. Use is_ghost. In PREVIEW these are ~150 SEEDED DEMO learners (ids starting 99…) — say they are demo records. In REAL the rule falls back to never-recorded, which mostly reflects the ~17% attendance coverage gap, so report that caveat. Add activity_status = \'at_risk\' to include learners who are absent but still assessed. NEVER answer this with a bare "no matching records".' },

  { q: 'Why are these students at risk? / what is driving the risk?',
    sql: `SELECT student_id, student_name, division, risk_score, r_assessment, r_attendance, r_vulnerability, r_income
FROM v_dropout_risk WHERE is_active AND risk_score >= 50 ORDER BY risk_score DESC LIMIT 300`,
    note: 'A "why" question needs the INDIVIDUAL students, not just their averages — the factor comparison runs on the cohort. Run the averages below as a SECOND query if you want the driver split.' },

  { q: 'What is the average driver split for at-risk students?',
    sql: `SELECT round(avg(r_assessment), 1) AS assessment_driver,
round(avg(r_attendance), 1) AS attendance_driver,
round(avg(r_vulnerability), 1) AS vulnerability_driver,
round(avg(r_income), 1) AS income_driver
FROM v_dropout_risk WHERE is_active AND risk_score >= 50`,
    note: 'A "why are these students at risk" follow-up is ANSWERABLE — average the four r_* DRIVERS across the at-risk cohort so the LARGEST is the reason (assessment is usually the biggest). NEVER refuse, and NEVER switch to centre evaluation scores — this is about STUDENTS. Reuse the previous at-risk filter.' },

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

  { q: 'What is the dominant / top dropout reason in each division?',
    sql: `SELECT division, dropout_reason, count(*) AS students
FROM v_students WHERE is_dropout AND dropout_reason IS NOT NULL AND dropout_reason <> ''
GROUP BY division, dropout_reason
QUALIFY row_number() OVER (PARTITION BY division ORDER BY count(*) DESC) = 1
ORDER BY students DESC`,
    note: 'THE dominant / top / leading / most common X "per" or "in each" Y = ONE row per Y, not every combination. Use DuckDB QUALIFY row_number() OVER (PARTITION BY <the per-group column> ORDER BY <measure> DESC) = 1. Returning all combinations makes the answer unreadable — only drop QUALIFY if the user asked for the full breakdown.' },

  { q: 'What are the main dropout reasons?',
    sql: `SELECT dropout_reason, count(*) AS students FROM v_students WHERE is_dropout GROUP BY dropout_reason ORDER BY students DESC` },

  { q: 'Which centres have the worst attendance?',
    sql: `SELECT center_id, division, avg_attendance_recorded FROM v_center_enrollment
WHERE avg_attendance_recorded IS NOT NULL ORDER BY avg_attendance_recorded ASC LIMIT 10` },

  { q: 'Which centres need a visit? (lowest M&E scores)',
    sql: `SELECT center_id, center_name, division, me_score FROM v_center_enrollment
WHERE me_score IS NOT NULL ORDER BY me_score ASC LIMIT 15` },

  // ── ATTENDANCE module ──────────────────────────────────────────────────────
  { q: 'Which centres have attendance below 85%?',
    sql: `SELECT center_id, center_name, division, students, avg_attendance_recorded
FROM v_center_enrollment
WHERE avg_attendance_recorded IS NOT NULL AND avg_attendance_recorded < 85
ORDER BY avg_attendance_recorded ASC LIMIT 30`,
    note: "85% is the programme's action threshold. avg_attendance_recorded averages only months that HAVE a value, so state attendance coverage alongside it. Say how many centres are below the line in total, not just the ones listed." },

  { q: 'Show centre-wise total attendance',
    sql: `SELECT center_id, center_name, division, students, avg_attendance_recorded
FROM v_center_enrollment
WHERE avg_attendance_recorded IS NOT NULL
ORDER BY avg_attendance_recorded DESC LIMIT 40`,
    note: 'One row per centre. Include center_name and division so the list is readable, and report the network average for comparison.' },

  { q: 'Show average attendance by division and programme',
    sql: `SELECT s.division, s.programme,
round(avg(a.avg_attendance_recorded), 1) AS avg_attendance,
count(*) FILTER (WHERE a.recorded_months > 0) AS learners_with_records,
count(*) AS learners
FROM v_students s JOIN v_student_attendance a USING (student_id)
GROUP BY s.division, s.programme
ORDER BY avg_attendance ASC`,
    note: 'v_student_attendance has no division, so join v_students for it. Always carry learners_with_records next to the average — a division with thin coverage must not be compared as an equal.' },

  { q: 'Why is attendance low — what are the reasons?',
    sql: `SELECT a.student_id, s.division, s.programme, a.avg_attendance_recorded,
s.income_band, s.is_working, s.parent_no_education, s.insecure_housing
FROM v_student_attendance a JOIN v_students s USING (student_id)
WHERE a.recorded_months > 0 AND a.avg_attendance_recorded < 60
ORDER BY a.avg_attendance_recorded ASC LIMIT 300`,
    note: 'A "why" question needs the INDIVIDUAL learners, not an aggregate — a downstream step compares this exact group against the network to find the associated factors, and it cannot run on a summary row. There is no recorded reason-for-absence field, so never invent one.' },

  // ── CENTRES module ─────────────────────────────────────────────────────────
  { q: 'Which centres have the highest monitoring score?',
    sql: `SELECT center_id, center_name, division, students, me_score
FROM v_center_enrollment WHERE me_score IS NOT NULL
ORDER BY me_score DESC LIMIT 15`,
    note: 'The mirror of "needs a visit". These are the centres worth learning from — say what the network average is so "highest" has a reference point.' },

  { q: "Which monitoring indicator scored lowest across centres? / what's the weakest monitoring indicator right now?",
    sql: `WITH m AS (
  SELECT round(avg(pedagogy), 2) AS pedagogy, count(pedagogy) AS n_pedagogy,
         round(avg(assessment_quality), 2) AS assessments, count(assessment_quality) AS n_assessments,
         round(avg(documentation), 2) AS documentation, count(documentation) AS n_documentation,
         round(avg(learning_environment), 2) AS environment, count(learning_environment) AS n_environment,
         round(avg(engagement), 2) AS engagement, count(engagement) AS n_engagement
  FROM v_center_enrollment
)
SELECT 'Pedagogy' AS indicator, pedagogy AS avg_score, n_pedagogy AS centres_scored FROM m
UNION ALL SELECT 'Assessments', assessments, n_assessments FROM m
UNION ALL SELECT 'Documentation', documentation, n_documentation FROM m
UNION ALL SELECT 'Learning environment', environment, n_environment FROM m
UNION ALL SELECT 'Community & family engagement', engagement, n_engagement FROM m
ORDER BY avg_score ASC`,
    note: 'SUPERLATIVE: return ALL FIVE indicators as ROWS, ordered worst-first — never just the winner. The reader needs the comparison to see whether the weakest is far below the others or barely different. This is the sanctioned UNION case: every row is the same 0-5 score, so they belong on one axis. Scores are 0-5 and must never be averaged against a 0-100 percentage. NOTE THE SHAPE: aggregate ONCE in a CTE, then read that single row five times. UNIONing five separate scans of v_center_enrollment computes the same answer but scans a heavy joined view five times over, which is slow in the browser and can exhaust memory outright.' },

  { q: 'Compare centres across all five monitoring indicators',
    sql: `SELECT center_id, center_name, division, pedagogy, assessment_quality,
documentation, learning_environment, engagement, me_score
FROM v_center_enrollment WHERE me_score IS NOT NULL
ORDER BY me_score ASC LIMIT 20`,
    note: 'One row per centre with all five dimensions side by side, so the weakest dimension per centre is visible. Order by me_score ASC to lead with the centres that need attention.' },

  // ── ASSESSMENT module ──────────────────────────────────────────────────────
  { q: 'Show average marks by division',
    sql: `SELECT division, round(avg(mark), 1) AS avg_mark,
count(DISTINCT student_id) AS learners_assessed, count(*) AS marks
FROM v_marks WHERE division IS NOT NULL
GROUP BY division ORDER BY avg_mark ASC`,
    note: 'v_marks already carries division. Use count(DISTINCT student_id) because a learner appears once per subject and phase. Only ~30% of learners have any mark — say so, and never present this as covering every child.' },

  { q: 'Show average marks by centre',
    sql: `SELECT m.center_id, c.center_name, c.division,
round(avg(m.mark), 1) AS avg_mark, count(DISTINCT m.student_id) AS learners_assessed
FROM v_marks m LEFT JOIN v_center_enrollment c USING (center_id)
GROUP BY m.center_id, c.center_name, c.division
HAVING count(DISTINCT m.student_id) >= 5
ORDER BY avg_mark ASC LIMIT 30`,
    note: 'Join for center_name so the list is readable. The HAVING clause keeps out centres resting on one or two assessed children, which would otherwise top or bottom the ranking on noise.' },

  { q: 'Which subjects have the weakest average marks?',
    sql: `SELECT subject, round(avg(mark), 1) AS avg_mark,
count(DISTINCT student_id) AS learners_assessed, count(*) AS marks
FROM v_marks GROUP BY subject ORDER BY avg_mark ASC`,
    note: 'SUPERLATIVE: return EVERY subject ordered worst-first, never only the weakest one — the gap between subjects is the finding. Marks are 0-100.' },

  { q: 'Show average marks by subject and programme',
    sql: `SELECT programme, subject, round(avg(mark), 1) AS avg_mark,
count(DISTINCT student_id) AS learners_assessed
FROM v_marks GROUP BY programme, subject
ORDER BY programme, avg_mark ASC`,
    note: 'Two dimensions: programme × subject. The renderer pivots this into one bar group per programme with a colour per subject, so return it long, not pivoted.' },

  { q: "Which centres' data is too incomplete to trust?",
    sql: `SELECT center_id, center_name, division, students,
attendance_coverage_pct, is_evaluated, trust
FROM v_center_health WHERE trust <> 'reliable'
ORDER BY attendance_coverage_pct ASC LIMIT 30`,
    note: "v_center_health already encodes the rule: 'untrustworthy' means no M&E score or almost no recorded attendance, 'partial' means thin coverage. This is a data-quality answer — it says which centres you cannot yet judge, not which centres are bad." },

  // ── STUDENTS module ────────────────────────────────────────────────────────
  { q: 'Which students have the highest average marks?',
    sql: `SELECT student_id, student_name, division, programme,
round(avg(mark), 1) AS avg_mark, count(*) AS marks
FROM v_marks
GROUP BY student_id, student_name, division, programme
HAVING count(*) >= 3
ORDER BY avg_mark DESC LIMIT 20`,
    note: 'Require at least 3 marks so a single lucky score cannot top the list. student_name is NULL in the newer dataset — when the ACTIVE DATASET says names are not collected, show student_id with division instead of an empty name column.' },

  { q: 'Show students who are regularly absent',
    sql: `SELECT a.student_id, a.student_name, s.division, s.programme,
a.avg_attendance_recorded, a.recorded_months
FROM v_student_attendance a JOIN v_students s USING (student_id)
WHERE a.recorded_months > 0 AND a.avg_attendance_recorded < 60
ORDER BY a.avg_attendance_recorded ASC LIMIT 30`,
    note: 'recorded_months > 0 is essential: attendance 0 means NOT RECORDED, so without it this returns learners nobody ever registered rather than learners who are absent. Report how many learners have any attendance record at all.' },

  { q: 'Show dropout reasons by income band',
    sql: `SELECT income_band, dropout_reason, count(*) AS students
FROM v_students
WHERE is_dropout AND dropout_reason IS NOT NULL AND income_band IS NOT NULL
GROUP BY income_band, dropout_reason
ORDER BY income_band, students DESC`,
    note: 'Two dimensions, so return it long and let the renderer pivot. This shows which reasons dominate at each income level — it is an association, never proof that income causes the reason.' },

  { q: 'Is there a relationship between family income and attendance?',
    sql: `SELECT s.income_band,
round(avg(a.avg_attendance_recorded), 1) AS avg_attendance,
count(*) FILTER (WHERE a.recorded_months > 0) AS learners_with_records
FROM v_students s JOIN v_student_attendance a USING (student_id)
WHERE s.income_band IS NOT NULL
GROUP BY s.income_band ORDER BY s.income_band`,
    note: 'Compare attendance across income bands and describe the direction and size of the gap. Correlation language only — "attendance tends to be lower in the poorest band", never "poverty causes absence". Carry learners_with_records so a thin band is not read as equal evidence.' },

  { q: 'Show the lowest-income students',
    sql: `SELECT student_id, student_name, division, programme, income_band, household_income_tk
FROM v_students
WHERE income_band = '<5000'
ORDER BY household_income_tk NULLS LAST LIMIT 30`,
    note: "income_band '<5000' is the lowest band. In the newer dataset income_band is banded HOUSEHOLD income; in the older one it is the father's — say which. Never present a banded figure as an exact income." },

  { q: 'Why are these centres worst / why do these centres need a visit?',
    sql: `SELECT center_name, division, me_score, pedagogy, assessment_quality, documentation, learning_environment, engagement
FROM v_center_enrollment WHERE me_score IS NOT NULL ORDER BY me_score ASC LIMIT 15`,
    note: 'A "why is this centre weak" question is ANSWERABLE — return the 5 M&E dimensions alongside me_score so the LOWEST dimension shows the reason. NEVER refuse with "no evaluation scores"; reuse the previous lowest-M&E filter.' },
];

/** Render the examples as a compact block for the prompt. */
export function renderFewShots(shots: FewShot[] = FEW_SHOTS): string {
  return shots.map((s) => `Q: ${s.q}\nSQL: ${s.sql}${s.note ? `\n-- ${s.note}` : ''}`).join('\n\n');
}
