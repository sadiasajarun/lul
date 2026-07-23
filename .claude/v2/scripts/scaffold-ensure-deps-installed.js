#!/usr/bin/env node
// scaffold-ensure-deps-installed.js — v82. Check that every dep declared
// in package.json (dependencies + devDependencies) is present in
// node_modules. If any are missing, run `npm install --no-audit --no-fund`.
//
// v81 evidence: bcrypt was declared in package.json (^5.1.1) but
// node_modules/bcrypt/ didn't exist. Seed script + e2e tests failed
// with `Cannot find module 'bcrypt'` → route_to_agent looped 95min
// trying to fix what `npm install` would have fixed in 30sec.
//
// Root cause: scaffolds like scaffold-seed-script, scaffold-toast-system,
// scaffold-frontend-test-config edit package.json but don't trigger
// install. The baseline tar's pre-installed node_modules is stale.
//
// This scaffold runs at the END of backend + frontend phases (before
// anything that needs deps at runtime).
'use strict';

var fs = require('fs');
var path = require('path');
var child_process = require('child_process');

// Node builtins (+ `node:` prefix handled separately) — never npm-installable.
var NODE_BUILTINS = {};
['assert','async_hooks','buffer','child_process','cluster','console','constants',
 'crypto','dgram','dns','domain','events','fs','http','http2','https','inspector',
 'module','net','os','path','perf_hooks','process','punycode','querystring',
 'readline','repl','stream','string_decoder','timers','tls','trace_events','tty',
 'url','util','v8','vm','wasi','worker_threads','zlib'].forEach(function (b) { NODE_BUILTINS[b] = true; });

function walkSource(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name[0] === '.') return;
    var p = path.join(dir, e.name);
    if (e.isDirectory()) walkSource(p, out);
    else if (e.isFile() && /\.(t|j)sx?$/.test(e.name)) out.push(p);
  });
  return out;
}

// Resolve a bare import specifier to its npm package name.
// `@radix-ui/react-slot` -> `@radix-ui/react-slot`; `lucide-react/icons` -> `lucide-react`.
// Returns null for relative / alias / builtin / virtual specifiers (not npm packages).
var NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
function specToPackage(spec) {
  if (!spec) return null;
  if (/\s/.test(spec)) return null;                                          // whitespace ⇒ not a real specifier (greedy-regex noise)
  if (spec[0] === '.' || spec[0] === '/' || spec[0] === '~') return null;   // relative / RR7 alias
  if (spec.indexOf('@/') === 0) return null;                                 // common src alias
  if (spec.indexOf('node:') === 0) return null;                              // explicit builtin
  if (spec.indexOf('virtual:') === 0 || spec.indexOf('\0') !== -1) return null; // vite virtual
  if (NODE_BUILTINS[spec.split('/')[0]]) return null;
  var parts = spec.split('/');
  var name = spec[0] === '@' ? parts.slice(0, 2).join('/') : parts[0]; // scoped vs unscoped
  return NPM_NAME_RE.test(name) ? name : null;                         // reject malformed names
}

// Scan all source files for third-party import/require specifiers → set of package names.
var IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
function scanImportedPackages(target) {
  var pkgs = {};
  ['app', 'src'].forEach(function (sub) {
    walkSource(path.join(target, sub)).forEach(function (file) {
      var src = fs.readFileSync(file, 'utf-8');
      var m;
      IMPORT_RE.lastIndex = 0;
      while ((m = IMPORT_RE.exec(src))) {
        var name = specToPackage(m[1] || m[2] || m[3]);
        if (name) pkgs[name] = true;
      }
    });
  });
  return Object.keys(pkgs);
}

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) { console.error('Usage: scaffold-ensure-deps-installed --target DIR'); process.exit(1); }
  return out;
}

// Phase 1: install declared-but-not-installed deps (the original v82 behavior).
function installDeclaredMissing(target, declaredKeys, dryRun) {
  var missing = declaredKeys.filter(function (dep) {
    return !fs.existsSync(path.join(target, 'node_modules', dep, 'package.json'));
  });
  if (missing.length === 0) {
    console.log('scaffold-ensure-deps-installed: all ' + declaredKeys.length + ' declared deps already installed');
    return;
  }
  console.log('scaffold-ensure-deps-installed: ' + missing.length + ' of ' + declaredKeys.length + ' declared deps missing:');
  missing.slice(0, 8).forEach(function (d) { console.log('  - ' + d); });
  if (missing.length > 8) console.log('  ... and ' + (missing.length - 8) + ' more');
  if (dryRun) { console.log('  [dry-run] would: npm install --legacy-peer-deps --no-audit --no-fund'); return; }

  // v82b: --legacy-peer-deps to absorb peer-dep conflicts (v82 evidence:
  // @vitejs/plugin-react@6 wants vite@^8 but project has vite@5; npm 9+
  // hard-rejects without this flag). LLM-generated package.json often
  // has version skew the scaffolds can't predict; --legacy-peer-deps
  // lets install complete + the conflict surfaces as a runtime warning
  // instead of a 30-second silent abort.
  console.log('  running: npm install --legacy-peer-deps --no-audit --no-fund (in ' + target + ')');
  try {
    var out = child_process.execSync('npm install --legacy-peer-deps --no-audit --no-fund', {
      cwd: target, encoding: 'utf-8', timeout: 4 * 60 * 1000,
    });
    console.log('  npm install completed (' + out.split('\n').length + ' lines output)');
    var stillMissing = missing.filter(function (dep) {
      return !fs.existsSync(path.join(target, 'node_modules', dep, 'package.json'));
    });
    if (stillMissing.length > 0) console.error('  ⚠ ' + stillMissing.length + ' deps STILL missing after install: ' + stillMissing.slice(0, 5).join(', '));
    else console.log('  ✓ all previously-missing declared deps now installed');
  } catch (err) {
    console.error('  npm install FAILED: ' + (err.message || '').slice(0, 300));
  }
}

// Phase 2 (v122): install IMPORTED-but-UNDECLARED packages.
//
// v121 P0 cascade: scaffold-language-toggle emits LanguageToggle.tsx importing
// `~/components/ui/dropdown-menu`, whose shadcn primitive imports
// `@radix-ui/react-dropdown-menu`. That radix peer was never added to
// package.json, so Phase 1 never installed it. The BUILD still passed because
// Vite hoist-resolved it from a stray cell-root node_modules (a fix-agent had
// run `npm install @radix-ui/react-dropdown-menu` at the WRONG cwd → no `react`
// sibling there). At SSR runtime Node ESM couldn't resolve `react` from that
// hoisted copy → EVERY page 500'd → universal AC-1 failure → 7.5% story pass.
//
// A passing build does NOT prove a third-party import is correctly installed in
// frontend/node_modules. So: scan source imports, and for any package imported
// but NOT resolvable inside target/node_modules AND not declared, `npm install`
// it in the CORRECT cwd (target). Installing per-package and tolerating failure
// means a hallucinated specifier just logs a warning — it never pollutes
// package.json (npm only writes the dep on a successful resolve+install).
function installImportedUndeclared(target, declaredKeys, dryRun) {
  var declaredSet = {};
  declaredKeys.forEach(function (k) { declaredSet[k] = true; });
  var imported = scanImportedPackages(target);
  var needed = imported.filter(function (pkg) {
    if (declaredSet[pkg]) return false; // declared → Phase 1 owns it
    // resolvable inside target/node_modules? then it's fine (transitively present)
    return !fs.existsSync(path.join(target, 'node_modules', pkg, 'package.json'));
  });
  if (needed.length === 0) {
    console.log('scaffold-ensure-deps-installed: no imported-but-undeclared packages — OK');
    return;
  }
  console.log('scaffold-ensure-deps-installed: ' + needed.length + ' imported package(s) not declared/installed:');
  needed.forEach(function (d) { console.log('  + ' + d); });
  if (dryRun) { console.log('  [dry-run] would: npm install ' + needed.join(' ') + ' --legacy-peer-deps'); return; }

  // Install one at a time so a single bad specifier doesn't abort the batch.
  needed.forEach(function (pkg) {
    try {
      child_process.execSync('npm install ' + pkg + ' --legacy-peer-deps --no-audit --no-fund', {
        cwd: target, encoding: 'utf-8', timeout: 3 * 60 * 1000,
      });
      var ok = fs.existsSync(path.join(target, 'node_modules', pkg, 'package.json'));
      console.log('  ' + (ok ? '✓' : '⚠') + ' npm install ' + pkg + (ok ? ' → installed + declared' : ' → still missing'));
    } catch (err) {
      console.error('  ⚠ npm install ' + pkg + ' FAILED (likely not a real package): ' + (err.message || '').slice(0, 120));
    }
  });
}

function main() {
  var args = parseArgs(process.argv);
  var pkgPath = path.join(args.target, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.log('scaffold-ensure-deps-installed: no package.json at ' + args.target + ' — skipping');
    return;
  }
  var pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); } catch (e) {
    console.error('scaffold-ensure-deps-installed: package.json parse error: ' + e.message);
    return;
  }
  var declaredKeys = Object.keys(Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {}));
  if (declaredKeys.length > 0) installDeclaredMissing(args.target, declaredKeys, args.dryRun);
  else console.log('scaffold-ensure-deps-installed: no deps declared');

  // Phase 2 re-reads package.json keys (Phase 1 may have just added some).
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')); } catch (e) { /* keep prior */ }
  var declaredAfter = Object.keys(Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {}));
  installImportedUndeclared(args.target, declaredAfter, args.dryRun);
}

main();
