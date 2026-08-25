// Per-question token + resource accounting, printed to the console. Each model call records its
// token usage (from the provider's usage metadata); ask-browser resets before a question and logs
// a summary after, so you see exactly what each prompt cost (tokens, calls, time).
import { aiLog } from './debug';

export interface CallUsage {
  provider: string;
  model: string;          // the model that served this call (e.g. gpt-4o-mini)
  promptTokens: number;   // input/context tokens
  outputTokens: number;   // generated tokens
  totalTokens: number;
  /** Input tokens served from the provider's prompt cache (billed at a discount). */
  cachedTokens?: number;
  /** The endpoint actually called, so the console shows which API was hit, not just a label. */
  endpoint?: string;
}

/** A call the API rejected. Recorded so a failure is VISIBLE instead of being swallowed by failover. */
export interface CallFailure {
  provider: string;
  model: string;
  endpoint: string;
  status: number;         // HTTP status (400, 401, 429, 503 …)
  message: string;        // the provider's own error text, trimmed
  at: number;
}

/**
 * List prices per 1M tokens. Used only for the console read-out, so an out-of-date rate misreports
 * the estimate but never affects an answer. Verify against current provider pricing before budgeting.
 */
const PRICE = {
  'gpt-4o':      { in: 2.50, cached: 1.25, out: 10.00 },
  'gpt-4o-mini': { in: 0.15, cached: 0.075, out: 0.60 },
} as const;

/** True when we have no list price for this model, so a $0.0000 read-out means "unknown", not "free". */
export function isUnpriced(model: string): boolean {
  return !!model && !(model in PRICE);
}

/** Rough spend for one question, splitting cached from uncached input. */
export function estimateCost(model: string, promptTokens: number, cachedTokens: number, outputTokens: number): number {
  const p = PRICE[model as keyof typeof PRICE];
  if (!p) return 0;
  const fresh = Math.max(0, promptTokens - cachedTokens);
  return (fresh * p.in + cachedTokens * p.cached + outputTokens * p.out) / 1_000_000;
}

let calls: CallUsage[] = [];
let failures: CallFailure[] = [];

// Session running totals. These deliberately survive resetUsage() (which clears the PER-QUESTION
// counters) so the console can show what the whole session has cost, not just the last question.
const session = { questions: 0, calls: 0, failures: 0, promptTokens: 0, outputTokens: 0, cachedTokens: 0, cost: 0 };

/** Called by each provider after a response; logs that call and accumulates it. */
export function recordUsage(u: CallUsage): void {
  calls.push(u);
  session.calls += 1;
  session.promptTokens += u.promptTokens;
  session.outputTokens += u.outputTokens;
  session.cachedTokens += u.cachedTokens ?? 0;
  session.cost += estimateCost(u.model, u.promptTokens, u.cachedTokens ?? 0, u.outputTokens);
  const cached = u.cachedTokens ? `, ${u.cachedTokens} cached` : '';
  aiLog(`💰 ${u.provider} (${u.model}) call — in: ${u.promptTokens} tok${cached}, out: ${u.outputTokens} tok, total: ${u.totalTokens} tok`);
}

/** Called by a provider when the API rejects a call. Without this a 400/503 is invisible: the
 *  failover layer catches it and moves on, so the console shows a slow answer with no reason. */
export function recordFailure(f: Omit<CallFailure, 'at'>): void {
  failures.push({ ...f, at: Date.now() });
  session.failures += 1;
  aiLog(`⛔ ${f.provider} (${f.model}) HTTP ${f.status} — ${f.message}`);
}

export function resetUsage(): void {
  calls = [];
  failures = [];
  session.questions += 1;
}

/** Cumulative totals for the whole browser session. Read by the aiStats() console helper. */
export function sessionTotals() {
  return { ...session, totalTokens: session.promptTokens + session.outputTokens };
}

export function usageSummary() {
  const promptTokens = calls.reduce((s, c) => s + c.promptTokens, 0);
  const outputTokens = calls.reduce((s, c) => s + c.outputTokens, 0);
  const cachedTokens = calls.reduce((s, c) => s + (c.cachedTokens ?? 0), 0);
  const lastCall = calls[calls.length - 1];
  const cost = calls.reduce((s, c) => s + estimateCost(c.model, c.promptTokens, c.cachedTokens ?? 0, c.outputTokens), 0);
  return {
    calls: calls.length,
    promptTokens,
    outputTokens,
    cachedTokens,
    cost,
    totalTokens: promptTokens + outputTokens,
    lastModel: lastCall?.model ?? '',
    lastProvider: lastCall?.provider ?? '',
    lastEndpoint: lastCall?.endpoint ?? '',
    failures: [...failures],
    unpriced: isUnpriced(lastCall?.model ?? ''),
  };
}
