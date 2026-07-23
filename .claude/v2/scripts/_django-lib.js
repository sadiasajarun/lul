// _django-lib.js — shared contract parsers + naming helpers for the Django/DRF
// scaffold family (scaffold-django-models / -serializers / -viewsets / …).
// The parsers are STACK-AGNOSTIC (they read PROJECT_DATABASE.md / PROJECT_API.md,
// the same contract docs the NestJS scaffolds consume); only the emitters differ.
'use strict';
var fs = require('fs');

function toPascal(s) {
  return String(s).split(/[-_\s]+/).filter(Boolean).map(function (w) {
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  }).join('');
}
function singularize(s) {
  if (/ies$/.test(s)) return s.replace(/ies$/, 'y');
  if (/ses$/.test(s)) return s.replace(/es$/, '');
  if (/s$/.test(s)) return s.replace(/s$/, '');
  return s;
}

// Parse PROJECT_DATABASE.md `### <table>` sections → [{table, name, columns, indexes}].
function parseDatabase(dbMd) {
  var sections = dbMd.split(/^### /m);
  var entities = [];
  for (var i = 1; i < sections.length; i++) {
    var s = sections[i];
    var firstLine = s.split(/\r?\n/)[0].trim();
    if (!/^[a-z][a-z0-9_]*$/i.test(firstLine)) continue;
    if (/Enum$/i.test(firstLine)) continue;
    var entity = { table: firstLine, name: singularize(firstLine), columns: [], indexes: [] };
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
        entity.columns.push({ column: parts[1].replace(/`/g, ''), type: parts[2] || '', constraints: parts[3] || '', description: parts[4] || '' });
      }
      var idxMatch = /^- `([A-Za-z0-9_]+)`\s+on\s+`([^`]+)`/.exec(line);
      if (idxMatch) entity.indexes.push({ name: idxMatch[1], on: idxMatch[2] });
    }
    if (entity.columns.length === 0) continue;
    entities.push(entity);
  }
  return entities;
}

// Parse PROJECT_API.md for endpoints → [{method, path, resource}]. Tolerant of
// the common markdown shapes (`### GET /api/applications`, table rows, or
// `- GET /api/...`). Resource = first path segment after /api.
function parseApi(apiMd) {
  var routes = [];
  var seen = {};
  var re = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_\/:{}-]+)/g;
  var m;
  while ((m = re.exec(apiMd)) !== null) {
    var method = m[1], p = m[2].replace(/\/$/, '');
    var key = method + ' ' + p;
    if (seen[key]) continue; seen[key] = true;
    var seg = p.replace(/^\/api\/?/, '').split('/')[0];
    if (!seg) continue;
    routes.push({ method: method, path: p, resource: seg });
  }
  return routes;
}

// Distinct top-level resources that have at least one collection route.
function apiResources(apiMd) {
  var routes = parseApi(apiMd);
  var set = {};
  routes.forEach(function (r) { if (/^[a-z][a-z0-9-]*$/.test(r.resource)) set[r.resource] = true; });
  return Object.keys(set);
}

module.exports = { toPascal, singularize, parseDatabase, parseApi, apiResources };
