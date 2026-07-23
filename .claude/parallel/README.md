# fullstack-2 parallel runner

Parallel multi-model `/fullstack-2` runner. Spawns N target dirs (one per (model, cake)),
each with its own `.claude-project/`, `backend/`, `frontend/`. Source workspace
is read by the foundation phase; cells are written into isolated dirs.

## Code/data layout

| Location | Purpose | Tracked? |
|---|---|---|
| `.claude/parallel/` | Scripts (run-parallel, aggregate, diagnose, harvest) + this README + `cells.conf.example` | YES (in submodule) |
| `experiments/parallel-runs/` | Per-project run output: `cells.conf`, `baseline.tar`, `runs/<tag>/run-<cell>/`, `logs/<tag>/`, `aggregate/`, `SUMMARY.md` | NO (gitignored) |
| `.claude-project/archive/manifest.csv` | Cross-run RL ledger (one row per episode) | YES |
| `.claude-project/memory/FAILURE_PATTERNS.yaml` | Pattern catalog (mitigated/open known failure shapes) | depends on project gitignore |

The slash command `/fullstack-2-parallel` is the recommended entry point. All
script invocations below run from the workspace root.

## Quick Start (from PRD)

Two commands. That's it.

```bash
# (run from workspace root)

# 1. Build shared foundation from PRD (init → prd → design → user-stories)
bash .claude/parallel/run-parallel.sh --from-prd ./FSP-requirements.pdf

# 2. Run parallel cells with different models (database → test-browser per cell)
bash .claude/parallel/run-parallel.sh --from-baseline
```

After `--from-baseline` finishes, `SUMMARY.md` is generated automatically with
per-cell results, rewards, and model variance.

## Architecture: Foundation + Parallel

The pipeline is split into two tiers so every model builds against the same
starting point — making output comparable across models:

| Tier | Phases | Runs | Purpose |
|------|--------|------|---------|
| Foundation | init → prd → design → user-stories | Once (source workspace) | Produces SOT docs, design system, HTML screens, user stories |
| Parallel | database → backend → frontend → integrate → test-api → test-browser | N times (one per cell per model) | Each model builds its own database + backend + frontend against shared foundation |

**Flow:**
1. `--from-prd <file>` builds foundation phases and snapshots `baseline.tar`
2. `--from-baseline` extracts the baseline into isolated cell directories and runs them
3. Aggregate runs automatically after cells finish → `SUMMARY.md`

HTML screens are generated under `.claude-project/design/html/<frontend-dir>/*.html`
during the foundation phase. Each cell's frontend phase reads from this shared design.

## Usage

### Primary flow (from PRD)

```bash
# (run from workspace root)

# Build foundation from PRD → baseline.tar
bash .claude/parallel/run-parallel.sh --from-prd ./path/to/PRD.pdf

# Run all cells (3 models × 2 cakes = 6 cells, 3 waves)
bash .claude/parallel/run-parallel.sh --from-baseline

# Run single cell for testing
bash .claude/parallel/run-parallel.sh --from-baseline --cell deepseek-v4-pro-cake1

# Run specific wave
bash .claude/parallel/run-parallel.sh --from-baseline --wave 1
```

### Classic flow (manual step-by-step)

```bash
# (run from workspace root)

# 0. Build foundation in source workspace first (via orchestrator)
node ../../.claude/v2/orchestrator.js fsp --run-all

# 1. Snapshot baseline from source workspace
bash .claude/parallel/run-parallel.sh --setup-baseline

# 2. Run a single cell (smoke test)
bash .claude/parallel/run-parallel.sh --cell deepseek-v4-pro-cake1

# 3. Run a single wave (2 cells in parallel)
bash .claude/parallel/run-parallel.sh --wave 1

# 4. Run all 3 waves sequentially
bash .claude/parallel/run-parallel.sh --all

# 5. Aggregate
bash .claude/parallel/run-parallel.sh --aggregate
```

### Inspect

```bash
bash .claude/parallel/run-parallel.sh --status
bash .claude/parallel/run-parallel.sh --chase deepseek-v4-pro-cake1
```

## Command Reference

| Command | Description |
|---------|-------------|
| `--from-prd <file>` | Build foundation phases from PRD, snapshot baseline, stop |
| `--from-baseline` | Run all waves from existing baseline, aggregate after |
| `--from-baseline --wave N` | Run specific wave only |
| `--from-baseline --cell <n>` | Run single cell only |
| `--setup-baseline` | Snapshot source workspace into baseline.tar |
| `--all` | Run all waves (setup-baseline if missing) |
| `--wave N` | Run wave N (setup-baseline if missing) |
| `--cell <name>` | Run a single cell |
| `--chase <name>` | Tail log and auto-retry on failure |
| `--status` | Print cell states and phase progress |
| `--aggregate` | Run aggregate.sh to produce SUMMARY.md + archive |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROJECT` | `fsp` | Project name passed to orchestrator |
| `CELLS_CONF` | `./cells.conf` | Path to cell matrix config file |
| `BASELINE_FROM` | `backend` | Where parallel cells start in the pipeline |
| `FORCE` | (unset) | Set to `1` to skip guard checks in setup_baseline |
| `NODE_TIMEOUT_MS` | `600000` (10 min) | C1 subprocess timeout — reduces hang cost from 30→10 min |
| `PARALLEL_QUALITY` | `0.85` | Phase quality threshold (lowered from orchestrator default 0.95) |
| `MAX_PARALLEL_CELLS` | (all) | Cap concurrent cells; default = launch every active cell at once |
| `RESPECT_WAVES` | (unset) | `1` = legacy sequential-wave behavior; default ignores wave field |
| `STREAM_INTERVAL_SEC` | `900` (15 min) | Streaming aggregator interval (W4 reform) |
| `SKIP_STREAM` | (unset) | `1` = disable streaming aggregator |
| `SKIP_DIAGNOSE` | (unset) | `1` = skip pre-run pattern classification |
| `SKIP_HARVEST` | (unset) | `1` = skip pre-run flat-layout harvest |
| `SKIP_HARVEST_ATTEMPT` | (unset) | `1` = skip per-attempt artifact snapshots (S2) |
| `SKIP_PREDICT` | (unset) | `1` = skip pre-run failure-rate prediction (A1) |
| `HARVEST_KEEP` | (unset) | `1` = archive flat dirs but don't delete |

### BASELINE_FROM — control where parallel cells start

```bash
# Default: cells start from backend (foundation = init through database)
bash .claude/parallel/run-parallel.sh --setup-baseline

# Start cells from database (each model builds its own schema)
BASELINE_FROM=database bash .claude/parallel/run-parallel.sh --setup-baseline

# Start cells from user-stories (shared database, model-own pages + backend)
BASELINE_FROM=user-stories bash .claude/parallel/run-parallel.sh --setup-baseline
```

`--from-prd` automatically sets `BASELINE_FROM=database` so cells own the database
phase — giving maximum model differentiation.

## Cell Configuration (`cells.conf`)

The cell matrix is defined in `cells.conf`:

```
# Format: name | wave | backend | model | port
deepseek-v4-pro-cake1 | 1 | opencode | opencode-go/deepseek-v4-pro | 3201
qwen3.6-plus-cake1 | 1 | opencode | opencode-go/qwen3.6-plus | 3301
claude-opus-cake1 | 2 | claude | | 3101
claude-opus-cake2 | 2 | claude | | 3102
deepseek-v4-pro-cake2 | 3 | opencode | opencode-go/deepseek-v4-pro | 3202
qwen3.6-plus-cake2 | 3 | opencode | opencode-go/qwen3.6-plus | 3302
```

### Cell matrix (3 models × 2 cakes = 6 cells)

| Cell | Backend | Model | Backend port |
|---|---|---|---|
| deepseek-v4-pro-cake1 | opencode | opencode-go/deepseek-v4-pro | 3201 |
| deepseek-v4-pro-cake2 | opencode | opencode-go/deepseek-v4-pro | 3202 |
| qwen3.6-plus-cake1 | opencode | opencode-go/qwen3.6-plus | 3301 |
| qwen3.6-plus-cake2 | opencode | opencode-go/qwen3.6-plus | 3302 |
| claude-opus-cake1 | claude | (default) | 3101 |
| claude-opus-cake2 | claude | (default) | 3102 |

### Adding a new model

Edit `cells.conf` and add a row:

```
# New model
gemini-flash-cake1 | 3 | opencode | google/gemini-2.5-flash | 3401
```

Custom config file:
```bash
CELLS_CONF=./my-cells.conf bash .claude/parallel/run-parallel.sh --from-baseline
```

## Isolation contract

The source workspace is shared with other in-flight `/fullstack-2` runs. To avoid corruption:

| Resource | Rule |
|---|---|
| `claude-fullstack-workspace/.claude-project/` | NEVER write — only the in-flight orchestrator writes here |
| `claude-fullstack-workspace/backend/`, `frontend/` | NEVER write — in-flight uses these as its build dir |
| `claude-fullstack-workspace/.claude/` | Read-only blueprints; no edits during runs |
| `~/.claude/` global config | Read-only during runs |
| Ports 3000 / 5173 | Reserved for in-flight; cells use 31xx / 32xx / 33xx |
| OpenCode-go quota (deepseek) | Shared with in-flight — schedule deepseek cells AFTER in-flight finishes |
| Claude Code subscription | Free — no in-flight Claude consumer |

## Files / dirs created at runtime

```
experiments/parallel-runs/
├── cells.conf                    # cell matrix config (editable)
├── baseline.tar                  # snapshot of source workspace foundation
├── run-<cell>/                   # per-cell --path target
│   ├── .claude-project/
│   │   ├── design/html/<frontend>/   # shared HTML screens (from foundation)
│   │   ├── docs/                     # shared SOT artifacts (PROJECT_*.md)
│   │   ├── episodes/                 # per-cell episode JSONL
│   │   └── memory/                   # per-cell learnings (merged back post-run)
│   ├── backend/
│   └── frontend/
├── logs/
│   ├── <cell>.log                    # full stdout from orchestrator
│   ├── <cell>.pid                    # process id while running
│   └── <cell>.exit                   # orchestrator exit code
├── aggregate/episodes/<cell>/        # per-cell episode files
└── SUMMARY.md                        # cross-cell results table
```

## Troubleshooting

- **`ERROR: baseline.tar missing`** — run `--from-prd` or `--setup-baseline` first.
- **`ERROR: '<phase>' phase is not Complete`** — the source workspace hasn't finished the foundation phases. Run `--from-prd <file>` to build from scratch, or use `FORCE=1` to snapshot incomplete state.
- **`WARNING: another /fullstack-2 orchestrator is still running`** — wait for it, or override with `FORCE=1`.
- **Cell stuck on `npm install`** — check `logs/<cell>.log`; OpenCode subprocesses sometimes hang on package resolution. Kill via `kill $(cat logs/<cell>.pid)` and re-run.
- **Cell stuck on evaluator** — the LLM backend may be rate-limited or unresponsive. Kill the cell and re-run; the orchestrator will resume from saved blueprint state.
- **Port already in use** — another cell or the in-flight orchestrator is bound. Edit ports in `cells.conf`.
- **Out of disk** — each clone needs ~2 GB after `npm install`. Check `df -h ~`. Clean up with `rm -rf run-<cell>/`.

## Why these design choices

- **Foundation + Parallel split** — phases init→user-stories run once in the source workspace and snapshotted. Cells extract this foundation and run only the model-dependent phases (database→test-browser). Eliminates cross-cell variance from different models generating different screens/specs.
- **`.claude-project/design/html/<frontend>/*.html`** — the canonical HTML output path. Cells share foundation-generated screens; no model re-invents the visual layer.
- **Sibling location (`experiments/parallel-runs/`)** — keeps clones within the repository for easy reference, with `run-*` dirs gitignored.
- **`tar` baseline + extract** instead of `git worktree` — most generated content is gitignored, so worktree wouldn't capture it.
- **`--exclude=node_modules` in baseline** — each cell runs its own `npm install` for isolation; saves 5+ GB per clone.
- **Per-cell episodes wiped on extract** — each cake should be independent training data, not contaminated by baseline build's events.
- **Pair Claude + OpenCode per wave** — Claude Code subscription and OpenCode-go are different quota pools, so 1 of each runs concurrently without quota contention.
- **Configurable cells via `cells.conf`** — add/remove models without editing the script.
- **`--from-prd` as single entry point** — two-command workflow replaces 6+ manual steps.

See plan: `~/.claude/plans/i-want-to-run-graceful-grove.md` for full context.
