// Per-question token + resource accounting, printed to the console. Each model call records its
// token usage (from the provider's usage metadata); ask-browser resets before a question and logs
// a summary after, so you see exactly what each prompt cost (tokens, calls, time).
import { aiLog } from './debug';

export interface CallUsage {
  provider: string;
  model: string;          // the model that served this call (e.g. gemini-2.5-flash, gpt-4o-mini)
  promptTokens: number;   // input/context tokens
  outputTokens: number;   // generated tokens
  totalTokens: number;
  /** Input tokens served from the provider's prompt cache (billed at a discount). */
  cachedTokens?: number;
}

/**
 * List prices per 1M tokens. Used only for the console read-out, so an out-of-date rate misreports
 * the estimate but never affects an answer. Verify against current provider pricing before budgeting.
 */
const PRICE = {
  'gpt-4o':      { in: 2.50, cached: 1.25, out: 10.00 },
  'gpt-4o-mini': { in: 0.15, cached: 0.075, out: 0.60 },
} as const;

/** Rough spend for one question, splitting cached from uncached input. */
export function estimateCost(model: string, promptTokens: number, cachedTokens: number, outputTokens: number): number {
  const p = PRICE[model as keyof typeof PRICE];
  if (!p) return 0;
  const fresh = Math.max(0, promptTokens - cachedTokens);
  return (fresh * p.in + cachedTokens * p.cached + outputTokens * p.out) / 1_000_000;
}

let calls: CallUsage[] = [];

/** Called by each provider after a response; logs that call and accumulates it. */
export function recordUsage(u: CallUsage): void {
  calls.push(u);
  const cached = u.cachedTokens ? `, ${u.cachedTokens} cached` : '';
  aiLog(`💰 ${u.provider} (${u.model}) call — in: ${u.promptTokens} tok${cached}, out: ${u.outputTokens} tok, total: ${u.totalTokens} tok`);
}

export function resetUsage(): void {
  calls = [];
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
  };
}
