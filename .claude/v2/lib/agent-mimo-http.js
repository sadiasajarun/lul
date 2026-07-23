/**
 * agent-mimo-http.js — HTTP transport for Xiaomi MiMo via Anthropic
 * Messages API protocol.
 *
 * Endpoint (default): https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages
 * Auth: Authorization: Bearer <tp-...> (Anthropic-style x-api-key also accepted)
 * Protocol: Anthropic Messages API — different request/response shape from
 *           OpenAI Chat Completions (which agent-opencode-http.js targets).
 *
 * Why a separate module:
 *   - Anthropic API: POST /v1/messages, body has top-level `system`,
 *     messages alternate user/assistant, content blocks (text/tool_use/
 *     tool_result/thinking), response has `content: [...]` not `choices[0]`,
 *     tools use `input_schema` not `parameters`, tool_result is a
 *     content block inside a user message (not role:tool).
 *   - Trying to stuff both protocols into one module would obscure the
 *     diffs and break the OpenAI-compat optimisations.
 *
 * Return shape matches agent-opencode-http.js so verifyArtifact + the
 * orchestrator's per-node logging stay identical:
 *   { result, num_turns, total_tokens, input_tokens, output_tokens,
 *     total_cost_usd, _duration_ms, _log_file, _backend: 'mimo-http' }
 *
 * v25 historical: mimo-v2.5-pro on this endpoint produced the best run
 * in project history (tests_passing 323/388, 83%, R_episode -20).
 */

const fs = require('fs');
const path = require('path');
const { resolveVars, agentLogsDirFor } = require('./config');
const { buildContractHints } = require('./contract-hints');

const DEFAULT_ENDPOINT = 'https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages';
// v47 evidence: mimo's text-tool-call mode is chattier than native Anthropic
// tool_use — it emits `<thinking>` blocks before each tool, and the
// integrate/contract-validation + smoke-test/story-runner nodes are long
// agentic tasks (many Read+Write rounds). 60-turn cap killed three nodes.
// Bump to 120; opencode-http stays at 60 since its OpenAI-compat mode
// chains tools more compactly.
const MAX_TURNS = parseInt(process.env.MIMO_HTTP_MAX_TURNS || '120', 10);
const MAX_TOKENS = parseInt(process.env.MIMO_HTTP_MAX_TOKENS || '32768', 10);
const RETRY_ATTEMPTS = parseInt(process.env.MIMO_HTTP_RETRIES || '6', 10);
const RETRY_BASE_MS = parseInt(process.env.MIMO_HTTP_RETRY_BASE_MS || '1000', 10);
const ANTHROPIC_VERSION = process.env.MIMO_ANTHROPIC_VERSION || '2023-06-01';

// Reuse the exact tool executors from agent-opencode-http.js so file
// behaviour stays identical regardless of which transport is in use.
const { TOOL_SCHEMAS, executeTool: execToolOpenAI } = require('./agent-opencode-http');

/**
 * Convert our internal TOOL_SCHEMAS (OpenAI function-calling shape) into
 * Anthropic's `tools` shape: { name, description, input_schema }.
 */
function buildAnthropicTools(toolProfile, denyDefault = ['WebSearch', 'Task', 'NotebookEdit']) {
  const allow = (toolProfile && Array.isArray(toolProfile.allow) && toolProfile.allow.length)
    ? toolProfile.allow
    : Object.keys(TOOL_SCHEMAS);
  const deny = new Set([
    ...denyDefault,
    ...((toolProfile && Array.isArray(toolProfile.deny)) ? toolProfile.deny : []),
  ]);
  const tools = [];
  for (const name of allow) {
    if (deny.has(name)) continue;
    const schema = TOOL_SCHEMAS[name];
    if (!schema) continue;
    tools.push({
      name,
      description: schema.description,
      input_schema: schema.parameters,
    });
  }
  return tools;
}

/**
 * Anthropic tool_use block → OpenAI-shaped tool_call object that the
 * shared executeTool understands.
 */
function adaptToolUseToExecutor(toolUseBlock) {
  return {
    id: toolUseBlock.id,
    function: {
      name: toolUseBlock.name,
      arguments: JSON.stringify(toolUseBlock.input || {}),
    },
  };
}

/**
 * Mimo-specific quirk: the model emits tool calls as XML-style text
 * rather than native Anthropic `tool_use` content blocks, even though
 * stop_reason='tool_use'. Format observed on token-plan-sgp:
 *
 *   <tool_call>
 *   <function=Write>
 *   <parameter=file_path>/path/to/file</parameter>
 *   <parameter=content>some content</parameter>
 *   </function>
 *   </tool_call>
 *
 * Parse out every <tool_call>...</tool_call> block and synthesise
 * pseudo-tool_use blocks so the rest of the driver can treat them
 * identically to native Anthropic tool_use. Each gets a synthetic id
 * since the model didn't provide one.
 */
function parseTextToolCalls(text) {
  if (!text || !text.includes('<tool_call>')) return [];
  const results = [];
  const callRe = /<tool_call>\s*<function=([^>]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g;
  const paramRe = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;
  let m;
  let idx = 0;
  while ((m = callRe.exec(text)) !== null) {
    const name = m[1].trim();
    const body = m[2];
    const input = {};
    let pm;
    while ((pm = paramRe.exec(body)) !== null) {
      const k = pm[1].trim();
      let v = pm[2];
      // Trim leading/trailing newlines but preserve internal whitespace
      v = v.replace(/^\n+|\n+$/g, '');
      // Try to coerce numeric / boolean / JSON values; fall back to string.
      const trimmed = v.trim();
      if (/^-?\d+$/.test(trimmed)) input[k] = parseInt(trimmed, 10);
      else if (/^-?\d+\.\d+$/.test(trimmed)) input[k] = parseFloat(trimmed);
      else if (trimmed === 'true' || trimmed === 'false') input[k] = trimmed === 'true';
      else input[k] = v;
    }
    results.push({
      type: 'tool_use',
      id: `mimo_pseudo_${Date.now()}_${idx++}`,
      name,
      input,
    });
    paramRe.lastIndex = 0;
  }
  return results;
}

function resolveModel(node, config) {
  // `mimo/mimo-v2.5-pro` → `mimo-v2.5-pro`. The endpoint accepts the
  // bare model id (no provider prefix).
  const raw = node.model || (config && config.defaultModel) || process.env.MIMO_DEFAULT_MODEL || 'mimo-v2.5-pro';
  return raw.includes('/') ? raw.split('/').pop() : raw;
}

function resolveApiKey() {
  if (process.env.MIMO_API_KEY) return process.env.MIMO_API_KEY;
  const authPath = path.join(process.env.HOME, '.local/share/opencode/auth.json');
  if (!fs.existsSync(authPath)) {
    throw new Error('mimo auth not found: set MIMO_API_KEY env var or add mimo-xiaomi to ~/.local/share/opencode/auth.json');
  }
  const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
  const entry = auth['mimo-xiaomi'] || auth['mimo'];
  if (!entry || !entry.key) {
    throw new Error('mimo-xiaomi.key missing from auth.json — paste the tp- API key into the `key` field');
  }
  return entry.key;
}

function resolveEndpoint() {
  if (process.env.MIMO_ENDPOINT) return process.env.MIMO_ENDPOINT;
  const authPath = path.join(process.env.HOME, '.local/share/opencode/auth.json');
  if (fs.existsSync(authPath)) {
    try {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
      const entry = auth['mimo-xiaomi'] || auth['mimo'];
      if (entry && entry.endpoint) return entry.endpoint;
    } catch (_) { /* fall through to default */ }
  }
  return DEFAULT_ENDPOINT;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Build the Anthropic /v1/messages request body. `system` is top-level
 * (not a role:system message), `messages` alternate user/assistant
 * (no role:tool — tool_result is a content block in user message).
 */
async function postMessages({ apiKey, endpoint, model, system, messages, tools }) {
  const body = {
    model,
    max_tokens: MAX_TOKENS,
    messages,
  };
  if (system) body.system = system;
  if (tools && tools.length > 0) body.tools = tools;
  const payload = JSON.stringify(body);

  let lastErr = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type': 'application/json',
        },
        body: payload,
      });
      if (res.ok) return res.json();
      const text = await res.text();
      const err = new Error(`mimo-http API ${res.status}: ${text.slice(0, 500)}`);
      err.status = res.status;

      // v68 fix: mimo wraps cluster rate-limits as HTTP 400 with body
      //   {"error":{"code":"429","type":"router_queue_limitation",...}}
      // The naive `< 500` check below would treat that as terminal, throwing
      // up to the agent loop which then immediately retries with a new HTTP
      // call → hits the same 429 → burns 25min until watchdog. Detect the
      // body-level 429 and retry it like a 5xx, but with much longer backoff
      // (cluster limits typically take 30-90s to clear).
      const bodyHas429 =
        /"code"\s*:\s*"?429"?/.test(text) ||
        /"type"\s*:\s*"router_queue_limitation"/.test(text) ||
        /rate.limit/i.test(text);
      if (bodyHas429) {
        err.bodyRateLimit = true;
        lastErr = err;
        // Long backoff: 5s, 10s, 20s, 40s, 60s (capped), 60s
        const backoffMs = Math.min(60000, 5000 * (1 << attempt));
        await sleep(backoffMs);
        continue;
      }
      if (res.status < 500 || res.status === 501) throw err; // 4xx terminal
      lastErr = err;
    } catch (e) {
      if (e.status && e.status < 500 && !e.bodyRateLimit) throw e;
      lastErr = e;
    }
    await sleep(RETRY_BASE_MS * (1 << attempt));
  }
  throw new Error(`mimo-http API: ${RETRY_ATTEMPTS} attempts failed. Last error: ${lastErr && lastErr.message}`);
}

/**
 * Cost calculator. Mimo via Xiaomi Token Plan pricing isn't published
 * in our records; the API returns `usage.input_tokens` and
 * `usage.output_tokens` but no `cost`. We track token counts and leave
 * dollar cost zero for now — Token Plan billing is tracked in their
 * own dashboard.
 */
function tallyUsage(usage, totals) {
  if (!usage) return;
  totals.input += usage.input_tokens || 0;
  totals.output += usage.output_tokens || 0;
  totals.cacheRead += usage.cache_read_input_tokens || 0;
  totals.cacheCreate += usage.cache_creation_input_tokens || 0;
}

/**
 * Drive the Anthropic tool-loop. Mirrors runAgentNodeHTTP's shape.
 */
async function runAgentNodeMimoHTTP(node, config, projectName, options = {}) {
  const { buildPrompt } = require('./agent-opencode');
  const cellVars = options.cellVars || null;
  const cellInfo = options.cellInfo || null;
  const cellSuffix = cellInfo ? `-${String(cellInfo.subject_value).replace(/[^A-Za-z0-9_-]/g, '_')}` : '';
  const cellTag = cellInfo ? ` [cell ${cellInfo.index + 1}/${cellInfo.total}: ${cellInfo.subject_value}]` : '';

  const prompt = buildPrompt(node, config, projectName, options.retryContext, cellVars);
  const model = resolveModel(node, config);
  const apiKey = resolveApiKey();
  const endpoint = resolveEndpoint();
  const tools = buildAnthropicTools(node.tool_profile);

  // v91 — MODEL-AGNOSTIC per-node turn budget.
  // Priority: node.max_turns > MIMO_HTTP_MAX_TURNS env > module default (120).
  // Nodes that need more turns (story-runner, contract-validation) declare a
  // higher number in their blueprint; backends respect it. This lets the
  // pipeline stay backend-portable — same node descriptor works whether
  // routed to mimo, opencode, or Claude.
  const turnBudget = node?.max_turns ? parseInt(node.max_turns, 10) : MAX_TURNS;

  fs.mkdirSync(agentLogsDirFor(config, projectName), { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(agentLogsDirFor(config, projectName), `${node.id}${cellSuffix}-${timestamp}.log`);
  const logStream = fs.createWriteStream(logFile);
  logStream.write(`=== NODE: ${node.id}${cellTag} ===\n`);
  logStream.write(`timestamp: ${new Date().toISOString()}\n`);
  logStream.write(`backend: mimo-http\n`);
  logStream.write(`model: ${model}\n`);
  logStream.write(`endpoint: ${endpoint}\n`);
  logStream.write(`tools allowed: ${tools.map(t => t.name).join(', ') || '(none)'}\n`);
  logStream.write(`\n=== PROMPT (${prompt.length} chars) ===\n${prompt}\n\n=== TURNS ===\n`);

  console.log(`\n[mimo-http] node: ${node.id}${cellTag}`);
  console.log(`[mimo-http] model: ${model}`);
  console.log(`[mimo-http] log:   ${path.relative(config.targetDir, logFile)}`);

  const startTime = Date.now();
  const NODE_TIMEOUT_MS = node.timeout_ms || parseInt(process.env.NODE_TIMEOUT_MS || '1500000', 10);
  const deadline = startTime + NODE_TIMEOUT_MS;

  // Anthropic protocol: the initial user prompt goes into messages[0].
  // Subsequent assistant outputs (with tool_use blocks) and tool_result
  // content blocks alternate.
  const messages = [{ role: 'user', content: prompt }];
  const totals = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  let turns = 0;
  let finalText = '';

  try {
    while (turns < turnBudget) {
      if (Date.now() > deadline) {
        throw new Error(`mimo-http exceeded NODE_TIMEOUT_MS=${NODE_TIMEOUT_MS}ms after ${turns} turns`);
      }
      turns++;
      logStream.write(`\n--- turn ${turns} → POST ---\n`);
      const data = await postMessages({ apiKey, endpoint, model, messages, tools });

      tallyUsage(data.usage, totals);

      const contentBlocks = Array.isArray(data.content) ? data.content : [];
      const stopReason = data.stop_reason;
      logStream.write(`stop_reason: ${stopReason}  in=${data.usage?.input_tokens}/out=${data.usage?.output_tokens} cache_read=${data.usage?.cache_read_input_tokens || 0}\n`);

      // Truncation: hard fail so retry/escalation engages.
      if (stopReason === 'max_tokens') {
        throw new Error(
          `mimo-http: response truncated at max_tokens=${MAX_TOKENS} ` +
          `(turn ${turns}). Bump MIMO_HTTP_MAX_TOKENS or split the artifact.`
        );
      }

      // Concatenate text blocks for logging + final return value.
      const textParts = [];
      const toolUses = [];
      for (const block of contentBlocks) {
        if (block.type === 'text') textParts.push(block.text || '');
        else if (block.type === 'tool_use') toolUses.push(block);
        else if (block.type === 'thinking') {
          // Don't log thinking content to the conversation, just to the file.
          logStream.write(`thinking: ${String(block.thinking || '').slice(0, 200)}\n`);
        }
      }
      const turnText = textParts.join('\n');
      if (turnText) logStream.write(`text: ${turnText.slice(0, 500)}\n`);

      // Fallback parser: mimo emits tool calls as XML-style text inside
      // a text block (`<tool_call><function=NAME>...</function></tool_call>`)
      // rather than native Anthropic tool_use blocks. Extract those and
      // treat them as pseudo-tool_use. See parseTextToolCalls() docstring
      // for the exact format. We do this even when stop_reason='end_turn'
      // because mimo sometimes ends the turn while still requesting a tool.
      let outboundBlocks = contentBlocks;
      if (toolUses.length === 0 && turnText.includes('<tool_call>')) {
        const parsed = parseTextToolCalls(turnText);
        if (parsed.length > 0) {
          logStream.write(`text-embedded tool_calls parsed: ${parsed.length}\n`);
          toolUses.push(...parsed);
          // Anthropic rejects `tool_result` on a subsequent turn unless
          // the preceding assistant message contained matching `tool_use`
          // blocks (by id). Inject the synthetic tool_use blocks into
          // the assistant message we push back. CRITICAL: also preserve
          // any `thinking` blocks verbatim — mimo's extended-thinking mode
          // returns 400 "reasoning_content must be passed back" if we
          // drop them. Strip the <tool_call> XML from text blocks so we
          // don't double-feed the model on the next round.
          outboundBlocks = [];
          for (const block of contentBlocks) {
            if (block.type === 'thinking') {
              outboundBlocks.push(block);            // preserve verbatim
            } else if (block.type === 'text') {
              const cleaned = (block.text || '').replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
              if (cleaned) outboundBlocks.push({ type: 'text', text: cleaned });
            }
            // Drop other types (won't appear in mimo responses but safe).
          }
          for (const tu of toolUses) outboundBlocks.push(tu);
        }
      }
      if (toolUses.length) logStream.write(`tool_uses: ${toolUses.length}\n`);

      // Push the assistant message back (with content blocks intact —
      // Anthropic requires the full block array, not just the text).
      messages.push({ role: 'assistant', content: outboundBlocks });

      // Either native Anthropic tool_use OR mimo's text-embedded variant
      // (parsed above) → execute the tools and loop. We don't gate on
      // stopReason because mimo's text-tool-call path sometimes returns
      // stop_reason='end_turn' even with a pending <tool_call>.
      if (toolUses.length > 0) {
        const toolResults = [];
        for (const tu of toolUses) {
          logStream.write(`  → tool ${tu.name}(${JSON.stringify(tu.input).slice(0, 200)})\n`);
          const result = execToolOpenAI(adaptToolUseToExecutor(tu), config);
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          logStream.write(`  ← ${resultStr.slice(0, 500)}\n`);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: resultStr.slice(0, 50000),
          });
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // stop_reason 'end_turn' or 'stop_sequence' → done.
      finalText = turnText;
      break;
    }
    if (turns >= turnBudget) {
      throw new Error(`mimo-http: hit MAX_TURNS=${turnBudget} without stop_reason=end_turn (node-declared: ${node?.max_turns || 'unset'})`);
    }
  } catch (err) {
    logStream.write(`\n=== ERROR: ${err.message} ===\n`);
    logStream.end();
    throw err;
  }

  const duration_ms = Date.now() - startTime;
  logStream.write(`\n=== RESULT ===\nturns: ${turns}\nduration_ms: ${duration_ms}\ntokens: in=${totals.input} out=${totals.output} cache_read=${totals.cacheRead}\n\n${finalText}\n`);
  logStream.end();

  console.log(`[mimo-http] turns=${turns} in=${totals.input} out=${totals.output} duration=${(duration_ms/1000).toFixed(1)}s`);

  return {
    result: finalText,
    num_turns: turns,
    total_tokens: totals.input + totals.output,
    input_tokens: totals.input,
    output_tokens: totals.output,
    cache_read_tokens: totals.cacheRead,
    cache_creation_tokens: totals.cacheCreate,
    total_cost_usd: 0,                // Token Plan billing tracked externally
    _duration_ms: duration_ms,
    _log_file: logFile,
    _backend: 'mimo-http',
  };
}

// Re-use the OpenAI module's verifyArtifact + buildPrompt verbatim —
// both are protocol-agnostic (they read a file off disk + format a
// prompt string). Keeps agent-factory's interface uniform across
// claude / opencode / mimo backends.
const { verifyArtifact, buildPrompt } = require('./agent-opencode');

module.exports = {
  runAgentNode: runAgentNodeMimoHTTP,
  runAgentNodeMimoHTTP,
  verifyArtifact,
  buildPrompt,
  buildAnthropicTools,
  resolveModel,
  resolveApiKey,
  resolveEndpoint,
};
