#!/bin/bash
# Hook 1: Block dangerous commands (PreToolUse - Bash)
# Exit 2 = block, Exit 0 = allow

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Dangerous patterns
DANGEROUS_PATTERNS=(
  'rm -rf /'
  'rm -rf /*'
  'rm -rf ~'
  'rm -rf ~/'
  'git reset --hard'
  'git push --force'
  'git push -f'
  'git clean -fd'
  'DROP TABLE'
  'DROP DATABASE'
  'TRUNCATE TABLE'
  ':(){ :|:& };:'
  'mkfs.'
  'dd if='
  '> /dev/sda'
  'chmod -R 777 /'
  'chown -R'
)

COMMAND_UPPER=$(echo "$COMMAND" | tr '[:lower:]' '[:upper:]')

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  PATTERN_UPPER=$(echo "$pattern" | tr '[:lower:]' '[:upper:]')
  if [[ "$COMMAND_UPPER" == *"$PATTERN_UPPER"* ]]; then
    echo "BLOCKED: Dangerous command detected -> '$pattern'" >&2
    echo "Command was: $COMMAND" >&2
    exit 2
  fi
done

exit 0
