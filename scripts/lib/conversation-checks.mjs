// Conversational understanding & follow-up — assertions for the three capabilities.
// Called from e2e-full.mjs. Spends no API tokens: routing, the glossary and follow-up detection are
// all deterministic, and the factor test runs against real DuckDB rows.
//
// The check that matters most is DEFINITIONS MATCH THE CALCULATION. A definition that drifts from
// the SQL is worse than no definition at all, because the reader then trusts a number they now
// misunderstand — so the weights are asserted against semantic.sql itself, not against a copy.

import fs from 'node:fs';
import path from 'node:path';

export async function runConversationChecks({ check, section, openDataset, root }) {
  const { routeQuestion } = await import('../../src/app/lib/ai/router.ts');
  const { GLOSSARY, findTerms, renderTermAnswer } = await import('../../src/app/lib/ai/glossary.ts');
  const { unsupportedNumbers, KNOWN_LIMITS, findLimit, renderDatasetFacts } = await import('../../src/app/lib/ai/explain.ts');
  const { detectFollowUp, needsClarification, requestedFactors } = await import('../../src/app/lib/ai/followup.ts');

  const SEMANTIC = fs.readFileSync(path.join(root, 'src/app/lib/db/semantic.sql'), 'utf8');

  /* ── 1. ROUTING ─────────────────────────────────────────────────────────── */
  section('CONVERSATION: routing');

  // Capability 1 — the failing case the client named, plus the rest of the spec's examples.
  const DEFINITIONS = [
    'what does vulnerability score mean?',
    'What is dropout risk?',
    'What is coverage?',
    'How is this score calculated?',
    'What does confidence 40% mean?',
    'Why is this low confidence?',
    'What is Catchup?',
    "What does 'mainstreamed' mean?",
    'What is an M&E indicator?',
    'Which field does this come from?',
    'Where does this number come from?',
    'What data is behind this number?',
    'Explain the monitoring score',
    'define ghost student',
    // Phrasings a real user reaches for. "How confident is this?" is a stated acceptance case, and
    // every one of these routed to the query path until the patterns were widened.
    'how confident is this?',
    'How confident are you in this?',
    'is this reliable?',
    'what is this based on?',
    'how do you know that?',
    'whats a ghost student',
    'tell me what mainstreamed means',
    'how is the monitoring score worked out',
  ];
  for (const q of DEFINITIONS) {
    check(`routes to definition: "${q}"`, () => routeQuestion(q).kind === 'definition');
  }

  // Capability 3 — questions about the data itself.
  const DATASET_QS = [
    'What data do you have?',
    'What can I ask you?',
    'How many students are in the database?',
    'What fields exist for students?',
    'How complete is the attendance data?',
    "What's missing from this dataset?",
    'Can you predict when a student will drop out?',
    "Why can't you show attendance trends?",
    'What are your limitations?',
  ];
  for (const q of DATASET_QS) {
    check(`routes to dataset: "${q}"`, () => routeQuestion(q).kind === 'dataset');
  }

  // THE REGRESSION GUARD. Routing a real question away from the database would be a far worse bug
  // than failing to explain a term, so every one of these must still reach the query path.
  const DATA_QS = [
    'What is the average attendance?',
    'How many students are in Dhaka?',
    'Which centres have attendance below 85%?',
    "What's the weakest monitoring indicator right now?",
    'Show students at risk of dropping out',
    'Why is attendance low in Sylhet?',
    'Show the lowest-income students',
    'Which subjects have the weakest average marks?',
    'Compare programme enrollment and mainstreaming',
    'How many children are at each reading level by area?',
    'Show dropout reasons by income band',
    'Is there a relationship between family income and attendance?',
    'Which centres need a visit?',
    'Show average marks by division',
    'show me confidence by division',
    'what is the total number of students in Dhaka',
    'compare Dhaka and Sylhet attendance',
  ];
  for (const q of DATA_QS) {
    check(`still routes to data: "${q}"`, () => routeQuestion(q).kind === 'data');
  }

  /* ── 2. DEFINITIONS MATCH THE CALCULATION ───────────────────────────────── */
  section('CONVERSATION: definitions match the SQL that computes them');

  for (const e of GLOSSARY) {
    if (!e.anchor) continue;
    check(`"${e.term}" still points at real SQL (${e.anchor.slice(0, 40)})`, () => SEMANTIC.includes(e.anchor));
  }

  // The risk score's weights are the whole point of "how is this calculated?". Assert each declared
  // weight is genuinely in the view, and that the parts still add to the stated 0-100 scale.
  const riskBlock = SEMANTIC.slice(
    SEMANTIC.indexOf('CREATE OR REPLACE VIEW v_dropout_risk'),
    SEMANTIC.indexOf('CREATE OR REPLACE VIEW v_center_health'),
  );
  const risk = GLOSSARY.find((g) => g.id === 'dropout_risk');
  check('the dropout-risk definition exists', () => !!risk && !!risk.parts);
  for (const p of risk.parts) {
    // "Extra hardship" is a COMPOSED cap: the view adds 6 + 7 + 7 rather than writing 20 anywhere.
    // Verifying the composition is a stronger check than hunting for the literal, so it gets its own
    // assertion below.
    if (p.label.startsWith('Extra hardship')) continue;
    check(`risk weight ${p.max} ("${p.label}") is really in v_dropout_risk`, () => new RegExp(`\\b${p.max}\\b`).test(riskBlock));
  }
  check('the hardship cap we state (20) is what the view actually adds up to', () => {
    const at = riskBlock.indexOf('AS r_vulnerability');
    const expr = riskBlock.slice(Math.max(0, at - 400), at);
    const weights = (expr.match(/THEN (\d+) ELSE 0/g) ?? []).map((m) => Number(m.match(/\d+/)[0]));
    const declared = risk.parts.find((x) => x.label.startsWith('Extra hardship')).max;
    return weights.length === 3 && weights.reduce((a, b) => a + b, 0) === declared;
  });
  check('the risk parts add up to the 0-100 scale we tell the user', () =>
    risk.parts.reduce((n, p) => n + p.max, 0) === 100);
  check('income sub-weights (15/9/4) match the CASE in the view', () =>
    /'<5000' THEN 15/.test(riskBlock) && /'5000-9999' THEN 9/.test(riskBlock) && /'10000-14999' THEN 4/.test(riskBlock));
  check('hardship sub-weights (6/7/7) match the view', () =>
    /THEN 6 ELSE 0/.test(riskBlock) && (riskBlock.match(/THEN 7 ELSE 0/g) ?? []).length >= 2);

  // Confidence is a share of four signal groups — the definition says 25 each.
  const conf = GLOSSARY.find((g) => g.id === 'confidence_pct');
  check('confidence is described as four equal signal groups', () =>
    conf.parts.length === 4 && conf.parts.every((p) => p.max === 25));
  check('the view really divides by 4 signal groups', () => /signals_present \/ 4/.test(riskBlock));

  // Vulnerability is a 0-5 count of five markers — the explanation lists exactly five.
  const vuln = GLOSSARY.find((g) => g.id === 'vulnerability');
  const vulnBullets = vuln.plain.split('\n').filter((l) => l.trim().startsWith('* ')).length;
  check('the vulnerability explanation lists exactly 5 markers', () => vulnBullets === 5);
  check('the vulnerability view really counts 5 markers', () => {
    const b = SEMANTIC.slice(SEMANTIC.indexOf('CREATE OR REPLACE VIEW v_vulnerability'));
    return (b.slice(0, b.indexOf(';')).match(/CASE WHEN/g) ?? []).length === 5;
  });

  check('every glossary entry names where its number comes from', () => GLOSSARY.every((g) => g.source && g.source.length > 8));
  check('every glossary entry has a one-line plain answer', () => GLOSSARY.every((g) => g.short && g.short.length > 15));

  /* ── 3. TERM MATCHING ───────────────────────────────────────────────────── */
  section('CONVERSATION: term matching');

  check('"vulnerability score" finds the vulnerability entry', () => findTerms('what does vulnerability score mean?')[0]?.id === 'vulnerability');
  check('"dropout risk" beats the shorter "dropout"', () => findTerms('explain dropout risk')[0]?.id === 'dropout_risk');
  check('"confidence" is found on its own', () => findTerms('why is this low confidence?').some((t) => t.id === 'confidence_pct'));
  check('an unrelated question matches no term', () => findTerms('which centres are in Sylhet?').length === 0);
  check('the written definition names the real weights', () => {
    const txt = renderTermAnswer(GLOSSARY.find((g) => g.id === 'dropout_risk'));
    return txt.includes('35') && txt.includes('30') && txt.includes('15') && txt.includes('20');
  });

  /* ── 4. NEVER FABRICATE A NUMBER ────────────────────────────────────────── */
  section('CONVERSATION: invented numbers are rejected');

  const facts = 'The score runs 0-100. Schoolwork is worth up to 35. Attendance coverage is 17%.';
  check('a grounded answer passes', () => unsupportedNumbers('It runs 0 to 100, and schoolwork is worth 35.', facts).length === 0);
  check('an invented percentage is caught', () => unsupportedNumbers('Coverage is about 62% of children.', facts).includes('62'));
  check('an invented count is caught', () => unsupportedNumbers('There are 41,203 children affected.', facts).includes('41203'));
  check('small counts are allowed (they are ordinals, not statistics)', () =>
    unsupportedNumbers('It is built from four parts and five markers.', facts).length === 0);
  check('a number from the user question is allowed', () =>
    unsupportedNumbers('A confidence of 40% means two of the four were recorded.', `${facts}\nWhat does confidence 40% mean?`).length === 0);

  /* ── 5. LIMITS ARE SPECIFIC, NOT "INSUFFICIENT DATA" ────────────────────── */
  section('CONVERSATION: limitations name the missing field');

  check('every limit says what is missing', () => KNOWN_LIMITS.every((l) => l.missing.length > 40));
  check('every limit says what would fix it', () => KNOWN_LIMITS.every((l) => l.wouldNeed.length > 20));
  check('every limit offers something answerable instead', () => KNOWN_LIMITS.every((l) => l.insteadAsk.length > 20));
  check('no limit falls back on "insufficient data"', () =>
    KNOWN_LIMITS.every((l) => !/insufficient data|not enough data|no data available/i.test(l.missing)));
  check('"why can\'t you show attendance trends?" finds the dated-attendance limit', () =>
    findLimit('why can\'t you show attendance trends?')?.id === 'attendance_trend');
  check('the attendance limit explains there is no date column', () =>
    /no date|dates/i.test(findLimit('show me attendance over time')?.missing ?? ''));
  check('"can you predict when a student will drop out?" finds the timing limit', () =>
    findLimit('can you predict when a student will drop out?')?.id === 'dropout_timing');
  check('the dropout-timing limit names the missing dated leaving record', () =>
    /dated|when they left|no.{0,20}date/i.test(findLimit('predict when a student will drop out')?.missing ?? ''));

  /* ── 6. FOLLOW-UPS ──────────────────────────────────────────────────────── */
  section('CONVERSATION: follow-up modification');

  const HISTORY = [
    { role: 'user', text: 'Which centres have attendance below 85%?' },
    {
      role: 'ai',
      text: '412 centres are below the line.',
      sql: "SELECT center_id, center_name, division FROM v_center_enrollment WHERE avg_attendance_recorded < 85 ORDER BY avg_attendance_recorded LIMIT 30",
      columns: ['center_id', 'center_name', 'division'],
      rows: [{ center_id: '123', center_name: 'A', division: 'Dhaka' }],
      rowCount: 412,
    },
  ];

  const FOLLOWUPS = [
    ['Add family income as a factor and show it again', 'add_factor'],
    ['Now show only girls', 'filter'],
    ['Only for Catchup', 'filter'],
    ['Just Dhaka', 'filter'],
    ['Remove that factor', 'drop_factor'],
    ['Sort by attendance instead', 'sort'],
    ['Show more rows', 'resize'],
    ['Break that down by district', 'regroup'],
    ['Why is that one so high?', 'drill'],
    ['Compare that to the best centre', 'compare'],
    ['Show me all students, not just those', 'unfilter'],
  ];
  for (const [q, kind] of FOLLOWUPS) {
    check(`follow-up "${q}" is a ${kind}`, () => detectFollowUp(q, HISTORY)?.kind === kind);
  }

  check('a follow-up instruction carries the previous SQL forward', () => {
    const f = detectFollowUp('Only for Catchup', HISTORY);
    return f.instruction.includes('v_center_enrollment') && /avg_attendance_recorded < 85/.test(f.instruction);
  });
  check('a follow-up instruction restates the honesty rules', () => {
    const f = detectFollowUp('Sort by attendance instead', HISTORY);
    return /coverage/i.test(f.instruction) && /0-5|0-100/.test(f.instruction);
  });

  // A self-contained question must NOT be swallowed as an edit to the previous answer.
  const FRESH = [
    'Which subjects have the weakest average marks?',
    'How many teachers are there in Sylhet?',
    'Show the lowest-income students',
  ];
  for (const q of FRESH) check(`self-contained question is not an edit: "${q}"`, () => detectFollowUp(q, HISTORY) === null);
  check('nothing is an edit when there is no history', () => detectFollowUp('only Dhaka', []) === null);

  /* ── 7. ASK RATHER THAN GUESS ───────────────────────────────────────────── */
  section('CONVERSATION: clarify instead of guessing');

  check('"why is that one so high?" with nothing on screen asks a question', () =>
    !!needsClarification('why is that one so high?', []));
  check('the same question WITH a prior result does not ask', () =>
    needsClarification('why is that one so high?', HISTORY) === null);
  check('"add income" before anything was asked gets a question', () =>
    !!needsClarification('add income', []));
  check('a normal question is never interrupted with a clarification', () =>
    needsClarification('Which centres need a visit?', []) === null);

  /* ── 8. NAMED FACTORS ───────────────────────────────────────────────────── */
  section('CONVERSATION: factors asked for by name');

  check('"add family income as a factor" names the income factor', () =>
    requestedFactors('Add family income as a factor and show it again').includes('household_income_low'));
  check('"also include child labour" names the child-labour factor', () =>
    requestedFactors('also include child labour as a driver').includes('child_labour'));
  check('a question naming no factor returns nothing', () => requestedFactors('only Dhaka').length === 0);

  // A forced factor must survive the materiality filter and be reported with real numbers.
  if (openDataset) {
    const D = await openDataset('data');
    try {
      const { computeFactors } = await import('../../src/app/lib/ai/factors.ts');
      const rows = await D.q(`SELECT student_id FROM v_students WHERE division = 'Dhaka' LIMIT 200`);
      const ids = rows.map((r) => String(r.student_id));
      const ds = { query: async (sql) => { const r = await D.q(sql); return { columns: r.length ? Object.keys(r[0]) : [], rows: r, rowCount: r.length }; } };

      const normal = await computeFactors(ds, 'student', ids, [], 'general', []);
      const forced = await computeFactors(ds, 'student', ids, [], 'general', ['household_income_low']);
      check('forcing a factor does not break the analysis', () => Array.isArray(forced.drivers));
      // THE CONTRACT: a factor the user names is either MEASURED or EXPLAINED. It is never silently
      // dropped — that would read as the request being ignored.
      check('a factor asked for by name is never silently dropped', () =>
        forced.requested.some((f) => f.id === 'household_income_low') ||
        forced.requestedUnavailable.some((f) => f.id === 'household_income_low'));
      check('an unmeasurable named factor comes back with a plain reason', () => {
        const u = forced.requestedUnavailable.find((f) => f.id === 'household_income_low');
        return !u || (u.reason.length > 15 && !/undefined|null/.test(u.reason));
      });
      check('a factor nobody asked for is not force-reported', () =>
        normal.requested.length === 0 && normal.requestedUnavailable.length === 0);
      check('a measured forced factor carries its real numbers', () => {
        const f = forced.requested.find((x) => x.id === 'household_income_low');
        return !f || (Number.isFinite(f.cohortValue) && Number.isFinite(f.baselineValue) && f.cohortN > 0);
      });
      check('a measured forced factor records whether it made a difference', () => {
        const f = forced.requested.find((x) => x.id === 'household_income_low');
        return !f || typeof f.material === 'boolean';
      });
      check('forcing one factor does not change the others', () =>
        normal.drivers.filter((d) => d.id !== 'household_income_low').length ===
        forced.drivers.filter((d) => d.id !== 'household_income_low').length);
    } finally {
      D.close();
    }
  }

  /* ── 9. THE DATASET DESCRIPTION IS REAL ─────────────────────────────────── */
  section('CONVERSATION: the dataset description is measured, not written');

  const profile = {
    dataMode: 'real',
    views: [
      { view: 'v_students', rows: 250632, columns: [{ name: 'income_band', type: 'VARCHAR', filledPct: 91.2, distinct: 4 }] },
      { view: 'v_student_attendance', rows: 250632, columns: [{ name: 'avg_attendance_recorded', type: 'DOUBLE', filledPct: 17.3, distinct: 900 }] },
    ],
  };
  const rendered = renderDatasetFacts(profile, 'how complete is the attendance data?');
  check('the description carries the real row count', () => rendered.includes('250,632'));
  check('the description carries the real coverage figure', () => rendered.includes('17.3'));
  check('the description lists what cannot be answered', () => /CANNOT ANSWER/.test(rendered));
  check('the description offers questions that do work', () => /QUESTIONS THAT DO WORK/.test(rendered));
  check('a fields question lists the columns', () =>
    /WHAT IS RECORDED/.test(renderDatasetFacts(profile, 'what fields exist for students?')));
}
