# Phase 9: Test Browser (Story Runner)

Phase 9 runs user-story acceptance specs in a live browser and produces a per-story pass/fail report with screenshots. The default loop is lean and honest — three stages, no hidden tiers.

For deep-mode coverage (chaos, fuzz, autonomous exploration, UX audit, production layers), invoke `/production-test --deep` or the `test-production` skill with `--deep`.

## Prerequisites

- Phase 5 (backend) complete and passing
- Phase 6 (frontend) complete **including the `design-fidelity` gate check** (no more file-count-only passes)
- Phase 7 (integrate) complete
- Phase 8 (test-api) complete with `.gate-proofs/test-api.proof` present
- User story YAML files present: `.claude-project/user_stories/*.yaml`
- `_fixtures.yaml` users populated (used by `global-setup.ts` for storageState)

---

## The Three Stages

### Stage 1 — Preflight

Reuses PF-1, PF-3, PF-5 from `.claude/skills/qa/test-production.md`:

- `tsc --noEmit` (frontend + backend)
- `npm run build` (frontend + backend → `dist/` artifacts)
- Backend e2e tests, 3 consecutive green runs

Abort if preflight fails. Fix and re-run — never start browser tests on a broken build.

### Stage 2 — Story Runner

Delegated to skill `test-story-runner` (`.claude/skills/qa/test-story-runner/SKILL.md`).

1. Regenerate specs: `cd frontend && node e2e/_gen-specs.cjs` (YAML → real `expect(...)` assertions).
2. `global-setup.ts` produces `e2e/.auth/{role}.json` per `_fixtures.yaml`.
3. Run: `cd frontend && npx playwright test acceptance --reporter=json > playwright-report/results.json`.
4. Each test screenshots fullPage to `test-results/{story.id}.png`; runner copies to `.claude-project/status/{project}/screenshots/`.

### Stage 3 — Report

Produces:

- `.claude-project/status/{project}/STORY_TEST_REPORT.md` — pass rate + per-story table (id, role, route, status, screenshot, failure).
- `.claude-project/status/{project}/STORY_TEST_INDEX.html` — screenshot grid with status-colored borders.

---

## Gate

Enforced by `.claude/gates/test-browser-gate.sh`:

| Check | Threshold |
|-------|-----------|
| `preflight` | `frontend/dist`, `backend/dist`, `.gate-proofs/test-api.proof` all present |
| `story-pass-rate` | `passed / total >= 0.95` (parses `playwright-report/results.json`) |
| `screenshots-present` | `count >= ceil(total_stories / 2)` |
| `story-report` | `STORY_TEST_REPORT.md` exists and is not a template placeholder |

All four must pass → emits `STORY_TEST_COMPLETE`.

---

## Deep Mode (Optional)

```bash
/production-test --deep
```

Runs chaos (network/storage/timezone/RTL), fuzz boundaries, autonomous exploration, UX audit, and production layers. Required only when `fullstack {project} --mode production` is invoked or when a bug pattern review triggers it.

---

## Commands

```bash
# Default Phase 9
cd frontend && node e2e/_gen-specs.cjs
cd frontend && npx playwright test acceptance --reporter=json > playwright-report/results.json
bash .claude/gates/test-browser-gate.sh "$PWD"

# Deep Phase 9
/production-test --deep
```
