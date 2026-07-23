#!/usr/bin/env node
// scaffold-broken-imports-quarantine.js — v88
//
// SCANS app/pages/**/*.tsx via `tsc --noEmit -p tsconfig.json` and quarantines
// pages with unresolvable imports. Replaces the page source with a tiny
// safety-net stub that compiles cleanly + renders a placeholder.
//
// WHY: Vite uses STATIC imports — one .tsx file with `import { Foo } from
// '~/nonexistent'` poisons the entire module graph. ALL routes return 500,
// even routes pointing to working pages.
//
// v87 evidence:
//   - admin cell: 28/28 stories CRASHED at global-setup (login page returned
//     500). STORY_QA_REPORT identified 6 LLM-generated pages with bogus
//     imports as the cause.
//   - company cell: 6/6 stories PASSED in the same run. Its routes file
//     didn't statically import the broken pages.
//
// PROVES THE THEORY: one bad LLM page kills the whole cell. routes-prune
// handles MISSING files; this handles BROKEN-IMPORT files (file exists but
// has unresolvable imports).
//
// STRATEGY:
//   1. Run `tsc --noEmit -p tsconfig.json` on the frontend.
//   2. Group errors by file. For each app/pages/**/*.tsx with >0 import
//      errors (TS2307 Cannot find module + TS2305 no exported member),
//      classify:
//      a. If file has >=3 import errors → QUARANTINE: replace entire file
//         with a stub matching the same default export name
//      b. If 1-2 errors: leave for now (page-imports-doctor handles
//         additive fixes; we don't want to fight with it)
//   3. Idempotent. Marker on line 1: `// Quarantined by scaffold-broken-imports-quarantine`
//
// The stub preserves: file path → same default export → routes that import
// it still resolve. The page renders a 404-style placeholder with a
// `data-testid` matching the slug so story-runner gets navigable.
'use strict';

var fs = require('fs');
var path = require('path');
var child_process = require('child_process');

function parseArgs(argv) {
  var out = { threshold: 3 };
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--threshold') out.threshold = parseInt(argv[++i], 10) || 3;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-broken-imports-quarantine --target <FRONTEND_DIR> [--threshold N] [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

var MARKER = '// Quarantined by scaffold-broken-imports-quarantine';

function runTsc(frontendDir) {
  // Resolve TypeScript's tsc.js entry directly via node — bypasses the
  // `node_modules/.bin/tsc` shim which is a 45-byte symlink and fails to
  // resolve in some pipeline environments.
  var tscJs = path.join(frontendDir, 'node_modules/typescript/bin/tsc');
  if (!fs.existsSync(tscJs)) {
    console.log('scaffold-broken-imports-quarantine: no node_modules/typescript/bin/tsc — skipping');
    return null;
  }
  try {
    child_process.execSync('node ' + JSON.stringify(tscJs) + ' --noEmit -p tsconfig.json', {
      cwd: frontendDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    });
    return '';
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function parseErrors(tscOutput) {
  // Format: `path/to/file.tsx(line,col): error TSXXXX: message`
  // We only care about TS2307 (Cannot find module) and TS2305 (no exported member)
  var byFile = {};
  var lines = tscOutput.split('\n');
  lines.forEach(function (line) {
    var m = /^([^(]+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/.exec(line);
    if (!m) return;
    var file = m[1];
    var code = m[4];
    var message = m[5];
    if (code !== 'TS2307' && code !== 'TS2305') return;
    if (!byFile[file]) byFile[file] = [];
    byFile[file].push({ line: parseInt(m[2], 10), col: parseInt(m[3], 10), code: code, message: message });
  });
  return byFile;
}

function kebabToPascal(s) {
  return s.split(/[-_\s]+/).filter(Boolean).map(function (p) {
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join('');
}

function deriveComponentName(filePath) {
  // Reuse the existing default export name if we can find it.
  try {
    var content = fs.readFileSync(filePath, 'utf-8');
    // Match `export default function XxxYyy(`
    var m = /export\s+default\s+function\s+(\w+)/m.exec(content);
    if (m) return m[1];
    // Match `export default class XxxYyy`
    m = /export\s+default\s+class\s+(\w+)/m.exec(content);
    if (m) return m[1];
    // Match `const XxxYyy = ...; export default XxxYyy;`
    m = /export\s+default\s+(\w+)\s*;/.exec(content);
    if (m) return m[1];
  } catch (_) { /* fall through */ }
  // Fall back to filename
  var base = path.basename(filePath, '.tsx');
  return kebabToPascal(base);
}

function renderStub(componentName, originalPath, errors) {
  var slug = path.basename(originalPath, '.tsx').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  var errorLines = errors.slice(0, 6).map(function (e) {
    return '//   ' + e.code + ' (line ' + e.line + '): ' + e.message;
  }).join('\n');
  return [
    MARKER + ' — original had ' + errors.length + ' unresolvable import(s)',
    '// Original: ' + originalPath,
    errorLines,
    '//',
    '// The original page was quarantined because its imports could not be',
    '// resolved. Without quarantine, Vite\'s static module graph fails to',
    '// bundle and the ENTIRE SPA returns 500 — even working pages.',
    '// This stub preserves the file path + default export so routes still',
    '// resolve. Restore the original from git history once imports are fixed.',
    '',
    "import { Link } from 'react-router';",
    '',
    'export default function ' + componentName + '() {',
    '  return (',
    '    <div className="min-h-screen flex flex-col items-center justify-center bg-white p-8" data-testid="' + slug + '-quarantined">',
    '      <h1 className="text-2xl font-bold mb-2">Page Unavailable</h1>',
    '      <p className="text-gray-600 mb-4 text-center max-w-md">',
    '        This page is temporarily quarantined due to a build error.',
    '      </p>',
    '      <Link to="/" className="text-blue-600 underline" data-testid="' + slug + '-home-link">Return home</Link>',
    '    </div>',
    '  );',
    '}',
    '',
  ].join('\n');
}

function isPageFile(filePath, frontendDir) {
  // Only quarantine files under app/pages/. Don't touch components, hooks,
  // services — those would cascade further.
  var rel = path.relative(frontendDir, filePath);
  return /^app\/pages\//.test(rel) && rel.endsWith('.tsx');
}

function isAlreadyQuarantined(filePath) {
  try {
    var first = fs.readFileSync(filePath, 'utf-8').split('\n')[0];
    return first.indexOf('Quarantined by scaffold-broken-imports-quarantine') >= 0;
  } catch (_) { return false; }
}

function main() {
  var args = parseArgs(process.argv);
  var frontendDir = path.resolve(args.target);
  if (!fs.existsSync(path.join(frontendDir, 'app/pages'))) {
    console.log('scaffold-broken-imports-quarantine: no app/pages/ under ' + frontendDir + ' — skipping');
    return;
  }
  if (!fs.existsSync(path.join(frontendDir, 'tsconfig.json'))) {
    console.log('scaffold-broken-imports-quarantine: no tsconfig.json — skipping');
    return;
  }

  console.log('scaffold-broken-imports-quarantine: running tsc to detect unresolvable imports...');
  var tscOutput = runTsc(frontendDir);
  if (tscOutput === null) return;

  var errorsByFile = parseErrors(tscOutput);
  var pagesWithErrors = Object.keys(errorsByFile).filter(function (f) {
    // tsc reports relative paths from cwd; resolve them
    var abs = path.isAbsolute(f) ? f : path.resolve(frontendDir, f);
    if (!isPageFile(abs, frontendDir)) return false;
    if (isAlreadyQuarantined(abs)) return false;
    return errorsByFile[f].length >= args.threshold;
  });

  if (pagesWithErrors.length === 0) {
    var totalImportErrors = Object.keys(errorsByFile).reduce(function (s, k) { return s + errorsByFile[k].length; }, 0);
    console.log('scaffold-broken-imports-quarantine: ' + totalImportErrors + ' import error(s) detected, but no page exceeds threshold (' + args.threshold + ') — nothing to quarantine');
    return;
  }

  console.log('scaffold-broken-imports-quarantine: quarantining ' + pagesWithErrors.length + ' page(s) with >=' + args.threshold + ' unresolvable imports');

  var quarantined = 0;
  pagesWithErrors.forEach(function (relPath) {
    var abs = path.isAbsolute(relPath) ? relPath : path.resolve(frontendDir, relPath);
    var errors = errorsByFile[relPath];
    var compName = deriveComponentName(abs);
    var stub = renderStub(compName, path.relative(frontendDir, abs), errors);

    if (args.dryRun) {
      console.log('  [dry] would quarantine ' + path.relative(frontendDir, abs) + ' (' + errors.length + ' errors, exports ' + compName + ')');
    } else {
      fs.writeFileSync(abs, stub);
      quarantined++;
      if (args.verbose) {
        console.log('  quarantined ' + path.relative(frontendDir, abs) + ' (' + errors.length + ' errors, exports ' + compName + ')');
      }
    }
  });

  if (!args.dryRun) {
    console.log('scaffold-broken-imports-quarantine: ' + quarantined + ' page(s) quarantined');
  }
}

main();
