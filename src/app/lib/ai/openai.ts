// OpenAI caller — same contract as the Gemini one (returns the model's raw JSON text), so the
// failover layer can treat the two interchangeably. JSON mode is on; errors carry .status so the
// resilient layer can tell a rate-limit (429) apart from a real failure.
import { recordUsage, recordFailure } from './usage';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export interface OpenAiOptions {
  apiKey: string;
  model?: string;
  temperature?: number;
}

const DEFAULT_MODEL = 'gpt-4o-mini';

export class ProviderError extends Error {
  status: number;
  retryAfterMs?: number;
  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function openaiGenerate(system: string, user: string, opts: OpenAiOptions): Promise<string> {
  const model = opts.model || DEFAULT_MODEL;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_object' },
      temperature: opts.temperature ?? 0.1,
    }),
  });
  if (!res.ok) {
    const retryAfter = res.headers.get('retry-after');
    const ms = retryAfter ? Math.round(parseFloat(retryAfter) * 1000) : undefined;
    const detail = (await res.text()).slice(0, 300);
    // Report BEFORE throwing: the resilient layer catches this and moves on, so without recording it
    // here a rejected call leaves no trace and the console just shows a slow, unexplained answer.
    recordFailure({ provider: 'openai', model, endpoint: ENDPOINT, status: res.status, message: detail });
    throw new ProviderError(`OpenAI API ${res.status}: ${detail}`, res.status, ms);
  }
  const json = await res.json();
  const u = json?.usage ?? {};
  recordUsage({
    provider: 'openai',
    model,
    endpoint: ENDPOINT,
    promptTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
    // OpenAI serves an identical prompt prefix from cache at a discount. Reading it is the only way
    // to tell whether that discount is actually landing.
    cachedTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
  });
  const text = (json?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) {
    recordFailure({ provider: 'openai', model, endpoint: ENDPOINT, status: 502, message: 'Empty response (no choices[0].message.content)' });
    throw new ProviderError('Empty OpenAI response', 502);
  }
  return text;
}

export function makeOpenAiGenerate(opts: OpenAiOptions) {
  return (system: string, user: string) => openaiGenerate(system, user, opts);
}
