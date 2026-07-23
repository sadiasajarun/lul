#!/usr/bin/env node
// scaffold-upload-pages.js — file upload list + form pages from
// PAGES_PLAN.yaml upload_pages[]. Cross-references MODULE_PLAN.yaml's
// uploads[] for mime/size + metadata fields.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--plan') out.plan = argv[++i];
    else if (a === '--module-plan') out.modulePlan = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--templates') out.templates = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.plan || !out.target || !out.templates) {
    console.error('Usage: scaffold-upload-pages --plan PAGES_PLAN --module-plan MODULE_PLAN --target FRONTEND_DIR --templates _upload/');
    process.exit(1);
  }
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

function renderMetadataStateHooks(fields) {
  return fields.map(function (f) {
    return "  const [" + f.name + ", set" + cap(f.name) + "] = useState('');";
  }).join('\n');
}
function renderMetadataSubmitFields(fields) {
  return fields.map(function (f) { return '        ' + f.name + ','; }).join('\n');
}
function renderMetadataInputs(fields) {
  if (!fields || fields.length === 0) return '';
  var lines = [];
  fields.forEach(function (f) {
    var label = f.label || cap(f.name);
    var inputType = f.type === 'Date' ? 'date' : (f.type === 'number' ? 'number' : 'text');
    lines.push('        <div>');
    lines.push('          <Label htmlFor="' + f.name + '">' + label + '</Label>');
    lines.push('          <Input');
    lines.push('            id="' + f.name + '"');
    lines.push('            type="' + inputType + '"');
    lines.push('            value={' + f.name + '}');
    lines.push('            onChange={(e) => set' + cap(f.name) + '(e.target.value)}');
    if (!f.nullable) lines.push('            required');
    lines.push('            data-testid="__entity__-upload-' + f.name + '"');
    lines.push('          />');
    lines.push('        </div>');
  });
  return lines.join('\n');
}
function renderListHeaders(cols) {
  return cols.map(function (c) {
    return '              <th className="py-2 pr-4">' + (c.label || cap(c.name || c)) + '</th>';
  }).join('\n');
}
function renderListCells(cols) {
  return cols.map(function (c) {
    var n = c.name || c;
    return '                <td className="py-3 pr-4">{String((item as Record<string, unknown>).' + n + ' ?? \'\')}</td>';
  }).join('\n');
}

function substituteFile(srcPath, dstPath, replacements, opts) {
  if (!fs.existsSync(srcPath)) { console.error('template missing: ' + srcPath); process.exit(2); }
  var content = fs.readFileSync(srcPath, 'utf-8');
  Object.keys(replacements).forEach(function (key) {
    var esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var patterns = [
      new RegExp('^[ \\t]*// ' + esc + '[ \\t]*$', 'gm'),
      new RegExp('^[ \\t]*\\{/\\*\\s*' + esc + '\\s*\\*/\\}[ \\t]*$', 'gm'),
    ];
    patterns.forEach(function (re) {
      content = content.replace(re, function () { return replacements[key]; }); // v128: $-backreference-safe
    });
  });
  content = content.replace(/\n{3,}/g, '\n\n');
  Object.keys(replacements).forEach(function (key) {
    content = content.split(key).join(replacements[key]);
  });

  if (opts.dryRun) { console.log('  [dry] would write ' + path.relative(opts.target, dstPath)); return; }
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.writeFileSync(dstPath, content);
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.plan)) process.exit(1);
  var yaml = loadYaml();
  var plan = yaml.parse(fs.readFileSync(args.plan, 'utf-8'));
  var up = plan && plan.upload_pages;
  if (!Array.isArray(up) || up.length === 0) {
    console.log('scaffold-upload-pages: no upload_pages — skipping');
    return;
  }

  var uploads = [];
  if (args.modulePlan && fs.existsSync(args.modulePlan)) {
    var mp = yaml.parse(fs.readFileSync(args.modulePlan, 'utf-8'));
    uploads = (mp && mp.uploads) || [];
  }
  var byName = {};
  uploads.forEach(function (u) { byName[u.name] = u; });

  console.log('scaffold-upload-pages: ' + up.length + ' upload page set(s)');
  for (var i = 0; i < up.length; i++) {
    var page = up[i];
    var backend = byName[page.upload] || {};
    var entityPascal = backend.entity || toPascal(page.upload);
    var entityKebab = toKebab(entityPascal);
    var entitiesKebab = pluralize(entityKebab);
    var maxBytes = (backend.max_size_mb || 10) * 1024 * 1024;
    var mime = backend.allowed_mime || [];
    var fields = backend.fields || [];
    var listCols = (page.list_columns || [{ name: 'id' }].concat(fields.map(function (f) { return { name: f.name }; }))).map(function (c) {
      return typeof c === 'string' ? { name: c, label: cap(c) } : c;
    });

    console.log('  ' + page.upload + ' (' + entityPascal + ', list=' + (page.list !== false) + ', upload_form=' + (page.upload_form !== false) + ')');

    var entityCamel = entityPascal[0].toLowerCase() + entityPascal.slice(1);
    var replacements = {
      '__Entity__': entityPascal,
      '__entityCamel__': entityCamel,
      '__entity__': entityKebab,
      '__entities__': entitiesKebab,
      '__ALLOWED_MIME_LIST__': mime.map(function (m) { return "'" + m + "'"; }).join(', '),
      '__MAX_SIZE_BYTES__': String(maxBytes),
      '__METADATA_STATE_HOOKS__': renderMetadataStateHooks(fields),
      '__METADATA_SUBMIT_FIELDS__': renderMetadataSubmitFields(fields),
      '__METADATA_INPUTS__': renderMetadataInputs(fields),
      '__LIST_HEADERS__': renderListHeaders(listCols),
      '__LIST_CELLS__': renderListCells(listCols),
    };

    var FE = args.target;
    var TPL = args.templates;
    var files = [];
    if (page.list !== false) {
      files.push(['pages/__Entity__UploadListPage.tsx', path.join(FE, 'app/pages/' + entityKebab + '-upload/' + entityPascal + 'UploadListPage.tsx')]);
    }
    if (page.upload_form !== false) {
      files.push(['pages/__Entity__UploadFormPage.tsx', path.join(FE, 'app/pages/' + entityKebab + '-upload/' + entityPascal + 'UploadFormPage.tsx')]);
    }
    files.push(['services/api/__entity__UploadService.ts', path.join(FE, 'app/services/httpServices/' + entityKebab + 'UploadService.ts')]);
    files.push(['routes/__entity__-upload.routes.ts', path.join(FE, 'app/routes/' + entityKebab + '-upload.routes.ts')]);
    for (var fi = 0; fi < files.length; fi++) {
      substituteFile(path.join(TPL, files[fi][0]), files[fi][1], replacements, args);
    }
  }
  console.log('scaffold-upload-pages: done');
}

main();
