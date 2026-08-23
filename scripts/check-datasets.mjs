// ─────────────────────────────────────────────────────────────────────────────
// check-datasets.mjs — every dataset must satisfy the semantic layer.
//
// Exists because adding one column to v_students silently broke Preview: public/data/ had been
// rebuilt with the new column but public/data-tuned/ had not, so every view failed at runtime with
// "Table s does not have a column named …". Schema-only (LIMIT 0), so it is fast and reads no rows.
//
//   npm run check:datasets
// ─────────────────────────────────────────────────────────────────────────────
import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEMANTIC = path.join(ROOT, 'src', 'app', 'lib', 'db', 'semantic.sql');
const TABLES = ['students', 'attendance', 'assessments', 'teachers', 'centers'];
// Preview-only tables: absent elsewhere, so they are stubbed exactly as duckdb-source.ts does.
const STUBS = [
  'CREATE TABLE IF NOT EXISTS attendance_monthly (month_num INT, month VARCHAR, division VARCHAR, programme VARCHAR, n_students INT, sum_attendance DOUBLE)',
  'CREATE TABLE IF NOT EXISTS attendance_center_monthly (center_id VARCHAR, month_num INT, month VARCHAR, n_students INT, sum_attendance DOUBLE)',
  'CREATE TABLE IF NOT EXISTS attendance_gaps (student_id VARCHAR, last_attended_month VARCHAR, days_since_last_attendance INT, recent_attendance_pct DOUBLE)',
];

// Mirrors NUMERIC_COLUMNS in src/app/lib/db/types.ts — a column that is entirely empty in one
// dataset would otherwise load as VARCHAR and break avg()/sum().
const NUMERIC = {
  students: ['father_income_tk', 'mother_income_tk', 'student_income_tk', 'household_income_tk', 'enrollment_year', 'mainstreamed'],
  attendance: ['attendance_pct', 'is_estimated'],
  assessments: ['mark'],
  centers: ['gps_lat', 'gps_lng', 'pedagogy', 'assessments', 'documentation', 'learning_environment', 'engagement', 'overall_score'],
};
const typesClause = (t) => (NUMERIC[t]?.length ? `, types={${NUMERIC[t].map((c) => `'${c}':'DOUBLE'`).join(', ')}}` : '');

const stmts = fs.readFileSync(SEMANTIC, 'utf8').replace(/--[^\n]*/g, '').split(';').filter((s) => s.trim().length);
const datasets = ['data', 'data-tuned', 'data-v2'].filter((d) => fs.existsSync(path.join(ROOT, 'public', d)));

let failed = 0;
for (const ds of datasets) {
  const dir = path.join(ROOT, 'public', ds).replace(/\\/g, '/');
  const db = new duckdb.Database(':memory:');
  const q = (s) => new Promise((res, rej) => db.all(s, (e, r) => (e ? rej(e) : res(r))));
  try {
    await q(`PRAGMA memory_limit='1GB'`);
    await q(`PRAGMA threads=1`);
    for (const t of TABLES) {
      const f = `${dir}/${t}.csv`;
      if (!fs.existsSync(f)) throw new Error(`missing ${t}.csv`);
      await q(`CREATE TABLE ${t} AS SELECT * FROM read_csv_auto('${f}', header=true${typesClause(t)}) LIMIT 0`);
    }
    for (const s of STUBS) await q(s);
    for (const s of stmts) await q(s);
    const v = await q("SELECT count(*) c FROM information_schema.tables WHERE table_name LIKE 'v\\_%' ESCAPE '\\'");
    console.log(`  ✅ ${ds.padEnd(12)} all ${stmts.length} statements built · ${Number(v[0].c)} views`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${ds.padEnd(12)} ${String(e.message).split('\n')[0]}`);
  } finally {
    db.close();
  }
}

console.log();
if (failed) {
  console.log(`❌ ${failed} of ${datasets.length} dataset(s) do not satisfy the semantic layer.`);
  console.log('   A column added to a view must exist in EVERY dataset — rebuild them all:');
  console.log('   npm run build:data && npm run build:data:tuned && npm run build:data:v2');
  process.exit(1);
}
console.log(`✅ all ${datasets.length} datasets satisfy the semantic layer.`);
