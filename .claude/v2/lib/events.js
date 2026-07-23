/**
 * events.js — structured event stream for episodes.
 *
 * An "episode" = one invocation of the orchestrator (single phase, run-all, or loop).
 * Every meaningful transition during the episode is captured as a JSON event and
 * appended to .claude-project/episodes/{episode_id}.jsonl.
 *
 * This is the raw training data for the RL reward function and the bandit policy.
 * DO NOT gate behavior on event emission — it must be side-effect-free for the
 * pipeline. Disable via --no-events for bit-for-bit reproducibility checks.
 */

const fs = require('fs');
const path = require('path');

/**
 * Canonical event types. Using a constant rather than free-form strings so
 * downstream consumers (reward.js, policy.js) never have to guess.
 */
const EVENT_TYPES = {
  EPISODE_START: 'episode_start',
  EPISODE_END: 'episode_end',
  PHASE_START: 'phase_start',
  PHASE_END: 'phase_end',
  NODE_START: 'node_start',
  NODE_RESULT: 'node_result',
  ARTIFACT_VERIFY: 'artifact_verify',
  GATE_SCORE: 'gate_score',
  EVALUATOR_SCORE: 'evaluator_score', // emitted by gate.js after blending
                                      // deterministic + evaluator scores so
                                      // reward.js can compute drift penalties.
  GENERATION_START: 'generation_start',
  GENERATION_END: 'generation_end',
  ITERATION_START: 'iteration_start',
  ITERATION_END: 'iteration_end',
  BUG_DETECTED: 'bug_detected',        // emitted by /report-bug (future)
  STAGNATION_DETECTED: 'stagnation_detected',
  CONVERGENCE: 'convergence',
};

function generateEpisodeId() {
  const iso = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const rand = Math.random().toString(36).slice(2, 6);
  return `ep-${iso}-${rand}`;
}

/**
 * Create an event stream tied to a single episode.
 *   config       — the orchestrator config (targetDir lives here)
 *   projectName  — the detected project name
 *   options      — { enabled: bool, episodeId?: string, mode?: string, argv?: [] }
 *
 * Returns an object with { episodeId, enabled, path, emit, close }.
 * emit() is cheap and safe to call when disabled (becomes a no-op).
 */
function createEventStream(config, projectName, options = {}) {
  const episodeId = options.episodeId || generateEpisodeId();
  const enabled = options.enabled === true;
  const episodesDir = path.join(config.targetDir, '.claude-project', 'episodes');
  const filePath = path.join(episodesDir, `${episodeId}.jsonl`);

  if (enabled) {
    fs.mkdirSync(episodesDir, { recursive: true });
  }

  let diskErrorLogged = false;
  const eventBuffer = []; // in-memory fallback when disk fails
  const MAX_BUFFER = 200;

  function emit(type, payload = {}) {
    if (!enabled) return;
    const event = {
      t: new Date().toISOString(),
      type,
      episode_id: episodeId,
      project: projectName,
      ...payload,
    };
    const line = JSON.stringify(event) + '\n';
    try {
      fs.appendFileSync(filePath, line);
      // If we had buffered events from a transient failure, try flushing them
      if (eventBuffer.length > 0) {
        try {
          fs.appendFileSync(filePath, eventBuffer.join(''));
          eventBuffer.length = 0;
          if (diskErrorLogged) {
            console.error(`[events] disk recovered — flushed ${eventBuffer.length} buffered events`);
            diskErrorLogged = false;
          }
        } catch {}
      }
    } catch (err) {
      // Buffer in memory so training data isn't silently lost
      if (eventBuffer.length < MAX_BUFFER) {
        eventBuffer.push(line);
      }
      if (!diskErrorLogged) {
        console.error(`[events] WARNING: disk write failed, buffering in memory (${err.message})`);
        diskErrorLogged = true;
      }
    }
  }

  return {
    episodeId,
    enabled,
    path: filePath,
    emit,
    /**
     * Convenience helpers — typed emitters for the most common events so
     * callers can't mistype the keys.
     */
    episodeStart(meta) {
      emit(EVENT_TYPES.EPISODE_START, {
        mode: meta.mode,
        argv: meta.argv,
        target_dir: config.targetDir,
        source_dir: config.sourceDir,
      });
    },
    episodeEnd(meta) {
      emit(EVENT_TYPES.EPISODE_END, {
        success: meta.success,
        failed_phase: meta.failedPhase || null,
        failed_node: meta.failedNode || null,
        duration_ms: meta.duration_ms,
      });
    },
    phaseStart(phase, genOrIter = null) {
      emit(EVENT_TYPES.PHASE_START, { phase, gen: genOrIter });
    },
    phaseEnd(phase, result) {
      emit(EVENT_TYPES.PHASE_END, {
        phase,
        success: result.success,
        failed_node: result.failedNode || null,
        duration_ms: result.duration_ms,
        nodes_pass: result.nodesPassed,
        nodes_fail: result.nodesFailed,
        nodes_skip: result.nodesSkipped,
        nodes_total: result.nodesTotal,
        score: result.score,
      });
    },
    /**
     * extra may include `cell: { source, subject_var, subject_value, index, total }`
     * when the node was run as one cell of a fanout. Reward/audit consumers can
     * group events by cell.subject_value to attribute outcomes to a specific
     * module/page/role.
     */
    nodeResult(phase, node, status, extra = {}) {
      emit(EVENT_TYPES.NODE_RESULT, {
        phase,
        node: node.id,
        node_type: node.type,
        status,
        ...extra,
      });
    },
    artifactVerify(phase, node, verify, cell = null) {
      emit(EVENT_TYPES.ARTIFACT_VERIFY, {
        phase,
        node: node.id,
        verified: verify.verified,
        reason: verify.reason || null,
        path: verify.path || null,
        pattern: node.verification_pattern || null,
        size: verify.size || null,
        cell: cell || null,
      });
    },
    gateScore(phase, gateResult, proof) {
      emit(EVENT_TYPES.GATE_SCORE, {
        phase,
        score: gateResult?.score ?? null,
        passed: gateResult?.passed ?? null,
        summary: gateResult?.summary ?? null,
        proof_valid: proof?.valid ?? null,
      });
    },
    /**
     * Emitted after gate + evaluator scores have been blended. `drift` is the
     * signed difference (deterministic - evaluator) — large positive values
     * suggest the mechanical gate is too lax; large negatives suggest it is
     * too strict. Consumed by reward.js to penalize coherence-drift episodes.
     */
    evaluatorScore(phase, data = {}) {
      emit(EVENT_TYPES.EVALUATOR_SCORE, {
        phase,
        node: data.node || null,
        deterministic_score: data.deterministic_score ?? null,
        evaluator_score: data.evaluator_score ?? null,
        blended_score: data.blended_score ?? null,
        blend_strategy: data.blend_strategy || null,
        drift: data.drift ?? null,
        p0_blockers: data.p0_blockers ?? 0,
        p1_blockers: data.p1_blockers ?? 0,
        p2_blockers: data.p2_blockers ?? 0,
        mismatch: data.mismatch ?? null,
        duration_ms: data.duration_ms ?? null,
        cost_usd: data.cost_usd ?? null,
      });
    },
    generationStart(gen) {
      emit(EVENT_TYPES.GENERATION_START, { gen });
    },
    generationEnd(gen, total, improvement, runOk) {
      emit(EVENT_TYPES.GENERATION_END, { gen, total, improvement, run_ok: runOk });
    },
    iterationStart(phase, iter) {
      emit(EVENT_TYPES.ITERATION_START, { phase, iter });
    },
    iterationEnd(phase, iter, score, success) {
      emit(EVENT_TYPES.ITERATION_END, { phase, iter, score, success });
    },
    stagnation(reason, context) {
      emit(EVENT_TYPES.STAGNATION_DETECTED, { reason, ...context });
    },
    convergence(context) {
      emit(EVENT_TYPES.CONVERGENCE, context);
    },
  };
}

/**
 * Read an episode JSONL file into an array of parsed events.
 * Used by reward.js and reward-audit.js.
 */
function readEpisode(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Episode file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`Invalid JSON at line ${i + 1} of ${filePath}: ${err.message}`);
    }
  });
}

module.exports = {
  EVENT_TYPES,
  createEventStream,
  generateEpisodeId,
  readEpisode,
};
