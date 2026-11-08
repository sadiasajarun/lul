// Checks the simulated Preview side tables are consistent with the Preview data they extend.
//
//   npm run check:side
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import duckdb from 'duckdb';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'public', 'data-tuned').replace(/\\/g, '/');
const db = new duckdb.Database(':memory:');
const q = (s) => new Promise((res, rej) => db.all(s, (e, r) => (e ? rej(e) : res(r))));
const num = async (s) => Number(Object.values((await q(s))[0])[0]);

const ID = `types={'student_id':'VARCHAR','center_id':'VARCHAR'}`;
await q(`CREATE VIEW students AS SELECT * FROM read_csv_auto('${dir}/students.csv', sample_size=-1, ${ID})`);
await q(`CREATE VIEW centers AS SELECT * FROM read_csv_auto('${dir}/centers.csv', sample_size=-1, types={'center_id':'VARCHAR'})`);
await q(`CREATE VIEW assessments AS SELECT * FROM read_csv_auto('${dir}/assessments.csv', sample_size=-1, ${ID})`);
await q(`CREATE VIEW attendance AS SELECT * FROM read_csv_auto('${dir}/attendance.csv', sample_size=-1, types={'student_id':'VARCHAR'})`);
const CENTER_ONLY = `types={'center_id':'VARCHAR'}`;
const SIDE_TYPES = {
  side_center_visits: CENTER_ONLY, side_center_observations: CENTER_ONLY, side_center_org: CENTER_ONLY, side_teacher_attendance: CENTER_ONLY,
  side_unit_marks: CENTER_ONLY, side_ppe_centers: CENTER_ONLY, side_dropout_events: ID, side_cycle_marks: ID, side_student_monthly: ID,
  side_ppe_students: ID, side_ppe_marks: ID, side_cash_transfers: `types={'student_id':'VARCHAR','center_id':'VARCHAR','transaction_no':'VARCHAR'}`,
};
for (const [t, types] of Object.entries(SIDE_TYPES)) await q(`CREATE VIEW ${t} AS SELECT * FROM read_csv_auto('${dir}/${t}.csv', sample_size=-1, ${types})`);

let failed = 0;
async function zero(name, sql) {
  const n = await num(sql);
  console.log(`${n === 0 ? 'ok  ' : 'FAIL'} ${name}${n === 0 ? '' : ` (${n})`}`);
  if (n !== 0) failed++;
}

const STUDENT_CENTERS = `(SELECT DISTINCT center_id FROM students)`;
for (const t of ['side_center_visits', 'side_center_observations', 'side_center_org', 'side_teacher_attendance', 'side_unit_marks']) {
  await zero(`${t}: only centers that have students`, `SELECT count(*) FROM ${t} WHERE center_id NOT IN ${STUDENT_CENTERS}`);
}
await zero('every student-backed center has visits', `SELECT count(*) FROM ${STUDENT_CENTERS} x WHERE center_id NOT IN (SELECT center_id FROM side_center_visits)`);
await zero('latest observation round equals the existing M&E score', `SELECT count(*) FROM side_center_observations o JOIN centers c USING (center_id) WHERE o.round_no = 3 AND abs(o.score - CASE o.category WHEN 'pedagogy' THEN COALESCE(c.pedagogy, c.overall_score) WHEN 'assessments' THEN COALESCE(c.assessments, c.overall_score) WHEN 'documentation' THEN COALESCE(c.documentation, c.overall_score) WHEN 'learning_environment' THEN COALESCE(c.learning_environment, c.overall_score) ELSE COALESCE(c.engagement, c.overall_score) END) > 0.001`);
await zero('dropout dates exist only for true dropouts', `SELECT count(*) FROM side_dropout_events e JOIN students s USING (student_id) WHERE s.dropout_reason IS NULL OR s.mainstream_status = 'Mainstreamed'`);
await zero('every true dropout has a date', `SELECT count(*) FROM students s WHERE s.dropout_reason IS NOT NULL AND s.mainstream_status IS DISTINCT FROM 'Mainstreamed' AND s.student_id NOT IN (SELECT student_id FROM side_dropout_events)`);
await zero('dropout dates fall after the start date', `SELECT count(*) FROM side_dropout_events e JOIN students s USING (student_id) WHERE s.education_start_date IS NOT NULL AND e.dropout_date::DATE < strptime(s.education_start_date, '%d %b %Y')::DATE`);
await zero('cash transfers: no dummy learners', `SELECT count(*) FROM side_cash_transfers c JOIN students s USING (student_id) WHERE s.mainstream_status = 'Running'`);
await zero('cash transfers: only low-income learners', `SELECT count(*) FROM side_cash_transfers c JOIN students s USING (student_id) WHERE s.income_band NOT IN ('<5000', '5000-9999')`);
await zero('cycle marks: students exist', `SELECT count(*) FROM side_cycle_marks WHERE student_id NOT IN (SELECT student_id FROM students)`);
await zero('cycle marks: never duplicate an existing mark', `SELECT count(*) FROM side_cycle_marks c JOIN assessments a ON a.student_id = c.student_id AND a.subject = c.subject AND a.phase = c.phase`);
await zero('marks stay within 0-100', `SELECT count(*) FROM side_cycle_marks WHERE mark < 0 OR mark > 100`);
await zero('unit marks keep each center-subject mean', `SELECT count(*) FROM (SELECT center_id, subject, avg(avg_mark) AS u FROM side_unit_marks GROUP BY 1, 2) x JOIN (SELECT center_id, subject, avg(mark) AS m FROM assessments WHERE mark IS NOT NULL GROUP BY 1, 2) y USING (center_id, subject) WHERE abs(u - m) > 0.05`);
await zero('monthly attendance averages to the existing figure', `SELECT count(*) FROM (SELECT student_id, avg(attendance_pct) AS m FROM side_student_monthly GROUP BY 1) x JOIN (SELECT student_id, avg(attendance_pct) AS a FROM attendance GROUP BY 1) y USING (student_id) WHERE abs(m - a) > 3`);
await zero('PPE ids never collide with existing centers', `SELECT count(*) FROM side_ppe_centers WHERE center_id IN (SELECT center_id FROM centers)`);
await zero('PPE students all belong to a PPE center', `SELECT count(*) FROM side_ppe_students WHERE center_id NOT IN (SELECT center_id FROM side_ppe_centers)`);

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll side-table checks passed.');
process.exit(failed ? 1 : 0);
