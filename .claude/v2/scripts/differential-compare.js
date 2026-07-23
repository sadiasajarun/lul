#!/usr/bin/env node
// differential-compare.js — multi-stack contract verification.
//
// Drives the SAME contract requests against two running backends (e.g. the
// NestJS app on :A and the Django app on :B, generated from the same PROJECT_API
// / PROJECT_DATABASE / _fixtures) and diffs their responses. This is the
// acceptance test for a second tech stack: if both honor the shared contract,
// their status codes + (normalized) response bodies match; every DIVERGE is a
// concrete contract gap to close in one stack or the other.
//
// Normalization strips non-deterministic + per-instance values (uuids, *_at
// timestamps, ISO datetimes) and sorts arrays, so the comparison is about SHAPE
// + STABLE VALUES, not row ids or ordering.
//
// Usage:
//   differential-compare --a http://localhost:3000/api --b http://localhost:8000/api \
//     --fixtures <_fixtures.yaml> [--login-path /auth/login] [--probe /applications] [--verbose]
//   (repeat --probe; default probes: a GET per top-level collection found in the run)
'use strict';

var http = require('http');
var https = require('https');
var fs = require('fs');

function parseArgs(argv) {
  var out = { probes: [], loginPath: '/auth/login' };
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--a') out.a = argv[++i];
    else if (a === '--b') out.b = argv[++i];
    else if (a === '--fixtures') out.fixtures = argv[++i];
    else if (a === '--login-path') out.loginPath = argv[++i];
    else if (a === '--probe') out.probes.push(argv[++i]);
    else if (a === '--as') out.as = argv[++i]; // fixture user key to log in as
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.a || !out.b || !out.fixtures) {
    console.error('Usage: differential-compare --a <baseUrlA> --b <baseUrlB> --fixtures <_fixtures.yaml> [--probe /path]... [--as <userKey>]');
    process.exit(1);
  }
  return out;
}

function request(method, url, body, cookie) {
  return new Promise(function (resolve) {
    var u = new URL(url);
    var lib = u.protocol === 'https:' ? https : http;
    var payload = body ? JSON.stringify(body) : null;
    var headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    if (cookie) headers['Cookie'] = cookie;
    var req = lib.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: method, headers: headers, timeout: 8000 },
      function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var raw = Buffer.concat(chunks).toString('utf-8');
          var json = null; try { json = JSON.parse(raw); } catch (e) {}
          resolve({ status: res.statusCode, json: json, raw: raw, setCookie: res.headers['set-cookie'] });
        });
      });
    req.on('error', function (e) { resolve({ status: 0, error: e.message }); });
    req.on('timeout', function () { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// Recursively normalize: drop volatile keys, blank uuid/datetime values, sort arrays.
var VOLATILE_KEY = /^(id|.*_id|.*Id|created_at|updated_at|deleted_at|createdAt|updatedAt|deletedAt|timestamp|token|access|refresh|iat|exp)$/;
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function normalize(v) {
  if (Array.isArray(v)) {
    var arr = v.map(normalize);
    arr.sort(function (a, b) { return JSON.stringify(a) < JSON.stringify(b) ? -1 : 1; });
    return arr;
  }
  if (v && typeof v === 'object') {
    var out = {};
    Object.keys(v).sort().forEach(function (k) {
      if (VOLATILE_KEY.test(k)) { out[k] = '<volatile>'; return; }
      out[k] = normalize(v[k]);
    });
    return out;
  }
  if (typeof v === 'string' && (UUID_RE.test(v) || ISO_RE.test(v))) return '<volatile>';
  return v;
}

function diff(a, b, path, acc) {
  path = path || '$';
  acc = acc || [];
  if (JSON.stringify(a) === JSON.stringify(b)) return acc;
  var ta = Array.isArray(a) ? 'array' : typeof a;
  var tb = Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) { acc.push(path + ': type ' + ta + ' ≠ ' + tb); return acc; }
  if (ta === 'object' && a && b) {
    var keys = new Set(Object.keys(a).concat(Object.keys(b)));
    keys.forEach(function (k) {
      if (!(k in a)) acc.push(path + '.' + k + ': missing in A');
      else if (!(k in b)) acc.push(path + '.' + k + ': missing in B');
      else diff(a[k], b[k], path + '.' + k, acc);
    });
  } else if (ta === 'array') {
    if (a.length !== b.length) acc.push(path + ': length ' + a.length + ' ≠ ' + b.length);
    else for (var i = 0; i < a.length; i++) diff(a[i], b[i], path + '[' + i + ']', acc);
  } else {
    acc.push(path + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b));
  }
  return acc;
}

function loadFixtureUser(fixturesPath, asKey) {
  var raw = fs.readFileSync(fixturesPath, 'utf-8');
  // tiny YAML-less extract: find users: block, then the chosen key's email/password.
  // (avoids a yaml dep — good enough for the _fixtures.yaml shape)
  var lines = raw.split(/\r?\n/);
  var users = {}; var curKey = null;
  var inUsers = false; var baseIndent = null;
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (/^users:\s*$/.test(ln)) { inUsers = true; continue; }
    if (inUsers) {
      var km = /^(\s+)([A-Za-z0-9_]+):\s*$/.exec(ln);
      if (km) { if (baseIndent === null) baseIndent = km[1].length; if (km[1].length === baseIndent) { curKey = km[2]; users[curKey] = {}; continue; } }
      if (curKey) {
        var em = /^\s+email:\s*(.+)\s*$/.exec(ln); if (em) users[curKey].email = em[1].replace(/['"]/g, '').trim();
        var pm = /^\s+password:\s*(.+)\s*$/.exec(ln); if (pm) users[curKey].password = pm[1].replace(/['"]/g, '').trim();
      }
      if (/^[A-Za-z]/.test(ln)) inUsers = false; // left the users block
    }
  }
  if (asKey && users[asKey] && users[asKey].email) return users[asKey];
  // default: first user with a real email + password
  var k = Object.keys(users).find(function (k) { return users[k].email && users[k].email !== 'null' && users[k].password; });
  return k ? users[k] : null;
}

async function login(base, loginPath, user) {
  var r = await request('POST', base + loginPath, { email: user.email, password: user.password });
  var cookie = r.setCookie ? r.setCookie.map(function (c) { return c.split(';')[0]; }).join('; ') : null;
  var token = r.json && r.json.data && (r.json.data.token || r.json.data.access);
  return { status: r.status, cookie: cookie, token: token, body: r.json };
}

async function main() {
  var args = parseArgs(process.argv);
  var user = loadFixtureUser(args.fixtures, args.as);
  if (!user) { console.error('differential-compare: no usable fixture user'); process.exit(1); }
  console.log('differential-compare: A=' + args.a + '  B=' + args.b + '  as=' + user.email);

  var results = [];
  // Probe 0: login (status + envelope shape)
  var la = await login(args.a, args.loginPath, user);
  var lb = await login(args.b, args.loginPath, user);
  var loginDiff = (la.status !== lb.status)
    ? ['status ' + la.status + ' ≠ ' + lb.status]
    : diff(normalize(la.body), normalize(lb.body));
  results.push({ probe: 'POST ' + args.loginPath, statusA: la.status, statusB: lb.status, diffs: loginDiff });

  var authA = la.token ? { Authorization: 'Bearer ' + la.token } : null;
  // GET probes (authenticated via cookie or bearer)
  for (var i = 0; i < args.probes.length; i++) {
    var p = args.probes[i];
    var ra = await request('GET', args.a + p, null, la.cookie);
    var rb = await request('GET', args.b + p, null, lb.cookie);
    var d = (ra.status !== rb.status) ? ['status ' + ra.status + ' ≠ ' + rb.status] : diff(normalize(ra.json), normalize(rb.json));
    results.push({ probe: 'GET ' + p, statusA: ra.status, statusB: rb.status, diffs: d });
  }

  var pass = 0, fail = 0;
  results.forEach(function (r) {
    var ok = r.diffs.length === 0;
    ok ? pass++ : fail++;
    console.log((ok ? '  ✅ MATCH ' : '  ❌ DIVERGE ') + r.probe + '  (A=' + r.statusA + ' B=' + r.statusB + ')');
    if (!ok) r.diffs.slice(0, args.verbose ? 50 : 8).forEach(function (l) { console.log('       · ' + l); });
  });
  console.log('differential-compare: ' + pass + ' match, ' + fail + ' diverge of ' + results.length + ' probe(s)');
  process.exit(fail === 0 ? 0 : 1);
}

main();
