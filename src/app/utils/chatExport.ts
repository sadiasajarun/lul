/**
 * Chat export — Markdown / CSV / print-to-PDF, plus read-aloud. No external dependencies:
 * Markdown & CSV download via Blob, PDF via the browser's print dialog (a new window), TTS via
 * the Web Speech API. "Excel" here means .csv (opens in Excel) — a real .xlsx would need a library.
 */

import type { ChatMsg, Conversation } from "../lib/types";
import type { DashboardWidget } from "./openAIHelper";

/** Strip the summary's markdown bullet/bold markers for plain-text contexts. */
export function stripMd(s: string): string {
  return s.replace(/\*\*/g, "").replace(/^\*\s*/gm, "• ");
}

// ── Primary data table ───────────────────────────────────────────────────────
// An export is JUST the answer's data — the list asked for — not the summary + KPI tiles + chart
// dump. Pick the single most relevant data widget: a table, else the chart's data, else metrics.
function primaryTable(widgets?: DashboardWidget[]): { title: string; headers: string[]; rows: Record<string, unknown>[] } | null {
  const ws = widgets ?? [];
  const table = ws.find((w) => w.type === "table" && w.tableHeaders?.length);
  if (table) return { title: table.title, headers: table.tableHeaders as string[], rows: (table.data ?? []) as Record<string, unknown>[] };
  const chart = ws.find((w) => w.type === "chart" && Array.isArray(w.data) && w.data.length);
  if (chart) {
    const cols = [chart.xAxisKey, ...(chart.seriesKeys ?? [])].filter(Boolean) as string[];
    return { title: chart.title, headers: cols, rows: (chart.data ?? []) as Record<string, unknown>[] };
  }
  const metrics = ws.find((w) => w.type === "metrics" && w.metricsList?.length);
  if (metrics) return { title: metrics.title, headers: ["Metric", "Value", "Note"], rows: (metrics.metricsList ?? []).map((k) => ({ Metric: k.label, Value: k.value, Note: k.sub ?? "" })) };
  return null;
}

// ── Markdown ────────────────────────────────────────────────────────────────
export function messageToMarkdown(m: ChatMsg): string {
  let out = `${m.text}\n`;
  const t = primaryTable(m.response?.widgets);
  if (t) {
    out += `\n**${t.title}**\n\n| ${t.headers.join(" | ")} |\n|${t.headers.map(() => "---").join("|")}|\n`;
    for (const r of t.rows) out += `| ${t.headers.map((h) => String(r[h] ?? "")).join(" | ")} |\n`;
  }
  if (m.sources?.length) out += `\n> Sources: ${m.sources.join(", ")}\n`;
  return out;
}

export function conversationToMarkdown(c: Conversation): string {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  let out = `# ${c.title}\n_Generated ${date} · NFPE / EMDC — Bangladesh · grounded to Database/_\n`;
  for (const m of c.messages) {
    if (m.role === "user") out += `\n---\n\n**🗨️ ${m.text}**\n`;
    else out += `\n${messageToMarkdown(m)}`;
  }
  return out;
}

// ── CSV ───────────────────────────────────────────────────────────────────────
function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of a single answer = JUST the list it asked for (the primary data table), nothing else. */
export function messageToCsv(m: ChatMsg): string {
  const t = primaryTable(m.response?.widgets);
  if (t) {
    const rows = [t.headers.map(csvCell).join(",")];
    for (const r of t.rows) rows.push(t.headers.map((h) => csvCell(r[h])).join(","));
    return rows.join("\n");
  }
  return `Answer\n${csvCell(stripMd(m.text))}`;
}

/** Excel of a conversation = the ANSWER DATA (each answer's list table under its question), NOT the
 *  Time/Role/Message transcript. One answer → just that table. */
export function conversationToCsv(c: Conversation): string {
  const blocks: string[] = [];
  for (let i = 0; i < c.messages.length; i++) {
    if (c.messages[i].role !== "ai") continue;
    const t = primaryTable(c.messages[i].response?.widgets);
    if (!t) continue;
    let q = "";
    for (let j = i - 1; j >= 0; j--) if (c.messages[j].role === "user") { q = c.messages[j].text; break; }
    const rows = [t.headers.map(csvCell).join(",")];
    for (const r of t.rows) rows.push(t.headers.map((h) => csvCell(r[h])).join(","));
    blocks.push((q ? `${csvCell(q)}\n` : "") + rows.join("\n"));
  }
  if (blocks.length) return blocks.join("\n\n");
  // No data tables in the conversation → a simple question/answer list (still not a raw transcript).
  const qa = ["Question,Answer"];
  c.messages.forEach((m, i) => {
    if (m.role !== "user") return;
    const ai = c.messages.slice(i + 1).find((x) => x.role === "ai");
    qa.push([m.text, ai ? stripMd(ai.text).replace(/\n/g, " ") : ""].map(csvCell).join(","));
  });
  return qa.join("\n");
}

// ── HTML (for print → PDF) ──────────────────────────────────────────────────
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
function textToHtml(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/^\*\s*/, "").trim())
    .filter(Boolean)
    .map((l) => `<p>• ${esc(l.replace(/\*\*/g, ""))}</p>`)
    .join("");
}
export function messageToHtml(m: ChatMsg): string {
  let h = textToHtml(m.text);
  const t = primaryTable(m.response?.widgets);
  if (t) {
    h += `<h3>${esc(t.title)}</h3><table><tr>${t.headers.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
    for (const r of t.rows) h += `<tr>${t.headers.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`;
    h += `</table>`;
  }
  if (m.sources?.length) h += `<blockquote>Sources: ${esc(m.sources.join(", "))}</blockquote>`;
  return h;
}
export function conversationToHtml(c: Conversation): string {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  let h = `<h1>${esc(c.title)}</h1><div class="meta">Generated ${date} · NFPE / EMDC — Bangladesh · <span class="badge">Grounded</span></div>`;
  for (const m of c.messages) {
    if (m.role === "user") h += `<div class="msg"><div class="q">Q: ${esc(m.text)}</div></div>`;
    else h += `<div class="msg">${messageToHtml(m)}</div>`;
  }
  return h;
}

/** Print/PDF of JUST the latest exchange — the most recent answer and the question that produced it,
 *  NOT the whole conversation history. Returns just the header if no answer exists yet. */
export function latestExchangeToHtml(c: Conversation): string {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  let h = `<h1>${esc(c.title)}</h1><div class="meta">Generated ${date} · NFPE / EMDC — Bangladesh · <span class="badge">Grounded</span></div>`;
  let i = -1;
  for (let k = c.messages.length - 1; k >= 0; k--) if (c.messages[k].role === "ai") { i = k; break; }
  if (i === -1) return h;
  let q = "";
  for (let j = i - 1; j >= 0; j--) if (c.messages[j].role === "user") { q = c.messages[j].text; break; }
  if (q) h += `<div class="msg"><div class="q">Q: ${esc(q)}</div></div>`;
  h += `<div class="msg">${messageToHtml(c.messages[i])}</div>`;
  return h;
}

/** A condensed summary of a whole conversation — each question paired with its answer's headline. */
export function conversationSummary(c: Conversation): { md: string; html: string } {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const items: { q: string; a: string }[] = [];
  c.messages.forEach((m, i) => {
    if (m.role !== "user") return;
    const ai = c.messages.slice(i + 1).find((x) => x.role === "ai");
    const first = ai ? (stripMd(ai.text).split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "") : "";
    items.push({ q: m.text, a: first });
  });
  const body = items.length ? items : [{ q: "No questions asked yet.", a: "" }];
  const md = `# Summary — ${c.title}\n_${date} · NFPE / EMDC — grounded to Database/_\n\n` +
    body.map((x) => (x.a ? `- **${x.q}** — ${x.a}` : `- ${x.q}`)).join("\n");
  const html = `<h1>Summary — ${esc(c.title)}</h1><div class="meta">${date} · NFPE / EMDC — grounded to Database/</div>` +
    `<ul>${body.map((x) => `<li><b>${esc(x.q)}</b>${x.a ? ` — ${esc(x.a)}` : ""}</li>`).join("")}</ul>`;
  return { md, html };
}

// ── Download / print / speak ────────────────────────────────────────────────
export function download(name: string, text: string, mime: string): boolean {
  try {
    // Excel: a UTF-8 BOM fixes garbled names/symbols, and "sep=," forces comma columns in every
    // locale (otherwise semicolon-locale Excel dumps every row into one cell).
    const isCsv = /csv/i.test(mime) || /\.csv$/i.test(name);
    const BOM = String.fromCharCode(0xfeff);
    const payload = isCsv ? BOM + "sep=,\r\n" + text.replace(/\r?\n/g, "\r\n") : text;
    const blob = new Blob([payload], { type: isCsv ? "text/csv;charset=utf-8" : mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** Print an HTML report via a new window (→ the browser's Save as PDF). */
export function printHtml(bodyHtml: string, title = "Report"): void {
  const w = window.open("", "_blank", "width=840,height=1000");
  if (!w) return;
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
      `<style>` +
      `*{box-sizing:border-box}body{font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;color:#12172a;margin:32px;line-height:1.5}` +
      `h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}h3{font-size:13px;color:#475069;margin:16px 0 6px}` +
      `.meta{font-size:11px;color:#7a8397;margin-bottom:18px}` +
      `table{border-collapse:collapse;width:100%;margin:8px 0;font-size:12px}` +
      `th,td{border:1px solid #e5e9f2;padding:6px 9px;text-align:left}th{background:#f4f6fb;font-weight:600}` +
      `.msg{margin:0 0 16px}.q{font-weight:700;color:#5b62e0}.badge{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;padding:2px 8px;border-radius:20px;background:#eef0fe;color:#5b62e0}` +
      `blockquote{color:#7a8397;font-size:11px;border-left:3px solid #e5e9f2;margin:8px 0;padding:2px 10px}` +
      `@media print{body{margin:12mm}}` +
      `</style></head><body>${bodyHtml}</body></html>`
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}

let speaking = false;
export function speak(text: string): void {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!synth) return;
  if (speaking) {
    synth.cancel();
    speaking = false;
    return;
  }
  const u = new SpeechSynthesisUtterance(stripMd(text).replace(/•/g, ""));
  u.rate = 1;
  u.onend = () => {
    speaking = false;
  };
  speaking = true;
  synth.speak(u);
}
