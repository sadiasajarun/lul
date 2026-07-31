// Lightweight console logger for the AI pipeline. On in dev by default; toggle with
// `aiDebug(false)` / `aiDebug(true)` in the browser console (persists via localStorage).
// Guarded so it is a no-op in Node (the eval harness) where import.meta.env/localStorage are absent.

export function debugEnabled(): boolean {
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage.getItem('aiDebug') : null;
    if (ls === '0') return false;
    if (ls === '1') return true;
    const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
    return !!env?.DEV; // default: on during `npm run dev`, off in a production build
  } catch {
    return false;
  }
}

export function aiLog(label: string, ...args: unknown[]): void {
  if (debugEnabled()) console.log('%c[AI]%c ' + label, 'color:#6b7cff;font-weight:700', 'color:inherit', ...args);
}
