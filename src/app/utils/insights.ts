/**
 * GROUNDED NARRATIVES (REVAMP C3) — ported from prototype/assets/js/insights.js.
 *
 * "LLM outputs must be grounded in real queries, never free-generated numbers … This one rule
 *  is the difference between a trustworthy analytics copilot and a liability."
 *   — docs/AI_OPPORTUNITY_ROADMAP.md
 *
 * HARD GUARDRAIL: a narrative may only contain numerals that exist in its payload.
 * validateNarrative() proves it; narrate() falls back to a safe template on failure.
 */

import type { Lang } from "../lib/fmt";

/** True only in a dev build. See the note at its call site for why the expression is spelled out. */
function isDev(): boolean {
  try { return Boolean(import.meta.env.DEV); } catch { return false; }
}
import { toBnNumerals } from "../lib/fmt";

/** Bengali numerals → ASCII, so BN text validates against the same payload numbers. */
const BN_TO_ASCII: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

/**
 * Normalize a numeral for comparison: Bengali → ASCII, strip thousands separators and
 * a trailing %, and drop trailing zeros so "86.5" === "86.50".
 */
function normalize(s: string): string {
  const ascii = String(s).replace(/[০-৯]/g, (d) => BN_TO_ASCII[d] ?? d);
  const cleaned = ascii.replace(/,/g, "").replace(/%$/, "").trim();
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return cleaned;
  return String(Math.round(n * 100) / 100);
}

/** Every numeral literally present in the payload (recursively). */
function rawNumbers(payload: unknown): Set<string> {
  const set = new Set<string>();
  const walk = (v: unknown): void => {
    if (v == null) return;
    if (typeof v === "number") { set.add(normalize(String(v))); return; }
    if (typeof v === "string") {
      for (const m of v.match(/-?\d[\d,]*(\.\d+)?/g) ?? []) set.add(normalize(m));
      return;
    }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === "object") { Object.values(v as Record<string, unknown>).forEach(walk); }
  };
  walk(payload);
  return set;
}

/**
 * Numbers a truthful summary may legitimately state that are not LITERALLY in the data:
 * column totals, and each value's share of its column total.
 *
 * Without this the guardrail rejects correct sentences. Real example: the dropout answer says
 * "Poverty … 64,135 students (52.8% of all dropouts)". 64,135 is in the chart data; 52.8 is
 * 64,135 / 121,465 — arithmetic over the same rows, not an invention. Rejecting it replaced a
 * true insight with a useless fallback.
 *
 * Scope is deliberately narrow — sums and shares-of-total only. It does NOT admit arbitrary
 * arithmetic, so a fabricated "94% pass rate" is still caught.
 */
function derivedNumbers(payload: unknown): Set<string> {
  const set = new Set<string>();

  const addPct = (part: number, whole: number) => {
    if (!whole) return;
    const pct = (part / whole) * 100;
    set.add(normalize(String(Math.round(pct * 100) / 100))); // 2dp
    set.add(normalize(String(Math.round(pct * 10) / 10)));   // 1dp — the common case
    set.add(normalize(String(Math.round(pct))));             // 0dp
  };

  const scanRows = (rows: unknown[]): void => {
    const columns = new Map<string, number[]>();
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        const n = typeof v === "number" ? v : parseFloat(String(v));
        if (!Number.isFinite(n)) continue;
        if (!columns.has(k)) columns.set(k, []);
        columns.get(k)!.push(n);
      }
    }
    let grand = 0;
    for (const values of columns.values()) {
      const sum = values.reduce((a, b) => a + b, 0);
      grand += sum;
      set.add(normalize(String(Math.round(sum * 100) / 100)));
      for (const v of values) addPct(v, sum);       // share of its own column
    }
    set.add(normalize(String(Math.round(grand * 100) / 100)));
    for (const values of columns.values()) {
      for (const v of values) addPct(v, grand);     // share of the grand total
    }
  };

  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      if (v.some((x) => typeof x === "object" && x !== null)) scanRows(v);
      v.forEach(walk);
      return;
    }
    if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(payload);
  return set;
}

/** Numerals the payload permits: literally present, or a total/share derived from it. */
export function allowedNumbers(payload: unknown): Set<string> {
  const set = rawNumbers(payload);
  for (const n of derivedNumbers(payload)) set.add(n);
  return set;
}

/**
 * True iff every numeral in `text` is present in `payload`.
 * This is the guardrail: if it returns false, the text is NOT safe to render.
 */
export function validateNarrative(text: string, payload: unknown): boolean {
  const allowed = allowedNumbers(payload);
  const nums = text.match(/-?[\d০-৯][\d০-৯,]*(\.[\d০-৯]+)?/g) ?? [];
  return nums.every((n) => allowed.has(normalize(n)));
}

/** Numerals in `text` that the payload does NOT contain — for diagnostics. */
export function ungroundedNumbers(text: string, payload: unknown): string[] {
  const allowed = allowedNumbers(payload);
  const nums = text.match(/-?[\d০-৯][\d০-৯,]*(\.[\d০-৯]+)?/g) ?? [];
  return [...new Set(nums.filter((n) => !allowed.has(normalize(n))))];
}

/** Last-resort text with no free numbers. Always safe. */
export function safeTemplate(lang: Lang = "en"): string {
  return lang === "bn"
    ? "এই তথ্যের সারসংক্ষেপ তৈরি করা হয়েছে।"
    : "A summary of this data is available.";
}

/**
 * Build a summary FROM the data when a model's text is rejected (REVAMP C3: "on failure,
 * regenerate the summary from a template over the widget data"). Falling back to a bare
 * "a summary is available" throws away an answer the widgets can still support.
 *
 * Every number here is read straight out of the rows, so it is grounded by construction.
 */
export function templateSummary(payload: unknown, lang: Lang = "en"): string {
  const rows = findFirstRowSet(payload);
  if (!rows) return safeTemplate(lang);

  const { labelKey, valueKey, items } = rows;
  if (items.length === 0) return safeTemplate(lang);

  const sorted = [...items].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const total = sorted.reduce((s, r) => s + r.value, 0);
  if (!total) return safeTemplate(lang);

  const share = Math.round((top.value / total) * 1000) / 10;
  const line =
    `* **${top.label}** leads on ${valueKey}, at **${top.value.toLocaleString("en-US")}** ` +
    `(${share}% of the ${total.toLocaleString("en-US")} total across ${sorted.length} ${labelKey} values).`;
  const second = sorted[1]
    ? `\n* **${sorted[1].label}** follows at **${sorted[1].value.toLocaleString("en-US")}**.`
    : "";
  const note = `\n* This summary was generated directly from the returned data.`;

  const text = line + second + note;
  return validateNarrative(text, payload) ? (lang === "bn" ? toBnNumerals(text) : text) : safeTemplate(lang);
}

/** Find the first array of row objects with a label-ish key and a numeric key. */
function findFirstRowSet(
  payload: unknown
): { labelKey: string; valueKey: string; items: { label: string; value: number }[] } | null {
  let found: ReturnType<typeof findFirstRowSet> = null;

  const consider = (arr: unknown[]): void => {
    if (found) return;
    const objs = arr.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
    if (objs.length === 0) return;
    const keys = Object.keys(objs[0]);
    const labelKey = keys.find((k) => typeof objs[0][k] === "string");
    const valueKey = keys.find((k) => Number.isFinite(Number(objs[0][k])) && k !== labelKey);
    if (!labelKey || !valueKey) return;
    const items = objs
      .map((o) => ({ label: String(o[labelKey]), value: Number(o[valueKey]) }))
      .filter((r) => Number.isFinite(r.value));
    if (items.length) found = { labelKey, valueKey, items };
  };

  const walk = (v: unknown): void => {
    if (found) return;
    if (Array.isArray(v)) { consider(v); v.forEach(walk); return; }
    if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(payload);
  return found;
}

/**
 * Validate a candidate narrative (template- or LLM-generated) against its payload.
 * Returns the text if grounded; otherwise a safe fallback. Never returns unvalidated numbers.
 */
export function narrate(text: string, payload: unknown, lang: Lang = "en"): string {
  if (!text?.trim()) return templateSummary(payload, lang);
  if (validateNarrative(text, payload)) return lang === "bn" ? toBnNumerals(text) : text;
  // Written EXACTLY as `import.meta.env.DEV` on purpose. Vite replaces this precise expression with a
  // literal at build time. The optional-chaining form (`import.meta.env?.DEV`) does NOT match that
  // pattern, so Vite falls back to inlining the ENTIRE env object — which shipped every VITE_* value
  // into the public bundle, including API keys for providers this app never calls. The try/catch
  // keeps it safe under plain Node, where import.meta.env does not exist.
  if (isDev()) {
    console.warn("[insights] ungrounded numbers rejected:", ungroundedNumbers(text, payload), "\ntext:", text);
  }
  // Rejected → rebuild from the data rather than discarding the answer entirely.
  return templateSummary(payload, lang);
}
