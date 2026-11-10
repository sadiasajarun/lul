// Runs the five follow-up scenarios through the real pipeline with the model stubbed, and checks
// that every turn really builds on the turn before it. Costs nothing.
//
//   npm run audit:scenarios -- real      (or v2, tuned)
import { openPipeline, REFUSE } from './harness.mjs';
import { QUESTIONS, SCENARIOS } from './bank/questions.mjs';

const mode = process.argv[2];
if (!['real', 'v2', 'tuned'].includes(mode)) throw new Error('usage: scenarios.mjs <real|v2|tuned>');

// What a model would plausibly write for each scenario's opening question.
const MARKS = 'SELECT center_id, avg(mark) AS am FROM v_marks GROUP BY center_id';
const OPENING_SQL = {
  'Show me the top 10 best-performing centers.': `SELECT center_id, center_name, division, me_score, students FROM v_center_enrollment WHERE me_score IS NOT NULL ORDER BY me_score DESC, students DESC LIMIT 10`,
  'Show me the bottom 10 centers.': `SELECT center_id, center_name, division, me_score, students FROM v_center_enrollment WHERE me_score IS NOT NULL ORDER BY me_score ASC, students DESC LIMIT 10`,
  'Find centers with above-average attendance but below-average results.': `WITH m AS (${MARKS}) SELECT e.center_id, e.center_name, e.avg_attendance_recorded, round(m.am, 1) AS avg_mark FROM v_center_enrollment e JOIN m USING (center_id) WHERE e.avg_attendance_recorded > (SELECT avg(avg_attendance_recorded) FROM v_center_enrollment) AND m.am < (SELECT avg(am) FROM m) ORDER BY avg_mark LIMIT 100`,
  'Show the districts with the highest dropout rates.': `SELECT district, count(*) AS students, round(100.0 * count(*) FILTER (WHERE is_dropout AND mainstream_status <> 'Mainstreamed') / count(*), 1) AS dropout_rate_pct FROM v_students WHERE district IS NOT NULL GROUP BY district ORDER BY dropout_rate_pct DESC`,
  'Find centers with high results, high attendance, low dropout, and strong mainstream transition.': `WITH m AS (${MARKS}) SELECT e.center_id, e.center_name, e.avg_attendance_recorded, round(m.am, 1) AS avg_mark FROM v_center_enrollment e JOIN m USING (center_id) WHERE e.avg_attendance_recorded IS NOT NULL ORDER BY avg_mark DESC, e.center_id LIMIT 30`,
};

const pipe = await openPipeline(mode);
const { foldContext } = await pipe.load('/src/app/lib/ai/context/fold.ts');
const { chainFollowups } = await pipe.load('/src/app/lib/ai/context/next.ts');
const { resolveTurn } = await pipe.load('/src/app/lib/ai/context/resolve.ts');

pipe.setReply((body) => {
  const user = body.messages.at(-1).content;
  if (!/Step \d+ of \d+/.test(user)) return '{}';
  if (/EVIDENCE GATHERED SO FAR:\n\(no queries run yet\)/.test(user)) {
    const q = user.match(/QUESTION: (.*)/)?.[1];
    if (!OPENING_SQL[q]) return REFUSE;
    return JSON.stringify({ action: 'run_sql', intent: 'list', sql: OPENING_SQL[q], title: q });
  }
  return JSON.stringify({ action: 'finish', answer_evidence: ['e1'], primary_evidence: 'e1' });
});

let failures = 0;
const fail = (m) => { failures++; console.log(`      FAIL ${m}`); };

// The same chains in other words: following along must not depend on the exact phrasing.
const PARAPHRASED = [
  ['Paraphrased: best center', [
    'Show me the top 10 best-performing centers.',
    'Of those, which 3 have the lowest dropout?',
    'Pick the 2nd one',
    'Do a full postmortem of this centre',
    'Now look at teachers and attendance',
    'Compare this centre with the worst centre in the same district',
    'What are the 3 largest gaps?',
    'Which of these gaps are controllable?',
    'What practices could we replicate?',
  ]],
  ['Paraphrased: poor center', [
    'Show me the bottom 10 centers.',
    'Choose the worst one',
    'Why is this centre underperforming?',
    'Look at attendance',
    'And check the marks',
    'What about its teachers?',
    'Recommend 3 interventions',
    'Create a 90-day improvement plan for this center.',
  ]],
  ['Paraphrased: dropout', [
    'Show the districts with the highest dropout rates.',
    'Go with the worst district',
    'Show the five centers contributing most to dropout.',
    'Pick the first one',
    'Check dropout by gender',
    'Now analyse it by income',
    'What is the strongest associated factor?',
  ]],
];

for (const [name, turns] of [...SCENARIOS, ...PARAPHRASED]) {
  console.log(`\n== ${name}`);
  const messages = [];
  for (const [i, text] of turns.entries()) {
    const before = foldContext(messages, mode);
    const callsBefore = pipe.calls.length;
    const history = messages
      .filter((m) => m.role === 'user' || m.response !== undefined || m.refused)
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text, sql: m.sources?.[0] ?? null, columns: m.evidence?.columns, rows: m.evidence?.rows, rowCount: m.evidence?.rowCount }));
    let res;
    try {
      res = await pipe.ask(text, history, before);
    } catch (e) {
      fail(`turn ${i + 1} threw: ${e.message}`);
      break;
    }
    messages.push({ role: 'user', text });
    messages.push({ role: 'ai', text: res.response.summary, response: res.refused ? null : res.response, refused: res.refused, sources: res.sql ? [res.sql] : undefined, evidence: res.evidence, turn: res.turn });

    const widgets = res.response.widgets.length;
    const after = foldContext(messages, mode);
    const bound = !!res.turn?.bound;
    const aiCalls = pipe.calls.length - callsBefore;
    console.log(`  ${String(i + 1).padStart(2)}. ${bound ? 'bound' : 'open '} w=${widgets} ai=${aiCalls} | ${text}`);
    console.log(`      ${res.response.summary.split('\n')[0].slice(0, 120)}`);

    if (res.refused) fail('refused');
    if (/top 10 best-performing|bottom 10 centers/i.test(text) && !/Performance score \(0-100\)/.test(res.response.summary)) fail('not ranked by the combined performance score');
    if (/top 10 best-performing|bottom 10 centers/i.test(text) && res.response.widgets[0]?.data?.some((r) => r.students < 30)) fail('a center with fewer than 30 students was ranked');
    if (i > 0 && !bound) fail('was not answered in context');
    if (!widgets && !/not recorded|only center|no comparable|None of those|No records|no recorded/i.test(res.response.summary)) fail('no widgets and no honest explanation');
    if (res.turn?.cohort && before.cohort && /among|top five/i.test(text)) {
      const prior = new Set(before.cohort.ids);
      if (!res.turn.cohort.ids.every((id) => prior.has(id))) fail('cohort escaped the previous list');
    }
    if (/^select/i.test(text) && !after.selected) fail('nothing was selected');
    const ordinal = text.toLowerCase().match(/\b(first|second|third|fourth|fifth|\d+)(?:st|nd|rd|th)?\b(?= (?:one|center|centre|district|row))/);
    if (ordinal && before.list?.items.length) {
      const n = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 }[ordinal[1]] ?? Number(ordinal[1]);
      const expected = before.list.items[n - 1]?.id;
      if (after.selected?.id !== expected) fail(`picked ${after.selected?.id}, expected row ${n} (${expected})`);
    }
    if (/same (district|upazila)/i.test(text) && !after.comparison && !/only center|not recorded|no comparable/i.test(res.response.summary)) fail('no comparison pair recorded');
    if (after.comparison && after.comparison.a.id === after.comparison.b.id) fail('compared a center with itself');
    if (mode !== 'tuned' && /estimated/i.test(res.response.summary)) fail('Preview label in a real dataset');
    if (mode === 'tuned' && bound && !/estimated/i.test(res.response.summary)) fail('missing Preview label');
    // Every suggested next question must continue this same chain when clicked.
    if (bound && res.turn) {
      const suggestions = chainFollowups(res.turn, after);
      if (!suggestions.length) fail('no suggested next questions');
      for (const s of suggestions) {
        const r = resolveTurn(s, after);
        if (!r || r.type === 'clarify' || r.type === 'refine_open') fail(`suggestion does not continue the chain: "${s}"`);
      }
    }
    if (/lowest dropout/i.test(text) && res.turn?.list) {
      const students = res.response.widgets[0]?.data?.map((r) => r.students) ?? [];
      if (students.some((n, k) => k && n > students[k - 1] && res.turn.list.items[k].value === res.turn.list.items[k - 1].value)) fail('ties not ordered by most students');
    }
  }
}

// Every "this center" question from the bank, each asked straight after selecting a center.
console.log('\n== Center follow-up questions');
{
  const base = [];
  for (const text of ['Show me the bottom 10 centers.', 'Select the first center.']) {
    const res = await pipe.ask(text, [], foldContext(base, mode));
    base.push({ role: 'ai', turn: res.turn });
  }
  let bound = 0;
  const contextual = QUESTIONS.filter((item) => item.ctx);
  for (const item of contextual) {
    const res = await pipe.ask(item.text, [], foldContext(base, mode));
    const honest = /not recorded|Not recorded|No records|no recorded|only center|no comparable|not behind/i.test(res.response.summary);
    if (!res.turn?.bound) fail(`not answered in context: ${item.text}`);
    else if (res.refused || (!res.response.widgets.length && !honest)) fail(`no answer: ${item.text}`);
    else bound++;
  }
  console.log(`  ${bound} of ${contextual.length} answered in context`);
}

// A reference to "this center" with nothing chosen must ask, not let the model guess.
console.log('\n== Center reference with nothing chosen');
{
  const studentsOnly = { mode, live: false, stale: false, list: { kind: 'student', items: [{ id: 's1' }, { id: 's2' }], total: 2 } };
  const centers = { mode, live: false, stale: false, list: { kind: 'center', items: [{ id: 'c1', label: 'C1' }, { id: 'c2', label: 'C2' }], total: 2 } };
  const CASES = [
    ['Compare it with the worst-performing center in the same district.', studentsOnly, {}, 'clarify'],
    ['What is the dropout rate of this center?', studentsOnly, {}, 'clarify'],
    ['Compare it with the worst-performing center in the same district.', centers, {}, 'clarify-options'],
    ['Why is this center underperforming?', studentsOnly, { priorSingleCenter: true }, 'none'],
  ];
  for (const [q, ctx, opts, want] of CASES) {
    const r = resolveTurn(q, ctx, opts);
    const got = !r ? 'none' : r.type === 'clarify' ? (r.options?.length ? 'clarify-options' : 'clarify') : r.type;
    console.log(`  ${got === want ? 'ok   ' : 'WRONG'} ${q} -> ${got}`);
    if (got !== want) fail(`"${q}" gave ${got}, expected ${want}`);
  }
}

// These must NOT be treated as references to an earlier answer.
const NEGATIVE = [
  'Which is the second largest division?', 'Show the top 10 teachers based on student performance.', 'How many students have dropped out?',
  'Show student count by district.', 'What does vulnerability score mean?', 'Which centres need a visit?',
  'Sort by attendance instead.', 'Break that down by district.', 'Add family income as a factor.', 'Only girls.', 'Show more.', 'Only Chattogram.',
  'Which division performs best?', 'How is this center\'s score calculated?',
];
const live = {
  mode, live: true, stale: false,
  list: { kind: 'center', items: [{ id: '1', label: 'A', value: 1 }, { id: '2', label: 'B', value: 2 }], total: 2 },
  cohort: { kind: 'center', ids: ['1', '2'], total: 2 },
  selected: { kind: 'center', id: '1', label: 'A', district: 'D' },
};
// Every way of picking a row must land on exactly that row.
console.log('\n== Picking rows');
{
  const five = { ...live, list: { kind: 'center', total: 5, metric: { column: 'dropout_rate_pct', label: 'Dropout', betterWhen: 'lower' }, items: [3, 1, 5, 0, 4].map((v, i) => ({ id: `c${i + 1}`, label: `C${i + 1}`, value: v })) } };
  const PICKS = [
    ['Select the first center.', 'c1'], ['Select the second center.', 'c2'], ['Select the third center.', 'c3'], ['Select the fourth center.', 'c4'],
    ['Select the fifth center.', 'c5'], ['Pick the 2nd one', 'c2'], ['Select the 3rd center', 'c3'], ['Choose number 4', 'c4'], ['Take the 1st one', 'c1'],
    ['Select the last center.', 'c5'], ['Select the worst one.', 'c3'], ['Select the best one.', 'c4'], ['The second one', 'c2'],
  ];
  for (const [q, want] of PICKS) {
    const r = resolveTurn(q, five);
    const got = r?.type === 'select' ? r.entity.id : r?.type ?? 'none';
    console.log(`  ${got === want ? 'ok   ' : 'WRONG'} ${q} -> ${got}`);
    if (got !== want) fail(`"${q}" picked ${got}, expected ${want}`);
  }
}

console.log('\n== Must stand alone');
for (const q of NEGATIVE) {
  const r = resolveTurn(q, live);
  console.log(`  ${r ? 'BOUND' : 'ok   '} ${q}`);
  if (r) fail(`"${q}" was treated as a follow-up (${r.type})`);
}

if (mode !== 'tuned' && pipe.source.sideFetches.length) fail(`side tables fetched in ${mode}`);
console.log(`\n${mode}: ${failures ? `${failures} failure(s)` : 'all scenario checks passed'}.`);
await pipe.close();
process.exit(failures ? 1 : 0);
