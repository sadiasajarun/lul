/**
 * agent-opencode.js — runs agentic nodes via `opencode run` subprocess
 *
 * Drop-in replacement for agent.js that uses OpenCode instead of Claude Code.
 * Supports per-node model selection via node.model field in blueprints.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolveVars, agentLogsDirFor, statusDirFor } = require('./config');
const { buildContractHints } = require('./contract-hints');

/**
 * Build the prompt for the agent, including retry context and artifact contracts.
 */
function buildPrompt(node, config, projectName, retryContext, cellVars = null) {
  const parts = [];

  // Inject retry context from previous failed attempt
  if (retryContext) {
    parts.push('=== RETRY CONTEXT (previous attempt failed) ===');
    parts.push(`Attempt: ${retryContext.attempt} of ${retryContext.maxAttempts}`);
    parts.push(`Failure reason: ${retryContext.reason}`);
    if (retryContext.path) parts.push(`Expected artifact: ${retryContext.path}`);
    if (retryContext.pattern) parts.push(`Required pattern: ${retryContext.pattern}`);
    if (retryContext.error) parts.push(`Error: ${retryContext.error}`);
    parts.push('Fix the issue above and produce the required artifact.');
    parts.push('=== END RETRY CONTEXT ===\n\n');
  }

  // Inject cross-iteration loop context (written by runPhaseLoop after a failed iteration).
  // This carries blockers from the prior iteration's evaluator so the model can fix them
  // specifically instead of re-rolling the same defects.
  const loopCtxPath = path.join(statusDirFor(config, projectName), '.loop-context.md');
  if (fs.existsSync(loopCtxPath)) {
    const loopCtx = fs.readFileSync(loopCtxPath, 'utf-8');
    if (loopCtx.trim()) {
      parts.push('=== CROSS-ITERATION FAILURE CONTEXT (prior iteration scored below quality target) ===');
      parts.push(loopCtx);
      parts.push('=== END CROSS-ITERATION CONTEXT ===\n\n');
    }
  }

  // Surface cell context so the agent knows which fanout subject it owns.
  if (cellVars && Object.keys(cellVars).length > 0) {
    parts.push('=== FANOUT CELL ===');
    for (const [k, v] of Object.entries(cellVars)) {
      parts.push(`${k}: ${v}`);
    }
    parts.push('Implement ONLY this subject. Other subjects are owned by sibling cells running in parallel.');
    parts.push('=== END FANOUT CELL ===\n\n');
  }

  // Inject additional_read context
  if (node.context && node.context.additional_read) {
    parts.push('=== CONTEXT FILES ===\n');
    for (const pattern of node.context.additional_read) {
      const resolved = resolveVars(pattern, config, projectName, cellVars);
      if (resolved.includes('*')) {
        const dir = path.dirname(resolved);
        const base = path.basename(resolved).replace(/\*/g, '.*');
        if (fs.existsSync(dir)) {
          for (const f of fs.readdirSync(dir)) {
            if (new RegExp('^' + base + '$').test(f)) {
              const full = path.join(dir, f);
              if (fs.statSync(full).isFile()) {
                parts.push(`--- ${full} ---\n${fs.readFileSync(full, 'utf-8').slice(0, 5000)}\n`);
              }
            }
          }
        }
      } else if (fs.existsSync(resolved)) {
        parts.push(`--- ${resolved} ---\n${fs.readFileSync(resolved, 'utf-8').slice(0, 5000)}\n`);
      }
    }
    parts.push('\n=== END CONTEXT ===\n\n');
  }

  // The node's prompt
  parts.push(resolveVars(node.prompt || '', config, projectName, cellVars));

  // Artifact contract
  if (node.required_output_file) {
    const requiredPath = resolveVars(node.required_output_file, config, projectName, cellVars);
    parts.push(`\n\n=== MANDATORY ARTIFACT CONTRACT ===`);
    parts.push(`You MUST produce a file at this exact path:`);
    parts.push(`  ${requiredPath}`);
    parts.push(``);
    parts.push(`The orchestrator will verify this file exists after your run.`);
    parts.push(`If the file is missing, your work is REJECTED regardless of what you say.`);
    if (node.verification_pattern) {
      const resolvedPattern = resolveVars(node.verification_pattern, config, projectName, cellVars);
      // Model-agnostic contract hints — same block for kimi/minimax/deepseek/claude.
      for (const line of buildContractHints(resolvedPattern)) parts.push(line);
    }
    parts.push(`\nDo not claim the task is complete without writing this file.`);
  }

  return parts.join('\n');
}

/**
 * Build OpenCode CLI arguments for the node.
 */
function buildOpenCodeArgs(node, config) {
  // OpenCode 1.1.x: no --dangerously-skip-permissions flag (use opencode.json
  // `permission` block instead) and no --dir flag (cwd is set on spawn below).
  const args = [
    'run',
    '--format', 'json',
  ];

  // Per-node model override (the key feature!)
  if (node.model) {
    args.push('--model', node.model);
  } else if (config.defaultModel) {
    args.push('--model', config.defaultModel);
  } else if (process.env.OPENCODE_DEFAULT_MODEL) {
    args.push('--model', process.env.OPENCODE_DEFAULT_MODEL);
  }
  // If none specified, OpenCode uses its configured default

  return args;
}

/**
 * Parse OpenCode's nd-JSON output into a structured result.
 * OpenCode emits one JSON object per line (newline-delimited JSON).
 */
function parseOpenCodeOutput(stdout) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  const events = [];
  
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch (e) {
      // Skip non-JSON lines (shouldn't happen with --format json)
      console.warn(`[opencode] skipping non-JSON line: ${line.slice(0, 100)}`);
    }
  }

  // Extract key metrics from events
  let result = '';
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let numTurns = 0;

  for (const event of events) {
    // Count tool uses as "turns"
    if (event.type === 'tool_use') {
      numTurns++;
    }
    
    // Collect text content
    if (event.type === 'text' && event.part?.text) {
      result += event.part.text + '\n';
    }

    // Aggregate token counts from step_finish events
    if (event.type === 'step_finish' && event.part?.tokens) {
      const t = event.part.tokens;
      totalTokens += t.total || 0;
      inputTokens += t.input || 0;
      outputTokens += t.output || 0;
      costUsd += event.part.cost || 0;
    }
  }

  return {
    result: result.trim(),
    num_turns: numTurns,
    total_tokens: totalTokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_cost_usd: costUsd,
    _events: events,
  };
}

/**
 * Run an agentic node via OpenCode subprocess.
 * Returns a promise that resolves with the parsed result.
 */
function runAgentNodeCLI(node, config, projectName, options = {}) {
  return new Promise((resolve, reject) => {
    const cellVars = options.cellVars || null;
    const cellInfo = options.cellInfo || null;
    const cellSuffix = cellInfo ? `-${String(cellInfo.subject_value).replace(/[^A-Za-z0-9_-]/g, '_')}` : '';
    const cellTag = cellInfo ? ` [cell ${cellInfo.index + 1}/${cellInfo.total}: ${cellInfo.subject_value}]` : '';

    const prompt = buildPrompt(node, config, projectName, options.retryContext, cellVars);
    const args = buildOpenCodeArgs(node, config);

    // Log file per node per run (per cell when fanout is active)
    fs.mkdirSync(agentLogsDirFor(config, projectName), { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(agentLogsDirFor(config, projectName), `${node.id}${cellSuffix}-${timestamp}.log`);
    const logStream = fs.createWriteStream(logFile);

    logStream.write(`=== NODE: ${node.id}${cellTag} ===\n`);
    logStream.write(`timestamp: ${new Date().toISOString()}\n`);
    logStream.write(`backend: opencode\n`);
    logStream.write(`model: ${node.model || config.defaultModel || '(default)'}\n`);
    if (cellInfo) {
      logStream.write(`cell: ${JSON.stringify(cellInfo)}\n`);
    }
    logStream.write(`command: opencode ${args.join(' ')} "<prompt>"\n`);
    logStream.write(`\n=== PROMPT (${prompt.length} chars) ===\n${prompt}\n\n=== STDOUT ===\n`);

    console.log(`\n[opencode] node: ${node.id}${cellTag}`);
    console.log(`[opencode] model: ${node.model || config.defaultModel || '(default)'}`);
    console.log(`[opencode] log:   ${path.relative(config.targetDir, logFile)}`);
    console.log(`[opencode] launching subprocess...`);

    const startTime = Date.now();

    // OpenCode takes prompt as positional argument, not stdin
    const fullArgs = [...args, prompt];

    // Per-subprocess XDG_DATA_HOME to prevent SQLite WAL lock contention.
    // opencode stores its session DB at $XDG_DATA_HOME/opencode/opencode.db.
    // When >1 fanout subprocesses launch concurrently, they all try to open
    // the same DB → "Failed to run the query 'PRAGMA journal_mode = WAL'" →
    // first subprocess wins, others crash. v25 hit this on test-browser
    // story-runner fanout (3 frontends) — 1 succeeded, 2 watchdog'd at 45 min.
    // Fix: give each subprocess its own data home with auth.json symlinked
    // from the user's real opencode dir.
    //
    // v57 fix: also symlink log/repos/snapshot/storage. v56 evidence: opencode
    // 1.14.51 hangs silently after sqlite-migration when only auth.json is
    // present in the isolated XDG_DATA_HOME — kimi-k2.6 prompts of any
    // non-trivial size never get to the LLM call (logs show only
    // "Database migration complete." + "build · kimi-k2.6" then watchdog at
    // 25min). Smoke test reproduced the hang with just 'auth.json' symlink
    // and fixed it by adding the 4 state directories. `snapshot/` (54MB)
    // appears to be the critical one — likely model registry / provider
    // config cache opencode needs to resolve `opencode-go/...` model IDs.
    const realOpencodeDir = path.join(process.env.HOME, '.local/share/opencode');
    const subDataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'opencode-data-'));
    const subOpencodeDir = path.join(subDataDir, 'opencode');
    fs.mkdirSync(subOpencodeDir, { recursive: true });
    for (const link of ['auth.json', 'bin', 'plugin', 'log', 'repos', 'snapshot', 'storage']) {
      const src = path.join(realOpencodeDir, link);
      if (fs.existsSync(src)) {
        try { fs.symlinkSync(src, path.join(subOpencodeDir, link)); } catch (_) {}
      }
    }

    const child = spawn('opencode', fullArgs, {
      cwd: config.targetDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        TERM: 'dumb',
        XDG_DATA_HOME: subDataDir,
      },
    });

    const cleanupDataDir = () => {
      try { fs.rmSync(subDataDir, { recursive: true, force: true }); } catch (_) {}
    };

    let stdout = '';
    let stderr = '';

    // Watchdog: opencode can hang silently for hours (observed in v18, v19, v21
    // — design-evaluator and test-browser-evaluator). NODE_TIMEOUT_MS bounds
    // wallclock time per subprocess. Default 25 min — long enough for heavy
    // implement/convert nodes that legitimately take 10-20 min; short enough
    // to not stall a run on a true hang. v22 ran 10-min default and watchdog
    // fired 32 times across both cells, killing many legitimately-slow nodes
    // mid-generation. Bumped to 25 min so heavy work survives.
    // When timeout fires: SIGTERM, wait 5s, SIGKILL. The reject() path treats
    // it as a normal subprocess failure so on_failure routing still applies.
    // Per-node timeout override: blueprints can set node.timeout_ms for heavy
    // nodes (story-runner, integrate, implement, convert-pages, design-fidelity-check)
    // that walk through many sub-tasks and need more wall-clock budget than the
    // 25-min global default. Falls back to NODE_TIMEOUT_MS env, then 25 min.
    const NODE_TIMEOUT_MS = node.timeout_ms || parseInt(process.env.NODE_TIMEOUT_MS || '1500000', 10);
    let timeoutFired = false;
    const watchdog = setTimeout(() => {
      timeoutFired = true;
      const msg = `\n=== WATCHDOG TIMEOUT (${NODE_TIMEOUT_MS}ms) — killing opencode subprocess ===\n`;
      logStream.write(msg);
      console.error(`[opencode] ⚠  subprocess hung — exceeded NODE_TIMEOUT_MS=${NODE_TIMEOUT_MS}ms, killing`);
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => {
        if (!child.killed) {
          try { child.kill('SIGKILL'); } catch (_) {}
        }
      }, 5000);
    }, NODE_TIMEOUT_MS);

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      logStream.write(text);
    });

    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      logStream.write(`[stderr] ${text}`);
    });

    // OpenCode reads prompt from args, not stdin
    child.stdin.end();

    child.on('close', code => {
      clearTimeout(watchdog);
      cleanupDataDir();
      const duration = Date.now() - startTime;
      logStream.write(`\n=== EXIT CODE: ${code} | DURATION: ${duration}ms ===\n`);
      logStream.end();

      if (timeoutFired) {
        return reject(new Error(`opencode subprocess timed out after ${NODE_TIMEOUT_MS}ms (NODE_TIMEOUT_MS env var). Last stdout tail: ${stdout.slice(-300)}`));
      }

      if (code !== 0) {
        return reject(new Error(`opencode exited with code ${code}: ${stderr.slice(-500)}`));
      }

      let parsed;
      try {
        parsed = parseOpenCodeOutput(stdout);
      } catch (e) {
        return reject(new Error(`failed to parse opencode output: ${e.message}\nstdout: ${stdout.slice(-500)}`));
      }

      parsed._duration_ms = duration;
      parsed._log_file = logFile;
      parsed._backend = 'opencode';

      resolve(parsed);
    });

    child.on('error', err => {
      clearTimeout(watchdog);
      cleanupDataDir();
      logStream.end();
      reject(err);
    });
  });
}

/**
 * Verify that the required artifact exists and matches the pattern.
 * Identical to the original agent.js implementation.
 */
function verifyArtifact(node, config, projectName, cellVars = null) {
  if (!node.required_output_file) {
    return { verified: true, reason: 'no_contract' };
  }

  const file = resolveVars(node.required_output_file, config, projectName, cellVars);

  if (!fs.existsSync(file)) {
    return { verified: false, reason: 'file_missing', path: file };
  }

  const content = fs.readFileSync(file, 'utf-8');

  if (node.verification_pattern) {
    const resolvedPattern = resolveVars(node.verification_pattern, config, projectName, cellVars);
    const re = new RegExp(resolvedPattern, 'm');
    if (!re.test(content)) {
      return {
        verified: false,
        reason: 'pattern_mismatch',
        path: file,
        pattern: resolvedPattern,
        content_preview: content.slice(0, 200),
      };
    }
  }

  return {
    verified: true,
    path: file,
    size: content.length,
  };
}

/**
 * Transport-selecting entry point.
 *
 * The `opencode run` CLI hangs silently on some macOS hosts (file watcher
 * subscribe + bun runtime issue — see VERSIONS.md v37/v38). When
 * OPENCODE_TRANSPORT=http (or node.transport === 'http'), bypass the CLI and
 * drive the opencode-go /zen/v1/chat/completions endpoint directly with a
 * local tool-call loop. CLI remains the default so unaffected environments
 * are untouched.
 */
function runAgentNode(node, config, projectName, options = {}) {
  const transport =
    (node && node.transport) ||
    (config && config.opencodeTransport) ||
    process.env.OPENCODE_TRANSPORT ||
    'cli';
  if (transport === 'http') {
    const { runAgentNodeHTTP } = require('./agent-opencode-http');
    return runAgentNodeHTTP(node, config, projectName, options);
  }
  return runAgentNodeCLI(node, config, projectName, options);
}

module.exports = {
  buildPrompt,
  buildOpenCodeArgs,
  parseOpenCodeOutput,
  runAgentNode,
  runAgentNodeCLI,
  verifyArtifact,
};
