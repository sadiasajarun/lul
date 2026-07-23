#!/bin/bash
# production-test-gate.sh — Comprehensive production readiness validation
# Unified gate for Phase 9 testing. Includes pre-flight, browser testing, and production readiness checks.
# Checks: preflight markers, chaos markers, production layer markers,
#          plus all original test-browser and ship gate checks
source "$(dirname "$0")/_gate-runner.sh"

init_gate "production-test" "$1"

# =============================================================================
# CHECK 1: All 8 marker files exist with real data
# =============================================================================

STATUS_DIR=""
for candidate in "$TARGET_DIR/.claude-project/status"/*; do
  if [ -d "$candidate" ] && [ "$(basename "$candidate")" != "frontend" ]; then
    STATUS_DIR="$candidate"
    break
  fi
done
FRONTEND_STATUS="$TARGET_DIR/.claude-project/$PROJECT_NAME/status/frontend"

MARKER_MISSING=0
for marker in \
  "$STATUS_DIR/PREFLIGHT_STATUS.md" \
  "$STATUS_DIR/SEED_STATUS.md" \
  "$STATUS_DIR/DESIGN_QA_STATUS.md" \
  "$FRONTEND_STATUS/E2E_QA_STATUS.md" \
  "$STATUS_DIR/CHAOS_TEST_STATUS.md" \
  "$STATUS_DIR/EXPLORATION_REPORT.md" \
  "$STATUS_DIR/UX_QA_SUMMARY.md" \
  "$STATUS_DIR/PRODUCTION_LAYERS_STATUS.md"; do
  if [ ! -f "$marker" ]; then
    MARKER_MISSING=$((MARKER_MISSING + 1))
  elif grep -q "YYYY-MM-DD\|{PROJECT_NAME}\|_no runs yet_" "$marker"; then
    MARKER_MISSING=$((MARKER_MISSING + 1))
  fi
done

if [ "$MARKER_MISSING" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"all-markers-exist","pass":true,"detail":"8/8 marker files verified","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$MARKER_MISSING of 8 markers missing or template" \
    '. + [{"name":"all-markers-exist","pass":false,"detail":$d,"duration_ms":0}]')
fi

# =============================================================================
# CHECKS 2-10: Browser testing checks
# =============================================================================

# --- Frontend Build ---
FRONTEND_DIR=""
for candidate in frontend frontend-web web client app; do
  [ -d "$TARGET_DIR/$candidate" ] && FRONTEND_DIR="$TARGET_DIR/$candidate" && break
done

if [ -n "$FRONTEND_DIR" ]; then
  run_check "frontend-build" "cd '$FRONTEND_DIR' && npm run build 2>&1"
fi

# --- Backend Unit Tests (regression) ---
BACKEND_DIR="$TARGET_DIR/backend"
if [ -d "$BACKEND_DIR" ] && [ -f "$BACKEND_DIR/package.json" ]; then
  if grep -q '"selectProjects"' "$BACKEND_DIR/jest.config.ts" 2>/dev/null || \
     grep -q '"selectProjects"' "$BACKEND_DIR/jest.config.js" 2>/dev/null || \
     grep -q 'projects' "$BACKEND_DIR/jest.config.ts" 2>/dev/null; then
    run_check "unit-tests-regression" "cd '$BACKEND_DIR' && npx jest --selectProjects unit --forceExit 2>&1"
  elif grep -q '"test"' "$BACKEND_DIR/package.json" 2>/dev/null; then
    run_check "unit-tests-regression" "cd '$BACKEND_DIR' && npm test -- --forceExit 2>&1"
  fi
fi

# --- Routes YAML exists ---
file_exists_check "routes-yaml" "$TARGET_DIR/.claude-project/routes.yaml"

# --- User stories exist ---
run_count_check "user-story-files" \
  "find '$TARGET_DIR/.claude-project/user_stories' -name '*.yaml' 2>/dev/null | wc -l" \
  ">=" 1

# --- E2E directory detection ---
E2E_DIR=""
for candidate in "$TARGET_DIR/e2e" "$FRONTEND_DIR/e2e" "$TARGET_DIR/tests/e2e"; do
  [ -d "$candidate" ] && E2E_DIR="$candidate" && break
done

if [ -n "$E2E_DIR" ]; then
  # story-spec-coverage
  STORY_COUNT=$(find "$TARGET_DIR/.claude-project/user_stories" -name '*.yaml' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$STORY_COUNT" -gt 0 ]; then
    SPEC_COUNT=$(find "$E2E_DIR" -name '*.spec.ts' -o -name '*.spec.js' 2>/dev/null | wc -l | tr -d ' ')
    THRESHOLD=$(( STORY_COUNT * 80 / 100 ))
    [ "$THRESHOLD" -lt 1 ] && THRESHOLD=1
    if [ "$SPEC_COUNT" -ge "$THRESHOLD" ]; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SPEC_COUNT spec files / $STORY_COUNT story files (>= 80% required)" \
        '. + [{"name":"story-spec-coverage","pass":true,"detail":$d,"duration_ms":0}]')
    else
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SPEC_COUNT spec files found, need $THRESHOLD ($STORY_COUNT stories × 80%)" \
        '. + [{"name":"story-spec-coverage","pass":false,"detail":$d,"duration_ms":0}]')
    fi
  fi

  # no-.or()-in-smoke-tests
  SMOKE_OR_COUNT=0
  for f in $(grep -rl '\.or(' "$E2E_DIR" --include='*.spec.ts' 2>/dev/null); do
    if grep -q 'smoke\|tier-1\|tier.1\|Smoke' "$f" 2>/dev/null; then
      MIXED=$(grep '\.or(' "$f" 2>/dev/null | grep -i 'fail\|error\|not found\|denied\|forbidden' | wc -l)
      SMOKE_OR_COUNT=$((SMOKE_OR_COUNT + MIXED))
    fi
  done
  if [ "$SMOKE_OR_COUNT" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-or-in-smoke-tests","pass":true,"detail":"smoke tests assert success states only","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SMOKE_OR_COUNT .or(error/fail) patterns in smoke tests" \
      '. + [{"name":"no-or-in-smoke-tests","pass":false,"detail":$d,"duration_ms":0}]')
  fi

  # no-silent-pass-pattern
  SILENT_PASS=$(grep -rn '\.catch.*=>.*false\|\.catch.*=>.*{})' "$E2E_DIR" --include='*.spec.ts' 2>/dev/null | wc -l)
  if [ "$SILENT_PASS" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-silent-pass-pattern","pass":true,"detail":"no .catch(() => false) patterns found","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SILENT_PASS .catch(() => false) silent-pass patterns found" \
      '. + [{"name":"no-silent-pass-pattern","pass":false,"detail":$d,"duration_ms":0}]')
  fi

  # test-cleanup-exists
  SPEC_COUNT=$(find "$E2E_DIR" -name '*.spec.ts' 2>/dev/null | wc -l)
  CLEANUP_COUNT=$(grep -rl 'afterAll\|afterEach' "$E2E_DIR" --include='*.spec.ts' 2>/dev/null | wc -l)
  if [ "$SPEC_COUNT" -gt 0 ] && [ "$CLEANUP_COUNT" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "0/$SPEC_COUNT spec files have cleanup hooks" \
      '. + [{"name":"test-cleanup-exists","pass":false,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$CLEANUP_COUNT/$SPEC_COUNT spec files have cleanup hooks" \
      '. + [{"name":"test-cleanup-exists","pass":true,"detail":$d,"duration_ms":0}]')
  fi
fi

# --- no-hardcoded-baseurl ---
PW_CONFIG="$TARGET_DIR/playwright.config.ts"
if [ -f "$PW_CONFIG" ]; then
  HARDCODED_BASE=$(grep -n "baseURL.*['\"]http://localhost" "$PW_CONFIG" 2>/dev/null | grep -v 'process.env\|import.meta' | wc -l)
  if [ "$HARDCODED_BASE" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-hardcoded-baseurl","pass":true,"detail":"baseURL uses env var","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "playwright.config.ts has hardcoded localhost baseURL" \
      '. + [{"name":"no-hardcoded-baseurl","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# =============================================================================
# CHECKS 11-18: Ship gate checks (production config)
# =============================================================================

# --- Backend production build ---
if [ -d "$BACKEND_DIR" ] && [ -f "$BACKEND_DIR/package.json" ]; then
  if grep -q '"build"' "$BACKEND_DIR/package.json" 2>/dev/null; then
    run_check "backend-build" "cd '$BACKEND_DIR' && npm run build 2>&1"
  fi
fi

# --- .env.example exists ---
file_exists_check "backend-env-example" "$BACKEND_DIR/.env.example"

# --- No .env files committed ---
if command -v git &>/dev/null && [ -d "$TARGET_DIR/.git" ]; then
  ENV_TRACKED=$(cd "$TARGET_DIR" && git ls-files '*.env' '.env.*' 2>/dev/null | grep -v '.env.example' | wc -l)
  if [ "$ENV_TRACKED" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-env-committed","pass":true,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$ENV_TRACKED .env files tracked in git" \
      '. + [{"name":"no-env-committed","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# --- No console.log in production code ---
CONSOLE_LOGS=$(grep -rn 'console\.log' "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null | grep -v 'node_modules\|\.spec\.\|\.test\.' | wc -l)
if [ "$CONSOLE_LOGS" -le 3 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$CONSOLE_LOGS console.log statements (threshold: 3)" \
    '. + [{"name":"no-console-logs","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$CONSOLE_LOGS console.log statements (threshold: 3)" \
    '. + [{"name":"no-console-logs","pass":false,"detail":$d,"duration_ms":0}]')
fi

# --- No weak/default secrets ---
WEAK_SECRETS=0
for secret_file in "$TARGET_DIR/docker-compose.yml" "$TARGET_DIR/docker-compose.prod.yml" "$BACKEND_DIR/.env.example"; do
  if [ -f "$secret_file" ]; then
    WEAK=$(grep -iE 'SECRET=.*dev-|SECRET=.*change|SECRET=.*example|SECRET=.*replace|SECRET=.*your-' "$secret_file" 2>/dev/null | wc -l)
    WEAK_SECRETS=$((WEAK_SECRETS + WEAK))
  fi
done
if [ "$WEAK_SECRETS" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-weak-secrets","pass":true,"detail":"no dev/example secrets found","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$WEAK_SECRETS weak/default secrets found" \
    '. + [{"name":"no-weak-secrets","pass":false,"detail":$d,"duration_ms":0}]')
fi

# --- .env.example completeness ---
if [ -f "$BACKEND_DIR/.env.example" ] && [ -d "$BACKEND_DIR/src" ]; then
  CODE_ENV_KEYS=$(grep -roh 'process\.env\.\([A-Z_]*\)' "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null | \
    sed 's/process\.env\.//' | sort -u)
  MISSING_KEYS=0
  for key in $CODE_ENV_KEYS; do
    if ! grep -q "$key" "$BACKEND_DIR/.env.example" 2>/dev/null; then
      MISSING_KEYS=$((MISSING_KEYS + 1))
    fi
  done
  if [ "$MISSING_KEYS" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"env-example-complete","pass":true,"detail":"all code env vars in .env.example","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$MISSING_KEYS env vars missing from .env.example" \
      '. + [{"name":"env-example-complete","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# =============================================================================
# CHECKS 19-21: New production-test specific checks
# =============================================================================

# --- UX scanner health ---
UX_SUMMARY=$(find "$TARGET_DIR/.claude-project/status" -name 'UX_QA_SUMMARY.md' 2>/dev/null | head -1)
if [ -n "$UX_SUMMARY" ] && [ -f "$UX_SUMMARY" ]; then
  UX_P0=$(grep -oP 'P0.*?\|\s*(\d+)' "$UX_SUMMARY" 2>/dev/null | grep -oP '\d+$' | head -1)
  UX_P0=${UX_P0:-0}
  if [ "$UX_P0" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "UX scanner P0=$UX_P0" \
      '. + [{"name":"ux-scanner-health","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "UX scanner P0=$UX_P0 (must be 0)" \
      '. + [{"name":"ux-scanner-health","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# --- Chaos test: no P0 crashes ---
CHAOS_STATUS=$(find "$TARGET_DIR/.claude-project/status" -name 'CHAOS_TEST_STATUS.md' 2>/dev/null | head -1)
if [ -n "$CHAOS_STATUS" ] && [ -f "$CHAOS_STATUS" ]; then
  CHAOS_FAIL=$(grep -c 'FAIL' "$CHAOS_STATUS" 2>/dev/null)
  CHAOS_FAIL=${CHAOS_FAIL:-0}
  if [ "$CHAOS_FAIL" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"chaos-resilience","pass":true,"detail":"all chaos scenarios passed","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$CHAOS_FAIL chaos scenario failures" \
      '. + [{"name":"chaos-resilience","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# --- Security: no dangerouslySetInnerHTML without justification ---
if [ -n "$FRONTEND_DIR" ] && [ -d "$FRONTEND_DIR/src" ]; then
  DANGEROUS_HTML=$(grep -rn 'dangerouslySetInnerHTML\|\.innerHTML\s*=' "$FRONTEND_DIR/src" --include='*.tsx' --include='*.ts' 2>/dev/null | wc -l)
  if [ "$DANGEROUS_HTML" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-dangerous-html","pass":true,"detail":"no innerHTML/dangerouslySetInnerHTML usage","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$DANGEROUS_HTML dangerouslySetInnerHTML/innerHTML patterns found" \
      '. + [{"name":"no-dangerous-html","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

output_results
