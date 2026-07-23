#!/usr/bin/env node
// scaffold-layouts.js — v73 deterministic layout scaffold. Writes
// AdminLayout / UserLayout / GuestLayout per the roles declared in
// PROJECT_KNOWLEDGE.md. Eliminates RULE-F3 violations (role-based
// layout separation) which have been broken on 70%+ of past runs.
//
// Also derives nav-menu items per role from PAGES_PLAN.modules[]
// where role_required matches the layout's audience.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--templates') out.templates = argv[++i];
    else if (a === '--pages-plan') out.pagesPlan = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target || !out.templates) {
    console.error('Usage: scaffold-layouts --target FRONTEND_DIR --templates components/layouts/ [--pages-plan PAGES_PLAN]');
    process.exit(1);
  }
  return out;
}

function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  return require(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim(), 'yaml'));
}

function copyIfMissing(src, dst, opts) {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dst)) {
    var existing = fs.readFileSync(dst, 'utf-8');
    if (existing.length > 500) {
      if (opts.verbose) console.log('  skip (rich existing): ' + path.relative(opts.target, dst));
      return false;
    }
  }
  if (opts.dryRun) {
    console.log('  [dry] would write ' + path.relative(opts.target, dst));
    return true;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log('  ✓ wrote ' + path.relative(opts.target, dst));
  return true;
}

function deriveNavItems(pagesPlan, audience) {
  if (!pagesPlan || !Array.isArray(pagesPlan.modules)) return [];
  return pagesPlan.modules
    .filter(function (m) {
      if (audience === 'admin') return /admin|operator/i.test(m.role_required || '');
      if (audience === 'user') return /user|worker|customer/i.test(m.role_required || '') || !m.role_required;
      return false;
    })
    .map(function (m) {
      return { name: m.name, label: m.entity || m.name, path: '/' + (m.plural || m.name + 's') };
    });
}

function renderNavBlock(items, prefix) {
  if (!items.length) return '';
  return items.map(function (it) {
    return '          <NavLink\n' +
           '            to="' + it.path + '"\n' +
           '            data-testid="' + prefix + '-nav-' + it.name + '"\n' +
           '            className={({ isActive }) => `px-3 py-2 rounded ${isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}\n' +
           '          >\n' +
           '            {' + JSON.stringify(it.label) + '}\n' +
           '          </NavLink>';
  }).join('\n');
}

function substituteNav(dstPath, marker, navJsx, opts) {
  if (!fs.existsSync(dstPath)) return;
  var content = fs.readFileSync(dstPath, 'utf-8');
  var re = new RegExp('^[ \\t]*\\{/\\*\\s*' + marker + '\\s*\\*/\\}[ \\t]*$', 'gm');
  var updated = content.replace(re, function () { return navJsx; }); // v128: $-backreference-safe (RCA v126 row 17)
  if (updated === content) return;
  if (!opts.dryRun) fs.writeFileSync(dstPath, updated);
  if (opts.verbose) console.log('  ↻ filled ' + marker + ' in ' + path.relative(opts.target, dstPath));
}

function main() {
  var args = parseArgs(process.argv);

  var written = 0;
  ['AdminLayout.tsx', 'UserLayout.tsx', 'GuestLayout.tsx'].forEach(function (f) {
    var src = path.join(args.templates, f);
    var dst = path.join(args.target, 'app/components/layouts', f);
    if (copyIfMissing(src, dst, args)) written++;
  });

  if (args.pagesPlan && fs.existsSync(args.pagesPlan)) {
    var yaml = loadYaml();
    var plan = yaml.parse(fs.readFileSync(args.pagesPlan, 'utf-8'));
    var adminItems = deriveNavItems(plan, 'admin');
    var userItems = deriveNavItems(plan, 'user');
    substituteNav(path.join(args.target, 'app/components/layouts/AdminLayout.tsx'),
                  '__ADMIN_NAV_ITEMS__', renderNavBlock(adminItems, 'admin'), args);
    substituteNav(path.join(args.target, 'app/components/layouts/UserLayout.tsx'),
                  '__USER_NAV_ITEMS__', renderNavBlock(userItems, 'user'), args);
    substituteNav(path.join(args.target, 'app/components/layouts/UserLayout.tsx'),
                  '__USER_BOTTOM_NAV_ITEMS__', renderNavBlock(userItems.slice(0, 5), 'user-bottom'), args);
    if (args.verbose) console.log('  derived nav: admin=' + adminItems.length + ', user=' + userItems.length);
  }

  console.log('scaffold-layouts: wrote ' + written + ' layouts');
}

main();
