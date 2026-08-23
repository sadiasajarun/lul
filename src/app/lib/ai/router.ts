/**
 * WHAT KIND OF QUESTION IS THIS?
 *
 * Until now every question took one path: write SQL, run it, interpret the rows. That is the right
 * path for "which centres are below 85%" and the WRONG path for "what does vulnerability score
 * mean?" — there is no query that answers it, so the agent either refused or improvised.
 *
 * Three kinds now:
 *   data       — answerable by querying the database. The existing agent path.
 *   definition — what a term/score/field MEANS, or how it is worked out. Answered from the glossary,
 *                which carries the same weights the database computes with.
 *   dataset    — what the data itself contains, how complete it is, what it cannot do. Answered from
 *                the live database profile + catalogue.
 *
 * Deterministic and rule-based, for the same reason intent is: routing decides how many model calls
 * a question costs, so it must be predictable and free rather than another thing the model can drift
 * on. When in doubt it returns 'data' — the existing path, which is never worse than today.
 */
import { findTerms } from './glossary';

export type QuestionKind = 'data' | 'definition' | 'dataset';

/** Unambiguous "explain this term to me" phrasings. */
const DEFINITION_STRONG = new RegExp(
  [
    "what (does|do|did) .{2,60}? mean",
    "what'?s .{2,60}? mean",
    'what .{2,40}? means\\b',
    'what is meant by',
    'meaning of',
    '\\bdefine\\b',
    'definition of',
    'how (is|are|was|do you|does the|is the) .{2,60}?(calculat|comput|work(ed)? out|derived|measured|scored|arrived at)',
    'how do you (calculate|compute|work out|measure|score|decide|arrive)',
    'what (goes|go) into',
    "what (is|are|s) (this|that|it) (made|built) (of|from)",
    "what'?s behind (this|that|the)",
    'what is behind (this|that|the)',
    'what data is behind',
    'where (does|do) (this|that|the|these|those) .{0,40}?(come|comes) from',
    'which field (does|do|is)',
    'what field (does|do|is)',
    'what counts as',
    'why is (this|that|it) (a )?(low|high) confidence',
    'why (is|are) (this|that|these|the) confidence',
    'how does .{2,40}? work\\b',
    // "How confident is this?" — a stated acceptance case. It reads as a question about the answer
    // on screen, so it is a definition of what the confidence figure means for that result.
    'how confident (is|are) (this|that|it|you)',
    'how (reliable|trustworthy|sure|certain) (is|are) (this|that|it|you)\\b',
    '^is (this|that|it) (reliable|trustworthy|accurate|certain)',
    // Provenance — "where did this come from?" in its various forms.
    'what (is|are) (this|that|it|these) based on',
    'how do you know',
    'how did you (work|get|find|arrive|calculate)',
  ].join('|'),
  'i',
);

/** Unambiguous "tell me about the data itself / your limits" phrasings. */
const DATASET_STRONG = new RegExp(
  [
    'what data (do|have) you',
    'what data is (there|available)',
    'what (else )?can (i|you) ask',
    'what can you (do|answer|tell me|help)',
    'what (kind of )?questions can',
    'what (fields|columns|tables|views|datasets)',
    'which (fields|columns|tables|views)',
    "what'?s (in|inside|missing from) (the|this|your)",
    'what is (in|missing from) (the|this|your)',
    "what('s| is) missing",
    'how complete',
    'how (good|reliable|trustworthy) is (the|this|your) data',
    'how much data',
    'how many .{0,30}(are (there )?)?in (the|your) (database|data|dataset|system)',
    "why can'?t you",
    'why cannot you',
    "why (don'?t|do not) you (have|know|show|support)",
    "can('?t)? you (predict|forecast|tell me when|know when)",
    'are you able to',
    'what are your (limits|limitations)',
    'what do you not (have|know)',
    'do you have .{2,40}? (data|field|column|information)',
    'tell me about (the|this|your) (data|database|dataset)',
    'describe (the|this|your) (data|database|dataset)',
  ].join('|'),
  'i',
);

/** "What is X?" — only definitional when X is a known term AND nothing asks for a computation. */
const DEFINITION_WEAK = /^\s*(?:so\s+)?(?:and\s+)?what(?:['’]?s| is| are)\s+(?:a|an|the)?\s*[^?]{2,60}\??\s*$/i;

/** "Explain X" / "tell me about X" — definitional only when X is a term and no "why" is present. */
const EXPLAIN_TERM = /^\s*(?:can you |please )?(?:explain|tell me about|help me understand|clarify)\b/i;

/**
 * Words that mean "compute something over the data". Their presence makes a question a DATA
 * question even when it also names a known term — "what is the average attendance" is a query,
 * "what is attendance" is a definition.
 */
const COMPUTES = /\b(how many|how much|count|number of|list|show|give me|top|worst|best|lowest|highest|weakest|strongest|average|avg|total|sum|percent|percentage|share of|ratio|breakdown|break down|distribution|by division|by programme|by program|by centre|by center|by district|by subject|by gender|compare|trend|per )\b/i;

/** A "why" that is asking about the DATA, not about the system's limits. */
const CAUSAL_WHY = /\bwhy (are|is|do|does|did) (the|these|those|they|it|students|children|centres|centers|attendance|marks|dropout)/i;

export interface RouteResult {
  kind: QuestionKind;
  /** Why it routed this way — logged, and shown in the debug console. */
  reason: string;
  /** Glossary terms the question mentions (definition route). */
  termIds: string[];
}

export function routeQuestion(question: string): RouteResult {
  const q = (question ?? '').trim();
  const terms = findTerms(q);
  const termIds = terms.map((t) => t.id);
  if (!q) return { kind: 'data', reason: 'empty question', termIds: [] };

  // A causal "why … are the students …" is an ANALYTICAL data question, not a question about the
  // system. Checked first so "why is attendance low" never lands in the dataset route.
  if (CAUSAL_WHY.test(q) && !/why can'?t you|why cannot you|why (don'?t|do not) you/i.test(q)) {
    return { kind: 'data', reason: 'causal "why" about the data itself', termIds };
  }

  if (DATASET_STRONG.test(q)) return { kind: 'dataset', reason: 'asks about the data, its coverage, or what the system can do', termIds };
  if (DEFINITION_STRONG.test(q)) return { kind: 'definition', reason: 'asks what something means or how it is worked out', termIds };

  // "Explain the vulnerability score" — definitional. "Explain why attendance is low" — analytical.
  if (EXPLAIN_TERM.test(q) && terms.length > 0 && !/\bwhy\b/i.test(q) && !COMPUTES.test(q)) {
    return { kind: 'definition', reason: `asks to explain a known term (${termIds[0]})`, termIds };
  }

  // "What is coverage?" — only when a known term is named and nothing asks for a computation.
  if (DEFINITION_WEAK.test(q) && terms.length > 0 && !COMPUTES.test(q)) {
    return { kind: 'definition', reason: `plain "what is X" about a known term (${termIds[0]})`, termIds };
  }

  return { kind: 'data', reason: 'answerable by querying the database', termIds };
}
