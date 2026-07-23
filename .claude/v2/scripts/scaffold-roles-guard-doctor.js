#!/usr/bin/env node
// scaffold-roles-guard-doctor.js — v104
//
// Add @UseGuards(JwtAuthGuard, RolesGuard) to any controller that uses
// @Roles() but doesn't already wire the guards. Without the guards, the
// @Roles() decorator is just metadata — NestJS won't enforce it, so role-
// gated endpoints are silently accessible to anyone.
//
// v103 evidence: backend-evaluator flagged this as P0 across
// ApplicationController, DocumentController, BankAccountController,
// CancellationAndRefundHybridPolicyController (25+ endpoints total).
// RBAC bypass is a security defect, not a typecheck error — tests pass
// but the live API is wide open.
//
// FIX: scan controllers, find those with @Roles but no @UseGuards(...Roles),
// inject @UseGuards(JwtAuthGuard, RolesGuard) at class level (or method
// level if @Roles is method-scoped).
//
// Idempotent — already-guarded controllers are skipped. Marker comment
// added to changed files for traceability.
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
    console.error('Usage: scaffold-roles-guard-doctor --target <BACKEND_DIR>');
    process.exit(1);
  }
  return out;
}

function findControllerFiles(modulesDir) {
  var out = [];
  if (!fs.existsSync(modulesDir)) return out;
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      var p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.controller\.ts$/.test(e.name)) out.push(p);
    });
  }
  walk(modulesDir);
  return out;
}

function processFile(filePath, opts) {
  var content = fs.readFileSync(filePath, 'utf-8');

  // Skip if no @Roles at all
  if (!/@Roles\s*\(/.test(content)) return { changed: false };

  // Skip if already has @UseGuards with RolesGuard
  if (/@UseGuards\s*\([^)]*RolesGuard[^)]*\)/.test(content)) {
    return { changed: false, reason: 'already-guarded' };
  }

  var changes = 0;
  var updated = content;

  // Ensure imports for the guards exist.
  // JwtAuthGuard typically lives at core/guards/jwt-auth.guard.
  // RolesGuard typically at core/guards/roles.guard.
  // Use relative paths discoverable from src/modules/<x>/<x>.controller.ts.
  var importsToAdd = [];
  if (!/import\s+\{[^}]*JwtAuthGuard[^}]*\}\s*from/.test(updated)) {
    importsToAdd.push("import { JwtAuthGuard } from '../../core/guards/jwt-auth.guard';");
  }
  if (!/import\s+\{[^}]*RolesGuard[^}]*\}\s*from/.test(updated)) {
    importsToAdd.push("import { RolesGuard } from '../../core/guards/roles.guard';");
  }
  if (!/import\s+\{[^}]*UseGuards[^}]*\}\s*from\s+['"]@nestjs\/common['"]/.test(updated)) {
    // Add UseGuards to existing @nestjs/common import if present, else add a line.
    var nestImportRe = /(import\s+\{)([^}]*)(\}\s*from\s+['"]@nestjs\/common['"])/;
    if (nestImportRe.test(updated)) {
      updated = updated.replace(nestImportRe, function (m, a, inner, c) {
        return a + inner + ', UseGuards' + c;
      });
    } else {
      importsToAdd.push("import { UseGuards } from '@nestjs/common';");
    }
  }

  if (importsToAdd.length > 0) {
    // Insert after last existing import line.
    var importMatches = Array.from(updated.matchAll(/^import .*?;?\s*$/gm));
    if (importMatches.length > 0) {
      var last = importMatches[importMatches.length - 1];
      var insertAt = last.index + last[0].length;
      updated = updated.slice(0, insertAt) + '\n' + importsToAdd.join('\n') + updated.slice(insertAt);
    } else {
      updated = importsToAdd.join('\n') + '\n' + updated;
    }
  }

  // Inject @UseGuards above the class declaration. Prefer class-level so
  // ALL methods inherit the guards. Locate `@Controller(...)` or
  // `export class XxxController` — insert before whichever appears.
  // Match: `@Controller('foo')\n[other decorators]\nexport class FooController`
  var classDeclRe = /(@Controller\s*\([^)]*\)\s*\n(?:[^]*?\n)?)?(\s*export\s+class\s+\w*Controller\b)/;
  var m = classDeclRe.exec(updated);
  if (m) {
    var ctrlBlock = m[1] || '';
    var classDecl = m[2];
    // Avoid double-injecting if we already added a marker
    if (!/scaffold-roles-guard-doctor/.test(updated.slice(Math.max(0, m.index - 200), m.index + 100))) {
      var guardLine = '@UseGuards(JwtAuthGuard, RolesGuard) // [scaffold-roles-guard-doctor] @Roles found without guards\n';
      updated = updated.slice(0, m.index + ctrlBlock.length) + guardLine + classDecl + updated.slice(m.index + m[0].length);
      changes++;
    }
  }

  if (changes === 0 && importsToAdd.length === 0) return { changed: false };

  if (!opts.dryRun) fs.writeFileSync(filePath, updated);
  return { changed: true, count: changes };
}

function main() {
  var args = parseArgs(process.argv);
  var modulesDir = path.join(args.target, 'src/modules');
  if (!fs.existsSync(modulesDir)) {
    console.log('scaffold-roles-guard-doctor: no src/modules — skipping');
    return;
  }
  var files = findControllerFiles(modulesDir);
  var fixed = 0, alreadyGuarded = 0, noRoles = 0;
  files.forEach(function (f) {
    var r = processFile(f, args);
    if (r.changed) {
      fixed++;
      if (args.verbose) console.log('  ' + path.relative(args.target, f) + ': guards added');
    } else if (r.reason === 'already-guarded') {
      alreadyGuarded++;
    } else {
      noRoles++;
    }
  });
  console.log('scaffold-roles-guard-doctor: ' + fixed + ' controller(s) guards added, ' +
    alreadyGuarded + ' already guarded, ' + noRoles + ' had no @Roles (skipped)');
}

main();
