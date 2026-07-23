#!/usr/bin/env node
// scaffold-routes-prune.js — v82. Scan every app/routes/*.routes.ts file,
// parse `route("path", "component.tsx")` lines, and REMOVE entries whose
// component file doesn't exist on disk.
//
// v81 evidence: worker test-browser crashed in 5.8s because routes.ts
// referenced `affiliationRequest/layout.tsx` — that file doesn't exist
// (the directory is kebab-case `affiliation-request/`). vite refused to
// boot with ENOENT, blocking the entire test-browser phase.
//
// This scaffold runs AFTER scaffold-routes-dedupe + all page scaffolds,
// catches kebab/camel mismatches + LLM hallucinations that reference
// non-existent files.
//
// Idempotent. Comments out (doesn't delete) the dangling route lines
// for forensic trail.
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
  if (!out.target) { console.error('Usage: scaffold-routes-prune --target FRONTEND_DIR'); process.exit(1); }
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

// v82b: per-line detection that handles multi-line route() calls.
// We identify lines that START a route/layout/index call (the SIGNATURE
// is on this one line) and extract the component path. Closing `)` may
// be on a later line for nested children — we don't care, we just need
// to know what file the call references.
//
// v81 evidence: my v82a regex required the `)` to be on the same line
// and missed `route('affiliation-requests', 'affiliationRequest/layout.tsx', [`
// which spans multiple lines for its children array. That's exactly
// the line that caused the ENOENT crash.
function checkLine(line) {
  var callMatch = /^(\s*)(route|layout|index)\s*\(/.exec(line);
  if (!callMatch) return null;
  // Skip already-commented-out lines (our own prune marker, or LLM/scaffold comments)
  if (/^\s*\/\//.test(line)) return null;
  // Collect all .tsx/.ts/.jsx/.js string literals on this line.
  var stringRe = /['"]([^'"]+\.(?:tsx|ts|jsx|js))['"]/g;
  var matches = [];
  var m;
  while ((m = stringRe.exec(line)) !== null) matches.push(m[1]);
  if (matches.length === 0) return null;
  // For route('path', 'component.tsx'), component is the 2nd string.
  // For layout('component.tsx') and index('component.tsx'), it's the 1st.
  var kind = callMatch[2];
  var component = (kind === 'route' && matches.length >= 2) ? matches[1] : matches[0];
  return { indent: callMatch[1], kind: kind, component: component };
}

function pickFallback(appDir) {
  // Prefer a known-existing page in priority order. The fallback gets
  // substituted in place of the dangling component so vite still boots.
  var candidates = [
    'pages/not-found.tsx',
    'pages/NotFoundPage.tsx',
    'pages/error.tsx',
    'pages/landing.tsx',
    'pages/index.tsx',
    'root.tsx',
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (fs.existsSync(path.join(appDir, candidates[i]))) return candidates[i];
  }
  return null;
}

// v107 fuzzy-match: when a route points to a missing file, search the same
// directory for a file whose name contains the missing file's stem keyword.
// E.g. routes pointing to "pages/company/staff.tsx" (missing) → finds
// "pages/company/staff-management.tsx". Returns the relative path (from app/)
// if exactly one fuzzy match is found, null otherwise.
function findFuzzyMatch(appDir, component) {
  var dir = path.dirname(component);
  var stem = path.basename(component, path.extname(component)).toLowerCase();
  var absDir = path.join(appDir, dir);
  if (!fs.existsSync(absDir)) return null;
  var entries;
  try { entries = fs.readdirSync(absDir); } catch (e) { return null; }
  var matches = entries.filter(function (e) {
    if (!/\.(tsx|ts|jsx|js)$/.test(e)) return false;
    var eName = e.replace(/\.(tsx|ts|jsx|js)$/, '').toLowerCase();
    // Match if the stem is a substring of the filename (and the filename is
    // longer than the stem — we already checked the exact file doesn't exist)
    return eName.indexOf(stem) !== -1 && eName !== stem;
  });
  if (matches.length !== 1) return null;
  return dir + '/' + matches[0];
}

// v130: remove the children array from any route pruned to not-found.tsx.
// Anchors on our own prune marker `[scaffold-routes-prune] was:` (so fuzzy
// `swapped from:` swaps — which point to a REAL component that CAN render an
// <Outlet/> — are left intact). After the marker's `*/`, if the route's arg
// list continues with `, [ ... ]` (a children array), excise it (comma through
// the bracket-matched `]`), leaving the route's closing `)` so it becomes a leaf.
function stripFallbackChildren(text) {
  var marker = '[scaffold-routes-prune] was:';
  var idx = 0;
  while (true) {
    var m = text.indexOf(marker, idx);
    if (m < 0) break;
    var commentEnd = text.indexOf('*/', m);
    if (commentEnd < 0) { idx = m + marker.length; continue; }
    var j = commentEnd + 2;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] === ',') {
      var k = j + 1;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] === '[') {
        var depth = 0, p = k;
        for (; p < text.length; p++) {
          if (text[p] === '[') depth++;
          else if (text[p] === ']') { depth--; if (depth === 0) break; }
        }
        if (depth === 0) {
          // excise the `, [ ...children... ]` span; keep the trailing `)` that follows
          text = text.slice(0, j) + ' ' + text.slice(p + 1);
          idx = j + 1;
          continue;
        }
      }
    }
    idx = m + marker.length;
  }
  return text;
}

function pruneFile(filePath, frontendRoot, fallback, dryRun, verbose, idCounter) {
  var content = fs.readFileSync(filePath, 'utf-8');
  var lines = content.split('\n');
  var pruned = [];
  // Components are resolved from the `app/` dir
  var appDir = path.join(frontendRoot, 'app');
  var out = lines.map(function (line) {
    var c = checkLine(line);
    if (!c) return line;
    var component = c.component;
    var resolved = path.join(appDir, component);
    var candidates = [resolved, resolved + '.tsx', resolved + '.ts', resolved + '/index.tsx', resolved + '/index.ts'];
    var found = candidates.some(function (p) { return fs.existsSync(p); });
    if (found) return line;
    // v107: try fuzzy match before falling back to not-found
    var fuzzy = findFuzzyMatch(appDir, component);
    if (fuzzy) {
      if (verbose) console.log('  fuzzy swap: ' + component + ' → ' + fuzzy);
      pruned.push({ from: component, to: fuzzy, kind: 'swap' });
      var compRe = new RegExp(
        "(['\"])" + component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(['\"])"
      );
      return line.replace(compRe, function (_m, p1, p2) {
        return p1 + fuzzy + p2 + "/* [scaffold-routes-prune] swapped from: " + component + " */ ";
      });
    }
    pruned.push({ from: component, to: fallback });
    // v85b CRITICAL FIX: when MULTIPLE routes are dangling, they all collapse
    // to the same fallback path → RR7 sees N routes with the same implicit
    // id (the component path minus extension) → "duplicate route id" → vite
    // refuses to boot. v83 worker crash evidence: 8 dangling layouts all
    // replaced with pages/not-found.tsx → 8 routes share id "pages/not-found".
    //
    // Strategy: COMMENT OUT the entire route line when ANY part of it
    // contains a multi-line `route(x, 'Y', [` opener (the v81 case). For
    // simple single-line route()/layout()/index() calls, replace with the
    // fallback BUT inject a unique synthetic `id:` option so RR7 distinguishes.
    //
    // For layout("X", [...]) — too risky to comment out (would break the
    // children array). So we DELETE the layout wrapper but keep its children
    // by removing the entire layout() call and unwrapping the children. But
    // that's a complex refactor. For now: replace the .tsx path AND add
    // `{ id: 'pruned-N' }` synthetic id arg.
    if (!fallback) return line; // no fallback available — leave as-is
    // v123: DETERMINISTIC id from file + component, NOT a counter. A counter resets
    // to 0 on every invocation, so a SECOND prune pass (final pre-build pass, retry,
    // or simulate-loop re-run) re-emits `pruned-1`, `pruned-2`, … colliding with the
    // first pass's ids across files → "duplicate route id: pruned-1" → build abort.
    // file-basename + sanitized component path is globally unique AND idempotent.
    var fileTag = path.basename(filePath).replace(/\.routes\.ts$/, '').replace(/[^a-z0-9]+/gi, '-');
    var compTag = component.replace(/^pages\//, '').replace(/\.tsx?$/, '').replace(/[^a-z0-9]+/gi, '-');
    var uniqueId = 'pruned-' + fileTag + '-' + compTag;
    void idCounter; // retained for signature compat; no longer used
    // Detect if this is a route(x, 'Y') (replaceable) or layout/index (just replace path)
    // Heuristic: if the line ends with `)` or `)` followed by trailing comma,
    // it's a single-line call. Safe to inject `, { id: 'X' }`.
    var trimmed = line.trimEnd();
    var endsCleanly = /\)\s*,?\s*$/.test(trimmed);
    // v85c: handle THREE shapes for injecting unique id (RR7 supports
    // `{ id: 'X' }` as an options arg in all three call sites):
    //   route('path', 'X.tsx')                → route('path', 'pages/not-found.tsx', { id: 'pruned-N' })
    //   route('path', 'X.tsx', [children])    → route('path', 'pages/not-found.tsx', { id: 'pruned-N' }, [children])
    //   layout('X.tsx', [children])            → layout('X.tsx', { id: 'pruned-N' }, [children])
    //   index('X.tsx')                         → index('pages/not-found.tsx', { id: 'pruned-N' })
    //
    // Strategy: locate the dangling .tsx string + the comma/paren AFTER it,
    // splice the id option BEFORE any children array or closing paren.
    var compRe = new RegExp(
      "(['\"])" + component.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "(['\"])(\\s*)"
    );
    return line.replace(compRe, function (_m, p1, p2, trailing) {
      // After the closing quote of the component path, the next non-space
      // char tells us whether children/options follow on this line:
      //   `,` = followed by another arg (could be options or children array)
      //   `)` = single-arg call, this is the close
      // Either way, we inject `, { id: 'X' }` right after the closing quote
      // and BEFORE the trailing whitespace + next token.
      return p1 + fallback + p2 + ", { id: '" + uniqueId + "' }" + trailing +
             "/* [scaffold-routes-prune] was: " + component + " */ ";
    });
  });
  // v130: a route pruned to not-found.tsx must become a LEAF. The line-swap above
  // only replaces the .tsx path + injects a synthetic id; it KEEPS any children
  // array. But not-found.tsx renders no <Outlet/>, so every child under it is
  // (a) UNREACHABLE and worse (b) SHADOWS a real same-path route registered in
  // another *.routes.ts file. v129 evidence: scaffold-crud-pages emitted
  // `route('applications','application/layout.tsx',[index,':id',...])`; the layout
  // file dangled → pruned to not-found, but its `:id` child kept matching FIRST
  // and rendered 404 over the real worker.routes `applications/:id` page → the
  // entire application-detail + application-processing stories failed (13 ACs).
  // Strip the children array off every not-found-pruned route so the real routes win.
  // Runs UNCONDITIONALLY (not gated on new prunes) — on a re-run / --resume the swap
  // already happened in a prior pass, so there are 0 NEW dangling refs but the dead
  // children still need excising.
  var beforeStrip = out.join('\n');
  var joined = stripFallbackChildren(beforeStrip);
  var strippedChildren = joined !== beforeStrip;
  if (pruned.length === 0 && !strippedChildren) return { changed: false, pruned: 0 };
  if (!dryRun) fs.writeFileSync(filePath, joined);
  if (verbose && strippedChildren) console.log('  ' + path.relative(process.cwd(), filePath) + ': stripped dead children off not-found-pruned route(s)');
  if (verbose) {
    pruned.forEach(function (c) {
      console.log('  ' + path.relative(process.cwd(), filePath) + ': ' + c.from + ' → ' + (c.to || '(no fallback)'));
    });
  }
  return { changed: true, pruned: pruned.length };
}

function main() {
  var args = parseArgs(process.argv);
  var fallback = pickFallback(path.join(args.target, 'app'));
  if (!fallback) console.warn('scaffold-routes-prune: no fallback page found in app/ — dangling refs will be left as-is');
  var routeFiles = walk(path.join(args.target, 'app/routes'), []);
  var topLevel = path.join(args.target, 'app/routes.ts');
  if (fs.existsSync(topLevel)) routeFiles.push(topLevel);
  if (routeFiles.length === 0) {
    console.log('scaffold-routes-prune: no *.routes.ts files under ' + args.target);
    return;
  }
  var filesFixed = 0, totalPruned = 0;
  // v85b: shared id counter ensures each pruned route gets a globally-unique
  // synthetic id across all *.routes.ts files. Otherwise file-scoped counters
  // could collide on the implicit id.
  var idCounter = { n: 0 };
  routeFiles.forEach(function (f) {
    var r = pruneFile(f, args.target, fallback, args.dryRun, args.verbose, idCounter);
    if (r.changed) { filesFixed++; totalPruned += r.pruned; }
  });
  console.log('scaffold-routes-prune: ' + filesFixed + ' files pruned, ' + totalPruned + ' dangling route() entries removed');
}

main();
