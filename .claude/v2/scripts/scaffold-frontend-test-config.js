#!/usr/bin/env node
// scaffold-frontend-test-config.js — v73 writes vitest config + setup
// files for component tests + msw mock server. Project-agnostic.
// Component-test specs themselves are written per-page by
// scaffold-component-tests (or the LLM, if it wants).
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--templates') out.templates = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target || !out.templates) {
    console.error('Usage: scaffold-frontend-test-config --target FRONTEND_DIR --templates tests/');
    process.exit(1);
  }
  return out;
}

function copyIfMissing(src, dst, opts) {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dst)) {
    if (opts.verbose) console.log('  skip (exists): ' + path.relative(opts.target, dst));
    return false;
  }
  if (opts.dryRun) {
    console.log('  [dry] would write ' + path.relative(opts.target, dst));
    return true;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('  ✓ wrote ' + path.relative(opts.target, dst));
  return true;
}

function ensureDeps(target, opts) {
  var pkgPath = path.join(target, 'package.json');
  if (!fs.existsSync(pkgPath)) return;
  var pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkg.devDependencies = pkg.devDependencies || {};
  pkg.scripts = pkg.scripts || {};

  // v93: @testing-library/dom is the PEER of @testing-library/react v13+.
  // Without it, `import { screen } from '@testing-library/react'` triggers
  // TS2305 ("no exported member 'screen'") because react-testing-library
  // re-exports screen from @testing-library/dom but the re-export resolves
  // to nothing when dom isn't installed. v92 evidence: cascade of TS2305
  // across 11+ test files per frontend cell.
  var deps = {
    'vitest': '*',
    '@vitejs/plugin-react': '*',
    '@testing-library/react': '*',
    '@testing-library/dom': '*',
    '@testing-library/jest-dom': '*',
    'jsdom': '*',
    'msw': '*',
    '@vitest/coverage-v8': '*',
  };
  var added = [];
  for (var d in deps) {
    if (!pkg.dependencies?.[d] && !pkg.devDependencies[d]) {
      pkg.devDependencies[d] = deps[d];
      added.push(d);
    }
  }
  if (!pkg.scripts['test:unit']) pkg.scripts['test:unit'] = 'vitest run --config tests/vitest.config.ts';
  if (!pkg.scripts['test:watch']) pkg.scripts['test:watch'] = 'vitest --config tests/vitest.config.ts';

  if (opts.dryRun) {
    console.log('  [dry] would add ' + added.length + ' devDeps + 2 npm scripts');
    return;
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  if (added.length > 0) console.log('  ↻ added devDeps: ' + added.join(', '));
}

function main() {
  var args = parseArgs(process.argv);

  ['setup.ts', 'msw-server.ts', 'vitest.config.ts'].forEach(function (f) {
    copyIfMissing(
      path.join(args.templates, f),
      path.join(args.target, 'tests', f),
      args,
    );
  });
  ensureDeps(args.target, args);
  console.log('scaffold-frontend-test-config: done');
}

main();
