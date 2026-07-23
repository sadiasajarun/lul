#!/bin/bash
# Hook: SessionStart — inject pipeline state at session start
# Shows the LLM which phases are in-progress and what blueprint nodes are pending.
# This pushes the pipeline state into the LLM's attention without competing with
# a 500-line orchestrator document.
#
# Wire in .claude/settings.json:
# {
#   "hooks": {
#     "SessionStart": [{
#       "hooks": [{
#         "type": "command",
#         "command": ".claude/scripts/session-start-pipeline-state.sh"
#       }]
#     }]
#   }
# }

set -euo pipefail

TARGET_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
STATUS_DIR="$TARGET_DIR/.claude-project/status"

# Find any in-progress blueprint state files
if [ ! -d "$STATUS_DIR" ]; then
  exit 0
fi

PENDING_BLUEPRINTS=$(find "$STATUS_DIR" -name ".blueprint-*.json" 2>/dev/null)

if [ -z "$PENDING_BLUEPRINTS" ]; then
  exit 0
fi

OUTPUT=""
for state_file in $PENDING_BLUEPRINTS; do
  phase=$(basename "$state_file" | sed 's/^\.blueprint-//;s/\.json$//')

  STATE_INFO=$(node -e "
    try {
      const s = JSON.parse(require('fs').readFileSync('$state_file', 'utf8'));
      const nodes = s.completed_nodes || [];
      const passed = nodes.filter(n => n.status === 'PASS').length;
      const failed = nodes.filter(n => n.status === 'FAIL').length;
      const pending = nodes.filter(n => n.status === 'PENDING_AGENT').length;
      const skipped = nodes.filter(n => n.status === 'SKIPPED').length;
      console.log(JSON.stringify({
        status: s.status,
        passed, failed, pending, skipped,
        pending_ids: nodes.filter(n => n.status === 'PENDING_AGENT').map(n => n.id)
      }));
    } catch (e) { console.log('{}'); }
  " 2>/dev/null)

  STATUS=$(echo "$STATE_INFO" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');try{console.log(JSON.parse(d).status||'unknown')}catch{console.log('unknown')}")

  if [ "$STATUS" = "completed" ]; then
    continue
  fi

  PENDING_IDS=$(echo "$STATE_INFO" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');try{console.log((JSON.parse(d).pending_ids||[]).join(', '))}catch{console.log('')}")
  PASSED=$(echo "$STATE_INFO" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');try{console.log(JSON.parse(d).passed||0)}catch{console.log(0)}")
  FAILED=$(echo "$STATE_INFO" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');try{console.log(JSON.parse(d).failed||0)}catch{console.log(0)}")

  OUTPUT+="Phase '$phase' blueprint: status=$STATUS, passed=$PASSED, failed=$FAILED\n"
  if [ -n "$PENDING_IDS" ]; then
    OUTPUT+="  Pending agentic nodes: $PENDING_IDS\n"
    OUTPUT+="  → Resume with: npx ts-node .claude/scripts/blueprint-runner.ts $phase $TARGET_DIR --resume\n"
  fi
done

if [ -n "$OUTPUT" ]; then
  # Claude Code SessionStart hook: stdout is injected into session context
  echo "=== PIPELINE STATE ==="
  echo -e "$OUTPUT"
  echo "⚠️  Blueprint execution is IN PROGRESS. Do NOT start new phases until these complete."
  echo "⚠️  Do NOT mark any phase 'Complete' in PIPELINE_STATUS.md without matching blueprint state."
fi

exit 0
