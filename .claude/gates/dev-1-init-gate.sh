#!/bin/bash
# dev-1-init-gate.sh — Deterministic validation for Dev-track Phase D1-init
# Enforces: project scaffold (CLAUDE.md, .claude-rules, dirs, memory templates, PIPELINE_STATUS)
#           + design-intent.yaml is present and valid
source "$(dirname "$0")/_gate-runner.sh"

init_gate "D1-init" "$1"

# --- 1. CLAUDE.md exists at root ---
file_exists_check "claude-md-exists" "$TARGET_DIR/CLAUDE.md"

# --- 2. .claude-rules (root) ---
file_exists_check "claude-rules-root" "$TARGET_DIR/.claude-rules"

# --- 3. backend/.claude-rules (if backend/ exists) ---
if [ -d "$TARGET_DIR/backend" ]; then
  file_exists_check "claude-rules-backend" "$TARGET_DIR/backend/.claude-rules"
fi

# --- 4. frontend/.claude-rules (try all candidates) ---
FRONTEND_DIR=""
for cand in frontend frontend-web web client app; do
  [ -d "$TARGET_DIR/$cand" ] && FRONTEND_DIR="$cand" && break
done
if [ -n "$FRONTEND_DIR" ]; then
  file_exists_check "claude-rules-frontend" "$TARGET_DIR/$FRONTEND_DIR/.claude-rules"
fi

# --- 5. Directory scaffolding ---
for d in \
  ".claude-project/docs" \
  ".claude-project/$PROJECT_NAME/memory" \
  ".claude-project/status"; do
  file_exists_check "dir-$(basename "$d")" "$TARGET_DIR/$d"
done

# --- 6. Memory templates ---
for mem in DECISIONS.md LEARNINGS.md PREFERENCES.md; do
  file_exists_check "memory-$mem" "$TARGET_DIR/.claude-project/$PROJECT_NAME/memory/$mem"
done

# --- 7. PIPELINE_STATUS.md exists ---
STATUS_FILE=$(find "$TARGET_DIR/.claude-project/status" -name PIPELINE_STATUS.md -type f 2>/dev/null | head -1)
if [ -n "$STATUS_FILE" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg p "$STATUS_FILE" '. + [{"name":"pipeline-status","pass":true,"detail":$p,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"pipeline-status","pass":false,"detail":"PIPELINE_STATUS.md not found","duration_ms":0}]')
fi

# --- 8. design-intent.yaml exists ---
INTENT_FILE="$TARGET_DIR/.claude-project/$PROJECT_NAME/design/design-intent.yaml"
file_exists_check "intent-exists" "$INTENT_FILE"

# --- 9. design-intent.yaml is valid YAML ---
if [ -f "$INTENT_FILE" ]; then
  if command -v python3 &>/dev/null; then
    if python3 -c "import yaml; yaml.safe_load(open('$INTENT_FILE'))" 2>/dev/null; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"intent-valid-yaml","pass":true,"duration_ms":0}]')
    else
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"intent-valid-yaml","pass":false,"detail":"YAML parse error","duration_ms":0}]')
    fi
  else
    # Fallback: basic grep check for expected top-level keys
    if grep -qE '^(generated_at|source|screens):' "$INTENT_FILE"; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"intent-valid-yaml","pass":true,"detail":"basic grep check (python3 unavailable)","duration_ms":0}]')
    else
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"intent-valid-yaml","pass":false,"detail":"missing expected keys","duration_ms":0}]')
    fi
  fi
fi

# --- 10. intent.yaml has at least one screen ---
if [ -f "$INTENT_FILE" ]; then
  SCREEN_COUNT=$(grep -cE "^\s*- file:" "$INTENT_FILE" 2>/dev/null || echo 0)
  SCREEN_COUNT=$(echo "$SCREEN_COUNT" | tr -d '[:space:]')
  if [ "${SCREEN_COUNT:-0}" -ge 1 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$SCREEN_COUNT screens" '. + [{"name":"intent-has-screens","pass":true,"detail":$n,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"intent-has-screens","pass":false,"detail":"no screens in intent","duration_ms":0}]')
  fi
fi

# --- 11. intent.yaml html_bundle_hash matches current HTML tree ---
if [ -f "$INTENT_FILE" ]; then
  HTML_ROOT="$TARGET_DIR/.claude-project/$PROJECT_NAME/design/html"
  if [ -d "$HTML_ROOT" ]; then
    CURRENT_HASH=$(find "$HTML_ROOT" -name '*.html' -type f | sort | xargs -I {} sh -c 'echo "{}"; cat "{}"' | sha256sum | awk '{print $1}')
    INTENT_HASH=$(grep -E "^\s*html_bundle_hash:" "$INTENT_FILE" | head -1 | sed 's/.*"\([a-f0-9]\{64\}\)".*/\1/')
    if [ "$CURRENT_HASH" = "$INTENT_HASH" ] && [ -n "$CURRENT_HASH" ]; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"intent-hash-match","pass":true,"duration_ms":0}]')
    else
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "intent=$INTENT_HASH current=$CURRENT_HASH" '. + [{"name":"intent-hash-match","pass":false,"detail":$d,"duration_ms":0}]')
    fi
  fi
fi

output_results
