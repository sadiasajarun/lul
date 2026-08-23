// Answer cache for the live agent path (there was none before — the old cache lived in the dead
// engine). Keyed by normalized question + data-mode + a schema-version hash, so REAL/PREVIEW never
// collide and any catalog/few-shot/view change auto-invalidates. Only used for FIRST-turn, confident
// answers — follow-ups depend on prior rows and must never be served stale.
import type { AskResult } from './pipeline';
import { VIEWS, CAVEATS } from '../db/catalog';
import { renderFewShots } from './fewshot';

const CACHE_KEY = 'lul_answer_cache_v1';
const MAX = 60;

function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
/** Any change to the query surface rotates the whole key space → automatic invalidation. */
const SCHEMA_VERSION = hashStr(JSON.stringify(VIEWS) + JSON.stringify(CAVEATS) + renderFewShots());

function normalize(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
}
function keyOf(question: string, dataMode: string): string {
  return `${normalize(question)}|${dataMode}|${SCHEMA_VERSION}`;
}

interface Entry { key: string; value: AskResult; t: number }

function load(): Entry[] {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]') as Entry[]; } catch { return []; }
}
function save(entries: Entry[]): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(entries.slice(-MAX))); } catch { /* quota / disabled */ }
}

export function getCachedAnswer(question: string, dataMode: string): AskResult | null {
  const key = keyOf(question, dataMode);
  const hit = load().find((e) => e.key === key);
  return hit ? { ...hit.value, cached: true } : null;
}

export function cacheAnswer(question: string, dataMode: string, value: AskResult): void {
  if (value.refused || value.rateLimited || !value.response?.widgets?.length) return;
  const key = keyOf(question, dataMode);
  const entries = load().filter((e) => e.key !== key);
  entries.push({ key, value: { ...value, cached: undefined }, t: Date.now() });
  save(entries);
}
