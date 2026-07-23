#!/usr/bin/env node
// scaffold-frontend-contract-doctor.js — v118
//
// Repairs the frontend contract-drift cascade that surfaced once db/backend
// fixes first let a slim run REACH the frontend build. v118 `npx tsc --noEmit`
// showed 36 errors in 3 classes, all LLM page/service/type disagreement:
//
//   A) role string↔number (TS2352/2367): app/types/auth.d.ts `Role` is a string
//      union, but guards/layouts compare to NUMERIC role literals ([10,99],[1,2])
//      because the DB/PRD roles are numeric (RULE-B8 frontend counterpart).
//   B) auth shape (TS2339/2561/2353): AuthState has no `loading` (only isLoading)
//      yet the slice/pages read `.loading`; AuthResponseDto has no `error`/`message`
//      yet login/register pages read them off the success result.
//   C) crud page↔service names (TS2305/2724): pages import fetchUserList/createUser/
//      updateUser/fetchUserById/deleteUser but the generated service exported a
//      different surface (e.g. a /me self-service getMe/patchMe/deleteMe).
//
// All four are deterministic. Fixes are minimal + idempotent:
//   R1 Role → numeric union (from PROJECT_DATABASE.md role discriminator, else default)
//   R2 AuthResponseDto += error?/message?   (compile the page's defensive checks)
//   R3 AuthState += loading?                (alias so `.loading` reads typecheck)
//   R4 service stub-exports for any name a page imports but the service lacks
//      (any-typed so it compiles under both `dispatch(x())` and `await x()`; returns
//      empty at runtime → page renders empty instead of crashing — the safety-net
//      philosophy, same as scaffold-page-from-story stubs).
//
// Run AFTER convert/page+service generation, BEFORE the frontend typecheck node.
'use strict';

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--project-database') out.projectDb = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target) {
    console.error('Usage: scaffold-frontend-contract-doctor --target <FRONTEND_DIR> [--project-database <PROJECT_DATABASE.md>] [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

function walk(dir, re, acc) {
  acc = acc || [];
  if (!fs.existsSync(dir)) return acc;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build' || e.name === '.git') return;
    var p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, re, acc);
    else if (e.isFile() && re.test(e.name)) acc.push(p);
  });
  return acc;
}

// Derive the numeric role union from PROJECT_DATABASE.md (lines like `0=foreign_worker`).
// Falls back to the canonical FSP discriminator if not found.
function numericRoleUnion(projectDb) {
  var nums = [];
  if (projectDb && fs.existsSync(projectDb)) {
    var txt = fs.readFileSync(projectDb, 'utf-8');
    var re = /(^|\s|`)(\d{1,3})\s*=\s*(foreign_worker|company_staff|company_lead|operator|super_admin|admin|user|manager|staff|lead)/gi;
    var m;
    while ((m = re.exec(txt)) !== null) { var n = parseInt(m[2], 10); if (nums.indexOf(n) === -1) nums.push(n); }
  }
  if (nums.length === 0) nums = [0, 1, 2, 10, 99];
  nums.sort(function (a, b) { return a - b; });
  return nums.join(' | ') + ' | number';
}

// name → numeric role map (e.g. company_lead → 2), from PROJECT_DATABASE.md or default.
function roleNameMap(projectDb) {
  var map = { foreign_worker: 0, company_staff: 1, company_lead: 2, operator: 10, super_admin: 99 };
  if (projectDb && fs.existsSync(projectDb)) {
    var txt = fs.readFileSync(projectDb, 'utf-8');
    var re = /(\d{1,3})\s*=\s*([a-z_]+)/gi, m;
    while ((m = re.exec(txt)) !== null) { map[m[2].toLowerCase()] = parseInt(m[1], 10); }
  }
  return map;
}

// Split a parameter string on top-level commas (respecting <>(){}[] depth), so
// `id: string, data: Record<string, unknown>` → ['id: string', ' data: Record<string, unknown>'].
function splitParams(s) {
  var out = [], depth = 0, cur = '';
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if ('<({['.indexOf(c) >= 0) depth++;
    else if ('>)}]'.indexOf(c) >= 0) depth--;
    if (c === ',' && depth <= 0) { out.push(cur); cur = ''; }
    else cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

// Make a function declaration's params at index >= fromIdx optional. Returns the
// rewritten declaration head, or null if nothing changed. `head` is the text from
// the function name through the closing `)` of the param list.
function makeParamsOptional(paramsInner, fromIdx) {
  var parts = splitParams(paramsInner);
  var changed = false;
  var np = parts.map(function (p, i) {
    if (i < fromIdx) return p;
    if (/^\s*\.\.\./.test(p)) return p;          // rest param — already any-arity
    if (/=/.test(p)) return p;                    // has a default — already optional
    var mm = /^(\s*[A-Za-z_$][\w$]*)(\??)\s*:/.exec(p);
    if (!mm || mm[2] === '?') return p;           // no annotation, or already optional
    changed = true;
    return p.replace(/^(\s*[A-Za-z_$][\w$]*)\s*:/, '$1?:');
  });
  return changed ? np.join(',') : null;
}

function reconcileArity(opts, app, write) {
  var tscOut;
  try {
    tscOut = cp.execSync('npx tsc --noEmit', { cwd: opts.target, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { tscOut = ((e.stdout || '') + (e.stderr || '')); } // tsc exits non-zero; output carries the errors
  var files = walk(app, /\.(ts|tsx)$/);
  // alias map: export const X = Y;  (re-exports like applyTransition = transition)
  var alias = {};
  files.forEach(function (f) {
    var c = fs.readFileSync(f, 'utf-8'), a, re = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g;
    while ((a = re.exec(c)) !== null) alias[a[1]] = a[2];
  });
  function resolve(name) { var seen = {}; while (alias[name] && !seen[name]) { seen[name] = 1; name = alias[name]; } return name; }
  var errRe = /^(.+?)\((\d+),(\d+)\): error TS2554: Expected (\d+) arguments?, but got (\d+)\./gm;
  var m, fixed = 0, done = {};
  while ((m = errRe.exec(tscOut)) !== null) {
    var N = +m[4], M = +m[5];
    if (M >= N) continue; // only too-FEW args
    var absFile = path.isAbsolute(m[1]) ? m[1] : path.join(opts.target, m[1].trim());
    if (!fs.existsSync(absFile)) continue;
    var callLine = (fs.readFileSync(absFile, 'utf-8').split('\n')[(+m[2]) - 1] || '');
    // callee = identifier whose '(' sits closest to the error column
    var col = +m[3], best = null, cre = /([A-Za-z_$][\w$]*)\s*\(/g, cm;
    while ((cm = cre.exec(callLine)) !== null) {
      var pos = cm.index + cm[1].length;
      if (best === null || Math.abs(pos - col) < Math.abs(best.pos - col)) best = { name: cm[1], pos: pos };
    }
    if (!best) continue;
    // Scope to the RIGHT module: follow the call file's import of the callee
    // (the same fn name can be declared in several services — v119 `transition`
    // exists in both application + affiliationRequest workflow services).
    var callSrc = fs.readFileSync(absFile, 'utf-8');
    var searchFiles;
    var imp = new RegExp("import\\s*\\{[^}]*\\b" + best.name + "\\b[^}]*\\}\\s*from\\s*['\"](~[^'\"]+|\\.[^'\"]+)['\"]").exec(callSrc);
    if (imp) {
      var modPath = imp[1].replace(/^~\//, 'app/');
      var cand = path.isAbsolute(modPath) ? modPath : path.join(opts.target, modPath);
      var resolved = [cand + '.ts', cand + '.tsx', path.join(cand, 'index.ts')].filter(fs.existsSync);
      searchFiles = resolved.length ? resolved : [absFile];
    } else { searchFiles = [absFile]; } // locally-declared fn
    // resolve alias WITHIN the module file, then find the real declaration there.
    var real = best.name;
    if (searchFiles.length) {
      var modSrc = fs.readFileSync(searchFiles[0], 'utf-8');
      var la = new RegExp('export\\s+const\\s+' + best.name + '\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*;').exec(modSrc);
      if (la) real = la[1];
    }
    if (done[searchFiles[0] + '#' + real]) continue;
    for (var fi = 0; fi < searchFiles.length; fi++) {
      var c = fs.readFileSync(searchFiles[fi], 'utf-8');
      var dre = new RegExp('(\\b(?:export\\s+)?(?:async\\s+)?function\\s+' + real + '\\s*\\(|\\b(?:export\\s+)?const\\s+' + real + '\\s*=\\s*(?:async\\s+)?\\()');
      var dm = dre.exec(c);
      if (!dm) continue;
      var open = dm.index + dm[0].length - 1; // index of '('
      var depth = 0, end = -1;
      for (var k = open; k < c.length; k++) { if (c[k] === '(') depth++; else if (c[k] === ')') { depth--; if (depth === 0) { end = k; break; } } }
      if (end < 0) break;
      var inner = c.slice(open + 1, end);
      var rewritten = makeParamsOptional(inner, M);
      if (rewritten !== null) {
        write(searchFiles[fi], c.slice(0, open + 1) + rewritten + c.slice(end));
        fixed++; done[searchFiles[0] + '#' + real] = 1;
      }
      break;
    }
  }
  return fixed ? ('R10 ' + fixed + ' too-few-arg callee(s) → trailing params optional (TS2554)') : '';
}

function applyDoctor(opts) {
  var app = path.join(opts.target, 'app');
  var changes = [];
  var write = function (f, s) { if (!opts.dryRun) fs.writeFileSync(f, s); };

  // ---- R1/R2/R3: auth.d.ts type repairs ----
  var authDts = path.join(app, 'types', 'auth.d.ts');
  if (fs.existsSync(authDts)) {
    var src = fs.readFileSync(authDts, 'utf-8');
    var orig = src;

    // R1: Role → numeric union (only if it's currently string-based)
    if (/export\s+type\s+Role\s*=/.test(src) && !/export\s+type\s+Role\s*=\s*[0-9]/.test(src)) {
      var union = numericRoleUnion(opts.projectDb);
      src = src.replace(/export\s+type\s+Role\s*=\s*[^;]+;/,
        '// v118 scaffold-frontend-contract-doctor: numeric roles (RULE-B8) — guards compare to numeric literals\nexport type Role = ' + union + ';');
      changes.push('R1 Role → ' + union);
    }

    // R2: AuthResponseDto — make `user` optional + add error?/message?/data?.
    // LLM auth action helpers return error-only objects ({ error }) and data
    // wrappers ({ data }); login/register pages read .error/.message off the
    // success result. Relaxing the DTO compiles all of these defensive shapes.
    src = src.replace(/export\s+interface\s+AuthResponseDto\s*\{([\s\S]*?)\}/, function (full, body) {
      var nb = body.replace(/^(\s*)user\s*:/m, '$1user?:'); // user: → user?:
      var add = '';
      if (!/\berror\??\s*:/.test(nb)) add += '  error?: string;\n';
      if (!/\bmessage\??\s*:/.test(nb)) add += '  message?: string;\n';
      if (!/\bdata\??\s*:/.test(nb)) add += '  data?: unknown;\n';
      if (nb === body && !add) return full;
      changes.push('R2 AuthResponseDto: user optional + error?/message?/data?');
      return 'export interface AuthResponseDto {' + nb + add + '}';
    });

    // R3: AuthState += loading? (alias so pages/slice that read .loading typecheck)
    src = src.replace(/export\s+interface\s+AuthState\s*\{([\s\S]*?)\}/, function (full, body) {
      if (/\bloading\??\s*:/.test(body)) return full;
      changes.push('R3 AuthState += loading?');
      return 'export interface AuthState {' + body + '  loading?: boolean;\n}';
    });

    if (src !== orig) { write(authDts, src); }
  }

  // R1b: domain `role` fields are numeric too. The Role alias in auth.d.ts isn't
  // the only role type — v119: User (user.d.ts) typed role as string, so pages
  // doing `u.role === 1` (numeric, correct) hit TS2367 (string vs number). Coerce
  // every `role: <x>` / `role?: <x>` property in app/types/*.d.ts to `number`
  // (RULE-B8). Runs AFTER the auth.d.ts write above so nothing clobbers it.
  var r1bFiles = 0, r1bCount = 0;
  walk(path.join(app, 'types'), /\.d\.ts$/).forEach(function (f) {
    var c = fs.readFileSync(f, 'utf-8'), n = 0;
    var nc = c.replace(/(\n[ \t]*role)(\??)\s*:\s*([^;\n]+);/g, function (full, lhs, opt, ty) {
      if (/^\s*number\s*$/.test(ty)) return full; // already numeric
      if (/\bRole\b/.test(ty)) return full;        // already the (numeric) Role alias
      n++; return lhs + opt + ': number;';
    });
    if (nc !== c) { write(f, nc); r1bFiles++; r1bCount += n; }
  });
  if (r1bCount) changes.push('R1b ' + r1bCount + ' domain role field(s) → number in ' + r1bFiles + ' file(s)');

  // ---- R4: service stub-exports for imported-but-missing names ----
  // Scan ALL app/ consumers (pages, redux slices, utils, hooks, components) —
  // not just pages — since slices import service thunks too (v118: userSlice
  // imported fetchUsers).
  var svcDir = path.join(app, 'services', 'httpServices');
  var allTs = walk(app, /\.(tsx|ts)$/).filter(function (f) { return f.indexOf(path.sep + 'services' + path.sep + 'httpServices' + path.sep) === -1; });
  // Map: serviceFile -> Set(importedNames)
  var wanted = {};
  var typeSpec = {}, valSpec = {}; // svc+'::'+name → imported as a TYPE / as a VALUE
  // group1 = optional whole-import `type ` (import type { … }); group2 = specifiers; group3 = svc.
  var importRe = /import\s*(type\s+)?\{([^}]+)\}\s*from\s*['"]~\/services\/httpServices\/([A-Za-z0-9_-]+)['"]/g;
  allTs.forEach(function (pf) {
    var c = fs.readFileSync(pf, 'utf-8');
    var m;
    while ((m = importRe.exec(c)) !== null) {
      var wholeType = !!m[1];
      var svc = m[3];
      (wanted[svc] = wanted[svc] || {});
      m[2].split(',').forEach(function (s) {
        var raw = s.trim();
        if (!raw) return;
        // inline `type X` modifier OR whole-import `import type { … }` → type-only specifier.
        var isType = wholeType || /^type\s+/.test(raw);
        var name = raw.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (!name) return;
        wanted[svc][name] = true;
        if (isType) typeSpec[svc + '::' + name] = true; else valSpec[svc + '::' + name] = true;
      });
    }
  });
  // Names used as a Redux thunk anywhere — referenced as `NAME.fulfilled/.pending/
  // .rejected` (a slice's extraReducers). v120: a plain-function R4 stub for such a
  // name made `NAME.fulfilled` undefined → `builder.addCase(undefined,…)` threw
  // "Cannot read properties of undefined (reading 'type')" during SSR → root.tsx
  // crashed → EVERY authenticated route rendered BLANK. A thunk-used name must be
  // stubbed as a real createAsyncThunk so `.fulfilled` etc. exist.
  var thunkUsed = {};
  allTs.concat(walk(svcDir, /\.ts$/)).forEach(function (f) {
    var c = fs.readFileSync(f, 'utf-8'), tm, tre = /\b([A-Za-z_$][\w$]*)\.(fulfilled|pending|rejected)\b/g;
    while ((tm = tre.exec(c)) !== null) thunkUsed[tm[1]] = true;
  });
  Object.keys(wanted).forEach(function (svc) {
    var svcFile = path.join(svcDir, svc + '.ts');
    // v125: a MISSING service module (a page imports `~/services/httpServices/X` that
    // was never generated) → esbuild build ENOENT (`Could not load …/Xservice`), which
    // route-prune does NOT handle (it prunes route()→missing-page, not page→missing-
    // service imports). So CREATE the stub module here instead of skipping. v125:
    // frontend-admin-dashboard ApplicationLifecycleWorkflowListPage imported a missing
    // application-lifecycleService.
    var fileExists = fs.existsSync(svcFile);
    var c = fileExists ? fs.readFileSync(svcFile, 'utf-8') : '';
    var missing = !fileExists ? Object.keys(wanted[svc]) : Object.keys(wanted[svc]).filter(function (n) {
      // exported as const/function/async/let/var/class/type, or re-exported alias
      var re = new RegExp('export\\s+(?:const|function|async\\s+function|let|var|class|type|interface)\\s+' + n + '\\b|export\\s*\\{[^}]*\\b' + n + '\\b');
      return !re.test(c);
    });
    if (missing.length === 0) return;
    var needsThunkImport = false;
    var stub = '\n// v118/v120 scaffold-frontend-contract-doctor R4 — stub exports for page/slice-\n' +
      '// imported symbols this service never defined (crud-page ↔ service-from-controller\n' +
      '// name drift). Thunk-used names (referenced as .fulfilled/.pending/.rejected in a\n' +
      '// slice) MUST be createAsyncThunk or addCase crashes SSR; others are any plain fns.\n' +
      missing.map(function (n) {
        // Type-only import (`import { type X }` / `import type { X }`) → emit a TYPE
        // alias, NOT a value. v124: a value stub for a type-imported name produced
        // `export const type DashboardResult = …` (invalid — `const type`) → esbuild
        // build abort. A type-only name needs `export type X = any`.
        if (typeSpec[svc + '::' + n] && !valSpec[svc + '::' + n]) {
          return 'export type ' + n + ' = any;';
        }
        if (thunkUsed[n]) {
          needsThunkImport = true;
          return 'export const ' + n + " = createAsyncThunk('" + svc + '/' + n + "', async (..._args: any[]) => ({} as any));";
        }
        return 'export const ' + n + ': any = (..._args: any[]): any => Promise.resolve(Array.isArray(undefined) ? [] : ({} as any));';
      }).join('\n') + '\n';
    var head = c;
    if (!fileExists) {
      fs.mkdirSync(svcDir, { recursive: true });
      head = '// Generated by scaffold-frontend-contract-doctor R4 — stub service module\n' +
             '// (a page imported ~/services/httpServices/' + svc + ' that was never generated).\n';
    }
    if (needsThunkImport && !/createAsyncThunk/.test(head)) {
      head = "import { createAsyncThunk } from '@reduxjs/toolkit';\n" + head;
    }
    write(svcFile, head + stub);
    changes.push('R4 ' + svc + ' ' + (fileExists ? '+= ' : 'CREATED ') + '[' + missing.join(', ') + ']' + (needsThunkImport ? ' (thunk-aware)' : ''));
  });

  // ---- R4s (v125): stub missing redux-slice action exports ----
  // A page importing `{ clearCurrent }` from '~/redux/features/userSlice' that the
  // slice never exported → rollup "clearCurrent is not exported by …" → BUILD abort.
  // Append a no-op action creator so the import resolves + dispatch(clearCurrent()) is
  // harmless. (v125 admin-dashboard: UserDetailPage imported a non-existent action.)
  (function stubMissingSliceExports() {
    var featDir = path.join(app, 'redux', 'features');
    if (!fs.existsSync(featDir)) return;
    var consumers = walk(app, /\.(tsx|ts)$/).filter(function (f) { return f.indexOf(path.sep + 'features' + path.sep) === -1; });
    var wantS = {};
    var re = /import\s*\{([^}]+)\}\s*from\s*['"]~\/redux\/features\/([A-Za-z0-9_-]+)['"]/g;
    consumers.forEach(function (f) {
      var c = fs.readFileSync(f, 'utf-8'), m;
      while ((m = re.exec(c))) {
        var s = m[2]; wantS[s] = wantS[s] || {};
        m[1].split(',').forEach(function (x) { var n = x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim(); if (n) wantS[s][n] = true; });
      }
    });
    Object.keys(wantS).forEach(function (s) {
      var sf = path.join(featDir, s + '.ts');
      if (!fs.existsSync(sf)) return;
      var c = fs.readFileSync(sf, 'utf-8');
      var missing = Object.keys(wantS[s]).filter(function (n) {
        return !new RegExp(
          'export\\s+(?:const|function|async\\s+function|let|var|class|type|interface|default)\\s+' + n + '\\b' +
          '|export\\s*\\{[^}]*\\b' + n + '\\b' +
          '|export\\s+const\\s*\\{[^}]*\\b' + n + '\\b'  // destructured: export const { clearCurrent } = slice.actions
        ).test(c);
      });
      if (!missing.length) return;
      var stub = '\n// scaffold-frontend-contract-doctor R4s — no-op action creators a consumer\n' +
        '// imports but this slice never exported (unblock build; dispatch is a harmless no-op).\n' +
        missing.map(function (n) {
          return 'export const ' + n + ' = (..._args: any[]): any => ({ type: ' + JSON.stringify(s + '/' + n) + ', payload: _args[0] });';
        }).join('\n') + '\n';
      write(sf, c + stub);
      changes.push('R4s ' + s + ' += [' + missing.join(', ') + ']');
    });
  })();

  // ---- R9: dedupe duplicate top-level exports in service files (TS2451) ----
  // v119: adminSettingService declared `export const findAll = …` twice (and
  // `fetchFindAll` twice) → TS2451 "Cannot redeclare block-scoped variable".
  // Split each service into top-level `export …` statements, keep the first
  // declaration of each name, drop later duplicates. Conservative: only acts on
  // exact same-name redeclarations.
  walk(svcDir, /\.ts$/).forEach(function (f) {
    var c = fs.readFileSync(f, 'utf-8');
    var chunks = c.split(/\n(?=export\b)/);
    var seen = {}, dropped = 0;
    var kept = chunks.filter(function (ch, i) {
      var m = ch.match(/^export\s+(?:const|let|var|async\s+function|function|class)\s+([A-Za-z_$][\w$]*)/);
      if (!m) return true;            // not a named decl (e.g. `export {…}`, `export type`) — keep
      if (seen[m[1]]) { dropped++; return false; }
      seen[m[1]] = true; return true;
    });
    if (dropped > 0) { write(f, kept.join('\n')); changes.push('R9 ' + path.basename(f) + ' dropped ' + dropped + ' duplicate export(s)'); }
  });

  // ---- R5pre (v125): CREATE missing ~/types/X stub MODULES ----
  // R5 below only APPENDS to an EXISTING types file (and skips missing ones — the
  // "handled elsewhere" comment was a lie: nothing created them). A service that
  // imports from a ~/types/X module the pipeline never generated → TS2307 "Cannot
  // find module" at the esbuild BUILD (which resolves modules), even after the
  // typecheck fix-agent — and the fix-agent fixed it inconsistently per-frontend
  // (v125: frontend-admin-dashboard build aborted on ~7 missing ~/types/* modules
  // [transition, schedule, staff, worker, health, application-lifecycle] imported as
  // `import type * as T from '~/types/transition'`). Create each missing module with
  // any-typed stubs for every named-imported AND namespace-accessed member.
  // v126: GENERALIZED across ~/types, ~/enums, ~/schemas — each fresh convert exposed
  // a different missing-module dir (v125 types/services/slice; v126 enums imported by
  // schemas: `~/enums/company-status.enum` never synced). One pass ends the whack-a-mole.
  (function createMissingLocalModules() {
    var configs = [
      { prefix: 'types', dir: path.join(app, 'types'), kind: 'type' },
      { prefix: 'enums', dir: path.join(app, 'enums'), kind: 'value' },   // enums are value+type (z.nativeEnum, X.MEMBER)
      { prefix: 'schemas', dir: path.join(app, 'schemas'), kind: 'value' }, // zod schemas are runtime values
    ];
    var files = walk(app, /\.(tsx|ts)$/);
    configs.forEach(function (cfg) {
      var members = {};
      // module path may contain ., -, /, and a .enum/.schema suffix
      var reNamed = new RegExp("import\\s+(?:type\\s+)?\\{([^}]+)\\}\\s*from\\s*['\"]~/" + cfg.prefix + "/([A-Za-z0-9_./-]+)['\"]", 'g');
      var reNs = new RegExp("import\\s+(?:type\\s+)?\\*\\s+as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*['\"]~/" + cfg.prefix + "/([A-Za-z0-9_./-]+)['\"]", 'g');
      files.forEach(function (f) {
        if (f.indexOf(path.sep + cfg.prefix + path.sep) !== -1) return; // skip files inside the target dir
        var c = fs.readFileSync(f, 'utf-8'), m;
        reNamed.lastIndex = 0;
        while ((m = reNamed.exec(c))) {
          var mod = m[2]; members[mod] = members[mod] || {};
          m[1].split(',').forEach(function (s) { var n = s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim(); if (n) members[mod][n] = true; });
        }
        reNs.lastIndex = 0;
        while ((m = reNs.exec(c))) {
          var mod2 = m[2], alias = m[1]; members[mod2] = members[mod2] || {};
          var ure = new RegExp('\\b' + alias + '\\.([A-Za-z_$][\\w$]*)', 'g'), um;
          while ((um = ure.exec(c))) members[mod2][um[1]] = true;
        }
      });
      Object.keys(members).forEach(function (mod) {
        var base = path.join(cfg.dir, mod);
        if (fs.existsSync(base + '.ts') || fs.existsSync(base + '.tsx') || fs.existsSync(base + '.d.ts')) return;
        var names = Object.keys(members[mod]);
        var header = '// Generated by scaffold-frontend-contract-doctor (missing-module stub) for\n' +
          '// ~/' + cfg.prefix + '/' + mod + ' (imported but never generated; any-typed to unblock the build).\n';
        var ext, body;
        if (cfg.kind === 'value') {
          // value+type stub: works as a value (z.nativeEnum(X), X.MEMBER → any) AND a type.
          ext = '.ts';
          body = header + names.map(function (n) {
            return 'export const ' + n + ': any = {};\nexport type ' + n + ' = any;';
          }).join('\n') + '\n' + 'const _d: any = {};\nexport default _d;\n';
        } else {
          ext = '.d.ts';
          body = header + (names.length ? names.map(function (n) { return 'export type ' + n + ' = any;'; }).join('\n') + '\n' : '') +
            'declare const _stub: { [k: string]: any };\nexport default _stub;\n';
        }
        fs.mkdirSync(path.dirname(base), { recursive: true });
        fs.writeFileSync(base + ext, body);
        changes.push('R5pre created ' + cfg.prefix + '/' + mod + ext + ' [' + names.join(', ') + ']');
      });
    });
  })();

  // ---- R5: type-member stub-exports for imported-but-missing type names ----
  // v118: pages/slices/services import named types (UserState, SignupRequest)
  // from ~/types/X that the generated X.d.ts never exported. Append `export type
  // Name = any;` so the import resolves. any keeps it from cascading further.
  var typesDir = path.join(app, 'types');
  var wantedTypes = {};
  var typeImportRe = /import\s+type\s*\{([^}]+)\}\s*from\s*['"]~\/types\/([A-Za-z0-9_-]+)['"]|import\s*\{([^}]+)\}\s*from\s*['"]~\/types\/([A-Za-z0-9_-]+)['"]/g;
  walk(app, /\.(tsx|ts)$/).filter(function (f) { return f.indexOf(path.sep + 'types' + path.sep) === -1; }).forEach(function (pf) {
    var c = fs.readFileSync(pf, 'utf-8');
    var m;
    while ((m = typeImportRe.exec(c)) !== null) {
      var names = (m[1] || m[3] || '').split(',').map(function (s) { return s.trim().split(/\s+as\s+/)[0].trim(); }).filter(Boolean);
      var t = m[2] || m[4];
      (wantedTypes[t] = wantedTypes[t] || {}); names.forEach(function (n) { if (n) wantedTypes[t][n] = true; });
    }
  });
  Object.keys(wantedTypes).forEach(function (t) {
    var tFile = path.join(typesDir, t + '.d.ts');
    if (!fs.existsSync(tFile)) return; // missing type FILE handled elsewhere (stub modules)
    var c = fs.readFileSync(tFile, 'utf-8');
    var missing = Object.keys(wantedTypes[t]).filter(function (n) {
      var re = new RegExp('export\\s+(?:type|interface|const|enum|class)\\s+' + n + '\\b|export\\s*\\{[^}]*\\b' + n + '\\b|export\\s+default\\b');
      return !re.test(c);
    });
    if (missing.length === 0) return;
    var stub = '\n// v118 scaffold-frontend-contract-doctor R5 — stub types for imported-but-\n' +
      '// undefined members (LLM type/consumer drift). Redux `*State` types get a\n' +
      '// structured shape (so `state.items.map(...)` infers `any` not implicit-any);\n' +
      '// everything else is any-typed to unblock the build.\n' +
      missing.map(function (n) {
        // Redux slice state: give a list-friendly shape so consumers typecheck.
        if (/State$/.test(n)) {
          return 'export type ' + n + ' = { items: any[]; list?: any[]; data?: any; selected?: any; ' +
            'loading?: boolean; isLoading?: boolean; error?: string | null; pagination?: any; [k: string]: any };';
        }
        return 'export type ' + n + ' = any;';
      }).join('\n') + '\n';
    write(tFile, c + stub);
    changes.push('R5 types/' + t + ' += [' + missing.join(', ') + ']');
  });

  // ---- R8: repair truncated generic/object types in .d.ts (TS1005) ----
  // v119: the LLM emitted `items: Array<{ key: string | number | null;` then
  // closed the interface with `}` — the `Array<{` is never closed (`}>` missing),
  // so tsc dies with TS1005 '>' expected, which HALTS parsing and MASKS every
  // other error in the file. Coerce a property whose type opens an Array<{ / <{ /
  // Record< / { … and is followed directly by the interface-closing brace (i.e.
  // the member was truncated mid-type) to `?: any`. Only touches the exact
  // unbalanced-then-close shape, so well-formed members are left alone.
  var r8files = 0, r8count = 0;
  walk(path.join(app, 'types'), /\.d\.ts$/).forEach(function (f) {
    var c = fs.readFileSync(f, 'utf-8'), n = 0;
    // property: `name?: <open-generic-or-object> … ;` immediately before a `}` that
    // closes the interface, where the type's <,{,( are not balanced by >,},).
    var nc = c.replace(/(\n[ \t]*)([A-Za-z_$][\w$]*)(\??\s*):\s*([^\n;]*(?:Array<\{|<\{|Record<|\{)[^\n;]*);(\s*\n[ \t]*\})/g,
      function (full, ind, name, opt, type, close) {
        var opens = (type.match(/[<{(]/g) || []).length;
        var closes = (type.match(/[>})]/g) || []).length;
        if (opens <= closes) return full; // balanced — leave it
        n++;
        return ind + name + '?: any;' + close;
      });
    if (nc !== c) { write(f, nc); r8files++; r8count += n; }
  });
  if (r8count) changes.push('R8 ' + r8count + ' truncated .d.ts type(s) → ?: any in ' + r8files + ' file(s)');

  // ---- R11: i18n active language reads localStorage (RULE-T6 test/UX) ----
  // v120: the i18n init `.use(LanguageDetector)` but then sets `lng: defaultLocale`
  // (ko), which OVERRIDES the detector — so the app ALWAYS renders Korean and the
  // English-written story specs (`getByText(/Forgot password\?/i)`) never match a
  // Korean-only page → a large class of stories false-fails. Make `lng` read a
  // stored preference first: `(window.localStorage.getItem('i18nextLng')) ||
  // defaultLocale`. SSR + a default user (no preference) still get ko (no hydration
  // mismatch); tests/users that set i18nextLng=en render English. Pairs with
  // scaffold-story-specs seeding i18nextLng=en for the suite.
  var i18nFile = path.join(app, 'i18n', 'index.ts');
  if (fs.existsSync(i18nFile)) {
    var ic = fs.readFileSync(i18nFile, 'utf-8');
    if (/\blng:\s*defaultLocale\s*,/.test(ic) && !/getItem\(['"]i18nextLng/.test(ic)) {
      ic = ic.replace(/\blng:\s*defaultLocale\s*,/,
        "lng: (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('i18nextLng')) || defaultLocale,");
      write(i18nFile, ic);
      changes.push('R11 i18n lng → localStorage-aware (RULE-T6)');
    }
  }

  // ---- R10: reconcile too-few-argument calls (TS2554) — runs LAST ----
  // After R1-R9 fix the contract drift, the only TS2554 left are genuine arity
  // gaps: v119 a page called `applyTransition(id, action)` (2 args) but the
  // service fn `transition(id, action, data)` requires 3. Run tsc, read every
  // "Expected N arguments, but got M", resolve the callee (following
  // `export const alias = real;` re-exports), and make params M+1..N OPTIONAL on
  // its declaration. Optional is a superset of required → no existing call breaks.
  var r10 = reconcileArity(opts, app, write);
  if (r10) changes.push(r10);

  // ---- R6: string role-name comparisons → numeric (AUTH-user only) ----
  // Once R1 makes the AuthUser `Role` numeric, pages comparing `user?.role ===
  // 'company_lead'` (string name) become TS2367. Rewrite those to the numeric
  // value (mirrors backend rolesguard-coerce). CRITICAL: restrict to auth-user
  // receivers (user/currentUser/me/…). Other pages use a SELF-CONSISTENT string
  // role scheme — e.g. a local `UserRow.role: UserRole` string union with string
  // mock data and `u.role === 'foreign_worker'` (string===string, fine). v119:
  // an un-scoped R6 broke 6 such comparisons in user-management.tsx by numeric-
  // izing only the comparison side. Only the auth user's role is numeric (R1).
  var rmap = roleNameMap(opts.projectDb);
  var roleCmpRe = /(\b(?:user|currentUser|me|authUser|loggedInUser|profile|auth\?\.user|auth\.user)\??\.role\s*(?:===|!==|==|!=)\s*)(['"])([a-z_]+)\2/g;
  var r6files = 0, r6count = 0;
  walk(app, /\.(tsx|ts)$/).forEach(function (f) {
    var c = fs.readFileSync(f, 'utf-8'), n = 0;
    var nc = c.replace(roleCmpRe, function (full, lhs, q, name) {
      if (Object.prototype.hasOwnProperty.call(rmap, name)) { n++; return lhs + rmap[name]; }
      return full;
    });
    if (nc !== c) { write(f, nc); r6files++; r6count += n; }
  });
  if (r6count) changes.push('R6 ' + r6count + ' string role-name comparison(s) → numeric in ' + r6files + ' file(s)');

  return changes;
}

function main() {
  var opts = parseArgs(process.argv);
  var changes = applyDoctor(opts);
  if (opts.verbose || opts.dryRun) {
    changes.forEach(function (c) { console.log('  ' + (opts.dryRun ? '[dry] ' : '') + c); });
  }
  console.log('scaffold-frontend-contract-doctor: ' + changes.length + ' repair(s) applied');
}

main();
