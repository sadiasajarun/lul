#!/usr/bin/env node
// scaffold-jwt-role-nullish-doctor.js — v114
//
// Fix the falsy-zero role bug in JWT payload construction.
//
// BUG (v114 evidence): auth.service built the token payload with
//   const payload = { id, email, role: u.role || 'user' };
// The DB/PRD use NUMERIC roles (0=foreign_worker). In JS, `0 || 'user'` === 'user'
// (zero is falsy), so EVERY foreign_worker (role 0) got `role: 'user'` in their JWT.
// RolesGuard then compared 'user' against @Roles('foreign_worker') → 403 on every
// worker endpoint. Login succeeded; every authenticated worker request 403'd.
//
// FIX: rewrite `<expr>.role || <default>` → `<expr>.role ?? <default>` (nullish
// coalescing preserves a valid 0). Scoped to role-defaulting expressions so it
// can't change unrelated `||` semantics.
//
// Idempotent. on_failure: ignore.
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
    console.error('Usage: scaffold-jwt-role-nullish-doctor --target <BACKEND_DIR> [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  fs.readdirSync(dir).forEach(function (n) {
    if (n === 'node_modules' || n === 'dist' || n === '.git') return;
    var full = path.join(dir, n);
    var st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.ts$/.test(n)) acc.push(full);
  });
  return acc;
}

function main() {
  var opts = parseArgs(process.argv);
  var files = walk(path.join(opts.target, 'src'), []);
  // Match `<lhs>.role || <default>` where default is a string/number/identifier.
  // Captures the part up to and including `.role`, then the `||`, then the default.
  var re = /(\b[\w.?[\]'"]*\.role)\s*\|\|\s*(['"][^'"]*['"]|\d+|[A-Za-z_$][\w.$]*)/g;
  var fixed = 0, files_fixed = 0;
  files.forEach(function (f) {
    var src = fs.readFileSync(f, 'utf-8');
    if (!/\.role\s*\|\|/.test(src)) return;
    var n = 0;
    var out = src.replace(re, function (m, lhs, def) { n++; return lhs + ' ?? ' + def; });
    if (out !== src) {
      fixed += n;
      files_fixed++;
      if (opts.verbose || opts.dryRun) {
        console.log('  ' + (opts.dryRun ? '[dry] would fix' : 'fixed') + ' ' + n + ' role-falsy default(s) in ' + path.relative(opts.target, f));
      }
      if (!opts.dryRun) fs.writeFileSync(f, out);
    }
  });
  console.log('scaffold-jwt-role-nullish-doctor: ' + fixed + ' role||default → role??default across ' + files_fixed + ' file(s)');
}

main();
