---
description: Persistent verify/fix loop until implementation passes — the boulder never stops
---

# /ouroboros:ralph

Persistent self-referential loop until verification passes. "The boulder never stops."

## Usage

```
/ouroboros:ralph "<request>"
```

**Trigger keywords:** "ralph", "don't stop", "must complete", "until it works", "keep going"

---

## Instructions

### Step 1: Parse Request

Extract what needs to be done from the user's request. Identify:
- **Goal**: What should be achieved
- **Verification criteria**: How to check if it's done (tests pass, build succeeds, etc.)
- **Seed reference**: If a seed exists, use its acceptance criteria

### Step 2: Initialize State

Create `.claude-project/status/ouroboros/ralph/{session_id}.json`:

```json
{
  "id": "ralph-{uuid}",
  "request": "{user request}",
  "status": "running",
  "iteration": 0,
  "max_iterations": 10,
  "started_at": "{timestamp}",
  "seed_id": "{seed_id or null}",
  "verification_history": []
}
```

Create the directory if it doesn't exist.

### Step 3: Enter the Loop

For each iteration:

#### 3a. Execute
- Work on the request (write code, fix bugs, implement features)
- Use parallel agents via Task tool when tasks are independent
- Apply seed constraints if available

#### 3b. Verify
Run verification checks:
- **Build**: Does it compile/build?
- **Tests**: Do all tests pass?
- **Lint**: Any lint errors?
- **Seed AC**: If seed exists, check each acceptance criterion

Calculate verification score (0.0-1.0):
```
score = (checks_passed / total_checks)
```

#### 3c. Record

```json
{
  "iteration": 1,
  "passed": false,
  "score": 0.65,
  "issues": ["3 tests failing", "type error in webhook.ts"],
  "timestamp": "{iso_date}"
}
```

#### 3d. Report Progress

```
[Ralph Iteration {i}/{max}]
Execution complete. Verifying...

Verification: {PASSED/FAILED}
Score: {score}
Issues:
- {issue 1}
- {issue 2}

The boulder never stops. Continuing...
```

#### 3e. Check Exit Conditions

- **PASS** (score = 1.0 or all checks pass): Break, report success
- **MAX ITERATIONS** (iteration ≥ max): Break, report incomplete
- **USER STOP** (user says "stop"): Save checkpoint, exit gracefully
- Otherwise: Analyze failures, fix, continue to next iteration

### Step 4: Completion Report

```
Ralph {COMPLETE/INCOMPLETE}
===========================
Request: {original request}
Iterations: {count}/{max}

Verification History:
- Iteration 1: FAILED (0.65) — 3 tests failing
- Iteration 2: FAILED (0.85) — 1 edge case
- Iteration 3: PASSED (1.0)

{Summary of what was done}
```

### Step 5: Update State

Mark session as completed or incomplete in the state file.

---

## Stagnation Detection

If the same score repeats 3 times (SPINNING pattern), automatically:
1. Report stagnation detected
2. Suggest `/ouroboros:unstuck` for lateral thinking
3. Try a different approach before next iteration

If score oscillates A→B→A→B (OSCILLATION pattern):
1. Report oscillation detected
2. Load `ouroboros-architect.md` persona for structural analysis
3. Propose restructuring before continuing

---

## Interruption Handling

- **"stop ralph"**: Save checkpoint, exit. Resume with "continue ralph"
- **"ralph continue"**: Load last checkpoint, resume from last iteration
- **Session restart**: State persists in `.claude-project/status/ouroboros/ralph/`

---

## Example

```
User: /ouroboros:ralph fix all failing tests

[Ralph Iteration 1/10]
Running tests... 15 total, 12 passing, 3 failing.
Analyzing failures...
Fixing auth middleware test...
Fixing webhook retry test...
Fixing rate limiter test...

Verification: FAILED
Score: 0.87
Issues:
- Rate limiter test: edge case with concurrent requests

The boulder never stops. Continuing...

[Ralph Iteration 2/10]
Fixing rate limiter concurrent edge case...
Adding mutex for shared counter...

Verification: PASSED
Score: 1.0

Ralph COMPLETE
==============
Request: Fix all failing tests
Iterations: 2/10

Verification History:
- Iteration 1: FAILED (0.87)
- Iteration 2: PASSED (1.0)

All 15 tests passing. Build successful.
```
