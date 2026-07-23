#!/usr/bin/env bash
# run-parallel.sh — Parallel multi-model fullstack-2 orchestrator runner
# Spawns N cells (configurable via cells.conf) with isolated target
# directories per cell. Each cell runs the full pipeline independently
# against a shared baseline built from a PRD or existing source workspace.
#
# Lives in: .claude/parallel/ (code, ships with the .claude submodule)
# Run output goes to: experiments/parallel-runs/ (data, project-local)
#
# Quick start (from PRD):
#   bash .claude/parallel/run-parallel.sh --from-prd ./FSP-requirements.pdf
#   bash .claude/parallel/run-parallel.sh --from-baseline
#
# Classic usage:
#   bash .claude/parallel/run-parallel.sh --setup-baseline
#   bash .claude/parallel/run-parallel.sh --all
#   bash .claude/parallel/run-parallel.sh --cell <name>
#   bash .claude/parallel/run-parallel.sh --aggregate
#
# Environment:
#   FORCE=1               Skip guard checks during baseline setup
#   CELLS_CONF=<path>     Override cells config
#                          (default: $DATA_DIR/cells.conf)
#   BASELINE_FROM=<pp>    Where cells start (default: backend).
#                          Use "database" to include database phase in cells.
#   PROJECT=<name>        Project name (default: fsp)
#   TAG=<name>            Optional label; scopes output under runs/<ts>-<tag>/
#                          Run modes auto-tag if not given.
#   SOURCE_DIR=<path>     Workspace root (default: cwd at invocation)
#   PARALLEL_DATA_DIR=<p> Override data dir
#                          (default: $SOURCE_DIR/experiments/parallel-runs)
set -u

# ─── path layout (code/data split) ────────────────────────────────────
# CODE_DIR = where this script lives (.claude/parallel/)
# SOURCE_DIR = workspace root; defaults to cwd (slash commands run from root)
# DATA_DIR = where run output, baseline, cells.conf, logs live;
#            default = experiments/parallel-runs/ relative to SOURCE_DIR
#
# Sibling scripts (aggregate.sh, diagnose.sh, harvest.sh) live in CODE_DIR.
# Run output (run-<cell>/, runs/, logs/, aggregate/, baseline.tar) lives in DATA_DIR.

CODE_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="${SOURCE_DIR:-$PWD}"
PROJECT="${PROJECT:-fsp}"
# Per-PRD layout: experiments/parallel-runs/<project>/{baseline.tar,cells.conf,runs,logs}.
# PARALLEL_DATA_DIR override should point at the per-project leaf, not the parent.
DATA_DIR="${PARALLEL_DATA_DIR:-$SOURCE_DIR/experiments/parallel-runs/$PROJECT}"
PARALLEL_ROOT="$DATA_DIR"   # legacy name, kept so internal refs still work

# FROM_BACKEND=1 — freeze the backend (skip the ~2h database+backend regen) and
# iterate ONLY frontend → ship. Same logic that froze design (v53), one phase
# further: once the backend is stable (gate det 1.000, boots+serves) there's no
# value re-generating it every run. Implies BUILD_ONLY=1; pre-build restores the
# canonical frozen backend from $BACKEND_CANONICAL_DIR and marks database+backend
# Complete (orchestrator then skips them). Rebuild the freeze when the backend
# genuinely changes: capture a known-good run's backend/ into backend-canonical/.
if [ "${FROM_BACKEND:-0}" = "1" ]; then
  export BUILD_ONLY=1
  export FREEZE_BACKEND=1
  export BACKEND_CANONICAL_DIR="${BACKEND_CANONICAL_DIR:-$DATA_DIR/backend-canonical}"
  if [ ! -d "$BACKEND_CANONICAL_DIR/src" ]; then
    echo "FROM_BACKEND=1 but no frozen backend at $BACKEND_CANONICAL_DIR/src — capture a known-good run's backend/ there first." >&2
    exit 1
  fi
  echo "[FROM_BACKEND] frozen backend: $BACKEND_CANONICAL_DIR — database+backend will be skipped"
fi

# When BUILD_ONLY=1 is set, prefer baseline-post-design.tar (canonical
# PRD + HTML + user_stories + scaffolds; ~11MB, no node_modules) so each
# cell starts ready for the slim pipeline (pre-build → database → ...).
# See blueprints/pre-build-2.yaml. Falls back to baseline.tar if the
# post-design one doesn't exist yet (treat as opt-in).
if [ "${BUILD_ONLY:-0}" = "1" ] && [ -f "$DATA_DIR/baseline-post-design.tar" ]; then
  BASELINE_TAR="$DATA_DIR/baseline-post-design.tar"
else
  BASELINE_TAR="$DATA_DIR/baseline.tar"
fi
LOG_DIR="$DATA_DIR/logs"
CELLS_CONF="${CELLS_CONF:-$DATA_DIR/cells.conf}"
BASELINE_FROM="${BASELINE_FROM:-backend}"

# Default 1 attempt — auto-retry of the same code burns compute without
# producing new signal (validated across v1-v17: same code → same failures).
# Override via env: MAX_RETRIES=3 bash run-parallel.sh ... for legacy behavior.
# For diagnose-and-fix loops, use --resume on a follow-up launch instead.
MAX_RETRIES="${MAX_RETRIES:-1}"

ORCHESTRATOR="$SOURCE_DIR/.claude/v2/orchestrator.js"

# C1 subprocess timeout — defaults to 25 min per agentic node (long enough
# for heavy implement/convert-pages cells, short enough to bound a true hang).
# v22 evidence: 10-min default fired the watchdog 32 times across both cells,
# killing many legitimately-slow nodes mid-generation. 25 min lets heavy work
# complete while still bounding hangs.
# Env-overridable: NODE_TIMEOUT_MS=1200000 to use 20 min, etc.
export NODE_TIMEOUT_MS="${NODE_TIMEOUT_MS:-1500000}"

# Ensure data dir exists (first invocation against a fresh project)
mkdir -p "$DATA_DIR" 2>/dev/null || true

# ─── run scoping ──────────────────────────────────────────────────────
# When TAG is set, all output goes under runs/<timestamp>-<tag>/ and
# logs/<timestamp>-<tag>/.  Without TAG, flat run-<cell>/ and logs/
# (full backward compatibility with existing runs).

TAG="${TAG:-}"
RUN_ID=""
if [ -n "$TAG" ]; then
  RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$TAG"
fi

RUN_ROOT=""
if [ -n "$RUN_ID" ]; then
  RUN_ROOT="$PARALLEL_ROOT/runs/$RUN_ID"
fi

# Path helpers — encapsulate flat vs scoped layout
cell_run_dir() {
  local cell="$1"
  if [ -n "$RUN_ROOT" ]; then
    echo "$RUN_ROOT/run-$cell"
  else
    echo "$PARALLEL_ROOT/run-$cell"
  fi
}

cell_log_dir() {
  if [ -n "$RUN_ID" ]; then
    echo "$LOG_DIR/$RUN_ID"
  else
    echo "$LOG_DIR"
  fi
}

# ─── cell config loader (bash 3.2 compatible) ────────────────────────

CELLS=""

# Load cells.conf into per-cell variables.
# Variable naming: cell_WAVE_<name> cell_BACKEND_<name> cell_MODEL_<name> cell_PORT_<name>
# Dashes in names are replaced with underscores for valid shell var names.
_load_cell() {
  local raw="$1" wave="$2" backend="$3" model="$4" port="$5"
  local name
  name=$(echo "$raw" | xargs)
  wave=$(echo "$wave" | xargs)
  backend=$(echo "$backend" | xargs)
  model=$(echo "$model" | xargs)
  port=$(echo "$port" | xargs)

  local vname
  vname=$(echo "$name" | sed 's/[-.]/_/g')

  CELLS="$CELLS $name"
  eval "cell_WAVE_${vname}=\"$wave\""
  eval "cell_BACKEND_${vname}=\"$backend\""
  eval "cell_MODEL_${vname}=\"$model\""
  eval "cell_PORT_${vname}=\"$port\""
}

# Read config file line by line (no subshell pipe — bash 3.2 safe)
_load_config() {
  local conf="$1"
  if [ ! -f "$conf" ]; then
    echo "ERROR: cells config not found at $conf" >&2
    echo "       Set CELLS_CONF=/path/to/cells.conf or create the default one." >&2
    exit 1
  fi
  local line raw name wave backend model port
  while read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [ -z "$(echo "$line" | xargs)" ] && continue
    # Split on | while preserving empty fields
    raw=$(echo "$line" | cut -d'|' -f1)
    wave=$(echo "$line" | cut -d'|' -f2)
    backend=$(echo "$line" | cut -d'|' -f3)
    model=$(echo "$line" | cut -d'|' -f4)
    port=$(echo "$line" | cut -d'|' -f5)
    _load_cell "$raw" "$wave" "$backend" "$model" "$port"
  done < "$conf"

  if [ -z "$CELLS" ]; then
    echo "ERROR: no cells loaded from $conf" >&2
    exit 1
  fi
}
_load_config "$CELLS_CONF"

# Indirect variable lookups (bash 3.2 compatible via ${!var})
_vname()     { echo "$1" | sed 's/[-.]/_/g'; }
cell_wave()   { local v="cell_WAVE_$(_vname "$1")";   echo "${!v:-0}"; }
cell_port()   { local v="cell_PORT_$(_vname "$1")";   echo "${!v:-0}"; }
cell_backend() { local v="cell_BACKEND_$(_vname "$1")"; echo "${!v:-unknown}"; }
cell_model()  { local v="cell_MODEL_$(_vname "$1")";   echo "${!v:-}"; }

# ─── wave helpers ─────────────────────────────────────────────────────

get_cells_in_wave() {
  local wave="$1"
  for cell in $CELLS; do
    local w
    w=$(cell_wave "$cell")
    [ "$w" = "$wave" ] && echo "$cell"
  done
}

get_max_wave() {
  local max=0 w
  for cell in $CELLS; do
    w=$(cell_wave "$cell")
    [ "$w" -gt "$max" ] && max="$w"
  done
  echo "$max"
}

# ─── helpers ───────────────────────────────────────────────────────────

print_help() {
  cat <<'EOF'
Usage: run-parallel.sh [OPTION]

Foundation (build shared SOT from PRD):
  --from-prd <file>     Build foundation phases from PRD, snapshot baseline, stop
                        (init → prd → design → user-stories → snapshot)

Parallel cells (run from existing baseline):
  --from-baseline       Run all waves, aggregate after (requires baseline.tar)
  --from-baseline --wave N    Run specific wave only
  --from-baseline --cell <n>  Run specific cell only

Classic modes (manual step-by-step):
  --setup-baseline      Snapshot source workspace into baseline.tar
  --all                 Run all waves sequentially (setup-baseline if missing)
  --wave N              Run wave N; setup-baseline if missing
  --cell <name>         Run a single cell (e.g. deepseek-v4-pro-cake1)
  --chase <name>        Tail log and auto-retry on failure

Inspection:
  --status              Print cell states and phase progress
  --progress            Print per-cell phase/node transition timeline (S3-substitute)
  --aggregate           Run aggregate.sh to produce SUMMARY.md + archive
  --list                List past tagged runs
  --clean --older-than <d>  Remove runs older than N days
  --help, -h            Show this help message

Options:
  --tag <name>          Label this run; output goes under runs/<ts>-<tag>/
                         Run modes auto-tag with 'auto-HHMMSS' if not given.
  --no-tag              Force flat run-<cell>/ layout (legacy, opts out of auto-tag)
  --hypothesis <text>   REQUIRED for tagged run-producing modes. One-line
                         statement of what this version is testing vs. the
                         previous version. Written to runs/<RUN_ID>/HYPOTHESIS.md
                         alongside SHAs of .claude / nestjs / react submodules
                         and baseline_sha so future audits can reconstruct the
                         delta. Skip only with --no-hypothesis (escape hatch).
  --no-hypothesis       Skip the --hypothesis requirement (escape hatch — use
                         only for ad-hoc debug runs you don't intend to compare).
  --resume              Continue from an existing tagged run dir instead of
                         extracting baseline.tar over a fresh dir. Requires
                         --tag matching an existing run. The orchestrator
                         skips phases already marked Complete in PIPELINE_STATUS
                         and re-runs only Pending/Failed phases. Lets you patch
                         source code, bump submodules, then iterate without
                         losing 30-90min of prior phase work. HYPOTHESIS.md
                         from the original launch is preserved (not rewritten).

Environment:
  FORCE=1              Skip guard checks in setup_baseline
  CELLS_CONF=<path>    Override cells config (default: ./cells.conf)
  BASELINE_FROM=<pp>   Where parallel cells start (default: backend).
                        Use "database" to include database phase in cells.
  PROJECT=<name>       Project name (default: fsp)
  TAG=<name>           Same as --tag flag
  SKIP_DIAGNOSE=1      Disable pre-run failure-pattern triage (default: enabled
                        for run-producing modes; warn-only, never blocks)
  SKIP_HARVEST=1       Disable pre-run harvest of flat-layout failed runs
                        (default: archive episodes to manifest.csv + delete
                        flat run-<cell>/ + flat logs/<cell>.* on every run)
  HARVEST_KEEP=1       Archive but DON'T clear flat dirs (inspect manually first)
  SKIP_PREDICT=1       Disable pre-run fail-rate prediction (A1, warn-only)
  SKIP_HARVEST_ATTEMPT=1   Skip per-attempt artifact snapshots (S2)
  SKIP_STREAM=1 / STREAM_INTERVAL_SEC=N    Streaming aggregate control (W4)
  NODE_TIMEOUT_MS=N    C1 subprocess timeout in ms (default 1500000 = 25 min)
  EVALUATOR_TIMEOUT_MS=N  Evaluator subprocess timeout in ms (default 2100000 = 35 min)
  PARALLEL_QUALITY=N   Phase quality threshold (default 0.85)
  MAX_PARALLEL_CELLS=N Cap concurrent cells (default = all at once)
  RESPECT_WAVES=1      Force legacy sequential-wave behavior
  SKIP_PREFLIGHT=1     Suppress host-tool availability check at run start
EOF
}

# ─── host-tool preflight ───────────────────────────────────────────────
# Late phases of the pipeline (test-api, test-browser, ship) assume
# specific tools exist on PATH. Without this check, a cell can spend an
# hour completing database+backend before discovering that, e.g.,
# playwright-cli isn't installed and test-browser will hard-abort. Warn
# loudly here so the user can install missing tools (or accept the risk)
# before the cell launches. SKIP_PREFLIGHT=1 silences this entirely.
preflight_host_tools() {
  [ "${SKIP_PREFLIGHT:-0}" = "1" ] && return 0
  echo ""
  echo "=== host-tool preflight ==="
  local tool path
  for tool in pm2 playwright-cli psql node npx; do
    if path=$(command -v "$tool" 2>/dev/null); then
      echo "  ✓ $tool: $path"
    else
      echo "  ⚠ $tool: NOT FOUND — phase that needs it may abort"
    fi
  done
  if npx --no-install playwright --version >/dev/null 2>&1; then
    local pw_ver
    pw_ver=$(npx --no-install playwright --version 2>&1 | head -1)
    echo "  ✓ playwright (npx): $pw_ver"
  else
    echo "  ⚠ playwright (npx): missing — test-browser story-runner will fail"
  fi
  echo "  (set SKIP_PREFLIGHT=1 to suppress this check)"
  echo "==========================="
  echo ""
}

inflight_running() {
  local active=1 pid_found=0 cell pid
  local logd
  logd=$(cell_log_dir)
  for cell in $CELLS; do
    local pidfile="$logd/$cell.pid"
    if [ -f "$pidfile" ]; then
      pid_found=1
      pid=$(cat "$pidfile" 2>/dev/null || true)
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        echo "  [INFLIGHT] $cell (pid=$pid)"
        active=0
      else
        echo "  [stale]    $cell (pid=$pid, process gone)"
      fi
    fi
  done
  if [ "$pid_found" -eq 0 ]; then
    echo "  No .pid files found."
  fi
  return $(( 1 - active ))
}

# Which phase must be Complete in PIPELINE_STATUS.md for the baseline guard?
# BASELINE_FROM=database → design must be Complete
# BASELINE_FROM=user-stories → user-stories must be Complete
# default (backend) → database must be Complete
guard_phase() {
  case "$BASELINE_FROM" in
    database) echo "design" ;;
    user-stories) echo "user-stories" ;;
    *) echo "database" ;;
  esac
}

setup_baseline() {
  local guard
  guard=$(guard_phase)
  local status_file="$SOURCE_DIR/.claude-project/$PROJECT/status/PIPELINE_STATUS.md"

  if [ "${FORCE:-}" != "1" ]; then
    if [ ! -f "$status_file" ]; then
      echo "ERROR: PIPELINE_STATUS.md not found at $status_file" >&2
      echo "       Set FORCE=1 to skip this check." >&2
      exit 1
    fi
    if ! grep -qE "^\|.*\|\s*$guard\s*\|.*\|\s*Complete\s*\|" "$status_file"; then
      echo "ERROR: '$guard' phase is not Complete in $status_file" >&2
      echo "       BASELINE_FROM=$BASELINE_FROM requires '$guard' to be Complete." >&2
      echo "       Set FORCE=1 to skip this check." >&2
      exit 1
    fi
  fi

  echo "Creating baseline tar (foundation up to: $guard) from $SOURCE_DIR ..."
  tar -cf "$BASELINE_TAR" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='experiments/parallel-runs/run-*' \
    --exclude='experiments/parallel-runs/runs' \
    --exclude='experiments/parallel-runs/logs' \
    --exclude='experiments/parallel-runs/logs.failed-*' \
    --exclude='experiments/parallel-runs/*.tar' \
    --exclude='experiments/parallel-runs/aggregate' \
    --exclude='.DS_Store' \
    -C "$SOURCE_DIR" .

  local size
  size=$(du -h "$BASELINE_TAR" | cut -f1)
  echo "done ($size)"
}

extract_baseline() {
  local cell_name="$1"
  local rundir
  rundir=$(cell_run_dir "$cell_name")

  echo "[$cell_name] Extracting baseline ..."
  mkdir -p "$rundir"
  tar -xf "$BASELINE_TAR" -C "$rundir"

  # Wipe per-run state so each cell starts clean.
  # memory/ is PRESERVED — carries baseline learnings from foundation phases.
  rm -rf "$rundir/.claude-project/$PROJECT/episodes"
  rm -rf "$rundir/.gate-proofs"

  # Remove evaluation artifacts
  find "$rundir" -name '*-evaluation.json' -delete 2>/dev/null || true
  find "$rundir" -name '*-evaluator-*.log' -delete 2>/dev/null || true

  # Remove status log files
  find "$rundir/.claude-project/$PROJECT/status" -name '*.log' -delete 2>/dev/null || true

  # Reset only the phases at-or-after BASELINE_FROM. Phases the foundation
  # already completed (init, prd, design, user-stories for BASELINE_FROM=database)
  # stay marked Complete so each cell starts at the right point.
  #
  # Bug fix: previously this reset *all* phases unconditionally, so cells
  # re-ran prd/design/user-stories even though baseline.tar already had them
  # done. That wasted ~10 min per cell and defeated the foundation+cells split.
  local reset_phases
  case "$BASELINE_FROM" in
    user-stories) reset_phases="user-stories backend frontend integrate test-api test-browser" ;;
    database)     reset_phases="database user-stories backend frontend integrate test-api test-browser" ;;
    *)            reset_phases="backend frontend integrate test-api test-browser" ;;
  esac

  local status_file phase
  for status_file in "$rundir"/.claude-project/*/status/PIPELINE_STATUS.md; do
    [ -f "$status_file" ] || continue
    for phase in $reset_phases; do
      sed -i '' -E "s/(\| *${phase} *\|) *(Complete|Failed) *(\|)/\1 Pending \3/g" "$status_file"
    done
  done

  # Delete per-phase blueprint state files for the phases we reset, so the
  # orchestrator's --resume can't pick up stale node progress from the source.
  # Pre-BASELINE_FROM blueprint state files are kept (they record successful
  # node completions the cell shouldn't re-do).
  for phase in $reset_phases; do
    find "$rundir/.claude-project/$PROJECT/status" -name ".blueprint-${phase}.json" -delete 2>/dev/null || true
  done

  # ─── Baseline corruption guard ──────────────────────────────────────────
  # Foundation phases (everything before BASELINE_FROM) must be Complete in
  # the extracted PIPELINE_STATUS. If any are Pending/Failed, the baseline.tar
  # is corrupt — proceeding would silently re-run those phases per cell and
  # waste 10-30 min each. Warn loudly with rebuild instructions.
  #
  # Note: this guards against PIPELINE_STATUS corruption only. Gate re-evaluation
  # at orchestrator startup can still flip Complete→Pending if a deterministic
  # check fails — see design-gate.sh DESIGN_SYSTEM_<variation> handling.
  local foundation_phases
  # BUILD_ONLY=1 slim pipeline starts at pre-build → database. Foundation
  # phases (init/spec/prd/design/user-stories) are seeded by pre-build
  # itself, NOT by the baseline. The post-design baseline marks these
  # Complete and database Pending, which is the correct shape.
  if [ "${BUILD_ONLY:-0}" = "1" ]; then
    foundation_phases="init spec prd design user-stories"
  else
    case "$BASELINE_FROM" in
      user-stories) foundation_phases="init spec prd design" ;;
      database)     foundation_phases="init spec prd design user-stories" ;;
      *)            foundation_phases="init spec prd design user-stories database" ;;
    esac
  fi

  local corrupted=""
  for status_file in "$rundir"/.claude-project/*/status/PIPELINE_STATUS.md; do
    [ -f "$status_file" ] || continue
    for phase in $foundation_phases; do
      if ! grep -qE "^\| *${phase} *\| *Complete *\|" "$status_file"; then
        corrupted="$corrupted $phase"
      fi
    done
    break  # only check first match (one project per cell)
  done

  if [ -n "$corrupted" ]; then
    echo "" >&2
    echo "⚠  [$cell_name] BASELINE CORRUPTION DETECTED" >&2
    echo "   Foundation phases NOT Complete in baseline.tar:$corrupted" >&2
    echo "   BASELINE_FROM=$BASELINE_FROM expects all foundation phases Complete." >&2
    echo "   Cell will re-run these phases (~10-30 min wasted)." >&2
    echo "" >&2
    echo "   Rebuild baseline:" >&2
    echo "     1. Fix source workspace state (run failing phases via /fullstack-2)" >&2
    echo "     2. Re-snapshot: bash .claude/parallel/run-parallel.sh --setup-baseline" >&2
    echo "" >&2
    if [ "${ALLOW_CORRUPT_BASELINE:-0}" != "1" ]; then
      echo "   Aborting. Set ALLOW_CORRUPT_BASELINE=1 to proceed anyway." >&2
      exit 1
    fi
    echo "   ALLOW_CORRUPT_BASELINE=1 set — proceeding despite corruption." >&2
  fi

  echo "[$cell_name] Baseline extracted."
}

# ─── foundation phase runner (for --from-prd) ─────────────────────────

run_phase() {
  local phase="$1"
  shift
  local extra_args="$@"

  local status_file="$SOURCE_DIR/.claude-project/$PROJECT/status/PIPELINE_STATUS.md"
  if [ -f "$status_file" ]; then
    if grep -qE "^\|.*\|\s*$phase\s*\|.*\|\s*Complete\s*\|" "$status_file"; then
      echo "[foundation] SKIP $phase — already Complete"
      return 0
    fi
  fi

  echo ""
  echo "=== [foundation] RUNNING: $phase ==="
  node "$ORCHESTRATOR" "$PROJECT" --phase "$phase" $extra_args
  local exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    echo "ERROR: $phase phase failed (exit $exit_code)" >&2
    exit $exit_code
  fi
  echo "[foundation] $phase Complete"
}

run_foundation_from_prd() {
  local prd_file="$1"

  if [ ! -f "$prd_file" ]; then
    echo "ERROR: PRD file not found: $prd_file" >&2
    exit 1
  fi

  echo "============================================================"
  echo "FOUNDATION: building shared SOT from PRD"
  echo "  PRD:     $prd_file"
  echo "  Project: $PROJECT"
  echo "  Phases:  init → prd → design → user-stories"
  echo "  Baseline: cells will run database → test-browser in parallel"
  echo "============================================================"

  export BASELINE_FROM=database

  # init — creates PIPELINE_STATUS.md + project skeleton
  run_phase "init"

  # prd — generates PROJECT_KNOWLEDGE.md, PROJECT_API.md, PROJECT_DATABASE.md
  run_phase "prd" "--prd" "$prd_file"

  # design — generates DESIGN_SYSTEM.md + HTML prototypes
  run_phase "design"

  # user-stories — generates YAML specs from design + API docs
  run_phase "user-stories"

  echo ""
  echo "=== Foundation complete. Snapshotting baseline ==="
  setup_baseline

  echo ""
  echo "============================================================"
  echo "Baseline ready ($BASELINE_TAR)"
  echo "============================================================"
  echo ""
  echo "Next: run parallel cells with different models:"
  echo "  bash run-parallel.sh --from-baseline"
  echo ""
  echo "Or inspect/test a single cell first:"
  local first_cell
  first_cell=$(echo $CELLS | awk '{print $1}')
  echo "  bash run-parallel.sh --from-baseline --cell $first_cell"
}

# ─── per-attempt artifact harvest (S2) ────────────────────────────────
# Snapshots whatever the cell produced during one attempt into the archive.
# Called after each attempt's exit (success or fail) so even all-fail runs
# leave a per-attempt artifact trail under
#   .claude-project/archive/artifacts/<run-id>/<cell>/attempt-<n>/
#
# Snapshots, doesn't move — original cell dir stays intact for retries.
# Skipped if SKIP_HARVEST_ATTEMPT=1 (e.g. when disk-pressured).
harvest_attempt_partials() {
  local cell="$1" attempt="$2" outcome="${3:-unknown}"
  [ "${SKIP_HARVEST_ATTEMPT:-0}" = "1" ] && return 0

  local rundir; rundir=$(cell_run_dir "$cell")
  [ -d "$rundir" ] || return 0

  local archive_root="$SOURCE_DIR/.claude-project/$PROJECT/archive"
  local run_id="${RUN_ID:-flat-$(date -u +%Y%m%dT%H%M%SZ)}"
  local archive_dir="$archive_root/artifacts/$run_id/$cell/attempt-$attempt"
  mkdir -p "$archive_dir"

  # Snapshot any subset of these directories that exists. Use cp -R to keep
  # original in cell dir intact for the retry path.
  local subdirs=(
    "backend/src"
    "frontend/app"
    "frontend/src"
    ".claude-project/$PROJECT/docs"
    ".claude-project/$PROJECT/status"
    ".claude-project/$PROJECT/episodes"
    ".claude-project/$PROJECT/memory"
  )
  local copied=0
  for sub in "${subdirs[@]}"; do
    if [ -d "$rundir/$sub" ]; then
      mkdir -p "$archive_dir/$(dirname "$sub")"
      cp -R "$rundir/$sub" "$archive_dir/$(dirname "$sub")/" 2>/dev/null && copied=$((copied + 1))
    fi
  done

  # Drop a one-line manifest so future archaeology can find this attempt.
  cat > "$archive_dir/_attempt-meta.txt" <<EOF
cell: $cell
attempt: $attempt
outcome: $outcome
captured_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
source_dir: $rundir
copied_subdirs: $copied
EOF
  echo "[harvest] attempt-$attempt artifacts ($outcome): $copied subdirs -> $archive_dir" >&2
}

# ─── cell runner ───────────────────────────────────────────────────────

run_cell() {
  local cell="$1"
  local attempt exit_code=1 resume_flag=""
  local rundir logd
  rundir=$(cell_run_dir "$cell")
  logd=$(cell_log_dir)

  # User-driven --resume: skip baseline extract on the FIRST attempt and pass
  # --resume to the orchestrator from the start. Pre-flights that the run dir
  # already exists with a parseable PIPELINE_STATUS.md so we know what to skip.
  # Without --resume, behavior is unchanged: attempt 1 extracts baseline,
  # attempts 2-3 re-extract (current default).
  local user_resume="${RESUME:-0}"

  if [ "$user_resume" = "1" ]; then
    if [ ! -d "$rundir" ]; then
      echo "ERROR: --resume requires existing run dir at $rundir" >&2
      echo "       Either remove --resume to do a fresh run, or restore the run dir." >&2
      return 1
    fi
    local status_file="$rundir/.claude-project/$PROJECT/status/PIPELINE_STATUS.md"
    if [ ! -f "$status_file" ]; then
      echo "ERROR: --resume needs $status_file to determine which phases to skip" >&2
      return 1
    fi
    echo "[$cell] --resume mode — using existing run dir, skipping baseline extract"
    echo "[$cell] PIPELINE_STATUS phases:"
    grep -E '^\| (init|spec|prd|design|database|user-stories|backend|frontend|integrate|test-api|test-browser|ship) \|' "$status_file" \
      | awk -F'|' '{ printf "  %-15s %s\n", $2, $3 }' \
      | sed 's/^  /    /'
  fi

  for attempt in 1 2 3; do
    if [ "$attempt" -gt "$MAX_RETRIES" ]; then
      break
    fi

    echo "============================================================"
    echo "[$cell] Attempt $attempt/$MAX_RETRIES"
    echo "============================================================"

    # Extract baseline only when NOT user-resuming AND on attempt 1.
    # Otherwise the run dir is preserved and the orchestrator will skip
    # phases marked Complete in PIPELINE_STATUS.md (orchestrator.js:1367-1377).
    if [ "$user_resume" = "1" ]; then
      echo "[$cell] [resume] preserving run dir, skipping extract_baseline"
      resume_flag="--resume"
    elif [ "$attempt" -eq 1 ]; then
      extract_baseline "$cell"
    else
      echo "[$cell] Resuming retry attempt $attempt with --resume..."
      resume_flag="--resume"
    fi

    # Build env
    local backend model port
    backend=$(cell_backend "$cell")
    model=$(cell_model "$cell")
    port=$(cell_port "$cell")

    # S3-substitute: per-cell progress watcher. Tails the cell log, extracts
    # phase/node transition headers, appends one TSV row per transition into
    # a single per-run progress file. Lets `--progress` show all cells'
    # timelines without grepping each cell log.
    local progress_file="$logd/_progress.tsv"
    (
      tail -n 0 -F "$logd/$cell.log" 2>/dev/null \
        | grep --line-buffered -oE '── \[[0-9]+/[0-9]+\] (deterministic|agentic|evaluator): [a-z][a-z-]*' \
        | while IFS= read -r marker; do
            printf "%s\t%s\t%s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$cell" "$marker" >> "$progress_file"
          done
    ) &
    local watcher_pid=$!

    # Run orchestrator in background subshell
    (
      export AGENT_BACKEND="$backend"
      if [ -n "$model" ]; then
        export OPENCODE_DEFAULT_MODEL="$model"
      fi
      if [ -n "$port" ] && [ "$port" -gt 0 ]; then
        export BACKEND_PORT="$port"
        export FRONTEND_PORT="$((port + 1))"
      fi
      # ENABLE_PHASE_LOOP=1 swaps --run-all for --loop + --max-iterations,
      # which calls runPipelineLoop() in orchestrator.js. Each phase auto-
      # retries up to PHASE_LOOP_MAX times (default 2) using prior evaluator
      # blockers as feedback context. Stagnation guard bails after 2 flat
      # iterations.
      local mode_args
      if [ "${ENABLE_PHASE_LOOP:-0}" = "1" ]; then
        mode_args="--loop --max-iterations ${PHASE_LOOP_MAX:-2} $resume_flag"
        echo "[$cell] phase-loop enabled (max-iterations=${PHASE_LOOP_MAX:-2})${resume_flag:+ + resume}"
      elif [ "${BUILD_ONLY:-0}" = "1" ]; then
        # Slim pipeline — pre-build → database → backend → frontend → integrate
        # → test-api → test-browser. Requires PRD + HTML + user_stories
        # already canonical at workspace .claude-project/<project>/.
        # See blueprints/pre-build-2.yaml and CLAUDE.md "Slim pipeline".
        mode_args="--build-only $resume_flag"
        echo "[$cell] slim pipeline (--build-only): skips init/spec/prd/design/user-stories${resume_flag:+ + resume}"
      else
        mode_args="--run-all $resume_flag"
      fi
      # --keep-going: when a fanout cell fails, finish surviving cells in the
      # current batch instead of aborting. Default-on for parallel runs because
      # observed pattern v18-v21: 5/6 page conversions succeed → 1 cell fails →
      # whole frontend phase marked Failed despite the working pages. With
      # --keep-going, all 6 attempt, partial failures don't poison the rest.
      # Override with FANOUT_FAIL_FAST=1 if the legacy abort behavior is needed.
      local keep_going_flag=""
      if [ "${FANOUT_FAIL_FAST:-0}" != "1" ]; then
        keep_going_flag="--keep-going"
      fi
      node "$ORCHESTRATOR" "$PROJECT" \
        $mode_args \
        --path "$rundir" \
        --no-abort \
        $keep_going_flag \
        --quality "${PARALLEL_QUALITY:-0.85}" \
        >> "$logd/$cell.log" 2>&1
      echo $? > "$logd/$cell.exit"
    ) &
    local bg_pid=$!
    echo "$bg_pid" > "$logd/$cell.pid"

    # Wait for completion
    wait "$bg_pid" 2>/dev/null || true

    # Stop the progress watcher (tail -F + grep loop) for this attempt
    kill "$watcher_pid" 2>/dev/null || true

    exit_code=$(cat "$logd/$cell.exit" 2>/dev/null || echo "1")
    echo "[$cell] exit code: $exit_code"

    if [ "$exit_code" -eq 0 ]; then
      echo "[$cell] SUCCESS on attempt $attempt"
      harvest_attempt_partials "$cell" "$attempt" "success"
      return 0
    fi

    # S2: harvest whatever the failed attempt produced into archive/artifacts/.
    # Even if all 3 attempts fail, every attempt's partial code/state is
    # preserved per-attempt. Lets you ship a "best of N attempts" demo or
    # diff what differs between attempts.
    harvest_attempt_partials "$cell" "$attempt" "fail"

    # Back up log before retry
    if [ "$attempt" -lt "$MAX_RETRIES" ]; then
      cp "$logd/$cell.log" "$logd/$cell.attempt-$attempt.log"
      local delay=$(( 2 ** attempt ))
      echo "[$cell] Failed. Retrying in ${delay}s with --resume ..."
      sleep "$delay"
      resume_flag="--resume"
    fi
  done

  # All retries exhausted
  touch "$logd/$cell.FAILED"
  echo "[$cell] FAILED after $MAX_RETRIES attempts"
  return "$exit_code"
}

# Variadic — accepts 1+ cell names, runs them in parallel, waits for all
run_wave() {
  local cells=("$@")
  local pids=() cell pid failed=0

  echo "============================================================"
  echo "WAVE: ${cells[*]}"
  echo "============================================================"

  for cell in "${cells[@]}"; do
    run_cell "$cell" &
    pids+=($!)
  done

  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || failed=1
  done

  echo "WAVE DONE: ${cells[*]}"
  return $failed
}

run_all_waves() {
  # S1 reform: ignore wave field by default and launch all cells concurrently.
  # Wave field in cells.conf becomes informational only — kept for backward
  # compat in --status / --aggregate output but no longer enforces sequential
  # execution. Cap parallelism with MAX_PARALLEL_CELLS (default = unlimited).
  #
  # Set RESPECT_WAVES=1 to force the legacy sequential-wave behavior.
  if [ "${RESPECT_WAVES:-0}" = "1" ]; then
    local max_wave wave wave_cells
    max_wave=$(get_max_wave)
    echo "=== Running $max_wave waves sequentially (RESPECT_WAVES=1) ==="
    for wave in $(seq 1 "$max_wave"); do
      wave_cells=$(get_cells_in_wave "$wave" | tr '\n' ' ')
      if [ -n "$(echo "$wave_cells" | xargs)" ]; then
        run_wave $wave_cells || true
      fi
    done
    echo "All waves complete."
    return 0
  fi

  # Concurrent path — launch every active cell in parallel, optionally batched
  # by MAX_PARALLEL_CELLS. Default = launch everything at once.
  local cells_arr=($CELLS)
  local total=${#cells_arr[@]}
  local max="${MAX_PARALLEL_CELLS:-$total}"
  [ "$max" -lt 1 ] && max=1
  [ "$max" -gt "$total" ] && max=$total

  echo "=== Running $total cells concurrently (max parallelism: $max) ==="

  local pids=() failed=0 i=0 cell
  for cell in "${cells_arr[@]}"; do
    run_cell "$cell" &
    pids+=($!)
    i=$((i + 1))
    if [ "$i" -ge "$max" ]; then
      for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || failed=1; done
      pids=()
      i=0
    fi
  done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || failed=1; done

  echo "All cells complete (concurrent mode)."
  return $failed
}

# ─── chase ──────────────────────────────────────────────────────────────

chase_cell() {
  local cell="$1"
  local logd
  logd=$(cell_log_dir)
  local pidfile="$logd/$cell.pid"

  if [ ! -f "$pidfile" ]; then
    echo "[$cell] No PID file found — launching fresh ..."
    mkdir -p "$logd"
    run_cell "$cell"
    return $?
  fi

  local pid
  pid=$(cat "$pidfile" 2>/dev/null || true)
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    echo "[$cell] PID $pid is not running. Starting fresh ..."
    mkdir -p "$logd"
    run_cell "$cell"
    return $?
  fi

  echo "[$cell] Tailing log for PID $pid (Ctrl-C to stop)..."
  tail -f "$logd/$cell.log" 2>/dev/null &
  local tail_pid=$!

  wait "$pid" 2>/dev/null || true
  kill "$tail_pid" 2>/dev/null || true
  wait "$tail_pid" 2>/dev/null || true

  local exit_code
  exit_code=$(cat "$logd/$cell.exit" 2>/dev/null || echo "1")
  echo "[$cell] Exited with code $exit_code"

  if [ "$exit_code" -ne 0 ]; then
    echo "[$cell] Non-zero exit — auto-resuming ..."
    run_cell "$cell"
  fi

  return 0
}

# ─── status ─────────────────────────────────────────────────────────────

print_status() {
  echo "=== Parallel Run Status ==="
  if [ -n "$RUN_ID" ]; then echo "Run:  $RUN_ID"; fi
  if [ -n "$RUN_ROOT" ]; then echo "Dir:  $RUN_ROOT"; fi
  echo ""

  local logd
  logd=$(cell_log_dir)

  for cell in $CELLS; do
    local pidfile="$logd/$cell.pid"
    local exitfile="$logd/$cell.exit"
    local failedfile="$logd/$cell.FAILED"

    if [ -f "$failedfile" ]; then
      echo "  $cell : FAILED (all retries exhausted)"
      continue
    fi

    if [ -f "$pidfile" ]; then
      local pid
      pid=$(cat "$pidfile" 2>/dev/null || true)
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        local run_dir
        run_dir=$(cell_run_dir "$cell")
        local status_file="$run_dir/.claude-project/$PROJECT/status/PIPELINE_STATUS.md"
        if [ -f "$status_file" ]; then
          local last_line
          last_line=$(grep -E '^\|' "$status_file" | tail -1 | tr -d ' ')
          echo "  $cell : RUNNING (pid=$pid) | $last_line"
        else
          echo "  $cell : RUNNING (pid=$pid) | no status file yet"
        fi
      else
        if [ -f "$exitfile" ]; then
          local code
          code=$(cat "$exitfile")
          if [ "$code" -eq 0 ]; then
            echo "  $cell : DONE (exit=0)"
          else
            echo "  $cell : EXITED (exit=$code)"
          fi
        else
          echo "  $cell : UNKNOWN (stale pid, no exit file)"
        fi
      fi
    else
      echo "  $cell : IDLE (not started)"
    fi
  done

  echo ""
  echo "Logs: $logd/"
  echo "Baseline: $BASELINE_TAR"
  echo "Project: $PROJECT"
  echo "Baseline from phase: $(guard_phase)"
}

# ─── validate cell name ─────────────────────────────────────────────────

validate_cell() {
  local name="$1"
  for c in $CELLS; do
    [ "$c" = "$name" ] && return 0
  done
  echo "ERROR: Unknown cell '$name'. Valid: $CELLS" >&2
  return 1
}

# ─── main ──────────────────────────────────────────────────────────────

MODE="${1:-}"

# --tag, --no-tag, --hypothesis, --no-hypothesis can appear before or after
# the mode; parse them first.
NO_TAG=0
HYPOTHESIS="${HYPOTHESIS:-}"
NO_HYPOTHESIS=0
RESUME="${RESUME:-0}"
for i in $(seq 1 $#); do
  if [ "${!i}" = "--tag" ]; then
    j=$((i + 1))
    TAG="${!j:-}"
    if [ -z "$TAG" ]; then echo "ERROR: --tag requires a name" >&2; exit 1; fi
  elif [ "${!i}" = "--no-tag" ]; then
    NO_TAG=1
  elif [ "${!i}" = "--hypothesis" ]; then
    j=$((i + 1))
    HYPOTHESIS="${!j:-}"
    if [ -z "$HYPOTHESIS" ]; then echo "ERROR: --hypothesis requires a quoted string" >&2; exit 1; fi
  elif [ "${!i}" = "--no-hypothesis" ]; then
    NO_HYPOTHESIS=1
  elif [ "${!i}" = "--resume" ]; then
    RESUME=1
  fi
done
export RESUME

# Auto-tag for "run-producing" modes when no explicit --tag was given.
# Inspection / maintenance modes (--status, --list, --clean, --aggregate,
# --setup-baseline, --help) keep flat layout so they read existing flat dirs.
# Pass --no-tag to force flat layout for run modes (legacy behavior).
case " --from-prd --from-baseline --all --wave --cell --chase " in
  *" $MODE "*)
    if [ -z "$TAG" ] && [ "$NO_TAG" != "1" ]; then
      TAG="auto-$(date -u +%H%M%S)"
      echo "[auto-tag] no --tag given — using '$TAG'. Pass --no-tag for flat layout." >&2
    fi
    ;;
esac

# Resolve RUN_ID + RUN_ROOT.
# - For inspection modes (--status, --list, --aggregate, --clean), find the
#   newest existing tagged run that matches (or any run if --tag absent) so
#   the user sees real state instead of an empty freshly-created dir.
# - For run-producing modes, mint a fresh timestamped RUN_ID.
case " $MODE " in
  " --status "|" --aggregate "|" --clean "|" --progress ")
    if [ -n "$TAG" ]; then
      existing=$(ls -td "$PARALLEL_ROOT/runs"/*-"$TAG" 2>/dev/null | head -1)
    else
      existing=$(ls -td "$PARALLEL_ROOT/runs"/* 2>/dev/null | head -1)
    fi
    if [ -n "$existing" ] && [ -d "$existing" ]; then
      RUN_ID=$(basename "$existing")
      RUN_ROOT="$existing"
    elif [ -n "$TAG" ]; then
      # No matching run; fall back to fresh ID (will report "no cells")
      RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$TAG"
      RUN_ROOT="$PARALLEL_ROOT/runs/$RUN_ID"
    fi
    ;;
  *)
    if [ -n "$TAG" ]; then
      if [ "$RESUME" = "1" ]; then
        # --resume: find the most-recent existing run dir matching this tag
        # so we continue against its preserved state instead of minting a
        # fresh empty timestamped dir.
        existing=$(ls -td "$PARALLEL_ROOT/runs"/*-"$TAG" 2>/dev/null | head -1)
        if [ -n "$existing" ] && [ -d "$existing" ]; then
          RUN_ID=$(basename "$existing")
          RUN_ROOT="$existing"
          echo "[resume] reusing existing run dir: $RUN_ID" >&2
        else
          echo "ERROR: --resume given for tag '$TAG' but no matching run dir under $PARALLEL_ROOT/runs/" >&2
          echo "       Existing tagged runs:" >&2
          ls -1d "$PARALLEL_ROOT/runs"/*-* 2>/dev/null | sed 's|.*/|        |' >&2 || true
          exit 1
        fi
      else
        RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$TAG"
        RUN_ROOT="$PARALLEL_ROOT/runs/$RUN_ID"
      fi
    fi
    ;;
esac

# ─── --hypothesis required for tagged run-producing modes ─────────────
# Why: every prior overnight-ship-vN run captured the timestamp + tag but
# nothing about what the version was testing or what changed since the
# previous version. After 30 versions you can't reconstruct the experiment
# without three repos' git logs. This guard forces the operator to write
# the hypothesis at launch, captured in runs/<RUN_ID>/HYPOTHESIS.md.
case " --from-prd --from-baseline --all --wave --cell --chase " in
  *" $MODE "*)
    # --resume reuses an existing run dir whose HYPOTHESIS.md was already
    # written at original launch. Don't require a new hypothesis on resume.
    if [ -n "$RUN_ID" ] && [ "$NO_HYPOTHESIS" != "1" ] && [ -z "$HYPOTHESIS" ] && [ "$RESUME" != "1" ]; then
      cat >&2 <<MSG
ERROR: --hypothesis is required for tagged run-producing modes.

Every versioned run (e.g. overnight-ship-v18) must record what it is
testing, so future audits can reconstruct why each version exists.

Pass one of:
  --hypothesis "one-line statement of what this version tests"
  --no-hypothesis       (escape hatch — only for ad-hoc debug runs)

Example:
  bash run-parallel.sh --from-baseline --cell qwen3.6-plus-cake2 \\
    --tag overnight-ship-v18-templated \\
    --hypothesis "template-based scaffolding (claude-react#56 + claude-fullstack#48) unblocks the frontend phase ceiling"
MSG
      exit 2
    fi

    # ─── RCA ledger required: prior run must be fully RCA'd before a new launch ───
    # Why: "RCA every phase" written as a memory rule fails under long context — the
    # LLM stops attending to it and skims. This makes it MECHANICAL: the launcher
    # refuses to start vN+1 until vN's RCA_LEDGER.md is complete — every failed phase
    # enumerated (machine lists them, none skippable), REPRODUCED live (not "the
    # report said X"), and resolved or deferred-with-valid-reason. Mirrors the
    # required-hypothesis guard above. (v114)
    if [ -n "$RUN_ID" ] && [ "$RESUME" != "1" ] && [ "${SKIP_RCA_CHECK:-0}" != "1" ]; then
      _runs_dir="$(dirname "$RUN_ROOT")"
      _prior=""
      [ -d "$_runs_dir" ] && _prior="$(ls -dt "$_runs_dir"/*/ 2>/dev/null | grep -v "$RUN_ID" | head -1)"
      if [ -n "$_prior" ] && [ -d "$_prior" ]; then
        if ! node "$(dirname "$0")/post-run-rca.js" --check "${_prior%/}" >&2; then
          cat >&2 <<MSG

🛑 Cannot launch '$TAG': the prior run's RCA ledger is incomplete.
   Per the post-run loop, EVERY failed phase of the prior run must be RCA'd
   (reproduced LIVE + resolved or deferred-with-reason) before the next run.

   1. Generate:  node .claude/parallel/post-run-rca.js --generate ${_prior%/}
   2. Fill RCA_LEDGER.md — reproduce each (cmd -> result), set resolution fixed:/defer:
   3. Re-launch; the check passes automatically when complete.

   Override (discouraged — defeats the purpose): SKIP_RCA_CHECK=1
MSG
          exit 2
        fi
      fi
    fi

    if [ -n "$RUN_ID" ] && [ -n "$HYPOTHESIS" ]; then
      mkdir -p "$RUN_ROOT"
      hypo_file="$RUN_ROOT/HYPOTHESIS.md"
      # On --resume, append the new hypothesis as an addendum rather than
      # overwriting the original launch's HYPOTHESIS.md.
      if [ "$RESUME" = "1" ] && [ -f "$hypo_file" ]; then
        cat >> "$hypo_file" <<APPENDIX

---

## Resume addendum — $(date -u +%Y-%m-%dT%H:%M:%SZ)

**Why resumed:** $HYPOTHESIS

**.claude SHA at resume:** \`$(cd "$SOURCE_DIR/.claude" 2>/dev/null && git rev-parse HEAD 2>/dev/null | cut -c1-12)\`
APPENDIX
        echo "[hypothesis] appended resume addendum to $hypo_file"
        # Skip the full template-write below
        true
      else
      claude_sha=$(cd "$SOURCE_DIR/.claude" 2>/dev/null && git rev-parse HEAD 2>/dev/null || echo "unknown")
      claude_msg=$(cd "$SOURCE_DIR/.claude" 2>/dev/null && git log -1 --pretty='%s' 2>/dev/null || echo "")
      nestjs_sha=$(cd "$SOURCE_DIR/.claude/nestjs" 2>/dev/null && git rev-parse HEAD 2>/dev/null || echo "unknown")
      react_sha=$(cd "$SOURCE_DIR/.claude/react" 2>/dev/null && git rev-parse HEAD 2>/dev/null || echo "unknown")
      baseline_sha=""
      if [ -f "$BASELINE_TAR" ]; then
        baseline_sha=$(shasum -a 256 "$BASELINE_TAR" 2>/dev/null | awk '{print substr($1,1,12)}')
      fi
      prev_run=$(ls -td "$PARALLEL_ROOT/runs"/*/ 2>/dev/null | grep -v "/$RUN_ID/" | head -1 | xargs -I{} basename {} 2>/dev/null)

      cat > "$hypo_file" <<EOF
# Hypothesis: $TAG

**Run ID:** $RUN_ID
**Started at:** $(date -u +%Y-%m-%dT%H:%M:%SZ)
**Previous run:** ${prev_run:-(none)}
**Operator:** $(whoami)

## Hypothesis

$HYPOTHESIS

## Pinned versions

| Component | SHA | Subject |
|---|---|---|
| .claude (claude-fullstack) | \`${claude_sha:0:12}\` | $claude_msg |
| .claude/nestjs | \`${nestjs_sha:0:12}\` | |
| .claude/react | \`${react_sha:0:12}\` | |
| baseline.tar | \`${baseline_sha:-n/a}\` | |

## Cells

\`\`\`
$(grep -v '^\s*#' "$CELLS_CONF" 2>/dev/null | grep -v '^\s*$' || echo "(cells.conf not found)")
\`\`\`

## Outcome

_To be filled in after the run completes (by harvest.sh / aggregate.sh or manually)._

- success_rate:
- frontend_reached:
- backend_tests_passing:
- notes:
EOF
      echo "[hypothesis] wrote $hypo_file"
      fi
    fi
    ;;
esac

logd=$(cell_log_dir)
mkdir -p "$logd"

# ─── pre-run hook (diagnose + harvest) ────────────────────────────────
# For run-producing modes:
#   1. Classify prior failures against .claude-project/memory/FAILURE_PATTERNS.yaml
#      (read-only against state; --update bumps occurrences/last_seen)
#   2. Harvest stale flat-layout runs into the archive ledger and clear them
#      (so the new tagged run starts clean and historical data is preserved)
# Warn-only by design: never blocks the run.
#
# Env knobs:
#   SKIP_DIAGNOSE=1  — skip step 1 (catalog classification)
#   SKIP_HARVEST=1   — skip step 2 (archive + clear flat layout)
#   HARVEST_KEEP=1   — archive but DON'T clear flat dirs (inspect manually first)
pre_run_hook() {
  # Step 1: diagnose (classify + bump catalog) — must run BEFORE harvest so the
  # pattern catalog captures the failure data before it's cleared from flat.
  if [ "${SKIP_DIAGNOSE:-0}" != "1" ] && [ -x "$CODE_DIR/diagnose.sh" ]; then
    local report rc
    report=$(bash "$CODE_DIR/diagnose.sh" --update --pre-run 2>&1)
    rc=$?
    case $rc in
      0) ;; # silent
      2|3)
        echo ""
        echo "=== pre-run diagnose ==="
        echo "$report"
        if [ "$rc" = "3" ]; then
          echo ""
          echo "[diagnose] 3+ unmitigated patterns observed. Proceeding (warn-only)."
          echo "          Set SKIP_DIAGNOSE=1 to suppress this hook."
        fi
        echo "========================"
        ;;
    esac
  fi

  # Step 1b (v90): kill zombie processes from prior runs. v89 evidence: pm2
  # zombies (fsp-frontend, fsp-backend) auto-restarted 173 times + 6 ts-node-
  # dev processes from v78/v86/v87 burned 75-100% CPU, OOM-killing the v89
  # orchestrator (SIGKILL exit 137). Single-line opt-out: SKIP_ZOMBIE_KILL=1.
  if [ "${SKIP_ZOMBIE_KILL:-0}" != "1" ]; then
    echo ""
    echo "=== pre-run zombie cleanup ==="
    node "$SOURCE_DIR/.claude/v2/scripts/scaffold-zombie-killer.js" \
      --project "$PROJECT" --verbose 2>&1 || true
    echo "=============================="
    echo ""
  fi

  # Step 2: harvest + clear flat layout (idempotent — no-op when nothing flat).
  if [ "${SKIP_HARVEST:-0}" != "1" ] && [ -x "$CODE_DIR/harvest.sh" ]; then
    local clear_flag=""
    [ "${HARVEST_KEEP:-0}" = "1" ] && clear_flag="--no-clear"
    echo ""
    echo "=== pre-run harvest ==="
    bash "$CODE_DIR/harvest.sh" $clear_flag 2>&1 || true
    echo "======================="
    echo ""
  fi

  # Step 3 (A1): predict per-cell historical fail rate from manifest.csv.
  # Warn-only; never blocks. Skip with SKIP_PREDICT=1.
  if [ "${SKIP_PREDICT:-0}" != "1" ] && [ -x "$CODE_DIR/diagnose.sh" ]; then
    echo "=== pre-run predict ==="
    bash "$CODE_DIR/diagnose.sh" --predict 2>&1 || true
    echo "======================="
    echo ""
  fi

  return 0
}

case " --from-prd --from-baseline --all --wave --cell --chase " in
  *" $MODE "*) preflight_host_tools; pre_run_hook ;;
esac

# ─── streaming aggregator (W4) ────────────────────────────────────────
# Background loop that periodically runs aggregate.sh during long runs.
# Without this, manifest.csv only gets populated when the entire run
# completes — a 6-hour run killed at hour 5 leaves zero ledger rows.
# With this, ledger updates every STREAM_INTERVAL_SEC (default 15 min),
# so killing mid-run preserves 95%+ of progress.
#
# Env knobs:
#   SKIP_STREAM=1           — disable streaming aggregator entirely
#   STREAM_INTERVAL_SEC=900 — interval (seconds, default 15 min)
start_streaming_aggregate() {
  [ "${SKIP_STREAM:-0}" = "1" ] && return 0
  case " --from-baseline --all --wave --cell --chase " in
    *" $MODE "*) ;;     # only useful for run modes that produce episodes
    *) return 0 ;;
  esac
  local wrapper_pid=$$
  local interval="${STREAM_INTERVAL_SEC:-900}"
  (
    sleep "$interval"
    while kill -0 "$wrapper_pid" 2>/dev/null; do
      bash "$CODE_DIR/aggregate.sh" "$RUN_ROOT" >/dev/null 2>&1 || true
      sleep "$interval"
    done
  ) &
  echo "[stream] background aggregator started (interval=${interval}s, pid=$!)" >&2
}
start_streaming_aggregate

case "$MODE" in
  # ── new: foundation from PRD ──────────────────────────────────────
  --from-prd)
    PRD_FILE="${2:-}"
    if [ -z "$PRD_FILE" ]; then
      echo "ERROR: --from-prd requires a PRD file path" >&2
      echo "Usage: bash run-parallel.sh --from-prd ./path/to/PRD.pdf" >&2
      exit 1
    fi
    run_foundation_from_prd "$PRD_FILE"
    exit 0
    ;;

  # ── new: run cells from existing baseline ──────────────────────────
  --from-baseline)
    if [ ! -f "$BASELINE_TAR" ]; then
      echo "ERROR: baseline.tar not found." >&2
      echo "       Run --from-prd <file> first to build the foundation." >&2
      exit 1
    fi

    SUB="${2:-}"
    case "$SUB" in
      --wave)
        WAVE_NUM="${3:-}"
        if [ -z "$WAVE_NUM" ]; then
          echo "ERROR: --wave requires a number" >&2
          exit 1
        fi
        WAVE_CELLS=$(get_cells_in_wave "$WAVE_NUM" | tr '\n' ' ')
        if [ -z "$(echo "$WAVE_CELLS" | xargs)" ]; then
          echo "ERROR: No cells in wave $WAVE_NUM. Max wave: $(get_max_wave)" >&2
          exit 1
        fi
        mkdir -p "$LOG_DIR"
        run_wave $WAVE_CELLS
        exit $?
        ;;

      --cell)
        CELL_NAME="${3:-}"
        if [ -z "$CELL_NAME" ]; then
          echo "ERROR: --cell requires a cell name" >&2
          echo "Valid cells: $CELLS" >&2
          exit 1
        fi
        validate_cell "$CELL_NAME" || exit 1
        mkdir -p "$LOG_DIR"
        run_cell "$CELL_NAME"
        exit $?
        ;;

      '')
        # Run all waves, then aggregate
        run_all_waves
        echo ""
        echo "All cells finished. Running aggregate..."
        exec bash "$CODE_DIR/aggregate.sh" "$RUN_ROOT"
        ;;

      *)
        echo "ERROR: Unknown sub-command '$SUB' after --from-baseline" >&2
        echo "       Valid: (none), --wave N, --cell <name>" >&2
        exit 1
        ;;
    esac
    ;;

  # ── classic modes ──────────────────────────────────────────────────
  --setup-baseline)
    if [ ! -f "$BASELINE_TAR" ] || [ "${FORCE:-}" = "1" ]; then
      setup_baseline
    else
      echo "baseline.tar already exists. Use FORCE=1 to rebuild."
    fi
    exit 0
    ;;

  --all)
    if [ ! -f "$BASELINE_TAR" ]; then
      setup_baseline
    elif ! inflight_running; then
      echo "ERROR: One or more cells are already running. Wait for them or check --status." >&2
      exit 1
    fi
    run_all_waves
    exit 0
    ;;

  --wave)
    WAVE_NUM="${2:-}"
    if [ -z "$WAVE_NUM" ]; then
      echo "ERROR: --wave requires a wave number" >&2
      exit 1
    fi

    if [ ! -f "$BASELINE_TAR" ]; then
      setup_baseline
    fi

    WAVE_CELLS=$(get_cells_in_wave "$WAVE_NUM" | tr '\n' ' ')
    if [ -z "$(echo "$WAVE_CELLS" | xargs)" ]; then
      echo "ERROR: No cells in wave $WAVE_NUM. Max wave: $(get_max_wave)" >&2
      exit 1
    fi

    mkdir -p "$LOG_DIR"
    run_wave $WAVE_CELLS
    exit $?
    ;;

  --cell)
    CELL_NAME="${2:-}"
    if [ -z "$CELL_NAME" ]; then
      echo "ERROR: --cell requires a cell name" >&2
      echo "Valid cells: $CELLS" >&2
      exit 1
    fi

    validate_cell "$CELL_NAME" || exit 1

    if [ ! -f "$BASELINE_TAR" ]; then
      echo "ERROR: baseline.tar missing. Run --setup-baseline or --from-prd first." >&2
      exit 1
    fi

    mkdir -p "$LOG_DIR"
    run_cell "$CELL_NAME"
    exit $?
    ;;

  --chase)
    CHASE_NAME="${2:-}"
    if [ -z "$CHASE_NAME" ]; then
      echo "ERROR: --chase requires a cell name" >&2
      exit 1
    fi
    validate_cell "$CHASE_NAME" || exit 1
    mkdir -p "$logd"
    chase_cell "$CHASE_NAME"
    exit $?
    ;;

  --status)
    print_status
    exit 0
    ;;

  --progress)
    # Pretty-print _progress.tsv from the resolved RUN_ID's log dir.
    # Shows per-cell phase/node transition timeline collected by S3-substitute.
    progress_file="$LOG_DIR/_progress.tsv"
    if [ ! -f "$progress_file" ]; then
      echo "No progress file found at $progress_file"
      echo "(Was this run launched after the S3 reform landed? Check logs/<tag>/)"
      exit 0
    fi
    echo "=== Per-cell progress (from $progress_file) ==="
    awk -F'\t' '{
      printf "%-22s  %-32s  %s\n", $1, $2, $3
    }' "$progress_file" | sort -k1
    exit 0
    ;;

  --aggregate)
    exec bash "$CODE_DIR/aggregate.sh" "$RUN_ROOT"
    ;;

  --list)
    echo "=== Tagged Runs ==="
    if [ -d "$PARALLEL_ROOT/runs" ]; then
      for d in "$PARALLEL_ROOT/runs"/*/; do
        [ -d "$d" ] || continue
        local rname
        rname=$(basename "$d")
        local cell_count
        cell_count=$(find "$d" -maxdepth 1 -name 'run-*' -type d 2>/dev/null | wc -l | tr -d ' ')
        local summary="$d/SUMMARY.md"
        if [ -f "$summary" ]; then
          echo "  $rname  ($cell_count cells, summary available)"
        else
          echo "  $rname  ($cell_count cells, no summary yet)"
        fi
      done
    else
      echo "  No tagged runs yet. Use --tag <name> to create one."
    fi
    exit 0
    ;;

  --clean)
    if [ "${2:-}" != "--older-than" ] || [ -z "${3:-}" ]; then
      echo "ERROR: --clean requires --older-than <days>" >&2
      echo "Usage: bash run-parallel.sh --clean --older-than 7" >&2
      exit 1
    fi
    local max_days="${3}"
    if [ ! -d "$PARALLEL_ROOT/runs" ]; then
      echo "No runs/ directory to clean."
      exit 0
    fi
    local cutoff
    cutoff=$(date -v-${max_days}d +%Y%m%d 2>/dev/null || date -d "${max_days} days ago" +%Y%m%d 2>/dev/null || echo "")
    if [ -z "$cutoff" ]; then
      echo "ERROR: could not compute cutoff date" >&2
      exit 1
    fi
    local cleaned=0
    for d in "$PARALLEL_ROOT/runs"/*/; do
      [ -d "$d" ] || continue
      local rname ts
      rname=$(basename "$d")
      ts=$(echo "$rname" | cut -d'T' -f1 | cut -d'-' -f1)
      if [ -n "$ts" ] && [ "$ts" \< "$cutoff" ] 2>/dev/null; then
        echo "  removing: $rname"
        rm -rf "$d"
        rm -rf "$PARALLEL_ROOT/logs/$rname" 2>/dev/null || true
        cleaned=$((cleaned + 1))
      fi
    done
    echo "Cleaned $cleaned runs older than ${max_days} days."
    exit 0
    ;;

  --help|-h|'')
    print_help
    exit 0
    ;;

  *)
    echo "ERROR: Unknown option '$MODE'" >&2
    echo ""
    print_help
    exit 1
    ;;
esac
