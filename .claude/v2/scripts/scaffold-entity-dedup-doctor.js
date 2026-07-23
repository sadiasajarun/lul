#!/usr/bin/env node
// scaffold-entity-dedup-doctor.js — v114
//
// Remove DUPLICATE TypeORM entity classes that register the same table.
//
// BUG PATTERN (v114 evidence): scaffold-entities couldn't parse the doubled
// PROJECT_DATABASE.md column format and emitted 0-column stub entities at
// modules/{singular}/{singular}.entity.ts. The LLM `implement` node then wrote
// COMPLETE entities at modules/{plural}/entities/{singular}.entity.ts. Result:
// EVERY table had TWO `@Entity('table')` classes. TypeORM registers both, so
// resolving the entity for a table is ambiguous — the seed/repo can pick the
// empty stub and throw `EntityPropertyNotFoundError: Property "email" was not
// found in "User"`, plus the backend fails to compile (two User classes).
//
// FIX: group entity files by their `@Entity('table')` name. For any table with
// more than one entity file, KEEP the most-complete one (most @Column/relation
// members; tie → most-imported; tie → shortest path) and DELETE the rest. Any
// file importing a deleted entity is repointed to the kept entity (same class
// name in practice; the import path is rewritten). Orphaned stubs (the common
// case) are simply removed.
//
// Idempotent: with no duplicates remaining it is a no-op.
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
  if (!out.target) {
    console.error('Usage: scaffold-entity-dedup-doctor --target <BACKEND_DIR> [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  fs.readdirSync(dir).forEach(function (name) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') return;
    var full = path.join(dir, name);
    var st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.entity\.ts$/.test(name)) acc.push(full);
  });
  return acc;
}

function entityTable(src) {
  // @Entity('users') | @Entity("users") | @Entity({ name: 'users' })
  var m = /@Entity\(\s*['"]([a-zA-Z0-9_]+)['"]/.exec(src) ||
          /@Entity\(\s*\{[^}]*name\s*:\s*['"]([a-zA-Z0-9_]+)['"]/.exec(src);
  return m ? m[1] : null;
}

function entityClass(src) {
  var m = /export\s+class\s+([A-Za-z0-9_]+)/.exec(src);
  return m ? m[1] : null;
}

function memberScore(src) {
  // Completeness proxy: count column + relation decorators.
  var re = /@(Column|PrimaryColumn|PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|ManyToOne|OneToMany|ManyToMany|OneToOne|JoinColumn|JoinTable)\b/g;
  var n = 0; while (re.exec(src)) n++;
  return n;
}

// Resolve an import specifier in `fromFile` to an absolute .ts path (best-effort).
function resolveImport(fromFile, spec) {
  if (spec[0] !== '.') return null; // only relative imports point at local entities
  var base = path.resolve(path.dirname(fromFile), spec);
  var cands = [base + '.ts', base + '.entity.ts', path.join(base, 'index.ts')];
  for (var i = 0; i < cands.length; i++) if (fs.existsSync(cands[i])) return cands[i];
  // also tolerate spec already ending without extension matching a file
  if (fs.existsSync(base) && /\.ts$/.test(base)) return base;
  return null;
}

function relImport(fromFile, toFile) {
  var rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/').replace(/\.ts$/, '');
  if (rel[0] !== '.') rel = './' + rel;
  return rel;
}

function processTarget(target, opts) {
  var srcDir = path.join(target, 'src');
  var files = walk(srcDir, []);
  var byTable = {};
  files.forEach(function (f) {
    var src = fs.readFileSync(f, 'utf-8');
    var table = entityTable(src);
    if (!table) return;
    (byTable[table] = byTable[table] || []).push({
      file: f, cls: entityClass(src), score: memberScore(src),
    });
  });

  // Count how many files import each entity file (for tiebreak).
  var importCount = {};
  files.forEach(function (f) {
    var src = fs.readFileSync(f, 'utf-8');
    var re = /from\s+['"]([^'"]+)['"]/g, m;
    while ((m = re.exec(src))) {
      var r = resolveImport(f, m[1]);
      if (r) importCount[r] = (importCount[r] || 0) + 1;
    }
  });

  var deletions = []; // { del, keep }
  Object.keys(byTable).forEach(function (table) {
    var group = byTable[table];
    if (group.length < 2) return;
    group.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;              // most members first
      var ic = (importCount[b.file] || 0) - (importCount[a.file] || 0); // then most-imported
      if (ic !== 0) return ic;
      return a.file.length - b.file.length;                           // then shortest path
    });
    var keep = group[0];
    group.slice(1).forEach(function (g) { deletions.push({ del: g, keep: keep, table: table }); });
  });

  if (deletions.length === 0) {
    console.log('scaffold-entity-dedup-doctor: no duplicate @Entity tables across ' + files.length + ' entity file(s)');
    return;
  }

  // Repoint importers of each deleted file to the kept file, then delete.
  var allTs = [];
  walkAllTs(srcDir, allTs);
  var fixed = 0;
  deletions.forEach(function (d) {
    if (opts.verbose || opts.dryRun) {
      console.log('  table "' + d.table + '": keep ' + path.relative(target, d.keep.file) +
        ' (' + d.keep.score + ' members), drop ' + path.relative(target, d.del.file) + ' (' + d.del.score + ')');
    }
    if (opts.dryRun) return;
    // Repoint imports
    allTs.forEach(function (tf) {
      if (tf === d.del.file) return;
      if (!fs.existsSync(tf)) return; // skip files deleted in an earlier iteration
      var src = fs.readFileSync(tf, 'utf-8'), changed = false;
      src = src.replace(/from\s+(['"])([^'"]+)\1/g, function (full, q, spec) {
        var resolved = resolveImport(tf, spec);
        if (resolved && resolved === d.del.file) {
          changed = true;
          var newSpec = relImport(tf, d.keep.file);
          return 'from ' + q + newSpec + q;
        }
        return full;
      });
      // If kept class name differs from deleted, rename the imported identifier too.
      if (changed && d.keep.cls && d.del.cls && d.keep.cls !== d.del.cls) {
        var nameRe = new RegExp('\\b' + d.del.cls + '\\b', 'g');
        src = src.replace(nameRe, d.keep.cls);
      }
      if (changed) { fs.writeFileSync(tf, src); }
    });
    fs.unlinkSync(d.del.file);
    fixed++;
  });

  console.log('scaffold-entity-dedup-doctor: removed ' + fixed + ' duplicate entity file(s) across ' +
    Object.keys(byTable).filter(function (t) { return byTable[t].length > 1; }).length + ' table(s)');
}

function walkAllTs(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  fs.readdirSync(dir).forEach(function (name) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') return;
    var full = path.join(dir, name);
    var st = fs.statSync(full);
    if (st.isDirectory()) walkAllTs(full, acc);
    else if (/\.ts$/.test(name)) acc.push(full);
  });
  return acc;
}

function main() {
  var opts = parseArgs(process.argv);
  processTarget(opts.target, opts);
}

main();
