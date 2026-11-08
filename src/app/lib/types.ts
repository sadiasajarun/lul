/**
 * Shared app types.
 *
 * ViewMode is deliberately small: after the Phase A truth pass, only views backed by real
 * `Database/` data exist. Do not re-add a mode without a real data source behind it.
 */

import type { DynamicDashboardResponse } from "./dashboard-types";
import type { AnswerEvidence } from "./ai/evidence";
import type { AnswerReasoning } from "./ai/reasoning";
import type { TurnDelta } from "./ai/context/types";

export type ViewMode = "overview" | "ai-dashboard" | "chat";

/**
 * The decision "lens" a fact/answer carries (from the RAG brief). It drives the visual accent so a
 * user can tell an issue from a win from a recommended action at a glance — without reading the text.
 */
export type Lens = "kpi" | "win" | "issue" | "action" | "quality" | "context";
export type Severity = "info" | "watch" | "warn" | "critical";

export interface ChatMsg {
  role: "user" | "ai";
  /** The message text: for AI answers this is the grounded summary (markdown bullets). */
  text: string;
  timestamp: string;

  // ── Rich AI-answer fields (optional; only set on answered AI messages) ──────
  /** The full dashboard response — its widgets render inline under the summary. */
  response?: DynamicDashboardResponse | null;
  /** Decision lens + severity → the answer's accent and chip. */
  lens?: Lens;
  severity?: Severity;
  /** Guardrail passed: every number in the summary is present in the data. */
  grounded?: boolean;
  /** Model summary was rejected by the guardrail → a template summary is shown instead. */
  withheld?: boolean;
  /** Answered instantly from the learning cache at zero token cost. */
  cached?: boolean;
  /** The data can't answer this — no fabricated widget was returned. */
  refused?: boolean;
  /** Answered WITHOUT a query: a definition, or a question about the dataset itself. */
  explained?: boolean;
  /** A short clarifying question, asked instead of guessing what a follow-up meant. */
  clarifying?: boolean;
  /** Drill-down / adjacent-grain questions offered under the answer. */
  followups?: string[];
  /** Coverage/quality caption shown as honesty, e.g. attendance is coverage-limited. */
  coverage?: string;
  /** Which engine actually answered (may differ from the provider badge on a silent fallback). */
  engine?: "gemini" | "openai" | "local" | "cache";
  /** True when the chosen provider's call failed and we fell back to the local engine. */
  fellBack?: boolean;
  /** Dataset sources used for this answer (the "Source" action). */
  sources?: string[];
  /** The grounded facts the answer drew on (statement + source). */
  facts?: { statement: string; source: string }[];
  /** The primary query result behind this answer — carried into the next turn's agent context so
   *  follow-ups ("why are THESE at risk?") reason over the exact prior cohort. */
  evidence?: AnswerEvidence;
  /** The four reasoning layers behind this answer (finding / factors / confidence / action). */
  reasoning?: AnswerReasoning;
  /** What this answer contributes to the conversation, so later turns can refer back to it. */
  turn?: TurnDelta;
}

/** A single chat thread in the Copilot's history sidebar. */
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMsg[];
  pinned?: boolean;
  archived?: boolean;
  /** Set when the user manually renames the chat, so auto-titling from the first prompt won't override it. */
  renamed?: boolean;
}

export type ApiProvider = "gemini" | "openai" | "local";
