# Test Browser Phase Rules

## Process

- Run all 3 sub-phases: Design QA → Acceptance → Exploration
- Design QA: Compare React vs HTML source (fidelity >= 85%)
- Acceptance: Run YAML user stories via playwright-qa-agent (>= 80% pass)
- Exploration: Autonomous browser testing for edge cases

## Quality

- Any P0/P1 bug from exploration = phase FAILS
- Backend API tests must still pass after fixes (regression check)
- Combined score must reach >= 0.95 for phase to pass

## Test Quality — Banned Patterns

### RULE-T0: `waitForLoadState('load')` Prohibited in SPA Tests ✅ gate: `no-bad-waits`

<!-- Why: The 'load' browser event never fires in SPAs that keep a WebSocket, SSE,
     or dev-HMR socket open. Tests using `page.waitForLoadState('load')` hang for
     the full timeout and report as flaky, even though the app is actually ready.
     Agents sometimes pick 'load' by analogy with MPAs and the anti-pattern recurs.
     Pattern: pipeline contract drift (skill said networkidle; agent used load)
     Ref: .claude/gates/no-bad-waits.sh
          .claude/react/skills/e2e-testing/SKILL.md → Wait Pattern Anti-Patterns -->

- Never use `page.waitForLoadState('load')` in Playwright specs targeting the SPA.
- Prefer locator readiness: `await page.waitForSelector('[data-testid=...]', { state: 'visible' })` or `await expect(locator).toBeVisible()`.
- For data-fetch completion, use `waitForLoadState('networkidle', { timeout: 5_000 })` wrapped in `.catch(() => {})` as a fallback.
- Enforced by `bash .claude/gates/no-bad-waits.sh <target_dir>` — standalone gate that greps all spec files. Zero-tolerance: one occurrence fails the check.
- Violation: test-browser-gate FAIL.

### RULE-T1: .or() Prohibited (Smoke/Happy-path Tests) ✅ gate: `no-or-in-smoke-tests`

<!-- Why: Agent wrote smoke tests using .or() to accept both success and error states:
     `expect(page.getByText('Dashboard').or(page.getByText('Error'))).toBeVisible()`.
     Every test passed regardless of whether the app worked. The error state branch
     was effectively a silent pass for broken features.
     Pattern: D-01 — Silent Pass (.or() variant)
     Ref: test-browser-gate.sh → no-or-in-smoke-tests check -->

- In Smoke (Tier-1) tests, do not use `.or()` to include error states as success
- Assert only success states: `expect(page.getByText('My Projects')).toBeVisible()`
- Error state verification should be done in separate Tier-11 (API Error) test files
- Violation: test-browser-gate FAIL

### RULE-T2: .catch(() => false) + if Prohibited (Silent Pass) ✅ gate: `no-silent-pass-pattern`

<!-- Why: Agent used `.isVisible().catch(() => false)` then `if (visible) { ...assertions }`.
     When elements were missing (due to real bugs), the catch swallowed the failure
     and the if-block was skipped. Test reported PASS with zero assertions executed.
     Pattern: D-01 — Silent Pass (catch-false-if variant)
     Ref: test-browser-gate.sh → no-silent-pass-pattern check -->

- Using `.catch(() => false)` followed by `if (visible)` pattern is prohibited
- This pattern skips entire test blocks when elements are missing and reports PASS
- Instead: use `test.skip('prerequisite missing')` for explicit skip
- Or: assert prerequisites in `beforeAll` → skip entire describe on failure
- Violation: test-browser-gate FAIL

### RULE-T3: Seed Data Dependencies Must Be Explicit

<!-- Why: Tests assumed seed data existed but didn't verify. When seed script failed
     silently (DB connection error), tests ran against empty database and either
     passed vacuously (no data to assert against) or failed with cryptic "element
     not found" errors that obscured the root cause.
     Pattern: D-01 — Silent Pass (implicit seed dependency)
     Ref: backend-gate.sh → seed-script-exists check -->

- Tests depending on seed data must indicate dependencies in `test.describe`
- Verify seed data existence in `beforeAll` (API call or DOM check)
- If missing, use `test.skip('seed data missing')` — never silently PASS

### RULE-T4: Playwright baseURL Must Use Environment Variables ✅ gate: `no-hardcoded-baseurl`

<!-- Why: Agent hardcoded http://localhost:5173 in playwright.config.ts. When the
     frontend started on a different port (collision with another project), all
     tests failed with connection refused. Environment variables allow CI/CD and
     multi-project setups to override the URL.
     Pattern: Port mismatch — hardcoded URLs break in multi-project environments
     Ref: test-browser-gate.sh → no-hardcoded-baseurl check -->

- Set `baseURL` to `process.env.BASE_URL` in `playwright.config.ts`
- Hardcoding `http://localhost:XXXX` is prohibited
- Violation: test-browser-gate FAIL

### RULE-T5: Test Data Cleanup ✅ gate: `test-cleanup-exists` (FAIL)

<!-- Why: E2E tests created users, projects, and tasks but never deleted them.
     On the second pipeline run, unique constraint violations caused test failures
     (duplicate email). On the third run, list pages had stale data from previous
     runs that polluted assertions ("expected 3 items, found 9").
     Pattern: Data pollution — test artifacts accumulate across runs
     Ref: test-browser-gate.sh → test-cleanup-exists check -->

- Data created in E2E tests must be cleaned up in `afterAll`/`afterEach`
- Prevents data pollution across repeated runs
- At least 1 spec file must have afterAll/afterEach (0 = gate FAIL)
- Violation: test-browser-gate FAIL

### RULE-T6: i18n Apps — Bilingual Selectors Required ✅ promoted from GP-008 (35 instances)

<!-- Why: Playwright tests used English-only selectors (page.locator('text=Submit'))
     but the app's default locale was Korean. All selectors failed because the DOM
     contained Korean text. This was the single most common test failure pattern
     across all projects with i18n.
     Pattern: GP-008 — English-Only Selectors in i18n
     Ref: agent-learnings → LRN-002 | bug-patterns-global.yaml
     Instances: 35+ across 19 projects -->

- When the app uses i18n (react-i18next, etc.) and the default locale is not English:
  - English-only selectors like `page.locator('text=Submit')` are **prohibited**
  - Must use bilingual regex or language-independent selectors:
    1. `[data-testid="submit-btn"]` — highest priority (language-independent)
    2. `button:has-text(/Submit|제출/i)` — regex with both languages
    3. `[type="submit"]` — attribute-based
    4. `[role="button"][aria-label*="submit"]` — ARIA-based
- When generating test stories: check default locale in `src/i18n/index.ts` → include that locale's text in selectors
- Violation: test-browser-gate FAIL

### RULE-T7: Update User Stories Immediately When Fixing Bugs

<!-- Why: Agent fixed an API double-wrapping bug in Phase 9 but didn't add it to
     the user story YAML. On the next pipeline iteration, the same bug was
     re-introduced because the user story didn't test for it.
     Pattern: A-08 — Bug Recurrence
     Ref: PATTERN_GLOSSARY.md → A-08 -->

- After fixing bugs found in Phase 9, immediately add `error_scenarios` or `boundary_cases` entries to the related user story YAML
- Using the `/bug-feedback-loop` skill is recommended
- Failure to add risks recurrence of the same bug in the next pipeline (A-08 pattern)
- Example: API double-wrapping bug → add `error_scenario: API response unwrapping` to `global-patterns.yaml`

### RULE-T8: User Story → Playwright AC 1:1 Conversion Required ✅ gate: `story-spec-coverage`

<!-- Why: Agent cherry-picked 5 "representative" user stories out of 20 and wrote
     tests only for those. The remaining 15 stories had zero coverage. Bugs in
     untested flows shipped to production. Coverage must be systematic, not selective.
     Pattern: D-01 — Silent Pass (selective coverage variant)
     Ref: test-browser-gate.sh → story-spec-coverage check -->

- Read all YAMLs in `.claude-project/user_stories/` directory and convert each story's `acceptance_criteria` to Playwright tests
- `boundary_cases` → negative tests, `error_scenarios` → error state tests
- Spec file count >= (user story file count × 80%) — below threshold = test-browser-gate FAIL
- Writing only a few scenarios selected by agent's arbitrary judgment is prohibited (D-01 pattern)

### RULE-T9: `test.skip(!seedAvailable)` Pattern Prohibited

<!-- Why: Agent checked seed availability via API call in beforeAll, then used
     test.skip(!seedAvailable, 'seed not ready'). When seed was missing, 41 out of
     52 tests were silently skipped. The report showed "47 passed, 5 failed" —
     the 41 skipped tests appeared as passed in the pipeline score.
     Pattern: D-01 — Silent Pass (skip variant)
     Ref: PATTERN_GLOSSARY.md → D-01 -->

- The pattern of checking seed via API call in `beforeAll` then using `test.skip(!seedAvailable, ...)` is prohibited
- Instead: `global-setup.ts` runs seed + creates storageState → tests reuse storageState
- This pattern silently skips tests when seed is missing, creating a false sense of coverage (D-01 variant)

### RULE-T10: Inline Login Within Tests Prohibited

<!-- Why: Every test file had its own login flow in beforeAll (navigate to /login,
     fill email, fill password, click submit, wait for redirect). This added 3-5s
     per test file, and when the login page changed (button text, form structure),
     ALL test files broke simultaneously. storageState eliminates both problems.
     Pattern: Test duplication — repeated login flow across files
     Ref: Playwright docs → storageState reuse pattern -->

- Directly logging in with email+password in each test/beforeAll is prohibited
- Instead: reuse per-role auth state via `playwright.config.ts`'s `use.storageState`
- Allowed: initial one-time login inside `global-setup.ts` (for storageState creation purposes)

### RULE-T11: global-setup.ts Must Read Credentials from `_fixtures.yaml` Users Section

<!-- Why: Agent hardcoded admin@test.com / password123 in global-setup.ts. When seed
     script was updated to use credentials from _fixtures.yaml, global-setup failed
     because the hardcoded credentials no longer matched. Single source of truth
     prevents this drift.
     Pattern: Credential drift — hardcoded values diverge from seed data
     Ref: RULE-B3 (seed must also read from _fixtures.yaml) -->

- Hardcoding email/password in `global-setup.ts` is prohibited
- Must read credentials from `.claude-project/user_stories/_fixtures.yaml`'s `users` section
- Create `storageState-{role}.json` file for each role
- Register `setup` project in `playwright.config.ts`: `testMatch: ['**/global-setup.ts']`
- Test projects must have `dependencies: ['setup']` to ensure setup runs first

### RULE-T12: Design QA Must Use Screenshot-Based Comparison (Phase 9)

<!-- Why: Code-level design QA (checking Tailwind classes match) reported 95% fidelity,
     but visual comparison revealed obviously wrong layouts — flex directions reversed,
     colors from wrong theme variant, missing box-shadows. Code matching cannot catch
     visual regressions that arise from class interactions.
     Pattern: C-06 — CSS Value Drift (detection gap)
     Ref: frontend.yaml → design-fidelity-check vs test-browser.yaml → screenshot comparison -->

- Code-level checks (Tailwind class matching) alone cannot guarantee design quality
- Phase 9 must capture screenshots of both HTML prototypes + React implementations via Playwright for visual comparison
- HTML prototypes are opened in browser via `file://` path for screenshots
- React implementations are visited via Playwright on the running server for screenshots
- Pages requiring authentication must use storageState-{role}.json (seed-and-auth-setup must run first)
- Comparing only public pages and reporting "design QA complete" is prohibited
- Pages with fidelity < 85% must be fixed immediately and re-verified with screenshots

### RULE-T13: All Chaos Scenarios Must Be Executed (No Skipping)

<!-- Why: Agent judged "this is a simple CRUD app, chaos testing is unnecessary" and
     skipped all 7 scenarios. A P0 crash was later found in production when a user
     rapid-clicked the submit button (double-submit), which chaos scenario C-3
     (rapid interaction) would have caught.
     Pattern: Agent judgment override — skipping mandated checks based on complexity assessment
     Ref: test-browser.yaml → chaos scenarios C-1 through C-7 -->

- All 7 chaos scenarios (C-1 ~ C-7) must be executed on all major routes
- Skipping with judgments like "this app is simple so chaos is unnecessary" is prohibited
- In INCREMENTAL mode, changed routes + previously FAILed scenarios must be re-executed
- P0 crashes must be immediately forwarded to 9d bug-feedback-loop

### RULE-T14: XSS Reflection in Boundary Fuzzing = Immediate P0

<!-- Why: Agent submitted XSS payloads during fuzz testing but classified reflected
     <script> tags as "medium severity" because dangerouslySetInnerHTML wasn't used
     directly. However, the payload was rendered as HTML via a rich-text editor
     component. Severity must be judged by the result (HTML reflected), not the method.
     Pattern: Security — XSS reflection regardless of implementation technique
     Ref: OWASP Top 10 — A7:2017 Cross-Site Scripting -->

- In 9c-fuzz, if XSS payloads (`<script>`, `<img onerror>`) are submitted and rendered as HTML, it is an immediate P0 security bug
- Regardless of `dangerouslySetInnerHTML` usage — judge by the result (whether HTML is reflected)
- P0 security bugs must be verified by re-running 9c-fuzz after code fix

### RULE-T15: PRD NFR Standards Are Source of Truth (Defaults Allowed)

<!-- Why: Agent reported "performance looks good" based on subjective assessment.
     Actual LCP was 4.2s (target: <2.5s) and bundle size was 780KB (target: <500KB).
     Without explicit numeric thresholds, the agent's "good enough" judgment masked
     real performance issues.
     Pattern: Agent judgment override — subjective assessment replaces measurable criteria
     Ref: PRODUCTION_SLO.yaml (extracted from PRD NFR section) -->

- Performance/security/accessibility standards are extracted from PRD's Non-Functional Requirements section
- If PRD has no NFR, use defaults (LCP < 2.5s, bundle < 500KB, WCAG 2.1 AA, etc.)
- FAIL when below standards — arbitrary judgments like "this is good enough" are prohibited
- Standards are recorded in PRODUCTION_SLO.yaml (extracted in iteration 1, reused thereafter)

### RULE-T16: Bug-Predicted High-Risk Files Get 2x Exploration Depth

<!-- Why: Bug-patterns-global.yaml showed that files with high git churn AND matching
     bug pattern code signals had 3x higher defect rates. Standard exploration depth
     (20 actions) missed bugs in these files that deeper exploration (40 actions)
     consistently found.
     Pattern: Risk-based testing — allocate more effort to historically buggy areas
     Ref: bug-patterns-global.yaml (112 patterns) + git churn analysis -->

- Routes containing high-risk files from 9d-predict use DEEP mode (40 actions) in 9c autonomous exploration
- 2x the FULL mode (20 actions) of normal routes
- High-risk criteria: bug-patterns-global.yaml pattern match + top 20% git churn

## Scope Guard

- May fix bugs in both frontend/app/ and backend/src/
- Do NOT add new features during test-browser
- Do NOT modify test infrastructure
- Do NOT change database schema
- Focus on fixing what exists, not building new things
