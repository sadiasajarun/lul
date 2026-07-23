#!/usr/bin/env node
/**
 * distill-learnings.js — bridge from raw episode JSONL to LLM-readable LEARNINGS.md
 *
 * Reads .claude-project/episodes/*.jsonl, extracts a structured summary per
 * episode (phases passed/failed, fanout cells, costs, drift), and appends to
 * .claude-project/memory/LEARNINGS.md under a "## Run history" section so the
 * next pipeline run sees prior outcomes as context.
 *
 * Idempotent — uses HTML comment markers `<!-- ep:{episode_id} -->` to skip
 * episodes already distilled. Safe to run after every pipeline run, or on
 * a hook, or manually.
 *
 * Usage:
 *   node .claude/v2/distill-learnings.js [--all] [--latest] [--episode <id>] [--dry-run]
 *     --all       distill every episode in episodes/ (default)
 *     --latest    only the most recent episode
 *     --episode   one specific episode id (matches filename prefix)
 *     --dry-run   print what would be appended without writing
 */

const fs = require('fs');
const path = require('path');

function findProjectRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, '.claude-project'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`No .claude-project root found from ${startDir}`);
}

function parseArgs(argv) {
  const flags = { all: false, latest: false, episode: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') flags.all = true;
    else if (argv[i] === '--latest') flags.latest = true;
    else if (argv[i] === '--episode') flags.episode = argv[++i];
    else if (argv[i] === '--dry-run') flags.dryRun = true;
  }
  if (!flags.all && !flags.latest && !flags.episode) flags.all = true;
  return flags;
}

function readEpisode(filePath) {
  const events = [];
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch {}
  }
  return events;
}

function summarizeEpisode(events) {
  const start = events.find(e => e.type === 'episode_start') || {};
  const end = events.find(e => e.type === 'episode_end') || {};
  const phases = events.filter(e => e.type === 'phase_end');
  const cells = events.filter(e => e.type === 'node_result' && e.cell);
  const gates = events.filter(e => e.type === 'gate_score');
  const evals = events.filter(e => e.type === 'evaluator_score');

  const phaseRows = phases.map(p => ({
    phase: p.phase,
    success: p.success,
    score: p.score,
    failed_node: p.failed_node,
    duration_s: Math.round((p.duration_ms || 0) / 1000),
    nodes_pass: p.nodes_pass,
    nodes_fail: p.nodes_fail,
  }));

  const cellsByNode = {};
  for (const c of cells) {
    cellsByNode[c.node] = cellsByNode[c.node] || { passed: [], failed: [], cached: [], total_cost: 0 };
    const bucket = cellsByNode[c.node];
    if (c.status === 'PASS' && c.cached) bucket.cached.push(c.cell.subject_value);
    else if (c.status === 'PASS') bucket.passed.push(c.cell.subject_value);
    else bucket.failed.push(`${c.cell.subject_value}(${c.error || 'fail'})`);
    if (typeof c.cost_usd === 'number') bucket.total_cost += c.cost_usd;
  }

  const driftRows = evals.map(e => ({
    phase: e.phase,
    deterministic: e.deterministic_score,
    evaluator: e.evaluator_score,
    blended: e.blended_score,
    drift: e.drift,
    p0: e.p0_blockers,
    p1: e.p1_blockers,
    p2: e.p2_blockers,
  }));

  const totalCost = phases.reduce((s, p) => s + (p.cost_usd || 0), 0);
  const totalDuration = end.duration_ms || phases.reduce((s, p) => s + (p.duration_ms || 0), 0);

  return {
    episode_id: start.episode_id || 'unknown',
    project: start.project || 'unknown',
    mode: start.mode || '?',
    argv: start.argv || [],
    started_at: start.t || '?',
    ended_at: end.t || null,
    success: end.success ?? null,
    failed_phase: end.failed_phase || null,
    duration_s: Math.round(totalDuration / 1000),
    total_cost_usd: totalCost,
    phases: phaseRows,
    fanout_nodes: cellsByNode,
    drift: driftRows,
    gate_count: gates.length,
  };
}

function renderEpisodeBlock(s) {
  const lines = [];
  lines.push(`<!-- ep:${s.episode_id} -->`);
  lines.push(`### ${s.episode_id}`);
  lines.push(`- **project**: ${s.project}`);
  lines.push(`- **mode**: ${s.mode} \`${(s.argv || []).join(' ')}\``);
  lines.push(`- **started**: ${s.started_at}`);
  if (s.ended_at) lines.push(`- **ended**: ${s.ended_at}`);
  lines.push(`- **duration**: ${Math.floor(s.duration_s / 60)}m ${s.duration_s % 60}s`);
  if (s.success !== null) lines.push(`- **outcome**: ${s.success ? 'success ✅' : 'failed ❌'}${s.failed_phase ? ' at ' + s.failed_phase : ''}`);

  if (s.phases.length) {
    lines.push(`- **phases**:`);
    for (const p of s.phases) {
      const mark = p.success ? '✓' : '✗';
      const failNote = p.success ? '' : ` (failed: ${p.failed_node})`;
      lines.push(`  - ${mark} ${p.phase} score=${p.score?.toFixed?.(2) ?? p.score} (${p.nodes_pass}/${p.nodes_pass + p.nodes_fail} nodes, ${p.duration_s}s)${failNote}`);
    }
  }

  const fanoutNodeIds = Object.keys(s.fanout_nodes);
  if (fanoutNodeIds.length) {
    lines.push(`- **fanout nodes**:`);
    for (const nodeId of fanoutNodeIds) {
      const b = s.fanout_nodes[nodeId];
      const total = b.passed.length + b.failed.length + b.cached.length;
      lines.push(`  - \`${nodeId}\`: ${b.passed.length + b.cached.length}/${total} pass (${b.cached.length} cached, ${b.passed.length} fresh, ${b.failed.length} fail), cost $${b.total_cost.toFixed(2)}`);
      if (b.failed.length) lines.push(`    - failed cells: ${b.failed.join(', ')}`);
    }
  }

  if (s.drift.length) {
    lines.push(`- **eval drift** (deterministic vs evaluator):`);
    for (const d of s.drift) {
      const flag = Math.abs(d.drift || 0) > 0.3 ? ' ⚠ wide drift' : '';
      lines.push(`  - ${d.phase}: det=${d.deterministic?.toFixed?.(2)} eval=${d.evaluator?.toFixed?.(2)} blended=${d.blended?.toFixed?.(2)} (P0=${d.p0} P1=${d.p1} P2=${d.p2})${flag}`);
    }
  }

  lines.push(`- **what to remember**: <!-- agents: append concise lesson here when a recurring pattern emerges -->`);
  lines.push(``);
  return lines.join('\n');
}

const SECTION_HEADER = '## Run history (auto-distilled from episodes)';
const SECTION_INTRO = `> Each entry below is harvested from \`.claude-project/episodes/*.jsonl\` by \`.claude/v2/distill-learnings.js\`.
> Newest first. Marker \`<!-- ep:{id} -->\` makes distillation idempotent.
> Agents/humans may append observations under each entry's "what to remember" line — those lines are preserved across re-runs.`;

function ensureSection(content) {
  if (content.includes(SECTION_HEADER)) return content;
  const sep = content.endsWith('\n') ? '' : '\n';
  return `${content}${sep}\n---\n\n${SECTION_HEADER}\n\n${SECTION_INTRO}\n\n`;
}

function distilledEpisodeIds(content) {
  const ids = new Set();
  const re = /<!-- ep:([a-zA-Z0-9_:.\-]+) -->/g;
  let m;
  while ((m = re.exec(content)) !== null) ids.add(m[1]);
  return ids;
}

function insertNewEntry(content, block) {
  // Insert immediately under the section intro so the latest entry is at top.
  const idx = content.indexOf(SECTION_HEADER);
  if (idx < 0) return content + block;
  // Find end of intro paragraph (first blank line after section header)
  const after = content.slice(idx);
  const introEnd = after.indexOf(SECTION_INTRO);
  let cursor = introEnd >= 0 ? idx + introEnd + SECTION_INTRO.length : idx + SECTION_HEADER.length;
  // Skip the trailing blank lines after the intro
  while (cursor < content.length && content[cursor] === '\n') cursor++;
  return content.slice(0, cursor) + block + '\n' + content.slice(cursor);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = findProjectRoot();
  const episodesDir = path.join(root, '.claude-project', 'episodes');
  const memoryDir = path.join(root, '.claude-project', 'memory');
  const learningsPath = path.join(memoryDir, 'LEARNINGS.md');

  if (!fs.existsSync(episodesDir)) {
    console.error(`No episodes/ dir at ${episodesDir}`);
    process.exit(2);
  }
  if (!fs.existsSync(learningsPath)) {
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(learningsPath, `# Learnings\n\n`);
  }

  const allFiles = fs.readdirSync(episodesDir)
    .filter(f => f.startsWith('ep-') && f.endsWith('.jsonl'))
    .sort();

  let targets;
  if (args.episode) {
    targets = allFiles.filter(f => f.includes(args.episode));
  } else if (args.latest) {
    targets = allFiles.slice(-1);
  } else {
    targets = allFiles;
  }

  if (targets.length === 0) {
    console.log('No matching episodes.');
    return;
  }

  let content = fs.readFileSync(learningsPath, 'utf-8');
  content = ensureSection(content);
  const seen = distilledEpisodeIds(content);

  let added = 0;
  let skipped = 0;
  // Process oldest → newest, always inserting at top of section. Each new
  // insertion pushes the previously-newest down, so after the loop the most
  // recent episode is at the top of the run-history section.
  for (const f of targets) {
    const events = readEpisode(path.join(episodesDir, f));
    const summary = summarizeEpisode(events);
    if (seen.has(summary.episode_id)) {
      skipped++;
      continue;
    }
    const block = renderEpisodeBlock(summary);
    if (args.dryRun) {
      console.log('--- would append ---');
      console.log(block);
    } else {
      content = insertNewEntry(content, block);
    }
    added++;
  }

  if (!args.dryRun && added > 0) {
    fs.writeFileSync(learningsPath, content);
  }

  console.log(`distill: scanned ${targets.length}, appended ${added}, skipped ${skipped} (already distilled)${args.dryRun ? ' [dry-run]' : ''}`);
  if (added > 0 && !args.dryRun) {
    console.log(`updated ${path.relative(root, learningsPath)}`);
  }
}

main();
