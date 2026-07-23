#!/usr/bin/env node
// scaffold-lucide-icon-doctor.js — v88
//
// Replace LLM-hallucinated lucide-react icon names with valid substitutes.
//
// THE BUG: LLM emits icon names that LOOK right but don't exist in lucide-react:
//   CashCheck         → BadgeDollarSign or HandCoins
//   OfficeBuilding    → Building or Building2
//   AccountGroup      → Users or UsersRound
//   FileDocumentCheck → FileCheck or FileCheck2
//   FileChart         → FileBarChart or FileBarChart2
//
// One bad icon import → TS2305 → Vite bundle fails → 500 on every route.
//
// FIX STRATEGY:
//   1. Parse node_modules/lucide-react/dist/lucide-react.d.ts to build the
//      authoritative export catalog.
//   2. Walk app/pages/**/*.tsx + app/components/**/*.tsx for
//      `import { ... } from 'lucide-react'` statements.
//   3. For each imported identifier, check against the catalog. If absent,
//      try common substitutions (hardcoded map below) or fall back to a
//      universally-safe icon ('Circle' for unknown).
//   4. Rewrite the import list and ALSO rewrite the JSX usages of the bad
//      name in the same file to the substitute.
//
// Substitution map is conservative — prefers semantic close-matches; falls
// back to a generic safe icon. Idempotent.
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
    console.error('Usage: scaffold-lucide-icon-doctor --target <FRONTEND_DIR> [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

// Conservative substitution map — covers the LLM hallucinations seen in v87
// and other common bad guesses. When a name is not in the lucide catalog,
// we look it up here first; if no entry, fall back to 'HelpCircle'.
var SUBSTITUTIONS = {
  // Money / commerce
  CashCheck: 'BadgeDollarSign',
  CashRegister: 'Banknote',
  CreditCardCheck: 'CreditCard',
  // Buildings / organizations
  OfficeBuilding: 'Building',
  OfficeBuildingLarge: 'Building2',
  CompanyBuilding: 'Building',
  Organization: 'Building2',
  // People / groups
  AccountGroup: 'Users',
  AccountGroupOutline: 'Users',
  PeopleGroup: 'Users',
  UserGroup: 'Users',
  Account: 'User',
  AccountCircle: 'CircleUser',
  // Documents
  FileDocument: 'FileText',
  FileDocumentCheck: 'FileCheck',
  FileDocumentOutline: 'FileText',
  FileChart: 'FileBarChart',
  FileChartLine: 'FileBarChart',
  FileChartPie: 'FileBarChart',
  DocumentText: 'FileText',
  DocumentCheck: 'FileCheck',
  // Notifications / bells
  BellRing: 'Bell',
  BellAlert: 'BellRing',
  // Charts
  ChartBar: 'BarChart',
  ChartLine: 'LineChart',
  ChartPie: 'PieChart',
  // Generic UI
  ContentSave: 'Save',
  ContentCopy: 'Copy',
  ContentCut: 'Scissors',
  Magnify: 'Search',
  MagnifyPlus: 'ZoomIn',
  MagnifyMinus: 'ZoomOut',
  // Approvals
  CheckBold: 'Check',
  CloseBold: 'X',
  CheckCircleOutline: 'CheckCircle',
  CloseCircle: 'XCircle',
  // Status
  AlertCircleOutline: 'AlertCircle',
  AlertTriangle: 'AlertTriangle', // valid
  AlertOctagon: 'OctagonAlert',
};

var SAFE_FALLBACK = 'HelpCircle';

function buildLucideCatalog(frontendDir) {
  var typesPath = path.join(frontendDir, 'node_modules/lucide-react/dist/lucide-react.d.ts');
  if (!fs.existsSync(typesPath)) {
    console.log('scaffold-lucide-icon-doctor: lucide-react types not found — skipping (project may not use lucide)');
    return null;
  }
  var content = fs.readFileSync(typesPath, 'utf-8');
  var catalog = new Set();
  // `declare const Foo` and `declare const FooIcon` are both valid imports.
  var re = /declare\s+const\s+([A-Z][a-zA-Z0-9]+)\b/g;
  var m;
  while ((m = re.exec(content)) !== null) {
    catalog.add(m[1]);
  }
  return catalog;
}

function walkTsx(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') return;
      walkTsx(p, out);
    } else if (e.isFile() && /\.tsx$/.test(e.name)) {
      out.push(p);
    }
  });
  return out;
}

function processFile(filePath, catalog, options) {
  var content = fs.readFileSync(filePath, 'utf-8');
  // Find all `import { ... } from 'lucide-react'` statements.
  // Support multi-line imports.
  //
  // CRITICAL: must use `[^{}]*` (not `[\s\S]*?`) to keep the import body
  // OPAQUE — the body cannot contain `{` or `}`. Previous version used
  // non-greedy `[\s\S]*?` which still greedily captured ACROSS multiple
  // import statements, picking up everything from the FIRST `import {` in
  // the file through to the FIRST `} from 'lucide-react'`. Result: all
  // identifiers in intervening imports (useState from react, etc.) got
  // treated as lucide hallucinations and substituted. v88 verification
  // found 32 file regressions in worker cell from this bug. Fix: require
  // the body to be brace-free.
  var importRe = /import\s*\{\s*([^{}]*?)\s*\}\s*from\s*['"]lucide-react['"]\s*;?/g;
  var updated = content;
  var totalRewrites = 0;
  var renames = {}; // bad → good for JSX rewrite

  updated = updated.replace(importRe, function (whole, names) {
    var idents = names.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var newIdents = [];
    // Two dedup sets:
    //   localNames: bound names (the LEFT side of `as`, or the bare name)
    //   importedBareNames: actual lucide identifiers being pulled in (for
    //     dedup of multiple substitutions that both map to the same icon)
    var localNames = new Set();
    var importedBareNames = new Set();
    idents.forEach(function (raw) {
      var aliasMatch = /^([A-Za-z0-9_]+)(\s+as\s+([A-Za-z0-9_]+))?$/.exec(raw);
      if (!aliasMatch) { newIdents.push(raw); return; }
      var name = aliasMatch[1];
      var explicitAlias = aliasMatch[3] || null;
      var localBinding = explicitAlias || name;
      // Already declared in this import statement?
      if (localNames.has(localBinding)) return;

      if (catalog.has(name)) {
        // Real lucide icon — keep as-is unless ALREADY imported under a
        // different alias (rare).
        localNames.add(localBinding);
        importedBareNames.add(name);
        newIdents.push(raw);
        return;
      }
      // Hallucinated — substitute. Always emit as `<sub> as <originalName>`
      // so JSX usages like `<CashCheck />` keep working without rewrites.
      var sub = SUBSTITUTIONS[name];
      if (!sub || !catalog.has(sub)) sub = SAFE_FALLBACK;
      renames[name] = sub;
      totalRewrites++;
      // If `sub` already imported in this statement, we just alias the
      // existing import — but TS doesn't allow `Sub, Sub as Name` in one
      // import. Fallback: comment out the duplicate sub.
      if (importedBareNames.has(sub)) {
        // Already have e.g. `Users` imported directly. Emit alias against
        // it via `Sub as Name` — TS DOES allow `X, X as Y` (different
        // local bindings).
        newIdents.push(sub + ' as ' + localBinding + '  /* scaffold-lucide-icon-doctor: ' + name + ' → ' + sub + ' (reusing existing import) */');
      } else {
        newIdents.push(sub + ' as ' + localBinding + '  /* scaffold-lucide-icon-doctor: hallucinated → ' + sub + ' */');
        importedBareNames.add(sub);
      }
      localNames.add(localBinding);
    });
    return 'import { ' + newIdents.join(', ') + " } from 'lucide-react';";
  });

  if (totalRewrites === 0) return { changed: false };
  if (!options.dryRun) fs.writeFileSync(filePath, updated);
  return { changed: true, rewrites: totalRewrites, renames: renames };
}

function main() {
  var args = parseArgs(process.argv);
  var frontendDir = path.resolve(args.target);
  if (!fs.existsSync(path.join(frontendDir, 'app'))) {
    console.log('scaffold-lucide-icon-doctor: no app/ dir under ' + frontendDir + ' — skipping');
    return;
  }
  var catalog = buildLucideCatalog(frontendDir);
  if (!catalog) return;
  if (args.verbose) {
    console.log('scaffold-lucide-icon-doctor: lucide-react catalog has ' + catalog.size + ' icons');
  }
  var tsxFiles = walkTsx(path.join(frontendDir, 'app'));
  var filesFixed = 0;
  var totalRewrites = 0;
  tsxFiles.forEach(function (f) {
    var r = processFile(f, catalog, args);
    if (r.changed) {
      filesFixed++;
      totalRewrites += r.rewrites;
      if (args.verbose) {
        console.log('  ' + path.relative(frontendDir, f) + ': ' + r.rewrites + ' icon(s) substituted');
      }
    }
  });
  console.log('scaffold-lucide-icon-doctor: ' + filesFixed + ' file(s) fixed, ' + totalRewrites + ' hallucinated icon(s) substituted');
}

main();
