#!/bin/bash
# Hook 8: Auto-commit on Stop
# Always exit 0. Creates a commit if there are uncommitted changes.

INPUT=$(cat)

# Prevent infinite loops — if stop hook is already active, skip
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
if [ "$STOP_ACTIVE" = "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
cd "$PROJECT_DIR"

# Check if we're in a git repo
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  exit 0
fi

# Check if there are any changes to commit
CHANGES=$(git status --porcelain 2>/dev/null)
if [ -z "$CHANGES" ]; then
  exit 0
fi

# Stage all changes and commit
TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")

git add -A
git commit -m "chore: auto-commit from Claude Code session [$BRANCH] $TIMESTAMP" --no-verify 2>/dev/null

if [ $? -eq 0 ]; then
  echo "Auto-committed changes on branch '$BRANCH'"
fi

exit 0
