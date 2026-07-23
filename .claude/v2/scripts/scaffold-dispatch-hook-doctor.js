#!/usr/bin/env node
// scaffold-dispatch-hook-doctor.js — v112
// Fixes a subtle infinite-loop bug in LLM-generated Redux store hooks:
//
//   BAD:  export const useAppDispatch = () => useDispatch<AppDispatch>();
//   GOOD: export const useAppDispatch: () => AppDispatch = useDispatch;
//
// Root cause: the BAD pattern returns a new function on every call, so any
// component that does `const dispatch = useAppDispatch()` and adds `dispatch`
// to a useEffect dependency array will re-render infinitely:
//   render → useEffect([dispatch]) fires → dispatch(fetchThunk()) → state change
//   → render → new dispatch reference → useEffect fires again → infinite loop
//
// React error: "Maximum update depth exceeded. This can happen when a
// component calls setState inside useEffect, but useEffect either doesn't
// have a dependency array, or one of the dependencies changes on every render."
//
// The GOOD pattern makes useAppDispatch a stable type alias — same function
// reference across renders.
//
// Patches: app/redux/store/hooks.ts (or any file containing the bad pattern).
//
// Usage:
//   node scaffold-dispatch-hook-doctor.js --target <FRONTEND_DIR> [--dry-run] [--verbose]

'use strict';

var fs   = require('fs');
var path = require('path');

var args    = process.argv.slice(2);
var target  = null;
var dryRun  = false;
var verbose = false;

for (var i = 0; i < args.length; i++) {
  if (args[i] === '--target')  { target  = args[++i]; }
  if (args[i] === '--dry-run') { dryRun  = true; }
  if (args[i] === '--verbose') { verbose = true; }
}

if (!target) {
  console.error('Usage: scaffold-dispatch-hook-doctor.js --target <FRONTEND_DIR> [--dry-run] [--verbose]');
  process.exit(1);
}

var BAD_PATTERN  = /export\s+const\s+useAppDispatch\s*=\s*\(\s*\)\s*=>\s*useDispatch<AppDispatch>\s*\(\s*\)/;
var GOOD_REPLACE = 'export const useAppDispatch: () => AppDispatch = useDispatch';

function walkForHooks(dir, results) {
  results = results || [];
  if (!fs.existsSync(dir)) return results;
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
      walkForHooks(path.join(dir, e.name), results);
    } else if (e.isFile() && /hooks\.ts$/.test(e.name)) {
      results.push(path.join(dir, e.name));
    }
  }
  return results;
}

var hooksFiles = walkForHooks(path.join(target, 'app'));
if (hooksFiles.length === 0) {
  if (verbose) console.log('[scaffold-dispatch-hook-doctor] no hooks.ts files found under ' + target + '/app');
  console.log('[scaffold-dispatch-hook-doctor] 0 files patched');
  process.exit(0);
}

var totalFixed = 0;

hooksFiles.forEach(function (filePath) {
  var src = fs.readFileSync(filePath, 'utf-8');
  if (!BAD_PATTERN.test(src)) {
    if (verbose) console.log('  ok: ' + path.relative(target, filePath));
    return;
  }
  var updated = src.replace(BAD_PATTERN, GOOD_REPLACE);
  if (updated === src) return;

  if (verbose || dryRun) {
    console.log((dryRun ? '[dry-run] would patch' : 'patched') + ': ' + path.relative(target, filePath));
  }
  if (!dryRun) {
    fs.writeFileSync(filePath, updated, 'utf-8');
    totalFixed++;
  }
});

console.log('[scaffold-dispatch-hook-doctor] ' + totalFixed + '/' + hooksFiles.length + ' hooks file(s) patched');
