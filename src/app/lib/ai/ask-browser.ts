// Browser entry to the /ask pipeline. Wires the in-browser DuckDB-wasm engine to the LLM caller.
// App.tsx calls askViaPipeline(); it no longer needs to know about keys or providers.
//
// OPENAI IS THE ONLY PROVIDER. Gemini is deliberately disabled: it is not wired into the chain and
// VITE_AI_PROVIDER can no longer switch it back on. Both Gemini keys were returning 503, and because
// they sat AHEAD of OpenAI in the chain every model call burned two failing round-trips before it
// reached a provider that could answer — the agent makes several calls per question, so a single
// question spent over a minute failing. src/app/lib/ai/gemini.ts is kept for reference; re-enabling
// it means importing makeGeminiGenerate here again, on purpose, not by setting an env var.
import { getDataSource, getDataMode } from '../db';
import { makeOpenAiGenerate } from './openai';
import { makeResilientGenerate, type Provider, type ResilientGenerate } from './resilient';
import { askQuestion, type AskResult } from './pipeline';
import { runAgent } from './agent';
import { modeGuard } from './mode-guards';
import { getCachedAnswer, cacheAnswer } from './answer-cache';
import { buildSystemPrompt, type HistoryTurn } from './prompt';
import { resetUsage, usageSummary, sessionTotals } from './usage';
import { recordRefusal, listRefusals, exportRefusals, clearRefusals } from './refusal-log';
import { isDiagnostic, analyzeResult, proposeInvestigation, rowsOf } from './analyze';
import { routeQuestion } from './router';
import { answerDefinition, answerDataset } from './explain';
import { detectFollowUp, needsClarification, requestedFactors } from './followup';
import { aiLog } from './debug';
import type { ConversationContext } from './context/types';
import { deriveTurn } from './context/derive';
import { answerBoundTurn } from './trained/bound';
import { answerTrained } from './trained/registry';

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
  // Cumulative spend for this browser session (survives individual questions; resets on reload).
  w.aiStats = () => {
    const s = sessionTotals();
    console.table({
      questions: s.questions, calls: s.calls, failed: s.failures,
      'input tokens': s.promptTokens, 'cached input': s.cachedTokens, 'output tokens': s.outputTokens,
      'total tokens': s.totalTokens, 'est. cost (USD)': `$${s.cost.toFixed(4)}`,
    });
    return `session: ${s.calls} calls · ${s.totalTokens.toLocaleString()} tokens · ~$${s.cost.toFixed(4)}`;
  };
  // BACKEND CHECK — sends a minimal request with the SAME shape the pipeline uses (json_object mode
  // + temperature) so a rejection here proves the request PARAMETERS are wrong, while success proves
  // the key/model/endpoint are fine and the fault lies in the size or content of the real prompt.
  w.aiPing = async () => {
    const key = ENV.openaiKey;
    const model = ENV.openaiModel;
    if (!key) return '✗ no VITE_OPENAI_API_KEY in this build';
    const t0 = performance.now();
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: 'Reply with JSON.' }, { role: 'user', content: 'Return {"ok":true}' }],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
      });
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) {
        const body = await res.text();
        console.error(`%c✗ OpenAI HTTP ${res.status}%c  model=${model}  ${ms}ms\n${body.slice(0, 600)}`,
          'color:#c0392b;font-weight:700', 'color:inherit');
        return `✗ HTTP ${res.status} — the error body is printed above; it names the exact cause`;
      }
      const j = await res.json();
      const u = j?.usage ?? {};
      console.log(`%c✓ OpenAI reachable%c  model=${model}  ${ms}ms  (in ${u.prompt_tokens ?? 0} / out ${u.completion_tokens ?? 0} tok)`,
        'color:#1e8e3e;font-weight:700', 'color:inherit');
      return `✓ ok — key, model and endpoint all work. A 400 on real questions is then about prompt size or content, not config.`;
    } catch (e) {
      return `✗ network error: ${(e as Error).message}`;
    }
  };
}

/** Friendly label for a provider slot name. OpenAI is the only one wired; Gemini is disabled. */
const PROVIDER_LABEL: Record<string, string> = {
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
    const s = sessionTotals();
    // A rejected call is the single most useful thing to see when answers are slow or missing, so it
    // is printed in full — status code and the provider's own error text — not summarised away.
    const failLines = u.failures.map((f) => `   ✗ HTTP ${f.status} ${f.endpoint}\n     ${f.message.replace(/\s+/g, ' ').slice(0, 200)}`);
    const body = [
      `%c🛰 AI MONITOR%c  ${refused ? '⚠ refused' : u.calls ? '✓ answered' : '✗ no successful call'}`,
      `   API used : ${who}${u.lastEndpoint ? `  →  ${u.lastEndpoint}` : ''}`,
      `   model    : ${u.lastModel || '—'}`,
      u.calls
        ? `   tokens   : ${num(u.totalTokens)}  (in ${num(u.promptTokens)}${u.cachedTokens ? `, ${num(u.cachedTokens)} cached` : ''} · out ${num(u.outputTokens)})`
        : `   tokens   : — (no model call succeeded)`,
      // Cost is an estimate from list prices — it tracks spend, it never affects an answer. An
      // unpriced model must say so: a bare $0.0000 reads as "free" when it means "rate unknown".
      u.calls
        ? `   cost     : ${u.unpriced ? `unknown — no list price for "${u.lastModel}"` : `~$${u.cost.toFixed(4)}${u.cachedTokens ? '' : '  (no prompt-cache discount seen)'}`}`
        : '',
      `   calls    : ${u.calls} ok${u.failures.length ? ` · ${u.failures.length} FAILED` : ''} · ${ms.toFixed(0)} ms`,
      ...failLines,
      `   provider : ${status}`,
      `   session  : ${s.questions} question(s) · ${s.calls} calls${s.failures ? ` · ${s.failures} failed` : ''} · ${num(s.totalTokens)} tok · ~$${s.cost.toFixed(4)}`,
    ].filter(Boolean).join('\n');
    // eslint-disable-next-line no-console
    console.log(body, 'font-weight:bold;color:#4C5FE4', 'font-weight:normal;color:inherit');
  } catch { /* never let the monitor break a response */ }
}

// Only OpenAI is read. VITE_AI_PROVIDER / VITE_GEMINI_* are intentionally ignored — leaving them set
// in an environment no longer has any effect on which API is called.
const ENV = {
  openaiKey: import.meta.env.VITE_OPENAI_API_KEY || '',
  openaiModel: (import.meta.env.VITE_OPENAI_MODEL as string) || 'gpt-4o-mini',
};

// One resilient caller for the whole session, so provider cooldowns persist across questions.
let resilient: ResilientGenerate | null = null;
function getResilient(): ResilientGenerate {
  if (resilient) return resilient;
  // OpenAI is the whole chain. The resilient wrapper still applies its 429/503 cooldown to this one
  // slot, so a rate-limited call fails fast and honestly instead of hunting for another provider.
  const providers: Provider[] = [];
  if (ENV.openaiKey) providers.push({ name: 'openai', generate: makeOpenAiGenerate({ apiKey: ENV.openaiKey, model: ENV.openaiModel }) });
  resilient = makeResilientGenerate(providers);
  return resilient;
}

/** Answer a question end-to-end. `history` (recent turns) lets follow-ups resolve references, and
 *  `context` carries what earlier answers produced, however long ago they were.
 *  Returns an honest refusal (no throw) when no key is configured. */
export async function askViaPipeline(question: string, history: HistoryTurn[] = [], context?: ConversationContext): Promise<AskResult> {
  const res = await answerQuestion(question, history, context);
  if (context && !res.turn) {
    // Observational only: a failure here must never cost the user their answer.
    try { res.turn = await deriveTurn(res, getDataMode(), getDataSource()); } catch (e) { aiLog('turn record skipped:', (e as Error).message); }
  }
  return res;
}

async function answerQuestion(question: string, history: HistoryTurn[], context?: ConversationContext): Promise<AskResult> {
  const r = getResilient();
  if (r.count === 0) {
    return {
      question, intent: 'unsupported', sql: null, refused: true, attempts: 0, provider: 'none',
      error: 'no api key',
      response: {
        summary: 'No AI key is configured. Add VITE_OPENAI_API_KEY to your .env to enable answers.',
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

  // Does this turn refer back to an earlier answer? If not, nothing below changes.
  const bound = await answerBoundTurn(question, context, { ds: getDataSource(), mode: dataMode, generate: r.generate });
  if (bound.result) return bound.result;
  // A fixed answer exists only for questions the normal path provably cannot handle.
  if (!bound.instruction) {
    const trained = await answerTrained(question, context, { ds: getDataSource(), mode: dataMode });
    if (trained) return trained;
  }

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
          followUpInstruction: bound.instruction ?? followUp?.instruction, forceFactors },
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
