#!/usr/bin/env node
// scaffold-zombie-killer.js — v90
//
// Kill leftover backend/frontend dev-server processes from prior runs before
// launching a new run. v89 died because pm2 was auto-restarting fsp-frontend
// (173 respawns) + 6 ts-node-dev processes from v78/v86/v87 were burning
// 75-100% CPU, OOM-killing the v89 orchestrator (exit 137 / SIGKILL).
//
// STRATEGY:
//   1. pm2 list — find processes whose pm2 NAME matches our project pattern
//      (configurable via --project, e.g. fsp-*) → pm2 delete each
//   2. ps aux — find any ts-node-dev / react-router / esbuild / vite processes
//      whose command-line path includes `experiments/parallel-runs/` →
//      SIGTERM, then SIGKILL after 2s grace
//   3. Excludes processes whose path matches --keep (e.g. the run we're
//      about to launch, or the parent orchestrator that's calling us)
//
// SAFE: only targets processes under experiments/parallel-runs/ and pm2 names
// matching the project. Won't touch unrelated dev work.
'use strict';

var fs = require('fs');
var child_process = require('child_process');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--project') out.project = argv[++i];
    else if (a === '--keep-path') out.keepPath = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.project) {
    console.error('Usage: scaffold-zombie-killer --project <project-prefix> [--keep-path <substring>] [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

function safeExec(cmd) {
  try { return child_process.execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

function killPm2Processes(projectPrefix, dryRun, verbose) {
  var killed = 0;
  // Try pm2 jlist (JSON output). If pm2 not installed, skip silently.
  var out = safeExec('pm2 jlist 2>/dev/null');
  if (!out || !out.startsWith('[')) {
    if (verbose) console.log('  pm2 not available or no processes managed — skipping pm2 cleanup');
    return 0;
  }
  var list;
  try { list = JSON.parse(out); } catch (_) { return 0; }
  list.forEach(function (proc) {
    var name = proc.name || '';
    // Match any pm2 entry whose name starts with the project prefix
    // (e.g. project=fsp matches fsp-frontend, fsp-backend, fsp-company-dashboard)
    if (name.indexOf(projectPrefix + '-') !== 0 && name !== projectPrefix) return;
    if (verbose) console.log('  pm2 delete: ' + name + ' (pid ' + proc.pid + ', restarts ' + proc.pm2_env.restart_time + ')');
    if (!dryRun) safeExec('pm2 delete ' + JSON.stringify(name) + ' 2>/dev/null');
    killed++;
  });
  return killed;
}

function killOrphanProcesses(keepSubstr, dryRun, verbose) {
  // ps aux with full command line, filter to pipeline-related processes only.
  var out = safeExec('ps -eo pid,command');
  if (!out) return 0;
  var lines = out.split('\n');
  var targets = [];
  lines.forEach(function (line) {
    var m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!m) return;
    var pid = parseInt(m[1], 10);
    var cmd = m[2];
    // Skip our own process tree (this scaffold's invoker)
    if (pid === process.pid) return;
    if (keepSubstr && cmd.indexOf(keepSubstr) >= 0) return;
    // Target: processes whose command references experiments/parallel-runs/
    if (cmd.indexOf('experiments/parallel-runs') < 0) return;
    // Match common dev-server signatures
    var isTarget = false;
    if (/ts-node-dev/.test(cmd)) isTarget = true;
    else if (/react-router\s+dev/.test(cmd)) isTarget = true;
    else if (/esbuild.*--service/.test(cmd)) isTarget = true;
    else if (/vite/.test(cmd) && /experiments\/parallel-runs/.test(cmd)) isTarget = true;
    else if (/run-parallel\.sh/.test(cmd)) isTarget = true;
    else if (/orchestrator\.js/.test(cmd)) isTarget = true;
    if (!isTarget) return;
    targets.push({ pid: pid, cmd: cmd.slice(0, 80) });
  });
  if (targets.length === 0) return 0;
  // SIGTERM first
  targets.forEach(function (t) {
    if (verbose) console.log('  kill -TERM ' + t.pid + ': ' + t.cmd);
    if (!dryRun) safeExec('kill -TERM ' + t.pid + ' 2>/dev/null');
  });
  if (dryRun) return targets.length;
  // 2s grace, then SIGKILL stragglers
  safeExec('sleep 2');
  targets.forEach(function (t) {
    safeExec('kill -KILL ' + t.pid + ' 2>/dev/null');
  });
  return targets.length;
}

function main() {
  var args = parseArgs(process.argv);
  console.log('scaffold-zombie-killer: project=' + args.project + (args.keepPath ? ' keep=' + args.keepPath : ''));
  var pm2Killed = killPm2Processes(args.project, args.dryRun, args.verbose);
  var orphanKilled = killOrphanProcesses(args.keepPath, args.dryRun, args.verbose);
  console.log('scaffold-zombie-killer: ' + pm2Killed + ' pm2 process(es) deleted, ' + orphanKilled + ' orphan process(es) killed');
}

main();
