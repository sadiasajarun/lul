#!/usr/bin/env node
// story-fix.js — frozen-app, per-story debug loop for the long tail (80→90%+).
//
// PRINCIPLE: past ~90%, the remaining failures are DEBUGGING an existing app,
// not regenerating it. Re-running the 3.6h pipeline to fix 2 stories is the wrong
// tool. This harness keeps the already-built app FROZEN + WARM and iterates only
// on the failing stories — boot once, test one story, fix surgically, re-test
// just that story, then a cheap full-suite regression check. ~10-20 min/story
// vs 3.6h/run.
//
// Each story == one Playwright spec (frontend/tests/stories/<id>.spec.ts). The
// app is booted once and reused across invocations (pid files under the run dir).
//
// Usage:
//   story-fix --run <RUN_DIR> --frontend <name> --list
//       boot warm + run all story specs → PASS/FAIL baseline (the failing tail)
//   story-fix --run <RUN_DIR> --frontend <name> --story 02-login
//       run ONE story; on FAIL emit a fix-bundle (AC + candidate page files +
//       error + screenshot) and the exact re-test command — fix, then re-run this
//   story-fix --run <RUN_DIR> --frontend <name> --regression
//       re-run the whole suite against the warm app (cheap post-fix check)
//   story-fix --run <RUN_DIR> --frontend <name> --down
//       stop the warm servers
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

function parseArgs(argv) {
  var out = { backendPort: null, frontendPort: null };
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--run') out.run = argv[++i];
    else if (a === '--frontend') out.frontend = argv[++i];
    else if (a === '--story') out.story = argv[++i];
    else if (a === '--list') out.list = true;
    else if (a === '--regression') out.regression = true;
    else if (a === '--down') out.down = true;
    else if (a === '--backend-port') out.backendPort = argv[++i];
    else if (a === '--frontend-port') out.frontendPort = argv[++i];
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.run || !out.frontend) {
    console.error('Usage: story-fix --run <RUN_DIR> --frontend <name> [--list | --story <id> | --regression | --down]');
    process.exit(1);
  }
  return out;
}

function sh(cmd, opts) {
  try { return { code: 0, out: cp.execSync(cmd, Object.assign({ encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }, opts || {})) }; }
  catch (e) { return { code: e.status || 1, out: (e.stdout || '') + (e.stderr || '') }; }
}

function projectDir(run) {
  // <run>/.claude-project/<proj> — the dir that actually holds the project
  // (user_stories/docs), NOT siblings like episodes/ or qa/.
  var cp_ = path.join(run, '.claude-project');
  if (!fs.existsSync(cp_)) return null;
  var dirs = fs.readdirSync(cp_).filter(function (n) { try { return fs.statSync(path.join(cp_, n)).isDirectory(); } catch (e) { return false; } });
  var proj = dirs.find(function (n) { return fs.existsSync(path.join(cp_, n, 'user_stories')) || fs.existsSync(path.join(cp_, n, 'docs')); });
  return proj ? path.join(cp_, proj) : (dirs[0] ? path.join(cp_, dirs[0]) : null);
}

function detectPorts(run, frontend, args) {
  var bp = args.backendPort, fp = args.frontendPort;
  // backend .env PORT
  if (!bp) { try { var m = /^PORT=(\d+)/m.exec(fs.readFileSync(path.join(run, 'backend/.env'), 'utf-8')); if (m) bp = m[1]; } catch (e) {} }
  // frontend VITE_API_URL → backend port; frontend dev port from .env or default by index
  if (!fp) { try { var fm = /VITE_PORT=(\d+)/m.exec(fs.readFileSync(path.join(run, frontend, '.env'), 'utf-8')); if (fm) fp = fm[1]; } catch (e) {} }
  bp = bp || '3000';
  fp = fp || '5173';
  return { bp: bp, fp: fp };
}

function healthy(url) { return sh('curl -s -o /dev/null -w "%{http_code}" --max-time 2 ' + url).out.trim() === '200'; }
function listening(url) { var c = sh('curl -s -o /dev/null -w "%{http_code}" --max-time 2 ' + url).out.trim(); return c !== '000' && c !== ''; }

function bootIfDown(name, dir, port, healthPath, pidFile) {
  var url = 'http://localhost:' + port + (healthPath || '');
  if (listening(url)) { console.log('  ' + name + ' already up on :' + port); return; }
  console.log('  booting ' + name + ' on :' + port + ' ...');
  var cmd = name === 'backend'
    ? 'cd "' + dir + '" && PORT=' + port + ' nohup npm run start:dev >.story-fix-' + name + '.log 2>&1 & echo $!'
    : 'cd "' + dir + '" && PORT=' + port + ' nohup npm run dev -- --port ' + port + ' >.story-fix-' + name + '.log 2>&1 & echo $!';
  var pid = sh(cmd).out.trim();
  if (pid) fs.writeFileSync(pidFile, pid);
  // Single shell wait — the retry loop + sleep live INSIDE one execSync (robust;
  // avoids many per-iteration execSync('sleep') calls that a sandbox can block).
  var waited = sh('for i in $(seq 1 45); do c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "' + url + '" 2>/dev/null); { [ "$c" != "000" ] && [ -n "$c" ]; } && { echo "up:$((i*2))"; exit 0; }; sleep 2; done; echo down');
  if (/up:/.test(waited.out)) console.log('  ' + name + ' up after ' + (waited.out.match(/up:(\d+)/) || [])[1] + 's');
  else console.log('  WARN: ' + name + ' not reachable after 90s — check ' + dir + '/.story-fix-' + name + '.log');
}

function ensureWarm(run, frontend, ports) {
  console.log('[story-fix] warming app (frozen) — backend :' + ports.bp + ', ' + frontend + ' :' + ports.fp);
  bootIfDown('backend', path.join(run, 'backend'), ports.bp, '/api/health', path.join(run, 'backend/.story-fix-backend.pid'));
  bootIfDown('frontend', path.join(run, frontend), ports.fp, '', path.join(run, frontend, '.story-fix-frontend.pid'));
}

function stopWarm(run, frontend) {
  ['backend/.story-fix-backend.pid', frontend + '/.story-fix-frontend.pid'].forEach(function (rel) {
    var f = path.join(run, rel);
    if (fs.existsSync(f)) { var pid = fs.readFileSync(f, 'utf-8').trim(); sh('kill ' + pid + ' 2>/dev/null'); fs.unlinkSync(f); console.log('  stopped pid ' + pid + ' (' + rel + ')'); }
  });
}

function specsDir(run, frontend) { return path.join(run, frontend, 'tests/stories'); }

function runSpec(run, frontend, ports, specFile) {
  var fe = path.join(run, frontend);
  var env = 'BASE_URL=http://localhost:' + ports.fp + ' API_URL=http://localhost:' + ports.bp + '/api';
  var target = specFile ? ('tests/stories/' + specFile) : '';
  var r = sh('cd "' + fe + '" && ' + env + ' npx playwright test ' + target + ' --reporter=line 2>&1');
  return r;
}

function parseLine(out) {
  // playwright --reporter=line ends with e.g. "  3 passed (4s)" / "  1 failed"
  var passed = (/(\d+) passed/.exec(out) || [])[1];
  var failed = (/(\d+) failed/.exec(out) || [])[1];
  return { passed: Number(passed || 0), failed: Number(failed || 0) };
}

function fixBundle(run, frontend, story, runOut) {
  var proj = projectDir(run);
  console.log('\n=== FIX BUNDLE: ' + story + ' ===');
  // 1) story YAML (acceptance criteria)
  var yamlF = proj && path.join(proj, 'user_stories', story + '.yaml');
  if (yamlF && fs.existsSync(yamlF)) {
    console.log('--- story (' + path.relative(run, yamlF) + '):');
    console.log(fs.readFileSync(yamlF, 'utf-8').split('\n').slice(0, 40).join('\n'));
    // 2) candidate page files from ui_route
    var routes = (fs.readFileSync(yamlF, 'utf-8').match(/ui_route:\s*([^\s#]+)/g) || []).map(function (s) { return s.split(/:\s*/)[1]; });
    var pagesDir = path.join(run, frontend, 'app/pages');
    var cands = [];
    if (fs.existsSync(pagesDir)) {
      var base = story.replace(/^\d+-/, '');
      var walk = function (d) { fs.readdirSync(d).forEach(function (n) { var p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx$/.test(n) && (n.toLowerCase().indexOf(base.split('-')[0]) >= 0)) cands.push(path.relative(run, p)); }); };
      try { walk(pagesDir); } catch (e) {}
    }
    console.log('--- candidate page file(s) [routes: ' + routes.join(', ') + ']:');
    cands.slice(0, 6).forEach(function (c) { console.log('    ' + c); });
  }
  // 3) the failure
  console.log('--- playwright failure (tail):');
  console.log(runOut.split('\n').filter(function (l) { return /Error|expect|✘|✗|failed|Received|locator|toBeVisible|timeout/i.test(l); }).slice(0, 12).map(function (l) { return '    ' + l.trim(); }).join('\n'));
  // 4) screenshots
  var resultsDir = path.join(run, frontend, 'test-results');
  if (fs.existsSync(resultsDir)) {
    var shots = sh('find "' + resultsDir + '" -name "*.png" 2>/dev/null | head -3').out.trim();
    if (shots) console.log('--- screenshots:\n' + shots.split('\n').map(function (s) { return '    ' + s; }).join('\n'));
  }
  console.log('\n--- after a surgical fix, re-test ONLY this story:');
  console.log('    node ' + path.relative(process.cwd(), __filename) + ' --run "' + run + '" --frontend ' + frontend + ' --story ' + story);
  console.log('--- then regression-check the whole suite (cheap, warm):');
  console.log('    node ' + path.relative(process.cwd(), __filename) + ' --run "' + run + '" --frontend ' + frontend + ' --regression\n');
}

function main() {
  var args = parseArgs(process.argv);
  if (args.down) { stopWarm(args.run, args.frontend); return; }
  var ports = detectPorts(args.run, args.frontend, args);
  ensureWarm(args.run, args.frontend, ports);

  var sd = specsDir(args.run, args.frontend);
  if (!fs.existsSync(sd)) { console.error('[story-fix] no tests/stories under ' + args.frontend + ' — run scaffold-story-specs first'); process.exit(1); }

  if (args.story) {
    var specFile = fs.readdirSync(sd).find(function (f) { return f === args.story + '.spec.ts' || f.indexOf(args.story) === 0; });
    if (!specFile) { console.error('[story-fix] no spec for story "' + args.story + '" in ' + sd); process.exit(1); }
    console.log('[story-fix] running story ' + specFile + ' against the warm app ...');
    var r = runSpec(args.run, args.frontend, ports, specFile);
    var pr = parseLine(r.out);
    if (r.code === 0 && pr.failed === 0) { console.log('  ✅ PASS (' + pr.passed + ' AC checks)'); process.exit(0); }
    console.log('  ❌ FAIL (' + pr.passed + ' passed, ' + pr.failed + ' failed)');
    fixBundle(args.run, args.frontend, args.story, r.out);
    process.exit(1);
  }

  // --list / --regression: full suite
  console.log('[story-fix] running full story suite against the warm app ...');
  var all = runSpec(args.run, args.frontend, ports, null);
  // per-spec PASS/FAIL: playwright line reporter prints each spec; parse failing spec names
  var failing = (all.out.match(/tests\/stories\/([0-9a-z-]+)\.spec\.ts/g) || []);
  var pr2 = parseLine(all.out);
  console.log('\n[story-fix] suite: ' + pr2.passed + ' passed, ' + pr2.failed + ' failed (AC checks).');
  var failSpecs = Array.from(new Set((all.out.match(/✘|✗|failed/.test(all.out) ? (all.out.match(/[0-9a-z-]+\.spec\.ts/g) || []) : []))));
  if (args.list) {
    console.log('[story-fix] failing specs (target these with --story <id>):');
    // surface lines that mention a failing test
    all.out.split('\n').filter(function (l) { return /✘|✗|\d+\)\s|failed/.test(l) && /spec\.ts|US-|AC-/.test(l); }).slice(0, 30).forEach(function (l) { console.log('    ' + l.trim()); });
  }
  process.exit(pr2.failed === 0 ? 0 : 1);
}

main();
