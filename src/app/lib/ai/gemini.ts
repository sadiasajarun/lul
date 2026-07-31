// Thin Gemini caller used as the pipeline's `generate` function. Kept tiny and injectable so the
// eval harness can swap in a Node fetch (same REST endpoint) and tests can swap in a stub.
import { ProviderError } from './openai';
import { recordUsage } from './usage';

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  /** JSON mode is on by default — the pipeline expects a JSON object back. */
  temperature?: number;
}

const DEFAULT_MODEL = 'gemini-2.5-flash';

/** Returns the model's raw text (expected to be a JSON object). Throws ProviderError on HTTP/parse failure. */
export async function geminiGenerate(system: string, user: string, opts: GeminiOptions): Promise<string> {
  const model = opts.model || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: opts.temperature ?? 0.1 },
  });
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    const m = text.match(/retry in ([\d.]+)s/i);            // Gemini 429 bodies suggest a retry delay
    throw new ProviderError(`Gemini API ${res.status}: ${text.slice(0, 200)}`, res.status, m ? Math.ceil(parseFloat(m[1]) * 1000) : undefined);
  }
  const json = await res.json();
  const um = json?.usageMetadata ?? {};
  recordUsage({
    provider: 'gemini',
    promptTokens: um.promptTokenCount ?? 0,
    outputTokens: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
    totalTokens: um.totalTokenCount ?? 0,
  });
  const parts: { text?: string }[] = json?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p?.text ?? '').join('').trim();
  if (!text) throw new ProviderError('Empty Gemini response', 502);
  return text;
}

/** Bind a key/model into a `generate(system, user)` function for the pipeline. */
export function makeGeminiGenerate(opts: GeminiOptions) {
  return (system: string, user: string) => geminiGenerate(system, user, opts);
}
