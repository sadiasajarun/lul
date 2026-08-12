// RISK VALIDATION GUARD — deterministic, no LLM, no API key. Run: npm run check:risk
//
// Sanity-checks the rule-based v_dropout_risk score against real outcomes: students who ACTUALLY
// dropped out (clean label: is_true_dropout) should score higher than students who were successfully
// mainstreamed (is_mainstreamed). This is a statistical separation check — NOT machine learning — and
// it keeps weight tuning honest: if a future weight change makes dropouts stop separating from
// successes, this fails. Uses the REAL dataset (public/data).
import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'public', 'data');
const SEMANTIC = path.join(HERE, '..', 'src', 'app', 'lib', 'db', 'semantic.sql');

const db = new duckdb.Database(':memory:');
const run = (sql) => new Promise((res, rej) => db.all(sql, (e, r) => (e ? rej(e) : res(r))));
const q = (p) => p.replace(/\\/g, '/');

for (const t of ['students', 'attendance', 'assessments', 'teachers', 'centers'])
  await run(`CREATE TABLE ${t} AS SELECT * FROM read_csv_auto('${q(path.join(DATA, t + '.csv'))}', header=true, sample_size=-1)`);
await run('CREATE TABLE attendance_monthly (month_num INTEGER, month VARCHAR, division VARCHAR, programme VARCHAR, n_students INTEGER, sum_attendance DOUBLE)');
for (const s of fs.readFileSync(SEMANTIC, 'utf8').split(';').filter((x) => x.replace(/--[^\n]*/g, '').trim().length)) await run(s);

const rows = await run(`
  SELECT CASE WHEN is_true_dropout THEN 'true_dropout' WHEN is_mainstreamed THEN 'mainstreamed' ELSE 'active/other' END AS grp,
         count(*) AS n, round(avg(risk_score), 1) AS avg_risk,
         round(avg(r_income), 1) AS r_income, round(avg(r_attendance), 1) AS r_attendance,
         round(avg(r_assessment), 1) AS r_assessment, round(avg(r_vulnerability), 1) AS r_vulnerability
  FROM v_dropout_risk GROUP BY 1`);
const by = Object.fromEntries(rows.map((r) => [r.grp, r]));
const num = (x) => Number(x);

console.log('\nDropout-risk validation (real data) — avg risk_score by outcome:');
for (const g of ['true_dropout', 'active/other', 'mainstreamed'])
  if (by[g]) console.log(`  ${g.padEnd(14)} n=${String(num(by[g].n)).padStart(7)}  avg risk=${num(by[g].avg_risk)}`);

// ── TUNING REPORT (Phase 5 · re-tuning aid) ─────────────────────────────────────
// For each factor, how far apart are true dropouts and mainstreamed successes? A factor that barely
// separates (or points the wrong way) is a candidate to DOWN-weight; a strong separator to UP-weight.
// Run this whenever new outcome data lands, then adjust the weights in v_dropout_risk accordingly.
const d = by['true_dropout'], m = by['mainstreamed'];
if (d && m) {
  console.log('\nFactor separation (true_dropout − mainstreamed) — tune weights toward the strong separators:');
  for (const f of ['r_income', 'r_attendance', 'r_assessment', 'r_vulnerability']) {
    const gap = num(d[f]) - num(m[f]);
    const flag = gap >= 2 ? '↑ strong' : gap <= 0 ? '⚠ weak/against — review' : '· mild';
    console.log(`  ${f.padEnd(16)} dropout=${String(num(d[f])).padStart(4)}  mainstreamed=${String(num(m[f])).padStart(4)}  gap=${gap.toFixed(1).padStart(5)}  ${flag}`);
  }
}

const margin = 3; // dropouts must beat mainstreamed successes by at least this
const dr = num(d?.avg_risk), mr = num(m?.avg_risk);
const pass = d && m && dr - mr >= margin;
console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — true dropouts (${dr}) vs mainstreamed successes (${mr}); need a margin ≥ ${margin}, got ${(dr - mr).toFixed(1)}.\n`);
db.close();
process.exit(pass ? 0 : 1);
