#!/bin/bash
# Per-project OpenCode installer.
# Copies templates from .claude/templates/opencode/ to project root and ensures
# nested submodules (.claude/nestjs, .claude/react, .claude/operations) are
# initialized. Idempotent — re-running is safe.
#
# Usage (from project root, where .claude/ lives as a submodule):
#   bash .claude/scripts/setup-opencode.sh
set -euo pipefail

if [ ! -d .claude ]; then
  echo "ERROR: run this from a project root containing .claude/" >&2
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "WARN: 'opencode' CLI not found on PATH — install it before launching the pipeline." >&2
fi

# 1. Populate nested submodules (.claude/nestjs, .claude/react, .claude/operations).
if git rev-parse --git-dir >/dev/null 2>&1; then
  git submodule update --init --recursive
else
  echo "Not a git repo — skipping submodule init"
fi

# 2. Install slash command at project root where OpenCode looks.
mkdir -p .opencode/commands
cp .claude/templates/opencode/commands/fullstack-2.md .opencode/commands/fullstack-2.md

# 3. Install opencode.json at project root if absent (do not overwrite user edits).
if [ -f opencode.json ]; then
  echo "Skipping opencode.json (already exists)"
else
  cp .claude/templates/opencode/opencode.json opencode.json
fi

# 4. OpenCode reads AGENTS.md natively. Symlink to CLAUDE.md if present and
#    AGENTS.md doesn't already exist.
if [ -f CLAUDE.md ] && [ ! -e AGENTS.md ]; then
  ln -s CLAUDE.md AGENTS.md
  echo "Symlinked AGENTS.md → CLAUDE.md"
fi

cat <<EOF

OpenCode setup complete.

Verify:
  command -v opencode && opencode --version
  cat opencode.json
  ls .opencode/commands/

Configure a default model (one of these):
  - Set in ~/.config/opencode/opencode.json (global default)
  - Or export OPENCODE_DEFAULT_MODEL=anthropic/claude-sonnet-4-5 before launch
  - Or pass --model on launch

Run the pipeline:
  opencode                          # launches TUI
  /fullstack-2 <project> --dry-run  # smoke test
  /fullstack-2 <project> --run-all  # real run

Or run the orchestrator headless (skips the slash command):
  AGENT_BACKEND=opencode \\
  OPENCODE_DEFAULT_MODEL=anthropic/claude-sonnet-4-5 \\
  node .claude/v2/orchestrator.js <project> --phase init
EOF
