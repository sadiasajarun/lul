#!/bin/bash
# Hook 2: Protect sensitive files (PreToolUse - Edit|Write)
# Exit 2 = block, Exit 0 = allow

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

FILENAME=$(basename "$FILE_PATH")

# Protected file patterns
# Allow .env.example but block all other .env files
if [[ "$FILENAME" == ".env" || ("$FILENAME" == .env.* && "$FILENAME" != ".env.example") ]]; then
  echo "BLOCKED: .env files are protected. Edit manually if needed." >&2
  exit 2
fi

# Block private keys and certificates
if [[ "$FILENAME" == *.pem || "$FILENAME" == *.key || "$FILENAME" == *.p12 || "$FILENAME" == *.pfx ]]; then
  echo "BLOCKED: Private key/certificate files are protected." >&2
  exit 2
fi

# Block lock files
if [[ "$FILENAME" == "package-lock.json" || "$FILENAME" == "pnpm-lock.yaml" || "$FILENAME" == "yarn.lock" ]]; then
  echo "BLOCKED: Lock files should not be edited directly. Use package manager commands." >&2
  exit 2
fi

exit 0
