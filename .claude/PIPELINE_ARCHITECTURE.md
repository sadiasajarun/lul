# claude-fullstack Pipeline Architecture

> Complete reference for the claude-fullstack pipeline — from spec interview to production deployment.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Directory Structure](#2-directory-structure)
3. [Pipeline Orchestrator](#3-pipeline-orchestrator)
4. [Phase-by-Phase Breakdown](#4-phase-by-phase-breakdown)
5. [Rules System](#5-rules-system)
6. [Blueprints (Deterministic + Agentic Execution)](#6-blueprints)
7. [Quality Gates](#7-quality-gates)
8. [Evaluation Criteria](#8-evaluation-criteria)
9. [Loop Engine](#9-loop-engine)
10. [Spec System (Ouroboros)](#10-spec-system-ouroboros)
11. [Skills](#11-skills)
12. [Phase Manifests](#12-phase-manifests)
13. [Templates](#13-templates)
14. [Configuration](#14-configuration)

---

## 1. Overview

claude-fullstack is a **modular, specification-driven pipeline** that transforms a business idea into a deployed full-stack application through 11 sequential phases. It lives as a git submodule at `.claude/` inside the fullstack bot and serves as the **single source of truth** for all pipeline behavior.

### Core Design Principles

| Principle | Description |
|-----------|-------------|
| **Spec-first** | Every project starts with a structured seed document; the spec is immutable (only ontology evolves) |
| **Design-then-build** | HTML prototypes are generated before any React code |
| **TDD-driven backend** | RED (failing tests) → GREEN (implement) → REFACTOR |
| **Parallel execution** | Design + Database run in parallel; Backend + Frontend run in parallel |
| **Scope-guarded phases** | Each phase has explicit file-level boundaries (what CAN and CANNOT be modified) |
| **Quality-gated progression** | Gate scripts validate output before advancing to next phase |
| **Infinite improvement** | `--loop` mode iterates until convergence or stagnation |
| **Deterministic + Agentic** | Blueprints interleave shell commands (verifiable) with LLM tasks (creative) |

### Tech Stack (Generated Apps)

| Layer | Technology |
|-------|-----------|
| Backend | NestJS + TypeORM + PostgreSQL |
| Frontend | React + Vite + Tailwind CSS v4 + TanStack Query |
| Auth | JWT httpOnly cookies (access: 1h, refresh: 7d) |
| Deployment | Docker → Railway / Render |

---

## 2. Directory Structure

```
.claude/
├── commands/
│   ├── fullstack.md                     # Main pipeline orchestrator (661 lines)
│   └── report-bug.md                    # Bug reporting command
│
├── pipeline/
│   ├── phases/                          # Phase instructions (11 phases)
│   │   ├── 00-spec.md                   # Requirements interview + seed generation
│   │   ├── 01-init.md                   # Project scaffolding
│   │   ├── 02-prd.md                    # PRD generation + conversion + stories
│   │   ├── 02.5-user-stories.md         # Iterative story depth enrichment
│   │   ├── 03-design.md                 # Design guide → prompts → HTML
│   │   ├── 04-database.md              # Entity design + migrations
│   │   ├── 05-backend.md               # TDD: RED → GREEN → REFACTOR
│   │   ├── 06-frontend.md              # HTML-to-React conversion
│   │   ├── 07-integrate.md             # Wire frontend to backend API
│   │   ├── 08-test-api.md              # Smoke tests + backend test execution
│   │   ├── 09-test-browser.md          # Design QA + acceptance + exploration
│   │   └── 10-ship.md                  # Production deployment
│   │
│   ├── manifests/                       # Per-phase tool/skill/rule declarations (13 files)
│   │   ├── spec.manifest.yaml
│   │   ├── init.manifest.yaml
│   │   ├── prd.manifest.yaml
│   │   ├── user-stories.manifest.yaml
│   │   ├── design.manifest.yaml
│   │   ├── database.manifest.yaml
│   │   ├── backend.manifest.yaml
│   │   ├── frontend.manifest.yaml
│   │   ├── integrate.manifest.yaml
│   │   ├── test-api.manifest.yaml
│   │   ├── test-browser.manifest.yaml
│   │   └── ship.manifest.yaml
│   │
│   ├── loop/                            # Loop engine
│   │   ├── infinite-loop.md             # Main loop algorithm + exit conditions
│   │   ├── stagnation.md               # Stagnation detection + handler personas
│   │   ├── artifact-tracking.md         # Hash-based artifact invalidation
│   │   └── drift-monitoring.md          # Spec drift calculation
│   │
│   └── evaluation/
│       └── criteria.yaml                # Centralized scoring definitions for all phases
│
├── rules/
│   ├── common.rules.md                  # Git, code quality, documentation rules
│   ├── phases/                          # Phase-specific scope guards
│   │   ├── spec.rules.md
│   │   ├── design.rules.md
│   │   ├── database.rules.md
│   │   ├── backend.rules.md
│   │   ├── frontend.rules.md
│   │   ├── integrate.rules.md
│   │   ├── test-api.rules.md
│   │   ├── test-browser.rules.md
│   │   └── ship.rules.md
│   └── stacks/                          # Stack-specific rules
│       ├── base.rules.md               # Spec-first, design-then-build principles
│       ├── nestjs.rules.md             # Module pattern, JWT, validation, TypeORM
│       └── react.rules.md             # Vite, Tailwind, TanStack Query, functional components
│
├── blueprints/                          # Deterministic + agentic execution specs
│   ├── backend.yaml
│   ├── database.yaml
│   ├── frontend.yaml
│   ├── integrate.yaml
│   └── test-api.yaml
│
├── gates/                               # Quality gate scripts (shell)
│   ├── _gate-runner.sh                  # JSON output parser helper
│   ├── backend-gate.sh
│   ├── database-gate.sh
│   ├── design-gate.sh
│   ├── frontend-gate.sh
│   ├── integrate-gate.sh
│   ├── test-api-gate.sh
│   ├── production-test-gate.sh
│   └── ship-gate.sh
│
├── spec/                                # Ouroboros spec system
│   ├── agents/                          # 9 interview/evaluation personas
│   │   ├── ouroboros-seed-architect.md
│   │   ├── ouroboros-interviewer.md
│   │   ├── ouroboros-evaluator.md
│   │   ├── ouroboros-architect.md
│   │   ├── ouroboros-hacker.md
│   │   ├── ouroboros-simplifier.md
│   │   ├── ouroboros-contrarian.md
│   │   ├── ouroboros-researcher.md
│   │   └── ouroboros-ontologist.md
│   └── commands/ouroboros/              # Spec commands
│       ├── interview.md
│       ├── seed.md
│       ├── evaluate.md
│       ├── status.md
│       ├── evolve.md
│       ├── unstuck.md
│       └── ralph.md
│
├── skills/                              # Reusable skill definitions
│   ├── project-init.md
│   ├── generate-prd/SKILL.md
│   ├── generate-user-stories/SKILL.md
│   ├── deepen-user-stories/SKILL.md
│   ├── design/
│   │   ├── prd-to-design-guide/SKILL.md
│   │   ├── design-guide-to-prompts/SKILL.md
│   │   └── prompts-to-html/SKILL.md
│   ├── qa/
│   │   ├── smoke-test/SKILL.md
│   │   ├── acceptance-test/SKILL.md
│   │   ├── ui-review/SKILL.md
│   │   └── design-qa-validator.md
│   └── dev/
│       └── ensure-servers/SKILL.md
│
├── templates/
│   ├── PIPELINE_STATUS.template.md      # Status tracking template
│   └── claude-project/                  # Project docs/memory/status templates
│
├── nestjs/                              # [SUBMODULE] NestJS agents, guides, skills
├── react/                               # [SUBMODULE] React agents, guides, skills
│
├── stack-config.json                    # Enabled stacks configuration
└── settings.json                        # Permission settings
```

---

## 3. Pipeline Orchestrator

**File**: `commands/fullstack.md`

The main `/fullstack` command drives the entire pipeline. It accepts three execution modes:

| Mode | Flag | Behavior |
|------|------|----------|
| Single step | `--run` | Execute one phase, then stop |
| Single generation | `--run-all` | Execute all phases once (one pass through the pipeline) |
| Infinite loop | `--loop` | Iterate until convergence or stagnation |

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--max-generations` | 50 | Maximum loop iterations |
| `--quality-target` | 0.95 | Pipeline score threshold for convergence |
| `--max-iterations` | 10 | Max improvement attempts per phase |
| `--skip-spec` | false | Skip Phase 0 when PRD already exists |
| `--path <dir>` | current dir | Build project in different directory |
| `--phase <name>` | — | Target specific phase |

### Phase Execution Order

```
Phase 0: spec
    │
Phase 1: init
    │
Phase 2: prd
    │
Phase 2.5: user-stories (optional)
    │
    ├──────────────── PARALLEL FORK ──────────────────┐
    │                                                  │
Phase 3: design                                   Phase 4: database
    │                                                  │
Phase 6: frontend                                 Phase 5: backend
    │                                                  │
    └──────────────── SYNC POINT ─────────────────────┘
    │
Phase 7: integrate
    │
Phase 8: test-api
    │
Phase 9: test-browser
    │
Phase 10: ship
```

### Per-Phase Execution Flow

For each phase, the orchestrator:

1. **Load manifest** — `pipeline/manifests/{name}.manifest.yaml`
   - Determines prerequisites, rules, skills, tools, gate config
2. **Check prerequisites** — Verify required phases are complete
3. **Load rules** — Common + phase-specific + stack-specific
4. **Pre-hydrate context** — Read project docs (PRD, API, Database, Knowledge)
5. **Load phase instructions** — `pipeline/phases/{NN}-{name}.md`
6. **Execute blueprint** (if exists) — `blueprints/{name}.yaml`
7. **Run quality gate** — `gates/{name}-gate.sh`
8. **Update status** — Write results to `PIPELINE_STATUS.md`

```
Manifest ──► Prerequisites ──► Rules ──► Pre-hydrate ──► Instructions
                                                              │
                                                              ▼
                                              Blueprint (deterministic + agentic)
                                                              │
                                                              ▼
                                                    Quality Gate ──► Status Update
                                                       │
                                                ┌──────┴──────┐
                                              PASS          FAIL
                                                │             │
                                          Next phase    Retry (if --loop)
```

---

## 4. Phase-by-Phase Breakdown

### Phase 0: Spec (`00-spec.md`)

**Purpose**: Crystallize requirements via Socratic interview.

**Three entry paths**:

| Path | Condition | Behavior |
|------|-----------|----------|
| Full interview | No seed, no PRD | Run full Ouroboros interview |
| PRD gap analysis | PRD provided | Analyze PRD, fill gaps only |
| Existing seed | Seed unchanged | Skip entirely |

**Process**:
1. Ouroboros interviewer asks 5-8 diagnostic questions
2. Seed architect transforms answers into structured YAML
3. Evaluator validates: ambiguity_score must be ≤ 0.2

**Output**: `seed-{uuid}.yaml` containing:
- `goal` — What the app does
- `constraints` — Technical and business limits
- `acceptance_criteria` — How to verify success
- `ontology` — Domain model (entities, relationships, terms)

### Phase 1: Init (`01-init.md`)

**Purpose**: Scaffold project directory structure.

**Actions**:
- Initialize git repo, add `.claude` submodule
- Create `.claude-project/` (docs, memory, status, user_stories)
- Generate `.claude-rules` files from templates
- Create `PIPELINE_STATUS.md` for tracking
- Validate tech stack (backend + frontend frameworks)

**No loop workflow** — deterministic, runs once.

### Phase 2: PRD (`02-prd.md`)

**Purpose**: Generate Product Requirements Document and convert to project docs.

**Three sub-steps**:

| Step | Action | Output |
|------|--------|--------|
| 2a | Generate PRD from seed | `{PROJECT}_PRD.md` |
| 2b | Convert PRD to project docs | `PROJECT_KNOWLEDGE.md`, `PROJECT_API.md`, `PROJECT_DATABASE.md` |
| 2c | Generate user stories | YAML files in `user_stories/` |

**Gate**: `sections_complete AND feature_coverage ≥ 90% AND user_stories_exist`

### Phase 2.5: User Stories (`02.5-user-stories.md`)

**Purpose**: Iteratively deepen story coverage with edge cases.

**6-phase algorithm** (per iteration):
1. **Inventory** — Catalog existing stories
2. **Re-read** — Load referenced files
3. **Gap analysis** — Identify missing coverage (boundary, error, state, keyboard)
4. **Generate** — Write new stories for tiers 9-13
5. **Accumulate** — Append to existing story files
6. **Report** — Generate STORY_COVERAGE.md per route

**Convergence exits**:
- No new stories generated
- Saturation delta < 0.05
- Depth score ≥ 0.95
- Max 8 iterations reached

**Gate**: `story_depth_score ≥ 0.75`

### Phase 3: Design (`03-design.md`)

**Purpose**: Create design system and HTML prototypes.

**Three execution paths**:

| Path | When | Flow |
|------|------|------|
| A (default) | Full AI generation | 3a → 3b → 3c → 3d → 3e |
| B | External designer | 3a only, pause for designer input |
| C | Existing HTML | Skip 3a-3c, go to validation |

**Five sub-phases**:

| Step | Action | Output |
|------|--------|--------|
| 3a | Generate Design Guide | Colors, typography, spacing, components |
| 3b | Create design prompts | Per-screen prompt files |
| 3c | Generate HTML pages | Atomic design: atoms → molecules → organisms → pages |
| 3d | Design QA | Routing validation, consistency checks |
| 3e | Deploy preview (optional) | GitHub Pages |

**Key patterns**:
- **Style DNA extraction** — Extract consistent design tokens and cache for prefix reuse
- **Layout shell pattern** — Generate page 1 fully, reuse layout shell for remaining pages
- **Shared component consistency** — Programmatic extraction (never trust LLM for consistency)
- **Customer-flow verification** — Verify `user-app.html` has complete browsing flow

**Gate**: `all_html_generated AND routing_score ≥ 95% AND shared_consistency == 100%`

**Runs in PARALLEL with Phase 4.**

### Phase 4: Database (`04-database.md`)

**Purpose**: Design TypeORM entities and generate migrations.

**Steps**:
1. Design entities from PRD and feature specs
2. Create entity files (UUID PKs, soft deletes, proper relations)
3. Generate and run migrations
4. Validate schema compiles with no orphans

**Entity conventions**:
- UUID primary keys
- `@DeleteDateColumn()` for soft deletes
- `camelCase` for DTO properties, `snake_case` for DB columns
- Indexes on frequently queried fields

**Gate**: `schema_compiles AND no_orphans`

**Runs in PARALLEL with Phase 3.**

### Phase 5: Backend (`05-backend.md`)

**Purpose**: Implement the API using strict TDD.

**Three-step TDD cycle**:

| Step | Name | Action | Scope Guard |
|------|------|--------|-------------|
| 5a | RED | Generate failing tests from acceptance criteria | Only touch `backend/test/` |
| 5b | GREEN | Implement minimum code to pass tests | Only touch `backend/src/` |
| 5c | REFACTOR | Improve code quality, add Swagger | Only touch `backend/src/` |

**Module pattern** (per feature):
```
backend/src/modules/{feature}/
├── {feature}.entity.ts
├── {feature}.service.ts
├── {feature}.controller.ts
└── dto/
    ├── create-{feature}.dto.ts
    ├── update-{feature}.dto.ts
    └── {feature}-response.dto.ts
```

**Review step**: After TDD cycle, verify implementation matches PRD (specs vs code).

**Gate**: `tests_pass AND endpoint_coverage ≥ 90%`

**Requires Phase 4 completion** (entities must be frozen). **Runs in PARALLEL with Phase 6.**

### Phase 6: Frontend (`06-frontend.md`)

**Purpose**: Convert HTML prototypes from Phase 3 into React components.

**Steps**:
1. Locate HTML source from Phase 3 output
2. Extract shared components (Navbar, Footer, Sidebar) into React Layout
3. Convert each HTML page to a React component
4. Set up React Router matching HTML slugs
5. Verify design fidelity (React vs HTML)

**Gate**: `screen_coverage ≥ 90% AND fidelity ≥ 85%`

**Requires Phase 3 completion** (HTML must exist). **Runs in PARALLEL with Phase 5.**

### Phase 7: Integrate (`07-integrate.md`)

**Purpose**: Wire frontend to backend API.

**SYNC POINT** — waits for both Phase 5 AND Phase 6 to complete.

**Steps**:
1. Replace mock/static data with real API calls
2. Create TanStack Query hooks for each endpoint
3. Implement auth flow (login, register, token refresh)
4. Add error handling (401, 403, 404, 500)
5. Add loading states and empty states
6. Enforce type safety (no `any` types)

**Gate**: `api_connection_rate ≥ 95%`

### Phase 8: Test API (`08-test-api.md`)

**Purpose**: Smoke test + backend test execution.

**Three steps**:

| Step | Action | Blocking? |
|------|--------|-----------|
| 1 | Smoke test all routes via Playwright CLI | Yes — must pass before continuing |
| 2 | Execute backend API tests (Jest + Supertest) | Yes |
| 3 | Fix failures iteratively (max 2 fix rounds) | — |

**Stability requirement**: Tests must pass **3 out of 3** consecutive runs (no flaky tests).

**Critical rule**: Tests that compile but don't execute score **0.0**.

**Gate**: `smoke_pass AND backend_tests_pass AND no_flaky`

### Phase 9: Test Browser (`09-test-browser.md`)

**Purpose**: Comprehensive live browser testing.

**Four sub-phases**:

| Step | Name | Action | Target |
|------|------|--------|--------|
| 9-pre | Seed data | Verify test users exist (or mark auth stories BLOCKED) | — |
| 9a | Design QA | Compare React vs HTML fidelity | ≥ 85% |
| 9b-deepen | Story enrichment | Auto-deepen stories (in `--loop` mode) | — |
| 9b | Acceptance | Execute YAML user stories via Playwright | ≥ 80% (excluding BLOCKED) |
| 9c | Exploration | Autonomous edge-case discovery | No P0/P1 bugs |

**Scoring weights**:

| Category | Weight |
|----------|--------|
| Design fidelity | 25% |
| Acceptance pass rate | 35% |
| Exploration (no P0/P1) | 20% |
| Regression (no regressions) | 10% |
| Story depth | 10% |

**Console error budget**: 0 errors for public routes, max 10 for authenticated routes.

**CRASHED stories count as FAIL** (app/infra bug, not test bug).

**Gate**: `combined_score ≥ 0.95`

### Phase 10: Ship (`10-ship.md`)

**Purpose**: Deploy to production.

**Steps**:
1. Production build verification (frontend + backend)
2. Environment variable validation
3. Calculate specification drift
4. Deploy (docker-compose, cloud platform, or custom)

**Drift calculation**: `0.5 × goal_drift + 0.3 × constraint_drift + 0.2 × ontology_drift`

| Drift Score | Action |
|-------------|--------|
| ≤ 0.1 | Ship confidently |
| 0.1 – 0.2 | Document changes, ship |
| 0.2 – 0.4 | Ask user: evolve spec, fix code, or re-interview |
| > 0.4 | STOP — needs major redesign |

**No loop workflow** — deterministic deployment.

---

## 5. Rules System

Rules enforce coding standards and phase boundaries. They are loaded per-phase based on the manifest configuration.

### Rule Categories

#### Common Rules (`rules/common.rules.md`)

| Category | Rules |
|----------|-------|
| Git | Feature branches from `dev`, PR to `dev`, conventional commits |
| Code quality | No `console.log`, no `any` types, no commented-out code |
| Documentation | Update PROJECT_API.md, PROJECT_DATABASE.md, PROJECT_KNOWLEDGE.md |

#### Stack Rules (`rules/stacks/`)

| File | Key Rules |
|------|-----------|
| `base.rules.md` | Spec-first, design-then-build, incremental evaluation |
| `nestjs.rules.md` | Module pattern (entity → service → controller), JWT httpOnly cookies, class-validator, HttpException subclasses |
| `react.rules.md` | Functional components only, Vite + TypeScript strict, Tailwind v4 (no inline styles), TanStack Query for data fetching, React.memo for expensive renders |

#### Phase Rules (`rules/phases/`)

Each phase has a scope guard defining what CAN and CANNOT be modified:

| Phase | CAN Modify | CANNOT Modify |
|-------|-----------|---------------|
| spec | Seed files only | Any code files |
| design | HTML files, design guide | Backend, frontend code |
| database | Entity files, migrations | Backend services, frontend |
| backend (RED) | `backend/test/` only | `backend/src/`, frontend |
| backend (GREEN) | `backend/src/` only | `backend/test/`, frontend |
| frontend | `frontend/app/` only | Backend, HTML/design files |
| integrate | Frontend API calls only | Backend controllers, entities |
| test-api | Test files, bug fixes | Feature additions |
| test-browser | Bug fixes (both layers) | Feature additions |
| ship | Config, env files | Code changes |

---

## 6. Blueprints

**Location**: `blueprints/`

Blueprints define execution plans that interleave **deterministic nodes** (shell commands, verifiable) with **agentic nodes** (LLM tasks, creative). This ensures reproducibility where possible while allowing AI flexibility where needed.

### Available Blueprints

#### `backend.yaml`

```
pre-check → generate-tests (RED) → verify-red → implement (GREEN)
    → lint-fix → typecheck → verify-green → refactor → review → gate
```

- **Deterministic**: pre-check, verify-red, lint-fix, typecheck, verify-green, gate
- **Agentic**: generate-tests, implement, refactor, review
- **TDD isolation**: Test writer and implementer are separated (different scope guards)

#### `database.yaml`

```
pre-check → design-schema → typecheck → gate
```

- Validates entity files compile, naming conventions correct, indexes present

#### `frontend.yaml`

```
pre-check → convert (HTML→React) → lint-fix → typecheck → build → gate
```

- Validates TypeScript compiles and production build succeeds

#### `integrate.yaml`

```
pre-check → integrate (wire APIs) → typecheck → gate
```

- Validates backend controllers exist, frontend pages exist, API calls properly wired

#### `test-api.yaml`

```
pre-check → ensure-servers → smoke-test → run-backend-tests → gate
```

- Validates servers running, all routes load, backend tests pass 3/3

### Error Handling in Blueprints

When a deterministic node fails:
1. First failure → attempt automatic fix (lint, type errors)
2. Second failure → **stop** (max 2 fix rounds — diminishing returns principle)

---

## 7. Quality Gates

**Location**: `gates/`

Shell scripts that validate phase output. Each gate outputs structured JSON:

```json
{
  "gate": "backend",
  "checks": [
    { "name": "endpoint_coverage", "passed": true, "value": 0.92, "threshold": 0.90 },
    { "name": "tests_pass", "passed": true, "value": 0.87, "threshold": 0.80 }
  ],
  "score": 0.895,
  "summary": "Backend gate passed (89.5%)",
  "passed": true
}
```

### Gate Thresholds

| Gate | Checks | Pass Condition |
|------|--------|---------------|
| `design-gate.sh` | Pages exist, routing valid, shared consistency | routing ≥ 95%, consistency = 100% |
| `database-gate.sh` | Schema compiles, no orphan entities | All pass |
| `backend-gate.sh` | Endpoint coverage, test pass rate, HTTP status | coverage ≥ 90%, tests pass |
| `frontend-gate.sh` | Component count, design fidelity | fidelity ≥ 85% |
| `integrate-gate.sh` | API connection rate, error handling | connection ≥ 95% |
| `test-api-gate.sh` | Smoke pass, backend tests, stability (3/3) | All pass, no flaky |
| `production-test-gate.sh` | Pre-flight, design fidelity, acceptance rate, chaos resilience, security, accessibility, ship config | production_score ≥ 0.97 |
| `ship-gate.sh` | Build success, drift score | drift ≤ 0.2 |

`_gate-runner.sh` is a helper that parses JSON output from individual gate scripts.

---

## 8. Evaluation Criteria

**File**: `pipeline/evaluation/criteria.yaml`

Centralized scoring definitions for all 11 phases. For each phase, defines:

| Field | Purpose |
|-------|---------|
| `checks[]` | Specific verification questions (e.g., "endpoint_coverage ≥ 90%?") |
| `gate` | Boolean pass condition expression |
| `method` | How to evaluate (e.g., "Compare PRD endpoints vs controller routes") |
| `scoring` | Weight breakdown for multi-dimensional phases |

**Example — Phase 5 (Backend)**:
- Checks: `all_endpoints_exist`, `dtos_match_spec`, `error_handling`, `tests_generated`, `tests_compile`, `crud_coverage`
- Gate: `endpoint_coverage >= 90% AND tests_generated`
- Method: Compare PROJECT_API.md endpoints vs controller route definitions

**Example — Phase 9 (Test Browser)**:
- Scoring weights: design (25%) + acceptance (35%) + exploration (20%) + regression (10%) + depth (10%)
- Gate: `combined_score >= 0.95`

---

## 9. Loop Engine

**Location**: `pipeline/loop/`

The loop engine powers `--loop` mode, enabling autonomous iterative improvement across multiple generations.

### Infinite Loop Algorithm (`infinite-loop.md`)

```
for generation in 1..max_generations:
    │
    ├── Identify phases needing work (score < target OR failed)
    │
    ├── Execute phases (with auto-improvement loops per phase)
    │   ├── Run phase
    │   ├── Evaluate via gate
    │   ├── If FAIL and iterations < max: improve and retry
    │   └── If PASS: advance
    │
    ├── Calculate generation_score = average(all phase scores)
    │
    ├── Log to PIPELINE_STATUS.md Generation Log
    │
    ├── Check exit conditions:
    │   ├── CONVERGED: pipeline_score ≥ quality_target (default 0.95)
    │   ├── STAGNATION: same score for 3 generations
    │   ├── MAX_GENERATIONS: reached limit (default 50)
    │   └── USER_STOP: user interrupts
    │
    └── If continuing:
        ├── Reset failed phases
        └── Check artifact invalidation (cascade downstream)
```

**Parallelization within loop**: After Phase 2, phases 3+4 run in parallel, then 5+6 run in parallel.

### Stagnation Detection (`stagnation.md`)

Three patterns detected:

| Pattern | Signal | Response |
|---------|--------|----------|
| **SPINNING** | Same score 3 consecutive times | Load **hacker** persona — try different approach |
| **OSCILLATING** | Score alternates (up-down-up) | Load **architect** persona — architectural problem |
| **PLATEAU** | < 0.01 improvement per generation | Load **simplifier** persona — may be acceptable |

**Spec evolution trigger**: When `pipeline_score > 0.7` and stagnant for 2+ generations → run `/ouroboros:evolve` to mutate the spec.

### Artifact Tracking & Invalidation (`artifact-tracking.md`)

Tracks file hashes across generations. When an artifact changes, downstream artifacts are invalidated:

```
seed YAML ──────────► ALL downstream phases
PRD ────────────────► design, database, backend, frontend
Design Guide ───────► HTML, frontend
HTML pages ─────────► frontend
Entity files ───────► backend (services, controllers)
Backend controllers ► integration
```

**Invalidation behavior**: Set affected phases to "Needs Review" (not "Failed"), re-evaluate in the next generation.

### Drift Monitoring (`drift-monitoring.md`)

Measures how far the implementation has drifted from the original spec:

```
drift_score = 0.5 × goal_drift + 0.3 × constraint_drift + 0.2 × ontology_drift
```

| Drift | Action |
|-------|--------|
| ≤ 0.1 | Ship confidently |
| 0.1 – 0.2 | Document changes, ship |
| 0.2 – 0.4 | Ask user: evolve spec, fix code, or re-interview |
| > 0.4 | STOP — needs major redesign |

Checked at Phase 10 and between generations in `--loop` mode.

---

## 10. Spec System (Ouroboros)

**Location**: `spec/`

A 9-agent interview and evaluation system that transforms vague requirements into structured, unambiguous seed documents.

### Agent Personas

| Agent | Role |
|-------|------|
| **Seed Architect** | Transforms interview answers → structured seed YAML |
| **Interviewer** | Conducts Socratic 5-8 question interview |
| **Evaluator** | 3-stage verification (mechanical → semantic → consensus) |
| **Architect** | Identifies structural problems, proposes redesign |
| **Hacker** | "Make it work first" pragmatism — breaks through blockers |
| **Simplifier** | MVP cutting, scope reduction |
| **Contrarian** | "What if we're solving the wrong problem?" |
| **Researcher** | Deep investigation, root cause analysis |
| **Ontologist** | Domain model questioning, term clarification |

### Commands

| Command | Purpose |
|---------|---------|
| `interview.md` | Run 5-8 question interview → reduce ambiguity to ≤ 0.2 |
| `seed.md` | Generate YAML seed from interview answers |
| `evaluate.md` | 3-stage verification: Stage 1 (mechanical checks) → Stage 2 (semantic) → Stage 3 (consensus, if triggered) |
| `status.md` | Check current pipeline state + drift from spec |
| `evolve.md` | Mutate spec when pipeline is stagnant |
| `unstuck.md` | Break through stagnation with alternative approaches |
| `ralph.md` | Persistent verify/fix loops |

### Evaluation Pipeline

```
Stage 1: Mechanical
  ├── Seed structure valid?
  ├── All required fields present?
  └── Acceptance criteria testable?
         │
         ▼
Stage 2: Semantic
  ├── Goal achievable with constraints?
  ├── Ontology complete?
  └── No contradictions?
         │
         ▼ (only if scores diverge)
Stage 3: Consensus
  ├── Multiple agents debate
  └── Reach agreement on final score
```

---

## 11. Skills

**Location**: `skills/`

Reusable, composable skill definitions invoked by phases.

### Skill Inventory

| Category | Skill | Used By |
|----------|-------|---------|
| **Init** | `project-init.md` | Phase 1 |
| **PRD** | `generate-prd/SKILL.md` | Phase 2a |
| **PRD** | `generate-user-stories/SKILL.md` | Phase 2c |
| **Stories** | `deepen-user-stories/SKILL.md` | Phase 2.5, 9b-deepen |
| **Design** | `prd-to-design-guide/SKILL.md` | Phase 3a |
| **Design** | `design-guide-to-prompts/SKILL.md` | Phase 3b |
| **Design** | `prompts-to-html/SKILL.md` | Phase 3c |
| **QA** | `smoke-test/SKILL.md` | Phase 8 |
| **QA** | `acceptance-test/SKILL.md` | Phase 9b |
| **QA** | `ui-review/SKILL.md` | Phase 9a |
| **QA** | `design-qa-validator.md` | Phase 3d, 9a |
| **Dev** | `ensure-servers/SKILL.md` | Phase 8, 9 |

### Stack Submodule Skills

Additional skills are provided by the NestJS and React submodules:

- **NestJS** (`nestjs/skills/`): API development, test generation, module scaffolding
- **React** (`react/skills/`): HTML-to-React conversion, API integration, component patterns

---

## 12. Phase Manifests

**Location**: `pipeline/manifests/`

Each phase has a YAML manifest that declares its full configuration. This is the single place where a phase's dependencies, rules, tools, and gates are defined.

### Manifest Structure

```yaml
# Example: backend.manifest.yaml
display_name: "Backend Development"
prerequisites: [database]

rules:
  - rules/common.rules.md
  - rules/phases/backend.rules.md
  - rules/stacks/nestjs.rules.md

pre_hydrate:
  - .claude-project/docs/PROJECT_API.md
  - .claude-project/docs/PROJECT_DATABASE.md
  # + existing code patterns

skills:
  primary: api-development
  secondary: [test-generation]
  agents: [backend-developer]

tools:
  allowed: [Read, Write, Edit, Bash, Glob, Grep]
  denied: [WebSearch]
  mcp: []

gate:
  script: gates/backend-gate.sh
  threshold: 0.9
  criteria:
    - endpoint_coverage >= 0.90
    - tests_generated == true

ralph:  # /ralph workflow (if applicable)
  enabled: true
  max_iterations: 5
```

### Key Manifest Fields

| Field | Purpose |
|-------|---------|
| `display_name` | Human-readable phase name |
| `prerequisites` | Phases that must complete first |
| `rules[]` | Rule files to load (scope guards, stack rules) |
| `pre_hydrate` | Files to read before agent starts (context injection) |
| `skills` | Primary, secondary, and agent assignments |
| `tools` | Allowed/denied tools, MCP integrations (Playwright, etc.) |
| `gate` | Gate script path, pass threshold, evaluation criteria |
| `ralph` | /ralph verify-fix loop configuration |

---

## 13. Templates

**Location**: `templates/`

### PIPELINE_STATUS.template.md

The main status tracking file created per project:

| Section | Content |
|---------|---------|
| Header | Project name, created date, last run, generation count |
| Scores | Pipeline score, quality target, seed ID, tech stack |
| Progress table | Phase \| Status \| Score \| Output \| Loop Runs |
| Artifact hashes | File path \| Hash (for invalidation detection) |
| Generation log | Gen \| Score \| Phases Run \| Duration \| Exit Reason |
| Execution log | Free-text log of actions taken |

### Project Templates (`templates/claude-project/`)

Templates for initializing a new project's `.claude-project/` directory:

| Category | Templates |
|----------|-----------|
| `docs/` | PROJECT_API.md, PROJECT_DATABASE.md, PROJECT_KNOWLEDGE.md, PROJECT_API_INTEGRATION.md |
| `memory/` | DECISIONS.md, LEARNINGS.md, PREFERENCES.md |
| `status/` | Per-layer (backend, frontend, mobile) implementation + integration + E2E QA tracking |
| `hooks/` | README template for project-local hooks |
| `agents/` | README template for project-local agents |
| `skills/` | README template for project-local skills |

---

## 14. Configuration

### stack-config.json

```json
{
  "version": "2.0",
  "enabledStacks": ["base", "nestjs", "react"],
  "enabledTeamModules": [],
  "availableTeamModules": []
}
```

Determines which stack rules and guides are loaded at runtime. Adding a new stack (e.g., Django, Next.js) requires adding it here and providing corresponding `rules/stacks/{name}.rules.md`.

### settings.json

Global permission configuration:
- Allows: Bash, git operations
- Default mode: `acceptEdits`
- Additional directories for multi-frontend projects

---

## Quick Reference

### File Lookup by Purpose

| Need to understand... | Read this file |
|----------------------|----------------|
| Overall pipeline flow | `commands/fullstack.md` |
| What a specific phase does | `pipeline/phases/{NN}-{name}.md` |
| What rules apply to a phase | `pipeline/manifests/{name}.manifest.yaml` → follow rule paths |
| How quality is measured | `pipeline/evaluation/criteria.yaml` |
| How gates validate output | `gates/{name}-gate.sh` |
| How the loop works | `pipeline/loop/infinite-loop.md` |
| How stagnation is handled | `pipeline/loop/stagnation.md` |
| How specs are created | `spec/commands/ouroboros/interview.md` + `seed.md` |
| How artifacts cascade | `pipeline/loop/artifact-tracking.md` |
| NestJS coding rules | `rules/stacks/nestjs.rules.md` |
| React coding rules | `rules/stacks/react.rules.md` |
| Phase scope boundaries | `rules/phases/{name}.rules.md` |

### Counts

| Dimension | Count |
|-----------|-------|
| Pipeline phases | 11 (+ Phase 2.5 optional) |
| Phase manifests | 13 |
| Phase rules | 9 |
| Stack rules | 3 (base, nestjs, react) |
| Gate scripts | 8 + 1 runner |
| Blueprints | 5 |
| Spec agents | 9 |
| Spec commands | 7 |
| Skills | 15+ |
| Loop engine files | 4 |
