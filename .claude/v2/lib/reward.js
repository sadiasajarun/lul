/**
 * reward.js — pure reward computation from an event stream.
 *
 * Inputs:
 *   - reward.yaml (weights, multipliers, severity table)
 *   - events.jsonl (one episode)
 *
 * Outputs:
 *   - Per-phase rewards (R_phase)
 *   - Per-generation rewards (R_generation) — only meaningful in loop mode
 *   - Terminal reward (R_terminal)
 *   - Total episode reward (R_episode)
 *   - Full breakdown for audit/debugging
 *
 * This module is pure. No side effects. No LLM calls. Given the same events
 * and the same config, it always returns the same numbers. That's the ground
 * truth the policy will eventually learn against.
 */

const fs = require('fs');
const path = require('path');
const { loadYaml } = require('./config');
const { readEpisode, EVENT_TYPES } = require('./events');

/**
 * Load reward.yaml from the source project. Merges all YAML documents
 * (the v1 file uses --- separators to divide sections).
 */
function loadRewardConfig(sourceDir) {
  const file = path.join(sourceDir, '.claude', 'pipeline', 'loop', 'reward.yaml');
  if (!fs.existsSync(file)) {
    throw new Error(`reward.yaml not found at ${file}`);
  }
  const yaml = loadYaml();
  const content = fs.readFileSync(file, 'utf-8');

  // v1's reward.yaml uses `---` multi-document format. Merge all docs.
  let merged = {};
  if (typeof yaml.parseAllDocuments === 'function') {
    const docs = yaml.parseAllDocuments(content);
    for (const doc of docs) {
      const obj = doc.toJSON();
      if (obj && typeof obj === 'object') Object.assign(merged, obj);
    }
  } else {
    merged = yaml.parse(content);
  }
  return merged;
}

/**
 * Group events by phase.
 */
function eventsByPhase(events) {
  const byPhase = {};
  for (const e of events) {
    if (!e.phase) continue;
    if (!byPhase[e.phase]) byPhase[e.phase] = [];
    byPhase[e.phase].push(e);
  }
  return byPhase;
}

/**
 * Sum cost_usd across all node_result events for a phase.
 */
function phaseCost(phaseEvents) {
  return phaseEvents
    .filter(e => e.type === EVENT_TYPES.NODE_RESULT && typeof e.cost_usd === 'number')
    .reduce((sum, e) => sum + e.cost_usd, 0);
}

/**
 * Sum duration_ms across all node_result events for a phase.
 */
function phaseDuration(phaseEvents) {
  return phaseEvents
    .filter(e => e.type === EVENT_TYPES.NODE_RESULT && typeof e.duration_ms === 'number')
    .reduce((sum, e) => sum + e.duration_ms, 0);
}

/**
 * Count artifact verification failures for a phase — a signal that the
 * agent tried to skip work. Each failure should cost the phase reward.
 */
function phaseArtifactFailures(phaseEvents) {
  return phaseEvents.filter(
    e => e.type === EVENT_TYPES.ARTIFACT_VERIFY && e.verified === false,
  ).length;
}

/**
 * Extract evaluator signals from a phase's events. Returns the first
 * EVALUATOR_SCORE event's fields, or zeros when absent. Used by
 * computePhaseReward to apply the drift + blocker penalties described in
 * the harness plan §4 (self-evaluation bias detection).
 *
 * `drift` is (deterministic - evaluator). Positive drift means the gate
 * was too lax relative to the evaluator — the more common failure mode
 * and the one the article explicitly calls out.
 */
function phaseEvaluatorMetrics(phaseEvents) {
  const ev = phaseEvents.find(e => e.type === EVENT_TYPES.EVALUATOR_SCORE);
  if (!ev) {
    return {
      present: false,
      drift: 0,
      abs_drift: 0,
      p0_blockers: 0,
      p1_blockers: 0,
      evaluator_score: null,
      deterministic_score: null,
    };
  }
  const drift = typeof ev.drift === 'number' ? ev.drift : 0;
  return {
    present: true,
    drift,
    abs_drift: Math.abs(drift),
    p0_blockers: ev.p0_blockers || 0,
    p1_blockers: ev.p1_blockers || 0,
    evaluator_score: ev.evaluator_score ?? null,
    deterministic_score: ev.deterministic_score ?? null,
  };
}

/**
 * Compute R_phase for a single phase.
 *
 *   R_phase = phase_weight × (new_score - prev_score)
 *           + Σ shift_left_bonus(bug_severity × multiplier[rca_phase])   [when bug events present]
 *           - cost_penalty × total_cost_usd
 *           - artifact_failure_penalty × failed_verifications
 *
 * phase_weight defaults to 1.0 (overridable per phase in reward.yaml → policy_memory later).
 * prev_score defaults to 0 if unknown (first run).
 */
function computePhaseReward(phase, events, rewardConfig, prevScores = {}) {
  const byPhase = eventsByPhase(events);
  const phaseEvents = byPhase[phase] || [];

  const phaseEnd = phaseEvents.find(e => e.type === EVENT_TYPES.PHASE_END);
  const gateEvent = phaseEvents.find(e => e.type === EVENT_TYPES.GATE_SCORE);

  const newScore = gateEvent?.score ?? phaseEnd?.score ?? 0;
  const prevScore = prevScores[phase] ?? 0;
  const deltaScore = newScore - prevScore;

  // Phase weight from reward.yaml (added during Stage 1 tuning).
  // Foundational phases (init, spec, prd, database, ship) get higher weight.
  const phaseWeightMap = rewardConfig?.phase_reward?.phase_weight || {};
  const phaseWeight = phaseWeightMap[phase] ?? 1.0;
  const baseReward = phaseWeight * deltaScore;

  // Shift-left bonus: bugs emitted during this phase credit the RCA phase.
  // For this phase, count bugs whose rca_phase == this phase (credited for catching)
  // and bugs whose discovered_in_phase == this phase (penalty for missing earlier).
  const shiftLeftMultiplier = rewardConfig?.phase_reward?.shift_left_multiplier || {};
  const severityWeights = rewardConfig?.generation_reward?.severity_weights || {
    P0: -10, P1: -5, P2: -2, P3: -1,
  };
  const latePenaltyMult = rewardConfig?.phase_reward?.late_bug_penalty_multiplier || 1.5;

  const bugEvents = events.filter(e => e.type === EVENT_TYPES.BUG_DETECTED);
  let shiftLeftBonus = 0;
  let lateBugPenalty = 0;
  for (const bug of bugEvents) {
    const severity = Math.abs(severityWeights[bug.severity] || 0);
    const mult = shiftLeftMultiplier[bug.rca_phase] || 1.0;

    if (bug.rca_phase === phase) {
      // This phase is the one that should have caught the bug earlier —
      // if it was actually caught here, that's a shift-left win.
      if (bug.discovered_in_phase === phase) {
        shiftLeftBonus += mult * severity;
      } else {
        // Bug was caught later than it should have been — credit against rca_phase.
        // Negative signal: this phase missed something its job was to catch.
        lateBugPenalty += severity * latePenaltyMult;
      }
    }
  }

  // Cost penalty — modest, just to prefer cheap solutions when rewards tie.
  // Coefficient is read from reward.yaml (tuned 2026-04-10: 2.0 → 0.5).
  const cost = phaseCost(phaseEvents);
  const costCoef = rewardConfig?.phase_reward?.cost_penalty_coefficient ?? 0.5;
  const costPenalty = cost * costCoef;

  // Artifact verification failure penalty — the agent tried to skip the contract.
  const artifactFails = phaseArtifactFailures(phaseEvents);
  const artifactPenaltyCoef = rewardConfig?.phase_reward?.artifact_failure_penalty ?? 10;
  const artifactPenalty = artifactFails * artifactPenaltyCoef;

  // Evaluator drift penalty — large gaps between deterministic and subjective
  // scores are the article's "self-evaluation bias" fingerprint. Penalty only
  // applies above `drift_threshold` so small variance is free. Only counts when
  // an evaluator actually ran (no evaluator → no penalty, no reward).
  const evalMetrics = phaseEvaluatorMetrics(phaseEvents);
  const driftConfig = rewardConfig?.phase_reward?.evaluator_drift || {};
  const driftThreshold = typeof driftConfig.threshold === 'number' ? driftConfig.threshold : 0.3;
  const driftCoef = typeof driftConfig.coefficient === 'number' ? driftConfig.coefficient : 10;
  const driftPenalty = evalMetrics.present && evalMetrics.abs_drift > driftThreshold
    ? driftCoef * (evalMetrics.abs_drift - driftThreshold)
    : 0;

  // Evaluator blocker penalty — P0/P1 that the evaluator caught. Separate from
  // the gate.passed machinery because we want episode-level training signal
  // even when blockers don't force a FAIL (soft blend, max-iter reached).
  const blockerConfig = rewardConfig?.phase_reward?.evaluator_blockers || {};
  const p0Pen = typeof blockerConfig.p0_penalty === 'number' ? blockerConfig.p0_penalty : 20;
  const p1Pen = typeof blockerConfig.p1_penalty === 'number' ? blockerConfig.p1_penalty : 5;
  const blockerPenalty = evalMetrics.p0_blockers * p0Pen + evalMetrics.p1_blockers * p1Pen;

  const total = baseReward
    + shiftLeftBonus
    - lateBugPenalty
    - costPenalty
    - artifactPenalty
    - driftPenalty
    - blockerPenalty;

  return {
    phase,
    prev_score: prevScore,
    new_score: newScore,
    delta_score: deltaScore,
    components: {
      base: baseReward,
      shift_left_bonus: shiftLeftBonus,
      late_bug_penalty: -lateBugPenalty,
      cost_penalty: -costPenalty,
      artifact_penalty: -artifactPenalty,
      evaluator_drift_penalty: -driftPenalty,
      evaluator_blocker_penalty: -blockerPenalty,
    },
    cost_usd: cost,
    duration_ms: phaseDuration(phaseEvents),
    artifact_failures: artifactFails,
    evaluator: {
      present: evalMetrics.present,
      deterministic_score: evalMetrics.deterministic_score,
      evaluator_score: evalMetrics.evaluator_score,
      drift: evalMetrics.drift,
      p0_blockers: evalMetrics.p0_blockers,
      p1_blockers: evalMetrics.p1_blockers,
    },
    total,
  };
}

/**
 * Compute R_generation for a single generation (loop mode only).
 * Sums phase rewards for that generation and applies the multi-term formula
 * from reward.yaml.
 */
function computeGenerationReward(genNumber, events, rewardConfig, prevPipelineScore = 0) {
  const genEvents = events.filter(e => e.gen === genNumber || e.type === EVENT_TYPES.GENERATION_END);
  const genEnd = genEvents.find(e => e.type === EVENT_TYPES.GENERATION_END && e.gen === genNumber);
  if (!genEnd) {
    return { gen: genNumber, total: 0, note: 'no generation_end event found' };
  }

  const currentTotal = genEnd.total || 0;
  const deltaPipeline = currentTotal - prevPipelineScore;

  const weights = rewardConfig?.generation_reward?.weights || {};
  const alpha = weights.pipeline_score_improvement ?? 0.15;
  const beta = weights.bug_penalty ?? 0.35;
  const gamma = weights.story_pass_rate ?? 0.15;
  const delta = weights.coverage_depth ?? 0.10;
  const epsilon = weights.pattern_reuse ?? 0.15;
  const zeta = weights.stagnation_penalty ?? 0.10;

  // Bug penalty — sum severity-weighted bugs detected in this generation
  const severityWeights = rewardConfig?.generation_reward?.severity_weights || {
    P0: -10, P1: -5, P2: -2, P3: -1,
  };
  const bugEvents = events.filter(
    e => e.type === EVENT_TYPES.BUG_DETECTED && e.gen === genNumber,
  );
  let bugPenalty = 0;
  for (const bug of bugEvents) {
    bugPenalty += severityWeights[bug.severity] || 0;
  }

  // Stagnation penalty — only applied if a stagnation event fired this gen
  const stagEvents = events.filter(
    e => e.type === EVENT_TYPES.STAGNATION_DETECTED && e.gen === genNumber,
  );
  const stagPenalty = stagEvents.length * (rewardConfig?.generation_reward?.stagnation?.penalty_per_generation ?? 5);

  // Story pass rate + coverage depth + pattern reuse: not yet instrumented,
  // these will land when Stage 2 ships the story/coverage telemetry.
  const storyPassRate = 0;
  const coverageDepth = 0;
  const patternReuse = 0;

  const total =
    alpha * deltaPipeline +
    beta * bugPenalty +                 // bugPenalty is already negative (severity_weights are negative)
    gamma * storyPassRate +
    delta * coverageDepth +
    epsilon * patternReuse -
    zeta * stagPenalty;

  return {
    gen: genNumber,
    pipeline_score: currentTotal,
    delta_pipeline: deltaPipeline,
    components: {
      pipeline_score_improvement: alpha * deltaPipeline,
      bug_penalty: beta * bugPenalty,
      story_pass_rate: gamma * storyPassRate,
      coverage_depth: delta * coverageDepth,
      pattern_reuse: epsilon * patternReuse,
      stagnation_penalty: -zeta * stagPenalty,
    },
    total,
  };
}

/**
 * Compute the terminal reward at episode end.
 */
function computeTerminalReward(events, rewardConfig, maxGenerations = 10) {
  const convergenceEvent = events.find(e => e.type === EVENT_TYPES.CONVERGENCE);
  const terminal = rewardConfig?.terminal_reward || {};
  const convergenceBonus = terminal.convergence_bonus ?? 100;
  const singlePhaseBonus = terminal.single_phase_success_bonus ?? 20;
  const speedBonusMax = terminal.speed_bonus_max ?? 50;
  const escapePenaltyMult = terminal.escape_penalty_multiplier ?? 50;

  const genEvents = events.filter(e => e.type === EVENT_TYPES.GENERATION_END);
  const generationsUsed = genEvents.length || 1;

  // Convergence bonus — distinguishes pipeline-wide convergence (big bonus)
  // from single-phase success (smaller bonus). If no convergence event was
  // emitted, this episode didn't succeed and earns zero.
  const isPipelineConvergence =
    convergenceEvent && convergenceEvent.mode && convergenceEvent.mode !== 'single-phase';
  const isSinglePhaseSuccess =
    convergenceEvent && convergenceEvent.mode === 'single-phase';
  const convReward = isPipelineConvergence
    ? convergenceBonus
    : (isSinglePhaseSuccess ? singlePhaseBonus : 0);

  // Speed bonus — only earned on pipeline convergence (fewer generations = better).
  const speedReward = isPipelineConvergence
    ? speedBonusMax * Math.max(0, (maxGenerations - generationsUsed) / maxGenerations)
    : 0;

  // Escape penalty — any bug with escaped_to_production:true
  const escapedBugs = events.filter(
    e => e.type === EVENT_TYPES.BUG_DETECTED && e.escaped_to_production === true,
  );
  const severityWeights = rewardConfig?.generation_reward?.severity_weights || {
    P0: -10, P1: -5, P2: -2, P3: -1,
  };
  let escapePenalty = 0;
  for (const bug of escapedBugs) {
    escapePenalty += escapePenaltyMult * Math.abs(severityWeights[bug.severity] || 0);
  }

  // Coverage completeness — not yet instrumented
  const coverageReward = 0;

  const total = convReward + speedReward - escapePenalty + coverageReward;

  return {
    converged: !!convergenceEvent,
    convergence_kind: isPipelineConvergence
      ? 'pipeline'
      : (isSinglePhaseSuccess ? 'single-phase' : 'none'),
    generations_used: generationsUsed,
    components: {
      convergence_bonus: convReward,
      speed_bonus: speedReward,
      escape_penalty: -escapePenalty,
      coverage_completeness: coverageReward,
    },
    total,
  };
}

/**
 * Top-level: compute full reward breakdown for an episode file.
 */
function computeEpisodeReward(episodeFile, rewardConfig, options = {}) {
  const events = readEpisode(episodeFile);
  if (events.length === 0) {
    return { error: 'empty episode', total: 0 };
  }

  const episodeStart = events.find(e => e.type === EVENT_TYPES.EPISODE_START);
  const episodeEnd = events.find(e => e.type === EVENT_TYPES.EPISODE_END);

  // Phases that appear in the event stream
  const phases = [...new Set(events.filter(e => e.phase).map(e => e.phase))];

  // Per-phase rewards
  const phaseRewards = phases.map(p =>
    computePhaseReward(p, events, rewardConfig, options.prevScores || {}),
  );

  // Per-generation rewards (only meaningful in loop mode)
  const genNumbers = [...new Set(
    events.filter(e => e.type === EVENT_TYPES.GENERATION_END).map(e => e.gen),
  )].sort((a, b) => a - b);
  const genRewards = [];
  let prevPipeline = 0;
  for (const gen of genNumbers) {
    const r = computeGenerationReward(gen, events, rewardConfig, prevPipeline);
    genRewards.push(r);
    prevPipeline = r.pipeline_score;
  }

  // Terminal reward
  const terminal = computeTerminalReward(
    events,
    rewardConfig,
    options.maxGenerations || 10,
  );

  // Totals
  const phaseSum = phaseRewards.reduce((s, r) => s + r.total, 0);
  const genSum = genRewards.reduce((s, r) => s + r.total, 0);
  const episodeTotal = phaseSum + genSum + terminal.total;

  return {
    episode_id: episodeStart?.episode_id || path.basename(episodeFile, '.jsonl'),
    project: episodeStart?.project,
    mode: episodeStart?.mode,
    duration_ms: episodeEnd?.duration_ms || null,
    success: episodeEnd?.success || false,
    event_count: events.length,
    phases: phaseRewards,
    generations: genRewards,
    terminal,
    totals: {
      phase_sum: phaseSum,
      generation_sum: genSum,
      terminal: terminal.total,
      episode: episodeTotal,
    },
  };
}

module.exports = {
  loadRewardConfig,
  computePhaseReward,
  computeGenerationReward,
  computeTerminalReward,
  computeEpisodeReward,
};
