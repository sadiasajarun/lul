// AGENTIC ANALYSIS — turns a raw query result into an INVESTIGATED "why".
//
// The base pipeline answers WHAT (grounded numbers + a chart). For a diagnostic question ("why is X
// low", "what's driving Y"), this layer behaves like an analyst exploring the data:
//   1. proposeInvestigation() — looks at the initial result and decides ONE deeper breakdown that would
//      explain it (e.g. the 5 M&E dimensions, the mark distribution, a by-dimension split).
//   2. ask-browser runs that follow-up through the normal pipeline (so it's validated + grounded).
//   3. analyzeResult() — reasons over BOTH the initial result and the breakdown + the data caveats,
//      and explains the likely reason/drivers + any data-quality artefact.
// Everything is grounded: the model reasons ONLY over rows it was handed; it never invents numbers, and
// the widgets below still show the SQL-grounded figures. Fires only for "why" questions.
import { CAVEATS } from '../db/catalog';
import type { DashboardResponse } from './interpret';
import { extractJson } from './exec';

type Generate = (system: string, user: string) => Promise<string>;

/** True for questions that ask for a REASON, not just a figure. */
export function isDiagnostic(question: string): boolean {
  return /\b(why|reason|explain|cause|because|driver|driving|what'?s behind|account for|root cause)\b/i.test(question);
}

/** Pull the most data-bearing rows out of a response (table/chart rows, or a metric tile folded to a row). */
export function rowsOf(response: DashboardResponse): Record<string, unknown>[] {
  for (const w of response.widgets ?? []) {
    if (Array.isArray(w.data) && w.data.length) return w.data.slice(0, 40);
    if (Array.isArray(w.metricsList) && w.metricsList.length) {
      return [Object.fromEntries(w.metricsList.map((m) => [m.label, m.value]))];
    }
  }
  return [];
}

/** Step 1 — propose ONE follow-up question that would best reveal WHY, or null if the result suffices. */
export async function proposeInvestigation(question: string, response: DashboardResponse, generate: Generate): Promise<string | null> {
  const rows = rowsOf(response);
  if (!rows.length) return null;
  const system = [
    'You are an analyst investigating WHY a finding is what it is, over the NFPE–EMDC education dataset.',
    'Given the QUESTION and the INITIAL RESULT rows, propose ONE follow-up question that would best reveal',
    'the underlying reason — usually a breakdown by a contributing dimension (e.g. the 5 M&E categories:',
    'pedagogy/assessments/documentation/learning environment/community engagement; the mark distribution;',
    'by subject; by income band; by division).',
    'Respond with ONLY JSON: {"question": "<one concise, self-contained follow-up question>"}',
    'or {"question": null} if the initial result already explains the why.',
  ].join('\n');
  const user = `QUESTION: ${question}\n\nINITIAL RESULT (JSON):\n${JSON.stringify(rows).slice(0, 2000)}`;
  try {
    const obj = extractJson<{ question?: string | null }>(await generate(system, user));
    const q = obj?.question;
    return typeof q === 'string' && q.trim().length > 3 ? q.trim() : null;
  } catch {
    return null;
  }
}

/** Step 3 — reasoned insight (markdown bullets) over one or more result groups, or null to keep the summary. */
export async function analyzeResult(question: string, groups: { label: string; rows: Record<string, unknown>[] }[], generate: Generate): Promise<string | null> {
  const useful = groups.filter((g) => g.rows.length);
  if (!useful.length) return null;
  const system = [
    'You are a data analyst for the NFPE–EMDC primary-education programme in Bangladesh.',
    'You are given a QUESTION, one or more RESULT GROUPS a set of queries returned, and DATA CAVEATS.',
    'Respond with ONLY a JSON object: {"insight": "<2 to 4 markdown bullets>"}.',
    'Each bullet starts with "* **label** — " and states the likely REASON / drivers behind the pattern,',
    'plus any data-quality caveat that changes how to read it. Use the breakdown group to name the concrete driver.',
    'Ground everything ONLY in the rows and caveats provided — NEVER invent numbers or facts beyond them.',
    'If the pattern is a data artefact (e.g. mostly zeros = not assessed, or low coverage), say so plainly.',
  ].join('\n');
  const groupsText = useful.map((g) => `--- ${g.label} ---\n${JSON.stringify(g.rows).slice(0, 2400)}`).join('\n\n');
  const user = `QUESTION: ${question}\n\nRESULT GROUPS:\n${groupsText}\n\nDATA CAVEATS:\n${CAVEATS.map((c) => '- ' + c).join('\n')}`;
  try {
    const obj = extractJson<{ insight?: string }>(await generate(system, user));
    return typeof obj?.insight === 'string' && obj.insight.trim().length > 10 ? obj.insight.trim() : null;
  } catch {
    return null;
  }
}
