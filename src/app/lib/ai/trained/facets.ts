// The analysis a follow-up can ask for about a center or a group of centers. Each facet is fixed SQL
// bound to the current scope, so a follow-up answer never depends on the model writing a query.
import type { DataMode } from '../../db/duckdb-source';
import type { Intent } from '../interpret';
import type { FacetKey } from '../context/resolve';
import type { ScoreColumn } from './setup';

export type Where = (alias?: string) => string;

export interface Part { title: string; intent: Intent; sql: string; side?: string[]; note?: string }

export interface FacetOutcome { parts: Part[]; missing?: string }

export interface MetricMeta {
  key: ScoreColumn;
  label: string;
  better: 'higher' | 'lower';
  controllable: boolean;
  why: string;
  fix: string;
  lesson: string;
}

export const METRICS: MetricMeta[] = [
  { key: 'avg_mark', label: 'Average marks', better: 'higher', controllable: true, why: 'Teaching and remedial support directly affect it.', fix: 'Run targeted remedial sessions in the weakest subjects and re-test each cycle.', lesson: 'Stronger learning results' },
  { key: 'avg_attendance', label: 'Attendance (%)', better: 'higher', controllable: true, why: 'Follow-up with families and class timing can change it.', fix: 'Start weekly follow-up of absent learners through teachers and the CMC.', lesson: 'Regular attendance follow-up' },
  { key: 'dropout_rate_pct', label: 'Dropout rate (%)', better: 'lower', controllable: true, why: 'Early-warning follow-up can reduce it, though poverty and migration also drive it.', fix: 'Set up an early-warning list and home visits for learners at risk of leaving.', lesson: 'Keeping learners enrolled' },
  { key: 'mainstream_rate_pct', label: 'Mainstream transition (%)', better: 'higher', controllable: true, why: 'Preparation and links with receiving schools can raise it.', fix: 'Agree admission support with nearby schools and prepare eligible learners early.', lesson: 'Preparing learners for mainstream schools' },
  { key: 'me_score', label: 'M&E overall score (0-5)', better: 'higher', controllable: true, why: 'It reflects operating practice that supervision can improve.', fix: 'Agree a corrective action list from the latest monitoring review.', lesson: 'Sound overall center management' },
  { key: 'pedagogy', label: 'Pedagogy score (0-5)', better: 'higher', controllable: true, why: 'Coaching and teacher training can improve it.', fix: 'Arrange classroom coaching focused on teaching practice.', lesson: 'Good classroom teaching practice' },
  { key: 'assessment_quality', label: 'Assessment quality (0-5)', better: 'higher', controllable: true, why: 'Assessment routines can be taught and supervised.', fix: 'Introduce a regular assessment routine and review the results with teachers.', lesson: 'Regular, well-used assessment' },
  { key: 'documentation', label: 'Documentation (0-5)', better: 'higher', controllable: true, why: 'Record keeping is a routine a center can adopt.', fix: 'Set a simple monthly record-keeping checklist.', lesson: 'Consistent record keeping' },
  { key: 'learning_environment', label: 'Learning environment (0-5)', better: 'higher', controllable: true, why: 'Classroom set-up can be improved, within budget limits.', fix: 'Fix the most basic classroom and materials gaps first.', lesson: 'A well-kept learning environment' },
  { key: 'engagement', label: 'Community engagement (0-5)', better: 'higher', controllable: true, why: 'Parent and community meetings can be scheduled and followed up.', fix: 'Hold regular parent and community meetings with recorded actions.', lesson: 'Active parent and community engagement' },
  { key: 'students_per_teacher', label: 'Students per active teacher', better: 'lower', controllable: true, why: 'Staffing can be adjusted, within budget limits.', fix: 'Review teacher allocation against enrolment.', lesson: 'Manageable student-teacher ratios' },
  { key: 'visits', label: 'Staff and PO visits', better: 'higher', controllable: true, why: 'Visit schedules are set by management.', fix: 'Schedule more frequent supervision visits with follow-up on actions.', lesson: 'Regular supervision visits' },
  { key: 'negative_observations', label: 'Negative monitoring observations', better: 'lower', controllable: true, why: 'Issues raised can be tracked to closure.', fix: 'Track each negative observation to closure with a named owner.', lesson: 'Closing monitoring issues promptly' },
  { key: 'pct_low_income', label: 'Low-income learners (%)', better: 'lower', controllable: false, why: 'It describes who the center serves, not how it is run.', fix: '', lesson: '' },
  { key: 'pct_cwd', label: 'Learners with disabilities (%)', better: 'lower', controllable: false, why: 'It describes who the center serves, not how it is run.', fix: '', lesson: '' },
];

export const metaFor = (key: string) => METRICS.find((m) => m.key === key);

const NOT_RECORDED: Partial<Record<FacetKey, string>> = {
  visits: 'staff and PO visits',
  observations: 'dated monitoring observations',
  cmc: 'CMC functioning (the nearest measure is the community engagement score)',
  cash: 'cash transfer payments',
};

const trueDropout = (a = '') => `(${a}is_dropout AND ${a}mainstream_status IS DISTINCT FROM 'Mainstreamed')`;

/** The SQL for a facet, or what is missing when this dataset cannot answer it. */
export function facetParts(key: FacetKey, where: Where, label: string, mode: DataMode, grouped: boolean): FacetOutcome {
  if (mode !== 'tuned' && NOT_RECORDED[key]) return { parts: [], missing: NOT_RECORDED[key] };
  const by = grouped ? 'center_name, ' : '';
  const byS = grouped ? 'c.center_name, ' : '';
  const joinS = grouped ? ` JOIN tv_center_scorecard c USING (center_id)` : '';
  const orderS = grouped ? '1, 2' : '1';

  switch (key) {
    case 'attendance': {
      const parts: Part[] = [{
        title: `${label}: attendance`, intent: 'list',
        sql: `SELECT center_name, avg_attendance, attendance_coverage_pct, students FROM tv_center_scorecard WHERE ${where()} ORDER BY avg_attendance DESC NULLS LAST, center_id`,
      }, {
        title: `${label}: learners by attendance band`, intent: 'aggregate',
        sql: `SELECT CASE WHEN avg_attendance_recorded < 60 THEN '1. Below 60%' WHEN avg_attendance_recorded < 75 THEN '2. 60-74%' WHEN avg_attendance_recorded < 85 THEN '3. 75-84%' ELSE '4. 85% or above' END AS attendance_band, count(*) AS students FROM v_student_attendance WHERE ${where()} AND avg_attendance_recorded IS NOT NULL GROUP BY 1 ORDER BY 1`,
      }];
      if (mode === 'tuned') parts.push({ title: `${label}: monthly attendance`, intent: 'trend', sql: `SELECT month, round(sum(sum_attendance) / NULLIF(sum(n_students), 0), 1) AS avg_attendance_pct FROM v_center_monthly WHERE ${where()} GROUP BY month, month_num ORDER BY month_num` });
      return { parts };
    }
    case 'results':
      return { parts: [{ title: `${label}: average marks by subject`, intent: 'aggregate', sql: `SELECT subject, round(avg(mark), 1) AS avg_mark, count(DISTINCT student_id) AS students FROM v_marks WHERE ${where()} GROUP BY subject ORDER BY avg_mark` }] };
    case 'cycle':
      return { parts: [{
        title: `${label}: marks by assessment phase`, intent: 'trend', side: ['side_cycle_marks'],
        sql: `SELECT phase, round(avg(mark), 1) AS avg_mark, count(DISTINCT student_id) AS students FROM tv_marks_cycle WHERE ${where()} GROUP BY phase ORDER BY phase`,
      }, {
        title: `${label}: baseline to latest cycle by subject`, intent: 'list', side: ['side_cycle_marks'],
        sql: `WITH s AS (SELECT subject, phase, avg(mark) AS m FROM tv_marks_cycle WHERE ${where()} GROUP BY subject, phase), l AS (SELECT subject, max(phase) AS latest FROM s WHERE phase <> 'BL' GROUP BY subject) SELECT b.subject, round(b.m, 1) AS baseline, l.latest AS latest_cycle, round(c.m, 1) AS latest_mark, round(c.m - b.m, 1) AS improvement FROM s b JOIN l ON b.subject = l.subject JOIN s c ON c.subject = l.subject AND c.phase = l.latest WHERE b.phase = 'BL' ORDER BY improvement DESC`,
      }] };
    case 'dropout':
      return { parts: [{
        title: `${label}: dropout`, intent: 'list',
        sql: `SELECT center_name, students, dropouts, dropout_rate_pct FROM tv_center_scorecard WHERE ${where()} ORDER BY dropout_rate_pct DESC, center_id`,
      }, {
        title: `${label}: dropout reasons`, intent: 'aggregate',
        sql: `SELECT dropout_reason, count(*) AS students FROM v_students WHERE ${where()} AND ${trueDropout()} GROUP BY dropout_reason ORDER BY students DESC`,
      }] };
    case 'dropout_gender':
      return { parts: [{ title: `${label}: dropout by gender`, intent: 'aggregate', sql: `SELECT gender_label, round(100.0 * count(*) FILTER (WHERE ${trueDropout()}) / count(*), 1) AS dropout_rate_pct, count(*) AS students, count(*) FILTER (WHERE ${trueDropout()}) AS dropouts FROM v_students WHERE ${where()} GROUP BY gender_label ORDER BY dropout_rate_pct DESC` }] };
    case 'dropout_income':
      return { parts: [{ title: `${label}: dropout by family income`, intent: 'aggregate', sql: `SELECT COALESCE(income_band, 'Not recorded') AS income_band, round(100.0 * count(*) FILTER (WHERE ${trueDropout()}) / count(*), 1) AS dropout_rate_pct, count(*) AS students, count(*) FILTER (WHERE ${trueDropout()}) AS dropouts FROM v_students WHERE ${where()} GROUP BY 1 ORDER BY dropout_rate_pct DESC` }] };
    case 'mainstream':
      return { parts: [{ title: `${label}: mainstream transition`, intent: 'list', sql: `SELECT center_name, students, mainstreamed, mainstream_rate_pct FROM tv_center_scorecard WHERE ${where()} ORDER BY mainstream_rate_pct DESC, center_id` }] };
    case 'gender':
      return { parts: [{ title: `${label}: marks by gender`, intent: 'aggregate', sql: `SELECT gender_label, round(avg(mark), 1) AS avg_mark, count(DISTINCT student_id) AS students FROM v_marks WHERE ${where()} AND gender_label IS NOT NULL GROUP BY gender_label ORDER BY avg_mark` }] };
    case 'income':
      return { parts: [{ title: `${label}: marks by family income`, intent: 'aggregate', sql: `SELECT COALESCE(s.income_band, 'Not recorded') AS income_band, round(avg(m.mark), 1) AS avg_mark, count(DISTINCT m.student_id) AS students FROM v_marks m JOIN v_students s USING (student_id) WHERE ${where('m')} GROUP BY 1 ORDER BY avg_mark` }] };
    case 'groups':
      return { parts: [{ title: `${label}: marks by student group`, intent: 'list', sql: `SELECT s.gender_label, COALESCE(s.income_band, 'Not recorded') AS income_band, round(avg(m.mark), 1) AS avg_mark, count(DISTINCT m.student_id) AS students FROM v_marks m JOIN v_students s USING (student_id) WHERE ${where('m')} AND s.gender_label IS NOT NULL GROUP BY 1, 2 HAVING count(DISTINCT m.student_id) >= 5 ORDER BY avg_mark` }] };
    case 'teachers': {
      const parts: Part[] = [{
        title: `${label}: teacher staffing`, intent: 'list',
        sql: `SELECT center_name, teachers, active_teachers, students, students_per_teacher FROM tv_center_scorecard WHERE ${where()} ORDER BY students_per_teacher DESC NULLS LAST, center_id`,
      }, {
        title: `${label}: teacher profile`, intent: 'list',
        sql: `SELECT ${byS}t.employment_status, t.education, t.experience, count(*) AS teachers FROM v_teachers t${joinS} WHERE ${where('t')} GROUP BY ALL ORDER BY ${grouped ? '1, 5 DESC' : '4 DESC'}`,
      }];
      if (mode === 'tuned') parts.push({ title: `${label}: teacher attendance`, intent: 'list', side: ['side_teacher_attendance'], sql: `SELECT teacher_name, round(100.0 * sum(present_days) / sum(working_days), 1) AS attendance_pct, sum(working_days) AS working_days FROM side_teacher_attendance WHERE ${where()} GROUP BY teacher_name ORDER BY attendance_pct` });
      return { parts };
    }
    case 'monitoring':
      return { parts: [{ title: `${label}: M&E scores (0-5)`, intent: 'list', sql: `SELECT center_name, me_score, pedagogy, assessment_quality, documentation, learning_environment, engagement FROM tv_center_scorecard WHERE ${where()} ORDER BY me_score DESC NULLS LAST, center_id` }] };
    case 'visits':
      return { parts: [{ title: `${label}: staff and PO visits`, intent: 'list', side: ['side_center_visits'], sql: `SELECT ${byS}v.staff_role, count(*) AS visits, min(v.visit_date) AS first_visit, max(v.visit_date) AS last_visit FROM side_center_visits v${joinS} WHERE ${where('v')} GROUP BY ALL ORDER BY ${orderS}` }] };
    case 'observations':
      return { parts: [{ title: `${label}: monitoring observations`, intent: 'list', side: ['side_center_observations'], sql: `SELECT ${byS}o.obs_date, o.category, o.score, o.rating, o.issue, o.resolved FROM side_center_observations o${joinS} WHERE ${where('o')} ORDER BY ${grouped ? 'c.center_name, ' : ''}o.obs_date DESC, o.category LIMIT 40` }] };
    case 'cmc':
      return { parts: [{ title: `${label}: CMC functioning`, intent: 'list', side: ['side_center_org'], sql: `SELECT ${by}cmc_status, cmc_meetings_per_year, cmc_members, cmc_last_meeting FROM side_center_org o JOIN tv_center_scorecard c USING (center_id) WHERE ${where('o')} ORDER BY ${grouped ? 'center_name' : 'cmc_status'}` }] };
    case 'cash':
      return { parts: [{ title: `${label}: cash transfers`, intent: 'list', side: ['side_cash_transfers'], sql: `SELECT status, count(*) AS payments, count(DISTINCT student_id) AS students, round(sum(amount_tk)) AS amount_tk, count(*) FILTER (WHERE transaction_no IS NULL OR transaction_no = '') AS missing_transaction_no FROM side_cash_transfers WHERE ${where()} GROUP BY status ORDER BY status` }] };
    default:
      return { parts: [] };
  }
}
