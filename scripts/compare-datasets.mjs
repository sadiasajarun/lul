// ─────────────────────────────────────────────────────────────────────────────
// compare-datasets.mjs — hold the SAME question against every dataset.
//
// The point of running the 14-08-26 export as a third mode is to see how an answer
// MOVES when the underlying data changes, rather than trusting either in isolation.
// Deterministic (runs the SQL, not the model), so it costs nothing.
//
//   npm run compare
// ─────────────────────────────────────────────────────────────────────────────
import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEMANTIC = path.join(ROOT, 'src', 'app', 'lib', 'db', 'semantic.sql');
const TABLES = ['students', 'attendance', 'assessments', 'teachers', 'centers'];
const PREVIEW_ONLY = ['attendance_monthly', 'attendance_center_monthly', 'attendance_gaps'];
const NUMERIC = {
  students: ['father_income_tk', 'mother_income_tk', 'student_income_tk', 'household_income_tk', 'enrollment_year', 'mainstreamed'],
  attendance: ['attendance_pct', 'is_estimated'],
  assessments: ['mark'],
  centers: ['gps_lat', 'gps_lng', 'pedagogy', 'assessments', 'documentation', 'learning_environment', 'engagement', 'overall_score'],
};
const tc = (t) => (NUMERIC[t]?.length ? `, types={${NUMERIC[t].map((c) => `'${c}':'DOUBLE'`).join(', ')}}` : '');

// One scalar per question — enough to see the answer move, small enough to print side by side.
const QUESTIONS = [
  ['learners on the books', `SELECT count(*) FROM v_students`],
  ['attendance coverage %', `SELECT round(100.0*count(*) FILTER (WHERE recorded_months>0)/count(*),1) FROM v_student_attendance`],
  ['mean attendance (recorded only)', `SELECT round(avg(avg_attendance_recorded),1) FROM v_student_attendance`],
  ['centres below 85% attendance', `SELECT count(*) FROM v_center_economic_pressure WHERE below_85 AND attendance_confidence <> 'low'`],
  ['centres with a monitoring score', `SELECT count(*) FROM v_center_enrollment WHERE me_score IS NOT NULL`],
  ['mean monitoring score', `SELECT round(avg(me_score),2) FROM v_center_enrollment WHERE me_score IS NOT NULL`],
  ['ghost / inactive learners', `SELECT count(*) FROM v_ghost_students WHERE is_ghost`],
  ['learners with any mark', `SELECT count(DISTINCT student_id) FROM v_marks`],
  ['reading: below baseline', `SELECT count(DISTINCT student_id) FROM v_score_levels WHERE is_reading AND level_order = 1`],
  ['households in the two lowest bands %', `SELECT round(100.0*count(*) FILTER (WHERE income_band IN ('<5000','5000-9999'))/count(*),1) FROM v_students`],
  ['children with recorded work %', `SELECT round(100.0*count(*) FILTER (WHERE is_working)/count(*),1) FROM v_students`],
  ['active learners %', `SELECT round(100.0*count(*) FILTER (WHERE is_active)/count(*),1) FROM v_students`],
  ['teachers linked to a centre %', `SELECT round(100.0*count(*) FILTER (WHERE center_id IS NOT NULL)/count(*),1) FROM v_teachers`],
];

async function open(folder) {
  const dir = path.join(ROOT, 'public', folder).replace(/\\/g, '/');
  const db = new duckdb.Database(':memory:');
  const q = (s) => new Promise((res, rej) => db.all(s, (e, r) => (e ? rej(e) : res(r))));
  await q(`PRAGMA memory_limit='2GB'`);
  await q(`PRAGMA threads=1`);
  for (const t of TABLES) await q(`CREATE TABLE ${t} AS SELECT * FROM read_csv_auto('${dir}/${t}.csv', header=true, sample_size=-1${tc(t)})`);
  await q(`CREATE TABLE IF NOT EXISTS attendance_monthly (month_num INTEGER, month VARCHAR, division VARCHAR, programme VARCHAR, n_students INTEGER, sum_attendance DOUBLE)`);
  await q(`CREATE TABLE IF NOT EXISTS attendance_center_monthly (center_id VARCHAR, month_num INTEGER, month VARCHAR, n_students INTEGER, sum_attendance DOUBLE)`);
  await q(`CREATE TABLE IF NOT EXISTS attendance_gaps (student_id VARCHAR, last_attended_month VARCHAR, days_since_last_attendance INTEGER, recent_attendance_pct DOUBLE)`);
  for (const f of PREVIEW_ONLY) {
    const p = `${dir}/${f}.csv`;
    if (!fs.existsSync(p)) continue;
    const ty = f === 'attendance_gaps' ? `, types={'student_id':'VARCHAR'}` : f === 'attendance_center_monthly' ? `, types={'center_id':'VARCHAR'}` : '';
    await q(`CREATE OR REPLACE TABLE ${f} AS SELECT * FROM read_csv_auto('${p}', header=true, sample_size=-1${ty})`);
  }
  for (const s of fs.readFileSync(SEMANTIC, 'utf8').replace(/--[^\n]*/g, '').split(';').filter((x) => x.trim().length)) await q(s);
  return { q, close: () => db.close() };
}

const LABEL = { data: 'Real', 'data-v2': 'Real·26', 'data-tuned': 'Preview' };
const folders = ['data', 'data-v2', 'data-tuned'].filter((d) => fs.existsSync(path.join(ROOT, 'public', d, 'students.csv')));
const results = {};
for (const f of folders) {
  const D = await open(f);
  results[f] = [];
  for (const [, sql] of QUESTIONS) {
    try {
      const r = await D.q(sql);
      const v = r.length ? Object.values(r[0])[0] : null;
      results[f].push(v == null ? '—' : (typeof v === 'bigint' ? Number(v) : v).toLocaleString());
    } catch (e) {
      results[f].push('ERR');
    }
  }
  D.close();
}

const w = 38;
console.log('\nThe same measure, computed on each dataset. Differences are the DATA, not the code —');
console.log('every column ran the identical SQL through the identical semantic layer.\n');
console.log('  ' + 'measure'.padEnd(w) + folders.map((f) => LABEL[f].padStart(14)).join(''));
console.log('  ' + '─'.repeat(w + 14 * folders.length));
QUESTIONS.forEach(([label], i) => {
  console.log('  ' + label.padEnd(w) + folders.map((f) => String(results[f][i]).padStart(14)).join(''));
});
console.log('\n  Real     = the Jul-2025 export (full population, thin attendance)');
console.log('  Real·26  = the 14-Aug-2026 export (a 2022-heavy cohort slice, much better measured)');
console.log('  Preview  = Real + estimates, now preferring Real·26 values wherever they exist');
console.log('\n  A gap between Real and Real·26 is a COVERAGE difference, not a contradiction:');
console.log('  they describe different populations. Do not read one as correcting the other.\n');
