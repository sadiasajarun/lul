#!/usr/bin/env node
// scaffold-page-imports-doctor.js — v77 codemod that scans
// `app/pages/**/*.tsx` and `app/components/**/*.tsx`, finds undefined
// JSX identifiers in a known catalog (UI primitives, layouts, hooks,
// utils), and prepends the missing `import` statements.
//
// v76 evidence: 17 occurrences of `TS2304: Cannot find name 'Input'`
// in `app/pages/user/UserEditPage.tsx` because LLM forgot to import
// Input from `~/components/ui/input`. This codemod fixes that class
// of error before typecheck runs.
//
// Catalog driven by what actually exists in the target tree —
// we walk `app/components/ui/`, `app/components/atoms/`,
// `app/components/layouts/`, `app/hooks/`, `app/lib/`, `app/contexts/`
// and build a {symbol: relative-import-path} map.
//
// We only ADD imports — never remove or modify existing ones.
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
  if (!out.target) { console.error('Usage: scaffold-page-imports-doctor --target FRONTEND_DIR'); process.exit(1); }
  return out;
}

function walk(dir, filterFn, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, filterFn, out);
    else if (e.isFile() && filterFn(f)) out.push(f);
  });
  return out;
}

// Build a catalog of exported symbols across well-known directories.
// We grep the source for `export ... <Name>` / `export { Name }`.
function buildCatalog(target) {
  var catalog = {}; // symbol -> { path: '~/components/ui/input', source: 'absPath' }
  var dirs = [
    'app/components/ui',
    'app/components/atoms',
    'app/components/layouts',
    'app/components/shared',
    'app/components/modals',
    'app/components/guards',
    'app/hooks',
    'app/lib',
    'app/contexts',
    'app/utils',
  ];
  dirs.forEach(function (rel) {
    var d = path.join(target, rel);
    var files = walk(d, function (f) { return /\.(tsx?|jsx?)$/.test(f) && !/\.d\.ts$/.test(f); }, []);
    files.forEach(function (f) {
      var content = fs.readFileSync(f, 'utf-8');
      var importPath = '~/' + path.relative(path.join(target, 'app'), f).replace(/\.(tsx?|jsx?)$/, '').replace(/\\/g, '/');
      // export function/const/class
      var re1 = /export\s+(?:async\s+)?(?:function|const|class|let|var)\s+(\w+)/g;
      var m;
      while ((m = re1.exec(content)) !== null) registerSymbol(catalog, m[1], importPath, f);
      // export default
      var re2 = /export\s+default\s+(?:function|class)?\s*(\w+)?/g;
      while ((m = re2.exec(content)) !== null) {
        if (m[1]) registerSymbol(catalog, m[1], importPath, f, /*isDefault*/true);
        else {
          // anonymous default export — derive from filename
          var base = path.basename(f, path.extname(f));
          if (base !== 'index') {
            var pascal = toPascal(base);
            registerSymbol(catalog, pascal, importPath, f, true);
          }
        }
      }
      // export { A, B as C }   (Shadcn UI pattern — function declared then exported at bottom)
      var re3 = /export\s+\{([^}]+)\}/g;
      while ((m = re3.exec(content)) !== null) {
        m[1].split(',').forEach(function (entry) {
          var parts = entry.trim().split(/\s+as\s+/);
          var publicName = (parts[1] || parts[0]).trim();
          if (publicName && /^\w+$/.test(publicName)) registerSymbol(catalog, publicName, importPath, f);
        });
      }
      // export type { ... } / export interface { ... }
      var re4 = /export\s+type\s+\{([^}]+)\}/g;
      while ((m = re4.exec(content)) !== null) {
        m[1].split(',').forEach(function (entry) {
          var parts = entry.trim().split(/\s+as\s+/);
          var publicName = (parts[1] || parts[0]).trim();
          if (publicName && /^\w+$/.test(publicName)) registerSymbol(catalog, publicName, importPath, f);
        });
      }
    });
  });

  // Service thunks/methods — walk services/httpServices/
  var svcDir = path.join(target, 'app/services/httpServices');
  walk(svcDir, function (f) { return /\.(tsx?)$/.test(f); }, []).forEach(function (f) {
    var content = fs.readFileSync(f, 'utf-8');
    var importPath = '~/' + path.relative(path.join(target, 'app'), f).replace(/\.(tsx?)$/, '').replace(/\\/g, '/');
    var re = /export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g;
    var m;
    while ((m = re.exec(content)) !== null) registerSymbol(catalog, m[1], importPath, f);
  });

  // Redux features
  var reduxDir = path.join(target, 'app/redux/features');
  walk(reduxDir, function (f) { return /\.(tsx?)$/.test(f); }, []).forEach(function (f) {
    var content = fs.readFileSync(f, 'utf-8');
    var importPath = '~/' + path.relative(path.join(target, 'app'), f).replace(/\.(tsx?)$/, '').replace(/\\/g, '/');
    var re = /export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g;
    var m;
    while ((m = re.exec(content)) !== null) registerSymbol(catalog, m[1], importPath, f);
  });

  return catalog;
}

function registerSymbol(catalog, name, importPath, source, isDefault) {
  // Don't overwrite an existing registration — first-write wins (deterministic order).
  if (catalog[name]) return;
  catalog[name] = { path: importPath, source: source, isDefault: !!isDefault };
}

function toPascal(s) {
  return s.split(/[-_\s]+/).filter(Boolean).map(function (w) {
    return w[0].toUpperCase() + w.slice(1);
  }).join('');
}

// Heuristic to detect identifiers used in a file's JSX/code that
// might be missing imports.
function findReferencedNames(content) {
  var names = {};
  // JSX tags: <Foo ...> or <Foo/>
  var re1 = /<([A-Z]\w*)\b/g;
  var m;
  while ((m = re1.exec(content)) !== null) names[m[1]] = true;
  // Function calls / identifiers at use sites: word boundary, starts with lowercase letter for hooks/services
  var re2 = /\b(use[A-Z]\w*|fetch[A-Z]\w*|create[A-Z]\w*|update[A-Z]\w*|delete[A-Z]\w*|cn|httpService)\b/g;
  while ((m = re2.exec(content)) !== null) names[m[1]] = true;
  return Object.keys(names);
}

function findAlreadyImported(content) {
  var imported = {};
  var re = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+['"][^'"]+['"]/g;
  var m;
  while ((m = re.exec(content)) !== null) {
    if (m[2]) imported[m[2]] = true; // default import
    if (m[1]) m[1].split(',').forEach(function (entry) {
      var parts = entry.trim().split(/\s+as\s+/);
      var local = (parts[1] || parts[0]).trim().replace(/^type\s+/, '');
      if (local) imported[local] = true;
    });
  }
  // Locally defined symbols
  var re2 = /(?:^|\n)\s*(?:export\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/g;
  while ((m = re2.exec(content)) !== null) imported[m[1]] = true;
  return imported;
}

function injectImports(content, missing, catalog) {
  // Group by import path
  var byPath = {}; // importPath -> {default: name|null, named: [names]}
  missing.forEach(function (name) {
    var entry = catalog[name];
    if (!entry) return;
    if (!byPath[entry.path]) byPath[entry.path] = { default: null, named: [] };
    if (entry.isDefault) byPath[entry.path].default = name;
    else byPath[entry.path].named.push(name);
  });
  if (Object.keys(byPath).length === 0) return { content: content, added: [] };

  var newImports = [];
  Object.keys(byPath).sort().forEach(function (p) {
    var b = byPath[p];
    var parts = [];
    if (b.default) parts.push(b.default);
    if (b.named.length) parts.push('{ ' + b.named.sort().join(', ') + ' }');
    newImports.push("import " + parts.join(', ') + " from '" + p + "';");
  });

  // Insert after the last existing import (or at top if none).
  var lines = content.split('\n');
  var lastImportIdx = -1;
  for (var i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i])) lastImportIdx = i;
    // stop scanning once we hit non-import code (past the imports block)
    if (lastImportIdx >= 0 && !/^import\s|^\s*$|^\/\/|^\/\*/.test(lines[i]) && i > lastImportIdx + 1) break;
  }
  var insertAt = lastImportIdx >= 0 ? lastImportIdx + 1 : 0;
  var added = [].concat(newImports);
  lines.splice.apply(lines, [insertAt, 0].concat(added, ['']));
  return { content: lines.join('\n'), added: added };
}

function main() {
  var args = parseArgs(process.argv);
  var catalog = buildCatalog(args.target);
  if (args.verbose) console.log('catalog: ' + Object.keys(catalog).length + ' symbols');

  var pagesDir = path.join(args.target, 'app/pages');
  var pageFiles = walk(pagesDir, function (f) { return /\.tsx$/.test(f); }, []);
  // Also scan components (some LLM-generated components miss imports too)
  var compFiles = walk(path.join(args.target, 'app/components'), function (f) {
    return /\.tsx$/.test(f) && !/components\/ui\//.test(f);
  }, []);
  var allFiles = pageFiles.concat(compFiles);

  var fixed = 0, totalAdded = 0;
  allFiles.forEach(function (f) {
    var content = fs.readFileSync(f, 'utf-8');
    var referenced = findReferencedNames(content);
    var alreadyImported = findAlreadyImported(content);
    var missing = referenced.filter(function (n) { return !alreadyImported[n] && catalog[n]; });
    if (missing.length === 0) return;
    var result = injectImports(content, missing, catalog);
    if (result.added.length === 0) return;
    if (!args.dryRun) fs.writeFileSync(f, result.content);
    fixed++;
    totalAdded += result.added.length;
    if (args.verbose) {
      console.log('  ' + path.relative(args.target, f) + ': +' + result.added.length + ' imports (' + missing.join(', ') + ')');
    }
  });
  console.log('scaffold-page-imports-doctor: fixed ' + fixed + ' files, added ' + totalAdded + ' import statements');
}

main();
