#!/usr/bin/env bash
# harvest.sh — pull episodes from flat-layout failed runs into the archive
# ledger, then clear the flat dirs. Closes the loop between failed-run
# artifacts and long-term RL training data.
#
# Usage:
#   bash harvest.sh                # archive + clear (default)
#   bash harvest.sh --no-clear     # archive only; keep flat dirs
#   bash harvest.sh --dry-run      # show what would happen, change nothing
#   bash harvest.sh --quiet        # suppress per-cell logging (use in hooks)
#
# Why this exists:
#   - aggregate.sh archives only the cells of the current --from-baseline run
#   - flat-layout failed cells from prior runs (run-<cell>/, logs/<cell>.*)
#     accumulate disk usage and leave failure data unarchived (lost on cleanup)
#   - this script archives those failed episodes into manifest.csv (so the
#     bandit / reward-audit can see negative trajectories) and frees disk
#
# Exit codes:
#   0 — nothing to harvest, OR harvest succeeded
#   1 — error during archive
#   2 — partial success (archived some cells but not all)

set -u

CODE_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${SOURCE_DIR:-}" ]; then
  if [ -d "$CODE_DIR/../v2" ]; then
    SOURCE_DIR="$(cd "$CODE_DIR/../.." && pwd)"
  else
    SOURCE_DIR="$PWD"
  fi
fi
DATA_DIR="${PARALLEL_DATA_DIR:-$SOURCE_DIR/experiments/parallel-runs}"
PARALLEL_ROOT="$DATA_DIR"   # legacy alias for in-script refs
PROJECT="${PROJECT:-fsp}"
ARCHIVE_ROOT="$SOURCE_DIR/.claude-project/$PROJECT/archive"
LOG_DIR="$DATA_DIR/logs"
REWARD_LIB="$SOURCE_DIR/.claude/v2/lib/reward.js"
AUDIT_JSON="$ARCHIVE_ROOT/audit-json.js"
MANIFEST="$ARCHIVE_ROOT/manifest.csv"

CLEAR=1
DRY_RUN=0
QUIET=0
for arg in "$@"; do
  case "$arg" in
    --no-clear) CLEAR=0 ;;
    --dry-run)  DRY_RUN=1 ;;
    --quiet)    QUIET=1 ;;
    --help|-h)
      sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown arg $arg" >&2; exit 1 ;;
  esac
done

log() { [ "$QUIET" = "0" ] && echo "$@"; }

# ─── discover flat-layout cells ──────────────────────────────────────

FLAT_CELLS=()
for d in "$PARALLEL_ROOT"/run-*; do
  [ -d "$d" ] || continue
  name=$(basename "$d" | sed 's/^run-//')
  FLAT_CELLS+=("$name")
done

if [ ${#FLAT_CELLS[@]} -eq 0 ]; then
  log "[harvest] no flat-layout cells — nothing to do"
  exit 0
fi

log "[harvest] found ${#FLAT_CELLS[@]} flat cell(s): ${FLAT_CELLS[*]}"

# ─── reward fn snapshot (for manifest interpretation) ────────────────

REWARD_FN_SHA=""
if [ -f "$REWARD_LIB" ]; then
  REWARD_FN_SHA=$(shasum -a 256 "$REWARD_LIB" 2>/dev/null | awk '{print $1}' | head -c 12)
  if [ -n "$REWARD_FN_SHA" ] && [ "$DRY_RUN" = "0" ]; then
    snap="$ARCHIVE_ROOT/reward-fn-versions/reward-$REWARD_FN_SHA.js"
    [ ! -f "$snap" ] && {
      mkdir -p "$ARCHIVE_ROOT/reward-fn-versions"
      cp "$REWARD_LIB" "$snap"
    }
  fi
fi

# ─── manifest header (idempotent) ────────────────────────────────────

if [ ! -f "$MANIFEST" ] && [ "$DRY_RUN" = "0" ]; then
  mkdir -p "$ARCHIVE_ROOT"
  echo "episode_id,run_id,cell,model,backend,project,prd_sha,baseline_sha,started_at,success,R_episode,R_phase_sum,R_terminal,reward_fn_sha,archive_path" > "$MANIFEST"
fi

# ─── helpers ──────────────────────────────────────────────────────────

# Mirror aggregate.sh's parser. Adding new model families = add a case here.
parse_cell_meta() {
  case "$1" in
    claude-opus-*)        echo "claude-opus|claude" ;;
    deepseek-v4-pro-*)    echo "deepseek-v4-pro|opencode" ;;
    qwen3.6-plus-*)       echo "qwen3.6-plus|opencode" ;;
    *)                    echo "unknown|unknown" ;;
  esac
}

json_get() {
  python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    v = d.get('$1', '')
    print(v if v is not None else '')
except Exception:
    print('')
" 2>/dev/null
}

# ─── per-cell archive ────────────────────────────────────────────────

RUN_ID="harvest-$(date -u +%Y-%m-%dT%H-%M-%SZ)"
ARCHIVE_RUN_DIR="$ARCHIVE_ROOT/episodes/$RUN_ID"

TOTAL_EPISODES_ARCHIVED=0
TOTAL_EPISODES_DUPED=0
TOTAL_CELLS_HARVESTED=0
HARVEST_FAILED=0

for cell in "${FLAT_CELLS[@]}"; do
  cell_dir="$PARALLEL_ROOT/run-$cell"
  ep_src="$cell_dir/.claude-project/$PROJECT/episodes"

  if [ ! -d "$ep_src" ]; then
    log "  [$cell] no episodes/ dir — will be cleared without archive"
    continue
  fi

  ep_count=$(find "$ep_src" -name 'ep-*.jsonl' -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$ep_count" = "0" ]; then
    log "  [$cell] 0 episode files — will be cleared without archive"
    continue
  fi

  meta=$(parse_cell_meta "$cell")
  model="${meta%%|*}"
  backend="${meta##*|}"

  log "  [$cell] $ep_count episode(s)  model=$model"

  archive_cell_dir="$ARCHIVE_RUN_DIR/$cell"
  [ "$DRY_RUN" = "0" ] && mkdir -p "$archive_cell_dir"

  for f in "$ep_src"/ep-*.jsonl; do
    [ -f "$f" ] || continue
    fname=$(basename "$f")

    if [ "$DRY_RUN" = "1" ]; then
      log "    cp $f -> $archive_cell_dir/$fname"
      TOTAL_EPISODES_ARCHIVED=$((TOTAL_EPISODES_ARCHIVED + 1))
      continue
    fi

    cp -n "$f" "$archive_cell_dir/$fname"

    # Append manifest row if audit tool exists and episode_id not already present
    if [ -f "$AUDIT_JSON" ]; then
      audit=$(node "$AUDIT_JSON" "$archive_cell_dir/$fname" 2>/dev/null)
      if [ -n "$audit" ]; then
        episode_id=$(echo "$audit" | json_get episode_id)
        if [ -n "$episode_id" ]; then
          if grep -q "^$episode_id," "$MANIFEST" 2>/dev/null; then
            TOTAL_EPISODES_DUPED=$((TOTAL_EPISODES_DUPED + 1))
          else
            success=$(echo "$audit" | json_get success)
            R_episode=$(echo "$audit" | json_get R_episode)
            R_phase_sum=$(echo "$audit" | json_get R_phase_sum)
            R_terminal=$(echo "$audit" | json_get R_terminal)
            project=$(echo "$audit" | json_get project)
            started_at=$(echo "$audit" | json_get started_at)
            archive_path="episodes/$RUN_ID/$cell/$fname"
            echo "$episode_id,$RUN_ID,$cell,$model,$backend,$project,-,-,$started_at,$success,$R_episode,$R_phase_sum,$R_terminal,$REWARD_FN_SHA,$archive_path" >> "$MANIFEST"
            TOTAL_EPISODES_ARCHIVED=$((TOTAL_EPISODES_ARCHIVED + 1))
          fi
        fi
      fi
    fi
  done

  TOTAL_CELLS_HARVESTED=$((TOTAL_CELLS_HARVESTED + 1))
done

log ""
log "[harvest] archived: $TOTAL_EPISODES_ARCHIVED new, $TOTAL_EPISODES_DUPED dedup'd ($TOTAL_CELLS_HARVESTED cell(s))"
[ "$DRY_RUN" = "0" ] && log "[harvest] run id: $RUN_ID"

# ─── clear flat layout (opt-out via --no-clear) ──────────────────────

if [ "$CLEAR" = "0" ]; then
  log "[harvest] --no-clear: leaving flat dirs in place"
  exit 0
fi

log ""
[ "$DRY_RUN" = "1" ] && log "[harvest] DRY-RUN — would remove:"

CLEARED_KB=0
for cell in "${FLAT_CELLS[@]}"; do
  cell_dir="$PARALLEL_ROOT/run-$cell"
  if [ -d "$cell_dir" ]; then
    bytes=$(du -sk "$cell_dir" 2>/dev/null | cut -f1)
    CLEARED_KB=$((CLEARED_KB + bytes))
    if [ "$DRY_RUN" = "1" ]; then
      log "  rm -rf $cell_dir  (~${bytes}KB)"
    else
      rm -rf "$cell_dir"
    fi
  fi

  # Flat log artifacts (not under logs/<tag>/)
  for ext in log pid exit FAILED attempts; do
    f="$LOG_DIR/$cell.$ext"
    [ -f "$f" ] || continue
    if [ "$DRY_RUN" = "1" ]; then
      log "  rm $f"
    else
      rm -f "$f"
    fi
  done

  for f in "$LOG_DIR"/$cell.attempt-*.log; do
    [ -f "$f" ] || continue
    if [ "$DRY_RUN" = "1" ]; then
      log "  rm $f"
    else
      rm -f "$f"
    fi
  done
done

if [ "$DRY_RUN" = "1" ]; then
  log "[harvest] DRY-RUN — would free ~${CLEARED_KB}KB"
else
  log "[harvest] cleared flat layout (~${CLEARED_KB}KB freed)"
fi

[ "$HARVEST_FAILED" = "0" ] && exit 0 || exit 2
