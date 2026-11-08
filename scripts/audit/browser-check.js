// Runs inside the browser against the dev server, because the browser uses DuckDB-wasm while the Node
// checks use native DuckDB. The model is stubbed here too, so nothing reaches OpenAI.
const OPENING = `SELECT center_id, center_name, division, me_score, students FROM v_center_enrollment WHERE me_score IS NOT NULL ORDER BY me_score DESC, students DESC LIMIT 10`;

function stubModel() {
  const real = window.fetch.bind(window);
  window.__openaiCalls = 0;
  window.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.openai.com/')) return real(url, init);
    window.__openaiCalls++;
    const user = JSON.parse(init.body).messages.at(-1).content;
    let content = '{}';
    if (/Step \d+ of \d+/.test(user)) {
      content = /\(no queries run yet\)/.test(user)
        ? JSON.stringify({ action: 'run_sql', intent: 'list', sql: OPENING, title: 'Top centers' })
        : JSON.stringify({ action: 'finish', answer_evidence: ['e1'], primary_evidence: 'e1' });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

export function installStub() { stubModel(); return 'stubbed'; }

export async function run() {
  stubModel();
  const db = await import('/src/app/lib/db/index.ts');
  const { askViaPipeline } = await import('/src/app/lib/ai/ask-browser.ts');
  const { foldContext } = await import('/src/app/lib/ai/context/fold.ts');
  const log = [];
  const turn = async (mode, messages, text) => {
    const res = await askViaPipeline(text, [], foldContext(messages, mode));
    messages.push({ role: 'ai', turn: res.turn });
    log.push({ mode, text, trained: !!res.trained, bound: !!res.turn?.bound, widgets: res.response.widgets.length, rows: res.response.widgets[0]?.data?.length ?? 0, first: res.response.summary.split('\n')[0].slice(0, 110) });
    return res;
  };

  await db.getDataSource().init();
  await db.setDataSourceMode('tuned');
  const preview = [];
  for (const q of ['Show me the top 10 best-performing centers.', 'Among these, which three have the lowest dropout rates?', 'Select the second center.', 'Check its monitoring and visit history.', 'What are the five biggest differences?']) await turn('tuned', preview, q);
  await turn('tuned', [], 'Which centers received the most visits?');
  await turn('tuned', [], 'What is the total cash transfer amount?');
  await turn('tuned', [], 'Show PPE vs NFPE center distribution.');

  // Switching dataset must hide every Preview row.
  await db.setDataSourceMode('real');
  await turn('real', preview.slice(), 'Select the second center.');
  await turn('real', [], 'Which centers received the most visits?');
  await turn('real', [], 'What is the overall student attendance rate?');
  const leak = await db.getDataSource().query('SELECT count(*) AS n FROM tv_center_scorecard WHERE visits IS NOT NULL').catch((e) => ({ rows: [{ n: `error: ${e.message}` }] }));
  window.__browserCheck = { log, realVisitRows: leak.rows[0].n, openaiCalls: window.__openaiCalls };
  return 'done';
}
