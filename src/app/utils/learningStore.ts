/**
 * Learning-pattern loop (localStorage-backed).
 *
 * Three jobs, all keyed to the KB version so new data self-heals the cache:
 *
 *  1. ANSWER CACHE — a normalised query → its answer. A repeat question costs ZERO tokens.
 *  2. FACT-USEFULNESS WEIGHTS — which facts proved useful for which query terms. These bias the
 *     retriever so it gets sharper with use (the "learning" part). Weights are about term→fact
 *     mapping, which is stable, so they SURVIVE a data refresh; only the cached answers expire.
 *  3. VERSION GUARD — when scripts/build-knowledge-base.mjs emits a new version (i.e. new data),
 *     every cached answer is invalidated automatically; the next ask recomputes and re-caches.
 *
 * This is what lets the AI "not scan the whole database every time": it answers from the fact
 * pack, and from cache when it has seen the question before.
 */

import { KB_VERSION } from "../lib/knowledgeBase";

const CACHE_KEY = "kb_answer_cache_v4"; // v4: invalidates answers cached before the M&E row-engine branch
const WEIGHTS_KEY = "kb_fact_weights_v1";
const MAX_CACHE = 200;

// ── normalisation ─────────────────────────────────────────────────────────────
function normalizeQuery(q: string): string {
  return (q.toLowerCase().match(/[a-z0-9]+/g) ?? []).sort().join(" ");
}

// ── storage helpers (safe if localStorage is unavailable, e.g. SSR/tests) ─────
function read<T>(key: string, fallback: T): T {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled — degrade silently */
  }
}

// ── 1 · Answer cache ──────────────────────────────────────────────────────────
interface CachedAnswer {
  version: string;
  query: string;
  response: unknown; // DynamicDashboardResponse
  factIds: string[];
  hits: number;
  stampedTurn: number; // monotonic recency, avoids Date.now()
}
type Cache = Record<string, CachedAnswer>;

let turn = 0;

/** Return a cached answer for this query at the current KB version, or null. */
export function getCachedAnswer(query: string): CachedAnswer | null {
  const cache = read<Cache>(CACHE_KEY, {});
  const hit = cache[normalizeQuery(query)];
  if (!hit || hit.version !== KB_VERSION) return null;
  hit.hits += 1;
  hit.stampedTurn = ++turn;
  cache[normalizeQuery(query)] = hit;
  write(CACHE_KEY, cache);
  return hit;
}

/** Cache an answer, evicting the least-recently-used entries past MAX_CACHE. */
export function cacheAnswer(query: string, response: unknown, factIds: string[]): void {
  const cache = read<Cache>(CACHE_KEY, {});
  cache[normalizeQuery(query)] = {
    version: KB_VERSION, query, response, factIds, hits: 1, stampedTurn: ++turn,
  };
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE) {
    keys.sort((a, b) => cache[a].stampedTurn - cache[b].stampedTurn)
      .slice(0, keys.length - MAX_CACHE)
      .forEach((k) => delete cache[k]);
  }
  write(CACHE_KEY, cache);
}

// ── 2 · Fact-usefulness weights (the learning signal) ────────────────────────
type Weights = Record<string, number>; // key: `${term}` or `${lens}:${term}` → boost

/** Current retrieval weights (fed into retrieveFacts). */
export function getWeights(): Weights {
  const w = read<{ version: string; weights: Weights }>(WEIGHTS_KEY, { version: "", weights: {} });
  return w.weights ?? {};
}

/**
 * Reinforce the terms→facts that produced a used answer. Called after every successful ask.
 * Weights are capped so no single pattern dominates, and decay slightly so stale patterns fade.
 */
export function reinforce(query: string, factIds: string[]): void {
  const store = read<{ version: string; weights: Weights }>(WEIGHTS_KEY, { version: KB_VERSION, weights: {} });
  const weights = store.weights ?? {};
  const terms = (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2);
  const factSet = new Set(factIds);

  // gentle global decay so the model tracks recent usage
  for (const k of Object.keys(weights)) weights[k] = Math.max(1, weights[k] * 0.995);

  for (const term of terms) {
    // reward the term generally, and the specific facts that answered it
    weights[term] = Math.min(3, (weights[term] ?? 1) + 0.15);
    for (const fid of factSet) {
      const key = `${term}#${fid}`;
      weights[key] = Math.min(3, (weights[key] ?? 1) + 0.25);
    }
  }
  write(WEIGHTS_KEY, { version: KB_VERSION, weights });
}

// ── 3 · Stats (for the UI badge / debugging) ─────────────────────────────────
export function learningStats(): { cached: number; version: string; patterns: number } {
  const cache = read<Cache>(CACHE_KEY, {});
  const valid = Object.values(cache).filter((c) => c.version === KB_VERSION).length;
  const weights = getWeights();
  return { cached: valid, version: KB_VERSION, patterns: Object.keys(weights).length };
}

/** Drop everything (e.g. a manual reset). Weights + answer cache. */
export function resetLearning(): void {
  write(CACHE_KEY, {});
  write(WEIGHTS_KEY, { version: KB_VERSION, weights: {} });
}
