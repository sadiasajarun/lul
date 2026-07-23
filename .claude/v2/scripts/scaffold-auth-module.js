#!/usr/bin/env node
//
// scaffold-auth-module.js — generate the canonical auth module from a
// SPEC.yaml `auth:` section. Replaces the LLM-authored auth flow that
// drifted in every prior run.
//
// Usage: scaffold-auth-module --spec SPEC.yaml --target BACKEND_DIR --templates _auth/
//

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
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.spec || !out.target || !out.templates) {
    console.error('Usage: scaffold-auth-module --spec SPEC.yaml --target BACKEND_DIR --templates _auth/');
    process.exit(1);
  }
  return out;
}

function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  var globalPath = require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim();
  return require(path.join(globalPath, 'yaml'));
}

function toPascal(s) {
  return s.split(/[-_\s]+/).filter(Boolean)
    .map(function (w) { return w[0].toUpperCase() + w.slice(1).toLowerCase(); }).join('');
}

function discoverUserEntityImport(spec, targetBackend) {
  // SPEC may say `user_entity: User` and `user_entity_module: users`.
  // Find the actual entity file path under src/modules/*. Prefer the
  // database-phase layout (plural/entities/singular.entity.ts).
  var userEntityClass = (spec.auth && spec.auth.user_entity) || 'User';
  var userKebab = (spec.auth && spec.auth.user_entity_module) || 'user';
  var candidates = [
    path.join(targetBackend, 'src/modules', userKebab + 's/entities/' + userKebab + '.entity.ts'),
    path.join(targetBackend, 'src/modules/users/entities/user.entity.ts'),
    path.join(targetBackend, 'src/modules', userKebab + '/entities/' + userKebab + '.entity.ts'),
    path.join(targetBackend, 'src/modules', userKebab + '/' + userKebab + '.entity.ts'),
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) {
      // Compute import path relative to src/modules/auth/auth.service.ts
      var rel = path.relative(path.join(targetBackend, 'src/modules/auth'), candidates[i]).replace(/\.ts$/, '');
      return { class: userEntityClass, importPath: rel };
    }
  }
  // Fall through — emit a TODO comment; the module will fail typecheck but
  // the error will be clear.
  return { class: userEntityClass, importPath: '../users/entities/user.entity', missing: true };
}

function renderValidatorImports(fields, includePassword) {
  var validators = new Set();
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    for (var j = 0; j < (f.validators || []).length; j++) {
      var v = f.validators[j];
      validators.add(typeof v === 'string' ? v.split(':')[0] : v.name);
    }
  }
  if (includePassword) {
    validators.add('IsString');
    validators.add('IsNotEmpty');
    validators.add('MinLength');
  }
  if (validators.size === 0) return '';
  return "import { " + Array.from(validators).sort().join(', ') + " } from 'class-validator';";
}

function renderEnumImports(fields) {
  var seen = {};
  var lines = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    if (f.type === 'enum' && f.enumName && f.enumImport && !seen[f.enumName]) {
      seen[f.enumName] = true;
      lines.push("import { " + f.enumName + " } from '" + f.enumImport + "';");
    }
  }
  return lines.join('\n');
}

function renderField(f) {
  var lines = [];
  var apiProps = [];
  if (f.swagger && f.swagger.description) apiProps.push("description: '" + f.swagger.description.replace(/'/g, "\\'") + "'");
  if (f.swagger && f.swagger.example !== undefined) {
    var ex = typeof f.swagger.example === 'string' ? "'" + f.swagger.example + "'" : f.swagger.example;
    apiProps.push('example: ' + ex);
  }
  if (f.type === 'enum') apiProps.push('enum: ' + f.enumName);
  if (f.nullable) apiProps.push('required: false');
  lines.push('  @ApiProperty(' + (apiProps.length ? '{ ' + apiProps.join(', ') + ' }' : '') + ')');
  for (var i = 0; i < (f.validators || []).length; i++) {
    var v = f.validators[i];
    var name = typeof v === 'string' ? v.split(':')[0] : v.name;
    var arg = '';
    if (typeof v === 'string') {
      var idx = v.indexOf(':');
      arg = idx === -1 ? '' : v.slice(idx + 1);
    } else if (v.arg !== undefined) {
      arg = typeof v.arg === 'string' ? "'" + v.arg.replace(/'/g, "\\'") + "'" : String(v.arg);
    }
    lines.push('  @' + name + '(' + arg + ')');
  }
  var tsType = f.type === 'enum' ? f.enumName : f.type === 'Date' ? 'Date' : f.type;
  var optional = f.nullable ? '?' : '!';
  lines.push('  ' + f.name + optional + ': ' + tsType + ';');
  lines.push('');
  return lines.join('\n');
}

function substituteFile(srcPath, dstPath, replacements, opts) {
  var content = fs.readFileSync(srcPath, 'utf-8');

  // STEP 1: marker-line substitutions (`// __FOO__`) replace the ENTIRE line
  // including the `//` prefix. Must happen BEFORE plain identifier substitution
  // otherwise the placeholder gets replaced in-place leaving the `//` behind.
  //
  // Pass a function as the replacement so $, $', $`, $&, $n are NOT
  // interpreted as backreferences (DTO field values can contain `$'` from
  // regex patterns like /^010-\d{4}-\d{4}$/, which would otherwise splat
  // the post-match input into the output and corrupt the file).
  Object.keys(replacements).forEach(function (key) {
    var markerLine = new RegExp('^\\s*// ' + key.replace(/[.*+?^${}()|[\\\\]\\\\]/g, '\\$&') + '\\s*$', 'gm');
    var value = replacements[key];
    content = content.replace(markerLine, function () { return value; });
  });

  // STEP 2: plain identifier replacement for any remaining placeholders
  // (e.g. inline `__Entity__` or `__entity__` usages outside marker lines).
  Object.keys(replacements).forEach(function (key) {
    content = content.split(key).join(replacements[key]);
  });

  if (opts.dryRun) {
    console.log('  [dry] would write ' + path.relative(opts.target, dstPath) + ' (' + content.length + ' bytes)');
    return;
  }
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.writeFileSync(dstPath, content);
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.spec)) { console.error('SPEC not found: ' + args.spec); process.exit(1); }
  if (!fs.existsSync(args.templates)) { console.error('templates dir missing: ' + args.templates); process.exit(2); }
  var yaml = loadYaml();
  var spec = yaml.parse(fs.readFileSync(args.spec, 'utf-8'));
  if (!spec || !spec.auth) {
    console.log('scaffold-auth-module: SPEC has no `auth:` section — skipping');
    return;
  }
  var auth = spec.auth;

  var identifierField = auth.identifier_field || 'email';
  var passwordField = auth.password_field || 'passwordHash';
  var signupFields = auth.signup_fields || [
    { name: 'email', type: 'string', validators: ['IsEmail', 'IsNotEmpty'] },
    { name: 'name', type: 'string', nullable: true, validators: ['IsOptional', 'IsString'] },
  ];

  var userInfo = discoverUserEntityImport(spec, args.target);
  var userEntityImport = "import { " + userInfo.class + " } from '" + userInfo.importPath + "';";
  // Standard NestJS pattern: put @InjectRepository directly on the property.
  // Avoids the prior "overload" hack which produced an optional param BEFORE
  // a required param (TS1016 "required parameter cannot follow an optional").
  var userRepoInject =
    '@InjectRepository(' + userInfo.class + ')\n' +
    '    private readonly userRepo: Repository<' + userInfo.class + '>,';

  // Identifier field decl in login DTO
  var idValidators = identifierField === 'email'
    ? ['IsEmail', 'IsNotEmpty']
    : ['IsString', 'IsNotEmpty'];
  var idDecl = '  @ApiProperty({ description: \'Login ' + identifierField + '\', example: \'user@example.com\' })\n' +
    idValidators.map(function (v) { return '  @' + v + '()'; }).join('\n') + '\n' +
    '  ' + identifierField + '!: string;\n';

  var loginValidatorImports = "import { " + idValidators.concat(['IsString']).sort().filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ') + " } from 'class-validator';";

  // Signup DTO fields. Ensure required canonical fields are always present
  // (template no longer hard-codes them so MODULE_PLAN can override, but
  // missing them creates contract mismatches LLM-generated stories hit).
  // v106 evidence: runtime probe of v105 backend showed POST /auth/signup
  // returned 400 with `property passwordConfirm should not exist` because
  // the LLM signup form sends passwordConfirm but DTO never declared it.
  var hasPassword = signupFields.some(function (f) { return f.name === 'password'; });
  if (!hasPassword) {
    signupFields.push({
      name: 'password',
      type: 'string',
      validators: ['IsString', 'IsNotEmpty', 'MinLength:8'],
      swagger: { description: 'Password (min 8 chars)', example: 'CorrectHorseBatteryStaple1!' },
    });
  }
  // v106: always accept passwordConfirm (canonical signup form sends it).
  // Optional in DTO so backend doesn't require it, but @IsOptional() means
  // it won't be rejected by whitelist validation pipe.
  var hasPasswordConfirm = signupFields.some(function (f) { return f.name === 'passwordConfirm'; });
  if (!hasPasswordConfirm) {
    signupFields.push({
      name: 'passwordConfirm',
      type: 'string',
      nullable: true,
      validators: ['IsOptional', 'IsString'],
      swagger: { description: 'Password confirmation (must match password)', example: 'CorrectHorseBatteryStaple1!' },
    });
  }
  // v106: if role is in signupFields, force it OPTIONAL — self-signup
  // shouldn't require role (defaults to 0=foreign_worker server-side).
  // Without this, signup stories that send {email,password,name,phone}
  // fail validation with "role must be a number".
  signupFields.forEach(function (f) {
    if (f.name === 'role') {
      f.nullable = true;
      f.validators = (f.validators || []).filter(function (v) {
        var n = typeof v === 'string' ? v.split(':')[0] : v.name;
        return n !== 'IsNotEmpty';
      });
      if (!f.validators.some(function (v) {
        var n = typeof v === 'string' ? v.split(':')[0] : v.name;
        return n === 'IsOptional';
      })) {
        f.validators.unshift('IsOptional');
      }
    }
  });
  var signupFieldBlock = signupFields.map(renderField).join('\n');
  var signupValidatorImports = renderValidatorImports(signupFields, /* includePassword */ true);
  var enumImports = renderEnumImports(signupFields);

  // Signup create payload — auth.service.ts substitutes fields into the entity-create object
  var signupCreateLines = ['    const payload: any = {'];
  signupCreateLines.push("      " + identifierField + ": dto." + identifierField + ",");
  signupCreateLines.push("      " + passwordField + ": passwordHash,");
  for (var i = 0; i < signupFields.length; i++) {
    var f = signupFields[i];
    if (f.name === identifierField) continue;
    if (f.name === 'password') continue;
    // v107: skip passwordConfirm — client-side validation field only.
    if (f.name === 'passwordConfirm') continue;
    // v107: skip the password column itself (e.g. passwordHash) — it's
    // already hardcoded above with the bcrypt hash. v106 evidence: when
    // MODULE_PLAN had passwordHash in signup_fields, the loop pushed it
    // AGAIN producing `passwordHash: passwordHash,` followed by
    // `passwordHash: dto.passwordHash,` — TS1117 duplicate property error
    // that took down test-api pre-check in 1.9s.
    if (f.name === passwordField) continue;
    signupCreateLines.push("      " + f.name + ": dto." + f.name + ",");
  }
  signupCreateLines.push('    };');
  var signupCreate = signupCreateLines.join('\n');

  var roleEnumImport = '';
  if ((auth.roles && auth.roles.length) || signupFields.some(function (f) { return f.type === 'enum' && f.enumName === 'RoleEnum'; })) {
    roleEnumImport = "import { RoleEnum } from '../../common/enums/role.enum';";
  }

  var commonReplacements = {
    '__USER_ENTITY__': userInfo.class,
    '__USER_ENTITY_IMPORT__': userEntityImport,
    '__USER_REPO_INJECT__': userRepoInject,
    '__IDENTIFIER_FIELD__': identifierField,
    '__PASSWORD_FIELD__': passwordField,
    '__SIGNUP_CREATE__': signupCreate,
    '__IDENTIFIER_FIELD_DECL__': idDecl,
    '__VALIDATOR_IMPORTS__': '',
    '__SIGNUP_FIELDS__': signupFieldBlock,
    '__ENUM_IMPORTS__': enumImports,
    '__ROLE_ENUM_IMPORT__': roleEnumImport,
  };

  var moduleDir = path.join(args.target, 'src/modules/auth');
  var files = [
    { src: 'auth.controller.ts',           dst: path.join(moduleDir, 'auth.controller.ts'),           reps: commonReplacements },
    { src: 'auth.service.ts',              dst: path.join(moduleDir, 'auth.service.ts'),              reps: commonReplacements },
    { src: 'auth.module.ts',               dst: path.join(moduleDir, 'auth.module.ts'),               reps: commonReplacements },
    { src: 'dtos/login.dto.ts',            dst: path.join(moduleDir, 'dtos/login.dto.ts'),            reps: Object.assign({}, commonReplacements, { '__VALIDATOR_IMPORTS__': loginValidatorImports }) },
    { src: 'dtos/signup.dto.ts',           dst: path.join(moduleDir, 'dtos/signup.dto.ts'),           reps: Object.assign({}, commonReplacements, { '__VALIDATOR_IMPORTS__': signupValidatorImports }) },
    { src: 'dtos/auth-response.dto.ts',    dst: path.join(moduleDir, 'dtos/auth-response.dto.ts'),    reps: commonReplacements },
  ];

  console.log('scaffold-auth-module: writing auth module');
  console.log('  identifier_field:    ' + identifierField);
  console.log('  password_field:      ' + passwordField);
  console.log('  signup_fields:       ' + signupFields.map(function (f) { return f.name; }).join(', '));
  console.log('  user_entity_import:  ' + userInfo.importPath + (userInfo.missing ? '  ⚠ entity file not found' : ''));

  for (var fi = 0; fi < files.length; fi++) {
    var f = files[fi];
    var srcPath = path.join(args.templates, f.src);
    if (!fs.existsSync(srcPath)) {
      console.error('template missing: ' + srcPath);
      process.exit(2);
    }
    substituteFile(srcPath, f.dst, f.reps, args);
  }
  console.log('scaffold-auth-module: done');
}

main();
