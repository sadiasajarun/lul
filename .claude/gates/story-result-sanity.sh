#!/usr/bin/env bash
# story-result-sanity.sh — flip PASS→FAIL on result.json steps whose detail
# contradicts the result (e.g. "result": "PASS" with "detail": "HTTP 404: ...").
#
# v55 fix. v54 evidence: STORY_QA_REPORT_frontend.md claimed 20/28 PASS, but the
# evaluator caught 3 P0 + 4 P1 blockers — the runner was writing PASS while the
# step's detail field explicitly said HTTP 404/500/0. The evaluator catches this
# at grading time, but bug-fix-pass runs BEFORE the evaluator and sees inflated
# PASS counts, so the real bugs aren't fixed.
#
# This gate scans every result.json under the story-runs directory and flips
# any step whose detail matches HTTP (0|4xx|5xx) from PASS to FAIL. Then it
# recomputes story-level status and rewrites STORY_QA_REPORT_<frontend>.md
# pass/fail counts.
#
# Model-agnostic: pure jq/awk operating on the runner's own output. Same
# defense as test-browser-evaluator's P0 #1, but earlier in the pipeline so
# bug-fix-pass acts on truthful data.
#
# Usage: story-result-sanity.sh <run_dir>
#   run_dir = the cell run dir (e.g. .../run-mimo-xiaomi-cake1)
#   reads from <run_dir>/.claude-project/<project>/status/story-runs/<ts>/<story>/result.json
#   detects {STATUS_DIR} via PIPELINE_STATUS.md location

set -uo pipefail

RUN_DIR="${1:-$PWD}"
STATUS_DIR=$(find "$RUN_DIR/.claude-project" -name PIPELINE_STATUS.md 2>/dev/null | head -1 | xargs dirname 2>/dev/null)
if [ -z "$STATUS_DIR" ] || [ ! -d "$STATUS_DIR/story-runs" ]; then
  echo "story-result-sanity: no story-runs/ under $RUN_DIR — nothing to check"
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "story-result-sanity: jq not installed — skipping (advisory)" >&2
  exit 0
fi

# Anything matching this pattern in a step's `detail` field is treated as a
# hard contradiction with result=PASS.
HTTP_ERR_REGEX='HTTP (0|[45][0-9][0-9])(:|\b)'

total_flipped=0
total_stories_flipped=0
total_result_files=0

while IFS= read -r -d '' result_json; do
  total_result_files=$((total_result_files + 1))

  # Count steps that claim PASS but have HTTP error in detail
  bad_steps=$(jq -r --arg re "$HTTP_ERR_REGEX" \
    '[.steps[]? | select(.result == "PASS" and (.detail // "" | test($re)))] | length' \
    "$result_json" 2>/dev/null || echo 0)

  if [ "${bad_steps:-0}" -eq 0 ]; then
    continue
  fi

  # Backup once
  if [ ! -f "${result_json}.pre-sanity" ]; then
    cp "$result_json" "${result_json}.pre-sanity"
  fi

  # Flip PASS → FAIL on offending steps
  tmpfile=$(mktemp)
  jq --arg re "$HTTP_ERR_REGEX" '
    .steps = (.steps // [] | map(
      if .result == "PASS" and ((.detail // "") | test($re))
      then .result = "FAIL"
           | .detail = (.detail + " [sanity-flip: PASS+HTTP-error contradiction]")
      else .
      end
    ))
    | .status = (
        if [.steps[]? | select(.category == "acceptance" and .result != "PASS")] | length > 0
        then "FAIL"
        elif [.steps[]? | select(.result == "CRASH")] | length > 0
        then "CRASH"
        elif [.steps[]? | select(.result != "PASS")] | length > 0
        then "FAIL"
        else (.status // "PASS")
        end
      )
    | .priority = (
        if .status == "CRASH" then "P0"
        elif .status == "FAIL"
        then ([.steps[]? | select(.result != "PASS")] | first | .category) as $c
             | (if $c == "acceptance" then "P1" elif $c == null then (.priority // "-") else "P2" end)
        else "-"
        end
      )
    | .first_failure = (
        ([.steps[]? | select(.result != "PASS")] | first | .step) // .first_failure
      )
  ' "$result_json" > "$tmpfile" && mv "$tmpfile" "$result_json"

  story_id=$(jq -r '.id' "$result_json" 2>/dev/null)
  echo "story-result-sanity: flipped $bad_steps step(s) in $story_id ($result_json)"
  total_flipped=$((total_flipped + bad_steps))
  total_stories_flipped=$((total_stories_flipped + 1))
done < <(find "$STATUS_DIR/story-runs" -name 'result.json' -print0 2>/dev/null)

if [ "$total_result_files" -eq 0 ]; then
  echo "story-result-sanity: no result.json files found — nothing to check"
  exit 0
fi

echo "story-result-sanity: scanned $total_result_files result.json files, flipped $total_flipped step(s) across $total_stories_flipped stories"

# Recompute pass/fail totals in STORY_QA_REPORT{_suffix}.md if present. We
# only update the headline counts, leaving the human narrative + per-story
# table intact (bug-fix-pass reads the table; it'll re-read individual
# result.json files for status, which are now correct).
for report in "$STATUS_DIR"/STORY_QA_REPORT*.md; do
  [ -f "$report" ] || continue

  pass_n=0
  fail_n=0
  crash_n=0
  total_n=0
  while IFS= read -r -d '' rj; do
    s=$(jq -r '.status' "$rj" 2>/dev/null)
    total_n=$((total_n + 1))
    case "$s" in
      PASS) pass_n=$((pass_n + 1)) ;;
      CRASH) crash_n=$((crash_n + 1)) ;;
      *) fail_n=$((fail_n + 1)) ;;
    esac
  done < <(find "$STATUS_DIR/story-runs" -name 'result.json' -print0 2>/dev/null)

  if [ "$total_n" -eq 0 ]; then continue; fi

  # In-place replace numeric headline fields. Use a tmp file to avoid sed
  # portability problems on BSD/GNU.
  tmp=$(mktemp)
  awk -v total="$total_n" -v pass="$pass_n" -v fail="$fail_n" -v crash="$crash_n" '
    BEGIN { rate = (total > 0) ? sprintf("%.2f", pass/total) : "0.00" }
    /^stories_total:/   { sub(/[0-9]+$/, total); print; next }
    /^stories_passed:/  { sub(/[0-9]+$/, pass);  print; next }
    /^stories_failed:/  { sub(/[0-9]+$/, fail);  print; next }
    /^stories_crashed:/ { sub(/[0-9]+$/, crash); print; next }
    /^pass_rate:/       { sub(/[0-9.]+$/, rate); print; next }
    { print }
  ' "$report" > "$tmp" && mv "$tmp" "$report"

  echo "story-result-sanity: rewrote headline counts in $report (pass=$pass_n fail=$fail_n crash=$crash_n total=$total_n)"
done
