// A compact, grounded record of ONE query result the agent gathered. Carried across conversation
// turns (so a follow-up like "why are these students at risk?" reasons over the EXACT prior cohort
// instead of re-deriving it), and attached to the answer for display/debug.
export interface AnswerEvidence {
  /** The validated SQL that produced these rows. */
  sql: string;
  /** Result column names (kept even when rows are truncated, so the shape is always known). */
  columns: string[];
  /** Row objects, capped for the prompt/history budget. */
  rows: Record<string, unknown>[];
  /** Full row count of the underlying result (may exceed rows.length after capping). */
  rowCount: number;
}
