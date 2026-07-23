#!/usr/bin/env node
// scaffold-cascade-doctor.js — v88
//
// Fix wrong onDelete cascade rules on retention-required tables.
//
// THE BUG: LLM/scaffold-entities emits `onDelete: 'CASCADE'` for FKs even on
// tables that must preserve history (audit logs, payments, refunds). Per
// PROJECT_DATABASE.md retention rules:
//   - PaymentRequest: 5-year retention
//   - RefundRecord:   5-year retention
//   - AuditLog:       2-year retention (immutable)
//   - ApplicationStatusHistory: immutable history
//
// With CASCADE, deleting a user wipes their payment/audit history. Wrong.
//
// FIX (per entity-name match):
//   - PaymentRequest, RefundRecord:           CASCADE → RESTRICT
//   - AuditLog, ApplicationStatusHistory:     CASCADE → SET NULL (+ make FK nullable)
//
// Idempotent — re-runs don't change already-correct cascade rules. Marker
// comment `[scaffold-cascade-doctor]` added to changed lines.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--db') out.db = argv[++i];
    else if (a === '--no-heuristics') out.noHeuristics = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-cascade-doctor --target <BACKEND_DIR> [--db PROJECT_DATABASE.md] [--no-heuristics] [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

// v90: NO hardcoded retention rules. All rules come from PROJECT_DATABASE.md
// via parseRetentionSpec() below. If --db isn't passed (or the file lacks
// retention sections), this scaffold is a no-op — that's correct for any
// project that doesn't declare retention. Removing project-specific defaults
// (payment-request, audit-log, etc.) keeps the pipeline generic.
var DEFAULT_RETENTION_RULES = {};

// v89: parse PROJECT_DATABASE.md for retention-tagged tables and synthesize
// rules dynamically. Rules:
//   - "immutable" or "immutable audit log" → SET NULL on FKs to user-like parents
//   - "5-year retention" + financial words (payment, refund) → RESTRICT
//   - "5-year retention" + history/log words → SET NULL
//   - "2-year retention" + history/log → SET NULL
//   - Indefinite or short-lived → ignored (default CASCADE is fine)
function parseRetentionSpec(dbMd) {
  var rules = {};
  if (!dbMd) return rules;

  // Section: "Tables without soft delete (immutable / token-based)"
  // followed by lines like "- `audit_logs` — immutable (retention: 2 years, ...)"
  var immutableRe = /-\s*`([a-z_]+)`\s*[—-]\s*(immutable|short-lived)/gi;
  var m;
  while ((m = immutableRe.exec(dbMd)) !== null) {
    var tableName = m[1];
    var classifier = m[2].toLowerCase();
    if (classifier === 'short-lived') continue; // CASCADE OK for tokens
    var moduleName = snakePluralToKebabSingular(tableName);
    rules[moduleName] = 'SET NULL';
  }

  // Section: explicit retention table — "| `<table>` | 5 years | ..."
  // Distinguish financial (RESTRICT) vs history/log (SET NULL).
  var tableRowRe = /\|\s*`([a-z_]+)`\s*\|\s*([^|]+?)\s*\|/g;
  while ((m = tableRowRe.exec(dbMd)) !== null) {
    var tname = m[1];
    var retention = m[2].toLowerCase();
    if (!/\d+\s*year/.test(retention)) continue; // skip header rows + indefinite/short-lived
    var kebab = snakePluralToKebabSingular(tname);
    if (rules[kebab]) continue; // already set above
    // Financial keywords → RESTRICT, history/log → SET NULL
    if (/payment|refund|invoice|receipt|charge|transaction/.test(tname)) {
      rules[kebab] = 'RESTRICT';
    } else if (/log|history|audit|event|trail|record/.test(tname)) {
      rules[kebab] = 'SET NULL';
    } else {
      // Default: keep CASCADE (don't fight LLM unless we know better)
    }
  }
  return rules;
}

function snakePluralToKebabSingular(s) {
  // payment_requests → payment-request
  // audit_logs       → audit-log
  // application_status_history → application-status-history (no plural to drop)
  var kebab = s.replace(/_/g, '-');
  // Drop trailing 's' if it looks plural (heuristic). Some collective nouns
  // like 'history' aren't plural — only drop when the second-to-last char
  // is a regular consonant.
  if (/[a-z]s$/.test(kebab) && !/[s]s$/.test(kebab)) {
    kebab = kebab.replace(/s$/, '');
  }
  return kebab;
}

function findEntityFiles(modulesDir) {
  var out = [];
  if (!fs.existsSync(modulesDir)) return out;
  fs.readdirSync(modulesDir, { withFileTypes: true }).forEach(function (e) {
    if (!e.isDirectory()) return;
    var dir = path.join(modulesDir, e.name);
    fs.readdirSync(dir).forEach(function (f) {
      if (/\.entity\.ts$/.test(f)) out.push({ moduleName: e.name, filePath: path.join(dir, f) });
    });
    var entitiesDir = path.join(dir, 'entities');
    if (fs.existsSync(entitiesDir)) {
      fs.readdirSync(entitiesDir).forEach(function (f) {
        if (/\.entity\.ts$/.test(f)) out.push({ moduleName: e.name, filePath: path.join(entitiesDir, f) });
      });
    }
  });
  return out;
}

function fixCascadeInFile(filePath, desiredBehavior, options) {
  var content = fs.readFileSync(filePath, 'utf-8');
  var changes = 0;

  // For 'RESTRICT': just change CASCADE → RESTRICT
  // For 'SET NULL': change CASCADE → SET NULL, AND add nullable: true to the @ManyToOne, AND `?` to the property
  if (desiredBehavior === 'RESTRICT') {
    var updated = content.replace(/onDelete:\s*['"]CASCADE['"]/g, function () {
      changes++;
      return "onDelete: 'RESTRICT' /* [scaffold-cascade-doctor] retention */";
    });
    if (changes > 0 && !options.dryRun) fs.writeFileSync(filePath, updated);
    return { changes: changes };
  }

  if (desiredBehavior === 'SET NULL') {
    // SET NULL requires the FK column to be nullable. We do a simpler safe
    // transform: replace `onDelete: 'CASCADE'` with `onDelete: 'SET NULL', nullable: true`
    // and the next property line `actor?: User` etc — leave the property as-is
    // (the user may already have `?` or `!`).
    var updated2 = content.replace(
      /onDelete:\s*['"]CASCADE['"]([^)]*)/g,
      function (_m, rest) {
        changes++;
        // If `nullable: true` not already in the rest, inject it
        if (/nullable\s*:/.test(rest)) {
          return "onDelete: 'SET NULL'" + rest + " /* [scaffold-cascade-doctor] retention */";
        }
        return "onDelete: 'SET NULL', nullable: true" + rest + " /* [scaffold-cascade-doctor] retention */";
      }
    );
    if (changes > 0 && !options.dryRun) fs.writeFileSync(filePath, updated2);
    return { changes: changes };
  }

  return { changes: 0 };
}

// Generic per-name heuristics: any entity whose module name matches a
// financial/audit semantic class gets the corresponding default cascade rule.
// This is project-agnostic — based on word patterns that are universal
// across business domains, not hardcoded table names.
//
//   financial words (payment, refund, invoice, billing, charge, transaction,
//   receipt, ledger, account-balance) → RESTRICT (preserve financial history)
//
//   audit/history words (audit, history, log, event, trail, journal, record-of)
//   → SET NULL (preserve trail when actor is deleted)
//
// Disable with --no-heuristics if a project wants spec-only behavior.
function applyGenericHeuristics(moduleName) {
  var n = moduleName.toLowerCase();
  // Financial — strong financial semantic
  if (/^(payment|refund|invoice|billing|charge|transaction|receipt|ledger)/.test(n)) {
    return 'RESTRICT';
  }
  // Audit/history — preserve when parent deleted
  if (/^(audit|history|log|event|trail|journal)\b/.test(n) || /-history$|-log$|-trail$|-audit$/.test(n)) {
    return 'SET NULL';
  }
  return null;
}

function main() {
  var args = parseArgs(process.argv);
  var modulesDir = path.join(args.target, 'src/modules');
  if (!fs.existsSync(modulesDir)) {
    console.log('scaffold-cascade-doctor: no src/modules — skipping');
    return;
  }
  var entityFiles = findEntityFiles(modulesDir);

  // Build rule set: spec-derived + generic heuristics
  var rules = {};
  if (args.db && fs.existsSync(args.db)) {
    var dbMd = fs.readFileSync(args.db, 'utf-8');
    var specRules = parseRetentionSpec(dbMd);
    Object.keys(specRules).forEach(function (k) { rules[k] = specRules[k]; });
    if (args.verbose) {
      console.log('  spec-derived retention rules: ' + Object.keys(specRules).length);
    }
  }
  // Apply generic heuristics per entity module name (does NOT override spec)
  if (!args.noHeuristics) {
    entityFiles.forEach(function (e) {
      if (rules[e.moduleName]) return; // spec wins
      var heur = applyGenericHeuristics(e.moduleName);
      if (heur) rules[e.moduleName] = heur;
    });
    if (args.verbose) {
      var heuristicCount = Object.keys(rules).length - (args.db ? Object.keys(parseRetentionSpec(fs.readFileSync(args.db, 'utf-8'))).length : 0);
      if (heuristicCount > 0) console.log('  heuristic retention rules: ' + heuristicCount);
    }
  }

  var matched = 0;
  var totalChanges = 0;
  entityFiles.forEach(function (e) {
    var rule = rules[e.moduleName];
    if (!rule) return;
    matched++;
    var r = fixCascadeInFile(e.filePath, rule, args);
    totalChanges += r.changes;
    if (args.verbose) {
      console.log('  ' + e.moduleName + ' (' + rule + '): ' + r.changes + ' CASCADE → ' + rule);
    }
  });

  console.log('scaffold-cascade-doctor: ' + matched + ' retention table(s) matched, ' + totalChanges + ' CASCADE rules rewritten');
}

main();
