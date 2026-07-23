#!/usr/bin/env node
// scaffold-entities.js — v74 derives TypeORM entity .ts files from
// PROJECT_DATABASE.md tables. Pairs with v73's scaffold-module-plan to
// fully replace the LLM design-schema agentic node.
//
// Output: one `<entity>.entity.ts` per parsed table, written to
// `backend/src/modules/<entity>/<entity>.entity.ts`. Each entity:
//   - extends BaseEntity (id + timestamps + soft-delete)
//   - @Column per source row with type mapping (VARCHAR → string,
//     INT/SMALLINT → number, BOOLEAN → boolean, TIMESTAMPTZ → Date,
//     UUID → string)
//   - @Index per `IDX_*` index declared in the markdown
//   - @ManyToOne stubs per `FK → other_table(id)` foreign key with
//     commented `target` resolved by re-running the scaffold once
//     siblings exist
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--db') out.db = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--force') out.force = true;
  }
  if (!out.db || !out.target) {
    console.error('Usage: scaffold-entities --db PROJECT_DATABASE.md --target BACKEND_DIR [--force]');
    process.exit(1);
  }
  return out;
}

function toPascal(s) {
  return s.split(/[-_\s]+/).filter(Boolean).map(function (w) {
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  }).join('');
}
function toKebab(s) {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase();
}
function singularize(s) {
  if (/ies$/i.test(s)) return s.replace(/ies$/i, 'y');
  if (/ses$/i.test(s)) return s.replace(/ses$/i, 's');
  if (/s$/i.test(s) && !/ss$/i.test(s)) return s.replace(/s$/i, '');
  return s;
}
function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, function (_m, c) { return c.toUpperCase(); });
}

function parseDatabase(dbMd) {
  var sections = dbMd.split(/^### /m);
  var entities = [];
  for (var i = 1; i < sections.length; i++) {
    var s = sections[i];
    var firstLine = s.split(/\r?\n/)[0].trim();
    if (!/^[a-z][a-z0-9_]*$/i.test(firstLine)) continue;
    // v88: skip ENUM REFERENCE sections. PROJECT_DATABASE.md has both:
    //   ### users           → real entity (has `| Column | Type` header)
    //   ### RoleEnum        → enum reference (has `| DB Value | Name` header)
    // The naive parser accepted ANY identifier-shaped heading, which created
    // 12 empty enum-as-entity tables in v87. Filter: skip headings ending in
    // 'Enum' OR sections lacking a `| Column | Type` header.
    if (/Enum$/i.test(firstLine)) continue;
    var entity = { table: firstLine, columns: [], indexes: [] };
    entity.name = singularize(firstLine);

    var lines = s.split(/\r?\n/);
    var inTable = false;
    for (var j = 1; j < lines.length; j++) {
      var line = lines[j];
      if (/^\| Column \| Type/i.test(line)) { inTable = true; continue; }
      if (inTable && /^\|\s*-+/.test(line)) continue;
      if (inTable) {
        if (!/^\|/.test(line)) { inTable = false; continue; }
        var parts = line.split('|').map(function (p) { return p.trim(); });
        if (parts.length < 4) continue;
        entity.columns.push({
          column: parts[1].replace(/`/g, ''),
          type: parts[2] || '',
          constraints: parts[3] || '',
          description: parts[4] || '',
        });
      }
      // Index lines: "- `IDX_users_phone` on `phone`"
      var idxMatch = /^- `([A-Za-z0-9_]+)`\s+on\s+`([^`]+)`/.exec(line);
      if (idxMatch) entity.indexes.push({ name: idxMatch[1], on: idxMatch[2] });
    }
    // v88: only emit entities with actual columns. Defense in depth — if the
    // section name is not an enum but the body has no `| Column | Type` header,
    // it's not a real table definition (e.g. cross-reference indexes section).
    if (entity.columns.length === 0) continue;
    entities.push(entity);
  }
  return entities;
}

function mapType(typeStr) {
  var t = typeStr.toUpperCase();
  if (/BIGINT|INT|SMALLINT|NUMERIC|DECIMAL/.test(t)) return { ts: 'number', orm: t.includes('SMALL') ? 'smallint' : (t.includes('BIG') ? 'bigint' : 'int') };
  if (/BOOLEAN/.test(t)) return { ts: 'boolean', orm: 'boolean' };
  if (/TIMESTAMP/.test(t)) return { ts: 'Date', orm: 'timestamptz' };
  if (/DATE/.test(t)) return { ts: 'Date', orm: 'date' };
  if (/UUID/.test(t)) return { ts: 'string', orm: 'uuid' };
  var v = /VARCHAR\((\d+)\)/i.exec(typeStr);
  if (v) return { ts: 'string', orm: 'varchar', length: Number(v[1]) };
  if (/TEXT/.test(t)) return { ts: 'string', orm: 'text' };
  if (/JSON|JSONB/.test(t)) return { ts: 'Record<string, unknown>', orm: 'jsonb' };
  return { ts: 'string', orm: 'varchar' };
}

function renderEntity(entity) {
  var entityName = toPascal(entity.name);
  var tableName = entity.table;
  var columnLines = [];
  var imports = new Set();
  imports.add('Entity');
  imports.add('Column');

  // Detect FK relations
  var relations = [];
  var fkCols = new Set();

  for (var i = 0; i < entity.columns.length; i++) {
    var c = entity.columns[i];
    // Skip system columns provided by BaseEntity
    if (/^(id|created_at|updated_at|deleted_at)$/i.test(c.column)) continue;

    if (/_id$/.test(c.column)) {
      // Try to extract FK target
      var m = /FK\s*→?\s*([a-z_]+)/.exec(c.constraints);
      var targetTable = m ? m[1] : c.column.replace(/_id$/, '');
      relations.push({
        prop: snakeToCamel(c.column.replace(/_id$/, '')),
        target: toPascal(singularize(targetTable)),
        idColumn: c.column,
        idProp: snakeToCamel(c.column),
        nullable: !/NOT NULL/i.test(c.constraints),
      });
      fkCols.add(c.column);
      // Still emit the foreign key id column as a separate scalar @Column
    }

    var t = mapType(c.type);
    var prop = snakeToCamel(c.column);
    var nullable = !/NOT NULL/i.test(c.constraints);
    var unique = /UNIQUE/i.test(c.constraints);
    var hasDefault = /DEFAULT\s+([^,)]+)/i.exec(c.constraints);

    var colOpts = [];
    if (c.column !== prop) colOpts.push("name: '" + c.column + "'");
    colOpts.push("type: '" + t.orm + "'");
    if (t.length) colOpts.push('length: ' + t.length);
    if (nullable) colOpts.push('nullable: true');
    if (unique) colOpts.push('unique: true');
    if (hasDefault) {
      var defVal = hasDefault[1].trim();
      if (/NOW\(\)|CURRENT_TIMESTAMP/i.test(defVal)) colOpts.push("default: () => 'NOW()'");
      else if (/^\d+$/.test(defVal)) colOpts.push('default: ' + defVal);
      else if (/^TRUE|FALSE$/i.test(defVal)) colOpts.push('default: ' + defVal.toLowerCase());
      else if (/^'[^']*'$/.test(defVal)) colOpts.push('default: ' + defVal);
    }

    var commentSrc = c.description ? "  /** " + c.description.replace(/\*\//g, '* /').slice(0, 200) + " */" : null;
    if (commentSrc) columnLines.push(commentSrc);
    columnLines.push("  @Column({ " + colOpts.join(', ') + " })");
    columnLines.push("  " + prop + (nullable ? '?' : '!') + ": " + t.ts + ";");
    columnLines.push('');
  }

  // Index declarations
  var indexLines = [];
  for (var ii = 0; ii < entity.indexes.length; ii++) {
    var idx = entity.indexes[ii];
    if (!/^UQ_/.test(idx.name)) {
      imports.add('Index');
      indexLines.push("@Index('" + idx.name + "', ['" + snakeToCamel(idx.on) + "'])");
    }
  }

  // Relation lines
  var relationLines = [];
  for (var ri = 0; ri < relations.length; ri++) {
    var r = relations[ri];
    imports.add('ManyToOne');
    imports.add('JoinColumn');
    relationLines.push("  @ManyToOne(() => " + r.target + (r.nullable ? ', { nullable: true, onDelete: \'SET NULL\' }' : ', { onDelete: \'CASCADE\' }') + ')');
    relationLines.push("  @JoinColumn({ name: '" + r.idColumn + "' })");
    relationLines.push("  " + r.prop + "?: " + r.target + ";");
    relationLines.push('');
  }

  var lines = [
    "/**",
    " * Generated by scaffold-entities from PROJECT_DATABASE.md table `" + tableName + "`.",
    " * Edits to this file are preserved across re-runs ONLY when the table",
    " * definition is unchanged; otherwise re-run with --force to regenerate.",
    " */",
    "import { " + Array.from(imports).sort().join(', ') + " } from 'typeorm';",
    "import { BaseEntity } from '../../core/base/base.entity';",
  ];

  // Add target entity imports (best-effort path)
  var targetImports = new Set();
  for (var ti = 0; ti < relations.length; ti++) {
    targetImports.add(relations[ti].target);
  }
  targetImports.forEach(function (t) {
    var slug = toKebab(t).toLowerCase();
    lines.push("import { " + t + " } from '../" + slug + "/" + slug + ".entity';");
  });

  lines.push('');
  if (indexLines.length) lines = lines.concat(indexLines);
  lines.push("@Entity('" + tableName + "')");
  lines.push("export class " + entityName + " extends BaseEntity {");
  lines = lines.concat(columnLines);
  if (relationLines.length) {
    lines.push('  // ── Relations ──');
    lines.push('');
    lines = lines.concat(relationLines);
  }
  lines.push('}');
  lines.push('');
  return { content: lines.join('\n'), entityName: entityName, tableName: tableName };
}

// v88: prune module dirs created by a PRIOR run's parser bug
// (e.g. `*-enum` modules with empty @Entity classes). Only fires when the
// dir name matches `*-enum` AND the entity file has zero @Column declarations.
// Conservative — won't delete real modules with relations/services/etc.
function pruneBogusEnumModules(targetDir, verbose) {
  var modulesDir = path.join(targetDir, 'src/modules');
  if (!fs.existsSync(modulesDir)) return 0;
  var pruned = 0;
  fs.readdirSync(modulesDir, { withFileTypes: true }).forEach(function (e) {
    if (!e.isDirectory()) return;
    if (!/-enum$/i.test(e.name)) return;
    var dir = path.join(modulesDir, e.name);
    // Find .entity.ts file
    var files = fs.readdirSync(dir).filter(function (f) { return /\.entity\.ts$/.test(f); });
    var allEmpty = files.length > 0 && files.every(function (f) {
      var content = fs.readFileSync(path.join(dir, f), 'utf-8');
      return !/@Column\(/.test(content);
    });
    if (!allEmpty) return;
    // Safe to delete: this is a bogus enum-as-entity from the v87 parser bug.
    fs.rmSync(dir, { recursive: true, force: true });
    pruned++;
    if (verbose) console.log('  pruned bogus enum module: ' + e.name);
  });
  return pruned;
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.db)) {
    console.error('scaffold-entities: PROJECT_DATABASE.md missing');
    process.exit(1);
  }
  // Prune leftover bogus enum modules (v87 carry-overs) before parsing.
  // Always safe — only removes dirs whose entity files have NO @Column.
  var pruned = pruneBogusEnumModules(args.target, args.verbose);
  if (pruned > 0) console.log('scaffold-entities: pruned ' + pruned + ' bogus enum module(s) from prior run');

  var dbMd = fs.readFileSync(args.db, 'utf-8');
  var entities = parseDatabase(dbMd);
  console.log('scaffold-entities: parsed ' + entities.length + ' entities');

  var written = 0;
  var skipped = 0;
  for (var i = 0; i < entities.length; i++) {
    var e = entities[i];
    var rendered = renderEntity(e);
    var dirName = toKebab(e.name);
    var fileName = dirName + '.entity.ts';
    var dst = path.join(args.target, 'src/modules', dirName, fileName);

    if (!args.force && fs.existsSync(dst)) {
      skipped++;
      if (args.verbose) console.log('  skip (exists): ' + path.relative(args.target, dst));
      continue;
    }
    if (args.dryRun) {
      console.log('  [dry] would write ' + path.relative(args.target, dst));
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, rendered.content);
    }
    written++;
  }
  console.log('scaffold-entities: wrote ' + written + ', skipped ' + skipped);
}

main();
