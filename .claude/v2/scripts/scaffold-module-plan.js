#!/usr/bin/env node
// scaffold-module-plan.js — v73 deterministic replacement for the
// emit-module-plan agentic node. Parses PROJECT_DATABASE.md (entity
// definitions), PROJECT_API.md (route prefixes), and
// PROJECT_KNOWLEDGE.md (role table) to emit a working MODULE_PLAN.yaml.
//
// The LLM-driven emit-module-plan is unreliable: v71's admin-dashboard
// frontend cell aborted at this step (mimo 429), and v71's actual
// MODULE_PLAN only had 3 modules instead of the expected 12+. This
// deterministic version produces consistent output in ~100ms.
//
// Strategy: this scaffolder writes a 'safe-default' MODULE_PLAN. The
// existing emit-module-plan can still run AFTER and OVERWRITE if the
// LLM wants to add nuance — but the deterministic fallback ensures
// downstream phases always have something to work with.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--status-dir') out.statusDir = argv[++i];
    else if (a === '--api') out.api = argv[++i];
    else if (a === '--db') out.db = argv[++i];
    else if (a === '--knowledge') out.knowledge = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--force') out.force = true;
  }
  if (!out.statusDir && !(out.api && out.db)) {
    console.error('Usage: scaffold-module-plan --status-dir <STATUS_DIR> [--api ...] [--db ...] [--knowledge ...] [--force]');
    process.exit(1);
  }
  return out;
}

function loadYaml() {
  try { return require('yaml'); } catch (_) {}
  return require(path.join(require('child_process').execSync('npm root -g', { encoding: 'utf-8' }).trim(), 'yaml'));
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
  // crude: strip trailing s/es/ies. Not a real inflector but good enough
  // for English column-name conventions.
  if (/ies$/i.test(s)) return s.replace(/ies$/i, 'y');
  if (/ses$/i.test(s)) return s.replace(/ses$/i, 's');
  if (/s$/i.test(s) && !/ss$/i.test(s)) return s.replace(/s$/i, '');
  return s;
}
function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, function (_m, c) { return c.toUpperCase(); });
}

// ── Parse PROJECT_DATABASE.md entity tables ─────────────────────────────

function parseEntities(dbMd) {
  // For each `### entity_name` section, extract the column table.
  // Returns: [{ name, table, columns: [{ column, type, constraints, description }] }]
  var entities = [];
  var sections = dbMd.split(/^### /m);
  for (var i = 1; i < sections.length; i++) {
    var s = sections[i];
    var firstLine = s.split(/\r?\n/)[0].trim();
    // Skip non-entity sections like "Indexes:" etc.
    if (!/^[a-z][a-z0-9_]*$/i.test(firstLine)) continue;
    var entity = { table: firstLine, columns: [] };
    entity.name = singularize(firstLine);

    // Find the column table: lines starting with | Column or | column
    var lines = s.split(/\r?\n/);
    var inTable = false;
    for (var j = 1; j < lines.length; j++) {
      var line = lines[j];
      if (/^\| Column \| Type/i.test(line)) { inTable = true; continue; }
      if (inTable && /^\|\s*-+/.test(line)) continue; // table separator
      if (inTable) {
        if (!/^\|/.test(line)) { inTable = false; continue; }
        var parts = line.split('|').map(function (p) { return p.trim(); }).filter(function (p, idx, arr) { return idx > 0 && idx < arr.length - 1; });
        if (parts.length < 2) continue;
        var col = {
          column: parts[0].replace(/`/g, ''),
          type: parts[1] || '',
          constraints: parts[2] || '',
          description: parts[3] || '',
        };
        entity.columns.push(col);
      }
    }
    entities.push(entity);
  }
  return entities;
}

// ── Parse PROJECT_API.md route resources ────────────────────────────────

function parseApiResources(apiMd) {
  // Sections under `### <Resource>` containing `#### METHOD `/path/...` `.
  // Returns: { byPrefix: { '/auth': [{method, path, section}, ...], '/users': [...], ... }, hasAuth: bool }
  var result = { byPrefix: {}, hasAuth: false, uploadPaths: [], workflowPaths: [] };
  var sections = apiMd.split(/^### /m);
  for (var i = 1; i < sections.length; i++) {
    var s = sections[i];
    var firstLine = s.split(/\r?\n/)[0].trim();
    var endpoints = [];
    var re = /^####\s+(GET|POST|PATCH|PUT|DELETE)\s+`(\S+)`/gm;
    var m;
    while ((m = re.exec(s)) !== null) {
      var method = m[1];
      var routePath = m[2];
      endpoints.push({ method: method, path: routePath, section: firstLine });
      var prefix = routePath.split('/').slice(0, 2).join('/');
      if (!result.byPrefix[prefix]) result.byPrefix[prefix] = [];
      result.byPrefix[prefix].push({ method: method, path: routePath, section: firstLine });
      if (/^\/auth\//.test(routePath)) result.hasAuth = true;
      if (/transitions/i.test(routePath)) result.workflowPaths.push(routePath);
      if (/upload|attach/i.test(routePath) || /multipart/i.test(s.slice(0, 500))) result.uploadPaths.push(routePath);
    }
  }
  return result;
}

// ── Parse PROJECT_KNOWLEDGE.md role table ──────────────────────────────

function parseRoles(knowledgeMd) {
  // Find "Role Definitions" or "Role Hierarchy" section + extract the
  // Internal Name column from its markdown table.
  var re = /### Role Definitions[\s\S]+?\|\s*Role\s*\|[\s\S]+?\n\n/;
  var m = re.exec(knowledgeMd);
  if (!m) return ['user', 'admin']; // fallback
  var section = m[0];
  var roles = [];
  var rowRe = /\|\s*[^|]+\|\s*`([^`]+)`/g;
  var r;
  while ((r = rowRe.exec(section)) !== null) {
    var name = r[1].trim();
    if (/^[a-z_]+$/.test(name)) roles.push(name);
  }
  return roles.length ? roles : ['user', 'admin'];
}

// ── Map columns → MODULE_PLAN fields ───────────────────────────────────

function mapColumnToField(col) {
  // Skip system columns
  if (/^(id|created_at|updated_at|deleted_at)$/i.test(col.column)) return null;
  if (/_id$/.test(col.column)) return null; // FK columns become relations, not fields

  var f = {
    name: snakeToCamel(col.column),
    type: 'string',
    validators: [],
  };
  if (col.column !== f.name) {
    f.column = { name: col.column };
  }

  var typeUpper = col.type.toUpperCase();
  if (/INT|BIGINT|SMALLINT|NUMERIC|DECIMAL/.test(typeUpper)) {
    f.type = 'number';
    f.validators.push('IsNumber');
  } else if (/BOOLEAN/.test(typeUpper)) {
    f.type = 'boolean';
    f.validators.push('IsBoolean');
  } else if (/TIMESTAMP|DATE/.test(typeUpper)) {
    f.type = 'Date';
    f.validators.push('IsDate');
  } else if (/UUID/.test(typeUpper)) {
    f.type = 'string';
    f.validators.push('IsUUID');
  } else if (/VARCHAR\((\d+)\)/.test(typeUpper)) {
    f.type = 'string';
    f.validators.push('IsString');
    var maxLen = RegExp.$1;
    f.validators.push('MaxLength:' + maxLen);
  } else {
    f.validators.push('IsString');
  }

  // Email detection
  if (/email/i.test(col.column)) {
    f.validators = ['IsEmail', 'IsNotEmpty'];
    if (/MaxLength:(\d+)/.test(JSON.stringify(f))) {
      // keep MaxLength from VARCHAR parse
    } else {
      f.validators.push('MaxLength:255');
    }
  }

  // Nullability
  if (/NOT NULL/i.test(col.constraints)) {
    if (!f.validators.includes('IsNotEmpty')) f.validators.push('IsNotEmpty');
    f.nullable = false;
  } else {
    f.validators.push('IsOptional');
    f.nullable = true;
  }

  // Unique
  if (/UNIQUE/i.test(col.constraints)) f.unique = true;

  // Swagger description from column description
  if (col.description) {
    f.swagger = { description: col.description.replace(/\s+/g, ' ').trim() };
  }

  return f;
}

function entityToRelations(entity) {
  var rels = [];
  for (var i = 0; i < entity.columns.length; i++) {
    var c = entity.columns[i];
    if (!/_id$/.test(c.column)) continue;
    // FK column: extract target table from "FK → <table>(id)" pattern
    var m = /FK\s*→?\s*([a-z_]+)/.exec(c.constraints);
    var targetTable = m ? m[1] : c.column.replace(/_id$/, '');
    rels.push({
      name: snakeToCamel(c.column.replace(/_id$/, '')),
      kind: 'ManyToOne',
      target: toPascal(singularize(targetTable)),
      nullable: !/NOT NULL/i.test(c.constraints),
    });
  }
  return rels;
}

// ── Build MODULE_PLAN ──────────────────────────────────────────────────

function buildModulePlan(entities, api, roles) {
  var plan = { modules: [] };

  // Identify auth presence
  var authEntityNames = ['user', 'account', 'profile'];
  var hasAuth = api.hasAuth && entities.some(function (e) { return authEntityNames.indexOf(e.name.toLowerCase()) >= 0; });

  // Map every entity → module (except user, which becomes auth)
  for (var i = 0; i < entities.length; i++) {
    var e = entities[i];
    if (e.name.toLowerCase() === 'user' && hasAuth) continue; // user goes into auth section

    var fields = [];
    for (var ci = 0; ci < e.columns.length; ci++) {
      var f = mapColumnToField(e.columns[ci]);
      if (f) fields.push(f);
    }
    var relations = entityToRelations(e);

    plan.modules.push({
      name: toKebab(e.name),
      entity: toPascal(e.name),
      table: e.table,
      plural: e.table,
      description: 'CRUD module for ' + e.name,
      fields: fields,
      relations: relations.length ? relations : undefined,
    });
  }

  // Auth section
  if (hasAuth) {
    var userEntity = entities.find(function (e) { return e.name.toLowerCase() === 'user'; });
    var signupFields = [];
    if (userEntity) {
      var includedNames = ['email', 'password_hash', 'name', 'phone', 'role'];
      for (var ufi = 0; ufi < userEntity.columns.length; ufi++) {
        var uc = userEntity.columns[ufi];
        if (includedNames.indexOf(uc.column) < 0) continue;
        var ff = mapColumnToField(uc);
        if (!ff) continue;
        // signup uses plaintext 'password' not 'password_hash'
        if (uc.column === 'password_hash') {
          ff.name = 'password';
          ff.column = undefined;
        }
        signupFields.push(ff);
      }
    }
    plan.auth = {
      user_entity: 'User',
      user_entity_module: 'user',
      identifier_field: 'email',
      password_field: 'passwordHash',
      roles: roles,
      access_ttl: '1h',
      refresh_ttl: '7d',
      signup_fields: signupFields,
    };
  }

  // Workflows: detect from API patterns
  if (api.workflowPaths.length > 0) {
    var workflowEntities = {};
    for (var wi = 0; wi < api.workflowPaths.length; wi++) {
      var wp = api.workflowPaths[wi];
      var entitySlug = wp.split('/')[1];
      workflowEntities[entitySlug] = true;
    }
    plan.workflows = Object.keys(workflowEntities).map(function (slug) {
      return {
        name: singularize(slug) + '-lifecycle',
        entity: toPascal(singularize(slug)),
        state_field: 'currentState',
        initial: 'draft',
        states: ['draft', 'submitted', 'approved', 'rejected'],
        transitions: [
          { from: 'draft', to: 'submitted', action: 'submit' },
          { from: 'submitted', to: 'approved', action: 'approve', guard: 'role.' + (roles.find(function (r) { return /admin|operator/i.test(r); }) || roles[0]) },
          { from: 'submitted', to: 'rejected', action: 'reject', guard: 'role.' + (roles.find(function (r) { return /admin|operator/i.test(r); }) || roles[0]) },
        ],
      };
    });
  }

  // Uploads: detect from API patterns
  if (api.uploadPaths.length > 0) {
    var uploadEntities = {};
    for (var ui = 0; ui < api.uploadPaths.length; ui++) {
      var up = api.uploadPaths[ui];
      var entitySlug = up.split('/')[1];
      uploadEntities[entitySlug] = true;
    }
    plan.uploads = Object.keys(uploadEntities).map(function (slug) {
      return {
        name: singularize(slug),
        entity: toPascal(singularize(slug)),
        storage: 'local',
        max_size_mb: 10,
        allowed_mime: ['image/png', 'image/jpeg', 'application/pdf'],
        fields: [],
      };
    });
  }

  return plan;
}

// ── Main ────────────────────────────────────────────────────────────────

function main() {
  var args = parseArgs(process.argv);
  var apiPath = args.api || path.join(args.statusDir, '../docs/PROJECT_API.md');
  var dbPath = args.db || path.join(args.statusDir, '../docs/PROJECT_DATABASE.md');
  var knowledgePath = args.knowledge || path.join(args.statusDir, '../docs/PROJECT_KNOWLEDGE.md');
  var outPath = args.out || path.join(args.statusDir, 'MODULE_PLAN.yaml');

  // If MODULE_PLAN already exists and looks valid, don't overwrite unless --force
  if (!args.force && fs.existsSync(outPath)) {
    var existing = fs.readFileSync(outPath, 'utf-8');
    if (/^\s*modules:\s*\n\s*-/m.test(existing) && existing.length > 200) {
      console.log('scaffold-module-plan: ' + outPath + ' already exists (' + existing.length + ' bytes) — keeping. Use --force to overwrite.');
      return;
    }
  }

  for (var i = 0; i < [apiPath, dbPath].length; i++) {
    var p = [apiPath, dbPath][i];
    if (!fs.existsSync(p)) {
      console.error('scaffold-module-plan: required file missing: ' + p);
      process.exit(1);
    }
  }

  var apiMd = fs.readFileSync(apiPath, 'utf-8');
  var dbMd = fs.readFileSync(dbPath, 'utf-8');
  var knowledgeMd = fs.existsSync(knowledgePath) ? fs.readFileSync(knowledgePath, 'utf-8') : '';

  var entities = parseEntities(dbMd);
  var api = parseApiResources(apiMd);
  var roles = parseRoles(knowledgeMd);

  if (args.verbose) {
    console.log('  parsed: entities=' + entities.length + ', route_prefixes=' + Object.keys(api.byPrefix).length + ', roles=' + roles.join(','));
  }

  var plan = buildModulePlan(entities, api, roles);

  var yaml = loadYaml();
  var header = '# Generated by scaffold-module-plan (deterministic).\n' +
               '# Derived from PROJECT_DATABASE.md entity tables + PROJECT_API.md\n' +
               '# routes + PROJECT_KNOWLEDGE.md roles. The LLM-driven\n' +
               '# emit-module-plan node may still run after this and refine.\n\n';
  var content = header + yaml.stringify(plan);

  if (args.dryRun) {
    console.log('  [dry] would write ' + outPath + ' (' + content.length + ' bytes, ' + plan.modules.length + ' modules)');
    return;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content);
  console.log('scaffold-module-plan: wrote ' + outPath + ' (' + content.length + ' bytes, ' + plan.modules.length + ' modules' +
              (plan.auth ? ' + auth' : '') +
              (plan.workflows ? ' + ' + plan.workflows.length + ' workflows' : '') +
              (plan.uploads ? ' + ' + plan.uploads.length + ' uploads' : '') +
              ')');
}

main();
