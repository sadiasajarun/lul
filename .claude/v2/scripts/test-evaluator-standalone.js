#!/usr/bin/env node
/**
 * test-evaluator-standalone.js — runs JUST the design evaluator node.
 *
 * Used to smoke-test lib/evaluator.js against real artifacts without
 * kicking off the entire design phase (which needs PRD, variation
 * approval, and ~30 min of agent time).
 *
 * Run:  node .claude/v2/scripts/test-evaluator-standalone.js [project]
 *
 * Reads artifacts from .claude-project/design/html/*.html and writes
 * .claude-project/status/{project}/design-evaluation.json. Prints a
 * summary of the scores + blockers.
 */

const path = require('path');
const fs = require('fs');
const { findProjectRoot, makeConfig } = require('../lib/config');
const { runEvaluatorNode } = require('../lib/evaluator');
const { createEventStream } = require('../lib/events');

const projectName = process.argv[2] || 'rl-test-project';
const sourceDir = findProjectRoot(process.cwd());
const config = makeConfig(sourceDir);

const statusDir = path.join(config.statusDir, projectName);
if (!fs.existsSync(statusDir)) {
  fs.mkdirSync(statusDir, { recursive: true });
}

config.events = createEventStream(config, projectName, { enabled: false });

const htmlDir = path.join(config.targetDir, '.claude-project', 'design', 'html');
const htmlFiles = fs.existsSync(htmlDir)
  ? fs.readdirSync(htmlDir).filter(f => f.endsWith('.html'))
  : [];

if (htmlFiles.length === 0) {
  console.error(`FATAL: no HTML files found in ${htmlDir}`);
  console.error('The evaluator needs real artifacts to grade. Run the design phase first.');
  process.exit(1);
}

const designSystem = path.join(config.targetDir, '.claude-project', 'design', 'DESIGN_SYSTEM.md');
const domainResearch = path.join(config.targetDir, '.claude-project', 'design', 'DOMAIN_RESEARCH.md');

// Mirror design-2.yaml's evaluator node exactly. Keep defaults permissive so
// the test catches regressions in defaults rather than hiding them.
const node = {
  id: 'design-evaluator-smoke',
  type: 'evaluator',
  description: 'smoke-test the evaluator node against real HTML artifacts',
  rubric_file: '.claude/blueprints/evaluators/design-rubric.yaml',
  required_output_file: `{TARGET_DIR}/.claude-project/status/{project}/design-evaluation.json`,
  verification_pattern: '"overall_score"\\s*:\\s*[0-9.]+',
  tool_profile: {
    allow: ['Read', 'Grep', 'Glob', 'Bash', 'Write'],
    deny: ['Edit', 'NotebookEdit', 'WebFetch', 'WebSearch'],
  },
  inputs: {
    artifacts: ['{TARGET_DIR}/.claude-project/design/html/*.html'],
    references: [
      '{TARGET_DIR}/.claude-project/design/DESIGN_SYSTEM.md',
      '{TARGET_DIR}/.claude-project/design/DOMAIN_RESEARCH.md',
    ],
    max_files: 12,              // cap for smoke — the real node allows 30
    max_chars_per_file: 6000,
  },
  calibration: {
    examples_file: '.claude/blueprints/evaluators/design-examples.yaml',
  },
};

console.log('=== EVALUATOR STANDALONE SMOKE TEST ===');
console.log(`project:       ${projectName}`);
console.log(`source dir:    ${sourceDir}`);
console.log(`target dir:    ${config.targetDir}`);
console.log(`html files:    ${htmlFiles.length} found (will evaluate ${Math.min(12, htmlFiles.length)})`);
console.log(`design system: ${fs.existsSync(designSystem) ? 'present' : 'MISSING'}`);
console.log(`domain doc:    ${fs.existsSync(domainResearch) ? 'present' : 'MISSING'}`);
console.log('');

runEvaluatorNode(node, config, projectName)
  .then(result => {
    console.log('\n=== RESULT ===');
    console.log(`duration:      ${(result._duration_ms / 1000).toFixed(1)}s`);
    console.log(`turns:         ${result.num_turns}`);
    console.log(`cost_usd:      $${(result.total_cost_usd || 0).toFixed(4)}`);
    console.log(`log:           ${path.relative(config.targetDir, result._log_file)}`);

    const ev = result.evaluation;
    if (!ev.valid) {
      console.log('\n❌ EVALUATION INVALID');
      for (const err of ev.errors) console.log(`   - ${err}`);
      process.exit(2);
    }

    const n = ev.normalized;
    console.log('\n=== SCORES ===');
    console.log(`overall (derived):  ${n.overall_score.toFixed(3)}`);
    console.log(`overall (claimed):  ${n.claimed_overall_score != null ? n.claimed_overall_score.toFixed(3) : 'n/a'}`);
    if (n.mismatch_significant) {
      console.log(`⚠  mismatch:        ${n.mismatch.toFixed(3)} (> 0.02, agent arithmetic drift)`);
    }
    console.log('\nweighted_breakdown:');
    for (const [k, v] of Object.entries(n.weighted_breakdown)) {
      console.log(`  ${k.padEnd(14)}: ${v.toFixed(3)}`);
    }

    console.log(`\nblockers:       P0=${n.p0_count}  P1=${n.p1_count}  P2=${n.p2_count}`);
    for (const b of n.blockers) {
      console.log(`  [${b.severity}] ${b.criterion}: ${b.issue}`);
      if (b.location) console.log(`       @ ${b.location}`);
      if (b.suggestion) console.log(`       fix: ${b.suggestion}`);
    }

    console.log('\nrationale:');
    console.log('  ' + n.rationale.split('\n').join('\n  '));

    console.log(`\nfile: ${path.relative(config.targetDir, ev.file_path)}`);
    console.log('\n✅ EVALUATOR SMOKE TEST PASSED');
  })
  .catch(err => {
    console.error('\n❌ EVALUATOR FAILED');
    console.error(err.message);
    if (err.stack) console.error(err.stack.split('\n').slice(1, 5).join('\n'));
    process.exit(3);
  });
