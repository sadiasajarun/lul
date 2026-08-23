/**
 * What is the question actually ASKING? The answer's shape follows from this — a list is a complete
 * answer to "list the centres below 85%", and bolting a reasoning stack and a recommendation onto it
 * is noise. Only a "why" question earns the full analysis.
 *
 * Deterministic and rule-based on purpose: intent decides how much work (and how many model calls)
 * an answer does, so it must be predictable and free rather than another thing the model can drift on.
 */

export type QuestionIntent = 'retrieval' | 'analytical' | 'comparative' | 'predictive';

/**
 * The subject an analytical question is about. Used to (a) pick which factors are even candidates
 * and (b) ban the factors that would merely restate the outcome.
 */
export type OutcomeTopic = 'attendance' | 'performance' | 'assessment' | 'risk' | 'general';

/** "why / what's driving / explain / reason" — the only intent that gets the full analysis. */
const ANALYTICAL = /\bwhy\b|what'?s driving|what is driving|whats driving|driver(s)? (of|behind)|reason(s)? (for|behind|why)|explain(s|ing)?\b|root cause|because of|what causes|what is causing/i;

/** Forward-looking. Deliberately checked AFTER "why", so "why will X decline" reads as analytical. */
const PREDICTIVE = /\bpredict|forecast|projection|next month|next week|going to|will (it |they |we )?(decline|drop|fall|worsen|improve|be)\b|likely to|(rising|growing|increasing|mounting) risk|at risk|expected to|heading (for|towards)|trend(ing)? (down|up)/i;

/** Two things held side by side. */
const COMPARATIVE = /\bcompare\b|\bcomparison\b|\bversus\b|\bvs\.?\b|\bdiffer(ence|s|ent)?\b between|how does .+ (compare|differ)|against each other|side by side|relative to/i;

export function classifyIntent(question: string): QuestionIntent {
  const q = (question ?? '').trim();
  if (!q) return 'retrieval';
  if (ANALYTICAL.test(q)) return 'analytical';
  if (PREDICTIVE.test(q)) return 'predictive';
  if (COMPARATIVE.test(q)) return 'comparative';
  return 'retrieval';
}

/**
 * Which subject the question is about. Order matters: a question mentioning both attendance and
 * centres ("why do these centres have low attendance") is an ATTENDANCE question — the outcome being
 * explained is the attendance, so attendance-family factors must be banned as circular.
 */
export function classifyTopic(question: string): OutcomeTopic {
  const q = (question ?? '').toLowerCase();
  if (/attend|absent|absence|absentee|present|turnout|drop(ping)? out of class|stopped coming|ghost|inactive/.test(q)) return 'attendance';
  if (/risk|dropout risk|likely to drop|vulnerab/.test(q)) return 'risk';
  if (/mark|score of|subject|reading|numeracy|assess|exam|result|learning outcome|grade level/.test(q)) return 'assessment';
  if (/centre|center|monitoring|indicator|m&e|performing|performance|visit|quality/.test(q)) return 'performance';
  return 'general';
}

/** Does this intent get the ranked-factor analysis at all? */
export function wantsFactorAnalysis(intent: QuestionIntent): boolean {
  return intent === 'analytical';
}

/** Does this intent get a recommended action? Only when the analysis can earn one. */
export function wantsAction(intent: QuestionIntent): boolean {
  return intent === 'analytical' || intent === 'predictive';
}

/**
 * Does this intent get a prose block under the bullets?
 * Retrieval is included, but its block is DESCRIPTIVE only — what stands out in the data, never why.
 * That keeps "no forced reasoning" true while stopping a list answer from collapsing to one line.
 */
export function wantsInterpretation(intent: QuestionIntent): boolean {
  return intent === 'analytical' || intent === 'comparative' || intent === 'retrieval';
}
