#!/usr/bin/env node
// verify-fixes-against-run.js — exercise every "fix-class" scaffold
// (the ones meant to patch up LLM output) against a finished run dir.
// Reports what each would have done if it had run.
//
// Usage:
//   node .claude/v2/scripts/verify-fixes-against-run.js \
//     experiments/parallel-runs/fsp/runs/20260602T053835Z-overnight-ship-v82
//
// Each scaffold gets a COPY of the run dir in /tmp so the original is
// untouched. Output: per-scaffold "would-have-changed" report.
'use strict';

var fs = require('fs');
var path = require('path');
var { execSync, spawnSync } = require('child_process');

var runDir = process.argv[2];
if (!runDir || !fs.existsSync(runDir)) {
  console.error('Usage: node verify-fixes-against-run.js <run-dir>');
  console.error('  e.g. node verify-fixes-against-run.js experiments/parallel-runs/fsp/runs/<tag>');
  process.exit(1);
}

var cellDir = path.join(runDir, 'run-mimo-xiaomi-cake1');
if (!fs.existsSync(cellDir)) {
  // try cake2 or first child dir starting with run-
  var children = fs.readdirSync(runDir).filter(function (d) { return d.indexOf('run-') === 0; });
  if (children.length === 0) {
    console.error('No run-* cell dir found under ' + runDir);
    process.exit(1);
  }
  cellDir = path.join(runDir, children[0]);
}

var frontendDir = path.join(cellDir, 'frontend');
var backendDir = path.join(cellDir, 'backend');
var fixesDir = path.dirname(require.main.filename);
var tmpRoot = '/tmp/verify-fixes-' + Date.now();

function header(s) {
  console.log('\n========================================');
  console.log(s);
  console.log('========================================');
}

function snapshot(src, name) {
  var dst = path.join(tmpRoot, name);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  execSync('cp -r ' + JSON.stringify(src) + ' ' + JSON.stringify(dst), { stdio: 'pipe' });
  return dst;
}

function run(cmd, args) {
  var r = spawnSync(cmd, args, { encoding: 'utf-8' });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status };
}

// ---- The fix-class scaffolds we want to verify ----
var FIX_SCAFFOLDS = [
  {
    name: 'scaffold-routes-prune',
    bin: path.join(fixesDir, 'scaffold-routes-prune.js'),
    args: function (snap) { return ['--target', snap, '--verbose']; },
    needs: 'frontend',
    summarize: function (out) {
      var m = (out.stdout || '').match(/(\d+) files pruned, (\d+) dangling/);
      return m ? m[2] + ' dangling routes' : 'unchanged';
    },
  },
  {
    name: 'scaffold-routes-dedupe',
    bin: path.join(fixesDir, 'scaffold-routes-dedupe.js'),
    args: function (snap) { return ['--target', snap, '--verbose']; },
    needs: 'frontend',
    summarize: function (out) {
      var m = (out.stdout || '').match(/(\d+) duplicate route\(\) lines removed/);
      return m ? m[1] + ' duplicate routes' : 'unchanged';
    },
  },
  {
    name: 'scaffold-page-imports-doctor',
    bin: path.join(fixesDir, 'scaffold-page-imports-doctor.js'),
    args: function (snap) { return ['--target', snap, '--verbose']; },
    needs: 'frontend',
    summarize: function (out) {
      var m = (out.stdout || '').match(/added (\d+) import statements/);
      return m ? m[1] + ' missing imports' : 'unchanged';
    },
  },
  {
    name: 'scaffold-ensure-deps-installed (backend, dry-run)',
    bin: path.join(fixesDir, 'scaffold-ensure-deps-installed.js'),
    args: function (snap) { return ['--target', snap, '--dry-run']; },
    needs: 'backend',
    summarize: function (out) {
      var m = (out.stdout || '').match(/(\d+) of (\d+) deps missing/);
      return m ? m[1] + '/' + m[2] + ' deps missing' : 'all present';
    },
  },
  {
    name: 'scaffold-ensure-deps-installed (frontend, dry-run)',
    bin: path.join(fixesDir, 'scaffold-ensure-deps-installed.js'),
    args: function (snap) { return ['--target', snap, '--dry-run']; },
    needs: 'frontend',
    summarize: function (out) {
      var m = (out.stdout || '').match(/(\d+) of (\d+) deps missing/);
      return m ? m[1] + '/' + m[2] + ' deps missing' : 'all present';
    },
  },
  {
    name: 'scaffold-test-enum-imports',
    bin: path.join(fixesDir, 'scaffold-test-enum-imports.js'),
    args: function (snap) { return ['--target', snap, '--side', 'backend', '--dry-run', '--verbose']; },
    needs: 'backend',
    summarize: function (out) {
      var m = (out.stdout || '').match(/added (\d+) import statements/);
      return m ? m[1] + ' missing enum imports' : 'all enums imported';
    },
  },
];

header('verify-fixes — run: ' + path.basename(runDir));
console.log('cell dir: ' + cellDir);
console.log('frontend: ' + (fs.existsSync(frontendDir) ? 'exists' : 'MISSING'));
console.log('backend:  ' + (fs.existsSync(backendDir) ? 'exists' : 'MISSING'));

var results = [];
FIX_SCAFFOLDS.forEach(function (fix) {
  if (!fs.existsSync(fix.bin)) {
    results.push({ name: fix.name, status: 'SKIP', detail: 'scaffold not on disk' });
    return;
  }
  var targetDir = fix.needs === 'frontend' ? frontendDir : backendDir;
  if (!fs.existsSync(targetDir)) {
    results.push({ name: fix.name, status: 'SKIP', detail: fix.needs + ' dir missing' });
    return;
  }
  // Snapshot only the dirs/files the scaffold needs (avoid copying node_modules)
  var snap = snapshot(targetDir, fix.name);
  var out = run('node', [fix.bin].concat(fix.args(snap)));
  var detail = fix.summarize(out);
  results.push({ name: fix.name, status: out.exitCode === 0 ? 'OK' : 'ERR', detail: detail });
});

header('SUMMARY');
results.forEach(function (r) {
  console.log('  [' + r.status + '] ' + r.name.padEnd(50) + ' → ' + r.detail);
});

// Cleanup
try { execSync('rm -rf ' + JSON.stringify(tmpRoot), { stdio: 'pipe' }); } catch (_) {}
console.log('\n(snapshot dirs cleaned)');
