#!/usr/bin/env node
/**
 * Claude Agent Runner — uses `claude --print` subprocess to execute agentic nodes
 *
 * This replaces `mark-agentic-pass.js` with REAL agent execution:
 *   - Launches `claude --print` as a subprocess (subscription auth, no API key)
 *   - Scopes tools via --disallowed-tools (strict enforcement)
 *   - Requires the agent to produce a specific output file
 *   - Blocks completion if file doesn't exist or doesn't match verification pattern
 *
 * Usage:
 *   node claude-agent-runner.js <blueprint> <node_id>
 *
 * Each blueprint node that uses this runner must declare in its YAML:
 *   required_output_file: "path/to/result.md"
 *   verification_pattern: "grep regex the file must match"  (optional)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// --- Load yaml (global or local install) ---
let yaml;
try {
  yaml = require('yaml');
} catch {
  try {
    const globalPath = require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim();
    yaml = require(path.join(globalPath, 'yaml'));
  } catch {
    console.error('ERROR: yaml package not found. Install: npm install -g yaml');
    process.exit(1);
  }
}

// --- Helpers ---

function resolveVars(str, targetDir, claudeDir, projectName) {
  return str
    .replace(/\{TARGET_DIR\}/g, targetDir)
    .replace(/\{CLAUDE_DIR\}/g, claudeDir)
    .replace(/\{project\}/g, projectName);
}

function resolveProjectName(targetDir) {
  const statusDir = path.join(targetDir, '.claude-project', 'status');
  if (fs.existsSync(statusDir)) {
    for (const entry of fs.readdirSync(statusDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const statusFile = path.join(statusDir, entry.name, 'PIPELINE_STATUS.md');
        if (fs.existsSync(statusFile)) return entry.name;
      }
    }
  }
  return path.basename(targetDir);
}

function loadBlueprint(blueprintName, claudeDir) {
  const file = path.join(claudeDir, 'blueprints', `${blueprintName}.yaml`);
  if (!fs.existsSync(file)) throw new Error(`Blueprint not found: ${file}`);
  return yaml.parse(fs.readFileSync(file, 'utf-8'));
}

function buildPrompt(node, targetDir, claudeDir, projectName) {
  const parts = [];

  // Inject additional_read files as context
  if (node.context && node.context.additional_read) {
    parts.push('=== CONTEXT FILES ===\n');
    for (const pattern of node.context.additional_read) {
      const resolved = resolveVars(pattern, targetDir, claudeDir, projectName);
      // Simple glob handling
      if (resolved.includes('*')) {
        const dir = path.dirname(resolved);
        const pat = path.basename(resolved).replace(/\*/g, '.*');
        if (fs.existsSync(dir)) {
          for (const f of fs.readdirSync(dir)) {
            if (new RegExp('^' + pat + '$').test(f)) {
              const full = path.join(dir, f);
              if (fs.statSync(full).isFile()) {
                parts.push(`--- ${full} ---\n${fs.readFileSync(full, 'utf-8').slice(0, 5000)}\n`);
              }
            }
          }
        }
      } else if (fs.existsSync(resolved)) {
        parts.push(`--- ${resolved} ---\n${fs.readFileSync(resolved, 'utf-8').slice(0, 5000)}\n`);
      }
    }
    parts.push('\n=== END CONTEXT ===\n\n');
  }

  // The main prompt
  parts.push(resolveVars(node.prompt || '', targetDir, claudeDir, projectName));

  // Artifact contract
  if (node.required_output_file) {
    const requiredPath = resolveVars(node.required_output_file, targetDir, claudeDir, projectName);
    parts.push(`\n\n=== CRITICAL REQUIREMENT ===`);
    parts.push(`You MUST produce a file at: ${requiredPath}`);
    parts.push(`This file will be verified after your run. If it does not exist, the node FAILS.`);
    if (node.verification_pattern) {
      parts.push(`The file must match this pattern: ${node.verification_pattern}`);
    }
    parts.push(`Do not skip this requirement. Do not mark the task complete without creating this file.`);
  }

  return parts.join('\n');
}

function runClaudeAgent(prompt, options) {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--output-format', 'json',
      '--permission-mode', 'bypassPermissions',
    ];

    if (options.allowedTools && options.allowedTools.length) {
      args.push('--allowed-tools', options.allowedTools.join(' '));
    }
    if (options.disallowedTools && options.disallowedTools.length) {
      args.push('--disallowed-tools', options.disallowedTools.join(' '));
    }
    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }
    if (options.maxBudgetUsd) {
      args.push('--max-budget-usd', String(options.maxBudgetUsd));
    }
    if (options.cwd) {
      args.push('--add-dir', options.cwd);
    }

    console.log(`\n[claude-agent-runner] launching: claude ${args.slice(0, 6).join(' ')} ... (prompt: ${prompt.length} chars)`);
    const startTime = Date.now();

    const child = spawn('claude', args, {
      cwd: options.cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.stdin.write(prompt);
    child.stdin.end();

    child.on('close', code => {
      const duration = Date.now() - startTime;
      if (code !== 0) {
        return reject(new Error(`claude exited with code ${code}: ${stderr.slice(-500)}`));
      }
      try {
        const result = JSON.parse(stdout);
        result._duration_ms = duration;
        resolve(result);
      } catch (e) {
        reject(new Error(`failed to parse claude output: ${e.message}\nstdout: ${stdout.slice(-500)}`));
      }
    });

    child.on('error', err => reject(err));
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: claude-agent-runner.js <blueprint> <node_id> [target_dir]');
    process.exit(1);
  }

  const [blueprintName, nodeId, targetDirArg] = args;
  const targetDir = path.resolve(targetDirArg || process.cwd());
  const claudeDir = path.join(targetDir, '.claude');
  const projectName = resolveProjectName(targetDir);

  console.log(`Blueprint: ${blueprintName}`);
  console.log(`Node:      ${nodeId}`);
  console.log(`Target:    ${targetDir}`);
  console.log(`Project:   ${projectName}`);
  console.log('');

  const blueprint = loadBlueprint(blueprintName, claudeDir);
  const node = blueprint.nodes.find(n => n.id === nodeId);
  if (!node) {
    console.error(`Node '${nodeId}' not found in blueprint '${blueprintName}'`);
    process.exit(1);
  }
  if (node.type !== 'agentic') {
    console.error(`Node '${nodeId}' is ${node.type}, not agentic. Use blueprint-runner.js for non-agentic nodes.`);
    process.exit(1);
  }

  // Build the prompt with context + artifact contract
  const prompt = buildPrompt(node, targetDir, claudeDir, projectName);

  // Scope tools
  const scopeGuard = node.scope_guard || {};
  const toolProfile = node.tool_profile || blueprint.tool_profile || {};
  const allowedTools = toolProfile.allow || ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'];
  const disallowedTools = toolProfile.deny || ['WebSearch', 'WebFetch'];

  // Launch claude
  let result;
  try {
    result = await runClaudeAgent(prompt, {
      cwd: targetDir,
      allowedTools,
      disallowedTools,
      maxBudgetUsd: node.max_budget_usd || 2.0,
    });
  } catch (err) {
    console.error(`\n[claude-agent-runner] ERROR: ${err.message}`);
    process.exit(1);
  }

  console.log(`[claude-agent-runner] duration: ${(result._duration_ms / 1000).toFixed(1)}s`);
  console.log(`[claude-agent-runner] turns:    ${result.num_turns}`);
  console.log(`[claude-agent-runner] cost:     $${result.total_cost_usd || 0} (subscription)`);
  console.log(`[claude-agent-runner] result:   ${String(result.result || '').slice(0, 200)}...`);

  // Artifact verification
  if (node.required_output_file) {
    const requiredPath = resolveVars(node.required_output_file, targetDir, claudeDir, projectName);
    if (!fs.existsSync(requiredPath)) {
      console.error(`\n[claude-agent-runner] FAIL: required output file not created`);
      console.error(`  Expected: ${requiredPath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(requiredPath, 'utf-8');
    console.log(`\n[claude-agent-runner] ✓ output file exists: ${requiredPath}`);
    console.log(`  size: ${content.length} bytes`);

    if (node.verification_pattern) {
      const re = new RegExp(node.verification_pattern);
      if (!re.test(content)) {
        console.error(`[claude-agent-runner] FAIL: file content does not match verification pattern`);
        console.error(`  Pattern: ${node.verification_pattern}`);
        console.error(`  First 200 bytes: ${content.slice(0, 200)}`);
        process.exit(1);
      }
      console.log(`  ✓ matches verification pattern`);
    }
  }

  // Update the blueprint state file to mark this node PASS
  const stateFile = path.join(targetDir, '.claude-project', 'status', `.blueprint-${blueprintName}.json`);
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const nodeState = state.completed_nodes.find(n => n.id === nodeId);
    if (nodeState && nodeState.status === 'PENDING_AGENT') {
      nodeState.status = 'PASS';
      nodeState.output = `agent ran in ${result._duration_ms}ms, ${result.num_turns} turns, cost $${result.total_cost_usd || 0}`;
      nodeState.timestamp = new Date().toISOString();

      const pending = state.completed_nodes.filter(n => n.status === 'PENDING_AGENT').length;
      const failed = state.completed_nodes.filter(n => n.status === 'FAIL').length;
      if (pending === 0 && failed === 0) {
        state.status = 'completed';
      }

      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      console.log(`\n[claude-agent-runner] ✓ marked ${nodeId} PASS in ${stateFile}`);
    }
  }

  console.log(`\n[claude-agent-runner] NODE COMPLETE: ${nodeId}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
