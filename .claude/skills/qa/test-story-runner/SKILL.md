---
name: test-story-runner
description: Simplified 3-stage test-browser runner — preflight, execute user-story acceptance specs with screenshots, produce report. Use for default Phase 9 runs; use /production-test --deep for chaos/fuzz/exploration.
tags: [qa, test-browser, playwright, phase-9]
---

# Test Story Runner

Default execution for Phase 9 (`test-browser`). Runs user-story acceptance specs against the running frontend + backend and produces a per-story report with screenshots.

Advanced depth modes (chaos, fuzz, autonomous exploration, UX audit, production layers) are handled by `/production-test --deep`. This skill keeps the default loop fast and honest: every story either passes its assertions or the report shows exactly what failed.

Completion promise: `STORY_TEST_COMPLETE`.

---

## Stage 1 — Preflight

Reuses preflight checks PF-1, PF-3, PF-5 from `.claude/skills/qa/test-production.md`:

| Step | Check | Gate proof |
|------|-------|------------|
| PF-1 | `cd frontend && npx tsc --noEmit` | `frontend-gate` TSC pass |
| PF-3 | `cd frontend && npm run build` and `cd backend && npm run build` | `frontend/dist` + `backend/dist` exist |
| PF-5 | `cd backend && npm run test:e2e` (3 consecutive runs, all pass) | `.gate-proofs/test-api.proof` present |

If any preflight step fails, abort — do not run browser tests. Report `preflight_failed: true`.

---

## Stage 2 — Story Runner

For each `.claude-project/user_stories/*.yaml` (excluding `_*.yaml` fixtures):

1. Regenerate specs: `cd frontend && node e2e/_gen-specs.cjs`.
2. Ensure `e2e/global-setup.ts` has produced `e2e/.auth/{role}.json` per `_fixtures.yaml` users.
3. Run: `cd frontend && npx playwright test acceptance --reporter=json > playwright-report/results.json`.
4. Playwright project config (`playwright.config.ts`) routes each spec to the right `storageState` via filename regex, so auth is automatic.
5. Each generated test captures a screenshot to `test-results/{story.id}.png` as part of execution.
6. Copy screenshots to persistent location: `.claude-project/status/{project}/screenshots/`.

Per story the runner records:

- `id` — story ID (e.g. `SVC-001`)
- `slug` — YAML filename
- `role` — `yaml.role`
- `route` — `yaml.route`
- `status` — `pass` | `fail` | `fixme`
- `failure` — first failed expect message (if any)
- `screenshot` — absolute path to the captured png
- `duration_ms`

---

## Stage 3 — Report

Emits two artifacts under `.claude-project/status/{project}/`:

### STORY_TEST_REPORT.md

```
# Story Test Report — {project}
Generated: {iso-timestamp}

Pass rate: {pass}/{total} ({pct}%)
Preflight: {ok|FAILED}

| ID | Slug | Role | Route | Status | Screenshot | Failure |
|----|------|------|-------|--------|------------|---------|
| ... | ... | ... | ... | ... | ![](screenshots/...png) | ... |
```

### STORY_TEST_INDEX.html

Minimal HTML grid with thumbnail `<img>` per story, red/green border per status. No CSS framework; inline styles only.

---

## Threshold

Pass criteria (checked by `.claude/gates/test-browser-gate.sh`):

- `preflight_ok === true`
- `pass_rate >= 0.95` (count of `status === 'pass'` over total stories)
- Screenshots present: at least `ceil(total_stories / 2)` `screenshots/story-*.png` files
- `STORY_TEST_REPORT.md` exists and contains no template placeholders (`{project}`, `{iso-timestamp}`, `{pass}`, `{total}`, `{pct}`).

Below these thresholds → `STORY_TEST_COMPLETE` is **not** emitted. The frontend gate's `design-fidelity` check must also be green before entering Phase 9.

---

## Commands

```bash
# Regenerate specs from YAML
cd frontend && node e2e/_gen-specs.cjs

# Run default Phase 9
cd frontend && npx playwright test acceptance --reporter=json > playwright-report/results.json

# Evaluate gate
bash .claude/gates/test-browser-gate.sh "$PWD"

# Deep mode (chaos/fuzz/UX/exploration)
/production-test --deep
```
