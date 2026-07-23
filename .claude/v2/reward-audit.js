#!/usr/bin/env node
/**
 * reward-audit.js — print the reward breakdown for one or more episode files.
 *
 * Usage:
 *   node reward-audit.js <episode-file>
 *   node reward-audit.js --latest                  # audit the newest episode in cwd
 *   node reward-audit.js --project <name>          # list latest N episodes with totals
 *   node reward-audit.js --list [N]                # list last N episodes in .claude-project/episodes/
 *
 * This is the checkpoint tool: after every 10 episodes, run this and compare
 * the ranking it produces against your gut feeling for "good run vs bad run".
 * If the ranks disagree, the reward function is wrong — FIX IT before trusting
 * any policy built on top.
 */

const fs = require('fs');
const path = require('path');
const { findProjectRoot, makeConfig } = require('./lib/config');
const { loadRewardConfig, computeEpisodeReward } = require('./lib/reward');

function parseArgs(argv) {
  const out = { file: null, latest: false, list: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--latest') out.latest = true;
    else if (a === '--list') out.list = parseInt(argv[i + 1], 10) || 10;
    else if (!a.startsWith('--')) out.file = a;
  }
  return out;
}

function findEpisodesDir() {
  const sourceDir = findProjectRoot(process.cwd());
  // Episodes live in target dir; default to cwd if --path wasn't given.
  return path.join(sourceDir, '.claude-project', 'episodes');
}

function findLatestEpisode(episodesDir) {
  if (!fs.existsSync(episodesDir)) return null;
  const files = fs.readdirSync(episodesDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(episodesDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? path.join(episodesDir, files[0].name) : null;
}

function listEpisodes(episodesDir, limit) {
  if (!fs.existsSync(episodesDir)) return [];
  const files = fs.readdirSync(episodesDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({
      name: f,
      path: path.join(episodesDir, f),
      mtime: fs.statSync(path.join(episodesDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, limit);
}

function fmt(n, width = 8) {
  if (n === null || n === undefined) return 'n/a'.padStart(width);
  const s = typeof n === 'number' ? n.toFixed(2) : String(n);
  return s.padStart(width);
}

function printEpisodeAudit(breakdown) {
  const b = breakdown;
  console.log('');
  console.log('═'.repeat(78));
  console.log(`episode:   ${b.episode_id}`);
  console.log(`project:   ${b.project || 'n/a'}`);
  console.log(`mode:      ${b.mode || 'n/a'}`);
  console.log(`events:    ${b.event_count}`);
  console.log(`success:   ${b.success}`);
  console.log(`duration:  ${b.duration_ms ? (b.duration_ms / 1000).toFixed(1) + 's' : 'n/a'}`);
  console.log('═'.repeat(78));

  if (b.phases.length > 0) {
    console.log('\nPER-PHASE REWARDS');
    console.log('  phase         | prev  | new   | Δ     | base  | shift | late  | cost  | artif | TOTAL');
    console.log('  ' + '-'.repeat(90));
    for (const p of b.phases) {
      const c = p.components;
      console.log(
        `  ${p.phase.padEnd(13)} | ${fmt(p.prev_score, 5)} | ${fmt(p.new_score, 5)} | ${fmt(p.delta_score, 5)} | ` +
        `${fmt(c.base, 5)} | ${fmt(c.shift_left_bonus, 5)} | ${fmt(c.late_bug_penalty, 5)} | ` +
        `${fmt(c.cost_penalty, 5)} | ${fmt(c.artifact_penalty, 5)} | ${fmt(p.total, 6)}`,
      );
    }
  }

  if (b.generations.length > 0) {
    console.log('\nPER-GENERATION REWARDS');
    console.log('  gen | pipeline | Δ      | α·Δpipe | β·bugs | γ·story | δ·depth | ε·reuse | ζ·stag | TOTAL');
    console.log('  ' + '-'.repeat(92));
    for (const g of b.generations) {
      const c = g.components;
      console.log(
        `  ${String(g.gen).padStart(3)} | ${fmt(g.pipeline_score, 8)} | ${fmt(g.delta_pipeline, 5)} | ` +
        `${fmt(c.pipeline_score_improvement, 6)} | ${fmt(c.bug_penalty, 5)} | ${fmt(c.story_pass_rate, 6)} | ` +
        `${fmt(c.coverage_depth, 6)} | ${fmt(c.pattern_reuse, 6)} | ${fmt(c.stagnation_penalty, 5)} | ${fmt(g.total, 6)}`,
      );
    }
  }

  console.log('\nTERMINAL REWARD');
  const t = b.terminal;
  console.log(`  converged:             ${t.converged}`);
  console.log(`  generations used:      ${t.generations_used}`);
  console.log(`  convergence_bonus:    ${fmt(t.components.convergence_bonus, 7)}`);
  console.log(`  speed_bonus:          ${fmt(t.components.speed_bonus, 7)}`);
  console.log(`  escape_penalty:       ${fmt(t.components.escape_penalty, 7)}`);
  console.log(`  coverage_completeness:${fmt(t.components.coverage_completeness, 7)}`);
  console.log(`  R_terminal:           ${fmt(t.total, 7)}`);

  console.log('\nEPISODE TOTAL');
  console.log(`  Σ R_phase:       ${fmt(b.totals.phase_sum, 10)}`);
  console.log(`  Σ R_generation:  ${fmt(b.totals.generation_sum, 10)}`);
  console.log(`  R_terminal:      ${fmt(b.totals.terminal, 10)}`);
  console.log(`  ─────────────────────────`);
  console.log(`  R_episode:       ${fmt(b.totals.episode, 10)}`);
  console.log('═'.repeat(78));
}

function printEpisodeList(episodes, rewardConfig) {
  console.log('');
  console.log('LAST EPISODES (most recent first)');
  console.log('  episode                              | events | success | R_episode | file');
  console.log('  ' + '-'.repeat(100));
  for (const ep of episodes) {
    try {
      const b = computeEpisodeReward(ep.path, rewardConfig);
      console.log(
        `  ${b.episode_id.padEnd(37)} | ${String(b.event_count).padStart(6)} | ` +
        `${String(b.success).padEnd(7)} | ${fmt(b.totals.episode, 9)} | ${ep.name}`,
      );
    } catch (err) {
      console.log(`  ${ep.name.padEnd(37)} | ERROR: ${err.message}`);
    }
  }
  console.log('');
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const sourceDir = findProjectRoot(process.cwd());
  const config = makeConfig(sourceDir, sourceDir);
  let rewardConfig;
  try {
    rewardConfig = loadRewardConfig(sourceDir);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }

  if (args.list !== null) {
    const episodes = listEpisodes(findEpisodesDir(), args.list);
    if (episodes.length === 0) {
      console.log('No episodes found in', findEpisodesDir());
      process.exit(0);
    }
    printEpisodeList(episodes, rewardConfig);
    process.exit(0);
  }

  let file = args.file;
  if (args.latest || !file) {
    file = findLatestEpisode(findEpisodesDir());
    if (!file) {
      console.error(`No episode files found in ${findEpisodesDir()}`);
      console.error('Run the orchestrator with --emit-events first.');
      process.exit(1);
    }
    console.log(`[auto-selected latest episode: ${path.basename(file)}]`);
  }

  if (!fs.existsSync(file)) {
    console.error(`Episode file not found: ${file}`);
    process.exit(1);
  }

  const breakdown = computeEpisodeReward(file, rewardConfig);
  printEpisodeAudit(breakdown);
}

main();
