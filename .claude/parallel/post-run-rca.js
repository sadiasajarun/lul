#!/usr/bin/env node
// post-run-rca.js — FORCE the per-phase RCA ledger (v114).
//
// WHY THIS EXISTS: writing "RCA every phase" in a memory rule fails — in a long
// session the LLM stops attending to the rule and reverts to skimming (fix the
// one big bug, declare done, skip the other phases). The fix is to move
// enforcement OUT of the LLM's attention into a deterministic gate.
//
// This script:
//   --generate <run-dir>  → enumerate EVERY phase from PIPELINE_STATUS (+ backlog
//                           carry-forward) and write RCA_LEDGER.md with one row
//                           per failed phase / open item. The machine lists the
//                           phases, so none can be silently skipped.
//   --check <run-dir>     → exit non-zero unless every row's REQUIRED columns
//                           (reproduced cmd→code, root cause, resolution) are
//                           filled and every defer has a valid reason.
//
// The launcher (run-parallel.sh) runs --check on the prior run before starting a
// new one and ABORTS if incomplete — same precedent as the required --hypothesis.
'use strict';

var fs = require('fs');
var path = require('path');

var VALID_DEFER = ['needs-llm-judgment', 'scope>2h', 'no-repro', 'provider/environmental'];
var LEDGER_NAME = 'RCA_LEDGER.md';
var BLANK_MARKS = ['', '-', 'todo', 'tbd', 'fixme', 'xxx'];

function arg(flag) {
  var i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function findCellDir(runDir) {
  if (!fs.existsSync(runDir)) return null;
  var cells = fs.readdirSync(runDir).filter(function (d) { return /^run-/.test(d) && fs.statSync(path.join(runDir, d)).isDirectory(); });
  return cells.length ? path.join(runDir, cells[0]) : null;
}

function findStatus(runDir) {
  var cell = findCellDir(runDir);
  if (!cell) return null;
  // .claude-project/<project>/status/PIPELINE_STATUS.md  (project name varies)
  var base = path.join(cell, '.claude-project');
  if (!fs.existsSync(base)) return null;
  var hits = [];
  fs.readdirSync(base).forEach(function (proj) {
    var p = path.join(base, proj, 'status', 'PIPELINE_STATUS.md');
    if (fs.existsSync(p)) hits.push(p);
  });
  return hits[0] || null;
}

// Parse the phase table → [{phase, status, output}]
function parsePhases(statusFile) {
  var txt = fs.readFileSync(statusFile, 'utf-8');
  var rows = [];
  txt.split('\n').forEach(function (line) {
    // | backend | Failed | .78 | 26/33 checks passed | 0 | ... |
    var m = /^\|\s*([a-z-]+)\s*\|\s*(Complete|Failed|Pending)\s*\|\s*([^|]*)\|\s*([^|]*)\|/.exec(line);
    if (m && ['spec','init','prd','user-stories','design','database','backend','frontend','integrate','test-api','test-browser','ship'].indexOf(m[1]) >= 0) {
      rows.push({ phase: m[1], status: m[2].trim(), score: m[3].trim(), output: m[4].trim() });
    }
  });
  return rows;
}

function backlogItems(runDir) {
  // workspace backlog (carry-forward) — search up for .claude-project/<proj>/SCAFFOLD_BACKLOG.md
  var items = [];
  var dir = path.resolve(runDir);
  for (var up = 0; up < 8; up++) {
    var cp = path.join(dir, '.claude-project');
    if (fs.existsSync(cp)) {
      fs.readdirSync(cp).forEach(function (proj) {
        var bl = path.join(cp, proj, 'SCAFFOLD_BACKLOG.md');
        if (fs.existsSync(bl)) {
          fs.readFileSync(bl, 'utf-8').split('\n').forEach(function (l) {
            var m = /^###\s*Item:\s*(.+)$/.exec(l.trim());
            if (m) items.push(m[1].trim());
          });
        }
      });
    }
    dir = path.dirname(dir);
  }
  return items;
}

// AUTHORITATIVE failure source: the run log's "RUN-ALL SUMMARY" block prints
// `❌ <phase> … — failed at <node>` once at end-of-run. Unlike PIPELINE_STATUS
// (which write-races — a hard-gate abort can leave the phase row "Pending"),
// the SUMMARY never misses a real failure and names the EXACT failing node.
// v119: PIPELINE_STATUS showed frontend "Pending" while the SUMMARY correctly
// said "❌ frontend — failed at build" → the old PIPELINE_STATUS-only enumeration
// silently dropped the run's actual blocker.
function findRunLogs(runDir) {
  // runDir = .../<project>/runs/<TAG>[/run-<CELL>]. Logs live at
  // .../<project>/logs/<TAG>/*.log. Walk up to the <project> dir, then logs/<TAG>.
  var tag = path.basename(runDir);
  var guess = [];
  var runsDir = path.dirname(runDir);                 // .../runs/<TAG> → .../runs  (or .../runs if cell)
  // If runDir is a cell dir (run-*), step up one more to the TAG dir.
  if (/^run-/.test(tag)) { runDir = path.dirname(runDir); tag = path.basename(runDir); runsDir = path.dirname(runDir); }
  var projDir = path.dirname(runsDir);                 // .../<project>
  var logsTagDir = path.join(projDir, 'logs', tag);
  if (fs.existsSync(logsTagDir)) {
    fs.readdirSync(logsTagDir).forEach(function (f) {
      if (/\.log$/.test(f) && !/launcher/.test(f)) guess.push(path.join(logsTagDir, f));
    });
  }
  return guess;
}
function logSummaryFailures(runDir) {
  var out = {}; // phase -> node
  findRunLogs(runDir).forEach(function (lf) {
    var txt;
    try { txt = fs.readFileSync(lf, 'utf-8'); } catch (e) { return; }
    var idx = txt.lastIndexOf('RUN-ALL SUMMARY');
    var scope = idx >= 0 ? txt.slice(idx) : txt;
    var re = /^\s*❌\s+([a-z][a-z-]*)\b[^\n]*?(?:failed at\s+([a-z][\w-]*))?\s*$/gim;
    var m;
    while ((m = re.exec(scope)) !== null) {
      var ph = m[1], node = m[2] || '';
      if (!out[ph] || (node && !out[ph])) out[ph] = node;
      if (node) out[ph] = node;
    }
  });
  return out; // {frontend:'build', backend:'verify-green', ...}
}

function generate(runDir) {
  var statusFile = findStatus(runDir);
  if (!statusFile) { console.error('post-run-rca: PIPELINE_STATUS.md not found under ' + runDir); process.exit(2); }
  var phases = parsePhases(statusFile);
  var failedMap = {};
  phases.filter(function (p) { return p.status === 'Failed'; }).forEach(function (p) {
    failedMap[p.phase] = { phase: p.phase, detail: (p.output || p.score || 'Failed') };
  });
  // Merge the authoritative log SUMMARY — catches write-race "Pending" phases
  // (e.g. frontend hard-abort) and pins the exact failing node.
  var logFails = logSummaryFailures(runDir);
  Object.keys(logFails).forEach(function (ph) {
    var node = logFails[ph];
    var detail = node ? ('failed at ' + node) : 'failed (log SUMMARY)';
    if (failedMap[ph]) { if (node) failedMap[ph].detail = failedMap[ph].detail + ' / failed at ' + node; }
    else failedMap[ph] = { phase: ph, detail: detail };
  });
  var failed = Object.keys(failedMap).map(function (k) { return failedMap[k]; });
  var backlog = backlogItems(runDir);
  var tag = path.basename(runDir);

  var rows = [];
  var n = 1;
  failed.forEach(function (p) {
    rows.push('| ' + (n++) + ' | ' + p.phase + ' | ' + p.detail + ' |  |  |  |');
  });
  backlog.forEach(function (it) {
    rows.push('| ' + (n++) + ' | [backlog] ' + it + ' |  |  |  |  |');
  });
  if (rows.length === 0) rows.push('| 1 | (no failed phases / backlog) | clean run | n/a | n/a | fixed:clean |');

  var out = [
    '# RCA Ledger — ' + tag,
    '',
    '<!-- Generated by post-run-rca.js --generate. FILL the last 3 columns of EVERY row -->',
    '<!-- before launching the next run. run-parallel.sh blocks launch until --check passes. -->',
    '<!-- "reproduced" MUST be an actual command + observed result (e.g. `curl .../applications -> 403`), -->',
    '<!-- NOT "the report said X" — LLM reports misdiagnose (v114 JWT example). Reproduce live. -->',
    '<!-- resolution: `fixed:<commit-or-scaffold>` OR `defer:<reason>` where reason ∈ ' + VALID_DEFER.join(' | ') + ' -->',
    '',
    '| # | phase / item | error (auto) | reproduced? (cmd → result) | root cause | resolution |',
    '|---|---|---|---|---|---|',
  ].concat(rows).join('\n') + '\n';

  var dst = path.join(runDir, LEDGER_NAME);
  fs.writeFileSync(dst, out);
  console.log('post-run-rca: wrote ' + path.relative(process.cwd(), dst) + ' — ' + (rows.length) + ' row(s) to fill (' + failed.length + ' failed phase(s), ' + backlog.length + ' backlog item(s))');
}

function isBlank(cell) {
  return BLANK_MARKS.indexOf((cell || '').trim().toLowerCase()) >= 0;
}

function check(runDir) {
  var ledger = path.join(runDir, LEDGER_NAME);
  if (!fs.existsSync(ledger)) {
    console.error('❌ RCA INCOMPLETE: ' + LEDGER_NAME + ' missing. Run: node .claude/parallel/post-run-rca.js --generate ' + runDir);
    process.exit(1);
  }
  // Cross-check: every Failed phase must appear as a row. Source = PIPELINE_STATUS
  // "Failed" UNION the run-log RUN-ALL SUMMARY (authoritative — catches write-race
  // "Pending" phases the status table drops, e.g. a frontend hard-gate abort).
  var statusFile = findStatus(runDir);
  var fp = {};
  if (statusFile) parsePhases(statusFile).filter(function (p) { return p.status === 'Failed'; }).forEach(function (p) { fp[p.phase] = true; });
  Object.keys(logSummaryFailures(runDir)).forEach(function (ph) { fp[ph] = true; });
  var failedPhases = Object.keys(fp);

  // A FAILED-phase row's "reproduced?" must show a LIVE observation, not a static
  // hypothesis. Without this, the ledger accepts prose like "page errors at runtime
  // (needs live RCA)" — which is exactly how simulate-driven discovery gets skipped:
  // a plausible guess passes the check, so the artifact never gets booted + driven.
  // Require at least one evidence token: a backtick command, a cmd→result arrow, a
  // ratio (5/5, 18/28), an HTTP/status code, an explicit PASS/FAIL, or a tool verb.
  var EVIDENCE_RE = /`|→|->|\b\d+\s*\/\s*\d+\b|\bHTTP\b|\b[1-5]\d\d\b|\bPASS(ED)?\b|\bFAIL(ED)?\b|\b(curl|npx|npm|grep|node|bash|psql|tsc|jest|playwright|ts-node)\b|\b0 errors?\b/i;

  var lines = fs.readFileSync(ledger, 'utf-8').split('\n').filter(function (l) { return /^\|/.test(l) && !/^\|\s*-+/.test(l) && !/^\|\s*#\s*\|/.test(l); });
  var problems = [];
  var coveredPhases = {};
  lines.forEach(function (line) {
    var cells = line.split('|').map(function (c) { return c.trim(); }); // ['', #, phase, error, reproduced, root, resolution, '']
    if (cells.length < 7) return;
    var item = cells[2], reproduced = cells[4], root = cells[5], resolution = cells[6];
    var isFailedPhase = failedPhases.indexOf(item) >= 0;
    failedPhases.forEach(function (ph) { if (item === ph) coveredPhases[ph] = true; });

    if (isBlank(reproduced)) problems.push('row "' + item + '": reproduced? is blank (must be a real cmd → result)');
    else if (isFailedPhase && !EVIDENCE_RE.test(reproduced)) {
      problems.push('row "' + item + '": reproduced? reads like a HYPOTHESIS, not a live observation — boot the artifact + drive it, then record the actual command + result (e.g. `curl … → 403`, `npx tsc → 0 errors`, `5/5 PASS`). Do NOT defer a failed phase with a guess.');
    }
    if (isBlank(root)) problems.push('row "' + item + '": root cause is blank');
    if (isBlank(resolution)) problems.push('row "' + item + '": resolution is blank (fixed:<x> or defer:<reason>)');
    else {
      var dm = /^defer:\s*(.+)$/i.exec(resolution);
      if (dm && VALID_DEFER.indexOf(dm[1].trim().toLowerCase()) < 0) {
        problems.push('row "' + item + '": invalid defer reason "' + dm[1].trim() + '" (must be ∈ ' + VALID_DEFER.join(' | ') + ')');
      }
      if (!dm && !/^fixed:/i.test(resolution)) {
        problems.push('row "' + item + '": resolution must start with "fixed:" or "defer:"');
      }
    }
  });
  failedPhases.forEach(function (ph) {
    if (!coveredPhases[ph]) problems.push('Failed phase "' + ph + '" has NO ledger row — every failed phase must be RCA\'d');
  });

  if (problems.length) {
    console.error('❌ RCA LEDGER INCOMPLETE (' + problems.length + ' issue(s)) — cannot launch next run:');
    problems.forEach(function (p) { console.error('   - ' + p); });
    console.error('   Fill ' + path.relative(process.cwd(), ledger) + ', then retry. (override: SKIP_RCA_CHECK=1)');
    process.exit(1);
  }
  console.log('✅ RCA ledger complete — ' + lines.length + ' row(s), all reproduced + resolved.');
}

function main() {
  var gen = arg('--generate');
  var chk = arg('--check');
  if (gen) return generate(gen);
  if (chk) return check(chk);
  console.error('Usage: post-run-rca.js --generate <run-dir> | --check <run-dir>');
  process.exit(2);
}

main();
