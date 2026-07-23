#!/bin/bash
# _gate-runner.sh — Shared utilities for deterministic gate scripts
# Each gate outputs structured JSON: { gate, checks[], score, summary }
#
# Usage from gate scripts:
#   source "$(dirname "$0")/_gate-runner.sh"
#   init_gate "backend"
#   run_check "tsc" "cd $REPO && npx tsc --noEmit"
#   run_check "eslint" "cd $REPO && npx eslint src/ --quiet"
#   output_results

set -o pipefail

# --- State ---
GATE_NAME=""
CHECKS_JSON="[]"
TARGET_DIR="${1:-.}"
# PROJECT_NAME (per-PRD layout): comes from $2 if the caller passed it
# (orchestrator's runGate does), else auto-detect by globbing for the first
# .claude-project/<project>/status/PIPELINE_STATUS.md.
PROJECT_NAME="${2:-}"
if [ -z "$PROJECT_NAME" ]; then
  for candidate in "$TARGET_DIR/.claude-project"/*/status/PIPELINE_STATUS.md; do
    [ -f "$candidate" ] && PROJECT_NAME=$(basename "$(dirname "$(dirname "$candidate")")") && break
  done
fi

# --- Functions ---

init_gate() {
  GATE_NAME="$1"
  CHECKS_JSON="[]"
  TARGET_DIR="${2:-$TARGET_DIR}"
  # Optional 3rd arg: project name override. Otherwise PROJECT_NAME from
  # the top-level resolution stays in effect.
  PROJECT_NAME="${3:-$PROJECT_NAME}"

  # Resolve to absolute path
  TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd)" || {
    echo "{\"gate\":\"$GATE_NAME\",\"error\":\"target directory not found: $TARGET_DIR\"}"
    exit 2
  }
}

# run_check <name> <command> [expect_pattern]
# Runs command, captures output and exit code.
# If expect_pattern provided, greps output for it (pass if found).
run_check() {
  local name="$1"
  local cmd="$2"
  local expect="${3:-}"
  local start_time end_time duration

  start_time=$(date +%s%N 2>/dev/null || date +%s)

  local output exit_code
  output=$(eval "$cmd" 2>&1) || true
  exit_code=${PIPESTATUS[0]:-$?}

  end_time=$(date +%s%N 2>/dev/null || date +%s)
  if [[ "$start_time" =~ ^[0-9]{10,}$ ]]; then
    duration=$(( (end_time - start_time) / 1000000 ))  # nanoseconds to ms
  else
    duration=$(( (end_time - start_time) * 1000 ))  # seconds to ms
  fi

  local pass=false detail=""

  if [ -n "$expect" ]; then
    if echo "$output" | grep -qE "$expect"; then
      pass=true
    else
      detail="expected pattern not found: $expect"
    fi
  elif [ "$exit_code" -eq 0 ]; then
    pass=true
  else
    # Extract first meaningful error line
    detail=$(echo "$output" | grep -iE "(error|fail|cannot|not found)" | head -3 | tr '\n' ' ' | cut -c1-200)
    if [ -z "$detail" ]; then
      detail="exit code $exit_code"
    fi
  fi

  # Escape JSON special chars in detail
  detail=$(echo "$detail" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g' | tr -d '\n')

  local check_json
  if [ "$pass" = true ]; then
    check_json="{\"name\":\"$name\",\"pass\":true,\"duration_ms\":$duration}"
  else
    check_json="{\"name\":\"$name\",\"pass\":false,\"detail\":\"$detail\",\"duration_ms\":$duration}"
  fi

  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --argjson c "$check_json" '. + [$c]')
}

# run_count_check <name> <command_that_outputs_number> <operator> <threshold>
# e.g. run_count_check "endpoint-coverage" "grep -c '@Controller' ..." ">=" 10
run_count_check() {
  local name="$1"
  local cmd="$2"
  local op="$3"
  local threshold="$4"

  local count
  count=$(eval "$cmd" 2>/dev/null) || count=0

  local pass=false
  case "$op" in
    ">=") [ "$count" -ge "$threshold" ] && pass=true ;;
    ">")  [ "$count" -gt "$threshold" ] && pass=true ;;
    "==") [ "$count" -eq "$threshold" ] && pass=true ;;
    "<=") [ "$count" -le "$threshold" ] && pass=true ;;
  esac

  local detail="count=$count (expected $op $threshold)"
  local check_json
  if [ "$pass" = true ]; then
    check_json="{\"name\":\"$name\",\"pass\":true,\"detail\":\"$detail\",\"duration_ms\":0}"
  else
    check_json="{\"name\":\"$name\",\"pass\":false,\"detail\":\"$detail\",\"duration_ms\":0}"
  fi

  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --argjson c "$check_json" '. + [$c]')
}

# file_exists_check <name> <file_path>
file_exists_check() {
  local name="$1"
  local file_path="$2"
  local check_json

  if [ -f "$file_path" ] || [ -d "$file_path" ]; then
    check_json="{\"name\":\"$name\",\"pass\":true,\"duration_ms\":0}"
  else
    check_json="{\"name\":\"$name\",\"pass\":false,\"detail\":\"not found: $file_path\",\"duration_ms\":0}"
  fi

  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --argjson c "$check_json" '. + [$c]')
}

output_results() {
  local passed total score summary threshold

  passed=$(echo "$CHECKS_JSON" | jq '[.[] | select(.pass==true)] | length')
  total=$(echo "$CHECKS_JSON" | jq 'length')

  if [ "$total" -eq 0 ]; then
    score="0"
    summary="0/0 (no checks)"
  else
    score=$(echo "scale=2; $passed / $total" | bc)
    summary="$passed/$total"
  fi

  # Allow lowering the gate pass bar via env (variance experiments).
  # Default 1.0 = all checks must pass. Set to 0.75 for 6/8 pass.
  threshold=${GATE_PASS_THRESHOLD:-1.0}

  # Layer 1: Write gate proof file (bash-generated, not LLM-generated)
  [ -d "$TARGET_DIR" ] && write_gate_proof
  # Layer 1: Record gate results to PIPELINE_STATUS.md
  [ -d "$TARGET_DIR" ] && record_gate_to_status

  jq -n \
    --arg gate "$GATE_NAME" \
    --argjson checks "$CHECKS_JSON" \
    --arg score "$score" \
    --arg threshold "$threshold" \
    --arg summary "$summary" \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      gate: $gate,
      checks: $checks,
      score: ($score | tonumber),
      summary: $summary,
      passed: (($score | tonumber) >= ($threshold | tonumber)),
      timestamp: $timestamp
    }'
}

# =============================================================================
# Layer 1: Gate Proof & Status Recording
# These functions are called by output_results() — bash-generated artifacts
# that the LLM agent cannot forge.
# =============================================================================

# write_gate_proof — Creates .gate-proofs/{phase}.proof with execution evidence
write_gate_proof() {
  local proof_dir="$TARGET_DIR/.claude-project/$PROJECT_NAME/status/.gate-proofs"
  mkdir -p "$proof_dir"
  local proof_file="$proof_dir/${GATE_NAME}.proof"
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local passed_count
  passed_count=$(echo "$CHECKS_JSON" | jq '[.[] | select(.pass==true)] | length')
  local total_count
  total_count=$(echo "$CHECKS_JSON" | jq 'length')
  local checks_hash
  checks_hash=$(echo "$CHECKS_JSON" | shasum -a 256 | cut -d' ' -f1)

  cat > "$proof_file" <<PROOF_EOF
gate: ${GATE_NAME}
executed_at: ${ts}
score: ${score}
passed: ${passed_count}/${total_count}
checks_hash: ${checks_hash}
runner_pid: $$
PROOF_EOF
}

# record_gate_to_status — Updates PIPELINE_STATUS.md with ALL status updates
# This is the single source of truth for phase completion status.
# Updates: Gate Results, Progress Table, Execution Log, Config (last_run, pipeline_score)
record_gate_to_status() {
  # Find PIPELINE_STATUS.md
  local status_file=""
  for candidate in "$TARGET_DIR/.claude-project"/*/status/PIPELINE_STATUS.md; do
    [ -f "$candidate" ] && status_file="$candidate" && break
  done
  [ -z "$status_file" ] && return 0

  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local date_short
  date_short=$(date +%Y-%m-%d)
  local passed_count total_count
  passed_count=$(echo "$CHECKS_JSON" | jq '[.[] | select(.pass==true)] | length')
  total_count=$(echo "$CHECKS_JSON" | jq 'length')

  # Determine phase status from score
  local phase_status="Failed"
  if [ "$(echo "$score >= 0.8" | bc -l 2>/dev/null || echo 0)" = "1" ]; then
    phase_status="Complete"
  fi

  # Gate output description (from GATE_OUTPUT env var or auto-generated)
  local gate_output="${GATE_OUTPUT:-${passed_count}/${total_count} checks passed}"

  # Read generation from config block
  local generation
  generation=$(grep -A 20 '```yaml' "$status_file" | grep 'generation:' | head -1 | awk '{print $2}')
  [ -z "$generation" ] && generation="1"

  # --- 1. Update Gate Results section (replace "_no runs yet_") ---
  local table_rows=""
  local check_count
  check_count=$(echo "$CHECKS_JSON" | jq 'length')
  for i in $(seq 0 $((check_count - 1))); do
    local cname cpass cdetail cdur
    cname=$(echo "$CHECKS_JSON" | jq -r ".[$i].name")
    cpass=$(echo "$CHECKS_JSON" | jq -r ".[$i].pass")
    cdetail=$(echo "$CHECKS_JSON" | jq -r ".[$i].detail // \"\"" | cut -c1-80)
    cdur=$(echo "$CHECKS_JSON" | jq -r ".[$i].duration_ms")
    local result_icon="FAIL"
    [ "$cpass" = "true" ] && result_icon="PASS"
    table_rows="${table_rows}| ${cname} | ${result_icon} | ${cdetail} | ${cdur}ms |\n"
  done

  local temp_file
  temp_file=$(mktemp)
  awk -v gate="$GATE_NAME" -v rows="$table_rows" -v ts="$ts" -v sc="$score" '
    BEGIN { in_section=0; replaced=0 }
    /^### .* — Gate Results/ {
      if (index($0, gate) > 0) { in_section=1 }
      else { in_section=0 }
    }
    /^### / && !/Gate Results/ { in_section=0 }
    /^## / { in_section=0 }
    in_section && /_no runs yet_/ && !replaced {
      printf "%s", rows
      printf "| **Score** | **%s** | **%s** | |\n", sc, ts
      replaced=1
      next
    }
    { print }
  ' "$status_file" > "$temp_file"

  if [ -s "$temp_file" ]; then
    mv "$temp_file" "$status_file"
  else
    rm -f "$temp_file"
  fi

  # --- 2. Update Progress Table row ---
  # Replace the row matching this gate's phase name with updated Status, Score, Output, Gate Run At
  local progress_temp
  progress_temp=$(mktemp)
  awk -v gate="$GATE_NAME" -v status="$phase_status" -v sc="$score" -v output="$gate_output" -v ts="$ts" '
    BEGIN { found=0 }
    /^\| / && !found {
      # Split by | and check if field 1 (phase name) matches gate
      split($0, fields, "|")
      # Trim whitespace from phase field
      phase = fields[2]
      gsub(/^[ \t]+|[ \t]+$/, "", phase)
      if (phase == gate) {
        # Reconstruct row: | phase | Status | Score | Output | Loop Runs | Gate Run At | Notes |
        printf "| %s | %s | %s | %s | %s | %s | %s |\n", gate, status, sc, output, "0", ts, "gate-runner"
        found=1
        next
      }
    }
    { print }
  ' "$status_file" > "$progress_temp"

  if [ -s "$progress_temp" ]; then
    mv "$progress_temp" "$status_file"
  else
    rm -f "$progress_temp"
  fi

  # --- 3. Append to Execution Log ---
  # Find the Execution Log table and append a row after the header separator
  local exec_temp
  exec_temp=$(mktemp)
  awk -v date="$date_short" -v gate="$GATE_NAME" -v gen="$generation" -v status="$phase_status" -v sc="$score" '
    BEGIN { in_exec=0; header_done=0; appended=0 }
    /^## Execution Log/ { in_exec=1 }
    /^## / && !/Execution Log/ { in_exec=0 }
    in_exec && /^\|---/ { header_done=1; print; next }
    in_exec && header_done && !appended && /^$/ {
      printf "| %s | %s | %s | - | %s | %s | gate-runner |\n", date, gate, gen, status, sc
      appended=1
    }
    in_exec && header_done && !appended && /^## / {
      printf "| %s | %s | %s | - | %s | %s | gate-runner |\n", date, gate, gen, status, sc
      appended=1
    }
    { print }
  ' "$status_file" > "$exec_temp"

  if [ -s "$exec_temp" ]; then
    mv "$exec_temp" "$status_file"
  else
    rm -f "$exec_temp"
  fi

  # --- 4. Update Config block: last_run and pipeline_score ---
  # Update last_run
  sed -i.bak "s/^last_run:.*/last_run: $ts/" "$status_file" 2>/dev/null || \
    sed -i '' "s/^last_run:.*/last_run: $ts/" "$status_file"
  rm -f "${status_file}.bak"

  # Recalculate pipeline_score: average of all completed phase scores
  # Count completed phases and sum their scores from Progress Table
  local new_pipeline_score
  new_pipeline_score=$(awk '
    BEGIN { sum=0; count=0 }
    /^\|/ && /Complete/ {
      split($0, f, "|")
      sc = f[4]  # Score column
      gsub(/^[ \t]+|[ \t]+$/, "", sc)
      if (sc ~ /^[0-9]/) {
        sum += sc
        count++
      }
    }
    END {
      if (count > 0) printf "%.2f", sum/count
      else print "0"
    }
  ' "$status_file")

  sed -i.bak "s/^pipeline_score:.*/pipeline_score: $new_pipeline_score/" "$status_file" 2>/dev/null || \
    sed -i '' "s/^pipeline_score:.*/pipeline_score: $new_pipeline_score/" "$status_file"
  rm -f "${status_file}.bak"

  # --- 5. Update Gate Proofs table ---
  local proof_file="$TARGET_DIR/.claude-project/$PROJECT_NAME/status/.gate-proofs/${GATE_NAME}.proof"
  local checks_hash
  checks_hash=$(echo "$CHECKS_JSON" | shasum -a 256 | cut -d' ' -f1)
  local proofs_temp
  proofs_temp=$(mktemp)
  awk -v gate="$GATE_NAME" -v proof="$proof_file" -v ts="$ts" -v sc="$score" -v hash="$checks_hash" '
    BEGIN { in_proofs=0; header_done=0; appended=0 }
    /^## Gate Proofs/ { in_proofs=1 }
    /^## / && !/Gate Proofs/ { if (in_proofs && !appended) { printf "| %s | %s | %s | %s | %s |\n", gate, ".gate-proofs/"gate".proof", ts, sc, hash; appended=1 } in_proofs=0 }
    in_proofs && /^\|---/ { header_done=1; print; next }
    in_proofs && header_done && !appended && /^$/ {
      printf "| %s | %s | %s | %s | %s |\n", gate, ".gate-proofs/"gate".proof", ts, sc, hash
      appended=1
    }
    { print }
  ' "$status_file" > "$proofs_temp"

  if [ -s "$proofs_temp" ]; then
    mv "$proofs_temp" "$status_file"
  else
    rm -f "$proofs_temp"
  fi
}
