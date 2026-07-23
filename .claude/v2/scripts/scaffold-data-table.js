#!/usr/bin/env node
// scaffold-data-table.js — v74 ships a reusable DataTable component
// to every frontend. CRUD list pages and admin tables both consume it
// instead of reinventing the sort+pagination+empty+loading pattern.
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
    console.error('Usage: scaffold-data-table --target FRONTEND_DIR --templates components/data-table/');
    process.exit(1);
  }
  return out;
}

function copyIfMissing(src, dst, opts) {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dst) && !opts.force) {
    if (opts.verbose) console.log('  skip (exists): ' + path.relative(opts.target, dst));
    return false;
  }
  if (opts.dryRun) { console.log('  [dry] would write ' + path.relative(opts.target, dst)); return true; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('  ✓ wrote ' + path.relative(opts.target, dst));
  return true;
}

function main() {
  var args = parseArgs(process.argv);
  copyIfMissing(
    path.join(args.templates, 'DataTable.tsx'),
    path.join(args.target, 'app/components/data-table/DataTable.tsx'),
    args,
  );
  console.log('scaffold-data-table: done');
}

main();
