// Menu-consistency assertions. Called from e2e-full.mjs.
//
// Guards the defect where the same question answered differently in two datasets: the question had
// no teaching example, so the model improvised the SQL and the result SHAPE decided how much
// evidence the reader saw. The coverage check below is the one that stops it recurring — adding a
// menu question without an example now fails the suite.

const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);

export async function runMenuChecks({ check, section }) {
  section('MENU CONSISTENCY');

  const { FEW_SHOTS } = await import('../../src/app/lib/ai/fewshot.ts');
  const { MODULES } = await import('../../src/app/lib/modules.ts');
  const { toResponse } = await import('../../src/app/lib/ai/interpret.ts');

  // ── 1. every preset question has a teaching example ──────────────────────
  const shots = FEW_SHOTS.map((s) => new Set(words(s.q)));
  const uncovered = [];
  for (const m of MODULES) {
    for (const q of m.questions) {
      const w = words(q.q);
      const best = Math.max(0, ...shots.map((set) => w.filter((x) => set.has(x)).length / Math.max(1, w.length)));
      if (best < 0.5) uncovered.push(q.q);
    }
  }
  uncovered.length === 0
    ? check('every preset question has a teaching example', () => true)
    : check(`every preset question has a teaching example (${uncovered.length} missing: ${uncovered[0].slice(0, 50)})`, () => false);

  // ── 2. superlative questions must return the whole comparison set ────────
  for (const needle of ['monitoring indicator scored lowest', 'subjects have the weakest']) {
    const shot = FEW_SHOTS.find((s) => s.q.toLowerCase().includes(needle));
    check(`"${needle}" has an example`, () => !!shot);
    if (shot) {
      // A winner-only answer has no GROUP BY and no UNION — the comparison set would be missing.
      const returnsSet = /group\s+by/i.test(shot.sql) || /union\s+all/i.test(shot.sql);
      check(`"${needle}" returns the whole set, not just the winner`, () => returnsSet);
    }
  }

  // ── 3. a one-row comparison renders as a ranked chart, not a wide row ────
  const wide = toResponse('Average M&E dimension scores', 'aggregate', {
    columns: ['avg_pedagogy', 'avg_assessment_quality', 'avg_documentation', 'avg_learning_environment', 'avg_engagement'],
    rows: [{ avg_pedagogy: 3.36, avg_assessment_quality: 3.0, avg_documentation: 3.45, avg_learning_environment: 3.44, avg_engagement: 3.23 }],
    rowCount: 1,
  });
  const chart = wide.widgets.find((w) => w.type === 'chart');
  check('one row x 5 numbers becomes a chart', () => !!chart);
  check('the comparison chart has one bar per measure', () => chart && chart.data.length === 5);
  check('the bars are ranked lowest-first', () => chart && chart.data[0].value === 3.0);
  check('its summary names the lowest AND the highest', () =>
    /assessment quality/i.test(wide.summary) && /documentation/i.test(wide.summary));
  check('the summary is multi-bullet, not one line', () => wide.summary.split('\n').filter(Boolean).length >= 3);

  // a labelled scalar (text + one number) should still be tiles — tiles read well there
  const labelled = toResponse('Weakest dimension', 'aggregate', {
    columns: ['dimension', 'avg_score'],
    rows: [{ dimension: 'Assessment Quality', avg_score: 3.14 }],
    rowCount: 1,
  });
  check('a text+number single row still renders as tiles', () => labelled.widgets.every((w) => w.type === 'metrics'));
}
