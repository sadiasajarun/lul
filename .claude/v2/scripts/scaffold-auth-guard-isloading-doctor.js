#!/usr/bin/env node
// scaffold-auth-guard-isloading-doctor.js — v108
//
// Fix role-specific auth guards (WorkerGuard, CompanyGuard, AdminGuard) that use
// `if (isLoading) { return <spinner/> }` without checking `authChecked`.
//
// BUG PATTERN: Worker/Company/Admin guards check `isLoading` to show a spinner.
// BUT `isLoading` is set to `true` by EVERY async auth action (me(), login(), etc).
// When a guarded page component dispatches `me()` on mount (e.g. profile.tsx),
// the sequence becomes:
//   1. Guard passes (isLoading=false, isAuthenticated=true) → page renders
//   2. Page dispatches me() → me.pending → isLoading=true
//   3. Guard shows spinner → UNMOUNTS the page
//   4. me.fulfilled → isLoading=false → page mounts again → dispatches me() → loop!
//
// FIX: Change `if (isLoading)` to `if (!authChecked && isLoading)` so the spinner
// only shows during the INITIAL auth check, never on subsequent API calls.
// Also adds `authChecked` to the destructured auth selector if not already present.
//
// TARGET FILES: app/components/guards/*Guard.tsx (WorkerGuard, CompanyGuard, AdminGuard)
// NOT AuthGuard / GuestGuard (those are generic and don't use isLoading spinner).
//
// Idempotent — files without the bug pattern are skipped.
// Evidence: v107 run, 13-my-profile AC-3 + AC-5 infinite spinner loop.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-auth-guard-isloading-doctor --target <FRONTEND_DIR>');
    process.exit(1);
  }
  return out;
}

function findGuardFiles(guardsDir) {
  var out = [];
  if (!fs.existsSync(guardsDir)) return out;
  fs.readdirSync(guardsDir).forEach(function (name) {
    // Target role-specific guards: WorkerGuard, CompanyGuard, AdminGuard
    if (/Guard\.tsx$/.test(name) && !/(Auth|Guest|Role|Protected)Guard/.test(name)) {
      out.push(path.join(guardsDir, name));
    }
  });
  return out;
}

function processFile(filePath, opts) {
  var content = fs.readFileSync(filePath, 'utf-8');

  // Skip if no isLoading spinner pattern
  if (!/if\s*\(\s*isLoading\s*\)/.test(content)) {
    if (opts.verbose) console.log('  SKIP (no isLoading pattern):', path.basename(filePath));
    return { changed: false };
  }

  // Skip if already fixed (authChecked in the condition)
  if (/if\s*\(\s*!authChecked\s*&&\s*isLoading\s*\)/.test(content)) {
    if (opts.verbose) console.log('  SKIP (already fixed):', path.basename(filePath));
    return { changed: false };
  }

  var orig = content;

  // 1. Fix the isLoading condition: `if (isLoading)` → `if (!authChecked && isLoading)`
  content = content.replace(/if\s*\(\s*isLoading\s*\)\s*\{/g, 'if (!authChecked && isLoading) {');

  // 2. Add `authChecked` to the useAppSelector destructure if not already present.
  //    Pattern: const { ..., isLoading, ... } = useAppSelector(...)
  //    or: const { isAuthenticated, isLoading, user } = useAppSelector(...)
  if (!/ authChecked[,\s}]/.test(content)) {
    // Add authChecked to the destructure alongside isLoading
    content = content.replace(
      /const\s*\{\s*([^}]*\bisLoading\b[^}]*)\}\s*=\s*useAppSelector/,
      function (match, inner) {
        // Don't double-add
        if (/authChecked/.test(inner)) return match;
        return 'const { ' + inner.trim() + ', authChecked } = useAppSelector';
      }
    );
  }

  if (content === orig) {
    if (opts.verbose) console.log('  SKIP (no change after transform):', path.basename(filePath));
    return { changed: false };
  }

  if (opts.dryRun) {
    console.log('  DRY-RUN would fix:', path.basename(filePath));
    return { changed: false };
  }

  fs.writeFileSync(filePath, content);
  console.log('  FIXED:', path.basename(filePath));
  return { changed: true };
}

function main() {
  var opts = parseArgs(process.argv);
  var guardsDir = path.join(opts.target, 'app', 'components', 'guards');

  var files = findGuardFiles(guardsDir);
  if (files.length === 0) {
    console.log('scaffold-auth-guard-isloading-doctor: no role-specific guard files found under', guardsDir);
    return;
  }

  var fixed = 0;
  files.forEach(function (f) {
    var result = processFile(f, opts);
    if (result.changed) fixed++;
  });

  console.log('scaffold-auth-guard-isloading-doctor: ' + fixed + '/' + files.length + ' guard(s) fixed');
}

main();
