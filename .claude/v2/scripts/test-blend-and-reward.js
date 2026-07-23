#!/usr/bin/env node
/**
 * test-blend-and-reward.js — exercises the post-evaluator integration.
 *
 * Step 9 smoke-tested the evaluator subprocess. This script tests the code
 * paths that consume its output: runGateWithBlend, the evaluator_score
 * event, and reward.js drift penalties. Uses the real design-evaluation.json
 * written by the prior smoke test, so it costs nothing.
 *
 * Run:  node .claude/v2/scripts/test-blend-and-reward.js [project]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { findProjectRoot, makeConfig } = require('../lib/config');
const { runGateWithBlend, blendScores, hasGate } = require('../lib/gate');
const { createEventStream, readEpisode } = require('../lib/events');
const { computePhaseReward } = require('../lib/reward');

const projectName = process.argv[2] || 'rl-test-project';
const sourceDir = findProjectRoot(process.cwd());
const config = makeConfig(sourceDir);

console.log('=== BLEND + REWARD INTEGRATION TEST ===');
console.log(`project: ${projectName}\n`);

// ---------------------------------------------------------------------------
// 1. The evaluation.json from Step 9 must be on disk.
// ---------------------------------------------------------------------------

const evalPath = path.join(config.statusDir, projectName, 'design-evaluation.json');
if (!fs.existsSync(evalPath)) {
  console.error(`FATAL: ${evalPath} missing.`);
  console.error('Run `node .claude/v2/scripts/test-evaluator-standalone.js` first.');
  process.exit(1);
}
const evaluation = JSON.parse(fs.readFileSync(evalPath, 'utf-8'));
console.log('--- 1. Evaluation on disk ---');
console.log(`  overall_score: ${evaluation.overall_score}`);
console.log(`  p0_count:      ${evaluation.p0_count}`);
console.log(`  p1_count:      ${evaluation.p1_count}`);

// ---------------------------------------------------------------------------
// 2. blendScores with various deterministic inputs + the real evaluation.
// ---------------------------------------------------------------------------

console.log('\n--- 2. Blend logic against real evaluation ---');

function reportBlend(label, gateScore, gatePassed, blendConfig) {
  const r = blendScores(gateScore, gatePassed, evaluation, blendConfig);
  console.log(`  ${label}`);
  console.log(`    strategy=${r.blend_strategy}  det=${r.deterministic_score.toFixed(3)}  eval=${r.evaluator_score.toFixed(3)}  blended=${r.blended_score.toFixed(3)}  passed=${r.final_passed}  p0=${r.p0_blockers}`);
  console.log(`    ${r.details}`);
  return r;
}

// Expected values derived from the on-disk evaluation so the test stays
// correct as the evaluator regenerates it across runs.
const evalScore = evaluation.overall_score;
const evalP0 = evaluation.p0_count || 0;

// Scenario A — deterministic gate says perfect, soft_score blend
const a = reportBlend(
  'Scenario A: gate=1.0 passed, soft_score 60/40, min_eval=0.5',
  1.0, true,
  { strategy: 'soft_score', deterministic_weight: 0.6, weight: 0.4, min_evaluator_score: 0.5 },
);
// Soft-score blend: 0.6*1.0 + 0.4*evalScore. P0>0 OR eval<0.5 → forced fail.
const aExpectedScore = Math.round((0.6 * 1.0 + 0.4 * evalScore) * 1000) / 1000;
const aExpectedPass = evalP0 === 0 && evalScore >= 0.5;
const aPass = Math.abs(a.blended_score - aExpectedScore) < 1e-6 && a.final_passed === aExpectedPass;
console.log(`    ${aPass ? 'OK' : 'FAIL'}: expected blended=${aExpectedScore}, passed=${aExpectedPass} (P0=${a.p0_blockers}, eval=${evalScore})`);

// Scenario B — raise min_eval above actual evaluator score → force fail
const b = reportBlend(
  `Scenario B: gate=1.0 passed, min_eval=0.7 (above evaluator ${evalScore})`,
  1.0, true,
  { strategy: 'soft_score', min_evaluator_score: 0.7 },
);
// Force fail if eval < 0.7 OR P0 > 0. With current eval, both conditions fail it.
const bExpectedPass = evalScore >= 0.7 && evalP0 === 0;
const bPass = b.final_passed === bExpectedPass;
console.log(`    ${bPass ? 'OK' : 'FAIL'}: expected passed=${bExpectedPass} (eval ${b.evaluator_score} vs min 0.7)`);

// Scenario C — veto mode
const c = reportBlend(
  'Scenario C: gate=1.0 passed, veto (default min 0.7)',
  1.0, true,
  { strategy: 'veto' },
);
// veto: final = min(gate, eval). passed = gate.passed AND eval >= 0.7 AND P0 === 0.
const cExpectedScore = Math.min(1.0, evalScore);
const cExpectedPass = evalScore >= 0.7 && evalP0 === 0;
const cPass = Math.abs(c.blended_score - cExpectedScore) < 1e-6 && c.final_passed === cExpectedPass;
console.log(`    ${cPass ? 'OK' : 'FAIL'}: expected blended=${cExpectedScore}, passed=${cExpectedPass}`);

// ---------------------------------------------------------------------------
// 3. Simulate runGateWithBlend reading the real evaluation through a mock
//    blueprint. Uses a tmp "gate script" that just echoes a score so we can
//    assert the blend path end-to-end without touching real gate scripts.
// ---------------------------------------------------------------------------

console.log('\n--- 3. runGateWithBlend end-to-end with mock gate ---');

// Write a throwaway gate script that prints fixed deterministic JSON.
const tmpGateDir = path.join(os.tmpdir(), 'v2-gate-test-' + Date.now());
fs.mkdirSync(tmpGateDir, { recursive: true });
const tmpGateScript = path.join(tmpGateDir, 'mock-phase-gate.sh');
fs.writeFileSync(tmpGateScript, '#!/bin/bash\necho \'{"score":1.0,"passed":true,"summary":"mock 10/10"}\'\nexit 0\n');
fs.chmodSync(tmpGateScript, 0o755);

// Override gatesDir so hasGate/runGate find the mock instead of real gates.
const mockConfig = { ...config, gatesDir: tmpGateDir };

const mockBlueprint = {
  name: 'mock-phase',
  nodes: [{
    id: 'design-evaluator',
    type: 'evaluator',
    // Points at the real evaluation.json already on disk.
    required_output_file: '{TARGET_DIR}/.claude-project/status/{project}/design-evaluation.json',
    blend: { strategy: 'soft_score', deterministic_weight: 0.6, weight: 0.4, min_evaluator_score: 0.5 },
  }],
};

if (!hasGate(mockConfig, 'mock-phase')) {
  console.log('  FAIL: hasGate did not find mock gate script');
  process.exit(1);
}

const gateResult = runGateWithBlend(mockConfig, 'mock-phase', projectName, mockBlueprint);
console.log(`  gate ran:          ${gateResult.ran}`);
console.log(`  blend applied:     ${gateResult._blend_applied === true}`);
console.log(`  deterministic:     ${gateResult.deterministic_score}`);
console.log(`  evaluator:         ${gateResult.evaluator_score}`);
console.log(`  blended:           ${gateResult.blended_score}`);
console.log(`  strategy:          ${gateResult.blend_strategy}`);
console.log(`  p0_blockers:       ${gateResult.p0_blockers}`);
console.log(`  p1_blockers:       ${gateResult.p1_blockers}`);
console.log(`  p2_blockers:       ${gateResult.p2_blockers}`);
console.log(`  final score:       ${gateResult.score}`);
console.log(`  final passed:      ${gateResult.passed}`);

// Assertions derive expected values from the evaluation.json so the test
// stays correct as the file gets re-generated by future evaluator runs.
const expectedP0 = evaluation.p0_count || 0;
const expectedP1 = evaluation.p1_count || 0;
const expectedP2 = evaluation.p2_count || 0;
const expectedEval = evaluation.overall_score;
const expectedBlend = Math.round((0.6 * 1.0 + 0.4 * expectedEval) * 1000) / 1000;
// passed = false iff P0 > 0 OR evaluator < min_eval (0.5). With current
// evaluation (P0=1, eval=0.6) → false.
const expectPassedFalse = expectedP0 > 0 || expectedEval < 0.5;

const gatePass = gateResult._blend_applied === true
  && gateResult.deterministic_score === 1.0
  && Math.abs(gateResult.evaluator_score - expectedEval) < 1e-6
  && Math.abs(gateResult.blended_score - expectedBlend) < 1e-6
  && gateResult.passed === !expectPassedFalse
  && gateResult.p0_blockers === expectedP0
  && gateResult.p1_blockers === expectedP1
  && gateResult.p2_blockers === expectedP2;
console.log(`  ${gatePass ? 'OK' : 'FAIL'}: blend applied; P0=${expectedP0}, P1=${expectedP1}, P2=${expectedP2} all surfaced; passed=${!expectPassedFalse}`);

fs.rmSync(tmpGateDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 4. Event emission end-to-end — emit an evaluator_score event, read it back
//    from the episode file, confirm every field we need for reward.js.
// ---------------------------------------------------------------------------

console.log('\n--- 4. evaluator_score event round-trip ---');

const tmpTarget = path.join(os.tmpdir(), 'evt-test-' + Date.now());
fs.mkdirSync(tmpTarget, { recursive: true });
const evtConfig = makeConfig(tmpTarget);
const stream = createEventStream(evtConfig, projectName, { enabled: true });

// Pull p1/p2 from the gateResult itself — that's the path under test.
// The fix being verified is that runGateWithBlend exposes these fields.
stream.phaseStart('design');
stream.evaluatorScore('design', {
  node: 'design-evaluator',
  deterministic_score: gateResult.deterministic_score,
  evaluator_score: gateResult.evaluator_score,
  blended_score: gateResult.blended_score,
  blend_strategy: gateResult.blend_strategy,
  drift: gateResult.deterministic_score - gateResult.evaluator_score,
  p0_blockers: gateResult.p0_blockers,
  p1_blockers: gateResult.p1_blockers,
  p2_blockers: gateResult.p2_blockers,
});
stream.phaseEnd('design', {
  success: gateResult.passed,
  failedNode: null,
  duration_ms: 1000,
  nodesPassed: 1,
  nodesFailed: 0,
  nodesSkipped: 0,
  nodesTotal: 1,
  score: gateResult.blended_score,
});

const events = readEpisode(stream.path);
const evScoreEvent = events.find(e => e.type === 'evaluator_score');
console.log(`  events emitted:    ${events.length}`);
console.log(`  evaluator_score event found: ${!!evScoreEvent}`);
if (evScoreEvent) {
  console.log(`    drift:            ${evScoreEvent.drift}`);
  console.log(`    p0:               ${evScoreEvent.p0_blockers}`);
  console.log(`    p1:               ${evScoreEvent.p1_blockers}`);
  console.log(`    p2:               ${evScoreEvent.p2_blockers}`);
  console.log(`    blend_strategy:   ${evScoreEvent.blend_strategy}`);
}
const expectedDrift = 1.0 - expectedEval;
const evtPass = !!evScoreEvent
  && Math.abs(evScoreEvent.drift - expectedDrift) < 1e-6
  && evScoreEvent.p0_blockers === expectedP0
  && evScoreEvent.p1_blockers === expectedP1
  && evScoreEvent.p2_blockers === expectedP2;
console.log(`  ${evtPass ? 'OK' : 'FAIL'}: drift=${expectedDrift.toFixed(3)}, P0/P1/P2 = ${expectedP0}/${expectedP1}/${expectedP2} round-tripped through JSONL`);

// ---------------------------------------------------------------------------
// 5. Reward.js drift + blocker penalties fire on the round-tripped events.
// ---------------------------------------------------------------------------

console.log('\n--- 5. reward.js drift + blocker penalties ---');

const rewardConfig = {
  phase_reward: {
    cost_penalty_coefficient: 0,
    // Use defaults for evaluator_drift + evaluator_blockers.
  },
};

const reward = computePhaseReward('design', events, rewardConfig);
console.log(`  delta_score:                    ${reward.delta_score}`);
console.log(`  components.base:                ${reward.components.base}`);
console.log(`  components.evaluator_drift:     ${reward.components.evaluator_drift_penalty}`);
console.log(`  components.evaluator_blocker:   ${reward.components.evaluator_blocker_penalty}`);
console.log(`  evaluator.present:              ${reward.evaluator.present}`);
console.log(`  evaluator.drift:                ${reward.evaluator.drift}`);
console.log(`  total:                          ${reward.total}`);

// Drift penalty: 10 × max(0, |drift| - 0.3)
// Blocker penalty: P0 × 20 + P1 × 5 (P2 currently 0 by default)
const driftExpected = -10 * Math.max(0, Math.abs(expectedDrift) - 0.3);
const blockerExpected = -(expectedP0 * 20 + expectedP1 * 5);
const rewardPass = Math.abs(reward.components.evaluator_drift_penalty - driftExpected) < 1e-6
  && reward.components.evaluator_blocker_penalty === blockerExpected
  && reward.evaluator.present === true;
console.log(`  ${rewardPass ? 'OK' : 'FAIL'}: expected drift=${driftExpected.toFixed(3)}, blocker=${blockerExpected}`);

fs.rmSync(tmpTarget, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n=== SUMMARY ===');
const results = [
  ['blend: P0 forces fail (soft_score)',        aPass],
  ['blend: min_eval floor forces fail',          bPass],
  ['blend: veto takes min + requires min_eval',  cPass],
  ['runGateWithBlend end-to-end',                gatePass],
  ['evaluator_score event round-trip',           evtPass],
  ['reward.js drift + blocker penalties',        rewardPass],
];

let pass = 0, fail = 0;
for (const [label, ok] of results) {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`);
  ok ? pass++ : fail++;
}
console.log(`\n  ${pass}/${results.length} tests passed`);

process.exit(fail === 0 ? 0 : 1);
