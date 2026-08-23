/**
 * FOLLOW-UPS THAT MODIFY THE PREVIOUS ANSWER.
 *
 * "Only Chattogram." "Add family income as a factor." "Sort by attendance instead." "Show more."
 * None of these is a question on its own. Each is an EDIT to the answer already on screen, and the
 * user should not have to restate the whole thing to make it.
 *
 * The agent prompt already argues for carrying a cohort forward, but an argument in a prompt is a
 * hope. This detects the edit deterministically, names the exact previous SQL, and states the delta
 * as an instruction — so continuity does not depend on the model noticing.
 *
 * Two things it deliberately does NOT do:
 *   - It never rewrites the SQL itself. The modified question goes back through the normal query
 *     path, so coverage, scale rules, correlation framing and every other guarantee still apply. A
 *     follow-up is not a shortcut around the honesty rules.
 *   - It never guesses at a reference it cannot resolve. If there is nothing to point "that one" at,
 *     it asks a short question instead — which is cheaper and less annoying than a confident answer
 *     to the wrong question.
 */
import type { HistoryTurn } from './prompt';
import { findTerms } from './glossary';

export type ModificationKind =
  | 'filter'      // "only girls", "just Dhaka", "for Catchup"
  | 'unfilter'    // "all students", "remove that filter", "across the whole network"
  | 'add_factor'  // "add family income as a factor"
  | 'drop_factor' // "remove that factor", "without income"
  | 'sort'        // "sort by attendance instead"
  | 'resize'      // "show more rows", "top 5 only"
  | 'regroup'     // "break that down by district"
  | 'drill'       // "why is that one so high?"
  | 'compare';    // "compare that to the best centre"

export interface FollowUp {
  kind: ModificationKind;
  /** The instruction handed to the agent, naming the previous SQL and the change to make. */
  instruction: string;
}

export interface Clarification {
  /** The short question to ask instead of guessing. */
  question: string;
  reason: string;
}

/** Phrases that only make sense as an edit to something already on screen. */
const PATTERNS: { kind: ModificationKind; re: RegExp }[] = [
  { kind: 'unfilter', re: /\b(all|every|whole|entire) (students?|children|centres?|centers?|network|country|dataset)\b|\b(regardless|ignore) (of|the)\b|not just (those|these|them)|remove (that|the) filter|without (that|the) filter|show (me )?everyone|the full list/i },
  { kind: 'add_factor', re: /\badd\b.{0,40}\b(as a |as an )?(factor|driver|dimension|column|variable)\b|\balso (include|consider|show)\b.{0,40}\b(factor|driver|income|attendance|nutrition|disability|work)\b|\binclude\b.{0,30}\b(as a )?(factor|driver)\b/i },
  { kind: 'drop_factor', re: /\b(remove|drop|exclude|take out|without)\b.{0,30}\b(that |the |this )?(factor|driver|one|column)\b|\bignore\b.{0,25}\bfactor\b/i },
  { kind: 'sort', re: /\bsort (by|on)\b|\border (by|it by)\b|\brank (by|them by|it by)\b|\b(by|on) .{2,30}\binstead\b/i },
  { kind: 'resize', re: /\bshow (me )?more\b|\bmore rows\b|\bmore of them\b|\btop \d+\b|\bfirst \d+\b|\bonly \d+\b|\bjust \d+\b|\bfewer\b|\blonger list\b|\bfull list\b/i },
  { kind: 'regroup', re: /\bbreak (that|this|it|them) down\b|\bbreakdown by\b|\bgroup (that|this|it|them)? ?by\b|\bsplit (that|this|it|them) by\b|\bby (district|division|programme|program|centre|center|gender|subject|month|year)\b.{0,20}(instead|now)?$/i },
  { kind: 'drill', re: /\bwhy is (that|this|it|the) ?(one)?\b|\bwhy are (those|these|they)\b|\bwhat about (that|this|those|these) ?(one)?\b|\bwhat'?s going on (there|with (that|those))\b/i },
  { kind: 'compare', re: /\bcompare (that|this|it|them|those)\b|\b(versus|vs\.?) (the|last|best|worst)\b|\bagainst the (best|worst|average|network)\b|\bcompared (to|with) (the|last)\b/i },
  { kind: 'filter', re: /^\s*(only|just|now|and)\b|\bonly (for|in|the)\b|\bjust (for|in|the)\b|\bfor (girls|boys|female|male|catchup|abal|innovation)\b|\bnarrow (it |that )?(down )?to\b|\bfilter (to|by|it to)\b/i },
];

/** A reference to something on screen with no words of its own to stand on. */
const BARE_REFERENCE = /^\s*(why|what|how|show|list|and|but|ok|okay)?\s*(is|are|about|of)?\s*(that|this|those|these|it|them|they|the (one|ones|first|last|top|worst|best))\b/i;

/** Words that carry their own subject, so the question stands alone even if short. */
const SELF_CONTAINED = /\b(student|children|centre|center|teacher|attendance|mark|score|division|district|programme|program|subject|dropout|income|risk|gender|girl|boy)/i;

/** The most recent AI turn that actually returned rows. */
function lastAnswer(history: HistoryTurn[]): HistoryTurn | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i];
    if (t.role === 'ai' && (t.sql || (t.rows && t.rows.length))) return t;
  }
  return null;
}

/** The most recent user question, so the modified question can be phrased against it. */
function lastQuestion(history: HistoryTurn[]): string {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].role === 'user') return history[i].text;
  return '';
}

const HOW_TO_APPLY: Record<ModificationKind, string> = {
  filter: 'ADD the new qualifier to the previous query, keeping every filter it already had. Do not widen the population.',
  unfilter: 'REMOVE the previous cohort filter the user named, and keep everything else. They have explicitly asked to widen, so an explicit instruction outranks the carried context.',
  add_factor:
    'RE-RUN the previous analysis with the requested extra field included, keeping every filter it already had. The extra field must be SELECTED alongside the existing ones so it can be compared, not replace them.',
  drop_factor: 'RE-RUN the previous query WITHOUT the field the user asked to remove, keeping every other filter and column.',
  sort: 'RE-RUN the previous query with a different ORDER BY, changing nothing else. Same filters, same columns, same row limit.',
  resize: 'RE-RUN the previous query with a different LIMIT, changing nothing else. Same filters, same ordering, same columns.',
  regroup: 'RE-RUN the previous query grouped by the new dimension the user named, keeping the same filters and the same measure.',
  drill:
    'The user is pointing at a ROW IN THE PREVIOUS RESULT. Identify which row from the rows above, then query THAT entity\'s driver columns — a student\'s r_* risk drivers, or a centre\'s five monitoring dimensions. Keep the same entity; never switch from students to centres or back.',
  compare:
    'Put the previous result SIDE BY SIDE with what the user named. Return both in one result with a clear label column, so the comparison is visible rather than described.',
};

/**
 * Is this turn an edit to the previous answer? Returns the instruction to hand the agent, or null
 * when the question stands on its own and should be answered fresh.
 */
export function detectFollowUp(question: string, history: HistoryTurn[]): FollowUp | null {
  const q = (question ?? '').trim();
  if (!q || !history.length) return null;
  const prev = lastAnswer(history);
  if (!prev) return null;

  const hit = PATTERNS.find((p) => p.re.test(q));
  if (!hit) return null;

  // A long, fully-specified question that happens to contain "only" is a new question, not an edit.
  const words = q.split(/\s+/).length;
  if (words > 16 && hit.kind === 'filter') return null;

  const prevQ = lastQuestion(history.slice(0, -1)) || '(the previous question)';
  const prevSql = prev.sql ? prev.sql.replace(/\s+/g, ' ').trim() : '(no SQL was recorded for it)';

  const instruction = [
    'THIS TURN IS A MODIFICATION OF THE PREVIOUS ANSWER — not a new question.',
    `The user previously asked: "${prevQ}"`,
    `The SQL that answered it was: ${prevSql}`,
    `They are now asking: "${q}"`,
    `WHAT TO DO: ${HOW_TO_APPLY[hit.kind]}`,
    'Start from the previous SQL above and change only what they asked to change. Every other filter,',
    'qualifier and rule stays exactly as it was. All the usual rules still apply to the new query:',
    'state coverage, never average a 0-5 score against a 0-100 percentage, and use association language.',
    'Say in your title which cohort you are showing, so the user can correct you if they meant something wider.',
  ].join('\n');

  return { kind: hit.kind, instruction };
}

/**
 * Would answering this require guessing what the user meant? Returns the clarifying question to ask.
 *
 * Deliberately narrow. Asking for clarification is only better than answering when we genuinely
 * cannot resolve the reference — a system that asks too often is worse than one that occasionally
 * guesses and shows its working.
 */
export function needsClarification(question: string, history: HistoryTurn[]): Clarification | null {
  const q = (question ?? '').trim();
  if (!q) return null;
  const short = q.split(/\s+/).length <= 6;

  // "why is that one so high?" with nothing on screen to point at.
  if (BARE_REFERENCE.test(q) && !SELF_CONTAINED.test(q)) {
    const prev = lastAnswer(history);
    if (!prev || !(prev.rows && prev.rows.length)) {
      return {
        question:
          "I want to be sure I answer the right thing — there is no earlier result for me to point that at. Which centre, student or measure do you mean?",
        reason: 'reference with no prior result to resolve against',
      };
    }
  }

  // "add income" — add it to WHAT? Only ambiguous when nothing has been answered yet.
  if (short && /^\s*(add|remove|drop|include|exclude|sort|filter|group)\b/i.test(q) && !lastAnswer(history)) {
    return {
      question: 'Happy to — which result should I apply that to? Ask the question first and I will change it from there.',
      reason: 'modification requested before there was anything to modify',
    };
  }

  return null;
}

/**
 * "Add family income as a factor" — which factor did they mean?
 *
 * Returns the glossary/factor terms named in the question, so the analysis can be told to include
 * them even if they would normally fall below the materiality bar. The user asking for a factor
 * explicitly outranks the automatic filter: they want to SEE it, whether or not it turns out to
 * matter — and being shown that it does not matter is a real answer.
 */
export function requestedFactors(question: string): string[] {
  const q = (question ?? '').toLowerCase();
  const named: string[] = [];
  const map: [RegExp, string][] = [
    [/family income|household income|income/, 'household_income_low'],
    [/child labour|child labor|labour work/, 'child_labour'],
    [/working|work type|occupation/, 'working'],
    [/nutrition|eating|food/, 'nutrition_poor'],
    [/disabilit/, 'disability'],
    [/parent.{0,15}education|parents.{0,15}school/, 'parent_no_education'],
    [/housing|land|rent/, 'insecure_housing'],
    [/day labour|day labor|guardian/, 'guardian_day_labour'],
    [/attendance/, 'attendance'],
    [/engagement|parents and the community/, 'engagement'],
    [/pedagogy|teaching quality/, 'pedagogy'],
    [/documentation|record keeping/, 'documentation'],
    [/learning environment|classroom/, 'learning_environment'],
  ];
  for (const [re, id] of map) if (re.test(q) && !named.includes(id)) named.push(id);
  // A named glossary term that is itself a factor family adds nothing new here, but it confirms the
  // user is talking about factors at all rather than, say, a division name.
  if (!named.length && findTerms(q).some((t) => t.id === 'associated_factor')) return [];
  return named;
}
