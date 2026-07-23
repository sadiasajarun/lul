#!/usr/bin/env node
// scaffold-frontend-build-preflight.js — run the FULL idempotent build-blocker
// doctor sweep in one place. Used TWO ways (DRY):
//   (1) PROACTIVELY as a node right before `build` (after routes-final-cleanup) —
//       so late nodes (restorer/scope-lock/routes-cleanup) that reintroduce a bad
//       icon or dangling import get re-doctored before the gate sees them.
//   (2) REACTIVELY inside the self-healing `build` node, after a failed build,
//       before the single retry.
//
// Every doctor here is marker-idempotent + deterministic + cheap, and all assume
// deps are installed (run this AFTER scaffold-ensure-deps-installed). Order is
// deps → catalog/icon → i18n → css → page-imports → routes → broken-import
// quarantine (last, the poison-pill backstop). A doctor erroring never fails the
// sweep (best-effort); the build gate is the real arbiter.
'use strict';

var path = require('path');
var cp = require('child_process');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--default-locale') out.defaultLocale = argv[++i];
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) { console.error('Usage: scaffold-frontend-build-preflight --target FRONTEND_DIR [--default-locale ko]'); process.exit(1); }
  out.defaultLocale = out.defaultLocale || process.env.DEFAULT_LOCALE || 'ko';
  return out;
}

function run(script, args, label) {
  var full = path.join(__dirname, script);
  try {
    var out = cp.execFileSync('node', [full].concat(args), { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    var last = out.trim().split('\n').filter(Boolean).pop() || 'ok';
    console.log('  ✓ ' + label + ': ' + last.slice(0, 120));
  } catch (e) {
    // best-effort — a doctor that throws must not abort the sweep
    var msg = (e && (e.stdout || e.message) || '').toString().trim().split('\n').pop() || 'error';
    console.log('  · ' + label + ': skipped (' + msg.slice(0, 80) + ')');
  }
}

function main() {
  var a = parseArgs(process.argv);
  var t = a.target;
  console.log('scaffold-frontend-build-preflight: running build-blocker doctor sweep on ' + t);
  // Deps must be present for the catalog/icon doctors to work (idempotent if already installed).
  run('scaffold-ensure-deps-installed.js', ['--target', t], 'ensure-deps');
  run('scaffold-lucide-icon-doctor.js', ['--target', t], 'lucide-icons');
  run('scaffold-i18n-keys.js', ['--target', t, '--default-locale', a.defaultLocale], 'i18n-locale-completeness');
  run('scaffold-css-imports-doctor.js', ['--target', t], 'css-imports');
  run('scaffold-page-imports-doctor.js', ['--target', t], 'page-imports');
  run('scaffold-routes-prune.js', ['--target', t], 'routes-prune');
  run('scaffold-broken-imports-quarantine.js', ['--target', t], 'broken-imports-quarantine');
  console.log('scaffold-frontend-build-preflight: sweep complete');
}

main();
