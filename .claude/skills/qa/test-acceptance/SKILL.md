---
name: acceptance-test
description: Iterative acceptance test loop — runs user stories via ui-review skill, diagnoses failures, fixes stories or app code, re-runs until converged.
tags: [qa, acceptance, user-stories, playwright, iteration]
---

# Acceptance Test Loop

Iterative acceptance testing skill. Runs user story YAML files via the ui-review skill (playwright-qa-agent), analyzes failures, fixes either the stories or the app, and re-runs until the pass rate converges.

```
Run stories → Analyze failures → Fix → Re-run → Converge
```

---

## When to Use

- Phase 9 of the fullstack pipeline (after smoke test passes)
- Standalone via `fullstack {project} --phase test-browser --loop`
- After regenerating user stories from PRD
- After making frontend/backend changes that affect user flows

---

## Prerequisites

1. User story YAML files exist: `.claude-project/user_stories/*.yaml`
2. Frontend and backend servers running (use `ensure-servers` skill if needed)
3. Smoke test passed (all routes load without crash)

---

## Inputs

| Input | Path | Purpose |
|-------|------|---------|
| User Stories | `.claude-project/user_stories/*.yaml` | YAML story files to test |
| Status File | `.claude-project/status/{project}/ACCEPTANCE_TEST_STATUS.md` | Track per-story pass/fail across iterations |
| Fixtures | `.claude-project/user_stories/_fixtures.yaml` | Test credentials (optional) |

---

## Iteration Algorithm

### Step 1: Setup

1. **Ensure servers running**
   - Load `.claude/skills/dev/ensure-servers/SKILL.md`
   - Capture `FRONTEND_URL` and `BACKEND_URL`
   - If servers fail to start: EXIT with status "blocked"

2. **Discover stories**
   - Glob: `.claude-project/user_stories/*.yaml`
   - Parse all stories into flat list
   - Count total stories

3. **Load or create status file**
   - Path: `.claude-project/status/{project}/ACCEPTANCE_TEST_STATUS.md`
   - If exists: read current state (which stories passed/failed in previous iterations)
   - If not exists: create from template (all stories as "Pending")

### Step 2: Run Acceptance Tests

**First iteration**: Run ALL stories.
```
Load ui-review skill: .claude/skills/qa/review-ui/SKILL.md
```

**Subsequent iterations** (`--incremental`): Run only stories from files that had failures.
```
Load ui-review skill with filename_filter = {failed-file-filter}
```

The ui-review skill spawns one `playwright-qa-agent` per story in parallel. Wait for all agents to complete.

### Step 3: Collect Results

Parse the ui-review aggregate report. For each story, extract:
- **STATUS**: PASS, FAIL, or CRASH
- **Steps**: total/passed/failed/crashed/skipped
- **FAILURE_DETAILS**: Which step failed/crashed and why
- **Screenshots**: Path to screenshot evidence

**CRITICAL**: CRASH stories must be tracked separately. They indicate the test environment is broken (session died, timeout, auth loop), NOT that the story is wrong. Do NOT count CRASH as PASS.

### Step 4: Update Status File

Update `.claude-project/status/{project}/ACCEPTANCE_TEST_STATUS.md`:

```markdown
# Acceptance Test Status - {project}

## Summary

| Iteration | Total | Passed | Failed | Crashed | Blocked | Pass Rate | Date |
|-----------|-------|--------|--------|---------|---------|-----------|------|
| 1         | 38    | 22     | 8      | 5       | 3       | 73.3%*    | ...  |
| 2         | 13    | 9      | 2      | 2       | 0       | 86.1%**   | ...  |

*Pass rate = passed / (total - blocked). Crashed stories count as FAIL, not PASS.
**Cumulative: (31 passed) / (38 - 3 blocked) = 88.6%

## Story Tracking

| Story | Source File | Status | Failed Step | Fix Type | Iterations |
|-------|-----------|--------|-------------|----------|------------|
| Home page loads | home.yaml | :white_check_mark: | - | - | 1 |
| Login validation | login.yaml | :white_check_mark: | - | story | 2 |
| Cart page loads | cart.yaml | :x: | Step 3 | - | 2 |
| Vehicle tab cascade | tire-search.yaml | :boom: | Step 2 (CRASH) | crash | 1 |

## Failure Log

### Iteration 1
- **Cart page loads** (cart.yaml): Step 3 — "Verify total amount section is visible" — element not found. Screenshot: runs/20260304/cart-page/02_verify.png
```

### Step 5: Analyze and Fix Failures

For each FAILED story:

#### 5a. Read Context

1. Read the failure details from the agent report
2. Read the screenshot (if available) to see the actual page state
3. Read the story YAML file (the workflow that was executed)
4. Read the app source code for the target page (React component)

#### 5b. Classify Failure

| Classification | Signals | Action |
|----------------|---------|--------|
| **Story bug** | Wrong element description, wrong expected text, missing wait, wrong URL path, element renamed | Fix the YAML story file |
| **App bug** | Element genuinely missing, API returns error, page crashes, wrong behavior, missing feature | Fix frontend/backend source |
| **Data bug** | Empty list (no seed data), auth fails (wrong credentials), missing API response | Fix seed data or fixtures |
| **Flaky** | Passes sometimes, timing-dependent, animation interferes | Add `Wait for` step to story |
| **Crash** | Session died, snapshot timeout, auth infinite loop, browser unresponsive | Fix app bug first (crash is always an app/infra bug, never a story bug) |

**Classification heuristic:**
1. If STATUS is CRASH → always **crash** (app/infra bug — fix the root cause before re-running)
2. If the screenshot shows the page loaded correctly but the element name doesn't match → **story bug**
3. If the screenshot shows an error, crash, or blank page → **app bug**
4. If the screenshot shows "no data" or empty state → **data bug**
5. If the story passed in a previous iteration but fails now → **flaky** (add wait)

#### 5c. Apply Fix

**Story bug fix:**
- Edit the YAML file directly
- Fix the workflow step that failed (update element description, add missing wait, fix URL)
- Use canonical verbs from `generate-user-stories/SKILL.md`
- Do NOT add login steps — use `auth` field

**App bug fix:**
- Read the React component for the target page
- Identify the missing/broken element
- Fix the component (add missing element, fix API call, fix rendering)
- If backend issue: read the controller/service and fix

**Data bug fix:**
- Check if fixtures file exists at `.claude-project/user_stories/_fixtures.yaml`
- If credentials wrong: update fixtures
- If seed data missing: note in status file as "needs seed data"

#### 5d. Mark Fixed

Update the story's status in the status file:
- `Fix Type`: "story" | "app" | "data" | "flaky"
- `Status`: `:clipboard:` (pending re-test)

### Step 6: Check Exit Conditions

```
pass_rate = total_passed / (total_stories - blocked_stories)
# CRASHED stories count as FAIL — they are NOT excluded from the denominator
# Only BLOCKED stories (missing seed data) are excluded

CONVERGENCE: pass_rate >= 0.95
  → EXIT with "converged"
  → Report final pass rate and remaining failures

STAGNATION: pass_rate unchanged for 3 consecutive iterations
  → EXIT with "stagnation"
  → Report: "Pass rate stalled at {rate}% for 3 iterations"
  → List remaining failures with classification

MAX ITERATIONS: iteration >= 10
  → EXIT with "max_iterations"
  → Report final state

ZERO PROGRESS: iteration >= 3 AND pass_rate == 0
  → EXIT with "no_progress"
  → Likely a fundamental issue (servers down, auth broken)
```

### Step 7: Report Iteration

Output after each iteration:

```
Acceptance Test — Iteration {N}
================================
Pass rate: {passed}/{total - blocked} ({rate}%)
  Passed: {n}  |  Failed: {n}  |  Crashed: {n}  |  Blocked: {n}
  Story fixes: {n}
  App fixes: {n}
  Crash fixes: {n}
  Data fixes: {n}

Crashed stories (environment/app issue — fix before re-running):
  - {story_name} ({file}): {crash_reason}

Remaining failures:
  - {story_name} ({file}): {failure_reason}

Status: {CONTINUING | CONVERGED | STAGNATED | MAX_ITERATIONS}
```

### Step 8: Loop or Exit

If not converged/stagnated/maxed: go to Step 2 with `--incremental`.

When exiting, output the completion promise:
```
<promise>ACCEPTANCE_TEST_COMPLETE</promise>
```

---

## Fix Priority

When multiple stories fail, fix in this order:

1. **Shared failures first**: If multiple stories fail on the same page/component, fix the component once (app bug)
2. **Story bugs before app bugs**: Story fixes are cheaper and faster
3. **Auth stories before feature stories**: Login failures cascade to all `auth: user` and `auth: admin` stories
4. **Smoke-level failures before interaction failures**: Page-not-loading blocks all interaction tests

---

## Scope Guard

- May edit: `.claude-project/user_stories/*.yaml` (fix stories)
- May edit: `frontend/app/` (fix app bugs found by stories)
- May edit: `backend/src/` (fix API bugs found by stories)
- May edit: `.claude-project/user_stories/_fixtures.yaml` (fix test data)
- Do NOT: Add new features — only fix what exists
- Do NOT: Modify test infrastructure (ui-review skill, `playwright-qa-agent`)
- Do NOT: Change database schema

---

## Error Handling

| Error | Action |
|-------|--------|
| No YAML story files found | EXIT — run `generate-user-stories` skill first |
| Servers not running | Run `ensure-servers` skill, retry once, then EXIT |
| All stories fail iteration 1 | Check servers, check auth — likely fundamental issue |
| ui-review agent timeout | Mark story as FAIL with "timeout", continue |
| Same story fails 3+ iterations | Move to "Needs Manual Review", skip in future iterations |

---

## Related

- **Story generation**: `.claude/skills/dev/generate-user-stories/SKILL.md`
- **Story execution**: `.claude/skills/qa/review-ui/SKILL.md`
- **Agent protocol**: `.claude/agents/playwright-qa-agent.md`
- **Pipeline orchestrator**: `.claude/commands/fullstack.md`
- **Smoke test**: `.claude/skills/qa/test-smoke/SKILL.md`
- **Ensure servers**: `.claude/skills/dev/ensure-servers/SKILL.md`
