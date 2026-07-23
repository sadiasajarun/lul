/**
 * Decision rules — the app-side view of the SAME thresholds the knowledge-base builder used.
 *
 * `Database/kb/rules.json` is emitted by scripts/build-knowledge-base.mjs from its canonical
 * RULES object. Importing it here means a decision shown in the UI and a decision baked into a
 * fact can never diverge — "decision points always follow consistency" holds by construction.
 * If a threshold ever needs changing, change it in the builder and re-run `npm run kb`.
 */

import rulesJson from "../../../Database/demo/kb/rules.json";

export interface DecisionRules {
  mainstream: { winAtOrAbovePct: number; issueBelowPct: number };
  attendance: { captionBelowCoveragePct: number; criticalBelowCoveragePct: number; qualityBelowCoveragePct: number };
  centerGrade: { goodAtOrAbove: number; fairAtOrAbove: number; outOf: number };
  genderParity: { minGirlPct: number; maxGirlPct: number };
  smallDivisionBelow: number;
  baselineBands: { maxExclusive: number; band: string }[];
  riskBands: { criticalAtOrAbove: number; highAtOrAbove: number; elevatedAtOrAbove: number };
}

export const RULES: DecisionRules = (rulesJson as { rules: DecisionRules }).rules;

// ── Consistent classifiers — use these everywhere a decision is made ─────────────

export type GradeBand = "Good" | "Fair" | "Poor";
export function centerGradeBand(score: number): GradeBand {
  if (score >= RULES.centerGrade.goodAtOrAbove) return "Good";
  if (score >= RULES.centerGrade.fairAtOrAbove) return "Fair";
  return "Poor";
}

export type MainstreamVerdict = "strong" | "typical" | "underperforming";
export function mainstreamVerdict(ratePct: number): MainstreamVerdict {
  if (ratePct >= RULES.mainstream.winAtOrAbovePct) return "strong";
  if (ratePct < RULES.mainstream.issueBelowPct) return "underperforming";
  return "typical";
}

/** A metric computed over partial data must carry a caption below this coverage. */
export function attendanceNeedsCaption(coveragePct: number): boolean {
  return coveragePct < RULES.attendance.captionBelowCoveragePct;
}

/** Baseline/assessment score band (Red/Yellow/Green/Pink/Blue). */
export function baselineBand(score: number): string {
  for (const b of RULES.baselineBands) if (score < b.maxExclusive) return b.band;
  return RULES.baselineBands[RULES.baselineBands.length - 1].band;
}

/** Dropout-risk tier (A2 semantics). */
export function riskTier(score: number): "critical" | "high" | "elevated" | "low" {
  if (score >= RULES.riskBands.criticalAtOrAbove) return "critical";
  if (score >= RULES.riskBands.highAtOrAbove) return "high";
  if (score >= RULES.riskBands.elevatedAtOrAbove) return "elevated";
  return "low";
}
