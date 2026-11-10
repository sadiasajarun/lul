/**
 * DOES THIS TURN POINT AT AN EARLIER ANSWER?
 *
 * Deterministic and precision-first. Returning null means "this question stands on its own", and it
 * then takes today's path completely unchanged, so a miss is never worse than before. A wrong bind
 * would be worse, which is why named scopes unbind, and why every bound answer states its scope.
 */
import { isExplanationRequest } from '../router';
import type { ConversationContext, EntityKind, EntityRef } from './types';

export type FacetKey =
  | 'attendance' | 'results' | 'cycle' | 'dropout' | 'dropout_gender' | 'dropout_income' | 'mainstream'
  | 'gender' | 'income' | 'groups' | 'teachers' | 'monitoring' | 'visits' | 'observations' | 'cmc' | 'cash';

export interface Criterion { metric: string; direction: 'above' | 'below' | 'highest' | 'lowest' }

export type Scope = { kind: 'selected'; entity: EntityRef } | { kind: 'cohort' };

export type Resolved =
  | { type: 'select'; entity: EntityRef }
  | { type: 'take'; n: number; end: 'top' | 'bottom' }
  | { type: 'refine'; criteria: Criterion[]; limit?: number }
  | { type: 'refine_open' }
  | { type: 'facets'; scope: Scope; facets: FacetKey[]; diagnose?: boolean }
  | { type: 'postmortem'; scope: Scope }
  | { type: 'compare'; scope: Scope; target: 'best' | 'worst'; geo: 'district' | 'upazila' }
  | { type: 'compare_similar'; scope: Scope }
  | { type: 'differences'; scope: Scope; n: number; versusBest: boolean }
  | { type: 'contributors'; scope: Scope; n: number }
  | { type: 'controllable'; scope: Scope }
  | { type: 'lessons'; scope: Scope }
  | { type: 'interventions'; scope: Scope; n: number }
  | { type: 'plan'; scope: Scope }
  | { type: 'apply_bottom'; n: number }
  | { type: 'characteristics'; n?: number }
  | { type: 'hypothesis'; step: 'test' | 'evidence' | 'missing' }
  | { type: 'strongest_factor'; scope: Scope }
  | { type: 'clarify'; question: string; options?: EntityRef[] };

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20 };
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const NUMBER = '\\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty';
const KIND_NOUNS: [RegExp, EntityKind][] = [[/\bdistricts?\b/, 'district'], [/\bupazilas?\b/, 'upazila'], [/\bdivisions?\b/, 'division'], [/\bteachers?\b/, 'teacher'], [/\bstudents?\b/, 'student'], [/\bcenters?\b/, 'center']];

const toNumber = (s: string | undefined): number | undefined => (s == null ? undefined : WORDS[s] ?? (/^\d+$/.test(s) ? Number(s) : undefined));

function normalize(q: string): string {
  return q.toLowerCase().replace(/centres?/g, (m) => (m.endsWith('s') ? 'centers' : 'center')).replace(/[’]/g, "'").replace(/[.?!]+\s*$/, '').trim();
}

/** A question that names its own scope is not about the earlier result. */
const UNBINDS = /\b(all|every|entire|whole) (centers?|students?|districts?|divisions?|teachers?|network)\b|\bnationwide\b|\bnetwork.?wide\b|\bacross the (network|country)\b|\b(dhaka|mymensingh|chattogram|rangpur|sylhet)\b/;

/** Asks about a named kind of thing, so it starts a new question even in the middle of a chain. */
const NEW_SUBJECT = /\b(which|top|bottom|list|show) (\d+ )?(divisions?|districts?|upazilas?|centers?|teachers?|students(?! groups))\b|\bhow many\b/;

const REFINE = /\b(among|of|from) (these|those|them|the above)\b|^which of (these|those)\b|\bstill\b.*\bdespite\b/;
const THIS_ENTITY = /\b(this|that|the same) (center|district|upazila|teacher|student)\b|\bthe center's\b/;
const PRONOUN = /\b(it|its)\b/;
const PLURAL = /\b(their|these|those|them|they)\b/;

const FACET_PATTERNS: [FacetKey, RegExp][] = [
  ['dropout_gender', /dropout.*\b(gender|boys?|girls?)\b/],
  ['dropout_income', /dropout.*\bincome\b/],
  ['cycle', /\bbaseline\b|\b(latest|previous) cycle\b|\bcycles?\b|\bimproved?\b|\bimprovement\b|\bover time\b|\bdeclin|\bchanged\b/],
  ['attendance', /\battendance\b|\babsent/],
  ['groups', /\bstudent groups?\b/],
  ['results', /\bstudent (performance|results?)\b|\bresults?\b|\bmarks?\b|\bacademic\b|\bsubjects?\b/],
  ['dropout', /\bdrop ?outs?\b/],
  ['mainstream', /\bmainstream/],
  ['gender', /\b(gender|boys?|girls?)\b/],
  ['income', /\bincome\b/],
  ['teachers', /\bteach(ers?|ing)\b/],
  ['observations', /\bobservations?\b|\bmonitoring\b.*\bhistory\b/],
  ['monitoring', /\bmonitoring\b|\bm&e\b|\bm and e\b/],
  ['visits', /\bvisit(s|ed)?\b|\bmonitoring frequency\b/],
  ['cmc', /\bcmc\b/],
  ['cash', /\bcash\b/],
];

const CONTINUATION = /^(check|now|then|next|also|include|consider|analy[sz]e|look at|review|what about|how about|and)\b/;

/** Edits to the answer on screen. followup.ts already handles these, so they must stay with it. */
const EDIT_REQUEST = /\b(sort|order|rank)\b.*\b(by|on|instead)\b|\bbreak (that|this|it|them) down\b|\bgroup(ed)? (that |this |it |them )?by\b|\bsplit (that|this|it|them) by\b|\badd\b.*\b(factor|driver|column|dimension)\b|\b(remove|drop|exclude)\b|\bshow (me )?more\b|\bfilter\b|^(only|just)\b/;

const METRIC_PATTERNS: [string, RegExp][] = [
  ['dropout_rate_pct', /drop ?out/],
  ['avg_attendance', /attendance/],
  ['avg_mark', /results?|marks?|scores?|academic/],
  ['mainstream_rate_pct', /mainstream/],
  ['visits', /visits?/],
  ['me_score', /monitoring|m&e/],
];

function facetsIn(n: string, previous?: string): FacetKey[] {
  // "Now analyze it by family income": "it" is whatever the last turn was analysing.
  const continuing = previous?.startsWith('dropout') && /\banaly[sz]e it by\b/.test(n);
  const text = continuing ? n.replace(/\banaly[sz]e it by\b/, 'dropout by') : n;
  const found: FacetKey[] = [];
  let rest = text;
  for (const [key, re] of FACET_PATTERNS) {
    if (re.test(rest)) {
      found.push(key);
      if (key === 'dropout_gender') rest = rest.replace(/drop ?outs?|\b(gender|boys?|girls?)\b/g, ' ');
      if (key === 'dropout_income') rest = rest.replace(/drop ?outs?|\bincome\b/g, ' ');
    }
  }
  return found;
}

function parseCriteria(n: string): Criterion[] {
  const out: Criterion[] = [];
  for (const clause of n.split(/,|\band\b|\bbut\b|\bdespite\b|\bwith\b/)) {
    const metric = METRIC_PATTERNS.find(([, re]) => re.test(clause))?.[0];
    if (!metric) continue;
    let direction: Criterion['direction'] | undefined;
    if (/\b(lowest|least|fewest|minimum)\b/.test(clause)) direction = 'lowest';
    else if (/\b(highest|most|maximum|best)\b/.test(clause)) direction = 'highest';
    else if (/\b(above|over|more than|good|strong|high|frequent)\b/.test(clause)) direction = 'above';
    else if (/\b(below|under|less than|weak|poor|low)\b/.test(clause)) direction = 'below';
    if (direction) out.push({ metric, direction });
  }
  return out;
}

function pick(ctx: ConversationContext, which: string): EntityRef | { clarify: string } {
  const list = ctx.list!;
  const label = (i: number) => {
    const item = list.items[i];
    return { kind: list.kind, id: item.id, label: item.label };
  };
  if (which in ORDINALS || /^\d+$/.test(which)) {
    const index = (ORDINALS[which] ?? Number(which)) - 1;
    if (index < 0 || index >= list.items.length) return { clarify: `That list only has ${list.items.length} rows. Which one do you mean?` };
    return label(index);
  }
  if (which === 'last') return label(list.items.length - 1);
  if (which === 'top') return label(0);
  if (which === 'bottom') return label(list.items.length - 1);
  // "worst" and "best" follow the value that ranked the list, not the row position.
  const metric = list.metric;
  const scored = list.items.map((item, i) => ({ item, i })).filter((x) => x.item.value != null);
  if (!metric || !scored.length) return { clarify: `I can't tell which measure makes one "${which}" in that list. Which one do you mean?` };
  const useMax = which === 'highest' || (which === 'best' && metric.betterWhen === 'higher') || (which === 'worst' && metric.betterWhen === 'lower');
  const chosen = scored.reduce((a, b) => ((useMax ? b.item.value! > a.item.value! : b.item.value! < a.item.value!) ? b : a));
  return label(chosen.i);
}

function scopeFor(n: string, ctx: ConversationContext): Scope | null {
  const cohortOk = ctx.cohort?.kind === 'center';
  if (THIS_ENTITY.test(n) && ctx.selected) return { kind: 'selected', entity: ctx.selected };
  if (PRONOUN.test(n) && ctx.live && ctx.selected) return { kind: 'selected', entity: ctx.selected };
  if (PLURAL.test(n) && cohortOk) return { kind: 'cohort' };
  return null;
}

/** The earlier focus a bare continuation like "check attendance first" applies to. */
function liveScope(ctx: ConversationContext): Scope | null {
  if (!ctx.live) return null;
  if (ctx.selected && ['center', 'district'].includes(ctx.selected.kind)) return { kind: 'selected', entity: ctx.selected };
  if (ctx.cohort?.kind === 'center') return { kind: 'cohort' };
  return null;
}

/** A question that only makes sense once a particular center has been chosen. */
const NEEDS_CENTER = /\b(best|worst)(?:[- ]performing)? center in the same (district|upazila)\b|\b(this|that|the same) center\b|\bthe center's\b/;

export interface ResolveOptions {
  /** The last answer showed exactly one center, so "this center" already means something. */
  priorSingleCenter?: boolean;
}

export function resolveTurn(question: string, ctx: ConversationContext | undefined, opts: ResolveOptions = {}): Resolved | null {
  if (!ctx) return null;
  const raw = (question ?? '').trim();
  const n = normalize(raw);
  if (!n || isExplanationRequest(raw)) return null;

  if (ctx.stale && (REFINE.test(n) || THIS_ENTITY.test(n) || /^(select|pick|choose)\b/.test(n))) {
    return { type: 'clarify', question: 'You switched dataset since that answer, so its rows no longer apply. Please ask for the list again here and I will carry on from it.' };
  }

  // A reply to a numbered clarifying question.
  const reply = n.match(/^(?:option |number )?(\d+)$/);
  if (reply && ctx.pending?.length) {
    const chosen = ctx.pending[Number(reply[1]) - 1];
    if (chosen) return { type: 'select', entity: chosen };
  }

  if (UNBINDS.test(n) && !/\bsame\b/.test(n)) return null;

  // ── Selection ─────────────────────────────────────────────────────────────────────────────────
  const ordinalWord = `${Object.keys(ORDINALS).join('|')}|last|worst|best|top|bottom|lowest|highest|\\d+(?:st|nd|rd|th)?`;
  const selection =
    n.match(new RegExp(`^(?:let'?s )?(?:select|pick|choose|go with|take|focus on|open|drill into) (?:the |number )?(${ordinalWord})(?: one| center| district| upazila| division| teacher| student| row| item)?(?: in (?:the|this) list)?$`)) ??
    n.match(new RegExp(`^(?:the )?(${ordinalWord})(?: one)$`));
  if (selection && ctx.list?.items.length) {
    const wanted = KIND_NOUNS.find(([re]) => re.test(n))?.[1];
    if (wanted && wanted !== ctx.list.kind) {
      return { type: 'clarify', question: `The last list shows ${ctx.list.kind}s, not ${wanted}s. Which ${ctx.list.kind} do you mean?`, options: ctx.list.items.slice(0, 10).map((i) => ({ kind: ctx.list!.kind, id: i.id, label: i.label })) };
    }
    // Only "2nd" loses its suffix: stripping it from words turned "second" into "seco".
    const which = selection[1].replace(/^(\d+)(?:st|nd|rd|th)$/, '$1');
    const chosen = pick(ctx, which);
    if ('clarify' in chosen) return { type: 'clarify', question: chosen.clarify, options: ctx.list.items.slice(0, 10).map((i) => ({ kind: ctx.list!.kind, id: i.id, label: i.label })) };
    return { type: 'select', entity: chosen };
  }

  // ── "Show the top five" of what is on screen ──────────────────────────────────────────────────
  const take = n.match(new RegExp(`^(?:show|give|list|keep)(?: me)?(?: only| just)? the (top|first|bottom|last) (${NUMBER})(?: ones?)?(?: of (?:these|those|them))?$`));
  if (take && ctx.list?.items.length) {
    return { type: 'take', n: toNumber(take[2])!, end: take[1] === 'bottom' || take[1] === 'last' ? 'bottom' : 'top' };
  }

  // ── Refinement of the current cohort ──────────────────────────────────────────────────────────
  if (REFINE.test(n) && !/\b(differences?|gaps?|patterns?|lessons?)\b/.test(n) && (ctx.cohort || ctx.list)) {
    const criteria = parseCriteria(n);
    const limit = toNumber(n.match(new RegExp(`\\bwhich (${NUMBER})\\b|\\b(?:top|bottom) (${NUMBER})\\b`))?.slice(1).find(Boolean));
    if (criteria.length && (ctx.cohort?.kind ?? ctx.list?.kind) === 'center') return { type: 'refine', criteria, limit };
    return { type: 'refine_open' };
  }

  const scope = scopeFor(n, ctx);
  const live = liveScope(ctx);
  const focus = scope ?? live;

  // "Compare it with the worst center in the same district" with no center chosen: asking is better
  // than letting the model guess which center, and which district, was meant.
  if (NEEDS_CENTER.test(n) && !focus && !opts.priorSingleCenter) {
    const options = ctx.list?.kind === 'center' ? ctx.list.items.slice(0, 10).map((i) => ({ kind: 'center' as const, id: i.id, label: i.label })) : undefined;
    return {
      type: 'clarify',
      question: options
        ? 'Which center do you mean? Reply with its number from the last list:'
        : 'No center has been selected yet. Ask for a list of centers first, for example "Show me the top 10 best-performing centers.", then select one.',
      options,
    };
  }

  // ── Reasoning over things already derived in this chain ───────────────────────────────────────
  const apply = n.match(new RegExp(`\\bapply (?:them|these|those).*\\bbottom (${NUMBER}) centers?\\b`));
  if (apply && (ctx.derived || ctx.cohort)) return { type: 'apply_bottom', n: toNumber(apply[1])! };

  if (focus) {
    const interventions = n.match(new RegExp(`\\brecommend (?:the )?(?:top |best )?(${NUMBER})?\\s*(?:priority |key )*interventions?\\b`));
    if (interventions) return { type: 'interventions', scope: focus, n: toNumber(interventions[1]) ?? 5 };
    if (/\b(\d+|ninety)[- ]day\b.*\bplan\b|\bimprovement plan\b/.test(n)) return { type: 'plan', scope: focus };
    if (/\bcontrollable\b|\b(management|we) (can )?(realistically )?(address|fix|change)\b|\b(realistically )?replicable\b/.test(n)) return { type: 'controllable', scope: focus };
    if (/\blessons?\b|\bpractices?\b.*\breplicat|\breplicate\b/.test(n)) return { type: 'lessons', scope: focus };
  }

  if (/\bstrongest associated factor\b|\bstrongest factor\b|\bmain associated factor\b/.test(n) && focus) return { type: 'strongest_factor', scope: focus };

  const patternCount = n.match(new RegExp(`\\b(${NUMBER}) (?:strongest |main |top )*(?:recurring )?patterns?\\b`));
  if (ctx.cohort?.kind === 'center' && (patternCount || /\b(common|shared?) (patterns?|characteristics?)\b|\bcharacteristics do\b|\bpatterns do\b/.test(n))) {
    return { type: 'characteristics', n: toNumber(patternCount?.[1]) };
  }

  if (ctx.cohort?.kind === 'center' || ctx.hypothesis) {
    if (/\b(teaching quality|teacher quality)\b.*\b(explanation|explain|reason|cause)\b/.test(n)) return { type: 'hypothesis', step: 'test' };
    if (ctx.hypothesis && /\bevidence\b.*\b(supports?|for)\b/.test(n)) return { type: 'hypothesis', step: 'evidence' };
    if (ctx.hypothesis && /\b(additional|more|extra|other) data\b|\bdata would\b/.test(n)) return { type: 'hypothesis', step: 'missing' };
  }

  // ── Comparison ────────────────────────────────────────────────────────────────────────────────
  const paired = n.match(/\b(best|worst)(?:[- ]performing)? center in the same (district|upazila)\b/);
  if (paired && focus) return { type: 'compare', scope: focus, target: paired[1] as 'best' | 'worst', geo: paired[2] as 'district' | 'upazila' };
  if (focus && /\b(similar|average) centers?\b|\bdifferent from\b/.test(n)) return { type: 'compare_similar', scope: focus };

  const differences = n.match(new RegExp(`\\b(${NUMBER})?\\s*(?:biggest |largest |main |key )+(?:differences?|gaps?)\\b`));
  if (differences && focus) return { type: 'differences', scope: focus, n: toNumber(differences[1]) ?? 5, versusBest: /\bbest center\b/.test(n) };

  // ── Analysis of the current focus ─────────────────────────────────────────────────────────────
  if (!focus) return null;

  const contributors = n.match(new RegExp(`\\b(${NUMBER}) centers? contributing most to dropout\\b`));
  if (contributors && focus.kind === 'selected' && focus.entity.kind !== 'center') return { type: 'contributors', scope: focus, n: toNumber(contributors[1])! };

  if (!scope && (NEW_SUBJECT.test(n) || EDIT_REQUEST.test(n))) return null;

  if (/\bpostmortem\b|^analy[sz]e (this |the )?center\b|\bfull analysis\b/.test(n)) return { type: 'postmortem', scope: focus };

  const diagnose = /\bunderperform|\bperforming well\b|\bpoor performance\b|\bstrongest factors?\b|\bmajor reasons?\b|\bmain problem\b|\bcontributing significantly\b/.test(n);
  const facets = facetsIn(n, ctx.facet);
  if (diagnose) return { type: 'facets', scope: focus, facets, diagnose: true };
  if (!facets.length) return null;
  if (scope || CONTINUATION.test(n) || n.split(/\s+/).length <= 12) return { type: 'facets', scope: focus, facets };
  return null;
}
