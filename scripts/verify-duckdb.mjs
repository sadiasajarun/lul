import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Same DuckDB engine (and same SQL dialect + semantic layer) the browser runs via duckdb-wasm — so a
// query that passes here answers identically in the app. This doubles as the eval-harness backbone.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'public', 'data');
const SEMANTIC = path.join(HERE, '..', 'src', 'app', 'lib', 'db', 'semantic.sql');
const db = new duckdb.Database(':memory:');
const run = (sql) => new Promise((res, rej) => db.all(sql, (e, r) => (e ? rej(e) : res(r))));
const p = (f) => path.join(DATA, f).replace(/\\/g, '/');

// Base tables
for (const t of ['students', 'attendance', 'assessments', 'teachers', 'centers'])
  await run(`CREATE TABLE ${t} AS SELECT * FROM read_csv_auto('${p(t + '.csv')}', header=true, sample_size=-1)`);
// Optional Preview-only monthly attendance (absent under public/data/) — empty table so views build.
if (fs.existsSync(p('attendance_monthly.csv'))) await run(`CREATE TABLE attendance_monthly AS SELECT * FROM read_csv_auto('${p('attendance_monthly.csv')}', header=true, sample_size=-1)`);
else await run(`CREATE TABLE attendance_monthly (month_num INTEGER, month VARCHAR, division VARCHAR, programme VARCHAR, n_students INTEGER, sum_attendance DOUBLE)`);
// Semantic layer (same file the app loads)
const stmts = fs.readFileSync(SEMANTIC, 'utf8').replace(/--[^\n]*/g, '').split(';').filter((s) => s.trim().length);
for (const s of stmts) await run(s);

const show = async (label, sql) => {
  const r = await run(sql);
  console.log(`\n▶ ${label}`);
  console.table(r.slice(0, 10).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]))));
};

// Views resolve + answer the reported questions THROUGH the semantic layer:
await show('Female count + % girls (v_students)',
  `SELECT count(*) FILTER (WHERE gender_label='Female') AS girls, count(*) total,
   round(100.0*count(*) FILTER (WHERE gender_label='Female')/count(*),1) pct_girls FROM v_students`);
await show('Active vs mainstreamed vs dropout (v_students definitions)',
  `SELECT count(*) FILTER (WHERE is_active) active, count(*) FILTER (WHERE is_mainstreamed) mainstreamed,
   count(*) FILTER (WHERE is_dropout) dropout, count(*) total FROM v_students`);
await show('Student-to-teacher ratio by division (v_teacher_ratio_by_division)',
  `SELECT * FROM v_teacher_ratio_by_division ORDER BY students_per_teacher DESC`);
await show('Attendance coverage + honest mean (v_attendance)',
  `SELECT round(100.0*count(*) FILTER (WHERE is_recorded)/count(*),1) AS coverage_pct,
   round(avg(attendance_pct) FILTER (WHERE is_recorded),1) AS mean_over_recorded FROM v_attendance`);
await show('ABAL students with poor Bangla (v_student_subject) — the actual list',
  `SELECT student_id, avg_mark, n_marks FROM v_student_subject
   WHERE programme='ABAL' AND subject='Bangla' AND avg_mark IS NOT NULL ORDER BY avg_mark ASC LIMIT 8`);
await show('Centres with more than 30 students (v_center_enrollment)',
  `SELECT center_id, center_name, division, students, teachers FROM v_center_enrollment WHERE students>30 ORDER BY students DESC LIMIT 8`);
await show('Enrollment by year (v_enrollment_by_year)',
  `SELECT * FROM v_enrollment_by_year ORDER BY enrollment_year DESC LIMIT 6`);

db.close();
console.log('\n✅ Semantic-layer verification complete.');
