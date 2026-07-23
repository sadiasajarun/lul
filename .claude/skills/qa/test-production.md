---
description: Production-ready test loop — comprehensive bug detection with chaos testing, boundary fuzzing, bug prediction, and pre-flight verification
argument-hint: "<project> [--deep] [--mode development|production] [--quality 0.97] [--path <dir>] [--frontend <name>]"
---

# Production Test Command

Comprehensive bug detection loop before production release.

## Invocation Modes

| Flag | Behavior |
|------|----------|
| *(none)* | **Default** — delegates to `test-story-runner` skill (preflight + acceptance specs + report). Fast, honest. |
| `--deep` | Runs the full 3-Tier structure below: chaos, fuzz, exploration, UX audit, production layers. |
| `--mode production` | Implies `--deep` plus production SLO enforcement from PRD NFR. |

If invoked without `--deep` and not in `--mode production`, this command simply calls the `test-story-runner` skill and exits on its `STORY_TEST_COMPLETE` promise. The rest of this document describes `--deep` behavior.

---

## Deep Mode — 3-Tier Structure

Uses a 3-Tier structure to sequentially verify code-level, browser, and production layers. Provides significantly enhanced bug detection over the basic looptest through chaos scenarios, boundary value fuzzing, and bug prediction reverse search.

```
/production-test my-project
/production-test tirebank --path /Users/me/projects/tirebank --frontend frontend-admin-dashboard
```

---

## Hard Rules (Must Never Be Violated)

1. **Find bugs effectively** — Never degrade detection quality. Visit every route at least once. Never skip chaos scenarios.
2. **Story First, Fix Second** — Bugs must be recorded in user stories before code fixes.
3. **No skips** — Execute all sub-phases, visit all routes, generate all 8 marker files.
4. **Infrastructure caching allowed** — Seed/server checks that passed once can be cached.
5. **Fix → Re-test required** — Any area with code changes must be re-tested.
6. **PRD NFR is the Source of Truth for SLOs** — Performance/security/accessibility criteria are extracted from PRD NFR. Use defaults if absent.
7. **Pre-flight failure = No browser testing** — Tier 1 must pass before Tier 2 begins.

---

## Execution Modes

| Mode | Tiers | Default Score Target | When Used |
|------|-------|---------------------|-----------|
| development | Tier 1 + Tier 2 | 0.95 | Phase 9 single run (`--run`), `--loop` iteration 1 |
| production | Tier 1 + Tier 2 + Tier 3 | 0.97 | `--loop` iteration 2+, explicit `--mode production` |

In **development** mode:
- Tier 3 (production layers) is SKIPPED
- PRODUCTION_LAYERS_STATUS.md is written with `Status: Skipped (development mode)`
- Score uses `browser_score` only (6-weight formula from Tier 2)
- Hard gates: `preflight_pass` + `chaos_resilient` only

In **production** mode:
- All 3 tiers execute
- Full 7-component weighted scoring formula
- All hard gates enforced (preflight, chaos, security, accessibility, ship)

---

## Prerequisites

- Phase 8 (test-api) complete
- Phase 3.5 (user-stories) complete
- User story YAML files exist: `.claude-project/user_stories/*.yaml`

---

## Loop Algorithm

```
project = $1
target = --quality (default: 0.97)
TARGET_DIR = --path (default: cwd)
$FRONTEND = --frontend (default: tech_stack.frontends[0])

iteration = 1
last_score = 0

WHILE true:  # Loop indefinitely until the user asks to stop

  1. DETERMINE EXECUTION MODE
     IF --mode == development:
       → tier_limit = 2, target = --quality (default: 0.95)
     ELSE IF --mode == production OR iteration >= 2:
       → tier_limit = 3, target = --quality (default: 0.97)

     IF iteration == 1 OR ITERATION_CHECKPOINT.yaml does not exist:
       → mode = FULL
     ELSE IF Safety Fallback triggered (see Safety Fallback section):
       → mode = FULL
     ELSE:
       → mode = INCREMENTAL

  2. IF mode == INCREMENTAL:
       → Run Step 0: Change Detection (build CHANGE_MANIFEST.yaml)

  3. TIER 1: PRE-FLIGHT
     Run each pre-flight check:
       PF-1 (tsc) → PF-2 (eslint) → PF-3 (build) → PF-4 (unit) → PF-5 (api) → PF-6 (audit)
     ANY failure → fix immediately, re-run (max 3 retries)
     ALL pass → write PREFLIGHT_STATUS.md → proceed to Tier 2
     INCREMENTAL: only run checks affected by code changes

  4. TIER 2: BROWSER TESTING
     Run each sub-phase according to mode:
       9-pre → 9a → 9b-deepen → 9b → 9c-chaos → 9c → 9c-fuzz → 9c-monkey → 9d → 9d-predict → 9e
     (See Sub-Phase Rules below)

  5. TIER 3: PRODUCTION LAYERS
     IF tier_limit < 3:
       → Write PRODUCTION_LAYERS_STATUS.md with "Status: Skipped (development mode)"
       → Skip to step 6

     PL-0 (PRD NFR extraction) → PL-1 (security) → PL-2 (performance) → PL-3 (accessibility) → PL-4 (viewport) → PL-5 (data) → PL-6 (config)
     PL failures → generate bug reports, feed into 9d in next iteration
     Write PRODUCTION_LAYERS_STATUS.md

  6. QUALITY GATE
     Check Hard Gates (boolean)
     Calculate production_score (weighted components)
     Write all 8 marker files

  7. WRITE ITERATION_CHECKPOINT.yaml
     Record complete state for next iteration

  8. CHECK EXIT CONDITIONS
     a. USER STOP: User requests to stop
        → Complete only the currently in-progress bug fix
        → Write ITERATION_CHECKPOINT.yaml after fix completion
        → Output Summary (see Exit Summary section below)
        → EXIT
     b. CONVERGED: score >= target
        → Do NOT stop. Only report to user:
          "Score {S} reached target {target}. Continuing to find more bugs."
        → Continue execution (deeper bug search)

     ⚠️ Never stop until the user explicitly asks.
     Do not auto-stop for stagnation, max iterations, etc.

  9. PREPARE NEXT ITERATION
     last_score = score
     iteration += 1

END WHILE
```

---

## Step 0: Change Detection (INCREMENTAL mode only)

Before Tier 1, build CHANGE_MANIFEST.yaml:

```
1. Read ITERATION_CHECKPOINT.yaml → previous git_sha
2. Run: git diff --name-only {previous_sha}..HEAD
3. Map changed files to routes:
   a. frontend/app/pages/{PageName}.tsx → route from routes.yaml
   b. frontend/app/components/{Name}.tsx → grep which pages import it → those routes
   c. backend/src/** → backend_changed=true (conservative: ALL routes affected)
   d. backend/src/database/migrations/** → db_migration_changed=true
   e. .claude-project/user_stories/*.yaml → changed_stories
   f. FALLBACK: unmappable file → add ALL routes to full_retest

4. Compute full_retest_routes = UNION of:
   a. changed_routes (from git diff)
   b. checkpoint.exploration.bug_routes
   c. Routes of FAIL/CRASH stories from checkpoint
   d. checkpoint.ux_scanner.issue_routes (P0/P1)
   e. checkpoint.chaos.fail_routes (chaos failure routes)
   f. IF backend_changed → ALL routes

5. spot_check_routes = all_routes - full_retest_routes
6. Write CHANGE_MANIFEST.yaml
```

**CHANGE_MANIFEST.yaml schema:**

```yaml
iteration: 4
previous_sha: "abc123def"
current_sha: "def456ghi"

changed_files:
  - frontend/app/pages/Cart.tsx
  - backend/src/modules/orders/orders.controller.ts

derived:
  changed_routes: ["/cart", "/checkout"]
  changed_components:
    "/cart": ["frontend/app/pages/Cart.tsx"]
  changed_stories: ["cart.yaml"]
  backend_changed: true
  db_migration_changed: false
  package_json_changed: false

retest_required:
  full_retest_routes: ["/cart", "/checkout"]
  spot_check_routes: ["/home", "/products", "/login"]
  chaos_retest_routes: ["/cart", "/checkout"]  # chaos re-test targets
```

---

## Tier 1: Pre-Flight Rules

Pre-flight detects bugs at the code level without a browser. All checks must pass before proceeding to Tier 2.

### PF-1: TypeScript Compilation

```
frontend: cd $FRONTEND && npx tsc --noEmit
backend: cd backend && npx tsc --noEmit

INCREMENTAL: run only when code has changed
PASS: zero errors
FAIL: → fix errors → re-run (max 3)
```

### PF-2: ESLint

```
frontend: cd $FRONTEND && npx eslint src/ --quiet --max-warnings 0
backend: cd backend && npx eslint src/ --quiet --max-warnings 0

INCREMENTAL: run only when code has changed
PASS: zero errors (warnings allowed)
FAIL: → fix errors → re-run (max 3)
```

### PF-3: Production Build

```
frontend: cd $FRONTEND && npm run build
backend: cd backend && npm run build

INCREMENTAL: run only when code has changed
PASS: build succeeds with no errors
FAIL: → fix build errors → re-run (max 3)
Record bundle size: extract from build output → used in performance_score
```

### PF-4: Unit Tests

```
backend: cd backend && npx jest --selectProjects unit --forceExit
(or npm test -- --forceExit)

INCREMENTAL: run only when backend code has changed
PASS: all tests pass
FAIL: → fix tests or code → re-run (max 3)
```

### PF-5: API Tests (3x Stability)

```
backend: cd backend && npm run test:e2e (3 consecutive runs)

INCREMENTAL: run only when backend code has changed
PASS: 3/3 identical results (no flaky)
FAIL: → fix flaky tests → re-run (max 3)
```

### PF-6: Dependency Audit

```
frontend: cd $FRONTEND && npm audit --audit-level=high
backend: cd backend && npm audit --audit-level=high

INCREMENTAL: run only when package.json or package-lock.json has changed
PASS: zero HIGH or CRITICAL vulnerabilities
FAIL: → npm audit fix or manual resolution → re-run (max 3)
```

### Pre-Flight Marker: PREFLIGHT_STATUS.md

```markdown
# Pre-Flight Status — Iteration {N}
Date: {timestamp}

| Check | Result | Detail |
|-------|--------|--------|
| PF-1 tsc frontend | ✅ PASS | 0 errors |
| PF-1 tsc backend | ✅ PASS | 0 errors |
| PF-2 eslint frontend | ✅ PASS | 0 errors, 12 warnings |
| PF-2 eslint backend | ✅ PASS | 0 errors |
| PF-3 build frontend | ✅ PASS | bundle: 342KB gzipped |
| PF-3 build backend | ✅ PASS | compiled successfully |
| PF-4 unit tests | ✅ PASS | 45/45 passed |
| PF-5 api tests | ✅ PASS | 23/23 passed, 3/3 stable |
| PF-6 audit frontend | ✅ PASS | 0 high, 2 moderate |
| PF-6 audit backend | ✅ PASS | 0 high, 0 moderate |

**Overall: ALL PASS** → Proceed to Tier 2
```

---

## Tier 2: Sub-Phase Rules

### 9-pre (Seed/Servers)

| Mode | Behavior |
|------|----------|
| FULL | Full seed verification + server startup (same logic as current 09-test-browser.md) |
| INCREMENTAL | `checkpoint.seed.verified == true AND db_migration_changed == false` → health check only (~2 sec). Otherwise → FULL |

Always generate SEED_STATUS.md (may indicate cached).

### 9a (Design QA)

| Mode | Behavior |
|------|----------|
| FULL | Screenshot + HTML comparison for all pages |
| INCREMENTAL | Re-screenshot only `full_retest_routes` pages + pages with fidelity < 0.95. Cache the rest. |

```
pages_to_retest = []
For each page:
  IF page.route in full_retest_routes → retest (code change/bug)
  ELSE IF checkpoint fidelity < 0.95 → retest (low quality)
  ELSE → cached score

DESIGN_QA_STATUS.md: record all pages (re-tested + cached indicated)
average_fidelity: based on all pages (cached + fresh)
```

### 9b-deepen (Story Enrichment)

| Mode | Behavior |
|------|----------|
| FULL | Same as current logic (execute if gap_score >= 0.05, skip if < 0.05) |
| INCREMENTAL | Same (no change) |

### 9b (Acceptance Testing)

| Mode | Behavior |
|------|----------|
| FULL | Execute all YAML stories |
| INCREMENTAL | Selective execution (rules below) |

```
stories_to_run = []

For each story:
  IF checkpoint result in [FAIL, CRASH]     → MUST re-run (previously failed)
  ELSE IF story.file in changed_stories     → MUST re-run (story definition changed)
  ELSE IF story is new (created by 9b-deepen/9d) → MUST re-run (new)
  ELSE IF related_files in changed_files    → MUST re-run (component code changed)
  ELSE IF backend_changed AND uses API      → MUST re-run (backend changed)
  ELSE IF checkpoint result == PASS         → add to spot_check_pool

spot_check = random 10% of spot_check_pool (minimum 1)
stories_to_run += spot_check

Remaining PASS stories → retain cached result

⚠️ REGRESSION ALERT:
  If spot check finds FAIL (previously PASS → now FAIL):
    → P0 regression warning
    → Immediately re-queue all stories from that YAML file (same iteration)

E2E_QA_STATUS.md: record all stories
  - Re-tested: fresh result
  - Cached: "PASS (cached from iteration {N-1})"
  - Spot check: "PASS (spot-check ✓)" or "FAIL (regression!)"
pass_rate: based on all stories (cached + fresh, excluding BLOCKED)
```

### ★ 9c-chaos (Chaos Scenario Testing) [NEW]

Executes 7 chaos scenarios across all major routes to detect bugs under abnormal conditions.

| Mode | Behavior |
|------|----------|
| FULL | All routes × 7 chaos scenarios |
| INCREMENTAL | `chaos_retest_routes` × 7 + re-run previously FAILed scenarios. Cache the rest. |

```
For each route in target_routes:
  For each chaos scenario C-1..C-7:

    C-1 (Empty State):
      1. page.route('**/api/**', → { status: 200, body: '[]' or '{}' })
      2. Visit page
      3. Verify: pageerror == 0 AND not blank screen AND no error text
      → Catches: undefined access, .map(null), missing conditional rendering

    C-2 (API Failure):
      failure_modes = [500, timeout(30s), abort('connectionrefused'), malformed_json]
      For each failure_mode:
        1. page.route('**/api/**', → inject failure_mode)
        2. Visit page
        3. Verify: pageerror == 0 AND error UI displayed AND no raw error text
      → Catches: unhandled rejection, infinite loading, UI freeze

    C-3 (Token Expiry):
      1. Login normally, then visit authenticated page
      2. page.route('**/api/**', → { status: 401, body: 'token expired' })
      3. Attempt interaction (button click, page navigation)
      4. Verify: login redirect OR re-auth modal OR alert displayed
      → Catches: data loss, infinite redirect, partial rendering

    C-4 (Storage Nuke):
      1. Visit page and confirm normal load
      2. page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); })
      3. Navigate (click a link)
      4. Verify: pageerror == 0 AND page loads
      → Catches: storage-dependent crashes

    C-5 (Double Submit):
      1. Visit a page with a form
      2. Fill form, then dblclick() the submit button
      3. Verify: button disabled or duplicate prevention OR success message appears only once
      → Catches: duplicate data creation, duplicate API calls

    C-6 (Back/Forward):
      1. Navigate from page A → page B
      2. page.goBack()
      3. page.goForward()
      4. Verify: pageerror == 0 AND content rendered (body > 100 chars)
      → Catches: SPA routing bugs, stale data, broken state

    C-7 (Slow Network):
      1. CDP Network.emulateNetworkConditions(500kbps, 400ms latency)
      2. Visit page (timeout 60s)
      3. Verify: loading skeleton or spinner displayed AND not blank screen
      → Catches: missing loading state, unhandled timeout

Pass/Fail criteria:
  PASS: graceful degradation (error message, redirect, loading state)
  FAIL: JS crash (pageerror), blank screen, infinite spinner, raw error text
  P0: pageerror + crash = immediately forward to 9d
  P1: blank screen without error UI = forward to 9d

Generate CHAOS_TEST_STATUS.md:
  Route × scenario PASS/FAIL matrix
  chaos_score = pass count / total count
```

### 9c (Autonomous Exploration)

| Mode | Behavior |
|------|----------|
| FULL | Full exploration of all routes (20 actions/page) |
| INCREMENTAL | full_retest_routes → FULL. Rest → LIGHT (5 actions). |

```
For each route:
  IF route in full_retest_routes:
    → FULL: 20 actions, all interactive elements, edge inputs, console monitoring
  ELSE IF route in bug_predict_high_risk (forwarded from 9d-predict):
    → DEEP: 40 actions, deeper exploration (routes containing high-risk files)
  ELSE:
    → LIGHT: navigate + snapshot + console check + 5 actions
    → P0 checks still performed (ErrorBoundary crash, 100+ console errors)
    → click primary CTA

⚠️ Every route visited at least once. No skips.

EXPLORATION_REPORT.md: record all routes
  - FULL: complete bug report
  - DEEP: complete bug report + "high-risk prediction" tag
  - LIGHT: "light-touch: navigated, {N} console errors, no crash"
```

### ★ 9c-fuzz (Boundary Value Fuzzing) [NEW]

Inputs boundary value data into all input fields across routes to detect crashes and security vulnerabilities.

| Mode | Behavior |
|------|----------|
| FULL | All input fields on all routes |
| INCREMENTAL | Input fields on `full_retest_routes` only. Cache the rest. |

```
fuzz_payloads = [
  { name: "empty", value: "" },
  { name: "long", value: "a".repeat(10000) },
  { name: "xss", value: "<script>alert(1)</script>" },
  { name: "xss-img", value: "<img onerror=alert(1) src=x>" },
  { name: "sqli", value: "'; DROP TABLE users;--" },
  { name: "unicode", value: "🎉مرحبا你好" },
  { name: "special", value: "null undefined NaN [object Object]" },
  { name: "number-edge", values: ["0", "-1", "9007199254740991", "NaN", "Infinity"] },
  { name: "date-edge", values: ["2038-01-19", "1970-01-01", "2023-02-29", "9999-12-31"] },
]

For each route:
  1. Playwright snapshot → detect all input/textarea/select elements
  2. For each input field:
     For each payload:
       a. Enter payload into field
       b. Submit form if possible
       c. Verify:
          - pageerror == 0 (no crash)
          - XSS payload not rendered as HTML (no <script> in innerHTML)
          - Validation error message displayed (for empty input)
  3. Aggregate results into EXPLORATION_REPORT.md

⚠️ XSS payload rendered as HTML = immediate P0 security bug
```

### ★ 9c-monkey (Gremlin Testing) [NEW]

Detects unexpected crashes through random interactions.

| Mode | Behavior |
|------|----------|
| FULL | All routes, 30 seconds each |
| INCREMENTAL | `full_retest_routes` only, 30 seconds each. Skip the rest. |

```
For each target route:
  1. Visit page
  2. Inject gremlins.js CDN (addScriptTag)
     URL: https://unpkg.com/gremlins.js
  3. Run for 30 seconds:
     - clicker: random clicks
     - toucher: random touches
     - formFiller: random form input
     - scroller: random scrolling
     - typer: random keyboard input
  4. Collect pageerror events
  5. Filter out known noise: ResizeObserver, Script error, etc.
  6. Verify: critical errors == 0

Results: aggregated into EXPLORATION_REPORT.md under "monkey-test" section
```

### 9d (Auto Bug Feedback)

| Mode | Behavior |
|------|----------|
| FULL | Process all P0/P1 bugs via RCA |
| INCREMENTAL | Process new bugs only (not already in _rca_history.md) |

```
1. Extract P0/P1 from EXPLORATION_REPORT.md + CHAOS_TEST_STATUS.md + UX_QA_SUMMARY.md
2. Filter bugs already in _rca_history.md
3. Process new bugs only:

For each new P0/P1 bug:
  Step 1 (Intake):    Create BUG-{NNN}.yaml
  Step 2 (RCA):       Classify root_origin + root_cause_category
  Step 3 (Story):     Create missing user story → add to YAML
  ──── GATE ────────────────────────────────────────
  Step 3 output MUST be written to disk
  BEFORE Step 4.5.4 can begin (Story First, Fix Second)
  ────────────────────────────────────────────────────
  Step 4 (Pattern):   Extract gap pattern → _gap_patterns.yaml
  Step 4.5.1-3 (Upstream Fix): Patch skill/algorithm files
  Step 4.5.4 (Code Fix):       Fix app code (if applicable)
  Step 4.5.5 (Verify Fix):
    IF code_fix_files is not null:
      → Run story created in Step 3 via playwright-qa-agent
      → PASS → fix_verified = true
      → FAIL → attempt 2nd fix → re-run
      → 2 failures → fix_verified = false, needs_manual = true (non-blocking)
    IF code_fix_files is null:
      → fix_verified = "n/a"
  Step 5 (Archive):   Record in _rca_history.md

After all bugs:
  → Run learn-bugs (update bug-patterns-global.yaml)
```

### ★ 9d-predict (Bug Prediction & Reverse Search) [NEW]

Proactively detects code likely to contain bugs by leveraging historical bug patterns and git churn data.

| Mode | Behavior |
|------|----------|
| FULL | Scan entire codebase |
| INCREMENTAL | Re-scan focusing on changed files |

```
Signal A: bug-patterns-global.yaml reverse search
  1. Load skills/qa/learn-bugs/references/bug-patterns-global.yaml
  2. Extract source.patterns (grep patterns) from each pattern
  3. Grep across frontend/app/ + backend/src/ in current codebase
  4. Generate matched file list → sort by match_count
  5. Match = "this code may contain a bug similar to past occurrences"

Signal B: Git churn-based prediction (Google methodology)
  1. git log --since="90 days ago" --grep="fix\|bug\|patch" --name-only → bugfix files
  2. git log --since="90 days ago" --name-only | sort | uniq -c | sort -rn → high-churn
  3. git log --since="30 days ago" --diff-filter=A --name-only → recently added files
  4. Weighted score: bugfix × 3 + churn(>5 times) × 1 + recently_added × 2

Combined Output:
  1. Calculate risk score per file (Signal A + Signal B combined)
  2. Map top files → corresponding routes (via routes.yaml)
  3. Forward high-risk route list → 9c autonomous exploration:
     - High-risk routes: DEEP mode (40 actions instead of 20)
     - Normal routes: as before (FULL 20 or LIGHT 5)

Generate BUG_PREDICTION_REPORT.md:
  | File | Risk Score | Reasons | Route |
  |------|-----------|---------|-------|
  | Cart.tsx | 8.5 | bugfix(3), churn(12), pattern-match(FD-01) | /cart |
```

### 9e (UX Heuristic Scanner)

| Mode | Behavior |
|------|----------|
| FULL | All routes × 10 categories full scan |
| INCREMENTAL | full_retest + issue routes → full. Rest → reduced. |

```
For each route:
  IF route in full_retest_routes           → FULL: all 10 categories
  ELSE IF route in checkpoint.issue_routes → FULL: all 10 categories (re-check previous issues)
  ELSE:
    → REDUCED:
      - Always run: fake-data + dead-ui (high signal, fast)
      - Additionally: categories that had issues previously
      - Rest: cached "clean" result

⚠️ Every route visited. No skips.

UX_QA_SUMMARY.md: record all routes
  - FULL: 10-category results
  - REDUCED: scanned categories + "clean (cached)" indicated

P0/P1 → bug-feedback-loop (processed in 9d)
All issues → learn-bugs --global
```

---

## Tier 3: Production Layer Rules

### PL-0: PRD NFR Extraction

```
1. Load PRD files from .claude-project/prd/ (Glob *.md)
2. Search for "Non-Functional Requirements" or "NFR" section
3. Extract performance/security/accessibility thresholds
4. Use defaults if not found:
   performance:
     lcp_threshold_ms: 2500
     cls_threshold: 0.1
     bundle_size_kb_gzipped: 500
     api_latency_p95_ms: 500
   security:
     level: "owasp-top-10"
     npm_audit_level: "high"
   accessibility:
     standard: "WCAG 2.1 AA"
     axe_critical_threshold: 0
5. Record in PRODUCTION_SLO.yaml (only on iteration 1, reuse thereafter)
```

### PL-1: Security Scan

```
Static analysis (grep):
  1. dangerouslySetInnerHTML usage → P1 (unless justified)
  2. Direct innerHTML assignment → P0
  3. Raw SQL queries (sql`, query(`, execute(` without parameterization) → P1
  4. Hardcoded secrets (API_KEY=, password=, secret= literals) → P0
  5. CORS origin '*' → P1
  6. npm audit HIGH/CRITICAL → P0

Live testing (playwright):
  7. Reuse XSS results from 9c-fuzz (already executed)
  8. Unauthenticated access to protected routes → verify blocked
  9. Reuse weak-secrets check from ship-gate.sh

security_score = max(0, 1.0 - P0×0.5 - P1×0.1 - P2×0.02)
HARD GATE: P0 = 0 required
```

### PL-2: Performance Audit

```
Thresholds: loaded from PRODUCTION_SLO.yaml

1. Bundle size: extracted from PF-3 build output (already executed)
   score = 1.0 if < slo.bundle_size, proportional to 2× cap

2. Page load time: visit all routes via playwright
   Measure navigationStart → load time for each page
   page_load_score = 1.0 if LCP < slo.lcp_threshold

3. CLS: measure layout-shift via PerformanceObserver for 5 seconds
   cls_score = 1.0 if CLS < slo.cls_threshold

4. API latency: collect API request timing from playwright network timing
   api_score = 1.0 if p95 < slo.api_latency_p95

5. console.log count: reuse ship-gate.sh (≤ 3 allowed)

performance_score = avg(bundle, page_load, cls, api_latency)
```

### PL-3: Accessibility Audit

```
Leverage ux-scanner accessibility category (A11Y-01~08) results +

Additional axe-core verification:
  1. Visit each route via playwright
  2. Inject axe-core CDN: page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/axe-core/axe.min.js' })
  3. Run page.evaluate(() => axe.run())
  4. Classify violations: critical, serious, moderate, minor

Keyboard navigation verification:
  5. Repeat Tab key → confirm focus reaches all interactive elements
  6. Enter/Space → confirm button/link activation
  7. Escape → confirm modal/dropdown closes

accessibility_score = max(0, 1.0 - critical×0.3 - serious×0.1 - moderate×0.03)
HARD GATE: critical = 0 required
```

### PL-4: Cross-Viewport Testing

```
Using playwright-qa-agent viewport parameter:
  Desktop: 1440×900 (already tested in 9b → reuse results)
  Tablet: 768×1024 (re-run smoke + tier-1 stories)
  Mobile: 375×812 (re-run smoke + tier-1 stories)

Additional layout structure verification (per viewport):
  1. No horizontal overflow: scrollWidth <= clientWidth
  2. No interactive element overlap: getBoundingClientRect comparison
  3. Truncated text has title/tooltip

viewport_score = pass_rate across (tablet + mobile) stories
```

### PL-5: Data Integrity

```
1. Seed data completeness:
   - Verify at least 1 record exists in every DB table
   - npx prisma db seed → completes without error

2. FK constraint verification:
   - No orphan records (FK reference targets exist)
   - prisma validate passes

3. Cascade behavior verification (if applicable):
   - Confirm child handling when parent is deleted

data_integrity_score = pass_rate of all checks
```

### PL-6: Production Config Validation

```
Reuse ship-gate.sh entirely:
  1. Backend production build
  2. Frontend production build
  3. .env.example exists
  4. .env not committed
  5. Docker files exist (if applicable)
  6. console.log ≤ 3
  7. No weak secrets
  8. .env.example completeness

ship_gate_pass = all checks pass (HARD GATE)
```

### Production Layers Marker: PRODUCTION_LAYERS_STATUS.md

```markdown
# Production Layers Status — Iteration {N}
Date: {timestamp}
SLO Source: PRD NFR (or defaults)

## PL-1: Security
| Check | Severity | Count | Status |
|-------|----------|-------|--------|
| dangerouslySetInnerHTML | P1 | 0 | ✅ |
| innerHTML | P0 | 0 | ✅ |
| raw SQL | P1 | 0 | ✅ |
| hardcoded secrets | P0 | 0 | ✅ |
| CORS wildcard | P1 | 0 | ✅ |
| npm audit HIGH | P0 | 0 | ✅ |
| XSS reflection | P0 | 0 | ✅ |
| auth bypass | P0 | 0 | ✅ |
Score: 1.00

## PL-2: Performance
| Metric | Value | SLO | Status |
|--------|-------|-----|--------|
| Bundle size | 342KB | < 500KB | ✅ |
| LCP (avg) | 1.8s | < 2.5s | ✅ |
| CLS (avg) | 0.03 | < 0.1 | ✅ |
| API p95 | 180ms | < 500ms | ✅ |
Score: 0.95

## PL-3: Accessibility
axe-core: 0 critical, 1 serious, 3 moderate
Keyboard nav: all elements reachable
Score: 0.90

## PL-4: Cross-Viewport
| Viewport | Stories | Pass Rate |
|----------|---------|-----------|
| Desktop (1440) | cached from 9b | 0.96 |
| Tablet (768) | 15 | 0.93 |
| Mobile (375) | 15 | 0.87 |
Score: 0.92

## PL-5: Data Integrity
Seed complete: ✅
FK violations: 0
Score: 1.00

## PL-6: Ship Gate
All 8 checks: ✅ PASS
```

---

## Quality Gate

### Hard Gates (boolean)

```yaml
hard_gates:
  preflight_pass: true          # PF-1..PF-6 all passed
  chaos_resilient: true         # 9c-chaos P0 crashes = 0
  security_clean: true          # PL-1 P0 = 0
  accessibility_clean: true     # PL-3 critical axe = 0
  ship_gate_pass: true          # PL-6 all passed

# Any false → production_score capped at 0.80
```

### Weighted Score

```yaml
production_score = (browser_score × 0.45)
                 + (chaos_score × 0.15)
                 + (security_score × 0.10)
                 + (performance_score × 0.10)
                 + (accessibility_score × 0.08)
                 + (viewport_score × 0.07)
                 + (data_integrity_score × 0.05)

browser_score (existing 6-weight formula):
  = (design_fidelity × 0.20)
  + (acceptance_pass_rate × 0.30)
  + (exploration_health × 0.15)
  + (e2e_regression_rate × 0.10)
  + (story_depth_score × 0.10)
  + (ux_scanner_health × 0.15)
```

Required marker files (8, required in all modes):
- PREFLIGHT_STATUS.md
- SEED_STATUS.md
- DESIGN_QA_STATUS.md
- E2E_QA_STATUS.md
- CHAOS_TEST_STATUS.md
- EXPLORATION_REPORT.md
- UX_QA_SUMMARY.md
- PRODUCTION_LAYERS_STATUS.md

---

## ITERATION_CHECKPOINT.yaml

**Location:** `.claude-project/status/{project}/ITERATION_CHECKPOINT.yaml`
**Written:** At the end of every iteration (including iteration 1 — bootstrap for incremental)

```yaml
iteration: 3
timestamp: "2026-03-23T14:30:00+09:00"
git_sha: "abc123def"
command: "production-test"

# TIER 1: Pre-flight
preflight:
  tsc_frontend: pass
  tsc_backend: pass
  eslint_frontend: { errors: 0, warnings: 12 }
  eslint_backend: { errors: 0, warnings: 3 }
  build_frontend: { status: pass, bundle_kb: 342 }
  build_backend: pass
  unit_tests: { passed: 45, failed: 0, total: 45 }
  api_tests: { passed: 23, failed: 0, total: 23, stability: "3/3" }
  npm_audit: { high: 0, moderate: 2, low: 5 }
  all_pass: true

# TIER 2: Browser Testing
seed:
  verified: true
  db_migration_hash: "sha256:..."

design_qa:
  per_page:
    - page: "/home"
      fidelity: 0.92
      component_files: ["frontend/app/pages/Home.tsx"]
    - page: "/products"
      fidelity: 0.97
      component_files: ["frontend/app/pages/Products.tsx"]
  average_fidelity: 0.94

acceptance:
  stories:
    - id: "home-smoke-1"
      file: "home.yaml"
      result: PASS
      related_files: ["frontend/app/pages/Home.tsx"]
    - id: "cart-add-item"
      file: "cart.yaml"
      result: FAIL
      related_files: ["frontend/app/pages/Cart.tsx"]
  pass_rate: 0.82
  total: 45
  passed: 37
  failed: 6
  blocked: 2

chaos:
  per_route:
    - route: "/home"
      scenarios: { C1: PASS, C2: PASS, C3: n/a, C4: PASS, C5: n/a, C6: PASS, C7: PASS }
    - route: "/cart"
      scenarios: { C1: FAIL, C2: PASS, C3: PASS, C4: PASS, C5: FAIL, C6: PASS, C7: PASS }
  fail_routes: ["/cart"]
  chaos_score: 0.85

exploration:
  routes_explored:
    - route: "/products"
      bugs_found: 0
      actions_performed: 18
      mode: FULL
    - route: "/cart"
      bugs_found: 2
      actions_performed: 40
      mode: DEEP
  bug_routes: ["/cart", "/checkout"]
  health_score: 0.70

bug_prediction:
  high_risk_files:
    - file: "frontend/app/pages/Cart.tsx"
      risk_score: 8.5
      reasons: ["bugfix(3)", "churn(12)", "pattern-match(FD-01)"]
      route: "/cart"
  high_risk_routes: ["/cart"]

ux_scanner:
  per_route:
    - route: "/home"
      issues: []
      categories_clean: ["fake-data", "dead-ui", "text-quality", "accessibility", "session-auth", "security", "data-consistency", "missing-features", "ui-polish", "real-time"]
    - route: "/products"
      issues: ["UX-003"]
      issue_severities: { "UX-003": "P1" }
      categories_with_issues: ["fake-data"]
  issue_routes: ["/products", "/admin/members"]
  health_score: 0.85

# TIER 3: Production Layers
production_layers:
  slo_source: "PRD NFR"
  security:
    findings: []
    score: 1.0
  performance:
    bundle_size_kb: 342
    lcp_avg_ms: 1800
    cls_avg: 0.03
    api_p95_ms: 180
    score: 0.95
  accessibility:
    violations: { critical: 0, serious: 1, moderate: 3 }
    score: 0.90
  cross_viewport:
    desktop: { pass_rate: 1.0 }
    tablet: { pass_rate: 0.93, stories_run: 15 }
    mobile: { pass_rate: 0.87, stories_run: 15 }
    score: 0.92
  data_integrity:
    seed_complete: true
    fk_violations: 0
    score: 1.0
  ship_gate:
    all_pass: true

# Combined
hard_gates_pass: true
browser_score: 0.88
production_score: 0.91
```

---

## Safety Fallback (→ FULL Execution)

```
Fall back to FULL execution if ANY of:
  - ITERATION_CHECKPOINT.yaml does not exist or is corrupted
  - db_migration_changed AND backend_changed simultaneously
  - full_retest_routes >= 60% of all routes
  - checkpoint.production_score < 0.50
```

---

## Exit Behavior (When User Stops)

When the user requests to stop:

```
1. If a bug is currently being processed:
   → Complete only that bug's fix (through Step 4.5.4 + 4.5.5)
   → Skip remaining unprocessed bugs

2. Write ITERATION_CHECKPOINT.yaml (save current state)

3. Output Exit Summary:
   ┌──────────────────────────────────────────┐
   │ /production-test Summary                  │
   ├──────────────────────────────────────────┤
   │ Iterations completed: {N}                │
   │ Final score: {S} (target: {target})      │
   │ Score progression: 0.42 → 0.68 → 0.85   │
   │                                          │
   │ Pre-flight: {PASS/FAIL}                  │
   │ Hard gates: {all_pass/failed_list}       │
   │                                          │
   │ Bugs found (total):    {count}           │
   │ Bugs fixed:            {count}           │
   │ Bugs needs_manual:     {count}           │
   │                                          │
   │ Chaos scenarios:       {pass}/{total}    │
   │ Security findings:     {P0}/{P1}/{P2}    │
   │ Accessibility:         {critical}/{all}  │
   │                                          │
   │ Stories added:          {count}           │
   │ Gap patterns extracted: {count}           │
   │ Bug predictions matched: {count}          │
   │                                          │
   │ Remaining issues:                         │
   │   - {P0/P1 bug descriptions}              │
   │   - {FAIL stories list}                   │
   │   - {FAIL chaos scenarios}                │
   │   - {Hard gate failures}                  │
   │                                          │
   │ To resume: /production-test {project}     │
   └──────────────────────────────────────────┘

4. Next /production-test run will resume from ITERATION_CHECKPOINT.yaml
```

⚠️ No automatic stop conditions. Stagnation, max iterations, and convergence never trigger auto-stop.
Even when convergence is reached, only report to the user and continue running (deeper bug search).

---

## Full Cycle Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     ITERATION N                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Step 0: Change Detection (iteration 2+ only)               │
│    └─ git diff → CHANGE_MANIFEST.yaml                       │
│    └─ Compute full_retest_routes + chaos_retest_routes       │
│                                                             │
│  ═══ TIER 1: PRE-FLIGHT ═══════════════════════════════════ │
│  PF-1..PF-6: tsc → eslint → build → unit → api → audit     │
│  → PREFLIGHT_STATUS.md                                      │
│                                                             │
│  ═══ TIER 2: BROWSER TESTING ══════════════════════════════ │
│  9-pre: Server + seed (cached or full)                      │
│  9a:    Design QA (screenshot comparison)                   │
│  9b-deepen: User story enrichment (reads _gap_patterns.yaml)│
│  9b:    Acceptance testing (fail+new+changed+10% spot check)│
│  ★ 9c-chaos: Chaos scenarios (7 types × routes)             │
│  9c:    Autonomous exploration (FULL/DEEP/LIGHT)            │
│  ★ 9c-fuzz: Boundary value fuzzing (8 payload types)        │
│  ★ 9c-monkey: Gremlin testing (30-second random)            │
│                                                             │
│  9d:    Bug feedback (exploration + chaos + ux bugs)         │
│    ├─ Step 1: BUG-{NNN}.yaml                                │
│    ├─ Step 2: RCA                                           │
│    ├─ Step 3: Create user story ★ (Story First)              │
│    ├─ ──── GATE ──── (confirm story written to disk)         │
│    ├─ Step 4: Extract gap pattern                            │
│    ├─ Step 4.5: Upstream patch + code fix ★ (Fix Second)     │
│    ├─ Step 4.5.5: Verify fix (re-test via story) ★           │
│    └─ Step 5: Archive                                        │
│  ★ 9d-predict: Bug prediction reverse search (patterns + git churn) │
│                                                             │
│  9e:    UX scan (changed+issue routes FULL / rest REDUCED)  │
│                                                             │
│  ═══ TIER 3: PRODUCTION LAYERS ════════════════════════════ │
│  PL-0: PRD NFR extraction → PRODUCTION_SLO.yaml             │
│  PL-1: Security scan (static + live)                         │
│  PL-2: Performance audit (bundle + LCP + CLS + API)          │
│  PL-3: Accessibility audit (axe-core + keyboard)             │
│  PL-4: Cross-viewport (3 viewports × smoke stories)         │
│  PL-5: Data integrity (seed + FK + cascade)                  │
│  PL-6: Production config (ship-gate.sh)                      │
│  → PRODUCTION_LAYERS_STATUS.md                               │
│                                                             │
│  Quality Gate: Hard Gates + Weighted Score                    │
│  Write ITERATION_CHECKPOINT.yaml                             │
│                                                             │
│  score >= 0.97 → CONVERGED ✓ (continue running)             │
│  score <  0.97 → NEXT ITERATION ↓                           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│              ↓ Passed to next iteration                      │
│  _gap_patterns.yaml    → 9b-deepen enriches stories         │
│  bug-patterns-global   → 9d-predict reverse search + Tier 14│
│  Code fix results      → Bug count decreases on re-test     │
│  ITERATION_CHECKPOINT  → Enables incremental mode            │
│  BUG_PREDICTION_REPORT → 9c explores high-risk routes deeply│
└──────────────── ITERATION N+1 ──────────────────────────────┘
```

---

## Quick Reference

| Sub-Phase | FULL (iteration 1) | INCREMENTAL (iteration 2+) |
|-----------|--------------------|-----------------------------|
| Tier 1 PF-1..6 | Run all | Changed areas only |
| 9-pre | Full seed + server | Health check only (if seed cached) |
| 9a | Screenshot all pages | Changed + low-quality pages only |
| 9b-deepen | Run if gap_score ≥ 0.05 | Same |
| 9b | All stories | Failed+new+changed+10% spot check |
| ★ 9c-chaos | All routes × 7 scenarios | Changed routes × 7 + previous FAILs |
| 9c | All routes FULL | Changed FULL + high-risk DEEP + rest LIGHT |
| ★ 9c-fuzz | All route inputs | Changed route inputs only |
| ★ 9c-monkey | All routes 30 sec | Changed routes only |
| 9d | All P0/P1 | New bugs only + Step 4.5.5 verification |
| ★ 9d-predict | Full scan | Changed files focus |
| 9e | All routes 10 categories | Changed/issue routes full + rest reduced |
| Tier 3 PL-0..6 | Run all | Changed areas only |
| Marker files | All 8 | All 8 (with cached indication) |
| Checkpoint | Write (bootstrap) | Write (for next iteration) |

---

## Integration with Existing Systems

- **09-test-browser.md**: Phase 9 pipeline doc delegates to this unified skill
- **bug-feedback-loop/SKILL.md**: Step 4.5.5 (code fix verification), Step 3 completion gate
- **artifact-tracking.md**: ITERATION_CHECKPOINT.yaml, CHANGE_MANIFEST.yaml, 8 marker files
- **fullstack.md**: `--phase test-browser` invokes this skill (development mode for iter 1, production for iter 2+)
- **learn-bugs/SKILL.md**: 9d updates bug-patterns-global.yaml → 9d-predict reverse search
- **ship-gate.sh**: Reused entirely in PL-6
- **production-test-gate.sh**: Unified gate for Phase 9
