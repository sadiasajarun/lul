/**
 * Single number-formatting helper (PART 4 rule: no scattered toFixed()).
 * Bengali numeral support is wired here so the C6 bilingual pass has one place to change.
 */

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

export type Lang = "en" | "bn";

/** Convert ASCII digits in a string to Bengali numerals. */
export function toBnNumerals(s: string): string {
  return s.replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

/** Thousands-separated integer. */
export function fmtInt(n: number, lang: Lang = "en"): string {
  const s = Math.round(n).toLocaleString("en-US");
  return lang === "bn" ? toBnNumerals(s) : s;
}

/** Rate with one decimal + % sign. */
export function fmtRate(n: number, lang: Lang = "en", decimals = 1): string {
  const s = `${n.toFixed(decimals)}%`;
  return lang === "bn" ? toBnNumerals(s) : s;
}

/** Fixed-decimal number, no unit. */
export function fmtNum(n: number, lang: Lang = "en", decimals = 1): string {
  const s = n.toFixed(decimals);
  return lang === "bn" ? toBnNumerals(s) : s;
}
