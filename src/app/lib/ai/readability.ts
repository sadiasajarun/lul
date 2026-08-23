/**
 * A hard plain-language bar for the prose an end user reads.
 *
 * Style instructions in a prompt are a request, not a guarantee — the model drifts back into
 * "assessment problems are the most significant factor, with vulnerability scores often at zero"
 * whenever the source data is itself abstract. So the output is MEASURED, and if it fails, it is
 * sent back once to be rewritten. The check is deterministic and free; only a failure costs a call.
 */
import type { Generate } from './pipeline';
import { extractJson } from './exec';
import { aiLog } from './debug';

/** Words that signal analyst-speak or model-internals leaking into the reader's answer. */
const JARGON = [
  'significant', 'correlation', 'correlated', 'metric', 'metrics', 'indicator', 'indicators',
  'variable', 'variables', 'cohort', 'furthermore', 'moreover', 'additionally', 'leverage',
  'utilise', 'utilize', 'facilitate', 'optimise', 'optimize', 'methodology', 'methodologies',
  'holistic', 'robust', 'aggregate', 'granular', 'parameter', 'quantitative', 'qualitative',
  'statistically', 'derived', 'aforementioned', 'thereby', 'whereby',
];

/** Phrases that describe the SCORING MODEL rather than the children — always a rewrite trigger. */
const MODEL_SPEAK = [
  /contribut\w* (a |an )?score/i,
  /score of \d/i,
  /scores? (are|is|often|generally|consistently)/i,
  /\bvulnerability scores?\b/i,
  /\bincome scores?\b/i,
  /\bassessment scores?\b/i,
  /\bthe (data|analysis) (shows|indicates|suggests) that\b/i,
];

const MAX_AVG_SENTENCE = 22;
const MAX_JARGON = 1;

export interface ReadabilityReport {
  ok: boolean;
  avgSentenceWords: number;
  jargonHits: string[];
  modelSpeak: boolean;
}

export function assessReadability(text: string): ReadabilityReport {
  const t = (text ?? '').trim();
  const sentences = t.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length > 2);
  const words = sentences.reduce((n, s) => n + s.split(/\s+/).length, 0);
  const avg = sentences.length ? words / sentences.length : 0;
  const lower = ` ${t.toLowerCase()} `;
  const jargonHits = JARGON.filter((w) => lower.includes(` ${w} `) || lower.includes(` ${w},`) || lower.includes(` ${w}.`));
  const modelSpeak = MODEL_SPEAK.some((re) => re.test(t));
  return {
    ok: avg <= MAX_AVG_SENTENCE && jargonHits.length <= MAX_JARGON && !modelSpeak,
    avgSentenceWords: Math.round(avg * 10) / 10,
    jargonHits,
    modelSpeak,
  };
}

const REWRITE_SYSTEM = [
  'You rewrite analyst text so a busy field officer in Bangladesh can read it once and understand it.',
  'English may be their second language. They have no statistics training.',
  '',
  'RULES:',
  '- Keep every fact and every number exactly as given. Change ONLY the wording.',
  '- PRESERVE THE BULLETS. If a field arrives as several lines starting "* ", return the SAME number of',
  '  lines in the same order, still starting "* ". Never merge bullets into a paragraph.',
  '- Short sentences, 12-18 words. One idea per sentence.',
  '- Everyday words. If a 12-year-old would not know it, replace it.',
  '- Write about children, families, teachers and centres — never about "factors", "scores", "metrics" or "indicators".',
  '- Never describe how a score is calculated. Say what it means for real children instead.',
  '- Active voice. No "furthermore", "moreover", "significant", "correlation".',
  '- Do not add new facts, numbers, causes or recommendations.',
  '',
  'Return ONLY: {"finding":"...","interpretation":"...","action":"..."}',
  'If a field was given as empty, return it empty.',
].join('\n');

interface Parts { finding: string; interpretation?: string; action?: string }

/**
 * Measure the reader-facing prose; rewrite ONCE if it fails the bar. Falls back to the original on
 * any error — a clumsy sentence is much better than no answer.
 */
export async function enforcePlainLanguage(parts: Parts, generate: Generate): Promise<Parts> {
  const joined = [parts.finding, parts.interpretation ?? '', parts.action ?? ''].join(' ');
  const report = assessReadability(joined);
  if (report.ok) return parts;

  aiLog(
    `readability: rewriting — avg ${report.avgSentenceWords} words/sentence` +
      (report.jargonHits.length ? `, jargon: ${report.jargonHits.join(', ')}` : '') +
      (report.modelSpeak ? ', model-speak detected' : ''),
  );

  try {
    const user = JSON.stringify({
      finding: parts.finding,
      interpretation: parts.interpretation ?? '',
      action: parts.action ?? '',
    });
    const out = extractJson<Parts>(await generate(REWRITE_SYSTEM, user));
    if (!out?.finding) return parts;
    const rewritten: Parts = {
      finding: out.finding.trim() || parts.finding,
      interpretation: parts.interpretation ? (out.interpretation ?? '').trim() || parts.interpretation : undefined,
      action: parts.action ? (out.action ?? '').trim() || parts.action : undefined,
    };
    // A rewrite that flattens the bullets into a paragraph is worse than clumsy wording — it is the
    // one-line answer all over again. Enforce it rather than trusting the instruction.
    const bullets = (t: string | undefined) => (t ?? '').split('\n').map((l) => l.trim()).filter(Boolean).length;
    if (bullets(rewritten.finding) < bullets(parts.finding)) {
      aiLog('readability: rewrite dropped bullets — keeping the original');
      return parts;
    }
    // Only accept the rewrite if it actually reads better.
    const after = assessReadability([rewritten.finding, rewritten.interpretation ?? '', rewritten.action ?? ''].join(' '));
    return after.ok || after.avgSentenceWords < report.avgSentenceWords ? rewritten : parts;
  } catch {
    return parts;
  }
}
