# Fullstack v2 Orchestrator

Code-based pipeline runner. A Node.js script ([orchestrator.js](orchestrator.js)) walks blueprint YAMLs deterministically and spawns a fresh agent subprocess per agentic node. Every agentic node has a hard artifact contract — `required_output_file` + optional `verification_pattern` — that the orchestrator verifies after the subprocess returns. There is no path for an agent to silently skip work.

For the user-facing slash command, see [.claude/commands/fullstack-2.md](../commands/fullstack-2.md). This README documents the engine itself.

## v1 vs v2

| Aspect | v1 (`/fullstack`) | v2 (`/fullstack-2`) |
|--------|-------------------|---------------------|
| Orchestrator | LLM interprets a long markdown command | Node.js walks YAML blueprints |
| Agentic nodes | LLM tools in shared context | One subprocess per node (isolated) |
| Artifact verification | Self-reported | `fs.existsSync` + regex match |
| Tool scoping | Advisory hint | Strict `--disallowed-tools` |
| Skip prevention | Trusts the LLM | Impossible — code walks every node |
| Blueprint files | `*.yaml` | `*-2.yaml` (with v1 fallback) |
| Episode logging | None | `.claude-project/episodes/ep-*.jsonl` |
| Reward computation | None | Pure function over event stream |

## Quick start

```bash
# Single phase
node .claude/v2/orchestrator.js <project> --phase backend

# Full pipeline (init → … → test-browser; ship is run separately)
node .claude/v2/orchestrator.js <project> --run-all

# Phase convergence loop
node .claude/v2/orchestrator.js <project> --phase frontend --loop --quality 0.95

# Pipeline-wide generation loop
node .claude/v2/orchestrator.js <project> --loop --max-generations 5

# Different agent backend
AGENT_BACKEND=opencode node .claude/v2/orchestrator.js <project> --phase backend

# Resume after abort
node .claude/v2/orchestrator.js <project> --phase frontend --resume

# Dry-run (walk without executing; no events written)
node .claude/v2/orchestrator.js <project> --run-all --dry-run
```

## CLI reference

All flags live in `parseArgs()` near the top of [orchestrator.js](orchestrator.js).

### Modes

| Flag | Behavior |
|------|----------|
| `--phase <name>` | Run a single phase once |
| `--phase <name> --loop` | Re-run a phase until score ≥ `--quality`, max iterations, or stagnation |
| `--run-all` | Execute every phase in `PIPELINE_GRAPH` order |
| `--loop` | Pipeline-wide generation loop — resets below-threshold phases each generation |
| `--loop --skip-spec` | Pipeline loop but skip the spec phase |
| `--resume` | Continue a phase from saved blueprint state (skip COMPLETE nodes) |
| `--reset <phase>` | Reset a phase to Pending and clear its blueprint state |
| `--prd <file>` | Load a PRD (md/pdf), clear old chunks, reset prd phase. Chainable with `--run-all` / `--phase` |
| `--refresh` | Wipe generated artifacts (backend/, frontend/, docs, etc.). Plan-only unless `--yes` |
| `--dry-run` | Walk nodes without executing (also suppresses event emission) |

### Tuning

| Flag | Default | Applies to |
|------|---------|------------|
| `--quality <float>` | `0.95` | All loop modes — convergence target |
| `--max-iterations <int>` | `5` | `--phase X --loop` — hard cap per phase |
| `--max-generations <int>` | `10` | `--loop` — hard cap on pipeline generations |

### Behavioral

| Flag | Default | Effect |
|------|---------|--------|
| `--verbose` / `-v` | off | Print extra output from deterministic nodes |
| `--no-events` / `--emit-events` | events on | Disable / re-enable episode JSONL logging |
| `--keep-going` | off | When a fanout cell fails, keep running surviving cells (phase still marked FAIL) |
| `--path <dir>` | cwd | Target a different project than cwd; `.claude/` still read from source |
| `--yes` / `-y` | off | Confirmation flag for destructive ops (currently `--refresh`) |

> `--help` is **not** implemented. Read this README or `parseArgs()` directly.

## Phase order and execution graph

`PHASE_ORDER` (11 phases — used for validation, `--reset`, and flat lookups):

```
init → spec → prd → design → database → user-stories →
backend → frontend → integrate → test-api → test-browser
```

`PIPELINE_GRAPH` groups phases that have no dependency on each other and can run in parallel within a step:

| Step | Phases (parallel) |
|------|-------------------|
| 1 | `init` |
| 2 | `spec` |
| 3 | `prd` |
| 4 | `design`, `database` (both depend only on prd) |
| 5 | `user-stories`, `backend` |
| 6 | `frontend` |
| 7 | `integrate` |
| 8 | `test-api` |
| 9 | `test-browser` |

> `ship` has a blueprint ([ship-2.yaml](../blueprints/ship-2.yaml)) but is **not** in `PHASE_ORDER` or `PIPELINE_GRAPH`. Run it explicitly with `--phase ship`.

### Frontend-scoped fanout

`FRONTEND_SCOPED_PHASES = { frontend, integrate, test-browser }`. When `PIPELINE_STATUS.md` declares multiple frontends, these phases fan out — one execution per frontend, recorded under a compound key `<phase>:<frontend_name>`. `init` is deliberately not scoped — it creates shared project state that must exist exactly once.

## Blueprint contracts

Loader is [lib/blueprint.js](lib/blueprint.js). For phase X it tries `<blueprintsDir>/X-2.yaml` first, then falls back to `X.yaml` (v1) only if the v2 file is missing.

### Node types

| Type | Behavior |
|------|----------|
| `agentic` | Spawns an agent subprocess (claude or opencode). Must declare `required_output_file`; verified post-run via `fs.existsSync` + optional `verification_pattern` regex |
| `deterministic` | Runs a shell command via `execSync`. Supports `condition`, `max_retries`, and `on_failure: route_to_agent` (auto-fix) |
| `evaluator` | Specialized agentic node that grades artifacts against a rubric. Force-denies `Edit/NotebookEdit/WebFetch/WebSearch` and writes a normalized JSON evaluation |

### Artifact contract

Every agentic node MUST set:

```yaml
- id: implement-user-module
  type: agentic
  required_output_file: backend/src/modules/user/user.controller.ts
  verification_pattern: '@Controller\(.user.\)'   # optional regex (multiline)
  prompt: |
    ...
```

`validateV2Contracts()` rejects any agentic node missing `required_output_file`.

### Fanout

```yaml
- id: scaffold-frontend
  type: agentic
  fanout:
    source: frontends            # or backend_modules | html_pages | roles
    subject_var: FRONTEND        # exposed to prompt + paths as {FRONTEND}
    concurrency: 4               # 1..32
  required_output_file: '{FRONTEND}/app/root.tsx'   # MUST reference {subject_var}
```

The validator rejects fanout nodes whose `required_output_file` does not contain `{subject_var}` — otherwise every cell would overwrite the same artifact and verification would be meaningless. Pluggable resolvers live in [lib/fanout-sources.js](lib/fanout-sources.js).

**Resolvers**

| `source` | Returns | Indexed from |
|---|---|---|
| `frontends` | frontend descriptors | `PIPELINE_STATUS.md` `frontends:` block (always returns ≥1 entry) |
| `backend_modules` | module name slugs | `MODULE_INVENTORY.yaml` (explicit override) → PROJECT_API.md `/api/{seg}` route prefixes (preferred — actual controller surface) → PROJECT_KNOWLEDGE.md `### Module:` headings (fallback) → PRD.md (last resort) |
| `html_pages` | page slugs (basename of .html) | `.claude-project/design/html/*.html` |
| `roles` | role-name slugs | "User Types" section of PROJECT_KNOWLEDGE.md / PRD.md |

The route-based `backend_modules` resolver was changed in 2026-04-28 from heading-based after a real-PRD run revealed gaps: KB headings missed modules implied by API but absent from documentation (e.g., `email-history`, `dashboard`, `affiliations`). Route prefixes are the controller-facing source of truth.

**Cell-skip cache (fast-path)**

When a cell's `required_output_file` already exists, verifies, and is fresher than every upstream input declared in `context.additional_read`, the orchestrator skips the subprocess and emits `PASS` with `cached: true`. This makes retries (post-quota-reset, `--loop` iterations, gate-failure recoveries) only re-spend on cells that actually need to re-run.

Set `FANOUT_NO_CACHE=1` in the environment to force every cell to re-run regardless. Staleness rule: if any upstream context file's mtime exceeds the artifact's mtime, the cell is treated as stale and re-runs.

**Partial-failure handling**

When a cell fails inside a batch, the default is to abort remaining batches (fail fast). Pass `--keep-going` to let the current batch finish surviving cells before reporting phase failure. Useful when most cells are independent and you want to triage all failures at once instead of seeing them one batch at a time.

## Agent backend selection

The factory ([lib/agent-factory.js](lib/agent-factory.js)) picks a backend by priority:

1. `node.backend` field in the blueprint
2. `config.agentBackend` setting
3. `AGENT_BACKEND` environment variable
4. Default: `claude`

| Backend | Adapter | Command | Model selection |
|---------|---------|---------|-----------------|
| `claude` | [lib/agent.js](lib/agent.js) | `claude --print` | Claude models only |
| `opencode` | [lib/agent-opencode.js](lib/agent-opencode.js) | `opencode run` | Any provider (Anthropic, OpenAI, Google, …) per node |

Per-node model override works on opencode:

```yaml
- id: deep-spec
  type: agentic
  model: anthropic/claude-opus-4
  prompt: ...

- id: cheap-fix
  model: openai/gpt-4.1-mini
  prompt: ...
```

Tool scoping per node:

```yaml
tool_profile:
  allow: [Read, Write, Edit, Bash, Grep, Glob]
  deny:  [WebSearch, WebFetch]
```

`allow` becomes `--allowed-tools`, `deny` becomes `--disallowed-tools`. Evaluator nodes additionally force-deny `Edit`, `NotebookEdit`, `WebFetch`, `WebSearch` regardless of the profile.

## Evaluator + rubric system

### Rubric structure

Rubrics live under `.claude/blueprints/evaluators/` and follow:

```yaml
name: frontend-rubric
version: 1
scope: frontend
criteria:
  visual_fidelity:
    weight: 0.4
    question: "Does the React output match the HTML prototype?"
    anchors:
      - { score: 1.0, description: "Pixel-perfect" }
      - { score: 0.5, description: "Recognizable but off" }
      - { score: 0.0, description: "Nothing in common" }
  ...
output_format:
  required_fields: [overall_score, p0_count, p1_count, p2_count, findings]
  blocker_severities: [P0, P1, P2]
```

Weights MUST sum to 1.0. The evaluator recomputes `overall_score = Σ weight × criterion_score` after the agent writes its JSON, so an agent cannot inflate the score by writing a different number.

### Blend strategies

Implemented in [lib/gate.js](lib/gate.js)'s `blendScores()`:

| Strategy | Formula | Use case |
|----------|---------|----------|
| `soft_score` (default) | `det_weight × gate + eval_weight × eval` (default 0.6 / 0.4) | design, frontend, integrate |
| `veto` | `min(gate, eval)` with `min_evaluator_score` floor (default 0.7) | ship phase |
| `hard_gate` | `final = gate` (evaluator advisory only) | rare |

All strategies respect:
- `min_evaluator_score` floor — falls below = force-fail
- P0 blockers from `evaluation.p0_count` — any P0 = force-fail regardless of score

### Calibration

Optional `{phase}-examples.yaml` provides a few-shot calibration set fed to the evaluator alongside the rubric, so different runs grade against the same anchors.

## Episode logging

Every real run emits a JSONL stream at `<targetDir>/.claude-project/episodes/<episode_id>.jsonl`. Episode IDs are `ep-<ISO-with-dashes>-<4char>`. Disabled in dry-runs and when `--no-events` is passed.

Event types ([lib/events.js](lib/events.js), `EVENT_TYPES`):

```
episode_start, episode_end
phase_start, phase_end
generation_start, generation_end
iteration_start, iteration_end
node_start, node_result        # carries `cell` field on fanout nodes
artifact_verify
gate_score, evaluator_score
bug_detected
stagnation_detected, convergence
```

Each line is JSON: `{ t, type, episode_id, project, …type-specific fields }`. The stream falls back to an in-memory ring buffer (200 events) if disk writes fail; emission is always side-effect-free for the pipeline itself.

`episodes/` is **excluded from `--refresh`** — it's append-only training data. Wiping it would reset the bandit/policy learning signal to zero. Refresh clears generated artifacts (code, docs, status); episode history is preserved like git log. Manual purge: `rm -rf .claude-project/episodes`.

## Memory & learning bridge

Raw episode JSONL is machine-readable but agents need digested context. [distill-learnings.js](distill-learnings.js) reads each episode and appends a structured summary block to `<targetDir>/.claude-project/memory/LEARNINGS.md` under a "Run history" section. Future agents see prior outcomes — phases passed/failed, fanout cell counts (cached vs fresh vs failed), eval drift, costs — as part of their context.

```bash
node .claude/v2/distill-learnings.js              # all episodes (default)
node .claude/v2/distill-learnings.js --latest     # only most recent
node .claude/v2/distill-learnings.js --episode ep-2026-04-28T03  # one specific
node .claude/v2/distill-learnings.js --dry-run    # preview what would append
```

Idempotent — uses `<!-- ep:{id} -->` markers to skip episodes already distilled. Safe to run after every pipeline run, on a hook, or manually. Each entry has a `**what to remember**:` line where agents/humans can append concise lessons; those lines are preserved across re-runs of the distiller.

`memory/*.md` (DECISIONS, LEARNINGS, PREFERENCES) is preserved by `--refresh`, so curated lessons + auto-distilled run history both accumulate across refreshes. Combined with the episode-preservation rule above, "more iterations → smarter orchestrator" becomes a real loop:

- Episodes accumulate raw events for the future RL bandit.
- Distillation surfaces them in LEARNINGS.md so the LLM sees prior failures as context.
- `--refresh` purges generated code but keeps both signals intact.

## Reward system

Pure function over an episode stream. Implemented in [lib/reward.js](lib/reward.js); config at `.claude/pipeline/loop/reward.yaml` (multi-document YAML, all docs merged).

Reward components:

| Component | Trigger | Notes |
|-----------|---------|-------|
| `R_phase` | Per `phase_end` | Base + shift-left bonus, late-bug / cost / artifact-failure penalties |
| `R_generation` | Per `generation_end` (loop mode only) | Score-improvement, bug, story-pass, coverage, pattern-reuse, stagnation |
| `R_terminal` | Per `episode_end` | Convergence bonus, speed bonus, escape penalty, coverage completeness |

```
R_episode = Σ R_phase + Σ R_generation + R_terminal
```

### Audit CLI

[reward-audit.js](reward-audit.js):

```bash
node .claude/v2/reward-audit.js --latest              # newest episode in cwd
node .claude/v2/reward-audit.js --list 10             # last 10 episodes with totals
node .claude/v2/reward-audit.js --project <name>      # filter by project
node .claude/v2/reward-audit.js <episode-file>        # specific episode
```

Output: per-phase component breakdown, per-generation components, terminal rewards, full sum. Use this every ~10 episodes to sanity-check the reward function against your gut ranking.

## State and config

### State files

[lib/state.js](lib/state.js). All writes are atomic (`tmp + rename`) and lock-protected (`.lock` files with stale-lock recovery up to 5s).

| Path | Contents |
|------|----------|
| `<targetDir>/.claude-project/status/.blueprint-<phase>.json` | Per-node status (`PENDING` / `COMPLETE` / `FAIL`); read by `--resume` |
| `<targetDir>/.claude-project/status/.gate-proofs/<phase>.proof` | Gate proof file (gate name + score, mtime-checked, `maxAgeMinutes` defaults to 10) |
| `<targetDir>/.claude-project/status/<project>/PIPELINE_STATUS.md` | Markdown status table: Phase \| Status \| Score \| Output \| LoopRuns \| GateRunAt \| Notes |
| `<targetDir>/.claude-project/agent-logs/*.log` | Per-node agent transcript (one file per agentic invocation) |

### Config defaults

`makeConfig(targetDir, sourceDir)` from [lib/config.js](lib/config.js) splits SOURCE (where `.claude/` is read) from TARGET (where `.claude-project/` is written). Default: source = target = cwd. Override target with `--path`.

| Field | Path |
|-------|------|
| `claudeDir` | `<sourceDir>/.claude` |
| `blueprintsDir` | `<sourceDir>/.claude/blueprints` |
| `gatesDir` | `<sourceDir>/.claude/gates` |
| `statusDir` | `<targetDir>/.claude-project/status` |
| `gateProofsDir` | `<targetDir>/.claude-project/status/.gate-proofs` |
| `agentLogsDir` | `<targetDir>/.claude-project/agent-logs` |
| `agentRunnerScript` | `<sourceDir>/.claude/scripts/claude-agent-runner.js` |

## Helper modules

| File | Purpose |
|------|---------|
| [lib/fanout-sources.js](lib/fanout-sources.js) | Pluggable resolvers (`frontends`, `backend_modules`, `html_pages`, `roles`) returning the values to fan a node across |
| [lib/html-filter.js](lib/html-filter.js) | Maps HTML mockups to frontends via `html_dir` (folder mode) or `role_prefixes` (glob mode) |
| [lib/deterministic.js](lib/deterministic.js) | Runs shell commands via `execSync`; honors `condition`, `max_retries`, and `on_failure: route_to_agent` auto-fix |
| [lib/rubric.js](lib/rubric.js) | Loads + validates rubric YAML; recomputes `overall_score` from criterion scores |
| [lib/evaluator.js](lib/evaluator.js) | Builds evaluator prompt (rubric + calibration + artifact inputs); runs agent; rewrites authoritative JSON |
| [lib/state.js](lib/state.js) | Atomic state I/O, file-locked status table writes |
| [lib/events.js](lib/events.js) | Episode event stream (JSONL append, disk-fallback ring buffer) |
| [lib/reward.js](lib/reward.js) | Pure reward computation from event stream |
| [lib/gate.js](lib/gate.js) | Gate script invocation, proof verification, deterministic↔evaluator blending |
| [lib/blueprint.js](lib/blueprint.js) | Blueprint loader (v2 with v1 fallback) and contract validator |
| [lib/config.js](lib/config.js) | Path discovery, source/target split, YAML loader, `resolveVars` template substitution |
| [lib/agent-factory.js](lib/agent-factory.js) | Backend dispatcher (claude / opencode), artifact verification entry point |
| [lib/agent.js](lib/agent.js) | `claude --print` adapter |
| [lib/agent-opencode.js](lib/agent-opencode.js) | `opencode run` adapter |

## File map

```
v2/
├── orchestrator.js        # entry point — argv parsing, phase dispatch, loop logic
├── reward-audit.js        # CLI: audit episode reward breakdowns
├── distill-learnings.js   # CLI: harvest episodes → memory/LEARNINGS.md
├── command.md             # slash-command launcher (used by /fullstack-2)
├── README.md              # this file
├── lib/                   # see "Helper modules" above
└── scripts/
    ├── test-blend-and-reward.js
    └── test-evaluator-standalone.js
```

Cross-cutting gate scripts (called from blueprints' deterministic nodes):

```
.claude/gates/
├── _gate-runner.sh                    # shared utilities (init_gate, run_check, output_results)
├── <phase>-gate.sh                    # per-phase deterministic scoring (12 files)
└── cross-reference-consistency.sh     # 6-check drift gate (routes/states/columns/HTML/i18n/services)
```

## Not yet ported from v1

- Policy memory (RL bandit — needs ≥ 20 scored episodes first)
- `--adopt` / `--update`
- Inline `AskUserQuestion` for design-variation confirmation (works via abort + `--resume` instead)

## See also

- [.claude/commands/fullstack-2.md](../commands/fullstack-2.md) — slash-command wrapper used by Claude Code
- [.claude/blueprints/](../blueprints/) — every `*-2.yaml` blueprint and the `evaluators/` rubric library
- [.claude/gates/](../gates/) — `<phase>-gate.sh` deterministic scoring scripts
- [.claude/pipeline/loop/reward.yaml](../pipeline/loop/reward.yaml) — reward configuration
