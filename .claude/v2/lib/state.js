/**
 * state.js — blueprint state file + PIPELINE_STATUS.md I/O
 *
 * Safety guarantees:
 *   - writeAtomic: write → .tmp, then rename (crash-safe)
 *   - withFileLock: .lock file with retry (parallel-phase-safe)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { statusDirFor } = require('./config');

/**
 * Write file atomically: write to .tmp then rename. If process is killed
 * mid-write, the .tmp is left behind but the original file is untouched.
 */
function writeAtomic(filePath, content) {
  const tmp = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

/**
 * Simple file-based lock for serializing writes to shared files
 * (e.g., PIPELINE_STATUS.md during parallel phase execution).
 * Spins with backoff for up to ~5 seconds, then proceeds anyway
 * (stale lock protection).
 */
function withFileLock(filePath, fn) {
  const lockFile = `${filePath}.lock`;
  const maxWaitMs = 5000;
  const startTime = Date.now();
  let delay = 10;

  // Spin until we acquire the lock or timeout
  while (true) {
    try {
      // O_EXCL: fails if file exists — atomic lock acquisition
      fs.writeFileSync(lockFile, `${process.pid}\n${Date.now()}`, { flag: 'wx' });
      break; // acquired
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Check for stale lock (older than 10 seconds)
      try {
        const lockContent = fs.readFileSync(lockFile, 'utf-8');
        const lockTime = parseInt(lockContent.split('\n')[1], 10);
        if (Date.now() - lockTime > 10000) {
          // Stale lock — remove and retry
          try { fs.unlinkSync(lockFile); } catch {}
          continue;
        }
      } catch {}
      if (Date.now() - startTime > maxWaitMs) {
        // Timeout — break stale lock and proceed
        try { fs.unlinkSync(lockFile); } catch {}
        break;
      }
      // Backoff
      const jitter = Math.random() * delay;
      const waitUntil = Date.now() + delay + jitter;
      while (Date.now() < waitUntil) {} // busy-wait (sync context)
      delay = Math.min(delay * 2, 200);
    }
  }

  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockFile); } catch {}
  }
}

function blueprintStatePath(config, projectName, phaseName) {
  return path.join(statusDirFor(config, projectName), `.blueprint-${phaseName}.json`);
}

function initBlueprintState(config, projectName, phaseName, blueprint) {
  const file = blueprintStatePath(config, projectName, phaseName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const nodes = blueprint.nodes.map(n => ({
    id: n.id,
    type: n.type,
    status: 'PENDING',
    timestamp: null,
  }));
  const state = {
    blueprint: phaseName,
    blueprint_source: blueprint._meta.filename,
    target_dir: config.targetDir,
    started_at: new Date().toISOString(),
    completed_nodes: nodes,
    current_node: null,
    status: 'running',
  };
  writeAtomic(file, JSON.stringify(state, null, 2));
  return state;
}

function loadBlueprintState(config, projectName, phaseName) {
  const file = blueprintStatePath(config, projectName, phaseName);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    // Corrupted JSON from interrupted write — remove and return null
    // so the caller treats this as "no saved state" rather than crashing.
    console.error(`WARN: corrupted blueprint state at ${file}: ${err.message}`);
    console.error(`WARN: removing corrupted file — phase will start fresh`);
    try { fs.unlinkSync(file); } catch {}
    return null;
  }
}

function saveBlueprintState(config, projectName, phaseName, state) {
  const file = blueprintStatePath(config, projectName, phaseName);
  writeAtomic(file, JSON.stringify(state, null, 2));
}

function updateNodeStatus(state, nodeId, status, extra = {}) {
  let node = state.completed_nodes.find(n => n.id === nodeId);
  if (!node) {
    // v128: a node added to the blueprint AFTER this state was saved (a --resume
    // across a blueprint that gained a node). Register it instead of throwing —
    // the resume runs it fresh, so its result needs a home in completed_nodes.
    node = { id: nodeId, status: 'PENDING' };
    state.completed_nodes.push(node);
  }
  node.status = status;
  node.timestamp = new Date().toISOString();
  Object.assign(node, extra);
}

function computeBlueprintStatus(state) {
  const nodes = state.completed_nodes;
  const failed = nodes.filter(n => n.status === 'FAIL').length;
  const pending = nodes.filter(n => ['PENDING', 'PENDING_AGENT'].includes(n.status)).length;
  if (failed > 0) return 'failed';
  if (pending > 0) return 'running';
  return 'completed';
}

/**
 * Reads a single phase's Status column from PIPELINE_STATUS.md.
 * Returns one of: 'Complete', 'Failed', 'Pending', 'Running', or null if the phase row is missing.
 */
function readPhaseStatus(config, projectName, phaseName) {
  const file = path.join(statusDirFor(config, projectName), 'PIPELINE_STATUS.md');
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf-8');
  const rowRegex = new RegExp(`^\\|\\s*${phaseName}\\s*\\|\\s*([A-Za-z]+)\\s*\\|`, 'm');
  const match = content.match(rowRegex);
  return match ? match[1] : null;
}

/**
 * Reads the Score column for a phase row. Returns a float in [0, 1] or null.
 * Row format: | phase | Status | Score | Output | ... |
 */
function readPhaseScore(config, projectName, phaseName) {
  const file = path.join(statusDirFor(config, projectName), 'PIPELINE_STATUS.md');
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf-8');
  const rowRegex = new RegExp(`^\\|\\s*${phaseName}\\s*\\|\\s*[A-Za-z]+\\s*\\|\\s*([0-9.]+|-)\\s*\\|`, 'm');
  const match = content.match(rowRegex);
  if (!match || match[1] === '-') return null;
  const v = parseFloat(match[1]);
  return Number.isFinite(v) ? v : null;
}

/**
 * Flip a phase row back to Pending with score - (used between loop iterations).
 * Also removes the blueprint state file so the next run starts clean.
 */
function resetPhaseStatus(config, projectName, phaseName) {
  const file = path.join(statusDirFor(config, projectName), 'PIPELINE_STATUS.md');
  if (fs.existsSync(file)) {
    withFileLock(file, () => {
      let content = fs.readFileSync(file, 'utf-8');
      const rowRegex = new RegExp(`^(\\|\\s*${phaseName}\\s*\\|)\\s*[A-Za-z]+\\s*\\|\\s*[0-9.\\-]+\\s*\\|([^\\n]*)$`, 'm');
      content = content.replace(rowRegex, `$1 Pending | - |$2`);
      writeAtomic(file, content);
    });
  }
  const stateFile = blueprintStatePath(config, projectName, phaseName);
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
}

function updatePipelineStatusRow(config, projectName, phaseName, row) {
  const file = path.join(statusDirFor(config, projectName), 'PIPELINE_STATUS.md');
  if (!fs.existsSync(file)) {
    throw new Error(`PIPELINE_STATUS.md not found at ${file}`);
  }

  withFileLock(file, () => {
    let content = fs.readFileSync(file, 'utf-8');

    const rowRegex = new RegExp(`^\\| ${phaseName} \\|[^\\n]*$`, 'm');
    const newRow = `| ${phaseName} | ${row.status} | ${row.score} | ${row.output} | ${row.loopRuns || 0} | ${row.gateRunAt || '-'} | ${row.notes || 'fullstack-2'} |`;

    if (!rowRegex.test(content)) {
      throw new Error(`Phase row for '${phaseName}' not found in PIPELINE_STATUS.md`);
    }

    content = content.replace(rowRegex, newRow);
    content = content.replace(/^last_run: .*$/m, `last_run: ${new Date().toISOString()}`);

    writeAtomic(file, content);
  });
}

function appendExecutionLog(config, projectName, phaseName, entry) {
  const file = path.join(statusDirFor(config, projectName), 'PIPELINE_STATUS.md');
  if (!fs.existsSync(file)) return;

  withFileLock(file, () => {
    let content = fs.readFileSync(file, 'utf-8');

    const logRow = `| ${entry.date} | ${phaseName} | ${entry.gen || 1} | ${entry.duration || '-'} | ${entry.result} | ${entry.score} | ${entry.notes || 'fullstack-2'} |`;

    const logSection = content.match(/(## Execution Log[\s\S]*?\|------[^\n]*\n)([\s\S]*?)(\n## |\n---|\s*$)/);
    if (!logSection) return;
    const prefix = logSection[1];
    const existingRows = logSection[2];
    const suffix = logSection[3];
    const replacement = `${prefix}${existingRows}${logRow}\n${suffix}`;
    content = content.replace(logSection[0], replacement);
    writeAtomic(file, content);
  });
}

module.exports = {
  writeAtomic,
  withFileLock,
  blueprintStatePath,
  initBlueprintState,
  loadBlueprintState,
  saveBlueprintState,
  updateNodeStatus,
  computeBlueprintStatus,
  readPhaseStatus,
  readPhaseScore,
  resetPhaseStatus,
  updatePipelineStatusRow,
  appendExecutionLog,
};
