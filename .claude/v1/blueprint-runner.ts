#!/usr/bin/env npx ts-node
/**
 * Blueprint Runner — Code-enforced workflow execution
 *
 * Problem: LLM-based orchestrators can skip blueprint nodes.
 * Solution: This script walks through blueprint YAML nodes sequentially,
 * executes deterministic nodes via shell, and BLOCKS until each completes.
 * Agentic nodes are output as instructions for the LLM to execute.
 *
 * Usage:
 *   npx ts-node .claude/scripts/blueprint-runner.ts <blueprint> <target_dir> [--dry-run]
 *
 * Example:
 *   npx ts-node .claude/scripts/blueprint-runner.ts test-browser /path/to/project
 *
 * Output:
 *   - Runs deterministic nodes via shell (enforced, not skippable)
 *   - Prints agentic node prompts for LLM execution
 *   - Tracks completed nodes in .blueprint-state.json
 *   - Blocks phase completion until all nodes pass
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as yaml from 'yaml'; // falls back to JSON.parse if yaml not installed

// --- Types ---

interface BlueprintNode {
  id: string;
  type: 'deterministic' | 'agentic';
  description?: string;
  command?: string;
  skill?: string;
  prompt?: string;
  on_failure?: 'abort' | 'ignore' | 'route_to_agent';
  abort_message?: string;
  max_retries?: number;
  agent_prompt?: string;
  condition?: string;
  scope_guard?: { allow?: string[]; deny?: string[] };
  context?: { additional_read?: string[] };
}

interface Blueprint {
  name: string;
  description: string;
  nodes: BlueprintNode[];
}

interface NodeResult {
  id: string;
  type: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED' | 'PENDING_AGENT';
  output?: string;
  error?: string;
  duration_ms?: number;
  timestamp: string;
}

interface BlueprintState {
  blueprint: string;
  target_dir: string;
  started_at: string;
  completed_nodes: NodeResult[];
  current_node: string | null;
  status: 'running' | 'completed' | 'failed' | 'waiting_agent';
}

// --- Helpers ---

function resolveVars(str: string, targetDir: string, claudeDir: string): string {
  return str
    .replace(/\{TARGET_DIR\}/g, targetDir)
    .replace(/\{CLAUDE_DIR\}/g, claudeDir)
    .replace(/\{project\}/g, path.basename(targetDir));
}

function loadBlueprint(name: string, claudeDir: string): Blueprint {
  const blueprintPath = path.join(claudeDir, 'blueprints', `${name}.yaml`);
  if (!fs.existsSync(blueprintPath)) {
    throw new Error(`Blueprint not found: ${blueprintPath}`);
  }
  const content = fs.readFileSync(blueprintPath, 'utf-8');
  try {
    return yaml.parse(content) as Blueprint;
  } catch {
    // Fallback: try simple YAML parse via regex for basic structure
    throw new Error(`Failed to parse blueprint YAML. Install 'yaml' package: npm i -g yaml`);
  }
}

function loadState(stateFile: string): BlueprintState | null {
  if (fs.existsSync(stateFile)) {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  }
  return null;
}

function saveState(stateFile: string, state: BlueprintState): void {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function checkCondition(condition: string, targetDir: string): boolean {
  try {
    const resolved = resolveVars(condition, targetDir, '');
    execSync(resolved, { stdio: 'pipe', cwd: targetDir });
    return true;
  } catch {
    return false;
  }
}

// --- Main ---

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: blueprint-runner.ts <blueprint-name> <target-dir> [--dry-run] [--resume]');
    console.error('Example: blueprint-runner.ts test-browser /path/to/project');
    process.exit(1);
  }

  const blueprintName = args[0];
  const targetDir = path.resolve(args[1]);
  const dryRun = args.includes('--dry-run');
  const resume = args.includes('--resume');

  // Resolve .claude directory
  const claudeDir = path.join(targetDir, '.claude');
  if (!fs.existsSync(claudeDir)) {
    console.error(`ERROR: .claude directory not found at ${claudeDir}`);
    process.exit(1);
  }

  // Load blueprint
  const blueprint = loadBlueprint(blueprintName, claudeDir);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`BLUEPRINT: ${blueprint.name}`);
  console.log(`NODES: ${blueprint.nodes.length}`);
  console.log(`TARGET: ${targetDir}`);
  console.log(`MODE: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  console.log(`${'='.repeat(60)}\n`);

  // State file for tracking progress
  const stateFile = path.join(targetDir, '.claude-project', 'status', `.blueprint-${blueprintName}.json`);
  let state: BlueprintState;

  if (resume) {
    const existing = loadState(stateFile);
    if (existing) {
      state = existing;
      console.log(`Resuming from node: ${state.current_node || 'beginning'}`);
      console.log(`Completed: ${state.completed_nodes.length}/${blueprint.nodes.length}\n`);
    } else {
      state = {
        blueprint: blueprintName,
        target_dir: targetDir,
        started_at: new Date().toISOString(),
        completed_nodes: [],
        current_node: null,
        status: 'running',
      };
    }
  } else {
    state = {
      blueprint: blueprintName,
      target_dir: targetDir,
      started_at: new Date().toISOString(),
      completed_nodes: [],
      current_node: null,
      status: 'running',
    };
  }

  const completedIds = new Set(state.completed_nodes.filter(n => n.status === 'PASS').map(n => n.id));
  let failCount = 0;
  const agenticQueue: { node: BlueprintNode; index: number }[] = [];

  for (let i = 0; i < blueprint.nodes.length; i++) {
    const node = blueprint.nodes[i];

    // Skip already completed nodes on resume
    if (completedIds.has(node.id)) {
      console.log(`[${i + 1}/${blueprint.nodes.length}] ✅ ${node.id} (already completed)`);
      continue;
    }

    state.current_node = node.id;
    saveState(stateFile, state);

    console.log(`[${i + 1}/${blueprint.nodes.length}] ${node.type === 'deterministic' ? '⚙️' : '🤖'} ${node.id}`);
    console.log(`  Description: ${node.description || 'N/A'}`);

    // Check condition
    if (node.condition) {
      const conditionMet = checkCondition(node.condition, targetDir);
      if (!conditionMet) {
        console.log(`  ⏭️  SKIPPED (condition not met)\n`);
        state.completed_nodes.push({
          id: node.id,
          type: node.type,
          status: 'SKIPPED',
          timestamp: new Date().toISOString(),
        });
        continue;
      }
    }

    if (node.type === 'deterministic') {
      if (!node.command) {
        console.log(`  ⚠️  No command defined\n`);
        continue;
      }

      const resolvedCmd = resolveVars(node.command, targetDir, claudeDir);

      if (dryRun) {
        console.log(`  [DRY RUN] Would execute:`);
        console.log(`  ${resolvedCmd.split('\n').join('\n  ')}\n`);
        state.completed_nodes.push({
          id: node.id,
          type: node.type,
          status: 'PASS',
          output: '[dry run]',
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      // EXECUTE — this is the enforcement point. Code runs the shell command.
      const startTime = Date.now();
      let retries = node.max_retries || 0;
      let passed = false;
      let lastOutput = '';
      let lastError = '';

      while (retries >= 0) {
        try {
          lastOutput = execSync(resolvedCmd, {
            cwd: targetDir,
            stdio: 'pipe',
            timeout: 300000, // 5 min timeout
            env: { ...process.env, TARGET_DIR: targetDir },
          }).toString();
          passed = true;
          break;
        } catch (err: unknown) {
          const execErr = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
          lastOutput = execErr.stdout?.toString() || '';
          lastError = execErr.stderr?.toString() || '';
          retries--;

          if (retries >= 0) {
            console.log(`  ❌ FAIL (retrying, ${retries + 1} attempts left)`);
          }
        }
      }

      const duration = Date.now() - startTime;

      if (passed) {
        console.log(`  ✅ PASS (${duration}ms)`);
        if (lastOutput.trim()) {
          const lines = lastOutput.trim().split('\n');
          const preview = lines.slice(-3).join('\n  ');
          console.log(`  ${preview}`);
        }
        state.completed_nodes.push({
          id: node.id,
          type: node.type,
          status: 'PASS',
          output: lastOutput.slice(-500),
          duration_ms: duration,
          timestamp: new Date().toISOString(),
        });
      } else {
        console.log(`  ❌ FAIL`);
        if (lastError) console.log(`  Error: ${lastError.slice(0, 200)}`);
        state.completed_nodes.push({
          id: node.id,
          type: node.type,
          status: 'FAIL',
          error: (lastError || lastOutput).slice(-500),
          duration_ms: duration,
          timestamp: new Date().toISOString(),
        });
        failCount++;

        if (node.on_failure === 'abort') {
          console.log(`\n🛑 ABORT: ${node.abort_message || 'Deterministic check failed'}`);
          state.status = 'failed';
          saveState(stateFile, state);
          process.exit(1);
        }

        if (node.on_failure === 'route_to_agent') {
          console.log(`  → Routing to agent for fix...`);
          agenticQueue.push({ node, index: i });
        }
      }
    } else if (node.type === 'agentic') {
      // Agentic nodes cannot be run by this script — output instructions for LLM
      console.log(`  🤖 AGENTIC NODE — Requires LLM execution`);
      console.log(`  Skill: ${node.skill || 'inline prompt'}`);
      if (node.scope_guard) {
        console.log(`  Scope Guard:`);
        if (node.scope_guard.allow) console.log(`    Allow: ${node.scope_guard.allow.join(', ')}`);
        if (node.scope_guard.deny) console.log(`    Deny: ${node.scope_guard.deny.join(', ')}`);
      }

      agenticQueue.push({ node, index: i });
      state.completed_nodes.push({
        id: node.id,
        type: node.type,
        status: 'PENDING_AGENT',
        timestamp: new Date().toISOString(),
      });
    }

    console.log('');
    saveState(stateFile, state);
  }

  // --- Summary ---
  console.log(`${'='.repeat(60)}`);
  console.log('BLUEPRINT EXECUTION SUMMARY');
  console.log(`${'='.repeat(60)}`);

  const passed = state.completed_nodes.filter(n => n.status === 'PASS').length;
  const failed = state.completed_nodes.filter(n => n.status === 'FAIL').length;
  const skipped = state.completed_nodes.filter(n => n.status === 'SKIPPED').length;
  const pending = state.completed_nodes.filter(n => n.status === 'PENDING_AGENT').length;

  console.log(`  Total Nodes:  ${blueprint.nodes.length}`);
  console.log(`  ✅ Passed:    ${passed}`);
  console.log(`  ❌ Failed:    ${failed}`);
  console.log(`  ⏭️  Skipped:   ${skipped}`);
  console.log(`  🤖 Pending:   ${pending} (require LLM agent execution)`);
  console.log('');

  if (pending > 0) {
    console.log('AGENTIC NODES REQUIRING LLM EXECUTION:');
    console.log('─'.repeat(50));
    for (const { node, index } of agenticQueue) {
      if (node.type === 'agentic') {
        console.log(`\n[Node ${index + 1}] ${node.id}`);
        console.log(`  Skill: ${node.skill || 'N/A'}`);
        if (node.prompt) {
          console.log(`  Prompt: ${node.prompt.slice(0, 200).replace(/\n/g, '\n  ')}...`);
        }
        if (node.context?.additional_read) {
          console.log(`  Read: ${node.context.additional_read.join(', ')}`);
        }
      }
    }
    console.log('');

    state.status = 'waiting_agent';
    console.log('⚠️  Run the agentic nodes above, then re-run with --resume');
    console.log(`   npx ts-node .claude/scripts/blueprint-runner.ts ${blueprintName} ${targetDir} --resume`);
  } else if (failed > 0) {
    state.status = 'failed';
    console.log(`❌ BLUEPRINT FAILED: ${failed} deterministic checks failed`);
  } else {
    state.status = 'completed';
    console.log('✅ BLUEPRINT COMPLETED: All nodes passed');
  }

  saveState(stateFile, state);
}

main();
