#!/usr/bin/env node
// scaffold-environment.js — v74 emits .env.example (and .env if missing)
// for backend or frontend by greppping process.env.X and
// import.meta.env.VITE_X references in source code. Eliminates RULE-B4 /
// RULE-F1 gate failures (env-example-complete) — historically broken on
// most v5x-v6x runs because the LLM grep'd only its own code and missed
// vars used by canonical templates.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--side') out.side = argv[++i]; // 'backend' | 'frontend'
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) { console.error('Usage: scaffold-environment --target DIR [--side backend|frontend]'); process.exit(1); }
  out.side = out.side || (fs.existsSync(path.join(out.target, 'app')) ? 'frontend' : 'backend');
  return out;
}

function walk(dir, out, depth) {
  depth = depth || 0;
  if (depth > 8) return;
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) return;
    var full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, depth + 1);
    else if (e.isFile() && /\.(ts|tsx|js)$/.test(e.name)) out.push(full);
  });
}

function discoverVars(target, side) {
  var files = [];
  walk(path.join(target, 'src'), files);
  walk(path.join(target, 'app'), files);
  walk(path.join(target, 'test'), files);
  // also seed-script
  if (fs.existsSync(path.join(target, 'src/database/seed.ts'))) files.push(path.join(target, 'src/database/seed.ts'));

  var found = new Set();
  var beRe = /process\.env\.([A-Z][A-Z0-9_]+)/g;
  var feRe = /import\.meta\.env\.([A-Z][A-Z0-9_]+)/g;
  for (var i = 0; i < files.length; i++) {
    try {
      var content = fs.readFileSync(files[i], 'utf-8');
      var m;
      while ((m = beRe.exec(content)) !== null) found.add(m[1]);
      while ((m = feRe.exec(content)) !== null) found.add(m[1]);
    } catch (_) { /* skip unreadable */ }
  }
  // Always include canonical baseline vars per side
  var baseline = side === 'backend' ? [
    'PORT', 'MODE', 'NODE_ENV',
    'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DATABASE',
    'DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD', 'DB_DATABASE',
    // v93: TYPEORM schema management — dev-only auto-sync + migration auto-run.
    // Pipeline runs always recreate the DB; without these the schema never
    // gets created (v92 cascade: empty migrations/, no schema, every auth call
    // 500'd, story-runner stuck at login, 0/28 stories passed).
    'TYPEORM_SYNCHRONIZE', 'MIGRATIONS_AUTO_RUN',
    'AUTH_JWT_SECRET', 'JWT_SECRET',
    'AUTH_TOKEN_COOKIE_NAME', 'AUTH_TOKEN_EXPIRE_TIME',
    'AUTH_REFRESH_TOKEN_COOKIE_NAME', 'AUTH_REFRESH_TOKEN_EXPIRE_TIME',
    'ALLOW_ORIGINS', 'FRONTEND_URL',
    'STORAGE_DRIVER', 'STORAGE_LOCAL_DIR', 'STORAGE_LOCAL_PUBLIC_URL',
  ] : [
    'VITE_API_URL', 'VITE_APP_NAME', 'VITE_DEFAULT_LOCALE',
  ];
  baseline.forEach(function (v) { found.add(v); });
  return Array.from(found).sort();
}

function defaultValue(name, side) {
  // v93: check specific patterns FIRST, then fall through to the generic
  // secret-catch-all. The original order matched /TOKEN/ before /EXPIRE_TIME/
  // → AUTH_TOKEN_EXPIRE_TIME got 'REPLACE_ME_IN_PRODUCTION' instead of '86400'
  // → @nestjs/jwt throws "Invalid JWT expiry time: undefined" on every login.
  if (/COOKIE_NAME/.test(name)) return /REFRESH/.test(name) ? 'refresh_token' : 'access_token';
  if (/EXPIRE_TIME/.test(name)) return /REFRESH/.test(name) ? '604800' : '86400';
  // Sane dev defaults; secrets are placeholder strings the operator must rotate.
  if (/PASSWORD|SECRET|KEY|TOKEN/i.test(name)) return 'REPLACE_ME_IN_PRODUCTION';
  if (name === 'PORT') return side === 'backend' ? '3000' : '5173';
  if (name === 'MODE') return 'DEV';
  if (name === 'NODE_ENV') return 'development';
  // v93: TYPEORM_SYNCHRONIZE=true is SAFE for the pipeline (DB is dropped+
  // recreated every run) and avoids the v92 cascade where empty migrations/
  // meant no schema ever got created. MIGRATIONS_AUTO_RUN=true is the second
  // layer (applies any migrations on boot).
  if (name === 'TYPEORM_SYNCHRONIZE') return 'true';
  if (name === 'MIGRATIONS_AUTO_RUN') return 'true';
  if (/POSTGRES_HOST|DB_HOST/.test(name)) return 'localhost';
  if (/POSTGRES_PORT|DB_PORT/.test(name)) return '5432';
  if (/POSTGRES_USER|DB_USERNAME/.test(name)) return 'postgres';
  if (/POSTGRES_DATABASE|DB_DATABASE/.test(name)) return 'app';
  // v93: COOKIE_NAME + EXPIRE_TIME checks moved to top of function (before
  // TOKEN catch-all) — leaving these here as dead code would be confusing.
  if (name === 'ALLOW_ORIGINS') return 'http://localhost:3000,http://localhost:5173';
  if (name === 'FRONTEND_URL') return 'http://localhost:5173';
  if (name === 'STORAGE_DRIVER') return 'local';
  if (name === 'STORAGE_LOCAL_DIR') return './uploads';
  if (name === 'STORAGE_LOCAL_PUBLIC_URL') return '/static/uploads';
  if (name === 'VITE_API_URL') return 'http://localhost:' + (process.env.BACKEND_PORT || '3000') + '/api';
  if (name === 'VITE_APP_NAME') return 'App';
  if (name === 'VITE_DEFAULT_LOCALE') return 'ko';
  return '';
}

function writeEnv(target, fileName, vars, side, opts) {
  var dst = path.join(target, fileName);
  if (fs.existsSync(dst) && fileName === '.env' && !opts.force) {
    if (opts.verbose) console.log('  skip (exists): ' + fileName);
    return false;
  }
  var lines = [
    '# Generated by scaffold-environment (' + side + ').',
    '# Edit defaults below; commit only .env.example, never .env.',
    '',
  ];
  vars.forEach(function (v) { lines.push(v + '=' + defaultValue(v, side)); });
  if (opts.dryRun) {
    console.log('  [dry] would write ' + fileName + ' (' + vars.length + ' keys)');
    return true;
  }
  fs.writeFileSync(dst, lines.join('\n') + '\n');
  console.log('  ✓ wrote ' + fileName + ' (' + vars.length + ' keys)');
  return true;
}

function main() {
  var args = parseArgs(process.argv);
  console.log('scaffold-environment: target=' + args.target + ' side=' + args.side);
  var vars = discoverVars(args.target, args.side);
  if (args.verbose) console.log('  discovered ' + vars.length + ' vars: ' + vars.slice(0, 10).join(', ') + (vars.length > 10 ? ', ...' : ''));

  writeEnv(args.target, '.env.example', vars, args.side, args);
  // Also write .env if missing so dev workflows work out of the box
  writeEnv(args.target, '.env', vars, args.side, args);

  console.log('scaffold-environment: done');
}

main();
