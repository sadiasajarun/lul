// Verifies Increment 4 with NO Gemini key: every golden SQL validates + executes, and the full
// orchestrator (validate → execute → interpret) runs against a stub LLM that returns the golden SQL.
import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'public', 'data');
const SEMANTIC = path.join(HERE, '..', 'src', 'app', 'lib', 'db', 'semantic.sql');

const { FEW_SHOTS } = await import('../src/app/lib/ai/fewshot.ts');
const { validateSql } = await import('../src/app/lib/ai/validate.ts');
const { askQuestion } = await import('../src/app/lib/ai/pipeline.ts');

const db = new duckdb.Database(':memory:');
const run = (sql) => new Promise((res, rej) => db.all(sql, (e, r) => (e ? rej(e) : res(r))));
const p = (f) => path.join(DATA, f).replace(/\\/g, '/');
for (const t of ['students', 'attendance', 'assessments', 'teachers', 'centers'])
  await run(`CREATE TABLE ${t} AS SELECT * FROM read_csv_auto('${p(t + '.csv')}', header=true, sample_size=-1)`);
for (const s of fs.readFileSync(SEMANTIC, 'utf8').split(';').filter((x) => x.replace(/--[^\n]*/g, '').trim().length)) await run(s);

// A DataSource backed by node-duckdb (same shape the browser DuckDbSource returns).
const dataSource = {
  kind: 'duckdb-wasm',
  init: async () => {},
  query: async (sql) => {
    const rows = (await run(sql)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
    return { columns: rows.length ? Object.keys(rows[0]) : [], rows, rowCount: rows.length };
  },
};

console.log('── 1) Validate + execute every golden SQL ──');
let ok = 0, bad = 0;
for (const fs2 of FEW_SHOTS) {
  const v = validateSql(fs2.sql);
  if (!v.ok) { console.log(`  ✗ VALIDATION: ${fs2.q} → ${v.error}`); bad++; continue; }
  try {
    const r = await dataSource.query(v.sql);
    console.log(`  ✓ ${fs2.q.slice(0, 52).padEnd(54)} ${String(r.rowCount).padStart(6)} rows | ${JSON.stringify(r.rows[0] ?? {}).slice(0, 60)}`);
    ok++;
  } catch (e) { console.log(`  ✗ EXEC: ${fs2.q} → ${e.message}`); bad++; }
}
console.log(`   ${ok} ok, ${bad} bad`);

console.log('\n── 2) Full orchestrator via a STUB LLM (returns the golden plan) ──');
const cases = [
  ['Give me the ABAL students who got poor results in Bangla', 'list', FEW_SHOTS.find((f) => f.q.includes('poor results')).sql],
  ["What's the student-to-teacher ratio by division?", 'ratio', FEW_SHOTS.find((f) => f.q.includes('ratio by division')).sql],
  ['How many students were mainstreamed?', 'count', FEW_SHOTS.find((f) => f.q.includes('mainstreamed')).sql],
];
for (const [q, intent, sql] of cases) {
  const generate = async () => JSON.stringify({ intent, sql, title: q });
  const res = await askQuestion(q, { dataSource, generate });
  const w = res.response.widgets[0];
  console.log(`  ▶ ${q}`);
  console.log(`     intent=${res.intent} refused=${res.refused} widget=${w?.type} rows=${w?.data?.length ?? (w?.metricsList?.length ?? 0)}`);
  console.log(`     summary: ${res.response.summary.slice(0, 120)}`);
}

// 3) Refusal path + validator rejection.
console.log('\n── 3) Safety: refusal + rejected SQL ──');
const refuse = await askQuestion('What is the average IQ of students?', { dataSource, generate: async () => JSON.stringify({ intent: 'unsupported', sql: null, title: 'No IQ data is collected.' }) });
console.log(`  refusal → refused=${refuse.refused}, msg="${refuse.response.summary}"`);
console.log(`  DROP blocked → ok=${validateSql('DROP TABLE students').ok} (expect false)`);
console.log(`  raw-table blocked → ok=${validateSql('SELECT * FROM students').ok} (expect false)`);

db.close();
console.log('\n✅ Pipeline verification complete.');
