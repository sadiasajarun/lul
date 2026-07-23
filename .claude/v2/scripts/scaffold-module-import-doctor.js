#!/usr/bin/env node
// scaffold-module-import-doctor.js — v97
//
// Walks backend src/**/*.module.ts. For each `import { X } from './Y'`
// statement, checks if `./Y.ts` (or .index.ts) actually exists. If not:
//   1. Removes the import line
//   2. Removes any reference to X in the @Module decorator
//      (controllers/providers/exports lists)
//
// v96 evidence: dashboard.module.ts + notification.module.ts both ended
// backend phase importing controllers/dtos that didn't exist at
// typecheck time. The implement-fanout LLM overwrote/deleted those
// files later, but the broken import was already enough to fail tsc
// → backend phase ended with 1 fail → cascade.
//
// This doctor runs BEFORE ts-balance-doctor in backend phase. The
// ts-doctor handles parse errors (TS1xxx); this handles semantic
// import errors (TS2307). Together they cover the most common LLM-
// induced backend typecheck cascade.
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
    console.error('Usage: scaffold-module-import-doctor --target <BACKEND_DIR> [--dry-run]');
    process.exit(1);
  }
  return out;
}

function findModuleFiles(root, out) {
  if (!fs.existsSync(root)) return;
  fs.readdirSync(root, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (/^(node_modules|dist|build)$/.test(e.name)) return;
      findModuleFiles(p, out);
    } else if (e.isFile() && /\.module\.ts$/.test(e.name)) {
      out.push(p);
    }
  });
}

// Check if a relative import path resolves to an actual file
function resolvesToFile(moduleFile, importPath) {
  if (!importPath.startsWith('.')) return true; // skip absolute/package imports
  var moduleDir = path.dirname(moduleFile);
  // Try .ts, .tsx, /index.ts
  var candidates = [
    path.join(moduleDir, importPath + '.ts'),
    path.join(moduleDir, importPath + '.tsx'),
    path.join(moduleDir, importPath, 'index.ts'),
    path.join(moduleDir, importPath + '.d.ts'),
  ];
  return candidates.some(function (c) { return fs.existsSync(c); });
}

function processModuleFile(moduleFile, opts) {
  var src = fs.readFileSync(moduleFile, 'utf-8');
  var lines = src.split('\n');
  var newLines = [];
  var droppedSymbols = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    // Match: import { Foo, Bar } from './foo';
    var importRe = /^import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"]/;
    var m = line.match(importRe);
    if (m) {
      var symbols = m[1].split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var importPath = m[2];
      if (!resolvesToFile(moduleFile, importPath)) {
        // Drop this import + remember symbols to scrub from @Module
        droppedSymbols = droppedSymbols.concat(symbols);
        if (opts.verbose) console.log('    drop import: ' + line.trim() + ' (path ' + importPath + ' does not resolve)');
        continue;
      }
    }
    newLines.push(line);
  }

  // Scrub dropped symbols from @Module decorator (controllers/providers/exports)
  if (droppedSymbols.length > 0) {
    var content = newLines.join('\n');
    droppedSymbols.forEach(function (sym) {
      // Remove `Sym,` or `, Sym` or `Sym ` inside list bodies; conservative regex
      var patterns = [
        new RegExp('\\b' + sym + '\\s*,\\s*', 'g'),   // "Sym, "
        new RegExp(',\\s*\\b' + sym + '\\b', 'g'),    // ", Sym"
        new RegExp('\\b' + sym + '\\b', 'g'),         // "Sym" (last)
      ];
      patterns.forEach(function (re) { content = content.replace(re, ''); });
    });
    // Clean up empty arrays/commas left over
    content = content.replace(/,\s*,/g, ',');
    content = content.replace(/\[\s*,/g, '[');
    content = content.replace(/,\s*\]/g, ']');
    newLines = content.split('\n');
  }

  var newSrc = newLines.join('\n');
  if (newSrc === src) return { changed: false };

  if (opts.dryRun) {
    console.log('  [dry] would modify ' + path.relative(opts.target, moduleFile) +
      ' (drop ' + droppedSymbols.length + ' broken import(s))');
  } else {
    fs.writeFileSync(moduleFile, newSrc);
    console.log('  ✓ ' + path.relative(opts.target, moduleFile) +
      ': dropped ' + droppedSymbols.length + ' broken import(s) [' + droppedSymbols.join(', ') + ']');
  }
  return { changed: true, dropped: droppedSymbols.length };
}

function main() {
  var args = parseArgs(process.argv);
  var srcDir = path.join(args.target, 'src');
  if (!fs.existsSync(srcDir)) {
    console.log('scaffold-module-import-doctor: no src/ — skipping');
    return;
  }

  var moduleFiles = [];
  findModuleFiles(srcDir, moduleFiles);
  if (moduleFiles.length === 0) {
    console.log('scaffold-module-import-doctor: no *.module.ts found — skipping');
    return;
  }

  var changed = 0;
  var totalDropped = 0;
  moduleFiles.forEach(function (f) {
    var r = processModuleFile(f, args);
    if (r.changed) {
      changed++;
      totalDropped += r.dropped || 0;
    }
  });

  console.log('scaffold-module-import-doctor: scanned ' + moduleFiles.length +
    ' module(s), modified ' + changed + ', dropped ' + totalDropped + ' broken import(s)');
}

main();
