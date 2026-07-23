#!/usr/bin/env node
// scaffold-rolesguard-coerce-doctor.js
// v108: RolesGuard strict === fails when JWT carries numeric role values but
//       @Roles() decorators use string literals. Original fix: String()-coerce
//       both sides.
// v114: String-coerce is INSUFFICIENT. The DB/PRD use NUMERIC roles (smallint,
//       e.g. 0=foreign_worker) so the JWT carries `role: 0`, but @Roles() often
//       uses the NAME ('foreign_worker'). String('0') !== String('foreign_worker')
//       → 403 on every name-only-guarded endpoint (v114: worker stories failed,
//       admin stories that listed both name+number passed). Coercion can't bridge
//       a number to its name.
//
//       Fix: inject a canonical role MAP (number<->name, both directions) into
//       roles.guard.ts and reconcile every role form through it. The map is
//       derived from the PRD/PROJECT_DATABASE.md role-discriminator definition
//       (e.g. "0=foreign_worker, 1=company_staff, ..."). Falls back to identity
//       (name-only) when no numeric mapping is found.
//
// Usage:
//   node scaffold-rolesguard-coerce-doctor.js --target <BACKEND_DIR> [--docs <dir>] [--dry-run] [--verbose]
'use strict';

var fs = require('fs');
var path = require('path');

var args = process.argv.slice(2);
var target = null, docsArg = null, dryRun = false, verbose = false;
for (var i = 0; i < args.length; i++) {
  if (args[i] === '--target') target = args[++i];
  else if (args[i] === '--docs') docsArg = args[++i];
  else if (args[i] === '--dry-run') dryRun = true;
  else if (args[i] === '--verbose') verbose = true;
}
if (!target) {
  console.error('Usage: scaffold-rolesguard-coerce-doctor.js --target <BACKEND_DIR> [--docs <dir>] [--dry-run]');
  process.exit(1);
}

// Locate PROJECT_DATABASE.md / PROJECT_KNOWLEDGE.md to mine the number<->name map.
function findDocs() {
  var cands = [];
  if (docsArg) cands.push(docsArg);
  var dir = path.resolve(target);
  for (var up = 0; up < 6; up++) {
    var cp = path.join(dir, '.claude-project');
    if (fs.existsSync(cp)) {
      fs.readdirSync(cp).forEach(function (proj) {
        var d = path.join(cp, proj, 'docs');
        if (fs.existsSync(d)) cands.push(d);
      });
    }
    dir = path.dirname(dir);
  }
  return cands;
}

// Collect the set of ACTUAL role names, so we don't confuse the role
// discriminator (0=foreign_worker) with unrelated status enums (0=pending).
// Sources: RoleEnum string values + every non-numeric @Roles() literal.
function collectRoleNames() {
  var names = {};
  // RoleEnum values
  var rolesDir = path.join(target, 'src');
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(function (n) {
      if (n === 'node_modules' || n === 'dist') return;
      var full = path.join(dir, n);
      var st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/role\.enum\.ts$/.test(n)) {
        var t = fs.readFileSync(full, 'utf-8'), m;
        var re = /=\s*['"]([a-z][a-z_]+)['"]/g;
        while ((m = re.exec(t))) names[m[1]] = true;
      } else if (/\.ts$/.test(n)) {
        var c = fs.readFileSync(full, 'utf-8'), mm;
        var rr = /@Roles\(([^)]*)\)/g;
        while ((mm = rr.exec(c))) {
          var argRe = /['"]([a-z][a-z_]+)['"]/g, a;
          while ((a = argRe.exec(mm[1]))) names[a[1]] = true;
        }
      }
    });
  })(rolesDir);
  return names;
}

// Derive { '0': 'foreign_worker', ... } from doc text, KEEPING only pairs whose
// name is a known role (filters out status/other numeric enums in the same doc).
function deriveRoleMap(roleNames) {
  var num2name = {};
  var docDirs = findDocs();
  var files = [];
  docDirs.forEach(function (d) {
    ['PROJECT_DATABASE.md', 'PROJECT_KNOWLEDGE.md'].forEach(function (f) {
      var p = path.join(d, f);
      if (fs.existsSync(p)) files.push(p);
    });
  });
  files.forEach(function (f) {
    var txt = fs.readFileSync(f, 'utf-8');
    var m;
    var reA = /(\d+)\s*=\s*`?([a-z][a-z_]+)`?/g;       // "0=foreign_worker"
    while ((m = reA.exec(txt))) if (roleNames[m[2]]) num2name[m[1]] = m[2];
    var reB = /\|\s*(\d+)\s*\|\s*`?([a-z][a-z_]+)`?\s*\|/g; // "| 0 | foreign_worker |"
    while ((m = reB.exec(txt))) if (roleNames[m[2]]) num2name[m[1]] = m[2];
  });
  return num2name;
}

function buildCanonLiteral(num2name) {
  var canon = {};
  Object.keys(num2name).forEach(function (num) {
    var name = num2name[num];
    canon[num] = name;   // number-string → name
    canon[name] = name;  // name → name (identity)
  });
  return canon;
}

var guardPath = path.join(target, 'src', 'core', 'guards', 'roles.guard.ts');
if (!fs.existsSync(guardPath)) {
  console.log('[scaffold-rolesguard-coerce-doctor] roles.guard.ts not found — skipping');
  process.exit(0);
}
var src = fs.readFileSync(guardPath, 'utf-8');

if (src.indexOf('ROLE_CANON') >= 0) {
  console.log('[scaffold-rolesguard-coerce-doctor] already reconciles via ROLE_CANON — skipping');
  process.exit(0);
}

var num2name = deriveRoleMap(collectRoleNames());
var canon = buildCanonLiteral(num2name);
var mapEntries = Object.keys(canon).map(function (k) { return JSON.stringify(k) + ': ' + JSON.stringify(canon[k]); });
if (verbose) console.log('[scaffold-rolesguard-coerce-doctor] derived role map: ' + JSON.stringify(num2name));

var newBody =
  '        const { user } = context.switchToHttp().getRequest();\n\n' +
  '        // v114: reconcile role representations. The DB/JWT carry NUMERIC roles\n' +
  '        // (e.g. 0=foreign_worker) while @Roles() may use the NAME or the number.\n' +
  '        // Map every form to a canonical name before comparing.\n' +
  '        const ROLE_CANON: Record<string, string> = { ' + mapEntries.join(', ') + ' };\n' +
  '        const canon = (r: unknown): string => ROLE_CANON[String(r)] ?? String(r);\n' +
  '        const userForms: string[] = Array.isArray(user?.roles)\n' +
  '            ? (user.roles as unknown[]).map(canon)\n' +
  '            : [canon(user?.role)];\n' +
  '        return requiredRoles.some((role) => userForms.includes(canon(role)));';

var startRe = /const\s*\{\s*user\s*\}\s*=\s*context\.switchToHttp\(\)\.getRequest\(\);/;
var startMatch = startRe.exec(src);
if (!startMatch) {
  console.log('[scaffold-rolesguard-coerce-doctor] unexpected guard shape (no getRequest) — skipping');
  process.exit(0);
}
var startIdx = startMatch.index;
// Replace from `const { user }` to the END of the canActivate method body — i.e.
// the `}` that closes the method. Brace-count forward from startIdx; the first
// `}` that drops depth below 0 is the method close. (Replacing only up to the
// first return left the old strict-equality branch dangling — v114 bug.)
var depth = 0, endIdx = -1;
for (var ci = startIdx; ci < src.length; ci++) {
  var ch = src[ci];
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth < 0) { endIdx = ci; break; } }
}
if (endIdx < 0) {
  console.log('[scaffold-rolesguard-coerce-doctor] could not find method close — skipping');
  process.exit(0);
}
// newBody replaces the whole body; keep the closing `}` of the method.
var updated = src.slice(0, startIdx) + newBody + '\n    ' + src.slice(endIdx);

if (updated === src) {
  console.log('[scaffold-rolesguard-coerce-doctor] no change needed');
  process.exit(0);
}
if (verbose || dryRun) {
  console.log((dryRun ? '[dry-run] would patch' : 'patched') + ': ' + path.relative(target, guardPath) +
    ' (' + Object.keys(num2name).length + ' numeric role(s) mapped)');
}
if (!dryRun) fs.writeFileSync(guardPath, updated, 'utf-8');
console.log('[scaffold-rolesguard-coerce-doctor] done');
