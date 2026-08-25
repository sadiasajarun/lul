// Lightweight console logger for the AI pipeline. On in dev by default; toggle with
// `aiDebug(false)` / `aiDebug(true)` in the browser console (persists via localStorage).
// Guarded so it is a no-op in Node (the eval harness) where import.meta.env/localStorage are absent.

export function debugEnabled(): boolean {
  try {
    const ls = typeof localStorage !== 'undefined' ? localStorage.getItem('aiDebug') : null;
    if (ls === '0') return false;
    if (ls === '1') return true;
    // MUST be spelled `import.meta.env.DEV`, with no cast and no optional chaining. Vite replaces
    // that exact expression with a literal at build time. Reaching the object any other way — a cast
    // like `(import.meta as {env?:...}).env`, or `import.meta.env?.DEV` — does not match, so Vite
    // inlines the WHOLE env object into the bundle. That is how every VITE_* value, including the
    // API keys, ended up readable in the shipped JavaScript. The try/catch below already covers
    // plain Node, where import.meta.env does not exist.
    return Boolean(import.meta.env.DEV); // default: on during `npm run dev`, off in a production build
  } catch {
    return false;
  }
}

export function aiLog(label: string, ...args: unknown[]): void {
  if (debugEnabled()) console.log('%c[AI]%c ' + label, 'color:#6b7cff;font-weight:700', 'color:inherit', ...args);
}
