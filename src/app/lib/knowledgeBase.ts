/**
 * Knowledge base — typed access + the token-efficient RAG retriever.
 *
 * The AI reads a handful of relevant FACTS (a few hundred tokens) instead of streaming raw CSV
 * rows (megabytes). Facts are pre-computed by scripts/build-knowledge-base.mjs. Row-level CSV
 * lookup (ragHelper) is reserved for "find this specific student/centre" questions only.
 */

import factsJson from "../../../Database/demo/kb/facts.json";
import metricsJson from "../../../Database/demo/kb/metrics.json";
import schemaJson from "../../../Database/demo/kb/schema.json";
import summary from "../../../Database/demo/summary_dataset.json";

export type Lens = "kpi" | "win" | "issue" | "action" | "quality" | "context";
export type Severity = "info" | "watch" | "warn" | "critical";

export interface Fact {
  id: string;
  category: string;
  subject: string;
  lens: Lens;
  severity: Severity;
  statement: string;
  value: number | string;
  unit: string;
  coverage?: number;
  source: string;
  tags: string[];
}

export const KB_VERSION: string = (factsJson as { version: string }).version;
export const FACTS: Fact[] = (factsJson as { facts: Fact[] }).facts;

export interface DecisionMetrics {
  version: string;
  kpis: { id: string; statement: string; value: number | string; unit: string }[];
  wins: { id: string; statement: string }[];
  issues: { id: string; statement: string; severity: Severity }[];
  actions: { id: string; statement: string; severity: Severity }[];
  dataQuality: { id: string; statement: string; severity: Severity }[];
}
export const METRICS = metricsJson as unknown as DecisionMetrics;
export const SCHEMA = schemaJson as unknown as {
  version: string;
  tables: Record<string, unknown>;
  relations: { from: string; to: string; type: string; strength: string; note?: string }[];
  programs: string[];
};

// ── Retrieval ─────────────────────────────────────────────────────────────────

const STOP = new Set([
  "show", "find", "list", "get", "the", "and", "for", "with", "how", "what", "which", "many",
  "average", "total", "data", "about", "give", "me", "of", "in", "is", "are", "by", "per",
  "all", "our", "programme", "program", "dashboard", "please", "a", "an", "to",
]);

/** Query → keyword set (stop-words removed, program aliases normalised). */
export function queryTerms(query: string): string[] {
  const raw = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
  return Array.from(new Set(raw));
}

/**
 * Score a fact against query terms. Tag hits weigh most; lens gives a small decision-intent
 * boost so "problems/issues/risks" surface issue+action facts, "good/well" surfaces wins.
 */
function scoreFact(fact: Fact, terms: string[], weights: Record<string, number>): number {
  let score = 0;
  for (const t of terms) {
    if (fact.tags.includes(t)) score += 3 * (weights[`${fact.lens}:${t}`] ?? weights[t] ?? 1);
    else if (fact.tags.some((tag) => tag.includes(t) || t.includes(tag))) score += 1;
  }
  // decision-intent boosts
  const q = terms.join(" ");
  if (/problem|issue|wrong|risk|concern|bad|low|worst|fail/.test(q) && (fact.lens === "issue" || fact.lens === "quality")) score += 2;
  if (/action|do|fix|improve|where|priorit|focus/.test(q) && fact.lens === "action") score += 2;
  if (/good|well|success|best|strong|win/.test(q) && fact.lens === "win") score += 2;
  if (fact.severity === "critical") score += 0.5;
  return score;
}

export interface Retrieval {
  facts: Fact[];
  factIds: string[];
  /** compact text block for the LLM prompt — grounded, a few hundred tokens */
  context: string;
  version: string;
}

const db = summary as any;
const PROG = ["abal", "catchup", "innovation"] as const;
const progInQuery = (q: string): (typeof PROG)[number] | null =>
  PROG.find((p) => q.includes(p)) ?? null;

/**
 * MICRO DRILL-DOWN: attach exactly ONE relevant structured slice for detail questions
 * (a full dropout breakdown, subject averages, division counts…). This is what lets the AI answer
 * micro-level asks at the right grain without dumping the whole dataset. Returns "" when the query
 * is not a detail question, so simple asks stay lean.
 */
export function retrieveDetail(query: string): string {
  const q = query.toLowerCase();
  const prog = progInQuery(q);
  const asTable = (title: string, obj: Record<string, number | string>) =>
    `### DETAIL DATA — ${title}\n` +
    Object.entries(obj).map(([k, v]) => `- ${k}: ${typeof v === "number" ? v.toLocaleString("en-US") : v}`).join("\n");

  if (/\bdropout|drop out|drop-out|leaving|left|attrition|reason/.test(q)) {
    if (prog) return asTable(`dropout reasons — ${prog}`, db.programs[prog].dropout_reasons);
    // network: sum reasons across programmes
    const merged: Record<string, number> = {};
    for (const p of PROG) for (const [r, n] of Object.entries(db.programs[p].dropout_reasons)) merged[r] = (merged[r] ?? 0) + (n as number);
    return asTable("dropout reasons — all programmes", merged);
  }
  if (/\bsubject|marks?|exam|score|average|bangla|math|english|science|bgs|religion|life skill/.test(q)) {
    const sa = db.subject_averages;
    if (prog && sa[prog]) return asTable(`average marks by subject — ${prog}`, sa[prog]);
    // No programme named → show all three side by side so the answer isn't silently limited to one.
    const subjects = Object.keys(sa.abal ?? {});
    const rows = subjects
      .map((s) => `- ${s}: ABAL ${sa.abal?.[s] ?? "—"} · Catchup ${sa.catchup?.[s] ?? "—"} · Innovation ${sa.innovation?.[s] ?? "—"}`)
      .join("\n");
    return `### DETAIL DATA — average marks by subject (all programmes)\n${rows}`;
  }
  if (/\bdivision|district|geograph|region|where|location/.test(q)) return asTable("enrolment by division", db.divisions);
  if (/\bgrade|class|enrol/.test(q)) return asTable("enrolment by grade", db.grades);
  if (/\bnutrition|health|food|malnutrition/.test(q)) return asTable("nutrition status", db.nutrition);
  if (/\bteacher|educator|staff|qualification|experience|education/.test(q)) {
    if (/experience/.test(q)) return asTable("teacher experience", db.teachers.experience);
    if (/educat|qualif|degree/.test(q)) return asTable("teacher education", db.teachers.education);
    return asTable("teacher gender split", db.teachers.gender);
  }
  if (/\bworst|low attendance|need.*visit|visit/.test(q)) {
    const rows = (db.worst_centers_by_attendance ?? []).slice(0, 10)
      .map((c: any) => `- Center ${c.center_id} (${c.program}): ${c.avg_attendance}%`).join("\n");
    return rows ? `### DETAIL DATA — worst centres by attendance\n${rows}` : "";
  }
  if (/\bpoor bangla|weak bangla|fail/.test(q)) {
    const rows = (db.poor_bangla_students ?? []).slice(0, 15)
      .map((s: any) => `- ${s.name} (${s.student_id}): Bangla ${s.bangla_mark}`).join("\n");
    return rows ? `### DETAIL DATA — lowest Bangla marks\n${rows}` : "";
  }
  return "";
}

/**
 * Select the minimal relevant fact set for a query.
 * @param weights per-term or `lens:term` boosts contributed by the learning loop.
 */
export function retrieveFacts(query: string, limit = 8, weights: Record<string, number> = {}): Retrieval {
  const terms = queryTerms(query);
  const scored = FACTS
    .map((f) => ({ f, s: scoreFact(f, terms, weights) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  // If nothing matched, fall back to the network KPIs so the AI still has grounded context.
  const chosen = (scored.length ? scored.slice(0, limit).map((x) => x.f)
    : FACTS.filter((f) => f.lens === "kpi"));

  const context = ["### GROUNDED FACTS (use only these numbers)", ...chosen.map((f) => `- ${f.statement}`)].join("\n");
  return { facts: chosen, factIds: chosen.map((f) => f.id), context, version: KB_VERSION };
}

/** A concise decision briefing (for the Analysis view / proactive summary). */
export function decisionBriefing(): { kpis: string[]; wins: string[]; issues: string[]; actions: string[] } {
  return {
    kpis: METRICS.kpis.map((m) => m.statement),
    wins: METRICS.wins.map((m) => m.statement),
    issues: METRICS.issues.map((m) => m.statement),
    actions: METRICS.actions.map((m) => m.statement),
  };
}
