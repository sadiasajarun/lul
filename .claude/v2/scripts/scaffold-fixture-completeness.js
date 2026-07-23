#!/usr/bin/env node
// scaffold-fixture-completeness.js — v88
//
// Ensure _fixtures.yaml entries have values for every NOT-NULL column on their
// target entity. Prevents seed-script crashes like:
//
//   ERROR: null value in column "phone" of relation "users" violates not-null constraint
//
// THE BUG: PROJECT_DATABASE.md spec → entity has `phone VARCHAR(20) NOT NULL`
// → seed.ts inserts user → fixture YAML lacks `phone` → Postgres rejects.
//
// v87 evidence: smoke-test step 4/6 failed with NOT NULL violation on phone
// for `worker_pending` user. test-api phase failed, test-browser stories
// crashed at global-setup.
//
// STRATEGY:
//   1. Discover entity NOT NULL columns by scanning backend/src/modules/**/*.entity.ts
//      (parse @Column decorators, exclude nullable, default-having, and primary
//      generated columns; soft-delete `deletedAt` is excluded by BaseEntity).
//   2. Parse _fixtures.yaml. Map fixture sections (users → User, companies → Company)
//      via simple plural→singular heuristic + entity name match.
//   3. For each fixture entry that's not the special `guest` placeholder (all-null),
//      ensure NOT NULL columns are present. Insert sensible defaults if missing:
//      - phone: '010-0000-0000'
//      - email: <key>@fixture.test
//      - password: 'TestPass1!'
//      - name: title-cased <key>
//      - languagePreference: 'en'
//      - role: 0 (foreign_worker default)
//      - status: 0 (pending default)
//      - generic varchar: '<key>-<column>'
//   4. Idempotent: if a field is already present (even as null for explicit
//      placeholder), don't overwrite.
//
// Marker comment `# [scaffold-fixture-completeness] added` injected on added lines.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--fixtures') out.fixtures = argv[++i];
    else if (a === '--backend') out.backend = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.fixtures || !out.backend) {
    console.error('Usage: scaffold-fixture-completeness --fixtures <_fixtures.yaml> --backend <BACKEND_DIR>');
    process.exit(1);
  }
  return out;
}

function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  try {
    return require(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim(), 'yaml'));
  } catch (_) {
    console.error('scaffold-fixture-completeness: yaml package not available — skipping');
    process.exit(0);
  }
}

var YAML = loadYaml();

// Heuristic plural → singular for fixture-section → entity-name mapping.
function singularize(plural) {
  if (/ies$/.test(plural)) return plural.replace(/ies$/, 'y');
  if (/es$/.test(plural)) return plural.replace(/es$/, '');
  if (/s$/.test(plural)) return plural.replace(/s$/, '');
  return plural;
}

function findEntityFiles(backendDir) {
  var modulesDir = path.join(backendDir, 'src/modules');
  var out = [];
  if (!fs.existsSync(modulesDir)) return out;
  fs.readdirSync(modulesDir, { withFileTypes: true }).forEach(function (e) {
    if (!e.isDirectory()) return;
    var dir = path.join(modulesDir, e.name);
    fs.readdirSync(dir).forEach(function (f) {
      if (/\.entity\.ts$/.test(f)) out.push(path.join(dir, f));
    });
    var entitiesDir = path.join(dir, 'entities');
    if (fs.existsSync(entitiesDir)) {
      fs.readdirSync(entitiesDir).forEach(function (f) {
        if (/\.entity\.ts$/.test(f)) out.push(path.join(entitiesDir, f));
      });
    }
  });
  return out;
}

function parseEntityRequiredFields(content) {
  // Returns { entityName, required: [{ field, type }] }
  var m = /export\s+class\s+(\w+)\s+extends\s+BaseEntity/.exec(content);
  if (!m) return null;
  var entityName = m[1];
  var lines = content.split('\n');
  var required = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var col = /@Column\(([^)]*)\)/.exec(line);
    if (!col) continue;
    var opts = col[1];
    // Skip nullable or default-having
    if (/nullable\s*:\s*true/.test(opts)) continue;
    if (/default\s*:/.test(opts)) continue;
    if (/PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn/.test(line)) continue;
    // The property declaration is on the next non-blank, non-comment line
    var propLine = '';
    for (var j = i + 1; j < lines.length && j < i + 5; j++) {
      var t = lines[j].trim();
      if (!t || /^\/\//.test(t) || /^\/\*/.test(t) || /^@/.test(t)) continue;
      propLine = t;
      break;
    }
    var pm = /^(\w+)([!?]):\s*(\w+)/.exec(propLine);
    if (!pm) continue;
    if (pm[2] === '?') continue; // optional → nullable
    required.push({ field: pm[1], type: pm[3].toLowerCase() });
  }
  return { entityName: entityName, required: required };
}

// v89: fields that should NEVER appear directly in fixture YAML —
// they're either auto-generated (id, timestamps) or derived from another
// fixture field (passwordHash derived from `password` via bcrypt).
// Returning null from defaultValueFor causes the field to be skipped.
var SEED_MANAGED_FIELDS = new Set([
  'passwordHash',          // seed.ts bcrypts `password` → passwordHash
  'id',                    // PrimaryGeneratedColumn
  'createdAt',             // CreateDateColumn
  'updatedAt',             // UpdateDateColumn
  'deletedAt',             // DeleteDateColumn (soft delete)
]);

function defaultValueFor(field, key, type) {
  // Skip fields managed by ORM/seed pipeline (see SEED_MANAGED_FIELDS).
  // For passwordHash specifically, scaffold-seed-script auto-hashes `password`.
  if (SEED_MANAGED_FIELDS.has(field)) return null;
  // Heuristic defaults per common field name first, then type. Values are
  // INTENTIONALLY GENERIC (e.g. E.164 international phone format, not a
  // country-specific format) so this scaffold works for any project.
  if (field === 'phone' || field === 'phoneNumber') return '+10000000000';
  if (field === 'email' || field === 'emailAddress') return key + '@fixture.test';
  if (field === 'password') return 'TestPass1!';
  if (field === 'name' || field === 'displayName' || field === 'fullName' || field === 'firstName' || field === 'lastName') {
    return key.replace(/[-_]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  if (field === 'languagePreference' || field === 'language' || field === 'locale') return 'en';
  if (field === 'role' || field === 'status') return 0; // smallint columns typically default to 0
  if (/url|website|link|homepage/i.test(field)) return 'https://example.test';
  if (/timezone|tz$/i.test(field)) return 'UTC';
  if (/currency/i.test(field)) return 'USD';
  if (/country/i.test(field)) return 'US';
  if (type === 'string') return key + '-' + field;
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  return null;
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.fixtures)) {
    console.log('scaffold-fixture-completeness: fixtures file not found — skipping');
    return;
  }
  var raw = fs.readFileSync(args.fixtures, 'utf-8');
  var doc;
  try { doc = YAML.parse(raw); } catch (e) {
    console.log('scaffold-fixture-completeness: fixture YAML parse failed: ' + e.message + ' — skipping');
    return;
  }
  if (!doc || typeof doc !== 'object') {
    console.log('scaffold-fixture-completeness: no top-level fixture sections — skipping');
    return;
  }

  // Build entity catalog: { entityNamePlural → { required, entityName } }
  var entityFiles = findEntityFiles(args.backend);
  var entityCatalog = {};
  entityFiles.forEach(function (f) {
    var content = fs.readFileSync(f, 'utf-8');
    var parsed = parseEntityRequiredFields(content);
    if (!parsed) return;
    // Match by class name (lowercased) + plural form
    var lc = parsed.entityName.toLowerCase();
    entityCatalog[lc + 's'] = parsed; // companies → company → ok via singularize too
    entityCatalog[lc] = parsed;
  });

  var addedTotal = 0;
  var sectionsFixed = 0;

  // Edit the YAML text in-place line by line. We can't reliably round-trip
  // YAML through library serialization without losing comments + ordering,
  // so we do targeted line insertion under each fixture entry.
  var lines = raw.split('\n');
  var newLines = [];
  var i = 0;
  var inSection = null;
  var sectionEntity = null;
  var inEntry = null;
  var entryStartIdx = -1;
  var entryFieldsSeen = new Set();
  var entryIndent = '';

  function flushEntry() {
    if (!inEntry || !sectionEntity) { return; }
    var missing = sectionEntity.required.filter(function (r) { return !entryFieldsSeen.has(r.field); });
    if (missing.length === 0) { return; }

    // Find the entry's content range: from entryStartIdx+1 forward, scanning
    // for the last line at field-indent. The entry header sits at section-
    // indent; entry fields are at section-indent + 2. Anything dedented below
    // section-indent (including the NEXT entry header at section-indent)
    // ENDS this entry's content.
    var sectionIndent = entryIndent.length - 2; // entryIndent is "  " more than entry header

    // Determine the entry header indent by re-inspecting entryStartIdx
    var headerLine = newLines[entryStartIdx] || '';
    var headerIndent = (headerLine.match(/^\s*/) || [''])[0].length;

    var lastFieldIdx = entryStartIdx; // initially the header itself
    var nonNullFieldsCount = 0;
    var hasNestedStructure = false;
    for (var k = entryStartIdx + 1; k < newLines.length; k++) {
      var ln = newLines[k];
      // Blank line — could be inside or between entries; record but keep scanning
      if (ln.trim() === '') continue;
      var lnIndent = (ln.match(/^\s*/) || [''])[0].length;
      // Dedent <= header → this line belongs to the NEXT entry or section
      if (lnIndent <= headerIndent) break;
      // v89: detect nested structures (list items or sub-mappings deeper
      // than field-indent). Examples:
      //   documents:                ← field at expected indent
      //     - documentId: doc_001   ← NESTED LIST starting with -
      //     - documentId: doc_002
      //   nestedMap:                ← field at expected indent
      //     subkey: value           ← deeper nesting
      // If we detect either pattern, skip injection on this entry. The
      // entry has complex structure that our naive line-splice would corrupt.
      if (lnIndent > entryIndent.length) {
        // Anything deeper than field-indent means nested structure
        hasNestedStructure = true;
      }
      // List item: dash at field-indent
      if (lnIndent === entryIndent.length && /^\s+-\s/.test(ln)) {
        hasNestedStructure = true;
      }
      // This line is part of the current entry
      lastFieldIdx = k;
      var mm = /^\s+(\w+):\s*(.*)/.exec(ln);
      if (mm && mm[1] !== 'description') {
        var val = mm[2].trim();
        if (val && val !== 'null') nonNullFieldsCount++;
      }
    }
    // Skip placeholder entries (e.g. `guest:` where everything is null)
    if (nonNullFieldsCount === 0) { return; }
    // Skip entries with nested structures (we can't safely splice without
    // potentially placing fields inside a nested context).
    if (hasNestedStructure) { return; }

    var injectionPoint = lastFieldIdx + 1;
    var insert = [];
    missing.forEach(function (r) {
      // v89: passwordHash special case — fixture should have plaintext
      // `password` instead; seed.ts bcrypt-hashes it. Only add `password`
      // if neither `password` nor `passwordHash` already in the fixture.
      if (r.field === 'passwordHash') {
        if (!entryFieldsSeen.has('password') && !entryFieldsSeen.has('passwordHash')) {
          insert.push(entryIndent + 'password: "TestPass1!"  # [scaffold-fixture-completeness] added (plaintext; seed bcrypts to passwordHash)');
          addedTotal++;
        }
        return;
      }
      var val = defaultValueFor(r.field, inEntry, r.type);
      if (val === null) return;
      var fmtVal;
      if (typeof val === 'string') fmtVal = '"' + val.replace(/"/g, '\\"') + '"';
      else fmtVal = String(val);
      insert.push(entryIndent + r.field + ': ' + fmtVal + '  # [scaffold-fixture-completeness] added');
      addedTotal++;
    });
    if (insert.length === 0) return;
    sectionsFixed++;
    newLines.splice.apply(newLines, [injectionPoint, 0].concat(insert));
  }

  function startEntry(name, indent) {
    flushEntry();
    inEntry = name;
    // The entry header line was just pushed to newLines BEFORE this call.
    // flushEntry above may have spliced new lines BEFORE that position,
    // shifting the entry header's actual index. So we find the LAST line
    // in newLines (which is the entry header).
    entryStartIdx = newLines.length - 1;
    entryFieldsSeen = new Set();
    entryIndent = indent;
  }

  function startSection(name) {
    flushEntry();
    inSection = name;
    sectionEntity = entityCatalog[name] || entityCatalog[singularize(name)] || null;
    inEntry = null;
  }

  while (i < lines.length) {
    var line = lines[i];
    newLines.push(line);
    // Top-level section heading: `users:`
    var secM = /^([a-zA-Z_][\w-]*):\s*$/.exec(line);
    if (secM) { startSection(secM[1]); i++; continue; }
    // Entry heading: `  worker_pending:`
    var entM = /^(\s+)([a-zA-Z_][\w-]*):\s*$/.exec(line);
    if (entM && inSection) {
      // Field indentation will be entM[1] + 2 spaces
      startEntry(entM[2], entM[1] + '  ');
      i++; continue;
    }
    // Field line under entry: `    role: 0`
    if (inEntry) {
      var fm = /^(\s+)([a-zA-Z_][\w-]*):\s*/.exec(line);
      if (fm) {
        entryFieldsSeen.add(fm[2]);
      }
    }
    i++;
  }
  flushEntry();

  if (addedTotal === 0) {
    console.log('scaffold-fixture-completeness: 0 missing NOT NULL fields detected — fixtures complete');
    return;
  }
  if (args.dryRun) {
    console.log('scaffold-fixture-completeness: [dry] would add ' + addedTotal + ' field(s) across ' + sectionsFixed + ' entry(ies)');
    return;
  }
  fs.writeFileSync(args.fixtures, newLines.join('\n'));
  console.log('scaffold-fixture-completeness: added ' + addedTotal + ' missing field(s) across ' + sectionsFixed + ' entry(ies)');
}

main();
