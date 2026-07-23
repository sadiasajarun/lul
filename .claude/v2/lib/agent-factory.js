/**
 * agent-factory.js — picks between Claude Code / OpenCode / Mimo backends
 *
 * Usage in orchestrator.js:
 *   const { runAgentNode, verifyArtifact } = require('./lib/agent-factory');
 *
 * Control via:
 *   - Environment: AGENT_BACKEND=opencode|claude|mimo
 *   - Config: config.agentBackend = 'opencode' | 'claude' | 'mimo'
 *   - Per-node: node.backend = 'opencode' | 'claude' | 'mimo'
 *
 * Priority: node.backend > config.agentBackend > AGENT_BACKEND env > 'claude' (default)
 *
 * Backend list:
 *   - claude:   spawns `claude` subprocess (Claude Code CLI)
 *   - opencode: spawns `opencode run` (CLI) or HTTP to opencode-go zen
 *               endpoint when OPENCODE_TRANSPORT=http
 *   - mimo:     direct HTTPS to Xiaomi MiMo via Anthropic Messages API
 *               (token-plan-sgp.xiaomimimo.com) — see agent-mimo-http.js
 */

const claudeAgent = require('./agent');
const opencodeAgent = require('./agent-opencode');
const mimoAgent = require('./agent-mimo-http');

/**
 * Determine which backend to use for a given node.
 *
 * v91 — MODEL-AGNOSTIC routing. Resolution priority:
 *   1. node.backend           — explicit per-node override (escape hatch, deprecated)
 *   2. AGENT_BACKEND_<intent> — env override per declared intent
 *                               (e.g. AGENT_BACKEND_synthesis=claude)
 *   3. AGENT_BACKEND_<cost>   — env override per declared cost class
 *                               (e.g. AGENT_BACKEND_heavy=claude)
 *   4. config.agentBackend    — cell-level default (from cells.conf)
 *   5. AGENT_BACKEND          — universal env default
 *   6. 'claude'               — fallback if nothing else set
 *
 * Nodes declare INTENT (synthesis/refinement/fix/verification/bulk_fanout) and
 * COST_CLASS (heavy/normal/light) instead of hardcoding a backend. This lets
 * projects swap models freely via env config without editing blueprints.
 */
function getBackend(node, config) {
  // 1. Per-node escape hatch
  if (node?.backend) {
    return node.backend;
  }
  // 2. Intent-based override (model-agnostic policy)
  if (node?.intent) {
    const intentVar = 'AGENT_BACKEND_' + String(node.intent).toLowerCase();
    if (process.env[intentVar]) return process.env[intentVar];
  }
  // 3. Cost-class override (heavy work → higher-quality model)
  if (node?.cost_class) {
    const costVar = 'AGENT_BACKEND_' + String(node.cost_class).toLowerCase();
    if (process.env[costVar]) return process.env[costVar];
  }
  // 4. Cell-level default (cells.conf)
  if (config?.agentBackend) {
    return config.agentBackend;
  }
  // 5. Env default
  if (process.env.AGENT_BACKEND) {
    return process.env.AGENT_BACKEND;
  }
  // 6. Universal fallback
  return 'claude';
}

/**
 * Get the agent module for the specified backend.
 */
function getAgentModule(backend) {
  switch (backend.toLowerCase()) {
    case 'opencode':
    case 'oc':
      return opencodeAgent;
    case 'mimo':
    case 'mimo-xiaomi':
      return mimoAgent;
    case 'claude':
    case 'cc':
    default:
      return claudeAgent;
  }
}

/**
 * Run an agentic node using the appropriate backend.
 */
async function runAgentNode(node, config, projectName, options = {}) {
  const backend = getBackend(node, config);
  const agent = getAgentModule(backend);
  
  console.log(`[agent-factory] backend: ${backend}`);
  
  return agent.runAgentNode(node, config, projectName, options);
}

/**
 * Verify artifact using the appropriate backend.
 * (Currently identical for both, but factory pattern allows future divergence)
 */
function verifyArtifact(node, config, projectName, cellVars = null) {
  const backend = getBackend(node, config);
  const agent = getAgentModule(backend);

  return agent.verifyArtifact(node, config, projectName, cellVars);
}

/**
 * Re-export buildPrompt for compatibility (used by routeToAgent in orchestrator.js)
 */
function buildPrompt(node, config, projectName, retryContext, cellVars = null) {
  const backend = getBackend(node, config);
  const agent = getAgentModule(backend);

  return agent.buildPrompt(node, config, projectName, retryContext, cellVars);
}

module.exports = {
  getBackend,
  getAgentModule,
  runAgentNode,
  verifyArtifact,
  buildPrompt,
};
