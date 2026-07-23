#!/usr/bin/env node
// scaffold-string-to-enum-doctor.js — v92
//
// Detects entity fields declared as `<field>!: string` with a
// `@Column({ type: 'varchar', default: 'X' })` decorator, AND finds the
// matching enum file already produced by scaffold-enums-from-spec — then
// rewrites the entity to use the TypeORM enum column + strong enum type.
//
// WHY: scaffold-entities emits string fields from PROJECT_DATABASE.md
// even when scaffold-enums-from-spec has already produced the matching
// enum. Result:
//   - deterministic `prefer-enum-over-string` gate check FAILS
//   - database evaluator drops constraint_correctness + migration_safety
//   - gate score caps at ~0.80 (v92 evidence: 6/8 → 0.799)
//
// FIX STRATEGY (per entity file):
//   1. Walk *.entity.ts
//   2. For each `@Column({...type:'varchar'..., default:'X'}) <f>!: string;`
//      - Derive entity-kebab from class name
//      - Look for `src/common/enums/<entity-kebab>-<field>-enum.ts`
//      - Verify default value 'X' exists in the enum
//      - Rewrite @Column to enum form + field type to enum class + add import
//   3. Idempotent: marker `// [string-to-enum-doctor]` on the rewritten column
//
// SAFE because:
//   - Only rewrites when a matching enum FILE already exists (not invented)
//   - Only rewrites when the default value is a verified enum member
//   - TypeScript string-enums are assignable from their string values; any
//     existing service code reading `entity.status === 'pending'` still
//     compiles (string-literal comparison is allowed against string enums)
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-string-to-enum-doctor --target <BACKEND_DIR> [--dry-run] [--verbose] [--force]');
    process.exit(1);
  }
  return out;
}

function parseEnumFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  var src = fs.readFileSync(filePath, 'utf-8');
  var clsMatch = src.match(/export\s+enum\s+(\w+)\s*\{([\s\S]*?)\}/);
  if (!clsMatch) return null;
  var name = clsMatch[1];
  var body = clsMatch[2];
  var values = {};
  var memberRe = /(\w+)\s*=\s*['"]([^'"]+)['"]/g;
  var m;
  while ((m = memberRe.exec(body))) {
    values[m[2]] = m[1]; // value -> MEMBER name
  }
  if (Object.keys(values).length === 0) return null;
  return { name: name, values: values };
}

function findEnumFile(enumsDir, entityKebab, field) {
  // Try entity-prefixed names first (more specific), then shared-name fallback.
  var fieldKebab = field.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  var candidates = [
    entityKebab + '-' + fieldKebab + '-enum.ts',
    entityKebab + '-' + fieldKebab + '.enum.ts',
    entityKebab + '_' + fieldKebab + '-enum.ts',
    // Shared-enum fallback (e.g. target-audience-enum.ts shared across entities)
    fieldKebab + '-enum.ts',
    fieldKebab + '.enum.ts',
  ];
  for (var i = 0; i < candidates.length; i++) {
    var p = path.join(enumsDir, candidates[i]);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function pascalToKebab(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function walkFiles(root, pattern) {
  var out = [];
  if (!fs.existsSync(root)) return out;
  (function visit(dir) {
    fs.readdirSync(dir).forEach(function (f) {
      var p = path.join(dir, f);
      var stat = fs.statSync(p);
      if (stat.isDirectory()) visit(p);
      else if (pattern.test(f)) out.push(p);
    });
  })(root);
  return out;
}

function processEntity(filePath, enumsDir, opts) {
  var src = fs.readFileSync(filePath, 'utf-8');
  if (src.indexOf('[string-to-enum-doctor]') !== -1 && !opts.force) {
    return { skipped: true, reason: 'already-processed' };
  }

  var classMatch = src.match(/export\s+class\s+(\w+)\s+extends\b/);
  if (!classMatch) return { skipped: true, reason: 'no-class' };
  var entityName = classMatch[1];
  var entityKebab = pascalToKebab(entityName);

  // Match: @Column({ ... default: 'X' ... }) <comments> <field>!: string;
  // The column body is non-greedy and must contain a `default: 'X'`.
  var blockRe = /@Column\(\s*\{\s*([^}]*?\bdefault:\s*['"]([^'"]+)['"][^}]*?)\}\s*\)([\s\S]*?)(\w+)\s*!?\s*:\s*string\s*;/g;
  var rewrites = [];
  var m;
  while ((m = blockRe.exec(src))) {
    var matchedText = m[0];
    var columnInside = m[1];
    var defaultValue = m[2];
    var betweenDecoratorAndField = m[3];
    var fieldName = m[4];

    // Must be a string-shaped column (varchar/text). Skip JSON, etc.
    if (!/type\s*:\s*['"](?:varchar|text|character\s*varying|char)['"]/i.test(columnInside)) {
      continue;
    }
    // Reject if the gap between decorator and field has another @Column —
    // that means we matched across two fields (greedy mishap).
    if (/@Column/.test(betweenDecoratorAndField)) continue;

    var enumFile = findEnumFile(enumsDir, entityKebab, fieldName);
    if (!enumFile) {
      if (opts.verbose) console.log('  ' + path.basename(filePath) + ': no enum file for ' + entityKebab + '.' + fieldName);
      continue;
    }
    var enumDef = parseEnumFile(enumFile);
    if (!enumDef) continue;
    if (!enumDef.values[defaultValue]) {
      if (opts.verbose) console.log('  ' + path.basename(filePath) + ': default "' + defaultValue + '" not in ' + enumDef.name);
      continue;
    }
    rewrites.push({
      match: matchedText,
      defaultValue: defaultValue,
      fieldName: fieldName,
      enumName: enumDef.name,
      enumFile: enumFile,
      memberName: enumDef.values[defaultValue],
      betweenDecoratorAndField: betweenDecoratorAndField,
    });
  }

  if (rewrites.length === 0) return { skipped: true, reason: 'no-matches' };

  var newSrc = src;
  rewrites.forEach(function (r) {
    // Preserve any inline comment(s) between decorator and field.
    var newBlock =
      "@Column({ type: 'enum', enum: " + r.enumName +
      ', default: ' + r.enumName + '.' + r.memberName + ' }) // [string-to-enum-doctor]' +
      r.betweenDecoratorAndField +
      r.fieldName + '!: ' + r.enumName + ';';
    newSrc = newSrc.replace(r.match, newBlock);
  });

  // Add imports for any enum classes used (only those not already imported)
  var seenImports = {};
  rewrites.forEach(function (r) {
    if (seenImports[r.enumName]) return;
    seenImports[r.enumName] = r;
  });

  Object.keys(seenImports).forEach(function (enumName) {
    if (new RegExp('import\\s*\\{[^}]*\\b' + enumName + '\\b[^}]*\\}').test(newSrc)) return;
    var r = seenImports[enumName];
    var basename = path.basename(r.enumFile, '.ts');
    var relDir = path.relative(path.dirname(filePath), path.dirname(r.enumFile)).replace(/\\/g, '/');
    if (!relDir.startsWith('.')) relDir = './' + relDir;
    var importLine = "import { " + enumName + " } from '" + relDir + "/" + basename + "';\n";

    var lastImportIdx = -1;
    var importRe = /^import\s.+?$/gm;
    var mi;
    while ((mi = importRe.exec(newSrc))) {
      lastImportIdx = mi.index + mi[0].length;
    }
    if (lastImportIdx === -1) {
      newSrc = importLine + newSrc;
    } else {
      newSrc = newSrc.slice(0, lastImportIdx) + '\n' + importLine.trimEnd() + newSrc.slice(lastImportIdx);
    }
  });

  if (opts.dryRun) {
    console.log('  [dry] ' + path.relative(opts.target, filePath) + ': would rewrite ' + rewrites.length + ' field(s): ' +
      rewrites.map(function (r) { return r.fieldName + ' -> ' + r.enumName; }).join(', '));
    return { rewrites: rewrites.length };
  }

  fs.writeFileSync(filePath, newSrc);
  return {
    rewrites: rewrites.length,
    fields: rewrites.map(function (r) { return r.fieldName + '→' + r.enumName; }),
  };
}

function main() {
  var args = parseArgs(process.argv);
  var backendSrc = path.join(args.target, 'src');
  var enumsDir = path.join(backendSrc, 'common/enums');
  if (!fs.existsSync(enumsDir)) {
    console.log('scaffold-string-to-enum-doctor: no common/enums dir — skipping');
    return;
  }
  var entityFiles = walkFiles(path.join(backendSrc, 'modules'), /\.entity\.ts$/);
  if (entityFiles.length === 0) {
    console.log('scaffold-string-to-enum-doctor: no entity files found — skipping');
    return;
  }
  var totalRewrites = 0;
  var entitiesChanged = 0;
  entityFiles.forEach(function (f) {
    var r = processEntity(f, enumsDir, args);
    if (r.rewrites) {
      totalRewrites += r.rewrites;
      entitiesChanged++;
      var fieldsLabel = r.fields ? ' [' + r.fields.join(', ') + ']' : '';
      console.log('  ✓ ' + path.relative(args.target, f) + ': rewrote ' + r.rewrites + ' field(s)' + fieldsLabel);
    }
  });
  console.log('scaffold-string-to-enum-doctor: rewrote ' + totalRewrites + ' field(s) in ' + entitiesChanged +
    ' entit' + (entitiesChanged === 1 ? 'y' : 'ies') + ' (of ' + entityFiles.length + ' total)');
}

main();
