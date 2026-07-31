// Layer 3 — RUNTIME REFUSAL CAPTURE (localStorage-backed).
//
// Every time the pipeline honestly declines a question ("the data can't answer that"), we log it.
// Real usage then becomes a test backlog: the exact questions users ask that the system refuses —
// the edge cases you could never enumerate up front. Pair with Layer 1 (check:catalog) and Layer 2
// (probe:refusals): a genuine gap shows up here first, you add the column/synonym, and the probe
// then guards it forever.
//
// Local-only: this never leaves the browser (same as the answer cache). Inspect it from the console:
//   showRefusals()    → table of what's been declined (newest first)
//   exportRefusals()  → JSON string to copy out and turn into probes / catalog fixes
//   clearRefusals()   → wipe the log

export interface RefusalEntry {
  q: string;          // the question as asked
  reason: string;     // the refusal summary the user saw
  intent: string;     // pipeline intent (usually 'unsupported')
  mode: string;       // data mode at the time ('real' | 'tuned') — a gap may be mode-specific
  provider?: string;  // which model answered (or 'none')
  ts: number;         // epoch ms
}

const KEY = 'ai_refusal_log_v1';
const MAX = 200; // keep the newest N; refusals are rare, this is plenty

function read(): RefusalEntry[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return raw ? (JSON.parse(raw) as RefusalEntry[]) : [];
  } catch { return []; }
}

function write(list: RefusalEntry[]): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

/** Record one refusal. Collapses repeats of the same question so the log stays a tidy set of distinct gaps. */
export function recordRefusal(entry: RefusalEntry): void {
  const norm = entry.q.trim().toLowerCase();
  const list = read().filter((e) => e.q.trim().toLowerCase() !== norm);
  list.push(entry);
  write(list.slice(-MAX));
}

/** All logged refusals, newest first. */
export function listRefusals(): RefusalEntry[] {
  return read().slice().sort((a, b) => b.ts - a.ts);
}

export function clearRefusals(): void { write([]); }

/** Pretty JSON for copying out of the browser. */
export function exportRefusals(): string { return JSON.stringify(listRefusals(), null, 2); }
