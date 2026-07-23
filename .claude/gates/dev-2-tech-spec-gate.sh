#!/bin/bash
# dev-2-tech-spec-gate.sh — Deterministic validation for Dev-track Phase D2-tech-spec
# Enforces: 3 PROJECT_*.md docs exist, frontmatter hashes match current inputs,
#           content has minimum depth, PROJECT_API.md has required sections
source "$(dirname "$0")/_gate-runner.sh"

init_gate "D2-tech-spec" "$1"

DOCS_DIR="$TARGET_DIR/.claude-project/docs"
PRD_FILE="$DOCS_DIR/PRD.md"
INTENT_FILE="$TARGET_DIR/.claude-project/$PROJECT_NAME/design/design-intent.yaml"

# --- 1. All 3 docs exist ---
for doc in PROJECT_KNOWLEDGE.md PROJECT_API.md PROJECT_DATABASE.md; do
  file_exists_check "docs-$doc" "$DOCS_DIR/$doc"
done

# --- 2. Compute current hashes from inputs ---
CURRENT_PRD_HASH=""
CURRENT_INTENT_HASH=""
if [ -f "$PRD_FILE" ]; then
  CURRENT_PRD_HASH=$(sed -e 's/[[:space:]]*$//' "$PRD_FILE" | tr -d '\r' | sha256sum | awk '{print $1}')
fi
if [ -f "$INTENT_FILE" ]; then
  CURRENT_INTENT_HASH=$(sha256sum "$INTENT_FILE" | awk '{print $1}')
fi

# --- 3. Frontmatter prd_hash matches current PRD ---
PRD_HASH_MISMATCH=""
for doc in PROJECT_KNOWLEDGE.md PROJECT_API.md PROJECT_DATABASE.md; do
  if [ -f "$DOCS_DIR/$doc" ]; then
    DOC_PRD_HASH=$(awk '/^prd_hash:/{print; exit}' "$DOCS_DIR/$doc" | sed 's/.*"\([a-f0-9]\{64\}\)".*/\1/')
    if [ "$DOC_PRD_HASH" != "$CURRENT_PRD_HASH" ] || [ -z "$DOC_PRD_HASH" ]; then
      PRD_HASH_MISMATCH="$PRD_HASH_MISMATCH $doc"
    fi
  fi
done

if [ -z "$PRD_HASH_MISMATCH" ] && [ -n "$CURRENT_PRD_HASH" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"frontmatter-prd-hash","pass":true,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg m "mismatch:$PRD_HASH_MISMATCH current=$CURRENT_PRD_HASH" '. + [{"name":"frontmatter-prd-hash","pass":false,"detail":$m,"duration_ms":0}]')
fi

# --- 4. Frontmatter intent_hash matches current intent.yaml ---
INTENT_HASH_MISMATCH=""
for doc in PROJECT_KNOWLEDGE.md PROJECT_API.md PROJECT_DATABASE.md; do
  if [ -f "$DOCS_DIR/$doc" ]; then
    DOC_INTENT_HASH=$(awk '/^intent_hash:/{print; exit}' "$DOCS_DIR/$doc" | sed 's/.*"\([a-f0-9]\{64\}\)".*/\1/')
    if [ "$DOC_INTENT_HASH" != "$CURRENT_INTENT_HASH" ] || [ -z "$DOC_INTENT_HASH" ]; then
      INTENT_HASH_MISMATCH="$INTENT_HASH_MISMATCH $doc"
    fi
  fi
done

if [ -z "$INTENT_HASH_MISMATCH" ] && [ -n "$CURRENT_INTENT_HASH" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"frontmatter-intent-hash","pass":true,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg m "mismatch:$INTENT_HASH_MISMATCH current=$CURRENT_INTENT_HASH" '. + [{"name":"frontmatter-intent-hash","pass":false,"detail":$m,"duration_ms":0}]')
fi

# --- 5. PROJECT_KNOWLEDGE.md depth (>= 50 lines) ---
K="$DOCS_DIR/PROJECT_KNOWLEDGE.md"
if [ -f "$K" ]; then
  LINES=$(wc -l < "$K" | tr -d ' ')
  if [ "${LINES:-0}" -ge 50 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$LINES lines" '. + [{"name":"knowledge-depth","pass":true,"detail":$n,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$LINES lines (need >=50)" '. + [{"name":"knowledge-depth","pass":false,"detail":$n,"duration_ms":0}]')
  fi
fi

# --- 6. PROJECT_API.md has >= 5 HTTP verb mentions ---
A="$DOCS_DIR/PROJECT_API.md"
if [ -f "$A" ]; then
  VERB_COUNT=$(grep -cEi '\b(GET|POST|PUT|PATCH|DELETE)\b' "$A" 2>/dev/null || echo 0)
  VERB_COUNT=$(echo "$VERB_COUNT" | tr -d '[:space:]')
  if [ "${VERB_COUNT:-0}" -ge 5 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$VERB_COUNT verb mentions" '. + [{"name":"api-endpoints-count","pass":true,"detail":$n,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$VERB_COUNT verb mentions (need >=5)" '. + [{"name":"api-endpoints-count","pass":false,"detail":$n,"duration_ms":0}]')
  fi
fi

# --- 7. PROJECT_API.md has required sections (Screen↔Endpoints, Endpoint→Screens, Role×Endpoint) ---
if [ -f "$A" ]; then
  MISSING_SECTIONS=""
  grep -qiE '^##\s+Screen\s*(→|->|.)\s*Endpoints' "$A" || MISSING_SECTIONS="$MISSING_SECTIONS Screen→Endpoints"
  grep -qiE '^##\s+Endpoint\s*(→|->|.)\s*Screens' "$A" || MISSING_SECTIONS="$MISSING_SECTIONS Endpoint→Screens"
  grep -qiE '^##.*Role.*[xX×].*Endpoint|Role.*Endpoint.*matrix|authz' "$A" || MISSING_SECTIONS="$MISSING_SECTIONS Role×Endpoint"

  if [ -z "$MISSING_SECTIONS" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"api-sections-present","pass":true,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg m "missing:$MISSING_SECTIONS" '. + [{"name":"api-sections-present","pass":false,"detail":$m,"duration_ms":0}]')
  fi
fi

# --- 8. PROJECT_DATABASE.md has >= 3 entities ---
DB="$DOCS_DIR/PROJECT_DATABASE.md"
if [ -f "$DB" ]; then
  ENTITY_COUNT=$(grep -cE '^##\s+[A-Z][a-zA-Z]+\s*(Entity|Table)?$|^(Entity|Table):\s+[A-Z]' "$DB" 2>/dev/null || echo 0)
  ENTITY_COUNT=$(echo "$ENTITY_COUNT" | tr -d '[:space:]')
  if [ "${ENTITY_COUNT:-0}" -ge 3 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$ENTITY_COUNT entities" '. + [{"name":"db-entities-count","pass":true,"detail":$n,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg n "$ENTITY_COUNT entities (need >=3)" '. + [{"name":"db-entities-count","pass":false,"detail":$n,"duration_ms":0}]')
  fi
fi

# --- 9. No placeholder literals (except in explicit TBD section) ---
PLACEHOLDER_FOUND=""
for doc in PROJECT_KNOWLEDGE.md PROJECT_API.md PROJECT_DATABASE.md; do
  f="$DOCS_DIR/$doc"
  if [ -f "$f" ]; then
    # Exclude lines in a "TBD" section heading onwards
    if awk '/^##\s+(TBD|From intent|Form-derived)/{in_tbd=1} !in_tbd{print}' "$f" | grep -qE '\{PROJECT_NAME\}|YYYY-MM-DD|<PLACEHOLDER>|<ISO>'; then
      PLACEHOLDER_FOUND="$PLACEHOLDER_FOUND $doc"
    fi
  fi
done

if [ -z "$PLACEHOLDER_FOUND" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-placeholders","pass":true,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg m "placeholders in:$PLACEHOLDER_FOUND" '. + [{"name":"no-placeholders","pass":false,"detail":$m,"duration_ms":0}]')
fi

output_results
