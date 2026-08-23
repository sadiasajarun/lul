/**
 * The answer's shape follows the QUESTION'S INTENT, not one fixed template.
 *
 *   retrieval   → finding + coverage. No factors, no interpretation, no recommendation.
 *                 A list is a complete answer.
 *   analytical  → finding + ranked valid factors + plain-language interpretation + confidence + action.
 *   comparative → finding + a short interpretation of what the difference means. No factor stack.
 *   predictive  → finding + driver + confidence + action.
 *
 * Layer 2 arrives already computed and already validated (factors.ts); the model may describe it but
 * cannot add to it. The interpretation is the layer a non-analyst actually reads — it is required for
 * analytical answers and is what makes the numbers mean something.
 */
import type { FactorResult } from './factors';
import { renderFactors } from './factors';
import type { QuestionIntent } from './intent';
import { wantsAction, wantsInterpretation, wantsFactorAnalysis } from './intent';
import type { Generate } from './pipeline';
import { extractJson } from './exec';
import { enforcePlainLanguage } from './readability';

export type ConfidenceLevel = 'high' | 'moderate' | 'low';

export interface AnswerReasoning {
  intent: QuestionIntent;
  /** Layer A — what the data literally shows. */
  finding: string;
  /** Layer B — validated, ranked. Empty for non-analytical intents (and when nothing passed). */
  factors: FactorResult['drivers'];
  protective: FactorResult['protective'];
  /** Factors the user asked for by name, shown whether or not they made a difference. */
  requested: FactorResult['requested'];
  /** Factors the user asked for that could not be measured, with the plain reason why. */
  requestedUnavailable: FactorResult['requestedUnavailable'];
  /** Set when the analysis ran but no factor survived the validity tests — stated, not padded over. */
  noDriverNote?: string;
  /** Layer C — 2–4 sentences of plain language. Only for analytical/comparative. */
  interpretation?: string;
  /** Layer D — qualifies, never terminates. */
  confidence: { level: ConfidenceLevel; note: string };
  /** Layer E — only when earned. */
  action?: string;
}

interface ModelOut {
  finding?: string;
  interpretation?: string;
  confidence_level?: string;
  confidence_note?: string;
  action?: string;
}

function systemFor(intent: QuestionIntent, hasFactors: boolean): string {
  const base = [
    'You are explaining data to a UNICEF field officer in Bangladesh. They are busy, practical, and have NO statistics training. English may be their second language.',
    '',
    'HOW TO WRITE — this matters as much as being correct:',
    '- Short sentences. Aim for 12-18 words. One idea per sentence.',
    '- Everyday words only. If a 12-year-old would not know the word, do not use it.',
    '- Write about CHILDREN, FAMILIES, TEACHERS and CENTRES — not about "factors", "metrics", "indicators", "variables" or "scores".',
    '- NEVER describe how the scoring works. "Income contributes a score of 15" is meaningless to the reader. Translate it into real life: "money problems are part of it, but a smaller part".',
    '- Active voice. "These children miss school" — not "absence is observed among this cohort".',
    '- Banned words: significant, correlation, metric, indicator, variable, cohort, furthermore, moreover, additionally, leverage, utilise, facilitate, optimise, methodology, outcomes, engagement and retention, holistic, robust.',
    '- Say the real-world meaning of every number you mention. A number with no meaning attached is a failed sentence.',
    '',
    'EXAMPLE — bad (do not write like this):',
    '  "Assessment problems are the most significant factor associated with dropout risk, with vulnerability scores often at zero and income consistently contributing a score of 15."',
    'EXAMPLE — good (write like this):',
    '  "The clearest warning sign is schoolwork. These children are falling behind in their tests, more than they are struggling with anything else. Money worries at home matter too, but less. Very few of them have health problems or a disability."',
    '',
    'HARD RULES:',
    '- Never state a cause. These are things that happen TOGETHER: say "goes together with", "tends to happen alongside", "is linked to" — never "because of", "caused by", "due to".',
    '- Never invent a number. Use only figures from the result or the computed factors given to you.',
    '- Attendance 0 means NOT RECORDED, never "absent". Never average a 0-5 score against a 0-100 percentage.',
    '- Never end on a caveat.',
    '',
    'SHAPE OF THE ANSWER — the reader skims, so give them several short points, not one long one:',
    '- "finding" MUST be 3-5 SHORT BULLETS. Start every bullet with "* " and separate them with a newline.',
    '- One idea per bullet. Do NOT write a paragraph — a single-bullet finding is a failed answer.',
    '- Short sentences and MORE of them. Simple wording is not the same as a short answer.',
  ];

  if (intent === 'retrieval') {
    return [...base, '',
      'This is a RETRIEVAL question — the reader asked for data, not for an explanation of why.',
      'Return ONLY: {"finding":"...","interpretation":"...","confidence_level":"high|moderate|low","confidence_note":"..."}',
      '',
      'finding — 3-5 bullets, each starting "* ". Between them cover:',
      '  (1) the headline number and what it counts;',
      '  (2) the highest and the lowest in the result, named;',
      '  (3) whether the result is concentrated in a few places or spread out;',
      '  (4) data coverage, stated once, only if it affects how the numbers should be read.',
      '',
      'interpretation — 2-4 sentences on WHAT STANDS OUT IN THE DATA ITSELF. Describe only what is visible:',
      'how lopsided the spread is, which places carry most of the total, how far the extremes sit from the middle,',
      'and how much of the whole network this result represents.',
      'FORBIDDEN here: any cause or driver, the words "because"/"due to"/"driven by", and any recommendation or next step.',
      'You are pointing at the shape of the data, never explaining it.',
      '',
      'confidence_note — one short sentence on how complete the underlying data is.',
    ].join('\n');
  }

  if (intent === 'comparative') {
    return [...base, '',
      'This is a COMPARATIVE question.',
      'Return ONLY: {"finding":"...","interpretation":"...","confidence_level":"...","confidence_note":"..."}',
      'finding — the comparison itself, with the numbers on each side.',
      'interpretation — 2–3 sentences on what the difference actually means for the programme. Light reasoning only; do not invent drivers.',
      'Do NOT recommend an action unless the comparison plainly implies one.',
    ].join('\n');
  }

  if (intent === 'predictive') {
    return [...base, '',
      'This is a PREDICTIVE question. The projection is an ESTIMATE from recent trend, not a calibrated probability — say so plainly once.',
      'Return ONLY: {"finding":"...","confidence_level":"...","confidence_note":"...","action":"..."}',
      'finding — who/what is projected, with the numbers and the direction.',
      'action — one specific next step for the highest-scoring cases, naming them.',
    ].join('\n');
  }

  // analytical
  return [...base, '',
    'This is an ANALYTICAL ("why") question. The reader is a programme officer, not an analyst. They need to understand WHAT IS HAPPENING and WHAT TO DO — a bare list of percentages is a failed answer.',
    'Return ONLY: {"finding":"...","interpretation":"...","confidence_level":"...","confidence_note":"...","action":"..."}',
    '',
    'finding — 2-3 sentences in plain English. Lead with the single most important number and say what it MEANS, not just what it is. Name the biggest contributor and how it compares with the others ("assessment problems account for roughly twice as much of the risk as attendance does"). Do NOT simply recite every figure in a row.',
    '',
    hasFactors
      ? 'interpretation — 4-6 sentences, and this is the heart of the answer. Do ALL of: (1) name the PATTERN across the factors rather than taking each in turn; (2) say which factor dominates and by how much relative to the rest; (3) explain the plausible mechanism in hedged language — how these things plausibly reinforce one another ("families under economic pressure pull children into work, and those children fall behind, which makes coming back harder"); (4) say concretely WHO is affected and WHERE. Flowing prose a non-technical reader follows without help.'
      : 'interpretation — 4-6 sentences. No cohort-level factor comparison was available, so ANALYSE THE NUMBERS THAT ARE IN THE RESULT: rank them, say which dominates and roughly by how much, describe the pattern they form, and explain in hedged language what that pattern plausibly reflects in programme terms. Explain what each key number actually MEANS. Do NOT say "the data does not reveal a driver" and stop — there are numbers in the result, so interpret them. Never invent a factor that is not there.',
    '',
    hasFactors
      ? 'action — 2-3 sentences. ONE specific step tied to the STRONGEST factor, naming the actual segment and place it applies to, and what it should achieve. A programme action (family outreach, cash-support review, teacher support, home visit) — not a data-cleaning task, unless coverage genuinely blocks every action.'
      : 'action — 2-3 sentences built on the LARGEST number in the result: name the specific group, the specific place, and the concrete step. Fall back to verification only if the numbers truly cannot support a programme action, and then name the exact field and district.',
    '',
    'The factor list is rendered separately — interpret it, never repeat it as a list.',
  ].join('\n');
}

function levelFrom(raw: string | undefined, f: FactorResult): ConfidenceLevel {
  const v = (raw ?? '').toLowerCase();
  if (v === 'high' || v === 'moderate' || v === 'low') return v;
  if (!f.drivers.length) return 'low';
  const min = Math.min(...f.drivers.map((x) => x.coveragePct));
  return min >= 80 ? 'high' : min >= 40 ? 'moderate' : 'low';
}

export async function buildReasoning(
  question: string,
  intent: QuestionIntent,
  deterministicSummary: string,
  resultPreview: string,
  factors: FactorResult,
  cohortFound: boolean,
  dataMode: string,
  caveats: string[],
  generate: Generate,
): Promise<AnswerReasoning> {
  // Asking for a factor by name ("add family income and show it again") makes this an analytical
  // turn whatever the original question's shape was — the user has asked for the comparison.
  const requested = factors.requested ?? [];
  const analytic = wantsFactorAnalysis(intent) || requested.length > 0;
  const hasFactors = analytic && factors.drivers.length > 0;

  const user = [
    `QUESTION: ${question}`,
    '',
    'RESULT (computed from SQL — these numbers are true):',
    resultPreview,
    '',
    analytic
      ? 'COMPUTED FACTORS (already validated: circular, backwards, trivial and immaterial ones were dropped):\n' + renderFactors(factors)
      : '',
    '',
    `ACTIVE DATASET: ${dataMode === 'tuned' ? 'PREVIEW (gap-filled, estimated values)' : 'REAL (recorded data, with coverage gaps)'}`,
    '',
    'DATA CAVEATS (for the confidence line only — never the conclusion):',
    ...caveats.slice(0, 6).map((c) => '- ' + c),
    '',
    'Return the JSON now.',
  ].filter(Boolean).join('\n');

  let parsed: ModelOut | null = null;
  try {
    parsed = extractJson<ModelOut>(await generate(systemFor(intent, hasFactors), user));
  } catch {
    parsed = null;
  }

  // DENSITY FLOOR. `insightSummary` (interpret.ts) already computes a grounded multi-bullet
  // headline — leader, its share, runner-up, how many compared — with no model call. If the model
  // ignores the bullet instruction and returns a paragraph, fall back to that rather than shipping
  // a one-line answer. Density then never depends on the model complying.
  const bulletCount = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean).length;
  const modelFinding = (parsed?.finding ?? '').trim();
  const finding = bulletCount(modelFinding) >= 2 ? modelFinding
    : bulletCount(deterministicSummary) > bulletCount(modelFinding) ? deterministicSummary
    : modelFinding || deterministicSummary;
  const note = (parsed?.confidence_note ?? '').trim()
    || (hasFactors
      ? `Based on ${factors.drivers[0].cohortN} records; the underlying fields are ${Math.min(...factors.drivers.map((f) => f.coveragePct))}% populated, so treat magnitudes as directional.`
      : 'Computed directly from the returned rows.');

  const out: AnswerReasoning = {
    intent,
    finding,
    factors: analytic ? factors.drivers : [],
    protective: analytic ? factors.protective : null,
    requested,
    requestedUnavailable: factors.requestedUnavailable ?? [],
    confidence: { level: levelFrom(parsed?.confidence_level, factors), note },
  };

  if (analytic && !hasFactors) {
    // These are genuinely different situations; conflating them misleads the reader. One means
    // "we compared and found nothing solid", the other means "there was no group to compare".
    out.noDriverNote = cohortFound
      ? 'Factors were measured against the whole network, but none passed the validity tests — the differences were circular, pointed the other way, or were too small to be meaningful.'
      : 'This answer is an aggregate rather than a list of individuals, so no group-vs-network comparison could be run. The reading below interprets the figures in the result itself.';
  }
  if (wantsInterpretation(intent)) {
    out.interpretation = (parsed?.interpretation ?? '').trim() || undefined;
  }
  if (wantsAction(intent)) {
    const a = (parsed?.action ?? '').trim();
    // An action must be EARNED. If the model gives nothing usable, fall back to a specific
    // verification step — never the generic "route to the field team" line.
    out.action = a || (hasFactors
      ? `Review this group against its strongest associated factor — ${factors.drivers[0].label.toLowerCase()} — and confirm the pattern on a sample before scaling a response.`
      : 'Verify the underlying records for this group before acting — start with the fields this answer depends on.');
  }

  // Final gate: measure the prose a person actually reads and rewrite it once if it slipped back
  // into analyst-speak. Facts and numbers are preserved; only the wording changes.
  const plain = await enforcePlainLanguage(
    { finding: out.finding, interpretation: out.interpretation, action: out.action },
    generate,
  );
  out.finding = plain.finding;
  out.interpretation = plain.interpretation;
  out.action = plain.action;
  return out;
}
