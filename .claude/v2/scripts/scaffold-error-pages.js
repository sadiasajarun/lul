#!/usr/bin/env node
// scaffold-error-pages.js — writes the canonical 404 page every project
// needs (RULE-F4). Project-agnostic — no MODULE_PLAN required.
//
// Files written (skipped if they already exist):
//   <FRONTEND_DIR>/app/pages/not-found.tsx
//
// Adds missing i18n keys (notFound.{title,description,home}) into the
// existing common.json locale files so the page never renders raw keys.
//
// Does NOT write an ErrorBoundary: the canonical root.tsx already exports
// one (it's RR7's convention to handle errors at the root level).
//
// Does NOT touch routes.ts — the canonical scaffold-frontend-shell
// already ships routes.ts with `route("*", "pages/not-found.tsx")`.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--templates') out.templates = argv[++i];
    else if (a === '--default-locale') out.defaultLocale = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target || !out.templates) {
    console.error('Usage: scaffold-error-pages --target FRONTEND_DIR --templates pages/_error [--default-locale ko]');
    process.exit(1);
  }
  out.defaultLocale = out.defaultLocale || 'ko';
  return out;
}

function copyIfMissing(src, dst, opts) {
  if (!fs.existsSync(src)) {
    console.error('  template missing: ' + src);
    return false;
  }
  if (fs.existsSync(dst)) {
    if (opts.verbose) console.log('  skip (exists): ' + path.relative(opts.target, dst));
    return false;
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

function ensureCommonKeys(target, opts) {
  // Inject notFound.{title,description,home} into common.json if absent.
  // Two locales: en + default. Won't overwrite existing translations.
  var locales = ['en'];
  if (opts.defaultLocale !== 'en') locales.push(opts.defaultLocale);

  var defaults = {
    en: { notFound: { title: 'Page not found', description: "The page you're looking for doesn't exist or has been moved.", home: 'Back to home' } },
    ko: { notFound: { title: '페이지를 찾을 수 없습니다', description: '찾으시는 페이지가 존재하지 않거나 이동되었습니다.', home: '홈으로 돌아가기' } },
    ja: { notFound: { title: 'ページが見つかりません', description: 'お探しのページは存在しないか、移動された可能性があります。', home: 'ホームに戻る' } },
  };

  for (var li = 0; li < locales.length; li++) {
    var loc = locales[li];
    var file = path.join(target, 'app/i18n/locales', loc, 'common.json');
    if (!fs.existsSync(file)) {
      if (opts.verbose) console.log('  skip (no ' + loc + '/common.json yet): ' + path.relative(target, file));
      continue;
    }
    var existing = {};
    try { existing = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (_) { existing = {}; }
    var addPack = defaults[loc] || defaults.en;
    var changed = false;
    if (!existing.notFound) {
      existing.notFound = {};
      changed = true;
    }
    ['title', 'description', 'home'].forEach(function (k) {
      if (existing.notFound[k] === undefined) {
        existing.notFound[k] = addPack.notFound[k];
        changed = true;
      }
    });
    if (!changed) {
      if (opts.verbose) console.log('  ' + loc + '/common.json — notFound.* already present');
      continue;
    }
    if (opts.dryRun) {
      console.log('  [dry] would update ' + path.relative(target, file));
      continue;
    }
    fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n');
    console.log('  ↻ added notFound.* keys to ' + loc + '/common.json');
  }
}

function main() {
  var args = parseArgs(process.argv);
  console.log('scaffold-error-pages: target=' + args.target);

  copyIfMissing(
    path.join(args.templates, 'not-found.tsx'),
    path.join(args.target, 'app/pages/not-found.tsx'),
    args,
  );
  ensureCommonKeys(args.target, args);
  console.log('scaffold-error-pages: done');
}

main();
