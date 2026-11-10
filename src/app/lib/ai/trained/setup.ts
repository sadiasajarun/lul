/**
 * Tables only the follow-up and trained answers use. Nothing here touches the semantic layer, so
 * every existing view and every model-written query behaves exactly as before.
 *
 * Preview's simulated side tables load on first use, so its start-up cost is unchanged. In the real
 * datasets they stay empty, and switching dataset rebuilds them, so real answers can never see them.
 */
import type { DataMode } from '../../db/duckdb-source';
import type { DataSource } from '../../db/types';

type Columns = [string, string][];

export const SIDE_TABLES: Record<string, Columns> = {
  side_center_visits: [['visit_id', 'VARCHAR'], ['center_id', 'VARCHAR'], ['visit_date', 'DATE'], ['staff_id', 'VARCHAR'], ['staff_name', 'VARCHAR'], ['staff_role', 'VARCHAR'], ['sub_program', 'VARCHAR'], ['purpose', 'VARCHAR']],
  side_center_observations: [['center_id', 'VARCHAR'], ['round_no', 'INTEGER'], ['obs_date', 'DATE'], ['category', 'VARCHAR'], ['score', 'DOUBLE'], ['rating', 'VARCHAR'], ['issue', 'VARCHAR'], ['resolved', 'BOOLEAN']],
  side_center_org: [['center_id', 'VARCHAR'], ['organization', 'VARCHAR'], ['cmc_status', 'VARCHAR'], ['cmc_meetings_per_year', 'INTEGER'], ['cmc_members', 'INTEGER'], ['cmc_last_meeting', 'DATE']],
  side_teacher_attendance: [['center_id', 'VARCHAR'], ['teacher_name', 'VARCHAR'], ['month_num', 'INTEGER'], ['month', 'VARCHAR'], ['working_days', 'INTEGER'], ['present_days', 'INTEGER']],
  side_cash_transfers: [['payment_id', 'VARCHAR'], ['transaction_no', 'VARCHAR'], ['student_id', 'VARCHAR'], ['center_id', 'VARCHAR'], ['month_num', 'INTEGER'], ['pay_date', 'DATE'], ['amount_tk', 'DOUBLE'], ['status', 'VARCHAR']],
  side_dropout_events: [['student_id', 'VARCHAR'], ['center_id', 'VARCHAR'], ['dropout_date', 'DATE']],
  side_unit_marks: [['center_id', 'VARCHAR'], ['subject', 'VARCHAR'], ['unit', 'INTEGER'], ['avg_mark', 'DOUBLE'], ['n_students', 'INTEGER']],
  side_cycle_marks: [['student_id', 'VARCHAR'], ['center_id', 'VARCHAR'], ['programme', 'VARCHAR'], ['subject', 'VARCHAR'], ['phase', 'VARCHAR'], ['mark', 'DOUBLE']],
  side_student_monthly: [['student_id', 'VARCHAR'], ['center_id', 'VARCHAR'], ['month_num', 'INTEGER'], ['month', 'VARCHAR'], ['attendance_pct', 'DOUBLE']],
  side_ppe_centers: [['center_id', 'VARCHAR'], ['center_name', 'VARCHAR'], ['division', 'VARCHAR'], ['district', 'VARCHAR'], ['upazila', 'VARCHAR'], ['overall_score', 'DOUBLE']],
  side_ppe_students: [['student_id', 'VARCHAR'], ['center_id', 'VARCHAR'], ['gender', 'VARCHAR'], ['income_band', 'VARCHAR'], ['disability_type', 'VARCHAR'], ['mainstream_status', 'VARCHAR'], ['dropout_reason', 'VARCHAR'], ['attendance_pct', 'DOUBLE']],
  side_ppe_marks: [['student_id', 'VARCHAR'], ['center_id', 'VARCHAR'], ['subject', 'VARCHAR'], ['phase', 'VARCHAR'], ['mark', 'DOUBLE']],
};

/** Relations app-written SQL may read on top of the catalog views. */
export const TRAINED_RELATIONS: ReadonlySet<string> = new Set(['tv_center_scorecard', 'tv_marks_cycle', ...Object.keys(SIDE_TABLES)]);

/** Numeric scorecard columns with network mean and spread, used for every "vs the network" figure. */
export const SCORE_COLUMNS = [
  'avg_mark', 'avg_attendance', 'dropout_rate_pct', 'mainstream_rate_pct', 'me_score', 'pedagogy', 'assessment_quality',
  'documentation', 'learning_environment', 'engagement', 'students_per_teacher', 'pct_low_income', 'pct_cwd', 'visits', 'negative_observations',
] as const;
export type ScoreColumn = (typeof SCORE_COLUMNS)[number];
/** `avg` is for "above-average" conditions. `median` is the reference in comparisons, because a few
 *  extreme centers drag the mean (centers with no linked teacher inflate students per teacher). */
export type NetworkStats = Record<ScoreColumn, { avg: number | null; median: number | null; sd: number | null }>;

/** Smaller centers are not ranked on the combined score: one or two learners swing their rates. */
export const MIN_RANKED_STUDENTS = 30;

const SCORECARD = `
CREATE OR REPLACE TABLE tv_center_scorecard AS
WITH s AS (
  SELECT center_id, count(*) AS students, count(*) FILTER (WHERE is_active) AS active,
    count(*) FILTER (WHERE is_mainstreamed) AS mainstreamed,
    count(*) FILTER (WHERE is_dropout AND mainstream_status IS DISTINCT FROM 'Mainstreamed') AS dropouts,
    mode(division) AS division, mode(district) AS district, mode(upazila) AS upazila,
    round(100.0 * count(*) FILTER (WHERE income_band IN ('<5000', '5000-9999')) / count(*), 1) AS pct_low_income,
    round(100.0 * count(*) FILTER (WHERE disability_type IS NOT NULL AND disability_type <> '') / count(*), 1) AS pct_cwd
  FROM v_students GROUP BY center_id
), a AS (
  SELECT center_id, round(avg(avg_attendance_recorded), 1) AS avg_attendance,
    round(100.0 * count(avg_attendance_recorded) / count(*), 1) AS attendance_coverage_pct
  FROM v_student_attendance GROUP BY center_id
), m AS (
  SELECT center_id, round(avg(mark), 1) AS avg_mark, round(avg(mark) FILTER (WHERE phase = 'BL'), 1) AS baseline_mark,
    round(avg(mark) FILTER (WHERE phase <> 'BL'), 1) AS cycle_mark
  FROM assessments GROUP BY center_id
), t AS (
  SELECT center_id, count(*) AS teachers, count(*) FILTER (WHERE employment_status = 'Active') AS active_teachers
  FROM teachers WHERE center_id IS NOT NULL GROUP BY center_id
), v AS (
  SELECT center_id, count(*) AS visits, max(visit_date) AS last_visit FROM side_center_visits GROUP BY center_id
), o AS (
  SELECT center_id, count(*) FILTER (WHERE rating = 'Negative') AS negative_observations FROM side_center_observations GROUP BY center_id
), base AS (
SELECT s.center_id, COALESCE(c.center_name, 'Center ' || s.center_id) AS center_name, s.division, s.district, s.upazila,
  c.sub_program, s.students, s.active, s.mainstreamed, s.dropouts,
  round(100.0 * s.dropouts / s.students, 1) AS dropout_rate_pct,
  round(100.0 * s.mainstreamed / s.students, 1) AS mainstream_rate_pct,
  a.avg_attendance, a.attendance_coverage_pct, m.avg_mark, m.baseline_mark, m.cycle_mark,
  c.overall_score AS me_score, c.pedagogy, c.assessments AS assessment_quality, c.documentation, c.learning_environment, c.engagement,
  COALESCE(t.teachers, 0) AS teachers, COALESCE(t.active_teachers, 0) AS active_teachers,
  round(1.0 * s.students / NULLIF(t.active_teachers, 0), 1) AS students_per_teacher,
  s.pct_low_income, s.pct_cwd, v.visits, v.last_visit, o.negative_observations
FROM s
LEFT JOIN centers c USING (center_id)
LEFT JOIN a USING (center_id)
LEFT JOIN m USING (center_id)
LEFT JOIN t USING (center_id)
LEFT JOIN v USING (center_id)
LEFT JOIN o USING (center_id)
), ranked AS (
  -- Each measure as a percentile among the centers big enough to rank (${MIN_RANKED_STUDENTS}+ students).
  SELECT center_id,
    CASE WHEN eligible AND me_score IS NOT NULL THEN percent_rank() OVER (PARTITION BY eligible AND me_score IS NOT NULL ORDER BY me_score) END AS pr_me,
    CASE WHEN eligible AND avg_mark IS NOT NULL THEN percent_rank() OVER (PARTITION BY eligible AND avg_mark IS NOT NULL ORDER BY avg_mark) END AS pr_mark,
    CASE WHEN eligible AND avg_attendance IS NOT NULL THEN percent_rank() OVER (PARTITION BY eligible AND avg_attendance IS NOT NULL ORDER BY avg_attendance) END AS pr_att,
    CASE WHEN eligible THEN percent_rank() OVER (PARTITION BY eligible ORDER BY dropout_rate_pct DESC) END AS pr_drop
  FROM (SELECT *, students >= ${MIN_RANKED_STUDENTS} AS eligible FROM base)
)
SELECT base.*,
  CASE WHEN (pr_me IS NOT NULL)::INT + (pr_mark IS NOT NULL)::INT + (pr_att IS NOT NULL)::INT + (pr_drop IS NOT NULL)::INT >= 2
    THEN round(100 * (COALESCE(pr_me, 0) + COALESCE(pr_mark, 0) + COALESCE(pr_att, 0) + COALESCE(pr_drop, 0))
      / ((pr_me IS NOT NULL)::INT + (pr_mark IS NOT NULL)::INT + (pr_att IS NOT NULL)::INT + (pr_drop IS NOT NULL)::INT), 1) END AS performance_score
FROM base LEFT JOIN ranked USING (center_id)`;

let readyMode: DataMode | null = null;
let ready: Promise<void> | null = null;
let loaded = new Set<string>();
let stats: NetworkStats | null = null;

const ddl = (columns: Columns) => columns.map(([n, t]) => `${n} ${t}`).join(', ');

/** Loads Preview side tables the first time an answer needs them. No-op in the real datasets. */
export async function ensureSide(ds: DataSource, mode: DataMode, tables: string[]): Promise<void> {
  if (mode !== 'tuned' || !ds.loadPreviewCsv) return;
  for (const t of tables) {
    if (loaded.has(t)) continue;
    await ds.loadPreviewCsv(t, SIDE_TABLES[t].map(([n, type]) => `'${n}': '${type}'`).join(', '));
    loaded.add(t);
  }
}

async function build(ds: DataSource, mode: DataMode): Promise<void> {
  await ds.init();
  loaded = new Set();
  for (const [t, cols] of Object.entries(SIDE_TABLES)) await ds.exec(`CREATE OR REPLACE TABLE ${t} (${ddl(cols)})`);
  await ensureSide(ds, mode, ['side_center_visits', 'side_center_observations']);
  await ds.exec(SCORECARD);
  await ds.exec(`CREATE OR REPLACE VIEW tv_marks_cycle AS
    SELECT student_id, center_id, programme, subject, phase, mark FROM assessments
    UNION ALL SELECT student_id, center_id, programme, subject, phase, mark FROM side_cycle_marks`);
  const select = SCORE_COLUMNS.flatMap((c) => [`avg(${c}) AS avg_${c}`, `median(${c}) AS med_${c}`, `stddev_samp(${c}) AS sd_${c}`]).join(', ');
  const row = (await ds.query(`SELECT ${select} FROM tv_center_scorecard`)).rows[0];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  stats = Object.fromEntries(SCORE_COLUMNS.map((c) => [c, { avg: num(row[`avg_${c}`]), median: num(row[`med_${c}`]), sd: num(row[`sd_${c}`]) }])) as NetworkStats;
}

/** Builds the trained tables once per dataset. Safe to await repeatedly. */
export function ensureTrained(ds: DataSource, mode: DataMode): Promise<void> {
  if (ready && readyMode === mode) return ready;
  readyMode = mode;
  ready = build(ds, mode).catch((e) => { ready = null; readyMode = null; throw e; });
  return ready;
}

export function networkStats(): NetworkStats {
  if (!stats) throw new Error('trained tables are not ready');
  return stats;
}
