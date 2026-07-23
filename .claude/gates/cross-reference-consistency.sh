#!/bin/bash
# cross-reference-consistency.sh — Layer-spanning drift detection
#
# Runs after database / backend / integrate phases. Verifies that artifacts
# from upstream layers (PRD, PROJECT_API.md, PROJECT_DATABASE.md, HTML
# prototypes) are consistently reflected in downstream code (controllers,
# DTOs, React pages, i18n locale files, http services).
#
# Pure shell + grep, no LLM. When a source-of-truth file is missing, the
# corresponding check is recorded as PASS with a "skipped: <reason>" note —
# the gate is for catching drift in extant artifacts, not for blocking
# phases that haven't run yet. Use `--strict` to invert this.
#
# Usage: bash cross-reference-consistency.sh <target-dir> [project-name]

source "$(dirname "$0")/_gate-runner.sh"

TARGET_DIR="${1:-.}"
PROJECT="${2:-}"
STRICT="${STRICT:-false}"
[ "$3" = "--strict" ] && STRICT="true"

init_gate "cross-reference-consistency" "$TARGET_DIR"

# Resolve canonical paths
DOCS_DIR="$TARGET_DIR/.claude-project/docs"
HTML_DIR="$TARGET_DIR/.claude-project/$PROJECT_NAME/design/html"
BACKEND_SRC="$TARGET_DIR/backend/src"
FRONTEND_DIR=""
for d in "$TARGET_DIR/frontend" "$TARGET_DIR"/frontend-*; do
  if [ -d "$d/src" ] || [ -d "$d/app" ]; then
    FRONTEND_DIR="$d"; break
  fi
done

# Helper: record skip-as-pass when source missing (unless --strict).
skip_or_fail() {
  local name="$1"
  local reason="$2"
  if [ "$STRICT" = "true" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$name" --arg r "$reason" \
      '. + [{"name":$n,"pass":false,"detail":("strict: " + $r),"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$name" --arg r "$reason" \
      '. + [{"name":$n,"pass":true,"detail":("skipped: " + $r),"duration_ms":0}]')
  fi
}

record_check() {
  local name="$1"
  local pass="$2"
  local detail="$3"
  detail=$(echo "$detail" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g' | tr -d '\n' | cut -c1-300)
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$name" --argjson p "$pass" --arg d "$detail" \
    '. + [{"name":$n,"pass":$p,"detail":$d,"duration_ms":0}]')
}

# ----------------------------------------------------------------------------
# Check 1 — Routes (PROJECT_API.md) ↔ Controllers (backend/src/modules)
# ----------------------------------------------------------------------------
check_routes_controllers() {
  local api_md="$DOCS_DIR/PROJECT_API.md"
  if [ ! -f "$api_md" ]; then skip_or_fail "routes-controllers" "PROJECT_API.md missing"; return; fi
  if [ ! -d "$BACKEND_SRC" ]; then skip_or_fail "routes-controllers" "backend/src missing"; return; fi

  # Extract method+path pairs from markdown tables that look like:
  #   | GET    | /api/users        | List users        |
  #   | POST   | /auth/login       | Login             |
  local routes
  routes=$(awk '/^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|/ { print }' "$api_md" \
    | sed -E 's/^\|[[:space:]]*([A-Z]+)[[:space:]]*\|[[:space:]]*([^|[:space:]]+).*/\1 \2/' \
    | sort -u)

  if [ -z "$routes" ]; then
    skip_or_fail "routes-controllers" "no method/path rows found in PROJECT_API.md"
    return
  fi

  local total=0 missing=0 missing_list=""
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    total=$((total + 1))
    local method path
    method=$(echo "$line" | awk '{print $1}')
    path=$(echo "$line" | awk '{print $2}')
    # Strip optional /api prefix and {param} placeholders for grep matching
    local clean
    clean=$(echo "$path" | sed -E 's|^/api||; s|/\{[^}]+\}|/[^/]+|g')
    # Search controllers for the path literal — accept either the full path
    # or its segment after removal of /api prefix.
    local segment
    segment=$(echo "$path" | sed -E 's|^/api/||; s|^/||; s|/\{[^}]+\}.*||; s|/.*||')
    if ! grep -rqE "@(${method}|All|Get|Post|Put|Patch|Delete)\s*\(" "$BACKEND_SRC" 2>/dev/null; then
      # No controllers at all — only flag once
      missing=$((missing + 1))
      missing_list="$missing_list ${method}_${path}"
      continue
    fi
    if [ -n "$segment" ] && ! grep -rq "$segment" "$BACKEND_SRC" 2>/dev/null; then
      missing=$((missing + 1))
      missing_list="$missing_list ${method}_${path}"
    fi
  done <<<"$routes"

  if [ "$missing" -eq 0 ]; then
    record_check "routes-controllers" true "all $total routes mapped"
  else
    record_check "routes-controllers" false "$missing/$total routes missing controllers:$missing_list"
  fi
}

# ----------------------------------------------------------------------------
# Check 2 — Application/state enum (PROJECT_DATABASE.md) ↔ service handlers
# ----------------------------------------------------------------------------
check_states_handlers() {
  local db_md="$DOCS_DIR/PROJECT_DATABASE.md"
  if [ ! -f "$db_md" ]; then skip_or_fail "states-handlers" "PROJECT_DATABASE.md missing"; return; fi
  if [ ! -d "$BACKEND_SRC" ]; then skip_or_fail "states-handlers" "backend/src missing"; return; fi

  # Extract enum-looking values: lower_snake_case identifiers from sections
  # mentioning "enum" or "status" or "state".
  local states
  states=$(awk '/[Ee]num|[Ss]tatus|[Ss]tate/,0' "$db_md" \
    | grep -oE "'[a-z][a-z0-9_]+'" \
    | tr -d "'" \
    | sort -u \
    | head -50)

  if [ -z "$states" ]; then
    skip_or_fail "states-handlers" "no enum/state values detected in PROJECT_DATABASE.md"
    return
  fi

  local total=0 missing=0 missing_list=""
  for s in $states; do
    total=$((total + 1))
    if ! grep -rq "$s" "$BACKEND_SRC" 2>/dev/null; then
      missing=$((missing + 1))
      [ ${#missing_list} -lt 200 ] && missing_list="$missing_list $s"
    fi
  done

  if [ "$missing" -eq 0 ]; then
    record_check "states-handlers" true "all $total state values referenced"
  else
    record_check "states-handlers" false "$missing/$total enum values not referenced in services:$missing_list"
  fi
}

# ----------------------------------------------------------------------------
# Check 3 — HTML prototypes ↔ React page components
# ----------------------------------------------------------------------------
check_html_pages() {
  if [ ! -d "$HTML_DIR" ]; then skip_or_fail "html-pages" "design/html dir missing"; return; fi
  if [ -z "$FRONTEND_DIR" ]; then skip_or_fail "html-pages" "no frontend dir found"; return; fi

  local pages_dir=""
  for d in "$FRONTEND_DIR/src/pages" "$FRONTEND_DIR/app/pages"; do
    [ -d "$d" ] && pages_dir="$d" && break
  done
  if [ -z "$pages_dir" ]; then skip_or_fail "html-pages" "no pages/ dir under frontend"; return; fi

  local total=0 missing=0 missing_list=""
  for html in "$HTML_DIR"/*.html; do
    [ -e "$html" ] || continue
    total=$((total + 1))
    local base
    base=$(basename "$html" .html)
    # Strip leading "NN-" numeric prefix and convert to PascalCase tokens
    local stem
    stem=$(echo "$base" | sed -E 's/^[0-9]+-//' | tr '[:lower:]-' '[:upper:] ' | tr -d ' ')
    # Loose match: any .tsx whose name contains the stem (case-insensitive)
    # or a file whose basename matches the original slug.
    if ! find "$pages_dir" -type f -name '*.tsx' \
      | grep -qiE "(${stem}|$(basename "$html" .html))"; then
      missing=$((missing + 1))
      [ ${#missing_list} -lt 200 ] && missing_list="$missing_list $base"
    fi
  done

  if [ "$total" -eq 0 ]; then
    skip_or_fail "html-pages" "design/html has no .html files"
    return
  fi
  if [ "$missing" -eq 0 ]; then
    record_check "html-pages" true "all $total HTML pages have a matching React component"
  else
    record_check "html-pages" false "$missing/$total HTML pages have no matching .tsx:$missing_list"
  fi
}

# ----------------------------------------------------------------------------
# Check 4 — DB columns (PROJECT_DATABASE.md) ↔ DTOs (backend/src/modules)
# ----------------------------------------------------------------------------
check_columns_dtos() {
  local db_md="$DOCS_DIR/PROJECT_DATABASE.md"
  if [ ! -f "$db_md" ]; then skip_or_fail "columns-dtos" "PROJECT_DATABASE.md missing"; return; fi
  if [ ! -d "$BACKEND_SRC" ]; then skip_or_fail "columns-dtos" "backend/src missing"; return; fi

  # Pull column names from markdown table rows. Filter out boilerplate
  # (id, created_at, updated_at, deleted_at) since BaseEntity owns them.
  local cols
  cols=$(awk '/^\|\s*[a-z_][a-z0-9_]*\s*\|/ { print $2 }' "$db_md" \
    | grep -E '^[a-z_][a-z0-9_]*$' \
    | grep -vE '^(id|created_at|updated_at|deleted_at|column|name)$' \
    | sort -u)

  if [ -z "$cols" ]; then
    skip_or_fail "columns-dtos" "no column names extracted from PROJECT_DATABASE.md"
    return
  fi

  local total=0 missing=0 missing_list=""
  for col in $cols; do
    total=$((total + 1))
    # Convert snake_case to camelCase for DTO field matching
    local camel
    camel=$(echo "$col" | awk -F_ '{ for (i=1;i<=NF;i++) { if (i>1) $i=toupper(substr($i,1,1)) substr($i,2); } printf "%s",$0 }' OFS='')
    # Search DTOs and entities for either form.
    if ! grep -rqE "(\b${col}\b|\b${camel}\b)" "$BACKEND_SRC"/modules 2>/dev/null; then
      missing=$((missing + 1))
      [ ${#missing_list} -lt 200 ] && missing_list="$missing_list $col"
    fi
  done

  if [ "$missing" -eq 0 ]; then
    record_check "columns-dtos" true "all $total non-base columns reachable in modules"
  else
    record_check "columns-dtos" false "$missing/$total columns missing from DTOs/entities:$missing_list"
  fi
}

# ----------------------------------------------------------------------------
# Check 5 — i18n keys ↔ all locale files (parity across declared locales)
# ----------------------------------------------------------------------------
check_i18n_keys() {
  if [ -z "$FRONTEND_DIR" ]; then skip_or_fail "i18n-key-parity" "no frontend dir"; return; fi
  local locales_dir=""
  for d in "$FRONTEND_DIR/public/locales" "$FRONTEND_DIR/src/locales" "$FRONTEND_DIR/app/locales"; do
    [ -d "$d" ] && locales_dir="$d" && break
  done
  if [ -z "$locales_dir" ]; then skip_or_fail "i18n-key-parity" "no locales dir"; return; fi

  # Collect language subdirs (en, ko, ru, vi, etc.)
  local langs
  langs=$(find "$locales_dir" -maxdepth 1 -mindepth 1 -type d -exec basename {} \; | sort)
  local lang_count
  lang_count=$(echo "$langs" | wc -w | tr -d ' ')

  if [ "$lang_count" -lt 2 ]; then
    skip_or_fail "i18n-key-parity" "fewer than 2 locale dirs ($lang_count)"
    return
  fi

  # Build sorted key lists per locale, then compare against the first.
  local first
  first=$(echo "$langs" | head -1)
  local first_keys
  first_keys=$(find "$locales_dir/$first" -name '*.json' -exec cat {} + 2>/dev/null \
    | jq -r 'paths(scalars) | map(tostring) | join(".")' 2>/dev/null \
    | sort -u)

  if [ -z "$first_keys" ]; then
    skip_or_fail "i18n-key-parity" "no keys in '$first' locale"
    return
  fi

  local total_keys
  total_keys=$(echo "$first_keys" | wc -l | tr -d ' ')
  local mismatched_locales=""
  local mismatch_count=0
  for lang in $langs; do
    [ "$lang" = "$first" ] && continue
    local lang_keys
    lang_keys=$(find "$locales_dir/$lang" -name '*.json' -exec cat {} + 2>/dev/null \
      | jq -r 'paths(scalars) | map(tostring) | join(".")' 2>/dev/null \
      | sort -u)
    local missing_in_lang
    missing_in_lang=$(comm -23 <(echo "$first_keys") <(echo "$lang_keys") | wc -l | tr -d ' ')
    if [ "$missing_in_lang" -gt 0 ]; then
      mismatch_count=$((mismatch_count + missing_in_lang))
      mismatched_locales="$mismatched_locales $lang(-$missing_in_lang)"
    fi
  done

  if [ "$mismatch_count" -eq 0 ]; then
    record_check "i18n-key-parity" true "$lang_count locales, $total_keys keys, full parity"
  else
    record_check "i18n-key-parity" false "missing keys across locales:$mismatched_locales"
  fi
}

# ----------------------------------------------------------------------------
# Check 6 — Frontend httpService calls ↔ backend route paths
# ----------------------------------------------------------------------------
check_frontend_routes() {
  if [ -z "$FRONTEND_DIR" ]; then skip_or_fail "frontend-routes" "no frontend dir"; return; fi
  if [ ! -d "$BACKEND_SRC" ]; then skip_or_fail "frontend-routes" "backend/src missing"; return; fi

  local services_dir=""
  for d in "$FRONTEND_DIR/src/services" "$FRONTEND_DIR/app/services"; do
    [ -d "$d" ] && services_dir="$d" && break
  done
  if [ -z "$services_dir" ]; then skip_or_fail "frontend-routes" "no services/ dir"; return; fi

  # Collect URL literals from service files: 'get|post|put|patch|del|delete' + ('/path')
  local fe_paths
  fe_paths=$(grep -rhoE "['\"]/[a-zA-Z0-9_/\\?\\=\\-\\.\\:]+['\"]" "$services_dir" 2>/dev/null \
    | tr -d "\"'" \
    | grep -E '^/' \
    | sort -u)

  if [ -z "$fe_paths" ]; then
    skip_or_fail "frontend-routes" "no URL literals in services/"
    return
  fi

  local total=0 missing=0 missing_list=""
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    total=$((total + 1))
    # Reduce to the unique part: strip /api prefix and template segments.
    local stem
    stem=$(echo "$p" | sed -E 's|^/api||; s|\$\{[^}]+\}|.*|g; s|/[0-9]+|/.*|g')
    # Find a controller path segment that matches.
    local seg
    seg=$(echo "$stem" | awk -F/ '{ for (i=NF;i>0;i--) if ($i != "" && $i !~ /\.\*/) { print $i; exit } }')
    [ -z "$seg" ] && continue
    if ! grep -rq "$seg" "$BACKEND_SRC"/modules 2>/dev/null; then
      missing=$((missing + 1))
      [ ${#missing_list} -lt 200 ] && missing_list="$missing_list $p"
    fi
  done <<<"$fe_paths"

  if [ "$missing" -eq 0 ]; then
    record_check "frontend-routes" true "all $total frontend service paths resolved"
  else
    record_check "frontend-routes" false "$missing/$total frontend paths have no backend match:$missing_list"
  fi
}

# ----------------------------------------------------------------------------
# Check 7 — CORS origin allowlist (backend main.ts) ↔ frontend dev port
#
# Catches the most common CORS bug class: hardcoded port mismatch between
# backend `enableCors({ origin: 'http://localhost:5173' })` and the actual
# Vite dev server port. When fanout cells write these in different cells
# (or one drifts during refactor), browsers block requests at runtime —
# bug surfaces ~3 phases later in test-browser. Catching at integrate
# saves a generation worth of reward penalty.
#
# This is a string-level check; it does NOT spin up servers or simulate a
# browser. Catches the ~80% common case (port mismatch). For wildcard /
# preflight / credentials / dynamic-port issues, layer a runtime smoke
# node on top of this check.
# ----------------------------------------------------------------------------
check_cors_origins() {
  if [ ! -d "$BACKEND_SRC" ]; then skip_or_fail "cors-origin-allowlist" "backend/src missing"; return; fi
  local main_ts="$BACKEND_SRC/main.ts"
  if [ ! -f "$main_ts" ]; then skip_or_fail "cors-origin-allowlist" "main.ts missing"; return; fi
  if [ -z "$FRONTEND_DIR" ]; then skip_or_fail "cors-origin-allowlist" "no frontend dir"; return; fi

  # Pull configured frontend dev port: vite.config.{ts,js} server.port → fallback 5173
  local fe_port
  for cfg in "$FRONTEND_DIR/vite.config.ts" "$FRONTEND_DIR/vite.config.js"; do
    [ -f "$cfg" ] || continue
    fe_port=$(awk '/server\s*[:=]/,/^[[:space:]]*}/' "$cfg" 2>/dev/null \
              | grep -oE 'port\s*:\s*[0-9]+' | grep -oE '[0-9]+' | head -1)
    [ -n "$fe_port" ] && break
  done
  fe_port=${fe_port:-5173}

  # Pull origin allowlist from the enableCors block in main.ts. Span multiple
  # lines because origin is often an array spread across several lines.
  local cors_block
  cors_block=$(awk '/enableCors/{flag=1} flag{print; if(/\)\)?\s*;?\s*$/){flag=0}}' "$main_ts" 2>/dev/null)

  if [ -z "$cors_block" ]; then
    record_check "cors-origin-allowlist" false "main.ts has no enableCors() call — backend will reject browser requests cross-origin"
    return
  fi

  # If the call is `enableCors()` with no args, NestJS defaults to `*`. Treat
  # as acceptable for dev but flag for visibility.
  if echo "$cors_block" | grep -qE 'enableCors\s*\(\s*\)\s*;?'; then
    record_check "cors-origin-allowlist" true "enableCors() with no args (defaults to wildcard — fine for dev, lock down in prod)"
    return
  fi

  # Wildcard origin
  if echo "$cors_block" | grep -qE "origin\s*:\s*['\"]\*['\"]|origin\s*:\s*true"; then
    record_check "cors-origin-allowlist" true "wildcard origin (fine for dev, lock down in prod)"
    return
  fi

  # Specific origins — extract every host:port literal
  local cors_origins
  cors_origins=$(echo "$cors_block" \
                 | grep -oE "(localhost|127\.0\.0\.1|\[::1\]):[0-9]+" \
                 | sort -u | tr '\n' ' ')

  if [ -z "$cors_origins" ]; then
    record_check "cors-origin-allowlist" false "enableCors uses non-localhost origins only — frontend dev server (localhost:$fe_port) will be blocked"
    return
  fi

  if echo "$cors_origins" | grep -qE "(localhost|127\.0\.0\.1|\[::1\]):$fe_port\b"; then
    record_check "cors-origin-allowlist" true "frontend port $fe_port is in CORS origin list ($cors_origins)"
  else
    record_check "cors-origin-allowlist" false "frontend dev port $fe_port is NOT in CORS origin list — main.ts has [$cors_origins], browser will block requests"
  fi
}

# ----------------------------------------------------------------------------
# Run all 7 checks
# ----------------------------------------------------------------------------
check_routes_controllers
check_states_handlers
check_html_pages
check_columns_dtos
check_i18n_keys
check_frontend_routes
check_cors_origins

output_results
