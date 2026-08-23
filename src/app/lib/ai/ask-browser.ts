// Browser entry to the /ask pipeline. Wires the in-browser DuckDB-wasm engine to a resilient,
// multi-provider LLM caller (Gemini preferred, OpenAI failover on rate-limit). App.tsx calls
// askViaPipeline(); it no longer needs to know about keys or providers.
import { getDataSource, getDataMode } from '../db';
import { makeGeminiGenerate } from './gemini';
import { makeOpenAiGenerate } from './openai';
import { makeResilientGenerate, type Provider, type ResilientGenerate } from './resilient';
import { askQuestion, type AskResult } from './pipeline';
import { runAgent } from './agent';
import { modeGuard } from './mode-guards';
import { getCachedAnswer, cacheAnswer } from './answer-cache';
import { buildSystemPrompt, type HistoryTurn } from './prompt';
import { resetUsage, usageSummary } from './usage';
import { recordRefusal, listRefusals, exportRefusals, clearRefusals } from './refusal-log';
import { isDiagnostic, analyzeResult, proposeInvestigation, rowsOf } from './analyze';
import { routeQuestion } from './router';
import { answerDefinition, answerDataset } from './explain';
import { detectFollowUp, needsClarification, requestedFactors } from './followup';
import { aiLog } from './debug';

// Console helpers for inspecting the pipeline live:
//   showSystemPrompt()  → prints the exact system prompt sent to the model
//   aiDebug(false)      → turn the [AI] stage logs off (aiDebug(true) to re-enable)
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.showSystemPrompt = () => { const p = buildSystemPrompt(getDataMode()); console.log(p); return `system prompt printed (${p.length} chars, mode=${getDataMode()})`; };
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
        ? `   tokens   : ${num(u.totalTokens)}  (in ${num(u.promptTokens)}${u.cachedTokens ? `, ${num(u.cachedTokens)} cached` : ''} · out ${num(u.outputTokens)})`
        : `   tokens   : — (no model call succeeded)`,
      // Cost is an estimate from list prices — it tracks spend, it never affects an answer.
      u.calls ? `   cost     : ~$${u.cost.toFixed(4)}${u.cachedTokens ? '' : '  (no prompt-cache discount seen)'}` : '',
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
  // When provider=openai we run OpenAI ONLY (no Gemini) per the current directive; gemini mode keeps
  // OpenAI as automatic failover. (Swap back to `[...openai, ...gemini]` to re-enable Gemini failover.)
  const providers = ENV.provider === 'openai' ? openai : [...gemini, ...openai];
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
  const dataMode = getDataMode();
  // Honesty guard BEFORE any model call: some questions cannot be answered by the ACTIVE dataset at
  // all (forward attendance in Real mode — there are no dates to read a trend from). Asked anyway a
  // model will invent one, so the explanation is returned from code instead.
  const guarded = modeGuard(question, dataMode);
  if (guarded) return guarded;

  // WHAT KIND OF QUESTION IS THIS? Not everything is a query. A definition ("what does vulnerability
  // score mean?") and a question about the data itself ("how complete is attendance?") have no SQL
  // that answers them — routed to the agent they used to be refused or improvised. Both are answered
  // from grounded facts instead, at roughly a twentieth of the cost of a query answer.
  const route = routeQuestion(question);
  if (route.kind !== 'data') {
    aiLog(`🧭 route=${route.kind} — ${route.reason}`);
    resetUsage();
    const e0 = performance.now();
    try {
      const res = route.kind === 'definition'
        ? await answerDefinition(question, r.generate)
        : await answerDataset(question, getDataSource(), dataMode, r.generate);
      printAiMonitor(r, usageSummary(), performance.now() - e0, false);
      return { ...res, provider: r.lastProvider };
    } catch (e) {
      aiLog('explain path failed, falling through to the query path:', (e as Error).message);
      // Fall through — the normal pipeline is never worse than a hard failure here.
    }
  }

  // A follow-up we genuinely cannot resolve gets a SHORT question back, not a confident answer to
  // the wrong thing. Costs nothing.
  const clarify = needsClarification(question, history);
  if (clarify) {
    aiLog(`❔ asking for clarification — ${clarify.reason}`);
    return {
      question, intent: 'lookup', sql: null, refused: false, attempts: 0, clarifying: true, provider: 'none',
      response: { summary: clarify.question, widgets: [] },
    };
  }

  // Is this turn an EDIT to the previous answer rather than a new question?
  const followUp = detectFollowUp(question, history);
  const forceFactors = followUp?.kind === 'add_factor' ? requestedFactors(question) : [];
  if (followUp) aiLog(`↩️ follow-up (${followUp.kind})${forceFactors.length ? ` forcing factors: ${forceFactors.join(', ')}` : ''}`);

  // AGENT path is the default; set VITE_AI_AGENT=off to fall back to the legacy single-shot pipeline.
  const useAgent = !['off', 'false', '0'].includes(String(import.meta.env.VITE_AI_AGENT ?? '').toLowerCase());

  // First-turn answer cache (agent path only) — never for follow-ups (they depend on prior rows).
  if (useAgent && history.length === 0) {
    const cached = getCachedAnswer(question, dataMode);
    if (cached) { printAiMonitor(r, usageSummary(), 0, cached.refused); return { ...cached, provider: 'cache' }; }
  }

  resetUsage();
  const t0 = performance.now();
  const deps = { dataSource: getDataSource(), generate: r.generate, dataMode };
  let res: AskResult;

  if (useAgent) {
    try {
      // Performance-first: one strong model for BOTH planning and synthesis (no cheap tier).
      res = await runAgent(
        question,
        { dataSource: deps.dataSource, generate: r.generate, synth: r.generate, dataMode,
          followUpInstruction: followUp?.instruction, forceFactors },
        history,
      );
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      const limited = /\b429\b|\b503\b|quota|rate.?limit|RESOURCE_EXHAUSTED|insufficient_quota|credit/i.test(msg);
      res = {
        question, intent: 'unsupported', sql: null, refused: true, rateLimited: limited, attempts: 0, error: msg,
        response: { summary: limited ? '⏳ The AI is temporarily rate-limited or out of quota — please try again shortly.' : `I couldn't complete that (${msg}).`, widgets: [] },
      };
    }
  } else {
    res = await askQuestion(question, deps, history);
    // Legacy one-hop "why" investigation (only on the fallback path).
    if (!res.refused && res.response && isDiagnostic(question)) {
      const groups = [{ label: 'initial result', rows: rowsOf(res.response) }];
      const followupQ = await proposeInvestigation(question, res.response, r.generate);
      if (followupQ) {
        try {
          const hist: HistoryTurn[] = [...history, { role: 'user', text: question }, { role: 'ai', text: res.response.summary, sql: res.sql }];
          const res2 = await askQuestion(followupQ, deps, hist);
          if (!res2.refused && res2.response) {
            groups.push({ label: `breakdown — ${followupQ}`, rows: rowsOf(res2.response) });
            if (res2.response.widgets?.length) res.response.widgets = [...res.response.widgets, ...res2.response.widgets];
          }
        } catch { /* investigation is best-effort */ }
      }
      const insight = await analyzeResult(question, groups, r.generate);
      if (insight) res.response.summary = insight;
    }
  }

  if (useAgent && history.length === 0) cacheAnswer(question, dataMode, res);
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
