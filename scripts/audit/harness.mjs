// Runs the REAL askViaPipeline in Node with the model stubbed out. It cannot spend money: the real
// key is never loaded (envDir points at a folder with no .env) and every network call is blocked
// except the OpenAI URL, which is answered locally.
import path from 'node:path';
import { createServer } from 'vite';

const ROOT = process.cwd();
const NODE_SOURCE = path.join(ROOT, 'scripts', 'audit', 'node-source.mjs').replace(/\\/g, '/');

class MemoryStorage {
  store = new Map();
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }
  setItem(k, v) { this.store.set(k, String(v)); }
  removeItem(k) { this.store.delete(k); }
  clear() { this.store.clear(); }
}

/** Default stub reply: the agent declines, so a question costs one captured prompt and ends. */
export const REFUSE = JSON.stringify({ action: 'refuse', reason: 'stubbed model' });

export async function openPipeline(mode) {
  globalThis.localStorage = new MemoryStorage();
  localStorage.setItem('dataMode', mode);
  localStorage.setItem('aiDebug', '0');
  localStorage.setItem('aiMonitor', '0');

  const calls = [];
  let reply = () => REFUSE;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.openai.com/')) throw new Error(`audit: blocked network call to ${url}`);
    const body = JSON.parse(init.body);
    calls.push({ model: body.model, messages: body.messages });
    const content = reply(body);
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const server = await createServer({
    configFile: false,
    root: ROOT,
    logLevel: 'error',
    envDir: path.join(ROOT, 'scripts', 'audit', 'bank'),
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { '@': path.join(ROOT, 'src') } },
    define: {
      'import.meta.env.VITE_OPENAI_API_KEY': JSON.stringify('audit-stub-key'),
      'import.meta.env.VITE_OPENAI_MODEL': JSON.stringify('gpt-4o'),
    },
    plugins: [{
      name: 'audit-node-duckdb',
      enforce: 'pre',
      resolveId(id) { return /(^|\/)duckdb-source(\.ts)?$/.test(id) ? NODE_SOURCE : null; },
    }],
  });

  const ask = await server.ssrLoadModule('/src/app/lib/ai/ask-browser.ts');
  const db = await server.ssrLoadModule('/src/app/lib/db/index.ts');
  await db.getDataSource().init();

  return {
    ask: ask.askViaPipeline,
    calls,
    setReply: (fn) => { reply = fn; },
    source: db.getDataSource(),
    load: (id) => server.ssrLoadModule(id),
    close: async () => { await server.close(); },
  };
}
