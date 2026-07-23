#!/usr/bin/env node
// scaffold-routes-dedupe.js — v81 normalize step. After LLM convert-pages,
// React Router 7's `routes.ts` config sometimes has two route entries
// pointing to the same component file:
//   route("signup", "pages/auth/register.tsx"),
//   route("register", "pages/auth/register.tsx"),
// RR7 uses the component path as the implicit route id; duplicates make
// vite dev server crash at boot with:
//   Error: Unable to define routes with duplicate route id: "pages/auth/register"
//
// v80 evidence: worker cell test-browser crashed in 5.6s at ensure-servers
// because of this exact pattern. Whole story-runner phase skipped — 0
// stories tested for that cell.
//
// This scaffold walks every app/routes/*.routes.ts (+ app/routes.ts) and
// removes duplicate route() entries where the component path repeats.
// Keeps the first occurrence (canonical path), comments out duplicates.
//
// Idempotent. Edits files in place. Skips files without a route() call.
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
  if (!out.target) { console.error('Usage: scaffold-routes-dedupe --target FRONTEND_DIR'); process.exit(1); }
  return out;
}

function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && /\.routes\.ts$/.test(e.name)) out.push(p);
  });
  return out;
}

// Match: route("path", "component.tsx", ...) — capturing path + component
// Allows single OR double quotes. Captures the component string (group 2).
// Allows optional 3rd arg (options or nested children).
var ROUTE_LINE_RE = /(\s*)route\s*\(\s*(['"])([^'"]+)\2\s*,\s*(['"])([^'"]+)\4\s*(,\s*\[?[^\)]*)?\)/;
// v115: also catch `index("component.tsx")` whose component a route()/index()
// already used (the route-vs-index duplicate that crashed the v115 build).
var INDEX_LINE_RE = /(\s*)index\s*\(\s*(['"])([^'"]+)\2\s*\)/;
// v121: layout() wrappers collide too. `layout('components/guards/AuthGuard.tsx',
// [...])` repeated across worker/company/admin route groups gives RR7 the SAME id
// ("components/guards/AuthGuard") → "Unable to define routes with duplicate route
// id" → frontend BUILD aborts (hard gate). Disambiguate like route()/index().
var LAYOUT_LINE_RE = /\blayout\s*\(\s*(['"])([^'"]+)\1/;

// Lenient component extractor: the component string of a route() opener, with NO
// closing ')' required — so multi-line `route("admin","admin-dashboard.tsx", [`
// openers register too (the single-line ROUTE_LINE_RE missed them).
// v128: the first-arg path is `[^'"]*` (ZERO+), not `[^'"]+`. An index-style
// `route('', 'pages/admin/admin-dashboard.tsx')` has an EMPTY path string; `+`
// failed to match it, so the empty-path route never registered in `seen` and the
// sibling `route('dashboard', '…admin-dashboard.tsx')` looked like a FIRST use →
// no disambiguation → both kept auto-id "pages/admin/admin-dashboard" → RR7
// "duplicate route id" → primary frontend BUILD abort (v128 hard-gate failure).
var ROUTE_COMP_RE = /\broute\s*\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]/;

// Derive a stable, unique RR7 route id from the component path + occurrence #.
function uniqueId(component, n) {
  var base = component.replace(/^pages\//, '').replace(/\.tsx?$/, '').replace(/[\/]/g, '-');
  return base + '-' + n;
}

// v115: RR7 derives the route id from the component path, so the SAME component
// used by 2+ routes — same file (`route("admin","x.tsx",[ index("x.tsx") ])`) OR
// across files (worker.routes + company.routes both `index("pages/dashboard.tsx")`)
// — crashes the build with "duplicate route id". Instead of REMOVING (which loses
// a role's route), we DISAMBIGUATE: add `{ id: "<unique>" }` to the 2nd+ use so
// every route survives with a distinct id. `seen` is shared across all route
// files (global, like RR7's id namespace).
function dedupeFile(filePath, dryRun, verbose, seen) {
  var content = fs.readFileSync(filePath, 'utf-8');
  var lines = content.split('\n');
  var changes = [];
  var out = lines.map(function (line) {
    if (/\[scaffold-routes-dedupe\]/.test(line)) return line;
    // A line that already carries an explicit { id: 'X' } was disambiguated by an
    // earlier pass — but the id ITSELF can collide across files (v123: routes-prune
    // emitted 'pruned-1' in several files → duplicate route id → build abort). So
    // dedupe the explicit id too: a repeated id gets a unique suffix. Idempotent
    // (a first occurrence + an already-suffixed 'X-2' both stay put on re-run).
    var explicitId = /\{\s*id\s*:\s*(['"])([^'"]+)\1\s*\}/.exec(line);
    if (explicitId) {
      var eid = explicitId[2], ekey = 'id:' + eid;
      seen[ekey] = (seen[ekey] || 0) + 1;
      if (seen[ekey] > 1) {
        var neid = eid + '-' + seen[ekey];
        changes.push({ comp: eid, id: neid, kind: 'id' });
        return line.replace(/(\{\s*id\s*:\s*)(['"])[^'"]+\2(\s*\})/, '$1"' + neid + '"$3');
      }
      return line;
    }
    var rc = ROUTE_COMP_RE.exec(line);
    if (rc) {
      var comp = rc[1];
      seen[comp] = (seen[comp] || 0) + 1;
      if (seen[comp] > 1) {
        var id = uniqueId(comp, seen[comp]);
        changes.push({ comp: comp, id: id, kind: 'route' });
        return line.replace(/(\broute\s*\(\s*['"][^'"]*['"]\s*,\s*['"][^'"]+['"])/, '$1, { id: "' + id + '" }');
      }
      return line;
    }
    var im = INDEX_LINE_RE.exec(line);
    if (im) {
      var icomp = im[3];
      seen[icomp] = (seen[icomp] || 0) + 1;
      if (seen[icomp] > 1) {
        var iid = uniqueId(icomp, seen[icomp]);
        changes.push({ comp: icomp, id: iid, kind: 'index' });
        return line.replace(/(\bindex\s*\(\s*(['"])[^'"]+\2)/, '$1, { id: "' + iid + '" }');
      }
      return line;
    }
    var lm = LAYOUT_LINE_RE.exec(line);
    if (lm) {
      var lcomp = lm[2];
      seen[lcomp] = (seen[lcomp] || 0) + 1;
      if (seen[lcomp] > 1) {
        var lid = uniqueId(lcomp, seen[lcomp]);
        changes.push({ comp: lcomp, id: lid, kind: 'layout' });
        // layout(file, children) → layout(file, { id }, children) — RR7 accepts the
        // options arg between file and children.
        return line.replace(/(\blayout\s*\(\s*(['"])[^'"]+\2)/, '$1, { id: "' + lid + '" }');
      }
      return line;
    }
    return line;
  });
  if (changes.length === 0) return { changed: false, removed: 0 };
  if (!dryRun) fs.writeFileSync(filePath, out.join('\n'));
  if (verbose) changes.forEach(function (c) {
    console.log('  ' + path.relative(process.cwd(), filePath) + ': disambiguated ' + c.kind + '("' + c.comp + '") → id "' + c.id + '"');
  });
  return { changed: true, removed: changes.length };
}

function main() {
  var args = parseArgs(process.argv);
  // Walk both app/routes/*.routes.ts files AND the top-level app/routes.ts
  var routeFiles = walk(path.join(args.target, 'app/routes'), []);
  var topLevel = path.join(args.target, 'app/routes.ts');
  if (fs.existsSync(topLevel)) routeFiles.push(topLevel);
  if (routeFiles.length === 0) {
    console.log('scaffold-routes-dedupe: no *.routes.ts files under ' + args.target);
    return;
  }
  var seen = {}; // shared across all files — RR7 route ids are a global namespace
  var filesFixed = 0, totalRemoved = 0;
  routeFiles.forEach(function (f) {
    var r = dedupeFile(f, args.dryRun, args.verbose, seen);
    if (r.changed) { filesFixed++; totalRemoved += r.removed; }
  });
  console.log('scaffold-routes-dedupe: ' + filesFixed + ' file(s) fixed, ' + totalRemoved + ' duplicate route id(s) disambiguated');
}

main();
