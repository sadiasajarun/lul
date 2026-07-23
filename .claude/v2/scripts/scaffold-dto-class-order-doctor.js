#!/usr/bin/env node
// scaffold-dto-class-order-doctor.js — v114
//
// Fix the temporal-dead-zone (TDZ) crash that kills the whole backend test suite
// when an LLM emits nested DTO classes in reference-before-declaration order.
//
// BUG PATTERN (v107 evidence, backend verify-green):
//   // dashboard-query.dto.ts
//   export class DashboardGroupDto {
//     @ValidateNested() @Type(() => DashboardWindowDto)
//     window?: DashboardWindowDto;          // <-- references a class declared BELOW
//   }
//   export class DashboardWindowDto { ... }  // <-- declared later in the same file
//
// With `emitDecoratorMetadata: true`, TypeScript emits
//   Reflect.metadata("design:type", DashboardWindowDto)
// for the `window` property. That expression is evaluated when the decorators
// run — i.e. while DashboardGroupDto's class body initializes — but the class
// binding DashboardWindowDto is still in its temporal dead zone, throwing:
//   ReferenceError: Cannot access 'DashboardWindowDto' before initialization
//
// Importing the DTO file then throws at module load, so app.module.ts can't load
// and EVERY e2e suite that boots the app fails to run (v107: 6 of 8 suites dead,
// backend phase Failed at verify-green → whole-pipeline cascade).
//
// FIX: within each DTO file, topologically reorder the top-level `export class`
// declarations so a class is always declared AFTER every same-file class it
// references. Leading doc-comments / decorators stay attached to their class.
// Stable: classes with no ordering constraint keep their original relative order.
// Cycles (mutually-referencing DTOs) can't be fixed by reordering — those files
// are left untouched and logged (they need a forward-ref refactor, not a sort).
//
// This replaces the route_to_agent fix that v107 spent its single retry on
// (and still aborted) with a deterministic, every-run repair.
//
// Idempotent: a file already in valid order is rewritten identically (no-op).
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
    console.error('Usage: scaffold-dto-class-order-doctor --target <BACKEND_DIR> [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  fs.readdirSync(dir).forEach(function (name) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') return;
    var full = path.join(dir, name);
    var st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.dto\.ts$/.test(name)) acc.push(full);
  });
  return acc;
}

// Find the index of the matching close-brace for the open-brace at openIdx.
function matchBrace(src, openIdx) {
  var depth = 0;
  for (var i = openIdx; i < src.length; i++) {
    var c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Parse a DTO file into:
//   preamble: everything before the first top-level export class (imports etc.)
//   blocks:   [{ name, text }] — each class WITH its leading comment/decorator lines
//   trailer:  anything after the last class
// Returns null if the file shape is unsupported (e.g. nested/non-exported classes,
// or content between classes we can't safely attribute) so we skip rather than corrupt.
function parseClasses(src) {
  var re = /(^|\n)export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/g;
  var matches = [];
  var m;
  while ((m = re.exec(src)) !== null) {
    // position of the word "export" (skip the leading newline captured in group 1)
    var exportIdx = m.index + (m[1] ? m[1].length : 0);
    matches.push({ name: m[2], exportIdx: exportIdx });
  }
  if (matches.length < 2) return null; // single/zero class — nothing to reorder

  var blocks = [];
  for (var k = 0; k < matches.length; k++) {
    var startDecl = matches[k].exportIdx;
    var braceOpen = src.indexOf('{', startDecl);
    if (braceOpen === -1) return null;
    var braceClose = matchBrace(src, braceOpen);
    if (braceClose === -1) return null;
    blocks.push({
      name: matches[k].name,
      declStart: startDecl,
      bodyStart: braceOpen,
      end: braceClose + 1, // exclusive
    });
  }

  // Attach leading comment/decorator lines: extend each block's start backwards to
  // include contiguous comment / blank / @decorator lines that belong to it (i.e.
  // sit between the previous block's end and this declaration).
  var preambleEnd = blocks[0].declStart;
  // Walk back from the first decl over leading doc-comment/decorator lines so they
  // travel with the class; stop at a blank line that separates from imports.
  for (var b = 0; b < blocks.length; b++) {
    var prevEnd = b === 0 ? 0 : blocks[b - 1].end;
    var segStart = blocks[b].declStart;
    // Find the start of the attached leading trivia within (prevEnd, segStart).
    var between = src.slice(prevEnd, segStart);
    // The class keeps everything from the last "blank line boundary" that directly
    // precedes it. We attach trailing comment/decorator block: take from the first
    // non-blank line after prevEnd's trailing newlines.
    var leadOffset = 0;
    // Trim leading blank lines (they belong between blocks, keep as separator)
    var mm = /^\s*\n/.exec(between);
    // Find index where the attached comment/decorator trivia begins: we attach the
    // contiguous run of comment(/decorator) lines immediately above the class.
    var lines = between.split('\n');
    // Walk from the bottom up: collect contiguous comment/decorator/blank lines
    var attachFromLine = lines.length; // default: nothing attached
    for (var li = lines.length - 1; li >= 0; li--) {
      var t = lines[li].trim();
      if (t === '') { attachFromLine = li; continue; }
      if (t.indexOf('//') === 0 || t.indexOf('*') === 0 || t.indexOf('/*') === 0 ||
          t.indexOf('@') === 0 || t.indexOf('*/') === (t.length - 2)) {
        attachFromLine = li; continue;
      }
      break;
    }
    // Recompute char offset of attachFromLine within `between`
    var charOff = 0;
    for (var lj = 0; lj < attachFromLine; lj++) charOff += lines[lj].length + 1;
    blocks[b].attachStart = prevEnd + charOff;
    if (b === 0) preambleEnd = Math.min(preambleEnd, blocks[b].attachStart);
  }

  var preamble = src.slice(0, preambleEnd);
  var trailer = src.slice(blocks[blocks.length - 1].end);

  // Build block text including attached leading trivia.
  for (var p = 0; p < blocks.length; p++) {
    var textStart = blocks[p].attachStart != null ? blocks[p].attachStart : blocks[p].declStart;
    blocks[p].text = src.slice(textStart, blocks[p].end);
    // body text for reference scanning (just the class body)
    blocks[p].body = src.slice(blocks[p].bodyStart, blocks[p].end);
  }
  return { preamble: preamble, blocks: blocks, trailer: trailer };
}

// Topological sort: a class must come AFTER every same-file class it references.
// Returns { order: [names], cycle: bool }. Stable wrt original order.
function topoSort(blocks) {
  var names = blocks.map(function (b) { return b.name; });
  var nameSet = {};
  names.forEach(function (n) { nameSet[n] = true; });

  // deps[A] = set of same-file classes A references (must precede A)
  var deps = {};
  blocks.forEach(function (b) {
    deps[b.name] = {};
    names.forEach(function (other) {
      if (other === b.name) return;
      var wordRe = new RegExp('\\b' + other + '\\b');
      if (wordRe.test(b.body)) deps[b.name][other] = true;
    });
  });

  var result = [];
  var placed = {};
  var origIndex = {};
  names.forEach(function (n, i) { origIndex[n] = i; });

  // Kahn-style with stable selection: repeatedly place the earliest-original class
  // whose deps are all already placed.
  var guard = 0;
  while (result.length < names.length) {
    var progressed = false;
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      if (placed[n]) continue;
      var ready = Object.keys(deps[n]).every(function (d) { return placed[d]; });
      if (ready) { result.push(n); placed[n] = true; progressed = true; break; }
    }
    if (!progressed) return { order: null, cycle: true };
    if (++guard > names.length * names.length + 5) return { order: null, cycle: true };
  }
  return { order: result, cycle: false };
}

function processFile(filePath, opts) {
  var src = fs.readFileSync(filePath, 'utf-8');
  var parsed = parseClasses(src);
  if (!parsed) return { changed: false };

  var sorted = topoSort(parsed.blocks);
  if (sorted.cycle) {
    if (opts.verbose) console.log('  SKIP (reference cycle, needs forward-ref): ' + path.basename(filePath));
    return { changed: false, cycle: true };
  }

  var origOrder = parsed.blocks.map(function (b) { return b.name; }).join(',');
  var newOrder = sorted.order.join(',');
  if (origOrder === newOrder) return { changed: false }; // already valid

  var byName = {};
  parsed.blocks.forEach(function (b) { byName[b.name] = b; });
  // Join reordered class blocks with a blank line between them.
  var bodyParts = sorted.order.map(function (n) { return byName[n].text.replace(/^\n+/, ''); });
  var rebuilt = parsed.preamble.replace(/\s+$/, '') + '\n\n' + bodyParts.join('\n\n') + '\n' + parsed.trailer.replace(/^\n+/, '');
  // normalize trailing whitespace to a single newline
  rebuilt = rebuilt.replace(/\s+$/, '') + '\n';

  if (opts.dryRun) {
    console.log('  DRY-RUN would reorder ' + path.basename(filePath) + ': [' + origOrder + '] -> [' + newOrder + ']');
    return { changed: false };
  }
  fs.writeFileSync(filePath, rebuilt);
  console.log('  FIXED ' + path.relative(opts.target, filePath) + ': [' + origOrder + '] -> [' + newOrder + ']');
  return { changed: true };
}

function main() {
  var opts = parseArgs(process.argv);
  var srcDir = path.join(opts.target, 'src');
  var files = walk(srcDir, []);
  if (files.length === 0) {
    console.log('scaffold-dto-class-order-doctor: no *.dto.ts files under ' + srcDir);
    return;
  }
  var fixed = 0, cycles = 0;
  files.forEach(function (f) {
    var r = processFile(f, opts);
    if (r.changed) fixed++;
    if (r.cycle) cycles++;
  });
  console.log('scaffold-dto-class-order-doctor: ' + fixed + ' file(s) reordered' +
    (cycles ? ', ' + cycles + ' skipped (cycle)' : '') + ' across ' + files.length + ' DTO file(s)');
}

main();
