#!/usr/bin/env node
// scaffold-seed-script-multi-entity.js — v89
//
// Patches the LLM-generated seed.ts to seed ALL fixture sections (companies,
// applications, documents, etc.) — not just users — and to map fixture-key
// references like `companyId: comp_uuid_active_1` to real generated UUIDs.
//
// THE BUG: existing scaffold-seed-script emits a seed.ts that only handles
// users. _fixtures.yaml has users, companies, services, applications,
// documents sections. User fixtures reference companyId='comp_uuid_active_1'
// — a literal string that fails Postgres UUID column parse. The whole
// downstream test-api + test-browser fails because there are no companies
// to satisfy user.companyId FKs.
//
// STRATEGY: append additional seed functions to seed.ts AFTER scaffold-seed-script
// has emitted the user-only baseline. Each new function:
//   - Reads the matching fixture section
//   - For each entry, generates a UUID, maps `<fixture-key>` → `<uuid>`
//   - Inserts the row with proper FK resolution
//
// Ordering (FK dependency graph, simple topological):
//   1. companies      (no FKs)
//   2. users          (FK → companies via companyId)
//   3. services       (no FKs, just a lookup table)
//   4. applications   (FKs → users.workerId + companies.companyId)
//   5. documents      (FK → users)
//   6. application_documents (FKs → applications + documents)
//
// IDEMPOTENT: marker comment `[scaffold-seed-script-multi-entity]` added
// to the appended block. Re-runs detect the marker and don't re-append.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--fixtures') out.fixtures = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target || !out.fixtures) {
    console.error('Usage: scaffold-seed-script-multi-entity --target <BACKEND_DIR> --fixtures <_fixtures.yaml>');
    process.exit(1);
  }
  return out;
}

function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  try {
    return require(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim(), 'yaml'));
  } catch (_) {
    console.error('scaffold-seed-script-multi-entity: yaml package unavailable — skipping');
    process.exit(0);
  }
}

var YAML = loadYaml();
var MARKER = '// [scaffold-seed-script-multi-entity]';

// v90: NO hardcoded sections. We derive sections from the fixture YAML
// directly and infer entity names + FK references automatically. The user
// section is special — it's seeded by the existing seedUsers() in seed.ts
// and we wrap it with seedUsersWithUuidMap below.
//
// FK inference: any field named `<otherSection>Id` (e.g. companyId →
// companies, applicationId → applications) is auto-resolved via uuidMap.
// Entity name inference: TitleCase the singularized section name.

function generateSeedFunction(sectionConfig) {
  var section = sectionConfig.section;
  var entityName = sectionConfig.entityName;
  var fkResolve = sectionConfig.fkResolve || {};

  var lines = [];
  lines.push('async function seed' + capitalize(camelize(section)) + '(ds: DataSource, fixtures: RawFixtures, uuidMap: Record<string, string>): Promise<void> {');
  lines.push('  const sectionFixtures = (fixtures as Record<string, unknown>)[' + JSON.stringify(section) + '] as Record<string, Record<string, unknown>> | undefined;');
  lines.push('  if (!sectionFixtures) { console.log(\'seed: no ' + section + ': section — skipping\'); return; }');
  lines.push('  // Find the entity class registered with this DataSource. Match by table');
  lines.push('  // name (snake_case) first, then by class name. If no match, skip the');
  lines.push('  // section gracefully — scaffold-entities may not have produced this entity.');
  lines.push('  const targetName = ' + JSON.stringify(entityName) + ';');
  lines.push('  const tableCandidates = [');
  lines.push('    targetName,');
  lines.push('    ' + JSON.stringify(section) + ',');
  lines.push('  ];');
  lines.push('  const meta = ds.entityMetadatas.find(m =>');
  lines.push('    m.name === targetName ||');
  lines.push('    tableCandidates.includes(m.tableName)');
  lines.push('  );');
  lines.push('  if (!meta) { console.log(\'seed: no ' + entityName + ' entity registered — skipping ' + section + '\'); return; }');
  lines.push('  const repo = ds.getRepository(meta.target as { new(): unknown });');
  lines.push('  const columnNames = new Set(meta.columns.map(c => c.propertyName));');
  lines.push('  let created = 0, updated = 0;');
  // v114: a section entry may be a SINGLE object OR an ARRAY of objects. The
  // documents fixture groups rows under a logical owner key (worker_1: [ ...docs ]).
  // The old code spread the array into {0:,1:,2:} → stripped to {} → null-FK crash.
  lines.push('  for (const [key, rawBody] of Object.entries(sectionFixtures)) {');
  lines.push('    const rows = Array.isArray(rawBody) ? rawBody : [rawBody];');
  lines.push('    for (const body of rows) {');
  lines.push('      if (!body || typeof body !== \'object\') continue;');
  lines.push('      if (Object.values(body).every(v => v === null)) continue; // placeholder (e.g. guest)');
  lines.push('      const inserted = { ...body } as Record<string, unknown>;');
  // FK resolution: replace fixture-key references with real UUIDs from uuidMap.
  // v114: also resolve the `<prefix>_uuid_<key>` convention (e.g. workerId:
  // usr_uuid_worker_active → users:worker_active) and remember the owner so
  // sibling sections that group rows under the same key can reuse it.
  Object.keys(fkResolve).forEach(function (fkField) {
    var refSection = fkResolve[fkField];
    lines.push('      // Resolve ' + fkField + ' (' + refSection + ' ref) to a real UUID');
    lines.push('      if (typeof inserted[' + JSON.stringify(fkField) + '] === \'string\') {');
    lines.push('        const refKey = inserted[' + JSON.stringify(fkField) + '] as string;');
    lines.push('        const stripped = /^[a-z]+_uuid_(.+)$/.exec(refKey);');
    lines.push('        const resolved = uuidMap[' + JSON.stringify(refSection) + ' + \':\' + refKey]');
    lines.push('          || uuidMap[refKey]');
    lines.push('          || (stripped ? uuidMap[' + JSON.stringify(refSection) + ' + \':\' + stripped[1]] : undefined);');
    lines.push('        if (resolved) {');
    lines.push('          inserted[' + JSON.stringify(fkField) + '] = resolved;');
    if (refSection === 'users') {
      lines.push('          uuidMap[\'__owner__:\' + key] = resolved; // remember owner for sibling sections grouped under this key');
    }
    lines.push('        }');
    lines.push('      }');
  });
  // v114: inject an implicit owner FK from the grouping key. The documents
  // fixture lists rows under "worker_1" with no per-row workerId; the same key
  // appears in the applications section WITH a workerId, so it was recorded in
  // uuidMap['__owner__:worker_1'] above (applications seed before documents).
  lines.push('      // Inject implicit owner FK (e.g. documents grouped under a worker key)');
  lines.push('      const ownerCol = meta.columns.find(c => /^(worker|user|owner)Id$/.test(c.propertyName) && !c.isNullable);');
  lines.push('      if (ownerCol && (inserted[ownerCol.propertyName] === undefined || inserted[ownerCol.propertyName] === null)) {');
  lines.push('        const owner = uuidMap[\'__owner__:\' + key] || uuidMap[\'users:\' + key];');
  lines.push('        if (owner) inserted[ownerCol.propertyName] = owner;');
  lines.push('      }');
  lines.push('      // Drop fields that aren\'t real columns on the entity');
  lines.push('      for (const k of Object.keys(inserted)) { if (!columnNames.has(k)) delete inserted[k]; }');
  // v114: fill required (NOT NULL, no DB default) columns the fixture omitted, so
  // under-specified fixtures (documents lack file_path/mime_type/uploaded_at,
  // and use `size` instead of `fileSize`) still insert. Only safe scalar types
  // are defaulted; uuid/enum are left alone (FK/constrained — can't invent).
  lines.push('      for (const col of meta.columns) {');
  lines.push('        if (col.isPrimary || col.isNullable) continue;');
  lines.push('        if (col.default !== undefined && col.default !== null) continue;');
  lines.push('        if (col.isCreateDate || col.isUpdateDate || col.isDeleteDate || col.isVersion) continue;');
  lines.push('        const pn = col.propertyName;');
  lines.push('        if (inserted[pn] !== undefined && inserted[pn] !== null) continue;');
  lines.push('        const t = String(col.type).toLowerCase();');
  lines.push('        if (/char|text|varying/.test(t)) {');
  lines.push('          let ph = \'seed-\' + pn;');
  lines.push('          if (col.length) ph = ph.slice(0, Number(col.length));');
  lines.push('          inserted[pn] = ph;');
  lines.push('        } else if (/bool/.test(t)) inserted[pn] = false;');
  lines.push('        else if (/int|numeric|decimal|float|double|real|money/.test(t)) inserted[pn] = 0;');
  lines.push('        else if (/time|date/.test(t)) inserted[pn] = new Date();');
  lines.push('        else if (/json/.test(t)) inserted[pn] = {};');
  lines.push('        // uuid / enum / unknown: leave unset — cannot safely invent');
  lines.push('      }');
  // v128: idempotent + FK-resolvable. The old template ALWAYS inserted, so a
  // re-seed (companies/users persist across runs) hit a duplicate-key unique
  // constraint, the entity was never registered in uuidMap, and EVERY child FK
  // reference (companyId/userId placeholders) then failed to resolve → the raw
  // placeholder string ("comp_uuid_active_1") went into a uuid column and threw.
  // Fix: find an existing row by a single-column unique key FIRST; whether found
  // or freshly created, register its id (+ symbolic refs) so children resolve.
  lines.push('      const __uniqCols: string[] = [];');
  lines.push('      for (const __ix of meta.indices) if (__ix.isUnique && __ix.columns.length === 1) __uniqCols.push(__ix.columns[0].propertyName);');
  lines.push('      for (const __uq of meta.uniques) if (__uq.columns.length === 1) __uniqCols.push(__uq.columns[0].propertyName);');
  // v95: register "symbolic-ref" fields whose values look like fixture-key
  // references (camelCase ending in "Id", value not already a uuid) so later
  // sections resolve e.g. `companyId: comp_uuid_active_1`.
  lines.push('      const __registerRefs = (id: string) => {');
  lines.push('        uuidMap[' + JSON.stringify(section) + ' + \':\' + key] = id;');
  lines.push('        for (const [bk, bv] of Object.entries(body as Record<string, unknown>)) {');
  lines.push('          if (typeof bv === \'string\' && /Id$/.test(bk) && !/^[0-9a-f]{8}-/.test(bv)) uuidMap[bv] = id;');
  lines.push('        }');
  lines.push('      };');
  lines.push('      try {');
  lines.push('        let __existing: { id?: string } | null = null;');
  lines.push('        for (const __uc of __uniqCols) {');
  lines.push('          if (inserted[__uc] !== undefined && inserted[__uc] !== null) {');
  lines.push('            __existing = await repo.findOne({ where: { [__uc]: inserted[__uc] } } as object) as { id?: string } | null;');
  lines.push('            if (__existing) break;');
  lines.push('          }');
  lines.push('        }');
  lines.push('        if (__existing && __existing.id) {');
  lines.push('          __registerRefs(__existing.id);');
  lines.push('          updated++;');
  lines.push('        } else {');
  lines.push('          const saved = await repo.save(repo.create(inserted as object)) as { id?: string };');
  lines.push('          if (saved && saved.id) __registerRefs(saved.id);');
  lines.push('          created++;');
  lines.push('        }');
  lines.push('      } catch (e) {');
  lines.push('        console.warn(\'  seed ' + section + '[\' + key + \'] failed: \' + (e as Error).message);');
  lines.push('      }');
  lines.push('    }');
  lines.push('  }');
  lines.push('  console.log(\'seed: ' + section + ' — \' + created + \' created, \' + updated + \' updated\');');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function camelize(s) { return s.replace(/_([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

function main() {
  var args = parseArgs(process.argv);
  var seedPath = path.join(args.target, 'src/database/seed.ts');
  if (!fs.existsSync(seedPath)) {
    console.log('scaffold-seed-script-multi-entity: no seed.ts at ' + seedPath + ' — skipping');
    return;
  }
  if (!fs.existsSync(args.fixtures)) {
    console.log('scaffold-seed-script-multi-entity: no _fixtures.yaml — skipping');
    return;
  }

  var seedContent = fs.readFileSync(seedPath, 'utf-8');
  if (seedContent.indexOf(MARKER) >= 0) {
    if (!args.force) {
      console.log('scaffold-seed-script-multi-entity: marker present — already patched (use --force to re-apply the upgraded template)');
      return;
    }
    // v128 --force: the scaffold CLASS was upgraded (idempotent find-existing +
    // uuidMap registration). Revert the prior patch so the new template applies:
    // restore the redirected call, then strip the appended extension block.
    seedContent = seedContent.replace(
      /\/\* \[scaffold-seed-script-multi-entity\] redirected to multi-entity \*\/ await seedAllWithUuidMap\(ds, fixtures\);/,
      'await seedUsers(ds, fixtures);'
    );
    var extIdx = seedContent.indexOf(MARKER + ' — multi-entity seed extension');
    if (extIdx >= 0) seedContent = seedContent.slice(0, extIdx).replace(/\s+$/, '\n');
    console.log('scaffold-seed-script-multi-entity: --force — reverted prior patch, re-applying upgraded template');
  }

  var fixturesRaw = fs.readFileSync(args.fixtures, 'utf-8');
  var fixturesDoc;
  try { fixturesDoc = YAML.parse(fixturesRaw); } catch (e) {
    console.log('scaffold-seed-script-multi-entity: fixtures parse failed — skipping');
    return;
  }
  if (!fixturesDoc) return;

  // Derive sections from the fixture YAML itself. Skip `users` (handled
  // separately by the wrapper). Order is best-effort topological: sections
  // with FK references to others come AFTER their dependencies.
  var allSections = Object.keys(fixturesDoc).filter(function (k) {
    return k !== 'users' && fixturesDoc[k] && typeof fixturesDoc[k] === 'object';
  });
  // Build dependency graph by inspecting first entry of each section for
  // <other>Id fields whose <other> matches another section name.
  function sectionFKs(section) {
    var entries = fixturesDoc[section];
    if (!entries || typeof entries !== 'object') return [];
    var firstKey = Object.keys(entries)[0];
    var firstVal = firstKey ? entries[firstKey] : null;
    if (!firstVal || typeof firstVal !== 'object') return [];
    var fks = [];
    Object.keys(firstVal).forEach(function (fkField) {
      var m = /^(.+)Id$/.exec(fkField);
      if (!m) return;
      // Try plural + singular match against other section names.
      // v114: include the -y → -ies plural (company → companies) which the bare
      // +s form (companys) missed.
      var refSingular = m[1];
      var candidates = [refSingular + 's', refSingular.replace(/y$/, 'ies'), refSingular];
      var found = candidates.find(function (c) { return allSections.indexOf(c) >= 0; }) ||
                  (refSingular === 'worker' || refSingular === 'user' ? 'users' : null);
      // v114: ignore a section's self-referential `<section>Id` field (e.g.
      // applications.applicationId — the row's OWN id, not a cross-section FK).
      // Treating it as a dependency deadlocked the topo sort and pushed
      // applications AFTER documents, so the worker-owner map wasn't ready when
      // documents (grouped under the same key) needed it.
      if (found && found !== section) fks.push({ field: fkField, refSection: found });
    });
    return fks;
  }
  // Topological sort: sections with no FK refs first
  var sortedSections = [];
  var remaining = allSections.slice();
  var maxIter = remaining.length * 2;
  while (remaining.length > 0 && maxIter-- > 0) {
    for (var i = 0; i < remaining.length; i++) {
      var fks = sectionFKs(remaining[i]);
      var allRefsSorted = fks.every(function (fk) {
        return fk.refSection === 'users' || sortedSections.indexOf(fk.refSection) >= 0;
      });
      if (allRefsSorted) {
        sortedSections.push(remaining[i]);
        remaining.splice(i, 1);
        break;
      }
    }
  }
  // Append remaining (cyclic deps fall through)
  remaining.forEach(function (s) { sortedSections.push(s); });

  // Build applicable list with derived entity name + fk resolution map
  var applicable = sortedSections.map(function (section) {
    // Entity name: singularize + TitleCase. companies → Company, application_documents → ApplicationDocument
    var singular = section.replace(/ies$/, 'y').replace(/s$/, '').replace(/^([a-z])/, function (c) { return c.toUpperCase(); });
    var entityName = singular.replace(/_([a-z])/g, function (_m, c) { return c.toUpperCase(); });
    var fkResolve = {};
    sectionFKs(section).forEach(function (fk) {
      fkResolve[fk.field] = fk.refSection;
    });
    return { section: section, entityName: entityName, fkResolve: fkResolve };
  });
  if (applicable.length === 0) {
    console.log('scaffold-seed-script-multi-entity: no extra fixture sections to seed — skipping');
    return;
  }

  // Generate the new seed functions + a wrapper that runs them in order
  // around the existing seedUsers().
  var generatedFns = applicable.map(generateSeedFunction).join('\n');
  var orderedCalls = [];
  // Run companies BEFORE users so user FKs resolve. The existing seedUsers
  // is preserved and called between companies and applications.
  orderedCalls.push('await seedCompanies(ds, fixtures, uuidMap);');
  orderedCalls.push('await seedUsersWithUuidMap(ds, fixtures, uuidMap);');
  applicable.forEach(function (s) {
    if (s.section === 'companies') return; // already first
    orderedCalls.push('await seed' + capitalize(camelize(s.section)) + '(ds, fixtures, uuidMap);');
  });

  // The existing seedUsers function reads fixtures directly. We patch it
  // to ALSO resolve companyId references via the uuidMap.
  var addendum = [
    '',
    MARKER + ' — multi-entity seed extension',
    '// Generated functions that seed companies, services, applications, documents',
    '// in dependency order. Each function maps fixture keys to real UUIDs via',
    '// uuidMap, so subsequent inserts can resolve FK references.',
    '',
    generatedFns,
    '',
    '// Patched user seeder that also resolves companyId fixture-key references.',
    'async function seedUsersWithUuidMap(ds: DataSource, fixtures: RawFixtures, uuidMap: Record<string, string>): Promise<void> {',
    '  if (!fixtures.users) { console.log(\'seed: no users: section — skipping\'); return; }',
    '  const userMeta = ds.entityMetadatas.find(m => m.name === \'User\' || m.tableName === \'users\');',
    '  if (!userMeta) { console.log(\'seed: no User entity registered\'); return; }',
    '  const repo = ds.getRepository(userMeta.target as { new(): unknown });',
    '  const columnNames = new Set(userMeta.columns.map(c => c.propertyName));',
    '  let created = 0, updated = 0;',
    '  for (const [key, body] of Object.entries(fixtures.users)) {',
    '    if (!body || typeof body !== \'object\') continue;',
    '    if (Object.values(body).every(v => v === null)) continue;',
    '    // v114: skip non-account placeholder users (e.g. `guest`) — a null email',
    '    // can\'t satisfy the NOT NULL/unique email column and isn\'t a real login.',
    '    if ((body as Record<string, unknown>).email == null) { console.log(\'seed: users[\' + key + \'] skipped (no email)\'); continue; }',
    '    const inserted: Record<string, unknown> = { ...body };',
    '    // Resolve companyId ref → uuid',
    '    if (typeof inserted.companyId === \'string\') {',
    '      const refKey = inserted.companyId as string;',
    '      const resolved = uuidMap[\'companies:\' + refKey] || uuidMap[refKey];',
    '      if (resolved) inserted.companyId = resolved;',
    '    }',
    '    // Hash password if present',
    '    if (typeof inserted.password === \'string\') {',
    '      inserted.passwordHash = await bcrypt.hash(inserted.password as string, 10);',
    '      delete inserted.password;',
    '    }',
    '    for (const k of Object.keys(inserted)) { if (!columnNames.has(k)) delete inserted[k]; }',
    '    // v114: fill required (NOT NULL, no default) columns the fixture omitted',
    '    // (e.g. a user fixture missing `phone`) so the row still inserts. Login',
    '    // only needs email+password; a placeholder phone is harmless test data.',
    '    for (const col of userMeta.columns) {',
    '      if (col.isPrimary || col.isNullable) continue;',
    '      if (col.default !== undefined && col.default !== null) continue;',
    '      if (col.isCreateDate || col.isUpdateDate || col.isDeleteDate || col.isVersion) continue;',
    '      const pn = col.propertyName;',
    '      if (inserted[pn] !== undefined && inserted[pn] !== null) continue;',
    '      const t = String(col.type).toLowerCase();',
    '      if (/char|text|varying/.test(t)) { let ph = \'seed-\' + pn; if (col.length) ph = ph.slice(0, Number(col.length)); inserted[pn] = ph; }',
    '      else if (/bool/.test(t)) inserted[pn] = false;',
    '      else if (/int|numeric|decimal|float|double|real|money/.test(t)) inserted[pn] = 0;',
    '      else if (/time|date/.test(t)) inserted[pn] = new Date();',
    '      else if (/json/.test(t)) inserted[pn] = {};',
    '    }',
    '    try {',
    '      // v128: idempotent — find an existing user by a single-column unique',
    '      // key DERIVED FROM ENTITY METADATA (PRD-agnostic, not a hardcoded',
    '      // "email"). The old always-insert hit duplicate-key on re-seed AND',
    '      // never registered the existing user id in uuidMap, so applications/',
    '      // documents could not resolve their userId/workerId FK.',
    '      const __uniqCols: string[] = [];',
    '      for (const __ix of userMeta.indices) if (__ix.isUnique && __ix.columns.length === 1) __uniqCols.push(__ix.columns[0].propertyName);',
    '      for (const __uq of userMeta.uniques) if (__uq.columns.length === 1) __uniqCols.push(__uq.columns[0].propertyName);',
    '      if (__uniqCols.length === 0 && columnNames.has(\'email\')) __uniqCols.push(\'email\');',
    '      let __existing: { id?: string } | null = null;',
    '      for (const __uc of __uniqCols) {',
    '        if (inserted[__uc] !== undefined && inserted[__uc] !== null) {',
    '          __existing = await repo.findOne({ where: { [__uc]: inserted[__uc] } } as object) as { id?: string } | null;',
    '          if (__existing) break;',
    '        }',
    '      }',
    '      if (__existing && __existing.id) {',
    '        uuidMap[\'users:\' + key] = __existing.id;',
    '        updated++;',
    '      } else {',
    '        const saved = await repo.save(repo.create(inserted as object)) as { id?: string };',
    '        if (saved && saved.id) uuidMap[\'users:\' + key] = saved.id;',
    '        created++;',
    '      }',
    '    } catch (e) {',
    '      console.warn(\'  seed users[\' + key + \'] failed: \' + (e as Error).message);',
    '    }',
    '  }',
    '  console.log(\'seed: users — \' + created + \' created, \' + updated + \' updated\');',
    '}',
    '',
    '// Multi-entity seed orchestrator. Replaces the original seedUsers call.',
    'async function seedAllWithUuidMap(ds: DataSource, fixtures: RawFixtures): Promise<void> {',
    '  const uuidMap: Record<string, string> = {};',
    '  ' + orderedCalls.join('\n  '),
    '  console.log(\'seed: multi-entity done — \' + Object.keys(uuidMap).length + \' refs mapped\');',
    '}',
    '',
    '// Intercept the main flow: replace the original seedUsers(ds, fixtures)',
    '// call with seedAllWithUuidMap. We do this by exporting a runMultiEntity',
    '// function that the existing main() can call.',
    'export { seedAllWithUuidMap };',
    '',
  ].join('\n');

  // Replace the existing `await seedUsers(ds, fixtures);` call (if present)
  // with `await seedAllWithUuidMap(ds, fixtures);`. Keeps the original
  // seedUsers function around for compatibility — it just won't be invoked.
  var patched = seedContent.replace(
    /await\s+seedUsers\s*\(\s*ds\s*,\s*fixtures\s*\)\s*;/,
    '/* [scaffold-seed-script-multi-entity] redirected to multi-entity */ await seedAllWithUuidMap(ds, fixtures);'
  ) + '\n' + addendum;

  if (args.dryRun) {
    console.log('scaffold-seed-script-multi-entity: [dry] would append ' + applicable.length + ' new seed function(s) + uuidMap orchestration');
    return;
  }
  fs.writeFileSync(seedPath, patched);
  console.log('scaffold-seed-script-multi-entity: patched seed.ts — added ' + applicable.length + ' seeders (' + applicable.map(function (s) { return s.section; }).join(', ') + ') + uuidMap');
}

main();
