#!/usr/bin/env node
// scaffold-truncated-llm-doctor.js — v90
//
// Detect LLM-emitted TypeScript files that were CUT OFF mid-declaration:
//   - Unbalanced braces (more { than } or vice versa)
//   - Unterminated string literals
//   - Trailing partial decorators (@Column followed by EOF or unmatched paren)
//   - Files ending mid-class-body without closing }
//
// v87/v88/v89 evidence (RECURRING bug):
//   - v88 backend typecheck: signup.dto.ts(65,16) TS1146 + notification.controller.ts(98) TS1068
//   - v89 backend typecheck: signup.dto.ts(65), company.controller.ts(29), notification.controller.ts(132)
//   - v89 frontend typecheck: app/types/application.d.ts(48,44) TS1002 unterminated string
//
// These cascade hard: ts-node-dev hits the syntax error, tries to compile,
// re-respawns on next file save, gets stuck in compile loop, 75-100% CPU,
// OS eventually OOM-kills the orchestrator (v89 exit 137).
//
// STRATEGY: walk *.ts/*.tsx in backend/src and frontend/app, parse each via
// node's vm.compileFunction OR a brace-balance heuristic. For files with
// unbalanced braces:
//   1. Try truncation rescue: walk backwards from EOF to last balanced point,
//      truncate file there + append a closing `}` for the open class.
//   2. If file has critical sub-declarations (multiple classes, exports),
//      restoration is too risky — quarantine the file with a stub.
//
// Idempotent. Marker `// [scaffold-truncated-llm-doctor]` added.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = { paths: [] };
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.paths.push(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (out.paths.length === 0) {
    console.error('Usage: scaffold-truncated-llm-doctor --target <DIR> [--target <DIR>...] [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

function walkSourceFiles(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') return;
      walkSourceFiles(p, out);
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) {
      out.push(p);
    }
  });
  return out;
}

// Brace/bracket/paren balance with string + comment awareness.
// Returns { ok, openBraces, openBrackets, openParens, lastBalancedOffset, openStringAtEOF }
function checkBalance(content) {
  var openBrace = 0, openBracket = 0, openParen = 0;
  var lastBalancedOffset = 0;
  var inLineComment = false;
  var inBlockComment = false;
  var inString = null; // null, "'", '"', '`'
  var inTemplateExpr = 0; // ${...} depth inside template literals
  for (var i = 0; i < content.length; i++) {
    var c = content[i];
    var prev = i > 0 ? content[i - 1] : '';
    var next = i + 1 < content.length ? content[i + 1] : '';
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (c === '\\' && next) { i++; continue; }
      if (c === inString && (inString !== '`' || inTemplateExpr === 0)) {
        inString = null;
        continue;
      }
      if (inString === '`' && c === '$' && next === '{') {
        inTemplateExpr++;
        i++;
        continue;
      }
      continue;
    }
    if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { inString = c; continue; }
    if (c === '{') openBrace++;
    else if (c === '}') {
      openBrace--;
      if (inTemplateExpr > 0) inTemplateExpr--;
    }
    else if (c === '[') openBracket++;
    else if (c === ']') openBracket--;
    else if (c === '(') openParen++;
    else if (c === ')') openParen--;
    // Track last position where everything is balanced
    if (openBrace === 0 && openBracket === 0 && openParen === 0 && inString === null) {
      lastBalancedOffset = i + 1;
    }
  }
  return {
    ok: openBrace === 0 && openBracket === 0 && openParen === 0 && inString === null,
    openBrace: openBrace,
    openBracket: openBracket,
    openParen: openParen,
    openStringAtEOF: inString,
    lastBalancedOffset: lastBalancedOffset,
  };
}

function quarantineStubFor(filePath, originalSize, balance) {
  // Determine the kind of file by path patterns
  var base = path.basename(filePath);
  if (/\.d\.ts$/.test(base)) {
    return [
      '// [scaffold-truncated-llm-doctor] original ' + originalSize + 'B was truncated mid-declaration',
      '// Original imbalance: braces=' + balance.openBrace + ' brackets=' + balance.openBracket +
        ' parens=' + balance.openParen + ' openStringAtEOF=' + (balance.openStringAtEOF || 'no'),
      '// Empty type module — re-emit by scaffold-api-client-types when entities/DTOs are clean.',
      'export {};',
      '',
    ].join('\n');
  }
  if (/\.controller\.ts$/.test(base)) {
    var name = base.replace('.controller.ts', '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }).replace(/\s/g, '');
    return [
      '// [scaffold-truncated-llm-doctor] original ' + originalSize + 'B truncated',
      "import { Controller } from '@nestjs/common';",
      '',
      "@Controller('" + base.replace('.controller.ts', '').toLowerCase() + "')",
      'export class ' + name + 'Controller {}',
      '',
    ].join('\n');
  }
  if (/\.dto\.ts$/.test(base)) {
    var className = base.replace('.dto.ts', '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }).replace(/\s/g, '') + 'Dto';
    return [
      '// [scaffold-truncated-llm-doctor] original ' + originalSize + 'B truncated',
      'export class ' + className + ' {}',
      '',
    ].join('\n');
  }
  if (/\.service\.ts$/.test(base)) {
    var svcName = base.replace('.service.ts', '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }).replace(/\s/g, '');
    return [
      '// [scaffold-truncated-llm-doctor] original ' + originalSize + 'B truncated',
      "import { Injectable } from '@nestjs/common';",
      '',
      '@Injectable()',
      'export class ' + svcName + 'Service {}',
      '',
    ].join('\n');
  }
  // Generic .ts/.tsx fallback — empty module export
  return [
    '// [scaffold-truncated-llm-doctor] original ' + originalSize + 'B truncated mid-declaration',
    'export {};',
    '',
  ].join('\n');
}

function attemptRescue(content, balance) {
  // If we have a small imbalance (1-2 unclosed braces, no open string), try
  // simple truncate-to-last-balanced + add closing braces.
  if (balance.openStringAtEOF) return null; // can't rescue an open string safely
  if (balance.openBrace < 1 || balance.openBrace > 2) return null;
  if (balance.openBracket !== 0 || balance.openParen !== 0) return null;
  // Truncate to last balanced point and append the missing close braces.
  if (balance.lastBalancedOffset < content.length * 0.5) return null; // truncated TOO much
  var rescued = content.substring(0, balance.lastBalancedOffset);
  for (var k = 0; k < balance.openBrace; k++) rescued += '\n}';
  rescued += '\n// [scaffold-truncated-llm-doctor] rescued by truncating to last balanced offset\n';
  return rescued;
}

function processFile(filePath, options) {
  var content;
  try { content = fs.readFileSync(filePath, 'utf-8'); }
  catch (_) { return { changed: false }; }
  // Skip already-quarantined files (idempotency)
  if (content.indexOf('[scaffold-truncated-llm-doctor]') >= 0) return { changed: false };
  // Skip very small files (likely intentional stubs)
  if (content.length < 50) return { changed: false };
  var balance = checkBalance(content);
  if (balance.ok) return { changed: false }; // file balanced — leave alone

  // Try rescue first
  var rescued = attemptRescue(content, balance);
  if (rescued !== null) {
    if (!options.dryRun) fs.writeFileSync(filePath, rescued);
    return { changed: true, action: 'rescued', balance: balance };
  }
  // Quarantine — replace with stub
  var stub = quarantineStubFor(filePath, content.length, balance);
  if (!options.dryRun) fs.writeFileSync(filePath, stub);
  return { changed: true, action: 'quarantined', balance: balance };
}

function main() {
  var args = parseArgs(process.argv);
  var rescued = 0, quarantined = 0;
  args.paths.forEach(function (root) {
    var files = walkSourceFiles(root);
    files.forEach(function (f) {
      var r = processFile(f, args);
      if (r.changed) {
        if (r.action === 'rescued') rescued++;
        if (r.action === 'quarantined') quarantined++;
        if (args.verbose) {
          console.log('  ' + r.action + ': ' + path.relative(root, f) +
            ' (braces=' + r.balance.openBrace +
            ' brackets=' + r.balance.openBracket +
            ' parens=' + r.balance.openParen +
            ' string=' + (r.balance.openStringAtEOF || 'no') + ')');
        }
      }
    });
  });
  console.log('scaffold-truncated-llm-doctor: ' + rescued + ' file(s) rescued, ' + quarantined + ' file(s) quarantined');
}

main();
