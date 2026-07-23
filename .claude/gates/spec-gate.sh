#!/bin/bash
# spec-gate.sh — Deterministic validation for spec phase
# Enforces: seed.yaml has required fields, ambiguity <= 0.2, acceptance criteria present
source "$(dirname "$0")/_gate-runner.sh"

init_gate "spec" "$1"

STATUS_DIR="$TARGET_DIR/.claude-project/status"

# Find seed.yaml (any project subdirectory)
SEED=""
for candidate in "$STATUS_DIR"/*/seed.yaml; do
  [ -f "$candidate" ] && SEED="$candidate" && break
done

if [ -z "$SEED" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"seed-exists","pass":false,"detail":"seed.yaml not found","duration_ms":0}]')
  output_results
  exit 0
fi

CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SEED" '. + [{"name":"seed-exists","pass":true,"detail":$d,"duration_ms":0}]')

# --- 1. Goal field present ---
if grep -q '^goal:[[:space:]]*[^[:space:]]' "$SEED"; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"goal-present","pass":true,"detail":"goal defined","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"goal-present","pass":false,"detail":"goal: field empty or missing","duration_ms":0}]')
fi

# --- 2. Ambiguity <= 0.2 ---
AMBIG=$(grep -m1 '^ambiguity_score:' "$SEED" | sed 's/[^0-9.]//g')
if [ -n "$AMBIG" ]; then
  # bash can't compare floats directly — use awk
  PASS=$(awk -v v="$AMBIG" 'BEGIN { print (v <= 0.2) ? "true" : "false" }')
  if [ "$PASS" = "true" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "ambiguity=$AMBIG" '. + [{"name":"ambiguity-leq-0.2","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "ambiguity=$AMBIG (> 0.2)" '. + [{"name":"ambiguity-leq-0.2","pass":false,"detail":$d,"duration_ms":0}]')
  fi
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"ambiguity-leq-0.2","pass":false,"detail":"ambiguity_score field missing","duration_ms":0}]')
fi

# --- 3. Acceptance criteria count >= 3 ---
AC_COUNT=$(awk '/^acceptance_criteria:/{flag=1;next}/^[a-z_]+:/{flag=0}flag && /^[[:space:]]*-/' "$SEED" | wc -l | tr -d ' ')
if [ "$AC_COUNT" -ge 3 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "count=$AC_COUNT" '. + [{"name":"acceptance-criteria-min-3","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "count=$AC_COUNT (need >= 3)" '. + [{"name":"acceptance-criteria-min-3","pass":false,"detail":$d,"duration_ms":0}]')
fi

# --- 4. Ontology terms present ---
ONT_COUNT=$(awk '/^ontology:/{flag=1;next}/^[a-z_]+:/{flag=0}flag && /^[[:space:]]*-[[:space:]]*term:/' "$SEED" | wc -l | tr -d ' ')
if [ "$ONT_COUNT" -ge 1 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "terms=$ONT_COUNT" '. + [{"name":"ontology-terms-present","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"ontology-terms-present","pass":false,"detail":"no ontology terms with definitions","duration_ms":0}]')
fi

# --- 5. SPEC_REPORT.md exists ---
SPEC_REPORT=""
for candidate in "$STATUS_DIR"/*/SPEC_REPORT.md; do
  [ -f "$candidate" ] && SPEC_REPORT="$candidate" && break
done
if [ -n "$SPEC_REPORT" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"spec-report-exists","pass":true,"detail":"SPEC_REPORT.md present","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"spec-report-exists","pass":false,"detail":"SPEC_REPORT.md missing","duration_ms":0}]')
fi

output_results
