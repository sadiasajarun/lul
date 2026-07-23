/**
 * evaluator.js — runs an evaluator node via claude or opencode subprocess.
 *
 * Backend detection: respects AGENT_BACKEND env, config.agentBackend, or
 * node.backend. Defaults to 'claude' for backward compatibility.
 *
 * Mirrors agent.js in shape (spawn, stdio pipe, per-node log file, JSON
 * output parse) but specializes for the evaluator role:
 *
 *   1. Prompt is assembled from a rubric + calibration examples + artifact
 *      inputs, not from a free-form `node.prompt`.
 *   2. Tool profile defaults to read-only. Even if the blueprint author
 *      tries to allow `Edit` or `WebFetch`, those are force-denied — the
 *      evaluator should never modify what it grades.
 *   3. After the subprocess exits, the JSON file the agent wrote is parsed
 *      and validated via lib/rubric. The on-disk file is rewritten with an
 *      authoritative, normalized version (overall_score recomputed from the
 *      weighted breakdown, scores clamped, counts derived).
 *
 * A missing/malformed evaluation file is NOT treated as a subprocess crash.
 * It's returned with evaluation.valid === false so the caller (orchestrator)
 * can decide whether to ignore (default for evaluator nodes) or fail the
 * phase based on the blueprint's `on_failure` setting.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolveVars, agentLogsDirFor, statusDirFor } = require('./config');
const {
  loadRubric,
  loadExamples,
  renderRubricPrompt,
  renderExamplesPrompt,
  validateEvaluation,
} = require('./rubric');

const DEFAULT_MAX_FILES_PER_CATEGORY = 30;
const DEFAULT_MAX_CHARS_PER_FILE = 8000;

/**
 * Determine which backend binary to use for evaluator execution.
 * Priority: AGENT_BACKEND env > config.agentBackend > 'claude' (default).
 */
function getEvaluatorBackend(config) {
  const envBackend = process.env.AGENT_BACKEND;
  if (envBackend) return envBackend;
  if (config && config.agentBackend) return config.agentBackend;
  return 'claude';
}

/**
 * Build OpenCode CLI arguments for an evaluator node.
 * Mirrors agent-opencode.js conventions.
 */
function buildOpenCodeEvaluatorArgs(node, config) {
  const args = ['run', '--format', 'json'];
  if (node.model) {
    args.push('--model', node.model);
  } else if (config.defaultModel) {
    args.push('--model', config.defaultModel);
  } else if (process.env.OPENCODE_DEFAULT_MODEL) {
    args.push('--model', process.env.OPENCODE_DEFAULT_MODEL);
  }
  return args;
}

// These tools are force-denied for evaluator nodes regardless of what the
// blueprint author declares. The evaluator must not modify the artifacts it
// grades — that's the article's whole point. Write is NOT in this list
// because the evaluator still needs to write its evaluation JSON output.
const EVALUATOR_ENFORCED_DENY = Object.freeze([
  'Edit',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
]);

// Role preamble shown to the evaluator agent. Encodes the anti-sycophancy
// instructions from the plan §4 Part A. Revised with care — this is the
// single most load-bearing piece of text in the whole evaluator.
const ROLE_PREAMBLE = `You are a design evaluator, not a builder.

You have Read, Grep, Glob, and Bash tools (plus Playwright MCP if available
for UI inspection). You have Write ONLY to produce your evaluation output
file at the path declared below. Do not modify any artifact you grade.

CALIBRATION (important — read twice):

- Default score is 0.7. You must earn every tenth above that by pointing at
  a specific observable reason the artifact exceeds the anchor description.
  Generic praise like "looks clean" or "nice design" is disqualifying — if
  you write that, your score is wrong.

- When unsure between two adjacent anchors, pick the LOWER one. Bias
  downward on uncertainty.

- Blockers are P0 only if they make the artifact unshippable (broken flow,
  missing declared feature, severe a11y issue). "I'd change it" is P2, not
  P0. Overusing P0 destroys the signal.

- You are graded on how close your scores track the calibration examples.
  An evaluator that returns 0.9 for everything is useless and will be
  replaced.

Your output is machine-parsed. Write exactly one JSON document at the
declared file path. No markdown fences. No prose before or after.`;

/**
 * Build the prompt the evaluator agent will see.
 *
 * Structure (plan §4):
 *   A. Role preamble + calibration directive
 *   B. Rubric (scope + criteria + anchors + required output fields)
 *   C. Few-shot calibration examples (if any)
 *   D. Inputs — artifact files, reference docs, optional contract
 *   E. Output contract reminder (path + JSON schema + shape sample)
 */
function buildEvaluatorPrompt(node, rubric, examples, config, projectName) {
  const parts = [];

  // A — role preamble
  parts.push('=== EVALUATOR ROLE ===');
  parts.push(ROLE_PREAMBLE);

  // B — rubric
  parts.push('\n=== RUBRIC ===');
  parts.push(renderRubricPrompt(rubric));

  // C — calibration examples (optional)
  const examplesText = renderExamplesPrompt(examples);
  if (examplesText) {
    parts.push('\n=== FEW-SHOT CALIBRATION ===');
    parts.push(examplesText);
  }

  // D — inputs
  parts.push('\n=== INPUTS TO EVALUATE ===');
  const inputs = node.inputs || {};
  const maxFiles = inputs.max_files || DEFAULT_MAX_FILES_PER_CATEGORY;
  const maxChars = inputs.max_chars_per_file || DEFAULT_MAX_CHARS_PER_FILE;

  const artifactFiles = collectFiles(inputs.artifacts || [], config, projectName, maxFiles);
  const referenceFiles = collectFiles(inputs.references || [], config, projectName, maxFiles);
  const contractFiles = collectFiles(inputs.contract || [], config, projectName, maxFiles);

  if (artifactFiles.length === 0 && referenceFiles.length === 0) {
    parts.push('(no input files matched the declared patterns — this is a red flag; flag it as a P0 blocker)');
  }

  if (referenceFiles.length > 0) {
    parts.push('\n## Reference documents (the source of truth for what the artifacts should be)');
    for (const f of referenceFiles) {
      parts.push(renderFileBlock(f, maxChars));
    }
  }
  if (contractFiles.length > 0) {
    parts.push('\n## Sprint contract (the per-run checklist of deliverables)');
    for (const f of contractFiles) {
      parts.push(renderFileBlock(f, maxChars));
    }
  }
  if (artifactFiles.length > 0) {
    parts.push(`\n## Artifacts to grade (${artifactFiles.length} files)`);
    for (const f of artifactFiles) {
      parts.push(renderFileBlock(f, maxChars));
    }
  }

  // E — output contract reminder
  const outPath = resolveVars(node.required_output_file || '', config, projectName);
  parts.push('\n=== OUTPUT CONTRACT ===');
  parts.push(`Write your evaluation as a SINGLE JSON document to this exact path:`);
  parts.push(`  ${outPath}`);
  parts.push('');
  parts.push('Shape (field order does not matter; types do):');
  parts.push('```json');
  parts.push(JSON.stringify(buildOutputTemplate(rubric), null, 2));
  parts.push('```');
  parts.push('');
  parts.push('Rules:');
  parts.push('- `overall_score` = Σ (criterion_score × criterion_weight), to 3 decimal places.');
  parts.push('  The orchestrator recomputes this and warns if your arithmetic is off.');
  parts.push('- Every criterion in the rubric must appear in `weighted_breakdown`.');
  parts.push('- `blockers[].location` should point at a specific file (and line if you can).');
  parts.push('- `blockers[].issue` must be one concrete observation, not a general opinion.');
  parts.push('- `rationale` is 2-4 sentences tying your scores to specific artifact observations.');
  parts.push('- Do not include any text outside the JSON file. No markdown fences. No commentary.');

  return parts.join('\n');
}

function buildOutputTemplate(rubric) {
  const breakdown = {};
  for (const name of Object.keys(rubric.criteria)) {
    breakdown[name] = 0.0;
  }
  return {
    overall_score: 0.0,
    weighted_breakdown: breakdown,
    blockers: [
      {
        severity: 'P1',
        criterion: Object.keys(rubric.criteria)[0],
        location: 'path/to/file.html:42',
        issue: 'One concrete observation.',
        suggestion: 'Concrete fix.',
      },
    ],
    rationale: 'Two to four sentences.',
    evaluator_metadata: {
      rubric_version: rubric.version || 1,
      artifacts_examined: 0,
      tools_used: [],
    },
  };
}

/**
 * Expand input patterns into a list of { path, content } entries.
 *
 * Supports three glob shapes:
 *   - no glob (literal path):    `dir/file.ts`
 *   - single-level glob:         `dir/*.html`           — matches files in `dir`
 *   - recursive globstar:        `dir/**\/*.ts`          — walks subtree of `dir`
 *
 * `**` matches any depth (including zero) of intermediate directories. The
 * pattern after the last `**` is the per-file regex applied at every depth.
 * Patterns like `dir/**\/entities/*.ts` are supported: walk `dir`, only
 * consider files whose full path (relative to `dir`) matches the trailing
 * pattern `entities/*.ts`.
 *
 * Absolute paths and missing directories are tolerated silently so
 * blueprints can declare optional inputs without conditional logic.
 */
function collectFiles(patterns, config, projectName, maxFiles) {
  const files = [];
  for (const raw of patterns) {
    if (files.length >= maxFiles) break;
    const resolved = resolveVars(raw, config, projectName);

    // Literal path — no glob anywhere.
    if (!resolved.includes('*')) {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        files.push({ path: resolved, content: safeRead(resolved) });
      }
      continue;
    }

    // Recursive glob (`**` somewhere in the pattern).
    const ggIdx = resolved.indexOf('**');
    if (ggIdx >= 0) {
      // Split at the last `**` so we get `<base>/**/<tail>`.
      // base is the directory we walk; tail is the path pattern relative to
      // base. `**` semantically means "zero or more path segments here," so
      // the tail regex must allow an optional subdirectory prefix before
      // the pattern itself. Examples:
      //   base/**/*.html         → tail=`*.html`, matches files at any depth
      //   base/**/entities/*.ts  → tail=`entities/*.ts`, matches in any
      //                            directory named entities at any depth
      const lastGG = resolved.lastIndexOf('**');
      const base = resolved.slice(0, lastGG).replace(/\/+$/, '');
      const tail = resolved.slice(lastGG + 2).replace(/^\/+/, '');
      // Build regex against the relative path from base. The leading
      // `(?:[^/]+/)*` allows any number of intermediate directory segments
      // (the `**` semantics). When tail is empty we match anything.
      const tailRegex = tail
        ? new RegExp('^(?:[^/]+/)*' + escapeRegex(tail).replace(/\\\*/g, '[^/]*') + '$')
        : /.*/;
      if (!fs.existsSync(base)) continue;
      walkDir(base, base, tailRegex, files, maxFiles);
      continue;
    }

    // Single-level glob (`dir/*.ext`).
    const dir = path.dirname(resolved);
    const glob = path.basename(resolved);
    const regex = new RegExp('^' + escapeRegex(glob).replace(/\\\*/g, '[^/]*') + '$');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (files.length >= maxFiles) break;
      if (regex.test(f)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isFile()) {
          files.push({ path: full, content: safeRead(full) });
        }
      }
    }
  }
  return files;
}

function escapeRegex(s) {
  // Escape every metachar so we can selectively re-enable `*` afterwards.
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '\\*');
}

/**
 * Recursive directory walk used by collectFiles for `**` patterns.
 * Pushes any file whose path (relative to `rootBase`) matches `tailRegex`.
 * Hard skips node_modules, .git, dist, build to avoid runaway walks.
 */
function walkDir(rootBase, current, tailRegex, files, maxFiles) {
  if (files.length >= maxFiles) return;
  let entries;
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  // Sort so output is stable across runs.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (files.length >= maxFiles) return;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git'
          || entry.name === 'dist' || entry.name === 'build') {
        // Pruned for speed. `dist` exception: ship phase wants dist/, but
        // it gets the explicit `dist/**/*.js` pattern at the top, not via
        // walking from a higher base — so this prune is safe in practice.
        continue;
      }
      walkDir(rootBase, full, tailRegex, files, maxFiles);
    } else if (entry.isFile()) {
      const rel = path.relative(rootBase, full);
      if (tailRegex.test(rel)) {
        files.push({ path: full, content: safeRead(full) });
      }
    }
  }
}

function safeRead(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return '';
  }
}

function renderFileBlock(file, maxChars) {
  const body = file.content.length > maxChars
    ? file.content.slice(0, maxChars) + `\n\n[...truncated, original is ${file.content.length} chars]`
    : file.content;
  return `\n--- ${file.path} ---\n${body}`;
}

/**
 * Assemble the `claude --print` args. Enforces read-only defaults: regardless
 * of what the blueprint declared in node.tool_profile.allow, the tools in
 * EVALUATOR_ENFORCED_DENY are always in --disallowed-tools.
 */
function buildEvaluatorArgs(node, config) {
  const args = [
    '--print',
    '--output-format=json',
    '--permission-mode', 'bypassPermissions',
    '--add-dir', config.targetDir,
  ];

  const profile = node.tool_profile || {};
  const allow = Array.isArray(profile.allow) ? profile.allow.slice() : ['Read', 'Grep', 'Glob', 'Bash', 'Write'];
  if (allow.length) args.push('--allowed-tools', allow.join(' '));

  // Union of blueprint deny list and our enforced deny list. Duplicates
  // don't hurt claude --print.
  const declaredDeny = Array.isArray(profile.deny) ? profile.deny : [];
  const deny = Array.from(new Set([...declaredDeny, ...EVALUATOR_ENFORCED_DENY]));
  args.push('--disallowed-tools', deny.join(' '));

  return args;
}

/**
 * Main entry point: run the evaluator subprocess, validate its JSON output
 * against the rubric, and persist the normalized result.
 *
 * Returns:
 *   {
 *     _duration_ms, _log_file,                    // ops observability
 *     num_turns, total_cost_usd, result,          // mirror of runAgentNode
 *     evaluation: {                               // evaluator-specific
 *       valid: bool,
 *       errors: string[],
 *       normalized: <normalized eval object or null>,
 *       file_path: string,
 *     }
 *   }
 */
function runEvaluatorNode(node, config, projectName) {
  return new Promise((resolve, reject) => {
    // Load rubric + examples upfront. These throw on malformed YAML, which
    // surfaces as a reject — not the agent's fault, fail fast at the orchestrator.
    const rubricPath = resolveVars(node.rubric_file || '', config, projectName);
    if (!rubricPath) {
      return reject(new Error(`evaluator node '${node.id}': rubric_file is required`));
    }
    const rubricFullPath = path.isAbsolute(rubricPath)
      ? rubricPath
      : path.join(config.sourceDir || config.targetDir, rubricPath);
    let rubric;
    try {
      rubric = loadRubric(rubricFullPath);
    } catch (err) {
      return reject(new Error(`evaluator node '${node.id}': ${err.message}`));
    }

    const examplesPathRaw = node.calibration && node.calibration.examples_file
      ? resolveVars(node.calibration.examples_file, config, projectName)
      : null;
    const examplesFullPath = examplesPathRaw && !path.isAbsolute(examplesPathRaw)
      ? path.join(config.sourceDir || config.targetDir, examplesPathRaw)
      : examplesPathRaw;
    let examples = { examples: [] };
    if (examplesFullPath) {
      try {
        examples = loadExamples(examplesFullPath, rubric);
      } catch (err) {
        // Bad examples file is a warning, not a fatal. Fall back to empty.
        console.warn(`[evaluator] ${node.id}: ignoring invalid examples file: ${err.message}`);
      }
    }

    const prompt = buildEvaluatorPrompt(node, rubric, examples, config, projectName);
    const backend = getEvaluatorBackend(config);
    const args = backend === 'opencode' || backend === 'oc'
      ? buildOpenCodeEvaluatorArgs(node, config)
      : buildEvaluatorArgs(node, config);

    fs.mkdirSync(agentLogsDirFor(config, projectName), { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(agentLogsDirFor(config, projectName), `${node.id}-${timestamp}.log`);
    const logStream = fs.createWriteStream(logFile);
    logStream.write(`=== EVALUATOR NODE: ${node.id} ===\n`);
    logStream.write(`timestamp: ${new Date().toISOString()}\n`);
    logStream.write(`backend:   ${backend}\n`);
    logStream.write(`rubric:    ${rubricFullPath}\n`);
    logStream.write(`examples:  ${examplesFullPath || '(none)'}\n`);
    logStream.write(`command:   ${backend} ${args.join(' ')}\n`);
    logStream.write(`\n=== PROMPT (${prompt.length} chars) ===\n${prompt}\n\n=== STDOUT ===\n`);

    console.log(`\n[evaluator] node: ${node.id}`);
    console.log(`[evaluator] backend:   ${backend}`);
    console.log(`[evaluator] rubric:    ${path.relative(config.targetDir, rubricFullPath)}`);
    console.log(`[evaluator] examples:  ${examplesFullPath ? path.relative(config.targetDir, examplesFullPath) : '(none)'}`);
    console.log(`[evaluator] tools allow: ${(node.tool_profile?.allow || ['Read', 'Grep', 'Glob', 'Bash', 'Write']).join(' ')}`);
    console.log(`[evaluator] enforced deny: ${EVALUATOR_ENFORCED_DENY.join(' ')}`);
    console.log(`[evaluator] log:          ${path.relative(config.targetDir, logFile)}`);
    console.log(`[evaluator] launching ${backend} subprocess...`);

    const startTime = Date.now();
    const isOpenCode = backend === 'opencode' || backend === 'oc';

    // Per-subprocess XDG_DATA_HOME prevents opencode SQLite WAL lock when
    // evaluators run concurrently with fanout agentic nodes (e.g. story-runner
    // x N frontends). See agent-opencode.js for the same pattern.
    let subDataDir = null;
    let cleanupDataDir = () => {};
    if (isOpenCode) {
      const realOpencodeDir = path.join(process.env.HOME, '.local/share/opencode');
      subDataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'opencode-data-'));
      const subOpencodeDir = path.join(subDataDir, 'opencode');
      fs.mkdirSync(subOpencodeDir, { recursive: true });
      for (const link of ['auth.json', 'bin', 'plugin']) {
        const src = path.join(realOpencodeDir, link);
        if (fs.existsSync(src)) {
          try { fs.symlinkSync(src, path.join(subOpencodeDir, link)); } catch (_) {}
        }
      }
      cleanupDataDir = () => {
        try { fs.rmSync(subDataDir, { recursive: true, force: true }); } catch (_) {}
      };
    }

    const child = isOpenCode
      ? spawn('opencode', [...args, prompt], {
          cwd: config.targetDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, TERM: 'dumb', XDG_DATA_HOME: subDataDir },
        })
      : spawn('claude', args, {
          cwd: config.targetDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

    let stdout = '';
    let stderr = '';

    // Watchdog: evaluator opencode can hang for hours (v18 design-evaluator
    // hung 87min, v19 + v21 test-browser-evaluator hung 1h+). EVALUATOR_TIMEOUT_MS
    // default 35 min — longer than NODE_TIMEOUT_MS 25 min because evaluators
    // run rubric+examples+artifacts through the model in one shot.
    // v22 evidence: 15-min default fired too often on slow-but-legitimate
    // evaluations. Bumped so legitimate work completes.
    // Per-node timeout override: blueprints can set node.timeout_ms on heavy
    // evaluators that need more budget than the 35-min global default.
    const EVAL_TIMEOUT_MS = node.timeout_ms || parseInt(
      process.env.EVALUATOR_TIMEOUT_MS || process.env.NODE_TIMEOUT_MS || '2100000',
      10
    );
    let timeoutFired = false;
    const watchdog = setTimeout(() => {
      timeoutFired = true;
      const msg = `\n=== WATCHDOG TIMEOUT (${EVAL_TIMEOUT_MS}ms) — killing evaluator subprocess ===\n`;
      logStream.write(msg);
      console.error(`[evaluator] ⚠  subprocess hung — exceeded ${EVAL_TIMEOUT_MS}ms, killing`);
      try { child.kill('SIGTERM'); } catch (_) {}
      setTimeout(() => {
        if (!child.killed) {
          try { child.kill('SIGKILL'); } catch (_) {}
        }
      }, 5000);
    }, EVAL_TIMEOUT_MS);

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

    // Claude: prompt via stdin. OpenCode: prompt as positional arg (already passed).
    if (!isOpenCode) {
      child.stdin.write(prompt);
      child.stdin.end();
    }

    child.on('close', code => {
      clearTimeout(watchdog);
      cleanupDataDir();
      const duration = Date.now() - startTime;
      logStream.write(`\n=== EXIT CODE: ${code} | DURATION: ${duration}ms ===\n`);

      if (timeoutFired) {
        logStream.end();
        return reject(new Error(`evaluator subprocess timed out after ${EVAL_TIMEOUT_MS}ms (EVALUATOR_TIMEOUT_MS env). Last stdout: ${stdout.slice(-300)}`));
      }

      if (code !== 0) {
        logStream.end();
        return reject(new Error(`evaluator subprocess exited ${code}: ${stderr.slice(-500)}`));
      }

      // Parse output: Claude emits a single JSON envelope; OpenCode emits nd-JSON.
      let numTurns = 0;
      let totalCostUsd = 0;
      let resultText = '';

      if (isOpenCode) {
        const lines = stdout.trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'result') {
              resultText = ev.result || '';
              numTurns = ev.num_turns || 0;
              totalCostUsd = ev.total_cost_usd || 0;
            }
          } catch (_) { /* skip non-JSON */ }
        }
      } else {
        let envelope;
        try {
          envelope = JSON.parse(stdout);
          numTurns = envelope.num_turns;
          totalCostUsd = envelope.total_cost_usd;
          resultText = envelope.result;
        } catch (err) {
          logStream.end();
          return reject(new Error(`failed to parse evaluator stdout: ${err.message}\nstdout tail: ${stdout.slice(-500)}`));
        }
      }

      // Read what the agent wrote to the evaluation file.
      const outPath = resolveVars(node.required_output_file || '', config, projectName);
      const evalOutcome = loadAndNormalizeEvaluation(outPath, rubric, logStream);

      if (evalOutcome.valid) {
        try {
          fs.writeFileSync(outPath, JSON.stringify(evalOutcome.normalized, null, 2) + '\n');
          logStream.write(`\n=== EVALUATION NORMALIZED AND PERSISTED ===\n${outPath}\n`);
        } catch (err) {
          logStream.write(`\n[warn] failed to rewrite normalized evaluation: ${err.message}\n`);
        }
      } else {
        logStream.write(`\n=== EVALUATION INVALID ===\nerrors:\n${evalOutcome.errors.map(e => '  - ' + e).join('\n')}\n`);
      }

      logStream.end();

      const result = {
        _duration_ms: duration,
        _log_file: logFile,
        num_turns: numTurns,
        total_cost_usd: totalCostUsd,
        result: resultText,
        evaluation: {
          valid: evalOutcome.valid,
          errors: evalOutcome.errors,
          normalized: evalOutcome.normalized,
          file_path: outPath,
        },
      };
      resolve(result);
    });

    child.on('error', err => {
      cleanupDataDir();
      logStream.end();
      reject(err);
    });
  });
}

function loadAndNormalizeEvaluation(outPath, rubric, logStream) {
  if (!outPath) {
    return { valid: false, errors: ['node missing required_output_file'], normalized: null };
  }
  if (!fs.existsSync(outPath)) {
    return { valid: false, errors: [`evaluation file not found: ${outPath}`], normalized: null };
  }
  const raw = fs.readFileSync(outPath, 'utf-8').trim();

  // Tolerate the common mistake of the agent wrapping JSON in ```json fences
  // — strip them before parsing so we don't fail a perfectly good evaluation
  // over a markdown habit.
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    logStream && logStream.write(`\n[warn] evaluation file is not valid JSON: ${err.message}\n`);
    return {
      valid: false,
      errors: [`evaluation file is not valid JSON: ${err.message}`],
      normalized: null,
    };
  }

  return validateEvaluation(parsed, rubric);
}

module.exports = {
  buildEvaluatorPrompt,
  buildEvaluatorArgs,
  buildOpenCodeEvaluatorArgs,
  collectFiles,
  getEvaluatorBackend,
  runEvaluatorNode,
  loadAndNormalizeEvaluation,
  EVALUATOR_ENFORCED_DENY,
};
