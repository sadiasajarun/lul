/**
 * FIXED ANSWERS FOR SPECIFIC QUESTIONS.
 *
 * Only questions today's path provably cannot answer belong here: misrouted ones, and ones needing
 * Preview-only tables. Patterns are anchored on purpose. An extra qualifier ("...in Dhaka") fails to
 * match and the question takes the normal AI path, because a fixed answer to a different question
 * would be worse than no fixed answer.
 */
import type { Intent } from '../interpret';

export type Param = 'center' | 'teacher' | 'staff' | 'student';

export interface TrainedEntry {
  match: RegExp;
  title: string;
  intent: Intent;
  /** Omitted means the entry applies in every dataset. */
  previewOnly?: boolean;
  side?: string[];
  param?: Param;
  /** Teacher results rest on the simulated teacher-to-subject mapping, and the answer says so. */
  simulatedLink?: boolean;
  sql: (param: string) => string;
}

const sc = 'tv_center_scorecard';
const TRUE_DROP = `(is_dropout AND mainstream_status IS DISTINCT FROM 'Mainstreamed')`;
const LOW_INCOME = `income_band IN ('<5000', '5000-9999')`;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/* ───────────────────────────────── reusable pieces of SQL ─────────────────────────────────────── */

// The students with generated cycle marks, so baseline and cycles are compared on the same learners.
const PHASES = `SELECT center_id, phase, avg(mark) AS m, count(DISTINCT student_id) AS n FROM tv_marks_cycle WHERE student_id IN (SELECT student_id FROM side_cycle_marks) GROUP BY center_id, phase`;
const BASE_TO_LATEST = `WITH p AS (${PHASES}), g AS (SELECT b.center_id, b.m AS baseline, l.m AS latest, l.n AS students FROM p b JOIN p l ON b.center_id = l.center_id WHERE b.phase = 'BL' AND l.phase = 'C3')`;
const SELECT_IMPROVE = `SELECT c.center_name, c.district, round(g.baseline, 1) AS baseline_mark, round(g.latest, 1) AS latest_mark, round(g.latest - g.baseline, 1) AS improvement, g.students FROM g JOIN ${sc} c USING (center_id) WHERE g.students >= 3`;

const CYCLE_STEP = `WITH p AS (${PHASES}), g AS (SELECT a.center_id, a.m AS previous_cycle, b.m AS latest_cycle FROM p a JOIN p b ON a.center_id = b.center_id WHERE a.phase = 'C2' AND b.phase = 'C3' AND b.n >= 3) SELECT c.center_name, c.district, round(g.previous_cycle, 1) AS previous_cycle_mark, round(g.latest_cycle, 1) AS latest_cycle_mark, round(g.latest_cycle - g.previous_cycle, 1) AS change FROM g JOIN ${sc} c USING (center_id)`;

const STUDENT_TREND = `WITH s AS (SELECT student_id, center_id, phase, avg(mark) AS m FROM tv_marks_cycle WHERE student_id IN (SELECT student_id FROM side_cycle_marks) GROUP BY student_id, center_id, phase), w AS (SELECT student_id, any_value(center_id) AS center_id, max(m) FILTER (WHERE phase = 'BL') AS bl, max(m) FILTER (WHERE phase = 'C1') AS c1, max(m) FILTER (WHERE phase = 'C2') AS c2, max(m) FILTER (WHERE phase = 'C3') AS c3 FROM s GROUP BY student_id)`;
const STUDENT_COLUMNS = `SELECT w.student_id, c.center_name, round(w.bl, 1) AS baseline, round(w.c1, 1) AS cycle_1, round(w.c2, 1) AS cycle_2, round(w.c3, 1) AS cycle_3`;
const STUDENT_FROM = `FROM w JOIN ${sc} c USING (center_id)`;
const DECLINING = `w.c1 < w.bl AND w.c2 < w.c1 AND w.c3 < w.c2`;

const READY = `WITH r AS (SELECT s.student_id, s.center_id, sa.avg_attendance_recorded AS att, m.avg_mark FROM v_students s JOIN v_student_attendance sa USING (student_id) JOIN (SELECT student_id, avg(avg_mark) AS avg_mark FROM v_student_subject GROUP BY student_id) m USING (student_id) WHERE s.is_active AND m.avg_mark >= 50)`;
const READY_NOTE = 'Readiness is a rule, not a recorded field: active learners averaging at least 50 marks.';

const PROGRAM_CTE = `WITH g AS (
  SELECT 'NFPE' AS program, count(*) AS students, 100.0 * count(*) FILTER (WHERE ${TRUE_DROP}) / count(*) AS dropout_rate_pct, 100.0 * count(*) FILTER (WHERE is_mainstreamed) / count(*) AS mainstream_rate_pct FROM v_students
  UNION ALL
  SELECT 'PPE', count(*), 100.0 * count(*) FILTER (WHERE dropout_reason IS NOT NULL AND dropout_reason <> '') / count(*), 100.0 * count(*) FILTER (WHERE mainstream_status = 'Mainstreamed') / count(*) FROM side_ppe_students
)`;
const PPE_ATT = `SELECT 'NFPE' AS program, round(avg(avg_attendance_recorded), 1) AS avg_attendance_pct, count(avg_attendance_recorded) AS students_recorded FROM v_student_attendance UNION ALL SELECT 'PPE', round(avg(attendance_pct), 1), count(attendance_pct) FROM side_ppe_students`;
const PPE_MARKS = `SELECT 'NFPE' AS program, round(avg(mark), 1) AS avg_mark, count(DISTINCT student_id) AS students FROM v_marks UNION ALL SELECT 'PPE', round(avg(mark), 1), count(DISTINCT student_id) FROM side_ppe_marks`;
const PPE = ['side_ppe_centers', 'side_ppe_students', 'side_ppe_marks'];

const TEACHER_SUBJECT = `SELECT center_id, teacher_name, CASE subject WHEN 'Mathematics' THEN 'Maths' ELSE subject END AS subject FROM v_teacher_batch`;
const TEACHER_RESULTS = `WITH t AS (${TEACHER_SUBJECT}), r AS (SELECT t.center_id, t.teacher_name, t.subject, avg(m.mark) AS avg_mark, count(DISTINCT m.student_id) AS students FROM t JOIN v_marks m ON m.center_id = t.center_id AND m.subject = t.subject GROUP BY 1, 2, 3 HAVING count(DISTINCT m.student_id) >= 5)`;
const TEACHER_SELECT = `SELECT r.teacher_name, c.center_name, r.subject, round(r.avg_mark, 1) AS avg_mark, r.students FROM r JOIN ${sc} c USING (center_id)`;
const TEACHER_ATT = `SELECT center_id, teacher_name, 100.0 * sum(present_days) / sum(working_days) AS teacher_attendance_pct FROM side_teacher_attendance GROUP BY center_id, teacher_name`;
const TEACHER_CENTER_ATT = `SELECT center_id, avg(teacher_attendance_pct) AS teacher_attendance_pct FROM (${TEACHER_ATT}) GROUP BY center_id`;

const BAND = (col: string, cuts: number[]) => `CASE WHEN ${col} < ${cuts[0]} THEN '1. Low' WHEN ${col} < ${cuts[1]} THEN '2. Medium' ELSE '3. High' END`;

const VISIT_BANDS = (select: string) => `WITH b AS (SELECT *, ntile(3) OVER (ORDER BY visits) AS tier FROM ${sc} WHERE visits IS NOT NULL) SELECT CASE tier WHEN 1 THEN '1. Fewest visits' WHEN 2 THEN '2. Middle' ELSE '3. Most visits' END AS visit_group, count(*) AS centers, ${select} FROM b GROUP BY tier ORDER BY tier`;
const AVG_VISITS = `(SELECT avg(visits) FROM ${sc})`;
const AVG_ME = `(SELECT avg(me_score) FROM ${sc})`;
const LAST_MONTH = `(SELECT max(visit_date) FROM side_center_visits)`;

const OBS_ROLLUP = `SELECT center_id, round_no, avg(score) AS score, count(*) FILTER (WHERE rating = 'Negative') AS negatives FROM side_center_observations GROUP BY center_id, round_no`;
const OBS_PIVOT = `SELECT center_id, max(score) FILTER (WHERE round_no = 1) AS round_1, max(score) FILTER (WHERE round_no = 2) AS round_2, max(score) FILTER (WHERE round_no = 3) AS round_3, max(negatives) FILTER (WHERE round_no = 1) AS neg_1 FROM (${OBS_ROLLUP}) GROUP BY center_id`;

const CASH_BY_STUDENT = `SELECT student_id, count(*) FILTER (WHERE status = 'Paid') AS paid, count(*) FILTER (WHERE status = 'Missed') AS missed, min(pay_date) AS first_paid FROM side_cash_transfers GROUP BY student_id`;

const pct = (filter: string) => `round(100.0 * count(*) FILTER (WHERE ${filter}) / count(*), 1)`;

const T = (match: RegExp, title: string, intent: Intent, sql: string | ((p: string) => string), side: string[] = [], extra: Partial<TrainedEntry> = {}): TrainedEntry => ({
  match, title, intent, previewOnly: true, side, sql: typeof sql === 'string' ? () => sql : sql, ...extra,
});

// "Best" and "bottom" rank on the same combined score, so the two scenarios judge centers alike.
const TOP_PERFORMING = /^show the top (10|ten) best[- ]performing centers$/;
const BOTTOM_PERFORMING = /^show the bottom (10|ten) (performing |worst[- ]performing )?centers$/;
const PERFORMANCE_COLUMNS = 'center_id, center_name, district, performance_score, me_score, avg_mark, avg_attendance, dropout_rate_pct, students';

/* ─────────────────────────────── misrouted today, in every dataset ────────────────────────────── */

const ALL_MODES: TrainedEntry[] = [
  { match: TOP_PERFORMING, title: 'Top 10 best-performing centers', intent: 'list', sql: () => `SELECT ${PERFORMANCE_COLUMNS} FROM ${sc} WHERE performance_score IS NOT NULL ORDER BY performance_score DESC, students DESC, center_id LIMIT 10` },
  { match: BOTTOM_PERFORMING, title: 'Bottom 10 performing centers', intent: 'list', sql: () => `SELECT ${PERFORMANCE_COLUMNS} FROM ${sc} WHERE performance_score IS NOT NULL ORDER BY performance_score ASC, students DESC, center_id LIMIT 10` },
  { match: /^what is the dropout rate among (children with disabilities|cwd students)$/, title: 'Dropout rate among children with disabilities', intent: 'lookup', sql: () => `SELECT count(*) AS children_with_disabilities, count(*) FILTER (WHERE ${TRUE_DROP}) AS dropouts, ${pct(TRUE_DROP)} AS dropout_rate_pct FROM v_students WHERE disability_type IS NOT NULL AND disability_type <> ''` },
  { match: /^what is the overall mainstream (conversion|transition) rate$/, title: 'Overall mainstream conversion rate', intent: 'lookup', sql: () => `SELECT count(*) AS students, count(*) FILTER (WHERE is_mainstreamed) AS mainstreamed, ${pct('is_mainstreamed')} AS mainstream_rate_pct FROM v_students` },
  { match: /^what is the mainstream (transition )?rate among (cwd students|children with disabilities)$/, title: 'Mainstream rate among children with disabilities', intent: 'lookup', sql: () => `SELECT count(*) AS children_with_disabilities, count(*) FILTER (WHERE is_mainstreamed) AS mainstreamed, ${pct('is_mainstreamed')} AS mainstream_rate_pct FROM v_students WHERE disability_type IS NOT NULL AND disability_type <> ''` },
  { match: /^what is the overall (student )?attendance rate$/, title: 'Overall student attendance rate', intent: 'lookup', sql: () => `SELECT round(avg(avg_attendance_recorded), 1) AS avg_attendance_pct, count(avg_attendance_recorded) AS students_with_attendance, round(100.0 * count(avg_attendance_recorded) / count(*), 1) AS attendance_coverage_pct FROM v_student_attendance` },
];

/* ────────────────────────────── needs Preview's simulated side tables ─────────────────────────── */

const PREVIEW: TrainedEntry[] = [
  // Period comparison and program split
  T(/^compare the last six months with the previous six months$/, 'Last six months vs the previous six months', 'list', `WITH a AS (SELECT ${LAST_MONTH} AS last_day), d AS (SELECT 'Dropouts' AS measure, dropout_date AS day FROM side_dropout_events UNION ALL SELECT 'Staff and PO visits', visit_date FROM side_center_visits UNION ALL SELECT 'Cash payments', pay_date FROM side_cash_transfers WHERE status = 'Paid') SELECT measure, count(*) FILTER (WHERE day > last_day - INTERVAL 6 MONTH AND day <= last_day) AS last_six_months, count(*) FILTER (WHERE day > last_day - INTERVAL 12 MONTH AND day <= last_day - INTERVAL 6 MONTH) AS previous_six_months FROM d, a GROUP BY measure ORDER BY measure`, ['side_dropout_events', 'side_center_visits', 'side_cash_transfers']),
  T(/^show ppe vs nfpe center distribution$/, 'PPE vs NFPE centers', 'share', `SELECT 'NFPE' AS program, count(*) AS centers FROM ${sc} UNION ALL SELECT 'PPE', count(*) FROM side_ppe_centers`, PPE),
  T(/^show the bottom (\d+|ten) ppe centers$/, 'Bottom 10 PPE centers', 'list', `WITH s AS (SELECT center_id, avg(mark) AS m FROM side_ppe_marks GROUP BY center_id) SELECT c.center_id, c.center_name, c.district, c.overall_score AS me_score, round(s.m, 1) AS avg_mark FROM side_ppe_centers c JOIN s USING (center_id) ORDER BY c.overall_score, s.m, c.center_id LIMIT 10`, PPE),
  T(/^compare dropout rates between ppe and nfpe$|^compare ppe and nfpe dropout$/, 'Dropout: PPE vs NFPE', 'aggregate', `${PROGRAM_CTE} SELECT program, round(dropout_rate_pct, 1) AS dropout_rate_pct, students FROM g ORDER BY program`, PPE),
  T(/^compare mainstream transition between ppe and nfpe$|^compare ppe and nfpe mainstream transition$/, 'Mainstream transition: PPE vs NFPE', 'aggregate', `${PROGRAM_CTE} SELECT program, round(mainstream_rate_pct, 1) AS mainstream_rate_pct, students FROM g ORDER BY program`, PPE),
  T(/^compare ppe and nfpe (academic )?performance$/, 'Marks: PPE vs NFPE', 'aggregate', `${PPE_MARKS} ORDER BY program`, PPE),
  T(/^compare ppe and nfpe attendance$/, 'Attendance: PPE vs NFPE', 'aggregate', `${PPE_ATT} ORDER BY program`, PPE),

  // Organization and cycle-based ranking
  T(/^which organization has the highest[- ]performing centers$/, 'Organizations by center performance', 'aggregate', `SELECT o.organization, round(avg(c.me_score), 2) AS avg_me_score, count(*) AS centers FROM side_center_org o JOIN ${sc} c USING (center_id) WHERE c.me_score IS NOT NULL GROUP BY o.organization ORDER BY avg_me_score DESC`, ['side_center_org']),
  T(/^which (\d+|ten) centers improved the most compared with the previous cycle$/, '10 centers that improved most on the previous cycle', 'list', `${CYCLE_STEP} ORDER BY change DESC, c.center_id LIMIT 10`, ['side_cycle_marks']),
  T(/^which (\d+|ten) centers declined the most$/, '10 centers that declined most on the previous cycle', 'list', `${CYCLE_STEP} ORDER BY change ASC, c.center_id LIMIT 10`, ['side_cycle_marks']),
  T(/^show the top centers based on baseline[- ]to[- ]latest[- ]cycle improvement$|^which centers improved most from baseline$/, 'Centers with the most improvement from baseline', 'list', `${BASE_TO_LATEST} ${SELECT_IMPROVE} ORDER BY improvement DESC, c.center_id LIMIT 10`, ['side_cycle_marks']),
  T(/^which centers improved least from baseline$/, 'Centers with the least improvement from baseline', 'list', `${BASE_TO_LATEST} ${SELECT_IMPROVE} ORDER BY improvement ASC, c.center_id LIMIT 10`, ['side_cycle_marks']),
  T(/^which centers have consistently remained in the top[- ]performing group$/, 'Centers in the top quarter in every cycle', 'list', `WITH p AS (${PHASES}), r AS (SELECT center_id, phase, percent_rank() OVER (PARTITION BY phase ORDER BY m) AS pr FROM p WHERE n >= 3 AND phase IN ('C1', 'C2', 'C3')), k AS (SELECT center_id FROM r GROUP BY center_id HAVING count(*) = 3 AND min(pr) >= 0.75) SELECT c.center_id, c.center_name, c.district, c.avg_mark, c.me_score FROM k JOIN ${sc} c USING (center_id) ORDER BY c.avg_mark DESC, c.center_id LIMIT 30`, ['side_cycle_marks']),
  T(/^which centers started with low baseline scores but achieved strong results$/, 'Low baseline, strong results', 'list', `${BASE_TO_LATEST}, n AS (SELECT avg(baseline) AS bl, avg(latest) AS lt FROM g) ${SELECT_IMPROVE} AND g.baseline < (SELECT bl FROM n) AND g.latest > (SELECT lt FROM n) ORDER BY improvement DESC, c.center_id LIMIT 20`, ['side_cycle_marks']),
  T(/^which centers started with high baseline scores but showed limited improvement$/, 'High baseline, limited improvement', 'list', `${BASE_TO_LATEST}, n AS (SELECT avg(baseline) AS bl, avg(latest - baseline) AS d FROM g) ${SELECT_IMPROVE} AND g.baseline > (SELECT bl FROM n) AND (g.latest - g.baseline) < (SELECT d FROM n) ORDER BY improvement ASC, c.center_id LIMIT 20`, ['side_cycle_marks']),
  T(/^compare cycle 1 and cycle 2 results$/, 'Cycle 1 vs Cycle 2 results by subject', 'list', `SELECT subject, round(avg(mark) FILTER (WHERE phase = 'C1'), 1) AS cycle_1, round(avg(mark) FILTER (WHERE phase = 'C2'), 1) AS cycle_2, round(avg(mark) FILTER (WHERE phase = 'C2') - avg(mark) FILTER (WHERE phase = 'C1'), 1) AS change FROM tv_marks_cycle WHERE student_id IN (SELECT student_id FROM side_cycle_marks) AND phase IN ('C1', 'C2') GROUP BY subject ORDER BY change DESC`, ['side_cycle_marks']),
  T(/^compare baseline with the latest cycle$/, 'Baseline vs the latest cycle by subject', 'list', `SELECT subject, round(avg(mark) FILTER (WHERE phase = 'BL'), 1) AS baseline, round(avg(mark) FILTER (WHERE phase = 'C3'), 1) AS latest_cycle, round(avg(mark) FILTER (WHERE phase = 'C3') - avg(mark) FILTER (WHERE phase = 'BL'), 1) AS improvement FROM tv_marks_cycle WHERE student_id IN (SELECT student_id FROM side_cycle_marks) AND phase IN ('BL', 'C3') GROUP BY subject ORDER BY improvement DESC`, ['side_cycle_marks']),
  T(/^compare baseline improvement by sub[- ]program$/, 'Baseline improvement by sub-program', 'aggregate', `${BASE_TO_LATEST} SELECT COALESCE(c.sub_program, 'Not recorded') AS sub_program, round(avg(g.baseline), 1) AS baseline_mark, round(avg(g.latest), 1) AS latest_mark, round(avg(g.latest - g.baseline), 1) AS improvement FROM g JOIN ${sc} c USING (center_id) GROUP BY 1 ORDER BY improvement DESC`, ['side_cycle_marks']),
  T(/^which students improved the most between cycles$/, 'Students who improved most between cycles', 'list', `${STUDENT_TREND} ${STUDENT_COLUMNS}, round(w.c3 - w.c1, 1) AS improvement ${STUDENT_FROM} WHERE w.c1 IS NOT NULL AND w.c3 IS NOT NULL ORDER BY improvement DESC, w.student_id LIMIT 20`, ['side_cycle_marks']),
  T(/^which students showed continuous decline$/, 'Students with continuously falling marks', 'list', `${STUDENT_TREND} ${STUDENT_COLUMNS} ${STUDENT_FROM} WHERE ${DECLINING} ORDER BY w.c3 - w.bl, w.student_id LIMIT 100`, ['side_cycle_marks']),
  T(/^show students with low baseline scores but strong improvement$/, 'Low baseline, strong improvement', 'list', `${STUDENT_TREND} ${STUDENT_COLUMNS}, round(w.c3 - w.bl, 1) AS improvement ${STUDENT_FROM} WHERE w.bl < 40 AND w.c3 IS NOT NULL ORDER BY improvement DESC, w.student_id LIMIT 50`, ['side_cycle_marks']),
  T(/^show active students with consistently declining scores$/, 'Active students with consistently declining scores', 'list', `${STUDENT_TREND} ${STUDENT_COLUMNS} ${STUDENT_FROM} JOIN v_students s USING (student_id) WHERE s.is_active AND ${DECLINING} ORDER BY w.c3 - w.bl, w.student_id LIMIT 100`, ['side_cycle_marks']),
  T(/^show unit[- ]wise performance$/, 'Marks by unit', 'list', `SELECT unit, subject, round(sum(avg_mark * n_students) / sum(n_students), 1) AS avg_mark FROM side_unit_marks GROUP BY unit, subject ORDER BY subject, unit`, ['side_unit_marks']),

  // Dated dropout
  T(/^which month had the highest number of dropouts$/, 'Dropouts by month', 'trend', `SELECT strftime(dropout_date, '%Y-%m') AS month, count(*) AS dropouts FROM side_dropout_events GROUP BY 1 ORDER BY dropouts DESC LIMIT 12`, ['side_dropout_events']),
  T(/^which centers had the biggest increase in dropout$/, 'Biggest increase in dropouts, latest year vs the year before', 'list', `WITH y AS (SELECT center_id, count(*) FILTER (WHERE year(dropout_date) = 2025) AS latest, count(*) FILTER (WHERE year(dropout_date) = 2024) AS prior FROM side_dropout_events GROUP BY center_id) SELECT c.center_name, c.district, y.prior AS dropouts_2024, y.latest AS dropouts_2025, y.latest - y.prior AS change FROM y JOIN ${sc} c USING (center_id) ORDER BY change DESC, c.center_id LIMIT 10`, ['side_dropout_events']),
  T(/^which centers reduced dropout the most$/, 'Biggest reduction in dropouts, latest year vs the year before', 'list', `WITH y AS (SELECT center_id, count(*) FILTER (WHERE year(dropout_date) = 2025) AS latest, count(*) FILTER (WHERE year(dropout_date) = 2024) AS prior FROM side_dropout_events GROUP BY center_id) SELECT c.center_name, c.district, y.prior AS dropouts_2024, y.latest AS dropouts_2025, y.latest - y.prior AS change FROM y JOIN ${sc} c USING (center_id) ORDER BY change ASC, c.center_id LIMIT 10`, ['side_dropout_events']),

  // Ready for mainstreaming
  T(/^how many students are ready for mainstreaming$/, 'Students ready for mainstreaming', 'lookup', `${READY} SELECT count(*) AS ready_for_mainstreaming FROM r`, [], { param: undefined }),
  T(/^which centers are preparing students for mainstreaming most effectively$/, 'Centers preparing students for mainstreaming', 'list', `${READY}, n AS (SELECT center_id, count(*) AS ready FROM r GROUP BY center_id) SELECT c.center_name, c.district, n.ready AS ready_now, c.mainstreamed, c.mainstream_rate_pct, c.students FROM n JOIN ${sc} c USING (center_id) WHERE c.students >= 30 ORDER BY c.mainstream_rate_pct DESC, n.ready DESC, c.center_id LIMIT 20`),
  T(/^which centers have many students ready for mainstreaming but low actual transition$/, 'Many students ready, low transition', 'list', `${READY}, n AS (SELECT center_id, count(*) AS ready FROM r GROUP BY center_id) SELECT c.center_name, c.district, n.ready AS ready_now, c.mainstream_rate_pct, c.students FROM n JOIN ${sc} c USING (center_id) WHERE c.mainstream_rate_pct < (SELECT avg(mainstream_rate_pct) FROM ${sc}) ORDER BY n.ready DESC, c.center_id LIMIT 20`),
  T(/^show students who are ready for mainstreaming but have weak attendance$/, 'Ready for mainstreaming, weak attendance', 'list', `${READY} SELECT r.student_id, c.center_name, round(r.att, 1) AS attendance_pct, round(r.avg_mark, 1) AS avg_mark FROM r JOIN ${sc} c USING (center_id) WHERE r.att < 60 ORDER BY r.att, r.student_id LIMIT 100`),

  // Teachers
  T(/^show the top (\d+|ten) teachers based on student performance$|^which teachers have the highest[- ]performing students$/, 'Top 10 teachers by student marks', 'list', `${TEACHER_RESULTS} ${TEACHER_SELECT} ORDER BY avg_mark DESC, r.teacher_name LIMIT 10`, [], { simulatedLink: true }),
  T(/^which teachers have the highest student improvement rates$/, 'Teachers with the highest student improvement', 'list', `WITH t AS (${TEACHER_SUBJECT}), m AS (SELECT center_id, subject, avg(mark) FILTER (WHERE phase = 'BL') AS bl, avg(mark) FILTER (WHERE phase = 'C3') AS c3 FROM tv_marks_cycle WHERE student_id IN (SELECT student_id FROM side_cycle_marks) GROUP BY center_id, subject) SELECT t.teacher_name, c.center_name, t.subject, round(m.bl, 1) AS baseline, round(m.c3, 1) AS latest, round(m.c3 - m.bl, 1) AS improvement FROM t JOIN m USING (center_id, subject) JOIN ${sc} c USING (center_id) WHERE m.c3 IS NOT NULL ORDER BY improvement DESC, t.teacher_name LIMIT 10`, ['side_cycle_marks'], { simulatedLink: true }),
  T(/^which teachers have the lowest student dropout rates$/, 'Teachers at centers with the lowest dropout', 'list', `SELECT t.teacher_name, c.center_name, c.dropout_rate_pct, c.students FROM v_teachers t JOIN ${sc} c USING (center_id) WHERE t.is_active AND c.students >= 30 ORDER BY c.dropout_rate_pct, c.students DESC, t.teacher_name LIMIT 20`, [], { simulatedLink: true }),
  T(/^which teachers have the highest dropout rate among their students$|^which teachers supervise students with high dropout$/, 'Teachers at centers with the highest dropout', 'list', `SELECT t.teacher_name, c.center_name, c.dropout_rate_pct, c.dropouts, c.students FROM v_teachers t JOIN ${sc} c USING (center_id) WHERE t.is_active AND c.students >= 30 ORDER BY c.dropout_rate_pct DESC, t.teacher_name LIMIT 20`, [], { simulatedLink: true }),
  T(/^which teachers are working with the highest number of cwd students$/, 'Teachers at centers serving the most CwD students', 'list', `WITH d AS (SELECT center_id, count(*) AS cwd_students FROM v_students WHERE disability_type IS NOT NULL AND disability_type <> '' GROUP BY center_id) SELECT t.teacher_name, c.center_name, d.cwd_students FROM v_teachers t JOIN d USING (center_id) JOIN ${sc} c USING (center_id) WHERE t.is_active ORDER BY d.cwd_students DESC, t.teacher_name LIMIT 20`, [], { simulatedLink: true }),
  T(/^which teachers produce the strongest outcomes for low[- ]baseline students$/, 'Strongest outcomes for low-baseline students', 'list', `WITH t AS (${TEACHER_SUBJECT}), m AS (SELECT a.center_id, a.subject, avg(a.mark) AS latest, count(DISTINCT a.student_id) AS students FROM tv_marks_cycle a JOIN (SELECT student_id, subject FROM tv_marks_cycle WHERE phase = 'BL' AND mark < 40 AND student_id IN (SELECT student_id FROM side_cycle_marks)) b ON a.student_id = b.student_id AND a.subject = b.subject WHERE a.phase = 'C3' GROUP BY a.center_id, a.subject HAVING count(DISTINCT a.student_id) >= 2) SELECT t.teacher_name, c.center_name, t.subject, round(m.latest, 1) AS latest_mark, m.students AS low_baseline_students FROM t JOIN m USING (center_id, subject) JOIN ${sc} c USING (center_id) ORDER BY latest_mark DESC, t.teacher_name LIMIT 10`, ['side_cycle_marks'], { simulatedLink: true }),
  T(/^compare teachers in the best and worst centers$/, 'Teachers in the best and worst centers', 'list', `WITH b AS (SELECT center_id, me_score, ntile(10) OVER (ORDER BY me_score) AS d FROM ${sc} WHERE me_score IS NOT NULL) SELECT CASE WHEN b.d = 10 THEN 'Best 10% of centers' ELSE 'Worst 10% of centers' END AS center_group, t.education, count(*) AS teachers, count(*) FILTER (WHERE t.is_active) AS active_teachers FROM v_teachers t JOIN b USING (center_id) WHERE b.d IN (1, 10) GROUP BY 1, 2 ORDER BY 1, 3 DESC`),
  T(/^compare teachers within center (.+)$/, 'Teachers in this center', 'list', (id) => `WITH t AS (${TEACHER_SUBJECT}), m AS (SELECT subject, avg(mark) AS avg_mark FROM v_marks WHERE center_id = ${q(id)} GROUP BY subject) SELECT t.teacher_name, t.subject, round(m.avg_mark, 1) AS subject_avg_mark, round(a.teacher_attendance_pct, 1) AS teacher_attendance_pct FROM t LEFT JOIN m USING (subject) LEFT JOIN (${TEACHER_ATT}) a ON a.center_id = t.center_id AND a.teacher_name = t.teacher_name WHERE t.center_id = ${q(id)} ORDER BY subject_avg_mark DESC NULLS LAST, t.teacher_name`, ['side_teacher_attendance'], { param: 'center', simulatedLink: true }),
  T(/^analy[sz]e teacher (.+)'s student outcomes$/, "This teacher's student outcomes", 'list', (name) => `WITH t AS (${TEACHER_SUBJECT}) SELECT t.teacher_name, c.center_name, t.subject, round(avg(m.mark), 1) AS avg_mark, count(DISTINCT m.student_id) AS students, c.dropout_rate_pct FROM t JOIN ${sc} c USING (center_id) LEFT JOIN v_marks m ON m.center_id = t.center_id AND m.subject = t.subject WHERE t.teacher_name = ${q(name)} GROUP BY 1, 2, 3, 6 ORDER BY 2, 3`, [], { param: 'teacher', simulatedLink: true }),

  // Teacher attendance
  T(/^which teacher has the best attendance record$/, 'Teachers with the best attendance', 'list', `SELECT a.teacher_name, c.center_name, round(a.teacher_attendance_pct, 1) AS attendance_pct FROM (${TEACHER_ATT}) a JOIN ${sc} c USING (center_id) ORDER BY attendance_pct DESC, a.teacher_name LIMIT 10`, ['side_teacher_attendance']),
  T(/^compare teacher attendance (with|and) student attendance$/, 'Teacher attendance vs student attendance', 'aggregate', `SELECT ${BAND('a.teacher_attendance_pct', [84, 90])} AS teacher_attendance_group, count(*) AS centers, round(avg(c.avg_attendance), 1) AS avg_student_attendance FROM (${TEACHER_CENTER_ATT}) a JOIN ${sc} c USING (center_id) GROUP BY 1 ORDER BY 1`, ['side_teacher_attendance']),
  T(/^compare teacher attendance with student results$/, 'Teacher attendance vs student results', 'aggregate', `SELECT ${BAND('a.teacher_attendance_pct', [84, 90])} AS teacher_attendance_group, count(*) AS centers, round(avg(c.avg_mark), 1) AS avg_mark FROM (${TEACHER_CENTER_ATT}) a JOIN ${sc} c USING (center_id) GROUP BY 1 ORDER BY 1`, ['side_teacher_attendance']),

  // Student monthly attendance
  T(/^which students have experienced the largest attendance decline$/, 'Largest attendance declines', 'list', `WITH m AS (SELECT student_id, center_id, avg(attendance_pct) FILTER (WHERE month_num <= 3) AS early, avg(attendance_pct) FILTER (WHERE month_num >= 10) AS recent FROM side_student_monthly GROUP BY student_id, center_id) SELECT m.student_id, c.center_name, round(m.early, 1) AS first_quarter_pct, round(m.recent, 1) AS last_quarter_pct, round(m.recent - m.early, 1) AS change FROM m JOIN ${sc} c USING (center_id) ORDER BY change, m.student_id LIMIT 20`, ['side_student_monthly']),
  T(/^show unusual attendance patterns$/, 'Most volatile month-to-month attendance', 'list', `WITH m AS (SELECT student_id, center_id, stddev_samp(attendance_pct) AS sd, min(attendance_pct) AS lowest, max(attendance_pct) AS highest FROM side_student_monthly GROUP BY student_id, center_id) SELECT m.student_id, c.center_name, round(m.lowest, 1) AS lowest_month_pct, round(m.highest, 1) AS highest_month_pct, round(m.sd, 1) AS month_to_month_spread FROM m JOIN ${sc} c USING (center_id) ORDER BY m.sd DESC, m.student_id LIMIT 20`, ['side_student_monthly']),

  // Visits
  T(/^which centers received the most visits$/, 'Centers with the most visits', 'list', `SELECT center_name, district, visits, last_visit FROM ${sc} ORDER BY visits DESC NULLS LAST, center_id LIMIT 15`),
  T(/^which centers received the fewest visits$/, 'Centers with the fewest visits', 'list', `SELECT center_name, district, visits, last_visit FROM ${sc} WHERE visits IS NOT NULL ORDER BY visits, center_id LIMIT 15`),
  T(/^which centers have not been visited recently$/, 'Centers not visited recently', 'list', `SELECT center_name, district, visits, last_visit, date_diff('day', last_visit, ${LAST_MONTH}) AS days_since_last_visit FROM ${sc} WHERE visits IS NOT NULL ORDER BY last_visit, center_id LIMIT 20`),
  T(/^show po[- ]wise visit counts$/, 'Visits by PO', 'list', `SELECT staff_name, count(*) AS visits, count(DISTINCT center_id) AS centers FROM side_center_visits WHERE staff_role = 'PO' GROUP BY staff_name ORDER BY visits DESC, staff_name LIMIT 50`),
  T(/^show staff[- ]wise visit counts$/, 'Visits by staff member', 'list', `SELECT staff_name, staff_role, count(*) AS visits, count(DISTINCT center_id) AS centers FROM side_center_visits GROUP BY staff_name, staff_role ORDER BY visits DESC, staff_name LIMIT 50`),
  T(/^which staff member covers the most centers$/, 'Staff covering the most centers', 'list', `SELECT staff_name, staff_role, count(DISTINCT center_id) AS centers, count(*) AS visits FROM side_center_visits GROUP BY staff_name, staff_role ORDER BY centers DESC, staff_name LIMIT 10`),
  T(/^show supervised teachers under staff (.+)$/, 'Teachers at centers this staff member visits', 'list', (id) => `WITH v AS (SELECT DISTINCT center_id FROM side_center_visits WHERE staff_id = ${q(id)} OR staff_name = ${q(id)}) SELECT c.center_name, t.teacher_name, t.employment_status FROM v JOIN v_teachers t USING (center_id) JOIN ${sc} c USING (center_id) ORDER BY 1, 2`, ['side_center_visits'], { param: 'staff' }),
  T(/^compare visit frequency with center performance$/, 'Visits vs center performance', 'aggregate', VISIT_BANDS(`round(avg(visits), 1) AS avg_visits, round(avg(me_score), 2) AS avg_me_score`)),
  T(/^compare visit frequency with dropout rate$/, 'Visits vs dropout rate', 'aggregate', VISIT_BANDS(`round(avg(visits), 1) AS avg_visits, round(avg(dropout_rate_pct), 1) AS avg_dropout_rate_pct`)),
  T(/^compare visit frequency with student results$/, 'Visits vs student results', 'aggregate', VISIT_BANDS(`round(avg(visits), 1) AS avg_visits, round(avg(avg_mark), 1) AS avg_mark`)),
  T(/^did center performance improve after repeated visits$/, 'Improvement by visit frequency', 'aggregate', `${BASE_TO_LATEST}, b AS (SELECT c.center_id, c.visits, g.latest - g.baseline AS improvement, ntile(3) OVER (ORDER BY c.visits) AS tier FROM g JOIN ${sc} c USING (center_id) WHERE c.visits IS NOT NULL) SELECT CASE tier WHEN 1 THEN '1. Fewest visits' WHEN 2 THEN '2. Middle' ELSE '3. Most visits' END AS visit_group, count(*) AS centers, round(avg(visits), 1) AS avg_visits, round(avg(improvement), 1) AS avg_improvement FROM b GROUP BY tier ORDER BY tier`, ['side_cycle_marks']),
  T(/^which poor[- ]performing centers have received limited monitoring$/, 'Poor performers with few visits', 'list', `SELECT center_name, district, me_score, visits, last_visit FROM ${sc} WHERE me_score < ${AVG_ME} AND visits < ${AVG_VISITS} ORDER BY me_score, visits, center_id LIMIT 20`),
  T(/^which frequently visited centers are still underperforming$/, 'Frequently visited but underperforming', 'list', `SELECT center_name, district, me_score, visits FROM ${sc} WHERE me_score < ${AVG_ME} AND visits > ${AVG_VISITS} ORDER BY me_score, visits DESC, center_id LIMIT 20`),
  T(/^which high[- ]performing centers receive fewer[- ]than[- ]average visits$/, 'High performers with few visits', 'list', `SELECT center_name, district, me_score, visits FROM ${sc} WHERE me_score > ${AVG_ME} AND visits < ${AVG_VISITS} ORDER BY me_score DESC, visits, center_id LIMIT 20`),
  T(/^show sub[- ]program[- ]wise po visits$|^which sub[- ]program has the highest po visit frequency$/, 'PO visits by sub-program', 'aggregate', `SELECT COALESCE(c.sub_program, 'Not recorded') AS sub_program, count(*) AS po_visits, round(1.0 * count(*) / count(DISTINCT v.center_id), 1) AS po_visits_per_center FROM side_center_visits v JOIN ${sc} c USING (center_id) WHERE v.staff_role = 'PO' GROUP BY 1 ORDER BY po_visits_per_center DESC`, ['side_center_visits']),

  // Observations
  T(/^show centers with repeated negative observations$/, 'Centers with repeated negative observations', 'list', `WITH n AS (SELECT center_id, count(DISTINCT round_no) AS rounds_with_negative, count(*) AS negative_observations FROM side_center_observations WHERE rating = 'Negative' GROUP BY center_id HAVING count(DISTINCT round_no) >= 2) SELECT c.center_name, c.district, n.rounds_with_negative, n.negative_observations, c.me_score FROM n JOIN ${sc} c USING (center_id) ORDER BY n.negative_observations DESC, c.center_id LIMIT 30`),
  T(/^show the most common monitoring issues$/, 'Most common monitoring issues', 'aggregate', `SELECT issue, count(*) AS observations FROM side_center_observations WHERE rating = 'Negative' GROUP BY issue ORDER BY observations DESC`),
  T(/^which observation categories fail most frequently$/, 'Observation categories by failure rate', 'aggregate', `SELECT category, count(*) FILTER (WHERE rating = 'Negative') AS negative, ${pct(`rating = 'Negative'`)} AS negative_pct FROM side_center_observations GROUP BY category ORDER BY negative_pct DESC`),
  T(/^which centers have unresolved issues from previous observations$/, 'Unresolved issues from previous observations', 'list', `WITH n AS (SELECT center_id, count(*) AS unresolved FROM side_center_observations WHERE rating = 'Negative' AND round_no < 3 AND resolved = false GROUP BY center_id) SELECT c.center_name, c.district, n.unresolved AS unresolved_issues, c.me_score FROM n JOIN ${sc} c USING (center_id) ORDER BY n.unresolved DESC, c.center_id LIMIT 30`),
  T(/^show the complete observation history for center (.+)$/, 'Observation history', 'list', (id) => `SELECT obs_date, category, score, rating, issue, resolved FROM side_center_observations WHERE center_id = ${q(id)} ORDER BY obs_date DESC, category`, [], { param: 'center' }),
  T(/^compare center (.+)'s last three observations$/, 'The last three observation rounds', 'list', (id) => `SELECT category, max(score) FILTER (WHERE round_no = 1) AS round_1, max(score) FILTER (WHERE round_no = 2) AS round_2, max(score) FILTER (WHERE round_no = 3) AS round_3 FROM side_center_observations WHERE center_id = ${q(id)} GROUP BY category ORDER BY category`, [], { param: 'center' }),
  T(/^which centers improved after negative observations$/, 'Improved after negative observations', 'list', `WITH p AS (${OBS_PIVOT}) SELECT c.center_name, c.district, round(p.round_1, 2) AS first_round, round(p.round_3, 2) AS latest_round, round(p.round_3 - p.round_1, 2) AS change FROM p JOIN ${sc} c USING (center_id) WHERE p.neg_1 > 0 AND p.round_3 > p.round_1 ORDER BY change DESC, c.center_id LIMIT 20`),
  T(/^which centers continue to decline despite repeated monitoring$/, 'Declining despite repeated monitoring', 'list', `WITH p AS (${OBS_PIVOT}) SELECT c.center_name, c.district, round(p.round_1, 2) AS first_round, round(p.round_2, 2) AS middle_round, round(p.round_3, 2) AS latest_round, c.visits FROM p JOIN ${sc} c USING (center_id) WHERE p.round_2 < p.round_1 AND p.round_3 < p.round_2 ORDER BY p.round_3 - p.round_1, c.center_id LIMIT 20`),

  // Cash transfers
  T(/^what is the total cash transfer amount$/, 'Total cash transfers', 'lookup', `SELECT round(sum(amount_tk)) AS total_amount_tk, count(*) FILTER (WHERE status = 'Paid') AS payments, count(DISTINCT student_id) AS students FROM side_cash_transfers WHERE status = 'Paid'`, ['side_cash_transfers']),
  T(/^show monthly cash transfer trends$/, 'Cash transfers by payment month', 'trend', `SELECT strftime(pay_date, '%Y-%m') AS month, round(sum(amount_tk)) AS amount_tk, count(*) AS payments FROM side_cash_transfers WHERE status = 'Paid' GROUP BY 1 ORDER BY 1`, ['side_cash_transfers']),
  T(/^show cash transfer by center$|^which centers have the highest total cash transfers$/, 'Cash transfers by center', 'list', `SELECT c.center_name, c.district, round(sum(t.amount_tk)) AS amount_tk, count(*) AS payments, count(DISTINCT t.student_id) AS students FROM side_cash_transfers t JOIN ${sc} c USING (center_id) WHERE t.status = 'Paid' GROUP BY 1, 2, c.center_id ORDER BY amount_tk DESC, c.center_id LIMIT 30`, ['side_cash_transfers']),
  T(/^show payment history for student (.+)$/, 'Payment history', 'list', (id) => `SELECT pay_date, amount_tk, status, transaction_no FROM side_cash_transfers WHERE student_id = ${q(id)} ORDER BY month_num`, ['side_cash_transfers'], { param: 'student' }),
  T(/^which students have not received expected payments$/, 'Students with missed payments', 'list', `WITH p AS (${CASH_BY_STUDENT}) SELECT p.student_id, c.center_name, p.paid AS payments_received, p.missed AS payments_missed FROM p JOIN v_students s USING (student_id) JOIN ${sc} c ON c.center_id = s.center_id WHERE p.missed > 0 ORDER BY p.missed DESC, p.student_id LIMIT 100`, ['side_cash_transfers']),
  T(/^show duplicate transaction numbers$/, 'Duplicate transaction numbers', 'list', `SELECT transaction_no, count(*) AS payments, count(DISTINCT student_id) AS students, round(sum(amount_tk)) AS amount_tk FROM side_cash_transfers WHERE transaction_no IS NOT NULL AND transaction_no <> '' GROUP BY transaction_no HAVING count(*) > 1 ORDER BY payments DESC, transaction_no`, ['side_cash_transfers']),
  T(/^show unusually high payment amounts$/, 'Unusually high payments', 'list', `SELECT payment_id, student_id, pay_date, amount_tk, transaction_no FROM side_cash_transfers WHERE amount_tk > 3 * (SELECT median(amount_tk) FROM side_cash_transfers WHERE status = 'Paid') ORDER BY amount_tk DESC, payment_id LIMIT 100`, ['side_cash_transfers']),
  T(/^compare cash transfer recipients and non[- ]recipients by attendance$/, 'Attendance: recipients vs non-recipients', 'aggregate', `SELECT CASE WHEN c.student_id IS NULL THEN 'Non-recipients' ELSE 'Recipients' END AS group_name, round(avg(a.avg_attendance_recorded), 1) AS avg_attendance_pct, count(*) AS students FROM v_student_attendance a JOIN v_students s USING (student_id) LEFT JOIN (SELECT DISTINCT student_id FROM side_cash_transfers) c ON c.student_id = a.student_id WHERE s.income_band IN ('<5000', '5000-9999') GROUP BY 1 ORDER BY 1`, ['side_cash_transfers']),
  T(/^compare cash transfer recipients and non[- ]recipients by dropout$/, 'Dropout: recipients vs non-recipients', 'aggregate', `SELECT CASE WHEN c.student_id IS NULL THEN 'Non-recipients' ELSE 'Recipients' END AS group_name, ${pct('s.is_dropout AND s.mainstream_status IS DISTINCT FROM \'Mainstreamed\'')} AS dropout_rate_pct, count(*) AS students FROM v_students s LEFT JOIN (SELECT DISTINCT student_id FROM side_cash_transfers) c ON c.student_id = s.student_id WHERE s.${LOW_INCOME} GROUP BY 1 ORDER BY 1`, ['side_cash_transfers']),
  T(/^compare cash transfer timing with student retention$/, 'Payment regularity vs retention', 'aggregate', `WITH p AS (${CASH_BY_STUDENT}) SELECT CASE WHEN p.missed = 0 THEN 'No missed payment' ELSE 'At least one missed payment' END AS payment_record, count(*) AS students, ${pct('s.is_dropout AND s.mainstream_status IS DISTINCT FROM \'Mainstreamed\'')} AS dropout_rate_pct FROM p JOIN v_students s USING (student_id) GROUP BY 1 ORDER BY 1`, ['side_cash_transfers']),
  T(/^show payment records with missing transaction information$/, 'Payments with missing transaction details', 'list', `SELECT payment_id, student_id, pay_date, amount_tk, status FROM side_cash_transfers WHERE status = 'Paid' AND (transaction_no IS NULL OR transaction_no = '') ORDER BY payment_id LIMIT 100`, ['side_cash_transfers']),
];

export const TRAINED_ENTRIES: TrainedEntry[] = [...ALL_MODES, ...PREVIEW];

const PERFORMANCE_NOTE = 'Performance score (0-100): the average of each center\'s percentile on M&E score, marks, attendance and dropout (lower dropout ranks higher). Only centers with 30 or more students and at least two of these measures are ranked.';

export const NOTES: { match: RegExp; note: string }[] = [
  { match: /ready for mainstream|preparing students for mainstream/, note: READY_NOTE },
  { match: TOP_PERFORMING, note: PERFORMANCE_NOTE },
  { match: BOTTOM_PERFORMING, note: PERFORMANCE_NOTE },
];
