#!/bin/bash
# Hook 6: Auto-lint after file edits (PostToolUse - Edit|Write)
# Always exit 0. Outputs lint errors so the agent can see and fix them.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

EXTENSION="${FILE_PATH##*.}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

case "$EXTENSION" in
  ts|tsx|js|jsx)
    LINT_OUTPUT=""

    # Find eslint binary
    if [ -f "$PROJECT_DIR/node_modules/.bin/eslint" ]; then
      LINT_OUTPUT=$("$PROJECT_DIR/node_modules/.bin/eslint" --fix "$FILE_PATH" 2>&1)
    elif [ -f "$PROJECT_DIR/frontend/node_modules/.bin/eslint" ]; then
      LINT_OUTPUT=$("$PROJECT_DIR/frontend/node_modules/.bin/eslint" --fix "$FILE_PATH" 2>&1)
    elif [ -f "$PROJECT_DIR/backend/node_modules/.bin/eslint" ]; then
      LINT_OUTPUT=$("$PROJECT_DIR/backend/node_modules/.bin/eslint" --fix "$FILE_PATH" 2>&1)
    fi

    # If there are remaining lint errors, output them so agent sees them
    if [ -n "$LINT_OUTPUT" ] && echo "$LINT_OUTPUT" | grep -q "error"; then
      echo "$LINT_OUTPUT" | tail -20
    fi
    ;;
esac

exit 0
