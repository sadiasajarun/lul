#!/usr/bin/env bash
# Post-run aggregator for parallel multi-model fullstack-2 runs.
# Bash 3.2 compatible (macOS default).
#
# Two outputs:
#   1. Local SUMMARY.md + aggregate/episodes/<cell>/ (this run only)
#   2. Append-only archive at <SOURCE>/.claude-project/archive/ for cross-run RL data
#      ├── episodes/<run-id>/<cell>/ep-*.jsonl
#      ├── episodes/<run-id>/meta.json
#      ├── manifest.csv
#      └── reward-fn-versions/reward-<sha>.js (snapshot)
#
# Manifest schema:
#   episode_id, run_id, cell, model, backend, project, prd_sha, baseline_sha,
#   started_at, success, R_episode, R_phase_sum, R_terminal, reward_fn_sha, archive_path

set -u

# ─── path layout (code/data split) ────────────────────────────────────
# Removes the previous hard-coded absolute SOURCE_DIR (portability bug —
# only worked on the original developer's machine). Now resolves SOURCE_DIR
# from CODE_DIR position (.claude/parallel/ → up 2 levels = workspace root).

CODE_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${SOURCE_DIR:-}" ]; then
  if [ -d "$CODE_DIR/../v2" ]; then
    # Script at .claude/parallel/ — workspace root is up 2 levels
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
AGGREGATE_DIR="$DATA_DIR/aggregate"

# Optional RUN_ROOT — when passed, discover cells + write summary under it
# (scoped layout from --tag).  When absent, use flat run-<cell>/ layout.
RUN_ROOT="${1:-}"
if [ -n "$RUN_ROOT" ]; then
  EPISODES_DIR="$AGGREGATE_DIR/episodes"
  SUMMARY="$RUN_ROOT/SUMMARY.md"
else
  EPISODES_DIR="$AGGREGATE_DIR/episodes"
  SUMMARY="$PARALLEL_ROOT/SUMMARY.md"
fi

REWARD_LIB="$SOURCE_DIR/.claude/v2/lib/reward.js"
AUDIT_JSON="$ARCHIVE_ROOT/audit-json.js"
MANIFEST="$ARCHIVE_ROOT/manifest.csv"

RUN_ID="run-$(date -u +%Y-%m-%dT%H-%M-%SZ)"
ARCHIVE_RUN_DIR="$ARCHIVE_ROOT/episodes/$RUN_ID"
SUMMARY_TMP="$AGGREGATE_DIR/.summary-rows.tsv"

mkdir -p "$EPISODES_DIR" "$ARCHIVE_RUN_DIR" "$ARCHIVE_ROOT/reward-fn-versions"
: > "$SUMMARY_TMP"

LOG_SEARCH="$LOG_DIR"
if [ -n "$RUN_ROOT" ]; then
  rname=$(basename "$RUN_ROOT")
  if [ -d "$LOG_DIR/$rname" ]; then
    LOG_SEARCH="$LOG_DIR/$rname"
  fi
fi

# ----------------------------------------------------------- discover cells

CELLS=()
SEARCH_ROOT="${RUN_ROOT:-$PARALLEL_ROOT}"
for d in "$SEARCH_ROOT"/run-*; do
  [ -d "$d" ] && CELLS+=("$(basename "$d" | sed 's/^run-//')")
done

if [ ${#CELLS[@]} -eq 0 ]; then
  echo "No run-* dirs in $SEARCH_ROOT — nothing to aggregate." >&2
  exit 1
fi

echo "============================================================"
echo "AGGREGATE: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Run id: $RUN_ID"
echo "Cells found: ${CELLS[*]}"
echo "Archive: $ARCHIVE_ROOT"
echo "============================================================"

# ----------------------------------------------------------- shared shas

REWARD_FN_SHA=$(shasum -a 256 "$REWARD_LIB" 2>/dev/null | awk '{print $1}')
REWARD_FN_SHORT=${REWARD_FN_SHA:0:12}
REWARD_SNAPSHOT="$ARCHIVE_ROOT/reward-fn-versions/reward-$REWARD_FN_SHORT.js"
if [ ! -f "$REWARD_SNAPSHOT" ]; then
  cp "$REWARD_LIB" "$REWARD_SNAPSHOT"
  echo "Snapshotted reward fn: $REWARD_SNAPSHOT"
fi

BASELINE_SHA="-"
if [ -f "$PARALLEL_ROOT/baseline.tar" ]; then
  BASELINE_SHA=$(shasum -a 256 "$PARALLEL_ROOT/baseline.tar" 2>/dev/null | awk '{print $1}' | head -c 12)
fi

# ----------------------------------------------------------- ensure manifest header

if [ ! -f "$MANIFEST" ]; then
  echo "episode_id,run_id,cell,model,backend,project,prd_sha,baseline_sha,started_at,success,R_episode,R_phase_sum,R_terminal,reward_fn_sha,archive_path" > "$MANIFEST"
fi

# ----------------------------------------------------------- helpers

# Cell name -> "model|backend"
parse_cell_meta() {
  local name=$1
  case $name in
    claude-opus-*) echo "claude-opus|claude" ;;
    deepseek-v4-pro-*) echo "deepseek-v4-pro|opencode" ;;
    qwen3.6-plus-*) echo "qwen3.6-plus|opencode" ;;
    historic) echo "historic|claude" ;;
    *) echo "unknown|unknown" ;;
  esac
}

# Pull a key from a single-line JSON. Empty if missing.
json_get() {
  local key=$1
  python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    v = d.get('$key', '')
    print(v if v is not None else '')
except Exception:
    print('')
" 2>/dev/null
}

# ----------------------------------------------------------- per-cell

for cell in "${CELLS[@]}"; do
  src="$SEARCH_ROOT/run-$cell/.claude-project/$PROJECT/episodes"
  dst="$EPISODES_DIR/$cell"
  archive_cell_dir="$ARCHIVE_RUN_DIR/$cell"
  mkdir -p "$dst" "$archive_cell_dir"

  # Per-cell PRD hash (cell's PRD, fall back to source)
  prd_path="$SEARCH_ROOT/run-$cell/.claude-project/$PROJECT/prd/PRD.md"
  [ -f "$prd_path" ] || prd_path="$SOURCE_DIR/.claude-project/$PROJECT/prd/PRD.md"
  prd_sha="-"
  [ -f "$prd_path" ] && prd_sha=$(shasum -a 256 "$prd_path" 2>/dev/null | awk '{print $1}' | head -c 12)

  meta_pair=$(parse_cell_meta "$cell")
  model="${meta_pair%%|*}"
  backend="${meta_pair##*|}"

  count=0
  if [ -d "$src" ]; then
    for f in "$src"/ep-*.jsonl; do
      [ -f "$f" ] || continue
      fname=$(basename "$f")
      cp "$f" "$dst/$fname"
      cp "$f" "$archive_cell_dir/$fname"
      count=$((count + 1))

      audit=$(node "$AUDIT_JSON" "$archive_cell_dir/$fname" 2>/dev/null)
      if [ -n "$audit" ]; then
        episode_id=$(echo "$audit" | json_get episode_id)
        success=$(echo "$audit" | json_get success)
        R_episode=$(echo "$audit" | json_get R_episode)
        R_phase_sum=$(echo "$audit" | json_get R_phase_sum)
        R_terminal=$(echo "$audit" | json_get R_terminal)
        project=$(echo "$audit" | json_get project)
        started_at=$(echo "$audit" | json_get started_at)
        archive_path="episodes/$RUN_ID/$cell/$fname"
        # Skip duplicates
        if ! grep -q "^$episode_id," "$MANIFEST" 2>/dev/null; then
          echo "$episode_id,$RUN_ID,$cell,$model,$backend,$project,$prd_sha,$BASELINE_SHA,$started_at,$success,$R_episode,$R_phase_sum,$R_terminal,$REWARD_FN_SHORT,$archive_path" >> "$MANIFEST"
        fi
      fi
    done
  fi

  exit_file="$LOG_SEARCH/$cell.exit"
  if [ -f "$exit_file" ]; then
    exit_code=$(cat "$exit_file")
  else
    exit_code="-"
  fi

  # Latest episode reward
  last_reward="no-episodes"
  latest_ep=""
  for f in $(ls -t "$dst"/ep-*.jsonl 2>/dev/null); do
    latest_ep="$f"
    break
  done
  if [ -n "$latest_ep" ]; then
    r=$(node "$AUDIT_JSON" "$latest_ep" 2>/dev/null | json_get R_episode)
    [ -n "$r" ] && last_reward="$r"
  fi

  log_size="-"
  [ -f "$LOG_SEARCH/$cell.log" ] && log_size=$(du -h "$LOG_SEARCH/$cell.log" | cut -f1)

  printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$cell" "$model" "$count" "$exit_code" "$last_reward" "$log_size" >> "$SUMMARY_TMP"

  echo "  [$cell] model=$model episodes=$count exit=$exit_code last_R=$last_reward prd_sha=$prd_sha"
done

# ----------------------------------------------------------- meta.json

cells_json=""
for c in "${CELLS[@]}"; do
  cells_json="$cells_json\"$c\","
done
cells_json="${cells_json%,}"

cat > "$ARCHIVE_RUN_DIR/meta.json" <<EOF
{
  "run_id": "$RUN_ID",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "source_dir": "$SOURCE_DIR",
  "parallel_root": "$PARALLEL_ROOT",
  "baseline_sha": "$BASELINE_SHA",
  "reward_fn_sha": "$REWARD_FN_SHORT",
  "cells": [$cells_json],
  "cell_count": ${#CELLS[@]}
}
EOF

# ----------------------------------------------------------- SUMMARY.md

{
  echo "# Parallel multi-model run summary"
  echo ""
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Run id: \`$RUN_ID\`"
  echo "Archive: \`$ARCHIVE_ROOT\`"
  echo "Reward fn: \`$REWARD_FN_SHORT\`"
  echo "Baseline: \`$BASELINE_SHA\`"
  echo ""
  echo "## Cell results"
  echo ""
  echo "| Cell | Model | Episodes | Exit | Last R_episode | Log size |"
  echo "|---|---|---|---|---|---|"
  while IFS=$'\t' read -r cell model count exit_code last_reward log_size; do
    echo "| $cell | $model | $count | $exit_code | $last_reward | $log_size |"
  done < "$SUMMARY_TMP"
  echo ""
  echo "## Per-model variance (R_episode across replicates, this run)"
  echo ""
  echo "| Model | n | mean | stddev | min | p10 | p50 | p90 | max | spread |"
  echo "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
  awk -F, -v r="$RUN_ID" '
    NR == 1 { next }
    $2 == r {
      model = $4
      val = $11 + 0
      cnt[model]++
      vals[model, cnt[model]] = val
      sum[model] += val
      sumsq[model] += val * val
    }
    END {
      for (m in cnt) {
        n = cnt[m]
        for (i = 1; i <= n; i++) arr[i] = vals[m, i]
        for (i = 1; i < n; i++)
          for (j = i + 1; j <= n; j++)
            if (arr[i] > arr[j]) { t = arr[i]; arr[i] = arr[j]; arr[j] = t }
        mean = sum[m] / n
        var = (sumsq[m] / n) - mean * mean
        sd = sqrt(var > 0 ? var : 0)
        i10 = int((n - 1) * 0.1) + 1
        i50 = int((n - 1) * 0.5) + 1
        i90 = int((n - 1) * 0.9) + 1
        printf "| %s | %d | %.2f | %.2f | %.2f | %.2f | %.2f | %.2f | %.2f | %.2f |\n", \
          m, n, mean, sd, arr[1], arr[i10], arr[i50], arr[i90], arr[n], arr[n] - arr[1]
        for (i in arr) delete arr[i]
      }
    }
  ' "$MANIFEST" | sort
  echo ""
  echo "> Wide spread + low mean = candidate for "model-unfit-for-this-phase" tag in follow-up runs."
  echo ""
  echo "## Archive paths"
  echo ""
  echo "- Episodes (this run): \`$ARCHIVE_RUN_DIR\`"
  echo "- Manifest: \`$MANIFEST\`"
  echo "- Run meta: \`$ARCHIVE_RUN_DIR/meta.json\`"
  echo ""
  echo "## Quick queries"
  echo ""
  echo "\`\`\`bash"
  echo "# All episodes from this run"
  echo "awk -F, -v r=$RUN_ID '\$2==r' $MANIFEST"
  echo ""
  echo "# Top 10 by R_episode (across all runs)"
  echo "tail -n +2 $MANIFEST | sort -t, -k11 -nr | head -10"
  echo ""
  echo "# Per-model average R_episode"
  echo "tail -n +2 $MANIFEST | awk -F, '{s[\$4]+=\$11; n[\$4]++} END {for (m in s) printf \"%-25s %.2f (n=%d)\\n\", m, s[m]/n[m], n[m]}'"
  echo "\`\`\`"
} > "$SUMMARY"

rm -f "$SUMMARY_TMP"

# ── merge cell LEARNINGS.md back to source workspace ──

do_merge_learnings() {
  local source_learnings="$1"  # SOURCE_DIR/.claude-project/memory/LEARNINGS.md
  shift
  local cell_dirs=("$@")        # run-<cell> dirs

  [ ${#cell_dirs[@]} -eq 0 ] && return
  [ ! -f "$source_learnings" ] && return

  # Collect episode IDs already in source
  local existing_ids
  existing_ids=$(grep -o '<!-- ep:[^ ]* -->' "$source_learnings" 2>/dev/null | sed 's/<!-- ep://;s/ -->//' | sort -u)

  local merged=0
  for cell_dir in "${cell_dirs[@]}"; do
    local cell_learnings="$cell_dir/.claude-project/$PROJECT/memory/LEARNINGS.md"
    [ -f "$cell_learnings" ] || continue

    # Extract episodes from cell that aren't in source
    local cell_ep_ids
    cell_ep_ids=$(grep -o '<!-- ep:[^ ]* -->' "$cell_learnings" 2>/dev/null | sed 's/<!-- ep://;s/ -->//')

    local cell_name
    cell_name=$(basename "$cell_dir" | sed 's/^run-//')

    for ep_id in $cell_ep_ids; do
      # Skip if already in source
      echo "$existing_ids" | grep -qxF "$ep_id" && continue

      # Extract the full episode block from cell learnings
      # Block: from "<!-- ep:ID -->" to next "<!-- ep:" or end of ## Run history section
      local block
      block=$(awk -v id="$ep_id" '
        BEGIN { in_block=0; buf="" }
        $0 ~ "<!-- ep:"id" -->" { in_block=1; buf=$0"\n"; next }
        in_block && ($0 ~ /^<!-- ep:/) { exit }
        in_block { buf=buf$0"\n" }
        END { printf "%s", buf }
      ' "$cell_learnings")

      [ -z "$block" ] && continue

      # Tag with cell origin
      local tagged_block
      tagged_block=$(echo "$block" | sed "1s/$/ (cell: $cell_name)/")

      # Insert into source after "## Run history" header
      # Find the header line, skip it, skip any blank line after it, then
      # insert the new block before the first existing entry.
      local tmpfile
      tmpfile=$(mktemp /tmp/learnings-merge.XXXXXX)
      awk -v block="$tagged_block" '
        BEGIN { inserted=0 }
        /^## Run history/ { print; getline; if ($0=="") print; print ""; print block; inserted=1; next }
        { print }
      ' "$source_learnings" > "$tmpfile"

      mv "$tmpfile" "$source_learnings"
      merged=$((merged + 1))
      existing_ids=$(printf '%s\n%s' "$existing_ids" "$ep_id" | sort -u)
    done
  done

  if [ "$merged" -gt 0 ]; then
    echo "  [merge-learnings] merged $merged new episode entries into $source_learnings"
  else
    echo "  [merge-learnings] no new entries (all cell episodes already in source)"
  fi
}

# Discover run-<cell> dirs with LEARNINGS.md
cell_dirs=()
for d in "$PARALLEL_ROOT"/run-*; do
  [ -d "$d" ] && [ -f "$d/.claude-project/$PROJECT/memory/LEARNINGS.md" ] && cell_dirs+=("$d")
done

if [ ${#cell_dirs[@]} -gt 0 ]; then
  do_merge_learnings "$SOURCE_DIR/.claude-project/$PROJECT/memory/LEARNINGS.md" "${cell_dirs[@]}"
fi

# ── back-fill HYPOTHESIS.md Outcome section from cell artifacts ──
if [ -n "$RUN_ROOT" ] && [ -x "$CODE_DIR/write-outcome.sh" ]; then
  bash "$CODE_DIR/write-outcome.sh" "$RUN_ROOT"
fi

echo ""
echo "Summary: $SUMMARY"
echo "Manifest rows added: $(awk -F, -v r="$RUN_ID" '$2==r' "$MANIFEST" | wc -l | tr -d ' ')"
echo "Total episodes aggregated this run: $(find "$EPISODES_DIR" -name 'ep-*.jsonl' -type f | wc -l | tr -d ' ')"
echo "Total episodes in archive: $(find "$ARCHIVE_ROOT/episodes" -name 'ep-*.jsonl' -type f | wc -l | tr -d ' ')"
