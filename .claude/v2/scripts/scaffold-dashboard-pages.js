#!/usr/bin/env node
// scaffold-dashboard-pages.js — dashboard pages (KPI cards + charts) from
// PAGES_PLAN.yaml dashboards[]. One page per dashboard. Each card/chart
// is a query string parsed client-side and POSTed to /dashboard/query.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--plan') out.plan = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--templates') out.templates = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.plan || !out.target || !out.templates) {
    console.error('Usage: scaffold-dashboard-pages --plan PAGES_PLAN --target FRONTEND_DIR --templates _dashboard/');
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
  return s.split(/[-_\s/]+/).filter(Boolean).map(function (w) { return cap(w.toLowerCase()); }).join('');
}
function toCamel(s) {
  var p = toPascal(s);
  return p ? p[0].toLowerCase() + p.slice(1) : p;
}
function escapeStr(s) { return s.replace(/'/g, "\\'"); }

function renderCardsArray(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return '';
  return cards.map(function (c) {
    return "  { title: '" + escapeStr(c.title) + "', query: '" + escapeStr(c.query) + "' },";
  }).join('\n');
}
function renderChartsArray(charts) {
  if (!Array.isArray(charts) || charts.length === 0) return '';
  return charts.map(function (c) {
    return "  { title: '" + escapeStr(c.title) + "', type: '" + (c.type || 'bar') + "', query: '" + escapeStr(c.query) + "' },";
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
    patterns.forEach(function (re) { content = content.replace(re, replacements[key]); });
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
  var ds = plan && plan.dashboards;
  if (!Array.isArray(ds) || ds.length === 0) {
    console.log('scaffold-dashboard-pages: no dashboards — skipping');
    return;
  }

  console.log('scaffold-dashboard-pages: ' + ds.length + ' dashboard(s)');

  // Always write the shared dashboard service (once)
  var FE = args.target;
  var TPL = args.templates;
  substituteFile(
    path.join(TPL, 'services/api/dashboardService.ts'),
    path.join(FE, 'app/services/httpServices/dashboardService.ts'),
    {}, args,
  );

  for (var i = 0; i < ds.length; i++) {
    var d = ds[i];
    var dashboardKebab = d.name;            // e.g. admin-overview
    var dashboardPascal = toPascal(d.name); // AdminOverview
    var dashboardCamel = toCamel(d.name);   // adminOverview
    var routePath = (d.route || '/' + d.name).replace(/^\//, '');

    console.log('  ' + dashboardKebab + ' (route=' + routePath + ', cards=' + ((d.cards||[]).length) + ', charts=' + ((d.charts||[]).length) + ')');

    var replacements = {
      '__Dashboard__': dashboardPascal,
      '__dashboardCamel__': dashboardCamel,
      '__dashboard__': dashboardKebab,
      '__route_path__': routePath,
      '__CARDS__': renderCardsArray(d.cards),
      '__CHARTS__': renderChartsArray(d.charts),
    };

    substituteFile(
      path.join(TPL, 'pages/__Dashboard__Page.tsx'),
      path.join(FE, 'app/pages/' + dashboardKebab + '/' + dashboardPascal + 'Page.tsx'),
      replacements, args,
    );

    // v72 fallback: ALSO write the same rendered page to the convention
    // the LLM-authored convert-pages step typically uses for admin
    // dashboards: `app/pages/admin/dashboard.tsx`. v71 evidence — admin
    // cell's convert-pages produced a 1-line stub there (because
    // emit-pages-plan failed → no dashboards: → no scaffold output → LLM
    // wrote a placeholder). With this override the scaffolded KPI cards
    // appear at the location routes.ts already wires.
    //
    // Only fires for dashboards whose name or route suggests admin/
    // overview — we don't want to overwrite a user-facing dashboard
    // that happens to live at the same path.
    if (/admin|overview/i.test(dashboardKebab) || /^\/?(admin|dashboard)\/?$/i.test(routePath)) {
      var fallbackPath = path.join(FE, 'app/pages/admin/dashboard.tsx');
      if (!fs.existsSync(fallbackPath) ||
          fs.readFileSync(fallbackPath, 'utf-8').length < 200) {
        substituteFile(
          path.join(TPL, 'pages/__Dashboard__Page.tsx'),
          fallbackPath,
          replacements, args,
        );
        console.log('    + fallback: app/pages/admin/dashboard.tsx');
      }
    }

    substituteFile(
      path.join(TPL, 'routes/__dashboard__.routes.ts'),
      path.join(FE, 'app/routes/' + dashboardKebab + '.routes.ts'),
      replacements, args,
    );
  }
  console.log('scaffold-dashboard-pages: done');
}

main();
