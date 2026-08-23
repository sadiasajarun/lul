// The /ask pipeline orchestrator: question → (LLM) SQL plan → validate → execute → self-correct
// → interpret. Engine-agnostic: it takes a `DataSource` and a `generate` function, so the same
// pipeline runs in the browser (DuckDB-wasm + Gemini) and in the Node eval harness.
import type { DataSource } from '../db/types';
import { validateSql } from './validate';
import { buildSystemPrompt, buildUserPrompt, buildFixPrompt, type HistoryTurn } from './prompt';
import { toResponse, type DashboardResponse, type Intent } from './interpret';
import { aiLog } from './debug';
import { ProviderError } from './openai';
import type { AnswerEvidence } from './evidence';
import type { AnswerReasoning } from './reasoning';

/** True when an error is a provider rate-limit / quota exhaustion (429/503). */
function isRateLimitError(e: unknown): { limited: boolean; retryMs?: number } {
  if (e instanceof ProviderError && (e.status === 429 || e.status === 503)) return { limited: true, retryMs: e.retryAfterMs };
  const msg = (e as Error)?.message ?? '';
  return { limited: /\b429\b|\b503\b|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(msg) };
}

/** A function that returns the model's raw JSON text for (system, user) prompts. */
export type Generate = (system: string, user: string) => Promise<string>;

export interface QueryPlan { intent: Intent; sql: string | null; title: string }

export interface AskResult {
  question: string;
  intent: Intent;
  /** The SQL that actually ran (validated + row-capped), or null if refused. */
  sql: string | null;
  response: DashboardResponse;
  refused: boolean;
  /** Present when the pipeline could not produce a runnable/answerable query. */
  error?: string;
  attempts: number;
  /** Which model provider answered (set by the browser entry): 'gemini' | 'openai' | 'none'. */
  provider?: string;
  /** True when the failure was a provider rate-limit (429/503) — surfaced clearly to the user. */
  rateLimited?: boolean;
  /** The primary query result behind the answer — carried into the next turn (agent path only). */
  evidence?: AnswerEvidence;
  /** The four-layer answer: finding -> associated factors -> confidence -> action. */
  reasoning?: AnswerReasoning;
  /** Answered from the answer cache at zero model cost (agent path only). */
  cached?: boolean;
  /** Answered WITHOUT a query — a definition, or a question about the dataset itself. */
  explained?: boolean;
  /** A short clarifying question was asked instead of guessing what the user meant. */
  clarifying?: boolean;
}

const MAX_ATTEMPTS = 3;

// Print the full system prompt to the console once per session (dev only) so it's visible
// without calling anything. Use showSystemPrompt() to reprint it on demand.
let promptLogged = false;

/** Extract the JSON plan from the model text (tolerates ```json fences / surrounding prose). */
export function parsePlan(text: string): QueryPlan {
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  const obj = JSON.parse(t) as Partial<QueryPlan>;
  const intent = (obj.intent ?? 'lookup') as Intent;
  const sql = obj.sql == null || obj.sql === '' ? null : String(obj.sql);
  return { intent, sql, title: obj.title ?? '' };
}

function refusal(question: string, title: string, intent: Intent = 'unsupported'): AskResult {
  const msg = title || 'The available data cannot answer that question.';
  return { question, intent, sql: null, refused: true, attempts: 1, response: { summary: msg, widgets: [] } };
}

export async function askQuestion(
  question: string,
  deps: { dataSource: DataSource; generate: Generate; dataMode?: string },
  history: HistoryTurn[] = [],
): Promise<AskResult> {
  const system = buildSystemPrompt(deps.dataMode);
  let user = buildUserPrompt(question, history);
  let lastError = '';
  let plan: QueryPlan | null = null;

  aiLog('❓ Question:', question);
  if (!promptLogged) {
    promptLogged = true;
    aiLog(`📜 FULL SYSTEM PROMPT (${system.length} chars, shown once per session):\n\n${system}`);
  } else {
    aiLog('📜 System prompt reused —', `${system.length} chars. Type showSystemPrompt() to reprint.`);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      const t0 = performance.now();
      raw = await deps.generate(system, user);
      aiLog(`⏱️ model call: ${(performance.now() - t0).toFixed(0)} ms`);
      plan = parsePlan(raw);
    } catch (e) {
      // Rate-limit: do NOT retry (that only burns more calls). Return a clear message immediately.
      const rl = isRateLimitError(e);
      if (rl.limited) {
        const secs = rl.retryMs ? Math.ceil(rl.retryMs / 1000) : null;
        aiLog('⛔ Rate-limited — not retrying.', (e as Error).message);
        return {
          question, intent: 'unsupported', sql: null, refused: true, rateLimited: true, attempts: attempt,
          error: (e as Error).message,
          response: {
            summary: `⏳ The AI is temporarily rate-limited${secs ? ` — please try again in about ${secs} second${secs === 1 ? '' : 's'}` : ', please try again in a moment'}. ` +
              `(Gemini's free tier allows ~20 requests per minute.)`,
            widgets: [],
          },
        };
      }
      lastError = `model/parse error: ${(e as Error).message}`;
      aiLog(`⚠️ Attempt ${attempt}: model/parse error → retrying`, lastError);
      user = buildFixPrompt(question, plan?.sql ?? '(none)', lastError);
      continue;
    }

    // Model declined — data can't answer it. Trust it (no fabricated widget).
    if (plan.intent === 'unsupported' || !plan.sql) {
      aiLog('🚫 Model refused (unsupported):', plan.title);
      return refusal(question, plan.title, plan.intent);
    }

    aiLog(`🧠 Attempt ${attempt}: model wrote SQL (intent=${plan.intent})\n`, plan.sql);

    const check = validateSql(plan.sql);
    if (!check.ok) {
      lastError = check.error ?? 'invalid SQL';
      aiLog(`⛔ Validation failed → self-correcting:`, lastError);
      user = buildFixPrompt(question, plan.sql, lastError);
      continue;
    }

    try {
      const q0 = performance.now();
      const result = await deps.dataSource.query(check.sql);
      aiLog(`⏱️ SQL execution: ${(performance.now() - q0).toFixed(0)} ms (in-browser DuckDB)`);
      const title = plan.title || question;
      aiLog(`✅ Executed OK — ${result.rowCount} row(s):`, result.rows.slice(0, 5));
      return {
        question, intent: plan.intent, sql: check.sql, refused: false, attempts: attempt,
        response: toResponse(title, plan.intent, result),
      };
    } catch (e) {
      lastError = `SQL execution error: ${(e as Error).message}`;
      aiLog(`↻ SQL error → feeding it back to the model to fix:`, lastError);
      user = buildFixPrompt(question, check.sql, lastError);
    }
  }

  // Exhausted retries — fail honestly rather than guess.
  return {
    question, intent: plan?.intent ?? 'unsupported', sql: plan?.sql ?? null,
    refused: true, attempts: MAX_ATTEMPTS, error: lastError,
    response: { summary: `I couldn't build a reliable query for that (${lastError}).`, widgets: [] },
  };
}
