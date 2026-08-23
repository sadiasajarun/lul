// E2E — the AI copilot's essential backbone, run against BOTH datasets (real + tuned).
// It exercises the exact pipeline the browser uses AFTER the model writes SQL:
//     validateSql (safety gate) → execute on DuckDB (same dialect as duckdb-wasm) → toResponse (widgets).
// Plus the guardrail (bad SQL is blocked) and the cross-mode invariants (real values identical,
// gap-fills fuller in tuned). No LLM tokens are spent unless you pass --live (1 question/mode).
//
//   node scripts/e2e-copilot.mjs           # deterministic, free, both modes
//   node scripts/e2e-copilot.mjs --live    # + one real Gemini question per mode (uses .env key)
import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SEMANTIC = path.join(ROOT, 'src', 'app', 'lib', 'db', 'semantic.sql');
const LIVE = process.argv.includes('--live');

const { validateSql } = await import('../src/app/lib/ai/validate.ts');
const { toResponse } = await import('../src/app/lib/ai/interpret.ts');

// ── tiny assert harness ──────────────────────────────────────────────────────
let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log(`  ✅ ${label}`); } else { fail++; console.log(`  ❌ ${label}`); } };

// ── build one engine per data folder (fresh in-memory DB) ────────────────────
async function engineFor(folder) {
  const DATA = path.join(ROOT, 'public', folder);
  const db = new duckdb.Database(':memory:');
  const run = (sql) => new Promise((res, rej) => db.all(sql, (e, r) => (e ? rej(e) : res(r))));
  const p = (f) => path.join(DATA, f).replace(/\\/g, '/');
  for (const t of ['students', 'attendance', 'assessments', 'teachers', 'centers'])
    await run(`CREATE TABLE ${t} AS SELECT * FROM read_csv_auto('${p(t + '.csv')}', header=true, sample_size=-1)`);
  // Optional Preview-only monthly table (mirrors the browser loader): from file if present, else empty.
  const mp = p('attendance_monthly.csv');
  if (fs.existsSync(mp)) await run(`CREATE TABLE attendance_monthly AS SELECT * FROM read_csv_auto('${mp}', header=true, sample_size=-1)`);
  else await run(`CREATE TABLE attendance_monthly (month_num INTEGER, month VARCHAR, division VARCHAR, programme VARCHAR, n_students INTEGER, sum_attendance DOUBLE)`);
  for (const s of fs.readFileSync(SEMANTIC, 'utf8').replace(/--[^\n]*/g, '').split(';').filter((x) => x.trim().length)) await run(s);
  const clean = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
  const query = async (sql) => { const rows = clean(await run(sql)); return { columns: rows.length ? Object.keys(rows[0]) : [], rows, rowCount: rows.length }; };
  return { db, run, query };
}

// ── the essential flow: as if the model returned this plan, run it end to end ─
const CASES = [
  { intent: 'count',     title: 'Total students',            sql: `SELECT count(*) AS students FROM v_students` },
  { intent: 'aggregate', title: 'Students by division',      sql: `SELECT division, count(*) AS students FROM v_students GROUP BY division ORDER BY students DESC LIMIT 5` },
  { intent: 'trend',     title: 'Enrollment by year',        sql: `SELECT * FROM v_enrollment_by_year ORDER BY enrollment_year DESC LIMIT 5` },
  { intent: 'ratio',     title: 'Student-teacher ratio',     sql: `SELECT * FROM v_teacher_ratio_by_division ORDER BY students_per_teacher DESC LIMIT 5` },
  { intent: 'list',      title: 'ABAL weak in Bangla',       sql: `SELECT student_id, avg_mark FROM v_student_subject WHERE programme='ABAL' AND subject='Bangla' AND avg_mark IS NOT NULL ORDER BY avg_mark LIMIT 8` },
  { intent: 'aggregate', title: 'Average attendance',        sql: `SELECT round(avg(avg_attendance_all),1) AS avg_attendance FROM v_student_attendance` },
];

// Queries the safety gate MUST reject (these keep the tab safe no matter what the model emits):
const BAD = [
  { sql: `DROP TABLE students`,               why: 'blocks DDL/drop' },
  { sql: `SELECT * FROM students`,            why: 'blocks non-whitelisted base table' },
  { sql: `SELECT 1; DELETE FROM students`,    why: 'blocks multi-statement / DML' },
];

async function testMode(mode, folder) {
  console.log(`\n━━ ${mode.toUpperCase()} (public/${folder}/) ━━`);
  const eng = await engineFor(folder);

  ok(true, 'tables loaded + semantic views built without error'); // reaching here means both succeeded

  for (const c of CASES) {
    const v = validateSql(c.sql);
    if (!v.ok) { ok(false, `[${c.intent}] ${c.title} — validate: ${v.error}`); continue; }
    const r = await eng.query(v.sql);
    const resp = toResponse(c.title, c.intent, r);
    ok(r.rowCount > 0 && resp.widgets.length >= 1, `[${c.intent}] ${c.title} → ${r.rowCount} row(s), ${resp.widgets.length} widget(s)`);
  }
  for (const b of BAD) ok(validateSql(b.sql).ok === false, `guard rejects: ${b.why}`);

  // metrics we compare across modes
  const [{ students }] = (await eng.query(`SELECT count(*)::INT AS students FROM v_students`)).rows;
  const [{ poverty }]  = (await eng.query(`SELECT count(*)::INT AS poverty FROM students WHERE lower(dropout_reason) LIKE '%povert%'`)).rows;
  const [{ att }]      = (await eng.query(`SELECT round(avg(avg_attendance_all),1) AS att FROM v_student_attendance`)).rows;
  const [{ marks }]    = (await eng.query(`SELECT count(*)::INT AS marks FROM v_marks`)).rows;
  // Monthly attendance trend: the exact query the copilot emits (weighted, month-ordered).
  const trend = (await eng.query(`SELECT month, round(sum(sum_attendance)/sum(n_students),1) AS avg FROM v_attendance_monthly GROUP BY month, month_num ORDER BY month_num`)).rows;
  eng.db.close();
  return { students, poverty, att, marks, months: trend.length, trend };
}

console.log(`AI COPILOT E2E — validate → execute → interpret, on real + tuned${LIVE ? ' (+live LLM smoke)' : ''}`);
const real = await testMode('real', 'data');
const tuned = await testMode('tuned', 'data-tuned');

console.log(`\n━━ CROSS-MODE INVARIANTS ━━`);
ok(real.students === tuned.students, `student count identical (${real.students})`);
ok(real.poverty === tuned.poverty, `poverty dropouts identical — real value untouched (${real.poverty})`);
ok(tuned.att > real.att + 20, `attendance fuller in tuned (real ${real.att} → tuned ${tuned.att})`);
ok(tuned.marks > real.marks, `marks fuller in tuned (real ${real.marks.toLocaleString()} → tuned ${tuned.marks.toLocaleString()})`);
ok(tuned.months === 12 && tuned.trend.every((r) => r.avg > 50 && r.avg <= 100), `monthly attendance trend in Preview (12 months, sane %)`);
ok(real.months === 0, `monthly attendance honestly EMPTY in Real (no fabricated trend)`);

// ── optional: one real end-to-end question per mode (spends 2 LLM calls total) ─
if (LIVE) {
  console.log(`\n━━ LIVE SMOKE (Gemini writes the SQL) ━━`);
  const { askQuestion } = await import('../src/app/lib/ai/pipeline.ts');
  const { geminiGenerate } = await import('../src/app/lib/ai/gemini.ts');
  const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
  const generate = (s, u) => geminiGenerate(s, u, { apiKey: env.VITE_GEMINI_API_KEY, model: env.VITE_GEMINI_MODEL || 'gemini-2.5-flash' });
  for (const [mode, folder] of [['real', 'data'], ['tuned', 'data-tuned']]) {
    const eng = await engineFor(folder);
    try {
      const res = await askQuestion('How many students are there per division?', { dataSource: { kind: 'duckdb-wasm', init: async () => {}, query: eng.query }, generate });
      ok(!res.refused && !!res.sql && res.response.widgets.length >= 1, `${mode}: live question answered (${res.provider}, intent=${res.intent})`);
    } catch (e) { ok(false, `${mode}: live question threw — ${String(e.message).slice(0, 60)}`); }
    eng.db.close();
  }
}

console.log(`\n${'─'.repeat(60)}\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
