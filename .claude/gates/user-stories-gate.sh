#!/bin/bash
# user-stories-gate.sh — Quality gate for Phase 3.5 (User Story Authorship)
#
# Contract: one YAML per HTML page, each YAML >= 5 scenarios across
# acceptance_criteria / boundary_cases / error_scenarios / state_transitions.

source "$(dirname "$0")/_gate-runner.sh"
init_gate "user-stories" "$1"

STORIES_DIR=""
for candidate in \
  "$TARGET_DIR/.claude-project/user_stories" \
  "$TARGET_DIR/user_stories"; do
  [ -d "$candidate" ] && STORIES_DIR="$candidate" && break
done

HTML_DIR="$TARGET_DIR/.claude-project/$PROJECT_NAME/design/html"

add_check() {
  local name="$1" pass="$2" detail="$3"
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$name" --argjson p "$pass" --arg d "$detail" \
    '. + [{"name":$n,"pass":$p,"detail":$d,"duration_ms":0}]')
}

# --- 0. Prerequisite — design approved ---
DESIGN_STATUS=""
for candidate in \
  "$TARGET_DIR/.claude-project/"*/status/DESIGN_STATUS.md \
  "$TARGET_DIR/.claude-project/DESIGN_STATUS.md" \
  "$TARGET_DIR/.claude-project/$PROJECT_NAME/design/DESIGN_STATUS.md"; do
  for f in $candidate; do
    [ -f "$f" ] && DESIGN_STATUS="$f" && break 2
  done
done
if [ -n "$DESIGN_STATUS" ] && grep -q 'approved: true' "$DESIGN_STATUS" 2>/dev/null; then
  add_check "prereq-design-approved" true "design approved"
else
  add_check "prereq-design-approved" false "design not approved — cannot author per-page stories"
fi

# --- 1. HTML pages exist ---
if [ ! -d "$HTML_DIR" ]; then
  add_check "html-pages-exist" false "missing: $HTML_DIR"
  output_results
  exit 0
fi
# v43: recurse to handle multi-frontend html/ subdirectories
# (frontend-admin/, frontend-worker/, etc.). The blueprint's
# require-html-pages was updated to the same; keep them aligned.
HTML_COUNT=$(find "$HTML_DIR" -name '*.html' 2>/dev/null | wc -l | tr -d ' ')
if [ "$HTML_COUNT" -gt 0 ]; then
  add_check "html-pages-exist" true "html_pages=$HTML_COUNT"
else
  add_check "html-pages-exist" false "no *.html under $HTML_DIR (any depth)"
  output_results
  exit 0
fi

# --- 2. Story YAMLs exist ---
if [ -z "$STORIES_DIR" ]; then
  add_check "story-files-exist" false "no user_stories directory"
  output_results
  exit 0
fi
YAML_COUNT=$(find "$STORIES_DIR" -maxdepth 1 -name '*.yaml' ! -name '_fixtures.yaml' ! -name '_index.yaml' 2>/dev/null | wc -l | tr -d ' ')
if [ "$YAML_COUNT" -gt 0 ]; then
  add_check "story-files-exist" true "yaml_count=$YAML_COUNT"
else
  add_check "story-files-exist" false "no story YAMLs in $STORIES_DIR"
  output_results
  exit 0
fi

# --- 3. Page parity: yaml_count >= html_count * 0.95 ---
MIN_YAML=$(( HTML_COUNT * 95 / 100 ))
if [ "$YAML_COUNT" -ge "$MIN_YAML" ]; then
  add_check "page-parity" true "yaml=$YAML_COUNT html=$HTML_COUNT (>= 95%)"
else
  add_check "page-parity" false "yaml=$YAML_COUNT html=$HTML_COUNT (need >= $MIN_YAML)"
fi

# --- 4. Naming parity: every HTML page has a matching YAML basename ---
MISSING=0
MISSING_LIST=""
for html in "$HTML_DIR"/*.html; do
  [ -f "$html" ] || continue
  base=$(basename "$html" .html)
  if [ ! -f "$STORIES_DIR/$base.yaml" ]; then
    MISSING=$((MISSING+1))
    MISSING_LIST="$MISSING_LIST $base"
  fi
done
if [ $MISSING -eq 0 ]; then
  add_check "naming-parity" true "every HTML page has a matching YAML"
else
  # Truncate list for the gate detail field
  SHORT=$(echo "$MISSING_LIST" | cut -c1-200)
  add_check "naming-parity" false "$MISSING HTML pages without matching YAML:$SHORT"
fi

# --- 5. Scenarios per story: >= 5 entries across buckets ---
# Count list items under acceptance_criteria / boundary_cases / error_scenarios / state_transitions.
THIN=0
THIN_LIST=""
BUCKETLESS=0
BUCKETLESS_LIST=""
for yml in "$STORIES_DIR"/*.yaml; do
  [ -f "$yml" ] || continue
  name=$(basename "$yml")
  [ "$name" = "_fixtures.yaml" ] && continue
  [ "$name" = "_index.yaml" ] && continue

  SCENARIOS=$(grep -cE '^\s*-\s+(id|case|scenario|state):' "$yml" 2>/dev/null)
  SCENARIOS=${SCENARIOS:-0}
  if [ "$SCENARIOS" -lt 5 ]; then
    THIN=$((THIN+1))
    THIN_LIST="$THIN_LIST $name(=$SCENARIOS)"
  fi

  BUCKETS=0
  for key in acceptance_criteria boundary_cases error_scenarios state_transitions; do
    if grep -qE "^${key}:" "$yml" 2>/dev/null; then
      BUCKETS=$((BUCKETS+1))
    fi
  done
  if [ "$BUCKETS" -lt 3 ]; then
    BUCKETLESS=$((BUCKETLESS+1))
    BUCKETLESS_LIST="$BUCKETLESS_LIST $name(buckets=$BUCKETS)"
  fi
done

if [ $THIN -eq 0 ]; then
  add_check "scenarios-per-story" true "all YAMLs have >= 5 scenarios"
else
  SHORT=$(echo "$THIN_LIST" | cut -c1-200)
  add_check "scenarios-per-story" false "$THIN YAMLs below 5 scenarios:$SHORT"
fi

if [ $BUCKETLESS -eq 0 ]; then
  add_check "bucket-coverage" true "all YAMLs have >= 3 of 4 scenario buckets"
else
  SHORT=$(echo "$BUCKETLESS_LIST" | cut -c1-200)
  add_check "bucket-coverage" false "$BUCKETLESS YAMLs missing buckets:$SHORT"
fi

# --- 6. No duplicate story names across files ---
DUP_COUNT=$(grep -hE '^\s*id:' "$STORIES_DIR"/*.yaml 2>/dev/null | \
  sed -E 's/^\s*id:\s*//' | sort | uniq -d | wc -l | tr -d ' ')
if [ "$DUP_COUNT" -eq 0 ]; then
  add_check "no-duplicate-ids" true "no duplicate story ids"
else
  add_check "no-duplicate-ids" false "$DUP_COUNT duplicate story ids"
fi

output_results
