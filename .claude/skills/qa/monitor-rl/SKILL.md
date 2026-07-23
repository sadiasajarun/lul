---
skill_name: monitor-rl
applies_to_local_project_only: false
auto_trigger_regex: [monitor rl, rl status, reward status, rl dashboard, rl monitor, show rewards, show improvements, pipeline rewards]
tags: [qa, rl, monitoring, rewards, dashboard]
related_skills: [run-feedback-loop, learn-bugs]
description: Reads RL state log, bug reports, and policy memory to produce a monitoring dashboard showing what improved, where, and how across generations and episodes.
allowed-tools: Read, Glob, Grep, Bash(cat *), Bash(wc *)
---

# Monitor RL — Reward System Dashboard

Produces a human-readable monitoring dashboard from the RL loop's state log, bug reports, and policy memory. Shows what improved, where bugs were caught, how rewards are trending, and what the system learned.

## When to Use

- During or after a `--loop` run to see what's happening
- After multiple episodes to review cross-project learning
- When investigating why a loop stagnated or converged slowly
- Via `/monitor-rl` command

## Inputs

| Input | Path | Required |
|-------|------|----------|
| State Log | `{TARGET_DIR}/.claude-project/status/{project}/STATE_LOG.yaml` | Yes (for per-episode view) |
| Pipeline Status | `{TARGET_DIR}/.claude-project/status/{project}/PIPELINE_STATUS.md` | Yes |
| Bug Reports | `{TARGET_DIR}/.claude-project/bug_reports/BUG-*.yaml` | No (if no bugs found) |
| Gap Patterns | `{TARGET_DIR}/.claude-project/bug_reports/_gap_patterns.yaml` | No |
| Per-Project Memory | `{TARGET_DIR}/.claude-project/policy-memory.yaml` | No (first episode) |
| Global Memory | `.claude/pipeline/loop/policy-memory-global.yaml` | No (first project) |
| Reward Config | `.claude/pipeline/loop/reward.yaml` | Yes (for weight reference) |

## Algorithm

### Step 1: Detect Available Data

```
1. Read PIPELINE_STATUS.md → extract generation count, pipeline_score, tech_stack
2. Check if STATE_LOG.yaml exists:
   IF yes → full dashboard mode (per-generation detail)
   IF no  → summary mode (status file only, no reward data)
3. Glob for BUG-*.yaml → count bug reports
4. Check if policy-memory.yaml exists (per-project)
5. Check if policy-memory-global.yaml has entries (cross-project)
```

### Step 2: Generate Dashboard

Output a structured markdown dashboard with 6 sections. Only include sections where data exists.

---

## Output Format

### Section 1: Episode Overview

```markdown
## RL Dashboard — {project}

**Episode**: {episode_id} | **Status**: {running|converged|stagnated|max_reached}
**Generations**: {completed}/{max} | **Quality**: {pipeline_score}/{target}
**Total Reward**: {cumulative_reward} (normalized: {normalized_reward})
**Duration**: {total_duration}
```

### Section 2: Generation Trend (what improved each generation)

```markdown
### Generation Trend

| Gen | Score | Δ | R_gen | Best Phase | Worst Phase | Bugs Found | Bugs Fixed |
|-----|-------|---|-------|------------|-------------|------------|------------|
| 1   | 0.42  | - | -8.2  | spec (0.95)| frontend (0.10) | 10 | 0 |
| 2   | 0.68  | +0.26 | 12.4 | database (0.90) | frontend (0.45) | 4 | 7 |
| 3   | 0.85  | +0.17 | 15.1 | backend (0.92) | test-browser (0.70) | 2 | 5 |
```

**How to read**: Each row is one generation. "Best Phase" = highest score phase. "Worst Phase" = lowest. Δ shows the pipeline score improvement. Positive R_gen means this generation made things better.

### Section 3: Phase Improvement Map (which phases improved and by how much)

```markdown
### Phase Improvement Map

| Phase | Gen 1 | Gen 2 | Gen 3 | Gen 4 | Gen 5 | Total Δ | R_phase (sum) |
|-------|-------|-------|-------|-------|-------|---------|---------------|
| spec  | 0.95  | -     | -     | -     | -     | 0.00    | 4.75          |
| prd   | 0.80  | 0.90  | -     | -     | -     | +0.10   | 6.20          |
| backend| 0.30 | 0.60  | 0.85  | 0.92  | -     | +0.62   | 18.50         |
| frontend| 0.10| 0.45  | 0.70  | 0.85  | 0.93  | +0.83   | 12.30         |
```

A `-` means the phase was not re-run that generation (score already met target).
Highest "Total Δ" = the phase that improved the most across the episode.
Highest "R_phase (sum)" = the phase that contributed the most reward.

### Section 4: Bug Analysis (where bugs were caught vs where they originated)

```markdown
### Bug Heatmap — Detection vs Origin

Where bugs were FOUND (rows) vs where they were INTRODUCED (columns):

|              | Origin: prd | Origin: db | Origin: be | Origin: fe | Origin: int |
|--------------|-------------|------------|------------|------------|-------------|
| Found: be    |      -      |     1      |   **3**    |     -      |      -      |
| Found: fe    |      -      |     -      |     -      |   **2**    |      -      |
| Found: int   |      1      |     -      |     1      |     1      |      -      |
| Found: t-api |      -      |     -      |     2      |     -      |      -      |
| Found: t-brw |      1      |     -      |     1      |     2      |   **3**     |

**Shift-left wins** (caught earlier than expected): 4 bugs
**Late catches** (found later than ideal): 7 bugs
**Shift-left ratio**: 0.36 (higher = better early detection)
```

**How to read**: Diagonal (bold) = bug found where it was introduced (ideal). Above diagonal = bug found earlier than origin (shift-left win, very good). Below diagonal = bug found later than origin (late catch, should improve).

### Section 5: Reward Attribution (what earned/cost the most reward)

```markdown
### Reward Attribution

**Top 3 Reward Earners** (actions that helped most):
1. `backend` TDD caught 3 bugs at 3.0x multiplier → R = +45.0
2. `test-browser` convergence pushed score from 0.93 → 0.96 → R = +22.3
3. Pattern reuse: 4/7 gap patterns applied proactively → R = +15.0

**Top 3 Reward Costs** (what hurt most):
1. 3 P1 bugs in test-browser (late catch, should have been in integrate) → R = -22.5
2. Stagnation: 2 generations stuck at backend 0.60 → R = -10.0
3. 1 P2 bug escaped to production → R = -100.0

**Net reward this episode**: +160.3
```

### Section 6: Learning Report (what the system learned for future runs)

```markdown
### What Was Learned

**New patterns added to global memory**: 3
  1. "Schema FK validation catches integrate-phase bugs" (shift_left: database → integrate)
  2. "Empty state testing prevents 40% of frontend P2 bugs" (prevention)
  3. "API error response format mismatch" (stagnation breaker for test-api)

**Patterns reused from global memory**: 4/7 (57% reuse ratio)
  - ✓ "Cross-page state persistence story" — prevented 2 bugs
  - ✓ "Auth token refresh interceptor retry limit" — prevented 1 bug
  - ✓ "Form validation DTO alignment" — prevented 1 bug
  - ✗ "File upload size limit" — not applicable (no file uploads)
  - ✗ "Pagination off-by-one" — not triggered
  - ✗ "Timezone serialization" — not triggered

**Stagnation events**: 1
  - backend stuck at 0.60 for 2 generations
  - Breaker applied: "re-run TDD RED phase with stricter scope_guard"
  - Result: score jumped to 0.85 next generation

**Production escapes**: 0 ✓
```

If production escapes exist:

```markdown
**⚠️ PRODUCTION ESCAPES**: 1
  - BUG-015: P1 "Cart total wrong with discount + tax" (reward impact: -250)
  - Origin: backend | Should have caught: test-api
  - Prevention added to global memory: "Tax calculation must test discount+tax combo"
  - All future projects will now test this pattern in test-api phase
```

---

## Section Display Rules

| Condition | Sections Shown |
|-----------|----------------|
| No STATE_LOG.yaml | 1 only (summary from PIPELINE_STATUS.md) |
| Generation 1 only | 1, 4 (if bugs exist) |
| Generation 2+ | 1, 2, 3, 4, 5 |
| Episode complete | All 6 sections |
| `--global` flag | Section 6 expanded with full global memory dump |
| `--compare` flag | Side-by-side comparison of 2 episodes |

## Arguments

```
/monitor-rl                     # Dashboard for current project
/monitor-rl --global            # Include full global policy memory
/monitor-rl --compare           # Compare latest 2 episodes
/monitor-rl --phase backend     # Focus on single phase across generations
/monitor-rl --bugs              # Expand bug heatmap with individual bug details
```

### --phase Focus Mode

When `--phase <name>` is provided, show a deep-dive for that single phase:

```markdown
### Phase Deep-Dive: backend

| Gen | Score | Δ | Bugs Found | Bugs (origin here) | R_phase | Action Taken |
|-----|-------|---|------------|---------------------|---------|-------------|
| 1   | 0.30  | - | 0          | 3                   | -4.5    | Initial TDD cycle |
| 2   | 0.60  | +0.30 | 2     | 1                   | 8.2     | Fix failing tests |
| 3   | 0.60  | 0.00  | 0     | 0                   | -5.0    | ⚠️ STAGNANT |
| 4   | 0.85  | +0.25 | 1     | 0                   | 12.1    | Breaker: strict scope_guard |
| 5   | 0.92  | +0.07 | 0     | 0                   | 3.5     | Refactor pass |

**Total R_phase**: 14.3
**Bugs originated here**: 4 (3 caught elsewhere, 1 caught here)
**Stagnation events**: 1 (resolved by scope_guard breaker)
**Shift-left effectiveness**: 1/4 bugs caught in-phase (25% — room for improvement)
```

### --bugs Expanded Mode

When `--bugs` is provided, list each bug with reward attribution:

```markdown
### Bug Detail Report

| Bug | Severity | Found In | Origin | Should Caught | Shift-Left | R_impact | Status |
|-----|----------|----------|--------|---------------|------------|----------|--------|
| BUG-001 | P1 | test-browser | backend | test-api | ✗ late | -7.5 | fixed |
| BUG-002 | P2 | frontend | frontend | frontend | ✓ in-phase | -5.0 | fixed |
| BUG-003 | P1 | test-api | backend | backend | ✓ shift-left | -4.5 | fixed |
| BUG-004 | P0 | production | integrate | test-browser | ✗ ESCAPED | -500.0 | open |
```
