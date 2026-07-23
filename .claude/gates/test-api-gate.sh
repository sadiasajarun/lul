#!/bin/bash
# test-api-gate.sh — Deterministic validation for test-api phase
# Checks: smoke test pass, backend tests pass, 3/3 stability
source "$(dirname "$0")/_gate-runner.sh"

init_gate "test-api" "$1"
BACKEND_DIR="$TARGET_DIR/backend"

# --- Smoke Test Results ---
# Check that smoke test was executed and all routes passed
SMOKE_STATUS=""
for candidate in "$TARGET_DIR/.claude-project/status"/*/SMOKE_TEST_STATUS.md; do
  [ -f "$candidate" ] && SMOKE_STATUS="$candidate" && break
done

if [ -n "$SMOKE_STATUS" ]; then
  # Parse structured fields from smoke status instead of blind grep.
  # Fields: crashes: N, console_errors: N, failed_routes: [list]
  CRASHES=$(grep -m1 '^crashes:' "$SMOKE_STATUS" 2>/dev/null | sed 's/[^0-9]//g')
  CRASHES=${CRASHES:-0}
  CONSOLE_ERRORS=$(grep -m1 '^console_errors:' "$SMOKE_STATUS" 2>/dev/null | sed 's/[^0-9]//g')
  CONSOLE_ERRORS=${CONSOLE_ERRORS:-0}
  # failed_routes: [] means empty; anything else means failures
  FAILED_ROUTES=$(grep -m1 '^failed_routes:' "$SMOKE_STATUS" 2>/dev/null | sed 's/failed_routes:\s*//' | tr -d ' ')
  HAS_FAILED_ROUTES=0
  if [ -n "$FAILED_ROUTES" ] && [ "$FAILED_ROUTES" != "[]" ] && [ "$FAILED_ROUTES" != "none" ]; then
    HAS_FAILED_ROUTES=1
  fi
  TOTAL_ISSUES=$((CRASHES + HAS_FAILED_ROUTES))
  if [ "$TOTAL_ISSUES" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "smoke: 0 crashes, $CONSOLE_ERRORS console hints, no failed routes" '. + [{"name":"smoke-test-pass","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "smoke: $CRASHES crash(es), failed_routes=$FAILED_ROUTES" '. + [{"name":"smoke-test-pass","pass":false,"detail":$d,"duration_ms":0}]')
  fi
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"smoke-test-pass","pass":false,"detail":"SMOKE_TEST_STATUS.md not found — smoke test may not have run","duration_ms":0}]')
fi

# --- Backend Tests ---
if [ -d "$BACKEND_DIR" ]; then
  # Check 1: Backend test files exist
  run_count_check "backend-test-files" \
    "find '$BACKEND_DIR' -name '*.e2e-spec.ts' -o -name '*.spec.ts' 2>/dev/null | grep -v node_modules | wc -l" \
    ">=" 1

  # Check 1b (v118): test COVERAGE ratio, not just existence. The check above
  # passes on a single spec file while 30 controllers go untested — det measured
  # presence, not coverage. Require e2e specs for >= 50% of feature controllers
  # so "tests pass" actually means a meaningful share of the API was exercised.
  TB_CTRL=$(find "$BACKEND_DIR/src/modules" -name '*.controller.ts' ! -name 'app.controller.ts' 2>/dev/null | wc -l | tr -d ' ')
  TB_E2E=$(find "$BACKEND_DIR/test" -name '*.e2e-spec.ts' 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')
  if [ "$TB_CTRL" -gt 0 ]; then
    TB_NEED=$(( TB_CTRL * 50 / 100 )); [ "$TB_NEED" -lt 1 ] && TB_NEED=1
    if [ "$TB_E2E" -ge "$TB_NEED" ]; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$TB_E2E e2e specs / $TB_CTRL controllers (>= 50%)" \
        '. + [{"name":"test-coverage-ratio","pass":true,"detail":$d,"duration_ms":0}]')
    else
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$TB_E2E e2e specs / $TB_CTRL controllers (need >= $TB_NEED = 50%)" \
        '. + [{"name":"test-coverage-ratio","pass":false,"detail":$d,"duration_ms":0}]')
    fi
  fi

  # Check 2: Backend tests pass
  if [ -f "$BACKEND_DIR/package.json" ]; then
    # Check if test:e2e script exists
    if grep -q '"test:e2e"' "$BACKEND_DIR/package.json" 2>/dev/null; then
      run_check "backend-tests-pass" "cd '$BACKEND_DIR' && npm run test:e2e -- --forceExit 2>&1"
    elif grep -q '"test"' "$BACKEND_DIR/package.json" 2>/dev/null; then
      run_check "backend-tests-pass" "cd '$BACKEND_DIR' && npm test -- --forceExit 2>&1"
    fi
  fi
fi

# --- Stability Check ---
# Check 3: Test stability (run tests 3x, all must pass)
# Only run if individual test passes already confirmed
BACKEND_PASSED=$(echo "$CHECKS_JSON" | jq '[.[] | select(.name=="backend-tests-pass" and .pass==true)] | length')
if [ "$BACKEND_PASSED" -gt 0 ]; then
  STABLE=true
  for i in 1 2; do
    if [ -f "$BACKEND_DIR/package.json" ]; then
      RESULT=$(cd "$BACKEND_DIR" && npm run test:e2e -- --forceExit 2>&1; echo "EXIT:$?")
      EXIT_CODE=$(echo "$RESULT" | grep 'EXIT:' | sed 's/EXIT://')
      if [ "$EXIT_CODE" != "0" ]; then
        STABLE=false
        break
      fi
    fi
  done
  if [ "$STABLE" = true ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"stability-3x-pass","pass":true,"detail":"3/3 runs passed","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"stability-3x-pass","pass":false,"detail":"flaky: failed on repeated run","duration_ms":0}]')
  fi
fi

output_results
