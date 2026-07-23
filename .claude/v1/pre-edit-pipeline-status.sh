#!/bin/bash
# Hook: PreToolUse for Edit/Write on PIPELINE_STATUS.md
# Blocks marking a phase "Complete" if the blueprint wasn't fully executed.
#
# Wire this in .claude/settings.json:
# {
#   "hooks": {
#     "PreToolUse": [{
#       "matcher": "Edit|Write",
#       "hooks": [{
#         "type": "command",
#         "command": ".claude/scripts/pre-edit-pipeline-status.sh"
#       }]
#     }]
#   }
# }

set -uo pipefail
# Intentionally NOT using -e: grep returns exit 1 when no match, which is not an error here

# Read hook payload from stdin
PAYLOAD=$(cat)

# Extract file path from payload (JSON)
FILE_PATH=$(echo "$PAYLOAD" | node -e "
const d = require('fs').readFileSync('/dev/stdin', 'utf8');
try {
  const j = JSON.parse(d);
  console.log(j.tool_input?.file_path || j.tool_input?.filePath || '');
} catch { console.log(''); }
" 2>/dev/null)

# Only enforce on PIPELINE_STATUS.md
if [[ ! "$FILE_PATH" =~ PIPELINE_STATUS\.md$ ]]; then
  exit 0
fi

# Extract the new content being written
NEW_CONTENT=$(echo "$PAYLOAD" | node -e "
const d = require('fs').readFileSync('/dev/stdin', 'utf8');
try {
  const j = JSON.parse(d);
  console.log(j.tool_input?.new_string || j.tool_input?.content || '');
} catch { console.log(''); }
" 2>/dev/null)

# Look for phases being marked Complete in the diff
# Pattern: | phase_name | Complete | ...
PHASES_MARKED_COMPLETE=$(echo "$NEW_CONTENT" | grep -oE '\| (spec|prd|design|database|backend|frontend|integrate|test-api|test-browser|ship|user-stories) \| Complete' 2>/dev/null | awk '{print $2}' || true)

if [ -z "$PHASES_MARKED_COMPLETE" ]; then
  exit 0
fi

# Determine TARGET_DIR from file path
TARGET_DIR=$(echo "$FILE_PATH" | sed 's|/\.claude-project/.*||')

# For each phase being marked complete, verify blueprint state
BLOCKED_PHASES=()
for phase in $PHASES_MARKED_COMPLETE; do
  BLUEPRINT_FILE="$TARGET_DIR/.claude/blueprints/${phase}.yaml"
  STATE_FILE="$TARGET_DIR/.claude-project/status/.blueprint-${phase}.json"
  GATE_PROOF="$TARGET_DIR/.claude-project/status/.gate-proofs/${phase}.proof"

  # Skip if no blueprint exists for this phase
  [ ! -f "$BLUEPRINT_FILE" ] && continue

  # Require blueprint state file
  if [ ! -f "$STATE_FILE" ]; then
    BLOCKED_PHASES+=("$phase: blueprint state file missing ($STATE_FILE)")
    continue
  fi

  # Require gate proof file (fresh within 10 minutes)
  if [ ! -f "$GATE_PROOF" ]; then
    BLOCKED_PHASES+=("$phase: gate proof missing ($GATE_PROOF)")
    continue
  fi

  # Parse state file
  STATUS=$(node -e "
    try {
      const s = JSON.parse(require('fs').readFileSync('$STATE_FILE', 'utf8'));
      const failed = (s.completed_nodes || []).filter(n => n.status === 'FAIL').length;
      const pending = (s.completed_nodes || []).filter(n => n.status === 'PENDING_AGENT').length;
      if (s.status !== 'completed') {
        console.log('NOT_COMPLETED:' + s.status + ' failed=' + failed + ' pending=' + pending);
      } else {
        console.log('OK');
      }
    } catch (e) { console.log('PARSE_ERROR:' + e.message); }
  " 2>/dev/null)

  if [ "$STATUS" != "OK" ]; then
    BLOCKED_PHASES+=("$phase: blueprint $STATUS")
  fi
done

if [ ${#BLOCKED_PHASES[@]} -gt 0 ]; then
  # Output JSON to stderr (Claude Code hook protocol: non-zero exit + stderr = block)
  echo "BLOCKED: Cannot mark phase(s) Complete without blueprint execution + gate proof" >&2
  echo "" >&2
  for msg in "${BLOCKED_PHASES[@]}"; do
    echo "  ❌ $msg" >&2
  done
  echo "" >&2
  echo "Required steps before marking Complete:" >&2
  echo "  1. Run blueprint: npx ts-node .claude/scripts/blueprint-runner.ts <phase> $TARGET_DIR" >&2
  echo "  2. Run gate:      bash .claude/gates/<phase>-gate.sh $TARGET_DIR" >&2
  echo "  3. Verify proof:  test -f .claude-project/status/.gate-proofs/<phase>.proof" >&2
  exit 2  # Exit 2 = hard block in Claude Code hooks
fi

exit 0
