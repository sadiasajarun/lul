// Browser entry to the /ask pipeline. Wires the in-browser DuckDB-wasm engine to a resilient,
// multi-provider LLM caller (Gemini preferred, OpenAI failover on rate-limit). App.tsx calls
// askViaPipeline(); it no longer needs to know about keys or providers.
import { getDataSource, getDataMode } from '../db';
import { makeGeminiGenerate } from './gemini';
import { makeOpenAiGenerate } from './openai';
import { makeResilientGenerate, type Provider, type ResilientGenerate } from './resilient';
import { askQuestion, type AskResult } from './pipeline';
import { buildSystemPrompt, type HistoryTurn } from './prompt';
import { resetUsage, usageSummary } from './usage';
import { recordRefusal, listRefusals, exportRefusals, clearRefusals } from './refusal-log';

// Console helpers for inspecting the pipeline live:
//   showSystemPrompt()  → prints the exact system prompt sent to the model
//   aiDebug(false)      → turn the [AI] stage logs off (aiDebug(true) to re-enable)
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.showSystemPrompt = () => { console.log(buildSystemPrompt()); return `system prompt printed (${buildSystemPrompt().length} chars)`; };
  w.aiDebug = (on = true) => { try { localStorage.setItem('aiDebug', on ? '1' : '0'); } catch { /* ignore */ } return `AI debug logging ${on ? 'ON' : 'OFF'}`; };
  // Layer 3 — inspect the questions the pipeline has declined (real usage → test backlog):
  w.showRefusals = () => {
    const l = listRefusals();
    console.table(l.map((e) => ({ q: e.q, reason: e.reason.slice(0, 60), intent: e.intent, mode: e.mode, when: new Date(e.ts).toISOString() })));
    return `${l.length} refusal(s) logged`;
  };
  w.exportRefusals = () => exportRefusals();
  w.clearRefusals = () => { clearRefusals(); return 'refusal log cleared'; };
  // Live AI monitor — on by default; prints provider + model + tokens after every question.
  w.aiMonitor = (on = true) => { try { localStorage.setItem('aiMonitor', on ? '1' : '0'); } catch { /* ignore */ } return `AI monitor ${on ? 'ON' : 'OFF'}`; };
}

/** Friendly label for a provider slot name. */
const PROVIDER_LABEL: Record<string, string> = {
  gemini: 'Gemini · key 1',
  'gemini-2': 'Gemini · key 2',
  openai: 'OpenAI',
};

/**
 * LIVE MONITOR — prints, after every question, which API served it, which model, and how many
 * tokens it cost, plus the live failover status of each provider. On by default; silence with
 * `aiMonitor(false)` in the console.
 */
function printAiMonitor(r: ResilientGenerate, u: ReturnType<typeof usageSummary>, ms: number, refused: boolean): void {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('aiMonitor') === '0') return;
    const who = PROVIDER_LABEL[r.lastProvider] ?? r.lastProvider ?? '—';
    const num = (n: number) => n.toLocaleString();
    const status = r.status()
      .map((s) => `${PROVIDER_LABEL[s.name] ?? s.name}${s.coolingDown ? ` ⏳${s.secondsLeft}s` : ' ✓'}`)
      .join('   ');
    const body = [
      `%c🛰 AI MONITOR%c  ${refused ? '⚠ refused' : '✓ answered'}`,
      `   API used : ${who}`,
      `   model    : ${u.lastModel || '—'}`,
      u.calls
        ? `   tokens   : ${num(u.totalTokens)}  (in ${num(u.promptTokens)} · out ${num(u.outputTokens)})`
        : `   tokens   : — (no model call succeeded)`,
      `   calls    : ${u.calls} · ${ms.toFixed(0)} ms`,
      `   failover : ${status}`,
    ].join('\n');
    // eslint-disable-next-line no-console
    console.log(body, 'font-weight:bold;color:#4C5FE4', 'font-weight:normal;color:inherit');
  } catch { /* never let the monitor break a response */ }
}

const ENV = {
  provider: ((import.meta.env.VITE_AI_PROVIDER as string) || 'gemini').toLowerCase(),
  geminiKey: import.meta.env.VITE_GEMINI_API_KEY || '',
  geminiKey2: (import.meta.env.VITE_GEMINI_API_KEY_2 as string) || '',
  geminiModel: (import.meta.env.VITE_GEMINI_MODEL as string) || 'gemini-2.5-flash',
  openaiKey: import.meta.env.VITE_OPENAI_API_KEY || '',
  openaiModel: (import.meta.env.VITE_OPENAI_MODEL as string) || 'gpt-4o-mini',
};

// One resilient caller for the whole session, so provider cooldowns persist across questions.
let resilient: ResilientGenerate | null = null;
function getResilient(): ResilientGenerate {
  if (resilient) return resilient;
  // Build each provider's slot(s), then order by VITE_AI_PROVIDER: the named provider is PRIMARY,
  // the other stays as automatic failover on rate-limit. (Two Gemini keys round-robin + cover each other.)
  const gemini: Provider[] = [];
  if (ENV.geminiKey) gemini.push({ name: 'gemini', generate: makeGeminiGenerate({ apiKey: ENV.geminiKey, model: ENV.geminiModel }) });
  if (ENV.geminiKey2) gemini.push({ name: 'gemini-2', generate: makeGeminiGenerate({ apiKey: ENV.geminiKey2, model: ENV.geminiModel }) });
  const openai: Provider[] = [];
  if (ENV.openaiKey) openai.push({ name: 'openai', generate: makeOpenAiGenerate({ apiKey: ENV.openaiKey, model: ENV.openaiModel }) });
  const providers = ENV.provider === 'openai' ? [...openai, ...gemini] : [...gemini, ...openai];
  resilient = makeResilientGenerate(providers);
  return resilient;
}

/** Answer a question end-to-end. `history` (recent turns) lets follow-ups resolve references.
 *  Returns an honest refusal (no throw) when no key is configured. */
export async function askViaPipeline(question: string, history: HistoryTurn[] = []): Promise<AskResult> {
  const r = getResilient();
  if (r.count === 0) {
    return {
      question, intent: 'unsupported', sql: null, refused: true, attempts: 0, provider: 'none',
      error: 'no api key',
      response: {
        summary: 'No AI key is configured. Add VITE_GEMINI_API_KEY and/or VITE_OPENAI_API_KEY to your .env to enable answers.',
        widgets: [],
      },
    };
  }
  resetUsage();
  const t0 = performance.now();
  const res = await askQuestion(question, { dataSource: getDataSource(), generate: r.generate }, history);
  const ms = performance.now() - t0;
  const u = usageSummary();
  // Live monitor (always on) — which API, which model, how many tokens, and failover status.
  printAiMonitor(r, u, ms, res.refused);
  // Layer 3: capture genuine refusals (a key WAS configured) as a backlog of real-world gaps.
  if (res.refused) {
    recordRefusal({
      q: question,
      reason: res.response?.summary ?? res.error ?? 'refused',
      intent: res.intent,
      mode: getDataMode(),
      provider: r.lastProvider,
      ts: Date.now(),
    });
  }
  return { ...res, provider: r.lastProvider };
}

/** Which providers are live vs cooling down (for a status badge, if desired). */
export function providerStatus() {
  return getResilient().status();
}

export type { AskResult, HistoryTurn };
