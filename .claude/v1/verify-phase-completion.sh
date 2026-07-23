#!/bin/bash
# verify-phase-completion.sh — Enforces blueprint completion before phase status update
#
# Called by Claude Code hook (PreEdit) when PIPELINE_STATUS.md is being modified.
# Blocks the edit if the phase is being marked "Complete" but the blueprint wasn't fully executed.
#
# Usage: verify-phase-completion.sh <target_dir> <phase_name>
#
# Exit 0 = allow, Exit 1 = block

set -euo pipefail

TARGET_DIR="${1:-.}"
PHASE_NAME="${2:-}"

if [ -z "$PHASE_NAME" ]; then
  echo "Usage: verify-phase-completion.sh <target_dir> <phase_name>"
  exit 1
fi

CLAUDE_DIR="$TARGET_DIR/.claude"
BLUEPRINT_FILE="$CLAUDE_DIR/blueprints/${PHASE_NAME}.yaml"
STATE_FILE="$TARGET_DIR/.claude-project/status/.blueprint-${PHASE_NAME}.json"

echo "=== Phase Completion Verification: $PHASE_NAME ==="

# --- Check 1: Does a blueprint exist for this phase? ---
if [ ! -f "$BLUEPRINT_FILE" ]; then
  echo "No blueprint for phase '$PHASE_NAME' — skipping enforcement"
  exit 0
fi

# --- Check 2: Was the blueprint runner executed? ---
if [ ! -f "$STATE_FILE" ]; then
  echo "BLOCKED: Blueprint state file not found: $STATE_FILE"
  echo "The blueprint-runner was never executed for this phase."
  echo ""
  echo "Run: npx ts-node .claude/scripts/blueprint-runner.ts $PHASE_NAME $TARGET_DIR"
  exit 1
fi

# --- Check 3: Parse blueprint state and check completion ---
STATUS=$(node -e "
const state = JSON.parse(require('fs').readFileSync('$STATE_FILE', 'utf-8'));
const nodes = state.completed_nodes || [];
const failed = nodes.filter(n => n.status === 'FAIL').length;
const pending = nodes.filter(n => n.status === 'PENDING_AGENT').length;
const total = nodes.length;
const passed = nodes.filter(n => n.status === 'PASS' || n.status === 'SKIPPED').length;

console.log(JSON.stringify({
  status: state.status,
  total,
  passed,
  failed,
  pending,
  completed_ids: nodes.filter(n => n.status === 'PASS' || n.status === 'SKIPPED').map(n => n.id)
}));
" 2>/dev/null)

if [ -z "$STATUS" ]; then
  echo "BLOCKED: Could not parse blueprint state file"
  exit 1
fi

BLUEPRINT_STATUS=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).status)")
FAILED=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).failed)")
PENDING=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.parse(d).pending)")

if [ "$BLUEPRINT_STATUS" = "completed" ]; then
  echo "✅ Blueprint completed — phase can be marked Complete"
  exit 0
fi

if [ "$FAILED" -gt 0 ]; then
  echo "BLOCKED: $FAILED blueprint nodes FAILED"
  echo "Fix failures and re-run blueprint-runner with --resume"
  exit 1
fi

if [ "$PENDING" -gt 0 ]; then
  echo "BLOCKED: $PENDING agentic nodes still PENDING"
  echo "Execute pending agents and update state, then re-run with --resume"
  exit 1
fi

echo "BLOCKED: Blueprint status is '$BLUEPRINT_STATUS' (expected 'completed')"
exit 1
