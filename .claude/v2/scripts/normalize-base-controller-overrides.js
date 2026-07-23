#!/usr/bin/env node
//
// normalize-base-controller-overrides.js — strip incorrect BaseController
// method overrides from LLM-written controllers.
//
// v64 evidence: LLM-implement overrode BaseController.findAll/findOne with
// `Promise<{ data: T }>` instead of `Promise<T[]>` / `Promise<T>` → TS2416
// "Property X in type Y is not assignable to the same property in base type"
// across multiple controllers.
//
// Strategy: if a *.controller.ts extends BaseController AND has its own
// findAll/findOne/create/update/remove methods, REMOVE those methods so the
// inherited BaseController versions are used. If the LLM added DOMAIN-
// specific methods (POST /:id/approve, etc.), preserve them.
//
// Idempotent. Conservative — only strips methods whose names match BaseController's.
//

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
  if (!out.target) { console.error('--target required'); process.exit(1); }
  return out;
}

var BASE_METHODS = ['findAll', 'findOne', 'create', 'update', 'remove'];

function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
    var full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && /\.controller\.ts$/.test(e.name)) out.push(full);
  }
  return out;
}

// Find and remove a method block by name. The method spans from the first
// decorator (@Get / @Post / etc.) preceding `<name>(...)` to the closing `}`
// of the method body. Returns the new content (with the method removed) and
// a count of removed methods.
function stripMethod(content, methodName) {
  // Locate the method signature. Signatures can span multiple lines:
  //   async <methodName>(
  //     @Query('page') page?: number,
  //   ): Promise<T[]> {
  // [\s\S]*? makes the body work across lines; non-greedy to grab first ).
  var sigRe = new RegExp(
    '(?:^|\\n)\\s*(?:async\\s+)?' + methodName + '\\s*\\(([\\s\\S]*?)\\)\\s*(?::\\s*[^{]+?)?\\s*\\{',
    'g'
  );
  var match = sigRe.exec(content);
  if (!match) return { content: content, removed: 0 };

  // sigRe starts with (?:^|\n) — if we matched on '\n', match.index points
  // to the newline. Bump forward to land on the line's actual first char.
  var sigStart = match.index;
  if (content[sigStart] === '\n') sigStart++;
  // Walk back to include preceding decorator block + comment block
  // (any line starting with @, /**, *, //)
  var lineStart = content.lastIndexOf('\n', sigStart - 1) + 1;
  var blockStart = lineStart;
  while (blockStart > 0) {
    var prevLineEnd = blockStart - 1;
    var prevLineStart = content.lastIndexOf('\n', prevLineEnd - 1) + 1;
    var prevLine = content.slice(prevLineStart, prevLineEnd).trimEnd();
    if (/^\s*$/.test(prevLine)) break;
    if (/^\s*(@|\/\*\*|\*|\/\/)/.test(prevLine)) {
      blockStart = prevLineStart;
      continue;
    }
    break;
  }

  // Walk forward from `{` after signature to matching `}` (brace count)
  var braceStart = content.indexOf('{', sigStart);
  if (braceStart === -1) return { content: content, removed: 0 };
  var depth = 0;
  var i = braceStart;
  for (; i < content.length; i++) {
    var ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  // Include trailing newlines
  while (i < content.length && (content[i] === '\n' || content[i] === ' ' || content[i] === '\t')) {
    if (content[i] === '\n') { i++; break; }
    i++;
  }

  var newContent = content.slice(0, blockStart) + content.slice(i);
  return { content: newContent, removed: 1 };
}

function fixOne(filePath, opts) {
  var orig = fs.readFileSync(filePath, 'utf-8');
  // Only process controllers that extend BaseController
  if (!/extends\s+BaseController\b/.test(orig)) return false;

  var content = orig;
  var totalRemoved = 0;
  for (var i = 0; i < BASE_METHODS.length; i++) {
    var r = stripMethod(content, BASE_METHODS[i]);
    content = r.content;
    totalRemoved += r.removed;
  }
  if (totalRemoved === 0) return false;

  if (opts.dryRun) {
    console.log('  [dry] would strip ' + totalRemoved + ' override(s) from ' + path.relative(opts.target, filePath));
    return true;
  }
  fs.writeFileSync(filePath, content);
  if (opts.verbose) console.log('  stripped ' + totalRemoved + ' override(s) from ' + path.relative(opts.target, filePath));
  return true;
}

function main() {
  var args = parseArgs(process.argv);
  var srcDir = path.join(args.target, 'src');
  var files = walk(srcDir);
  if (files.length === 0) {
    console.log('normalize-base-controller-overrides: no controllers found');
    return;
  }
  var fixed = 0;
  for (var i = 0; i < files.length; i++) {
    if (fixOne(files[i], args)) fixed++;
  }
  console.log('normalize-base-controller-overrides: scanned ' + files.length + ' controllers, fixed ' + fixed);
}

main();
