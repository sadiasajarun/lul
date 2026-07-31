// CATALOG GUARD — deterministic, no LLM, no API key. Run: npm run check:catalog
//
// Catches the "disability_type" class of bug: a column that EXISTS in a queryable v_* view but is
// not described in the AI's catalog, so the model can't see it and wrongly refuses ("not tracked").
//
// It builds the real semantic views in DuckDB (schema only — LIMIT 0, so it's fast and reads no
// personal data) and reconciles each view's actual columns against catalog.ts:
//   • column in the view but neither DOCUMENTED nor in HIDDEN_COLUMNS  → FAIL (a hidden gap)
//   • column DOCUMENTED but not present in the view                    → FAIL (stale/typo doc)
//   • view listed in catalog but missing from the engine, or vice-versa → FAIL
// Exit code 1 on any failure so it can gate a commit / CI.
import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'public', 'data');
const SEMANTIC = path.join(HERE, '..', 'src', 'app', 'lib', 'db', 'semantic.sql');
const { VIEWS, HIDDEN_COLUMNS, HIDDEN_VIEWS = {} } = await import('../src/app/lib/db/catalog.ts');

// ── build the views, schema-only (LIMIT 0 → infers columns from CSV headers, loads no rows) ──
const db = new duckdb.Database(':memory:');
const run = (sql) => new Promise((res, rej) => db.all(sql, (e, r) => (e ? rej(e) : res(r))));
const q = (p) => p.replace(/\\/g, '/');
for (const t of ['students', 'attendance', 'assessments', 'teachers', 'centers'])
  await run(`CREATE TABLE ${t} AS SELECT * FROM read_csv_auto('${q(path.join(DATA, t + '.csv'))}', header=true) LIMIT 0`);
// attendance_monthly is a preview-only table (empty in Real mode); stub it so v_attendance_monthly builds.
await run('CREATE TABLE IF NOT EXISTS attendance_monthly (month_num INT, month VARCHAR, division VARCHAR, programme VARCHAR, n_students INT, sum_attendance DOUBLE)');
for (const s of fs.readFileSync(SEMANTIC, 'utf8').split(';').filter((x) => x.replace(/--[^\n]*/g, '').trim().length)) await run(s);

const actualCols = async (view) => (await run(`DESCRIBE ${view}`)).map((r) => r.column_name);
const engineViews = new Set((await run("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'v\\_%' ESCAPE '\\'")).map((r) => r.table_name));

// ── reconcile ────────────────────────────────────────────────────────────────
const problems = [];
const documentedViews = new Set(VIEWS.map((v) => v.name));

for (const name of engineViews)
  if (!documentedViews.has(name) && !(name in HIDDEN_VIEWS))
    problems.push(`view ${name} exists in the engine but is NOT in catalog.ts VIEWS (document it, or add it to HIDDEN_VIEWS with a reason)`);

for (const v of VIEWS) {
  if (!engineViews.has(v.name)) { problems.push(`catalog view ${v.name} does not exist in the engine (renamed/removed?)`); continue; }
  const cols = new Set(await actualCols(v.name));
  const documented = new Set(v.columns.map((c) => c.name));
  const hidden = new Set(Object.keys(HIDDEN_COLUMNS[v.name] ?? {}));

  for (const c of cols)
    if (!documented.has(c) && !hidden.has(c))
      problems.push(`${v.name}.${c} — column is queryable but UNDOCUMENTED (add it to catalog.ts, or to HIDDEN_COLUMNS with a reason). This is the disability_type class of bug.`);

  for (const c of documented) if (!cols.has(c)) problems.push(`${v.name}.${c} — catalog documents a column the view does NOT expose (typo or stale after a view change)`);
  for (const c of hidden) if (!cols.has(c)) problems.push(`${v.name}.${c} — listed in HIDDEN_COLUMNS but the view no longer has it (remove the stale entry)`);
}

db.close();

// ── report ───────────────────────────────────────────────────────────────────
const checked = VIEWS.length;
if (problems.length) {
  console.error(`\n❌ catalog check FAILED — ${problems.length} issue(s) across ${checked} views:\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error('\nEvery column a user can be answered from must be described to the AI, or the AI will deny it exists.\n');
  process.exit(1);
}
console.log(`\n✅ catalog check passed — all columns across ${checked} views are documented or explicitly hidden.\n`);
