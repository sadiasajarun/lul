#!/usr/bin/env node
// scaffold-route-prefix-doctor.js — v122. Reconcile RR7 role-group route
// PREFIXES with the story ui_routes (RCA #5: route conventions != ui_route).
//
// v121 live evidence (probe w/ storageState): `goto /admin → "404 Page not
// found"`, `/admin/companies → 404`, BUT `/companies → renders`. convert-wire-
// routes wraps each role group in a PATHLESS layout():
//   layout('components/layouts/AdminLayout.tsx', adminRoutes)
// so adminRoutes mount at ROOT (/companies, /staff) while the stories use
// /admin/* (57×) + /company/* (21×) → EVERY authenticated admin/company story
// navigates to a 404. (worker stories use root paths /dashboard,/documents — so
// the worker group correctly stays pathless.) This was masked for runs because a
// bare-[data-testid] test selector false-passed the 404 layout shell; the v122
// behavior-first specs exposed it.
//
// Fix: convert the innermost role layout to a PATHED route() carrying the prefix
//   layout('…/AdminLayout.tsx', adminRoutes)
//     → route('admin', '…/AdminLayout.tsx', adminRoutes)
// for any role whose STORIES use a /<role> prefix. Roles whose stories use root
// paths (worker) stay pathless. Separately, a pathless role whose dashboard is an
// index() but whose stories address it at /dashboard gets index→route('dashboard').
//
// Evidence-driven + idempotent. A role layout already wrapped in route('<p>', …)
// no longer matches the layout() regex, so re-runs are no-ops.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--stories-dir') out.storiesDir = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) { console.error('Usage: scaffold-route-prefix-doctor --target FRONTEND_DIR [--stories-dir DIR]'); process.exit(1); }
  return out;
}

// roleRoutes var → role keyword: `adminRoutes` → `admin`, `workerRoutes` → `worker`.
function roleFromVar(v) { return v.replace(/Routes$/, '').toLowerCase(); }

// Collect every `ui_route:` value from the story YAMLs (cheap line-grep — no YAML
// parse needed; we only want the path strings). Returns { prefixes:Set, routes:Set }.
function scanStoryRoutes(storiesDir) {
  var prefixes = {}, routes = {};
  if (!storiesDir || !fs.existsSync(storiesDir)) return { prefixes: prefixes, routes: routes };
  fs.readdirSync(storiesDir).filter(function (f) { return /\.ya?ml$/.test(f); }).forEach(function (f) {
    var txt = fs.readFileSync(path.join(storiesDir, f), 'utf-8');
    var re = /ui_route:\s*([^\s#]+)/g, m;
    while ((m = re.exec(txt))) {
      var r = m[1].replace(/['"]/g, '').replace(/\?.*$/, ''); // strip quotes + ?query
      if (r[0] !== '/') continue;
      routes[r] = true;
      var seg = r.split('/')[1];
      if (seg) prefixes['/' + seg] = true;
    }
  });
  return { prefixes: prefixes, routes: routes };
}

// Auto-locate the stories dir under the run's .claude-project if not passed.
function findStoriesDir(target) {
  var root = path.resolve(target, '..');
  for (var up = 0; up < 3; up++) {
    var cp = path.join(root, '.claude-project');
    if (fs.existsSync(cp)) {
      var hit = null;
      (function walk(d, depth) {
        if (hit || depth > 4 || !fs.existsSync(d)) return;
        fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
          if (hit || !e.isDirectory()) return;
          if (e.name === 'user_stories') { hit = path.join(d, e.name); return; }
          walk(path.join(d, e.name), depth + 1);
        });
      })(cp, 0);
      if (hit) return hit;
    }
    root = path.resolve(root, '..');
  }
  return null;
}

// Roles to prefix when there is NO story evidence (conventional fallback).
var DEFAULT_PREFIX_ROLES = { admin: 1, company: 1 };

function main() {
  var args = parseArgs(process.argv);
  var routesTs = path.join(args.target, 'app/routes.ts');
  if (!fs.existsSync(routesTs)) {
    console.log('scaffold-route-prefix-doctor: no app/routes.ts — skipping');
    return;
  }
  var storiesDir = args.storiesDir || findStoriesDir(args.target);
  var story = scanStoryRoutes(storiesDir);
  var haveEvidence = Object.keys(story.prefixes).length > 0;
  if (args.verbose) console.log('  stories-dir: ' + (storiesDir || '(none)') + ' — prefixes: ' + Object.keys(story.prefixes).join(',') || '(none)');

  function prefixForRole(role) {
    if (role === 'public' || role === 'auth' || role === 'guest') return null; // never prefix shells
    if (haveEvidence) return story.prefixes['/' + role] ? role : null;
    return DEFAULT_PREFIX_ROLES[role] ? role : null;
  }

  var src = fs.readFileSync(routesTs, 'utf-8');

  // Match the innermost role layout: `layout('<path>', <identifierVar>)`. The
  // identifier 2nd-arg form (NOT an array `[…]`) is unique to the role groups —
  // guard/shell layouts pass an array of children, so they never match here.
  var LAYOUT_VAR_RE = /(\blayout\s*\(\s*)(['"])([^'"]+)\2(\s*,\s*)([A-Za-z_$][\w$]*)(\s*\))/g;
  var applied = [];
  var newSrc = src.replace(LAYOUT_VAR_RE, function (full, g1, q, lpath, comma, varName, g6) {
    var role = roleFromVar(varName);
    var prefix = prefixForRole(role);
    if (!prefix) return full; // pathless role (worker/public/auth) — leave as-is
    applied.push({ role: role, prefix: prefix, layout: lpath });
    // route(path, file, children) — RR7 signature; children is the role var.
    return "route(" + q + prefix + q + ", " + q + lpath + q + ", " + varName + ")";
  });

  if (applied.length > 0 && !args.dryRun) fs.writeFileSync(routesTs, newSrc);
  applied.forEach(function (a) {
    console.log('  routes.ts: ' + a.role + ' group → prefix /' + a.prefix + ' (layout ' + a.layout + ')');
  });

  // ── Pathless-role dashboard reconciliation ─────────────────────────────────
  // A role left pathless (e.g. worker) whose dashboard is an index() — i.e. at
  // `/` — but whose stories address it at /dashboard renders 404 for that story.
  // Convert that index() to a named route. Only when the story set actually uses
  // /dashboard (evidence-gated) so we never invent a path.
  if (story.routes['/dashboard'] || !haveEvidence) {
    // Map role var → its routes file from the import lines in routes.ts.
    var importRe = /import\s*\{\s*([A-Za-z_$][\w$]*)\s*\}\s*from\s*['"]([^'"]+)['"]/g, im;
    var prefixedRoles = {}; applied.forEach(function (a) { prefixedRoles[a.role] = true; });
    while ((im = importRe.exec(src))) {
      var vName = im[1], spec = im[2];
      if (!/Routes$/.test(vName)) continue;
      var role = roleFromVar(vName);
      if (prefixedRoles[role] || role === 'public' || role === 'auth') continue; // only pathless feature roles
      var rf = path.join(args.target, 'app', spec.replace(/^\.\//, '') + '.ts');
      if (!fs.existsSync(rf)) continue;
      var rsrc = fs.readFileSync(rf, 'utf-8');
      var idxRe = new RegExp("index\\(\\s*(['\"])(pages/" + role + "/dashboard\\.tsx)\\1\\s*\\)");
      if (idxRe.test(rsrc)) {
        var fixed = rsrc.replace(idxRe, "route('dashboard', '$2')");
        if (fixed !== rsrc) {
          if (!args.dryRun) fs.writeFileSync(rf, fixed);
          console.log('  ' + path.relative(args.target, rf) + ': index(dashboard) → route(\'dashboard\', …)  [story ui_route /dashboard]');
        }
      }
    }
  }

  if (applied.length === 0) console.log('scaffold-route-prefix-doctor: no role groups needed a prefix (already pathed or pathless-by-design)');
  else console.log('scaffold-route-prefix-doctor: prefixed ' + applied.length + ' role group(s)');
}

main();
