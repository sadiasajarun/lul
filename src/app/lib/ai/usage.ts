// Per-question token + resource accounting, printed to the console. Each model call records its
// token usage (from the provider's usage metadata); ask-browser resets before a question and logs
// a summary after, so you see exactly what each prompt cost (tokens, calls, time).
import { aiLog } from './debug';

export interface CallUsage {
  provider: string;
  promptTokens: number;   // input/context tokens
  outputTokens: number;   // generated tokens
  totalTokens: number;
}

let calls: CallUsage[] = [];

/** Called by each provider after a response; logs that call and accumulates it. */
export function recordUsage(u: CallUsage): void {
  calls.push(u);
  aiLog(`💰 ${u.provider} call — in: ${u.promptTokens} tok, out: ${u.outputTokens} tok, total: ${u.totalTokens} tok`);
}

export function resetUsage(): void {
  calls = [];
}

export function usageSummary() {
  const promptTokens = calls.reduce((s, c) => s + c.promptTokens, 0);
  const outputTokens = calls.reduce((s, c) => s + c.outputTokens, 0);
  return { calls: calls.length, promptTokens, outputTokens, totalTokens: promptTokens + outputTokens };
}
