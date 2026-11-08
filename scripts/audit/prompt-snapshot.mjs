// Proves questions left on the existing AI path send exactly the same prompts as before this work.
// One process per dataset, because each holds a full copy of the data in memory.
//
//   npm run audit:prompts -- real --write     record the baseline
//   npm run audit:prompts -- real             compare against it (exit 1 on any difference)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openPipeline } from './harness.mjs';
import { QUESTIONS, DOMAINS } from './bank/questions.mjs';
import { routeQuestion } from '../../src/app/lib/ai/router.ts';

const mode = process.argv[2];
if (!['real', 'v2', 'tuned'].includes(mode)) throw new Error('usage: prompt-snapshot.mjs <real|v2|tuned> [--write]');
const BASE = path.join(process.cwd(), 'scripts', 'audit', 'baseline', `prompts-${mode}.json`);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// The questions this work must not disturb: data exists and the routing is already right.
const untouched = QUESTIONS
  .filter((q) => !q.ctx && !q.needs.some((d) => DOMAINS[d][mode] !== 1) && routeQuestion(q.text).kind === 'data')
  .map((q) => q.text);

// Follow-ups that existing code already understands: they must keep their exact instructions.
const PRIOR = [
  { role: 'user', text: 'Show centers by attendance.' },
  { role: 'ai', text: 'Attendance by center.', sql: 'SELECT division, students FROM v_center_enrollment LIMIT 2', columns: ['division', 'students'], rows: [{ division: 'Dhaka', students: 10 }, { division: 'Mymensingh', students: 8 }], rowCount: 2 },
];
const FOLLOW_UPS = ['Only Chattogram.', 'Sort by attendance instead.', 'Show more.', 'Why is that one so high?', 'Break that down by district.', 'Add family income as a factor.'];

const pipe = await openPipeline(mode);
const result = {};

async function capture(key, question, history) {
  pipe.calls.length = 0;
  await pipe.ask(question, history);
  result[key] = pipe.calls.length ? sha(JSON.stringify(pipe.calls[0].messages)) : 'NO_MODEL_CALL';
}

for (const q of [...new Set(untouched)]) await capture(q, q, []);
for (const q of FOLLOW_UPS) await capture(`followup: ${q}`, q, PRIOR);
await pipe.close();

const missed = Object.entries(result).filter(([, v]) => v === 'NO_MODEL_CALL').map(([k]) => k);

if (process.argv.includes('--write')) {
  fs.writeFileSync(BASE, JSON.stringify(result, null, 2) + '\n');
  console.log(`${mode}: recorded ${Object.keys(result).length} prompts (${missed.length} with no model call).`);
} else {
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  const diff = Object.keys(base).filter((k) => base[k] !== result[k]);
  if (diff.length) {
    console.error(`${mode}: ${diff.length} prompt(s) changed:\n  ${diff.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`${mode}: all ${Object.keys(base).length} prompts identical.`);
}
process.exit(0);
