#!/usr/bin/env node
/**
 * fullstack-2 orchestrator — code-based pipeline phase runner
 *
 * Usage:
 *   node orchestrator.js <project> --phase <name> [--dry-run] [--verbose] [--resume]
 *   node orchestrator.js <project> --run-all [--skip-spec] [--dry-run] [--verbose]
 *
 * Supports:
 *   - Single-phase execution (--phase)
 *   - Multi-phase execution with parallel groups (--run-all)
 *   - Phase convergence loop (--phase X --loop)
 *   - Pipeline-wide generation loop (--loop)
 *   - Resume from saved blueprint state (--resume)
 *   - Reset a phase (--reset)
 *   - Load a PRD file (--prd), chainable with --run-all/--phase
 *   - Inline RL reward scoring after every episode
 *
 * Does NOT yet:
 *   - --adopt / --update
 */

const fs = require('fs');
const path = require('path');

const { findProjectRoot, makeConfig, findProjectName, getFrontends, statusDirFor, agentLogsDirFor, projectDir } = require('./lib/config');
const { loadBlueprint, validateV2Contracts, findBlueprint } = require('./lib/blueprint');
const {
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
} = require('./lib/state');
const { hasGate, runGate, runGateWithBlend, verifyGateProof } = require('./lib/gate');
const { runAgentNode, verifyArtifact } = require('./lib/agent-factory');
const { runEvaluatorNode } = require('./lib/evaluator');
const { runDeterministicNode } = require('./lib/deterministic');
const { resolveVars } = require('./lib/config');
const { createEventStream } = require('./lib/events');
const { loadRewardConfig, computeEpisodeReward } = require('./lib/reward');

// Phases whose behavior is scoped to a single frontend. When multiple frontends
// are declared in PIPELINE_STATUS.md, these phases fan out: one execution per
// frontend, each recorded under a compound phase key `<phase>:<frontend_name>`.
//
// `init` is deliberately NOT in this set: it creates shared project state
// (PIPELINE_STATUS.md, backend/, .claude-project/ skeleton) that must exist
// exactly once per project. Per-frontend directory scaffolding happens at the
// top of the frontend blueprint instead.
const FRONTEND_SCOPED_PHASES = new Set(['frontend', 'integrate', 'test-browser']);

function splitPhaseKey(key) {
  const i = key.indexOf(':');
  return i >= 0
    ? { phaseBase: key.slice(0, i), frontendName: key.slice(i + 1) }
    : { phaseBase: key, frontendName: null };
}

// Flat phase order — used for validation, --reset, and anywhere a simple list is needed.
// `pre-build` is the slim-pipeline pre-flight (replaces init/spec/prd/design/
// user-stories when --build-only is set); listed here so --reset and validation
// recognize it.
const PHASE_ORDER = [
  'init', 'spec', 'prd', 'design', 'database', 'user-stories',
  'backend', 'frontend', 'integrate', 'test-api', 'test-browser',
  'pre-build',
];

// Pipeline execution graph — each step is an array of phases that can run in parallel.
// Phases within the same step have no dependency on each other; only on prior steps.
const PIPELINE_GRAPH = [
  ['init'],
  ['spec'],
  ['prd'],
  ['design', 'database'],       // both depend only on prd
  ['user-stories', 'backend'],  // user-stories needs design; backend needs database
  ['frontend'],                 // needs design + backend (entities for types)
  ['integrate'],                // needs frontend + backend
  ['test-api'],
  ['test-browser'],
];

// Slim pipeline used by --build-only mode. Skips init/spec/prd/design/
// user-stories — the user pre-populates those via the canonical workspace
// (PRD docs + HTML + user_stories YAMLs already authored). pre-build is
// an all-deterministic pre-flight that verifies + copies + scaffolds.
// See blueprints/pre-build-2.yaml + CLAUDE.md "Slim pipeline (--build-only)".
const BUILD_ONLY_GRAPH = [
  ['pre-build'],
  ['database'],
  ['backend'],
  ['frontend'],
  ['integrate'],
  ['test-api'],
  ['test-browser'],
];

// --- argv parsing ---

function parseArgs(argv) {
  const positional = [];
  const flags = {
    phase: null,
    runAll: false,
    loop: false,
    maxIterations: 5,
    maxGenerations: 10,
    quality: 0.95,
    skipSpec: false,
    dryRun: false,
    verbose: false,
    resume: false,
    reset: null,
    prd: null,
    refresh: false,
    yes: false,
    targetDir: null,
    emitEvents: true, // on by default — every real run is training data.
                      // Suppressed automatically for dry-runs. Opt out with --no-events.
    keepGoing: false, // when a fanout cell fails, keep running surviving cells
                      // instead of aborting the batch. Phase still marked FAIL.
    noAbort: false,   // don't stop the whole pipeline when a phase fails
                      // (variance experiments where later-phase data matters)
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--phase') flags.phase = argv[++i];
    else if (a === '--run-all') flags.runAll = true;
    else if (a === '--build-only') { flags.runAll = true; flags.buildOnly = true; }  // slim pipeline (skip init/spec/prd/design/user-stories)
    else if (a === '--loop') flags.loop = true;
    else if (a === '--max-iterations') flags.maxIterations = parseInt(argv[++i], 10);
    else if (a === '--max-generations') flags.maxGenerations = parseInt(argv[++i], 10);
    else if (a === '--quality') flags.quality = parseFloat(argv[++i]);
    else if (a === '--skip-spec') flags.skipSpec = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--verbose' || a === '-v') flags.verbose = true;
    else if (a === '--resume') flags.resume = true;
    else if (a === '--reset') flags.reset = argv[++i];
    else if (a === '--prd') flags.prd = argv[++i];
    else if (a === '--refresh') flags.refresh = true;
    else if (a === '--yes' || a === '-y') flags.yes = true;
    else if (a === '--path') flags.targetDir = argv[++i];
    else if (a === '--emit-events') flags.emitEvents = true;
    else if (a === '--no-events') flags.emitEvents = false;
    else if (a === '--keep-going') flags.keepGoing = true;
    else if (a === '--no-abort') flags.noAbort = true;
    else if (!a.startsWith('--')) positional.push(a);
  }
  return { project: positional[0], ...flags };
}

/**
 * route_to_agent — when a deterministic node fails with on_failure: route_to_agent,
 * spawn an agentic subprocess to diagnose and fix the issue, then retry the
 * deterministic node.
 *
 * Returns { fixed: bool, attempts: number, agentLogs: string[] }
 */
async function routeToAgent(node, failOutput, config, projectName) {
  // v78b speed-up: default cut from 3 → 1 attempt. v77 evidence repeatedly
  // showed "⚠ fix agent introduced type errors — feeding back to next
  // attempt" on attempts 2 and 3, i.e. the model REGRESSED the codebase
  // on retry. Per-cell wall-clock saving: up to 50min when a typecheck
  // node loops. Nodes that genuinely benefit from multiple attempts can
  // still set route_to_agent_attempts: N explicitly in their blueprint.
  const maxAttempts = node.route_to_agent_attempts || 1;
  const agentLogs = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    section(`ROUTE-TO-AGENT: attempt ${attempt}/${maxAttempts} for '${node.id}'`);

    // Build a synthetic agentic node for the fix agent
    const failStdout = (failOutput.stdout || '').slice(-3000);
    const failStderr = (failOutput.stderr || '').slice(-1500);

    const fixPrompt = buildFixPrompt(node, failStdout, failStderr, attempt, maxAttempts, config, projectName);

    const fixNode = {
      id: `fix-${node.id}-attempt-${attempt}`,
      type: 'agentic',
      description: `Auto-fix for failed node '${node.id}' (attempt ${attempt})`,
      // v84: route fix-agent through Claude Code subprocess instead of
      // mimo. The main bulk-work agents (implement-fanout, convert-shell,
      // story-runner) stay on mimo for cost — they make many parallel
      // calls. But fix-agent is SURGICAL: 1-2 calls per failed node,
      // quality matters far more than cost.
      //
      // v71-v81 evidence: mimo fix-agent hit MAX_TURNS=120 in 8/10 runs
      // and introduced regressions in 5/10. Claude Code (via the user's
      // existing subscription — no API key, no per-call charge) handles
      // surgical debugging far better.
      //
      // Per-node override available via `node.fix_backend` (e.g., fall
      // back to mimo for a specific node if Claude proves wrong choice).
      backend: node.fix_backend || 'claude',
      // v100: bump fix-agent timeout 10min → 25min (matching other agentic
      // nodes). v99/v99b evidence: claude --print on real 7KB+ fix prompts
      // does 20-40 tool-use turns to repair typecheck/build/fix-contracts
      // failures. Each turn takes 5-15s (Read + Edit + Bash). The total
      // genuinely exceeds the v82 10min cap (--debug log showed claude
      // ACTIVELY streaming 120KB output in 60s, then watchdog killed it).
      // The v82 cap assumed fix-agent was looping (per v77+v79); v99b's
      // fix-agent isn't looping — it's just doing legitimate work that
      // takes longer than 10min. Trade-off: max 15min more wasted per
      // failed node IF the fix-agent really is stuck, but successful
      // self-healing saves HOURS of downstream cascade failures.
      timeout_ms: node.fix_timeout_ms || 1500000,
      tool_profile: node.fix_tool_profile || {
        allow: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
        deny: ['WebSearch', 'WebFetch'],
      },
      // No required_output_file — the "artifact" is the deterministic node passing on retry
    };

    let agentResult;
    try {
      // runAgentNode requires required_output_file for v2 contracts, but fix nodes
      // are ephemeral — skip artifact verification by temporarily setting it to a
      // dummy path that we'll create ourselves as a receipt.
      const agentLogsDir = agentLogsDirFor(config, projectName);
      const receiptPath = require('path').join(
        agentLogsDir,
        `fix-receipt-${node.id}-${attempt}.md`
      );
      fixNode.required_output_file = receiptPath;
      fixNode.verification_pattern = 'fix_attempt:';
      // Pre-create the receipt so verification always passes — we only care
      // whether the deterministic retry passes, not the agent's artifact.
      require('fs').mkdirSync(agentLogsDir, { recursive: true });
      require('fs').writeFileSync(receiptPath, `fix_attempt: ${attempt}\nnode: ${node.id}\n`);

      // Inject the fix prompt into the node for buildPrompt to pick up
      fixNode.prompt = fixPrompt;

      // v104: snapshot backend + frontend source files BEFORE fix-agent
      // runs, so we can roll back if fix-agent regresses the codebase.
      // Prior bug: orchestrator logged "original failure preserved" on
      // regression but didn't actually restore — fix-agent's bad edits
      // stayed on disk. v103 admin-dashboard cell ended with 122 errors
      // (started with 2) because the REGRESSED state was preserved.
      const snapshotDir = require('path').join(
        require('os').tmpdir(),
        `fix-agent-snapshot-${node.id}-${attempt}-${Date.now()}-${process.pid}`
      );
      const sourceDirs = [
        require('path').join(config.targetDir, 'backend', 'src'),
        require('path').join(config.targetDir, 'backend', 'test'),
        require('path').join(config.targetDir, 'frontend', 'app'),
        require('path').join(config.targetDir, 'frontend-admin-dashboard', 'app'),
        require('path').join(config.targetDir, 'frontend-company-dashboard', 'app'),
      ].filter(d => require('fs').existsSync(d));
      require('fs').mkdirSync(snapshotDir, { recursive: true });
      sourceDirs.forEach(d => {
        const dst = require('path').join(snapshotDir, require('path').relative(config.targetDir, d));
        require('fs').mkdirSync(require('path').dirname(dst), { recursive: true });
        require('child_process').execSync(`cp -R "${d}" "${dst}"`, { stdio: 'pipe' });
      });

      agentResult = await runAgentNode(fixNode, config, projectName);
      console.log(`  fix-agent duration: ${(agentResult._duration_ms / 1000).toFixed(1)}s | turns: ${agentResult.num_turns}`);
      agentLogs.push(agentResult._log_file);
      // Keep snapshotDir in scope for the regression-rollback path below.
      fixNode._snapshotDir = snapshotDir;
      fixNode._snapshotSourceDirs = sourceDirs;
    } catch (err) {
      console.error(`  fix-agent error: ${err.message}`);
      agentLogs.push(`error: ${err.message}`);
      continue; // try next attempt
    }

    // Post-fix validation: re-run the EXACT command that failed, so the
    // before/after error counts compare like-with-like. v100 evidence: the
    // prior hardcoded `cd backend && tsc && cd frontend && tsc` validation
    // ran BOTH directories regardless of which one failed. When fix-agent
    // successfully fixed a backend typecheck failure (4 → 0 backend errors),
    // the validation summed in frontend's pre-existing ~90 errors → false
    // positive "REGRESSED 4 → 90" bail. Verified manually on v100 backend
    // post-bail: 0 typecheck errors (fix worked) but orchestrator marked
    // it Failed and cascaded the bug through 5 fix-agent invocations.
    const validationCmd = node.fix_validation_command || node.command;
    section(`POST-FIX VALIDATION after fix attempt ${attempt}`);
    if (!validationCmd) {
      // Agentic nodes don't have a `command`; nothing to re-run for
      // post-fix validation. Skip the regression check and go straight
      // to the deterministic retry below. Fix-agent's own retry logic
      // will catch its own regressions.
      console.log(`  (no command on node — skipping post-fix validation, going straight to retry)`);
    } else {
    const { runDeterministicNode: validate } = require('./lib/deterministic');
    const valResult = await validate({
      command: validationCmd,
      max_retries: 0,
    }, config, projectName);
    if (valResult.exitCode !== 0) {
      // v79b regression guard: count TS errors before vs. after the fix.
      // If the fix made things WORSE (more errors than we started with),
      // BAIL immediately — retrying will only compound the regression.
      // v77+v79 evidence: 100% of "fix agent introduced type errors"
      // attempts that fed back ended up failing the final retry anyway,
      // burning 10-25min per attempt while the codebase rotted.
      const errorPattern = /error TS\d+:/g;
      const before = ((failOutput.stdout || '') + (failOutput.stderr || '')).match(errorPattern) || [];
      const after = (valResult.stdout || '').match(errorPattern) || [];
      const valErrors = (valResult.stdout || '').slice(-2000);
      if (after.length > before.length) {
        console.error(`  ⚠ fix agent REGRESSED codebase (${before.length} → ${after.length} TS errors) — bailing out of route_to_agent`);
        // v104: ROLLBACK fix-agent's edits when regression detected.
        // The prior "original failure preserved" was a LIE — the orchestrator
        // returned without restoring files, so regressed code stayed on disk
        // and cascaded into downstream phases (v103 admin-dashboard cell
        // ended with 122 errors instead of the original 2).
        if (fixNode._snapshotDir && fixNode._snapshotSourceDirs) {
          try {
            fixNode._snapshotSourceDirs.forEach(d => {
              const src = require('path').join(fixNode._snapshotDir, require('path').relative(config.targetDir, d));
              // rsync --delete ensures files created by fix-agent are removed too
              require('child_process').execSync(`rsync -a --delete "${src}/" "${d}/"`, { stdio: 'pipe' });
            });
            console.error(`  ↺ rolled back fix-agent edits to ${fixNode._snapshotSourceDirs.length} dir(s) — pre-fix state restored`);
            require('child_process').execSync(`rm -rf "${fixNode._snapshotDir}"`, { stdio: 'pipe' });
          } catch (rbErr) {
            console.error(`  ⚠ rollback failed: ${rbErr.message} — regressed state remains on disk`);
          }
        } else {
          console.error(`  → no snapshot available; downstream fix opportunity lost`);
        }
        return {
          fixed: false,
          attempts: attempt,
          retryResult: { exitCode: valResult.exitCode, stdout: valErrors, stderr: '[fix agent regressed: ' + after.length + ' > ' + before.length + ' TS errors — files rolled back]' },
          agentLogs,
        };
      }
      console.error(`  ⚠ fix agent introduced type errors (${before.length} → ${after.length}) — feeding back to next attempt`);
      failOutput = {
        ...failOutput,
        stdout: (failOutput.stdout || '') + '\n\n=== POST-FIX TSC ERRORS ===\n' + valErrors,
        stderr: (failOutput.stderr || '') + '\n[post-fix validation failed]',
      };
      continue; // skip retry, go to next fix attempt with tsc errors in context
    }
    console.log(`  ✅ post-fix validation passed (no type regressions)`);
    } // end of else (validationCmd present)

    // Retry the deterministic node
    section(`RETRY: re-running '${node.id}' after fix attempt ${attempt}`);
    const { runDeterministicNode: rerun } = require('./lib/deterministic');
    const retryResult = await rerun(node, config, projectName);

    if (retryResult.exitCode === 0) {
      console.log(`  ✅ PASS after fix attempt ${attempt}`);
      // Clean up snapshot dir on success (fix-agent's edits are keepers)
      if (fixNode._snapshotDir) {
        try { require('child_process').execSync(`rm -rf "${fixNode._snapshotDir}"`, { stdio: 'pipe' }); } catch (_) {}
      }
      return { fixed: true, attempts: attempt, retryResult, agentLogs };
    }

    console.error(`  ❌ still failing (exit ${retryResult.exitCode})`);
    // Clean up snapshot dir on retry-still-failing (next attempt will snapshot fresh)
    if (fixNode._snapshotDir) {
      try { require('child_process').execSync(`rm -rf "${fixNode._snapshotDir}"`, { stdio: 'pipe' }); } catch (_) {}
    }
    // Update failOutput for next iteration so the agent sees the latest errors
    failOutput = retryResult;
  }

  console.error(`  ⛔ route_to_agent exhausted ${maxAttempts} attempts for '${node.id}'`);
  return { fixed: false, attempts: maxAttempts, agentLogs };
}

/**
 * Build the prompt for the fix agent. The prompt gives the agent:
 * - What command failed and its output
 * - Instructions to diagnose and fix
 * - Context about the phase and project
 */
function buildFixPrompt(node, failStdout, failStderr, attempt, maxAttempts, config, projectName) {
  const command = resolveVars(node.command || '', config, projectName);
  const parts = [];

  // v59 fix — extract the subdir the failing command runs in so the fix
  // agent doesn't blindly `cat backend/...`/`ls test/setup/` from the wrong
  // working directory. v58 evidence: all 3 verify-green retry attempts
  // failed with `cat: test/setup/test-app.factory.ts: No such file or
  // directory` because the agent ran in run-dir root while the failing
  // command runs in backend/. Same pattern reproduced in fix-verify-page-
  // coverage (v57) and smoke-test (v58).
  //
  // Heuristic: parse the FIRST `cd "{TARGET_DIR}/<X>"` token from the
  // failing command — that's the directory the agent should operate from.
  const cdMatch = command.match(/cd\s+["']?([^"'\s&]+)/);
  const failingCmdCwd = cdMatch ? cdMatch[1] : null;

  parts.push(`=== FIX TASK (attempt ${attempt}/${maxAttempts}) ===`);
  parts.push(`A deterministic pipeline node failed. Your job is to fix the underlying code so the command passes on retry.`);
  parts.push('');
  parts.push(`Node: ${node.id}`);
  parts.push(`Description: ${node.description || 'n/a'}`);
  parts.push(`Command: ${command}`);
  parts.push('');
  if (failingCmdCwd) {
    parts.push(`=== WORKING DIRECTORY ===`);
    parts.push(`Your shell starts in: ${config.targetDir}`);
    parts.push(`The failing command runs in: ${failingCmdCwd}`);
    parts.push(`Before running bash commands like \`cat\`, \`ls\`, \`grep\`, or \`npx tsc\`, either:`);
    parts.push(`  (a) prepend \`cd ${failingCmdCwd} && \` to each command, OR`);
    parts.push(`  (b) use absolute paths like \`${failingCmdCwd}/test/setup/test-app.factory.ts\``);
    parts.push(`Relative paths like \`test/setup/...\` or \`src/modules/...\` are interpreted from your shell's cwd (${config.targetDir}), NOT from where the failing command runs. Reading a file with the wrong path wastes a turn on "No such file or directory".`);
    parts.push('');
  }
  parts.push('=== FAILURE OUTPUT (last 3000 chars of stdout) ===');
  parts.push(failStdout);
  if (failStderr) {
    parts.push('');
    parts.push('=== STDERR (last 1500 chars) ===');
    parts.push(failStderr);
  }
  parts.push('');
  parts.push('=== INSTRUCTIONS ===');
  parts.push('1. Read the failure output carefully. Identify the failing tests or checks.');
  parts.push('2. For each failure, read the relevant test file AND the source code it tests.');
  parts.push('3. Determine: is the test wrong, or is the source code wrong?');
  parts.push('   - If the test expects behavior the spec/PRD requires → fix the source code');
  parts.push('   - If the test has wrong expectations (wrong status code, wrong path) → fix the test');
  parts.push('4. Make the minimal fix. Do NOT add new features or refactor unrelated code.');
  parts.push('5. After fixing, do a quick sanity check by running the command yourself if possible.');
  parts.push('');
  parts.push('IMPORTANT RULES:');
  parts.push('- Fix as many failures as you can in this single pass');
  parts.push('- Do NOT delete or skip tests to make them pass');
  parts.push('- Do NOT add .skip() to tests');
  parts.push('- If a route returns 404 when 401 is expected, the route likely needs an auth guard or does not exist');
  parts.push('- Prefer fixing source code over fixing tests, unless the test is clearly wrong');
  parts.push('- Stick to POSIX/BSD shell flags (macOS host) — `cat -A` is GNU-only, use `od -c` or `cat -e` instead');

  // Inject file contents so the fix agent has actual diagnostic data,
  // not just "pass rate 12% < 80%". Blueprint nodes declare fix_read_files
  // as an array of paths (with {TARGET_DIR} vars) to inject.
  if (Array.isArray(node.fix_read_files) && node.fix_read_files.length > 0) {
    parts.push('');
    parts.push('=== DIAGNOSTIC FILES (read these before fixing) ===');
    for (const pattern of node.fix_read_files) {
      const resolved = resolveVars(pattern, config, projectName);
      if (fs.existsSync(resolved)) {
        const content = fs.readFileSync(resolved, 'utf-8').slice(0, 4000);
        parts.push(`\n--- ${resolved} ---`);
        parts.push(content);
      } else {
        parts.push(`\n--- ${resolved} --- (NOT FOUND)`);
      }
    }
    parts.push('\n=== END DIAGNOSTIC FILES ===');
  }

  // If there's a fix_context on the node, add it
  if (node.fix_context) {
    parts.push('');
    parts.push('=== ADDITIONAL CONTEXT ===');
    parts.push(resolveVars(node.fix_context, config, projectName));
  }

  return parts.join('\n');
}

function header(text, char = '=') {
  const line = char.repeat(70);
  console.log(`\n${line}\n${text}\n${line}`);
}

function section(text) {
  console.log(`\n── ${text} ${'─'.repeat(Math.max(0, 68 - text.length))}`);
}

/**
 * Run a single phase end-to-end.
 */

/**
 * Expand a node's `context.additional_read` patterns into a flat list of
 * existing absolute file paths, with template substitution (TARGET_DIR,
 * subject_var, etc.) and glob expansion. Used by the fanout cache check
 * to find the upstream inputs that determine staleness.
 *
 * Returns [] if the node declares no additional_read.
 */
function expandAdditionalRead(node, config, projectName, cellVars = null) {
  const out = [];
  const patterns = node?.context?.additional_read;
  if (!Array.isArray(patterns)) return out;
  for (const raw of patterns) {
    const resolved = resolveVars(raw, config, projectName, cellVars);
    if (resolved.includes('*')) {
      const dir = path.dirname(resolved);
      const base = path.basename(resolved).replace(/\*/g, '.*');
      if (!fs.existsSync(dir)) continue;
      let entries;
      try { entries = fs.readdirSync(dir); } catch { continue; }
      const re = new RegExp('^' + base + '$');
      for (const f of entries) {
        if (re.test(f)) {
          const full = path.join(dir, f);
          try { if (fs.statSync(full).isFile()) out.push(full); } catch {}
        }
      }
    } else if (fs.existsSync(resolved)) {
      out.push(resolved);
    }
  }
  return out;
}

/**
 * Run an agentic node in fanout mode — one parallel cell per resolved subject,
 * concurrency-capped. Each cell sees a `{subject_var}` template substitution
 * (e.g. `{module}` → `auth`) applied to required_output_file, prompt, and
 * additional_read paths. Per-cell events are emitted under the same node id
 * but tagged with a `cell` field so reward audit can group them.
 *
 * Returns one of:
 *   { status: 'PASS', cellResults }                — all cells passed
 *   { status: 'FAIL', failedCells, cellResults, error }  — at least one cell failed
 *   { status: 'NO_SUBJECTS' }                      — resolver returned []; caller falls back to single-cell
 */
async function runFanoutAgentic(node, config, projectName, args, phaseName) {
  const { resolveSubjects, normalizeSubject } = require('./lib/fanout-sources');

  let subjects;
  try {
    subjects = resolveSubjects(node.fanout.source, config, projectName);
  } catch (err) {
    return { status: 'FAIL', error: `fanout_source_error: ${err.message}`, cellResults: [] };
  }

  if (!Array.isArray(subjects) || subjects.length === 0) {
    return { status: 'NO_SUBJECTS' };
  }

  const concurrency = Math.max(1, Math.min(Number(node.fanout.concurrency || 3), subjects.length));
  const subjectVar = node.fanout.subject_var;
  const keepGoing = !!args.keepGoing;

  console.log(`  [fanout] source=${node.fanout.source} subjects=${subjects.length} concurrency=${concurrency} subject_var={${subjectVar}}`);
  for (const s of subjects) {
    const norm = normalizeSubject(s);
    console.log(`    - ${norm.label}`);
  }

  // Run cells in batches of `concurrency`. Each batch awaits Promise.all so
  // log lines from parallel cells interleave but ordering is bounded.
  const cellResults = [];
  outer: for (let i = 0; i < subjects.length; i += concurrency) {
    const batch = subjects.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(async (subject, j) => {
      const norm = normalizeSubject(subject);
      const cellInfo = {
        source: node.fanout.source,
        subject_var: subjectVar,
        subject_value: norm.varValue,
        index: i + j,
        total: subjects.length,
      };
      const cellVars = { [subjectVar]: norm.varValue };

      // Per-cell condition (shell expr) — keeps deterministic skip semantics
      if (node.condition) {
        const condCmd = resolveVars(node.condition, config, projectName, cellVars);
        const { execSync } = require('child_process');
        try {
          execSync(condCmd, { stdio: 'pipe', cwd: config.targetDir });
        } catch {
          config.events.nodeResult(phaseName, node, 'SKIPPED', { reason: 'condition_false', cell: cellInfo });
          return { status: 'SKIPPED', reason: 'condition_false', cellInfo };
        }
      }

      // Fast path: cell artifact already exists + verifies + is fresh.
      // Saves real $ on retries (loop mode, post-quota-reset reruns) — without
      // this, every retry re-spawns N claude subprocesses and re-pays for cells
      // that already passed in a prior run. Skip is opt-in via env: set
      // FANOUT_NO_CACHE=1 to force re-run all cells.
      //
      // Staleness rule: artifact must be newer than the youngest upstream
      // context file declared in node.context.additional_read. If any upstream
      // changed (e.g. PROJECT_API.md regenerated), the cached cell is stale
      // and we re-run. No additional_read declared → cache is treated as
      // fresh (no upstream signal to compare against).
      if (process.env.FANOUT_NO_CACHE !== '1') {
        const cached = verifyArtifact(node, config, projectName, cellVars);
        if (cached.verified && cached.path) {
          let isFresh = true;
          let staleAgainst = null;
          try {
            const artifactMtime = fs.statSync(cached.path).mtimeMs;
            const upstreamPaths = expandAdditionalRead(node, config, projectName, cellVars);
            for (const up of upstreamPaths) {
              try {
                const upMtime = fs.statSync(up).mtimeMs;
                if (upMtime > artifactMtime) {
                  isFresh = false;
                  staleAgainst = up;
                  break;
                }
              } catch { /* missing upstream — ignore */ }
            }
          } catch { isFresh = false; }

          if (isFresh) {
            console.log(`  [fanout] cell ${cellInfo.index + 1}/${cellInfo.total} ${cellInfo.subject_value}: cached PASS (artifact ${path.relative(config.targetDir, cached.path)})`);
            config.events.nodeResult(phaseName, node, 'PASS', {
              cached: true,
              artifact: cached.path,
              cell: cellInfo,
            });
            return { status: 'PASS', cached: true, verify: cached, cellInfo };
          } else {
            console.log(`  [fanout] cell ${cellInfo.index + 1}/${cellInfo.total} ${cellInfo.subject_value}: stale (upstream ${staleAgainst ? path.relative(config.targetDir, staleAgainst) : '?'} newer) — re-running`);
          }
        }
      }

      let result;
      try {
        result = await runAgentNode(node, config, projectName, { cellVars, cellInfo });
      } catch (err) {
        config.events.nodeResult(phaseName, node, 'FAIL', { error: err.message, cell: cellInfo });
        return { status: 'FAIL', error: err.message, cellInfo };
      }

      const verify = verifyArtifact(node, config, projectName, cellVars);
      config.events.artifactVerify(phaseName, node, verify, cellInfo);

      if (!verify.verified) {
        config.events.nodeResult(phaseName, node, 'FAIL', {
          error: `artifact_${verify.reason}`,
          duration_ms: result._duration_ms,
          turns: result.num_turns,
          cost_usd: result.total_cost_usd,
          cell: cellInfo,
        });
        return { status: 'FAIL', error: `artifact_${verify.reason}`, verify, result, cellInfo };
      }

      config.events.nodeResult(phaseName, node, 'PASS', {
        duration_ms: result._duration_ms,
        turns: result.num_turns,
        cost_usd: result.total_cost_usd,
        artifact: verify.path,
        cell: cellInfo,
      });
      return { status: 'PASS', verify, result, cellInfo };
    }));
    cellResults.push(...batchResults);

    if (!keepGoing) {
      const failed = batchResults.find(r => r.status === 'FAIL');
      if (failed) {
        console.error(`  [fanout] cell '${failed.cellInfo.subject_value}' failed — aborting remaining batches (use --keep-going to override)`);
        break outer;
      }
    }
  }

  // Aggregate
  const failedCells = cellResults.filter(r => r.status === 'FAIL');
  const passedCells = cellResults.filter(r => r.status === 'PASS');
  const skippedCells = cellResults.filter(r => r.status === 'SKIPPED');
  const completed = cellResults.length;
  const total = subjects.length;

  console.log(`  [fanout] result: ${passedCells.length}/${total} passed, ${failedCells.length} failed, ${skippedCells.length} skipped, ${total - completed} not_started`);

  if (failedCells.length === 0 && completed === total) {
    return { status: 'PASS', cellResults, total, passed: passedCells.length, skipped: skippedCells.length };
  }
  return {
    status: 'FAIL',
    error: failedCells.length ? `${failedCells.length}_cells_failed` : 'incomplete',
    failedCells,
    cellResults,
    total,
    passed: passedCells.length,
    skipped: skippedCells.length,
  };
}

/**
 *   phaseKey — either a bare phase name ("frontend") or a compound key
 *              ("frontend:admin") when this execution is scoped to one
 *              declared frontend. Blueprints are loaded by base name; state,
 *              PIPELINE_STATUS rows, events, and gate proof files use the full
 *              compound key so per-frontend runs don't collide.
 *
 * Returns { success: bool, failedNode: string|null, duration_ms: number, score: number, hardFailure: bool }
 */

// HARD vs SOFT gate classification (v114).
//   HARD = liveness/functional gate. Its failure means the phase didn't produce
//          a working artifact, so backend-dependent downstream phases (integrate,
//          test-api, test-browser) are MEANINGLESS — running them just burns hours
//          for zero signal. Hard failures abort downstream even under --no-abort.
//   SOFT = quality gate (e.g. backend-gate 26/33: architecture compliance). The
//          code still compiles/boots/serves; downstream IS meaningful. Soft
//          failures respect --no-abort (push past to gather the full ladder).
// A node may declare `severity: hard|soft` explicitly; otherwise we infer from
// the node id. Default is SOFT (conservative — only known liveness gates abort).
function nodeSeverity(node) {
  if (node && (node.severity === 'hard' || node.severity === 'soft')) return node.severity;
  const id = (node && node.id) || '';
  // DEFINITE liveness contracts: backend must compile, frontend must build,
  // servers must come up, and auth must work before api/browser tests. These
  // failures (after any route_to_agent attempts) mean downstream CANNOT run.
  //   - typecheck/build: doesn't compile/build → can't boot → hard
  //   - ensure-servers: server didn't come up → hard
  //   - global-setup-verify / login-proof: auth dead → stories can't run → hard
  // Deliberately NOT hard: verify-green (a test assertion can fail while the
  // server boots fine), and all quality gates (backend-gate score, etc.) → soft,
  // so --no-abort can still gather downstream signal.
  if (/^(typecheck|build|backend-build|frontend-build|ensure-servers)$/.test(id)) return 'hard';
  if (/global-setup-verify|login-proof|seed-and-auth-setup/.test(id)) return 'hard';
  return 'soft';
}

async function runPhase(phaseKey, args, config, projectName) {
  const { phaseBase, frontendName } = splitPhaseKey(phaseKey);
  // phaseName retained as an alias for the compound key so downstream calls
  // (state, events, gate, status row) key by the per-frontend identifier.
  const phaseName = phaseKey;
  header(`phase: ${phaseKey}`);
  config.events.phaseStart(phaseKey, null, frontendName);

  // Load blueprint (by base phase — per-frontend runs share the same blueprint)
  let blueprint;
  try {
    blueprint = loadBlueprint(config, phaseBase);
  } catch (err) {
    console.error(`\nERROR: ${err.message}`);
    const errResult = { success: false, failedNode: 'blueprint-load', duration_ms: 0, score: 0 };
    config.events.phaseEnd(phaseKey, { ...errResult, frontend: frontendName });
    return errResult;
  }

  console.log(`blueprint: ${blueprint._meta.filename} (v${blueprint._meta.version})`);
  console.log(`nodes:    ${blueprint.nodes.length}`);

  if (blueprint._meta.version === 2) {
    const validation = validateV2Contracts(blueprint);
    if (!validation.valid) {
      console.error(`\nERROR: v2 blueprint validation failed:`);
      validation.errors.forEach(e => console.error(`  - ${e}`));
      return { success: false, failedNode: 'blueprint-validation', duration_ms: 0, score: 0 };
    }
    console.log(`v2 contracts: ok (all agentic nodes declare required_output_file)`);
  } else {
    console.warn(`\nWARN: using v1 blueprint '${blueprint._meta.filename}'`);
    console.warn(`WARN: agentic nodes may lack artifact contracts — consider creating ${phaseBase}-2.yaml`);
  }

  // Initialize or resume state
  let state;
  if (args.resume) {
    state = loadBlueprintState(config, projectName, phaseName);
    if (!state) {
      // v128: a missing state file under --resume means this phase NEVER ran
      // (it was Pending — e.g. an earlier phase aborted before reaching it).
      // Only Failed/in-progress phases leave a .blueprint-<phase>.json to resume
      // from; Pending phases legitimately have none. The diagnose-and-fix loop
      // (fix an early phase → --resume) depends on the later Pending phases
      // running FRESH, not erroring. v128 hit this: frontend resumed + passed,
      // then integrate/test-api/test-browser all died at 'resume-missing'.
      console.log(`--resume: no prior state for '${phaseName}' (phase never started) — initializing fresh`);
      state = initBlueprintState(config, projectName, phaseName, blueprint);
    } else {
      console.log(`resuming from previous state (${state.completed_nodes.filter(n => n.status === 'PASS').length}/${state.completed_nodes.length} already done)`);
    }
  } else {
    state = initBlueprintState(config, projectName, phaseName, blueprint);
  }

  if (args.dryRun) {
    section('DRY RUN — walking nodes, not executing');
    for (const node of blueprint.nodes) {
      console.log(`  [${node.type.padEnd(13)}] ${node.id}${node.required_output_file ? ` → ${node.required_output_file}` : ''}`);
    }
    console.log(`  dry-run: ${blueprint.nodes.length} nodes would execute`);
    return { success: true, failedNode: null, duration_ms: 0, score: 1.0, dryRun: true };
  }

  // Walk nodes
  const startedAt = Date.now();
  let failed = false;
  let failedNode = null;

  // v128: ephemeral/liveness nodes establish runtime state — booted servers, a
  // seeded DB — that does NOT survive across a --resume (the processes are gone
  // by the next launch). Caching them as PASS makes resume SKIP the (re)boot, so
  // a downstream liveness check (login-proof) then hits a dead backend. v128
  // evidence: 3rd resume skipped ensure-servers ("PASS, already done") → no
  // backend → scaffold-global-setup-verify 7/7 HTTP 0 again, even though the
  // ensure-servers fix was in place. These nodes must ALWAYS re-run on resume
  // (their own fast-paths make re-running cheap when state genuinely persists —
  // ensure-servers shares an already-healthy owned backend instead of rebooting).
  const ALWAYS_RERUN_ON_RESUME = new Set([
    'ensure-servers', 'seed-database', 'seed-and-auth-setup', 'scaffold-global-setup-verify',
  ]);

  for (let i = 0; i < blueprint.nodes.length; i++) {
    const node = blueprint.nodes[i];
    const stateNode = state.completed_nodes.find(n => n.id === node.id);

    // v128: stateNode is undefined when the blueprint gained a node AFTER this
    // phase's state was saved (e.g. a new scaffold added between resumes). Such
    // a node has never run — treat it as pending and execute fresh, don't crash
    // on stateNode.status. (Was: TypeError reading 'status' of undefined.)
    const doneStatus = stateNode && (stateNode.status === 'PASS' || stateNode.status === 'SKIPPED');
    if (doneStatus && !ALWAYS_RERUN_ON_RESUME.has(node.id)) {
      section(`[${i + 1}/${blueprint.nodes.length}] ${node.id} (${stateNode.status}, already done)`);
      continue;
    }
    if (doneStatus && ALWAYS_RERUN_ON_RESUME.has(node.id)) {
      console.log(`  [resume] re-running ephemeral node '${node.id}' (was ${stateNode.status}) — booted/seeded state does not survive a resume`);
    }

    section(`[${i + 1}/${blueprint.nodes.length}] ${node.type}: ${node.id}`);
    if (node.description) console.log(`  description: ${node.description}`);

    state.current_node = node.id;
    saveBlueprintState(config, projectName, phaseName, state);

    if (node.type === 'deterministic') {
      const result = await runDeterministicNode(node, config, projectName);
      if (result.skipped) {
        console.log(`  SKIPPED: ${result.reason}`);
        updateNodeStatus(state, node.id, 'SKIPPED', { reason: result.reason });
        config.events.nodeResult(phaseName, node, 'SKIPPED', { reason: result.reason });
      } else if (result.exitCode === 0) {
        console.log(`  ✅ PASS (${result.duration_ms}ms, ${result.attempts} attempt${result.attempts > 1 ? 's' : ''})`);
        if (args.verbose && result.stdout.trim()) {
          const preview = result.stdout.trim().split('\n').slice(-3).join('\n    ');
          console.log(`    ${preview}`);
        }
        updateNodeStatus(state, node.id, 'PASS', {
          duration_ms: result.duration_ms,
          output: result.stdout.slice(-500),
        });
        config.events.nodeResult(phaseName, node, 'PASS', {
          duration_ms: result.duration_ms,
          attempts: result.attempts,
        });
      } else {
        console.error(`  ❌ FAIL (exit ${result.exitCode}, ${result.attempts} attempts)`);
        // Many tools (tsc, eslint) write errors to stdout. Show both so the
        // actual failure reason isn't hidden.
        if (result.stdout && result.stdout.trim()) {
          console.error(`    stdout: ${result.stdout.trim().slice(-1500)}`);
        }
        if (result.stderr && result.stderr.trim()) {
          console.error(`    stderr: ${result.stderr.trim().slice(-1500)}`);
        }
        updateNodeStatus(state, node.id, 'FAIL', {
          exit_code: result.exitCode,
          error: (result.stderr || result.stdout).slice(-500),
        });
        config.events.nodeResult(phaseName, node, 'FAIL', {
          duration_ms: result.duration_ms,
          exit_code: result.exitCode,
          attempts: result.attempts,
        });
        saveBlueprintState(config, projectName, phaseName, state);

        if (node.on_failure === 'ignore') {
          console.log(`  on_failure=ignore, continuing`);
        } else if (node.on_failure === 'route_to_agent') {
          // Spawn an agentic subprocess to diagnose and fix, then retry
          console.log(`\n  on_failure=route_to_agent — spawning fix agent...`);
          config.events.nodeResult(phaseName, node, 'ROUTE_TO_AGENT', {
            duration_ms: result.duration_ms,
            exit_code: result.exitCode,
          });
          const fixResult = await routeToAgent(node, result, config, projectName);
          if (fixResult.fixed) {
            console.log(`  ✅ route_to_agent succeeded after ${fixResult.attempts} attempt(s)`);
            updateNodeStatus(state, node.id, 'PASS', {
              duration_ms: fixResult.retryResult.duration_ms,
              output: (fixResult.retryResult.stdout || '').slice(-500),
              fix_attempts: fixResult.attempts,
              fix_agent_logs: fixResult.agentLogs,
            });
            config.events.nodeResult(phaseName, node, 'PASS', {
              via: 'route_to_agent',
              fix_attempts: fixResult.attempts,
            });
          } else {
            console.error(`\n  ⛔ route_to_agent failed after ${fixResult.attempts} attempts — aborting`);
            failed = true;
            failedNode = node.id;
            updateNodeStatus(state, node.id, 'FAIL', {
              error: `route_to_agent_exhausted_${fixResult.attempts}_attempts`,
              fix_agent_logs: fixResult.agentLogs,
            });
            break;
          }
        } else {
          // Default: abort
          failed = true;
          failedNode = node.id;
          console.error(`\nABORT: ${node.abort_message || 'deterministic node failed'}`);
          break;
        }
      }
    } else if (node.type === 'agentic') {
      if (!node.required_output_file) {
        console.error(`  ❌ FAIL: agentic node missing required_output_file contract`);
        console.error(`  fullstack-2 refuses to run agentic nodes without artifact contracts`);
        updateNodeStatus(state, node.id, 'FAIL', { error: 'no_artifact_contract' });
        config.events.nodeResult(phaseName, node, 'FAIL', { error: 'no_artifact_contract' });
        saveBlueprintState(config, projectName, phaseName, state);
        failed = true;
        failedNode = node.id;
        break;
      }

      // v80b: condition check ALSO applies to fanout agentic nodes.
      // Without this, the condition check at line ~838 only fires for
      // non-fanout agentics, so generate-tests (fanout) ran even when
      // scaffold-test-specs had already populated test/e2e (AUDIT 5).
      if (node.condition) {
        const condCmd = require('./lib/config').resolveVars(node.condition, config, projectName);
        const { execSync } = require('child_process');
        try {
          execSync(condCmd, { stdio: 'pipe', cwd: config.targetDir });
        } catch {
          console.log(`  SKIPPED: condition false (${condCmd.slice(0, 80)}...)`);
          updateNodeStatus(state, node.id, 'SKIPPED', { reason: 'condition_false' });
          config.events.nodeResult(phaseName, node, 'SKIPPED', { reason: 'condition_false' });
          saveBlueprintState(config, projectName, phaseName, state);
          continue;
        }
      }

      // Fanout branch — run one parallel cell per resolved subject. Per-cell
      // events are emitted inside runFanoutAgentic; here we just summarize and
      // map to phase-level state.
      //
      // NO_SUBJECTS: when the resolver returns an empty list (e.g.,
      // PROJECT_KNOWLEDGE.md not yet generated), the node fails. Falling back
      // to single-cell would leave the `{subject_var}` token unsubstituted in
      // the artifact path. The frontends resolver has its own default-fallback
      // so it can never reach this path; only new sources can.
      if (node.fanout) {
        const fanoutResult = await runFanoutAgentic(node, config, projectName, args, phaseName);
        if (fanoutResult.status === 'PASS') {
          console.log(`  ✅ PASS (fanout: ${fanoutResult.passed}/${fanoutResult.total} cells)`);
          updateNodeStatus(state, node.id, 'PASS', {
            fanout: {
              source: node.fanout.source,
              total: fanoutResult.total,
              passed: fanoutResult.passed,
              skipped: fanoutResult.skipped,
            },
          });
          saveBlueprintState(config, projectName, phaseName, state);
          continue;
        }
        if (fanoutResult.status === 'NO_SUBJECTS') {
          console.error(`  ❌ FAIL: fanout source '${node.fanout.source}' returned 0 subjects`);
          console.error(`    Likely cause: an upstream phase that produces the source data has not run yet.`);
          updateNodeStatus(state, node.id, 'FAIL', {
            error: `fanout_no_subjects_${node.fanout.source}`,
          });
          config.events.nodeResult(phaseName, node, 'FAIL', { error: `fanout_no_subjects_${node.fanout.source}` });
          saveBlueprintState(config, projectName, phaseName, state);
          if (node.on_failure === 'ignore') {
            console.log(`  on_failure=ignore, continuing despite empty fanout`);
            continue;
          }
          failed = true;
          failedNode = node.id;
          break;
        }
        // FAIL
        const failedSubjects = (fanoutResult.failedCells || []).map(c => c.cellInfo?.subject_value || '?').join(', ');
        console.error(`  ❌ FAIL: fanout aggregate (${fanoutResult.error}) — failed cells: ${failedSubjects || 'none completed'}`);
        updateNodeStatus(state, node.id, 'FAIL', {
          error: `fanout_${fanoutResult.error}`,
          failed_cells: failedSubjects,
        });
        saveBlueprintState(config, projectName, phaseName, state);
        if (node.on_failure === 'ignore') {
          console.log(`  on_failure=ignore, continuing despite fanout failure`);
          continue;
        }
        failed = true;
        failedNode = node.id;
        break;
      }

      // Optional condition — skip agentic node if shell expression is false
      // (mirrors the deterministic node's `condition` field)
      if (node.condition) {
        const condCmd = require('./lib/config').resolveVars(node.condition, config, projectName);
        const { execSync } = require('child_process');
        try {
          execSync(condCmd, { stdio: 'pipe', cwd: config.targetDir });
          // condition true → run the node
        } catch {
          console.log(`  SKIPPED: condition false (${condCmd.slice(0, 80)}...)`);
          updateNodeStatus(state, node.id, 'SKIPPED', { reason: 'condition_false' });
          config.events.nodeResult(phaseName, node, 'SKIPPED', { reason: 'condition_false' });
          saveBlueprintState(config, projectName, phaseName, state);
          continue;
        }
      }

      let result;
      try {
        result = await runAgentNode(node, config, projectName);
      } catch (err) {
        console.error(`  ❌ FAIL: agent subprocess error: ${err.message}`);
        updateNodeStatus(state, node.id, 'FAIL', { error: err.message });
        config.events.nodeResult(phaseName, node, 'FAIL', { error: err.message });
        saveBlueprintState(config, projectName, phaseName, state);
        if (node.on_failure === 'ignore') {
          console.log(`  on_failure=ignore, continuing despite agent error`);
          continue;
        }
        failed = true;
        failedNode = node.id;
        break;
      }

      console.log(`  duration: ${(result._duration_ms / 1000).toFixed(1)}s | turns: ${result.num_turns}`);
      if (result.result) {
        console.log(`  result:   ${String(result.result).slice(0, 200)}`);
      }

      const verify = verifyArtifact(node, config, projectName);
      config.events.artifactVerify(phaseName, node, verify);

      if (!verify.verified) {
        console.error(`  ❌ FAIL: artifact verification failed`);
        console.error(`    reason: ${verify.reason}`);
        if (verify.path) console.error(`    path:   ${verify.path}`);
        if (verify.pattern) console.error(`    pattern: ${verify.pattern}`);
        if (verify.content_preview) console.error(`    preview: ${verify.content_preview}`);
        updateNodeStatus(state, node.id, 'FAIL', {
          error: `artifact_${verify.reason}`,
          agent_log: result._log_file,
        });
        config.events.nodeResult(phaseName, node, 'FAIL', {
          error: `artifact_${verify.reason}`,
          duration_ms: result._duration_ms,
          turns: result.num_turns,
          cost_usd: result.total_cost_usd,
        });
        saveBlueprintState(config, projectName, phaseName, state);
        if (node.on_failure === 'ignore') {
          console.log(`  on_failure=ignore, continuing despite missing artifact`);
          continue;
        }
        failed = true;
        failedNode = node.id;
        break;
      }

      console.log(`  ✅ PASS (artifact verified: ${verify.path}, ${verify.size} bytes)`);
      updateNodeStatus(state, node.id, 'PASS', {
        duration_ms: result._duration_ms,
        turns: result.num_turns,
        cost_usd: result.total_cost_usd,
        artifact: verify.path,
        agent_log: result._log_file,
      });
      config.events.nodeResult(phaseName, node, 'PASS', {
        duration_ms: result._duration_ms,
        turns: result.num_turns,
        cost_usd: result.total_cost_usd,
        artifact: verify.path,
      });
    } else if (node.type === 'evaluator') {
      // Evaluator nodes produce a subjective score (coherence, originality,
      // craft, functionality) that complements the deterministic gate. They
      // use the same subprocess isolation as agentic nodes but with a
      // read-only tool profile enforced in lib/evaluator.js.
      //
      // Failure policy: evaluator failures default to `ignore` rather than
      // `abort` — a broken evaluator should be loud but not block the phase.
      // Blueprint can override with on_failure: abort when the score is
      // load-bearing (e.g., ship phase in veto blend mode).
      if (!node.required_output_file) {
        console.error(`  ❌ FAIL: evaluator node missing required_output_file contract`);
        updateNodeStatus(state, node.id, 'FAIL', { error: 'no_artifact_contract' });
        config.events.nodeResult(phaseName, node, 'FAIL', { error: 'no_artifact_contract' });
        saveBlueprintState(config, projectName, phaseName, state);
        failed = true;
        failedNode = node.id;
        break;
      }
      if (!node.rubric_file) {
        console.error(`  ❌ FAIL: evaluator node missing rubric_file`);
        updateNodeStatus(state, node.id, 'FAIL', { error: 'no_rubric_file' });
        config.events.nodeResult(phaseName, node, 'FAIL', { error: 'no_rubric_file' });
        saveBlueprintState(config, projectName, phaseName, state);
        failed = true;
        failedNode = node.id;
        break;
      }

      // Optional skip condition (same semantics as deterministic/agentic).
      if (node.condition) {
        const condCmd = require('./lib/config').resolveVars(node.condition, config, projectName);
        const { execSync } = require('child_process');
        try {
          execSync(condCmd, { stdio: 'pipe', cwd: config.targetDir });
        } catch {
          console.log(`  SKIPPED: condition false (${condCmd.slice(0, 80)}...)`);
          updateNodeStatus(state, node.id, 'SKIPPED', { reason: 'condition_false' });
          config.events.nodeResult(phaseName, node, 'SKIPPED', { reason: 'condition_false' });
          saveBlueprintState(config, projectName, phaseName, state);
          continue;
        }
      }

      const onFailure = node.on_failure || 'ignore'; // evaluator default

      let result;
      try {
        result = await runEvaluatorNode(node, config, projectName);
      } catch (err) {
        console.error(`  ⚠  evaluator subprocess error: ${err.message}`);
        updateNodeStatus(state, node.id, 'FAIL', { error: err.message });
        config.events.nodeResult(phaseName, node, 'FAIL', { error: err.message });
        saveBlueprintState(config, projectName, phaseName, state);
        if (onFailure === 'ignore') {
          console.log(`  on_failure=ignore, continuing despite evaluator error`);
          continue;
        }
        failed = true;
        failedNode = node.id;
        break;
      }

      console.log(`  duration: ${(result._duration_ms / 1000).toFixed(1)}s | turns: ${result.num_turns}`);

      // Standard artifact verification — the evaluation file must exist and
      // match the declared verification_pattern. Separate from the rubric-
      // level validation performed by lib/evaluator (that determines whether
      // the JSON *inside* the file is well-formed against the rubric).
      const verify = verifyArtifact(node, config, projectName);
      config.events.artifactVerify(phaseName, node, verify);

      const evaluation = result.evaluation || { valid: false, errors: ['no evaluation result'], normalized: null };
      const evaluationOk = verify.verified && evaluation.valid;

      if (!evaluationOk) {
        const reason = !verify.verified ? `artifact_${verify.reason}` : 'evaluation_invalid';
        console.error(`  ⚠  evaluator FAIL: ${reason}`);
        if (!verify.verified) {
          if (verify.path) console.error(`    path:    ${verify.path}`);
          if (verify.pattern) console.error(`    pattern: ${verify.pattern}`);
          if (verify.content_preview) console.error(`    preview: ${verify.content_preview}`);
        }
        if (evaluation.errors && evaluation.errors.length) {
          for (const e of evaluation.errors.slice(0, 5)) console.error(`    - ${e}`);
        }
        updateNodeStatus(state, node.id, 'FAIL', {
          error: reason,
          agent_log: result._log_file,
          evaluation_errors: evaluation.errors,
        });
        config.events.nodeResult(phaseName, node, 'FAIL', {
          error: reason,
          duration_ms: result._duration_ms,
          turns: result.num_turns,
          cost_usd: result.total_cost_usd,
        });
        saveBlueprintState(config, projectName, phaseName, state);
        if (onFailure === 'ignore') {
          console.log(`  on_failure=ignore, continuing despite evaluator failure`);
          continue;
        }
        failed = true;
        failedNode = node.id;
        break;
      }

      const norm = evaluation.normalized;
      const claimedStr = norm.claimed_overall_score != null
        ? norm.claimed_overall_score.toFixed(3)
        : 'n/a';
      console.log(`  ✅ PASS (evaluation stored: ${verify.path})`);
      console.log(`     overall_score: ${norm.overall_score.toFixed(3)}  (claimed by agent: ${claimedStr})`);
      console.log(`     blockers:      P0=${norm.p0_count}  P1=${norm.p1_count}  P2=${norm.p2_count}`);
      if (norm.mismatch_significant) {
        console.log(`     ⚠  claimed-vs-derived mismatch ${norm.mismatch.toFixed(3)} > 0.02 (agent arithmetic drift)`);
      }
      updateNodeStatus(state, node.id, 'PASS', {
        duration_ms: result._duration_ms,
        turns: result.num_turns,
        cost_usd: result.total_cost_usd,
        artifact: verify.path,
        agent_log: result._log_file,
        evaluator_score: norm.overall_score,
        claimed_evaluator_score: norm.claimed_overall_score,
        mismatch: norm.mismatch,
        p0_blockers: norm.p0_count,
        p1_blockers: norm.p1_count,
        p2_blockers: norm.p2_count,
      });
      config.events.nodeResult(phaseName, node, 'PASS', {
        duration_ms: result._duration_ms,
        turns: result.num_turns,
        cost_usd: result.total_cost_usd,
        artifact: verify.path,
        evaluator_score: norm.overall_score,
        claimed_evaluator_score: norm.claimed_overall_score,
        mismatch: norm.mismatch,
        p0_blockers: norm.p0_count,
        p1_blockers: norm.p1_count,
      });
    } else {
      console.warn(`  unknown node type: ${node.type}, skipping`);
      updateNodeStatus(state, node.id, 'SKIPPED', { reason: `unknown_type_${node.type}` });
    }

    saveBlueprintState(config, projectName, phaseName, state);
  }

  // Finalize state
  state.status = computeBlueprintStatus(state);
  state.current_node = null;
  saveBlueprintState(config, projectName, phaseName, state);

  const totalDurationMs = Date.now() - startedAt;

  // Run gate if blueprint succeeded and gate exists
  let gateResult = null;
  let gateProof = null;
  if (!failed && hasGate(config, phaseName)) {
    section(`running gate for phase '${phaseName}'`);
    // Pass the blueprint so gate can blend evaluator scores when the
    // blueprint declared any. For phases without evaluator nodes this
    // returns the same shape as the old runGate() did.
    gateResult = runGateWithBlend(config, phaseName, projectName, blueprint);
    if (!gateResult.passed) {
      console.error(`❌ gate FAILED: score=${gateResult.score} summary=${gateResult.summary}`);
      failed = true;
      failedNode = 'gate';
    } else {
      console.log(`✅ gate PASSED: score=${gateResult.score} summary=${gateResult.summary}`);
      gateProof = verifyGateProof(config, phaseName, 10, projectName);
      if (!gateProof.valid) {
        console.error(`❌ proof verification failed: ${gateProof.reason}`);
        failed = true;
        failedNode = 'verify-gate-proof';
      } else {
        console.log(`✅ proof verified: ${gateProof.path} (age ${gateProof.age_ms}ms)`);
      }
    }
    config.events.gateScore(phaseName, gateResult, gateProof);

    // If blending happened, emit the richer evaluator_score event so
    // reward.js can compute drift penalties. Skipped when no evaluator
    // node was declared for this phase (`_blend_applied` falsy).
    if (gateResult._blend_applied) {
      const det = gateResult.deterministic_score;
      const ev = gateResult.evaluator_score;
      const drift = (typeof det === 'number' && typeof ev === 'number') ? det - ev : null;
      config.events.evaluatorScore(phaseName, {
        deterministic_score: det,
        evaluator_score: ev,
        blended_score: gateResult.blended_score,
        blend_strategy: gateResult.blend_strategy,
        drift,
        p0_blockers: gateResult.p0_blockers || 0,
        p1_blockers: gateResult.p1_blockers || 0,
        p2_blockers: gateResult.p2_blockers || 0,
      });
      if (typeof drift === 'number') {
        const driftIcon = Math.abs(drift) > 0.3 ? '⚠' : '·';
        console.log(`  ${driftIcon} drift: ${drift >= 0 ? '+' : ''}${drift.toFixed(3)} (det=${det.toFixed(3)} - eval=${ev.toFixed(3)})`);
      }
    }
  }

  // Update PIPELINE_STATUS.md
  const score = gateResult?.score ?? (failed ? 0 : 1.0);
  try {
    const status = failed ? 'Failed' : 'Complete';
    const gateRunAt = gateResult ? new Date().toISOString() : '-';
    const output = gateResult ? `${gateResult.summary} (gate)` : `${state.completed_nodes.filter(n => n.status === 'PASS').length}/${state.completed_nodes.length} nodes`;

    updatePipelineStatusRow(config, projectName, phaseName, {
      status,
      score,
      output,
      gateRunAt,
      notes: 'fullstack-2',
    });
    appendExecutionLog(config, projectName, phaseName, {
      date: new Date().toISOString().split('T')[0],
      gen: 1,
      duration: `${Math.round(totalDurationMs / 1000)}s`,
      result: status,
      score,
      notes: `fullstack-2${failedNode ? ` failed:${failedNode}` : ''}`,
    });
    console.log(`\nupdated PIPELINE_STATUS.md: ${phaseName} → ${status} (score ${score})`);
  } catch (err) {
    console.error(`\nWARN: failed to update PIPELINE_STATUS.md: ${err.message}`);
  }

  // Per-phase summary
  const passedCount = state.completed_nodes.filter(n => n.status === 'PASS').length;
  const failedCount = state.completed_nodes.filter(n => n.status === 'FAIL').length;
  const skipped = state.completed_nodes.filter(n => n.status === 'SKIPPED').length;

  console.log(`\n${failed ? '❌' : '✅'} ${phaseName}: ${passedCount} pass | ${failedCount} fail | ${skipped} skipped | ${(totalDurationMs / 1000).toFixed(1)}s`);
  if (failedNode) console.log(`   failed at: ${failedNode}`);

  // v114: classify the failure as HARD (liveness gate → downstream meaningless)
  // or SOFT (quality gate → downstream still meaningful). Gate-score failures
  // have no failedNode → SOFT. Node aborts inherit the node's severity.
  const failedNodeObj = failedNode ? blueprint.nodes.find(n => n.id === failedNode) : null;
  let effectiveSeverity = failedNodeObj ? nodeSeverity(failedNodeObj) : 'soft';
  let nonBlockingSecondary = false;
  // v126: a SECONDARY (non-primary) frontend's build/typecheck failure is SOFT. The
  // PRIMARY frontend (frontends[0], the story-tested deliverable) must build → hard.
  // But an auxiliary dashboard frontend with broken convert output should NOT abort the
  // whole run — that lets the flakiest secondary hold the pipeline hostage and never
  // reach test-browser on the real app. The secondary still records FAIL (tracked), it
  // just doesn't gate downstream. Evidence: v123-v126 the main frontend built every run
  // while each secondary broke differently; only the primary's build is liveness-critical.
  // Applies to ANY hard failure on a secondary frontend (build/typecheck here, but also
  // ensure-servers/login-proof in integrate/test-browser — a frontend that didn't build
  // can't boot, and that shouldn't abort the run either). The PRIMARY frontend gates.
  if (effectiveSeverity === 'hard' && frontendName && failed) {
    try {
      const allFes = getFrontends(config, projectName);
      const primaryName = (allFes && allFes.length) ? allFes[0].name : null;
      if (primaryName && frontendName !== primaryName) {
        effectiveSeverity = 'soft';
        nonBlockingSecondary = true; // also bypass the soft-abort (no --no-abort needed)
        console.log(`   (secondary frontend '${frontendName}' ${failedNode} failure → SOFT + non-blocking; primary '${primaryName}' gates the run — v126)`);
      }
    } catch (_) { /* keep hard on any lookup error */ }
  }
  const hardFailure = !!(failed && failedNodeObj && effectiveSeverity === 'hard');

  const phaseResult = {
    success: !failed,
    failedNode,
    hardFailure,
    nonBlocking: nonBlockingSecondary, // secondary-frontend build/typecheck fail → don't gate downstream
    duration_ms: totalDurationMs,
    score,
    nodesPassed: passedCount,
    nodesFailed: failedCount,
    nodesSkipped: skipped,
    nodesTotal: blueprint.nodes.length,
    frontend: frontendName,
  };
  config.events.phaseEnd(phaseName, phaseResult);
  return phaseResult;
}

/**
 * Frontend-scoped phase fanout.
 *
 * Wraps runPhase to support per-frontend execution when multiple frontends
 * are declared in PIPELINE_STATUS.md. The inputs are a "phase key", which can
 * be:
 *   - bare base phase ("frontend"): iterate all declared frontends.
 *   - compound key ("frontend:admin"): run that one frontend only.
 *   - non-scoped phase ("backend", "prd", ...): pass-through, no fanout.
 *
 * For single-frontend projects the behavior collapses to a single runPhase
 * call that keys state as the bare phase name — byte-for-byte compatible with
 * the pre-multi-frontend pipeline.
 */
async function runPhaseWithFanout(phaseKey, args, config, projectName) {
  const { phaseBase, frontendName } = splitPhaseKey(phaseKey);

  if (!FRONTEND_SCOPED_PHASES.has(phaseBase)) {
    return runPhase(phaseBase, args, config, projectName);
  }

  const frontends = getFrontends(config, projectName);

  // Single-frontend: legacy shape — run with bare phase key, no compound rows.
  if (frontends.length === 1 && !frontendName) {
    const saved = config.frontend;
    config.frontend = frontends[0];
    try {
      return await runPhase(phaseBase, args, config, projectName);
    } finally {
      config.frontend = saved;
    }
  }

  // Explicit frontend selector.
  if (frontendName) {
    const fe = frontends.find(f => f.name === frontendName);
    if (!fe) {
      console.error(`ERROR: frontend '${frontendName}' not declared. Available: ${frontends.map(f => f.name).join(', ')}`);
      return { success: false, failedNode: 'unknown-frontend', duration_ms: 0, score: 0 };
    }
    const saved = config.frontend;
    config.frontend = fe;
    try {
      return await runPhase(`${phaseBase}:${fe.name}`, args, config, projectName);
    } finally {
      config.frontend = saved;
    }
  }

  // Multi-frontend fanout: run all declared frontends in PARALLEL.
  // Each frontend has its own isolated src/ directory and claude --print subprocess
  // so there are no write conflicts. Parallel execution reduces wall-clock time
  // proportionally to the number of frontends (e.g. 3 frontends → ~3x faster).
  section(`FANOUT ${phaseBase} (parallel): ${frontends.map(f => f.name).join(', ')}`);

  const parallelResults = await Promise.all(
    frontends.map(async (fe) => {
      // Each Promise gets its own config clone so concurrent frontends
      // don't overwrite each other's config.frontend.
      const feConfig = { ...config, frontend: fe };
      const r = await runPhase(`${phaseBase}:${fe.name}`, args, feConfig, projectName);
      return { frontend: fe.name, ...r };
    })
  );

  const allOk = parallelResults.every(r => r.success);
  // v126: prefer a BLOCKING failure (primary frontend / hard) as the representative one,
  // so the run-all summary names the real blocker, not a non-blocking secondary.
  const firstFailed = parallelResults.find(r => !r.success && !r.nonBlocking)
                    ?? parallelResults.find(r => !r.success) ?? null;
  const totalDuration = parallelResults.reduce((s, r) => s + (r.duration_ms || 0), 0);
  // v114: a fanout is a HARD failure if ANY cell hit a liveness gate (e.g. one
  // frontend failed to build) — downstream depends on every frontend.
  const fanoutHardFailure = parallelResults.some(r => !r.success && r.hardFailure);
  // v126: the fanout is NON-BLOCKING when it failed but EVERY failing cell is a
  // non-blocking secondary frontend (the primary built). Downstream runs on the primary.
  const fanoutNonBlocking = !allOk && !fanoutHardFailure &&
    parallelResults.every(r => r.success || r.nonBlocking);

  return {
    success: allOk,
    failedNode: firstFailed?.failedNode ?? null,
    hardFailure: fanoutHardFailure,
    nonBlocking: fanoutNonBlocking,
    duration_ms: totalDuration,
    score: allOk ? 1.0 : (firstFailed?.score ?? 0),
    fanout: parallelResults,
  };
}

/**
 * Re-run a single phase until score >= quality, max_iterations reached, or stagnation.
 * Stagnation = 2 consecutive iterations with score improvement < 0.01.
 */
/**
 * Path to the cross-iteration loop context file. agent.js / agent-opencode.js
 * read this file inside buildPrompt() and inject its contents as a section
 * in the agent's prompt, so the next iteration knows exactly what the prior
 * iteration's evaluator flagged.
 */
function loopContextPath(config, projectName) {
  return path.join(config.targetDir, '.claude-project', 'status', projectName, '.loop-context.md');
}

function clearLoopContext(config, projectName) {
  try { fs.unlinkSync(loopContextPath(config, projectName)); } catch (_) { /* not present */ }
}

/**
 * Read the prior iteration's `{phase}-evaluation.json`, format the blockers
 * + score breakdown into markdown, and write to `.loop-context.md`. The next
 * iteration's agent prompts will pick it up automatically via buildPrompt().
 *
 * No-op if the eval file is missing or unparseable.
 */
function writeLoopContext(config, projectName, phaseName, priorIter, priorScore, args) {
  const evalPath = path.join(config.targetDir, '.claude-project', 'status', projectName, `${phaseName}-evaluation.json`);
  if (!fs.existsSync(evalPath)) return;

  let evalData;
  try {
    evalData = JSON.parse(fs.readFileSync(evalPath, 'utf-8'));
  } catch (_) {
    return;
  }

  const lines = [];
  lines.push(`# Iteration ${priorIter} Failed — Fix These Specific Defects`);
  lines.push('');
  lines.push(`Prior iteration scored **${(evalData.overall_score ?? priorScore).toFixed(3)}** against quality target **${args.quality}**.`);
  lines.push('');

  if (evalData.weighted_breakdown) {
    lines.push('## Score breakdown');
    for (const [k, v] of Object.entries(evalData.weighted_breakdown)) {
      lines.push(`- ${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`);
    }
    lines.push('');
  }

  const blockers = evalData.blockers || [];
  if (blockers.length === 0) {
    lines.push('## No blockers reported by evaluator');
    lines.push('Score was below threshold but evaluator did not enumerate specific defects.');
    lines.push('Prioritize improvements across all weighted criteria above.');
  } else {
    lines.push(`## Blockers (${blockers.length}) — fix each one this iteration`);
    lines.push('');
    for (const b of blockers) {
      const sev = (b.severity || '?').toString().toUpperCase();
      const crit = b.criterion || 'general';
      lines.push(`### [${sev}] ${crit}`);
      if (b.location) lines.push(`**Location:** \`${b.location}\``);
      if (b.issue) lines.push(`**Issue:** ${b.issue}`);
      if (b.suggestion) lines.push(`**Suggestion:** ${b.suggestion}`);
      lines.push('');
    }
  }

  lines.push('## Rules for this iteration');
  lines.push('- Apply every suggestion above when regenerating artifacts.');
  lines.push('- Do NOT introduce new defects while fixing these.');
  lines.push(`- Score must reach ${args.quality} for convergence.`);
  lines.push('');

  const dir = path.dirname(loopContextPath(config, projectName));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(loopContextPath(config, projectName), lines.join('\n'));
  console.log(`  loop context written: ${blockers.length} blocker(s) → next iteration prompt`);
}

async function runPhaseLoop(phaseName, args, config, projectName) {
  header(`PHASE LOOP: ${phaseName}`);
  console.log(`target quality: ${args.quality}`);
  console.log(`max iterations: ${args.maxIterations}`);

  // Wipe any stale loop context from a prior --loop run so iter 1 starts clean.
  clearLoopContext(config, projectName);

  const history = [];
  let bestScore = 0;
  let stagnantCount = 0;

  try {
    for (let iter = 1; iter <= args.maxIterations; iter++) {
      section(`ITERATION ${iter}/${args.maxIterations}`);
      config.events.iterationStart(phaseName, iter);

      // Reset state so this iteration runs clean (don't honor --resume inside a loop)
      const iterArgs = { ...args, resume: false };
      resetPhaseStatus(config, projectName, phaseName);

      const result = await runPhaseWithFanout(phaseName, iterArgs, config, projectName);
      const score = result.score ?? 0;
      history.push({ iter, score, success: result.success, failedNode: result.failedNode });
      config.events.iterationEnd(phaseName, iter, score, result.success);

      console.log(`  iteration ${iter} score: ${score.toFixed(3)} (best so far: ${bestScore.toFixed(3)})`);

      // Convergence check
      if (result.success && score >= args.quality) {
        header(`✅ CONVERGED on iteration ${iter} (score ${score.toFixed(3)} >= ${args.quality})`);
        printLoopHistory(history);
        config.events.convergence({ mode: 'phase-loop', phase: phaseName, iterations: iter, score });
        return { success: true, iterations: iter, finalScore: score, history };
      }

      // Stagnation check
      const improvement = score - bestScore;
      if (improvement < 0.01) {
        stagnantCount++;
        console.log(`  stagnation counter: ${stagnantCount}/2 (improvement ${improvement.toFixed(3)} < 0.01)`);
        if (stagnantCount >= 2) {
          header(`⏹  STAGNATED after ${iter} iterations (no meaningful improvement)`);
          printLoopHistory(history);
          config.events.stagnation('phase-loop-flat', { phase: phaseName, iterations: iter, best_score: bestScore });
          return { success: false, reason: 'stagnation', iterations: iter, finalScore: score, history };
        }
      } else {
        stagnantCount = 0;
        bestScore = Math.max(bestScore, score);
      }

      // Before next iteration: write the prior evaluator's blockers into
      // .loop-context.md so the next iteration's agent prompt can read them.
      if (iter < args.maxIterations) {
        writeLoopContext(config, projectName, phaseName, iter, score, args);
      }
    }

    header(`⏹  MAX ITERATIONS REACHED (${args.maxIterations})`);
    printLoopHistory(history);
    return { success: false, reason: 'max_iterations', iterations: args.maxIterations, finalScore: bestScore, history };
  } finally {
    // Always clean up the loop context file when the loop exits.
    clearLoopContext(config, projectName);
  }
}

function printLoopHistory(history) {
  console.log(`\niteration history:`);
  for (const h of history) {
    const icon = h.success ? '✅' : '❌';
    const failed = h.failedNode ? ` (failed: ${h.failedNode})` : '';
    console.log(`  ${icon} iter ${h.iter}: score=${h.score.toFixed(3)}${failed}`);
  }
}

/**
 * Loop the entire pipeline phase-by-phase.
 *
 * For each phase in pipeline order:
 *   1. If already Complete with score >= quality → skip
 *   2. Otherwise run runPhaseLoop() until that phase converges
 *   3. If the phase fails to converge → STOP and report which phase blocked
 *   4. Only advance to the next phase once the current one passes
 *
 * This replaces the old whole-pipeline generation loop. Benefits:
 *   - No wasted compute re-running phases that already passed
 *   - Failure is localized — you know exactly which phase is the bottleneck
 *   - Simpler convergence signal per phase (each phase owns its own gate threshold)
 *   - Naturally respects dependency order
 */
async function runPipelineLoop(args, config, projectName) {
  header(`PIPELINE LOOP — phase-by-phase convergence`);
  console.log(`target quality:  ${args.quality}`);
  console.log(`max iterations:  ${args.maxIterations} per phase`);
  console.log(`skip-spec:       ${args.skipSpec}`);

  const phases = PHASE_ORDER.filter(p => !(args.skipSpec && p === 'spec'));

  const summary = []; // { phase, result: 'skipped'|'converged'|'failed', score, iterations }
  let gen = 0; // used for event compat — each phase convergence = one "generation"

  for (const phaseName of phases) {
    // Skip phases that are already Complete and above threshold, AND whose
    // artifacts still pass the gate (guards against stale PIPELINE_STATUS.md).
    const existingStatus = readPhaseStatus(config, projectName, phaseName);
    const existingScore = readPhaseScore(config, projectName, phaseName) ?? 0;
    if (existingStatus === 'Complete' && existingScore >= args.quality &&
        verifyCompleteStatusIsReal(phaseName, config, projectName, args.quality)) {
      console.log(`\n⏭  SKIP ${phaseName} — already Complete (score ${existingScore.toFixed(3)} >= ${args.quality})`);
      summary.push({ phase: phaseName, result: 'skipped', score: existingScore, iterations: 0 });
      continue;
    }

    gen++;
    config.events.generationStart(gen);
    header(`PHASE ${phaseName.toUpperCase()} — converging to ${args.quality}`);

    const result = await runPhaseLoop(phaseName, args, config, projectName);
    const finalScore = result.finalScore ?? 0;

    config.events.generationEnd(gen, finalScore, finalScore - existingScore, result.success);

    if (result.success) {
      console.log(`\n✅ ${phaseName} converged (score ${finalScore.toFixed(3)}) — advancing to next phase`);
      summary.push({ phase: phaseName, result: 'converged', score: finalScore, iterations: result.iterations });
    } else {
      // Phase failed to converge — stop the pipeline here
      const reason = result.reason === 'stagnation' ? 'stagnated' : `max iterations (${args.maxIterations}) reached`;
      header(`⛔ PIPELINE BLOCKED at phase '${phaseName}' (${reason}, score ${finalScore.toFixed(3)})`);
      summary.push({ phase: phaseName, result: 'failed', score: finalScore, iterations: result.iterations, reason: result.reason });
      printPipelineSummary(summary);
      config.events.stagnation('pipeline-phase-blocked', { phase: phaseName, score: finalScore, reason: result.reason });
      return { success: false, reason: 'phase_blocked', blockedAt: phaseName, finalScore, history: summary };
    }
  }

  // All phases converged
  const totalScore = summary.reduce((s, p) => s + p.score, 0);
  header(`✅ PIPELINE FULLY CONVERGED (${phases.length} phases passed)`);
  printPipelineSummary(summary);
  config.events.convergence({ mode: 'pipeline-loop', phases: phases.length, totalScore });
  return { success: true, phases: phases.length, totalScore, history: summary };
}

function printPipelineSummary(summary) {
  console.log(`\npipeline summary:`);
  console.log(`  phase          | result     | score | iters`);
  console.log(`  ---------------+------------+-------+------`);
  for (const h of summary) {
    const icon = h.result === 'converged' ? '✅' : h.result === 'skipped' ? '⏭ ' : '❌';
    const score = h.score != null ? h.score.toFixed(3) : '  n/a';
    const iters = h.result === 'skipped' ? ' skip' : String(h.iterations).padStart(5);
    console.log(`  ${icon} ${h.phase.padEnd(13)} | ${h.result.padEnd(10)} | ${score} | ${iters}`);
  }
}

// Legacy function (no longer called by runPipelineLoop, kept for safety)
function printPipelineHistory(history) {
  console.log(`\ngeneration history:`);
  console.log(`  gen | total  | Δ      | run  | notes`);
  console.log(`  ----+--------+--------+------+------`);
  for (const h of history) {
    const delta = h.improvement >= 0 ? `+${h.improvement.toFixed(3)}` : h.improvement.toFixed(3);
    const runIcon = h.runOk ? '✅' : '❌';
    console.log(`  ${String(h.gen).padStart(3)} | ${h.total.toFixed(2).padStart(6)} | ${delta.padStart(6)} | ${runIcon}   |`);
  }
}

/**
 * Verify a phase marked Complete in PIPELINE_STATUS.md still has its artifacts.
 *
 * PIPELINE_STATUS.md is user-editable and can drift from reality (e.g. if a
 * project was renamed, artifacts were manually deleted, or a status file from
 * another project got copied in). Before honoring a Complete row as a skip,
 * re-run the phase's gate script — gates already encode the real artifact
 * requirements. If the gate fails, status is stale: mark the phase Pending and
 * force the caller to re-run it.
 *
 * Returns true if status is trustworthy and the phase should be skipped.
 * Returns false if status is stale (and has been reset to Pending) and the
 * caller should run the phase.
 */
function verifyCompleteStatusIsReal(phaseName, config, projectName, minScore = 0) {
  // FROM_BACKEND freeze (FREEZE_BACKEND=1): database+backend are an operator-frozen,
  // boots-verified backend. Re-running the strict QUALITY gate against them defeats
  // the freeze — the gate judges quality (the frozen backend scores ~0.71 with known
  // backlog issues: stub controllers, swagger/validator coverage), NOT whether the
  // frozen artifact is present + usable. Do a light artifact check instead.
  if (process.env.FREEZE_BACKEND === '1' && (phaseName === 'backend' || phaseName === 'database')) {
    const beMain = path.join(config.targetDir || '.', 'backend', 'src', 'main.ts');
    if (fs.existsSync(beMain)) {
      console.log(`\n⏭  FROM_BACKEND: trusting frozen ${phaseName} (artifact present: backend/src/main.ts) — skipping quality re-verification`);
      return true;
    }
    console.warn(`⚠  FROM_BACKEND set but backend/src/main.ts missing — verifying ${phaseName} normally`);
  }
  if (!hasGate(config, phaseName)) {
    // No gate to verify against — trust the status.
    return true;
  }
  const gateResult = runGate(config, phaseName, projectName);
  const passed = gateResult.passed && (gateResult.score ?? 0) >= minScore;
  if (passed) return true;

  const detail = gateResult.summary || gateResult.stdout?.slice(0, 200) || '(no output)';
  console.warn(`\n⚠  STALE STATUS: ${phaseName} marked Complete but gate re-check failed (${detail}).`);
  console.warn(`   Resetting ${phaseName} → Pending. Phase will re-run.`);
  resetPhaseStatus(config, projectName, phaseName);
  return false;
}

/**
 * Run a single phase within runAll, handling skip/complete/missing-blueprint checks.
 * Returns { phase, ...result } or a skip record.
 */
async function runOnePhaseInPipeline(phaseName, args, config, projectName) {
  const currentStatus = readPhaseStatus(config, projectName, phaseName);
  if (currentStatus === 'Complete' && verifyCompleteStatusIsReal(phaseName, config, projectName)) {
    console.log(`\n⏭  SKIP ${phaseName} — already Complete in PIPELINE_STATUS.md`);
    return { phase: phaseName, success: true, skipped: true };
  }

  const found = findBlueprint(config, phaseName);
  if (!found) {
    console.error(`\n⚠  SKIP ${phaseName} — no blueprint file (${phaseName}-2.yaml or ${phaseName}.yaml)`);
    return { phase: phaseName, success: false, skipped: true, reason: 'no_blueprint' };
  }

  const result = await runPhaseWithFanout(phaseName, args, config, projectName);
  return { phase: phaseName, ...result };
}

/**
 * Run all pipeline phases, executing parallel groups concurrently via PIPELINE_GRAPH.
 * Skips phases already marked Complete.
 */
async function runAll(args, config, projectName) {
  const skipPhases = new Set(args.skipSpec ? ['spec'] : []);
  // --build-only swaps in the slim graph (pre-build → database → backend →
  // frontend → integrate → test-api → test-browser → ship). The user
  // pre-populates init/spec/prd/design/user-stories outputs via the
  // canonical workspace, and pre-build verifies + copies them into the
  // run dir. See blueprints/pre-build-2.yaml.
  const graph = args.buildOnly ? BUILD_ONLY_GRAPH : PIPELINE_GRAPH;
  const allPhases = graph.flat().filter(p => !skipPhases.has(p));

  header(`fullstack-2 — ${args.buildOnly ? 'BUILD ONLY (slim pipeline)' : 'RUN ALL'} (${allPhases.length} phases)`);
  console.log(`project:  ${projectName}`);
  console.log(`target:   ${config.targetDir}`);
  if (args.buildOnly) {
    console.log(`mode:     slim — phases init/spec/prd/design/user-stories skipped (read from canonical)`);
  } else {
    console.log(`skip-spec: ${args.skipSpec}`);
  }
  console.log(`dry-run:  ${args.dryRun}`);

  // Show execution plan with parallel groups
  const graphLabel = graph
    .map(step => step.filter(p => !skipPhases.has(p)))
    .filter(step => step.length > 0)
    .map(step => step.length > 1 ? `(${step.join(' || ')})` : step[0])
    .join(' → ');
  console.log(`phases:   ${graphLabel}`);

  const results = [];
  const pipelineStart = Date.now();
  let aborted = false;

  for (const step of graph) {
    if (aborted) break;

    const phasesInStep = step.filter(p => !skipPhases.has(p));
    if (phasesInStep.length === 0) continue;

    if (phasesInStep.length === 1) {
      // Single phase — run sequentially (most common case)
      const r = await runOnePhaseInPipeline(phasesInStep[0], args, config, projectName);
      results.push(r);
      if (!r.success && !r.skipped && !args.dryRun) {
        if (r.nonBlocking) {
          // v126: a SECONDARY frontend's build/typecheck failure. The primary frontend
          // (the story-tested deliverable) gates the run; an auxiliary dashboard frontend
          // breaking must not abort downstream. Recorded as FAIL, but does not block.
          console.log(`\n⚠  phase '${r.phase}' failed at ${r.failedNode} but is NON-BLOCKING (secondary frontend — primary gates the run); continuing to downstream`);
        } else if (r.hardFailure) {
          // HARD gate (liveness): the phase didn't produce a working artifact, so
          // backend-dependent downstream is meaningless. Abort even under
          // --no-abort — don't burn hours on integrate/test-api/test-browser.
          console.error(`\n🛑 HARD GATE FAILED at '${r.phase}' (${r.failedNode}) — downstream depends on this; aborting${args.noAbort ? ' (--no-abort does NOT override hard gates)' : ''}`);
          aborted = true;
        } else if (!args.noAbort) {
          console.error(`\n🛑 RUN-ALL ABORTED at phase '${r.phase}' (soft gate, failed at ${r.failedNode})`);
          aborted = true;
        } else {
          console.log(`\n⚠  phase '${r.phase}' SOFT-failed but --no-abort set — continuing past ${r.failedNode} (artifact still functional)`);
        }
      }
    } else {
      // Parallel group — run concurrently
      section(`PARALLEL: ${phasesInStep.join(' || ')}`);
      const parallelResults = await Promise.all(
        phasesInStep.map(p => runOnePhaseInPipeline(p, args, config, projectName))
      );
      results.push(...parallelResults);

      // If any phase in the parallel group failed, decide hard vs soft.
      // v126: a non-blocking failure (secondary frontend) does not count as a blocker.
      const failed = parallelResults.find(r => !r.success && !r.skipped && !r.nonBlocking);
      const hardFailed = parallelResults.find(r => !r.success && !r.skipped && r.hardFailure);
      if (failed && !args.dryRun) {
        if (hardFailed) {
          console.error(`\n🛑 HARD GATE FAILED at parallel step (${hardFailed.phase} at ${hardFailed.failedNode}) — aborting${args.noAbort ? ' (--no-abort does NOT override hard gates)' : ''}`);
          aborted = true;
        } else if (!args.noAbort) {
          console.error(`\n🛑 RUN-ALL ABORTED at parallel step (${failed.phase} soft-failed at ${failed.failedNode})`);
          aborted = true;
        } else {
          console.log(`\n⚠  parallel step '${failed.phase}' SOFT-failed but --no-abort set — continuing`);
        }
      }
    }
  }

  // Run-all summary
  const pipelineDuration = Date.now() - pipelineStart;
  header('RUN-ALL SUMMARY');
  for (const r of results) {
    const icon = r.skipped ? '⏭ ' : (r.success ? '✅' : '❌');
    const detail = r.skipped
      ? (r.reason || 'already Complete')
      : `${r.nodesPassed || 0}/${r.nodesTotal || 0} nodes, ${((r.duration_ms || 0) / 1000).toFixed(1)}s${r.failedNode ? ` — failed at ${r.failedNode}` : ''}`;
    console.log(`  ${icon} ${r.phase.padEnd(14)} ${detail}`);
  }
  console.log(`\ntotal duration: ${(pipelineDuration / 1000).toFixed(1)}s`);

  // v131: on a genuine abort, the Complete phases are CHECKPOINTED in
  // PIPELINE_STATUS — --resume skips them and re-runs only the failed/pending
  // ones. Emit the resume command so the human iteration is ~30min (re-run the
  // failed phase) not ~3h (regenerate everything). Pairs with the self-healing
  // build gate: self-heal handles deterministic failures in-run; this makes the
  // GENUINE failures cheap to recover. See feedback_self_healing_hard_gates.
  if (aborted) {
    const preserved = results.filter(r => r.skipped || r.success).map(r => r.phase);
    const failedAt = results.find(r => !r.success && !r.skipped);
    console.error('\n──────────────────────────────────────────────────────────────');
    console.error(`🧯 RUN ABORTED at '${failedAt ? failedAt.phase : '?'}'${failedAt && failedAt.failedNode ? ` (${failedAt.failedNode})` : ''} — completed phases are CHECKPOINTED, do NOT regenerate them.`);
    if (preserved.length) console.error(`   Complete + preserved (${preserved.length}): ${preserved.join(', ')}`);
    console.error('   Patch the fix, then RESUME (skips Complete phases, re-runs only the failed/pending one):');
    console.error(`     node ${path.relative(process.cwd(), __filename)} ${projectName} --run-all --resume --path ${args.targetDir || '<run-dir>'}`);
    console.error('   (or via the wrapper: bash .claude/parallel/run-parallel.sh --resume --tag <tag>)');
    console.error('──────────────────────────────────────────────────────────────');
  }

  const anyFailed = results.some(r => !r.success && !r.skipped);
  const lastRun = results.filter(r => !r.skipped).at(-1);
  const overallSuccess = !anyFailed && (lastRun ? lastRun.success : true);
  return overallSuccess;
}

// --- main ---

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.project) {
    console.error('Usage:');
    console.error('  orchestrator.js <project> --phase <name> [--resume] [--dry-run] [--verbose]');
    console.error('  orchestrator.js <project> --phase <name> --loop [--max-iterations N] [--quality 0.95]');
    console.error('  orchestrator.js <project> --run-all [--skip-spec] [--dry-run] [--no-abort]');
    console.error('  orchestrator.js <project> --loop [--max-generations N] [--quality 0.95] [--skip-spec]');
    console.error('  orchestrator.js <project> --reset <phase>');
    console.error('  orchestrator.js <project> --prd <file> [--run-all | --phase prd]');
    console.error('  orchestrator.js <project> --refresh [--yes]');
    console.error('Options:');
    console.error('  --no-abort      Continue past failed phases (variance experiments)');
    console.error('Examples:');
    console.error('  orchestrator.js hrm --run-all --skip-spec');
    console.error('  orchestrator.js hrm --run-all --no-abort');
    console.error('  orchestrator.js hrm --phase backend --loop');
    console.error('  orchestrator.js hrm --loop --max-generations 5');
    console.error('  orchestrator.js hrm --reset backend');
    console.error('  orchestrator.js hrm --prd ./requirements.pdf --run-all --skip-spec');
    console.error('  orchestrator.js hrm --refresh --yes');
    process.exit(1);
  }

  // --reset is a standalone action: reset a phase and exit.
  if (args.reset) {
    const sourceDir = findProjectRoot(process.cwd());
    const targetDir = args.targetDir ? path.resolve(args.targetDir) : sourceDir;
    const config = makeConfig(targetDir, sourceDir);
    const projectName = findProjectName(config, args.project);

    if (!PHASE_ORDER.includes(args.reset)) {
      console.error(`ERROR: unknown phase '${args.reset}'. Valid phases: ${PHASE_ORDER.join(', ')}`);
      process.exit(1);
    }

    resetPhaseStatus(config, projectName, args.reset);
    console.log(`✅ reset '${args.reset}' → Pending (blueprint state cleared)`);
    process.exit(0);
  }

  // --refresh: wipe all generated artifacts and exit.
  // Preserves PRD, memory, design system, and seed.yaml.
  // Requires --yes to execute; without it, prints the plan and exits.
  if (args.refresh) {
    const sourceDir = findProjectRoot(process.cwd());
    const targetDir = args.targetDir ? path.resolve(args.targetDir) : sourceDir;
    const config = makeConfig(targetDir, sourceDir);
    const projectName = findProjectName(config, args.project);
    const proj = path.join(targetDir, '.claude-project');

    const dirs = [
      path.join(targetDir, 'backend'),
      path.join(targetDir, 'frontend'),
      path.join(proj, 'status', projectName),
      path.join(proj, 'docs'),
      path.join(proj, 'design', 'html'),
      path.join(proj, 'design', 'variations'),
      path.join(proj, 'user_stories'),
      // NOTE: `episodes/` deliberately EXCLUDED from refresh.
      // Episode JSONL files are append-only RL training data — wiping them
      // resets the bandit/policy learning signal to zero. Each refresh
      // should clear *generated artifacts* (code, docs, status), not the
      // history of how prior runs performed. To purge episodes manually:
      //   rm -rf .claude-project/episodes
      path.join(proj, 'agent-logs'),
      path.join(proj, 'qa'),
      path.join(proj, 'context'),
      path.join(proj, 'knowledge'),
      path.join(proj, 'bug_reports'),
    ];
    const files = [
      path.join(targetDir, 'docker-compose.yml'),
      path.join(proj, 'routes.yaml'),
    ];

    const seedPath = path.join(proj, 'status', projectName, 'seed.yaml');
    const preservedSeed = fs.existsSync(seedPath) ? fs.readFileSync(seedPath) : null;

    if (!args.yes) {
      console.log('refresh plan (dry run — pass --yes to execute):');
      console.log('  DELETE directories:');
      for (const d of dirs) if (fs.existsSync(d)) console.log(`    - ${d}`);
      console.log('  DELETE files:');
      for (const f of files) if (fs.existsSync(f)) console.log(`    - ${f}`);
      console.log('  PRESERVE:');
      console.log(`    - ${path.join(proj, 'prd')}`);
      console.log(`    - ${path.join(proj, 'memory')}`);
      console.log(`    - ${path.join(proj, 'design', 'DESIGN_SYSTEM.md')}`);
      console.log(`    - ${path.join(proj, 'design', 'DOMAIN_RESEARCH.md')}`);
      if (preservedSeed) console.log(`    - ${seedPath} (saved and restored)`);
      console.log('');
      console.log(`  re-run to execute: node .claude/v2/orchestrator.js ${args.project} --refresh --yes`);
      process.exit(0);
    }

    let dirCount = 0, fileCount = 0;
    for (const d of dirs) {
      if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); dirCount++; }
    }
    for (const f of files) {
      if (fs.existsSync(f)) { fs.unlinkSync(f); fileCount++; }
    }
    if (preservedSeed) {
      fs.mkdirSync(path.dirname(seedPath), { recursive: true });
      fs.writeFileSync(seedPath, preservedSeed);
    }
    console.log(`✅ refreshed: wiped ${dirCount} directories, ${fileCount} files`);
    if (preservedSeed) console.log(`   preserved seed.yaml at ${seedPath}`);
    console.log(`   Run with --run-all to rebuild.`);
    process.exit(0);
  }

  // --prd <path>: copy a PRD file into the project, clear chunks so prd phase re-processes.
  // Can be combined with --run-all, --loop, or --phase prd.
  if (args.prd) {
    const sourceDir = findProjectRoot(process.cwd());
    const targetDir = args.targetDir ? path.resolve(args.targetDir) : sourceDir;
    const prdSource = path.resolve(args.prd);

    if (!fs.existsSync(prdSource)) {
      console.error(`ERROR: PRD file not found: ${prdSource}`);
      process.exit(1);
    }

    const prdDir = path.join(targetDir, '.claude-project', 'prd');
    const chunkDir = path.join(targetDir, '.claude-project', 'context');
    fs.mkdirSync(prdDir, { recursive: true });

    // Copy PRD to the canonical location
    const ext = path.extname(prdSource);
    const dest = path.join(prdDir, `prd${ext}`);
    fs.copyFileSync(prdSource, dest);
    console.log(`✅ PRD copied: ${prdSource} → ${dest}`);

    // Clear existing chunks so split-prd-chunks re-processes the new file
    if (fs.existsSync(chunkDir)) {
      const chunks = fs.readdirSync(chunkDir).filter(f => f.startsWith('PRD_chunk_'));
      for (const chunk of chunks) {
        fs.unlinkSync(path.join(chunkDir, chunk));
      }
      if (chunks.length > 0) console.log(`  cleared ${chunks.length} old PRD chunks`);
    }

    // Reset prd phase so it reruns with the new PRD
    const config = makeConfig(targetDir, sourceDir);
    const projectName = findProjectName(config, args.project);
    resetPhaseStatus(config, projectName, 'prd');
    console.log(`  reset prd phase → Pending`);

    // If --prd was the only action, exit. Otherwise continue to --run-all/--loop/--phase.
    if (!args.phase && !args.runAll && !args.loop) {
      console.log(`\nPRD loaded. Run with --run-all or --phase prd to process it.`);
      process.exit(0);
    }
  }

  if (!args.phase && !args.runAll && !args.loop) {
    console.error('ERROR: one of --phase <name>, --run-all, --loop, or --reset <phase> is required');
    process.exit(1);
  }

  if (args.phase && args.runAll) {
    console.error('ERROR: --phase and --run-all are mutually exclusive');
    process.exit(1);
  }

  // --loop without --phase implies pipeline-wide loop
  // --loop with --phase means single-phase convergence loop
  // --run-all + --loop = pipeline-wide loop (same as --loop alone)

  // Source dir = where .claude/ (blueprints, scripts) lives. Found by walking up from cwd.
  // Target dir = where .claude-project/ (status, output) lives. Defaults to source, overridden by --path.
  const sourceDir = findProjectRoot(process.cwd());
  const targetDir = args.targetDir ? path.resolve(args.targetDir) : sourceDir;
  const config = makeConfig(targetDir, sourceDir);
  const projectName = findProjectName(config, args.project);

  if (projectName !== args.project) {
    console.warn(`WARN: argv project '${args.project}' not found in ${config.projectsDir}`);
    console.warn(`WARN: falling back to detected project '${projectName}'`);
  }

  // Create event stream tied to this run. Hangs off config so every function
  // that receives config can emit events without extra plumbing.
  // Disabled if --dry-run (don't pollute training data) or if --emit-events was not passed.
  const eventsEnabled = args.emitEvents && !args.dryRun;
  config.events = createEventStream(config, projectName, { enabled: eventsEnabled });

  // Determine mode label for the banner
  let modeLabel;
  if (args.phase && args.loop) modeLabel = `phase-loop (${args.phase})`;
  else if (args.loop) modeLabel = 'pipeline-loop';
  else if (args.runAll) modeLabel = 'run-all';
  else modeLabel = `single-phase (${args.phase})`;

  header('fullstack-2 orchestrator');
  console.log(`project:  ${projectName}`);
  console.log(`target:   ${targetDir}`);
  console.log(`mode:     ${modeLabel}`);
  console.log(`dry-run:  ${args.dryRun}`);
  console.log(`verbose:  ${args.verbose}`);
  if (eventsEnabled) {
    console.log(`episode:  ${config.events.episodeId} → ${path.relative(targetDir, config.events.path)}`);
  }

  // Emit episode_start before any work begins so downstream reward calc
  // can locate the episode boundaries.
  config.events.episodeStart({
    mode: modeLabel,
    argv: process.argv.slice(2),
  });

  const episodeStart = Date.now();
  let overallSuccess = false;
  let failedPhase = null;
  let failedNodeId = null;

  try {
    if (args.phase && args.loop) {
      const result = await runPhaseLoop(args.phase, args, config, projectName);
      overallSuccess = result.success;
      failedPhase = args.phase;
    } else if (args.loop) {
      const result = await runPipelineLoop(args, config, projectName);
      overallSuccess = result.success;
    } else if (args.runAll) {
      overallSuccess = await runAll(args, config, projectName);
      // Pipeline-wide success (all Pending phases completed) earns a run-all convergence
      // event. Not as strong a signal as loop-mode convergence, but differentiates
      // successful from failed run-all episodes in the reward calculation.
      if (overallSuccess) {
        config.events.convergence({ mode: 'run-all' });
      }
    } else {
      const result = await runPhaseWithFanout(args.phase, args, config, projectName);
      overallSuccess = result.success;
      failedPhase = result.success ? null : args.phase;
      failedNodeId = result.failedNode;
      // Single-phase success gets its own (smaller) terminal bonus via the
      // convergence event. Emitted with mode='single-phase' so reward.js
      // can route to single_phase_success_bonus instead of convergence_bonus.
      if (overallSuccess) {
        config.events.convergence({
          mode: 'single-phase',
          phase: args.phase,
          score: result.score,
        });
      }
    }
  } finally {
    config.events.episodeEnd({
      success: overallSuccess,
      failedPhase,
      failedNode: failedNodeId,
      duration_ms: Date.now() - episodeStart,
    });
  }

  // Compute and print reward if events were emitted
  if (eventsEnabled) {
    try {
      const rewardConfig = loadRewardConfig(sourceDir);
      const breakdown = computeEpisodeReward(config.events.path, rewardConfig);
      header('EPISODE REWARD');
      if (breakdown.error) {
        console.log(`  (no reward: ${breakdown.error})`);
      } else {
        if (breakdown.phases.length > 0) {
          console.log('  phase rewards:');
          for (const p of breakdown.phases) {
            const sign = p.total >= 0 ? '+' : '';
            console.log(`    ${p.phase.padEnd(14)} ${sign}${p.total.toFixed(2)}  (Δscore: ${p.delta_score >= 0 ? '+' : ''}${p.delta_score.toFixed(3)}, cost: $${p.cost_usd.toFixed(3)})`);
          }
        }
        if (breakdown.generations.length > 0) {
          console.log('  generation rewards:');
          for (const g of breakdown.generations) {
            console.log(`    gen ${g.gen}: ${g.total >= 0 ? '+' : ''}${g.total.toFixed(2)}`);
          }
        }
        const t = breakdown.terminal;
        console.log(`  terminal:   ${t.total >= 0 ? '+' : ''}${t.total.toFixed(2)}  (${t.convergence_kind})`);
        console.log(`  ─────────────────────`);
        console.log(`  R_episode:  ${breakdown.totals.episode >= 0 ? '+' : ''}${breakdown.totals.episode.toFixed(2)}`);
      }
    } catch (err) {
      console.warn(`\nWARN: reward calculation skipped: ${err.message}`);
    }
  }

  process.exit(overallSuccess ? 0 : 1);
}

main().catch(err => {
  if (err && err.message && err.message.startsWith('project ')) {
    console.error(`\nERROR: ${err.message}`);
  } else {
    console.error('\nUNCAUGHT ERROR:', err);
  }
  process.exit(1);
});
