#!/usr/bin/env node
// scaffold-querybuilder-camelcase-doctor.js
// v108: TypeORM QueryBuilder requires camelCase entity property names, NOT
// snake_case DB column names.  e.g. qb.orderBy('app.created_at') throws
//   TypeError: Cannot read properties of undefined (reading 'databaseName')
// because TypeORM looks up the property name in entity metadata, not the
// column name.  This doctor rewrites every snake_case arg inside QueryBuilder
// method calls to the camelCase equivalent.
//
// Scope: src/modules/**/*.{repository,service}.ts files that contain
// createQueryBuilder (i.e., only files that actually use the QB API).
//
// Usage:
//   node scaffold-querybuilder-camelcase-doctor.js --target <BACKEND_DIR> [--dry-run] [--verbose]

'use strict';

var fs   = require('fs');
var path = require('path');

var glob;
try { glob = require('glob'); } catch (_) { glob = null; }

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
var args      = process.argv.slice(2);
var targetDir = null;
var dryRun    = false;
var verbose   = false;

for (var i = 0; i < args.length; i++) {
  if (args[i] === '--target')   { targetDir = args[++i]; }
  if (args[i] === '--dry-run')  { dryRun = true; }
  if (args[i] === '--verbose')  { verbose = true; }
}

if (!targetDir) {
  console.error('Usage: scaffold-querybuilder-camelcase-doctor.js --target <BACKEND_DIR> [--dry-run] [--verbose]');
  process.exit(1);
}

if (!fs.existsSync(targetDir)) {
  console.error('target dir not found:', targetDir);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function snakeToCamel(s) {
  return s.replace(/_([a-z0-9])/g, function (_, c) { return c.toUpperCase(); });
}

// QueryBuilder methods whose first string argument is a TypeORM property
// expression (alias.propertyName or alias.propertyName :param, etc.)
var QB_METHODS = [
  'andWhere', 'orWhere', 'where',
  'andHaving', 'orHaving', 'having',
  'orderBy', 'addOrderBy',
  'groupBy', 'addGroupBy',
  'select', 'addSelect',
  'leftJoin', 'leftJoinAndSelect', 'leftJoinAndMapMany', 'leftJoinAndMapOne',
  'innerJoin', 'innerJoinAndSelect', 'innerJoinAndMapMany', 'innerJoinAndMapOne',
];

// Matches: .methodName( "..." or '...'
var QB_CALL_RE = new RegExp(
  '\\.(' + QB_METHODS.join('|') + ')\\(\\s*([\'"])([^\'"]*?)\\2',
  'g'
);

// Inside the string argument, rewrite alias.snake_case_prop → alias.camelCase
var PROP_RE = /\b([A-Za-z][A-Za-z0-9]*)\.([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;

function rewriteStringArg(str) {
  return str.replace(PROP_RE, function (match, alias, snake) {
    var camel = snakeToCamel(snake);
    if (camel === snake) return match; // nothing to change
    return alias + '.' + camel;
  });
}

function rewriteContent(src) {
  var changed = false;
  var result = src.replace(QB_CALL_RE, function (fullMatch, method, quote, inner) {
    var rewritten = rewriteStringArg(inner);
    if (rewritten === inner) return fullMatch;
    changed = true;
    return '.' + method + '(' + quote + rewritten + quote;
  });
  return { content: result, changed: changed };
}

// ---------------------------------------------------------------------------
// Walk files
// ---------------------------------------------------------------------------
var pattern = path.join(targetDir, 'src', 'modules', '**', '*.{repository,service}.ts').replace(/\\/g, '/');
// glob pattern for repository + service files
var repoPattern  = path.join(targetDir, 'src', 'modules', '**', '*.repository.ts').replace(/\\/g, '/');
var svcPattern   = path.join(targetDir, 'src', 'modules', '**', '*.service.ts').replace(/\\/g, '/');

function walkSync(dir, results) {
  if (!fs.existsSync(dir)) return;
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach(function (ent) {
    var full = path.join(dir, ent.name);
    if (ent.isDirectory()) { walkSync(full, results); }
    else if (/\.(repository|service)\.ts$/.test(ent.name)) { results.push(full); }
  });
}

var files = [];
if (glob) {
  files = files.concat(glob.sync(repoPattern));
  files = files.concat(glob.sync(svcPattern));
} else {
  walkSync(path.join(targetDir, 'src', 'modules'), files);
}

var totalFiles   = 0;
var changedFiles = 0;
var totalFixes   = 0;

files.forEach(function (filePath) {
  var src = fs.readFileSync(filePath, 'utf-8');

  // Skip files that don't use QueryBuilder at all (fast exit)
  if (!src.includes('createQueryBuilder')) return;

  totalFiles++;
  var r = rewriteContent(src);

  if (!r.changed) {
    if (verbose) console.log('  unchanged:', path.relative(targetDir, filePath));
    return;
  }

  // Count rewrites for reporting
  var fixes = 0;
  src.replace(QB_CALL_RE, function (fullMatch, method, quote, inner) {
    var rewritten = rewriteStringArg(inner);
    if (rewritten !== inner) fixes++;
    return fullMatch;
  });
  totalFixes += fixes;
  changedFiles++;

  if (verbose || dryRun) {
    console.log('  ' + (dryRun ? '[dry-run] would fix' : 'fixed') + ' (' + fixes + ' refs): ' + path.relative(targetDir, filePath));
  }

  if (!dryRun) {
    fs.writeFileSync(filePath, r.content, 'utf-8');
  }
});

console.log(
  '[scaffold-querybuilder-camelcase-doctor] ' +
  (dryRun ? 'DRY-RUN ' : '') +
  'scanned=' + totalFiles +
  ' changed=' + changedFiles +
  ' refs_rewritten=' + totalFixes
);
