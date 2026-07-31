// Layer 2 — AUTO-PROBE for FALSE REFUSALS. Run: npm run probe:refusals
//
// Layer 1 (check:catalog) proves every column is DOCUMENTED. This proves the AI can actually ANSWER
// a question about each documented dimension — i.e. it no longer wrongly refuses ("religion is not
// tracked") when the data is right there. It derives one probe per categorical dimension straight
// from the catalog's ALLOWED_VALUES, so any dimension you add later is auto-covered here too.
//
// For each probe it runs the REAL pipeline (Gemini writes the SQL) and asserts: NOT refused, a SELECT
// came back, and it EXECUTES with ≥1 row on the same DuckDB engine the browser uses. It does NOT
// check the number is correct — that is eval.mjs's job. Here we only guard "can it answer at all".
import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODE = process.env.PROBE_MODE === 'tuned' ? 'tuned' : 'real';
const DATA = path.join(HERE, '..', 'public', MODE === 'tuned' ? 'data-tuned' : 'data');
const SEMANTIC = path.join(HERE, '..', 'src', 'app', 'lib', 'db', 'semantic.sql');

const { askQuestion } = await import('../src/app/lib/ai/pipeline.ts');
const { geminiGenerate } = await import('../src/app/lib/ai/gemini.ts');
const { openaiGenerate } = await import('../src/app/lib/ai/openai.ts');
const { ALLOWED_VALUES } = await import('../src/app/lib/db/catalog.ts');

// ── provider + key/model from .env (no dotenv dep), honouring VITE_AI_PROVIDER ─
const env = Object.fromEntries(
  fs.readFileSync(path.join(HERE, '..', '.env'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }),
);
const PROVIDER = (env.VITE_AI_PROVIDER || 'gemini').toLowerCase();
const OPENAI = PROVIDER === 'openai';
const API_KEY = OPENAI ? env.VITE_OPENAI_API_KEY : env.VITE_GEMINI_API_KEY;
const MODEL = OPENAI ? (env.VITE_OPENAI_MODEL || 'gpt-4o-mini') : (env.VITE_GEMINI_MODEL || 'gemini-2.5-flash');
if (!API_KEY) { console.error(`${OPENAI ? 'VITE_OPENAI_API_KEY' : 'VITE_GEMINI_API_KEY'} missing in .env`); process.exit(1); }

// ── engine: base tables + semantic views, identical to the browser/eval ───────
const db = new duckdb.Database(':memory:');
const run = (sql) => new Promise((res, rej) => db.all(sql, (e, r) => (e ? rej(e) : res(r))));
const clean = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
for (const t of ['students', 'attendance', 'assessments', 'teachers', 'centers'])
  await run(`CREATE TABLE ${t} AS SELECT * FROM read_csv_auto('${path.join(DATA, t + '.csv').replace(/\\/g, '/')}', header=true, sample_size=-1)`);
const mPath = path.join(DATA, 'attendance_monthly.csv');
if (fs.existsSync(mPath)) await run(`CREATE TABLE attendance_monthly AS SELECT * FROM read_csv_auto('${mPath.replace(/\\/g, '/')}', header=true, sample_size=-1)`);
else await run('CREATE TABLE attendance_monthly (month_num INTEGER, month VARCHAR, division VARCHAR, programme VARCHAR, n_students INTEGER, sum_attendance DOUBLE)');
for (const s of fs.readFileSync(SEMANTIC, 'utf8').split(';').filter((x) => x.replace(/--[^\n]*/g, '').trim().length)) await run(s);
const dataSource = {
  kind: 'duckdb-wasm', init: async () => {},
  query: async (sql) => { const rows = clean(await run(sql)); return { columns: rows.length ? Object.keys(rows[0]) : [], rows, rowCount: rows.length }; },
};

// ── Gemini generate with backoff on 429/503 (free-tier friendly), same as eval ─
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const callModel = OPENAI
  ? (system, user) => openaiGenerate(system, user, { apiKey: API_KEY, model: MODEL })
  : (system, user) => geminiGenerate(system, user, { apiKey: API_KEY, model: MODEL });
const generate = async (system, user) => {
  for (let i = 0; i < 4; i++) {
    try { return await callModel(system, user); }
    catch (e) { if (/\b(429|503)\b/.test(e.message) && i < 3) { await sleep(6000 * (i + 1)); continue; } throw e; }
  }
};

// ── probe questions, auto-derived from the catalog's categorical dimensions ────
// Natural phrasing per dimension; any dimension without an entry falls back to a generic breakdown,
// so a newly-added ALLOWED_VALUES key is still probed (just less prettily) until phrasing is added.
const PHRASING = {
  programme: 'Break down students by programme',
  division: 'How many students are in each division?',
  gender_label: 'What is the gender split of students?',
  religion: 'Break down students by religion',
  admitted_grade: 'How many students are there by admitted grade?',
  dropout_reason: 'What are the dropout reasons and their counts?',
  income_band: 'Break down students by income band',
  subject: 'Show the average mark by subject',
  phase: 'Show average marks by assessment phase',
  employment_status: 'How many teachers are there by employment status?',
};
// Documented dimensions that aren't enum-listed in ALLOWED_VALUES but must still be answerable:
const EXTRA = {
  disability_type: 'How many students have a disability, broken down by type?',
  ethnicity: 'How many students are there by ethnicity?',
  nutrition: 'Break down students by nutrition status',
  mainstream_status: 'How many students are mainstreamed versus not?',
};
const PROBES = [
  ...Object.keys(ALLOWED_VALUES).map((dim) => ({ dim, q: PHRASING[dim] || `Break down students by ${dim}` })),
  ...Object.entries(EXTRA).map(([dim, q]) => ({ dim, q })),
];

console.log(`\nProbe (false-refusal) — provider=${PROVIDER}, mode=${MODE}, model=${MODEL}, ${PROBES.length} dimensions\n${'─'.repeat(74)}`);
let pass = 0;
const fails = [];
for (const p of PROBES) {
  let ok = false, detail = '';
  try {
    const res = await askQuestion(p.q, { dataSource, generate });
    if (res.refused || !res.sql) {
      detail = `REFUSED: ${res.response.summary.slice(0, 64)}`;
      fails.push({ ...p, detail });
    } else {
      const rows = (await dataSource.query(res.sql)).rows;
      ok = rows.length >= 1;
      detail = ok ? `intent=${res.intent}, ${rows.length} rows` : 'answered but returned 0 rows';
      if (!ok) fails.push({ ...p, detail, sql: res.sql });
    }
  } catch (e) { detail = `ERROR: ${e.message.slice(0, 70)}`; fails.push({ ...p, detail }); }
  if (ok) pass++;
  console.log(`${ok ? '✅' : '❌'} [${p.dim}] ${p.q}\n     ${detail}`);
  await sleep(3500); // free-tier pacing
}

console.log(`${'─'.repeat(74)}\nAnswerable: ${pass}/${PROBES.length} (${Math.round((100 * pass) / PROBES.length)}%)`);
if (fails.length) {
  console.log('\nFalse refusals / failures — each is a real gap to fix (catalog column, synonym, or view):');
  for (const f of fails) console.log(`\n• [${f.dim}] ${f.q}\n  ${f.detail}${f.sql ? `\n  SQL: ${f.sql.replace(/\s+/g, ' ').trim().slice(0, 160)}` : ''}`);
}
db.close();
process.exit(fails.length ? 1 : 0);
