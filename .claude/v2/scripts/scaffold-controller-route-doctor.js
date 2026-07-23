#!/usr/bin/env node
// scaffold-controller-route-doctor.js — v89
//
// Normalize @Controller('path') paths to kebab-case to match PROJECT_API.md.
//
// THE BUG: LLM emits @Controller('bankAccounts'), @Controller('adminServiceTypes'),
// @Controller('paymentRequests') etc. (camelCase from module names) while
// PROJECT_API.md spec uses kebab-case paths like /bank-accounts,
// /admin/service-types. Result: every frontend httpService call to
// /bank-accounts returns 404 because the controller is mounted on
// /bankAccounts. This kills integrate phase and test-browser stories
// that depend on those endpoints.
//
// FIX: detect camelCase segments in @Controller paths and convert to kebab-case.
//   bankAccounts        → bank-accounts
//   adminServiceTypes   → admin-service-types
//   paymentRequests     → payment-requests
//
// Skips paths that are already kebab-case, already slash-separated, or
// contain URL params (`:id`, `:slug`) which usually indicate the LLM
// understood the spec.
//
// Idempotent. Adds a `// scaffold-controller-route-doctor` comment when
// it rewrites a path.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--api') out.api = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-controller-route-doctor --target <BACKEND_DIR> [--api PROJECT_API.md] [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

function findControllerFiles(modulesDir) {
  var out = [];
  if (!fs.existsSync(modulesDir)) return out;
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      var p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.controller\.ts$/.test(e.name)) out.push(p);
    });
  }
  walk(modulesDir);
  return out;
}

function camelToKebab(s) {
  // bankAccounts → bank-accounts
  // adminServiceTypes → admin-service-types
  // Already-kebab strings pass through unchanged.
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function isCamelCase(s) {
  // Has lower-then-upper transition (foo-Bar pattern excluded)
  return /[a-z][A-Z]/.test(s);
}

function fixControllerPath(originalPath) {
  if (!originalPath) return null;
  // If path has slashes, only normalize each segment individually.
  var segments = originalPath.split('/').filter(Boolean);
  var changed = false;
  var newSegments = segments.map(function (seg) {
    // Skip path params (`:id`), wildcards (`*`)
    if (/^:/.test(seg) || seg === '*') return seg;
    // Skip already-kebab
    if (!isCamelCase(seg)) return seg;
    changed = true;
    return camelToKebab(seg);
  });
  if (!changed) return null;
  return newSegments.join('/');
}

function processFile(filePath, options) {
  var content = fs.readFileSync(filePath, 'utf-8');
  var changes = [];
  // Match @Controller('path') or @Controller("path") — single string arg.
  // We don't touch @Controller({ path: '...', version: ... }) for now.
  var updated = content.replace(
    /@Controller\(\s*(['"])([^'"]*)\1\s*\)/g,
    function (match, quote, original) {
      var fixed = fixControllerPath(original);
      if (!fixed || fixed === original) return match;
      changes.push({ from: original, to: fixed });
      return '@Controller(' + quote + fixed + quote + ') /* scaffold-controller-route-doctor: ' + original + ' → ' + fixed + ' */';
    }
  );
  if (changes.length === 0) return { changed: false };
  if (!options.dryRun) fs.writeFileSync(filePath, updated);
  return { changed: true, changes: changes };
}

function main() {
  var args = parseArgs(process.argv);
  var modulesDir = path.join(args.target, 'src/modules');
  if (!fs.existsSync(modulesDir)) {
    console.log('scaffold-controller-route-doctor: no src/modules — skipping');
    return;
  }
  var controllerFiles = findControllerFiles(modulesDir);
  var filesFixed = 0;
  var totalRewrites = 0;
  controllerFiles.forEach(function (f) {
    var r = processFile(f, args);
    if (r.changed) {
      filesFixed++;
      totalRewrites += r.changes.length;
      if (args.verbose) {
        r.changes.forEach(function (c) {
          console.log('  ' + path.relative(args.target, f) + ': ' + c.from + ' → ' + c.to);
        });
      }
    }
  });
  console.log('scaffold-controller-route-doctor: ' + filesFixed + ' file(s) fixed, ' + totalRewrites + ' camelCase path(s) → kebab-case');
}

main();
