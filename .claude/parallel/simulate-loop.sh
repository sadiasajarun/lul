#!/usr/bin/env bash
# simulate-loop.sh — force the fix → simulate → fix loop.
#
# The post-run RCA ledger gates the NEXT launch, but the CONTINUOUS fix→simulate
# loop happens mid-session with no launch to gate — so it relied on willpower and
# I kept stopping at "fixed + committed" instead of booting + driving to validate
# the fix AND surface the next bug. This script removes both excuses:
#   1. boot is "high-effort"  → it's now ONE command (boots backend + frontend,
#      regenerates global-setup, runs the full Playwright story suite live).
#   2. "am I done?" is a guess → the EXIT CODE answers it: 0 only when the live
#      pass-rate >= target; otherwise non-zero + a NUMBERED next-bug list. You
#      cannot declare the loop done while this is red. Run it after every fix;
#      keep cycling fix → simulate-loop.sh → fix until it exits 0 (loop-until-dry).
#
# Usage: bash .claude/parallel/simulate-loop.sh <run-cell-dir> [--target 0.95] [--no-regen]
#   <run-cell-dir> = .../runs/<tag>/run-<cell>   (has backend/ + frontend/)
set -uo pipefail

RUN="${1:?usage: simulate-loop.sh <run-cell-dir> [--target N] [--no-regen]}"
shift || true
TARGET=0.95
REGEN=1
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2;;
    --no-regen) REGEN=0; shift;;
    *) shift;;
  esac
done

BE="$RUN/backend"
FE=""
for c in frontend frontend-web web client; do
  [ -d "$RUN/$c" ] && [ -f "$RUN/$c/package.json" ] && FE="$RUN/$c" && break
done
[ -d "$BE" ] || { echo "FAIL: no backend at $BE"; exit 2; }
[ -n "$FE" ] || { echo "FAIL: no frontend dir under $RUN"; exit 2; }

BE_PORT=${BE_PORT:-3601}
BE_LOG=$(mktemp); FE_LOG=$(mktemp)
BE_PID=""; FE_PID=""
cleanup() {
  [ -n "$BE_PID" ] && kill "$BE_PID" 2>/dev/null
  [ -n "$FE_PID" ] && kill "$FE_PID" 2>/dev/null
  pkill -f "start:dev" 2>/dev/null; pkill -f "react-router dev" 2>/dev/null; pkill -f "vite" 2>/dev/null
  rm -f "$BE_LOG" "$FE_LOG"
}
trap cleanup EXIT

CLAUDE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SD=$(find "$RUN/.claude-project" -type d -name user_stories 2>/dev/null | head -1)

# ─── REGENERATE deterministic frontend artifacts FROM the pipeline BEFORE testing ───
# This is what makes the loop force PIPELINE fixes, not throwaway run-dir edits:
# re-running the scaffolds/doctors (a) reflects any scaffold/doctor/template fix so
# the test proves the PIPELINE produces a working app (→ next run works too), and
# (b) OVERWRITES any hand-edit to the run dir — so a transient "fix in the run dir"
# is wiped and the story fails again, forcing the fix into the scaffold. The dev
# server serves these regenerated sources, so regenerate BEFORE booting.
if [ "$REGEN" = 1 ]; then
  echo "[simulate-loop] regenerating frontend artifacts from the pipeline (scaffold-restorer + ensure-deps + global-setup) ..."
  node "$CLAUDE_DIR/v2/scripts/scaffold-restorer.js" --target "$FE" --phase frontend \
    --backend-dir "$BE" --claude-dir "$CLAUDE_DIR" >/dev/null 2>&1 || true
  # ensure-deps-installed is import-aware (v122): it installs any third-party package
  # imported by app/ source but not declared/installed in frontend/node_modules — in
  # the CORRECT cwd. v121 P0 was an undeclared @radix-ui/react-dropdown-menu that
  # hoist-resolved at build time but 500'd every page at SSR. Running it here makes
  # the loop faithful to the pipeline so this dep class can't slip past simulate-loop.
  node "$CLAUDE_DIR/v2/scripts/scaffold-ensure-deps-installed.js" --target "$FE" >/dev/null 2>&1 || true
  # route-prefix doctor (v122): reconcile /admin, /company role-group prefixes with
  # story ui_routes so authenticated routes don't 404. Idempotent — no-op if already
  # pathed. Keeps the loop faithful to the pipeline's route-fixing.
  [ -n "$SD" ] && node "$CLAUDE_DIR/v2/scripts/scaffold-route-prefix-doctor.js" --target "$FE" --stories-dir "$SD" >/dev/null 2>&1 || true
  # auth-bootstrap (v122): hydrate auth from /auth/me on load + numeric-role/isLoading
  # guard fix, so protected routes don't redirect. Idempotent. Runs LAST so it wins
  # over any restorer regeneration. Keeps the loop faithful to the pipeline.
  node "$CLAUDE_DIR/v2/scripts/scaffold-auth-bootstrap.js" --target "$FE" >/dev/null 2>&1 || true
  # final route-cleanup (v123): restorer above can reintroduce a duplicate route id /
  # dangling ref → the dev server won't boot (RR7 resolves route ids at config load).
  # prune (deterministic ids) then dedupe (component + explicit-id) — mirrors the
  # pre-build blueprint node so the loop's artifact boots like the pipeline's.
  node "$CLAUDE_DIR/v2/scripts/scaffold-routes-prune.js" --target "$FE" >/dev/null 2>&1 || true
  node "$CLAUDE_DIR/v2/scripts/scaffold-routes-dedupe.js" --target "$FE" >/dev/null 2>&1 || true
  if [ -n "$SD" ] && [ -f "$SD/_fixtures.yaml" ]; then
    # delete global-setup + playwright.config so scaffold-story-specs regenerates
    # them from the (fixed) scaffold — picks up config/global-setup changes too.
    rm -f "$FE/tests/global-setup.ts" "$FE/playwright.config.ts"
    node "$CLAUDE_DIR/v2/scripts/scaffold-story-specs.js" --stories-dir "$SD" --fixtures "$SD/_fixtures.yaml" --target "$FE" >/dev/null 2>&1 || true
  fi
fi

echo "[simulate-loop] booting backend ($BE_PORT) + frontend dev ..."
( cd "$BE" && PORT="$BE_PORT" npm run start:dev >"$BE_LOG" 2>&1 & echo $! >/tmp/.sim-be.pid )
( cd "$FE" && VITE_API_URL="http://localhost:$BE_PORT/api" npm run dev >"$FE_LOG" 2>&1 & echo $! >/tmp/.sim-fe.pid )
BE_PID=$(cat /tmp/.sim-be.pid 2>/dev/null); FE_PID=$(cat /tmp/.sim-fe.pid 2>/dev/null)

# wait for backend health + frontend port (up to ~40s)
FE_PORT=""
for i in $(seq 1 20); do
  sleep 2
  H=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$BE_PORT/api/health" 2>/dev/null)
  [ -z "$FE_PORT" ] && FE_PORT=$(grep -oE 'localhost:[0-9]+' "$FE_LOG" 2>/dev/null | head -1 | cut -d: -f2)
  [ "$H" = "200" ] && [ -n "$FE_PORT" ] && break
done
[ "$H" = "200" ] || { echo "FAIL: backend not healthy on :$BE_PORT (HTTP $H)"; tail -5 "$BE_LOG"; exit 3; }
[ -n "$FE_PORT" ] || { echo "FAIL: frontend dev server never reported a port"; tail -5 "$FE_LOG"; exit 3; }

# LOGIN-READINESS gate (v123): /health=200 does NOT mean the DB is seeded + auth works.
# If global-setup runs before the (frozen) backend finishes migrate/seed, all 7 logins
# fail → no storageState → the WHOLE suite errors → a FALSE ~5% pass-rate with an empty
# next-bug list (a measurement mirage). So block until a real fixture login returns 200.
if [ -n "$SD" ] && [ -f "$SD/_fixtures.yaml" ]; then
  CRED_EMAIL=$(grep -oE "email:[[:space:]]*[^[:space:]]+@[^[:space:]]+" "$SD/_fixtures.yaml" | head -1 | sed -E 's/email:[[:space:]]*//')
  CRED_PASS=$(grep -A2 "email:[[:space:]]*$CRED_EMAIL" "$SD/_fixtures.yaml" | grep -oE "password:[[:space:]]*[^[:space:]]+" | head -1 | sed -E 's/password:[[:space:]]*//')
  if [ -n "$CRED_EMAIL" ] && [ -n "$CRED_PASS" ]; then
    LOGIN_OK=""
    for i in $(seq 1 20); do
      LC=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$BE_PORT/api/auth/login" \
        -H 'Content-Type: application/json' -d "{\"email\":\"$CRED_EMAIL\",\"password\":\"$CRED_PASS\"}" 2>/dev/null)
      [ "$LC" = "200" ] || [ "$LC" = "201" ] && { LOGIN_OK=1; break; }
      sleep 3
    done
    [ -n "$LOGIN_OK" ] || { echo "FAIL: backend up but login ($CRED_EMAIL) never succeeded (last HTTP $LC) — DB not seeded? Suite would false-fail."; tail -8 "$BE_LOG"; exit 3; }
    echo "[simulate-loop] login-readiness OK ($CRED_EMAIL → $LC)"
  fi
fi
echo "[simulate-loop] backend health 200, frontend on :$FE_PORT"

# Ensure Playwright is installed. A run that hard-failed BEFORE test-browser (e.g.
# at the frontend build) never installed @playwright/test → the suite finds 0 tests
# (ERR_MODULE_NOT_FOUND on the config) and reports a misleading 0/0. Install on demand.
if [ ! -d "$FE/node_modules/@playwright/test" ]; then
  echo "[simulate-loop] @playwright/test missing (run didn't reach test-browser) — installing ..."
  ( cd "$FE" && npm install -D @playwright/test --legacy-peer-deps --no-audit --no-fund >/dev/null 2>&1 || true )
  ( cd "$FE" && npx playwright install chromium >/dev/null 2>&1 || true )
fi

echo "[simulate-loop] running story suite live ..."
RES=$(mktemp)
# CRITICAL: write the JSON report to a FILE via PLAYWRIGHT_JSON_OUTPUT_NAME, NOT by
# redirecting stdout. global-setup.ts logs progress ("✓ storageState-N.json …") to
# stdout; with `--reporter=json >FILE` those lines PREPEND the JSON → `jq` parse error
# → a FALSE 0/0 that looks like "no tests ran" when 147 actually passed/failed. The
# env var routes pure JSON to the file regardless of stdout noise.
( cd "$FE" && BASE_URL="http://localhost:$FE_PORT" API_URL="http://localhost:$BE_PORT/api" \
    FSP_FIXTURES_PATH="${SD:+$SD/_fixtures.yaml}" \
    PLAYWRIGHT_JSON_OUTPUT_NAME="$RES" npx playwright test tests/stories --reporter=json >/dev/null 2>&1 ) || true

# JSON reporter → deterministic counts + the FAILING spec titles (status != expected)
PASS=$(jq -r '.stats.expected // 0' "$RES" 2>/dev/null); PASS=${PASS:-0}
FAILN=$(jq -r '(.stats.unexpected // 0)' "$RES" 2>/dev/null); FAILN=${FAILN:-0}
TOT=$((PASS + FAILN))
RATE=$(awk "BEGIN{ if($TOT>0) printf \"%.3f\", $PASS/$TOT; else print \"0\" }")

echo ""
echo "============================================================"
echo "  LIVE story pass-rate: $PASS/$TOT = $RATE  (target $TARGET)"
echo "============================================================"
if [ "$FAILN" -gt 0 ]; then
  echo "  NEXT-BUG LIST (failing ACs — reproduce each LIVE, don't guess):"
  jq -r '[.. | objects | select(has("ok") and .ok==false and has("title")) | .title] | unique[]' "$RES" 2>/dev/null \
    | grep -vE '^$' | head -40 | nl -w3 -s'. '
fi
rm -f "$RES"

# exit code = the "are we done?" gate
awk "BEGIN{ exit !($RATE >= $TARGET) }"
if [ $? -eq 0 ]; then
  echo "[simulate-loop] ✅ pass-rate >= target — loop can stop."
  exit 0
else
  echo "[simulate-loop] ❌ below target — loop NOT done. Fix a next-bug above, re-run simulate-loop.sh."
  exit 1
fi
