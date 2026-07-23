#!/bin/bash
# Hook 4: Log every Bash command (PreToolUse - Bash)
# Never blocks — always exit 0

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

if [ -z "$COMMAND" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG_FILE="$PROJECT_DIR/.claude/command-log.txt"

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$TIMESTAMP] [session:${SESSION_ID:0:8}] $COMMAND" >> "$LOG_FILE"

exit 0
