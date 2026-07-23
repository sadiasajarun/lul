/**
 * agent-opencode-http.js — runs agentic nodes via direct HTTP API to
 * opencode.ai/zen/v1/chat/completions, bypassing the `opencode run` CLI
 * (which is broken on some macOS hosts; v36/v37 evidence: silent hangs at
 * `file.watcher.updated subscribing` regardless of clean reinstall).
 *
 * Implements a multi-turn tool loop matching the subset of opencode tools the
 * FSP pipeline actually uses:
 *   Read, Write, Edit, MultiEdit, Bash, Grep, Glob
 *   WebFetch (limited), WebSearch + Task (return errors — rarely used)
 *
 * Reuses buildPrompt + verifyArtifact from agent-opencode.js so the contract
 * with the orchestrator is identical: same return shape, same logging path.
 *
 * Activated when OPENCODE_TRANSPORT=http. CLI path is the default.
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { resolveVars, agentLogsDirFor } = require('./config');

const ZEN_ENDPOINT = process.env.OPENCODE_ZEN_ENDPOINT || 'https://opencode.ai/zen/v1/chat/completions';
const MAX_TURNS = parseInt(process.env.OPENCODE_HTTP_MAX_TURNS || '60', 10);
// 8192 was the original cap; v39 evidence: minimax cut prd/generate-api-doc
// and design/design-variations mid-stream when it tried to emit long
// PROJECT_API.md / DESIGN_SYSTEM.md content inline (and even when calling
// Write, the JSON arg payload alone overran). Bumped to 32768 — covers
// every long-artifact node we've seen (PROJECT_API.md is ~24k tokens).
// Override with OPENCODE_HTTP_MAX_TOKENS if a host model rejects the cap.
const MAX_TOKENS = parseInt(process.env.OPENCODE_HTTP_MAX_TOKENS || '32768', 10);

// =============================================================================
// TOOL DEFINITIONS (OpenAI function-calling schema)
// =============================================================================

const TOOL_SCHEMAS = {
  Read: {
    type: 'function',
    function: {
      name: 'Read',
      description: 'Read a file from the filesystem. Returns the full text.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to read' },
          offset: { type: 'integer', description: '1-based line offset (optional)' },
          limit: { type: 'integer', description: 'Number of lines to read (optional)' },
        },
        required: ['file_path'],
      },
    },
  },
  Write: {
    type: 'function',
    function: {
      name: 'Write',
      description: 'Write a file. Creates parent directories as needed. Overwrites if exists.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute path to write' },
          content: { type: 'string', description: 'Full file contents' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  Edit: {
    type: 'function',
    function: {
      name: 'Edit',
      description: 'Edit a file by string replacement. old_string must be unique unless replace_all=true.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          old_string: { type: 'string', description: 'Exact text to find' },
          new_string: { type: 'string', description: 'Replacement text' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  MultiEdit: {
    type: 'function',
    function: {
      name: 'MultiEdit',
      description: 'Apply multiple edits to a single file in order.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                old_string: { type: 'string' },
                new_string: { type: 'string' },
                replace_all: { type: 'boolean' },
              },
              required: ['old_string', 'new_string'],
            },
          },
        },
        required: ['file_path', 'edits'],
      },
    },
  },
  Bash: {
    type: 'function',
    function: {
      name: 'Bash',
      description: 'Run a shell command (bash). Returns stdout+stderr+exit_code. Default cwd = project dir.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          description: { type: 'string', description: '5-10 word description (optional)' },
          timeout: { type: 'integer', description: 'Timeout in milliseconds (default 120000, max 600000)' },
        },
        required: ['command'],
      },
    },
  },
  Grep: {
    type: 'function',
    function: {
      name: 'Grep',
      description: 'Search for a pattern in files using ripgrep. Returns matching lines (or filenames with files_with_matches mode).',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern' },
          path: { type: 'string', description: 'File or directory to search (default cwd)' },
          glob: { type: 'string', description: 'Glob filter, e.g. "*.ts"' },
          output_mode: {
            type: 'string',
            enum: ['content', 'files_with_matches', 'count'],
            description: 'content = lines; files_with_matches = filenames only; count = match counts',
          },
          '-i': { type: 'boolean', description: 'Case-insensitive' },
          '-n': { type: 'boolean', description: 'Show line numbers' },
        },
        required: ['pattern'],
      },
    },
  },
  Glob: {
    type: 'function',
    function: {
      name: 'Glob',
      description: 'List files matching a glob pattern. Returns paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts"' },
          path: { type: 'string', description: 'Base directory (default cwd)' },
        },
        required: ['pattern'],
      },
    },
  },
  WebFetch: {
    type: 'function',
    function: {
      name: 'WebFetch',
      description: 'HTTP GET a URL and return the response body (text).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          prompt: { type: 'string', description: 'What to look for (ignored by minimal impl)' },
        },
        required: ['url'],
      },
    },
  },
};

function buildToolDefinitions(toolProfile, denyDefault = ['WebSearch', 'Task', 'NotebookEdit']) {
  const allow = toolProfile && Array.isArray(toolProfile.allow) ? toolProfile.allow : null;
  const deny = new Set([
    ...(toolProfile && Array.isArray(toolProfile.deny) ? toolProfile.deny : []),
    ...denyDefault,
  ]);
  const out = [];
  for (const [name, schema] of Object.entries(TOOL_SCHEMAS)) {
    if (deny.has(name)) continue;
    if (allow && !allow.includes(name)) continue;
    out.push(schema);
  }
  return out;
}

// =============================================================================
// TOOL EXECUTORS
// =============================================================================

function tool_Read(args, config) {
  const file_path = args.file_path;
  if (!file_path) return { error: 'Read: file_path required' };
  if (!fs.existsSync(file_path)) return { error: `Read: file not found: ${file_path}` };
  try {
    const content = fs.readFileSync(file_path, 'utf-8');
    const lines = content.split('\n');
    const start = (args.offset || 1) - 1;
    const limit = args.limit || lines.length;
    const slice = lines.slice(start, start + limit);
    return slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n');
  } catch (err) {
    return { error: `Read failed: ${err.message}` };
  }
}

function tool_Write(args) {
  const { file_path, content } = args;
  if (!file_path) return { error: 'Write: file_path required' };
  if (content === undefined) return { error: 'Write: content required' };
  try {
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, content);
    return `Wrote ${file_path} (${content.length} bytes)`;
  } catch (err) {
    return { error: `Write failed: ${err.message}` };
  }
}

function tool_Edit(args) {
  const { file_path, old_string, new_string, replace_all } = args;
  if (!file_path) return { error: 'Edit: file_path required' };
  if (old_string === undefined) return { error: 'Edit: old_string required' };
  if (new_string === undefined) return { error: 'Edit: new_string required' };
  if (!fs.existsSync(file_path)) return { error: `Edit: file not found: ${file_path}` };
  try {
    let content = fs.readFileSync(file_path, 'utf-8');
    if (replace_all) {
      const count = content.split(old_string).length - 1;
      if (count === 0) return { error: `Edit: old_string not found in ${file_path}` };
      content = content.split(old_string).join(new_string);
      fs.writeFileSync(file_path, content);
      return `Replaced ${count} occurrence(s) in ${file_path}`;
    }
    const idx = content.indexOf(old_string);
    if (idx === -1) return { error: `Edit: old_string not found in ${file_path}` };
    const last = content.lastIndexOf(old_string);
    if (idx !== last) return { error: `Edit: old_string is not unique in ${file_path} (use replace_all or expand the snippet)` };
    content = content.slice(0, idx) + new_string + content.slice(idx + old_string.length);
    fs.writeFileSync(file_path, content);
    return `Edited ${file_path}`;
  } catch (err) {
    return { error: `Edit failed: ${err.message}` };
  }
}

function tool_MultiEdit(args) {
  const { file_path, edits } = args;
  if (!file_path) return { error: 'MultiEdit: file_path required' };
  if (!Array.isArray(edits) || edits.length === 0) return { error: 'MultiEdit: edits array required' };
  if (!fs.existsSync(file_path)) return { error: `MultiEdit: file not found: ${file_path}` };
  try {
    let content = fs.readFileSync(file_path, 'utf-8');
    const applied = [];
    for (const [i, ed] of edits.entries()) {
      if (ed.replace_all) {
        const count = content.split(ed.old_string).length - 1;
        if (count === 0) return { error: `MultiEdit[${i}]: old_string not found` };
        content = content.split(ed.old_string).join(ed.new_string);
        applied.push(`[${i}] replaced ${count}x`);
      } else {
        const idx = content.indexOf(ed.old_string);
        if (idx === -1) return { error: `MultiEdit[${i}]: old_string not found` };
        const last = content.lastIndexOf(ed.old_string);
        if (idx !== last) return { error: `MultiEdit[${i}]: old_string not unique` };
        content = content.slice(0, idx) + ed.new_string + content.slice(idx + ed.old_string.length);
        applied.push(`[${i}] applied`);
      }
    }
    fs.writeFileSync(file_path, content);
    return `MultiEdit ${file_path}: ${applied.join(', ')}`;
  } catch (err) {
    return { error: `MultiEdit failed: ${err.message}` };
  }
}

function tool_Bash(args, config) {
  const { command, timeout = 120000 } = args;
  if (!command) return { error: 'Bash: command required' };
  const t = Math.min(Math.max(parseInt(timeout, 10) || 120000, 1000), 600000);
  try {
    const out = execSync(command, {
      shell: '/bin/bash',
      cwd: config.targetDir,
      timeout: t,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
    });
    return out;
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    return `exit_code: ${err.status ?? 'unknown'}\nstdout:\n${stdout}\nstderr:\n${stderr}`;
  }
}

function tool_Grep(args, config) {
  const { pattern } = args;
  if (!pattern) return { error: 'Grep: pattern required' };
  const cliArgs = [];
  if (args['-i']) cliArgs.push('-i');
  if (args['-n']) cliArgs.push('-n');
  const mode = args.output_mode || 'files_with_matches';
  if (mode === 'files_with_matches') cliArgs.push('-l');
  else if (mode === 'count') cliArgs.push('-c');
  if (args.glob) { cliArgs.push('--glob', args.glob); }
  cliArgs.push('--', pattern);
  cliArgs.push(args.path || config.targetDir);
  try {
    const out = execSync(`rg ${cliArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`, {
      shell: '/bin/bash',
      cwd: config.targetDir,
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
    });
    return out || '(no matches)';
  } catch (err) {
    if (err.status === 1) return '(no matches)';
    return { error: `Grep failed: ${err.message}` };
  }
}

function tool_Glob(args, config) {
  const { pattern } = args;
  if (!pattern) return { error: 'Glob: pattern required' };
  const basePath = args.path || config.targetDir;
  try {
    const out = execSync(`find ${JSON.stringify(basePath)} -type f -name '*' 2>/dev/null | head -200`, {
      shell: '/bin/bash',
      cwd: config.targetDir,
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf-8',
    });
    // Filter by glob pattern using minimatch-like regex
    const regex = new RegExp(
      '^' + pattern.replace(/[.+^$(){}|[\]\\]/g, '\\$&').replace(/\*\*/g, '___DOUBLESTAR___').replace(/\*/g, '[^/]*').replace(/___DOUBLESTAR___/g, '.*') + '$'
    );
    const files = out.split('\n').filter(f => f && regex.test(path.relative(basePath, f)));
    return files.join('\n') || '(no matches)';
  } catch (err) {
    return { error: `Glob failed: ${err.message}` };
  }
}

function tool_WebFetch(args) {
  const { url } = args;
  if (!url) return { error: 'WebFetch: url required' };
  try {
    const out = execSync(`curl -m 30 -sSL ${JSON.stringify(url)}`, {
      shell: '/bin/bash',
      timeout: 35000,
      maxBuffer: 5 * 1024 * 1024,
      encoding: 'utf-8',
    });
    return out.slice(0, 100000); // cap response size
  } catch (err) {
    return { error: `WebFetch failed: ${err.message}` };
  }
}

const TOOL_EXECUTORS = {
  Read: tool_Read,
  Write: tool_Write,
  Edit: tool_Edit,
  MultiEdit: tool_MultiEdit,
  Bash: tool_Bash,
  Grep: tool_Grep,
  Glob: tool_Glob,
  WebFetch: tool_WebFetch,
};

function executeTool(toolCall, config) {
  const name = toolCall.function?.name;
  let args = {};
  try {
    args = JSON.parse(toolCall.function?.arguments || '{}');
  } catch (e) {
    return { error: `Failed to parse tool arguments: ${e.message}` };
  }
  const fn = TOOL_EXECUTORS[name];
  if (!fn) {
    return { error: `Tool ${name} not supported in HTTP transport. Supported: ${Object.keys(TOOL_EXECUTORS).join(', ')}` };
  }
  try {
    const out = fn(args, config);
    if (out && typeof out === 'object' && out.error) {
      return out.error;
    }
    return String(out);
  } catch (err) {
    return { error: `Tool ${name} threw: ${err.message}` };
  }
}

// =============================================================================
// HTTP TOOL-LOOP DRIVER
// =============================================================================

// v40 evidence: design-variations failed with `opencode-go API 500: Internal
// server error` — a transient upstream blip, not a contract issue. One blip
// killed the entire run. Retry with exponential backoff on 5xx and on
// network-layer errors (ECONNRESET/ETIMEDOUT). 4xx still throws immediately
// — those are real (auth, model id, malformed body) and won't recover.
// v45 evidence: opencode-go had a transient outage window ~09:12-09:19 UTC
// that killed BOTH design domain-research (09:12) and database-evaluator
// (09:19). With 3 attempts + 1s/2s/4s backoff, max wait was ~7s — outage
// outlasted us → both phases cascaded. Bumping default to 6 attempts gives
// 1+2+4+8+16+32 = 63s max wait, catches outages up to ~1 min without
// ballooning normal-case latency (single attempt is still the fast path).
const RETRY_ATTEMPTS = parseInt(process.env.OPENCODE_HTTP_RETRIES || '6', 10);
const RETRY_BASE_MS = parseInt(process.env.OPENCODE_HTTP_RETRY_BASE_MS || '1000', 10);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function postCompletion({ apiKey, model, messages, tools }) {
  const body = { model, messages, max_tokens: MAX_TOKENS };
  if (tools && tools.length > 0) body.tools = tools;
  const payload = JSON.stringify(body);

  let lastErr = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(ZEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      });
      if (res.ok) return res.json();
      const text = await res.text();
      const err = new Error(`opencode-go API ${res.status}: ${text.slice(0, 500)}`);
      err.status = res.status;
      if (res.status < 500 || res.status === 501) throw err; // 4xx + 501 are terminal
      lastErr = err;
    } catch (e) {
      // Network-layer error or thrown 5xx — retryable unless we marked it
      // terminal already.
      if (e.status && e.status < 500) throw e;
      lastErr = e;
    }
    // Backoff: 1s, 2s, 4s, ... up to attempt count
    const delay = RETRY_BASE_MS * (1 << attempt);
    await sleep(delay);
  }
  throw new Error(`opencode-go API: ${RETRY_ATTEMPTS} attempts failed. Last error: ${lastErr && lastErr.message}`);
}

function resolveModel(node, config) {
  // Strip the opencode-go/ prefix if present — the zen endpoint takes the
  // bare model id (e.g. "kimi-k2.6", "minimax-m2.7").
  const raw = node.model || config.defaultModel || process.env.OPENCODE_DEFAULT_MODEL || 'kimi-k2.6';
  if (raw.includes('/')) return raw.split('/').pop();
  return raw;
}

function resolveApiKey() {
  if (process.env.OPENCODE_API_KEY) return process.env.OPENCODE_API_KEY;
  const authPath = path.join(process.env.HOME, '.local/share/opencode/auth.json');
  if (!fs.existsSync(authPath)) throw new Error('opencode auth.json not found at ' + authPath);
  const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
  if (!auth['opencode-go'] || !auth['opencode-go'].key) {
    throw new Error('opencode-go key missing from auth.json');
  }
  return auth['opencode-go'].key;
}

async function runAgentNodeHTTP(node, config, projectName, options = {}) {
  const { buildPrompt } = require('./agent-opencode');
  const cellVars = options.cellVars || null;
  const cellInfo = options.cellInfo || null;
  const cellSuffix = cellInfo ? `-${String(cellInfo.subject_value).replace(/[^A-Za-z0-9_-]/g, '_')}` : '';
  const cellTag = cellInfo ? ` [cell ${cellInfo.index + 1}/${cellInfo.total}: ${cellInfo.subject_value}]` : '';

  const prompt = buildPrompt(node, config, projectName, options.retryContext, cellVars);
  const model = resolveModel(node, config);
  const apiKey = resolveApiKey();
  const tools = buildToolDefinitions(node.tool_profile);

  fs.mkdirSync(agentLogsDirFor(config, projectName), { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(agentLogsDirFor(config, projectName), `${node.id}${cellSuffix}-${timestamp}.log`);
  const logStream = fs.createWriteStream(logFile);
  logStream.write(`=== NODE: ${node.id}${cellTag} ===\n`);
  logStream.write(`timestamp: ${new Date().toISOString()}\n`);
  logStream.write(`backend: opencode-http\n`);
  logStream.write(`model: ${model}\n`);
  logStream.write(`endpoint: ${ZEN_ENDPOINT}\n`);
  logStream.write(`tools allowed: ${tools.map(t => t.function.name).join(', ') || '(none)'}\n`);
  logStream.write(`\n=== PROMPT (${prompt.length} chars) ===\n${prompt}\n\n=== TURNS ===\n`);

  console.log(`\n[opencode-http] node: ${node.id}${cellTag}`);
  console.log(`[opencode-http] model: ${model}`);
  console.log(`[opencode-http] log:   ${path.relative(config.targetDir, logFile)}`);

  const startTime = Date.now();
  const NODE_TIMEOUT_MS = node.timeout_ms || parseInt(process.env.NODE_TIMEOUT_MS || '1500000', 10);
  const deadline = startTime + NODE_TIMEOUT_MS;

  // v91 — MODEL-AGNOSTIC per-node turn budget (see agent-mimo-http.js).
  const turnBudget = node?.max_turns ? parseInt(node.max_turns, 10) : MAX_TURNS;

  const messages = [{ role: 'user', content: prompt }];
  let turns = 0;
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let finalText = '';

  try {
    while (turns < turnBudget) {
      if (Date.now() > deadline) {
        throw new Error(`opencode-http exceeded NODE_TIMEOUT_MS=${NODE_TIMEOUT_MS}ms after ${turns} turns`);
      }
      turns++;
      logStream.write(`\n--- turn ${turns} → POST ---\n`);
      const data = await postCompletion({ apiKey, model, messages, tools });

      const cost = parseFloat(data.cost || '0') || 0;
      totalCost += cost;
      const usage = data.usage || {};
      totalInput += usage.prompt_tokens || 0;
      totalOutput += usage.completion_tokens || 0;

      const choice = data.choices?.[0];
      if (!choice) throw new Error('opencode-http: no choices in response');
      const msg = choice.message || {};
      logStream.write(`finish_reason: ${choice.finish_reason}  cost: $${cost}  tokens: in=${usage.prompt_tokens}/out=${usage.completion_tokens}\n`);
      if (msg.content) logStream.write(`content: ${String(msg.content).slice(0, 500)}\n`);
      if (msg.tool_calls?.length) logStream.write(`tool_calls: ${msg.tool_calls.length}\n`);

      // Push assistant message (with any tool_calls) into the conversation.
      // Some OpenAI-compat servers reject empty content; provide a placeholder.
      messages.push({
        role: 'assistant',
        content: msg.content || '',
        ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
      });

      if (choice.finish_reason === 'tool_calls' && msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          const name = tc.function?.name || '(unknown)';
          const args = tc.function?.arguments || '{}';
          logStream.write(`  → tool ${name}(${args.slice(0, 200)})\n`);
          const result = executeTool(tc, config);
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          logStream.write(`  ← ${resultStr.slice(0, 500)}\n`);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name,
            content: resultStr.slice(0, 50000),
          });
        }
        continue;
      }

      // finish_reason='stop' → normal completion.
      // finish_reason='length' → output was truncated at MAX_TOKENS. v39
      // evidence: minimax cut PROJECT_API.md and DESIGN_SYSTEM.md mid-stream
      // and the previous code silently treated this as success → orchestrator
      // saw "ran clean, no artifact" and reported file_missing. Now we surface
      // the truncation as a hard failure so retry/escalation can engage.
      if (choice.finish_reason === 'length') {
        throw new Error(
          `opencode-http: response truncated at MAX_TOKENS=${MAX_TOKENS} ` +
          `(turn ${turns}, last content ${(msg.content || '').length} chars). ` +
          `Bump OPENCODE_HTTP_MAX_TOKENS or split the artifact across smaller writes.`
        );
      }
      finalText = msg.content || '';
      break;
    }
    if (turns >= turnBudget) {
      throw new Error(`opencode-http: hit MAX_TURNS=${turnBudget} without finish_reason=stop (node-declared: ${node?.max_turns || 'unset'})`);
    }
  } catch (err) {
    logStream.write(`\n=== ERROR: ${err.message} ===\n`);
    logStream.end();
    throw err;
  }

  const duration_ms = Date.now() - startTime;
  logStream.write(`\n=== RESULT ===\nturns: ${turns}\nduration_ms: ${duration_ms}\ncost: $${totalCost.toFixed(6)}\ntokens: in=${totalInput} out=${totalOutput}\n\n${finalText}\n`);
  logStream.end();

  console.log(`[opencode-http] turns=${turns} cost=$${totalCost.toFixed(4)} duration=${(duration_ms/1000).toFixed(1)}s`);

  return {
    result: finalText,
    num_turns: turns,
    total_tokens: totalInput + totalOutput,
    input_tokens: totalInput,
    output_tokens: totalOutput,
    total_cost_usd: totalCost,
    _duration_ms: duration_ms,
    _log_file: logFile,
    _backend: 'opencode-http',
  };
}

module.exports = {
  runAgentNodeHTTP,
  buildToolDefinitions,
  executeTool,
  TOOL_SCHEMAS,
};
