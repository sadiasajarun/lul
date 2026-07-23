#!/usr/bin/env node
// scaffold-seed-script.js — generates backend/src/database/seed.ts from
// MODULE_PLAN.auth (user_entity + identifier_field + password_field) and
// registers `npm run seed` in backend/package.json.
//
// Fixes the v66 root cause: RULE-B3 mandates a seed script but the LLM
// didn't write one, so _fixtures.yaml users were never inserted into the
// DB, causing every authenticated test to fail with 401.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--spec') out.spec = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--templates') out.templates = argv[++i];
    else if (a === '--project') out.project = argv[++i]; // v93: project name → seed fixture path
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.spec || !out.target || !out.templates) {
    console.error('Usage: scaffold-seed-script --spec MODULE_PLAN --target BACKEND_DIR --templates _seed/ [--project NAME]');
    process.exit(1);
  }
  return out;
}
function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  return require(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim(), 'yaml'));
}

function substituteFile(srcPath, dstPath, replacements, opts) {
  if (!fs.existsSync(srcPath)) { console.error('template missing: ' + srcPath); process.exit(2); }
  var content = fs.readFileSync(srcPath, 'utf-8');
  Object.keys(replacements).forEach(function (key) {
    content = content.split(key).join(replacements[key]);
  });
  if (opts.dryRun) {
    console.log('  [dry] would write ' + path.relative(opts.target, dstPath));
    return;
  }
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.writeFileSync(dstPath, content);
}

function registerSeedScript(target, opts) {
  var pkgPath = path.join(target, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.log('  ⚠  package.json missing — skipping npm run seed registration');
    return;
  }
  var pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkg.scripts = pkg.scripts || {};
  if (pkg.scripts.seed) {
    if (opts.verbose) console.log('  npm run seed already registered');
    return;
  }
  pkg.scripts.seed = 'ts-node -r tsconfig-paths/register src/database/seed.ts';
  // Best-effort: ensure runtime deps the seed script needs are declared.
  // v71 fix: `tsconfig-paths` was missing — the npm script invokes
  //   ts-node -r tsconfig-paths/register src/database/seed.ts
  // so without this dep, `npm run seed` errors with
  //   "Cannot find module 'tsconfig-paths/register'", DB never gets
  // seeded, all _fixtures.yaml logins return 401, every browser story
  // fails at auth. v69 happened to work because the LLM-implement
  // phase added tsconfig-paths transitively. v70's scaffold-complete
  // short-circuit suppressed that side-effect → regression. Explicit
  // declaration is the right fix.
  pkg.dependencies = pkg.dependencies || {};
  // v71: ts-node added explicitly. The npm script invokes the `ts-node`
  // binary which currently resolves transitively via ts-node-dev (in
  // canonical devDeps). Transitive bin-resolution works under hoisted
  // npm but breaks under pnpm, strict modes, or future npm versions.
  // Explicit declaration is durable.
  ['bcrypt', 'dotenv', 'yaml', 'tsconfig-paths', 'ts-node'].forEach(function (d) {
    if (!pkg.dependencies[d] && !(pkg.devDependencies || {})[d]) {
      // record as required — npm install fires after scaffold
      pkg.dependencies[d] = '*';
    }
  });
  pkg.devDependencies = pkg.devDependencies || {};
  if (!pkg.devDependencies['@types/bcrypt'] && !(pkg.dependencies['@types/bcrypt'])) {
    pkg.devDependencies['@types/bcrypt'] = '*';
  }

  if (opts.dryRun) { console.log('  [dry] would update package.json'); return; }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('  ↻ registered npm run seed + ensured bcrypt/dotenv/yaml/tsconfig-paths deps');
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.spec)) {
    console.log('scaffold-seed-script: no MODULE_PLAN.yaml — skipping (LLM should produce seed manually)');
    return;
  }
  var yaml = loadYaml();
  var spec = yaml.parse(fs.readFileSync(args.spec, 'utf-8'));
  var auth = spec && spec.auth;
  if (!auth || !auth.user_entity) {
    console.log('scaffold-seed-script: no auth: section in MODULE_PLAN — skipping (project does not authenticate)');
    return;
  }

  var userEntity = auth.user_entity;
  var identifierField = auth.identifier_field || 'email';
  var passwordField = auth.password_field || 'passwordHash';

  console.log('scaffold-seed-script: entity=' + userEntity + ', identifier=' + identifierField + ', password_field=' + passwordField);

  // v93: substitute project name into the seed template's fixture path lookup.
  // Without this, the template's '__PROJECT_NAME__' marker stays unsubstituted
  // and the template's fallback path-discovery runs at runtime instead.
  // Both modes work, but substitution is cleaner + saves a directory scan.
  var projectName = args.project || (function detectProjectName() {
    // Best-effort: pick the first non-system folder under sibling .claude-project/
    var fs2 = require('fs');
    var candidates = [
      path.resolve(args.target, '../.claude-project'),
      path.resolve(args.target, '../../.claude-project'),
    ];
    var SYSTEM = { docs: 1, memory: 1, design: 1, status: 1, archive: 1, episodes: 1 };
    for (var i = 0; i < candidates.length; i++) {
      if (!fs2.existsSync(candidates[i])) continue;
      try {
        var dirs = fs2.readdirSync(candidates[i], { withFileTypes: true })
          .filter(function (d) { return d.isDirectory() && !SYSTEM[d.name]; })
          .map(function (d) { return d.name; });
        if (dirs.length > 0) return dirs[0];
      } catch (_) { /* ignore */ }
    }
    return '';
  })();

  var replacements = {
    '__USER_ENTITY__': userEntity,
    '__IDENTIFIER_FIELD__': identifierField,
    '__PASSWORD_FIELD__': passwordField,
    '__PROJECT_NAME__': projectName,
  };

  var dstPath = path.join(args.target, 'src/database/seed.ts');
  if (fs.existsSync(dstPath)) {
    console.log('  ⚠  src/database/seed.ts already exists — leaving as-is (LLM-authored or prior scaffold)');
  } else {
    substituteFile(path.join(args.templates, 'seed.ts'), dstPath, replacements, args);
    console.log('  ✓ wrote src/database/seed.ts');
  }

  registerSeedScript(args.target, args);
  console.log('scaffold-seed-script: done');
}

main();
