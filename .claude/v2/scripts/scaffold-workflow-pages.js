#!/usr/bin/env node
// scaffold-workflow-pages.js — workflow list + detail pages from
// PAGES_PLAN.yaml workflow_pages[]. Cross-references MODULE_PLAN.yaml's
// workflows[] for state_field + transitions table.
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
    console.error('Usage: scaffold-workflow-pages --plan PAGES_PLAN --module-plan MODULE_PLAN --target FRONTEND_DIR --templates _workflow/');
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

function renderListHeaders(cols, t) {
  return cols.map(function (c) {
    return '                  <th className="py-2 pr-4">' + (c.label || c) + '</th>';
  }).join('\n');
}
function renderListCells(cols) {
  return cols.map(function (c) {
    var name = c.name || c;
    return '                    <td className="py-3 pr-4">{String(item.' + name + ' ?? \'\')}</td>';
  }).join('\n');
}
function renderDetailFields(cols) {
  if (!cols || cols.length === 0) return '';
  var indent = '      ';
  var lines = [indent + '<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">'];
  cols.forEach(function (c) {
    var name = c.name || c;
    var label = c.label || cap(name);
    lines.push(indent + '  <dt className="text-muted-foreground">' + label + '</dt>');
    lines.push(indent + '  <dd data-testid="__entity__-field-' + name + '">{String((current as Record<string, unknown>).' + name + ' ?? \'\')}</dd>');
  });
  lines.push(indent + '</dl>');
  return lines.join('\n');
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

  if (opts.dryRun) {
    console.log('  [dry] would write ' + path.relative(opts.target, dstPath));
    return;
  }
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.writeFileSync(dstPath, content);
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.plan)) process.exit(1);
  var yaml = loadYaml();
  var plan = yaml.parse(fs.readFileSync(args.plan, 'utf-8'));
  var wp = plan && plan.workflow_pages;
  if (!Array.isArray(wp) || wp.length === 0) {
    console.log('scaffold-workflow-pages: no workflow_pages — skipping');
    return;
  }

  // Load MODULE_PLAN.workflows[] for cross-reference
  var workflows = [];
  if (args.modulePlan && fs.existsSync(args.modulePlan)) {
    var mp = yaml.parse(fs.readFileSync(args.modulePlan, 'utf-8'));
    workflows = (mp && mp.workflows) || [];
  }
  var workflowByName = {};
  workflows.forEach(function (w) { workflowByName[w.name] = w; });

  console.log('scaffold-workflow-pages: ' + wp.length + ' workflow page set(s)');
  for (var i = 0; i < wp.length; i++) {
    var page = wp[i];
    var backend = workflowByName[page.workflow] || {};
    var entityPascal = backend.entity || toPascal(page.workflow);
    var entityKebab = toKebab(entityPascal);
    var entitiesKebab = pluralize(entityKebab);
    var stateField = backend.state_field || 'currentState';
    var listCols = (page.list_columns || ['id']).map(function (c) {
      return typeof c === 'string' ? { name: c, label: cap(c) } : c;
    });

    console.log('  ' + page.workflow + ' (' + entityPascal + ', cols=' + listCols.map(function(c){return c.name;}).join(',') + ')');

    var entityCamel = entityPascal[0].toLowerCase() + entityPascal.slice(1);
    var replacements = {
      '__Entity__': entityPascal,
      '__Entities__': entityPascal + 's',
      '__entityCamel__': entityCamel,
      '__entity__': entityKebab,
      '__entities__': entitiesKebab,
      '__STATE_FIELD__': stateField,
      '__LIST_HEADERS__': renderListHeaders(listCols),
      '__LIST_CELLS__': renderListCells(listCols),
      '__DETAIL_FIELDS__': renderDetailFields(listCols),
    };

    var FE = args.target;
    var TPL = args.templates;
    var files = [
      ['pages/__Entity__WorkflowListPage.tsx',   path.join(FE, 'app/pages/' + entityKebab + '-workflow/' + entityPascal + 'WorkflowListPage.tsx')],
      ['pages/__Entity__WorkflowDetailPage.tsx', path.join(FE, 'app/pages/' + entityKebab + '-workflow/' + entityPascal + 'WorkflowDetailPage.tsx')],
      ['services/api/__entity__WorkflowService.ts', path.join(FE, 'app/services/httpServices/' + entityKebab + 'WorkflowService.ts')],
      ['routes/__entity__-workflow.routes.ts', path.join(FE, 'app/routes/' + entityKebab + '-workflow.routes.ts')],
    ];
    for (var fi = 0; fi < files.length; fi++) {
      substituteFile(path.join(TPL, files[fi][0]), files[fi][1], replacements, args);
    }
  }
  console.log('scaffold-workflow-pages: done');
}

main();
