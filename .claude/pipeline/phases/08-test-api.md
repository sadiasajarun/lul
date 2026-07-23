# Phase 8: Test API (Smoke + Backend Tests)

Phase 8 verifies that all routes load and backend API tests pass. It has three steps: smoke test all routes, execute backend tests, and fix failures. Frontend browser testing happens in Phase 9 (test-browser) via YAML user stories.

**Key distinction:**
- **Smoke test** visits every route via playwright-cli, catches runtime errors
- Backend API tests were already **generated** in Phase 5b — executed here
- Frontend is tested in Phase 9 via YAML user stories (NOT Playwright .spec.ts)

## Prerequisites

- Phase 7 (integrate) complete

## Execution

### Step 1: Smoke Test (BLOCKING)

```
1. Prerequisite check:
   a. Load and execute: .claude/skills/dev/ensure-servers/SKILL.md
      - Reads ports from ecosystem.config.js
      - Kills stale processes (pm2, lsof)
      - Verifies frontend .env.local matches backend port
      - Starts servers via PM2
      - Health-checks both servers
      - Produces: BACKEND_PORT, FRONTEND_PORT, BACKEND_URL, FRONTEND_URL
   b. Verify playwright-cli installed: playwright-cli --help

2. Load skill: .claude/skills/qa/test-smoke/SKILL.md

3. Read route manifest: .claude-project/routes.yaml

4. Execute smoke test against all routes:
   a. Public routes: visit directly, check for errors
   b. Auth-required routes: login as test user first, then visit
   c. Admin-required routes: login as admin first, then visit

5. For each route, verify:
   - Page loads (no timeout, no white screen)
   - No console errors (TypeError, ReferenceError, uncaught exceptions)
   - No unexpected network errors (401 on public route, 500, etc.)
   - Content renders (root element has visible children)

6. Generate SMOKE_TEST_STATUS.md

7. Quality gate:
   - ALL public routes must load without errors
   - ALL auth routes must load after authentication
   - ALL admin routes must load with admin credentials
   - Pass threshold: 100% of routes load, 0 console errors

8. If smoke test FAILS:
   - Log failing routes with error details and fix suggestions
   - These are BLOCKING — fix before proceeding
   - Common fixes:
     | Failure | Typical Fix |
     |---------|-------------|
     | 401 on public route | Add/verify @Public() decorator on controller |
     | White screen | Fix missing import or component crash |
     | Console TypeError | Fix null reference in component |
     | Network 500 | Fix backend service/controller error |
     | Login redirect on public page | Check ProtectedLayout routeAccess map and routes/protected.routes.ts |
```

### Step 2: Execute Backend API Tests

```
1. Start test environment:
   a. Ensure servers running via ensure-servers skill (if not already from Step 1)
   b. Backend: use test database (clean state)

2. Run backend API tests:
   Command: cd backend && npm run test:e2e
   Framework: Jest + Supertest
   Result: collect pass/fail counts

3. Run 3 consecutive times to detect flaky tests:
   If a test passes sometimes and fails sometimes -> mark as flaky
   Flaky tests count as failures until fixed
```

### Step 3: Fix Failures (Iteration Loop)

```
1. Categorize failures:

   | Failure Type | Fix Strategy |
   |-------------|-------------|
   | Backend test fails | Fix API logic or fix test |
   | Flaky test | Add retries or fix race condition |
   | Environment issue | Fix test setup/teardown |

2. For each failing backend test:
   - Read test + controller + service
   - Determine: is the test wrong or is the code wrong?
   - Fix and re-run
   - Exit when: all backend tests pass

3. Final verification:
   - Run ALL backend tests together
   - Must pass 3/3 consecutive runs
   - If still failing after 5 iterations -> escalate to user
```

## Quality Gate

```yaml
gate: smoke_pass AND backend_tests_pass AND no_flaky
checks:
  - smoke_test_pass: "All routes load without runtime errors?"
  - backend_tests_pass: "All backend API e2e tests pass?"
  - no_flaky_tests: "Tests pass 3/3 consecutive runs?"
  - test_count_adequate: "At least 1 test per backend endpoint?"

scoring:
  # CRITICAL: Compiled-only tests DO NOT count as passing
  execution_status:
    executed_and_passed: 1.0
    executed_and_failed: 0.0
    compiled_but_not_run: 0.0
    not_compiled: 0.0

  smoke_score = routes_passed / total_routes
  backend_score = backend_tests_passed / backend_tests_total * stability_factor
  stability_factor = 1.0 if 3/3 pass, 0.8 if 2/3 pass, 0.5 if 1/3 pass

  # Weighted composite
  test_api_score = (smoke_score * 0.4) + (backend_score * 0.6)

  # Hard cap: if tests only compiled but never executed, score caps at 0.50
  IF no_tests_actually_executed:
    test_api_score = min(test_api_score, 0.50)
```

## Loop Integration

- **Command**: `fullstack {project} --phase test-api --loop`
- **When**: If smoke test fails or backend tests fail
- **Skills**:
  - Smoke test: `.claude/skills/qa/test-smoke/SKILL.md`
  - Backend E2E: `.claude/$BACKEND/guides/workflow-generate-e2e-tests.md`

---

## Phase Completion — Status Update

**Status updates are handled AUTOMATICALLY by the gate script (`_gate-runner.sh`).**

When the blueprint's `gate` deterministic node runs `bash gates/test-api-gate.sh`, the gate-runner:
- Updates Progress Table (Status, Score, Output, Gate Run At)
- Updates Gate Results section with check details
- Writes gate proof file to `.gate-proofs/test-api.proof`
- Appends to Execution Log
- Updates `last_run` and `pipeline_score` in Config

The blueprint's `verify-gate-proof` node confirms the gate ran. **No manual status updates needed.**
