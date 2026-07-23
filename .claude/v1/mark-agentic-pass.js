#!/usr/bin/env node
/**
 * Helper: Mark PENDING_AGENT nodes as PASS in a blueprint state file.
 * Used when the LLM has validated that an agentic node's outputs already exist
 * (e.g., from a prior run) and re-running the agent would be wasteful.
 *
 * Usage:
 *   node mark-agentic-pass.js <blueprint> <node_id> <evidence>
 *
 * Example:
 *   node mark-agentic-pass.js prd prd-generate "validated: PROJECT_KNOWLEDGE.md 560L, API 3182L, DB 1284L, 41 stories"
 */

const fs = require('fs');
const path = require('path');

const [, , blueprint, nodeId, evidence = 'validated by LLM'] = process.argv;

if (!blueprint || !nodeId) {
  console.error('Usage: mark-agentic-pass.js <blueprint> <node_id> [evidence]');
  process.exit(1);
}

const stateFile = path.join(
  process.cwd(),
  '.claude-project',
  'status',
  `.blueprint-${blueprint}.json`
);

if (!fs.existsSync(stateFile)) {
  console.error(`State file not found: ${stateFile}`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
const node = state.completed_nodes.find(n => n.id === nodeId);

if (!node) {
  console.error(`Node not found: ${nodeId}`);
  process.exit(1);
}

if (node.status !== 'PENDING_AGENT') {
  console.error(`Node ${nodeId} is not PENDING_AGENT (status: ${node.status})`);
  process.exit(1);
}

node.status = 'PASS';
node.output = evidence;
node.timestamp = new Date().toISOString();

// Check if all nodes are now resolved
const pending = state.completed_nodes.filter(n => n.status === 'PENDING_AGENT').length;
const failed = state.completed_nodes.filter(n => n.status === 'FAIL').length;

if (pending === 0 && failed === 0) {
  state.status = 'completed';
  state.current_node = null;
  console.log(`✅ Marked ${nodeId} PASS. Blueprint '${blueprint}' is now COMPLETED.`);
} else {
  console.log(`✅ Marked ${nodeId} PASS. Blueprint '${blueprint}' still has ${pending} pending, ${failed} failed.`);
}

fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
