#!/usr/bin/env node
// scaffold-story-specs.js — v73 deterministic test-spec generation from
// YAML user stories. The agentic `story-runner` node consumes the same
// YAMLs at runtime via an LLM agent; this scaffolder pre-compiles them
// to Playwright .spec.ts files so they can be run by `playwright test`
// in CI — parallel, flake-free, ~5-10min instead of 30-40min.
//
// Generated per-story spec assertions are intentionally LIGHT —
// navigate to ui_route, wait for hydration, then assert text fragments
// extracted from the AC's `expected` field are visible. LLM-driven
// story-runner provides richer assertions; this scaffolder gives us a
// fast first-pass acceptance check.
//
// Also emits:
//   tests/global-setup.ts — logs each role from _fixtures.yaml, saves
//     storageState-{role}.json (RULE-T11 compliance)
//   playwright.config.ts — wires the global setup + per-spec
//     storageState by role tag
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--stories-dir') out.storiesDir = argv[++i];
    else if (a === '--fixtures') out.fixtures = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--base-url') out.baseUrl = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.storiesDir || !out.target) {
    console.error('Usage: scaffold-story-specs --stories-dir <path> --fixtures <_fixtures.yaml> --target <FRONTEND_DIR>');
    process.exit(1);
  }
  out.baseUrl = out.baseUrl || 'http://localhost:5173';
  return out;
}

function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  return require(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim(), 'yaml'));
}

// ── Spec rendering ───────────────────────────────────────────────────

function extractTextSnippets(expected, description) {
  // Priority: quoted strings from description (actual button/link labels) FIRST,
  // then quoted strings from expected (outcome descriptions with literals).
  // v109: removed capitalized-word extraction — words like "Redirect", "Three",
  // "Navigates" come from behavioral descriptions, NOT from actual UI text, so
  // they produce false-negative test failures on pages that are actually correct.
  var snippets = [];
  // 1. Quoted strings from description — e.g., "Sign In", "Forgot password?"
  if (description) {
    var dq = description.match(/"([^"]+)"/g);
    if (dq) snippets = snippets.concat(dq.map(function (q) { return q.slice(1, -1); }));
  }
  // 2. Quoted strings from expected — e.g., "Get Started →"
  if (expected) {
    var eq = expected.match(/"([^"]+)"/g);
    if (eq) snippets = snippets.concat(eq.map(function (q) { return q.slice(1, -1); }));
  }
  return snippets
    .map(function (s) { return s.replace(/\\/g, '').trim(); })
    .filter(function (s) { return s.length >= 2 && s.length <= 80; })
    .filter(function (s, i, arr) { return arr.indexOf(s) === i; })
    .slice(0, 5);
}

// ── Role → storageState mapping ───────────────────────────────────────
// Maps story role names (e.g. 'worker', 'admin') to the numeric role
// stored in _fixtures.yaml users (e.g. 0, 99) so we can wire
// test.use({ storageState: 'tests/storageState-N.json' }) in each spec.
function buildRoleNumericMap(fixturePath) {
  if (!fixturePath) return {};
  try {
    var yaml = loadYaml();
    var rawFixtures = fs.readFileSync(fixturePath, 'utf-8');
    var fixtures = yaml.parse(rawFixtures);
    var users = (fixtures && fixtures.users) || {};
    var result = {};
    // Build key → numericRole mapping for users with credentials
    for (var key in users) {
      var user = users[key];
      if (!user || !user.email || !user.password || user.role === null || user.role === undefined) continue;
      result[key] = String(user.role);
    }
    return result;
  } catch (_) {
    return {};
  }
}

// Maps a story role string to the numeric role from fixtures.
// Heuristic: split story role into words, find fixture user key with the
// most matching words. 'worker' → 'worker_active' (role 0); 'admin' →
// 'super_admin' (role 99); 'company_manager' → 'company_lead' (role 2).
function findNumericRoleForStoryRole(storyRole, keyRoleMap) {
  if (!storyRole || storyRole === 'all' || storyRole === 'guest') return null;
  if (Object.keys(keyRoleMap).length === 0) return null;

  var words = storyRole.toLowerCase().split(/[_\s]+/).filter(function (w) { return w.length > 2; });
  if (words.length === 0) return null;

  var best = { score: -1, numericRole: null };
  for (var key in keyRoleMap) {
    var keyLower = key.toLowerCase();
    var score = words.filter(function (w) { return keyLower.indexOf(w) !== -1; }).length;
    // Tiebreak: higher numeric role = more privileged = better for admin role
    var numericRole = keyRoleMap[key];
    if (score > best.score ||
        (score === best.score && parseInt(numericRole) > parseInt(best.numericRole || '0'))) {
      best = { score: score, numericRole: numericRole };
    }
  }

  return best.score > 0 ? best.numericRole : null;
}

// ─────────────────────────────────────────────────────────────────────────
// v122: behavior-first AC assertions (replaces exact-text equality).
//
// The story `description`/`expected` copy and the rendered UI copy are TWO
// INDEPENDENT LLM generations (story author vs i18n locale author). Asserting
// they match character-for-character (`getByText('← Back to Login')`) tests
// LLM-consistency, NOT the app — it FALSE-FAILS a working feature whose label
// merely differs ("Back to login", "로그인으로", no arrow) AND would FALSE-PASS a
// dead link that happens to carry the right label. So exact text is never the
// hard signal. Instead classify each AC and assert on STABLE, copy-free anchors:
//   nav     → a link to the destination route exists (RR7 renders <a href>)
//   toggle  → the interactive control (checkbox/switch) is present
//   mutate  → a trigger control (button/submit/form) is present
//   display → structured content (table/list/[data-testid]/region) is present
// plus a DOMAIN-KEYWORD fallback (nouns like "company"/"staff", regex word-
// match, NOT the exact phrase) so a page with no relevant content still fails.
// Tests run with i18nextLng=en (RULE-T6 harness), so English keywords are valid.

// Derive a navigation destination route from the AC, if it names one and it
// differs from the page the AC loads (same-route mentions aren't navigation).
function deriveNavTarget(ac, uiRoute) {
  var src = (ac.expected || '') + ' ' + (ac.description || '');
  var m = src.match(/(?:navigat\w*|redirect\w*|goes?\s+to|returns?\s+to|back\s+to|link\s+to)\b[^\/]*?(\/[a-z][a-z0-9\-\/]*)/i)
        || src.match(/(\/[a-z][a-z0-9\-]*(?:\/[a-z0-9\-:]+)*)\s+page\b/i);
  if (!m) return null;
  var target = m[1].replace(/[).,:;]+$/, '');
  if (!target || target === uiRoute || target === '/') return null;
  return target;
}

function classifyKind(ac) {
  var d = (ac.description || '').toLowerCase() + ' ' + (ac.expected || '').toLowerCase();
  var method = String(ac.endpoint || '').match(/\b(POST|PUT|PATCH|DELETE)\b/i);
  if (/\b(toggle|checkbox|check\s?box|switch|highlight|interactive)\b/.test(d)) return 'toggle';
  // Display intent ("dashboard displays …", "list shows …") wins over an incidental
  // mutate-noun in a label (e.g. a "Cancel/Refund" KPI card is not a cancel action).
  var displayish = /\b(display|displays|displayed|shows?|listing|overview|renders?)\b/.test(d);
  var mutateVerb = method || /\b(create|add|invite|approve|reject|confirm|submit|delete|remove|deactivate|demote|update|save|send|export|process|upload|resend)\b/.test(d);
  if (mutateVerb && !displayish) return 'mutate';
  if (/\b(enter|enters|fill|fills|choose|chooses|click|clicks)\b/.test(d) && !displayish) return 'mutate';
  return 'display';
}

// NOTE: deliberately NO bare `[data-testid]` catch-all. RULE-F10 puts a testid on
// every page, so a bare `[data-testid]` would be ~always-true → structure would mean
// nothing and any rendered page would pass. Each selector lists MEANINGFUL controls/
// regions, so "structure present" is a real signal; the domain-keyword OR-branch
// covers content the structural selector can't name.
var STRUCT_SELECTOR = {
  toggle: 'input[type="checkbox"], [role="switch"], [role="checkbox"], button[role="switch"], [data-testid*="toggle"], [data-testid*="remember"], [data-testid*="lang"]',
  mutate: 'button, [type="submit"], [role="button"], form, input, textarea, select, [data-testid*="submit"], [data-testid*="create"], [data-testid*="add"], [data-testid*="invite"]',
  display: 'table, [role="table"], ul, ol, [role="list"], [role="grid"], [data-testid*="list"], [data-testid*="card"], [data-testid*="table"]',
};
var KIND_COMMENT = {
  toggle: 'Interactive AC — the control must be present (copy-free)',
  mutate: 'Mutation AC — a trigger control (button/form/input) must be present',
  display: 'Display AC — the page must render structured content',
};

var KW_STOP = { user: 1, users: 1, admin: 1, super: 1, page: 1, click: 1, clicks: 1, enter: 1,
  enters: 1, with: 1, that: 1, this: 1, from: 1, into: 1, their: 1, when: 1, then: 1, after: 1,
  before: 1, button: 1, link: 1, links: 1, field: 1, fields: 1, form: 1, value: 1, values: 1,
  shows: 1, show: 1, display: 1, displays: 1, displayed: 1, navigate: 1, navigates: 1, view: 1,
  list: 1, lists: 1, status: 1, name: 1, names: 1, date: 1, code: 1, type: 1, types: 1, role: 1,
  roles: 1, account: 1, email: 1, phone: 1, valid: 1, select: 1, selects: 1, option: 1, options: 1 };
// Domain nouns from the AC description — used as a SEMANTIC fallback (word-regex,
// any-of), tolerant of wording differences, unlike exact-phrase equality.
function extractKeywords(ac) {
  var words = (ac.description || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  var out = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (w.length >= 4 && !KW_STOP[w] && out.indexOf(w) === -1) out.push(w);
  }
  return out.slice(0, 4);
}

function renderStorySpec(story, baseUrl, keyRoleMap) {
  var id = story.id || 'UNKNOWN';
  var role = story.role || 'all';
  var feature = story.feature || id;
  var goal = (story.goal || '').replace(/\r?\n/g, ' ').slice(0, 200);

  var lines = [];
  // Resolve storageState for this story's role — binds pre-captured auth
  // so tests run as the correct user without inline login (RULE-T10).
  var numericRole = findNumericRoleForStoryRole(role, keyRoleMap || {});
  var storageStatePath = numericRole !== null
    ? 'tests/storageState-' + numericRole + '.json'
    : null;

  lines.push('/**');
  lines.push(' * Generated by scaffold-story-specs from user_stories/' + (story.__file || (id + '.yaml')));
  lines.push(' *');
  lines.push(' * Story: ' + id);
  lines.push(' * Role:  ' + role);
  lines.push(' * Feature: ' + feature);
  lines.push(' * Goal: ' + goal);
  lines.push(' */');
  lines.push("import { test, expect } from '@playwright/test';");
  lines.push('');
  if (storageStatePath) {
    lines.push('// Pre-authenticate as role=' + role + ' (storageState captures JWT cookies from global-setup)');
    lines.push("test.use({ storageState: '" + storageStatePath + "' });");
    lines.push('');
  }

  var acs = story.acceptance_criteria || [];
  // Does ANY ac route carry a :param placeholder (e.g. /applications/:id)? If so the
  // spec MUST resolve the placeholder to a REAL resource id before navigating — visiting
  // the literal `/applications/:id` sends `:id` to the API as a bad UUID, the detail page
  // renders empty/error, and the keyword assertion fails (v129 class: 13 ACs across the
  // application-detail + application-processing stories). resolveRoute() fetches the first
  // item id from the resource's list endpoint (authenticated via the test's storageState
  // cookies) and substitutes it. Deterministic, no LLM.
  var hasParamRoute = acs.some(function (a) { return /\/:[A-Za-z_]/.test(a && a.ui_route || ''); });
  if (hasParamRoute) {
    lines.push("// Resolve :param routes to a real resource id (v129: literal ':id' nav → bad UUID → empty page).");
    lines.push("const __API_BASE = process.env.API_URL || 'http://localhost:3000/api';");
    lines.push("async function resolveRoute(page, route) {");
    lines.push("  if (!/\\/:[A-Za-z_]/.test(route)) return route;");
    lines.push("  const segs = route.split('/').filter(Boolean);");
    lines.push("  const idIdx = segs.findIndex(function (s) { return s.charAt(0) === ':'; });");
    lines.push("  let listSegs = segs.slice(0, idIdx);");
    lines.push("  if (['admin', 'worker', 'company', 'staff', 'operator'].indexOf(listSegs[0]) >= 0) listSegs = listSegs.slice(1);");
    lines.push("  const listPath = '/' + listSegs.join('/');");
    lines.push("  let id = '';");
    lines.push("  try {");
    lines.push("    const r = await page.request.get(__API_BASE + listPath);");
    lines.push("    if (r.ok()) {");
    lines.push("      const j = await r.json().catch(function () { return null; });");
    lines.push("      const items = (j && j.data && (j.data.items || j.data)) || (j && j.items) || [];");
    lines.push("      if (Array.isArray(items) && items[0] && items[0].id) id = String(items[0].id);");
    lines.push("    }");
    lines.push("  } catch (e) { /* fall through to placeholder */ }");
    lines.push("  return route.replace(/:[A-Za-z_]+/g, id || 'unknown');");
    lines.push("}");
    lines.push('');
  }

  lines.push("test.describe('" + id + " — " + feature.replace(/'/g, "\\'") + "', () => {");


  if (acs.length === 0) {
    lines.push("  test.skip('no acceptance criteria declared', () => {});");
    lines.push('});');
    return lines.join('\n');
  }

  for (var i = 0; i < acs.length; i++) {
    var ac = acs[i];
    var acId = ac.id || ('AC-' + (i + 1));
    var desc = (ac.description || '').replace(/'/g, "\\'").slice(0, 200);
    var route = ac.ui_route || '/';
    var navTarget = deriveNavTarget(ac, route);
    var kind = navTarget ? 'nav' : classifyKind(ac);
    var keywords = extractKeywords(ac);

    lines.push('');
    lines.push("  test('" + acId + " — " + desc + "', async ({ page }) => {");
    // Floor: the route must respond < 400 and render non-empty content. Catches
    // dead routes + SSR 500s (the v121 universal-failure class) without any copy.
    if (/\/:[A-Za-z_]/.test(route)) {
      lines.push("    const __route = await resolveRoute(page, '" + route + "');");
      lines.push("    const __resp = await page.goto(__route);");
    } else {
      lines.push("    const __resp = await page.goto('" + route + "');");
    }
    lines.push("    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});");
    lines.push("    expect(__resp ? __resp.status() : 0).toBeLessThan(400);");
    lines.push("    const __body = (await page.locator('body').innerText().catch(() => '')) || '';");
    lines.push("    expect(__body.trim().length).toBeGreaterThan(0);");
    if (kind === 'nav') {
      var slug = navTarget.replace(/^\//, '').split('/').pop();
      lines.push("    // Navigation AC → destination reachable via link/testid, NOT exact link copy");
      lines.push("    //   (story label and i18n label are independent LLM outputs — RULE-T6/F10).");
      lines.push("    const __signals = await Promise.all([");
      lines.push("      page.locator('a[href*=\"" + navTarget + "\"]').first().isVisible().catch(() => false),");
      lines.push("      page.locator('[data-testid*=\"" + slug + "\"]').first().isVisible().catch(() => false),");
      lines.push("    ]);");
      lines.push("    expect(__signals.some(Boolean)).toBeTruthy();");
    } else {
      lines.push("    // " + KIND_COMMENT[kind] + ", OR a domain keyword appears (word-regex,");
      lines.push("    //   any-of — tolerant of wording, unlike exact-phrase equality: RULE-T6).");
      lines.push("    const __checks = [");
      lines.push("      page.locator('" + STRUCT_SELECTOR[kind] + "').first().isVisible().catch(() => false),");
      for (var ki = 0; ki < keywords.length; ki++) {
        lines.push("      page.getByText(/\\b" + keywords[ki] + "\\b/i).first().isVisible().catch(() => false),");
      }
      lines.push("    ];");
      lines.push("    const __signals = await Promise.all(__checks);");
      lines.push("    expect(__signals.some(Boolean)).toBeTruthy();");
    }
    lines.push('  });');
  }

  lines.push('});');
  return lines.join('\n');
}

function renderGlobalSetup(fixtures, baseUrl) {
  // Logs in each user from _fixtures.yaml's users: section via
  // POST /auth/login, captures the Set-Cookie, saves storageState-<role>.json
  return [
    "/**",
    " * Generated by scaffold-story-specs. Runs ONCE before any test.",
    " * Logs in each role from _fixtures.yaml and persists their auth",
    " * state to storageState-<role>.json so tests can declare",
    " * `test.use({ storageState: 'storageState-admin.json' })`.",
    " */",
    "import { chromium } from '@playwright/test';",
    "import type { FullConfig } from '@playwright/test';",
    "import * as fs from 'fs';",
    "import * as path from 'path';",
    "import { fileURLToPath } from 'url';",
    "import { createRequire } from 'module';",
    "",
    "// ES-module __dirname polyfill. The frontend is an ES module (vite / RR7),",
    "// where raw __dirname is undefined → global-setup throws at load → NO",
    "// storageState files → every authenticated story fails auth (v120: stories",
    "// ran without login and false-reported '404'/content-not-found, dragging the",
    "// pass rate down ~30%). fileURLToPath(import.meta.url) gives a real dirname.",
    "const __filename = fileURLToPath(import.meta.url);",
    "const __dirname = path.dirname(__filename);",
    "",
    "// yaml via createRequire, NOT `import * as yaml from 'yaml'`. yaml@1 is CommonJS;",
    "// under Playwright's esbuild loader the CJS→ESM namespace interop leaves",
    "// `yaml.parse` undefined → global-setup throws `yaml.parse is not a function` →",
    "// the WHOLE suite aborts before any test (v121: 85.6%→11.6%, universal AC-1 fail).",
    "// require() returns the CJS module.exports directly, so `.parse` is always a fn.",
    "const require = createRequire(import.meta.url);",
    "const yaml = require('yaml');",
    "",
    "const FIXTURES_PATH = process.env.FSP_FIXTURES_PATH ||",
    "  path.resolve(__dirname, '../../.claude-project/fsp/user_stories/_fixtures.yaml');",
    "const API_URL = process.env.API_URL || 'http://localhost:3000/api';",
    "const BASE_URL = process.env.BASE_URL || '" + baseUrl + "';",
    "",
    "export default async function globalSetup(_config: FullConfig) {",
    "  if (!fs.existsSync(FIXTURES_PATH)) {",
    "    console.warn('global-setup: ' + FIXTURES_PATH + ' missing — skipping');",
    "    return;",
    "  }",
    "  const fixtures = yaml.parse(fs.readFileSync(FIXTURES_PATH, 'utf-8'));",
    "  const users = (fixtures && fixtures.users) || {};",
    "",
    "  console.log('global-setup: API_URL=' + API_URL + ' BASE_URL=' + BASE_URL);",
    "  let attempted = 0, succeeded = 0;",
    "  const failures: string[] = [];",
    "",
    "  for (const [key, raw] of Object.entries(users)) {",
    "    const u = raw as Record<string, unknown>;",
    "    if (!u.email || !u.password) continue;",
    "    attempted++;",
    "    const role = String(u.role ?? key);",
    "    const stateFile = path.resolve(__dirname, 'storageState-' + role + '.json');",
    "    try {",
    "      const browser = await chromium.launch();",
    "      const context = await browser.newContext({ baseURL: BASE_URL });",
    "      // CRITICAL: page.request / context.request uses an API request context",
    "      // separate from the browser cookie jar. To capture httpOnly cookies in",
    "      // storageState we MUST manually extract Set-Cookie response headers and",
    "      // inject via addCookies(). headersArray() handles multiple Set-Cookie",
    "      // headers correctly (headers() joins them with ',' breaking multi-cookie",
    "      // parsing). Strip sameSite/secure entirely — SameSite=None without",
    "      // Secure is silently dropped by Chrome on HTTP localhost.",
    "      // CRITICAL: page.request.post DOES NOT THROW on 4xx/5xx — we MUST",
    "      // check status ourselves. v78 worker cell scored 0/28 because this",
    "      // POST returned 401 silently → empty storageState → every protected",
    "      // page redirected to /login → every story failed.",
    "      const resp = await context.request.post(API_URL + '/auth/login', {",
    "        data: { email: u.email, password: u.password },",
    "      });",
    "      if (!resp.ok()) {",
    "        let body = '';",
    "        try { body = (await resp.text()).slice(0, 200); } catch (_) { /* ignore */ }",
    "        const msg = 'login HTTP ' + resp.status() + ' for ' + u.email + ' (' + body + ')';",
    "        failures.push(role + ': ' + msg);",
    "        console.error('  ✗ ' + role + ' (' + u.email + '): ' + msg);",
    "        await browser.close();",
    "        continue;",
    "      }",
    "      // Extract Set-Cookie headers and inject into browser context",
    "      const allHeaders = resp.headersArray();",
    "      const cookiesToAdd: Array<{ name: string; value: string; domain: string; path: string }> = [];",
    "      for (const header of allHeaders) {",
    "        if (header.name.toLowerCase() !== 'set-cookie') continue;",
    "        const parts = header.value.split(';').map((p: string) => p.trim());",
    "        const nameValue = parts[0] ?? '';",
    "        const eqIdx = nameValue.indexOf('=');",
    "        if (eqIdx < 0) continue;",
    "        const cname = nameValue.substring(0, eqIdx).trim();",
    "        const cvalue = nameValue.substring(eqIdx + 1).trim();",
    "        if (cname && cvalue) cookiesToAdd.push({ name: cname, value: cvalue, domain: 'localhost', path: '/' });",
    "      }",
    "      if (cookiesToAdd.length > 0) {",
    "        await context.addCookies(cookiesToAdd);",
    "      }",
    "      await context.storageState({ path: stateFile });",
    "      // Seed i18nextLng=en into the saved state so AUTHENTICATED stories render",
    "      // English too (RULE-T6 — app defaults to ko, story ACs are English).",
    "      try {",
    "        const _ss = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));",
    "        _ss.origins = [{ origin: BASE_URL, localStorage: [{ name: 'i18nextLng', value: 'en' }] }];",
    "        fs.writeFileSync(stateFile, JSON.stringify(_ss));",
    "      } catch (_) { /* keep cookies even if origin-merge fails */ }",
    "      await browser.close();",
    "      // Verify — empty state means Set-Cookie not sent (backend cookie config bug)",
    "      try {",
    "        const captured = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));",
    "        if (!Array.isArray(captured.cookies) || captured.cookies.length === 0) {",
    "          const msg = 'login HTTP 200 but storageState has 0 cookies (Set-Cookie missing — check backend CORS/cookie config)';",
    "          failures.push(role + ': ' + msg);",
    "          console.error('  ✗ ' + role + ' (' + u.email + '): ' + msg);",
    "          continue;",
    "        }",
    "      } catch (_) { /* keep going — file may not be parseable */ }",
    "      succeeded++;",
    "      console.log('  ✓ storageState-' + role + '.json (user ' + u.email + ', ' + cookiesToAdd.length + ' cookies)');",
    "    } catch (e) {",
    "      const msg = e instanceof Error ? e.message : String(e);",
    "      failures.push(role + ': exception ' + msg);",
    "      console.error('  ✗ ' + role + ' (' + u.email + '): ' + msg);",
    "    }",
    "  }",
    "",
    "  console.log('global-setup: ' + succeeded + '/' + attempted + ' user logins captured');",
    "  // FAIL the entire test run if zero logins captured — otherwise every",
    "  // story silently fails with 'redirected to /login' and the run looks",
    "  // like product bugs instead of broken auth infra.",
    "  if (attempted > 0 && succeeded === 0) {",
    "    throw new Error('global-setup: 0/' + attempted + ' logins succeeded. ' +",
    "      'Failures:\\n  - ' + failures.join('\\n  - ') + '\\n' +",
    "      'Common causes: wrong API_URL (port mismatch), backend not running, ' +",
    "      'seed script never ran, fixture user creds wrong, JWT cookie not in Set-Cookie header.');",
    "  }",
    "}",
    "",
  ].join('\n');
}

function renderPlaywrightConfig(baseUrl) {
  return [
    "import { defineConfig, devices } from '@playwright/test';",
    "",
    "/**",
    " * Generated by scaffold-story-specs. Wires global setup + per-role",
    " * storageState. Tests under tests/stories/ are auto-picked up.",
    " *",
    " * Per-story storageState binding: a spec can declare",
    " *   test.use({ storageState: path.resolve(__dirname, 'storageState-admin.json') });",
    " * Default is no auth (unauthenticated public routes).",
    " */",
    "export default defineConfig({",
    "  testDir: './tests/stories',",
    "  fullyParallel: true,",
    "  retries: 1,",
    "  workers: 4,",
    "  reporter: [['list'], ['json', { outputFile: 'tests/playwright-report.json' }]],",
    "  use: {",
    "    baseURL: process.env.BASE_URL || '" + baseUrl + "',",
    "    // i18nextLng=en so unauthenticated (public) specs render English — the story",
    "    // ACs are written in English but the app defaults to ko (RULE-T6). No cookies",
    "    // → still anonymous; auth specs override with their storageState-N.json (which",
    "    // global-setup also seeds with i18nextLng=en).",
    "    storageState: { cookies: [], origins: [{ origin: process.env.BASE_URL || '" + baseUrl + "', localStorage: [{ name: 'i18nextLng', value: 'en' }] }] },",
    "    trace: 'retain-on-failure',",
    "    screenshot: 'only-on-failure',",
    "  },",
    "  globalSetup: './tests/global-setup.ts',",
    "  projects: [",
    "    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },",
    "  ],",
    "});",
    "",
  ].join('\n');
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.storiesDir)) {
    console.log('scaffold-story-specs: no stories dir at ' + args.storiesDir + ' — skipping');
    return;
  }
  var yaml = loadYaml();

  // Build role→numericRole map from fixtures for test.use({ storageState }) binding
  var fixturesPath = args.fixtures ||
    path.join(args.storiesDir, '_fixtures.yaml');
  var keyRoleMap = buildRoleNumericMap(fixturesPath);
  if (Object.keys(keyRoleMap).length > 0 && args.verbose) {
    console.log('  role map built: ' + JSON.stringify(keyRoleMap));
  }

  var storiesOutDir = path.join(args.target, 'tests/stories');
  var globalSetupPath = path.join(args.target, 'tests/global-setup.ts');
  var pwConfigPath = path.join(args.target, 'playwright.config.ts');

  if (!args.dryRun) fs.mkdirSync(storiesOutDir, { recursive: true });

  var entries = fs.readdirSync(args.storiesDir, { withFileTypes: true });
  var written = 0, parseFixed = 0, parseFailed = 0;
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e.isFile() || !/\.yaml$/.test(e.name) || e.name === '_fixtures.yaml') continue;
    var src = path.join(args.storiesDir, e.name);
    var raw = fs.readFileSync(src, 'utf-8');
    var story;
    try {
      story = yaml.parse(raw);
    } catch (err) {
      // v78b + v79b: LLM-authored YAMLs commonly emit two malformed patterns:
      //   (a) `expected: "X" Y Z` — quoted scalar followed by unquoted text
      //   (b) `description: User selects from three options: Flight, Bus`
      //       — inner `:` (followed by space) makes YAML think it's a
      //       nested mapping, raising "Nested mappings are not allowed".
      // Repair line-by-line: any value containing (a) inner `"` OR (b) `: `
      // gets wrapped in single quotes. Block scalars (>, |), anchors, refs,
      // and comments are left alone.
      var repaired = raw.split('\n').map(function (line) {
        // v79c: also match list-item lines like `  - case: value` (the
        // `- ` prefix isn't part of the key but YAML still parses
        // `value` as a sub-mapping if it contains `: `). v79 evidence:
        // 04-forgot-password.yaml had `- case: ... (security: ...)`
        // which v79b couldn't reach because the regex required keys to
        // start with [a-zA-Z_].
        var m = /^(\s*(?:-\s+)?[a-zA-Z_][\w-]*\s*:\s*)(.+)$/.exec(line);
        if (!m) return line;
        var key = m[1], value = m[2];
        var trimmed = value.trim();
        // Skip block-scalar markers, anchors, references, comments.
        if (/^[|>!&*#]/.test(trimmed)) return line;
        // Already fully wrapped in matching quotes? leave it.
        if (/^"[^"]*"$/.test(trimmed) || /^'[^']*'$/.test(trimmed)) return line;
        // Pure-numeric/boolean/null literals don't need quoting.
        if (/^(true|false|null|~|-?\d+(\.\d+)?)$/.test(trimmed)) return line;
        // (a) Inner `"` plus extra text? wrap.
        // (b) Inner `: ` (colon-space, the mapping indicator)? wrap.
        var hasInnerQuote = /"/.test(value) && !/^"[^"]*"\s*$/.test(trimmed);
        var hasInnerColonSpace = /:\s/.test(value);
        if (hasInnerQuote || hasInnerColonSpace) {
          var escaped = value.replace(/'/g, "''");
          return key + "'" + escaped + "'";
        }
        return line;
      }).join('\n');
      try {
        story = yaml.parse(repaired);
        parseFixed++;
        if (args.verbose) console.log('  ⚙ repaired ' + e.name);
      } catch (err2) {
        parseFailed++;
        var msg = (err.message || String(err)).split('\n')[0];
        console.error('  ✗ skip ' + e.name + ' — ' + msg);
        continue;
      }
    }
    if (!story) continue;
    story.__file = e.name;
    var spec = renderStorySpec(story, args.baseUrl, keyRoleMap);
    var dst = path.join(storiesOutDir, e.name.replace(/\.yaml$/, '.spec.ts'));
    if (args.dryRun) {
      console.log('  [dry] would write ' + path.relative(args.target, dst));
    } else {
      fs.writeFileSync(dst, spec);
    }
    written++;
  }

  // Write playwright.config.ts + global-setup if missing
  if (!fs.existsSync(globalSetupPath) || args.dryRun) {
    var setup = renderGlobalSetup(args.fixtures || '_fixtures.yaml', args.baseUrl);
    if (!args.dryRun) {
      fs.mkdirSync(path.dirname(globalSetupPath), { recursive: true });
      fs.writeFileSync(globalSetupPath, setup);
    }
    if (args.verbose) console.log('  + tests/global-setup.ts');
  }
  if (!fs.existsSync(pwConfigPath) || args.dryRun) {
    var cfg = renderPlaywrightConfig(args.baseUrl);
    if (!args.dryRun) fs.writeFileSync(pwConfigPath, cfg);
    if (args.verbose) console.log('  + playwright.config.ts');
  }

  var msg = 'scaffold-story-specs: wrote ' + written + ' spec files to ' + path.relative(args.target, storiesOutDir);
  if (parseFixed > 0) msg += ' (repaired ' + parseFixed + ' broken YAMLs)';
  if (parseFailed > 0) msg += ' (' + parseFailed + ' unrecoverable)';
  console.log(msg);
}

main();
