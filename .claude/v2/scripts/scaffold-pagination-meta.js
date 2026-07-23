#!/usr/bin/env node
// scaffold-pagination-meta.js — v73 normalize step. Inspects every
// scaffolded service.ts that extends BaseService<Entity> and ensures
// the findAll override (if any) returns { items, total, page, limit,
// totalPages }. v70 evidence: frontend pagination UI needs totalPages
// but backend returns it inconsistently — sometimes wrapping in {data:},
// sometimes just an array.
//
// If a service.ts has a findAll override that returns a raw array, we
// inject a wrapper that converts to the canonical shape. If no override
// exists, BaseService already returns the canonical shape — no action.
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
  if (!out.target) { console.error('Usage: scaffold-pagination-meta --target BACKEND_DIR'); process.exit(1); }
  return out;
}

function walkServices(dir, out) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var f = path.join(dir, e.name);
    if (e.isDirectory()) walkServices(f, out);
    else if (e.isFile() && /\.service\.ts$/.test(e.name)) out.push(f);
  });
}

function main() {
  var args = parseArgs(process.argv);
  var modulesDir = path.join(args.target, 'src/modules');
  var services = [];
  walkServices(modulesDir, services);

  var rewrote = 0;
  var skipped = 0;
  for (var i = 0; i < services.length; i++) {
    var f = services[i];
    var content = fs.readFileSync(f, 'utf-8');
    if (!/extends BaseService/.test(content)) { skipped++; continue; }

    // Detect findAll overrides that return a raw array. The regex is
    // intentionally tight — only rewrites unambiguous cases. Anything
    // more complex stays untouched.
    var rewrittenContent = content.replace(
      /async findAll\(\s*([^)]*)\):\s*Promise<(\w+)\[\]>\s*\{([^}]+)return\s+([\w.()]+);\s*\}/g,
      function (_m, params, entityName, body, returnExpr) {
        return 'async findAll(' + params + '): Promise<{ items: ' + entityName + '[]; total: number; page: number; limit: number; totalPages: number }> {' +
               body +
               'const items = ' + returnExpr + ';\n' +
               '    const total = items.length;\n' +
               '    const limit = items.length || 10;\n' +
               '    return { items, total, page: 1, limit, totalPages: 1 };\n' +
               '  }';
      },
    );

    if (rewrittenContent === content) { skipped++; continue; }
    if (args.dryRun) {
      console.log('  [dry] would rewrite ' + path.relative(args.target, f));
    } else {
      fs.writeFileSync(f, rewrittenContent);
      console.log('  ↻ wrapped findAll return → { items, total, page, limit, totalPages } in ' + path.relative(args.target, f));
    }
    rewrote++;
  }
  console.log('scaffold-pagination-meta: rewrote ' + rewrote + ', skipped ' + skipped);
}

main();
