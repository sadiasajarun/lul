#!/bin/bash
# integrate-gate.sh — Deterministic validation for integration phase
# Checks: API service files exist, no `any` types in API calls, error handling present,
#         API route matching, CORS port consistency, interceptor safety
source "$(dirname "$0")/_gate-runner.sh"

init_gate "integrate" "$1"

# Auto-detect frontend directory
FRONTEND_DIR=""
for candidate in "frontend" "frontend-web" "web" "client" "app"; do
  if [ -d "$TARGET_DIR/$candidate" ] && [ -f "$TARGET_DIR/$candidate/package.json" ]; then
    FRONTEND_DIR="$TARGET_DIR/$candidate"
    break
  fi
done

if [ -z "$FRONTEND_DIR" ]; then
  echo '{"gate":"integrate","error":"no frontend directory found","checks":[],"score":0,"passed":false}'
  exit 1
fi

# Auto-detect source directory (app/ for React Router 7, src/ for CRA/Vite default)
SRC_DIR="$SRC_DIR"
[ -d "$FRONTEND_DIR/app" ] && [ ! -d "$SRC_DIR" ] && SRC_DIR="$FRONTEND_DIR/app"

# Auto-detect backend directory
BACKEND_DIR=""
for candidate in "backend" "server" "api"; do
  if [ -d "$TARGET_DIR/$candidate" ] && [ -f "$TARGET_DIR/$candidate/package.json" ]; then
    BACKEND_DIR="$TARGET_DIR/$candidate"
    break
  fi
done

# Check 1: API service/hook files exist
run_count_check "api-services-exist" \
  "find '$SRC_DIR' \( -path '*/api/*' -o -path '*/services/*' -o -path '*/hooks/*' \) -name '*.ts' -o -name '*.tsx' 2>/dev/null | wc -l" \
  ">=" 1

# Check 2: No `any` type in API response handling
# v118: threshold 5 → 0. A tolerance on an ANTI-pattern means "we accept 5
# instances of a known violation" (integrate.rules: "No `any` types"). The score
# must reflect reality; soft gate, so this lowers the number, never aborts.
ANY_COUNT=$(grep -rn ': any' "$SRC_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null | grep -iv 'eslint-disable\|TODO\|FIXME' | wc -l)
if [ "$ANY_COUNT" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$ANY_COUNT any types" '. + [{"name":"no-any-types","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$ANY_COUNT \`: any\` type(s) — integrate.rules bans any in API types" '. + [{"name":"no-any-types","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 3: Error handling patterns present (try/catch or error boundaries)
run_count_check "error-handling" \
  "grep -rl 'catch\|onError\|ErrorBoundary\|isError\|error.*state' '$SRC_DIR' --include='*.tsx' --include='*.ts' 2>/dev/null | wc -l" \
  ">=" 1

# Check 4: Loading states present
run_count_check "loading-states" \
  "grep -rl 'isLoading\|loading\|Spinner\|Skeleton\|LoadingOverlay' '$SRC_DIR' --include='*.tsx' 2>/dev/null | wc -l" \
  ">=" 1

# Check 5: TypeScript compiles after integration
run_check "tsc-after-integration" "cd '$FRONTEND_DIR' && npx tsc --noEmit"

# Check 6: Environment variable for API base URL
run_check "api-base-url-env" \
  "grep -rl 'VITE_API\|REACT_APP_API\|NEXT_PUBLIC_API\|process.env.*API\|import.meta.env.*API' '$SRC_DIR' --include='*.ts' --include='*.tsx' 2>/dev/null | head -1"

# =============================================================================
# Checks 7-10: Cross-component validation (prevents A-01, C-08, D-09, C-02)
# =============================================================================

# Check 7: API Route Matching — frontend API paths must exist in backend
# How it works:
#   1. Extract all backend routes from @Controller + @Get/@Post/... decorators
#   2. Extract all frontend API calls from api.get/post/... patterns
#   3. Compare: every frontend path must match a backend route
#   4. :param segments are normalized to wildcards for comparison
# Prevents: A-01 (organizations vs orgs), C-08 (/client/projects vs /orgs/:orgId/projects)
if [ -n "$BACKEND_DIR" ]; then
  BACKEND_ROUTES_TMP=$(mktemp)
  FRONTEND_CALLS_TMP=$(mktemp)

  # Extract backend routes: @Controller('prefix') + @Get('sub')/@Post('sub')/...
  # Normalize :param and {param} to * for pattern matching
  grep -rn "@Controller\|@Get\|@Post\|@Put\|@Patch\|@Delete" "$BACKEND_DIR/src" \
    --include='*.ts' 2>/dev/null | \
    sed -n "s/.*@[A-Za-z]*('\([^']*\)').*/\1/p" | \
    sed 's/:[^/]*\|{[^}]*}/\*/g' | sort -u > "$BACKEND_ROUTES_TMP"

  # Extract frontend API call paths: api.get('/path'), api.post(`/path`)
  grep -rn "api\.\(get\|post\|put\|patch\|delete\)\b" "$SRC_DIR" \
    --include='*.ts' --include='*.tsx' 2>/dev/null | \
    sed -n "s/.*['\"\`]\/\([^'\"\`\${}]*\).*/\1/p" | \
    sed 's/:[^/]*\|{[^}]*}/\*/g; s/\/$//' | sort -u > "$FRONTEND_CALLS_TMP"

  # Count frontend paths that don't match any backend route
  UNMATCHED=0
  UNMATCHED_DETAIL=""
  while IFS= read -r fe_path; do
    [ -z "$fe_path" ] && continue
    FOUND=false
    while IFS= read -r be_path; do
      [ -z "$be_path" ] && continue
      # v118: segment-boundary match, not loose substring. The old bidirectional
      # `grep -q` false-matched `/orgs` against `/organizations` (substring), so
      # genuine route mismatches were reported as matches. Normalize (strip leading
      # slash) and match only on equality or a `/`-delimited suffix, so a shorter
      # path matches a longer one only at a real segment boundary.
      bp="${be_path#/}"; fp="${fe_path#/}"
      if [ "$fp" = "$bp" ] || [ "${fp%/"$bp"}" != "$fp" ] || [ "${bp%/"$fp"}" != "$bp" ]; then
        FOUND=true
        break
      fi
    done < "$BACKEND_ROUTES_TMP"
    if [ "$FOUND" = false ]; then
      UNMATCHED=$((UNMATCHED + 1))
      UNMATCHED_DETAIL="$UNMATCHED_DETAIL /$fe_path"
    fi
  done < "$FRONTEND_CALLS_TMP"

  if [ "$UNMATCHED" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"api-route-matching","pass":true,"detail":"all frontend API paths match backend routes","duration_ms":0}]')
  else
    DETAIL="$UNMATCHED unmatched:$UNMATCHED_DETAIL"
    DETAIL=$(echo "$DETAIL" | cut -c1-200)
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$DETAIL" '. + [{"name":"api-route-matching","pass":false,"detail":$d,"duration_ms":0}]')
  fi

  rm -f "$BACKEND_ROUTES_TMP" "$FRONTEND_CALLS_TMP"
fi

# Check 8: CORS Port Consistency — backend CORS origin, Playwright baseURL, Vite port must align
# How it works:
#   1. Read FRONTEND_URL port from backend/.env
#   2. Read baseURL port from playwright.config.ts
#   3. Read server.port from vite.config.ts (default: 5173)
#   4. If any pair mismatches → warning (dev should allow multiple origins)
# Prevents: D-09/BUG-001 (CORS port mismatch), A-07 (CORS settings missing)
if [ -n "$BACKEND_DIR" ]; then
  CORS_PORT=$(grep -o 'FRONTEND_URL.*localhost:\([0-9]*\)' "$BACKEND_DIR/.env" 2>/dev/null | grep -o '[0-9]*$' | head -1)
  PW_PORT=$(grep -o 'baseURL.*localhost:\([0-9]*\)' "$TARGET_DIR/playwright.config.ts" 2>/dev/null | grep -o '[0-9]*$' | head -1)
  VITE_PORT=$(grep -o 'port.*[: ]\([0-9]*\)' "$FRONTEND_DIR/vite.config.ts" 2>/dev/null | grep -o '[0-9]*$' | head -1)
  VITE_PORT=${VITE_PORT:-5173}

  PORT_OK=true
  PORT_DETAIL="CORS=${CORS_PORT:-unset} PW=${PW_PORT:-unset} Vite=$VITE_PORT"
  [ -n "$CORS_PORT" ] && [ -n "$PW_PORT" ] && [ "$CORS_PORT" != "$PW_PORT" ] && PORT_OK=false
  [ -n "$CORS_PORT" ] && [ "$CORS_PORT" != "$VITE_PORT" ] && PORT_OK=false

  if [ "$PORT_OK" = true ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$PORT_DETAIL" '. + [{"name":"cors-port-consistency","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$PORT_DETAIL" '. + [{"name":"cors-port-consistency","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# Check 9: Axios interceptor has retry limit — prevents infinite 401 loop
# How it works:
#   1. Find files with interceptors.response
#   2. Check if they contain _retry/_isRetry/retryCount/MAX_RETRY
#   3. No retry limit = potential infinite loop on 401 → fail
# Prevents: C-02 (Axios infinite loop), A-09 (Auth interceptor loop)
INTERCEPTOR_FILES=$(grep -rl 'interceptors\.response' "$SRC_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null)
if [ -n "$INTERCEPTOR_FILES" ]; then
  HAS_RETRY_LIMIT=$(echo "$INTERCEPTOR_FILES" | xargs grep -l '_retry\|_isRetry\|retryCount\|MAX_RETRY\|isRefreshing' 2>/dev/null | wc -l)
  if [ "$HAS_RETRY_LIMIT" -ge 1 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"interceptor-retry-limit","pass":true,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "interceptors.response found but no retry limit (_retry/_isRetry/retryCount)" '. + [{"name":"interceptor-retry-limit","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# Check 10: No setTimeout + navigate pattern — use async/await instead
# How it works:
#   1. Search for setTimeout(...navigate...) or setTimeout(...router...)
#   2. This pattern causes timing bugs — should use await + navigate
# Prevents: C-01 (setTimeout navigation workaround)
SETTIMEOUT_NAV=$(grep -rn 'setTimeout' "$SRC_DIR" --include='*.tsx' --include='*.ts' 2>/dev/null | \
  grep -i 'navigate\|router\|push\|replace' | wc -l)
if [ "$SETTIMEOUT_NAV" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-settimeout-navigate","pass":true,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SETTIMEOUT_NAV setTimeout+navigate patterns found" '. + [{"name":"no-settimeout-navigate","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 11: Hardcoded error messages in catch blocks (WARN)
# Prevents: C-03 (error response hardcoding instead of using server message)
# Whitelists both dotted access (err.response.data.message) AND helper calls
# (extractErrorMessage(err), getErrorMessage(err), parseError(err), etc.)
# which are the canonical refactor target.
HARDCODED_ERRORS=$(grep -rn "catch.*{" "$FRONTEND_DIR/src" --include='*.tsx' --include='*.ts' -A5 2>/dev/null | \
  grep -i "setError\|setMessage\|toast" | \
  grep -v 'err\.\|error\.\|\.message\|\.data\|response\|t(\|extractError\|getErrorMessage\|parseError\|formatError\|errorMessage(\|(err)\|(error)' | wc -l)
if [ "$HARDCODED_ERRORS" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$HARDCODED_ERRORS hardcoded error messages" \
    '. + [{"name":"no-hardcoded-error-messages","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$HARDCODED_ERRORS hardcoded error messages — use err.response?.data?.message or t()" \
    '. + [{"name":"no-hardcoded-error-messages","pass":false,"detail":$d,"duration_ms":0}]')
fi

# =============================================================================
# Check 12: API Contract Verification — FE types must match BE entity fields (Layer 5)
# How it works:
#   1. Extract field names from backend entity files (@Column decorated)
#   2. Extract field names from frontend type/interface definitions
#   3. Match by domain name (e.g., project.entity.ts ↔ project types in api.ts)
#   4. FE fields not found in BE = potential runtime undefined errors
# Prevents: A-01~A-08 (field name mismatches like body vs text, pinX vs x)
# =============================================================================
if [ -n "$BACKEND_DIR" ] && [ -n "$FRONTEND_DIR" ]; then
  CONTRACT_MISMATCHES=0
  MISMATCH_DETAIL=""

  # Find all entity files
  for entity_file in $(find "$BACKEND_DIR/src" -name '*.entity.ts' 2>/dev/null); do
    # Extract entity name (e.g., "comment" from "comment.entity.ts")
    ENTITY_NAME=$(basename "$entity_file" .entity.ts | tr '[:upper:]' '[:lower:]')

    # Extract BE field names (lines with @Column or after @Column decorator)
    BE_FIELDS=$(grep -A1 '@Column\|@PrimaryGeneratedColumn\|@CreateDateColumn\|@UpdateDateColumn' "$entity_file" 2>/dev/null | \
      grep -v '@\|--\|^\s*$' | \
      sed -n 's/.*[[:space:]]\([a-zA-Z_][a-zA-Z0-9_]*\)[[:space:]]*[?!]*:.*/\1/p' | sort -u)

    [ -z "$BE_FIELDS" ] && continue

    # Capitalize entity name for PascalCase matching (e.g., "comment" → "Comment")
    ENTITY_PASCAL=$(echo "$ENTITY_NAME" | sed 's/^./\U&/' | sed 's/-./\U&/g; s/-//g')

    # Find matching FE type definitions — exact name match only (not OrganizationProject for "organization")
    FE_TYPE_FILES=$(grep -rlE "interface ${ENTITY_PASCAL} \{|interface ${ENTITY_PASCAL}\{|type ${ENTITY_PASCAL} =|type ${ENTITY_PASCAL}=" "$SRC_DIR" \
      --include='*.ts' --include='*.tsx' 2>/dev/null | head -3)

    for fe_file in $FE_TYPE_FILES; do
      [ -z "$fe_file" ] && continue
      # Skip FE files that are clearly response/auth wrapper types
      fe_basename=$(basename "$fe_file" | tr '[:upper:]' '[:lower:]')
      echo "$fe_basename" | grep -qiE 'response|auth|login|signup|register|token|session' && continue

      # Extract FE field names — exact interface match only
      FE_FIELDS=$(awk "/interface ${ENTITY_PASCAL} \\{|interface ${ENTITY_PASCAL}\\{|type ${ENTITY_PASCAL} =/,/^\}/" "$fe_file" 2>/dev/null | \
        grep -v 'interface\|type\|{' | \
        sed -n 's/[[:space:]]*\([a-zA-Z_][a-zA-Z0-9_]*\)[[:space:]]*[?]*:.*/\1/p' | sort -u)

      [ -z "$FE_FIELDS" ] && continue

      # Compare: FE fields not in BE fields
      for fe_field in $FE_FIELDS; do
        if ! echo "$BE_FIELDS" | grep -qw "$fe_field"; then
          # Skip common FE-only fields (computed/joined/auto-generated)
          echo "$fe_field" | grep -qE '^id$|^createdAt$|^updatedAt$|^deletedAt$' && continue
          # Skip common non-entity fields that appear in response/auth/DTO types
          echo "$fe_field" | grep -qE '^accessToken$|^refreshToken$|^token$|^data$|^message$|^error$|^status$|^statusCode$|^success$|^expiresAt$|^expiresIn$' && continue
          CONTRACT_MISMATCHES=$((CONTRACT_MISMATCHES + 1))
          MISMATCH_DETAIL="$MISMATCH_DETAIL ${ENTITY_NAME}:FE='$fe_field' not in BE;"
        fi
      done
    done
  done

  MISMATCH_DETAIL=$(echo "$MISMATCH_DETAIL" | cut -c1-300)
  # v118: threshold 10 → 2. Tolerating 10 FE-field-not-in-BE mismatches invited
  # exactly the contract drift this check exists to catch (FE renders fields the
  # API never returns). 2 keeps a little slack for the heuristic field matcher.
  if [ "$CONTRACT_MISMATCHES" -le 2 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$CONTRACT_MISMATCHES field mismatches (threshold: 2)${MISMATCH_DETAIL}" \
      '. + [{"name":"api-contract-fields","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$CONTRACT_MISMATCHES mismatches:$MISMATCH_DETAIL" \
      '. + [{"name":"api-contract-fields","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# =============================================================================
# Check 12b: No inline domain interfaces in service files, Redux slices, or page files
# Domain types (entities, query params, create/update payloads, *State) must be in ~/types/{domain}.d.ts
# Only component Props and local UI unions (FilterType, SortType, TabType) may stay inline
# Rule: typescript-standards.md Type Placement Rules, file-organization.md types/ section
# =============================================================================
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

# =============================================================================
# Checks 13-15: Integration completeness (prevents partial wiring)
# Ensures frontend is actually connected to backend, not using mock data
# =============================================================================

# Check 13: Redux slices have functional extraReducers (not placeholder comments)
# Prevents: Slices that look wired but have empty builder callbacks
SLICE_DIR="$SRC_DIR/redux/features"
if [ -d "$SLICE_DIR" ]; then
  SLICE_COUNT=$(find "$SLICE_DIR" -name '*Slice.ts' 2>/dev/null | wc -l | tr -d ' ')
  WIRED_COUNT=$(grep -rl 'builder\.addCase\|builder\.addMatcher' "$SLICE_DIR" --include='*Slice.ts' 2>/dev/null | wc -l | tr -d ' ')
  EMPTY_COUNT=$((SLICE_COUNT - WIRED_COUNT))
  if [ "$EMPTY_COUNT" -le 1 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$WIRED_COUNT/$SLICE_COUNT slices have wired extraReducers" \
      '. + [{"name":"slices-extrareducers-functional","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$EMPTY_COUNT/$SLICE_COUNT slices have empty extraReducers — must wire thunks with builder.addCase" \
      '. + [{"name":"slices-extrareducers-functional","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# Check 14: No hardcoded mock data arrays in page components after integration
# Prevents: Integration phase completing while pages still use fake data
MOCK_IN_PAGES=$(grep -rl 'mockUsers\|mockProjects\|mockData\|sampleData\|dummyData\|fakeDat\|hardcoded' \
  "$SRC_DIR/pages/" --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
if [ "$MOCK_IN_PAGES" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    '. + [{"name":"no-mock-data-after-integration","pass":true,"detail":"no mock data found in pages after integration","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$MOCK_IN_PAGES pages still have hardcoded mock data after integration" \
    '. + [{"name":"no-mock-data-after-integration","pass":false,"detail":$d,"duration_ms":0}]')
fi

# Check 15: Empty state handling in data-displaying pages
# Prevents: Blank screens when API returns empty arrays
EMPTY_STATE_COUNT=$(grep -rl 'length.*===.*0\|\.length.*0\|[Nn]o.*found\|[Ee]mpty.*[Ss]tate\|EmptyState' \
  "$SRC_DIR/pages/" --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
DATA_PAGES=$(grep -rl 'useAppSelector\|useAppDispatch\|dispatch(' "$SRC_DIR/pages/" --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
if [ "$DATA_PAGES" -eq 0 ] || [ "$EMPTY_STATE_COUNT" -ge 1 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$EMPTY_STATE_COUNT/$DATA_PAGES data pages have empty state" \
    '. + [{"name":"empty-state-handling","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "0/$DATA_PAGES data pages have empty state handling" \
    '. + [{"name":"empty-state-handling","pass":false,"detail":$d,"duration_ms":0}]')
fi

# =============================================================================
# Check 16-17: Socket.io client integration (conditional — only when backend has gateway)
# Prevents: Backend WebSocket gateway without frontend socket connection
# =============================================================================
BACKEND_HAS_GATEWAY=0
if [ -n "$BACKEND_DIR" ] && [ -d "$BACKEND_DIR/src" ]; then
  BACKEND_HAS_GATEWAY=$(grep -rl '@WebSocketGateway' "$BACKEND_DIR/src" --include='*.ts' 2>/dev/null | wc -l | tr -d ' ')
fi

if [ "$BACKEND_HAS_GATEWAY" -ge 1 ]; then
  # Check 16: Frontend has socket.io-client integration
  SOCKET_CLIENT=$(grep -rl 'socket\.io-client\|useSocket\|socketService\|SocketContext\|SocketProvider' \
    "$SRC_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$SOCKET_CLIENT" -ge 1 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SOCKET_CLIENT socket client file(s) found" \
      '. + [{"name":"socket-client-integration","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"socket-client-integration","pass":false,"detail":"backend has @WebSocketGateway but frontend has no socket.io-client integration — see react/docs/socket-integration.md","duration_ms":0}]')
  fi

  # Check 17: Socket cleanup exists (socket.off or .disconnect)
  SOCKET_CLEANUP=$(grep -rn 'socket\.off\|\.disconnect()' "$SRC_DIR" --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$SOCKET_CLEANUP" -ge 1 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SOCKET_CLEANUP socket cleanup calls found" \
      '. + [{"name":"socket-cleanup-exists","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
      '. + [{"name":"socket-cleanup-exists","pass":false,"detail":"socket client exists but no socket.off() or .disconnect() cleanup found — memory leak risk","duration_ms":0}]')
  fi
fi

output_results
