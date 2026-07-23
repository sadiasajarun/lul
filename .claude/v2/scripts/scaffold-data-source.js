#!/usr/bin/env node
// scaffold-data-source.js — v90
//
// Emit canonical src/database/data-source.ts that:
//   - Reads connection from process.env (DATABASE_URL or DB_HOST/PORT/etc.)
//   - Auto-discovers entities via glob (src/modules/**/*.entity.ts)
//   - Auto-discovers migrations via glob (src/database/migrations/*.ts)
//   - synchronize: false (migrations control schema)
//   - migrationsRun: derives from MIGRATIONS_AUTO_RUN env var (default true in dev,
//     false in production)
//
// THE GAP: the LLM-implement step often writes app.module.ts with inline
// TypeOrmModule.forRoot({...}) instead of a separate, reusable DataSource.
// Without data-source.ts, `typeorm migration:run` has no entry point and
// production deploys must rely on `synchronize: true` (auto-create schema
// from entities) — which corrupts existing data.
//
// SCOPE:
//   - Reads env var names from .env.example (best-effort autodetection)
//   - Falls back to NestJS-standard names (DB_HOST, DB_PORT, DB_USERNAME,
//     DB_PASSWORD, DB_NAME) or DATABASE_URL
//
// Idempotent: skips if data-source.ts already exists (project-specific
// overrides take precedence). Use --force to overwrite.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--force') out.force = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-data-source --target <BACKEND_DIR> [--force] [--verbose]');
    process.exit(1);
  }
  return out;
}

function detectEnvVars(target) {
  // Read .env.example if present; infer DB env var names. Common prefixes:
  //   DB_*, DATABASE_*, POSTGRES_*, PG_*
  var envExample = path.join(target, '.env.example');
  if (!fs.existsSync(envExample)) {
    return null;
  }
  var content = fs.readFileSync(envExample, 'utf-8');
  var lines = content.split('\n');
  var keys = lines.map(function (l) {
    var m = /^([A-Z][A-Z0-9_]*)\s*=/.exec(l);
    return m ? m[1] : null;
  }).filter(Boolean);
  // Find candidate keys. Use _SUFFIX$ word-boundary patterns to avoid
  // picking up substrings (e.g. DB_USERNAME ends in NAME but isn't a db name).
  var prefixPat = /^(DB|DATABASE|POSTGRES|PG)_/;
  var pickHost = keys.find(function (k) { return prefixPat.test(k) && /_HOST$/.test(k); });
  var pickPort = keys.find(function (k) { return prefixPat.test(k) && /_PORT$/.test(k); });
  var pickUser = keys.find(function (k) { return prefixPat.test(k) && /_(USERNAME|USER)$/.test(k); });
  var pickPass = keys.find(function (k) { return prefixPat.test(k) && /_PASSWORD$/.test(k); });
  var pickDb = keys.find(function (k) { return prefixPat.test(k) && /_(DATABASE|NAME|DB)$/.test(k); });
  var pickUrl = keys.find(function (k) { return /^(DATABASE|DB)_URL$/.test(k); });
  return { host: pickHost, port: pickPort, user: pickUser, pass: pickPass, db: pickDb, url: pickUrl };
}

function renderDataSource(envVars) {
  // v114: read BOTH common families (POSTGRES_* first, DB_* fallback) for every
  // field. Two recurring v107-class bugs motivated this:
  //   1. .env.example often contains BOTH DB_* AND POSTGRES_* keys, so the
  //      first-match detection picked DB_* while app.module.ts + the actual .env
  //      use POSTGRES_*. data-source.ts then fell back to defaults (user=postgres,
  //      db=app) → connected to the wrong DB → `migration:generate` failed →
  //      empty stub migration → database P0 (migration_safety 0.3).
  //   2. Reading a single family means a one-line env rename anywhere desyncs the
  //      CLI/migration path from the runtime path.
  // A dual-family precedence chain resilient to whichever family the project
  // settled on. Because type === 'postgres', POSTGRES_* ALWAYS comes first — this
  // matches the app.module.ts forRootAsync factory, so the CLI/migration path and
  // the runtime path resolve the SAME database. The detected primary var is only
  // appended (at the END) when it's a genuinely novel name (e.g. a PG_* custom
  // prefix) not already covered by the known families — it never reorders them,
  // so a stray DB_*=... value from .env.example can't override POSTGRES_*.
  function chain(fixed, primaryVar) {
    var seen = {};
    var parts = [];
    fixed.concat(primaryVar ? [primaryVar] : []).forEach(function (v) {
      if (v && !seen[v]) { seen[v] = true; parts.push('process.env.' + v); }
    });
    return parts.join(' || ');
  }
  var hostExpr = chain(['POSTGRES_HOST', 'DB_HOST'], envVars && envVars.host) + " || 'localhost'";
  var portExpr = 'parseInt(' + chain(['POSTGRES_PORT', 'DB_PORT'], envVars && envVars.port) + " || '5432', 10)";
  var userExpr = chain(['POSTGRES_USER', 'DB_USERNAME', 'DB_USER'], envVars && envVars.user) + " || 'postgres'";
  var passExpr = chain(['POSTGRES_PASSWORD', 'DB_PASSWORD'], envVars && envVars.pass) + " || 'postgres'";
  var dbExpr = chain(['POSTGRES_DATABASE', 'DB_DATABASE', 'DB_NAME'], envVars && envVars.db) + " || 'app'";
  var urlExpr = chain(['DATABASE_URL', 'DB_URL'], envVars && envVars.url);

  return [
    "// Generated by scaffold-data-source.",
    "//",
    "// Canonical TypeORM DataSource. Used by:",
    "//   - npm scripts: `typeorm migration:run`, `migration:generate`",
    "//   - seed.ts standalone connection (it builds its own; this is the CLI entry)",
    "//",
    "// Connection config: DATABASE_URL takes precedence; otherwise individual",
    "// vars are read from process.env with POSTGRES_* preferred over DB_* so the",
    "// CLI/migration path matches the app.module.ts forRootAsync runtime config.",
    "//",
    "// NOTE: exactly ONE DataSource instance is exported (AppDataSource). The",
    "// TypeORM CLI rejects a file that exports more than one DataSource, so do NOT",
    "// add `export default` here.",
    "import 'reflect-metadata';",
    "import * as path from 'path';",
    "import { DataSource, DataSourceOptions } from 'typeorm';",
    "import { config as dotenv } from 'dotenv';",
    "",
    "dotenv();",
    "",
    "const SRC = path.resolve(__dirname, '..');",
    "",
    "function buildOptions(): DataSourceOptions {",
    "  const url = " + urlExpr + ";",
    "  const common = {",
    "    type: 'postgres' as const,",
    "    entities: [path.join(SRC, 'modules/**/*.entity.{ts,js}')],",
    "    migrations: [path.join(SRC, 'database/migrations/*.{ts,js}')],",
    "    synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true',",
    "    migrationsRun: process.env.MIGRATIONS_AUTO_RUN !== 'false',",
    "    logging: process.env.TYPEORM_LOGGING === 'true',",
    "  };",
    "  if (url) {",
    "    return { ...common, url };",
    "  }",
    "  return {",
    "    ...common,",
    "    host: " + hostExpr + ",",
    "    port: " + portExpr + ",",
    "    username: " + userExpr + ",",
    "    password: " + passExpr + ",",
    "    database: " + dbExpr + ",",
    "  };",
    "}",
    "",
    "export const dataSourceOptions: DataSourceOptions = buildOptions();",
    "export const AppDataSource = new DataSource(dataSourceOptions);",
    "",
  ].join('\n');
}

function main() {
  var args = parseArgs(process.argv);
  // Only run for projects that already have a backend src/ layout — don't
  // create one from scratch (other scaffolds bootstrap that).
  var srcDir = path.join(args.target, 'src');
  var dst = path.join(srcDir, 'database/data-source.ts');
  if (fs.existsSync(dst) && !args.force) {
    console.log('scaffold-data-source: data-source.ts exists (use --force to overwrite) — skipping');
    return;
  }
  var envVars = detectEnvVars(args.target);
  if (args.verbose && envVars) {
    console.log('  detected env vars: ' + Object.keys(envVars).filter(function (k) { return envVars[k]; }).map(function (k) { return k + '=' + envVars[k]; }).join(', '));
  }
  var content = renderDataSource(envVars);
  if (args.dryRun) {
    console.log('  [dry] would write ' + path.relative(args.target, dst) + ' (' + content.split('\n').length + ' lines)');
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, content);
    console.log('scaffold-data-source: wrote ' + path.relative(args.target, dst));
  }
}

main();
