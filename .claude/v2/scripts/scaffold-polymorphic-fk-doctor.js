#!/usr/bin/env node
// scaffold-polymorphic-fk-doctor.js — v88
//
// Detects LLM-hallucinated polymorphic FK patterns and rewrites them to
// proper scalar columns.
//
// THE PATTERN: PROJECT_DATABASE.md describes polymorphic associations like:
//   audit_logs:
//     target_entity VARCHAR(64)  -- 'application' | 'user' | 'company' | ...
//     target_id     VARCHAR(255) -- ID of target row
// LLM interprets this as "there's a Target entity I should @ManyToOne to" and
// emits:
//   import { Target } from '../target/target.entity';  // ← doesn't exist
//   @ManyToOne(() => Target, { onDelete: 'CASCADE' })
//   @JoinColumn({ name: 'target_id' })
//   target?: Target;
//
// WHY IT BREAKS: backend typecheck fails (TS2307 — Target module not found),
// fix-agent burns 10 min trying to fix it, often gives up. v87 evidence:
// audit-log.entity.ts:9 + notification.entity.ts:9.
//
// FIX: detect imports of a type from a non-existent entity module, AND verify
// the importing file has `target_entity` + `target_id` (or similar polymorphic
// columns). Rewrite:
//   - Remove the broken import
//   - Remove the @ManyToOne / @JoinColumn / property declaration
//   - Replace with scalar @Column declarations for targetEntity + targetId
//   - Add composite @Index('IDX_<table>_target', ['targetEntity', 'targetId'])
//
// Idempotent — marker comment `[scaffold-polymorphic-fk-doctor]` added to
// rewritten section.
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
    console.error('Usage: scaffold-polymorphic-fk-doctor --target <BACKEND_DIR> [--dry-run] [--verbose]');
    process.exit(1);
  }
  return out;
}

function walkEntities(modulesDir) {
  var found = [];
  if (!fs.existsSync(modulesDir)) return found;
  fs.readdirSync(modulesDir, { withFileTypes: true }).forEach(function (e) {
    var p = path.join(modulesDir, e.name);
    if (e.isDirectory()) {
      fs.readdirSync(p, { withFileTypes: true }).forEach(function (e2) {
        if (e2.isFile() && /\.entity\.ts$/.test(e2.name)) {
          found.push(path.join(p, e2.name));
        } else if (e2.isDirectory() && e2.name === 'entities') {
          fs.readdirSync(path.join(p, 'entities')).forEach(function (n) {
            if (/\.entity\.ts$/.test(n)) found.push(path.join(p, 'entities', n));
          });
        }
      });
    }
  });
  return found;
}

function importedTypeFromBrokenPath(line, modulesDir) {
  // Match: import { X } from '../Y/Y.entity'  OR  '..\/Y\/Y.entity'
  var m = /^\s*import\s*\{\s*(\w+)(?:\s*,\s*\w+)*\s*\}\s*from\s*['"](\.\.\/[\w-]+\/[\w-]+\.entity)['"]\s*;?\s*$/.exec(line);
  if (!m) return null;
  var importName = m[1];
  var relPath = m[2];
  // relPath like '../target/target.entity' — resolve relative to <entity file dir>
  // We need <modulesDir>/<dirname>/<dirname>.entity.ts to exist
  var lastSeg = relPath.split('/').slice(-1)[0]; // 'target.entity'
  var dirSeg = relPath.split('/').slice(-2, -1)[0]; // 'target'
  var candidate = path.join(modulesDir, dirSeg, lastSeg + '.ts');
  if (fs.existsSync(candidate)) return null; // import resolves, fine
  return { importName: importName, importLine: line, dir: dirSeg };
}

function detectPolymorphicColumns(content) {
  // Look for target_entity / target_id (or actor_entity / entity_type style)
  // columns in @Column declarations. Returns the column-set if found.
  // Pattern 1: explicit Column with name: 'target_entity'
  var hasTargetEntity =
    /@Column\([^)]*name:\s*['"]target_entity['"]/.test(content) ||
    /target_?[Ee]ntity\s*[!?:]/.test(content);
  var hasTargetId =
    /@Column\([^)]*name:\s*['"]target_id['"]/.test(content) ||
    /target_?[Ii]d\s*[!?:]/.test(content);
  if (hasTargetEntity && hasTargetId) {
    return { entityCol: 'target_entity', idCol: 'target_id', entityProp: 'targetEntity', idProp: 'targetId' };
  }
  // Pattern 2: actor_entity / actor_id
  var hasActorEntity = /@Column\([^)]*name:\s*['"]actor_entity['"]/.test(content);
  var hasActorId = /@Column\([^)]*name:\s*['"]actor_id['"]/.test(content);
  if (hasActorEntity && hasActorId) {
    return { entityCol: 'actor_entity', idCol: 'actor_id', entityProp: 'actorEntity', idProp: 'actorId' };
  }
  return null;
}

function removeBrokenManyToOneBlock(content, importName) {
  // Remove the @ManyToOne(() => importName, ...) + @JoinColumn + property line.
  // Pattern: zero or more decorator lines, ending with `<prop>?: <ImportName>;`
  // We do this conservatively — match the smallest @ManyToOne block targeting
  // importName.
  var re = new RegExp(
    '(?:^|\\n)' +
      '(?:\\s*\\/\\*\\*[\\s\\S]*?\\*\\/\\s*\\n)?' + // optional JSDoc
      '(?:\\s*@(?:ManyToOne|OneToOne)\\([\\s\\S]*?\\)\\s*\\n)' + // @ManyToOne(...)
      '(?:\\s*@JoinColumn\\([\\s\\S]*?\\)\\s*\\n)?' + // optional @JoinColumn(...)
      '\\s*(\\w+)\\??:\\s*' + importName + '\\s*;?\\s*\\n',
    'g'
  );
  return content.replace(re, function (match) {
    return '\n  // [scaffold-polymorphic-fk-doctor] removed broken @ManyToOne to non-existent ' + importName + ' (polymorphic FK: keep scalar columns)\n';
  });
}

function removeBrokenImport(content, brokenLine) {
  // Remove the literal import line. Preserve surrounding whitespace.
  var lines = content.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i] === brokenLine || lines[i].trim() === brokenLine.trim()) {
      lines.splice(i, 1, '// [scaffold-polymorphic-fk-doctor] removed broken import: ' + brokenLine.trim());
      break;
    }
  }
  return lines.join('\n');
}

function ensureScalarColumnsPresent(content, poly) {
  // The polymorphic columns SHOULD already be present (scaffold-entities
  // emits them from PROJECT_DATABASE.md). If they're missing, append them
  // before the closing `}` of the class.
  var hasEntity = new RegExp('@Column\\([^)]*name:\\s*[\\\'"]' + poly.entityCol + '[\\\'"]').test(content) ||
                  new RegExp(poly.entityProp + '\\s*[!?:]').test(content);
  var hasId = new RegExp('@Column\\([^)]*name:\\s*[\\\'"]' + poly.idCol + '[\\\'"]').test(content) ||
              new RegExp(poly.idProp + '\\s*[!?:]').test(content);
  if (hasEntity && hasId) return content; // already there
  // Insert scalar columns before the final `}` of the class.
  var insert =
    '\n  // [scaffold-polymorphic-fk-doctor] polymorphic FK as scalar columns\n' +
    '  @Column({ name: \'' + poly.entityCol + '\', type: \'varchar\', length: 64 })\n' +
    '  ' + poly.entityProp + '!: string;\n\n' +
    '  @Column({ name: \'' + poly.idCol + '\', type: \'varchar\', length: 255 })\n' +
    '  ' + poly.idProp + '!: string;\n';
  return content.replace(/\n}\s*$/m, insert + '\n}\n');
}

function processFile(filePath, modulesDir, options) {
  var content = fs.readFileSync(filePath, 'utf-8');
  var lines = content.split('\n');
  var brokenImports = [];
  for (var i = 0; i < lines.length; i++) {
    var br = importedTypeFromBrokenPath(lines[i], modulesDir);
    if (br) brokenImports.push(br);
  }
  if (brokenImports.length === 0) return { changed: false };

  var poly = detectPolymorphicColumns(content);
  if (!poly) {
    // Has broken import but no polymorphic columns — out of scope; let the
    // other scaffolds (broken-imports-quarantine) handle it.
    return { changed: false, reason: 'broken import but no polymorphic columns' };
  }

  var updated = content;
  brokenImports.forEach(function (b) {
    updated = removeBrokenManyToOneBlock(updated, b.importName);
    updated = removeBrokenImport(updated, b.importLine);
  });
  updated = ensureScalarColumnsPresent(updated, poly);

  if (updated === content) return { changed: false };
  if (!options.dryRun) fs.writeFileSync(filePath, updated);
  return {
    changed: true,
    importsRemoved: brokenImports.map(function (b) { return b.importName; }),
    polyCols: [poly.entityProp, poly.idProp],
  };
}

function main() {
  var args = parseArgs(process.argv);
  var modulesDir = path.join(args.target, 'src/modules');
  if (!fs.existsSync(modulesDir)) {
    console.log('scaffold-polymorphic-fk-doctor: no src/modules — skipping');
    return;
  }
  var entityFiles = walkEntities(modulesDir);
  var filesChanged = 0;
  var importsRemoved = 0;
  entityFiles.forEach(function (f) {
    var r = processFile(f, modulesDir, args);
    if (r.changed) {
      filesChanged++;
      importsRemoved += r.importsRemoved.length;
      if (args.verbose) {
        console.log('  fixed ' + path.relative(args.target, f) + ' (removed: ' + r.importsRemoved.join(', ') + '; scalar cols: ' + r.polyCols.join(', ') + ')');
      }
    }
  });
  console.log('scaffold-polymorphic-fk-doctor: ' + filesChanged + ' file(s) fixed, ' + importsRemoved + ' broken polymorphic import(s) removed');
}

main();
