#!/bin/bash
# Hook 5: Auto-format after file edits (PostToolUse - Edit|Write)
# Always exit 0 (PostToolUse cannot block)

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

EXTENSION="${FILE_PATH##*.}"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

case "$EXTENSION" in
  ts|tsx|js|jsx|json|css|md|html)
    # Check if prettier is available in the project
    if [ -f "$PROJECT_DIR/node_modules/.bin/prettier" ]; then
      "$PROJECT_DIR/node_modules/.bin/prettier" --write "$FILE_PATH" 2>/dev/null
    elif [ -f "$PROJECT_DIR/frontend/node_modules/.bin/prettier" ]; then
      "$PROJECT_DIR/frontend/node_modules/.bin/prettier" --write "$FILE_PATH" 2>/dev/null
    elif [ -f "$PROJECT_DIR/backend/node_modules/.bin/prettier" ]; then
      "$PROJECT_DIR/backend/node_modules/.bin/prettier" --write "$FILE_PATH" 2>/dev/null
    elif command -v npx &>/dev/null; then
      npx prettier --write "$FILE_PATH" 2>/dev/null
    fi
    ;;
  py)
    if command -v black &>/dev/null; then
      black --quiet "$FILE_PATH" 2>/dev/null
    fi
    ;;
esac

exit 0
