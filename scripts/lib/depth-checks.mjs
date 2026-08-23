// Answer-depth assertions — kept in their own file because they are dense in newline escapes,
// which do not survive being generated inline. Called from e2e-full.mjs.
//
// Guards the "answers became one line" regression: a retrieval answer must be several bullets plus
// a descriptive block, and nothing downstream may flatten it back into a paragraph.

export async function runDepthChecks({ check, section }) {
  section('ANSWER DEPTH (the one-line regression)');

  const { wantsInterpretation, wantsAction } = await import('../../src/app/lib/ai/intent.ts');
  const { buildReasoning } = await import('../../src/app/lib/ai/reasoning.ts');
  const { enforcePlainLanguage } = await import('../../src/app/lib/ai/readability.ts');

  check('retrieval now earns a descriptive block', () => wantsInterpretation('retrieval') === true);
  check('retrieval still gets NO recommendation', () => wantsAction('retrieval') === false);
  check('analytical keeps its action', () => wantsAction('analytical') === true);

  const bulletsOf = (t) => (t || '').split('\n').map((l) => l.trim()).filter(Boolean).length;
  const NO_FACTORS = { drivers: [], protective: null, rejected: [], requested: [], requestedUnavailable: [] };
  const DETERMINISTIC = [
    '* **Dhaka** tops the list — **412** centres (51% of the 806 total).',
    '* Next is **Sylhet** (188); 5 divisions compared in all.',
  ].join('\n');

  // The model ignores the bullet instruction and returns a paragraph — the floor must rescue it.
  const flat = async () => JSON.stringify({
    finding: 'There are 412 centres below the line.',
    confidence_level: 'moderate',
    confidence_note: 'ok',
  });
  const rescued = await buildReasoning('Which centres are below 85%?', 'retrieval', DETERMINISTIC, 'rows', NO_FACTORS, false, 'real', [], flat);
  check('density floor rescues a one-line finding', () => bulletsOf(rescued.finding) >= 2);

  // The model complies — its bullets are kept as written.
  const good = async () => JSON.stringify({
    finding: ['* 412 centres sit below 85%.', '* Sylhet is worst, at 61%.', '* Dhaka holds most of them.'].join('\n'),
    interpretation: 'The result is lopsided. Three divisions carry most of the total.',
    confidence_level: 'moderate',
    confidence_note: 'ok',
  });
  const rich = await buildReasoning('Which centres are below 85%?', 'retrieval', DETERMINISTIC, 'rows', NO_FACTORS, false, 'real', [], good);
  check('a compliant multi-bullet finding is kept (>= 3 bullets)', () => bulletsOf(rich.finding) >= 3);
  check('retrieval answer carries a "what stands out" block', () => !!rich.interpretation);
  check('retrieval answer carries NO action', () => !rich.action);

  // The readability rewrite must never flatten bullets back into a paragraph.
  const flatten = async () => JSON.stringify({ finding: 'Everything merged into one long paragraph instead.', interpretation: '', action: '' });
  const kept = await enforcePlainLanguage({ finding: ['* one', '* two', '* three'].join('\n') }, flatten);
  check('a rewrite that drops bullets is rejected', () => bulletsOf(kept.finding) === 3);
}
