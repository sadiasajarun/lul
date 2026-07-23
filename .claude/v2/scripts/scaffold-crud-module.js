#!/usr/bin/env node
/**
 * scaffold-crud-module.js — expand the _crud/ template tree per entity
 * defined in MODULE_PLAN.yaml. Deterministic; replaces what the LLM
 * implement-fanout used to write from scratch for every CRUD module.
 *
 * Usage:
 *   node .claude/v2/scripts/scaffold-crud-module.js \
 *        --plan <path/to/MODULE_PLAN.yaml> \
 *        --target <run-dir>/backend \
 *        --templates <path/to/.claude/nestjs/templates/modules/_crud>
 *
 * Per module entry in plan.modules[]:
 *   1. Compute the placeholder map (__Entity__, __entity__, __entities__,
 *      __entity-kebab__, __entity-snake__).
 *   2. Render each template file from _crud/, substituting placeholders +
 *      field/relation marker blocks. Write to <target>/src/modules/<kebab>/.
 *   3. Render the e2e spec from _crud/test/ into <target>/test/e2e/.
 *
 * Idempotent: if a destination file exists and matches the template's
 * generated content, skip; if it differs (LLM has customized), warn and
 * leave it alone. Generator never overwrites LLM work.
 *
 * Exit codes:
 *   0 — success (one or more modules scaffolded, or all already present)
 *   1 — MODULE_PLAN.yaml unreadable / schema error
 *   2 — template dir missing
 *   3 — write failure
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plan') out.plan = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--templates') out.templates = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  if (!out.plan || !out.target || !out.templates) {
    printHelp();
    process.exit(1);
  }
  return out;
}

function printHelp() {
  console.log(`scaffold-crud-module — expand _crud/ template tree per MODULE_PLAN entry

Usage:
  scaffold-crud-module --plan <yaml> --target <backend-dir> --templates <_crud-dir> [--dry-run] [-v]

Args:
  --plan       Path to MODULE_PLAN.yaml
  --target     Backend root dir (e.g. <run>/backend) — files written under src/modules/ + test/e2e/
  --templates  _crud template dir (e.g. .claude/nestjs/templates/modules/_crud)
  --dry-run    Show what would be written, don't touch disk
  -v           Verbose output
`);
}

// ── case helpers ───────────────────────────────────────────────────────────

function toPascal(s) {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}
function toCamel(s) {
  const p = toPascal(s);
  return p ? p[0].toLowerCase() + p.slice(1) : p;
}
function toKebab(s) {
  return s
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}
function toSnake(s) {
  return toKebab(s).replace(/-/g, '_');
}
function pluralize(s) {
  // Naive plural — good enough for module routes; LLM-owners can override
  // via MODULE_PLAN `plural:` if their entity is irregular.
  if (/(s|x|z|ch|sh)$/i.test(s)) return s + 'es';
  if (/[^aeiou]y$/i.test(s)) return s.replace(/y$/i, 'ies');
  return s + 's';
}

// ── YAML reader (uses orchestrator's existing yaml dep) ────────────────────

function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  const { execSync } = require('child_process');
  const globalPath = execSync('npm root -g', { encoding: 'utf-8' }).trim();
  return require(path.join(globalPath, 'yaml'));
}

function readPlan(planPath) {
  if (!fs.existsSync(planPath)) {
    console.error(`MODULE_PLAN not found: ${planPath}`);
    process.exit(1);
  }
  const yaml = loadYaml();
  const text = fs.readFileSync(planPath, 'utf-8');
  let doc;
  try {
    doc = yaml.parse(text);
  } catch (err) {
    console.error(`MODULE_PLAN parse error: ${err.message}`);
    process.exit(1);
  }
  if (!doc || !Array.isArray(doc.modules)) {
    console.error('MODULE_PLAN must have a top-level `modules:` array');
    process.exit(1);
  }
  return doc;
}

// ── placeholder renderer ───────────────────────────────────────────────────

function computeVars(mod) {
  const name = mod.name;
  if (!name) throw new Error('module entry missing `name`');
  const entity = mod.entity || toPascal(name);
  const plural = mod.plural || pluralize(toCamel(name));
  return {
    __Entity__: entity,
    __entity__: toCamel(name),
    __entities__: plural,
    '__entity-kebab__': toKebab(name),
    '__entity-snake__': mod.table || toSnake(name),
  };
}

function substitute(text, vars) {
  let out = text;
  // Replace longest keys first so __entity-kebab__ doesn't match __entity__
  const keys = Object.keys(vars).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    out = out.split(k).join(vars[k]);
  }
  return out;
}

// ── field-block renderer ───────────────────────────────────────────────────
//
// Replaces marker comments inside templates:
//   // __FIELDS__               in entity.ts
//   // __DTO_IMPORTS__          in create dto
//   // __DTO_FIELDS__           in create dto
//   // __DTO_RESPONSE_IMPORTS__ in response dto
//   // __DTO_RESPONSE_FIELDS__  in response dto
//   // __CREATE_PAYLOAD__       in e2e spec  (the supertest .send(...) body)

function renderEntityFields(fields, relations) {
  const lines = [];
  for (const f of fields) {
    const colOpts = [];
    if (f.column?.name) colOpts.push(`name: '${f.column.name}'`);
    if (f.nullable) colOpts.push('nullable: true');
    if (f.unique) colOpts.push('unique: true');
    if (f.default !== undefined) {
      const def = typeof f.default === 'string' ? f.default : JSON.stringify(f.default);
      colOpts.push(`default: ${def}`);
    }
    if (f.type === 'enum') {
      colOpts.push("type: 'enum'");
      colOpts.push(`enum: ${f.enumName}`);
    } else if (f.type === 'Date') {
      colOpts.push("type: 'timestamp'");
    }
    const colArg = colOpts.length ? `{ ${colOpts.join(', ')} }` : '';
    const colDecorator = colArg ? `@Column(${colArg})` : '@Column()';
    const tsType = f.type === 'enum' ? f.enumName : f.type === 'Date' ? 'Date' : f.type;
    const optional = f.nullable ? '?' : '!';
    lines.push(`  ${colDecorator}`);
    lines.push(`  ${f.name}${optional}: ${tsType};`);
    lines.push('');
  }
  // Relation stubs (LLM customizes specifics)
  for (const r of relations || []) {
    if (r.kind === 'ManyToOne') {
      lines.push(`  // TODO: LLM — wire ${r.target} entity import + inverse side`);
      lines.push(`  // @ManyToOne(() => ${r.target}${r.nullable ? ', { nullable: true }' : ''})`);
      lines.push(`  // @JoinColumn({ name: '${r.joinColumn}' })`);
      lines.push(`  // ${toCamel(r.target)}?: ${r.target};`);
      lines.push(`  @Column({ name: '${r.joinColumn}', nullable: ${r.nullable ? 'true' : 'false'} })`);
      lines.push(`  ${toCamel(r.target)}Id${r.nullable ? '?' : '!'}: string;`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function renderEnumImports(fields) {
  const seen = new Map();
  for (const f of fields) {
    if (f.type === 'enum' && f.enumName && f.enumImport) {
      seen.set(f.enumName, f.enumImport);
    }
  }
  return [...seen].map(([name, imp]) => `import { ${name} } from '${imp}';`).join('\n');
}

// validatorName(v) → 'IsEmail' / 'Matches' / 'MinLength'
// validatorArg(v)  → '' (bare) | '8' (string-form colon-arg) | "'^010-\\d{4}-\\d{4}$'" (object-form, single-quoted)
function validatorName(v) {
  if (typeof v === 'string') return v.split(':')[0];
  if (v && typeof v === 'object' && v.name) return v.name;
  return String(v);
}
function validatorArg(v) {
  if (typeof v === 'string') {
    const idx = v.indexOf(':');
    return idx === -1 ? '' : v.slice(idx + 1);
  }
  if (v && typeof v === 'object' && v.name) {
    if (v.arg === undefined || v.arg === null) return '';
    // Wrap regex-style args in `/.../` for `Matches`. Other decorators get the
    // arg as a JS string literal (single-quoted, with embedded single-quotes escaped).
    if (v.name === 'Matches' && typeof v.arg === 'string') {
      // Strip leading/trailing slashes if the LLM accidentally included them
      const pattern = v.arg.replace(/^\/+/, '').replace(/\/+$/, '');
      return `/${pattern}/`;
    }
    if (typeof v.arg === 'string') {
      return `'${v.arg.replace(/'/g, "\\'")}'`;
    }
    return JSON.stringify(v.arg);
  }
  return '';
}

function renderDtoImports(fields, isResponse) {
  const validators = new Set();
  const swagger = new Set(['ApiProperty']);
  for (const f of fields) {
    if (isResponse && f.response === false) continue;
    for (const v of f.validators || []) {
      validators.add(validatorName(v));
    }
  }
  const imports = [];
  imports.push(`import { ${[...swagger].sort().join(', ')} } from '@nestjs/swagger';`);
  if (validators.size > 0 && !isResponse) {
    imports.push(`import { ${[...validators].sort().join(', ')} } from 'class-validator';`);
  }
  // Enum imports
  const enumImports = renderEnumImports(fields);
  if (enumImports) imports.push(enumImports);
  return imports.join('\n');
}

function renderDtoFields(fields, isResponse) {
  const lines = [];
  for (const f of fields) {
    if (isResponse && f.response === false) continue;
    const apiProps = [];
    if (f.swagger?.description) apiProps.push(`description: '${f.swagger.description.replace(/'/g, "\\'")}'`);
    if (f.swagger?.example !== undefined) {
      const ex = typeof f.swagger.example === 'string' ? `'${f.swagger.example}'` : f.swagger.example;
      apiProps.push(`example: ${ex}`);
    }
    if (f.nullable) apiProps.push('required: false');
    if (f.type === 'enum') apiProps.push(`enum: ${f.enumName}`);
    const apiArg = apiProps.length ? `{ ${apiProps.join(', ')} }` : '';
    lines.push(`  @ApiProperty(${apiArg})`);
    if (!isResponse) {
      for (const v of f.validators || []) {
        const name = validatorName(v);
        const arg = validatorArg(v);
        lines.push(`  @${name}(${arg})`);
      }
    }
    const tsType = f.type === 'enum' ? f.enumName : f.type === 'Date' ? 'Date' : f.type;
    const optional = f.nullable ? '?' : '!';
    lines.push(`  ${f.name}${optional}: ${tsType};`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderCreatePayload(fields) {
  // Build a valid example body for the e2e spec's supertest .send(...) call.
  // Include every non-nullable field even when response:false — the server
  // validates the Create DTO with class-validator before stripping
  // sensitive fields from the response, so omitting password (response:false)
  // would fail validation. response:false controls the read shape, not the
  // write shape.
  const required = fields.filter((f) => !f.nullable);
  const lines = [];
  lines.push('.send({');
  for (const f of required) {
    let v;
    if (f.name === 'email' || /email/i.test(f.name)) v = "'spec@test.com'";
    else if (f.name.toLowerCase().includes('password')) v = "'TestPass123!'";
    else if (f.type === 'number') v = '1';
    else if (f.type === 'boolean') v = 'true';
    else if (f.type === 'Date') v = 'new Date().toISOString()';
    else if (f.type === 'enum') {
      const fallback = `${f.enumName}.user`; // assumes RoleEnum.user exists in canonical enum
      v = f.default ? f.default.toString() : fallback;
    } else {
      v = "'test'";
    }
    lines.push(`          ${f.name}: ${v},`);
  }
  lines.push('        })');
  return lines.join('\n');
}

// ── per-module scaffold ────────────────────────────────────────────────────

function scaffoldModule(mod, templatesDir, targetBackendDir, opts) {
  const vars = computeVars(mod);
  const moduleKebab = vars['__entity-kebab__'];
  const moduleDir = path.join(targetBackendDir, 'src', 'modules', moduleKebab);
  const testDir = path.join(targetBackendDir, 'test', 'e2e');

  // v63 entity-coexistence: the database phase may have already written
  // entities at <plural>/entities/<singular>.entity.ts (different dir layout
  // than the CRUD scaffold uses). When that's the case, scaffold-crud-modules
  // would otherwise create a SECOND @Entity declaration for the same table
  // → TypeORM duplicate-registration error. Detect existing entities and
  // skip our own entity generation; the LLM-written entity stays canonical.
  function findExistingEntity() {
    const candidates = [
      path.join(targetBackendDir, 'src', 'modules', vars['__entities__'] || (moduleKebab + 's'), 'entities', moduleKebab + '.entity.ts'),
      path.join(targetBackendDir, 'src', 'modules', moduleKebab + 's', 'entities', moduleKebab + '.entity.ts'),
      path.join(moduleDir, 'entities', moduleKebab + '.entity.ts'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }
  const existingEntity = findExistingEntity();
  if (existingEntity && opts.verbose) {
    console.log(`  [${moduleKebab}] reusing existing entity: ${path.relative(targetBackendDir, existingEntity)}`);
  }

  const fieldBlock = renderEntityFields(mod.fields || [], mod.relations || []);
  const enumImports = renderEnumImports(mod.fields || []);
  const createImports = renderDtoImports(mod.fields || [], false);
  const createFields = renderDtoFields(mod.fields || [], false);
  const responseImports = renderDtoImports(mod.fields || [], true);
  const responseFields = renderDtoFields(mod.fields || [], true);
  const createPayload = renderCreatePayload(mod.fields || []);

  const markerSubs = (text) => text
    .replace(/^\s*\/\/ __FIELDS__\s*$/m, fieldBlock)
    .replace(/^\s*\/\/ __DTO_IMPORTS__\s*$/m, createImports)
    .replace(/^\s*\/\/ __DTO_FIELDS__\s*$/m, createFields)
    .replace(/^\s*\/\/ __DTO_RESPONSE_IMPORTS__\s*$/m, responseImports)
    .replace(/^\s*\/\/ __DTO_RESPONSE_FIELDS__\s*$/m, responseFields)
    // CREATE_PAYLOAD must match only at start-of-line + standalone (not inside
    // doc comments). The marker line in the e2e spec template is exactly
    // `        // __CREATE_PAYLOAD__` (8-space indent inside a test body).
    .replace(/^[ \t]*\/\/ __CREATE_PAYLOAD__\s*$/gm, '        ' + createPayload);

  // Append entity-extra imports (enum) after the existing entity imports block.
  // The entity template imports BaseEntity; we splice enum imports after it.
  function withEntityImports(text) {
    if (!enumImports) return text;
    return text.replace(
      /import { BaseEntity } from '\.\.\/\.\.\/core\/base\/base\.entity';\n/,
      (m) => m + enumImports + '\n',
    );
  }

  // v63: when entity lives at a different path (e.g. <plural>/entities/<x>.entity.ts
  // because the database phase wrote it there), rewrite our scaffold's
  // `import { __Entity__ } from './__entity-kebab__.entity'` to the correct
  // relative path. Same for the e2e spec (`'../../src/modules/<x>/<x>.entity'`).
  function rewriteEntityImportFor(actualEntityPath, srcModuleDir) {
    return function (text) {
      // Compute relative path from the rendered file's dir to actualEntityPath
      // (without .ts extension)
      const relFromModule = path.relative(srcModuleDir, actualEntityPath).replace(/\.ts$/, '');
      const relImport = relFromModule.startsWith('.') ? relFromModule : './' + relFromModule;
      // Replace `'./<kebab>.entity'` with the actual relative path
      const reKebabImport = new RegExp("'\\./" + moduleKebab + "\\.entity'", 'g');
      return text.replace(reKebabImport, "'" + relImport + "'");
    };
  }

  const filesToRender = [];
  // Only emit our own entity if database phase didn't already write one.
  if (!existingEntity) {
    filesToRender.push({ src: '__entity-kebab__.entity.ts', dst: path.join(moduleDir, `${moduleKebab}.entity.ts`), post: withEntityImports });
  }
  filesToRender.push(
    { src: '__entity-kebab__.repository.ts', dst: path.join(moduleDir, `${moduleKebab}.repository.ts`), post: existingEntity ? rewriteEntityImportFor(existingEntity, moduleDir) : null },
    { src: '__entity-kebab__.service.ts', dst: path.join(moduleDir, `${moduleKebab}.service.ts`), post: existingEntity ? rewriteEntityImportFor(existingEntity, moduleDir) : null },
    { src: '__entity-kebab__.controller.ts', dst: path.join(moduleDir, `${moduleKebab}.controller.ts`), post: existingEntity ? rewriteEntityImportFor(existingEntity, moduleDir) : null },
    { src: '__entity-kebab__.module.ts', dst: path.join(moduleDir, `${moduleKebab}.module.ts`), post: existingEntity ? rewriteEntityImportFor(existingEntity, moduleDir) : null },
    { src: 'dtos/create-__entity-kebab__.dto.ts', dst: path.join(moduleDir, 'dtos', `create-${moduleKebab}.dto.ts`) },
    { src: 'dtos/update-__entity-kebab__.dto.ts', dst: path.join(moduleDir, 'dtos', `update-${moduleKebab}.dto.ts`) },
    { src: `dtos/__entity-kebab__-response.dto.ts`, dst: path.join(moduleDir, 'dtos', `${moduleKebab}-response.dto.ts`) },
    { src: 'test/__entity-kebab__.e2e-spec.ts', dst: path.join(testDir, `${moduleKebab}.e2e-spec.ts`) },
  );

  let written = 0, skipped = 0, customized = 0;
  for (const f of filesToRender) {
    const srcPath = path.join(templatesDir, f.src);
    if (!fs.existsSync(srcPath)) {
      console.error(`template missing: ${srcPath}`);
      process.exit(2);
    }
    let rendered = substitute(fs.readFileSync(srcPath, 'utf-8'), vars);
    rendered = markerSubs(rendered);
    if (f.post) rendered = f.post(rendered);

    if (fs.existsSync(f.dst)) {
      const existing = fs.readFileSync(f.dst, 'utf-8');
      if (existing === rendered) {
        skipped++;
        continue;
      }
      // LLM has customized — preserve.
      customized++;
      if (opts.verbose) {
        console.log(`  [keep] ${path.relative(targetBackendDir, f.dst)} (LLM-modified)`);
      }
      continue;
    }
    if (opts.dryRun) {
      console.log(`  [dry] would write ${path.relative(targetBackendDir, f.dst)} (${rendered.length} bytes)`);
      written++;
      continue;
    }
    fs.mkdirSync(path.dirname(f.dst), { recursive: true });
    fs.writeFileSync(f.dst, rendered);
    written++;
  }
  return { written, skipped, customized, moduleKebab };
}

// ── main ───────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.templates)) {
    console.error(`templates dir missing: ${args.templates}`);
    process.exit(2);
  }
  const plan = readPlan(args.plan);

  console.log(`scaffold-crud-module: ${plan.modules.length} module(s) from ${args.plan}`);
  console.log(`  target:    ${args.target}`);
  console.log(`  templates: ${args.templates}`);
  if (args.dryRun) console.log('  mode:      DRY RUN');

  let total = { written: 0, skipped: 0, customized: 0, modules: 0 };
  for (const mod of plan.modules) {
    try {
      const r = scaffoldModule(mod, args.templates, args.target, args);
      console.log(`  [${r.moduleKebab}] written=${r.written} skipped=${r.skipped} customized=${r.customized}`);
      total.written += r.written;
      total.skipped += r.skipped;
      total.customized += r.customized;
      total.modules += 1;
    } catch (err) {
      console.error(`  [${mod.name || '<unnamed>'}] FAIL: ${err.message}`);
      process.exit(3);
    }
  }

  console.log(`\nDone. ${total.modules} module(s), wrote ${total.written}, kept ${total.skipped + total.customized} (${total.customized} LLM-customized).`);
}

main();
