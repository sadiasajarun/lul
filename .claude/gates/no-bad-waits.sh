#!/bin/bash
# no-bad-waits.sh — Deterministic check: no SPA-unsafe wait patterns in Playwright specs
# Enforces the Wait Pattern Anti-Patterns section of
# .claude/react/skills/e2e-testing/SKILL.md. Generic across React projects.
#
# Output: JSON to stdout matching the gate-runner single-check shape.
# Exit 0 on pass/skip.
#
# Usage: bash no-bad-waits.sh <target_dir>
#
# Allowed legitimate uses (do NOT flag):
#   1. Files where 'load' appears alongside a 'networkidle' wait — this is the
#      documented fallback pattern: try networkidle first, fall back to load on
#      timeout. The gate treats co-occurrence as evidence of a fallback.
#   2. Lines carrying the inline opt-out comment:
#        await page.waitForLoadState('load'); // no-bad-waits: ok
#      Use this when a single spec genuinely needs 'load' (e.g., a non-SPA page).

TARGET_DIR="${1:-.}"

TARGET_DIR="$(cd "$TARGET_DIR" 2>/dev/null && pwd)" || {
  echo '{"check":"no-bad-waits","pass":true,"detail":"target dir not found — skipped"}'
  exit 0
}

FRONTEND_DIR=""
for c in "frontend" "frontend-web" "web" "client"; do
  if [ -d "$TARGET_DIR/$c" ] && [ -f "$TARGET_DIR/$c/package.json" ]; then
    FRONTEND_DIR="$TARGET_DIR/$c"
    break
  fi
done
if [ -z "$FRONTEND_DIR" ]; then
  echo '{"check":"no-bad-waits","pass":true,"detail":"no frontend dir — skipped"}'
  exit 0
fi

TESTS_DIR=""
for c in "tests" "e2e" "playwright" "__tests__"; do
  if [ -d "$FRONTEND_DIR/$c" ]; then
    TESTS_DIR="$FRONTEND_DIR/$c"
    break
  fi
done
if [ -z "$TESTS_DIR" ]; then
  echo '{"check":"no-bad-waits","pass":true,"detail":"no tests dir — skipped (test phase may not have run yet)"}'
  exit 0
fi

# Step 1: collect every file that contains waitForLoadState('load')
CANDIDATES=$(grep -rlE "waitForLoadState\s*\(\s*['\"]load['\"]" "$TESTS_DIR" \
  --include='*.ts' --include='*.tsx' --include='*.js' 2>/dev/null)

# Step 2: per file, count "bad" occurrences after applying allow-list rules.
#   - Skip lines carrying `// no-bad-waits: ok`
#   - If the file ALSO uses 'networkidle' anywhere, treat the 'load' usage as a
#     legitimate fallback and skip the whole file from the violation count.
HITS=0
BAD_FILES=""
ALLOWED_FALLBACK=0
for f in $CANDIDATES; do
  if grep -qE "waitForLoadState\s*\(\s*['\"]networkidle['\"]" "$f"; then
    ALLOWED_FALLBACK=$((ALLOWED_FALLBACK + 1))
    continue
  fi
  FILE_HITS=$(grep -nE "waitForLoadState\s*\(\s*['\"]load['\"]" "$f" \
    | grep -vE "no-bad-waits:\s*ok" \
    | wc -l | tr -d ' ')
  if [ "$FILE_HITS" -gt 0 ]; then
    HITS=$((HITS + FILE_HITS))
    BAD_FILES="$BAD_FILES,$(basename "$f")"
  fi
done

if [ "$HITS" -eq 0 ]; then
  if [ "$ALLOWED_FALLBACK" -gt 0 ]; then
    printf '{"check":"no-bad-waits","pass":true,"detail":"no offending usages (%d file(s) use load as a documented fallback after networkidle — allowed)"}\n' \
      "$ALLOWED_FALLBACK"
  else
    echo '{"check":"no-bad-waits","pass":true,"detail":"no waitForLoadState(\"load\") usages found"}'
  fi
  exit 0
fi

BAD_FILES_STR=$(echo "$BAD_FILES" | sed 's/^,//' | cut -c1-200)
printf '{"check":"no-bad-waits","pass":false,"detail":"%d offending occurrence(s) of waitForLoadState(\\"load\\") in %s — never fires in SPAs; use waitForSelector or networkidle (see e2e-testing/SKILL.md). Suppress legitimate cases with: // no-bad-waits: ok"}\n' \
  "$HITS" "$BAD_FILES_STR"
