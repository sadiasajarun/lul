#!/usr/bin/env node
// ensure-pages-plan.js — v72 fallback. If PAGES_PLAN_<frontend>.yaml is
// missing or empty (typically because emit-pages-plan failed on mimo
// 429s or watchdog), derive a minimal-but-functional PAGES_PLAN from
// MODULE_PLAN.yaml so the downstream scaffold-{crud,auth,workflow,upload,
// dashboard}-pages nodes still run and produce real pages.
//
// v71 evidence: admin-dashboard cell's frontend phase aborted at
// emit-pages-plan, all scaffolds skipped, only LLM convert-shell stubs
// remained, 0/10 story pass rate. With this fallback the same failure
// mode produces a working set of scaffolded pages instead.
//
// The derived plan is NOT role-filtered — it lists every module from
// MODULE_PLAN. Routes per role are wired by scaffold-redux-and-routes +
// convert-wire-routes later in the phase; unused pages just remain as
// dead code that won't ship in the production bundle (Vite tree-shakes
// what routes.ts doesn't import).
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--module-plan') out.modulePlan = argv[++i];
    else if (a === '--pages-plan-out') out.pagesPlanOut = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.modulePlan || !out.pagesPlanOut) {
    console.error('Usage: ensure-pages-plan --module-plan MODULE_PLAN --pages-plan-out PAGES_PLAN');
    process.exit(1);
  }
  return out;
}

function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  return require(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim(), 'yaml'));
}

function looksValidPagesPlan(content) {
  // Has the minimum keys downstream scaffolds expect. We accept either a
  // `modules:` list or a `non_crud_modules:` list as evidence of a real
  // emit. An empty file or one with only auth_pages and nothing else is
  // treated as "broken" and replaced.
  if (!content || content.length < 30) return false;
  if (!/^\s*modules:\s*\n\s*-/m.test(content) &&
      !/^\s*non_crud_modules:/m.test(content) &&
      !/^\s*dashboards:/m.test(content)) {
    return false;
  }
  return true;
}

function deriveFromModulePlan(modulePlan) {
  var derived = {
    modules: [],
  };

  if (Array.isArray(modulePlan.modules)) {
    for (var i = 0; i < modulePlan.modules.length; i++) {
      var m = modulePlan.modules[i];
      if (!m || !m.name) continue;
      var fields = [];
      var moduleFields = m.fields || [];
      for (var fi = 0; fi < moduleFields.length; fi++) {
        var f = moduleFields[fi];
        if (!f || !f.name) continue;
        // Hide sensitive columns from frontend page set entirely
        if (/password|secret|token/i.test(f.name)) continue;
        var pf = {
          name: f.name,
          label: f.label || (f.name[0].toUpperCase() + f.name.slice(1)),
          type: f.type === 'string' && /datetime|timestamp/i.test(JSON.stringify(f)) ? 'datetime' : (f.type || 'string'),
          list: true,
          form: true,
        };
        if (f.type === 'enum' && Array.isArray(f.enumValues)) pf.enumValues = f.enumValues;
        // Map MODULE_PLAN validators (IsEmail / MaxLength:N / etc.) to
        // PAGES_PLAN validators (lowercase tokens / minLength:N).
        var validators = [];
        var src = f.validators || [];
        for (var vi = 0; vi < src.length; vi++) {
          var v = src[vi];
          var name = typeof v === 'string' ? v : (v && v.name);
          if (!name) continue;
          if (/^IsEmail$/i.test(name)) validators.push('email');
          else if (/^IsNotEmpty$|^IsString$/i.test(name)) validators.push('required');
          else if (/^IsOptional$/i.test(name)) validators.push('optional');
          else if (/^MinLength:(\d+)$/i.test(name)) validators.push('minLength:' + RegExp.$1);
          else if (/^MaxLength:(\d+)$/i.test(name)) validators.push('maxLength:' + RegExp.$1);
        }
        if (validators.length) pf.validators = validators;
        fields.push(pf);
      }

      derived.modules.push({
        name: m.name,
        entity: m.entity || m.name,
        plural: m.plural || (m.name + 's'),
        role_required: m.role_required || null,
        fields: fields,
      });
    }
  }

  // Auth: always enable login + forgot-password; signup + verify-email per
  // MODULE_PLAN.auth section. Conservative defaults that work everywhere.
  if (modulePlan.auth) {
    derived.auth_pages = {
      login: true,
      signup: true,
      forgot_password: true,
      verify_email: false,
    };
  }

  // Workflow pages: one per workflow declared in MODULE_PLAN.workflows.
  if (Array.isArray(modulePlan.workflows) && modulePlan.workflows.length > 0) {
    derived.workflow_pages = modulePlan.workflows.map(function (w) {
      var transitions = (w.transitions || []).map(function (t) { return t.action; }).filter(Boolean);
      return {
        workflow: w.name,
        list_columns: ['id', 'currentState', 'updatedAt'],
        transition_buttons: transitions.slice(0, 6),
        role_required: 'admin',
      };
    });
  }

  // Upload pages: one per uploads[] entry in MODULE_PLAN.
  if (Array.isArray(modulePlan.uploads) && modulePlan.uploads.length > 0) {
    derived.upload_pages = modulePlan.uploads.map(function (u) {
      return {
        upload: u.name,
        list: true,
        upload_form: true,
        role_required: 'user',
      };
    });
  }

  // Dashboards: emit a generic admin overview if MODULE_PLAN suggests
  // multiple entities. Pulls KPI queries from the first 4 entities.
  if (Array.isArray(modulePlan.modules) && modulePlan.modules.length >= 2) {
    var firstFew = modulePlan.modules.slice(0, 4);
    derived.dashboards = [{
      name: 'admin-overview',
      route: '/admin',
      role_required: 'admin',
      cards: firstFew.map(function (m) {
        return { title: 'Total ' + (m.plural || (m.name + 's')), query: 'count:' + (m.plural || (m.name + 's')) };
      }),
      charts: [],
    }];
  }

  return derived;
}

function main() {
  var args = parseArgs(process.argv);
  var yaml = loadYaml();

  if (!fs.existsSync(args.modulePlan)) {
    console.log('ensure-pages-plan: no MODULE_PLAN at ' + args.modulePlan + ' — skipping');
    return;
  }

  var existing = '';
  if (fs.existsSync(args.pagesPlanOut)) {
    existing = fs.readFileSync(args.pagesPlanOut, 'utf-8');
    if (looksValidPagesPlan(existing)) {
      console.log('ensure-pages-plan: ' + path.basename(args.pagesPlanOut) + ' already exists with content (' + existing.length + ' bytes) — keeping LLM output');
      return;
    }
    console.log('ensure-pages-plan: ' + path.basename(args.pagesPlanOut) + ' exists but looks incomplete (' + existing.length + ' bytes) — deriving from MODULE_PLAN');
  } else {
    console.log('ensure-pages-plan: ' + path.basename(args.pagesPlanOut) + ' missing (likely emit-pages-plan failed) — deriving from MODULE_PLAN');
  }

  var modulePlan = yaml.parse(fs.readFileSync(args.modulePlan, 'utf-8')) || {};
  var derived = deriveFromModulePlan(modulePlan);

  if (args.verbose) {
    console.log('  derived: modules=' + (derived.modules || []).length +
                ', auth_pages=' + (derived.auth_pages ? 'yes' : 'no') +
                ', workflow_pages=' + (derived.workflow_pages || []).length +
                ', upload_pages=' + (derived.upload_pages || []).length +
                ', dashboards=' + (derived.dashboards || []).length);
  }

  var header = '# Derived by ensure-pages-plan from MODULE_PLAN.yaml.\n' +
               '# This file was generated because emit-pages-plan did not produce\n' +
               '# a usable PAGES_PLAN (LLM failure / 429 / watchdog). The shape is\n' +
               '# intentionally generous: every MODULE_PLAN module is listed so\n' +
               '# scaffold-crud-pages generates a full page set. Routes.ts will\n' +
               '# decide which pages are actually wired per-role.\n\n';

  var out = header + yaml.stringify(derived);
  if (args.dryRun) {
    console.log('  [dry] would write ' + args.pagesPlanOut + ' (' + out.length + ' bytes)');
    return;
  }
  fs.mkdirSync(path.dirname(args.pagesPlanOut), { recursive: true });
  fs.writeFileSync(args.pagesPlanOut, out);
  console.log('  ✓ wrote derived PAGES_PLAN (' + out.length + ' bytes)');
}

main();
