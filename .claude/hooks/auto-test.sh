#!/bin/bash
# Hook 7: Auto-test after file edits (PostToolUse - Edit|Write)
# Always exit 0. Outputs test results so agent can see failures.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Only run tests for source code files
EXTENSION="${FILE_PATH##*.}"
case "$EXTENSION" in
  ts|tsx|js|jsx) ;;
  *) exit 0 ;;
esac

# Determine which project the file belongs to and run its tests
if [[ "$FILE_PATH" == *"/backend/"* ]] || [[ "$FILE_PATH" == *"/backend/src/"* ]]; then
  if [ -f "$PROJECT_DIR/backend/package.json" ]; then
    cd "$PROJECT_DIR/backend"
    TEST_OUTPUT=$(npm test -- --passWithNoTests 2>&1 | tail -5)
    if [ -n "$TEST_OUTPUT" ]; then
      echo "[auto-test] Backend: $TEST_OUTPUT"
    fi
  fi
elif [[ "$FILE_PATH" == *"/frontend/"* ]] || [[ "$FILE_PATH" == *"/frontend/app/"* ]]; then
  if [ -f "$PROJECT_DIR/frontend/package.json" ]; then
    cd "$PROJECT_DIR/frontend"
    TEST_OUTPUT=$(npm test -- --passWithNoTests 2>&1 | tail -5)
    if [ -n "$TEST_OUTPUT" ]; then
      echo "[auto-test] Frontend: $TEST_OUTPUT"
    fi
  fi
fi

exit 0
