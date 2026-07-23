# Policy Memory System

Two-tier learning system that accumulates RL experience across loop episodes. The policy memory is the "learned policy" — it records which actions led to the highest rewards so future runs make better decisions.

## Architecture

```
Global Policy Memory                    Per-Project Policy Memory
(pipeline/loop/policy-memory-global.yaml)  (.claude-project/policy-memory.yaml)
         │                                          │
         │  Cross-project patterns                  │  Project-specific history
         │  Bug category → prevention maps          │  Generation reward traces
         │  Shift-left success patterns             │  Phase stagnation solutions
         │  Phase selection heuristics              │  Local bug patterns
         │                                          │
         └──────────┬───────────────────────────────┘
                    │
              Read by infinite-loop.md
              at generation start
```

## Global Policy Memory

**Location**: `pipeline/loop/policy-memory-global.yaml`

Accumulates cross-project wisdom. Referenced by ALL future `--loop` runs as prior knowledge.

### What it stores

```yaml
# 1. Phase action rewards — which actions yield highest reward per phase
phase_actions:
  - phase: backend
    action: "Run TDD cycle with strict scope_guard (test-only, then impl-only)"
    avg_reward: 12.5
    episodes_observed: 8
    last_updated: "2026-04-09"

# 2. Bug prevention strategies — bug category → best prevention approach
prevention_strategies:
  - category: cross_component_gap
    strategy: "Add cross-page flow stories in Phase 3.5 user-stories deepening"
    success_rate: 0.85
    episodes_observed: 5

# 3. Shift-left success patterns — what catches bugs early
shift_left_patterns:
  - pattern: "Schema validation in Phase 4 catches 60% of integration bugs"
    detection_phase: database
    would_have_been: integrate
    avg_severity_prevented: "P1"
    frequency: 12

# 4. Stagnation breakers — what works when a phase is stuck
stagnation_breakers:
  - phase: test-browser
    stuck_at_score: 0.85
    action: "Deepen user stories to tier 12+ before re-running acceptance tests"
    success_rate: 0.70
    episodes_observed: 4

# 5. Phase selection heuristics — optimal phase ordering for reward
phase_priority_adjustments:
  - condition: "bug_count.P0 > 0 AND detection_phase == test-browser"
    action: "Prioritize re-running origin_phase before test-browser"
    reward_improvement: 15.2
```

### How it's updated

After each episode completes (converged, stagnated, or max_reached):
1. Read STATE_LOG.yaml for the completed episode
2. Extract high-reward actions (actions where R_phase > mean + 1σ)
3. Extract prevention successes (bugs caught early via shift-left)
4. Extract stagnation solutions (what broke stagnation)
5. Merge into global memory:
   - New patterns: add with `episodes_observed: 1`
   - Existing patterns: increment `episodes_observed`, update `avg_reward` (running mean)
   - Contradicted patterns (reward turned negative): decrease confidence, remove after 3 contradictions

### Cross-pollination rule

A pattern graduates from per-project to global when:
- It appears in **2+ different projects** with positive reward attribution
- Its `avg_reward` is above the global median

This prevents project-specific quirks from contaminating global knowledge.

## Per-Project Policy Memory

**Location**: `{TARGET_DIR}/.claude-project/policy-memory.yaml`

Tracks project-specific reward history. Cleaned up when project ships.

### What it stores

```yaml
project: "my-project"
episodes: 3
total_generations: 15

# Generation-level reward trace
reward_trace:
  - episode: 1
    generations: [
      { gen: 1, score: 0.42, reward: -12.5, phases_run: [spec, init, prd, design, database] },
      { gen: 2, score: 0.68, reward: 8.3, phases_run: [backend, frontend] },
      ...
    ]
    terminal_reward: 87.4
    outcome: "converged"

# Phase stagnation history — what worked when stuck
stagnation_history:
  - phase: frontend
    stuck_at: 0.82
    solution: "Re-ran design QA, found 3 inconsistencies, fixed and re-converted"
    generations_stuck: 2
    final_score: 0.94

# Project-specific bug patterns (not generalizable)
local_patterns:
  - pattern: "Multi-currency amounts need decimal precision validation"
    category: "domain_specific"
    frequency: 3
```

## How the Loop Engine Uses Policy Memory

At the start of each generation:

```
1. READ global policy memory (if exists)
2. READ per-project policy memory (if exists)
3. CALCULATE phase priorities:
   
   For each phase where score < target:
     base_priority = (target - score) × phase_weight
     
     # Boost from global memory
     IF global has phase_priority_adjustment matching current state:
       priority += adjustment.reward_improvement × confidence
     
     # Boost from stagnation history
     IF phase has been stagnant:
       IF global has stagnation_breaker for this phase:
         → Apply breaker strategy instead of default retry
     
     # Shift-left boost
     IF global shows this phase catches bugs that would appear later:
       priority += shift_left_bonus × avg_severity_prevented
   
   Sort phases by priority (highest first)
   Execute in priority order

4. AFTER generation completes:
   Append to per-project reward trace
   Calculate rewards per reward.yaml
   Log to STATE_LOG.yaml
```

## Production Escape Feedback

When a bug is reported against production (post-ship):

```
1. Tag bug as escaped: true in bug report
2. RCA → identify origin_phase (where bug was introduced)
3. RCA → identify should_have_caught_phase (where testing should have caught it)
4. Calculate R_escape = -50 × severity_weight (from reward.yaml)
5. Retroactively update:
   - Per-project policy memory: add escape event
   - Global policy memory: 
     - Add/update prevention_strategy for this bug category
     - Add shift_left_pattern: "Phase {should_have_caught} must test for {pattern}"
     - Increase phase_priority for should_have_caught_phase in similar contexts
6. Next loop run: the global memory now knows to test harder for this pattern
```

This creates a strong learning signal — one escaped P0 bug (-500 reward) overwhelms an entire generation of positive rewards, ensuring the system aggressively prevents repeat escapes.
