#!/usr/bin/env node
// scaffold-test-enum-imports.js — v82. Walk backend/test/**/*.spec.ts +
// frontend/tests/**/*.spec.ts files, find references to *Enum.X that
// aren't imported, and prepend the missing imports.
//
// v79+v80 evidence: LLM-generated tests reference `DocumentStatusEnum.*`,
// `NotificationTypeEnum.*`, etc. but don't import them. TS errors cascade
// through typecheck + verify-green + run-backend-tests.
//
// scaffold-test-specs templates now use RoleEnum correctly (v79b fix),
// but generate-tests fanout creates per-controller test files that
// reference DOMAIN enums the LLM forgets to import.
//
// Strategy: walk *.spec.ts files, find `\w+Enum\.\w+` patterns, check
// imports, look up the enum file in backend/src/**/*.enum.ts +
// frontend/app/enums/*.enum.ts, prepend missing imports.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--side') out.side = argv[++i]; // 'backend' or 'frontend'
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target || !out.side) {
    console.error('Usage: scaffold-test-enum-imports --target DIR --side backend|frontend');
    process.exit(1);
  }
  return out;
}

function walk(dir, filterFn, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var f = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/^(node_modules|dist|\.git)$/.test(e.name)) return;
      walk(f, filterFn, out);
    } else if (e.isFile() && filterFn(f)) out.push(f);
  });
  return out;
}

function buildEnumCatalog(target, side) {
  // For backend: walk src/**/*.enum.ts; relative import from test/ is '../../src/...'
  // For frontend: walk app/enums/*.enum.ts; relative import from tests/ is '~/enums/...'
  var catalog = {}; // EnumName → { importPath: relative path or alias }
  if (side === 'backend') {
    var srcEnums = walk(path.join(target, 'src'), function (f) { return /\.enum\.ts$/.test(f); }, []);
    srcEnums.forEach(function (f) {
      var content = fs.readFileSync(f, 'utf-8');
      var re = /export\s+enum\s+(\w+)/g; var m;
      while ((m = re.exec(content)) !== null) {
        // Relative import path from a file at backend/test/e2e/foo.e2e-spec.ts → '../../src/...'
        var fromTestE2e = path.relative(path.join(target, 'test/e2e'), f).replace(/\\/g, '/').replace(/\.ts$/, '');
        catalog[m[1]] = fromTestE2e;
      }
    });
  } else {
    // frontend
    var feEnums = walk(path.join(target, 'app/enums'), function (f) { return /\.enum\.ts$/.test(f); }, []);
    feEnums.forEach(function (f) {
      var content = fs.readFileSync(f, 'utf-8');
      var re = /export\s+enum\s+(\w+)/g; var m;
      while ((m = re.exec(content)) !== null) {
        var alias = '~/enums/' + path.basename(f, '.ts');
        catalog[m[1]] = alias;
      }
    });
  }
  return catalog;
}

function findReferencedEnums(content) {
  var names = {};
  var re = /\b(\w+Enum)\.\w+/g;
  var m;
  while ((m = re.exec(content)) !== null) names[m[1]] = true;
  return Object.keys(names);
}

function findImportedNames(content) {
  var imported = {};
  var re = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+['"][^'"]+['"]/g;
  var m;
  while ((m = re.exec(content)) !== null) {
    if (m[2]) imported[m[2]] = true;
    if (m[1]) m[1].split(',').forEach(function (entry) {
      var parts = entry.trim().split(/\s+as\s+/);
      var local = (parts[1] || parts[0]).trim().replace(/^type\s+/, '');
      if (local) imported[local] = true;
    });
  }
  return imported;
}

function injectImports(content, missing, catalog) {
  var byPath = {};
  missing.forEach(function (name) {
    var importPath = catalog[name];
    if (!importPath) return;
    if (!byPath[importPath]) byPath[importPath] = [];
    if (byPath[importPath].indexOf(name) === -1) byPath[importPath].push(name);
  });
  if (Object.keys(byPath).length === 0) return { content: content, added: [] };

  var newImports = [];
  Object.keys(byPath).sort().forEach(function (p) {
    newImports.push("import { " + byPath[p].sort().join(', ') + " } from '" + p + "';");
  });

  var lines = content.split('\n');
  var lastImportIdx = -1;
  for (var i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i])) lastImportIdx = i;
  }
  var insertAt = lastImportIdx >= 0 ? lastImportIdx + 1 : 0;
  lines.splice.apply(lines, [insertAt, 0].concat(newImports));
  return { content: lines.join('\n'), added: newImports };
}

function main() {
  var args = parseArgs(process.argv);
  var catalog = buildEnumCatalog(args.target, args.side);
  if (args.verbose) {
    console.log('  enum catalog: ' + Object.keys(catalog).length + ' enums available');
  }
  // Find test files
  var testFiles;
  if (args.side === 'backend') {
    testFiles = walk(path.join(args.target, 'test'), function (f) { return /\.(spec|e2e-spec)\.ts$/.test(f); }, []);
  } else {
    testFiles = walk(path.join(args.target, 'tests'), function (f) { return /\.(spec|test)\.ts$/.test(f); }, []);
    testFiles = testFiles.concat(walk(path.join(args.target, 'app'), function (f) { return /\.test\.tsx?$/.test(f); }, []));
  }
  var fixed = 0, totalAdded = 0;
  testFiles.forEach(function (f) {
    var content = fs.readFileSync(f, 'utf-8');
    var referenced = findReferencedEnums(content);
    if (referenced.length === 0) return;
    var imported = findImportedNames(content);
    var missing = referenced.filter(function (n) { return !imported[n] && catalog[n]; });
    if (missing.length === 0) return;
    var result = injectImports(content, missing, catalog);
    if (result.added.length === 0) return;
    if (!args.dryRun) fs.writeFileSync(f, result.content);
    fixed++;
    totalAdded += result.added.length;
    if (args.verbose) {
      console.log('  ' + path.relative(args.target, f) + ': +' + result.added.length + ' enum imports (' + missing.join(', ') + ')');
    }
  });
  console.log('scaffold-test-enum-imports: fixed ' + fixed + ' files, added ' + totalAdded + ' import statements');
}

main();
