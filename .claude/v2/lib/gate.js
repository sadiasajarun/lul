/**
 * gate.js — runs gate scripts, verifies proof files, and blends deterministic
 * gate scores with subjective evaluator scores when the blueprint declares
 * evaluator node(s).
 *
 * A gate result is one of:
 *   - `ran: false, reason: 'no_gate_script'` (no gate script for this phase)
 *   - deterministic only (`_blend_applied` falsy) — score = gate.score
 *   - blended (`_blend_applied: true`) — score = blended final_score, with
 *     raw deterministic_score + evaluator_score preserved alongside.
 *
 * Downstream consumers should read `score` / `passed` from the returned
 * object; they are overwritten to the blended values when blending is
 * active, so existing code paths keep working without changes.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveVars, gateProofsDirFor } = require('./config');

function gateScriptPath(config, phaseName) {
  return path.join(config.gatesDir, `${phaseName}-gate.sh`);
}

function hasGate(config, phaseName) {
  return fs.existsSync(gateScriptPath(config, phaseName));
}

function gateProofPath(config, projectName, phaseName) {
  return path.join(gateProofsDirFor(config, projectName), `${phaseName}.proof`);
}

function runGate(config, phaseName, projectName) {
  const script = gateScriptPath(config, phaseName);
  if (!fs.existsSync(script)) {
    return { ran: false, reason: 'no_gate_script' };
  }

  const projectArg = projectName || path.basename(config.targetDir);
  console.log(`\n[gate] running: bash ${path.relative(config.targetDir, script)} ${config.targetDir} ${projectArg}`);
  const startTime = Date.now();

  let stdout, exitCode = 0;
  const result = spawnSync('bash', [script, config.targetDir, projectArg], {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    // No timeout — gate script runs to completion.
  });

  stdout = result.stdout || '';
  exitCode = result.status || 0;

  const duration = Date.now() - startTime;

  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // some gates may print plain text
  }

  return {
    ran: true,
    exitCode,
    duration_ms: duration,
    stdout,
    json: parsed,
    score: parsed?.score ?? null,
    passed: parsed?.passed ?? (exitCode === 0),
    summary: parsed?.summary ?? null,
  };
}

function verifyGateProof(config, phaseName, maxAgeMinutes = 10, projectName = null) {
  const file = gateProofPath(config, projectName, phaseName);
  if (!fs.existsSync(file)) {
    return { valid: false, reason: 'proof_missing', path: file };
  }
  const stat = fs.statSync(file);
  const ageMs = Date.now() - stat.mtimeMs;
  if (ageMs > maxAgeMinutes * 60 * 1000) {
    return { valid: false, reason: 'proof_stale', age_ms: ageMs, path: file };
  }
  const content = fs.readFileSync(file, 'utf-8');
  const gateMatch = content.match(/^gate: (\S+)/m);
  const scoreMatch = content.match(/^score: (\S+)/m);
  return {
    valid: true,
    path: file,
    gate: gateMatch?.[1],
    score: scoreMatch ? parseFloat(scoreMatch[1]) : null,
    age_ms: ageMs,
  };
}

// ---------------------------------------------------------------------------
// Evaluator blending
// ---------------------------------------------------------------------------

/**
 * Pull all evaluator nodes out of a blueprint. Returns [] for missing /
 * malformed blueprints rather than throwing — a phase without evaluators
 * is the common case and should not produce warnings.
 */
function findEvaluatorNodes(blueprint) {
  if (!blueprint || !Array.isArray(blueprint.nodes)) return [];
  return blueprint.nodes.filter(n => n && n.type === 'evaluator');
}

/**
 * Load the normalized evaluation JSON an evaluator node wrote.
 * Returns null if the file is missing or unparseable — in either case the
 * gate falls back to deterministic-only scoring.
 */
function loadEvaluation(config, projectName, evalNode) {
  const p = resolveVars(evalNode.required_output_file || '', config, projectName);
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Combine a deterministic gate score with an evaluator score per the blend
 * config on the evaluator node. Pure function — no I/O, safe to unit-test.
 *
 * Blend strategies (plan §5):
 *   - soft_score  → weighted average (default; recommended for design/frontend/integrate)
 *   - veto        → min(det, eval), with min_evaluator_score floor (ship phase)
 *   - hard_gate   → evaluator is advisory; final = det (not recommended)
 *
 * Any strategy respects:
 *   - `min_evaluator_score` floor — falls below = force-fail
 *   - P0 blockers — any = force-fail regardless of score
 */
function blendScores(gateScore, gatePassed, evaluation, blendConfig) {
  const config = blendConfig || {};
  const strategy = config.strategy || 'soft_score';
  const evalScore = typeof evaluation?.overall_score === 'number' ? evaluation.overall_score : null;
  const p0 = evaluation?.p0_count || 0;
  const p1 = evaluation?.p1_count || 0;
  const p2 = evaluation?.p2_count || 0;

  // Fall through to deterministic-only if there's no evaluator score.
  if (evalScore == null) {
    return {
      final_score: gateScore,
      final_passed: gatePassed,
      deterministic_score: gateScore,
      evaluator_score: null,
      blended_score: gateScore,
      blend_strategy: 'none',
      p0_blockers: 0,
      p1_blockers: 0,
      p2_blockers: 0,
      details: 'no evaluator score available, using gate.score directly',
    };
  }

  switch (strategy) {
    case 'veto': {
      const minEval = typeof config.min_evaluator_score === 'number'
        ? config.min_evaluator_score
        : 0.7;
      const final = Math.min(gateScore, evalScore);
      const passed = gatePassed && evalScore >= minEval && p0 === 0;
      return {
        final_score: final,
        final_passed: passed,
        deterministic_score: gateScore,
        evaluator_score: evalScore,
        blended_score: final,
        blend_strategy: 'veto',
        p0_blockers: p0,
        p1_blockers: p1,
        p2_blockers: p2,
        details: `veto: min(gate=${gateScore.toFixed(3)}, eval=${evalScore.toFixed(3)}) = ${final.toFixed(3)}; P0=${p0}; min_eval=${minEval}`,
      };
    }
    case 'hard_gate': {
      // Evaluator is ADVISORY for the score (final = deterministic only, so the
      // gate stays reproducible — no LLM-judge variance in the number). But a
      // P0 blocker the evaluator reports still force-fails: P0s are discrete,
      // high-confidence findings (e.g. RBAC-breaking falsy-zero role), not a
      // fuzzy average. This is the right strategy when the deterministic gate
      // already promotes the recurring correctness findings to its own checks.
      const passed = gatePassed && p0 === 0;
      return {
        final_score: gateScore,
        final_passed: passed,
        deterministic_score: gateScore,
        evaluator_score: evalScore,
        blended_score: gateScore,
        blend_strategy: 'hard_gate',
        p0_blockers: p0,
        p1_blockers: p1,
        p2_blockers: p2,
        details: `hard_gate: score=det ${gateScore.toFixed(3)} (eval ${evalScore.toFixed(3)} advisory); P0=${p0}${p0 > 0 ? ' → FAIL' : ''}`,
      };
    }
    case 'soft_score':
    default: {
      const detWeight = typeof config.deterministic_weight === 'number'
        ? config.deterministic_weight
        : 0.6;
      const evalWeight = typeof config.weight === 'number'
        ? config.weight
        : 0.4;
      const minEval = typeof config.min_evaluator_score === 'number'
        ? config.min_evaluator_score
        : 0.5;
      const final = detWeight * gateScore + evalWeight * evalScore;
      const passed = gatePassed && evalScore >= minEval && p0 === 0;
      return {
        final_score: Math.round(final * 1000) / 1000,
        final_passed: passed,
        deterministic_score: gateScore,
        evaluator_score: evalScore,
        blended_score: Math.round(final * 1000) / 1000,
        blend_strategy: 'soft_score',
        p0_blockers: p0,
        p1_blockers: p1,
        p2_blockers: p2,
        details: `soft_score: ${detWeight}*${gateScore.toFixed(3)} + ${evalWeight}*${evalScore.toFixed(3)} = ${final.toFixed(3)}; P0=${p0}; min_eval=${minEval}`,
      };
    }
  }
}

/**
 * Thin wrapper: runs the deterministic gate, then blends in evaluator scores
 * if the blueprint declared any. When no blueprint is passed or none of its
 * nodes are evaluators, behavior is byte-for-byte identical to runGate().
 */
function runGateWithBlend(config, phaseName, projectName, blueprint = null) {
  const gateResult = runGate(config, phaseName, projectName);
  if (!gateResult.ran) return gateResult;

  const evaluators = findEvaluatorNodes(blueprint);
  if (evaluators.length === 0) return gateResult;

  if (evaluators.length > 1) {
    console.warn(`[gate] ${evaluators.length} evaluator nodes declared for '${phaseName}' — blending only the first (${evaluators[0].id})`);
  }
  const evalNode = evaluators[0];
  const evaluation = loadEvaluation(config, projectName, evalNode);
  const blended = blendScores(
    gateResult.score ?? 0,
    gateResult.passed ?? false,
    evaluation,
    evalNode.blend,
  );

  console.log(`[gate] blend: ${blended.details}`);

  return {
    ...gateResult,
    // Override score/passed so existing downstream code paths (which read
    // these fields) pick up the blended values transparently.
    score: blended.final_score,
    passed: blended.final_passed,
    // Detail fields for observability + event emission.
    deterministic_score: blended.deterministic_score,
    evaluator_score: blended.evaluator_score,
    blended_score: blended.blended_score,
    blend_strategy: blended.blend_strategy,
    p0_blockers: blended.p0_blockers,
    p1_blockers: blended.p1_blockers,
    p2_blockers: blended.p2_blockers,
    blend_details: blended.details,
    _blend_applied: true,
  };
}

module.exports = {
  gateScriptPath,
  hasGate,
  gateProofPath,
  runGate,
  runGateWithBlend,
  verifyGateProof,
  // Exported for unit tests:
  blendScores,
  findEvaluatorNodes,
  loadEvaluation,
};
