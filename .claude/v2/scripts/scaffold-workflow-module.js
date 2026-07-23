#!/usr/bin/env node
//
// scaffold-workflow-module.js — generate state-machine modules from
// MODULE_PLAN.yaml workflows: section.
//
// Per workflow entry, emits:
//   src/modules/<entity-kebab>-workflow/<entity-kebab>.workflow.ts
//   src/modules/<entity-kebab>-workflow/<entity-kebab>-workflow.controller.ts
// Plus updates the existing <entity>/<entity>.module.ts to register the
// new workflow provider (additive — preserves LLM extensions).
//
// Wired in backend-2.yaml after scaffold-auth-module, before generate-tests.
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
    console.error('Usage: scaffold-workflow-module --spec MODULE_PLAN --target BACKEND_DIR --templates _workflow/');
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
function toKebab(s) {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
}
function pluralize(s) {
  if (/(s|x|z|ch|sh)$/i.test(s)) return s + 'es';
  if (/[^aeiou]y$/i.test(s)) return s.replace(/y$/i, 'ies');
  return s + 's';
}

function renderStateType(wf) {
  var entity = wf.entity;
  var states = wf.states || [];
  return 'export type ' + entity + 'State =\n  ' +
    states.map(function (s) { return "'" + s + "'"; }).join('\n  | ') + ';';
}

function renderActionType(wf) {
  var entity = wf.entity;
  var actions = [];
  var seen = {};
  for (var i = 0; i < (wf.transitions || []).length; i++) {
    var t = wf.transitions[i];
    if (!seen[t.action]) { seen[t.action] = true; actions.push(t.action); }
  }
  return 'export type ' + entity + 'Action =\n  ' +
    actions.map(function (a) { return "'" + a + "'"; }).join('\n  | ') + ';';
}

function renderTransitionsTable(wf) {
  var lines = [];
  for (var i = 0; i < (wf.transitions || []).length; i++) {
    var t = wf.transitions[i];
    var from = t.from === '*' ? "'*'" : "'" + t.from + "'";
    var to = "'" + t.to + "'";
    var action = "'" + t.action + "'";
    var entry = '  { from: ' + from + ', to: ' + to + ', action: ' + action;
    if (t.guard) entry += ", guard: '" + t.guard.replace(/'/g, "\\'") + "'";
    entry += ' },';
    lines.push(entry);
  }
  return lines.join('\n');
}

function substituteFile(srcPath, dstPath, replacements, opts) {
  var content = fs.readFileSync(srcPath, 'utf-8');
  // Marker-line first
  Object.keys(replacements).forEach(function (key) {
    var markerLine = new RegExp('^\\s*// ' + key.replace(/[.*+?^${}()|[\\\\]\\\\]/g, '\\$&') + '\\s*$', 'gm');
    content = content.replace(markerLine, function () { return replacements[key]; }); // v128: $-backreference-safe (RCA v126 row 17)
  });
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

function registerWorkflowInModule(target, entityKebab, entityPlural, entityPascal, opts) {
  // Update <entity>/<entity>.module.ts to register the workflow provider +
  // controller. The CRUD scaffold's module file looks like:
  //   @Module({
  //     imports: [TypeOrmModule.forFeature([Entity])],
  //     controllers: [EntityController],
  //     providers: [EntityService, EntityRepository],
  //     exports: [EntityService],
  //   })
  // We append EntityWorkflow to providers + EntityWorkflowController to controllers.
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
    console.log('  ⚠  no <entity>.module.ts found at expected paths — workflow controller will need manual registration');
    return;
  }
  var orig = fs.readFileSync(modulePath, 'utf-8');
  if (/Workflow[\s,}]/.test(orig)) {
    if (opts.verbose) console.log('  workflow already registered in ' + path.relative(target, modulePath));
    return;
  }

  // Compute relative import to workflow dir
  var workflowDir = path.join(target, 'src/modules', entityKebab + '-workflow');
  var relImport = path.relative(path.dirname(modulePath), workflowDir).replace(/\.ts$/, '');
  var workflowImport = "import { " + entityPascal + "Workflow } from '" + relImport + "/" + entityKebab + ".workflow';";
  var controllerImport = "import { " + entityPascal + "WorkflowController } from '" + relImport + "/" + entityKebab + "-workflow.controller';";

  var content = orig;
  // Inject imports after last existing import
  var importMatches = [...content.matchAll(/^import .*?;?\s*$/gm)];
  var lastImport = importMatches.length ? importMatches[importMatches.length - 1] : null;
  if (lastImport) {
    var insertAt = lastImport.index + lastImport[0].length;
    content = content.slice(0, insertAt) + '\n' + workflowImport + '\n' + controllerImport + content.slice(insertAt);
  } else {
    content = workflowImport + '\n' + controllerImport + '\n' + content;
  }
  // Insert into controllers + providers arrays
  content = content.replace(/controllers:\s*\[([^\]]*)\]/, function (m, inner) {
    var items = inner.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    items.push(entityPascal + 'WorkflowController');
    return 'controllers: [' + items.join(', ') + ']';
  });
  content = content.replace(/providers:\s*\[([^\]]*)\]/, function (m, inner) {
    var items = inner.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    items.push(entityPascal + 'Workflow');
    return 'providers: [' + items.join(', ') + ']';
  });

  if (opts.dryRun) {
    console.log('  [dry] would update ' + path.relative(target, modulePath));
    return;
  }
  fs.writeFileSync(modulePath, content);
  if (opts.verbose) console.log('  registered in ' + path.relative(target, modulePath));
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.spec)) { console.error('SPEC not found: ' + args.spec); process.exit(1); }
  if (!fs.existsSync(args.templates)) { console.error('templates dir missing: ' + args.templates); process.exit(2); }
  var yaml = loadYaml();
  var spec = yaml.parse(fs.readFileSync(args.spec, 'utf-8'));
  if (!spec || !Array.isArray(spec.workflows) || spec.workflows.length === 0) {
    console.log('scaffold-workflow-module: SPEC has no `workflows:` — skipping');
    return;
  }

  console.log('scaffold-workflow-module: ' + spec.workflows.length + ' workflow(s)');

  for (var wi = 0; wi < spec.workflows.length; wi++) {
    var wf = spec.workflows[wi];
    var entityPascal = wf.entity || toPascal(wf.name);
    var entityKebab = toKebab(entityPascal.replace(/([a-z])([A-Z])/g, '$1-$2'));
    var entityPlural = pluralize(entityKebab);
    var stateField = wf.state_field || 'currentState';

    console.log('  ' + wf.name + ' (' + entityPascal + ': ' + (wf.states || []).length + ' states, ' + (wf.transitions || []).length + ' transitions)');

    // Discover where the entity ACTUALLY lives (DB phase writes plural/entities/,
    // CRUD scaffold writes singular/). Compute relative import path from the
    // workflow's own dir.
    var workflowDir = path.join(args.target, 'src/modules', entityKebab + '-workflow');
    var entityCandidates = [
      path.join(args.target, 'src/modules', entityPlural, 'entities', entityKebab + '.entity.ts'),
      path.join(args.target, 'src/modules', entityKebab, entityKebab + '.entity.ts'),
      path.join(args.target, 'src/modules', entityKebab, 'entities', entityKebab + '.entity.ts'),
    ];
    var entityRel = entityKebab + '/' + entityKebab + '.entity';  // fallback
    var repoRel = entityKebab + '/' + entityKebab + '.repository';
    for (var ec = 0; ec < entityCandidates.length; ec++) {
      if (fs.existsSync(entityCandidates[ec])) {
        var relPath = path.relative(workflowDir, entityCandidates[ec]).replace(/\.ts$/, '');
        // Repository is sibling to entity (or one dir up if entity is in entities/)
        var repoPath = entityCandidates[ec].replace(/entities[\\\/]/, '').replace(/\.entity\.ts$/, '.repository.ts');
        if (!fs.existsSync(repoPath)) {
          // Try sibling to entity dir (database-phase layout sometimes lacks repository)
          repoPath = path.join(path.dirname(path.dirname(entityCandidates[ec])), entityKebab + '.repository.ts');
        }
        entityRel = relPath;
        repoRel = path.relative(workflowDir, repoPath).replace(/\.ts$/, '');
        break;
      }
    }

    var entityImports =
      "import { " + entityPascal + " } from '" + entityRel + "';\n" +
      "import { " + entityPascal + "Repository } from '" + repoRel + "';";

    var commonReplacements = {
      '__Entity__': entityPascal,
      '__entity-kebab__': entityKebab,
      '__entities__': entityPlural,
      '__STATE_FIELD__': stateField,
      '__STATE_TYPE__': renderStateType(wf),
      '__ACTION_TYPE__': renderActionType(wf),
      '__TRANSITIONS_TABLE__': renderTransitionsTable(wf),
      '__ENTITY_IMPORTS__': entityImports,
      '__ACTION_TYPE_IMPORT__': "import type { " + entityPascal + "Action } from './" + entityKebab + ".workflow';",
    };

    var workflowDir = path.join(args.target, 'src/modules', entityKebab + '-workflow');
    var files = [
      { src: '__entity-kebab__.workflow.ts', dst: path.join(workflowDir, entityKebab + '.workflow.ts') },
      { src: '__entity-kebab__-workflow.controller.ts', dst: path.join(workflowDir, entityKebab + '-workflow.controller.ts') },
    ];
    for (var fi = 0; fi < files.length; fi++) {
      var f = files[fi];
      var srcPath = path.join(args.templates, f.src);
      if (!fs.existsSync(srcPath)) {
        console.error('template missing: ' + srcPath);
        process.exit(2);
      }
      substituteFile(srcPath, f.dst, commonReplacements, args);
    }

    // Register the workflow in the entity's existing module file
    registerWorkflowInModule(args.target, entityKebab, entityPlural, entityPascal, args);
  }
  console.log('scaffold-workflow-module: done');
}

main();
