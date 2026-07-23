#!/bin/bash
# frontend-gate.sh — Deterministic validation for frontend phase
# Checks: TSC, build succeeds, page components exist, routing configured,
#         dead buttons, layout-role coverage, PRD NFR compliance
source "$(dirname "$0")/_gate-runner.sh"

init_gate "frontend" "$1"

# Auto-detect frontend directory
FRONTEND_DIR=""
for candidate in "frontend" "frontend-web" "web" "client" "app"; do
  if [ -d "$TARGET_DIR/$candidate" ] && [ -f "$TARGET_DIR/$candidate/package.json" ]; then
    FRONTEND_DIR="$TARGET_DIR/$candidate"
    break
  fi
done

if [ -z "$FRONTEND_DIR" ]; then
  echo '{"gate":"frontend","error":"no frontend directory found","checks":[],"score":0,"passed":false}'
  exit 1
fi

# Auto-detect source directory (app/ for React Router 7 framework mode,
# src/ for CRA/Vite default). Prefer app/ if it exists (RR7 templates).
if [ -d "$FRONTEND_DIR/app" ]; then
  SRC_DIR="$FRONTEND_DIR/app"
elif [ -d "$FRONTEND_DIR/src" ]; then
  SRC_DIR="$FRONTEND_DIR/src"
else
  SRC_DIR="$FRONTEND_DIR/app"   # default for new RR7 projects
fi

# Check 0: .env.example exists
file_exists_check "frontend-env-example" "$FRONTEND_DIR/.env.example"

# Check 1: TypeScript compiles
run_check "tsc" "cd '$FRONTEND_DIR' && npx tsc --noEmit"

# Check 2: Build succeeds
run_check "build" "cd '$FRONTEND_DIR' && npm run build 2>&1"

# Check 3: Page components exist
run_count_check "page-components" \
  "find '$SRC_DIR' -path '*/pages/*' -name '*.tsx' -o -path '*/views/*' -name '*.tsx' 2>/dev/null | wc -l" \
  ">=" 1

# Check 3b: HTML prototype coverage — React page count must be at least 80% of HTML file count
# C-05: Prevents Phase 6 agent from ignoring HTML prototypes and implementing independent UI
# Skip if design/html directory doesn't exist (compatible with projects that didn't run design phase)
HTML_DESIGN_DIR=""
for dir in "$TARGET_DIR/.claude-project/$PROJECT_NAME/design/html" "$TARGET_DIR/.claude-project/$PROJECT_NAME/generated-screens" "$TARGET_DIR/design/html" "$TARGET_DIR/HTML"; do
  if [ -d "$dir" ] && [ "$(find "$dir" -name '*.html' 2>/dev/null | wc -l)" -gt 0 ]; then
    HTML_DESIGN_DIR="$dir"
    break
  fi
done
if [ -n "$HTML_DESIGN_DIR" ]; then
  HTML_COUNT=$(find "$HTML_DESIGN_DIR" -name '*.html' 2>/dev/null | wc -l | tr -d ' ')
  TSX_COUNT=$(find "$SRC_DIR/pages" "$SRC_DIR/views" -name '*.tsx' 2>/dev/null | wc -l | tr -d ' ')
  THRESHOLD=$(( HTML_COUNT * 80 / 100 ))
  [ "$THRESHOLD" -lt 1 ] && THRESHOLD=1
  if [ "$TSX_COUNT" -ge "$THRESHOLD" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$TSX_COUNT React pages / $HTML_COUNT HTML prototypes (>= 80% required)" \
      '. + [{"name":"html-prototype-coverage","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$TSX_COUNT React pages found, need $THRESHOLD ($HTML_COUNT HTML files × 80%) — each HTML prototype must have a corresponding React page" \
      '. + [{"name":"html-prototype-coverage","pass":false,"detail":$d,"duration_ms":0}]')
  fi

  # Check 3c: Name-based coverage — verify specific HTML files have corresponding React pages
  # Extracts page name from HTML filename and checks if a matching TSX exists
  UNMATCHED=""
  UNMATCHED_COUNT=0
  MATCHED_COUNT=0
  for html_file in $(find "$HTML_DESIGN_DIR" -name '*.html' 2>/dev/null); do
    BASENAME=$(basename "$html_file" .html)
    # Strip leading number prefix (e.g., "02-login" → "login", "07a-board-template" → "board-template")
    # Only strips if starts with digit — plain names like "login" pass through unchanged
    PAGE_SLUG=$(echo "$BASENAME" | sed 's/^[0-9][0-9]*[a-z]*[-_]//')
    # Convert kebab-case to PascalCase (POSIX-compatible, no GNU sed -r or \U)
    PASCAL=$(echo "$PAGE_SLUG" | awk -F'-' '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1' OFS='')
    # Search for matching TSX file (PascalCase page name)
    FOUND=$(find "$SRC_DIR/pages" "$SRC_DIR/views" -name "*${PASCAL}*" -o -name "*${PAGE_SLUG}*" 2>/dev/null | head -1)
    if [ -n "$FOUND" ]; then
      MATCHED_COUNT=$((MATCHED_COUNT + 1))
    else
      UNMATCHED_COUNT=$((UNMATCHED_COUNT + 1))
      UNMATCHED="$UNMATCHED\n    - $BASENAME ($PAGE_SLUG → ${PASCAL}Page.tsx not found)"
    fi
  done
  if [ "$UNMATCHED_COUNT" -gt 0 ]; then
    DETAIL="$MATCHED_COUNT/$HTML_COUNT HTML files have matching React pages. Missing:$(echo -e "$UNMATCHED")"
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$DETAIL" \
      '. + [{"name":"html-name-coverage","pass":false,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "All $HTML_COUNT HTML prototypes have matching React pages (name-verified)" \
      '. + [{"name":"html-name-coverage","pass":true,"detail":$d,"duration_ms":0}]')
  fi
fi

# Check 4: Routing configured (framework mode required per routing-guide.md)
run_check "routing-exists" \
  "test -f '$SRC_DIR/routes.ts'"

# Check 4b: Route files split into routes/ directory (not all inline in routes.ts)
# Prevents: All routes defined inline in routes.ts instead of split into routes/*.routes.ts
ROUTE_FILES=$(find "$SRC_DIR/routes" -name '*.routes.ts' 2>/dev/null | wc -l | tr -d ' ')
if [ "$ROUTE_FILES" -ge 1 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$ROUTE_FILES route files found in routes/ directory" \
    '. + [{"name":"route-files-split","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"route-files-split","pass":false,"detail":"No *.routes.ts files in routes/ — routes must be split per routing-guide.md","duration_ms":0}]')
fi

# Check 4c: routes.ts must NOT have inline route() calls — it should only import from routes/*.routes.ts
# Prevents: Agent creating route files BUT also defining routes inline in routes.ts (routes.ts is aggregator only)
if [ -f "$SRC_DIR/routes.ts" ]; then
  # Count route()/index() calls in routes.ts itself (excluding import lines and comments)
  INLINE_ROUTES=$(grep -E "^\s*(route|index)\(" "$SRC_DIR/routes.ts" 2>/dev/null | grep -v '^\s*//' | wc -l | tr -d ' ')
  # Allow max 2 inline routes (catch-all 404 + unauthorized are acceptable in routes.ts)
  if [ "$INLINE_ROUTES" -le 2 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"no-inline-routes","pass":true,"detail":"routes.ts is aggregator only","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$INLINE_ROUTES inline route()/index() calls in routes.ts — routes.ts must only import from routes/*.routes.ts (max 2 allowed for catch-all/unauthorized)" \
      '. + [{"name":"no-inline-routes","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# Check 5: No hardcoded API URLs (should use env vars)
HARDCODED=$(grep -rn 'localhost:3000\|127.0.0.1:3000' "$SRC_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v 'node_modules' | wc -l)
if [ "$HARDCODED" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-hardcoded-urls","pass":true,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$HARDCODED hardcoded localhost references found" '. + [{"name":"no-hardcoded-urls","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 6: Shared components extracted (layout, navbar, etc.)
run_count_check "shared-components" \
  "find '$SRC_DIR' -path '*/components/*' -name '*.tsx' -o -path '*/layouts/*' -name '*.tsx' 2>/dev/null | wc -l" \
  ">=" 1

# =============================================================================
# Checks 7-9: PRD compliance validation (prevents C-04, C-05, C-06, C-07)
# =============================================================================

# Check 7: Dead Button Detection — <button> without onClick or type="submit"
# How it works:
#   1. Find all <button in .tsx files
#   2. Filter out those with onClick, type="submit", disabled, or aria- (accessible)
#   3. Remaining = "dead buttons" that render UI but do nothing when clicked
# Prevents: C-04/BUG-002 (View & Reply button with no handler)
# Use perl to detect <button ...> blocks (up to 5 lines) without onClick/type="submit"
# This handles JSX multiline formatting where onClick is on the next line
DEAD_BUTTONS=$(find "$SRC_DIR" -name '*.tsx' -exec perl -0777 -ne '
  while (/<button\b((?:(?!<button|<\/button)[^>])*?)>/gs) {
    my $attrs = $1;
    unless ($attrs =~ /onClick|type=.submit.|disabled|aria-|\.\.\.props|\.\.\.rest|\{\.\.\./) {
      $count++;
    }
  }
  END { print $count // 0 }
' {} + 2>/dev/null || echo 0)
# Dead-button check is INFORMATIONAL during the frontend phase — buttons get
# wired in the integrate phase. Pass with a warning detail if integrate hasn't
# run yet; enforce strictly only after integrate is Complete.
# Scope to THIS project's PIPELINE_STATUS.md (passed as $2). Falls back to
# first-found if not provided. Avoids matching stale sibling dirs (hrm/, backend/).
PROJECT_NAME="${2:-}"
INTEGRATE_DONE=0
STATUS_FILE=""
if [ -n "$PROJECT_NAME" ] && [ -f "$TARGET_DIR/.claude-project/$PROJECT_NAME/status/PIPELINE_STATUS.md" ]; then
  STATUS_FILE="$TARGET_DIR/.claude-project/$PROJECT_NAME/status/PIPELINE_STATUS.md"
else
  for cand in "$TARGET_DIR/.claude-project/status"/*/PIPELINE_STATUS.md; do
    [ -f "$cand" ] && STATUS_FILE="$cand" && break
  done
fi
if [ -n "$STATUS_FILE" ] && grep -qE '^\| integrate \| Complete' "$STATUS_FILE" 2>/dev/null; then
  INTEGRATE_DONE=1
fi

if [ "$DEAD_BUTTONS" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-dead-buttons","pass":true,"duration_ms":0}]')
elif [ "$INTEGRATE_DONE" -eq 0 ]; then
  # Frontend phase only — buttons not yet wired. Warn but pass.
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$DEAD_BUTTONS buttons not yet wired (expected before integrate phase runs)" \
    '. + [{"name":"no-dead-buttons","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$DEAD_BUTTONS buttons without onClick/type=submit found (integrate complete — should be wired)" \
    '. + [{"name":"no-dead-buttons","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 8: Layout variants match PRD role count
# How it works:
#   1. Read PRD file, count layout definitions (e.g. "AdminLayout", "SuperAdminLayout")
#   2. Read Layout.tsx, count how many distinct variants/return blocks exist
#   3. If PRD has more layouts than code → layouts were merged (syntax-only extraction)
# Prevents: C-06/BUG-004a (SuperAdmin layout merged with Admin)
PRD_FILE=$(find "$TARGET_DIR/.claude-project" -name '*PRD*' -o -name '*prd*' 2>/dev/null | head -1)
if [ -n "$PRD_FILE" ]; then
  PRD_LAYOUT_COUNT=$(grep -ciE '(Layout\s*\|)|(AdminLayout|SuperAdminLayout|ClientLayout|PublicLayout)' "$PRD_FILE" 2>/dev/null || echo 0)
  LAYOUT_FILE=$(find "$SRC_DIR" -name 'Layout.tsx' -o -name 'layout.tsx' 2>/dev/null | head -1)
  if [ -n "$LAYOUT_FILE" ] && [ "$PRD_LAYOUT_COUNT" -gt 0 ]; then
    # Count distinct return blocks or variant checks in Layout
    CODE_VARIANT_COUNT=$(grep -cE "variant.*===|variant.*==|case ['\"]" "$LAYOUT_FILE" 2>/dev/null || echo 0)
    CODE_RETURN_COUNT=$(grep -c 'return' "$LAYOUT_FILE" 2>/dev/null || echo 0)
    CODE_LAYOUTS=$((CODE_VARIANT_COUNT > CODE_RETURN_COUNT ? CODE_VARIANT_COUNT : CODE_RETURN_COUNT))
    if [ "$CODE_LAYOUTS" -ge "$PRD_LAYOUT_COUNT" ]; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "PRD=$PRD_LAYOUT_COUNT, code=$CODE_LAYOUTS" \
        '. + [{"name":"layout-role-coverage","pass":true,"detail":$d,"duration_ms":0}]')
    else
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "PRD defines $PRD_LAYOUT_COUNT layouts but code has $CODE_LAYOUTS variants" \
        '. + [{"name":"layout-role-coverage","pass":false,"detail":$d,"duration_ms":0}]')
    fi
  fi
fi

# Check 9: PRD Non-Functional Requirements (NFR) compliance
# How it works:
#   1. Scan PRD for NFR keywords: i18n, accessibility, etc.
#   2. For each found NFR, check if corresponding implementation exists:
#      - i18n → i18next/react-intl in package.json
#      - accessibility → aria- attributes in .tsx files
#   3. Score = implemented / total NFRs found in PRD
# Prevents: C-05/BUG-003 (i18n not implemented despite PRD requirement)
if [ -n "$PRD_FILE" ]; then
  NFR_SCORE=0
  NFR_TOTAL=0

  # i18n check — 4-signal: package installed + init file + locale files + component usage
  # Prevents false positives where library is installed but never wired (pattern: "Installed But Not Used")
  if grep -qi 'i18n\|internationalization\|localization\|react-i18next\|다국어\|한국어\|한영' "$PRD_FILE" 2>/dev/null; then
    NFR_TOTAL=$((NFR_TOTAL + 1))
    I18N_SIGNALS=0
    # Signal 1: package installed
    if grep -q 'i18next\|react-intl\|formatjs\|next-intl' "$FRONTEND_DIR/package.json" 2>/dev/null; then
      I18N_SIGNALS=$((I18N_SIGNALS + 1))
    fi
    # Signal 2: init file exists with i18next.use(initReactI18next).init or i18next.init
    if grep -rql 'initReactI18next\|i18next\.init' "$SRC_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null; then
      I18N_SIGNALS=$((I18N_SIGNALS + 1))
    fi
    # Signal 3: public/locales/ directory has at least 2 language subdirectories/files
    LOCALE_COUNT=$(find "$FRONTEND_DIR/public/locales" -name '*.json' 2>/dev/null | wc -l)
    if [ "$LOCALE_COUNT" -ge 2 ]; then
      I18N_SIGNALS=$((I18N_SIGNALS + 1))
    fi
    # Signal 4: at least 5 .tsx files call useTranslation()
    TRANSLATION_FILES=$(grep -rl 'useTranslation' "$SRC_DIR" --include='*.tsx' 2>/dev/null | wc -l)
    if [ "$TRANSLATION_FILES" -ge 5 ]; then
      I18N_SIGNALS=$((I18N_SIGNALS + 1))
    fi
    # All 4 signals required to pass
    if [ "$I18N_SIGNALS" -eq 4 ]; then
      NFR_SCORE=$((NFR_SCORE + 1))
    fi
  fi

  # Accessibility check
  if grep -qi 'accessibility\|a11y\|aria\|wcag\|접근성' "$PRD_FILE" 2>/dev/null; then
    NFR_TOTAL=$((NFR_TOTAL + 1))
    ARIA_COUNT=$(grep -rl 'aria-' "$SRC_DIR" --include='*.tsx' 2>/dev/null | wc -l)
    [ "$ARIA_COUNT" -ge 3 ] && NFR_SCORE=$((NFR_SCORE + 1))
  fi

  if [ "$NFR_TOTAL" -gt 0 ]; then
    if [ "$NFR_SCORE" -eq "$NFR_TOTAL" ]; then
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$NFR_SCORE/$NFR_TOTAL NFR requirements satisfied" \
        '. + [{"name":"prd-nfr-compliance","pass":true,"detail":$d,"duration_ms":0}]')
    else
      CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$NFR_SCORE/$NFR_TOTAL NFR requirements implemented" \
        '. + [{"name":"prd-nfr-compliance","pass":false,"detail":$d,"duration_ms":0}]')
    fi
  fi
fi

# =============================================================================
# Checks 10-12: Basic UX + structural patterns (prevents C-10, D-06)
# =============================================================================

# Check 10: Basic UX Patterns — PRD-independent, always enforced
# These are patterns every web app must have, regardless of PRD content
# Prevents: C-10 (logo not linking to home)

# 10a: Logo/brand in Layout files must be wrapped in <Link> or <a>
LAYOUT_FILES=$(find "$SRC_DIR" -name '*Layout*' -name '*.tsx' 2>/dev/null)
LAYOUT_COUNT=0
LOGO_LINKED=0
if [ -n "$LAYOUT_FILES" ]; then
  LAYOUT_COUNT=$(echo "$LAYOUT_FILES" | wc -l | tr -d ' ')
  for lf in $LAYOUT_FILES; do
    # Check if brand/logo text is inside a <Link> or <a> tag (within 3 lines)
    if perl -0777 -ne 'exit(1) unless /<(?:Link|a)\b[^>]*>.*?(?:brand|logo|name|Brand|Logo)/s' "$lf" 2>/dev/null; then
      LOGO_LINKED=$((LOGO_LINKED + 1))
    fi
  done
fi
if [ "$LAYOUT_COUNT" -eq 0 ] || [ "$LOGO_LINKED" -ge "$LAYOUT_COUNT" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$LOGO_LINKED/$LAYOUT_COUNT layouts have logo link" \
    '. + [{"name":"logo-home-link","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$LOGO_LINKED/$LAYOUT_COUNT layouts have logo link" \
    '. + [{"name":"logo-home-link","pass":false,"detail":$d,"duration_ms":0}]')
fi

# 10b: 404 catch-all route exists in routes.ts or router config
CATCH_ALL=$(grep -rn 'path="\*"\|path: "\*"\|route(.\*' "$SRC_DIR" --include='*.tsx' --include='*.ts' 2>/dev/null | wc -l)
if [ "$CATCH_ALL" -ge 1 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"404-catch-all","pass":true,"detail":"catch-all route exists","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"404-catch-all","pass":false,"detail":"no path=\"*\" catch-all route found","duration_ms":0}]')
fi

# Check 11: TypeScript strict mode enabled
TSCONFIG="$FRONTEND_DIR/tsconfig.json"
if [ -f "$TSCONFIG" ]; then
  if grep -q '"strict"[[:space:]]*:[[:space:]]*true' "$TSCONFIG" 2>/dev/null; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"ts-strict-mode","pass":true,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"ts-strict-mode","pass":false,"detail":"tsconfig.json missing strict: true","duration_ms":0}]')
  fi
fi

# Check 12: Role-based UI visibility
# FAIL if PRD defines multiple roles but no route/page-level role guards exist.
# Accepts either pattern:
#   (a) Route-level guards — a <ProtectedRoute>/<RequireRole>/<RoleGuard> wrapper
#       used in App.tsx/router config PLUS a ProtectedRoute-style component file
#       under src/components or src/auth or src/guards
#   (b) Page-level guards — role identifier (useRole/usePermission/isAdmin/...)
#       referenced directly inside at least one file under src/pages
# Either is sufficient. Prevents: C-07/D-06 (admin pages accessible without guard).
ROLE_TOKENS='ProtectedRoute\|RequireRole\|RoleGuard\|useRole\|usePermission\|isOwner\|isAdmin\|isPlatformAdmin\|canManage'

# Pattern (a): route-level — router wiring + guard component exist
# Uses $SRC_DIR (auto-detected app/ or src/ at top of file) + RR7 framework-mode
# fallbacks (root.tsx, routes.ts) which don't exist under src/ layouts.
ROUTE_GUARD_FILES=$(grep -rl "$ROLE_TOKENS" \
  "$SRC_DIR/App.tsx" \
  "$SRC_DIR/root.tsx" \
  "$SRC_DIR/router" \
  "$SRC_DIR/routes" \
  "$SRC_DIR/routes.ts" \
  "$SRC_DIR/main.tsx" \
  --include='*.tsx' --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')
GUARD_COMPONENT_FILES=$(find \
  "$SRC_DIR/components" \
  "$SRC_DIR/auth" \
  "$SRC_DIR/guards" \
  -maxdepth 3 -type f \
  \( -iname 'ProtectedRoute*' -o -iname 'RequireRole*' -o -iname 'RoleGuard*' \
     -o -iname 'AuthGuard*' -o -iname 'GuestGuard*' \) \
  2>/dev/null | wc -l | tr -d ' ')

# Pattern (b): page-level — any page references a role identifier
PAGE_ROLE_FILES=$(grep -rl "$ROLE_TOKENS" "$SRC_DIR/pages" --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')

PAGE_FILES=$(find "$SRC_DIR/pages" -name '*.tsx' 2>/dev/null | wc -l | tr -d ' ')

HAS_ROUTE_GUARDS=0
if [ "$ROUTE_GUARD_FILES" -ge 1 ] && [ "$GUARD_COMPONENT_FILES" -ge 1 ]; then
  HAS_ROUTE_GUARDS=1
fi

if [ "$PAGE_FILES" -gt 0 ] && { [ "$HAS_ROUTE_GUARDS" -eq 1 ] || [ "$PAGE_ROLE_FILES" -ge 1 ]; }; then
  if [ "$HAS_ROUTE_GUARDS" -eq 1 ]; then
    DETAIL="route-level guards ($GUARD_COMPONENT_FILES guard component(s), $ROUTE_GUARD_FILES router file(s)); $PAGE_ROLE_FILES/$PAGE_FILES pages also reference roles"
  else
    DETAIL="$PAGE_ROLE_FILES/$PAGE_FILES pages have role checks"
  fi
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$DETAIL" \
    '. + [{"name":"role-based-ui","pass":true,"detail":$d,"duration_ms":0}]')
elif [ -n "$PRD_FILE" ] && grep -qi 'admin\|superadmin\|super.admin\|manager\|role.*based\|역할' "$PRD_FILE" 2>/dev/null && [ "$PAGE_FILES" -gt 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "no route-level guards and 0/$PAGE_FILES pages reference roles — PRD defines multiple roles (ProtectedRoute/useRole required)" \
    '. + [{"name":"role-based-ui","pass":false,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$PAGE_ROLE_FILES/$PAGE_FILES pages have role checks" \
    '. + [{"name":"role-based-ui","pass":true,"detail":$d,"duration_ms":0}]')
fi

# =============================================================================
# Checks 13-17: Submodule compliance (prevents skipped doc patterns)
# Ensures .claude/react/docs/ patterns are actually followed during generation
# =============================================================================

# Check 13: httpService.ts uses environment variable for baseURL
# Prevents: Hardcoded baseURL that ignores .env configuration
# Rule: .claude/react/docs/data-fetching.md line 56
HTTPSERVICE_FILE="$SRC_DIR/services/httpService.ts"
if [ -f "$HTTPSERVICE_FILE" ]; then
  if grep -q 'import\.meta\.env\.VITE_API_URL' "$HTTPSERVICE_FILE" 2>/dev/null; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"httpservice-env-url","pass":true,"detail":"httpService.ts uses VITE_API_URL","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"httpservice-env-url","pass":false,"detail":"httpService.ts has hardcoded baseURL — must use import.meta.env.VITE_API_URL","duration_ms":0}]')
  fi
fi

# Check 14: httpService.ts has withCredentials: true (required for cookie auth)
# Prevents: Cookie-based auth failing silently
# Rule: .claude/react/docs/authentication-architecture.md
if [ -f "$HTTPSERVICE_FILE" ]; then
  if grep -q 'withCredentials.*true' "$HTTPSERVICE_FILE" 2>/dev/null; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"httpservice-with-credentials","pass":true,"detail":"httpService.ts has withCredentials: true","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"httpservice-with-credentials","pass":false,"detail":"httpService.ts missing withCredentials: true — required for httpOnly cookie auth","duration_ms":0}]')
  fi
fi

# Check 15: Redux slices have wired extraReducers (not empty placeholders)
# Prevents: Slices that compile but never handle async thunk state changes
# Rule: .claude/react/docs/data-fetching.md lines 210-245
SLICE_DIR="$SRC_DIR/redux/features"
if [ -d "$SLICE_DIR" ]; then
  EMPTY_REDUCERS=$(grep -rl 'extraReducers' "$SLICE_DIR" --include='*Slice.ts' 2>/dev/null | \
    xargs grep -l '// .*will be wired\|// .*thunks.*here\|// .*TODO\|extraReducers: () =>' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$EMPTY_REDUCERS" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"redux-extrareducers-wired","pass":true,"detail":"all Redux slices have functional extraReducers","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$EMPTY_REDUCERS slices have empty/placeholder extraReducers — thunks must be wired with builder.addCase" \
      '. + [{"name":"redux-extrareducers-wired","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# Check 16: No hardcoded mock data arrays in page components
# Prevents: Pages displaying fake data instead of real API data
# Rule: RULE-F6 in frontend.rules.md
MOCK_DATA=$(grep -rl 'mockUsers\|mockProjects\|mockData\|sampleData\|dummyData\|fakeDat' \
  "$SRC_DIR/pages/" --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
if [ "$MOCK_DATA" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"no-mock-data-in-pages","pass":true,"detail":"no hardcoded mock data found in pages","duration_ms":0}]')
else
  MOCK_FILES=$(grep -rl 'mockUsers\|mockProjects\|mockData\|sampleData\|dummyData\|fakeDat' \
    "$SRC_DIR/pages/" --include='*.tsx' 2>/dev/null | xargs -I{} basename {} | tr '\n' ' ')
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$MOCK_DATA pages with mock data: $MOCK_FILES" \
    '. + [{"name":"no-mock-data-in-pages","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 17: Empty state UI exists in list/table pages
# Prevents: List pages showing blank screen when no data
# Rule: RULE-F4 in frontend.rules.md
LIST_PAGES=$(grep -rl 'map\b.*=>' "$SRC_DIR/pages/" --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
EMPTY_STATE_PAGES=$(grep -rl 'length.*===.*0\|\.length.*0\|no.*found\|No.*found\|empty.*state\|EmptyState' \
  "$SRC_DIR/pages/" --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
# v118: RATIO, not presence. The old `EMPTY_STATE_PAGES >= 1` passed if a SINGLE
# list page handled the empty case while every other list rendered a blank screen
# on no data (RULE-F4). Require >= 70% of list pages to have empty-state handling.
ES_NEED=$(( LIST_PAGES * 70 / 100 )); [ "$LIST_PAGES" -gt 0 ] && [ "$ES_NEED" -lt 1 ] && ES_NEED=1
if [ "$LIST_PAGES" -eq 0 ] || [ "$EMPTY_STATE_PAGES" -ge "$ES_NEED" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$EMPTY_STATE_PAGES/$LIST_PAGES list pages handle empty state (>= 70%)" \
    '. + [{"name":"empty-state-ui","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$EMPTY_STATE_PAGES/$LIST_PAGES list pages handle empty state (need >= $ES_NEED = 70%)" \
    '. + [{"name":"empty-state-ui","pass":false,"detail":$d,"duration_ms":0}]')
fi

# =============================================================================
# Checks 18-24: Doc anti-pattern detection (catches memory-generated code)
# These verify output matches .claude/react/docs/ patterns, not training data
# =============================================================================

# Check 25: No inline domain interfaces in service files, Redux slices, or page files
# Domain types (entities, query params, create/update payloads, *State) must be in ~/types/{domain}.d.ts
# Only component Props and local UI unions (FilterType, SortType, TabType) may stay inline
# Rule: typescript-standards.md Type Placement Rules, file-organization.md types/ section
SERVICES_DIR="$SRC_DIR/services/httpServices"
SLICE_DIR_CHECK="$SRC_DIR/redux/features"
PAGES_DIR="$SRC_DIR/pages"
INLINE_IFACE_COUNT=0
INLINE_IFACE_FILES=""

# Exclusion pattern: Props interfaces and local UI unions are allowed inline
INLINE_EXCLUDE='Props\|props\|FilterType\|SortType\|TabType\|ViewType\|ModalType\|z\.infer\|ContextValue\|Option<'

# Scan service files for interface/type declarations
if [ -d "$SERVICES_DIR" ]; then
  SVC_IFACE=$(grep -rn '^interface \|^export interface \|^type [A-Z].*=' "$SERVICES_DIR" \
    --include='*.ts' 2>/dev/null | grep -v "$INLINE_EXCLUDE" | wc -l | tr -d ' ')
  if [ "$SVC_IFACE" -gt 0 ]; then
    INLINE_IFACE_COUNT=$((INLINE_IFACE_COUNT + SVC_IFACE))
    SVC_IFACE_FILES=$(grep -rn '^interface \|^export interface \|^type [A-Z].*=' "$SERVICES_DIR" \
      --include='*.ts' 2>/dev/null | grep -v "$INLINE_EXCLUDE" | sed 's/:.*$//' | xargs -I{} basename {} 2>/dev/null | sort -u | tr '\n' ' ')
    INLINE_IFACE_FILES="$INLINE_IFACE_FILES services: $SVC_IFACE_FILES"
  fi
fi

# Scan Redux slice files for interface/type declarations
if [ -d "$SLICE_DIR_CHECK" ]; then
  SLICE_IFACE=$(grep -rn '^interface \|^export interface \|^type [A-Z].*=' "$SLICE_DIR_CHECK" \
    --include='*Slice.ts' 2>/dev/null | grep -v "$INLINE_EXCLUDE" | wc -l | tr -d ' ')
  if [ "$SLICE_IFACE" -gt 0 ]; then
    INLINE_IFACE_COUNT=$((INLINE_IFACE_COUNT + SLICE_IFACE))
    SLICE_IFACE_FILES=$(grep -rn '^interface \|^export interface \|^type [A-Z].*=' "$SLICE_DIR_CHECK" \
      --include='*Slice.ts' 2>/dev/null | grep -v "$INLINE_EXCLUDE" | sed 's/:.*$//' | xargs -I{} basename {} 2>/dev/null | sort -u | tr '\n' ' ')
    INLINE_IFACE_FILES="$INLINE_IFACE_FILES slices: $SLICE_IFACE_FILES"
  fi
fi

# Scan page files for inline domain interfaces (Props/UI unions are allowed)
if [ -d "$PAGES_DIR" ]; then
  PAGE_IFACE=$(grep -rn '^interface \|^export interface \|^type [A-Z].*=' "$PAGES_DIR" \
    --include='*.tsx' 2>/dev/null | grep -v "$INLINE_EXCLUDE" | wc -l | tr -d ' ')
  if [ "$PAGE_IFACE" -gt 0 ]; then
    INLINE_IFACE_COUNT=$((INLINE_IFACE_COUNT + PAGE_IFACE))
    PAGE_IFACE_FILES=$(grep -rn '^interface \|^export interface \|^type [A-Z].*=' "$PAGES_DIR" \
      --include='*.tsx' 2>/dev/null | grep -v "$INLINE_EXCLUDE" | sed 's/:.*$//' | xargs -I{} basename {} 2>/dev/null | sort -u | tr '\n' ' ')
    INLINE_IFACE_FILES="$INLINE_IFACE_FILES pages: $PAGE_IFACE_FILES"
  fi
fi

# Scan component files for inline domain interfaces (Props are allowed)
COMP_DIR="$SRC_DIR/components"
if [ -d "$COMP_DIR" ]; then
  COMP_IFACE=$(grep -rn '^interface \|^export interface \|^type [A-Z].*=' "$COMP_DIR" \
    --include='*.tsx' 2>/dev/null | grep -v "$INLINE_EXCLUDE" | wc -l | tr -d ' ')
  if [ "$COMP_IFACE" -gt 0 ]; then
    INLINE_IFACE_COUNT=$((INLINE_IFACE_COUNT + COMP_IFACE))
    COMP_IFACE_FILES=$(grep -rn '^interface \|^export interface \|^type [A-Z].*=' "$COMP_DIR" \
      --include='*.tsx' 2>/dev/null | grep -v "$INLINE_EXCLUDE" | sed 's/:.*$//' | xargs -I{} basename {} 2>/dev/null | sort -u | tr '\n' ' ')
    INLINE_IFACE_FILES="$INLINE_IFACE_FILES components: $COMP_IFACE_FILES"
  fi
fi

if [ "$INLINE_IFACE_COUNT" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"no-inline-domain-interfaces","pass":true,"detail":"all domain types are in ~/types/","duration_ms":0}]')
else
  DETAIL="$INLINE_IFACE_COUNT inline interfaces found in$INLINE_IFACE_FILES- move to ~/types/{domain}.d.ts"
  DETAIL=$(echo "$DETAIL" | cut -c1-250)
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$DETAIL" \
    '. + [{"name":"no-inline-domain-interfaces","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 18: No createBrowserRouter (must use framework mode route()/layout()/index())
# Anti-pattern from: .claude/react/docs/routing-guide.md
NO_CBR=$(grep -r 'createBrowserRouter' "$SRC_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
if [ "$NO_CBR" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"no-createBrowserRouter","pass":true,"detail":"framework mode confirmed","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$NO_CBR files use createBrowserRouter — must use framework mode route()/layout()/index() per routing-guide.md" \
    '. + [{"name":"no-createBrowserRouter","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 19: No react-router-dom imports (must use react-router)
# Anti-pattern from: CLAUDE.md key patterns
NO_RRD=$(grep -r 'react-router-dom' "$SRC_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
if [ "$NO_RRD" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"no-react-router-dom","pass":true,"detail":"all imports use react-router","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$NO_RRD files import react-router-dom — must use react-router" \
    '. + [{"name":"no-react-router-dom","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 20: react-router.config.ts exists (framework mode requirement)
# Anti-pattern from: .claude/react/docs/routing-guide.md
if [ -f "$FRONTEND_DIR/react-router.config.ts" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"react-router-config-exists","pass":true,"detail":"react-router.config.ts exists","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"react-router-config-exists","pass":false,"detail":"Missing react-router.config.ts — required for framework mode per routing-guide.md","duration_ms":0}]')
fi

# Check 21: No @/ import alias (must use ~/)
# Anti-pattern from: CLAUDE.md import rules
NO_AT_ALIAS=$(grep -rE "from ['\"]@/" "$SRC_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
if [ "$NO_AT_ALIAS" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"import-alias-tilde","pass":true,"detail":"all imports use ~/ alias","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$NO_AT_ALIAS files use @/ alias — must use ~/ per file-organization.md" \
    '. + [{"name":"import-alias-tilde","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 22: No TanStack Query (must use Redux createAsyncThunk)
# Anti-pattern from: CLAUDE.md key patterns
NO_TANSTACK=$(grep -ri 'tanstack\|@tanstack/react-query\|useQuery\|useMutation\|QueryClient' "$SRC_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
if [ "$NO_TANSTACK" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"no-tanstack-query","pass":true,"detail":"no TanStack Query usage found","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$NO_TANSTACK files use TanStack Query — must use Redux createAsyncThunk per data-fetching.md" \
    '. + [{"name":"no-tanstack-query","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 23: ProtectedLayout has routeAccess RBAC map
# Required by: .claude/react/docs/auth-guards.md
PL_FILE="$SRC_DIR/components/layouts/ProtectedLayout.tsx"
if [ -f "$PL_FILE" ]; then
  if grep -q 'routeAccess' "$PL_FILE" 2>/dev/null; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"protected-layout-rbac","pass":true,"detail":"ProtectedLayout has routeAccess map","duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"protected-layout-rbac","pass":false,"detail":"ProtectedLayout missing routeAccess RBAC map — required per auth-guards.md","duration_ms":0}]')
  fi
fi

# Check 24: No src/ source directory (must be app/)
# Anti-pattern from: .claude/react/docs/file-organization.md
if [ -d "$FRONTEND_DIR/src" ] && [ ! -d "$FRONTEND_DIR/app" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"source-dir-app","pass":false,"detail":"Source dir is src/ — must be app/ per file-organization.md","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"source-dir-app","pass":true,"detail":"source directory is app/","duration_ms":0}]')
fi

# Check 26: data-testid coverage (RULE-F10) — interactive elements must carry test hooks.
# Runs the standalone has-stable-testids.sh gate and folds its single-check JSON
# into CHECKS_JSON so it shows up like any other frontend-gate check.
TESTID_JSON=$(bash "$(dirname "$0")/has-stable-testids.sh" "$TARGET_DIR" 2>/dev/null)
if [ -n "$TESTID_JSON" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    --argjson c "$(echo "$TESTID_JSON" | jq '{name:"has-stable-testids", pass:.pass, detail:.detail, duration_ms:0}')" \
    '. + [$c]')
fi

output_results
