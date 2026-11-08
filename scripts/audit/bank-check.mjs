// Runs every single-turn question through the real pipeline with the model stubbed, and checks each
// one lands where the triage says it should. Costs nothing.
//
//   npm run audit:bank -- real      (or v2, tuned)
import { openPipeline } from './harness.mjs';
import { QUESTIONS, DOMAINS } from './bank/questions.mjs';
import { routeQuestion } from '../../src/app/lib/ai/router.ts';

const mode = process.argv[2];
if (!['real', 'v2', 'tuned'].includes(mode)) throw new Error('usage: bank-check.mjs <real|v2|tuned>');

const pipe = await openPipeline(mode);
const { foldContext } = await pipe.load('/src/app/lib/ai/context/fold.ts');
const empty = foldContext([], mode);

let failures = 0;
const counts = { answered: 0, unavailable: 0, clarified: 0, untouched: 0 };
const fail = (q, why) => { failures++; console.log(`FAIL ${why}\n     ${q}`); };

for (const item of QUESTIONS) {
  if (item.ctx) continue; // follow-ups are covered by the scenario checks
  const missing = item.needs.filter((d) => DOMAINS[d][mode] !== 1);
  const misrouted = routeQuestion(item.text).kind !== 'data';
  pipe.calls.length = 0;
  let res;
  try {
    res = await pipe.ask(item.text, [], empty);
  } catch (e) {
    fail(item.text, `threw: ${e.message.split('\n')[0].slice(0, 160)}`);
    continue;
  }
  const estimated = /estimated/i.test(res.response.summary);

  if (missing.length || misrouted) {
    if (!res.trained) { fail(item.text, `expected a trained answer, took the AI path (needs ${missing.join(', ') || 'routing fix'})`); continue; }
    if (res.clarifying) { counts.clarified++; continue; }
    if (mode !== 'tuned' && missing.length) {
      counts.unavailable++;
      if (res.response.widgets.length) fail(item.text, 'a "not available" answer showed data');
      if (!/does not record/.test(res.response.summary)) fail(item.text, 'missing the explanation');
      continue;
    }
    counts.answered++;
    if (!res.response.widgets.length) fail(item.text, `no rows returned: ${res.response.summary.split('\n')[0].slice(0, 90)}`);
    if (mode === 'tuned' && !estimated) fail(item.text, 'missing the Preview label');
    if (mode !== 'tuned' && estimated) fail(item.text, 'Preview label in a real dataset');
  } else {
    counts.untouched++;
    if (res.trained) fail(item.text, 'a question that works today was intercepted');
    if (!pipe.calls.length) fail(item.text, 'did not reach the AI path');
  }
}

if (mode !== 'tuned' && pipe.source.sideFetches.length) { failures++; console.log(`FAIL side tables fetched in ${mode}`); }
console.log(`${mode}: answered ${counts.answered}, not available ${counts.unavailable}, clarified ${counts.clarified}, untouched ${counts.untouched}, failures ${failures}.`);
await pipe.close();
process.exit(failures ? 1 : 0);
