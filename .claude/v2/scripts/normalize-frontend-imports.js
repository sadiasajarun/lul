#!/usr/bin/env node
//
// normalize-frontend-imports.js — fix common LLM-output import mistakes.
//
// v64 evidence: LLM-written pages frequently import from `react-router-dom`
// (the v6 path) instead of `react-router` (RR7 path); use FormField/FormItem/
// FormLabel/FormControl/FormMessage in JSX without importing them; etc.
//
// Idempotent: only rewrites known-bad patterns; preserves correct imports.
//
// Usage: normalize-frontend-imports --target FRONTEND_DIR [--dry-run]
//

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
  if (!out.target) { console.error('--target required'); process.exit(1); }
  return out;
}

function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.name === 'node_modules' || e.name === '.react-router' || e.name === 'dist' || e.name === 'build') continue;
    var full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && /\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

var FORM_IDENTIFIERS = ['FormField', 'FormItem', 'FormLabel', 'FormControl', 'FormMessage', 'FormDescription'];

function fixOne(filePath, opts) {
  var orig = fs.readFileSync(filePath, 'utf-8');
  var content = orig;

  // 1. react-router-dom → react-router (RR7 dropped the dom suffix)
  content = content.replace(/from\s+['"]react-router-dom['"]/g, "from 'react-router'");

  // 2. Ensure FormField/FormItem/etc imports are present when used in JSX
  // Only for .tsx files
  if (filePath.endsWith('.tsx')) {
    var usedFormIdents = FORM_IDENTIFIERS.filter(function (ident) {
      return new RegExp('<' + ident + '[\\s/>]').test(content);
    });
    if (usedFormIdents.length > 0) {
      // Check if they're already imported (from any path)
      var alreadyImported = FORM_IDENTIFIERS.filter(function (ident) {
        var re = new RegExp('import\\s+\\{[^}]*\\b' + ident + '\\b[^}]*\\}\\s+from');
        return re.test(content);
      });
      var missing = usedFormIdents.filter(function (i) { return alreadyImported.indexOf(i) === -1; });
      if (missing.length > 0) {
        var importLine = "import { " + missing.sort().join(', ') + " } from '~/components/ui/form';";
        // Insert after the last existing import statement
        var lastImportMatch = [...content.matchAll(/^import\s.*?;?\s*$/gm)].pop();
        if (lastImportMatch) {
          var insertAt = lastImportMatch.index + lastImportMatch[0].length;
          content = content.slice(0, insertAt) + '\n' + importLine + content.slice(insertAt);
        } else {
          content = importLine + '\n' + content;
        }
      }
    }
  }

  // 3. UUID type without typeorm import — common in LLM-written DTOs
  // If `UUID` appears as a type and isn't imported, change to `string` (the
  // safest fallback — TypeORM UUIDs are strings at runtime).
  if (/:\s*UUID\b/.test(content) && !/import.*\bUUID\b/.test(content)) {
    content = content.replace(/:\s*UUID\b/g, ': string');
  }

  if (content !== orig) {
    if (opts.dryRun) {
      console.log('  [dry] would modify ' + path.relative(opts.target, filePath));
      return true;
    }
    fs.writeFileSync(filePath, content);
    if (opts.verbose) console.log('  fixed ' + path.relative(opts.target, filePath));
    return true;
  }
  return false;
}

function main() {
  var args = parseArgs(process.argv);
  var appDir = path.join(args.target, 'app');
  var srcDir = path.join(args.target, 'src');
  var files = walk(appDir).concat(walk(srcDir));
  if (files.length === 0) {
    console.log('normalize-frontend-imports: no .ts/.tsx files found');
    return;
  }
  var fixed = 0;
  for (var i = 0; i < files.length; i++) {
    if (fixOne(files[i], args)) fixed++;
  }
  console.log('normalize-frontend-imports: scanned ' + files.length + ' files, fixed ' + fixed);
}

main();
