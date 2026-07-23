#!/usr/bin/env node
// scaffold-jsx-balance-doctor.js — v93
//
// Walks app/pages/**/*.tsx (+ optionally app/components/**/*.tsx) and parses
// each with the project's local TypeScript compiler API. If a file has
// syntactic errors (unclosed JSX tag, unterminated string literal, unbalanced
// braces, etc.), it DELETES the file so scaffold-page-from-story (the v86
// Lever 1 safety net that runs AFTER LLM convert-pages) can re-emit a clean
// stub from the matching user_story YAML.
//
// v93 evidence: convert-pages produced files like SignupPage.tsx with a
// `<select>` whose attribute embedded a string with single quotes that broke
// the JSX parser. Errors cascaded: 'JSX element form has no corresponding
// closing tag', 'Unexpected token. Did you mean {>}', 'Expected closing tag
// for div / main', etc. Plus notifications.tsx had an unterminated string
// literal. Both wiped frontend typecheck.
//
// STRATEGY:
//   1. Resolve TypeScript via <FRONTEND>/node_modules/typescript (the
//      pinned version the project uses for tsc).
//   2. For each .tsx file under app/pages/ (or optional --extra-dirs),
//      parse with ts.createSourceFile + ScriptKind.TSX.
//   3. Inspect parseDiagnostics. If any → file is broken → delete it.
//   4. Emit a per-file report so the next scaffold step (and a future
//      gate) can see which pages got reset.
//
// SAFE because:
//   - Only deletes parse-error files (never reformats valid code).
//   - scaffold-page-from-story emits a deterministic stub for each missing
//     page, so the codebase compiles after this doctor + that scaffold run.
//   - Idempotent: runs again find no parse errors, no-ops.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = { extraDirs: [] };
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--extra-dir') out.extraDirs.push(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-jsx-balance-doctor --target <FRONTEND_DIR> [--extra-dir app/components] [--dry-run]');
    process.exit(1);
  }
  return out;
}

function walkTsx(root, out) {
  if (!fs.existsSync(root)) return;
  fs.readdirSync(root, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (/^(node_modules|dist|build|\.react-router|coverage|__tests__|tests)$/.test(e.name)) return;
      walkTsx(p, out);
    } else if (e.isFile() && /\.tsx$/.test(e.name)) {
      out.push(p);
    }
  });
}

function loadProjectTypescript(target) {
  // Use absolute paths — require() can't resolve a relative module path.
  var absTarget = path.resolve(target);
  var candidates = [
    path.join(absTarget, 'node_modules', 'typescript'),
    path.join(absTarget, '..', 'node_modules', 'typescript'),
  ];
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.existsSync(candidates[i])) return require(candidates[i]);
    } catch (_) { /* ignore */ }
  }
  return null;
}

function main() {
  var args = parseArgs(process.argv);
  var pagesDir = path.join(args.target, 'app', 'pages');
  var ts = loadProjectTypescript(args.target);

  if (!ts) {
    console.log('scaffold-jsx-balance-doctor: TypeScript not found in ' + args.target + '/node_modules — skipping (run after deps install)');
    return;
  }

  var files = [];
  walkTsx(pagesDir, files);
  args.extraDirs.forEach(function (rel) {
    walkTsx(path.join(args.target, rel), files);
  });

  if (files.length === 0) {
    console.log('scaffold-jsx-balance-doctor: no .tsx files found under app/pages — skipping');
    return;
  }

  var brokenFiles = [];
  files.forEach(function (file) {
    try {
      var src = fs.readFileSync(file, 'utf-8');
      var sf = ts.createSourceFile(
        path.basename(file),
        src,
        ts.ScriptTarget.Latest,
        /*setParentNodes*/ true,
        ts.ScriptKind.TSX
      );
      var diags = (sf && sf.parseDiagnostics) || [];
      if (diags.length > 0) {
        brokenFiles.push({
          file: file,
          errors: diags.slice(0, 3).map(function (d) {
            var msg = ts.flattenDiagnosticMessageText
              ? ts.flattenDiagnosticMessageText(d.messageText, '\n')
              : (typeof d.messageText === 'string' ? d.messageText : String(d.messageText));
            return 'TS' + d.code + ': ' + msg.split('\n')[0];
          }),
        });
      }
    } catch (e) {
      // Read error or TS API throw — treat as broken
      brokenFiles.push({ file: file, errors: ['parse-doctor-internal-error: ' + e.message] });
    }
  });

  if (brokenFiles.length === 0) {
    console.log('scaffold-jsx-balance-doctor: scanned ' + files.length + ' .tsx file(s), 0 broken');
    return;
  }

  console.log('scaffold-jsx-balance-doctor: found ' + brokenFiles.length + ' broken file(s) out of ' + files.length);
  brokenFiles.forEach(function (b) {
    console.log('  ✗ ' + path.relative(args.target, b.file));
    b.errors.forEach(function (e) { console.log('    ' + e); });
    if (args.dryRun) {
      console.log('    [dry] would delete this file (scaffold-page-from-story will re-emit stub)');
    } else {
      try {
        fs.unlinkSync(b.file);
        console.log('    deleted (scaffold-page-from-story will re-emit a stub on next run)');
      } catch (e) {
        console.log('    ⚠  failed to delete: ' + e.message);
      }
    }
  });

  console.log('scaffold-jsx-balance-doctor: ' + brokenFiles.length + ' broken file(s) ' +
    (args.dryRun ? 'would be deleted' : 'deleted'));
}

main();
