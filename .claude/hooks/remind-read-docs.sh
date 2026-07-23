#!/bin/bash
# remind-read-docs.sh — Generic reminder to read submodule docs before writing code
# PostToolUse hook for Edit|Write
# Reads the CLAUDE.md doc tables to match file patterns → required docs dynamically

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$PROJECT_DIR" ] && exit 0

# Determine which stack the file belongs to
STACK=""
if echo "$FILE_PATH" | grep -q "frontend/"; then
  STACK="frontend"
elif echo "$FILE_PATH" | grep -q "backend/"; then
  STACK="backend"
fi

[ -z "$STACK" ] && exit 0

# Find the relevant submodule docs directory
DOCS_DIR=""
if [ "$STACK" = "frontend" ]; then
  # Look for any react/docs directory under .claude/
  DOCS_DIR=$(find "$PROJECT_DIR/.claude" -type d -name "docs" -path "*/react/*" 2>/dev/null | head -1)
elif [ "$STACK" = "backend" ]; then
  # Look for any nestjs/guides directory under .claude/
  DOCS_DIR=$(find "$PROJECT_DIR/.claude" -type d -name "guides" -path "*/nestjs/*" 2>/dev/null | head -1)
fi

[ -z "$DOCS_DIR" ] && exit 0

# Print a generic reminder with the docs directory
echo "REMINDER: Before writing $STACK code, ensure you have read the relevant doc from $(basename "$(dirname "$DOCS_DIR")")/$(basename "$DOCS_DIR")/. Do NOT generate patterns from memory."

exit 0
