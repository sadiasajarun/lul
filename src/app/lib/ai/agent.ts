// The AGENTIC analyst loop. Replaces the single-shot text-to-SQL + one-hop "why" pass with a bounded
// ReAct loop: each step the model plans ONE read-only SQL query, SEES the real rows, and decides to
// drill further, cross-check, compare, or finish — then a synthesis pass writes the grounded insight.
// Everything grounded flows through the same seam (validateSql → DataSource.query → interpret.toResponse),
// so no number is model-invented. Cross-turn result rows arrive via `history` so follow-ups reason
// over the EXACT prior cohort.
import type { DataSource, QueryResult } from '../db/types';
import { executeValidatedSql, extractJson } from './exec';
import { toResponse, type DashboardResponse, type DashboardWidget, type Intent } from './interpret';
import { renderHistory, buildAgentSystemPrompt, type HistoryTurn } from './prompt';
import { getDbProfile, renderDbProfile } from '../db/profile';
import { CAVEATS } from '../db/catalog';
import { caveatsFor } from './coverage';
import { computeFactors, detectCohort, type FactorResult } from './factors';
import { classifyIntent, classifyTopic, wantsFactorAnalysis } from './intent';
import { buildReasoning, type AnswerReasoning } from './reasoning';
import type { AskResult, Generate } from './pipeline';
import { aiLog } from './debug';

interface Evidence { id: string; sql: string; intent: Intent; title: string; result: QueryResult }

interface AgentAction {
  thought?: string;
  action: 'run_sql' | 'finish' | 'refuse';
  intent?: Intent;
  sql?: string | null;
  title?: string;
  answer_evidence?: string[];
  primary_evidence?: string;
  reason?: string;
}

export interface AgentDeps {
  dataSource: DataSource;
  /** Planner model (each ReAct step). */
  generate: Generate;
  /** Synthesis model (final reasoned insight); defaults to `generate`. */
  synth?: Generate;
  dataMode?: string;
  /** Set when this turn EDITS the previous answer ("only Dhaka", "sort by attendance instead").
   *  Names the previous SQL and the exact change, so continuity does not rely on the model
   *  noticing it from the transcript. See followup.ts. */
  followUpInstruction?: string;
  /** Factor ids the user asked for by name — measured even if they turn out to make no difference. */
  forceFactors?: string[];
}

const MAX_STEPS = Math.max(2, Number(import.meta.env.VITE_AI_AGENT_MAX_STEPS) || 7);
const MAX_FAILED = 3;

function parseAction(raw: string): AgentAction | null {
  const o = extractJson<AgentAction>(raw);
  if (!o || (o.action !== 'run_sql' && o.action !== 'finish' && o.action !== 'refuse')) return null;
  return o;
}

/** Compact projection of gathered evidence for the model's scratchpad. Full results stay in memory. */
function renderEvidence(evidence: Evidence[]): string {
  if (!evidence.length) return '(no queries run yet)';
  return evidence
    .map((e) => {
      const rows = e.result.rows.slice(0, 12);
      return [
        `[${e.id}] ${e.title}  (intent: ${e.intent}, ${e.result.rowCount} rows)`,
        `  sql: ${e.sql.replace(/\s+/g, ' ').trim()}`,
        `  columns: ${e.result.columns.join(', ')}`,
        `  rows: ${JSON.stringify(rows).slice(0, 1800)}`,
      ].join('\n');
    })
    .join('\n\n');
}

function buildAgentUser(question: string, history: HistoryTurn[], evidence: Evidence[], notes: string[], step: number, followUp?: string): string {
  const parts: string[] = [];
  if (history.length) parts.push(renderHistory(history), '');
  parts.push(`QUESTION: ${question}`, '');
  if (followUp) parts.push(followUp, '');
  parts.push('EVIDENCE GATHERED SO FAR:', renderEvidence(evidence), '');
  if (notes.length) parts.push('NOTES / ERRORS from earlier steps (fix and continue):', ...notes.map((n) => '- ' + n), '');
  const last = step >= MAX_STEPS;
  parts.push(
    `Step ${step} of ${MAX_STEPS}. Emit ONE JSON action.` +
      (last ? ' This is the LAST step — you MUST "finish" over the evidence you have (or "refuse" if none of it answers).' : ''),
  );
  return parts.join('\n');
}

function refusalResult(question: string, reason: string): AskResult {
  return { question, intent: 'unsupported', sql: null, refused: true, attempts: 1, response: { summary: reason, widgets: [] } };
}

/** Explain a genuinely EMPTY result in context (data-mode, filters, caveats) instead of a dead-end
 *  "no matching records" — e.g. "In Preview all activity is gap-filled, so no student is a ghost". */
async function explainEmpty(question: string, evidence: Evidence[], dataMode: string, synth: Generate): Promise<string> {
  const sqls = evidence.map((e) => e.sql.replace(/\s+/g, ' ').trim());
  const system = [
    'You are a data analyst. The queries below returned ZERO rows. In 1–2 short markdown bullets',
    '(each starting "* "), explain the MOST LIKELY reason there are no matching records and what the',
    'user can do — grounded in the queries, the DATA MODE, and the caveats. Be specific and concrete',
    '(e.g. "In PREVIEW mode activity is gap-filled, so no student is flagged inactive — switch to Real',
    'to find students with no recorded attendance/marks, though many reflect data gaps"). Never invent numbers.',
    'Reply with ONLY the bullets, no preamble, no JSON.',
  ].join(' ');
  const user = `QUESTION: ${question}\nDATA MODE: ${dataMode}\nQUERIES THAT RETURNED 0 ROWS:\n${sqls.join('\n')}\n\nDATA CAVEATS:\n${caveatsFor(CAVEATS, dataMode).map((c) => '- ' + c).join('\n')}`;
  try { return (await synth(system, user)).trim(); } catch { return ''; }
}

async function synthesize(question: string, evidence: Evidence[], action: AgentAction, synth: Generate, steps: number, dataMode: string, dataSource: DataSource, forceFactors: string[] = []): Promise<AskResult> {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const primary = byId.get(action.primary_evidence ?? '') ?? evidence[evidence.length - 1];
  const chosen = (action.answer_evidence?.length ? action.answer_evidence : [primary.id])
    .map((id) => byId.get(id))
    .filter((e): e is Evidence => !!e);
  const ordered = [primary, ...(chosen.length ? chosen : [primary]).filter((e) => e.id !== primary.id)];

  // Widgets: deterministic, straight from the SQL rows. The agent often runs several overlapping
  // queries on the way to an answer (a count, then the same breakdown with an extra column), so
  // identical widgets are dropped — otherwise the reader gets the same chart and table four times.
  const widgets: DashboardWidget[] = [];
  const seen = new Set<string>();
  for (const e of ordered) {
    for (const w of toResponse(e.title, e.intent, e.result).widgets) {
      const key = `${w.type}|${w.title}|${JSON.stringify(w.tableHeaders ?? w.seriesKeys ?? '')}|${JSON.stringify(w.data ?? w.metricsList ?? '').slice(0, 2000)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      widgets.push(w);
    }
  }

  const totalRows = ordered.reduce((n, e) => n + e.result.rowCount, 0);
  const deterministic = toResponse(primary.title, primary.intent, primary.result).summary;
  let summary: string = deterministic;
  let reasoning: AnswerReasoning | undefined;

  if (totalRows === 0) {
    // Nothing matched: explain WHY in context rather than dead-ending on "no matching records".
    try {
      const why = await explainEmpty(question, ordered, dataMode, synth);
      if (why) summary = why;
    } catch { /* keep the deterministic summary */ }
  } else {
    // LAYER 2 first: measure the cohort this answer identified against the whole network. This is
    // pure SQL, so the factors cannot be fabricated — and an empty list genuinely means "nothing
    // clears the support threshold", which the prose layer is told to respect.
    // The QUESTION'S INTENT decides the answer's shape. Only an analytical ("why") question gets the
    // factor analysis — a retrieval question is complete as data, and bolting reasoning onto it is
    // noise. The topic additionally bans the factor family that would restate the outcome.
    const intent = classifyIntent(question);
    const topic = classifyTopic(question);
    let factors: FactorResult = { drivers: [], protective: null, rejected: [], requested: [], requestedUnavailable: [] };
    let cohortFound = false;
    if (wantsFactorAnalysis(intent) || forceFactors.length) {
      try {
        // The headline evidence is often an AGGREGATE (e.g. the average risk drivers) with no ids in
        // it. The cohort may still be sitting in another query this turn, so search ALL the evidence
        // — largest id set wins — rather than giving up on the primary result alone.
        const candidates = ordered
          .map((e) => detectCohort(e.result.columns, e.result.rows))
          .filter((c): c is NonNullable<typeof c> => !!c)
          .sort((a, b) => b.ids.length - a.ids.length);
        const cohort = candidates[0] ?? null;
        if (cohort) {
          cohortFound = true;
          factors = await computeFactors(dataSource, cohort.entity, cohort.ids, primary.result.columns, topic, forceFactors);
        }
      } catch { /* reasoning must never break the answer */ }
    }
    aiLog(`intent=${intent} topic=${topic} cohort=${cohortFound} drivers=${factors.drivers.length}`);

    try {
      const preview = ordered
        .map((e) => `${e.title} (${e.result.rowCount} rows): ${JSON.stringify(e.result.rows.slice(0, 25)).slice(0, 1800)}`)
        .join('\n');
      reasoning = await buildReasoning(question, intent, deterministic, preview, factors, cohortFound, dataMode, caveatsFor(CAVEATS, dataMode), synth);
      summary = reasoning.finding;
    } catch {
      /* keep the deterministic summary */
    }
  }

  const response: DashboardResponse = { summary, widgets };
  return {
    question,
    intent: primary.intent,
    sql: primary.sql,
    refused: false,
    attempts: steps,
    response,
    reasoning,
    evidence: { sql: primary.sql, columns: primary.result.columns, rows: primary.result.rows.slice(0, 20), rowCount: primary.result.rowCount },
  };
}

/** Run the bounded agentic loop for one user turn. Rate-limit / provider errors bubble up to the
 *  caller (ask-browser), which surfaces them; everything else is handled here. */
export async function runAgent(question: string, deps: AgentDeps, history: HistoryTurn[] = []): Promise<AskResult> {
  const dataMode = deps.dataMode ?? 'real';
  const profile = await getDbProfile(deps.dataSource, dataMode);
  const system = buildAgentSystemPrompt(deps.dataMode, renderDbProfile(profile));
  const synth = deps.synth ?? deps.generate;

  const evidence: Evidence[] = [];
  const notes: string[] = [];
  let failed = 0;

  for (let step = 1; step <= MAX_STEPS; step++) {
    const user = buildAgentUser(question, history, evidence, notes, step, deps.followUpInstruction);
    const raw = await deps.generate(system, user); // errors (rate-limit) bubble up
    const action = parseAction(raw);
    aiLog(`🤖 agent step ${step}/${MAX_STEPS}:`, action?.action ?? 'unparsed', action?.thought ?? '');

    if (!action) {
      notes.push('Your last reply was not a valid JSON action — reply with exactly one JSON action object.');
      continue;
    }
    if (action.action === 'refuse') {
      if (evidence.length && !/monthly|not available|real mode/i.test(action.reason ?? '')) {
        // We DID gather data — answer with it rather than refuse.
        return synthesize(question, evidence, { action: 'finish', answer_evidence: evidence.map((e) => e.id), primary_evidence: evidence[evidence.length - 1].id }, synth, step, dataMode, deps.dataSource, deps.forceFactors ?? []);
      }
      return refusalResult(question, action.reason || 'The available data cannot answer that question.');
    }
    if (action.action === 'finish') {
      if (!evidence.length) return refusalResult(question, action.reason || 'No supporting data was found for that.');
      return synthesize(question, evidence, action, synth, step, dataMode, deps.dataSource, deps.forceFactors ?? []);
    }
    // run_sql
    if (!action.sql) {
      notes.push('run_sql needs a "sql" field. Provide a SELECT or choose finish/refuse.');
      continue;
    }
    try {
      const result = await executeValidatedSql(action.sql, deps.dataSource);
      evidence.push({ id: `e${evidence.length + 1}`, sql: action.sql, intent: (action.intent ?? 'lookup') as Intent, title: action.title || question, result });
    } catch (e) {
      failed += 1;
      notes.push(`Query failed: ${(e as Error).message}. Fix the SQL and try again.`);
      if (failed >= MAX_FAILED) {
        if (evidence.length) return synthesize(question, evidence, { action: 'finish', answer_evidence: evidence.map((ev) => ev.id), primary_evidence: evidence[evidence.length - 1].id }, synth, step, dataMode, deps.dataSource, deps.forceFactors ?? []);
        return refusalResult(question, "I couldn't build a working query for that.");
      }
    }
  }

  // Budget exhausted.
  if (evidence.length) return synthesize(question, evidence, { action: 'finish', answer_evidence: evidence.map((e) => e.id), primary_evidence: evidence[evidence.length - 1].id }, synth, MAX_STEPS, dataMode, deps.dataSource, deps.forceFactors ?? []);
  return refusalResult(question, "I couldn't gather data to answer that within the step budget.");
}
