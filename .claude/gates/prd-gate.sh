#!/bin/bash
# prd-gate.sh — Deterministic validation for prd phase
# Enforces: all 4 doc files exist with meaningful content (not just placeholders)
source "$(dirname "$0")/_gate-runner.sh"

init_gate "prd" "$1"

DOCS_DIR="$TARGET_DIR/.claude-project/docs"

# --- 0. Stack lock (deterministic — no LLM): the generated PRD/knowledge doc must
# not AFFIRMATIVELY name a stack library that contradicts the declared stack.
# Prose scan is negation-aware so a legit "TanStack ... prohibited" note does not
# false-fail. Lists are data-driven (rules/stacks/stack-lock.json) — generic. ---
source "$(dirname "$0")/lib/stack-lock.lib.sh"
STACK_LOCK_JSON="$(dirname "$0")/../rules/stacks/stack-lock.json"
SL_BACKEND=$(stack_lock_resolve_stack "$TARGET_DIR" backend nestjs)
SL_FRONTEND=$(stack_lock_resolve_stack "$TARGET_DIR" frontend react)
SL_KNOWLEDGE="$TARGET_DIR/.claude-project/$PROJECT_NAME/docs/PROJECT_KNOWLEDGE.md"
stack_lock_emit_prd_check "$SL_KNOWLEDGE" "$STACK_LOCK_JSON" "$SL_BACKEND" "$SL_FRONTEND"

# --- 1. All 4 PRD doc files exist ---
REQUIRED_DOCS=("PROJECT_KNOWLEDGE.md" "PROJECT_API.md" "PROJECT_DATABASE.md")
MISSING=0
for doc in "${REQUIRED_DOCS[@]}"; do
  if [ ! -f "$DOCS_DIR/$doc" ]; then
    MISSING=$((MISSING + 1))
  fi
done

if [ "$MISSING" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "all 3 core docs present" '. + [{"name":"core-docs-exist","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$MISSING of 3 core docs missing" '. + [{"name":"core-docs-exist","pass":false,"detail":$d,"duration_ms":0}]')
fi

# --- 2. PROJECT_KNOWLEDGE.md minimum content (50 lines) ---
KNOWLEDGE="$DOCS_DIR/PROJECT_KNOWLEDGE.md"
if [ -f "$KNOWLEDGE" ]; then
  LINES=$(wc -l < "$KNOWLEDGE" | tr -d ' ')
  if [ "$LINES" -ge 50 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$LINES lines" '. + [{"name":"knowledge-depth","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$LINES lines (need >= 50)" '. + [{"name":"knowledge-depth","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# --- 3. PROJECT_API.md has endpoints (at least 5 HTTP verbs mentioned) ---
API_DOC="$DOCS_DIR/PROJECT_API.md"
if [ -f "$API_DOC" ]; then
  VERB_COUNT=$(grep -cEi '\b(GET|POST|PUT|PATCH|DELETE)\b' "$API_DOC" 2>/dev/null || echo 0)
  VERB_COUNT=$(echo "$VERB_COUNT" | tr -d '[:space:]')
  if [ "${VERB_COUNT:-0}" -ge 5 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$VERB_COUNT HTTP verb mentions" '. + [{"name":"api-endpoints-defined","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$VERB_COUNT HTTP verb mentions (need >= 5)" '. + [{"name":"api-endpoints-defined","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# --- 4. PROJECT_DATABASE.md has entities (at least 3) ---
DB_DOC="$DOCS_DIR/PROJECT_DATABASE.md"
if [ -f "$DB_DOC" ]; then
  # Count entity/table mentions — look for ## headings or "Entity:" / "Table:" patterns
  ENTITY_COUNT=$(grep -cE '^##\s+[A-Z][a-zA-Z]+\s*(Entity|Table)?$|^(Entity|Table):\s+[A-Z]' "$DB_DOC" 2>/dev/null || echo 0)
  ENTITY_COUNT=$(echo "$ENTITY_COUNT" | tr -d '[:space:]')
  if [ "${ENTITY_COUNT:-0}" -ge 3 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$ENTITY_COUNT entities" '. + [{"name":"db-entities-defined","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$ENTITY_COUNT entities (need >= 3)" '. + [{"name":"db-entities-defined","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# --- 5. No template placeholders in any doc ---
PLACEHOLDERS=0
for doc in "${REQUIRED_DOCS[@]}"; do
  if [ -f "$DOCS_DIR/$doc" ] && grep -qE '\{PROJECT_NAME\}|YYYY-MM-DD|<ISO>|\[TODO\]|<PLACEHOLDER>' "$DOCS_DIR/$doc" 2>/dev/null; then
    PLACEHOLDERS=$((PLACEHOLDERS + 1))
  fi
done

if [ "$PLACEHOLDERS" -eq 0 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"no-placeholders","pass":true,"detail":"no template placeholders","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$PLACEHOLDERS docs contain {PROJECT_NAME}/YYYY-MM-DD/TODO/etc" '. + [{"name":"no-placeholders","pass":false,"detail":$d,"duration_ms":0}]')
fi

# --- 6. User stories generated (_index.yaml) — checked here only as advisory.
#       Per .claude/blueprints/prd-2.yaml:167, user-story authorship happens in
#       Phase 3.5 (user-stories-2.yaml), NOT in the prd phase. This check used
#       to fail the prd gate on every greenfield run because the artifact was
#       produced by a later phase. Demoted to advisory: pass when the file
#       exists (resumed/reused project), pass-with-note when absent.
STORIES_INDEX="$TARGET_DIR/.claude-project/$PROJECT_NAME/user_stories/_index.yaml"
if [ -f "$STORIES_INDEX" ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"user-stories-generated","pass":true,"detail":"_index.yaml present","duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"user-stories-generated","pass":true,"detail":"deferred to phase 3.5 (user-stories)","duration_ms":0}]')
fi

output_results
