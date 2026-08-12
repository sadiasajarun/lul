/**
 * Chat answer metadata — the "decision lens" layer from the RAG brief.
 *
 * queryDashboardData() returns only { summary, widgets }; it carries no lens/severity. Rather than
 * change the backend contract, these PURE functions infer the decision framing client-side so the
 * chat can encode it visually (issue → warning accent, action → recommended treatment, win →
 * positive). Inference is keyword-based over the grounded summary + widgets, deliberately simple.
 */

import type { DashboardWidget } from "./openAIHelper";
import type { Lens, Severity } from "../lib/types";
import { matchPlaybook } from "../lib/ai/playbooks";

export interface LensStyle {
  /** Icon key resolved to a lucide component in ChatView (utils must not import components). */
  icon: "target" | "trophy" | "alert" | "compass" | "shield" | "info";
  label: string;
  labelBn: string;
  /** Accent colour — an OOSC token, never a raw hex outside the palette. */
  color: string;
}

export const LENS_STYLE: Record<Lens, LensStyle> = {
  kpi:     { icon: "target",  label: "Key metric",         labelBn: "মূল সূচক",      color: "var(--oo-primary)" },
  win:     { icon: "trophy",  label: "Positive",           labelBn: "ইতিবাচক",       color: "var(--oo-success)" },
  issue:   { icon: "alert",   label: "Issue",              labelBn: "সমস্যা",        color: "var(--oo-danger)" },
  action:  { icon: "compass", label: "Recommended action", labelBn: "প্রস্তাবিত পদক্ষেপ", color: "var(--oo-warning)" },
  quality: { icon: "shield",  label: "Data quality",       labelBn: "তথ্যের মান",    color: "var(--oo-info)" },
  context: { icon: "info",    label: "Context",            labelBn: "প্রেক্ষাপট",    color: "var(--oo-muted)" },
};

/** Severity → the small dot / left-accent colour (distinct scale from the domain bands). */
export const SEVERITY_COLOR: Record<Severity, string> = {
  info:     "var(--oo-muted)",
  watch:    "var(--oo-info)",
  warn:     "var(--oo-warning)",
  critical: "var(--oo-danger)",
};

/** True when the backend plainly said it can't answer and returned no widget. */
export function isRefusal(summary: string, widgets?: DashboardWidget[]): boolean {
  const hasWidgets = Array.isArray(widgets) && widgets.length > 0;
  if (hasWidgets) return false;
  return /can'?t answer|cannot answer|couldn'?t (find|complete)|no (matching )?data|not (available|found|in (the|this) (dataset|data))|unable to|don'?t have/i.test(summary);
}

/** Infer the decision lens from the answer's language and widgets. */
export function inferLens(summary: string, widgets?: DashboardWidget[]): Lens {
  const s = summary.toLowerCase();
  if (/coverage|not decision-ready|unresolved|isn'?t joined|can'?t be joined|record(ed)? as 0|data quality|unusable|withheld/.test(s)) return "quality";
  if (/recommend|should |prioriti|investigate|target|visit first|intervene|next step|action|escalat|route |focus (field|support)/.test(s)) return "action";
  if (/risk|drop|concern|below|stall|poor|worst|deficit|critical|fail|gap|lagging|low(est)?|urgent/.test(s)) return "issue";
  if (/parity|strength|healthy|leads|highest|best|improv|gain|success|above|on track|dominate/.test(s)) return "win";
  const onlyMetric = Array.isArray(widgets) && widgets.length === 1 && widgets[0].type === "metrics";
  return onlyMetric ? "kpi" : "context";
}

/** Infer severity, biased by the lens (a "win" is never critical). */
export function inferSeverity(summary: string, lens: Lens): Severity {
  if (lens === "win") return "info";
  const s = summary.toLowerCase();
  if (/critical|urgent|unusable|broken|stall|can'?t be joined|not decision-ready|0%/.test(s)) return "critical";
  if (/below|poor|worst|low(est)?|concern|risk|deficit|fail|warn/.test(s)) return "warn";
  if (/watch|monitor|thin|limited|caution|partial/.test(s)) return "watch";
  return "info";
}

/**
 * A generic, severity-aware recommendation for ANY analysis that has no specific playbook — so every
 * answer ends in a suggested action ("every query actionable"), grounded in the inferred lens.
 */
export function genericRecommendation(lens: Lens): string {
  switch (lens) {
    case "issue": return "Prioritise the worst cases here and route them to the field team for follow-up.";
    case "quality": return "Treat these figures with caution and close the underlying data gaps before acting on them.";
    case "win": return "A positive signal — note what is working here and replicate it in the weaker areas.";
    case "action": return "Act on the highest-impact item first, then re-check after the intervention.";
    default: return "Use this as a baseline, then drill into the biggest contributor to see what is driving it.";
  }
}

/**
 * A coverage/data-quality caption, shown as honesty (not an error). The demo dataset records
 * attendance for every learner (100% coverage), so there is no coverage caveat to surface — this
 * returns undefined. (Kept as a hook: if a coverage-limited metric is ever reintroduced, flag it here.)
 */
export function coverageCaption(_summary: string, _widgets?: DashboardWidget[]): string | undefined {
  return undefined;
}

/**
 * Drill-down / adjacent-grain follow-ups (the "what next" of the answer shape). Offer questions at
 * a deeper grain than the current one, skipping any dimension the prompt already pinned.
 */
export function deriveFollowups(prompt: string, _widgets?: DashboardWidget[]): string[] {
  // Predictive analyses carry their own drill-down chain (the relational flow) — use it when matched.
  const pb = matchPlaybook(prompt);
  if (pb) return pb.followups.slice(0, 3);

  const p = prompt.toLowerCase();
  const pool: string[] = [];

  const namedProgramme = /(abal|catchup|innovation)/.test(p);
  const topic =
    /dropout|drop out|leaving/.test(p) ? "dropout" :
    /subject|mark|exam|score|result/.test(p) ? "marks" :
    /teacher|instructor|staff/.test(p) ? "teacher" :
    /attendance/.test(p) ? "attendance" :
    /division|district|geograph/.test(p) ? "division" :
    /centre|center|evaluation|audit/.test(p) ? "centre" : "overview";

  if (topic === "dropout") {
    if (!namedProgramme) pool.push("Dropout reasons for Catchup", "Dropout reasons for ABAL");
    pool.push("Which division has the most dropouts?", "Who is eligible for a cash transfer?");
  } else if (topic === "marks") {
    if (!namedProgramme) pool.push("Average marks by subject in Catchup");
    pool.push("Weakest subject across programmes", "Cycle-wise marks progression");
  } else if (topic === "teacher") {
    pool.push("Teacher education levels", "Teacher experience distribution");
  } else if (topic === "attendance") {
    pool.push("Which centres have the lowest attendance?", "Attendance coverage by programme");
  } else if (topic === "division") {
    pool.push("Enrolment by division", "Which programme is weakest in Dhaka?");
  } else if (topic === "centre") {
    pool.push("Which centres need a visit?", "Weakest centre-quality dimension");
  } else {
    pool.push("Compare mainstreaming by programme", "Why are students dropping out?", "Which centres need a visit?");
  }

  // de-dupe + keep it minimal (max 3)
  return Array.from(new Set(pool)).slice(0, 3);
}
