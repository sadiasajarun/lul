#!/usr/bin/env node
// scaffold-numeric-enum-doctor.js — v87
//
// Detects TypeScript enums with NUMERIC values (e.g. RoleEnum.FOREIGN_WORKER = 0)
// and rewrites their @Column declarations from `type: 'enum', enum: X` to
// `type: 'int'`. Also rewrites migrations to drop the CREATE TYPE statements
// and use INTEGER column types.
//
// WHY: PostgreSQL native ENUM type doesn't store integers — it stores STRINGS
// matching the enum's value list. When TypeORM sees @Column({ type: 'enum',
// enum: RoleEnum }) with RoleEnum.FOREIGN_WORKER = 0, the migration becomes
// CREATE TYPE role_enum AS ENUM ('0', '1', '2'), which expects the string '0'
// but TypeORM inserts the integer 0 → "column 'role' is of type users_role_enum
// but expression is of type integer" cascade. seed.ts fails. test-browser
// fails because no users exist to log in as.
//
// v86 evidence: smoke-test step 4/6 failed with this exact error on RoleEnum,
// UserStatusEnum, ApplicationStatusEnum, DocumentStatusEnum (4 numeric enums).
// All test-browser stories that require auth (95% of stories) would fail at
// global-setup. Bug latent across v78-v85b but masked by earlier crashes —
// only v86 got far enough to expose it.
//
// FIX STRATEGY:
//   1. Walk common/enums + shared/enums
//   2. For each enum with numeric values:
//      a. Rewrite all @Column({ type: 'enum', enum: X, ... }) to
//         @Column({ type: 'int', ... }) in *.entity.ts
//      b. Drop CREATE TYPE statements for X in migrations
//      c. Replace "x_enum" column type references with INTEGER
//      d. Drop DROP TYPE statements in `down`
//
// Idempotent. Marker: writes '[scaffold-numeric-enum-doctor]' breadcrumb
// comments in migration files when it edits them.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-numeric-enum-doctor --target <BACKEND_DIR> [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

function findEnumFiles(backendSrc) {
  var dirs = [
    path.join(backendSrc, 'common/enums'),
    path.join(backendSrc, 'shared/enums'),
  ];
  var enums = [];
  dirs.forEach(function (dir) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(function (f) {
      if (!/\.enum\.ts$/.test(f) || f === 'index.ts') return;
      enums.push(path.join(dir, f));
    });
  });
  return enums;
}

function parseEnum(filePath) {
  var content = fs.readFileSync(filePath, 'utf-8');
  var enumMatch = /export\s+enum\s+(\w+)\s*\{([\s\S]*?)\}/.exec(content);
  if (!enumMatch) return null;
  var name = enumMatch[1];
  var body = enumMatch[2];
  // Find KEY = VAL ; ignore comments
  var lines = body.split('\n');
  var values = [];
  lines.forEach(function (line) {
    var m = /^\s*(\w+)\s*=\s*([^,\n/]+)/.exec(line);
    if (!m) return;
    var val = m[2].trim().replace(/,$/, '').trim();
    values.push({ key: m[1], val: val });
  });
  if (values.length === 0) return null;
  var isNumeric = values.every(function (v) {
    // Match plain integer values (with optional minus sign)
    return /^-?\d+$/.test(v.val);
  });
  return { name: name, isNumeric: isNumeric, values: values, filePath: filePath };
}

// Convert RoleEnum → role_enum (TypeORM snake_case naming convention)
function enumNameToSnake(typeName) {
  var stripped = typeName.replace(/Enum$/, '');
  return stripped
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '') + '_enum';
}

function fixEntityFiles(backendSrc, numericEnumNames, options) {
  var moduleDir = path.join(backendSrc, 'modules');
  if (!fs.existsSync(moduleDir)) return { filesFixed: 0, columnsFixed: 0 };

  var filesFixed = 0, columnsFixed = 0;

  function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      var p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); return; }
      if (!e.isFile() || !/\.entity\.ts$/.test(e.name)) return;

      var orig = fs.readFileSync(p, 'utf-8');
      var updated = orig;
      var fileChanges = 0;

      numericEnumNames.forEach(function (enumName) {
        // Match `@Column({ ... type: 'enum', ..., enum: <Name>, ... default: ... })`
        // The opts may be in any order — split by `,` not inside braces/quotes is fine
        // since @Column options are simple key:value pairs.
        var pattern = new RegExp(
          '@Column\\(\\s*\\{([^{}]*?)\\}\\s*\\)',
          'g'
        );
        updated = updated.replace(pattern, function (match, opts) {
          // Only act if THIS block references THIS enum
          if (!new RegExp('enum:\\s*' + enumName + '(?:\\W|$)').test(opts)) return match;
          if (!/type:\s*['"]enum['"]/.test(opts)) return match;

          var parts = opts.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          var preserved = [];
          parts.forEach(function (part) {
            if (/^type:\s*['"]enum['"]/.test(part)) return; // drop
            if (new RegExp('^enum:\\s*' + enumName).test(part)) return; // drop
            // default: RoleEnum.FOREIGN_WORKER → keep but TypeORM will coerce
            // to the numeric value via TS enum runtime.
            preserved.push(part);
          });
          preserved.unshift("type: 'int'");
          columnsFixed++;
          fileChanges++;
          return '@Column({ ' + preserved.join(', ') + ' })';
        });
      });

      if (fileChanges > 0) {
        if (!options.dryRun) fs.writeFileSync(p, updated);
        filesFixed++;
        if (options.verbose) {
          console.log('  ' + path.relative(backendSrc, p) + ': ' + fileChanges + ' enum column(s) → int');
        }
      }
    });
  }
  walk(moduleDir);
  return { filesFixed: filesFixed, columnsFixed: columnsFixed };
}

function fixMigrations(backendSrc, numericEnumSnakeNames, options) {
  var migDir = path.join(backendSrc, 'database/migrations');
  if (!fs.existsSync(migDir)) return { filesFixed: 0, changes: 0 };

  var filesFixed = 0, totalChanges = 0;

  fs.readdirSync(migDir).forEach(function (f) {
    if (!/\.ts$/.test(f)) return;
    var p = path.join(migDir, f);
    var orig = fs.readFileSync(p, 'utf-8');
    var updated = orig;
    var fileChanges = 0;

    numericEnumSnakeNames.forEach(function (snakeName) {
      // Drop CREATE TYPE block (full await queryRunner.query(`...`); statement)
      var createTypeRe = new RegExp(
        'await\\s+queryRunner\\.query\\(\\s*`\\s*CREATE\\s+TYPE\\s+"' + snakeName + '"\\s+AS\\s+ENUM[^`]+`\\s*\\)\\s*;',
        'g'
      );
      updated = updated.replace(createTypeRe, function (m) {
        fileChanges++;
        return '// [scaffold-numeric-enum-doctor] dropped CREATE TYPE ' + snakeName + ' (column now INTEGER)';
      });

      // Replace "snake_enum" type references with INTEGER  (inside column declarations)
      // Match `"col" "snake_name" NOT NULL` → `"col" INTEGER NOT NULL`
      // Also bare `"snake_name"` between type position chars.
      var quotedNameRe = new RegExp('"' + snakeName + '"', 'g');
      updated = updated.replace(quotedNameRe, function () {
        fileChanges++;
        return 'INTEGER';
      });

      // Drop DROP TYPE statements in `down`
      var dropTypeRe = new RegExp(
        'await\\s+queryRunner\\.query\\(\\s*`\\s*DROP\\s+TYPE\\s+"?' + snakeName + '"?\\s*`\\s*\\)\\s*;',
        'g'
      );
      updated = updated.replace(dropTypeRe, function () {
        fileChanges++;
        return '// [scaffold-numeric-enum-doctor] dropped DROP TYPE ' + snakeName;
      });
    });

    if (fileChanges > 0) {
      if (!options.dryRun) fs.writeFileSync(p, updated);
      filesFixed++;
      totalChanges += fileChanges;
      if (options.verbose) {
        console.log('  ' + path.relative(backendSrc, p) + ': ' + fileChanges + ' change(s)');
      }
    }
  });
  return { filesFixed: filesFixed, changes: totalChanges };
}

function main() {
  var args = parseArgs(process.argv);
  var backendSrc = path.join(args.target, 'src');
  if (!fs.existsSync(backendSrc)) {
    console.log('scaffold-numeric-enum-doctor: target src/ not found at ' + backendSrc);
    return;
  }

  // Step 1: discover numeric enums
  var enumFiles = findEnumFiles(backendSrc);
  var allEnums = enumFiles.map(parseEnum).filter(Boolean);
  var numericEnums = allEnums.filter(function (e) { return e.isNumeric; });

  if (numericEnums.length === 0) {
    console.log('scaffold-numeric-enum-doctor: no numeric-valued enums detected — nothing to fix');
    return;
  }

  console.log('scaffold-numeric-enum-doctor: detected ' + numericEnums.length +
    ' numeric enum(s): ' + numericEnums.map(function (e) { return e.name; }).join(', '));

  var numericEnumNames = numericEnums.map(function (e) { return e.name; });
  var numericEnumSnakeNames = numericEnumNames.map(enumNameToSnake);

  // Step 2: rewrite entity @Column declarations
  var entityFix = fixEntityFiles(backendSrc, numericEnumNames, args);
  console.log('  entities: ' + entityFix.filesFixed + ' files, ' + entityFix.columnsFixed + ' columns rewritten to type: int');

  // Step 3: rewrite migrations
  var migFix = fixMigrations(backendSrc, numericEnumSnakeNames, args);
  console.log('  migrations: ' + migFix.filesFixed + ' files, ' + migFix.changes + ' change(s)');
}

main();
