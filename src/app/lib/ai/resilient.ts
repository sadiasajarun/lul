// Provider failover. Wraps N model providers (Gemini, OpenAI) behind ONE `generate(system,user)`
// that the pipeline uses unchanged. Behaviour:
//   • Try providers in preference order (Gemini first), skipping any currently cooling down.
//   • On a rate-limit (429/503), put that provider on a cooldown until its suggested retry time
//     and immediately fail over to the next available provider.
//   • Once a provider's cooldown expires it becomes preferred again automatically — so the moment
//     Gemini's limit clears, the next question goes back to Gemini.
// State (cooldowns, last-used) lives in the closure, so it persists across questions.
import { ProviderError } from './openai';

export interface Provider {
  name: string;
  generate: (system: string, user: string) => Promise<string>;
}

interface Slot extends Provider { coolUntil: number }

const DEFAULT_COOLDOWN_MS = 60_000;

function isRateLimited(e: unknown): { limited: boolean; retryMs?: number } {
  if (e instanceof ProviderError) {
    if (e.status === 429 || e.status === 503) return { limited: true, retryMs: e.retryAfterMs };
    return { limited: false };
  }
  const msg = (e as Error)?.message ?? '';
  return { limited: /\b429\b|\b503\b|quota|rate.?limit|RESOURCE_EXHAUSTED|overloaded/i.test(msg) };
}

export interface ResilientGenerate {
  generate: (system: string, user: string) => Promise<string>;
  /** Name of the provider that answered the most recent successful call. */
  readonly lastProvider: string;
  readonly count: number;
  /** Debug/status: which providers are cooling down and until when. */
  status(): { name: string; coolingDown: boolean; secondsLeft: number }[];
}

export function makeResilientGenerate(providers: Provider[]): ResilientGenerate {
  const slots: Slot[] = providers.map((p) => ({ ...p, coolUntil: 0 }));
  let last = slots[0]?.name ?? '';
  let rr = 0; // round-robin cursor — alternate the starting provider each call to spread load

  async function generate(system: string, user: string): Promise<string> {
    const now = Date.now();
    const n = Math.max(1, slots.length);
    // Rotate the provider list by the round-robin cursor so consecutive calls alternate keys
    // (e.g. two Gemini keys share the 20/min limit ≈ double throughput), then skip any cooling-down
    // provider and fall back to the soonest-to-recover one.
    const rotated = Array.from({ length: slots.length }, (_, i) => slots[(rr + i) % n]);
    rr = (rr + 1) % n;
    const available = rotated.filter((s) => s.coolUntil <= now);
    const cooling = rotated.filter((s) => s.coolUntil > now).sort((a, b) => a.coolUntil - b.coolUntil);
    const order = [...available, ...cooling];

    let lastErr: unknown;
    for (const slot of order) {
      try {
        const out = await slot.generate(system, user);
        last = slot.name;
        return out;
      } catch (e) {
        lastErr = e;
        const rl = isRateLimited(e);
        if (rl.limited) {
          slot.coolUntil = Date.now() + (rl.retryMs && rl.retryMs > 0 ? rl.retryMs + 1000 : DEFAULT_COOLDOWN_MS);
        }
        // Either way, fall through to the next provider (a bad key on one shouldn't kill the answer).
      }
    }
    throw lastErr ?? new Error('No model provider is configured.');
  }

  return {
    generate,
    get lastProvider() { return last; },
    get count() { return slots.length; },
    status() {
      const now = Date.now();
      return slots.map((s) => ({ name: s.name, coolingDown: s.coolUntil > now, secondsLeft: Math.max(0, Math.ceil((s.coolUntil - now) / 1000)) }));
    },
  };
}
