// EVAL HARNESS — runs each reported question through the REAL pipeline (Gemini writes the SQL live),
// executes that SQL on the same DuckDB engine the browser uses, and checks the result against
// known-correct values. Prints per-question pass/fail + an accuracy score. Run: npm run eval
import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'public', 'data');
const SEMANTIC = path.join(HERE, '..', 'src', 'app', 'lib', 'db', 'semantic.sql');

const { askQuestion } = await import('../src/app/lib/ai/pipeline.ts');
const { geminiGenerate } = await import('../src/app/lib/ai/gemini.ts');

// ── read key/model from .env (no dotenv dep) ─────────────────────────────────
const env = Object.fromEntries(
  fs.readFileSync(path.join(HERE, '..', '.env'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }),
);
const API_KEY = env.VITE_GEMINI_API_KEY;
const MODEL = env.VITE_GEMINI_MODEL || 'gemini-2.5-flash';
if (!API_KEY) { console.error('VITE_GEMINI_API_KEY missing in .env'); process.exit(1); }

// ── engine (tables + semantic views), same as the browser ────────────────────
const db = new duckdb.Database(':memory:');
const run = (sql) => new Promise((res, rej) => db.all(sql, (e, r) => (e ? rej(e) : res(r))));
const clean = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
for (const t of ['students', 'attendance', 'assessments', 'teachers', 'centers'])
  await run(`CREATE TABLE ${t} AS SELECT * FROM read_csv_auto('${path.join(DATA, t + '.csv').replace(/\\/g, '/')}', header=true, sample_size=-1)`);
const MONTHLY = path.join(DATA, 'attendance_monthly.csv').replace(/\\/g, '/');
if (fs.existsSync(MONTHLY)) await run(`CREATE TABLE attendance_monthly AS SELECT * FROM read_csv_auto('${MONTHLY}', header=true, sample_size=-1)`);
else await run(`CREATE TABLE attendance_monthly (month_num INTEGER, month VARCHAR, division VARCHAR, programme VARCHAR, n_students INTEGER, sum_attendance DOUBLE)`);
for (const s of fs.readFileSync(SEMANTIC, 'utf8').split(';').filter((x) => x.replace(/--[^\n]*/g, '').trim().length)) await run(s);
const dataSource = {
  kind: 'duckdb-wasm', init: async () => {},
  query: async (sql) => { const rows = clean(await run(sql)); return { columns: rows.length ? Object.keys(rows[0]) : [], rows, rowCount: rows.length }; },
};

// ── Gemini generate with backoff on 429/503 (free-tier friendly) ─────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const generate = async (system, user) => {
  for (let i = 0; i < 4; i++) {
    try { return await geminiGenerate(system, user, { apiKey: API_KEY, model: MODEL }); }
    catch (e) { if (/\b(429|503)\b/.test(e.message) && i < 3) { await sleep(6000 * (i + 1)); continue; } throw e; }
  }
};

// ── helpers for tolerant checks ──────────────────────────────────────────────
const near = (got, want, tol = 0.02) => got != null && Math.abs(got - want) <= Math.max(1, Math.abs(want) * tol);
const firstNum = (rows) => { for (const r of rows) for (const v of Object.values(r)) if (typeof v === 'number') return v; return null; };
const colVals = (rows, re) => { const k = rows[0] && Object.keys(rows[0]).find((c) => re.test(c)); return k ? rows.map((r) => r[k]) : []; };

// ── cases: the reported questions + known-correct expectations ───────────────
const CASES = [
  { q: 'How many students were mainstreamed?', want: '207,507',
    check: (rows) => near(firstNum(rows), 207507) },
  { q: 'What is the female student count?', want: '138,063',
    check: (rows) => near(firstNum(rows), 138063) },
  { q: 'What percent of students are girls?', want: '≈55.6%',
    check: (rows) => near(firstNum(rows), 55.6, 0.05) },
  { q: 'What is the active student count?', want: '20,500',
    check: (rows) => near(firstNum(rows), 20500, 0.05) },
  { q: 'Give me the ABAL students who got poor results in Bangla', want: 'a LIST of students',
    check: (rows, res) => res.intent === 'list' && rows.length > 1 && Object.keys(rows[0]).some((c) => /student/i.test(c)) },
  { q: "What's the student-to-teacher ratio by division?", want: 'Dhaka ≈167',
    check: (rows) => { const r = rows.find((x) => String(Object.values(x)[0]).includes('Dhaka')); const v = colVals([r], /per|ratio/i)[0]; return v > 140 && v < 190; } },
  { q: 'Top 3 divisions by enrollment', want: 'divisions, Dhaka top (108,134)',
    check: (rows) => rows.length <= 3 && /Dhaka/i.test(String(Object.values(rows[0])[0])) && rows.some((r) => Object.values(r).some((v) => near(v, 108134, 0.05))) },
  { q: 'Are there any centres with more than 30 students?', want: 'centres each >30',
    check: (rows) => rows.length > 1 && colVals(rows, /student/i).every((v) => v == null || v > 30) },
  { q: 'How many students enrolled this year vs last year?', want: '2024 & 2025 counts',
    check: (rows) => rows.length >= 1 && colVals(rows, /year/i).some((y) => [2024, 2025].includes(Number(y))) },
  { q: 'Show attendance for student 264814181329', want: 'that one student',
    check: (rows) => rows.length >= 1 && rows.some((r) => Object.values(r).some((v) => String(v).includes('264814181329'))) },
  { q: 'What is the average Bangla score in ABAL?', want: '≈25',
    check: (rows) => near(firstNum(rows), 25.1, 0.2) },
  { q: 'How many girls are in Catchup in Dhaka?', want: '45,682',
    check: (rows) => near(firstNum(rows), 45682, 0.03) },
];

console.log(`\nEval — model=${MODEL}, ${CASES.length} questions\n${'─'.repeat(70)}`);
let pass = 0;
const fails = [];
for (const c of CASES) {
  let ok = false, detail = '';
  try {
    const res = await askQuestion(c.q, { dataSource, generate });
    if (res.refused || !res.sql) { detail = `refused: ${res.response.summary.slice(0, 60)}`; }
    else {
      const rows = (await dataSource.query(res.sql)).rows;
      ok = !!c.check(rows, res);
      detail = `intent=${res.intent} got=${JSON.stringify(rows[0] ?? {}).slice(0, 56)}`;
      if (!ok) fails.push({ q: c.q, want: c.want, sql: res.sql, detail });
    }
  } catch (e) { detail = `ERROR: ${e.message.slice(0, 70)}`; fails.push({ q: c.q, want: c.want, sql: '(threw)', detail }); }
  if (ok) pass++;
  console.log(`${ok ? '✅' : '❌'} ${c.q}\n    want ${c.want} | ${detail}`);
  await sleep(3500); // free-tier pacing
}

console.log(`${'─'.repeat(70)}\nAccuracy: ${pass}/${CASES.length} (${Math.round((100 * pass) / CASES.length)}%)`);
if (fails.length) {
  console.log('\nFailures (inspect the SQL the model wrote):');
  for (const f of fails) console.log(`\n• ${f.q}\n  want: ${f.want}\n  ${f.detail}\n  SQL: ${f.sql.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
}
db.close();
