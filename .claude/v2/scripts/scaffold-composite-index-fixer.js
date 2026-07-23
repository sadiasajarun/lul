#!/usr/bin/env node
// scaffold-composite-index-fixer.js — v90
//
// Fix malformed TypeORM composite @Index declarations.
//
// THE BUG: LLM/scaffold emits composite indexes as a SINGLE bracketed string:
//   @Index('IDX_foo', ['(workerId, status)'])    // ❌ ONE column literally named '(workerId, status)'
//   @Index('IDX_bar', ['(user_id, read_at)'])    // ❌ same — TypeORM mis-creates
// Should be an array of separate column names:
//   @Index('IDX_foo', ['workerId', 'status'])    // ✅ composite over two columns
//   @Index('IDX_bar', ['user_id', 'read_at'])    // ✅
//
// Result: dashboard queries that depend on composite-column lookups end up
// doing full table scans. Cosmetic-looking but real performance hit when
// data grows.
//
// FIX: detect array-with-single-string-containing-comma-or-paren entries,
// strip outer parens, split on comma, emit as array of separate strings.
//
// Idempotent — already-correct multi-element arrays are unchanged.
// Marker comment added to changed lines.
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
    console.error('Usage: scaffold-composite-index-fixer --target <BACKEND_DIR>');
    process.exit(1);
  }
  return out;
}

function findEntityFiles(modulesDir) {
  var out = [];
  if (!fs.existsSync(modulesDir)) return out;
  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      var p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.entity\.ts$/.test(e.name)) out.push(p);
    });
  }
  walk(modulesDir);
  return out;
}

// Detect `[ '(...)' ]` or `[ 'a, b' ]` patterns — single-element arrays
// where the one string contains a comma. Split it into individual columns.
function fixCompositeArray(arrayStr) {
  // arrayStr is the content INSIDE the outer brackets, e.g. " '(workerId, status)' "
  var trimmed = arrayStr.trim();
  // Single-string pattern: only ONE quoted string inside the brackets
  var singleQuoteRe = /^(['"])([^'"]*)\1$/;
  var m = singleQuoteRe.exec(trimmed);
  if (!m) return null;
  var inner = m[2];
  // Strip optional surrounding parens
  inner = inner.replace(/^\(/, '').replace(/\)$/, '');
  if (!inner.includes(',')) return null; // not composite
  var cols = inner.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (cols.length < 2) return null;
  var quote = m[1];
  return cols.map(function (c) { return quote + c + quote; }).join(', ');
}

// Strip ' ASC' or ' DESC' suffix from column names inside an @Index array.
// v102 evidence: LLM emits `@Index('IDX', ['userId', 'createdAt DESC'])`
// thinking the trailing 'DESC' is a sort hint. TypeORM treats the whole
// string as a literal column name → at DataSource.initialize it throws
// "Index contains column that is missing in the entity: createdAt DESC",
// crashing every test suite that uses the DB (13 of 20 in v101). The
// correct sort-direction syntax is via the third arg or a where-options
// object; dropping the suffix gives the right column reference and
// TypeORM's default index direction (which is fine for most lookups).
function stripSortDirections(arrayBody) {
  var hits = 0;
  var fixed = arrayBody.replace(
    /(['"])([A-Za-z_][A-Za-z0-9_]*)\s+(ASC|DESC)\1/gi,
    function (whole, q, col) { hits++; return q + col + q; }
  );
  return hits > 0 ? { fixed: fixed, count: hits } : null;
}

function processFile(filePath, options) {
  var content = fs.readFileSync(filePath, 'utf-8');
  var changes = 0;
  // Match @Index(['name',] [singleEntry])  — the entry list is inside `[]`.
  // We target @Index declarations specifically (class-level + property-level).
  var updated = content.replace(
    /@Index\s*\(([^[]*?)\[\s*([^\]]+)\s*\]\s*\)/g,
    function (whole, leadingArg, arrayBody) {
      // Pass 1: split single-string composites like ['(a, b)'] → ['a', 'b']
      var split = fixCompositeArray(arrayBody);
      var bodyAfterSplit = split || arrayBody;
      // Pass 2: strip ' ASC'/' DESC' suffixes from any column entry
      var stripped = stripSortDirections(bodyAfterSplit);
      if (!split && !stripped) return whole; // nothing to fix
      changes++;
      var finalBody = stripped ? stripped.fixed : bodyAfterSplit;
      var note = split
        ? "split " + arrayBody.trim() + (stripped ? " + stripped " + stripped.count + " ASC/DESC suffix(es)" : "")
        : "stripped " + stripped.count + " ASC/DESC suffix(es) from " + arrayBody.trim();
      return '@Index(' + leadingArg + '[' + finalBody + ']) /* [scaffold-composite-index-fixer] ' + note + ' */';
    }
  );
  if (changes === 0) return { changed: false };
  if (!options.dryRun) fs.writeFileSync(filePath, updated);
  return { changed: true, count: changes };
}

function main() {
  var args = parseArgs(process.argv);
  var modulesDir = path.join(args.target, 'src/modules');
  if (!fs.existsSync(modulesDir)) {
    console.log('scaffold-composite-index-fixer: no src/modules — skipping');
    return;
  }
  var files = findEntityFiles(modulesDir);
  var filesFixed = 0, totalChanges = 0;
  files.forEach(function (f) {
    var r = processFile(f, args);
    if (r.changed) {
      filesFixed++;
      totalChanges += r.count;
      if (args.verbose) {
        console.log('  ' + path.relative(args.target, f) + ': ' + r.count + ' composite index(es) split');
      }
    }
  });
  console.log('scaffold-composite-index-fixer: ' + filesFixed + ' file(s) fixed, ' + totalChanges + ' composite index(es) split');
}

main();
