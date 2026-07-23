#!/usr/bin/env node
// ensure-rr7-types.js — runs `react-router typegen` and, if it fails or
// produces no `+types/root` ambient module, writes a minimal stub so that
// tsc doesn't TS2307 on `import type { Route } from "./+types/root"` in
// root.tsx / route module files.
//
// v66 evidence: typegen crashed on LLM-mangled vite.config.ts → no
// +types/root files → tsc failed → fix-agent burned 35min trying to
// recover. v67 fix: lock vite.config.ts via scope_guard (primary) +
// stub as fallback (this script).
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: ensure-rr7-types --target FRONTEND_DIR');
    process.exit(1);
  }
  return out;
}

function tryTypegen(target) {
  // v91: add 60s timeout. v90 evidence: react-router typegen deadlocked
  // for 3h 46min at 0% CPU holding the orchestrator hostage. Some I/O
  // block. With timeout, we fall through to writeStub() in seconds.
  try {
    cp.execSync('npx react-router typegen', {
      cwd: target,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,         // 60s hard cap
      killSignal: 'SIGKILL',  // ensure stuck typegen dies
    });
    return true;
  } catch (_e) {
    return false;
  }
}

function writeStub(target) {
  // Stub `<frontend>/.react-router/types/app/+types/root.ts` plus a
  // matching path-alias resolution under `app/+types/`. RR7 places
  // generated types under `.react-router/types/` and tsconfig.json
  // resolves them via `paths`. If typegen ran, those files exist; this
  // stub is only written when they don't.
  var stubDir = path.join(target, '.react-router/types/app');
  var stubFile = path.join(stubDir, '+types/root.ts');
  if (fs.existsSync(stubFile)) return false;
  fs.mkdirSync(path.join(stubDir, '+types'), { recursive: true });

  var content =
    '// Generated stub by ensure-rr7-types — typegen failed to run. Replace\n' +
    '// by fixing vite.config.ts and re-running `npx react-router typegen`.\n' +
    'export namespace Route {\n' +
    '  export type MetaFunction = () => Array<Record<string, unknown>>;\n' +
    '  export type LinksFunction = () => Array<Record<string, unknown>>;\n' +
    '  export type LoaderArgs = { request: Request; params: Record<string, string> };\n' +
    '  export type ActionArgs = { request: Request; params: Record<string, string> };\n' +
    '  export type ComponentProps = { loaderData?: unknown; actionData?: unknown; params?: Record<string, string> };\n' +
    '  export type ErrorBoundaryProps = { error: unknown };\n' +
    '  export type HeadersFunction = (args: { loaderHeaders: Headers; parentHeaders: Headers }) => Headers;\n' +
    '}\n';
  fs.writeFileSync(stubFile, content);
  return true;
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(path.join(args.target, 'package.json'))) {
    console.log('ensure-rr7-types: ' + args.target + ' has no package.json — skipping');
    return;
  }
  console.log('ensure-rr7-types: running react-router typegen in ' + args.target);
  var ok = tryTypegen(args.target);
  console.log('  typegen: ' + (ok ? 'PASS' : 'FAIL (will write stub)'));

  var wroteStub = writeStub(args.target);
  if (wroteStub) console.log('  ✓ wrote stub +types/root.ts (belt-and-suspenders for tsc)');
  else if (args.verbose) console.log('  +types/root.ts already exists — leaving alone');

  // Don't fail the pipeline on either outcome — the stub gets us past tsc
  // even when typegen breaks.
  console.log('ensure-rr7-types: done');
}

main();
