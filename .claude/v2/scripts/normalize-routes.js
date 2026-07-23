#!/usr/bin/env node
/**
 * normalize-routes.js — register per-entity routes/<name>.routes.ts files
 * in the top-level routes.ts.
 *
 * Scans `<frontend>/app/routes/*.routes.ts`, extracts each file's exported
 * routes-array identifier, and emits an aggregator `routes.ts` that imports
 * + spreads all of them.
 *
 * v62-att2 evidence: scaffold-crud-pages writes per-entity routes files
 * (user.routes.ts, notice.routes.ts, etc.) but the top-level routes.ts
 * only imports adminRoutes/workerRoutes/companyRoutes that the LLM
 * convert-shell wrote → scaffold-generated pages are unreachable.
 *
 * Idempotent. Preserves the existing layout() / route() composition above
 * the catch-all 404 by treating the LLM-authored routes.ts as a TEMPLATE
 * to extend rather than overwrite (we add discovered imports + nothing else).
 *
 * Strategy: if routes.ts ALREADY imports a routes-file we discover, no-op.
 * Otherwise, ADD the import + insert the exported array as an additional
 * top-level layout group at the END (before catch-all 404) wrapped in
 * AuthGuard by default. Idempotent on re-run.
 *
 * Usage:
 *   node .claude/v2/scripts/normalize-routes.js --target <frontend-dir> [--dry-run] [-v]
 */

'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: normalize-routes --target <frontend-dir> [--dry-run] [-v]');
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  if (!out.target) {
    console.error('--target required');
    process.exit(1);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const routesDir = path.join(args.target, 'app', 'routes');
  const topRoutesPath = path.join(args.target, 'app', 'routes.ts');

  if (!fs.existsSync(routesDir)) {
    console.log(`normalize-routes: no routes dir at ${routesDir} — skipping`);
    return;
  }
  if (!fs.existsSync(topRoutesPath)) {
    console.log(`normalize-routes: no top-level routes.ts at ${topRoutesPath} — skipping`);
    return;
  }

  const routesFiles = fs.readdirSync(routesDir)
    .filter((n) => /\.routes\.ts$/.test(n));

  if (routesFiles.length === 0) {
    console.log('normalize-routes: no per-entity routes files — skipping');
    return;
  }

  const discovered = [];
  for (const fname of routesFiles) {
    const filePath = path.join(routesDir, fname);
    const content = fs.readFileSync(filePath, 'utf-8');
    // Extract `export const <ident> = [` patterns (the canonical shape)
    const exportMatches = [...content.matchAll(/export\s+const\s+([a-zA-Z_$][\w$]*)\s*=\s*\[/g)];
    for (const m of exportMatches) {
      discovered.push({
        ident: m[1],
        importPath: `./routes/${fname.replace(/\.ts$/, '')}`,
        fname,
      });
    }
  }

  if (discovered.length === 0) {
    console.log('normalize-routes: no exported routes arrays — skipping');
    return;
  }

  const topContent = fs.readFileSync(topRoutesPath, 'utf-8');
  const existingImports = new Set();
  for (const m of topContent.matchAll(/import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]\.\/routes\/[^'"]+['"]/g)) {
    for (const ident of m[1].split(',')) existingImports.add(ident.trim());
  }

  const missing = discovered.filter((d) => !existingImports.has(d.ident));
  if (missing.length === 0) {
    console.log(`normalize-routes: all ${discovered.length} per-entity routes already imported — no-op`);
    return;
  }

  // Inject missing imports right after the last existing `./routes/` import.
  // Then add a new layout() group for each missing routes array, placed
  // BEFORE the catch-all 404.
  const importsToAdd = missing.map((d) => `import { ${d.ident} } from '${d.importPath}';`).join('\n');
  const layoutsToAdd = missing.map((d) => `  layout('components/guards/AuthGuard.tsx', ${d.ident}),`).join('\n');

  let updated = topContent;

  // Find the last `from './routes/...'` import and append new ones after
  const importRegex = /^import\s+\{[^}]+\}\s+from\s+['"]\.\/routes\/[^'"]+['"];?$/gm;
  const lastImport = [...updated.matchAll(importRegex)].pop();
  if (lastImport) {
    const insertAt = lastImport.index + lastImport[0].length;
    updated = updated.slice(0, insertAt) + '\n' + importsToAdd + updated.slice(insertAt);
  } else {
    // No existing routes imports — add at the top of the file after first blank line
    const firstBlank = updated.indexOf('\n\n');
    if (firstBlank !== -1) {
      updated = updated.slice(0, firstBlank) + '\n' + importsToAdd + updated.slice(firstBlank);
    } else {
      updated = importsToAdd + '\n' + updated;
    }
  }

  // Insert new layout groups before the catch-all 404 entry, or before the
  // closing `]` if no catch-all exists.
  const catchAllRegex = /(\s*route\s*\(\s*['"]\*['"])/;
  if (catchAllRegex.test(updated)) {
    updated = updated.replace(catchAllRegex, `\n${layoutsToAdd}\n$1`);
  } else {
    // Insert before the closing `] satisfies RouteConfig`
    updated = updated.replace(/(\]\s*satisfies\s+RouteConfig)/, `\n${layoutsToAdd}\n$1`);
  }

  if (args.dryRun) {
    console.log(`normalize-routes: would update ${topRoutesPath} — add ${missing.length} routes imports`);
    if (args.verbose) {
      for (const d of missing) console.log(`  + ${d.ident} from ${d.importPath}`);
    }
    return;
  }

  fs.writeFileSync(topRoutesPath, updated);
  console.log(`normalize-routes: updated ${topRoutesPath} — added ${missing.length} routes:`);
  for (const d of missing) console.log(`  + ${d.ident}`);
}

main();
