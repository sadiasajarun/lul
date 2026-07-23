#!/usr/bin/env node
// scaffold-ts-balance-doctor.js — v96
//
// Walks backend src/**/*.ts and parses each with the project's local
// TypeScript compiler API. If a file has SYNTACTIC errors (unbalanced
// braces, missing colon/comma/semicolon, unterminated string, etc.),
// it DELETES the file so the next backend-phase scaffold pass (scaffold-
// crud-module, scaffold-feature-module-stub, scaffold-controller-route-
// doctor, etc.) can re-emit a clean version from the entity spec.
//
// This is the BACKEND mirror of scaffold-jsx-balance-doctor (which
// handles frontend .tsx parse errors). Same TypeScript-compiler-API
// approach, same delete-then-rescaffold strategy.
//
// v95 evidence: backend phase ended with 34 pass | 1 fail because
// system-setting.controller.ts had parse errors (TS1005 ':' expected,
// TS1146 Declaration expected, TS1109 Expression expected) that
// route_to_agent's fix-agent couldn't repair (regressed and bailed per
// Rule #10). The broken file then cascaded: backend typecheck failed
// → backend-phase ended ⚠️ → test-api pre-check (tsc) failed in 0.9s →
// backend never started for test-browser → ALL 7 global-setup-verify
// logins returned HTTP 0 → 0/28 stories.
//
// Per the earlier-phase-first rule: fixing this BACKEND issue keeps the
// upstream phase stable, which is necessary for any downstream phase to
// produce real (non-mirage) results.
//
// SAFE because:
//   - Only deletes parse-error files (never reformats valid code)
//   - Backend phase has multiple scaffolds (scaffold-crud-module,
//     scaffold-feature-module-stub, scaffold-controller-route-doctor)
//     that re-emit canonical versions for any deleted controller/service
//   - Idempotent: runs again, no parse errors, no-ops
//   - Skips entity files (.entity.ts) since corrupting one would lose
//     schema info; entities are scaffold-emitted early and deletion is
//     unsafe without re-running scaffold-entities
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = { extraDirs: [], skipEntities: true };
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--extra-dir') out.extraDirs.push(argv[++i]);
    else if (a === '--include-entities') out.skipEntities = false;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-ts-balance-doctor --target <BACKEND_DIR> [--include-entities] [--dry-run]');
    process.exit(1);
  }
  return out;
}

function walkTs(root, out, opts) {
  if (!fs.existsSync(root)) return;
  fs.readdirSync(root, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (/^(node_modules|dist|build|coverage|__tests__|tests|migrations)$/.test(e.name)) return;
      walkTs(p, out, opts);
    } else if (e.isFile() && /\.ts$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) {
      // Skip entity files by default — corrupting one loses schema info.
      if (opts.skipEntities && /\.entity\.ts$/.test(e.name)) return;
      out.push(p);
    }
  });
}

function loadProjectTypescript(target) {
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
  var srcDir = path.join(args.target, 'src');
  var ts = loadProjectTypescript(args.target);

  if (!ts) {
    console.log('scaffold-ts-balance-doctor: TypeScript not found in ' + args.target + '/node_modules — skipping (run after deps install)');
    return;
  }

  var files = [];
  walkTs(srcDir, files, args);
  args.extraDirs.forEach(function (rel) {
    walkTs(path.join(args.target, rel), files, args);
  });

  if (files.length === 0) {
    console.log('scaffold-ts-balance-doctor: no .ts files found under src/ — skipping');
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
        ts.ScriptKind.TS
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
      brokenFiles.push({ file: file, errors: ['parse-doctor-internal-error: ' + e.message] });
    }
  });

  if (brokenFiles.length === 0) {
    console.log('scaffold-ts-balance-doctor: scanned ' + files.length + ' .ts file(s), 0 broken');
    return;
  }

  console.log('scaffold-ts-balance-doctor: found ' + brokenFiles.length + ' broken file(s) out of ' + files.length);
  var deleted = 0, stubbed = 0;
  brokenFiles.forEach(function (b) {
    console.log('  ✗ ' + path.relative(args.target, b.file));
    b.errors.forEach(function (e) { console.log('    ' + e); });
    if (args.dryRun) {
      var action = shouldStub(b.file) ? 'stub' : 'delete';
      console.log('    [dry] would ' + action + ' this file');
      return;
    }
    // v98: for files whose absence would break downstream imports (controllers,
    // services, repositories), emit a MINIMAL STUB instead of deleting. Modules
    // import them by name; deleting them strands the imports → TS2307 cascade
    // → backend phase fails → test-api fails → test-browser crashes (v97
    // evidence: 28 stories crashed in admin-dashboard cell because ts-doctor
    // deleted 3 controllers + 1 DTO that downstream depended on).
    // For files that are pure leaf (entity already skipped via --skip-entities,
    // .spec.ts skipped, modules emit themselves), delete is safe.
    try {
      if (shouldStub(b.file)) {
        var stub = emitStub(b.file);
        fs.writeFileSync(b.file, stub);
        console.log('    stubbed (minimal valid TS so downstream imports resolve)');
        stubbed++;
      } else {
        fs.unlinkSync(b.file);
        console.log('    deleted');
        deleted++;
      }
    } catch (e) {
      console.log('    ⚠  failed to ' + (shouldStub(b.file) ? 'stub' : 'delete') + ': ' + e.message);
    }
  });

  console.log('scaffold-ts-balance-doctor: ' + brokenFiles.length + ' broken file(s) processed' +
    (args.dryRun ? ' (dry-run)' : ' → ' + stubbed + ' stubbed, ' + deleted + ' deleted'));
}

// Files whose absence breaks downstream get stubs, not deletion.
function shouldStub(file) {
  return /\.controller\.ts$|\.service\.ts$|\.repository\.ts$|\.module\.ts$|\.dto\.ts$/.test(file);
}

// Minimal valid stub for each file class — gives downstream code something
// to import without erroring. Endpoints/methods won't work at runtime, but
// backend compiles → frontend can build → stories can run (even if they
// fail on the stubbed routes).
function emitStub(file) {
  var basename = path.basename(file);
  // ClassName from kebab: 'foo-bar.controller.ts' → 'FooBarController'
  var entityFromName = function (filename, suffix) {
    return filename.replace(new RegExp('\\.' + suffix + '\\.ts$'), '')
      .split(/[-_]/).map(function (w) { return w ? w[0].toUpperCase() + w.slice(1) : w; }).join('');
  };
  if (/\.controller\.ts$/.test(basename)) {
    var E = entityFromName(basename, 'controller');
    return [
      '// Auto-stubbed by scaffold-ts-balance-doctor — original had parse errors.',
      "import { Controller } from '@nestjs/common';",
      '',
      "@Controller('" + E.toLowerCase() + "')",
      'export class ' + E + 'Controller {}',
      '',
    ].join('\n');
  }
  if (/\.service\.ts$/.test(basename)) {
    var E2 = entityFromName(basename, 'service');
    return [
      '// Auto-stubbed by scaffold-ts-balance-doctor — original had parse errors.',
      "import { Injectable } from '@nestjs/common';",
      '',
      '@Injectable()',
      'export class ' + E2 + 'Service {}',
      '',
    ].join('\n');
  }
  if (/\.repository\.ts$/.test(basename)) {
    var E3 = entityFromName(basename, 'repository');
    return [
      '// Auto-stubbed by scaffold-ts-balance-doctor — original had parse errors.',
      "import { Injectable } from '@nestjs/common';",
      '',
      '@Injectable()',
      'export class ' + E3 + 'Repository {}',
      '',
    ].join('\n');
  }
  if (/\.module\.ts$/.test(basename)) {
    var E4 = entityFromName(basename, 'module');
    return [
      '// Auto-stubbed by scaffold-ts-balance-doctor — original had parse errors.',
      "import { Module } from '@nestjs/common';",
      '',
      '@Module({})',
      'export class ' + E4 + 'Module {}',
      '',
    ].join('\n');
  }
  if (/\.dto\.ts$/.test(basename)) {
    // DTO file basename like 'create-foo.dto.ts' or 'foo-response.dto.ts'
    var dtoName = basename.replace(/\.dto\.ts$/, '');
    var className = dtoName.split(/[-_]/).map(function (w) {
      return w ? w[0].toUpperCase() + w.slice(1) : w;
    }).join('') + 'Dto';
    return [
      '// Auto-stubbed by scaffold-ts-balance-doctor — original had parse errors.',
      'export class ' + className + ' {}',
      '',
    ].join('\n');
  }
  return '// Auto-stubbed by scaffold-ts-balance-doctor — original had parse errors.\nexport {};\n';
}

main();
