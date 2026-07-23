#!/usr/bin/env node
// scaffold-i18n-keys.js — extracts all `t('namespace.key', 'default')`
// calls from scaffolded .tsx files and merges missing keys into the
// existing en/ + default-locale JSON files.
//
// Fixes v50-v54 pattern: pages render raw `auth.login.title` strings
// because the locale JSON is missing those keys. The scaffolders emit
// pages with t() calls, but until v67 nothing pre-populated the JSON.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--default-locale') out.defaultLocale = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-i18n-keys --target FRONTEND_DIR [--default-locale ko]');
    process.exit(1);
  }
  out.defaultLocale = out.defaultLocale || 'ko';
  return out;
}

function walkTsx(dir, out) {
  if (!fs.existsSync(dir)) return;
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walkTsx(full, out);
    } else if (e.isFile() && /\.(tsx|ts)$/.test(e.name)) {
      out.push(full);
    }
  }
}

// Match: t('a.b.c'), t("a.b.c"), t('a.b.c', 'default text'), t("a.b.c", `default`)
var T_CALL_RE = /\bt\(\s*['"]([A-Za-z_][\w]*(?:\.[\w]+)+)['"](?:\s*,\s*(?:['"]([^'"]*)['"]|`([^`]*)`))?/g;

function extractKeys(files) {
  var byNs = {};
  for (var i = 0; i < files.length; i++) {
    var content = fs.readFileSync(files[i], 'utf-8');
    var m;
    T_CALL_RE.lastIndex = 0;
    while ((m = T_CALL_RE.exec(content)) !== null) {
      var key = m[1];
      var defaultText = m[2] || m[3] || null;
      var parts = key.split('.');
      var ns = parts.shift();
      if (!byNs[ns]) byNs[ns] = {};
      // Build nested object
      var cur = byNs[ns];
      for (var pi = 0; pi < parts.length - 1; pi++) {
        var p = parts[pi];
        if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
        cur = cur[p];
      }
      var leaf = parts[parts.length - 1];
      // Only set if not already present (first occurrence wins)
      if (cur[leaf] === undefined) {
        cur[leaf] = defaultText !== null ? defaultText : leaf;
      }
    }
  }
  return byNs;
}

function deepMerge(into, from, opts) {
  opts = opts || {};
  for (var k in from) {
    if (!Object.prototype.hasOwnProperty.call(from, k)) continue;
    if (from[k] !== null && typeof from[k] === 'object' && !Array.isArray(from[k])) {
      if (into[k] === undefined || typeof into[k] !== 'object') into[k] = {};
      deepMerge(into[k], from[k], opts);
    } else {
      // Existing values take precedence (don't overwrite translations)
      if (into[k] === undefined) into[k] = from[k];
    }
  }
}

function countLeaves(obj, n) {
  n = n || 0;
  for (var k in obj) {
    if (typeof obj[k] === 'object' && obj[k] !== null) n = countLeaves(obj[k], n);
    else n++;
  }
  return n;
}

function ensureLocaleFile(target, locale, ns, mergedKeys, opts) {
  var file = path.join(target, 'app/i18n/locales', locale, ns + '.json');
  var existing = {};
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (_) { existing = {}; }
  }
  var added = countLeaves(mergedKeys) - countLeaves(existing);
  if (added <= 0 && fs.existsSync(file)) {
    if (opts.verbose) console.log('  ' + locale + '/' + ns + '.json — no new keys');
    return { added: 0, file: file };
  }
  // For default locale, leave English default values as placeholders
  // (better than rendering raw keys; LLM/translator can refine later).
  deepMerge(existing, mergedKeys, {});
  if (opts.dryRun) {
    console.log('  [dry] would write ' + path.relative(target, file) + ' (+' + added + ' keys)');
    return { added: added, file: file };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n');
  return { added: added, file: file };
}

// v132: remove any `import X from './locales/...json'` line OUTSIDE the managed
// marker block. The block (rebuilt above with the full deduped matrix) owns all
// locale imports; anything outside is a duplicate that breaks the build with
// "already been declared". No-op if the markers aren't present (don't touch a
// file we don't manage).
function stripLocaleImportsOutsideMarkers(content) {
  var startM = '// i18n-scaffold-imports-start';
  var endM = '// i18n-scaffold-imports-end';
  var si = content.indexOf(startM);
  var ei = content.indexOf(endM);
  if (si < 0 || ei < 0) return content;
  var before = content.slice(0, si);
  var managed = content.slice(si, ei + endM.length);
  var after = content.slice(ei + endM.length);
  var localeImport = /^[ \t]*import\s+\w+\s+from\s+['"]\.\/locales\/[^'"]+\.json['"];[ \t]*\r?\n?/gm;
  before = before.replace(localeImport, '');
  after = after.replace(localeImport, '');
  return before + managed + after;
}

function updateI18nIndex(target, namespaces, defaultLocale, opts) {
  // Update i18n/index.ts to import + register every namespace × locale.
  var indexFile = path.join(target, 'app/i18n/index.ts');
  if (!fs.existsSync(indexFile)) {
    if (opts.verbose) console.log('  i18n/index.ts missing — skipping registration');
    return;
  }
  var content = fs.readFileSync(indexFile, 'utf-8');
  // Determine which locales exist
  var localesDir = path.join(target, 'app/i18n/locales');
  var locales = [];
  if (fs.existsSync(localesDir)) {
    locales = fs.readdirSync(localesDir).filter(function (d) {
      return fs.statSync(path.join(localesDir, d)).isDirectory();
    });
  }
  if (locales.length === 0) locales = ['en', defaultLocale].filter((v, i, a) => a.indexOf(v) === i);

  // For each (locale, ns), ensure an import + resource entry exists.
  // Use idempotent string-builder approach: parse current imports out, then
  // rebuild the resources block.
  function nsVar(locale, ns) {
    return ns + locale[0].toUpperCase() + locale.slice(1);
  }

  var importBlock = locales.flatMap(function (loc) {
    return namespaces.map(function (ns) {
      return "import " + nsVar(loc, ns) + " from './locales/" + loc + "/" + ns + ".json';";
    });
  }).join('\n');

  var resourcesBlock = locales.map(function (loc) {
    var entries = namespaces.map(function (ns) { return ns + ': ' + nsVar(loc, ns); }).join(', ');
    return '      ' + loc + ': { ' + entries + ' },';
  }).join('\n');

  // Replace the imports section (between first `import` line of locale and
  // the first non-import line). Replace the `resources: { ... }` block.
  // Simpler: just replace `resources: { ... }` and append imports above it.
  // To keep this robust, we replace the entire managed region marked by
  // // i18n-scaffold-imports-start / end + // i18n-scaffold-resources-start / end.
  // If markers don't exist yet, inject them.

  var newContent = content;
  if (!/i18n-scaffold-imports-start/.test(newContent)) {
    // Insert markers around imports + resources blocks. Use anchors.
    // Find first locale import line — these typically come after the initial
    // 'i18next' / 'react-i18next' imports.
    newContent = newContent.replace(/(import [^\n]*from '\.\/locales\/[^\n]*;\n)+/, function (m) {
      return '// i18n-scaffold-imports-start\n' + m + '// i18n-scaffold-imports-end\n';
    });
    newContent = newContent.replace(/resources:\s*\{[\s\S]*?\n\s{4}\},/, function (m) {
      return '// i18n-scaffold-resources-start\n    resources: {\n' + resourcesBlock + '\n    },\n    // i18n-scaffold-resources-end';
    });
  }

  // Now replace the managed regions.
  newContent = newContent.replace(
    /\/\/ i18n-scaffold-imports-start[\s\S]*?\/\/ i18n-scaffold-imports-end/,
    '// i18n-scaffold-imports-start\n' + importBlock + '\n// i18n-scaffold-imports-end'
  );
  newContent = newContent.replace(
    /\/\/ i18n-scaffold-resources-start[\s\S]*?\/\/ i18n-scaffold-resources-end/,
    '// i18n-scaffold-resources-start\n    resources: {\n' + resourcesBlock + '\n    },\n    // i18n-scaffold-resources-end'
  );

  // v132: the managed marker block is the SINGLE source of truth for locale
  // imports (it carries the full deduped locale×namespace matrix). Any
  // `import X from './locales/...'` OUTSIDE the markers is a leftover (the original
  // template/LLM hand-wrote commonKo/authKo/errorsKo before the scaffold ran) and
  // produces esbuild `The symbol "commonKo" has already been declared` → vite
  // build HARD-fails (v132 evidence: 9 dup-import errors, primary frontend aborted;
  // the self-heal i18n doctor only handled missing files/keys, not dup imports, so
  // the retry couldn't fix it). Strip every locale import outside the marker block.
  newContent = stripLocaleImportsOutsideMarkers(newContent);

  if (newContent === content) {
    if (opts.verbose) console.log('  i18n/index.ts already up to date');
    return;
  }
  if (opts.dryRun) {
    console.log('  [dry] would update i18n/index.ts');
    return;
  }
  fs.writeFileSync(indexFile, newContent);
  console.log('  ↻ updated i18n/index.ts with ' + namespaces.length + ' namespaces × ' + locales.length + ' locales');
}

// v130: every locale JSON that i18n/index.ts IMPORTS must exist as a file, or
// vite hard-fails the production build with `UNRESOLVED_IMPORT` (tsc misses it —
// JSON module resolution differs). updateI18nIndex emits imports for every
// (locale × namespace) derived from the locale DIRS, but only en + default-locale
// get key files written — so a partially-translated locale (ru/, vi/ with only
// auth/common/errors) is imported for ALL namespaces yet 10 files are missing →
// build abort at node 71/74 (v130 evidence: 20 missing ru/vi files).
// Parse index.ts's ACTUAL imports (the source of truth vite resolves) and stub
// every missing file from the en fallback (keys present → i18next fallbackLng
// renders English for the untranslated locale; never a raw key). Robust whether
// the imports were emitted by this scaffold or hand-added by the LLM.
function ensureImportedLocaleFiles(target, opts) {
  var indexFile = path.join(target, 'app/i18n/index.ts');
  if (!fs.existsSync(indexFile)) return 0;
  var content = fs.readFileSync(indexFile, 'utf-8');
  var localesDir = path.join(target, 'app/i18n/locales');
  var re = /from\s+'(\.\/locales\/([A-Za-z-]+)\/([A-Za-z0-9_-]+)\.json)'/g;
  var m, created = 0;
  while ((m = re.exec(content)) !== null) {
    var lng = m[2], ns = m[3];
    var f = path.join(localesDir, lng, ns + '.json');
    if (fs.existsSync(f)) continue;
    var enF = path.join(localesDir, 'en', ns + '.json');
    var fromEn = fs.existsSync(enF);
    var body = '{}\n';
    if (fromEn) { try { body = fs.readFileSync(enF, 'utf-8'); } catch (e) { body = '{}\n'; } }
    if (!opts.dryRun) {
      if (!fs.existsSync(path.dirname(f))) fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body);
    }
    created++;
    if (opts.verbose) console.log('  ✚ ' + lng + '/' + ns + '.json (' + (fromEn ? 'from en fallback' : 'empty') + ')');
  }
  if (created) console.log('scaffold-i18n-keys: created ' + created + ' missing imported locale file(s) — prevents vite UNRESOLVED_IMPORT build abort');
  return created;
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.target)) {
    console.error('target missing: ' + args.target);
    process.exit(1);
  }

  // Collect TSX/TS files under app/
  var files = [];
  walkTsx(path.join(args.target, 'app'), files);
  if (files.length === 0) {
    console.log('scaffold-i18n-keys: no .tsx files in app/ — skipping');
    return;
  }
  console.log('scaffold-i18n-keys: scanning ' + files.length + ' files');

  var byNs = extractKeys(files);
  var nsCount = Object.keys(byNs).length;
  if (nsCount === 0) {
    console.log('  no t() calls found');
    // Still run the build-blocker guard: index.ts may import locale files that
    // don't exist regardless of whether app code calls t().
    ensureImportedLocaleFiles(args.target, args);
    return;
  }
  console.log('  found ' + nsCount + ' namespaces: ' + Object.keys(byNs).sort().join(', '));

  // Two locales: en (English source) + default locale (Korean for FSP).
  var locales = ['en'];
  if (args.defaultLocale !== 'en') locales.push(args.defaultLocale);

  var totalAdded = 0;
  for (var i = 0; i < locales.length; i++) {
    var loc = locales[i];
    for (var ns in byNs) {
      var r = ensureLocaleFile(args.target, loc, ns, byNs[ns], args);
      totalAdded += r.added;
    }
  }

  // Also include any pre-existing namespaces from locales/ that t() calls
  // didn't surface (e.g. `common`, `errors`) so we don't drop them when
  // we rewrite i18n/index.ts.
  var allNamespaces = new Set(Object.keys(byNs));
  for (var li = 0; li < locales.length; li++) {
    var locDir = path.join(args.target, 'app/i18n/locales', locales[li]);
    if (!fs.existsSync(locDir)) continue;
    fs.readdirSync(locDir).forEach(function (f) {
      var m = f.match(/^(.+)\.json$/);
      if (m) allNamespaces.add(m[1]);
    });
  }

  // Wire all discovered + pre-existing namespaces into i18n/index.ts.
  updateI18nIndex(args.target, Array.from(allNamespaces).sort(), args.defaultLocale, args);

  // v130: backstop — every file index.ts imports must exist (build-blocker guard).
  ensureImportedLocaleFiles(args.target, args);

  console.log('scaffold-i18n-keys: added ' + totalAdded + ' missing keys across ' + locales.length + ' locale(s)');
}

main();
