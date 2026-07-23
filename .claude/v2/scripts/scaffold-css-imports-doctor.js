#!/usr/bin/env node
// scaffold-css-imports-doctor.js — v115
//
// Remove unresolvable bare-package CSS @imports that break the Tailwind-v4 + Vite
// production build.
//
// BUG (v115 evidence): app/styles/app.css had `@import "tw-animate-css";`. The
// package's exports only expose "." via a `style` condition that @tailwindcss/vite
// does not apply (and the dist file isn't a permitted subpath), so:
//   [@tailwindcss/vite:generate:build] Failed to resolve entry for "tw-animate-css"
//   ... No known conditions for "." specifier
// → `npm run build` dies → frontend phase fails at the (HARD) build gate → the
// whole downstream (integrate/test-api/test-browser) is skipped.
//
// WHY A DOCTOR (not just a template edit): the slim baseline FREEZES the
// frontend shell (app/styles/app.css), so a fix to the react template only lands
// in a future baseline rebuild. The run uses the LIVE .claude scaffolds, so this
// doctor repairs the frozen app.css on EVERY run — no baseline rebuild needed.
//
// Idempotent. Targets the known-incompatible bare imports; leaves everything else.
'use strict';

var fs = require('fs');
var path = require('path');

// Bare package @imports known to be incompatible with @tailwindcss/vite (exports
// without a default/import condition). Extend this list as new ones surface.
var BAD_IMPORTS = ['tw-animate-css'];

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-css-imports-doctor --target <FRONTEND_DIR> [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

function walkCss(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  fs.readdirSync(dir).forEach(function (n) {
    if (n === 'node_modules' || n === 'dist' || n === 'build' || n === '.git') return;
    var full = path.join(dir, n);
    var st = fs.statSync(full);
    if (st.isDirectory()) walkCss(full, acc);
    else if (/\.css$/.test(n)) acc.push(full);
  });
  return acc;
}

function main() {
  var opts = parseArgs(process.argv);
  var files = walkCss(path.join(opts.target, 'app'), []);
  var fixed = 0, filesTouched = 0;
  files.forEach(function (f) {
    var src = fs.readFileSync(f, 'utf-8');
    var orig = src;
    var n = 0;
    BAD_IMPORTS.forEach(function (pkg) {
      // @import "pkg"; | @import 'pkg'; | @import "pkg/anything";
      var re = new RegExp('^[ \\t]*@import\\s+["\\\']' + pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:/[^"\\\']*)?["\\\']\\s*;?[ \\t]*\\r?\\n?', 'gm');
      src = src.replace(re, function () { n++; return ''; });
    });
    if (src !== orig) {
      filesTouched++; fixed += n;
      if (opts.verbose || opts.dryRun) console.log('  ' + (opts.dryRun ? '[dry] would remove' : 'removed') + ' ' + n + ' bad @import(s) from ' + path.relative(opts.target, f));
      if (!opts.dryRun) fs.writeFileSync(f, src);
    }
  });
  console.log('scaffold-css-imports-doctor: removed ' + fixed + ' unresolvable @import(s) across ' + filesTouched + ' file(s) (' + files.length + ' css scanned)');
}

main();
