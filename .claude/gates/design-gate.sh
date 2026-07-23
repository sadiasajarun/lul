#!/bin/bash
# design-gate.sh — Deterministic validation for design phase
# Checks: HTML files exist, routing valid, shared components consistent, design system exists
source "$(dirname "$0")/_gate-runner.sh"

init_gate "design" "$1"

# Locate HTML output directory
HTML_DIR=""
for candidate in ".claude-project/$PROJECT_NAME/generated-screens" ".claude-project/$PROJECT_NAME/design/html" "design/html" "html"; do
  if [ -d "$TARGET_DIR/$candidate" ]; then
    HTML_DIR="$TARGET_DIR/$candidate"
    break
  fi
done

# Check 1: Design system file exists
DESIGN_SYSTEM=""
for candidate in ".claude-project/$PROJECT_NAME/design/DESIGN_SYSTEM.md" "DESIGN_SYSTEM.md" ".claude-project/$PROJECT_NAME/docs/DESIGN_SYSTEM.md"; do
  if [ -f "$TARGET_DIR/$candidate" ]; then
    DESIGN_SYSTEM="$TARGET_DIR/$candidate"
    break
  fi
done
file_exists_check "design-system-exists" "${DESIGN_SYSTEM:-$TARGET_DIR/.claude-project/$PROJECT_NAME/design/DESIGN_SYSTEM.md}"

# Check 2: HTML files generated
if [ -n "$HTML_DIR" ]; then
  run_count_check "html-files-exist" \
    "find '$HTML_DIR' -name '*.html' 2>/dev/null | wc -l" \
    ">=" 1

  # Check 2b: routes.yaml-based coverage — prevents self-pass via self-generated lists
  ROUTES_FILE="$TARGET_DIR/.claude-project/routes.yaml"
  if [ -f "$ROUTES_FILE" ]; then
    ROUTE_COUNT=$(grep -c '^ *- path:' "$ROUTES_FILE" 2>/dev/null || echo 0)
    HTML_COUNT=$(find "$HTML_DIR" -name "*.html" 2>/dev/null | wc -l | tr -d ' ')

    if [ "$ROUTE_COUNT" -eq 0 ]; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"routes-coverage","pass":true,"detail":"routes.yaml has no routes — skipping","duration_ms":0}]')
    elif [ "$HTML_COUNT" -ge "$ROUTE_COUNT" ]; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$HTML_COUNT HTML files cover $ROUTE_COUNT routes" '. + [{"name":"routes-coverage","pass":true,"detail":$d,"duration_ms":0}]')
    else
      MISSING=$((ROUTE_COUNT - HTML_COUNT))
      ROUTE_PATHS=$(grep '^ *- path:' "$ROUTES_FILE" 2>/dev/null | sed 's/.*path: *//' | tr '\n' '|')
      DETAIL="$HTML_COUNT HTML < $ROUTE_COUNT routes ($MISSING missing). All routes: $ROUTE_PATHS"
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$DETAIL" '. + [{"name":"routes-coverage","pass":false,"detail":$d,"duration_ms":0}]')
    fi
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"routes-coverage","pass":true,"detail":"no routes.yaml — skipping coverage check","duration_ms":0}]')
  fi

  # Check 3: No broken internal links (static analysis)
  # Extract all href values, check each target file exists
  TOTAL_LINKS=0
  BROKEN_LINKS=0
  for html_file in "$HTML_DIR"/*.html; do
    [ -f "$html_file" ] || continue
    # Extract href="..." values (internal only, not http/https/#)
    hrefs=$(grep -oP 'href="(?!https?://|#|mailto:|tel:|javascript:)\K[^"]+' "$html_file" 2>/dev/null || true)
    for href in $hrefs; do
      TOTAL_LINKS=$((TOTAL_LINKS + 1))
      target="$HTML_DIR/$href"
      if [ ! -f "$target" ]; then
        BROKEN_LINKS=$((BROKEN_LINKS + 1))
      fi
    done
  done

  if [ "$TOTAL_LINKS" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"routing-valid","pass":true,"detail":"no internal links found","duration_ms":0}]')
  elif [ "$BROKEN_LINKS" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$TOTAL_LINKS links, 0 broken" '. + [{"name":"routing-valid","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$BROKEN_LINKS/$TOTAL_LINKS links broken" '. + [{"name":"routing-valid","pass":false,"detail":$d,"duration_ms":0}]')
  fi

  # Check 4: Shared component consistency (navbar) — per layout group
  # Multi-layout designs intentionally have different navbars per layout group.
  # Check consistency WITHIN each group (admin-*, workspace-*, client-*, auth/other).
  INCONSISTENT_GROUPS=""
  GROUPS_CHECKED=0
  for prefix in "admin-" "workspace-" "client-"; do
    GROUP_FIRST_NAV=""
    GROUP_CONSISTENT=true
    GROUP_COUNT=0
    for html_file in "$HTML_DIR"/${prefix}*.html; do
      [ -f "$html_file" ] || continue
      # Layout shell candidates, in priority order:
      # 1. <header>...</header>          — top-bar layouts
      # 2. <aside>...</aside>            — sidebar layouts (admin/dashboard pattern)
      # 3. <nav> excluding `var-nav-bar` — fallback (var-nav-bar is the variation
      #                                   selection debug strip, not a real shared nav)
      NAV=$(sed -n '/<header/,/<\/header>/p' "$html_file" 2>/dev/null)
      if [ -z "$NAV" ]; then
        NAV=$(sed -n '/<aside/,/<\/aside>/p' "$html_file" 2>/dev/null)
      fi
      if [ -z "$NAV" ]; then
        # Skip var-nav-bar debug strip — find next nav block if present.
        NAV=$(awk '
          /<nav[^>]*var-nav-bar/ { in_skip=1; next }
          in_skip && /<\/nav>/ { in_skip=0; next }
          in_skip { next }
          /<nav/ { in_real=1 }
          in_real { print }
          /<\/nav>/ { if (in_real) exit }
        ' "$html_file" 2>/dev/null)
      fi
      [ -z "$NAV" ] && continue
      # Normalize: strip class/href, collapse SVG bodies (icons vary in geometry but
      # are the same conceptual element), drop whitespace between tags. The check
      # compares nav structure (link list + visible text), not formatting or
      # pixel-perfect icon paths.
      NAV_NORM=$(echo "$NAV" \
        | sed 's/ class="[^"]*"//g; s/href="[^"]*"//g' \
        | perl -pe 's|<svg\b[^>]*>.*?</svg>|<svg/>|gs' \
        | tr -s ' \t\n' ' ' \
        | perl -pe 's|>\s+|>|g; s|\s+<|<|g')
      GROUP_COUNT=$((GROUP_COUNT + 1))
      if [ -z "$GROUP_FIRST_NAV" ]; then
        GROUP_FIRST_NAV="$NAV_NORM"
      elif [ "$NAV_NORM" != "$GROUP_FIRST_NAV" ]; then
        GROUP_CONSISTENT=false
      fi
    done
    if [ "$GROUP_COUNT" -gt 1 ]; then
      GROUPS_CHECKED=$((GROUPS_CHECKED + 1))
      if [ "$GROUP_CONSISTENT" = false ]; then
        INCONSISTENT_GROUPS="$INCONSISTENT_GROUPS ${prefix}*"
      fi
    fi
  done

  if [ -z "$INCONSISTENT_GROUPS" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$GROUPS_CHECKED layout groups checked, all consistent" \
      '. + [{"name":"shared-components-consistent","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "inconsistent groups:$INCONSISTENT_GROUPS" \
      '. + [{"name":"shared-components-consistent","pass":false,"detail":$d,"duration_ms":0}]')
  fi

  # Check 5: No placeholder content
  PLACEHOLDER_COUNT=$(grep -rl 'Lorem ipsum\|TODO\|PLACEHOLDER\|Coming soon' "$HTML_DIR" --include='*.html' 2>/dev/null | wc -l)
  if [ "$PLACEHOLDER_COUNT" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-placeholders","pass":true,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$PLACEHOLDER_COUNT files with placeholder content" '. + [{"name":"no-placeholders","pass":false,"detail":$d,"duration_ms":0}]')
  fi
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"html-directory-found","pass":false,"detail":"no generated HTML directory found","duration_ms":0}]')
fi

# =============================================================================
# Check 6: Client approval — DESIGN_STATUS.md must have approved: true (Layer 7)
# Prevents: F-01 (agent generates all HTML without client confirmation)
# The design.yaml blueprint has require-variation-selection deterministic node,
# but if agent skips blueprint entirely, this gate catches it as backup.
# =============================================================================
DESIGN_STATUS=""
for candidate in \
  "$TARGET_DIR/.claude-project/"*/status/DESIGN_STATUS.md \
  "$TARGET_DIR/.claude-project/DESIGN_STATUS.md" \
  "$TARGET_DIR/.claude-project/$PROJECT_NAME/design/DESIGN_STATUS.md"; do
  for f in $candidate; do
    [ -f "$f" ] && DESIGN_STATUS="$f" && break 2
  done
done

if [ -n "$DESIGN_STATUS" ]; then
  if grep -q 'approved: true' "$DESIGN_STATUS" 2>/dev/null; then
    VARIATION=$(grep 'selected_variation:' "$DESIGN_STATUS" 2>/dev/null | sed 's/.*: *//' | tr -d ' "')
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "approved=true, variation=$VARIATION" \
      '. + [{"name":"client-approval","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "DESIGN_STATUS.md exists but approved: true missing — client must select a variation via AskUserQuestion" \
      '. + [{"name":"client-approval","pass":false,"detail":$d,"duration_ms":0}]')
  fi
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"client-approval","pass":false,"detail":"DESIGN_STATUS.md not found — Step 3d (client confirmation) never ran","duration_ms":0}]')
fi

output_results
