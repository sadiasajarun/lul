#!/bin/bash
# test-browser-gate.sh — Deterministic validation for the test-browser phase.
# Generic across React + Playwright projects. Auto-detects frontend dir, tests dir,
# spec subfolders, marker file location, and Playwright config extension.
#
# Checks:
#   1. playwright-config-exists  — playwright.config.{ts,mts,js,mjs} present
#   2. specs-exist               — at least 1 .spec.{ts,tsx,js} file authored
#   3. no-bad-waits              — invokes ./no-bad-waits.sh (RULE-T0)
#   4. no-hardcoded-baseurl      — no hardcoded localhost / 127.0.0.1 / IP:port in specs (RULE-T4)
#   5. story-spec-coverage       — Playwright spec count >= 80% of user-story YAMLs (RULE-T8)
#   6. test-cleanup-exists       — at least 1 spec uses afterAll/afterEach (RULE-T5)
#   7. no-or-in-smoke-tests      — no `.or(` chains in smoke/happy-path specs (RULE-T1)
#   8. no-silent-pass-pattern    — no `.catch(() => false)` followed by `if` (RULE-T2)
#   9. global-setup-exists       — global-setup file created for storageState (RULE-T11)
#  10. marker-files              — Phase 9 status markers present (only when test phase ran)
#
# Output: gate-runner JSON. Exit 0 on success, non-zero on infrastructure error.

source "$(dirname "$0")/_gate-runner.sh"

init_gate "test-browser" "$1"

# ---- Auto-detect frontend directory ----
FRONTEND_DIR=""
for c in "frontend" "frontend-web" "web" "client"; do
  if [ -d "$TARGET_DIR/$c" ] && [ -f "$TARGET_DIR/$c/package.json" ]; then
    FRONTEND_DIR="$TARGET_DIR/$c"
    break
  fi
done

if [ -z "$FRONTEND_DIR" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"frontend-exists","pass":false,"detail":"no frontend dir found","duration_ms":0}]')
  output_results
  exit 0
fi

# ---- Check 1: playwright config ----
PW_CONFIG=""
for ext in "ts" "mts" "js" "mjs"; do
  if [ -f "$FRONTEND_DIR/playwright.config.$ext" ]; then
    PW_CONFIG="$FRONTEND_DIR/playwright.config.$ext"
    break
  fi
done
if [ -n "$PW_CONFIG" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg p "$(basename "$PW_CONFIG")" \
    '. + [{"name":"playwright-config-exists","pass":true,"detail":$p,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"playwright-config-exists","pass":false,"detail":"no playwright.config.{ts,mts,js,mjs} found","duration_ms":0}]')
fi

# ---- Auto-detect tests directory ----
TESTS_DIR=""
for c in "tests" "e2e" "playwright" "__tests__"; do
  if [ -d "$FRONTEND_DIR/$c" ]; then
    TESTS_DIR="$FRONTEND_DIR/$c"
    break
  fi
done

# ---- Check 2: specs exist ----
if [ -n "$TESTS_DIR" ]; then
  SPEC_COUNT=$(find "$TESTS_DIR" \( -name '*.spec.ts' -o -name '*.spec.tsx' -o -name '*.spec.js' \) 2>/dev/null \
    | wc -l | tr -d ' ')
  if [ "$SPEC_COUNT" -ge 1 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg c "$SPEC_COUNT spec file(s)" \
      '. + [{"name":"specs-exist","pass":true,"detail":$c,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"specs-exist","pass":false,"detail":"0 spec files in tests dir","duration_ms":0}]')
  fi
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"specs-exist","pass":false,"detail":"no tests/e2e/playwright dir found in frontend/","duration_ms":0}]')
fi

# ---- Check 3: no-bad-waits (delegate to standalone script) ----
NBW_JSON=$(bash "$(dirname "$0")/no-bad-waits.sh" "$TARGET_DIR" 2>/dev/null)
if [ -n "$NBW_JSON" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    --argjson c "$(echo "$NBW_JSON" | jq '{name:"no-bad-waits", pass:.pass, detail:.detail, duration_ms:0}')" \
    '. + [$c]')
fi

# ---- Check 4: no hardcoded baseURL (RULE-T4) ----
if [ -n "$TESTS_DIR" ]; then
  # Match http://host:port and ws://host:port. Exclude lines that read from process.env / import.meta.env
  # Search inside spec files only (config files are allowed to set defaults).
  HARDCODED=$(grep -rnE "(https?|wss?)://(localhost|127\.0\.0\.1|0\.0\.0\.0)(:[0-9]+)?" "$TESTS_DIR" \
    --include='*.spec.ts' --include='*.spec.tsx' --include='*.spec.js' 2>/dev/null \
    | grep -v "process\.env" | grep -v "import\.meta\.env" \
    | wc -l | tr -d ' ')
  if [ "$HARDCODED" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"no-hardcoded-baseurl","pass":true,"detail":"no hardcoded URLs in spec files","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg c "$HARDCODED hardcoded URL(s) in specs — use baseURL from playwright.config" \
      '. + [{"name":"no-hardcoded-baseurl","pass":false,"detail":$c,"duration_ms":0}]')
  fi
fi

# ---- Check 5: story-spec coverage (RULE-T8) — 80% threshold ----
USER_STORIES_DIR="$TARGET_DIR/.claude-project/user_stories"
if [ -d "$USER_STORIES_DIR" ] && [ -n "$TESTS_DIR" ]; then
  # Count YAML stories excluding underscore-prefixed (fixtures, global-patterns, etc.)
  STORY_COUNT=$(find "$USER_STORIES_DIR" -maxdepth 1 -name '*.yaml' -not -name '_*' 2>/dev/null \
    | wc -l | tr -d ' ')
  # Acceptance specs preferred location; fall back to tests root
  ACCEPTANCE_DIR=""
  for c in "acceptance" "stories" "user-stories"; do
    [ -d "$TESTS_DIR/$c" ] && ACCEPTANCE_DIR="$TESTS_DIR/$c" && break
  done
  [ -z "$ACCEPTANCE_DIR" ] && ACCEPTANCE_DIR="$TESTS_DIR"
  ACC_SPEC_COUNT=$(find "$ACCEPTANCE_DIR" -maxdepth 2 -name '*.spec.ts' 2>/dev/null \
    | wc -l | tr -d ' ')
  if [ "$STORY_COUNT" -gt 0 ]; then
    THRESHOLD=$(( STORY_COUNT * 80 / 100 ))
    [ "$THRESHOLD" -lt 1 ] && THRESHOLD=1
    if [ "$ACC_SPEC_COUNT" -ge "$THRESHOLD" ]; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg c "$ACC_SPEC_COUNT specs / $STORY_COUNT stories (>= 80% required)" \
        '. + [{"name":"story-spec-coverage","pass":true,"detail":$c,"duration_ms":0}]')
    else
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg c "$ACC_SPEC_COUNT specs / $STORY_COUNT stories (need >= $THRESHOLD)" \
        '. + [{"name":"story-spec-coverage","pass":false,"detail":$c,"duration_ms":0}]')
    fi
  fi
fi

# ---- Check 6: test cleanup exists (RULE-T5) ----
if [ -n "$TESTS_DIR" ]; then
  CLEANUP=$(grep -rlE "afterAll|afterEach" "$TESTS_DIR" --include='*.spec.ts' --include='*.spec.tsx' 2>/dev/null \
    | wc -l | tr -d ' ')
  if [ "$CLEANUP" -ge 1 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg c "$CLEANUP file(s) with afterAll/afterEach" \
      '. + [{"name":"test-cleanup-exists","pass":true,"detail":$c,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"test-cleanup-exists","pass":false,"detail":"no afterAll/afterEach found in any spec","duration_ms":0}]')
  fi
fi

# ---- Check 7: no .or() in smoke tests (RULE-T1) ----
# Look in any spec under a smoke/ subfolder, or spec files matching *smoke*.
if [ -n "$TESTS_DIR" ]; then
  SMOKE_HITS=$(find "$TESTS_DIR" \( -path '*/smoke/*' -o -name '*smoke*.spec.ts' -o -name '*smoke*.spec.tsx' \) -print0 2>/dev/null \
    | xargs -0 grep -hE "\.or\s*\(" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$SMOKE_HITS" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"no-or-in-smoke-tests","pass":true,"detail":"no .or() chains in smoke tests","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg c "$SMOKE_HITS .or() chain(s) found in smoke specs — silent pass risk" \
      '. + [{"name":"no-or-in-smoke-tests","pass":false,"detail":$c,"duration_ms":0}]')
  fi
fi

# ---- Check 8: no silent-pass pattern (RULE-T2) ----
# Detect `.catch(() => false)` whose result is then used in an `if` within a few lines.
# Heuristic: count files with both patterns.
if [ -n "$TESTS_DIR" ]; then
  SILENT=$(grep -rlE "\.catch\s*\(\s*\(\s*\)\s*=>\s*false\s*\)" "$TESTS_DIR" \
    --include='*.spec.ts' --include='*.spec.tsx' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$SILENT" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"no-silent-pass-pattern","pass":true,"detail":"no .catch(() => false) silent-pass patterns","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg c "$SILENT file(s) use .catch(() => false) — silent pass risk (RULE-T2)" \
      '. + [{"name":"no-silent-pass-pattern","pass":false,"detail":$c,"duration_ms":0}]')
  fi
fi

# ---- Check 9: global-setup exists (RULE-T11) ----
if [ -n "$TESTS_DIR" ]; then
  GS=""
  for c in "global-setup.ts" "global-setup.js" "globalSetup.ts" "globalSetup.js"; do
    if find "$TESTS_DIR" -maxdepth 3 -name "$c" 2>/dev/null | head -1 | grep -q .; then
      GS="$c"
      break
    fi
  done
  if [ -n "$GS" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg c "$GS present" \
      '. + [{"name":"global-setup-exists","pass":true,"detail":$c,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"global-setup-exists","pass":false,"detail":"no global-setup file — storageState bootstrap missing (RULE-T11)","duration_ms":0}]')
  fi
fi

# ---- Check 10: marker files (only when test-browser phase has executed) ----
# Look for any project status directory under .claude-project/status/
STATUS_DIR=""
for d in "$TARGET_DIR"/.claude-project/*/status/; do
  [ -d "$d" ] && STATUS_DIR="$d" && break
done
if [ -n "$STATUS_DIR" ]; then
  MARKERS=("PREFLIGHT_STATUS.md" "SEED_STATUS.md" "DESIGN_QA_STATUS.md" \
           "E2E_QA_STATUS.md" "CHAOS_TEST_STATUS.md" "EXPLORATION_REPORT.md" \
           "UX_QA_SUMMARY.md" "PRODUCTION_LAYERS_STATUS.md")
  PRESENT=0
  for m in "${MARKERS[@]}"; do
    [ -f "${STATUS_DIR}${m}" ] && PRESENT=$((PRESENT + 1))
  done
  if [ "$PRESENT" -ge 6 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg c "$PRESENT/8 marker files present" \
      '. + [{"name":"marker-files","pass":true,"detail":$c,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg c "$PRESENT/8 marker files present (need >= 6)" \
      '. + [{"name":"marker-files","pass":false,"detail":$c,"duration_ms":0}]')
  fi
fi

# ---- Check 11 (v118, hardened v128): ACTUAL story pass-rate from the per-story
# TABLE — NOT the LLM-authored header. v127 evidence: a STORY_QA_REPORT header
# claimed `stories_passed: 28 / pass_rate: 1.00` while its OWN table showed 3
# PASS / 25 FAIL; trusting the header reports green over a red run (gate-design
# anti-pattern: claimed-not-correctness). v127 also wrote ONE report per frontend
# (STORY_QA_REPORT_<frontend>.md), which the old single-file lookup missed
# entirely. Fix: enumerate EVERY STORY_QA_REPORT*.md, count `| PASS |` rows vs
# all status rows (PASS|FAIL|CRASH|SKIP) in the table, aggregate, gate >= 80%.
S_PASS=0; S_TOTAL=0; QA_FILES=0; HDR_GAMING=""
for d in "$TARGET_DIR"/.claude-project/*/status/ "$TARGET_DIR"/.claude-project/status/*/ "$TARGET_DIR"/.claude-project/status/; do
  [ -d "$d" ] || continue
  for f in "$d"STORY_QA_REPORT*.md; do
    [ -f "$f" ] || continue
    QA_FILES=$((QA_FILES+1))
    fp=$(grep -cE '\| PASS \|' "$f" 2>/dev/null); fp=${fp:-0}
    ft=$(grep -cE '\| (PASS|FAIL|CRASH|SKIP) \|' "$f" 2>/dev/null); ft=${ft:-0}
    # Surface header-vs-table gaming (header pass count != real table PASS count)
    hdr=$(grep -m1 '^stories_passed:' "$f" 2>/dev/null | sed 's/[^0-9]//g'); hdr=${hdr:-}
    if [ "$ft" -gt 0 ] && [ -n "$hdr" ] && [ "$hdr" != "$fp" ]; then
      HDR_GAMING="$HDR_GAMING $(basename "$f")[header=$hdr,table=$fp]"
    fi
    S_PASS=$((S_PASS+fp)); S_TOTAL=$((S_TOTAL+ft))
  done
done
if [ "$QA_FILES" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"story-pass-rate","pass":false,"detail":"no STORY_QA_REPORT*.md found — acceptance stories did not run; cannot claim green without execution evidence","duration_ms":0}]')
elif [ "$S_TOTAL" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"story-pass-rate","pass":false,"detail":"STORY_QA_REPORT*.md found but contain ZERO story-table rows (PASS/FAIL/CRASH/SKIP) — header-only report, no executed-story evidence","duration_ms":0}]')
else
  SPCT=$(( S_PASS * 100 / S_TOTAL ))
  GAMING_NOTE=""
  [ -n "$HDR_GAMING" ] && GAMING_NOTE=" [header≠table gaming detected:$HDR_GAMING — gated on table]"
  if [ "$SPCT" -ge 80 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg c "$S_PASS/$S_TOTAL stories passed by TABLE across $QA_FILES report(s) (${SPCT}% >= 80%)$GAMING_NOTE" \
      '. + [{"name":"story-pass-rate","pass":true,"detail":$c,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg c "$S_PASS/$S_TOTAL stories passed by TABLE across $QA_FILES report(s) (${SPCT}% < 80% — acceptance fails)$GAMING_NOTE" \
      '. + [{"name":"story-pass-rate","pass":false,"detail":$c,"duration_ms":0}]')
  fi
fi

output_results
