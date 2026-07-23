#!/usr/bin/env node
// scaffold-app-module-registry.js — v89
//
// Auto-register every `<name>.module.ts` under src/modules/ in app.module.ts.
//
// v88 evidence: 12 module dirs were absent from app.module.ts despite having
// real controllers. application-workflow.controller.ts and document-upload.
// controller.ts shipped @Controller(...) decorators but their modules were
// never imported in AppModule → routes 404 at runtime.
//
// STRATEGY:
//   - Walk src/modules/<name>/<name>.module.ts
//   - Extract the exported module class name from each
//   - In app.module.ts:
//     - Insert `import { X } from './modules/X/X.module';` (between BEGIN/END
//       AUTO-MODULES markers, or just before @Module if no markers)
//     - Insert each module into the `imports: [...]` array
//
// Idempotent — uses managed BEGIN/END markers so re-runs leave manual edits
// outside the markers untouched.
'use strict';

var fs = require('fs');
var path = require('path');

var BEGIN_MARKER = '// BEGIN auto-modules (managed by scaffold-app-module-registry)';
var END_MARKER = '// END auto-modules';

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-app-module-registry --target <BACKEND_DIR>');
    process.exit(1);
  }
  return out;
}

function findFeatureModules(modulesDir) {
  if (!fs.existsSync(modulesDir)) return [];
  var out = [];
  fs.readdirSync(modulesDir, { withFileTypes: true }).forEach(function (e) {
    if (!e.isDirectory()) return;
    var modPath = path.join(modulesDir, e.name, e.name + '.module.ts');
    if (!fs.existsSync(modPath)) return;
    var content = fs.readFileSync(modPath, 'utf-8');
    var m = /export\s+class\s+(\w+Module)/.exec(content);
    if (!m) return;
    out.push({ moduleName: e.name, className: m[1] });
  });
  return out;
}

function updateAppModule(appModulePath, featureModules, options) {
  if (!fs.existsSync(appModulePath)) {
    console.log('scaffold-app-module-registry: app.module.ts not found at ' + appModulePath + ' — skipping');
    return { changed: false };
  }
  var content = fs.readFileSync(appModulePath, 'utf-8');

  // Build the AUTO sections
  var importLines = featureModules.map(function (m) {
    return "import { " + m.className + " } from './modules/" + m.moduleName + "/" + m.moduleName + ".module';";
  });
  var arrayLines = featureModules.map(function (m) { return '    ' + m.className + ','; });

  // Strategy: maintain TWO marked blocks
  //   1. AUTO-MODULES IMPORTS — sits at the top of the file with other imports
  //   2. AUTO-MODULES ARRAY — sits inside the `imports: [...]` of @Module
  // If markers exist, replace between them. If not, insert after last `import`
  // and inside the imports: array.

  var IMPORTS_BEGIN = BEGIN_MARKER + ' imports';
  var IMPORTS_END = END_MARKER + ' imports';
  var ARRAY_BEGIN = BEGIN_MARKER + ' array';
  var ARRAY_END = END_MARKER + ' array';

  // Block 1: imports
  if (content.indexOf(IMPORTS_BEGIN) >= 0) {
    // Replace between markers
    var beforeImports = content.split(IMPORTS_BEGIN)[0];
    var afterImports = content.split(IMPORTS_END)[1] || '';
    content = beforeImports + IMPORTS_BEGIN + '\n' + importLines.join('\n') + '\n' + IMPORTS_END + afterImports;
  } else {
    // Insert before the @Module decorator
    var moduleMatch = /@Module\(/.exec(content);
    if (!moduleMatch) {
      console.log('scaffold-app-module-registry: no @Module decorator found in app.module.ts — skipping');
      return { changed: false };
    }
    var insertAt = moduleMatch.index;
    var insertBlock = '\n' + IMPORTS_BEGIN + '\n' + importLines.join('\n') + '\n' + IMPORTS_END + '\n\n';
    content = content.slice(0, insertAt) + insertBlock + content.slice(insertAt);
  }

  // Block 2: array entry inside @Module({ imports: [ ... ] })
  // Need balanced bracket walk because the array body can contain nested
  // arrays like ConfigModule.forRoot({ load: [jwtConfig] }).
  if (content.indexOf(ARRAY_BEGIN) >= 0) {
    var beforeArray = content.split(ARRAY_BEGIN)[0];
    var afterArray = content.split(ARRAY_END)[1] || '';
    content = beforeArray + ARRAY_BEGIN + '\n' + arrayLines.join('\n') + '\n    ' + ARRAY_END + afterArray;
  } else {
    // Find @Module(...) and walk to its `imports: [` token, then
    // bracket-walk to the matching `]`.
    var moduleStart = content.indexOf('@Module(');
    if (moduleStart < 0) return { changed: false };
    var moduleObjStart = content.indexOf('{', moduleStart);
    if (moduleObjStart < 0) return { changed: false };
    // Find "imports" key within the @Module decorator body
    var importsKeyMatch = /imports\s*:\s*\[/.exec(content.slice(moduleObjStart));
    if (!importsKeyMatch) {
      // No imports: [...] yet — inject one
      var injectAt = moduleObjStart + 1;
      var block = '\n  imports: [\n    ' + ARRAY_BEGIN + '\n' + arrayLines.join('\n') + '\n    ' + ARRAY_END + '\n  ],';
      content = content.slice(0, injectAt) + block + content.slice(injectAt);
    } else {
      // bracket walk to find matching `]`
      var arrStart = moduleObjStart + importsKeyMatch.index + importsKeyMatch[0].length;
      var depth = 1;
      var arrEnd = -1;
      for (var pos = arrStart; pos < content.length; pos++) {
        var c = content[pos];
        if (c === '[') depth++;
        else if (c === ']') {
          depth--;
          if (depth === 0) { arrEnd = pos; break; }
        }
      }
      if (arrEnd < 0) return { changed: false };
      // Insert just before the closing `]`
      var insertion = '\n    ' + ARRAY_BEGIN + '\n' + arrayLines.join('\n') + '\n    ' + ARRAY_END + '\n  ';
      content = content.slice(0, arrEnd) + insertion + content.slice(arrEnd);
    }
  }

  if (options.dryRun) {
    console.log('  [dry] would update app.module.ts with ' + featureModules.length + ' feature module(s)');
    return { changed: true };
  }
  fs.writeFileSync(appModulePath, content);
  return { changed: true };
}

function main() {
  var args = parseArgs(process.argv);
  var modulesDir = path.join(args.target, 'src/modules');
  var appModulePath = path.join(args.target, 'src/app.module.ts');
  var featureModules = findFeatureModules(modulesDir);
  if (featureModules.length === 0) {
    console.log('scaffold-app-module-registry: no feature modules found');
    return;
  }
  if (args.verbose) {
    console.log('  found ' + featureModules.length + ' feature module(s): ' + featureModules.map(function (m) { return m.className; }).slice(0, 5).join(', ') + (featureModules.length > 5 ? ', ...' : ''));
  }
  var r = updateAppModule(appModulePath, featureModules, args);
  if (r.changed) {
    console.log('scaffold-app-module-registry: registered ' + featureModules.length + ' feature module(s) in app.module.ts');
  }
}

main();
