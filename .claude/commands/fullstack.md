---
description: Build any product from idea to deployment with infinite iteration loops
argument-hint: "<project> [--run | --loop | --phase <name> [--loop] | --reset <phase> | --adopt | --update --prd <path>] [--run-all] [--skip-spec] [--prd <path>] [--path <dir>] [--frontend <name>]"
---

# Fullstack Pipeline Orchestrator v3

An infinite-iteration product builder that combines specification-first thinking, phase-by-phase construction, and autonomous improvement loops. Each generation gets smarter.

```
SPECIFY --> DESIGN --> BUILD --> EVALUATE --> IMPROVE --> EVOLVE
   ^                                                      |
   +----------------- next generation -------------------+
```

## Quick Start

```bash
# Show pipeline status
/fullstack my-project

# Run next pending phase (single step)
/fullstack my-project --run

# Run all phases once (single generation)
/fullstack my-project --run-all

# INFINITE LOOP MODE - keep improving until quality converges
/fullstack my-project --loop
/fullstack my-project --loop --max-generations 10

# Run specific phase
/fullstack my-project --phase backend

# Loop a specific phase until it converges
/fullstack my-project --phase test-api --loop
/fullstack my-project --phase test-api --loop --max-iterations 5

# Skip specification phase (already have clear PRD)
/fullstack my-project --run-all --skip-spec

# Reset a phase to pending
/fullstack my-project --reset database

# BUILD IN A DIFFERENT FOLDER (remote project)
/fullstack tirebank --path /Users/me/projects/tirebank --prd .claude-project/prd/ABCTire_PRD.md --run-all --skip-spec

# ADOPT an existing project (audit artifacts, skip completed phases)
/fullstack my-project --adopt
/fullstack my-project --adopt --run-all

# UPDATE with new PRD (incremental changes only)
/fullstack my-project --update --prd path/to/new-prd.md
/fullstack my-project --update --prd path/to/new-prd.md --run-all
```

---

## Pipeline Phases

| # | Phase | What It Does | Prerequisites | Quality Gate | Loop Command |
|---|-------|-------------|---------------|--------------|--------------|
| 0a | audit | Scan existing project artifacts (--adopt/--update only) | - | all phases classified | - |
| 0b | prd-diff | Diff old vs new PRD, generate change plan (--update only) | audit | change plan written | - |
| 0 | spec | Crystallize requirements via interview + seed | - | ambiguity <= 0.2 | `--phase spec --loop` |
| 1 | init | Project scaffolding | spec | dirs exist | - |
| 2 | prd | Generate PRD + convert to project docs + generate user stories | init | all sections present, features mapped, user stories generated | `--phase prd --loop` |
| 3 | design | Create design guide + 3-variation preview + client confirmation + full HTML generation | prd | pages complete, routing valid, consistency 100%, client approved | `--phase design --loop` |
| 3.5 | user-stories | Deepen user story coverage via iterative gap analysis | design (confirmed) | story_depth_score >= 0.75 | `--phase user-stories --loop` |
| 4 | database | Design schema from spec | prd | schema compiles, no orphans | `--phase database --loop` |
| 5 | backend | TDD: Generate failing tests → implement to pass → refactor → review | database | AC compliance >= 90%, tests pass >= 80% | `--phase backend --loop` |
| 6 | frontend | Convert HTML designs to React components | design (confirmed) | screen coverage >= 90%, fidelity >= 85% | `--phase frontend --loop` |
| 7 | integrate | Wire frontend to backend | backend, frontend | all APIs connected | `--phase integrate --loop` |
| 8 | test-api | Run backend API tests | integrate | backend tests pass >= 80% | `--phase test-api --loop` |
| 9 | test-browser | Design QA + YAML user story acceptance + autonomous exploration + UX heuristic scan | test-api | 0.95 (dev) / 0.97 (prod) | `--phase test-browser --loop` |
| 10 | ship | Deploy to target environment | test-browser | drift <= 0.2 | - |

### Design-then-Build Pipeline (Parallelization)

```
Phase 2 (prd) Complete
        |
   +----+--------+
   |              |
Phase 3 (design) Phase 4 (database)   ← Parallel right after PRD (DB uses PRD as source of truth)
   |              |
   ⏸ 3d confirm  Phase 5 (backend)     ← only needs database
   |              |
   3e full HTML   |
   3f QA          |
   3g upload      |
   phase_complete |
   |              |
   +----+----+    |
   |         |    |
Phase 3.5  Phase 6 (frontend)         ← Starts after Phase 3 is FULLY complete (phase_complete: true)
(stories)    |    |                      ⚠️ Cannot start 3.5 while 3e HTML generation is in progress
   |         +----+
   |              |
   |        Phase 7 (integrate)        ← sync: frontend + backend
   |              |
   |        Phase 8 (test-api)
   |              |
   +------+-------+
          |
    Phase 9 (test-browser)             ← sync: stories (3.5) + test-api (8)
          |
    Phase 10 (ship)
```

**Parallelization Rules** (in `--run-all` mode):
- After Phase 2: Phase 3 (design) + Phase 4 (database) launch in parallel — DB depends on PRD only, not design
- Phase 4 → Phase 5 (backend) proceeds independently of design confirmation
- At Phase 3 sub-phase 3d, pipeline **PAUSES** for client to choose from 3 design variations (A/B/C)
- After confirmation: Phase 3.5 (user-stories) + Phase 6 (frontend) launch
- **⚠️ Phase 6 (frontend) BLOCKS until design is approved** — enforced by `design-approval-check` in frontend blueprint
- **⚠️ Phase 9 (test-browser) BLOCKS until Phase 3.5 is complete** — enforced by `user-stories-check` deterministic node in test-browser blueprint
- **Phase 3.5 has its own gate**: `bash gates/user-stories-gate.sh {TARGET_DIR}` — validates story files exist, depth score >= 0.75, no duplicates
- `--skip-review` flag: auto-selects variation A (developer-only, skips client confirmation)

### Test & QA Timeline

```
Phase 2 (prd)            → User story YAML files generated (.claude-project/user_stories/*.yaml)
Phase 3.5 (user-stories) → Iterative depth enrichment: boundary, error, state, keyboard, bug-pattern tiers 9-14 (via --phase user-stories --loop)
Phase 5 (backend)        → TDD cycle: 5a RED (tests from specs) → 5b GREEN (implement) → 5c REFACTOR → REVIEW
Phase 8 (test-api)       → Backend API test suite execution (via --phase test-api --loop)
```

---

## Architecture: Modular Pipeline

This orchestrator is a **thin controller** that delegates to modular files. Phase instructions, rules, manifests, and loop engine components live in separate files — loaded conditionally based on which phase is active.

### File Layout

```
.claude/
├── commands/fullstack.md            ← THIS FILE (orchestrator core)
├── pipeline/
│   ├── phases/                      ← Phase-specific instructions
│   │   ├── 00a-audit.md
│   │   ├── 00b-prd-diff.md
│   │   ├── 00-spec.md
│   │   ├── 01-init.md
│   │   ├── 02-prd.md
│   │   ├── 03.5-user-stories.md
│   │   ├── 03-design.md
│   │   ├── 04-database.md
│   │   ├── 05-backend.md
│   │   ├── 06-frontend.md
│   │   ├── 07-integrate.md
│   │   ├── 08-test-api.md
│   │   ├── 09-test-browser.md
│   │   └── 10-ship.md
│   ├── manifests/                   ← Per-phase tool/skill/context declarations
│   │   ├── spec.manifest.yaml
│   │   ├── init.manifest.yaml
│   │   ├── ... (one per phase)
│   │   └── ship.manifest.yaml
│   ├── loop/                        ← Loop engine components
│   │   ├── infinite-loop.md         ← RL-enhanced loop algorithm
│   │   ├── reward.yaml              ← Reward function config (shift-left, severity weights)
│   │   ├── state-log.yaml           ← State vector schema (per-generation tracking)
│   │   ├── policy-memory.md         ← Policy memory system documentation
│   │   ├── policy-memory-global.yaml ← Cross-project learned policy
│   │   ├── stagnation.md
│   │   ├── artifact-tracking.md
│   │   └── drift-monitoring.md
│   └── evaluation/
│       └── criteria.yaml            ← All phase scoring criteria + RL reference
├── rules/                           ← Conditionally-loaded rules
│   ├── common.rules.md              ← Always loaded
│   ├── phases/                      ← Loaded per active phase
│   │   ├── spec.rules.md
│   │   ├── design.rules.md
│   │   ├── ... (one per phase)
│   │   └── ship.rules.md
│   └── stacks/                      ← Loaded per tech stack
│       ├── nestjs.rules.md
│       ├── react.rules.md
│       └── base.rules.md
├── blueprints/                      ← Deterministic + agentic hybrid execution
│   ├── backend.yaml
│   ├── database.yaml
│   ├── frontend.yaml
│   ├── integrate.yaml
│   └── test-api.yaml
└── gates/                           ← Quality gate scripts
    ├── _gate-runner.sh
    └── {phase}-gate.sh
```

### Manifest `ralph` Fields

Phase manifests may include a `ralph:` section with named workflows (e.g., `workflow: backend-qa`). These are consumed by the `/ralph` command for persistent verify/fix loops — they are **not** standalone workflow files. The `/ralph` command reads the manifest, resolves the workflow name to phase skills, and runs iterative fix cycles. See `/ralph` command for details.

### Why Modular? (Stripe Minions Insight)

Stripe's Minions system uses **conditional rules by subdirectory** — rules load based on where the agent works, not globally. This prevents context window bloat and cross-phase contamination (e.g., backend rules don't apply during design).

Our implementation:
1. **Phase-scoped rules** with scope guards ("ONLY modify files under backend/src/")
2. **Phase manifests** declaring tools, skills, guides, and pre-hydration context
3. **Context pre-hydration** — read relevant files BEFORE agent starts, not during

---

## Execution Instructions

### Step 1: Parse Arguments

```
project = $1 (e.g., "my-project")
action = --run | --loop | --phase <name> [--loop] | --reset <name> | --run-all | (none = status)
max_generations = --max-generations <n> (default: 50, used with --loop)
max_iterations = --max-iterations <n> (default: 10, used with --phase <name> --loop)
skip_spec = --skip-spec flag (skip Phase 0 specification)
prd_path = --prd <path> (existing PRD file, skips PRD generation in Phase 2)
quality_threshold = --quality <n> (default: 0.95, convergence target for --loop)
target_path = --path <dir> (target project directory, default: current working directory)
frontend_name = --frontend <name> (target specific frontend from tech_stack.frontends[], default: frontends[0])
adopt = --adopt flag (adopt existing project, audit artifacts, skip completed phases)
update = --update flag (update existing project with new PRD, incremental changes)
skip_review = --skip-review flag (auto-select variation A in Phase 3 design confirmation, developer-only)
```

If no project is provided, ask using **AskUserQuestion**: "What is the project name?"

### Step 1.5: Resolve Target Project Directory

```
IF --path is provided:
  TARGET_DIR = resolve to absolute path
  Verify TARGET_DIR exists → if not, mkdir -p TARGET_DIR
  ALL file operations use TARGET_DIR as root (not cwd)
  Skills/agents: still read from cwd's .claude/ (the source project)
  If --prd path is relative, resolve from cwd (not TARGET_DIR)
ELSE:
  TARGET_DIR = cwd
```

### Step 1.6: PRD Pre-Read (Large File Enforcement)

**⚠️ MANDATORY when --prd is provided.** Run via Bash tool BEFORE any agentic work begins.

The PRD **must be read in its entirety** regardless of size. The pattern where an agent says "the PRD file is very large" and then only partially reads it is prohibited.

```
CASE 1: --prd not provided AND no existing PRD_chunk_*.md files
  → Skip this step entirely. Phase 0 runs full interview. PRD gets generated in Phase 2.

CASE 2: --prd provided
  1. Resolve prd_path to absolute path (relative → from cwd, not TARGET_DIR)
  2. Check file exists: if NOT found → warn "PRD file not found at {prd_path}" and STOP
  3. Run Bash to split into 400-line chunks:
       CHUNK_DIR="{TARGET_DIR}/.claude-project/context"
       mkdir -p "$CHUNK_DIR"
       rm -f "$CHUNK_DIR"/PRD_chunk_*.md

       TMP="$CHUNK_DIR/prd_raw.txt"
       if [[ "{prd_path}" == *.pdf ]]; then
         if command -v pdftotext &>/dev/null; then
           pdftotext -layout "{prd_path}" "$TMP"
         else
           echo "[PDF_FALLBACK] ORIGINAL_PATH={prd_path}" > "$CHUNK_DIR/PRD_chunk_00.md"
           echo "PRD_FALLBACK: pdftotext not available"
           exit 0
         fi
       else
         cp "{prd_path}" "$TMP"
       fi

       split -l 400 -d --additional-suffix=.md "$TMP" "$CHUNK_DIR/PRD_chunk_"
       rm -f "$TMP"
       echo "PRD split into $(ls "$CHUNK_DIR"/PRD_chunk_*.md | wc -l) chunks"

  4. ALL phases read from PRD_chunk_*.md (never original file, never single Read):
     - Chunks are pre-injected into agent context via manifest pre_hydrate before agent starts
     - PDF fallback: if chunk_00 contains [PDF_FALLBACK] → agent uses Read tool on ORIGINAL_PATH with pages parameter

CASE 3: --prd not provided BUT PRD_chunk_*.md files already exist
  → Chunks already created from a previous run. Reuse as-is.

  ❌ Prohibited: reading the original PRD in a single Read
  ❌ Prohibited: saying "the PRD file is very large" and only extracting key points
  ✅ No PRD_chunk_*.md + no --prd = interview mode, skipping this step is normal
```

### Step 2: Locate or Create Status File

Status file path: `{TARGET_DIR}/.claude-project/status/{project}/PIPELINE_STATUS.md`

If status file doesn't exist:
1. Copy template from `.claude/templates/PIPELINE_STATUS.template.md`
2. Replace `{PROJECT_NAME}` with actual project name
3. Set all phases to `Pending`, generation: 1

### Step 2.5: Resolve and Validate Tech Stack

Read `tech_stack` from PIPELINE_STATUS.md:
```yaml
tech_stack:
  backend: nestjs
  frontends: [react]
```

Set variables:
- `$BACKEND` = tech_stack.backend
- `$FRONTEND` = if `--frontend` flag provided, use that name; otherwise tech_stack.frontends[0]

Validate `.claude/$BACKEND/` and `.claude/$FRONTEND/` directories exist.

**Multi-frontend projects** (e.g., frontend/ + frontend-admin-dashboard/): Run fullstack separately per frontend using `--frontend`. Dashboard builds can use `.claude/react/skills/builders/dashboard-builder.md`.

**Dashboard workflow**: The `dashboards` field in PIPELINE_STATUS.md lists admin/coach dashboards. Each dashboard is a separate frontend that follows the same pipeline phases (design → frontend → integrate → test). Run with:
```bash
/fullstack my-project --frontend frontend-admin-dashboard --phase frontend --loop
```

### Step 2.7: Handle Adopt/Update Modes

```
IF --adopt OR --update:
  1. Execute Phase 0a (Audit):
     Read: .claude/pipeline/phases/00a-audit.md
     Follow its instructions to scan project artifacts and classify phases
     Update PIPELINE_STATUS.md with audit results and feature inventory
     Set mode = "adopt" or "update" in PIPELINE_STATUS.md

  IF --update:
    2. Execute Phase 0b (PRD Diff):
       Read: .claude/pipeline/phases/00b-prd-diff.md
       Follow its instructions to diff old vs new PRD
       Generate scoped change plan in PIPELINE_STATUS.md
       Set affected phases to Pending, keep unaffected as Complete

  IF --adopt (without --update):
    2. Set COMPLETE phases to Complete in status
       Set PARTIAL/MISSING phases to Pending
       Continue with normal --run or --loop from first Pending phase

  THEN: proceed to Step 3 (action handler) — only Pending phases will execute
```

### Skill Path Resolution

```
Phase -> Tier -> Skill Path
---------------------------
audit     -> core     -> .claude/pipeline/phases/00a-audit.md
prd-diff  -> core     -> .claude/pipeline/phases/00b-prd-diff.md
spec      -> spec     -> .claude/spec/commands/ouroboros/interview.md + seed.md
init      -> core     -> .claude/skills/operation/phase-1-init.md
prd       -> core     -> .claude/skills/dev/generate-prd/SKILL.md
                      -> .claude/$BACKEND/guides/workflow-convert-prd-to-knowledge.md
                      -> .claude/skills/dev/generate-user-stories/SKILL.md
user-stories -> core  -> .claude/skills/dev/deepen-user-stories/SKILL.md
design    -> core     -> 3a: .claude/skills/design/prd-to-design-guide/SKILL.md
                      -> 3b: .claude/skills/design/design-guide-to-prompts/SKILL.md
                      -> 3c: .claude/skills/design/generate-html/SKILL.md
database  -> $BACKEND -> .claude/$BACKEND/guides/workflow-design-database.md
backend   -> $BACKEND -> .claude/$BACKEND/skills/api-development/SKILL.md
frontend  -> $FRONT   -> .claude/$FRONTEND/skills/converters/html-to-react-converter.md
integrate -> $FRONT   -> .claude/$FRONTEND/skills/api-integration/SKILL.md
test-api  -> both     -> pre: .claude/skills/dev/ensure-servers/SKILL.md (verify servers running)
                      -> backend: .claude/$BACKEND/guides/workflow-generate-e2e-tests.md
test-browser -> $FRONT -> pre: .claude/skills/dev/ensure-servers/SKILL.md (verify servers running)
                       -> pre: .claude/$BACKEND/skills/database-seeding/SKILL.md (seed check)
                       -> .claude/$FRONTEND/skills/qa/design-qa-html.md
                       -> acceptance: .claude/skills/qa/test-acceptance/SKILL.md
                       -> ux-scan: .claude/skills/qa/scan-ux/SKILL.md
ship      -> core     -> .claude/pipeline/phases/10-ship.md (phase instructions serve as skill)
```

### Step 3: Action Handler

#### Action: (none) — Show Status

Display current pipeline state with resolved skill paths:
```
Fullstack Pipeline - {project} (Generation {N})
================================================

Phase        | Status    | Score | Output            | Loop Runs
-------------|-----------|-------|-------------------|----------
spec         | Complete  | 0.95  | seed-abc.yaml     | 0
...

Pipeline Score: 0.68 (target: 0.95)

Next Phase: backend
  Skill: .claude/$BACKEND/skills/api-development/SKILL.md
  Blueprint: .claude/blueprints/backend.yaml
  Gate: .claude/gates/backend-gate.sh
  Prerequisites: database (Complete ✓)
  Run: /fullstack {project} --run
```

#### Action: --run — Execute Next Phase

Find first phase where Status = `Pending` or `Failed` and prerequisites met → Execute (Step 4).

#### Action: --run-all — Single Generation

Execute all phases sequentially (or parallel where allowed). Stop on failure.

**PRD-first parallelization**: After Phase 2 (prd) completes:
```
1. Launch Phase 3 (design) + Phase 4 (database) in parallel — both depend on PRD only
2. Phase 4 → Phase 5 (backend) proceeds independently of design
3. Phase 3 pauses at 3d for client confirmation (approved: true)
4. Phase 3 continues: 3e (full HTML) → 3f (QA) → 3g (upload) → phase_complete: true
5. ONLY AFTER phase_complete: true → launch Phase 3.5 (user-stories) + Phase 6 (frontend)
   ⚠️ Phase 3.5 CANNOT start while Phase 3e is still running
   ⚠️ HTML must fully exist before user story depth analysis reads UI elements
6. Phase 7 (integrate) waits for both Phase 5 (backend) + Phase 6 (frontend)
7. At Phase 9 (test-browser) start: check if Phase 3.5 is complete
   IF complete: proceed with test-browser
   IF not complete: wait for Phase 3.5 to finish, then proceed
```

#### Action: --loop — Infinite Iteration Mode (RL-Enhanced)

Read `.claude/pipeline/loop/infinite-loop.md` and follow its RL-enhanced algorithm.
The loop engine uses reward-weighted phase selection and policy memory for smarter decisions.

Supporting RL files (loaded by infinite-loop.md):
- `.claude/pipeline/loop/reward.yaml` — Reward function weights (shift-left, severity, terminal)
- `.claude/pipeline/loop/state-log.yaml` — State vector schema for per-generation tracking
- `.claude/pipeline/loop/policy-memory-global.yaml` — Cross-project learned policy (read at loop start)
- `{TARGET_DIR}/.claude-project/policy-memory.yaml` — Per-project reward trace (created during loop)
- `{TARGET_DIR}/.claude-project/status/{project}/STATE_LOG.yaml` — Episode state log (created during loop)

If generation > 3 and stagnation detected, read `.claude/pipeline/loop/stagnation.md`.

#### Action: --phase <name> [--loop] — Execute Specific Phase

Validate phase name and prerequisites.

**Without --loop**: Execute phase once (Step 4).

**With --loop**: Execute phase in an iterative loop until converged:

```
phase = <name>
max_iter = --max-iterations (default: 10)
target = phase quality gate threshold (from Pipeline Phases table)
stagnation_count = 0
last_score = 0
iteration = 1

WHILE iteration <= max_iter:

  1. EXECUTE PHASE
     - Execute phase via Step 4 (load manifest, pre-hydrate, run skill/blueprint)
     - Run phase improvement loops (automatic — same as full --loop mode)
     - Evaluate via quality gate
     - phase_score = gate result

  2. CHECK EXIT CONDITIONS
     a. CONVERGED: phase_score >= target
        → Report: "Phase {name} converged at iteration {N}, score {S}"
        → EXIT
     b. STAGNATION: phase_score == last_score for 3 consecutive iterations
        → Report: "Phase {name} stalled at {S} for 3 iterations"
        → EXIT
     c. MAX ITERATIONS: iteration >= max_iter
        → Report: "Max iterations reached. Phase {name} score: {S}/{target}"
        → EXIT
     d. ZERO PROGRESS: iteration >= 3 AND phase_score == 0
        → Report: "No progress after 3 iterations. Investigate manually."
        → EXIT

  3. LOG ITERATION
     Update PIPELINE_STATUS.md phase entry with latest score
     Log: "Phase {name} — Iteration {N}: score {S}"

  4. PREPARE NEXT ITERATION
     - Reset phase status to Pending (keep score for tracking)
     - last_score = phase_score
     - iteration += 1
     - Continue loop

END WHILE
```

#### Action: --adopt — Adopt Existing Project

Run Phase 0a audit (Step 2.7) to scan existing artifacts and classify phases. Then continue with `--run`, `--run-all`, or `--loop` for remaining Pending phases. Completed phases are skipped.

```
/fullstack my-project --adopt --run-all
# 1. Audit: scan all artifacts, classify phases
# 2. Run only Pending/Partial phases (skip what's already built)
```

#### Action: --update --prd <path> — Update with New Requirements

Run Phase 0a audit + Phase 0b PRD diff (Step 2.7). Only phases affected by PRD changes are set to Pending and re-executed. Unaffected phases keep their Complete status.

```
/fullstack my-project --update --prd ./new-requirements.md --run-all
# 1. Audit: scan existing artifacts
# 2. PRD Diff: compare old vs new PRD, generate change plan
# 3. Run only affected phases with scoped instructions
```

Requires `--prd <path>` to provide the updated PRD file.

#### Action: --reset <name> — Reset Phase

Set phase status to `Pending`, clear score. Ask: "Reset dependent phases too?"

---

## Step 4: Execute a Phase (Core Protocol)

This is the heart of the orchestrator. For each phase, follow this sequence:

### 4.0 Load Phase Module

```
Read: .claude/pipeline/phases/{NN}-{phase_name}.md
This file contains ALL instructions specific to this phase.
```

### 4.0b Verify Prerequisites (MANDATORY)

```
Read the phase module's "Prerequisites" section.
For EACH listed prerequisite:

1. Check PIPELINE_STATUS.md Progress table → prerequisite phase Status == Complete
2. IF prerequisite has special conditions, verify deterministically:

   | Prerequisite Keyword | Extra Verification (bash) |
   |---------------------|--------------------------|
   | "design (confirmed)" or "design confirmed" | grep 'approved: true' DESIGN_STATUS.md |
   | "test-api" | test -f .gate-proofs/test-api.proof |
   | Any phase with a gate | test -f .gate-proofs/{phase}.proof |

3. IF any prerequisite NOT met:
   ❌ DO NOT proceed to Step 4.1
   ❌ DO NOT self-evaluate "close enough" or "probably done"
   → STOP and report which prerequisite is missing
   → Suggest: run the prerequisite phase first

Example: user-stories requires "design confirmed"
  → Check 1: PIPELINE_STATUS.md shows design = Complete ✓
  → Check 2: grep 'approved: true' .claude-project/status/*/DESIGN_STATUS.md ✓
  → Both pass → proceed. Either fails → STOP.
```

### 4.1 Load Phase Manifest & Inject Rules

```
Read: .claude/pipeline/manifests/{phase_name}.manifest.yaml

From manifest.rules[], read each file:
  1. .claude/rules/common.rules.md (always)
  2. .claude/rules/phases/{phase}.rules.md (phase-specific)
  3. .claude/rules/stacks/{$BACKEND|$FRONTEND|base}.rules.md (stack-specific)

Treat these as ACTIVE RULES — enforce scope guards and conventions.
```

### 4.2 Pre-Hydrate Context

```
From manifest.pre_hydrate, for each category:
  1. Resolve variables: {$BACKEND}, {$FRONTEND}, {TARGET_DIR}, {project}
  2. Resolve glob patterns to actual file paths
  3. If 'sample' field exists: read N representative files (most recently modified)
  4. If 'optional: true' and file missing: skip silently
  5. If 'conditional' field: evaluate condition before reading
  6. Read all resolved files

Inject as structured context block:
  === PRE-HYDRATED CONTEXT ===
  ## Specification Context
  [contents]
  ## Phase Documentation
  [contents]
  ## Current State
  [contents]
  ## Existing Code Patterns
  [sample files]
  ## Doc Reading Verification (MANDATORY)
  After reading all pre-hydrated files, output a 1-line summary per file:
    "[filename]: [key pattern or convention extracted]"
  Example:
    "architecture-overview.md: 4-layer pattern — Controller extends BaseController, Service extends BaseService"
    "routing-guide.md: framework mode only, route() from @react-router/dev/routes, NO createBrowserRouter"
  
  ❌ PROHIBITED: Generating code without completing this verification
  ❌ PROHIBITED: Filling in summaries from memory without reading the actual file
  If you cannot produce a summary for a file, you did not read it. Re-read it now.
  === END PRE-HYDRATED CONTEXT ===
```

### 4.3 Execute Phase (Blueprint or Skill)

```
IF blueprint exists at .claude/blueprints/{phase}.yaml:
  Execute BLUEPRINT mode (4.3a)
ELSE:
  Execute SKILL mode (4.3b)
```

#### 4.3a Blueprint Execution Mode

Blueprints interleave deterministic shell commands with agentic LLM tasks.

```
Read .claude/blueprints/{phase}.yaml
For each node in order:

  IF node.type == "deterministic":
    Run node.command via Bash (replace {TARGET_DIR}, {CLAUDE_DIR})
    Parse exit code:
      exit 0 → PASS, continue
      exit != 0 → check node.on_failure:
        "ignore"          → log warning, continue
        "abort"           → STOP, mark Failed
        "route_to_agent"  → enter GATE FAILURE PROTOCOL (4.3c)

  IF node.type == "agentic":
    If node.condition exists: evaluate, skip if false
    If node.scope_guard exists: enforce file-level boundaries
      - scope_guard.allow[]: glob patterns for files the agent MAY modify
      - scope_guard.deny[]: glob patterns for files the agent MUST NOT modify
      - Treat as hard constraints — violations should be flagged and reverted
    Load skill from node.skill path

    If node.context.additional_read exists:
      1. Read EVERY file listed in additional_read using the Read tool. No exceptions. No skipping.
      2. BEFORE writing any code, output a Pattern Checkpoint:
         === PATTERN CHECKPOINT ===
         For each additional_read file, state:
         - File: [path]
         - Key patterns: [2-3 specific patterns extracted — class names, import paths, decorators]
         - Anti-patterns: [1 thing the doc explicitly says NOT to do]
         === END PATTERN CHECKPOINT ===
      3. If any field is blank → you skipped the read. Go back and read now.
      ❌ PROHIBITED: Generating code from memory instead of from additional_read files.
      ❌ PROHIBITED: Skipping reads because you "already know" NestJS or React patterns.
      The submodule docs define THIS PROJECT's specific patterns. Your training data is not authoritative.

    Follow skill instructions with node.prompt as goal

    After agent completes, VERIFY output quality before proceeding:
    - Count files created vs files expected (from skill instructions)
    - Spot-check 2-3 generated files: read first 50 lines, verify they contain real logic (not stubs/mocks/TODOs)
    - If agent output contains TODO stubs, mock data, or placeholder implementations:
      ❌ DO NOT accept. Re-prompt the agent with specific failures.
      ❌ "73 files generated" does NOT mean "73 files with working code"
    - Verification pattern:
      grep -r "TODO\|FIXME\|mock\|Mock\|placeholder\|stub\|not.implemented" {output_dir} --include="*.ts" --include="*.tsx" -c
      IF count > 0: agent output is INCOMPLETE. Re-run with explicit instructions to implement.
```

**scope_guard** enables TDD-style isolation within a phase. For example, the backend blueprint uses it to ensure:
- Test-writing nodes can only modify `backend/test/**` (cannot touch source code)
- Implementation nodes can only modify `backend/src/**` (cannot modify tests)
- This ensures tests encode acceptance criteria from specs, not from reading implementation

#### 4.3b Skill-Only Execution Mode

Read skill file from resolved path (Step 2.5). Follow its instructions.

#### 4.3c Gate Failure Protocol (max 2 fix rounds)

Inspired by Stripe's "max 2 CI rounds" — diminishing returns after 2 attempts.

```
ROUND 1: Deterministic node fails
  → Capture FULL gate JSON output (checks[], score, detail fields)
  → Load debugging skill based on failure location:
    - Backend failures: .claude/{$BACKEND}/skills/debugging/fix-bug.md
    - Frontend failures: .claude/{$FRONTEND}/skills/debugging/fix-bug.md
  → Pass full gate JSON + error output as context to debugging skill
  → Agent attempts fix → Re-run same command
  → If PASS: continue. If FAIL: Round 2.

ROUND 2: Still failing
  → Send Round 1 + Round 2 context + full gate JSON: "Try a DIFFERENT approach"
  → Agent attempts fix → Re-run command
  → If PASS: continue. If FAIL: STOP.

ROUND 3+: NEVER RETRY
  → Mark phase Failed
  → In --loop: retry next generation
  → In --run: surface to user
```

### 4.4 Run Deterministic Quality Gate (MANDATORY)

**⚠️ CRITICAL: This step is NOT optional. Every phase with a gate script MUST run its gate.**
**Skipping this step is the #1 cause of undetected bugs (see FULLSTACK_ISSUES_v3.md G-02, FULLSTACK_ISSUES_PINBOARD.md G-01).**
**Do NOT self-evaluate or assign scores without running the gate script first.**

```
IF gate script exists at .claude/gates/{phase}-gate.sh:
  1. MUST Run: bash .claude/gates/{phase}-gate.sh {TARGET_DIR}
  2. Parse JSON output: { gate, checks[], score, summary, passed }
  3. phase_score = gate.score   # Score MUST come from gate, never self-assigned
  4. VERIFY PROOF (Layer 1 — gate-runner auto-generates this):
     Run: cat {TARGET_DIR}/.claude-project/status/.gate-proofs/{phase}.proof
     Confirm:
       a. gate field matches current phase name
       b. executed_at is within last 10 minutes
       c. score matches the JSON output score
     IF proof file missing → gate did NOT actually run. Re-run Step 4.4.
  5. IF NOT passed: enter Gate Failure Protocol (4.3c)
ELSE:
  # Phases without gate scripts: spec, init, prd (early phases with no buildable artifacts)
  # These use evaluation fallback — criteria from their manifest.gate.evaluation_criteria[]
  Run structured evaluation fallback:
    1. Stage 1 (Mechanical): Run ouroboros:evaluate Stage 1 checks (tsc --noEmit, lint, tests)
       See: .claude/spec/commands/ouroboros/evaluate.md (Step 2 only)
    2. Score: checks_passed / total_checks
    3. For ship phase ONLY: Run full 3-stage ouroboros:evaluate (mechanical + semantic + consensus)
    4. If no mechanical checks applicable: fall back to LLM evaluation using .claude/pipeline/evaluation/criteria.yaml
```

### 4.5 Runtime Verification (MANDATORY — DO NOT SKIP)

⚠️ **CRITICAL: This step exists because the #1 orchestrator failure is treating "files generated" as "phase complete".**
⚠️ **A phase is NOT complete until its output is VERIFIED TO WORK at runtime.**

After the gate passes, perform phase-specific runtime verification:

| Phase | Runtime Check | Command | Pass Criteria |
|-------|--------------|---------|---------------|
| database | Migration applies + schema valid | `cd {TARGET_DIR}/backend && npx prisma migrate dev --name init && npx prisma validate` | Exit 0, no errors |
| backend | Server starts + health check | `cd {TARGET_DIR}/backend && timeout 30 npm run start:dev & sleep 10 && curl -f http://localhost:3001/api/health` | HTTP 200 within 30s |
| backend | No TODO stubs in services | `grep -r "TODO\|FIXME\|stub\|not implemented" {TARGET_DIR}/backend/src/modules/ --include="*.ts" -l` | Zero files found |
| frontend | Build succeeds | `cd {TARGET_DIR}/frontend && npm run build` | Exit 0, dist/ created |
| frontend | No mock/hardcoded data in pages | `grep -r "mock\|Mock\|hardcoded\|MOCK\|fakeDat\|sampleDat" {TARGET_DIR}/frontend/app/pages/ --include="*.tsx" -l` | Zero files found |
| frontend | Redux hooks imported in pages | `for f in {TARGET_DIR}/frontend/app/pages/**/*.tsx; do grep -l "useAppDispatch\|useAppSelector\|dispatch(" "$f"; done \| wc -l` | Count > 0 for data pages |
| integrate | All API services connected to pages | `grep -rL "import.*from.*services\|import.*from.*redux" {TARGET_DIR}/frontend/app/pages/ --include="*.tsx"` | Only static pages (Landing, 404) |
| test-api | Tests actually pass | `cd {TARGET_DIR}/backend && npm run test:e2e 2>&1 \| tail -5` | "Tests: X passed" with pass rate >= 80% |
| test-browser | All 8 marker files exist with real data | Check PREFLIGHT_STATUS, SEED_STATUS, DESIGN_QA_STATUS, E2E_QA_STATUS, CHAOS_TEST_STATUS, EXPLORATION_REPORT, UX_QA_SUMMARY, PRODUCTION_LAYERS_STATUS | All 8 present, no template placeholders |

IF runtime check fails:
  1. DO NOT mark phase as Complete
  2. Report the specific failure
  3. Re-enter the phase to fix the issue
  4. Re-run gate + runtime check
  5. Only mark Complete when BOTH gate AND runtime pass

**The orchestrator MUST NOT proceed to the next phase if runtime verification fails.**

### 4.5b Run Phase Improvement Loop (if applicable)

Read manifest.improvement_loops[] for applicable workflows. Each phase has built-in improvement skills:

| Phase | Improvement Skill | When to Run |
|-------|------------------|-------------|
| spec | `.claude/spec/commands/ouroboros/interview.md` | If ambiguity > 0.2 |
| prd | `.claude/spec/commands/ouroboros/interview.md` (incremental) | If sections missing |
| user-stories | `.claude/skills/dev/deepen-user-stories/SKILL.md` | If story_depth_score < 0.75 |
| design | `.claude/skills/design/prd-to-design-guide/SKILL.md` + `generate-design-prompts/SKILL.md` + `generate-html/SKILL.md` | If pages missing or QA fails |
| database | `.claude/{$BACKEND}/guides/workflow-design-database.md` | If schema issues found |
| backend | `.claude/{$BACKEND}/skills/api-development/SKILL.md` | If endpoints incomplete |
| frontend | `.claude/{$FRONTEND}/skills/qa/design-qa-html.md` | After HTML-to-React conversion |
| integrate | `.claude/{$FRONTEND}/skills/api-integration/SKILL.md` | If APIs not connected |
| test-api | backend e2e tests | Phase 8: backend API tests |
| test-browser | `.claude/{$BACKEND}/skills/database-seeding/SKILL.md` + `.claude/skills/qa/` (seed → design QA → acceptance → exploration → UX scan) | Phase 9 |

Improvement loops are optional in `--run` mode but automatic in `--loop` mode (both full-pipeline `--loop` and `--phase <name> --loop`).

### 4.6 Mark Phase Complete (ONLY after proof verification)

A phase status transitions: Pending → In Progress → Complete OR Failed

**MANDATORY — Run via Bash BEFORE setting Status=Complete (phases with gate scripts):**

```bash
PROOF="{TARGET_DIR}/.claude-project/status/.gate-proofs/{phase}.proof"
if [ ! -f "$PROOF" ]; then
  echo "BLOCKED: Cannot mark {phase} Complete — no gate proof file."
  echo "Gate script was never executed. Run: bash {CLAUDE_DIR}/gates/{phase}-gate.sh {TARGET_DIR}"
  exit 1
fi
PROOF_SCORE=$(grep '^score:' "$PROOF" | awk '{print $2}')
PROOF_TIME=$(grep '^executed_at:' "$PROOF" | awk '{print $2}')
echo "Gate verified: score=$PROOF_SCORE at $PROOF_TIME"
```

Use $PROOF_SCORE as the phase score. DO NOT use any other score.

To mark a phase as Complete, ALL of these must be true:
  1. ✅ Phase skill/blueprint executed (Step 4.3)
  2. ✅ Quality gate passed with score (Step 4.4)
  3. ✅ Gate proof file exists and is fresh (bash check above)
  4. ✅ Runtime verification passed (Step 4.5)

If ANY check fails, phase stays In Progress or goes to Failed.

❌ NEVER mark a phase Complete based only on "files were generated"
❌ NEVER self-assign a score without running the gate script
❌ NEVER skip runtime verification "to save time"

### 4.7 Update Status (AUTOMATED for gate phases)

**For phases WITH gate scripts** (database, backend, frontend, integrate, test-api, test-browser, design, user-stories):
Status updates are performed **automatically** by `_gate-runner.sh` when the gate script runs.
The gate-runner updates: Progress Table, Gate Results, Gate Proofs, Execution Log, and Config (last_run, pipeline_score).
**Manual updates are NOT required** — the blueprint's `verify-gate-proof` node confirms the gate ran.

**For phases WITHOUT gate scripts** (spec, prd, init):
The blueprint's `update-pipeline-status` agentic node handles status updates using evaluation fallback scores.
Update these items manually:

```
REQUIRED UPDATES (phases without gates only):
  1. Progress Table — set Status + Score + Output columns
  2. Execution Log — append row: | {date} | {phase} | {gen} | {duration} | {result} | {score} | {notes} |
  3. Phase Details — update or add ### {phase} section with key outputs
  4. Config — update last_run timestamp, recalculate pipeline_score
```

**⚠️ PRE-COMPLETION VALIDATION (MUST pass before setting Status = Complete):**

```
CHECK 1 — GATE PROOF (phases with gate scripts):
  Run: test -f {TARGET_DIR}/.claude-project/status/.gate-proofs/{phase}.proof
  IF missing → gate was NOT run. Go back to Step 4.4. DO NOT mark Complete.

CHECK 2 — PROOF FRESHNESS:
  Read .gate-proofs/{phase}.proof → check executed_at
  IF executed_at is older than 10 minutes → re-run gate (stale proof).

CHECK 3 — SCORE CONSISTENCY:
  proof file score == phase_score from Step 4.4
  IF mismatch → use proof score (bash-generated, not LLM-generated).

CHECK 4 — EXECUTION LOG:
  Does the current phase row exist in the Execution Log table?
  IF missing → add it, THEN mark Complete.

CHECK 5 — BLUEPRINT NODE COMPLETENESS (phases with blueprints):
  List all node IDs from .claude/blueprints/{phase}.yaml
  Compare against nodes actually executed in this session.
  Nodes skipped due to condition=false are OK.
  Any other missing node → STOP, execute the missing node first.
```

```
On Failure:
  phase.status = Failed
  phase.score = last evaluation score
  Still update Execution Log with Failed result
  In --run/--run-all: STOP
  In --loop: mark for retry next generation
```

**INVALID PATTERNS (detected by pipeline-e2e-check.sh Layer 4 audit):**
- Complete but no `.gate-proofs/{phase}.proof` → gate was never run
- Complete but no Execution Log entry → status updated without logging
- Score in Progress table != score in proof file → score was manually overridden
- Phase Details section still shows "Pending" → details not updated

---

## Step 5: Evaluation & Scoring

```
phase_score = checks_passed / total_checks  (0.0 to 1.0)
pipeline_score = average(all_phase_scores)
```

Full evaluation criteria per phase: `.claude/pipeline/evaluation/criteria.yaml`

### RL Reward Calculation (--loop mode only)

In `--loop` mode, after each phase gate evaluation, the loop engine also calculates RL rewards:

```
R_phase = phase_weight × Δ(phase_score)
        + Σ(bugs_caught × severity_weight × shift_left_multiplier[phase])
        - late_bug_penalty (if bug should have been caught in an earlier phase)
```

Shift-left multipliers incentivize catching bugs early: spec (5.0x) > backend (3.0x) > test-browser (1.0x) > production (-50.0x catastrophic).

Reward config: `.claude/pipeline/loop/reward.yaml`
State tracking: `{TARGET_DIR}/.claude-project/status/{project}/STATE_LOG.yaml`

---

## Step 6: Infinite Loop Engine

When `--loop` is specified, read and follow: `.claude/pipeline/loop/infinite-loop.md`

Supporting files loaded on-demand:
- `.claude/pipeline/loop/reward.yaml` — RL reward function configuration
- `.claude/pipeline/loop/state-log.yaml` — state vector schema
- `.claude/pipeline/loop/policy-memory-global.yaml` — cross-project learned policy
- `.claude/pipeline/loop/policy-memory.md` — policy memory system documentation
- `.claude/pipeline/loop/stagnation.md` — when score stalls for 3+ generations
- `.claude/pipeline/loop/artifact-tracking.md` — between generations for invalidation
- `.claude/pipeline/loop/drift-monitoring.md` — at Phase 10 and optionally between generations

---

## Status File Format

Path: `{TARGET_DIR}/.claude-project/status/{project}/PIPELINE_STATUS.md`

```yaml
project: {PROJECT_NAME}
created: {DATE}
last_run: null
generation: 1
pipeline_score: 0.00
quality_target: 0.95
mode: greenfield
seed_id: null
tech_stack:
  backend: nestjs
  frontends: [react]
# RL metrics (populated in --loop mode)
episode_id: null
cumulative_reward: 0.0
bugs_found: 0
bugs_fixed: 0
bugs_escaped: 0
pattern_reuse_ratio: 0.0
```

Progress table, Artifact Hashes, Generation Log, and Execution Log sections — see template at `.claude/templates/PIPELINE_STATUS.template.md`.

---

## Error Handling

### Phase Fails
- `--run` / `--run-all`: Mark Failed, STOP, report with suggested fix
- `--loop`: Mark Failed, increment fail count. If 3+: stagnation handler. If handler fails: pause.
- `--phase <name> --loop`: Mark Failed, increment fail count. If 3+ consecutive: STOP (single-phase has no cross-phase recovery).

### Missing Skill File
1. Check alternate locations (guides/ instead of skills/)
2. If guide exists: use with warning
3. If nothing: skip phase, mark Blocked

### Artifact Invalidation
Read `.claude/pipeline/loop/artifact-tracking.md` for full invalidation rules.

---

## Examples

### Build a New Product (Infinite Loop)

```bash
/fullstack my-saas --loop
# Gen 1: Interview → Seed → Init → PRD → Design+DB → FE+BE → Integrate → Test-API → Test-Browser  (0.58)
# Gen 2: Improve design, database  (0.72)
# Gen 3: Improve backend, frontend  (0.86)
# Gen 4: Improve integration, test-api  (0.93)
# Gen 5: Improve test-browser  (0.96)
# CONVERGED at generation 5.
```

### Quick Build (Skip Spec, Single Pass)

```bash
/fullstack my-app --run-all --skip-spec
```

### Resume After Interruption

```bash
/fullstack my-app            # Shows: Gen 3, design failed, score 0.72
/fullstack my-app --phase design   # Retries design once
/fullstack my-app --phase design --loop  # Loops design until converged
/fullstack my-app --loop           # Continues from generation 3
```

### Loop a Single Phase

```bash
/fullstack tirebank --phase test-api --loop
# Iteration 1: backend tests 65% → score 0.65
# Iteration 2: fix 3 tests → score 0.90
# Iteration 3: fix 1 test → score 0.96
# CONVERGED at iteration 3.
```

```bash
/fullstack tirebank --phase test-api --loop --max-iterations 5
# Same as above but caps at 5 iterations
```

### Adopt an Existing Project

```bash
/fullstack my-saas --adopt --run-all
# Audit: spec Complete, prd Complete, database Complete, backend Partial (3/5), frontend Missing
# Skips: spec, prd, database
# Runs: backend (incremental), frontend, integrate, test-api, test-browser, ship
```

### Update with New Requirements

```bash
/fullstack my-saas --update --prd ./new-requirements.md --run-all
# Audit: all phases Complete
# PRD Diff: +reviews module, ~booking (added notes field), -referrals
# Runs: prd (update docs), database (add Review, modify Booking, remove Referral),
#        backend (reviews module, update bookings, remove referrals),
#        frontend (review pages, update booking form, remove referral page),
#        integrate, test-api, test-browser
```

### Build in Different Folder

```bash
/fullstack tirebank --path /Users/me/projects/tirebank \
  --prd .claude-project/prd/ABCTire_PRD.md --run-all --skip-spec
# After first run, tirebank/ has its own .claude/ — run natively
```

---

## Related Commands & Skills

- `design:prd-to-design-guide` — Design guide for external designer (Phase 3, Path B)
- `design:prd-to-design-prompts` — Design prompts from PRD
- `design:prompts-to-html` — Execute design prompts on AI design tools
- `design:html-to-git` — Deploy HTML to GitHub Pages
- `/figma-extract-screens` — Extract Figma screens
- `/ouroboros:interview` — Requirements interview (Phase 0)
- `/ouroboros:seed` — Generate specification seed (Phase 0)
- `/ouroboros:unstuck` — Break through stagnation (loop engine)
- `/ouroboros:evaluate` — 3-stage verification pipeline (used as eval fallback)
- `/ouroboros:evolve` — Evolutionary spec refinement (used in stagnation handler)
- `/report-bug` — Report a manually-found bug, trigger RCA, generate missing story, archive gap pattern. Use `--escaped` for production bugs (triggers -50x reward penalty + policy memory update)
- `/monitor-rl` — RL reward system dashboard: shows what improved, where bugs were caught, reward attribution, and what the system learned. Use `--phase <name>` for single-phase deep-dive, `--bugs` for per-bug detail, `--global` for full policy memory
