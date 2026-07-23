#!/bin/bash
# has-stable-testids.sh — Deterministic check: interactive elements have data-testid
# Enforces RULE-F10 (.claude/rules/phases/frontend.rules.md). Generic across React
# projects — auto-detects frontend/src/pages directory conventions.
#
# Output: JSON to stdout matching the gate-runner single-check shape:
#   { "check": "has-stable-testids", "pass": bool, "detail": "..." }
# Exit 0 on pass/skip. Non-zero only on infrastructure error.
#
# Usage: bash has-stable-testids.sh <target_dir> [threshold_pct]
#   target_dir    — project root containing frontend/
#   threshold_pct — optional, default 70 (percent of interactive elements that
#                   must carry data-testid)

TARGET_DIR="${1:-.}"
THRESHOLD="${2:-70}"

# Resolve to absolute path
TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd)" || {
  echo '{"check":"has-stable-testids","pass":true,"detail":"target dir not found — skipped"}'
  exit 0
}

# Auto-detect frontend directory (matches frontend-gate.sh conventions)
FRONTEND_DIR=""
for c in "frontend" "frontend-web" "web" "client" "app"; do
  if [ -d "$TARGET_DIR/$c" ] && [ -f "$TARGET_DIR/$c/package.json" ]; then
    FRONTEND_DIR="$TARGET_DIR/$c"
    break
  fi
done
if [ -z "$FRONTEND_DIR" ]; then
  echo '{"check":"has-stable-testids","pass":true,"detail":"no frontend dir — skipped"}'
  exit 0
fi

# Auto-detect source dir (React Router 7 app/ vs Vite/CRA src/)
SRC_DIR=""
for c in "app" "src"; do
  if [ -d "$FRONTEND_DIR/$c" ]; then
    SRC_DIR="$FRONTEND_DIR/$c"
    break
  fi
done
if [ -z "$SRC_DIR" ]; then
  echo '{"check":"has-stable-testids","pass":true,"detail":"no source dir — skipped"}'
  exit 0
fi

# Pages location — try common conventions; fall back to whole source dir
PAGES_GLOB=""
for c in "pages" "views" "routes" "screens"; do
  if [ -d "$SRC_DIR/$c" ]; then
    PAGES_GLOB="$SRC_DIR/$c"
    break
  fi
done
[ -z "$PAGES_GLOB" ] && PAGES_GLOB="$SRC_DIR"

# Count interactive elements: <button|input|textarea|select opening tags
INTERACTIVE=$(find "$PAGES_GLOB" \( -name '*.tsx' -o -name '*.jsx' \) -print0 2>/dev/null \
  | xargs -0 grep -hE '<(button|input|textarea|select)\b' 2>/dev/null \
  | wc -l | tr -d ' ')

# Count those carrying data-testid on the same opening tag
WITH_TESTID=$(find "$PAGES_GLOB" \( -name '*.tsx' -o -name '*.jsx' \) -print0 2>/dev/null \
  | xargs -0 grep -hE '<(button|input|textarea|select)[^>]*data-testid=' 2>/dev/null \
  | wc -l | tr -d ' ')

# Zero interactive elements → trivial / static project → pass
if [ "$INTERACTIVE" -eq 0 ]; then
  echo '{"check":"has-stable-testids","pass":true,"detail":"no interactive elements found — skipped"}'
  exit 0
fi

PCT=$(( WITH_TESTID * 100 / INTERACTIVE ))
if [ "$PCT" -ge "$THRESHOLD" ]; then
  printf '{"check":"has-stable-testids","pass":true,"detail":"%d/%d interactive elements have data-testid (%d%%, >=%d%% required)"}\n' \
    "$WITH_TESTID" "$INTERACTIVE" "$PCT" "$THRESHOLD"
else
  printf '{"check":"has-stable-testids","pass":false,"detail":"%d/%d interactive elements have data-testid (%d%%, need >=%d%%) — see RULE-F10"}\n' \
    "$WITH_TESTID" "$INTERACTIVE" "$PCT" "$THRESHOLD"
fi
