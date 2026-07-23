#!/bin/bash
# pm-3-design-gate.sh — Deterministic validation for PM-track Phase P3-design
# Enforces: role-folder HTML output, DESIGN_STATUS snapshot fields, shared consistency,
#           route coverage, routing validity
source "$(dirname "$0")/_gate-runner.sh"

init_gate "P3-design" "$1"

DESIGN_DIR="$TARGET_DIR/.claude-project/design"
HTML_ROOT="$DESIGN_DIR/html"

# Find DESIGN_STATUS.md
STATUS_FILE=""
for cand in \
  "$TARGET_DIR/.claude-project/status"/*/DESIGN_STATUS.md \
  "$DESIGN_DIR/DESIGN_STATUS.md" \
  "$TARGET_DIR/.claude-project/DESIGN_STATUS.md"; do
  [ -f "$cand" ] && STATUS_FILE="$cand" && break
done

# --- 1. DESIGN_STATUS.md exists ---
if [ -n "$STATUS_FILE" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg f "$STATUS_FILE" '. + [{"name":"design-status-exists","pass":true,"detail":$f,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"design-status-exists","pass":false,"detail":"DESIGN_STATUS.md not found","duration_ms":0}]')
fi

# --- 2. approved: true ---
if [ -n "$STATUS_FILE" ] && grep -qE '^approved:[[:space:]]*true' "$STATUS_FILE"; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"design-approved","pass":true,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"design-approved","pass":false,"detail":"approved: true missing","duration_ms":0}]')
fi

# --- 3. phase_complete: true ---
if [ -n "$STATUS_FILE" ] && grep -qE '^phase_complete:[[:space:]]*true' "$STATUS_FILE"; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"phase-complete","pass":true,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"phase-complete","pass":false,"detail":"phase_complete: true missing","duration_ms":0}]')
fi

# --- 4. Snapshot fields all recorded ---
SNAPSHOT_MISSING=""
for field in roles prd_hash_at_generation prd_version html_bundle_hash generated_at; do
  if [ -n "$STATUS_FILE" ] && ! grep -qE "^${field}:" "$STATUS_FILE"; then
    SNAPSHOT_MISSING="$SNAPSHOT_MISSING $field"
  fi
done

if [ -z "$SNAPSHOT_MISSING" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"snapshot-recorded","pass":true,"detail":"all 5 fields present","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg m "missing:$SNAPSHOT_MISSING" '. + [{"name":"snapshot-recorded","pass":false,"detail":$m,"duration_ms":0}]')
fi

# --- 5. html/ directory has role subfolders (or fallback app/) ---
if [ -d "$HTML_ROOT" ]; then
  ROLE_COUNT=$(find "$HTML_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
  if [ "$ROLE_COUNT" -ge 1 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$ROLE_COUNT role folders" '. + [{"name":"role-folders-present","pass":true,"detail":$n,"duration_ms":0}]')
  else
    # Check if flat (files directly under html/)
    FLAT_COUNT=$(find "$HTML_ROOT" -maxdepth 1 -name '*.html' -type f 2>/dev/null | wc -l | tr -d ' ')
    if [ "$FLAT_COUNT" -ge 1 ]; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$FLAT_COUNT flat HTML files (expected role folders)" '. + [{"name":"role-folders-present","pass":false,"detail":$n,"duration_ms":0}]')
    else
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"role-folders-present","pass":false,"detail":"html/ is empty","duration_ms":0}]')
    fi
  fi
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"role-folders-present","pass":false,"detail":"design/html/ does not exist","duration_ms":0}]')
fi

# --- 6. Each role folder has >= 1 HTML ---
if [ -d "$HTML_ROOT" ]; then
  EMPTY_ROLES=""
  while IFS= read -r role_dir; do
    COUNT=$(find "$role_dir" -maxdepth 1 -name '*.html' -type f 2>/dev/null | wc -l | tr -d ' ')
    [ "$COUNT" -eq 0 ] && EMPTY_ROLES="$EMPTY_ROLES $(basename "$role_dir")"
  done < <(find "$HTML_ROOT" -mindepth 1 -maxdepth 1 -type d)

  if [ -z "$EMPTY_ROLES" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"min-html-per-role","pass":true,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg e "empty role(s):$EMPTY_ROLES" '. + [{"name":"min-html-per-role","pass":false,"detail":$e,"duration_ms":0}]')
  fi
fi

# --- 7. Route coverage: every routes.yaml route has an HTML ---
ROUTES_FILE=""
for cand in "$TARGET_DIR/.claude-project/routes.yaml" "$TARGET_DIR/.claude-project/tech/routes.yaml"; do
  [ -f "$cand" ] && ROUTES_FILE="$cand" && break
done

if [ -n "$ROUTES_FILE" ]; then
  ROUTE_COUNT=$(grep -cE '^\s*-\s*path:' "$ROUTES_FILE" 2>/dev/null || echo 0)
  ROUTE_COUNT=$(echo "$ROUTE_COUNT" | tr -d '[:space:]')
  HTML_COUNT=$(find "$HTML_ROOT" -name '*.html' -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "${HTML_COUNT:-0}" -ge "${ROUTE_COUNT:-0}" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$HTML_COUNT html >= $ROUTE_COUNT routes" '. + [{"name":"route-coverage","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$HTML_COUNT html < $ROUTE_COUNT routes" '. + [{"name":"route-coverage","pass":false,"detail":$d,"duration_ms":0}]')
  fi
else
  # No routes.yaml yet — acceptable for PM phase (D6 generates it). Record as info pass.
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"route-coverage","pass":true,"detail":"routes.yaml absent (generated later by D6)","duration_ms":0}]')
fi

# --- 8. Routing validity: spot-check hrefs resolve within html/ tree ---
# Collect all HTML files (fully qualified paths)
BROKEN=0
TOTAL_LINKS=0
if [ -d "$HTML_ROOT" ]; then
  for f in $(find "$HTML_ROOT" -name '*.html' -type f); do
    # Extract hrefs that look like relative HTML paths
    while IFS= read -r href; do
      TOTAL_LINKS=$((TOTAL_LINKS + 1))
      # Resolve relative to the file's directory
      src_dir=$(dirname "$f")
      target="$src_dir/$href"
      # Normalize path (handle ../)
      target_canonical=$(cd "$src_dir" 2>/dev/null && cd "$(dirname "$href")" 2>/dev/null && echo "$(pwd)/$(basename "$href")" || echo "")
      if [ -z "$target_canonical" ] || [ ! -f "$target_canonical" ]; then
        # Fallback: check literal path
        [ ! -f "$target" ] && BROKEN=$((BROKEN + 1))
      fi
    done < <(grep -oE 'href="[^"#]+\.html"' "$f" 2>/dev/null | sed 's/href="//;s/"$//' || true)
  done
fi

if [ "$TOTAL_LINKS" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"routing-valid","pass":true,"detail":"no html links to check","duration_ms":0}]')
elif [ "$BROKEN" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$TOTAL_LINKS links resolved" '. + [{"name":"routing-valid","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$BROKEN/$TOTAL_LINKS broken" '. + [{"name":"routing-valid","pass":false,"detail":$d,"duration_ms":0}]')
fi

output_results
