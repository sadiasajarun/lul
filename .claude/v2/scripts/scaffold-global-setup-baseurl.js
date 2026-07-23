#!/usr/bin/env node
// scaffold-global-setup-baseurl.js — v89
//
// Pin tests/global-setup.ts API_URL + BASE_URL to the actual backend/frontend
// ports declared in backend/.env.example and frontend/vite.config.ts.
//
// v88 evidence: backend .env.example had PORT=3000, frontend/.env had
// VITE_API_URL=http://localhost:3000/api, BUT tests/global-setup.ts:11 used
// `process.env.API_URL || 'http://localhost:3601/api'` as fallback. When
// running outside cake1 (where API_URL isn't preset), global-setup hit 3601,
// got connection refused, never seeded a storageState, → all 10 stories
// crashed at global-setup before any story executed.
//
// STRATEGY:
//   - Read backend/.env.example → grep PORT= → extract actual port
//   - Read vite.config.ts → grep `port: NNNN` → extract frontend port
//   - Walk frontend(s)/tests/global-setup.ts → replace string-literal fallbacks
//     with the discovered values
//
// Idempotent — only edits LOCALLY-LITERAL fallback strings, leaves env-var
// resolution intact.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--backend') out.backend = argv[++i];
    else if (a === '--frontend') out.frontend = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.backend || !out.frontend) {
    console.error('Usage: scaffold-global-setup-baseurl --backend <BACKEND_DIR> --frontend <FRONTEND_DIR>');
    process.exit(1);
  }
  return out;
}

function detectBackendPort(backendDir) {
  // Order: .env > .env.example > NestJS default 3000
  var candidates = [
    path.join(backendDir, '.env'),
    path.join(backendDir, '.env.example'),
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (!fs.existsSync(candidates[i])) continue;
    var content = fs.readFileSync(candidates[i], 'utf-8');
    var m = /^\s*PORT\s*=\s*(\d+)/m.exec(content);
    if (m) return parseInt(m[1], 10);
  }
  return 3000;
}

function detectFrontendPort(frontendDir) {
  // Order: vite.config.ts > package.json > default 5173
  var viteConfig = path.join(frontendDir, 'vite.config.ts');
  if (fs.existsSync(viteConfig)) {
    var content = fs.readFileSync(viteConfig, 'utf-8');
    var m = /port\s*:\s*(\d+)/.exec(content);
    if (m) return parseInt(m[1], 10);
  }
  return 5173;
}

function patchGlobalSetup(setupPath, apiUrl, baseUrl, options) {
  if (!fs.existsSync(setupPath)) return { changed: false };
  var content = fs.readFileSync(setupPath, 'utf-8');
  var changes = 0;
  // Pattern 1: API_URL = process.env.API_URL || 'http://...PORT/api'
  // Replace the literal URL with the corrected one.
  var apiLiteralRe = /(['"])http:\/\/localhost:\d+\/api\1/g;
  var updated = content.replace(apiLiteralRe, function (whole) {
    changes++;
    return "'" + apiUrl + "'";
  });
  // Pattern 2: BASE_URL = process.env.BASE_URL || 'http://...PORT'
  // Frontend root URL (without /api). Replace literal.
  var baseLiteralRe = /(['"])http:\/\/localhost:\d+\1/g;
  updated = updated.replace(baseLiteralRe, function (whole) {
    // Skip already-corrected api URLs
    if (whole.indexOf('/api') >= 0) return whole;
    changes++;
    return "'" + baseUrl + "'";
  });
  if (changes === 0) return { changed: false };
  if (!options.dryRun) fs.writeFileSync(setupPath, updated);
  return { changed: true, count: changes };
}

function main() {
  var args = parseArgs(process.argv);
  var backendPort = detectBackendPort(args.backend);
  var frontendPort = detectFrontendPort(args.frontend);
  var apiUrl = 'http://localhost:' + backendPort + '/api';
  var baseUrl = 'http://localhost:' + frontendPort;
  if (args.verbose) {
    console.log('  detected: backend=' + backendPort + ', frontend=' + frontendPort);
    console.log('  API_URL=' + apiUrl);
    console.log('  BASE_URL=' + baseUrl);
  }
  // Walk frontend/tests/ for global-setup.ts files
  var candidates = [
    path.join(args.frontend, 'tests/global-setup.ts'),
    path.join(args.frontend, 'tests/setup/global-setup.ts'),
  ];
  // Also search any *global-setup*.ts under tests/
  var testsDir = path.join(args.frontend, 'tests');
  if (fs.existsSync(testsDir)) {
    fs.readdirSync(testsDir, { withFileTypes: true }).forEach(function (e) {
      if (e.isFile() && /global-setup/i.test(e.name) && /\.ts$/.test(e.name)) {
        candidates.push(path.join(testsDir, e.name));
      }
    });
  }
  // Dedup
  candidates = Array.from(new Set(candidates));

  var fixed = 0, totalChanges = 0;
  candidates.forEach(function (c) {
    var r = patchGlobalSetup(c, apiUrl, baseUrl, args);
    if (r.changed) {
      fixed++;
      totalChanges += r.count;
      if (args.verbose) console.log('  fixed ' + path.relative(args.frontend, c) + ' (' + r.count + ' URLs)');
    }
  });
  console.log('scaffold-global-setup-baseurl: ' + fixed + ' file(s) fixed, ' + totalChanges + ' URL literal(s) updated to API=' + apiUrl + ' BASE=' + baseUrl);
}

main();
