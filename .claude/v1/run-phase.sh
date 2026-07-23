#!/bin/bash
# run-phase.sh — Single entry point for phase execution
# Replaces the "LLM reads long MD and decides what to do" pattern with
# "Shell script walks blueprint, LLM fills in agentic node prompts only."
#
# Usage: run-phase.sh <phase_name> <target_dir> [--resume]
#
# What it enforces:
#   1. Blueprint file must exist
#   2. Prerequisites must be complete (checked via gate proofs)
#   3. Blueprint nodes run in order, deterministic ones via shell
#   4. Agentic nodes emit structured prompts for the LLM to execute
#   5. Gate script must run and produce a proof file
#   6. PIPELINE_STATUS.md updated only after all of the above

set -euo pipefail

PHASE="${1:-}"
TARGET_DIR="${2:-$(pwd)}"
RESUME_FLAG=""
[ "${3:-}" = "--resume" ] && RESUME_FLAG="--resume"

if [ -z "$PHASE" ]; then
  echo "Usage: run-phase.sh <phase> <target_dir> [--resume]" >&2
  exit 1
fi

CLAUDE_DIR="$TARGET_DIR/.claude"
BLUEPRINT_FILE="$CLAUDE_DIR/blueprints/${PHASE}.yaml"
GATE_SCRIPT="$CLAUDE_DIR/gates/${PHASE}-gate.sh"
PROOF_FILE="$TARGET_DIR/.claude-project/status/.gate-proofs/${PHASE}.proof"
STATE_FILE="$TARGET_DIR/.claude-project/status/.blueprint-${PHASE}.json"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  PHASE RUNNER: $PHASE"
echo "║  TARGET: $TARGET_DIR"
echo "╚══════════════════════════════════════════════════════════════╝"

# --- Step 1: Verify blueprint exists ---
if [ ! -f "$BLUEPRINT_FILE" ]; then
  echo "ERROR: No blueprint for phase '$PHASE' at $BLUEPRINT_FILE" >&2
  echo "Phases without blueprints: spec, init (these use skill mode)" >&2
  exit 1
fi

echo "✓ Blueprint found: $BLUEPRINT_FILE"

# --- Step 2: Verify prerequisites (via PIPELINE_STATUS.md) ---
# Extract prerequisite phases from blueprint header
PREREQS=$(grep -A5 "^prerequisites:" "$BLUEPRINT_FILE" 2>/dev/null | grep "  -" | sed 's/.*- //' || echo "")

if [ -n "$PREREQS" ]; then
  echo "Checking prerequisites: $PREREQS"
  for prereq in $PREREQS; do
    PREREQ_PROOF="$TARGET_DIR/.claude-project/status/.gate-proofs/${prereq}.proof"
    if [ ! -f "$PREREQ_PROOF" ]; then
      echo "ERROR: Prerequisite '$prereq' has no gate proof" >&2
      echo "  Expected: $PREREQ_PROOF" >&2
      exit 1
    fi
    echo "  ✓ $prereq"
  done
fi

# --- Step 3: Run blueprint-runner ---
echo ""
echo "▶ Running blueprint-runner..."
echo ""

if [ -f "$CLAUDE_DIR/scripts/blueprint-runner.ts" ]; then
  npx ts-node "$CLAUDE_DIR/scripts/blueprint-runner.ts" "$PHASE" "$TARGET_DIR" $RESUME_FLAG
else
  echo "ERROR: blueprint-runner.ts not found" >&2
  exit 1
fi

# --- Step 4: Check blueprint completion status ---
if [ ! -f "$STATE_FILE" ]; then
  echo "ERROR: Blueprint state file not created" >&2
  exit 1
fi

BLUEPRINT_STATUS=$(node -e "
  const s = JSON.parse(require('fs').readFileSync('$STATE_FILE', 'utf8'));
  console.log(s.status);
" 2>/dev/null)

if [ "$BLUEPRINT_STATUS" = "waiting_agent" ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "⏸  PAUSED: Agentic nodes require LLM execution"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  echo "The blueprint-runner output above lists pending agentic nodes."
  echo "Execute each one using the Task/Agent tool with the specified skill and prompt."
  echo "Then re-run:"
  echo "  bash .claude/scripts/run-phase.sh $PHASE $TARGET_DIR --resume"
  exit 0
fi

if [ "$BLUEPRINT_STATUS" != "completed" ]; then
  echo "ERROR: Blueprint status is '$BLUEPRINT_STATUS' (expected 'completed')" >&2
  exit 1
fi

echo ""
echo "✓ Blueprint completed"

# --- Step 5: Run gate script ---
if [ -f "$GATE_SCRIPT" ]; then
  echo ""
  echo "▶ Running gate: $GATE_SCRIPT"
  bash "$GATE_SCRIPT" "$TARGET_DIR"

  if [ ! -f "$PROOF_FILE" ]; then
    echo "ERROR: Gate ran but proof file not created" >&2
    exit 1
  fi

  SCORE=$(grep "^score:" "$PROOF_FILE" | awk '{print $2}')
  PASSED=$(grep "^passed:" "$PROOF_FILE" | awk '{print $2}')

  echo ""
  echo "Gate result: score=$SCORE, passed=$PASSED"

  if [ "$PASSED" != "true" ]; then
    echo "ERROR: Gate FAILED" >&2
    exit 1
  fi
else
  echo "⚠  No gate script for '$PHASE' (expected: $GATE_SCRIPT)"
  echo "   This phase uses evaluation fallback. Score must be computed separately."
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ✅ PHASE '$PHASE' COMPLETE"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Next: Update PIPELINE_STATUS.md (the PreEdit hook will verify state)"
