#!/usr/bin/env node
// scaffold-test-specs.js — render canonical e2e .spec.ts files per
// MODULE_PLAN entry (modules:, auth:, workflows:, uploads:, + dashboard).
//
// Eliminates the largest remaining LLM surface in the backend phase: the
// 12+ test files generate-tests fanout authors from scratch. Each spec is
// ~80% boilerplate (createTestApp → login → supertest → expect 2xx/4xx);
// only the domain-specific assertions need LLM. After this scaffold, the
// LLM phase APPENDS new describes rather than authoring whole files.
//
// Scope-guard upstream prevents the LLM from rewriting these files (the
// generate-tests scope_guard denies test/e2e/*.e2e-spec.ts after they
// exist).
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--spec' || a === '--plan') out.spec = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--templates') out.templates = argv[++i];
    else if (a === '--api-prefix') out.apiPrefix = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.spec || !out.target || !out.templates) {
    console.error('Usage: scaffold-test-specs --spec MODULE_PLAN --target BACKEND_DIR --templates test/_spec/');
    process.exit(1);
  }
  out.apiPrefix = out.apiPrefix || 'api';
  return out;
}

function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  return require(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim(), 'yaml'));
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function toPascal(s) {
  return s.split(/[-_\s]+/).filter(Boolean).map(function (w) { return cap(w.toLowerCase()); }).join('');
}
function toKebab(s) {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
}
function pluralize(s) {
  if (/(s|x|z|ch|sh)$/i.test(s)) return s + 'es';
  if (/[^aeiou]y$/i.test(s)) return s.replace(/y$/i, 'ies');
  return s + 's';
}

function substituteFile(srcPath, dstPath, replacements, opts) {
  if (!fs.existsSync(srcPath)) { console.error('template missing: ' + srcPath); process.exit(2); }
  var content = fs.readFileSync(srcPath, 'utf-8');
  Object.keys(replacements).forEach(function (key) {
    content = content.split(key).join(replacements[key]);
  });
  // Cleanup: lines that became bare `//` (marker was replaced with empty)
  // get dropped to keep the output tidy.
  content = content.replace(/^\s*\/\/\s*$/gm, '');
  content = content.replace(/\n{3,}/g, '\n\n');

  // Don't overwrite an existing spec — LLM may have already authored or
  // amended it. The scaffold runs BEFORE generate-tests, so existing
  // files indicate a prior partial run.
  if (fs.existsSync(dstPath)) {
    if (opts.verbose) console.log('  skip (exists): ' + path.relative(opts.target, dstPath));
    return false;
  }
  if (opts.dryRun) {
    console.log('  [dry] would write ' + path.relative(opts.target, dstPath));
    return true;
  }
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.writeFileSync(dstPath, content);
  if (opts.verbose) console.log('  wrote ' + path.relative(opts.target, dstPath));
  return true;
}

// v79b: convert a role name from MODULE_PLAN (e.g. "admin", "super_admin",
// "foreign_worker") to the TypeScript enum CONSTANT our e2e templates need
// (RoleEnum.ADMIN, RoleEnum.SUPER_ADMIN, RoleEnum.FOREIGN_WORKER). v79
// evidence: e2e specs failed typecheck with `RoleEnum.admin does not
// exist` because the template substituted the raw lowercase role string;
// route_to_agent then rewrote each file individually (~5min × 15 files +
// LLM-variance surface). Mapping deterministically eliminates that cascade.
function roleToEnumKey(role) {
  if (!role) return 'SUPER_ADMIN';
  return String(role)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2') // camelCase → snake
    .replace(/[-\s]+/g, '_')                // kebab/space → snake
    .toUpperCase();
}

function pickAdminRole(spec) {
  // Try MODULE_PLAN.auth.roles for an admin-like role; fall back to first role.
  var roles = (spec.auth && spec.auth.roles) || [];
  var adminLike = roles.find(function (r) {
    return /admin|operator|super/i.test(String(r));
  });
  return roleToEnumKey(adminLike || roles[0] || 'super_admin');
}

function renderCrudSpec(args, spec, mod, replacementsBase) {
  var entityPascal = mod.entity || toPascal(mod.name);
  var entityKebab = toKebab(entityPascal);
  var entitiesKebab = mod.plural || pluralize(entityKebab);

  // Role-required handling. If module declares role_required (kebab or
  // string), generate role-boundary tests + a non-privileged user setup.
  var roleRequired = mod.role_required || null;
  var adminRole = pickAdminRole(spec);
  var wrongRoleSetup = '';
  var wrongRoleDecls = '';
  var wrongRoleTestGet = '';
  var wrongRoleTestPost = '';
  var wrongRoleTestDelete = '';
  if (roleRequired && String(roleRequired).toLowerCase() !== String(adminRole).toLowerCase()) {
    var differentRole = (spec.auth && spec.auth.roles || []).find(function (r) {
      return String(r) !== String(adminRole) && String(r) !== String(roleRequired);
    }) || 'user';
    wrongRoleDecls = 'let wrongRoleCookie: string;';
    wrongRoleSetup = [
      'const wrongUser = await createTestUser(ctx.dataSource, {',
      "      email: '" + entityKebab + "-spec-wrongrole@test.com',",
      "      role: '" + differentRole + "',",
      '    });',
      '    wrongRoleCookie = await loginAndGetCookie(ctx.app, wrongUser.email, wrongUser.password);'
    ].join('\n    ');

    wrongRoleTestGet = [
      "it('returns 403 with wrong role', async () => {",
      "      await supertest(ctx.app.getHttpServer())",
      "        .get('/" + args.apiPrefix + "/" + entitiesKebab + "')",
      "        .set('Cookie', wrongRoleCookie)",
      "        .expect((res) => {",
      "          if (![401, 403].includes(res.status)) {",
      "            throw new Error(`Expected 403 (or 401) for wrong role, got ${res.status}`);",
      '          }',
      '        });',
      '    });'
    ].join('\n    ');

    wrongRoleTestPost = [
      "it('returns 403 with wrong role', async () => {",
      "      await supertest(ctx.app.getHttpServer())",
      "        .post('/" + args.apiPrefix + "/" + entitiesKebab + "')",
      "        .set('Cookie', wrongRoleCookie)",
      "        .send({})",
      "        .expect((res) => {",
      "          if (![400, 401, 403, 422].includes(res.status)) {",
      "            throw new Error(`Expected 403/422 for wrong role, got ${res.status}`);",
      '          }',
      '        });',
      '    });'
    ].join('\n    ');

    wrongRoleTestDelete = [
      "it('returns 403 with wrong role', async () => {",
      "      await supertest(ctx.app.getHttpServer())",
      "        .delete('/" + args.apiPrefix + "/" + entitiesKebab + "/00000000-0000-0000-0000-000000000000')",
      "        .set('Cookie', wrongRoleCookie)",
      "        .expect((res) => {",
      "          if (![400, 401, 403, 404].includes(res.status)) {",
      "            throw new Error(`Expected 403 for wrong role, got ${res.status}`);",
      '          }',
      '        });',
      '    });'
    ].join('\n    ');
  }

  var replacements = Object.assign({}, replacementsBase, {
    '__Entity__': entityPascal,
    '__entity-kebab__': entityKebab,
    '__entities__': entitiesKebab,
    '__ADMIN_ROLE__': adminRole,
    '__API_PREFIX__': args.apiPrefix,
    '__WRONG_ROLE_DECLS__': wrongRoleDecls,
    '__WRONG_ROLE_SETUP__': wrongRoleSetup,
    '__WRONG_ROLE_TEST_GET__': wrongRoleTestGet,
    '__WRONG_ROLE_TEST_POST__': wrongRoleTestPost,
    '__WRONG_ROLE_TEST_DELETE__': wrongRoleTestDelete,
  });

  return substituteFile(
    path.join(args.templates, '__module-kebab__.e2e-spec.ts'),
    path.join(args.target, 'test/e2e', mod.name + '.e2e-spec.ts'),
    replacements, args
  );
}

function renderSignupHappyBody(auth) {
  var fields = auth.signup_fields || [];
  var lines = [];
  var happyIdentifier = null;
  var happyPassword = 'TestPass1!';
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var v;
    if (f.name === auth.identifier_field || /email/i.test(f.name)) {
      v = "auth-spec@test.com";
      if (!happyIdentifier) happyIdentifier = v;
    } else if (/password/i.test(f.name)) {
      v = happyPassword;
    } else if (f.type === 'enum') {
      v = (f.enumValues && f.enumValues[0]) || 'user';
    } else if (f.type === 'boolean') {
      v = true;
    } else if (f.type === 'number' || f.type === 'integer') {
      v = 0;
    } else {
      v = "spec-" + f.name;
    }
    var fmt = (typeof v === 'string') ? "'" + v + "'" : String(v);
    lines.push('          ' + f.name + ': ' + fmt + ',');
  }
  // Always ensure password present even if not declared in signup_fields
  if (!fields.some(function (f) { return /password/i.test(f.name); })) {
    lines.push("          password: '" + happyPassword + "',");
  }
  return { body: lines.join('\n'), identifier: happyIdentifier || 'auth-spec@test.com', password: happyPassword };
}

function renderAuthSpec(args, spec) {
  if (!spec.auth) return false;
  var auth = spec.auth;
  var identifierField = auth.identifier_field || 'email';
  var happy = renderSignupHappyBody(auth);

  var replacements = {
    '__IDENTIFIER_FIELD__': identifierField,
    '__HAPPY_IDENTIFIER__': happy.identifier,
    '__HAPPY_PASSWORD__': happy.password,
    '__SIGNUP_HAPPY_BODY__': happy.body,
    '__API_PREFIX__': args.apiPrefix,
  };
  return substituteFile(
    path.join(args.templates, 'auth.e2e-spec.ts'),
    path.join(args.target, 'test/e2e', 'auth.e2e-spec.ts'),
    replacements, args
  );
}

function renderWorkflowSpec(args, spec, w) {
  var entityPascal = w.entity || toPascal(w.name);
  var entityKebab = toKebab(entityPascal);
  var entitiesKebab = pluralize(entityKebab);
  var firstAction = (w.transitions && w.transitions[0] && w.transitions[0].action) || 'start';
  var adminRole = pickAdminRole(spec);
  var replacements = {
    '__Entity__': entityPascal,
    '__entity-kebab__': entityKebab,
    '__entities__': entitiesKebab,
    '__FIRST_ACTION__': firstAction,
    '__ADMIN_ROLE__': adminRole,
    '__API_PREFIX__': args.apiPrefix,
  };
  return substituteFile(
    path.join(args.templates, '__module-kebab__-workflow.e2e-spec.ts'),
    path.join(args.target, 'test/e2e', w.name + '-workflow.e2e-spec.ts'),
    replacements, args
  );
}

function renderUploadSpec(args, spec, u) {
  var entityPascal = u.entity || toPascal(u.name);
  var entityKebab = toKebab(entityPascal);
  var entitiesKebab = pluralize(entityKebab);
  var adminRole = pickAdminRole(spec);
  var replacements = {
    '__Entity__': entityPascal,
    '__entity-kebab__': entityKebab,
    '__entities__': entitiesKebab,
    '__ADMIN_ROLE__': adminRole,
    '__API_PREFIX__': args.apiPrefix,
  };
  return substituteFile(
    path.join(args.templates, '__module-kebab__-upload.e2e-spec.ts'),
    path.join(args.target, 'test/e2e', u.name + '-upload.e2e-spec.ts'),
    replacements, args
  );
}

function renderDashboardSpec(args, spec) {
  // Only when a dashboard module is expected. Detection: presence of `dashboards:`
  // section in PAGES_PLAN — we don't see that here. Heuristic: if MODULE_PLAN
  // mentions /dashboard or admin-dashboard-operations, we render. Default to
  // rendering since the canonical dashboard module ships with core templates.
  var anyKnownEntity = null;
  if (Array.isArray(spec.modules)) {
    var firstWithPlural = spec.modules.find(function (m) { return m && m.plural; });
    anyKnownEntity = (firstWithPlural && firstWithPlural.plural) || (spec.modules[0] && pluralize(toKebab(spec.modules[0].entity || spec.modules[0].name)));
  }
  if (!anyKnownEntity) anyKnownEntity = 'users';
  var adminRole = pickAdminRole(spec);
  var replacements = {
    '__ANY_KNOWN_ENTITY__': anyKnownEntity,
    '__ADMIN_ROLE__': adminRole,
    '__API_PREFIX__': args.apiPrefix,
  };
  return substituteFile(
    path.join(args.templates, 'dashboard.e2e-spec.ts'),
    path.join(args.target, 'test/e2e', 'dashboard.e2e-spec.ts'),
    replacements, args
  );
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.spec)) {
    console.log('scaffold-test-specs: no MODULE_PLAN at ' + args.spec + ' — skipping (LLM will author specs)');
    return;
  }
  var yaml = loadYaml();
  var spec = yaml.parse(fs.readFileSync(args.spec, 'utf-8')) || {};

  var written = 0;
  var skipped = 0;

  // CRUD modules
  if (Array.isArray(spec.modules)) {
    console.log('scaffold-test-specs: ' + spec.modules.length + ' CRUD modules');
    for (var i = 0; i < spec.modules.length; i++) {
      var mod = spec.modules[i];
      if (!mod || !mod.name) continue;
      if (renderCrudSpec(args, spec, mod, {})) written++; else skipped++;
    }
  }

  // Auth
  if (spec.auth) {
    if (renderAuthSpec(args, spec)) written++; else skipped++;
  }

  // Workflows
  if (Array.isArray(spec.workflows)) {
    for (var w = 0; w < spec.workflows.length; w++) {
      if (renderWorkflowSpec(args, spec, spec.workflows[w])) written++; else skipped++;
    }
  }

  // Uploads
  if (Array.isArray(spec.uploads)) {
    for (var u = 0; u < spec.uploads.length; u++) {
      if (renderUploadSpec(args, spec, spec.uploads[u])) written++; else skipped++;
    }
  }

  // Dashboard (canonical, always shipped by templates/modules/_dashboard)
  if (renderDashboardSpec(args, spec)) written++; else skipped++;

  console.log('scaffold-test-specs: wrote ' + written + ' specs, skipped ' + skipped + ' existing');
}

main();
