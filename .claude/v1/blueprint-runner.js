#!/usr/bin/env node
/**
 * Blueprint Runner — Code-enforced workflow execution
 *
 * Problem: LLM-based orchestrators can skip blueprint nodes.
 * Solution: This script walks through blueprint YAML nodes sequentially,
 * executes deterministic nodes via shell, and BLOCKS until each completes.
 * Agentic nodes are output as instructions for the LLM to execute.
 *
 * Usage:
 *   node .claude/scripts/blueprint-runner.js <blueprint> <target_dir> [--dry-run] [--resume]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- Load yaml from global install if needed ---
let yaml;
try {
  yaml = require('yaml');
} catch {
  try {
    const globalPath = execSync('npm root -g', { encoding: 'utf-8' }).trim();
    yaml = require(path.join(globalPath, 'yaml'));
  } catch {
    console.error('ERROR: yaml package not found. Install: npm install -g yaml');
    process.exit(1);
  }
}

// --- Helpers ---

function resolveProjectName(targetDir) {
  // Find the project name by scanning .claude-project/status/ for any directory
  // that contains PIPELINE_STATUS.md. Fall back to basename(targetDir).
  const statusDir = path.join(targetDir, '.claude-project', 'status');
  if (fs.existsSync(statusDir)) {
    const entries = fs.readdirSync(statusDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const statusFile = path.join(statusDir, entry.name, 'PIPELINE_STATUS.md');
        if (fs.existsSync(statusFile)) {
          return entry.name;
        }
      }
    }
  }
  return path.basename(targetDir);
}

function resolveVars(str, targetDir, claudeDir) {
  const projectName = resolveProjectName(targetDir);
  return str
    .replace(/\{TARGET_DIR\}/g, targetDir)
    .replace(/\{CLAUDE_DIR\}/g, claudeDir)
    .replace(/\{project\}/g, projectName);
}

function loadBlueprint(name, claudeDir) {
  const blueprintPath = path.join(claudeDir, 'blueprints', `${name}.yaml`);
  if (!fs.existsSync(blueprintPath)) {
    throw new Error(`Blueprint not found: ${blueprintPath}`);
  }
  const content = fs.readFileSync(blueprintPath, 'utf-8');
  return yaml.parse(content);
}

function loadState(stateFile) {
  if (fs.existsSync(stateFile)) {
    return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  }
  return null;
}

function saveState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function checkCondition(condition, targetDir, claudeDir) {
  try {
    const resolved = resolveVars(condition, targetDir, claudeDir);
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
    console.error('Usage: blueprint-runner.js <blueprint> <target-dir> [--dry-run] [--resume]');
    process.exit(1);
  }

  const blueprintName = args[0];
  const targetDir = path.resolve(args[1]);
  const dryRun = args.includes('--dry-run');
  const resume = args.includes('--resume');

  const claudeDir = path.join(targetDir, '.claude');
  if (!fs.existsSync(claudeDir)) {
    console.error(`ERROR: .claude directory not found at ${claudeDir}`);
    process.exit(1);
  }

  const blueprint = loadBlueprint(blueprintName, claudeDir);
  console.log('\n' + '='.repeat(60));
  console.log(`BLUEPRINT: ${blueprint.name || blueprintName}`);
  console.log(`NODES: ${blueprint.nodes.length}`);
  console.log(`TARGET: ${targetDir}`);
  console.log(`MODE: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
  console.log('='.repeat(60) + '\n');

  const stateFile = path.join(targetDir, '.claude-project', 'status', `.blueprint-${blueprintName}.json`);
  let state;

  if (resume) {
    const existing = loadState(stateFile);
    if (existing) {
      state = existing;
      console.log(`Resuming from node: ${state.current_node || 'beginning'}`);
      console.log(`Completed: ${state.completed_nodes.length}/${blueprint.nodes.length}\n`);
    } else {
      state = newState(blueprintName, targetDir);
    }
  } else {
    state = newState(blueprintName, targetDir);
  }

  const completedIds = new Set(
    state.completed_nodes.filter(n => n.status === 'PASS').map(n => n.id)
  );
  let failCount = 0;
  const agenticQueue = [];

  for (let i = 0; i < blueprint.nodes.length; i++) {
    const node = blueprint.nodes[i];

    if (completedIds.has(node.id)) {
      console.log(`[${i + 1}/${blueprint.nodes.length}] ✅ ${node.id} (already completed)`);
      continue;
    }

    state.current_node = node.id;
    saveState(stateFile, state);

    console.log(`[${i + 1}/${blueprint.nodes.length}] ${node.type === 'deterministic' ? '⚙️ ' : '🤖 '}${node.id}`);
    if (node.description) console.log(`  ${node.description}`);

    if (node.condition) {
      const conditionMet = checkCondition(node.condition, targetDir, claudeDir);
      if (!conditionMet) {
        console.log('  ⏭️  SKIPPED (condition not met)\n');
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
        console.log('  ⚠️  No command defined\n');
        continue;
      }

      const resolvedCmd = resolveVars(node.command, targetDir, claudeDir);

      if (dryRun) {
        console.log('  [DRY RUN] Command:');
        console.log('  ' + resolvedCmd.split('\n').slice(0, 3).join('\n  ') + (resolvedCmd.includes('\n') ? '\n  ...' : ''));
        state.completed_nodes.push({
          id: node.id,
          type: node.type,
          status: 'PASS',
          output: '[dry run]',
          timestamp: new Date().toISOString(),
        });
        console.log('');
        continue;
      }

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
            timeout: 300000,
            env: { ...process.env, TARGET_DIR: targetDir },
          }).toString();
          passed = true;
          break;
        } catch (err) {
          lastOutput = (err.stdout || Buffer.from('')).toString();
          lastError = (err.stderr || Buffer.from('')).toString();
          retries--;
          if (retries >= 0) {
            console.log(`  ❌ FAIL (retrying, ${retries + 1} attempts left)`);
          }
        }
      }

      const duration = Date.now() - startTime;

      if (passed) {
        console.log(`  ✅ PASS (${duration}ms)`);
        const preview = lastOutput.trim().split('\n').slice(-2).join('\n    ');
        if (preview) console.log(`    ${preview}`);
        state.completed_nodes.push({
          id: node.id,
          type: node.type,
          status: 'PASS',
          output: lastOutput.slice(-500),
          duration_ms: duration,
          timestamp: new Date().toISOString(),
        });
      } else {
        console.log('  ❌ FAIL');
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
      }
    } else if (node.type === 'agentic') {
      console.log('  🤖 AGENTIC NODE — Requires LLM execution');
      console.log(`  Skill: ${node.skill || 'inline prompt'}`);
      if (node.scope_guard) {
        if (node.scope_guard.allow) console.log(`  Allow: ${node.scope_guard.allow.join(', ')}`);
        if (node.scope_guard.deny) console.log(`  Deny: ${node.scope_guard.deny.join(', ')}`);
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

  console.log('='.repeat(60));
  console.log('BLUEPRINT EXECUTION SUMMARY');
  console.log('='.repeat(60));

  const passed = state.completed_nodes.filter(n => n.status === 'PASS').length;
  const failed = state.completed_nodes.filter(n => n.status === 'FAIL').length;
  const skipped = state.completed_nodes.filter(n => n.status === 'SKIPPED').length;
  const pending = state.completed_nodes.filter(n => n.status === 'PENDING_AGENT').length;

  console.log(`  Total:    ${blueprint.nodes.length}`);
  console.log(`  ✅ Pass:  ${passed}`);
  console.log(`  ❌ Fail:  ${failed}`);
  console.log(`  ⏭️  Skip:  ${skipped}`);
  console.log(`  🤖 Pend:  ${pending} (require LLM agent execution)`);

  if (pending > 0) {
    console.log('\nAGENTIC NODES REQUIRING LLM EXECUTION:');
    console.log('─'.repeat(50));
    for (const { node, index } of agenticQueue) {
      console.log(`\n[${index + 1}] ${node.id}`);
      console.log(`  Skill: ${node.skill || 'N/A'}`);
      if (node.prompt) {
        const preview = node.prompt.trim().slice(0, 200).replace(/\n/g, '\n  ');
        console.log(`  Prompt: ${preview}${node.prompt.length > 200 ? '...' : ''}`);
      }
    }

    state.status = 'waiting_agent';
    console.log('\n⚠️  Run agentic nodes, then: node blueprint-runner.js', blueprintName, targetDir, '--resume');
  } else if (failed > 0) {
    state.status = 'failed';
    console.log('\n❌ BLUEPRINT FAILED');
  } else {
    state.status = 'completed';
    console.log('\n✅ BLUEPRINT COMPLETED');
  }

  saveState(stateFile, state);
}

function newState(blueprintName, targetDir) {
  return {
    blueprint: blueprintName,
    target_dir: targetDir,
    started_at: new Date().toISOString(),
    completed_nodes: [],
    current_node: null,
    status: 'running',
  };
}

main();
