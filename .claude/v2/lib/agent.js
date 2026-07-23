/**
 * agent.js — runs an agentic node via `claude --print` subprocess
 *
 * This wraps the existing claude-agent-runner.js pattern but lives inside
 * the orchestrator so we can control logging, timeouts, and artifact
 * verification from one place.
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { resolveVars, agentLogsDirFor, statusDirFor } = require('./config');
const { buildContractHints } = require('./contract-hints');

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
      // Model-agnostic contract hints: synthesise an example matching line +
      // explicit list of drift formats the regex rejects. Same block serves
      // kimi/minimax/deepseek/claude without per-model conditionals.
      for (const line of buildContractHints(resolvedPattern)) parts.push(line);
    }
    parts.push(`\nDo not claim the task is complete without writing this file.`);
  }

  return parts.join('\n');
}

function buildClaudeArgs(node, config) {
  const args = [
    '--print',
    '--output-format=json',
    '--permission-mode', 'bypassPermissions',
    '--add-dir', config.targetDir,
  ];

  const toolProfile = node.tool_profile || {};
  if (Array.isArray(toolProfile.allow) && toolProfile.allow.length) {
    args.push('--allowed-tools', toolProfile.allow.join(' '));
  }
  if (Array.isArray(toolProfile.deny) && toolProfile.deny.length) {
    args.push('--disallowed-tools', toolProfile.deny.join(' '));
  }

  // No budget cap — we run on Claude Code OAuth/Max (flat-rate subscription).
  // Time and idle watchdogs are the only guardrails.

  return args;
}

function runAgentNode(node, config, projectName, options = {}) {
  return new Promise((resolve, reject) => {
    const cellVars = options.cellVars || null;
    const cellInfo = options.cellInfo || null;
    const cellSuffix = cellInfo ? `-${String(cellInfo.subject_value).replace(/[^A-Za-z0-9_-]/g, '_')}` : '';
    const cellTag = cellInfo ? ` [cell ${cellInfo.index + 1}/${cellInfo.total}: ${cellInfo.subject_value}]` : '';

    const prompt = buildPrompt(node, config, projectName, options.retryContext, cellVars);
    const args = buildClaudeArgs(node, config);

    // Log file per node per run (per cell when fanout is active)
    fs.mkdirSync(agentLogsDirFor(config, projectName), { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(agentLogsDirFor(config, projectName), `${node.id}${cellSuffix}-${timestamp}.log`);
    const logStream = fs.createWriteStream(logFile);
    logStream.write(`=== NODE: ${node.id}${cellTag} ===\n`);
    logStream.write(`timestamp: ${new Date().toISOString()}\n`);
    if (cellInfo) {
      logStream.write(`cell: ${JSON.stringify(cellInfo)}\n`);
    }
    logStream.write(`command: claude ${args.join(' ')}\n`);
    logStream.write(`\n=== PROMPT (${prompt.length} chars) ===\n${prompt}\n\n=== STDOUT ===\n`);

    console.log(`\n[agent] node: ${node.id}${cellTag}`);
    console.log(`[agent] tools allow: ${(node.tool_profile?.allow || []).join(' ') || '(default)'}`);
    console.log(`[agent] tools deny:  ${(node.tool_profile?.deny || []).join(' ') || '(none)'}`);
    console.log(`[agent] log:         ${path.relative(config.targetDir, logFile)}`);
    console.log(`[agent] launching claude subprocess...`);

    const startTime = Date.now();

    const child = spawn('claude', args, {
      cwd: config.targetDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    // Watchdog — match opencode agent. v34 evidence: a smoke-test claude
    // subprocess sat at 0.1% CPU with zero stdout for 2h 34min while the
    // orchestrator waited indefinitely. Priority: node.timeout_ms >
    // NODE_TIMEOUT_MS env > 1500000ms (25 min) default.
    const NODE_TIMEOUT_MS = node.timeout_ms || parseInt(process.env.NODE_TIMEOUT_MS || '1500000', 10);
    let watchdogFired = false;
    const watchdog = setTimeout(() => {
      watchdogFired = true;
      const msg = `\n=== WATCHDOG TIMEOUT (${NODE_TIMEOUT_MS}ms) — killing claude subprocess ===\n`;
      logStream.write(msg);
      console.error(`[agent] ⚠  subprocess hung — exceeded NODE_TIMEOUT_MS=${NODE_TIMEOUT_MS}ms, killing`);
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 5000);
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

    child.stdin.write(prompt);
    child.stdin.end();

    child.on('close', code => {
      clearTimeout(watchdog);
      const duration = Date.now() - startTime;
      logStream.write(`\n=== EXIT CODE: ${code} | DURATION: ${duration}ms ===\n`);
      logStream.end();

      if (watchdogFired) {
        return reject(new Error(`claude subprocess timed out after ${NODE_TIMEOUT_MS}ms (NODE_TIMEOUT_MS env var). Last stdout tail: ${stdout.slice(-300)}`));
      }
      if (code !== 0) {
        return reject(new Error(`claude exited with code ${code}: ${stderr.slice(-500)}`));
      }
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch (e) {
        return reject(new Error(`failed to parse claude output: ${e.message}\nstdout: ${stdout.slice(-500)}`));
      }
      parsed._duration_ms = duration;
      parsed._log_file = logFile;
      resolve(parsed);
    });

    child.on('error', err => {
      logStream.end();
      reject(err);
    });
  });
}

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
    // Multiline flag: blueprint patterns use ^ to anchor at line start,
    // not string start (e.g. "^## Endpoints" in a markdown body).
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

module.exports = {
  buildPrompt,
  buildClaudeArgs,
  runAgentNode,
  verifyArtifact,
};
