// Sorts the question bank into work buckets without calling any AI model.
//
//   A  needs an earlier answer             -> conversation context
//   B  needs data the dataset does not have -> Preview side table, or an honest "not available"
//   C  provably misrouted by today's code  -> trained answer for that question only
//   D  data exists and routing is fine     -> left untouched
//
//   npm run audit:triage
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUESTIONS, SCENARIOS, DOMAINS } from './bank/questions.mjs';
import { routeQuestion } from '../../src/app/lib/ai/router.ts';
import { modeGuard } from '../../src/app/lib/ai/mode-guards.ts';
import { needsClarification } from '../../src/app/lib/ai/followup.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODES = ['real', 'v2', 'tuned'];

function bucketFor(item, mode) {
  if (item.ctx) return { bucket: 'A', why: 'depends on an earlier answer' };
  if (item.fixed) return { bucket: 'C', why: 'fixed answer requested by the user' };
  const missing = item.needs.filter((d) => DOMAINS[d][mode] !== 1);
  if (missing.length) return { bucket: 'B', why: missing.map((d) => DOMAINS[d].label).join(', ') };
  const guard = modeGuard(item.text, mode);
  if (guard) return { bucket: 'C', why: 'blocked by the forecast guard' };
  const route = routeQuestion(item.text);
  if (route.kind !== 'data') return { bucket: 'C', why: `routed to ${route.kind}: ${route.reason}` };
  const clarify = needsClarification(item.text, []);
  if (clarify) return { bucket: 'C', why: 'asks for clarification with no earlier answer' };
  return { bucket: 'D', why: 'data exists and routing is fine' };
}

const rows = QUESTIONS.map((item) => ({
  section: item.section,
  text: item.text,
  ...Object.fromEntries(MODES.map((m) => [m, bucketFor(item, m)])),
}));

const count = (mode, bucket) => rows.filter((r) => r[mode].bucket === bucket).length;
const scenarioTurns = SCENARIOS.reduce((n, [, turns]) => n + turns.length, 0);

console.log(`Questions: ${rows.length}   Scenario turns: ${scenarioTurns}\n`);
console.log('Bucket      Real  Real26  Preview');
for (const b of ['A', 'B', 'C', 'D']) {
  console.log(`${b.padEnd(10)}${String(count('real', b)).padStart(5)}${String(count('v2', b)).padStart(8)}${String(count('tuned', b)).padStart(9)}`);
}
console.log('\nBucket C (provably misrouted):');
for (const r of rows) {
  const hits = MODES.filter((m) => r[m].bucket === 'C');
  if (hits.length) console.log(`  [${hits.join(',')}] ${r.text}\n      ${r[hits[0]].why}`);
}

const outDir = path.join(HERE, 'baseline');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'triage.json'), JSON.stringify(rows, null, 2) + '\n');
console.log(`\nWrote ${path.relative(process.cwd(), path.join(outDir, 'triage.json'))}`);
