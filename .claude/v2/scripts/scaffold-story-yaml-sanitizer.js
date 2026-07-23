#!/usr/bin/env node
// scaffold-story-yaml-sanitizer.js — v128.
//
// PROBLEM (v128 evidence, live-reproduced): the story-runner crashed ALL 28
// stories with "YAML-PARSE" P0. 26/30 canonical user_story YAMLs fail
// yaml.safe_load because a mapping value STARTS with a quoted UI label and then
// continues unquoted, e.g.
//   expected: "No recent applications" message in applications card
//   description: "Process Next Application" button fetches next app in queue
// YAML reads `"No recent applications"` as a COMPLETE double-quoted scalar, then
// hits ` message …` and throws `expected <block end>, but found '<scalar>'`.
// (v127 never tripped this — its stories ran against a dead backend and the LLM
// report was fabricated; once login-proof + servers actually worked in v128, the
// strict parse surfaced it.)
//
// The author's INTENT is that the value includes the literal double-quotes (a
// quoted label inside a sentence). So the correct fix is to wrap the WHOLE value
// in a single-quoted YAML scalar — single quotes make the inner double-quotes
// literal; only inner single-quotes need doubling.
//
// FIX (deterministic, [[feedback_template_wins_llm]]): for every user_story
// *.yaml, rewrite any `key: "<label>" <more text>` line whose value starts with
// a quoted phrase but has trailing content into `key: '<value with '' escaped>'`.
// A value that is EXACTLY `"…"` (a legit fully-quoted scalar, nothing after) is
// left untouched. Idempotent: a single-quoted line no longer matches.
//
// Usage:
//   scaffold-story-yaml-sanitizer --target <STORIES_DIR> [--dry-run] [--verbose]
'use strict';

var fs = require('fs');
var path = require('path');

// A mapping line `key: value` with an inline scalar value. Captures:
//   [1] indent + key + ': '
//   [2] the raw value (trailing whitespace trimmed)
// Allow an optional leading "- " so list-item mappings (`- case: …`) match too.
var KV_RE = /^(\s*(?:- )?[A-Za-z0-9_-]+:[ \t]+)(\S.*?)[ \t]*$/;
// Already a COMPLETE quoted scalar (nothing trailing) — leave alone.
var FULL_DQUOTE = /^"[^"]*"$/;
var FULL_SQUOTE = /^'[^']*(?:''[^']*)*'$/;

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--dry-run') out.dryRun = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-story-yaml-sanitizer --target <STORIES_DIR> [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

// Split a raw value into [value, comment] at the first ' #' / '\t#' that is NOT
// inside a quote. A trailing YAML comment is part of the LINE, not the value —
// it must be preserved verbatim, never folded into a re-quoted scalar. v128
// evidence: `phone: "+10000000000"  # [scaffold-fixture-completeness] added` is
// VALID YAML (value +10000000000), but folding the comment in produced a 55-char
// value that overflowed phone varchar(20) → worker_pending never seeded → login
// 401 → login-proof hard-fail.
function splitComment(raw) {
  var inS = false, inD = false;
  for (var i = 0; i < raw.length; i++) {
    var c = raw.charAt(i);
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && i > 0 && /\s/.test(raw.charAt(i - 1))) {
      return [raw.slice(0, i).replace(/[ \t]+$/, ''), raw.slice(i)];
    }
  }
  return [raw, ''];
}

function fixLine(line) {
  var m = KV_RE.exec(line);
  if (!m) return null;
  var head = m[1];
  var rawFull = m[2];
  // Separate any trailing YAML comment — it stays verbatim, never re-quoted.
  var parts = splitComment(rawFull);
  var raw = parts[0];
  var comment = parts[1] ? ('  ' + parts[1]) : '';
  if (raw === '') return null;
  // Leave block scalars (| >), already-complete quoted scalars, and anchors/refs.
  if (/^[|>&*]/.test(raw)) return null;
  if (FULL_DQUOTE.test(raw) || FULL_SQUOTE.test(raw)) return null;
  // Problematic plain scalars that break a strict YAML parse:
  //   (1) starts with a " (quoted label) but has trailing text
  //   (2) contains a ": " (colon-space) — read as a nested mapping
  var needsQuote =
    (raw.charAt(0) === '"') ||
    /:[ \t]/.test(raw);
  if (!needsQuote) return null;
  // Single-quote the value (comment re-appended); double internal single-quotes.
  return head + "'" + raw.replace(/'/g, "''") + "'" + comment;
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.target)) {
    console.log('scaffold-story-yaml-sanitizer: no stories dir at ' + args.target + ' — nothing to do');
    return;
  }
  var files = fs.readdirSync(args.target).filter(function (f) { return /\.ya?ml$/.test(f); });
  var filesFixed = 0, linesFixed = 0;

  files.forEach(function (f) {
    var fp = path.join(args.target, f);
    var src = fs.readFileSync(fp, 'utf-8');
    var lines = src.split('\n');
    var changed = 0;
    var out = lines.map(function (line) {
      var fixed = fixLine(line);
      if (fixed !== null && fixed !== line) {
        changed++;
        if (args.verbose) console.log('  ' + f + ': ' + line.trim().slice(0, 70));
        return fixed;
      }
      return line;
    });
    if (changed > 0) {
      filesFixed++;
      linesFixed += changed;
      if (!args.dryRun) fs.writeFileSync(fp, out.join('\n'));
    }
  });

  console.log('scaffold-story-yaml-sanitizer: ' + linesFixed + ' line(s) re-quoted across ' + filesFixed + ' file(s)' + (args.dryRun ? ' (dry-run)' : ''));
}

main();
