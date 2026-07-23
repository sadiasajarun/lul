#!/bin/bash
# ship-gate.sh — Deterministic validation for ship/deploy phase
# Checks: production build succeeds, env vars configured, no dev dependencies leaked
source "$(dirname "$0")/_gate-runner.sh"

init_gate "ship" "$1"
BACKEND_DIR="$TARGET_DIR/backend"

# Auto-detect frontend directory
FRONTEND_DIR=""
for candidate in "frontend" "frontend-web" "web" "client" "app"; do
  if [ -d "$TARGET_DIR/$candidate" ] && [ -f "$TARGET_DIR/$candidate/package.json" ]; then
    FRONTEND_DIR="$TARGET_DIR/$candidate"
    break
  fi
done

# Check 1: Backend production build
if [ -d "$BACKEND_DIR" ] && [ -f "$BACKEND_DIR/package.json" ]; then
  if grep -q '"build"' "$BACKEND_DIR/package.json" 2>/dev/null; then
    run_check "backend-build" "cd '$BACKEND_DIR' && npm run build 2>&1"
  fi
fi

# Check 2: Frontend production build
if [ -n "$FRONTEND_DIR" ] && [ -f "$FRONTEND_DIR/package.json" ]; then
  if grep -q '"build"' "$FRONTEND_DIR/package.json" 2>/dev/null; then
    run_check "frontend-build" "cd '$FRONTEND_DIR' && npm run build 2>&1"
  fi
fi

# Check 3: Environment example files exist
file_exists_check "backend-env-example" "$BACKEND_DIR/.env.example"
if [ -n "$FRONTEND_DIR" ]; then
  file_exists_check "frontend-env-example" "$FRONTEND_DIR/.env.example"
fi

# Check 4: No .env files committed (check git status)
if command -v git &>/dev/null && [ -d "$TARGET_DIR/.git" ]; then
  ENV_TRACKED=$(cd "$TARGET_DIR" && git ls-files '*.env' '.env.*' 2>/dev/null | grep -v '.env.example' | wc -l)
  if [ "$ENV_TRACKED" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-env-committed","pass":true,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$ENV_TRACKED .env files tracked in git" '. + [{"name":"no-env-committed","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# Check 5: Docker files exist (if dockerized)
if [ -f "$TARGET_DIR/docker-compose.yml" ] || [ -f "$TARGET_DIR/docker-compose.prod.yml" ]; then
  file_exists_check "docker-compose" "$TARGET_DIR/docker-compose.yml"

  # Check Dockerfiles referenced in docker-compose exist
  if [ -f "$BACKEND_DIR/Dockerfile" ] || [ -f "$BACKEND_DIR/Dockerfile.prod" ]; then
    file_exists_check "backend-dockerfile" "$BACKEND_DIR/Dockerfile"
  fi
fi

# Check 6: No console.log left in production code
# v118: threshold 3 → 0. This is the SHIP gate (production). common.rules +
# ship.rules: "No console.log in production code". A threshold of 3 shipped debug
# output. Use a proper logger; 0 tolerance at the production boundary.
CONSOLE_LOGS=$(grep -rn 'console\.log' "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null | grep -v 'node_modules\|\.spec\.\|\.test\.' | wc -l)
if [ "$CONSOLE_LOGS" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$CONSOLE_LOGS console.log statements" '. + [{"name":"no-console-logs","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$CONSOLE_LOGS console.log statement(s) in production code — use the logger (ship.rules)" '. + [{"name":"no-console-logs","pass":false,"detail":$d,"duration_ms":0}]')
fi

# =============================================================================
# Checks 7-8: Security & completeness (prevents E-01, E-04)
# =============================================================================

# Check 7: No weak/default secrets in docker-compose or .env files
# Prevents: E-01 (JWT_SECRET=dev-jwt-secret-change-in-production)
WEAK_SECRETS=0
for secret_file in "$TARGET_DIR/docker-compose.yml" "$TARGET_DIR/docker-compose.prod.yml" "$BACKEND_DIR/.env.example"; do
  if [ -f "$secret_file" ]; then
    WEAK=$(grep -iE 'SECRET=.*dev-|SECRET=.*change|SECRET=.*example|SECRET=.*replace|SECRET=.*your-' "$secret_file" 2>/dev/null | wc -l)
    WEAK_SECRETS=$((WEAK_SECRETS + WEAK))
  fi
done
if [ "$WEAK_SECRETS" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-weak-secrets","pass":true,"detail":"no dev/example secrets found in config","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$WEAK_SECRETS weak/default secrets found — use strong secrets or env var references" \
    '. + [{"name":"no-weak-secrets","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 8: .env.example completeness — keys used in code should be in .env.example
# Prevents: E-04 (FRONTEND_URL missing from .env.example → CORS setup missed)
if [ -f "$BACKEND_DIR/.env.example" ] && [ -d "$BACKEND_DIR/src" ]; then
  # Extract env var names used in code
  CODE_ENV_KEYS=$(grep -roh 'process\.env\.\([A-Z_]*\)' "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null | \
    sed 's/process\.env\.//' | sort -u)
  MISSING_KEYS=0
  MISSING_LIST=""
  for key in $CODE_ENV_KEYS; do
    if ! grep -q "$key" "$BACKEND_DIR/.env.example" 2>/dev/null; then
      MISSING_KEYS=$((MISSING_KEYS + 1))
      MISSING_LIST="$MISSING_LIST $key"
    fi
  done
  if [ "$MISSING_KEYS" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"env-example-complete","pass":true,"detail":"all code env vars found in .env.example","duration_ms":0}]')
  else
    DETAIL="$MISSING_KEYS missing:$MISSING_LIST"
    DETAIL=$(echo "$DETAIL" | cut -c1-200)
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$DETAIL" \
      '. + [{"name":"env-example-complete","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

output_results
