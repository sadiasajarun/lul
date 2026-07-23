/**
 * deterministic.js — runs deterministic blueprint nodes via shell.
 *
 * v92 — UNIVERSAL SUBPROCESS TIMEOUT.
 *
 * Every node command runs inside its own process group with a hard wall-clock
 * timeout. If the command exceeds its budget (or any subprocess in its tree
 * deadlocks at 0% CPU like react-router typegen / build did in v89-v91),
 * SIGTERM the whole group, wait 5s, then SIGKILL.
 *
 * Per-node override via `timeout_ms:` in the YAML. Otherwise:
 *   default deterministic: 10min (DETERMINISTIC_TIMEOUT_MS env)
 *
 * v89-v91 evidence: react-router typegen, react-router build, npm install,
 * tsc all hung indefinitely at 0% CPU. Without this, the orchestrator
 * waited forever — v90 stalled 3h46m, v91 stalled 5h22m.
 */

const { spawn } = require('child_process');
const { resolveVars } = require('./config');

const DEFAULT_DETERMINISTIC_TIMEOUT_MS = parseInt(
  process.env.DETERMINISTIC_TIMEOUT_MS || '600000', 10
); // 10 min

function runWithTimeout(command, options, timeoutMs) {
  // Run shell command via `bash -lc` in its own process group so we can
  // kill the whole subprocess tree on timeout (react-router spawns esbuild
  // which spawns node — kill the parent + descendants atomically).
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // new process group; lets us kill -PID for the whole tree
    });
    let stdout = '';
    let stderr = '';
    const maxBuf = 10 * 1024 * 1024;
    let truncated = false;
    child.stdout.on('data', (chunk) => {
      if (stdout.length < maxBuf) stdout += chunk.toString();
      else if (!truncated) { truncated = true; stdout += '\n[stdout truncated at 10MB]\n'; }
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < maxBuf) stderr += chunk.toString();
      else if (!truncated) { truncated = true; stderr += '\n[stderr truncated at 10MB]\n'; }
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the whole process group (negative PID). SIGTERM first, then SIGKILL.
      try { process.kill(-child.pid, 'SIGTERM'); } catch (_) {}
      setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
      }, 5000);
    }, timeoutMs);

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          exitCode: 124, // conventional `timeout` exit code
          stdout, stderr,
          error: `subprocess exceeded timeout=${timeoutMs}ms (group SIGKILLed)`,
          timedOut: true,
        });
      } else if (signal) {
        resolve({ exitCode: 128 + (signal === 'SIGKILL' ? 9 : signal === 'SIGTERM' ? 15 : 1), stdout, stderr, signal });
      } else {
        resolve({ exitCode: code || 0, stdout, stderr });
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, stdout, stderr, error: err.message });
    });
  });
}

async function runDeterministicNode(node, config, projectName) {
  if (!node.command) {
    return { exitCode: 0, stdout: '', skipped: true, reason: 'no_command' };
  }

  const command = resolveVars(node.command, config, projectName);
  const startTime = Date.now();

  // Optional condition (run with short timeout — never expected to hang)
  if (node.condition) {
    const condCmd = resolveVars(node.condition, config, projectName);
    const condResult = await runWithTimeout(condCmd, {
      cwd: config.targetDir,
      env: { ...process.env, FRONTEND_DIR: config.frontend?.dir || 'frontend', BACKEND_DIR: 'backend' },
    }, 30_000);
    if (condResult.exitCode !== 0) {
      return { exitCode: 0, stdout: '', skipped: true, reason: 'condition_false' };
    }
  }

  const maxRetries = node.max_retries || 0;
  let attempt = 0;
  let lastResult = null;

  const timeoutMs = node.timeout_ms || DEFAULT_DETERMINISTIC_TIMEOUT_MS;

  while (attempt <= maxRetries) {
    const env = {
      ...process.env,
      FRONTEND_DIR: config.frontend?.dir || 'frontend',
      BACKEND_DIR: 'backend',
      FRONTEND_PORT: String(config.frontend?.dev_port || 5173),
      // v114: pass the cell's real backend port through (was hardcoded '3000',
      // which made scaffolds like scaffold-environment emit VITE_API_URL=:3000
      // even when the cell runs on 3601 → frontend/login-proof/ensure-servers
      // port mismatch → test-api login-proof HTTP 0).
      BACKEND_PORT: String(process.env.BACKEND_PORT || '3000'),
    };
    const result = await runWithTimeout(command, {
      cwd: config.targetDir,
      env,
    }, timeoutMs);
    if (result.exitCode === 0) {
      return {
        exitCode: 0,
        stdout: result.stdout,
        duration_ms: Date.now() - startTime,
        attempts: attempt + 1,
      };
    }
    lastResult = result;
    attempt++;
    if (attempt <= maxRetries) {
      console.log(`  retry ${attempt}/${maxRetries}...${result.timedOut ? ' (previous attempt timed out)' : ''}`);
    }
  }

  return {
    exitCode: lastResult.exitCode || 1,
    stdout: lastResult.stdout || '',
    stderr: lastResult.stderr || '',
    duration_ms: Date.now() - startTime,
    attempts: attempt,
    error: lastResult.error,
    timedOut: lastResult.timedOut || false,
  };
}

module.exports = {
  runDeterministicNode,
};
