#!/usr/bin/env node
// scaffold-global-setup-type-doctor.js
// Fixes TypeScript + ESM errors in generated playwright.config.ts and
// tests/global-setup.ts files.
//
// In playwright.config.ts:
//   require.resolve('./tests/global-setup.ts') → './tests/global-setup.ts'
//   path.resolve(__dirname, './tests/global-setup.ts') → same
//   Reason: `require` and `__dirname` are not available in ESM projects
//   (package.json "type":"module"). Playwright accepts a plain string.
//
// In tests/global-setup.ts:
//   TS1484: 'FullConfig' is a type; must use import type when verbatimModuleSyntax
//     is on. Patch: split combined import into separate chromium + type-only import.
//   TS2345: sameSite: string not assignable to "Lax"|"Strict"|"None" in
//     context.addCookies(). Patch: narrow type annotation on cookie array.
//
// Usage:
//   node scaffold-global-setup-type-doctor.js --target <FRONTEND_DIR> [--dry-run] [--verbose]

'use strict';

var fs   = require('fs');
var path = require('path');

var args    = process.argv.slice(2);
var target  = null;
var dryRun  = false;
var verbose = false;

for (var i = 0; i < args.length; i++) {
  if (args[i] === '--target')   { target  = args[++i]; }
  if (args[i] === '--dry-run')  { dryRun  = true; }
  if (args[i] === '--verbose')  { verbose = true; }
}

if (!target) {
  console.error('Usage: scaffold-global-setup-type-doctor.js --target <FRONTEND_DIR> [--dry-run] [--verbose]');
  process.exit(1);
}

function findGlobalSetupFiles(dir) {
  var results = [];
  var testsDir = path.join(dir, 'tests');
  if (!fs.existsSync(testsDir)) return results;
  (function walk(d) {
    var entries = fs.readdirSync(d, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.isFile() && /global-setup/i.test(e.name) && /\.ts$/.test(e.name)) {
        results.push(path.join(d, e.name));
      }
    }
  })(testsDir);
  return results;
}

var files = findGlobalSetupFiles(target);
if (files.length === 0) {
  console.log('[scaffold-global-setup-type-doctor] no global-setup.ts found — skipping');
  process.exit(0);
}

var totalFixed = 0;

files.forEach(function (filePath) {
  var src     = fs.readFileSync(filePath, 'utf-8');
  var updated = src;
  var patches = 0;

  // Fix 1a: import { chromium, FullConfig } from '@playwright/test'
  if (/import\s+\{\s*chromium\s*,\s*FullConfig\s*\}/.test(updated)) {
    updated = updated.replace(
      /import\s+\{\s*chromium\s*,\s*FullConfig\s*\}\s+from\s+(['"])@playwright\/test\1/,
      "import { chromium } from '@playwright/test';\nimport type { FullConfig } from '@playwright/test'"
    );
    patches++;
  }

  // Fix 1b: import { FullConfig, chromium } from '@playwright/test'
  if (/import\s+\{\s*FullConfig\s*,\s*chromium\s*\}/.test(updated)) {
    updated = updated.replace(
      /import\s+\{\s*FullConfig\s*,\s*chromium\s*\}\s+from\s+(['"])@playwright\/test\1/,
      "import { chromium } from '@playwright/test';\nimport type { FullConfig } from '@playwright/test'"
    );
    patches++;
  }

  // Fix 1c: standalone import { FullConfig } (no chromium) and not already a type import
  if (/import\s+\{\s*FullConfig\s*\}\s+from\s+['"]@playwright\/test['"]/.test(updated) &&
      !/import\s+type\s+\{[^}]*FullConfig/.test(updated)) {
    updated = updated.replace(
      /import\s+\{\s*FullConfig\s*\}\s+from\s+(['"])@playwright\/test\1/,
      "import type { FullConfig } from '@playwright/test'"
    );
    patches++;
  }

  // Fix 2: sameSite: string in inline cookie type annotation
  // context.addCookies() expects sameSite?: "Lax" | "Strict" | "None"
  if (/\bsameSite\s*:\s*string\b/.test(updated)) {
    updated = updated.replace(/\bsameSite\s*:\s*string\b/g, 'sameSite?: "Lax" | "Strict" | "None"');
    patches++;
  }

  // Fix 3: broken cookie capture — headers()['set-cookie'] joins multiple Set-Cookie
  // headers with ',', breaking parsing. Replace with headersArray() approach.
  // Also fix: old scaffold template used page.request.post() + direct storageState()
  // without addCookies(), meaning browser context cookies were never populated.
  //
  // Two targeted fixes:
  // 3a) Replace resp.headers()['set-cookie'] with resp.headersArray() extraction
  // 3b) Add addCookies() before storageState() when the old template is detected
  //     (the old template: page.request.post -> context.storageState, no addCookies)
  var fix3done = false;

  // Fix 3a: replace broken headers()['set-cookie'] extraction
  if (/\bresp\.headers\(\)\s*\[/.test(updated) || /headers\[['"]set-cookie['"]\]/.test(updated)) {
    // Replace the old extraction block: from "const headers = resp.headers()" or
    // "headers['set-cookie']" through the end of the parsing block before addCookies.
    // We target the specific line patterns.
    var headers3aRe = /const headers\s*=\s*resp\.headers\(\);?\s*\n(\s*)const setCookieHeader[\s\S]*?(?=\n\s*(?:if|await|\/\/))/;
    var match3a = updated.match(headers3aRe);
    if (match3a) {
      var indent = match3a[1] || '      ';
      var replacement3a = [
        'const allHeaders = resp.headersArray();',
        indent + "const cookiesToAdd: Array<{ name: string; value: string; domain: string; path: string }> = [];",
        indent + 'for (const header of allHeaders) {',
        indent + "  if (header.name.toLowerCase() !== 'set-cookie') continue;",
        indent + "  const parts = header.value.split(';').map((p: string) => p.trim());",
        indent + "  const nameValue = parts[0] ?? '';",
        indent + "  const eqIdx = nameValue.indexOf('=');",
        indent + '  if (eqIdx < 0) continue;',
        indent + "  const cname = nameValue.substring(0, eqIdx).trim();",
        indent + "  const cvalue = nameValue.substring(eqIdx + 1).trim();",
        indent + "  if (cname && cvalue) cookiesToAdd.push({ name: cname, value: cvalue, domain: 'localhost', path: '/' });",
        indent + '}',
        indent + 'if (cookiesToAdd.length > 0) { await context.addCookies(cookiesToAdd); }',
      ].join('\n' + indent);
      var r3a = updated.replace(headers3aRe, replacement3a + '\n' + indent);
      if (r3a !== updated) { updated = r3a; patches++; fix3done = true; }
    }
  }

  // Fix 3b: old scaffold template — page.request.post + context.storageState with NO addCookies
  // The old scaffold stored 0 cookies because API response cookies never flowed to browser context.
  if (!fix3done &&
      /page\.request\.post\s*\(/.test(updated) &&
      /context\.storageState\s*\(/.test(updated) &&
      !/context\.addCookies\s*\(/.test(updated)) {
    // Replace "await context.storageState" with the headersArray extraction + addCookies + storageState
    var inject3b = [
      '// v110 doctor: extract Set-Cookie headers and inject into browser context.',
      '      // headersArray() handles multiple Set-Cookie headers; minimal attrs avoid',
      '      // Chrome dropping SameSite=None cookies on HTTP localhost.',
      '      const allHeaders = resp.headersArray();',
      "      const cookiesToAdd: Array<{ name: string; value: string; domain: string; path: string }> = [];",
      '      for (const header of allHeaders) {',
      "        if (header.name.toLowerCase() !== 'set-cookie') continue;",
      "        const parts = header.value.split(';').map((p: string) => p.trim());",
      "        const nameValue = parts[0] ?? '';",
      "        const eqIdx = nameValue.indexOf('=');",
      '        if (eqIdx < 0) continue;',
      "        const cname = nameValue.substring(0, eqIdx).trim();",
      "        const cvalue = nameValue.substring(eqIdx + 1).trim();",
      "        if (cname && cvalue) cookiesToAdd.push({ name: cname, value: cvalue, domain: 'localhost', path: '/' });",
      '      }',
      '      if (cookiesToAdd.length > 0) { await context.addCookies(cookiesToAdd); }',
      '      await context.storageState',
    ].join('\n      ');
    var r3b = updated.replace(/await context\.storageState/, function () { return inject3b; }); // v128: $-backreference-safe
    if (r3b !== updated) { updated = r3b; patches++; }
  }

  if (patches === 0) {
    if (verbose) console.log('  no changes: ' + path.relative(target, filePath));
    return;
  }

  if (verbose || dryRun) {
    console.log((dryRun ? '[dry-run] would patch' : 'patched') +
      ': ' + path.relative(target, filePath) + ' (' + patches + ' fix(es))');
  }
  if (!dryRun) {
    fs.writeFileSync(filePath, updated, 'utf-8');
    totalFixed++;
  }
});

console.log('[scaffold-global-setup-type-doctor] ' + totalFixed + '/' + files.length + ' global-setup file(s) patched');

// Also fix playwright.config.ts: require.resolve / path.resolve(__dirname) in globalSetup
// These fail in ESM projects (package.json "type":"module"). Playwright accepts plain string.
var playwrightConfigPath = path.join(target, 'playwright.config.ts');
if (fs.existsSync(playwrightConfigPath)) {
  var cfgSrc = fs.readFileSync(playwrightConfigPath, 'utf-8');
  var cfgUpdated = cfgSrc;
  var cfgPatches = 0;

  // require.resolve('./tests/global-setup.ts') → './tests/global-setup.ts'
  if (/globalSetup\s*:\s*require\.resolve\(/.test(cfgUpdated)) {
    cfgUpdated = cfgUpdated.replace(
      /globalSetup\s*:\s*require\.resolve\(\s*(['"])(\.\/tests\/global-setup\.ts)\1\s*\)/,
      "globalSetup: './tests/global-setup.ts'"
    );
    cfgPatches++;
  }

  // path.resolve(__dirname, './tests/global-setup.ts') → './tests/global-setup.ts'
  if (/globalSetup\s*:\s*path\.resolve\(__dirname/.test(cfgUpdated)) {
    cfgUpdated = cfgUpdated.replace(
      /globalSetup\s*:\s*path\.resolve\(__dirname\s*,\s*(['"])(\.\/tests\/global-setup\.ts)\1\s*\)/,
      "globalSetup: './tests/global-setup.ts'"
    );
    cfgPatches++;
  }

  if (cfgPatches > 0) {
    if (verbose || dryRun) {
      console.log((dryRun ? '[dry-run] would patch' : 'patched') +
        ': playwright.config.ts (' + cfgPatches + ' fix(es))');
    }
    if (!dryRun) fs.writeFileSync(playwrightConfigPath, cfgUpdated, 'utf-8');
  } else {
    if (verbose) console.log('  playwright.config.ts: no changes needed');
  }
}
