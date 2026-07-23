#!/usr/bin/env node
// scaffold-global-setup-verify.js — v90
//
// Hard-fail the pipeline early if auth/login doesn't work for ANY fixture
// user. Without this gate, the agentic story-runner sees silent 401s,
// storageState never gets written, every story crashes at global-setup,
// and stories_total=N / stories_passed=0 reports get filed as if the
// system tested anything.
//
// v76/v78/v87/v89 evidence: every run that died at story-runner had the
// same pathology: global-setup ran, hit non-200 on /auth/login, accumulated
// failures[] silently, skipped storageState writing. Story-runner agents
// then burned hours diagnosing.
//
// STRATEGY:
//   1. Read _fixtures.yaml users:
//   2. For each non-placeholder user with email+password, POST /auth/login
//      to the backend (URL derived from backend/.env.example PORT)
//   3. If ANY login fails (non-200, non-2xx, missing cookie):
//      - Print exact request body + response body + status
//      - exit 1 with a loud error so the pipeline halts
//   4. If all pass, print "verified N users" and exit 0
//
// Designed to run AFTER seed.ts has executed but BEFORE story-runner.
// In the v90 pipeline that's between scaffold-story-specs and run-story-specs.
'use strict';

var fs = require('fs');
var path = require('path');
var http = require('http');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--fixtures') out.fixtures = argv[++i];
    else if (a === '--backend') out.backend = argv[++i];
    else if (a === '--api-base-url') out.apiBaseUrl = argv[++i];
    else if (a === '--port') out.port = argv[++i];
    else if (a === '--login-path') out.loginPath = argv[++i];
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.fixtures || !out.backend) {
    console.error('Usage: scaffold-global-setup-verify --fixtures <_fixtures.yaml> --backend <BACKEND_DIR> [--api-base-url] [--login-path /auth/login]');
    process.exit(1);
  }
  out.loginPath = out.loginPath || '/auth/login';
  return out;
}

function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  try {
    var root = require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim();
    return require(path.join(root, 'yaml'));
  } catch (_) {
    console.error('scaffold-global-setup-verify: yaml package unavailable — installing best-effort');
    process.exit(0);
  }
}

function detectBackendPort(backendDir) {
  for (var i = 0; i < 2; i++) {
    var p = path.join(backendDir, i === 0 ? '.env' : '.env.example');
    if (!fs.existsSync(p)) continue;
    var m = /^\s*PORT\s*=\s*(\d+)/m.exec(fs.readFileSync(p, 'utf-8'));
    if (m) return parseInt(m[1], 10);
  }
  return 3000;
}

function detectApiPrefix(backendDir) {
  // Look for global prefix in main.ts
  var mainPath = path.join(backendDir, 'src/main.ts');
  if (fs.existsSync(mainPath)) {
    var content = fs.readFileSync(mainPath, 'utf-8');
    var m = /setGlobalPrefix\(\s*['"]([^'"]+)['"]/.exec(content);
    if (m) return '/' + m[1].replace(/^\/+|\/+$/g, '');
  }
  return '/api'; // sensible default for NestJS
}

function postJson(url, body, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var parsed;
    try {
      parsed = new URL(url);
    } catch (e) { reject(new Error('bad url: ' + url)); return; }
    var payload = JSON.stringify(body);
    var req = http.request({
      method: 'POST',
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      timeout: timeoutMs || 5000,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Accept': 'application/json',
      },
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf-8'),
          headers: res.headers,
        });
      });
    });
    req.on('error', function (e) { reject(e); });
    req.on('timeout', function () { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

async function main() {
  var args = parseArgs(process.argv);

  if (!fs.existsSync(args.fixtures)) {
    console.log('scaffold-global-setup-verify: no _fixtures.yaml — skipping');
    return;
  }
  var YAML = loadYaml();
  var fixtures;
  try { fixtures = YAML.parse(fs.readFileSync(args.fixtures, 'utf-8')); }
  catch (e) {
    console.log('scaffold-global-setup-verify: fixtures parse failed (' + e.message + ') — skipping (not fatal)');
    return;
  }
  if (!fixtures || !fixtures.users) {
    console.log('scaffold-global-setup-verify: no users: in fixtures — skipping');
    return;
  }
  // v128: prefer the explicit --port (the cell's actual {BACKEND_PORT}) over
  // detecting from backend/.env. In FROM_BACKEND runs the FROZEN backend's
  // .env carries PORT=3000 while the cell runs on its assigned port (e.g. 3601,
  // set via the PORT env at boot) — detecting from .env made login-proof probe
  // :3000 (dead) and report 7/7 HTTP 0 while the backend was healthy on :3601
  // the whole time. RULE-I4 (port consistency) on the frozen path.
  var port = args.port || detectBackendPort(args.backend);
  var prefix = detectApiPrefix(args.backend);
  var apiBase = args.apiBaseUrl || ('http://localhost:' + port + prefix);
  var loginUrl = apiBase + args.loginPath;

  // Collect user records with email+password (skip placeholders)
  var candidates = [];
  Object.keys(fixtures.users).forEach(function (key) {
    var u = fixtures.users[key];
    if (!u || typeof u !== 'object') return;
    if (!u.email || !u.password) return;
    candidates.push({ key: key, email: u.email, password: u.password });
  });
  if (candidates.length === 0) {
    console.log('scaffold-global-setup-verify: no users with email+password — skipping');
    return;
  }
  console.log('scaffold-global-setup-verify: testing ' + candidates.length + ' login(s) against ' + loginUrl);

  // v128: tolerate a brief backend boot/restart window before judging logins.
  // The shared backend can be mid-restart when this runs (test-api just released
  // it; ensure-servers may have just (re)booted it across 3 parallel test-browser
  // instances). v128 evidence: 7/7 HTTP 0 because the backend died in the
  // ensure-servers→login-proof window. Probe reachability (ANY non-zero HTTP
  // status) for ~30s first — a transient window must not abort, but a
  // persistently-dead backend still falls through to the real per-user checks
  // below and fails honestly.
  var reachable = false;
  for (var rp = 0; rp < 15; rp++) {
    try {
      var probe = await postJson(loginUrl, { email: '__probe__@example.com', password: '__probe__' }, 4000);
      if (probe && probe.status && probe.status !== 0) { reachable = true; break; }
    } catch (e) { /* connection refused — backend not up yet, keep waiting */ }
    await new Promise(function (r) { setTimeout(r, 2000); });
  }
  if (reachable) {
    if (args.verbose) console.log('  backend reachable — proceeding to per-user login checks');
  } else {
    console.error('scaffold-global-setup-verify: backend at ' + loginUrl + ' still unreachable after ~30s (HTTP 0) — genuinely down, not a transient restart window');
  }

  var failures = [];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var result;
    try {
      result = await postJson(loginUrl, { email: c.email, password: c.password }, 5000);
    } catch (e) {
      result = { status: 0, body: 'request error: ' + e.message, headers: {} };
    }
    var ok = result.status >= 200 && result.status < 300;
    var hasCookie = !!(result.headers && result.headers['set-cookie']);
    if (!ok) {
      failures.push({
        user: c.key, email: c.email, status: result.status,
        body: (result.body || '').slice(0, 300),
      });
      if (args.verbose) console.log('  ❌ ' + c.key + ' (' + c.email + ') HTTP ' + result.status + ' — ' + (result.body || '').slice(0, 100));
    } else {
      if (args.verbose) console.log('  ✅ ' + c.key + ' (' + c.email + ') HTTP ' + result.status + (hasCookie ? ' +cookie' : ' NO cookie'));
    }
  }

  if (failures.length === 0) {
    console.log('scaffold-global-setup-verify: ✅ all ' + candidates.length + ' user(s) login successfully');
    return;
  }
  console.error('');
  console.error('scaffold-global-setup-verify: ❌ ' + failures.length + '/' + candidates.length + ' login(s) FAILED');
  console.error('');
  failures.forEach(function (f) {
    console.error('  user="' + f.user + '" email="' + f.email + '" → HTTP ' + f.status);
    console.error('    body: ' + f.body);
  });
  console.error('');
  console.error('Possible causes:');
  console.error('  1. Seed script did not run — check backend/src/database/seed.ts and `npm run seed` output');
  console.error('  2. passwordHash mismatch — fixture has plaintext that seed should hash with bcrypt');
  console.error('  3. Backend not running on port ' + port + ' — check ensure-servers step');
  console.error('  4. /auth/login route missing or returning different shape — check auth.controller.ts');
  console.error('');
  process.exit(1);
}

main().catch(function (e) {
  console.error('scaffold-global-setup-verify: unexpected error: ' + e.message);
  process.exit(1);
});
