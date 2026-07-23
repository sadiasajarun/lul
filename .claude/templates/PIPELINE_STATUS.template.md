# Fullstack Pipeline Status - {PROJECT_NAME}

## Configuration

```yaml
project: {PROJECT_NAME}
created: {DATE}
last_run: null
generation: 1
pipeline_score: 0
quality_target: 0.95
seed_id: null
tech_stack:
  backend: null          # nestjs | django
  frontends: []          # [react] | [react-native] | [react, react-native]
  dashboards: []         # [admin] | [coach] | [admin, coach]
format_version: 3
```

## Progress

| Phase | Status | Score | Output | Loop Runs | Gate Run At | Notes |
|-------|--------|-------|--------|------------|-------------|-------|
| spec | Pending | - | - | 0 | - | - |
| init | Pending | - | - | 0 | - | - |
| prd | Pending | - | - | 0 | - | - |
| user-stories | Pending | - | - | 0 | - | - |
| design | Pending | - | - | 0 | - | - |
| database | Pending | - | - | 0 | - | - |
| backend | Pending | - | - | 0 | - | - |
| frontend | Pending | - | - | 0 | - | - |
| integrate | Pending | - | - | 0 | - | - |
| test-api | Pending | - | - | 0 | - | - |
| test-browser | Pending | - | - | 0 | - | - |
| ship | Pending | - | - | 0 | - | - |

## Generation Log

| Gen | Score | Phases Run | Improved | Stagnant | Duration |
|-----|-------|-----------|----------|----------|----------|

## Artifact Hashes

| Phase | Artifact | Hash | Last Changed |
|-------|----------|------|-------------|

## Gate Proofs

| Phase | Proof File | Executed At | Score | Checks Hash |
|-------|-----------|-------------|-------|-------------|

## Gate Results

Gate scripts provide deterministic, non-LLM validation after each phase.

### database — Gate Results

| Check | Result | Detail | Time |
|-------|--------|--------|------|
| _no runs yet_ | | | |

**Fix Attempts:** _none_

### backend — Gate Results

| Check | Result | Detail | Time |
|-------|--------|--------|------|
| _no runs yet_ | | | |

**Fix Attempts:** _none_

### frontend — Gate Results

| Check | Result | Detail | Time |
|-------|--------|--------|------|
| _no runs yet_ | | | |

**Fix Attempts:** _none_

### integrate — Gate Results

| Check | Result | Detail | Time |
|-------|--------|--------|------|
| _no runs yet_ | | | |

**Fix Attempts:** _none_

### test-api — Gate Results

| Check | Result | Detail | Time |
|-------|--------|--------|------|
| _no runs yet_ | | | |

**Fix Attempts:** _none_

### test-browser — Gate Results

| Check | Result | Detail | Time |
|-------|--------|--------|------|
| _no runs yet_ | | | |

**Fix Attempts:** _none_

### ship — Gate Results

| Check | Result | Detail | Time |
|-------|--------|--------|------|
| _no runs yet_ | | | |

**Fix Attempts:** _none_

## Improvement Queue

Items identified for future iterations.

| Phase | Improvement | Priority | Source | Target Gen |
|-------|-------------|----------|--------|------------|

## Skill Paths by Tier

| Tier | Base Path | Description |
|------|-----------|-------------|
| base | `.claude/skills/` | Generic orchestration (init, ship) |
| $BACKEND | `.claude/$BACKEND/skills/` | Backend skills (prd, database, backend) |
| $FRONTEND | `.claude/$FRONTEND/skills/` + `guides/` | Frontend skills (frontend, dashboard, integrate, qa) |
| $STACK | `.claude/{context}/skills/` | Context-dependent (backend or frontend) |

### Tech Stack Resolution

- `$BACKEND` = tech_stack.backend (e.g., "nestjs", "django")
- `$FRONTEND` = tech_stack.frontends[0] (e.g., "react")
- `$STACK` = Resolved based on phase context

**Supported Tech Stacks:**

| Category | Options | Submodule URL |
|----------|---------|---------------|
| Backend | nestjs, django | github.com/potentialInc/claude-{backend} |
| Frontend | react, react-native | github.com/potentialInc/claude-{frontend} |

## Execution Log

| Date | Phase | Gen | Duration | Result | Score | Notes |
|------|-------|-----|----------|--------|-------|-------|

## Phase Details

### spec
- **Status**: Pending
- **Seed**: -
- **Ambiguity**: -

### init
- **Status**: Pending
- **Output**: -

### prd
- **Status**: Pending
- **PRD**: -
- **Converted Docs**: -

---

## Status Labels

| Label | Meaning |
|-------|---------|
| Complete | Phase finished successfully |
| In Progress | Currently executing |
| Pending | Not yet started |
| Failed | Execution failed |
| Needs Review | Artifact invalidated, re-evaluation needed |
| Skipped | Carried from previous generation |
