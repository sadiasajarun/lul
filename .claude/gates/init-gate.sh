#!/bin/bash
# init-gate.sh — Deterministic validation for init phase
# Enforces: scaffolding produced backend/ and frontend/ with package.json + tsconfig
source "$(dirname "$0")/_gate-runner.sh"

init_gate "init" "$1"

# --- 1. backend/ directory scaffolded ---
if [ -d "$TARGET_DIR/backend" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"backend-dir-exists","pass":true,"detail":"backend/ present","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"backend-dir-exists","pass":false,"detail":"backend/ missing","duration_ms":0}]')
fi

# --- 2. frontend/ directory scaffolded (supports multi-frontend: frontend-* dirs) ---
FRONTEND_FOUND=false
if [ -d "$TARGET_DIR/frontend" ]; then
  FRONTEND_FOUND=true
else
  # Check for multi-frontend pattern (frontend-admin, frontend-worker, etc.)
  for dir in "$TARGET_DIR"/frontend-*/; do
    [ -d "$dir" ] && FRONTEND_FOUND=true && break
  done
fi
if [ "$FRONTEND_FOUND" = true ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"frontend-dir-exists","pass":true,"detail":"frontend/ or frontend-* present","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"frontend-dir-exists","pass":false,"detail":"frontend/ missing","duration_ms":0}]')
fi

# --- 3. Backend package.json + tsconfig ---
if [ -f "$TARGET_DIR/backend/package.json" ] && [ -f "$TARGET_DIR/backend/tsconfig.json" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"backend-configs","pass":true,"detail":"package.json + tsconfig.json present","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"backend-configs","pass":false,"detail":"missing package.json or tsconfig.json","duration_ms":0}]')
fi

# --- 4. Frontend package.json + tsconfig (supports multi-frontend) ---
FRONTEND_CONFIGS_OK=false
if [ -f "$TARGET_DIR/frontend/package.json" ] && [ -f "$TARGET_DIR/frontend/tsconfig.json" ]; then
  FRONTEND_CONFIGS_OK=true
else
  # Check any frontend-* dir for configs
  for dir in "$TARGET_DIR"/frontend-*/; do
    if [ -f "${dir}package.json" ] && [ -f "${dir}tsconfig.json" ]; then
      FRONTEND_CONFIGS_OK=true
      break
    fi
  done
fi
if [ "$FRONTEND_CONFIGS_OK" = true ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"frontend-configs","pass":true,"detail":"package.json + tsconfig.json present","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"frontend-configs","pass":false,"detail":"missing package.json or tsconfig.json","duration_ms":0}]')
fi

# --- 5. PIPELINE_STATUS.md exists ---
STATUS_FILE=""
for candidate in "$TARGET_DIR"/.claude-project/*/status/PIPELINE_STATUS.md; do
  [ -f "$candidate" ] && STATUS_FILE="$candidate" && break
done
if [ -n "$STATUS_FILE" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"pipeline-status-exists","pass":true,"detail":"PIPELINE_STATUS.md present","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"pipeline-status-exists","pass":false,"detail":"no PIPELINE_STATUS.md","duration_ms":0}]')
fi

# --- 6. .env.example exists (hygiene) ---
if [ -f "$TARGET_DIR/.env.example" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"env-example-exists","pass":true,"detail":".env.example present","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"env-example-exists","pass":false,"detail":".env.example missing","duration_ms":0}]')
fi

output_results
