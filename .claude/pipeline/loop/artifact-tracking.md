# Artifact Tracking and Invalidation

Track key outputs from each phase. If an artifact changes, invalidate dependent phases.

## Tracked Artifacts

| Phase | Artifact | How Tracked |
|-------|----------|-------------|
| spec | seed YAML | File hash of seed-{id}.yaml |
| prd | PROJECT_KNOWLEDGE.md | File hash |
| design | DESIGN_SYSTEM.md | File hash |
| design | Design prompts file | File hash |
| design | HTML files | Combined hash of all *.html in generated-screens/ |
| database | Entity files | Combined hash of all *.entity.ts files |
| backend | Controller routes | Combined hash of all *.controller.ts files |
| backend | Backend test files | Combined hash of all *.e2e-spec.ts (backend) |
| frontend | Component files | Combined hash of all page components |
| integrate | API service files | Combined hash of all *.service.ts (frontend) |
| test-api | Backend test files | Combined hash of all *.e2e-spec.ts (backend) |
| prd | User story YAML files | Combined hash of all .claude-project/user_stories/*.yaml |
| user-stories | STORY_COVERAGE.md | File hash of STORY_COVERAGE.md |
| user-stories | Deepened story YAML | Combined hash of depth-tier stories (tiers 9-14) |
| test-browser | QA report | File hash of QA_REPORT.md |
| test-browser | ITERATION_CHECKPOINT.yaml | File existence + iteration number |
| test-browser | CHANGE_MANIFEST.yaml | Rebuilt each iteration (not tracked for invalidation) |
| test-browser | PREFLIGHT_STATUS.md | Pre-flight check results (Tier 1) |
| test-browser | CHAOS_TEST_STATUS.md | Chaos scenario test results (7 scenarios × routes) |
| test-browser | PRODUCTION_LAYERS_STATUS.md | Production layer results (security, performance, a11y, viewport, data, config) |
| ship | Build outputs | Combined hash of frontend/dist/ + backend/dist/ |

## Invalidation Rules

```
IF seed changes       → invalidate: prd, design, database, backend, frontend, integrate, test-api, test-browser
IF prd changes        → invalidate: design, database, backend, frontend, user-stories
IF design changes     → invalidate: frontend, user-stories (must re-convert HTML to React; user stories read UI elements from HTML)
IF database changes   → invalidate: backend
IF backend changes    → invalidate: integrate, test-api (backend tests may need updating)
IF frontend changes   → invalidate: integrate, test-browser (browser tests may need updating)
IF integrate changes  → invalidate: test-api, test-browser
IF backend tests change → invalidate: test-api (Step 2 needs re-execution)
IF user stories change  → invalidate: test-browser (acceptance tests use YAML stories)
```

## Invalidation Behavior

When a phase is invalidated:
1. Set status to `Needs Review` (not Failed — the code still exists)
2. In next loop generation, re-evaluate the phase
3. If evaluation passes: keep Complete. If fails: mark for re-execution.
