#!/usr/bin/env node
// scaffold-upload-module.js — file upload modules from MODULE_PLAN.yaml uploads:
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
    console.error('Usage: scaffold-upload-module --spec MODULE_PLAN --target BACKEND_DIR --templates _upload/');
    process.exit(1);
  }
  return out;
}
function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  return require(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim(), 'yaml'));
}
function toPascal(s) {
  return s.split(/[-_\s]+/).filter(Boolean).map(function (w) { return w[0].toUpperCase() + w.slice(1).toLowerCase(); }).join('');
}
function toKebab(s) {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
}
function pluralize(s) {
  if (/(s|x|z|ch|sh)$/i.test(s)) return s + 'es';
  if (/[^aeiou]y$/i.test(s)) return s.replace(/y$/i, 'ies');
  return s + 's';
}

function renderValidatorImports(fields) {
  var v = new Set();
  for (var i = 0; i < fields.length; i++) {
    for (var j = 0; j < (fields[i].validators || []).length; j++) {
      v.add(typeof fields[i].validators[j] === 'string' ? fields[i].validators[j].split(':')[0] : fields[i].validators[j].name);
    }
  }
  if (v.size === 0) return '';
  return "import { " + Array.from(v).sort().join(', ') + " } from 'class-validator';";
}

function renderUploadFields(fields) {
  var lines = [];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    // v97: defensive guard. v96 evidence: when MODULE_PLAN.yaml uploads:
    // entries had malformed/empty field objects, this loop emitted
    //   undefined!: undefined;
    //   undefined!: undefined;
    // → TS2300 'Duplicate identifier undefined' broke backend typecheck →
    // cascade into test-api pre-check failing (same file) → backend
    // never started for test-browser. Skip fields missing name OR type —
    // better to omit than emit garbage.
    if (!f || !f.name || !f.type) continue;
    lines.push('  @ApiProperty()');
    for (var j = 0; j < (f.validators || []).length; j++) {
      var v = f.validators[j];
      if (typeof v === 'string') {
        var parts = v.split(':');
        lines.push('  @' + parts[0] + '(' + (parts[1] || '') + ')');
      }
    }
    var tsType = f.type === 'Date' ? 'Date' : f.type;
    lines.push('  ' + f.name + (f.nullable ? '?' : '!') + ': ' + tsType + ';');
    lines.push('');
  }
  // If ALL fields were malformed and we have no output, emit a minimal
  // placeholder so the resulting class isn't empty (some TS configs
  // complain about empty class bodies + Swagger needs at least one prop).
  if (lines.length === 0) {
    lines.push('  // v97: no valid upload-metadata fields in MODULE_PLAN.yaml — placeholder');
    lines.push('  @ApiProperty({ required: false })');
    lines.push('  description?: string;');
  }
  return lines.join('\n');
}

function substituteFile(srcPath, dstPath, replacements, opts) {
  var content = fs.readFileSync(srcPath, 'utf-8');
  Object.keys(replacements).forEach(function (key) {
    var markerLine = new RegExp('^\\s*// ' + key.replace(/[.*+?^${}()|[\\\\]\\\\]/g, '\\$&') + '\\s*$', 'gm');
    content = content.replace(markerLine, function () { return replacements[key]; }); // v128: $-backreference-safe (RCA v126 row 17)
  });
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

function registerUploadInModule(target, entityKebab, entityPlural, entityPascal, opts) {
  var moduleCandidates = [
    path.join(target, 'src/modules', entityKebab, entityKebab + '.module.ts'),
    path.join(target, 'src/modules', entityPlural, entityPlural + '.module.ts'),
    path.join(target, 'src/modules', entityPlural, entityKebab + '.module.ts'),
  ];
  var modulePath = null;
  for (var i = 0; i < moduleCandidates.length; i++) {
    if (fs.existsSync(moduleCandidates[i])) { modulePath = moduleCandidates[i]; break; }
  }
  if (!modulePath) {
    console.log('  ⚠  no <entity>.module.ts found — upload controller needs manual registration');
    return;
  }
  var content = fs.readFileSync(modulePath, 'utf-8');
  if (/UploadController/.test(content)) return;
  var uploadDir = path.join(target, 'src/modules', entityKebab + '-upload');
  var relImport = path.relative(path.dirname(modulePath), uploadDir);
  var importLines =
    "import { " + entityPascal + "UploadController } from '" + relImport + "/" + entityKebab + "-upload.controller';\n" +
    "import { FileStorageModule } from '../../infrastructure/file-storage/file-storage.module';";

  var importMatches = [...content.matchAll(/^import .*?;?\s*$/gm)];
  var lastImport = importMatches.length ? importMatches[importMatches.length - 1] : null;
  if (lastImport) {
    var at = lastImport.index + lastImport[0].length;
    content = content.slice(0, at) + '\n' + importLines + content.slice(at);
  } else {
    content = importLines + '\n' + content;
  }
  // Add FileStorageModule to imports + UploadController to controllers
  content = content.replace(/imports:\s*\[([^\]]*)\]/, function (m, inner) {
    var items = inner.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (items.indexOf('FileStorageModule') === -1) items.push('FileStorageModule');
    return 'imports: [' + items.join(', ') + ']';
  });
  content = content.replace(/controllers:\s*\[([^\]]*)\]/, function (m, inner) {
    var items = inner.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    items.push(entityPascal + 'UploadController');
    return 'controllers: [' + items.join(', ') + ']';
  });

  if (opts.dryRun) { console.log('  [dry] would update ' + path.relative(target, modulePath)); return; }
  fs.writeFileSync(modulePath, content);
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.spec)) process.exit(1);
  var yaml = loadYaml();
  var spec = yaml.parse(fs.readFileSync(args.spec, 'utf-8'));
  if (!spec || !Array.isArray(spec.uploads) || spec.uploads.length === 0) {
    console.log('scaffold-upload-module: no `uploads:` — skipping');
    return;
  }

  console.log('scaffold-upload-module: ' + spec.uploads.length + ' upload module(s)');
  for (var ui = 0; ui < spec.uploads.length; ui++) {
    var up = spec.uploads[ui];
    var entityPascal = up.entity || toPascal(up.name);
    var entityKebab = toKebab(entityPascal.replace(/([a-z])([A-Z])/g, '$1-$2'));
    var entityPlural = pluralize(entityKebab);
    var maxSize = up.max_size_mb || 10;
    var allowedMime = (up.allowed_mime || ['*/*']).map(function (m) { return "'" + m + "'"; }).join(', ');

    console.log('  ' + up.name + ' (storage=' + (up.storage || 'local') + ', max=' + maxSize + 'MB, mime=[' + (up.allowed_mime || []).join(',') + '])');

    var replacements = {
      '__Entity__': entityPascal,
      '__entity-kebab__': entityKebab,
      '__entities__': entityPlural,
      '__ALLOWED_MIME_CONST__': "const ALLOWED_MIME: string[] = [" + allowedMime + "];",
      '__MAX_SIZE_CONST__': "const MAX_SIZE_BYTES = " + maxSize + " * 1024 * 1024;",
      '__UPLOAD_DTO_IMPORT__': "import { Upload" + entityPascal + "Dto } from './" + entityKebab + "-upload.dto';",
      '__VALIDATOR_IMPORTS__': renderValidatorImports(up.fields || []),
      '__UPLOAD_FIELDS__': renderUploadFields(up.fields || []),
    };

    var uploadDir = path.join(args.target, 'src/modules', entityKebab + '-upload');
    var files = [
      { src: '__entity-kebab__-upload.controller.ts', dst: path.join(uploadDir, entityKebab + '-upload.controller.ts') },
      { src: '__entity-kebab__-upload.dto.ts', dst: path.join(uploadDir, entityKebab + '-upload.dto.ts') },
    ];
    for (var fi = 0; fi < files.length; fi++) {
      var srcPath = path.join(args.templates, files[fi].src);
      if (!fs.existsSync(srcPath)) { console.error('template missing: ' + srcPath); process.exit(2); }
      substituteFile(srcPath, files[fi].dst, replacements, args);
    }
    registerUploadInModule(args.target, entityKebab, entityPlural, entityPascal, args);
  }
  console.log('scaffold-upload-module: done');
}

main();
