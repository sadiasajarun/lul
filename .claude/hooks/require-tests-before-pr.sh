#!/bin/bash
# Hook 3: Require tests before PR creation (PreToolUse - Bash gh pr create)
# Exit 2 = block PR, Exit 0 = allow

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
FAILED=0

# Run backend tests if backend exists
if [ -d "$PROJECT_DIR/backend" ] && [ -f "$PROJECT_DIR/backend/package.json" ]; then
  echo "Running backend tests..." >&2
  cd "$PROJECT_DIR/backend"
  if npm test --if-present 2>&1 | tail -10; then
    echo "Backend tests passed." >&2
  else
    echo "Backend tests FAILED." >&2
    FAILED=1
  fi
  cd "$PROJECT_DIR"
fi

# Run frontend tests if frontend exists
if [ -d "$PROJECT_DIR/frontend" ] && [ -f "$PROJECT_DIR/frontend/package.json" ]; then
  echo "Running frontend tests..." >&2
  cd "$PROJECT_DIR/frontend"
  if npm test --if-present 2>&1 | tail -10; then
    echo "Frontend tests passed." >&2
  else
    echo "Frontend tests FAILED." >&2
    FAILED=1
  fi
  cd "$PROJECT_DIR"
fi

if [ "$FAILED" -eq 1 ]; then
  echo "BLOCKED: Tests must pass before creating a PR." >&2
  exit 2
fi

exit 0
