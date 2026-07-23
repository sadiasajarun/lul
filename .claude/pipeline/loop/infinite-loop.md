# Infinite Loop Engine

When `--loop` is specified, the pipeline runs continuous generations until quality converges.

## RL-Enhanced Loop Algorithm

The loop engine now uses a reinforcement learning reward system to make smarter decisions about which phases to prioritize and how to allocate effort. Configuration lives in `reward.yaml`, state tracking in `state-log.yaml`, and learned policy in `policy-memory.md`.

```
generation = read from PIPELINE_STATUS.md (or 1 if new)
max_gen = --max-generations (default: 50)
target = --quality (default: 0.95)
stagnation_count = 0
last_score = 0

# RL initialization
Read: .claude/pipeline/loop/reward.yaml → reward_config
Read: .claude/pipeline/loop/policy-memory-global.yaml → global_policy (if exists)
Read: {TARGET_DIR}/.claude-project/policy-memory.yaml → project_policy (if exists)
IF generation == 1: Initialize STATE_LOG.yaml with new episode_id

WHILE generation <= max_gen:

  0. CAPTURE PRE-GENERATION STATE
     - Snapshot current phase_scores, bug_counts, coverage metrics
     - Record as state_before

  1. IDENTIFY WORK (Reward-Weighted Phase Selection)
     - Find all phases where score < target OR status = Failed
     - If no phases need work: CONVERGED, exit loop
     - Calculate priority for each phase:

       base_priority = (target - phase_score) × phase_weight

       # Policy memory boost: apply learned heuristics
       IF global_policy has phase_priority_adjustment matching current state:
         priority += adjustment.avg_reward_improvement × (episodes_observed / 10)

       # Shift-left boost: prioritize phases that catch bugs early
       IF global_policy.shift_left_patterns shows this phase prevents late bugs:
         priority += shift_left_bonus × avg_severity_prevented_weight

       # Stagnation strategy: use learned breakers instead of default retry
       IF phase has failed 3+ times AND global_policy has stagnation_breaker:
         → Apply breaker strategy (e.g., "deepen stories before re-running tests")

     - Sort by: priority (highest first)
     - Log: "Phase priorities: {phase: priority, ...}"

  2. EXECUTE PHASES
     - For each phase needing work (in priority order):
       a. If phase has failed 3+ times consecutively:
          → Check global_policy.stagnation_breakers for this phase
          → If breaker exists: apply breaker strategy
          → Else: run stagnation handler (see stagnation.md)
       b. Execute phase skill
       c. Run phase improvement loop (automatic in loop mode)
       d. Evaluate phase (quality gate)
       e. MANDATORY PROOF VERIFICATION — Run via Bash:
            PROOF="{TARGET_DIR}/.claude-project/status/.gate-proofs/{phase}.proof"
            if [ ! -f "$PROOF" ]; then
              echo "GATE NEVER RAN for {phase}. Forcing score to 0.0"
              echo "Re-running gate: bash {CLAUDE_DIR}/gates/{phase}-gate.sh {TARGET_DIR}"
              bash {CLAUDE_DIR}/gates/{phase}-gate.sh {TARGET_DIR}
            fi
            # Read score from proof file — DO NOT self-assign scores
            phase_score = $(grep '^score:' "$PROOF" | awk '{print $2}')
            Phases without gate scripts (spec, prd): use evaluation fallback score instead.
       f. Record score (from proof file, NOT self-assigned)
       f. CALCULATE PHASE REWARD (R_phase):
          Δ_score = new_score - old_score
          bugs_caught = bugs found during this phase execution
          R_phase = phase_weight × Δ_score
                  + Σ(bug.severity_weight × reward_config.shift_left_multiplier[phase])
                  - late_bug_penalty (for bugs RCA says should have been caught earlier)
          Log: "Phase {name}: R_phase = {R_phase}"

  3. CALCULATE GENERATION SCORE & REWARD
     pipeline_score = average(all phase scores)

     # Capture post-generation state
     state_after = snapshot phase_scores, bug_counts, coverage metrics

     # R_generation per reward.yaml
     Δ_pipeline = pipeline_score - last_score
     new_bugs = bugs found this generation (by severity)
     story_pass_rate = stories_passed / total_stories
     depth_improvement = state_after.depth_score - state_before.depth_score
     pattern_reuse = gap_patterns_reused / gap_patterns_total (or 0 if no patterns)
     stagnation_penalty = stagnation_count × penalty_per_generation (if stagnant)

     R_generation = α × Δ_pipeline
                  + β × (-Σ(severity_weight × new_bug_count))
                  + γ × story_pass_rate
                  + δ × depth_improvement
                  + ε × pattern_reuse
                  - ζ × stagnation_penalty

     (α, β, γ, δ, ε, ζ from reward_config.generation_reward.weights)

  4. CHECK EXIT CONDITIONS
     a. CONVERGED: pipeline_score >= target
        → Calculate R_terminal:
          R_terminal = convergence_bonus
                     + speed_bonus × (max_gen - generation) / max_gen
                     + coverage_completeness × final_depth_score
        → Log terminal reward
        → Report: "Pipeline converged at generation {N}, score {S}"
        → Report: "Episode reward: {R_episode} (normalized: {R_normalized})"
        → Update policy memories (Step 7)
        → Ask: "Ready to ship? (--phase ship)"

     b. STAGNATION: pipeline_score == last_score for 3 generations
        → Run stagnation handler
        → If still stagnant after handler: 
          Calculate R_terminal (no convergence bonus, stagnation penalty)
          Update policy memories (Step 7)
          Pause, report to user

     c. MAX GENERATIONS: generation >= max_gen
        → Calculate R_terminal (no convergence bonus)
        → Update policy memories (Step 7)
        → Report: "Max generations reached. Score: {S}/{target}"
        → Show which phases need manual attention

     d. USER STOP: user interrupts
        → Calculate R_terminal (partial, no convergence bonus)
        → Update policy memories (Step 7)
        → Save checkpoint, report progress

  5. LOG GENERATION (State Log + Status)
     Update PIPELINE_STATUS.md:
       generation: {N}
       generation_score: {S}
       Add to Generation Log table (include reward column)

     Append to STATE_LOG.yaml:
       Full state vector per state-log.yaml schema
       Include reward breakdown: { phase_rewards, R_generation, cumulative_reward }

  6. PREPARE NEXT GENERATION
     - Increment generation counter
     - Reset failed phases to Pending (keep scores for tracking)
     - Check for artifact invalidation (see artifact-tracking.md)
     - last_score = pipeline_score
     - Continue loop

  7. UPDATE POLICY MEMORIES (on episode end only)
     a. Per-project memory ({TARGET_DIR}/.claude-project/policy-memory.yaml):
        - Append episode reward trace
        - Record stagnation solutions used
        - Record local bug patterns

     b. Global memory (.claude/pipeline/loop/policy-memory-global.yaml):
        - Extract high-reward actions (R_phase > mean + 1σ)
        - Extract shift-left wins (bugs caught early)
        - Extract stagnation breakers that worked
        - Merge: new patterns get episodes_observed: 1
        - Merge: existing patterns get updated avg_reward
        - Cross-pollination: promote per-project patterns seen in 2+ projects
        - Contradictions: if a pattern's reward turned negative, decrease confidence

END WHILE
```

## Generation Log Format

```markdown
## Generation Log

| Gen | Score | Δ Score | R_gen | Cumul R | Bugs (P0/P1/P2/P3) | Phases Run | Improved | Stagnant | Duration |
|-----|-------|---------|-------|---------|---------------------|-----------|----------|----------|----------|
| 1   | 0.42  | +0.42   | -8.2  | -8.2    | 0/3/5/2             | all 11    | -        | -        | 50m      |
| 2   | 0.68  | +0.26   | 12.4  | 4.2     | 0/1/2/1             | 4 phases  | design, db | -      | 25m      |
| 3   | 0.85  | +0.17   | 15.1  | 19.3    | 0/0/1/0             | 3 phases  | be, fe   | -        | 20m      |
| 4   | 0.93  | +0.08   | 18.7  | 38.0    | 0/0/0/1             | 2 phases  | int, qa  | -        | 15m      |
| 5   | 0.96  | +0.03   | 22.3  | 60.3    | 0/0/0/0             | 1 phase   | qa       | -        | 10m      |

Status: CONVERGED at generation 5
Episode Reward: 160.3 (terminal: 100.0) | Normalized: 0.72
Bugs: 16 found, 16 fixed, 0 escaped | Pattern reuse: 4/7 (57%)
```

## Parallelization

After Phase 2 (prd), Phase 3 (design) and Phase 4 (database) run in parallel — DB depends on PRD only, not design. After design is confirmed, Phase 3.5 (user-stories) and Phase 6 (frontend) launch. Backend proceeds independently via database.

### When to Parallelize

```
In --run-all or --loop mode:
  After Phase 2 completes:
    Launch Phase 3 (design) + Phase 4 (database) concurrently
    Phase 4 → Phase 5 (backend) proceeds independently
    Phase 3 pauses at 3d for client confirmation
  After Phase 3 confirmed:
    Launch Phase 3.5 (user-stories) + Phase 6 (frontend)
    Phase 7 (integrate) waits for BOTH backend + frontend
```

### Parallel Execution Diagram

```
Phase 2 (prd) Complete
        |
   +----+--------+
   |              |
Phase 3 (design) Phase 4 (database)   ← parallel right after PRD
   |              |
   ⏸ 3d confirm Phase 5 (backend)     ← only needs database
   |              |
   +----+----+    |
   |         |    |
Phase 3.5  Phase 6 (frontend)         ← after design confirmation
(stories)    |    |
   |         +----+
   |              |
   |        Phase 7 (integrate)        ← sync: frontend + backend
   |              |
   |        Phase 8 (test-api)
   |              |
   +------+-------+
          |
    Phase 9 (test-browser)             ← sync: stories (3.5) + test-api (8)
          |
    Phase 10 (ship)
```
