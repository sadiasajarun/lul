#!/usr/bin/env bash
# diagnose.sh — Phase 1 of the failure feedback loop.
# Triages every non-success cell against known patterns in
# .claude-project/memory/FAILURE_PATTERNS.yaml. Read-only by default.
#
# Usage:
#   bash diagnose.sh                  # human-readable report
#   bash diagnose.sh --json           # JSON per cell (one object per line)
#   bash diagnose.sh --pre-run        # short summary for run-parallel.sh hook
#   bash diagnose.sh --update         # also append findings to FAILURE_PATTERNS.yaml
#                                     # (bumps occurrences / first_seen / last_seen;
#                                     #  appends 'unclassified' entries with raw evidence)
#
# Exit codes:
#   0 — no non-success cells (or all already mitigated)
#   2 — non-success cells found, classified or unclassified — non-blocking
#   3 — unmitigated critical pattern seen 3+ times (advisory; caller decides)

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
LOG_DIR="$DATA_DIR/logs"
CELLS_CONF="${CELLS_CONF:-$DATA_DIR/cells.conf}"
PATTERNS_FILE="${PATTERNS_FILE:-$SOURCE_DIR/.claude-project/memory/FAILURE_PATTERNS.yaml}"

MODE="report"      # report | json | pre-run | predict
DO_UPDATE=0

for arg in "$@"; do
  case "$arg" in
    --json)    MODE="json" ;;
    --pre-run) MODE="pre-run" ;;
    --predict) MODE="predict" ;;
    --update)  DO_UPDATE=1 ;;
    --help|-h)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *) echo "ERROR: unknown arg '$arg'" >&2; exit 1 ;;
  esac
done

# ─── predict mode (A1) ────────────────────────────────────────────────
# Reads .claude-project/archive/manifest.csv, groups by cell name, computes
# per-cell historical success rate. Prints WARN line for any cell with
# > 50% historical fail rate. Never exits non-zero (gentle mode — informational
# only; the user / pre-run hook decides what to do with the warnings).
#
# Manifest schema: episode_id,run_id,cell,model,backend,project,prd_sha,
#                  baseline_sha,started_at,success,R_episode,...
#                  ^1          ^2     ^3    ^4    ^5      ^6      ^7    ^8           ^9          ^10     ^11
predict_cells() {
  local manifest="$SOURCE_DIR/.claude-project/archive/manifest.csv"
  if [ ! -f "$manifest" ]; then
    echo "[predict] no manifest.csv yet — skipping (run aggregate.sh once to populate)"
    return 0
  fi

  echo "=== Per-cell historical fail-rate (from manifest.csv) ==="
  local any_warn=0
  for cell in $CELLS; do
    local total fails rate
    total=$(awk -F, -v c="$cell" '$3==c {n++} END {print n+0}' "$manifest")
    fails=$(awk -F, -v c="$cell" '$3==c && $10!="True" {n++} END {print n+0}' "$manifest")
    if [ "$total" -lt 3 ]; then
      printf "  %-32s n=%-2d  (insufficient history)\n" "$cell" "$total"
      continue
    fi
    rate=$((fails * 100 / total))
    if [ "$rate" -gt 50 ]; then
      printf "  ⚠  %-32s n=%-2d  fail-rate %d%%  (%d failed)\n" "$cell" "$total" "$rate" "$fails"
      any_warn=1
    else
      printf "  ✓  %-32s n=%-2d  fail-rate %d%%\n" "$cell" "$total" "$rate"
    fi
  done

  if [ "$any_warn" = "1" ]; then
    echo ""
    echo "  Cells flagged above have >50% historical failure rate."
    echo "  Consider commenting them out in cells.conf, or accept the risk."
    echo "  (Warning only — never blocks the run.)"
  fi
  return 0
}

if [ "$MODE" = "predict" ]; then
  # CELLS gets loaded below; defer execution until then via flag.
  RUN_PREDICT=1
fi

# ─── load cells from cells.conf (slim version of run-parallel.sh) ────

CELLS=""
if [ -f "$CELLS_CONF" ]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [ -z "$(echo "$line" | xargs)" ] && continue
    name=$(echo "$line" | cut -d'|' -f1 | xargs)
    [ -n "$name" ] && CELLS="$CELLS $name"
  done < "$CELLS_CONF"
fi

# Also include any cell that has a logs/<cell>.log even if it's no longer in
# cells.conf (commented-out cells, renamed cells, etc.) — we want to triage
# stale state too.
if [ -d "$LOG_DIR" ]; then
  for f in "$LOG_DIR"/*.log; do
    [ -f "$f" ] || continue
    base=$(basename "$f" .log)
    # Skip non-cell log files
    case "$base" in
      _*|[!a-z]*) continue ;;       # _batch.log, _foundation-*.log etc.
      *.attempt-*) continue ;;       # per-attempt backup logs
    esac
    case " $CELLS " in *" $base "*) ;; *) CELLS="$CELLS $base" ;; esac
  done
fi

# Predict mode runs here (CELLS now loaded) and exits before any other logic.
if [ "${RUN_PREDICT:-0}" = "1" ]; then
  predict_cells
  exit 0
fi

# ─── per-cell status ─────────────────────────────────────────────────

cell_status() {
  local cell="$1"
  local pidfile="$LOG_DIR/$cell.pid"
  local exitfile="$LOG_DIR/$cell.exit"
  local failedfile="$LOG_DIR/$cell.FAILED"

  if [ -f "$failedfile" ]; then echo "FAILED"; return; fi
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile" 2>/dev/null || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "RUNNING:$pid"; return
    fi
  fi
  if [ -f "$exitfile" ]; then
    local code; code=$(cat "$exitfile" 2>/dev/null || echo "?")
    if [ "$code" = "0" ]; then echo "DONE"; else echo "EXITED:$code"; fi
    return
  fi
  if [ -f "$LOG_DIR/$cell.log" ]; then echo "STOPPED"; return; fi
  echo "IDLE"
}

# ─── pattern classifier ──────────────────────────────────────────────

# Returns a pattern_id (or "unclassified") given a cell's logs.
classify_cell() {
  local cell="$1"
  local cell_log="$LOG_DIR/$cell.log"
  local agent_logs_dir="$PARALLEL_ROOT/run-$cell/.claude-project/agent-logs"

  # Newest run-* directory (auto-tag) takes precedence if flat doesn't exist.
  if [ ! -d "$PARALLEL_ROOT/run-$cell" ]; then
    local newest
    newest=$(ls -td "$PARALLEL_ROOT"/runs/*/run-"$cell" 2>/dev/null | head -1)
    [ -n "$newest" ] && agent_logs_dir="$newest/.claude-project/agent-logs"
  fi

  local last_node=""
  if [ -f "$cell_log" ]; then
    last_node=$(grep -oE '\[[0-9]+/[0-9]+\] (deterministic|agentic|evaluator): [a-z-]+' "$cell_log" \
                | tail -1 | sed -E 's/.*: //')
  fi

  # Pattern: subprocess-timeout (post-C1 — the timer prints this exact line)
  if [ -d "$agent_logs_dir" ] && \
     grep -lq "TIMEOUT after.*sending SIGTERM" "$agent_logs_dir"/*.log 2>/dev/null; then
    echo "subprocess-timeout|$last_node"; return
  fi

  # Pattern: opencode-evaluator-hang — gate on last_node being an *evaluator
  # Signature: agent log has `=== STDOUT ===` marker but NO content after it,
  # AND no `=== EXIT CODE` line (process was SIGKILLed before completing).
  case "$last_node" in
    *evaluator*)
      if [ -d "$agent_logs_dir" ]; then
        local newest_eval
        newest_eval=$(ls -t "$agent_logs_dir"/${last_node}-*.log 2>/dev/null | head -1)
        if [ -n "$newest_eval" ] && \
           grep -q "^command:.*opencode" "$newest_eval" 2>/dev/null && \
           grep -q "^=== STDOUT ===" "$newest_eval" 2>/dev/null && \
           ! grep -q "^=== EXIT CODE" "$newest_eval" 2>/dev/null; then
          local stdout_content
          stdout_content=$(awk '/^=== STDOUT ===/{flag=1; next} flag' "$newest_eval" \
                           | tr -d '[:space:]' | head -c 200)
          if [ -z "$stdout_content" ]; then
            echo "opencode-evaluator-hang|$last_node"; return
          fi
        fi
      fi
      ;;
  esac

  # Pattern: typecheck-failure — only when typecheck was the failing node
  if [ "$last_node" = "typecheck" ]; then
    echo "typecheck-failure|$last_node"; return
  fi

  # Pattern: verification-pattern-mismatch (any episode with this reason)
  local ep_dir_check="$PARALLEL_ROOT/run-$cell/.claude-project/episodes"
  if [ -d "$ep_dir_check" ] && \
     grep -lq '"reason": *"pattern_mismatch"' "$ep_dir_check"/*.jsonl 2>/dev/null; then
    echo "verification-pattern-mismatch|$last_node"; return
  fi

  # Pattern: artifact-missing
  if [ -d "$ep_dir_check" ] && \
     grep -lq '"reason": *"file_missing"' "$ep_dir_check"/*.jsonl 2>/dev/null; then
    echo "artifact-missing|$last_node"; return
  fi

  # Pattern: sigkill-external (exit=137 with no other signal)
  if [ -f "$LOG_DIR/$cell.exit" ] && [ "$(cat "$LOG_DIR/$cell.exit" 2>/dev/null)" = "137" ]; then
    echo "sigkill-external|$last_node"; return
  fi

  echo "unclassified|$last_node"
}

# ─── evidence harvester ──────────────────────────────────────────────

harvest_evidence() {
  local cell="$1"
  local cell_log="$LOG_DIR/$cell.log"
  local exit_code="?"
  [ -f "$LOG_DIR/$cell.exit" ] && exit_code=$(cat "$LOG_DIR/$cell.exit")

  local attempts=1
  for n in 1 2; do
    [ -f "$LOG_DIR/$cell.attempt-$n.log" ] && attempts=$((n + 1))
  done

  local episode_id="" R_episode=""
  local ep_dir="$PARALLEL_ROOT/run-$cell/.claude-project/episodes"
  if [ ! -d "$ep_dir" ]; then
    local newest_run
    newest_run=$(ls -td "$PARALLEL_ROOT"/runs/*/run-"$cell" 2>/dev/null | head -1)
    [ -n "$newest_run" ] && ep_dir="$newest_run/.claude-project/episodes"
  fi
  if [ -d "$ep_dir" ]; then
    local newest_ep
    newest_ep=$(ls -t "$ep_dir"/ep-*.jsonl 2>/dev/null | head -1)
    if [ -n "$newest_ep" ]; then
      episode_id=$(basename "$newest_ep" .jsonl)
    fi
  fi

  local log_tail=""
  if [ -f "$cell_log" ]; then
    log_tail=$(tail -3 "$cell_log" 2>/dev/null | tr '\n' ' ' | sed 's/"/\\"/g' | head -c 300)
  fi

  printf "exit_code=%s attempts=%d episode_id=%s log_tail=%s" \
    "$exit_code" "$attempts" "${episode_id:-none}" "${log_tail:-none}"
}

# ─── pattern catalog updater ──────────────────────────────────────────

# Bump occurrences for a known pattern, or append a new unclassified one.
# Conservative — only modifies the file when --update is set.
update_catalog() {
  local cell="$1" pattern_id="$2" failing_node="$3" exit_code="$4" log_tail="$5"
  [ "$DO_UPDATE" = "1" ] || return 0
  [ -f "$PATTERNS_FILE" ] || return 0    # require seeded catalog

  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Try to bump existing pattern's last_seen + occurrences. Cheap awk pass.
  # macOS grep/awk both lack reliable `\b`; match exact id by field 3.
  local pattern_exists=0
  if awk -v pid="$pattern_id" \
       '/^[[:space:]]*-[[:space:]]+id:/ && $3==pid { found=1; exit }
        END { exit !found }' "$PATTERNS_FILE" 2>/dev/null; then
    pattern_exists=1
  fi
  if [ "$pattern_exists" = "1" ]; then
    local tmp; tmp=$(mktemp)
    awk -v pid="$pattern_id" -v now="$now" -v cell="$cell" '
      BEGIN { in_block=0 }
      /^[[:space:]]*-[[:space:]]+id:/ { in_block = ($3 == pid) ? 1 : 0 }
      in_block && /^[[:space:]]+last_seen:/ {
        sub(/last_seen:.*/, "last_seen:  " now); print; next
      }
      in_block && /^[[:space:]]+occurrences:/ {
        n = $2 + 1
        sub(/occurrences:[[:space:]]*[0-9]+/, "occurrences: " n); print; next
      }
      { print }
    ' "$PATTERNS_FILE" > "$tmp" && mv "$tmp" "$PATTERNS_FILE"
  elif [ "$pattern_id" = "unclassified" ]; then
    # Append a stub for human triage later.
    {
      echo ""
      echo "  - id: unclassified-${cell}-$(date -u +%Y%m%dT%H%M%SZ)"
      echo "    first_seen: $now"
      echo "    last_seen:  $now"
      echo "    occurrences: 1"
      echo "    cells_affected: [$cell]"
      echo "    failing_nodes: [${failing_node:-unknown}]"
      echo "    signature: <unclassified — needs human review>"
      echo "    root_cause: <unknown>"
      echo "    mitigation: <none>"
      echo "    status: open"
      echo "    raw_evidence:"
      echo "      exit_code: $exit_code"
      echo "      log_tail_excerpt: |"
      echo "        ${log_tail:0:200}"
    } >> "$PATTERNS_FILE"
  fi
}

# ─── pattern lookup helpers ──────────────────────────────────────────

pattern_status() {
  local pid="$1"
  [ -f "$PATTERNS_FILE" ] || { echo "unknown"; return; }
  # macOS awk has no `\b`; match exact id by checking that field 3
  # ($1=`-`, $2=`id:`, $3=`<pattern_id>`) equals pid.
  awk -v pid="$pid" '
    /^[[:space:]]*-[[:space:]]+id:[[:space:]]+/ { in_block = ($3 == pid) ? 1 : 0 }
    in_block && /^[[:space:]]+status:/ { print $2; exit }
  ' "$PATTERNS_FILE" 2>/dev/null
}

pattern_mitigation() {
  local pid="$1"
  [ -f "$PATTERNS_FILE" ] || { echo ""; return; }
  awk -v pid="$pid" '
    /^[[:space:]]*-[[:space:]]+id:[[:space:]]+/ { in_block = ($3 == pid) ? 1 : 0 }
    in_block && /^[[:space:]]+mitigation:/ {
      # Mitigation may be a string OR a YAML object across following lines.
      # Just emit whats on this line; if its empty (object form), look at
      # next "type:" line below.
      line = $0
      sub(/^[[:space:]]*mitigation:[[:space:]]*/, "", line)
      if (length(line) > 0) { print line; exit }
      mit_block = 1
      next
    }
    mit_block && /^[[:space:]]+type:/ {
      sub(/^[[:space:]]*type:[[:space:]]*/, "")
      print
      exit
    }
    mit_block && /^[[:space:]]*-/ { exit }
  ' "$PATTERNS_FILE" 2>/dev/null
}

# ─── main ────────────────────────────────────────────────────────────

[ "$MODE" = "json" ] || echo "=== Failure Diagnosis ($(date -u +%Y-%m-%dT%H:%M:%SZ)) ==="

NON_SUCCESS=0
CRITICAL_UNMITIGATED=0
declare -a REPORT_ROWS=()

for cell in $CELLS; do
  status=$(cell_status "$cell")
  case "$status" in
    DONE|RUNNING:*) continue ;;
  esac

  NON_SUCCESS=$((NON_SUCCESS + 1))

  classification=$(classify_cell "$cell")
  pattern_id="${classification%|*}"
  failing_node="${classification#*|}"
  evidence=$(harvest_evidence "$cell")

  # Parse evidence into individual fields (for JSON output)
  exit_code=$(echo "$evidence" | grep -oE 'exit_code=[^ ]*' | cut -d= -f2)
  attempts=$(echo "$evidence" | grep -oE 'attempts=[^ ]*' | cut -d= -f2)
  episode_id=$(echo "$evidence" | grep -oE 'episode_id=[^ ]*' | cut -d= -f2)
  log_tail=$(echo "$evidence" | sed 's/^.*log_tail=//')

  pat_status=$(pattern_status "$pattern_id")
  pat_mitigation=$(pattern_mitigation "$pattern_id")

  if [ "$pat_status" = "open" ] || [ "$pattern_id" = "unclassified" ]; then
    CRITICAL_UNMITIGATED=$((CRITICAL_UNMITIGATED + 1))
  fi

  case "$MODE" in
    json)
      jq_safe() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
      printf '{"cell":"%s","status":"%s","exit_code":"%s","attempts":%s,"failing_node":"%s","pattern_id":"%s","pattern_status":"%s","mitigation":"%s","episode_id":"%s","log_tail":"%s"}\n' \
        "$cell" "$status" "$exit_code" "${attempts:-1}" "${failing_node:-unknown}" "$pattern_id" "$pat_status" "$(jq_safe "${pat_mitigation:-none}")" "$episode_id" "$(jq_safe "${log_tail:-none}")"
      ;;
    pre-run)
      printf "  %-32s  %-10s  %s%s\n" "$cell" "$status" "$pattern_id" \
        "$([ "$pat_status" = "mitigated" ] && echo " [mitigated]" || echo "")"
      ;;
    *)
      cat <<EOF

  ── $cell ──
    status        : $status
    failing node  : ${failing_node:-unknown}
    pattern       : $pattern_id  (catalog status: ${pat_status:-not-in-catalog})
    mitigation    : ${pat_mitigation:-<none>}
    attempts      : ${attempts:-1}
    exit_code     : ${exit_code:-?}
    episode       : ${episode_id:-none}
    log tail      : ${log_tail:-(no log)}
EOF
      ;;
  esac

  update_catalog "$cell" "$pattern_id" "$failing_node" "$exit_code" "$log_tail"
done

# ─── exit code policy ────────────────────────────────────────────────

if [ "$NON_SUCCESS" = "0" ]; then
  [ "$MODE" = "json" ] || echo "All cells DONE or RUNNING — nothing to investigate."
  exit 0
fi

if [ "$MODE" != "json" ]; then
  echo ""
  echo "Summary: $NON_SUCCESS non-success cell(s); $CRITICAL_UNMITIGATED unmitigated."
  if [ "$DO_UPDATE" = "1" ]; then
    echo "Catalog updated: $PATTERNS_FILE"
  else
    echo "Catalog read-only. Pass --update to record findings."
  fi
fi

# Advisory: 3+ unmitigated occurrences in one report = caller may want to halt.
if [ "$CRITICAL_UNMITIGATED" -ge 3 ]; then exit 3; fi
exit 2
