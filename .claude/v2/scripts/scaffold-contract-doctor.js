#!/usr/bin/env node
// scaffold-contract-doctor.js — v108
//
// Parse PROJECT_API.md endpoint tables, find any documented endpoint that
// has no implementing controller method, and emit a 501 Not Implemented
// stub. This converts "missing endpoint" from HTTP 404 (unclear) to HTTP
// 501 (clear "documented but not implemented" signal) — and makes the gap
// visible to gates instead of silently failing test-browser stories.
//
// v104 evidence: 15+ stories per cell failed with `GET /dashboard/stats
// returned HTTP 404 (not implemented)` etc. because LLM-emitted controllers
// missed endpoints PROJECT_API.md documents. Without this doctor, those
// stories silently fail at runtime instead of failing at scaffold time.
//
// v108: when documented paths use an access prefix (admin/X, company/X,
// worker/X) and no controller has that EXACT prefix, emit a new
// `admin-<resource>.controller.ts` (or `company-…`) in the matching resource
// module instead of stripping the prefix and attaching stubs to the resource
// controller — which served the wrong URL and left /api/admin/notices,
// /api/admin/faq, /api/admin/users etc. as 404. v107 evidence.
//
// Idempotent — existing methods (any controller with a route matching the
// documented path) are NOT modified. Only MISSING endpoints get stubs.
//
// Per template_wins_LLM + doctors_over_route_to_agent.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--api-md') out.apiMd = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  if (!out.target || !out.apiMd) {
    console.error('Usage: scaffold-contract-doctor --target <BACKEND_DIR> --api-md <PROJECT_API.md>');
    process.exit(1);
  }
  return out;
}

// Parse markdown table rows: | METHOD | `path` | description | auth |
function parseEndpoints(apiMdContent) {
  var lines = apiMdContent.split('\n');
  var out = [];
  var inTable = false;
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (/^\|\s*Method\s*\|\s*Path/.test(ln)) { inTable = true; continue; }
    if (inTable && /^\|\s*-+\s*\|/.test(ln)) continue;
    if (inTable && !/^\|/.test(ln)) { inTable = false; continue; }
    if (!inTable) continue;
    var m = /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`([^`]+)`\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/.exec(ln);
    if (m) {
      out.push({
        method: m[1].toUpperCase(),
        path: m[2].trim(),
        description: m[3].trim(),
        auth: m[4].trim(),
      });
    }
  }
  return out;
}

// Discover all controller files + extract @Controller prefix(es).
// v108: A single .controller.ts file may declare MULTIPLE @Controller
// classes (e.g. `applications` + `admin/applications` in one file).
// `prefixes` is the list of all controllers in the file; `prefix` is set
// to the FIRST one for backward compat with injectStub (which picks via
// pickController and only mutates the file content).
function discoverControllers(modulesDir) {
  var out = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      var p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.controller\.ts$/.test(e.name)) {
        var content = fs.readFileSync(p, 'utf-8');
        var re = /@Controller\(\s*['"]([^'"]*)['"]\s*\)[\s\S]*?export\s+class\s+(\w+)/g;
        var match;
        var prefixes = [];
        var firstClass = null;
        while ((match = re.exec(content)) !== null) {
          prefixes.push(match[1]);
          if (!firstClass) firstClass = match[2];
        }
        if (prefixes.length === 0) prefixes.push('');
        out.push({
          path: p,
          prefix: prefixes[0],
          prefixes: prefixes,
          className: firstClass,
          content: content,
        });
      }
    });
  }
  walk(modulesDir);
  return out;
}

// Normalize a path: strip leading/trailing slashes, lowercase, kebab.
function normPath(p) {
  return p.replace(/^\/+|\/+$/g, '').toLowerCase();
}

// Convert URL params (`:id` etc.) to a regex pattern that matches the
// equivalent in a controller's @Get('...') / @Post('...') decoration.
// Both representations use `:id` so we just normalize to that.
function paramNormalize(p) {
  return normPath(p).replace(/\{(\w+)\}/g, ':$1');
}

// Determine if a controller file already handles a given (METHOD, fullPath)
// pair under ANY of its @Controller prefixes. v108: iterate prefixes array.
function hasMethodForPath(controller, method, fullPath) {
  var full = paramNormalize(fullPath);
  var prefixes = controller.prefixes || [controller.prefix || ''];
  for (var i = 0; i < prefixes.length; i++) {
    var pfx = paramNormalize(prefixes[i] || '');
    if (pfx && !full.startsWith(pfx)) continue;
    var sub = full.slice(pfx.length).replace(/^\/+/, '');
    var decRe = new RegExp('@' + method.charAt(0) + method.slice(1).toLowerCase() + '\\(\\s*(?:[\'"]([^\'"]*)[\'"])?\\s*\\)', 'g');
    var m;
    while ((m = decRe.exec(controller.content)) !== null) {
      var declared = paramNormalize(m[1] || '');
      if (declared === sub) return true;
      if (declared === '' && sub === '') return true;
    }
  }
  return false;
}

// Generate a method name for a (METHOD, subPath) — e.g.
//   GET '/'              → findAll
//   GET ':id'            → findById
//   POST ''              → create
//   GET 'stats'          → getStats
//   POST ':id/cancel'    → cancelById
function methodNameFor(method, subPath) {
  var clean = subPath.replace(/^\/+|\/+$/g, '');
  var segs = clean.split('/').filter(Boolean);
  if (segs.length === 0) {
    return method === 'GET' ? 'findAll'
         : method === 'POST' ? 'create'
         : method === 'PUT' ? 'update'
         : method === 'PATCH' ? 'patch'
         : method === 'DELETE' ? 'remove' : 'handle';
  }
  // Convert kebab/snake → camel, strip ':' from params, capitalize each segment except first
  function camelize(s) { return s.replace(/[-_:](\w)/g, function (_, c) { return c.toUpperCase(); }).replace(/:/g, ''); }
  var parts = segs.map(camelize);
  var verb = method === 'GET' ? 'get'
           : method === 'POST' ? 'post'
           : method === 'PUT' ? 'put'
           : method === 'PATCH' ? 'patch'
           : method === 'DELETE' ? 'delete' : 'handle';
  // Capitalize first part, leading verb
  var name = verb + parts.map(function (p, i) {
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join('');
  return name;
}

// Find the best controller to attach a missing endpoint to.
// Heuristic: longest matching prefix wins; if no direct match, try
// stripping the `admin/` or `company/` access-prefix and re-matching.
// Many LLM-emitted controllers use the RESOURCE name (`notices`,
// `faq`, `service-types`) instead of the documented access-prefixed
// path (`/admin/notices`, `/admin/faq`, etc.).
function pickController(controllers, fullPath) {
  var full = paramNormalize(fullPath);
  var best = null, bestLen = -1, bestPrefix = '';
  function consider(c, candidatePath) {
    var prefixes = c.prefixes || [c.prefix || ''];
    for (var i = 0; i < prefixes.length; i++) {
      var pfx = paramNormalize(prefixes[i] || '');
      if (pfx && candidatePath.startsWith(pfx) && pfx.length > bestLen) {
        best = c; bestLen = pfx.length; bestPrefix = pfx;
      }
    }
  }
  controllers.forEach(function (c) { consider(c, full); });
  if (best) { best._bestPrefix = bestPrefix; return best; }
  // Fallback: strip access-prefix
  var stripped = full
    .replace(/^admin\//, '')
    .replace(/^company\//, '')
    .replace(/^worker\//, '');
  if (stripped !== full) {
    controllers.forEach(function (c) { consider(c, stripped); });
  }
  if (best) best._bestPrefix = bestPrefix;
  return best;
}

function injectStub(controller, method, fullPath, description, auth) {
  var pfx = paramNormalize(controller._bestPrefix || controller.prefix);
  var full = paramNormalize(fullPath);
  // If full path starts with controller prefix, strip it. Otherwise try
  // stripping admin/company access-prefix first (fallback matching path).
  var subPath;
  if (pfx && full.startsWith(pfx)) {
    subPath = full.slice(pfx.length).replace(/^\/+/, '');
  } else {
    var stripped = full.replace(/^admin\//, '').replace(/^company\//, '').replace(/^worker\//, '');
    if (stripped !== full && pfx && stripped.startsWith(pfx)) {
      subPath = stripped.slice(pfx.length).replace(/^\/+/, '');
    } else {
      subPath = full.slice(pfx ? pfx.length : 0).replace(/^\/+/, '');
    }
  }
  var fnName = methodNameFor(method, subPath);
  // Avoid name collision with existing methods.
  var collisionRe = new RegExp('\\b' + fnName + '\\s*\\(', 'g');
  var n = 0;
  while (collisionRe.test(controller.content)) {
    n++;
    fnName = fnName + n;
    collisionRe = new RegExp('\\b' + fnName + '\\s*\\(', 'g');
    if (n > 9) break;
  }

  // Determine parameters: `:id` → `@Param('id') id: string`
  var paramMatches = Array.from(subPath.matchAll(/:(\w+)/g));
  var paramDecls = paramMatches.map(function (m) { return "@Param('" + m[1] + "') " + m[1] + ": string"; });
  var bodyParam = (method === 'POST' || method === 'PUT' || method === 'PATCH')
    ? '@Body() body: Record<string, unknown>'
    : '';
  var allParams = paramDecls.concat(bodyParam ? [bodyParam] : []).join(', ');

  var verbDec = '@' + method.charAt(0) + method.slice(1).toLowerCase() + (subPath ? "('" + subPath + "')" : '()');
  var lines = [
    '',
    "  // [scaffold-contract-doctor] Stub for documented endpoint " + method + ' ' + fullPath,
    "  // " + description.replace(/[\r\n]+/g, ' ').slice(0, 120),
    '  ' + verbDec,
    "  async " + fnName + "(" + allParams + "): Promise<unknown> {",
    "    throw new NotImplementedException('" + method + ' ' + fullPath + " is documented in PROJECT_API.md but not yet implemented');",
    '  }',
  ];

  // Insert before the final '}' of the class
  var lastBrace = controller.content.lastIndexOf('}');
  if (lastBrace === -1) return false;
  var updated = controller.content.slice(0, lastBrace) + lines.join('\n') + '\n' + controller.content.slice(lastBrace);

  // Ensure required NestJS imports. v108 fix: the old per-symbol appends
  // broke multi-line import blocks — inner text ending ",\n" became
  // ",\n, NotImplementedException }" → TS1003. appendImportSymbols trims
  // trailing commas/whitespace first, then re-adds a clean tail.
  // v113 fix: fallback for controllers with no existing @nestjs/common import
  // (no regex match → replace() is a no-op → symbols silently dropped → TS2304).
  function appendImportSymbols(src, symbols) {
    var replaced = false;
    var result = src.replace(/import\s+\{([\s\S]*?)\}\s*from\s+['"]@nestjs\/common['"]/, function (_m, inner) {
      replaced = true;
      var trailingNl = /\n\s*$/.test(inner) ? '\n' : ' ';
      var trimmed = inner.replace(/[,\s]+$/, '');
      var addition = symbols.map(function (s) { return ', ' + s; }).join('');
      return "import {" + trimmed + addition + trailingNl + "} from '@nestjs/common'";
    });
    if (!replaced) {
      result = "import { " + symbols.join(', ') + " } from '@nestjs/common';\n" + result;
    }
    return result;
  }
  var needSyms = [];
  if (!/import\s+\{[\s\S]*?\bNotImplementedException\b[\s\S]*?\}\s*from\s+['"]@nestjs\/common['"]/.test(updated)) needSyms.push('NotImplementedException');
  if (paramMatches.length > 0 && !/import\s+\{[\s\S]*?\bParam\b[\s\S]*?\}\s*from\s+['"]@nestjs\/common['"]/.test(updated)) needSyms.push('Param');
  if (bodyParam && !/import\s+\{[\s\S]*?\bBody\b[\s\S]*?\}\s*from\s+['"]@nestjs\/common['"]/.test(updated)) needSyms.push('Body');
  var verbName = method.charAt(0) + method.slice(1).toLowerCase();
  if (!new RegExp('import\\s+\\{[\\s\\S]*?\\b' + verbName + '\\b[\\s\\S]*?\\}\\s*from\\s+[\'"]@nestjs\\/common[\'"]').test(updated)) needSyms.push(verbName);
  if (needSyms.length) updated = appendImportSymbols(updated, needSyms);

  controller.content = updated;
  return true;
}

// v108: When documented endpoints use an access prefix (`admin/X`,
// `company/X`, `worker/X`) and NO controller has that exact prefix, emit a
// new controller file at the matching resource module so the documented URL
// actually resolves. Without this the doctor stripped the prefix and
// attached @Get() stubs to the resource controller, which served the wrong
// URL.
//
// Returns the list of newly emitted controllers (with .path, .prefix,
// .className, .content) so the main loop can include them.
function emitAccessPrefixControllers(controllers, endpoints, modulesDir, dryRun) {
  var emitted = [];
  var groups = {}; // key = "admin/notices" → [endpoints]
  endpoints.forEach(function (ep) {
    var p = paramNormalize(ep.path);
    var m = /^(admin|company|worker)\/([a-z0-9][a-z0-9-]*)(?:\/|$)/.exec(p);
    if (!m) return;
    var access = m[1];
    var resource = m[2];
    var groupKey = access + '/' + resource;
    // Already a controller with that exact prefix? Check ALL prefixes in
    // each file (a single .controller.ts can declare multiple @Controller).
    if (controllers.some(function (c) {
      var prefixes = c.prefixes || [c.prefix || ''];
      return prefixes.some(function (pp) { return paramNormalize(pp) === groupKey; });
    })) return;
    if (!groups[groupKey]) groups[groupKey] = { access: access, resource: resource, eps: [] };
    groups[groupKey].eps.push(ep);
  });

  Object.keys(groups).forEach(function (gk) {
    var g = groups[gk];
    // Find the resource module dir. Strategy (in order):
    // 1. A controller whose prefix is the bare resource (e.g. 'service-types').
    // 2. A module dir on disk named access-resource or access-singularResource
    //    (e.g. 'admin-service-type') — handles LLM-generated prefixed modules.
    // 3. Fall back to creating a new dir.
    var singResource = singularize(g.resource);
    var resourceCtrl = controllers.find(function (c) {
      var prefixes = c.prefixes || [c.prefix || ''];
      return prefixes.some(function (pp) {
        var pfx = paramNormalize(pp);
        return pfx === g.resource || pfx === singResource;
      });
    });
    var moduleDir;
    var moduleFile;
    if (resourceCtrl) {
      moduleDir = path.dirname(resourceCtrl.path);
      var listing = fs.readdirSync(moduleDir);
      moduleFile = listing.find(function (f) { return /\.module\.ts$/.test(f); });
    } else {
      // Try to find an existing module dir named access-resource or access-singularResource
      var candidateDirs = [
        path.join(modulesDir, g.access + '-' + g.resource),
        path.join(modulesDir, g.access + '-' + singResource),
      ];
      var existingDir = candidateDirs.find(function (d) { return fs.existsSync(d) && fs.statSync(d).isDirectory(); });
      if (existingDir) {
        moduleDir = existingDir;
        var listing2 = fs.readdirSync(moduleDir);
        moduleFile = listing2.find(function (f) { return /\.module\.ts$/.test(f); });
      } else {
        // Create a new module dir under modulesDir keyed on access-singularResource
        moduleDir = path.join(modulesDir, g.access + '-' + singResource);
        moduleFile = null;
      }
    }

    var ctrlBase = g.access + '-' + singularize(g.resource);
    var ctrlFileName = ctrlBase + '.controller.ts';
    var ctrlPath = path.join(moduleDir, ctrlFileName);
    if (fs.existsSync(ctrlPath)) return; // never overwrite

    var className = pascalize(ctrlBase) + 'Controller';
    // Build minimal controller with 501 stubs for each documented endpoint
    var methodBodies = g.eps.map(function (ep) {
      var subPath = paramNormalize(ep.path).slice(gk.length).replace(/^\/+/, '');
      var fnName = methodNameFor(ep.method, subPath);
      var verb = ep.method.charAt(0) + ep.method.slice(1).toLowerCase();
      var verbDec = '@' + verb + (subPath ? "('" + subPath + "')" : '()');
      var paramMatches = Array.from(subPath.matchAll(/:(\w+)/g));
      var paramDecls = paramMatches.map(function (m) { return "@Param('" + m[1] + "') " + m[1] + ": string"; });
      var bodyParam = (ep.method === 'POST' || ep.method === 'PUT' || ep.method === 'PATCH')
        ? '@Body() body: Record<string, unknown>'
        : '';
      var allParams = paramDecls.concat(bodyParam ? [bodyParam] : []).join(', ');
      return [
        '  // [scaffold-contract-doctor] Stub for documented endpoint ' + ep.method + ' ' + ep.path,
        '  // ' + (ep.description || '').replace(/[\r\n]+/g, ' ').slice(0, 120),
        '  ' + verbDec,
        '  async ' + fnName + '(' + allParams + '): Promise<unknown> {',
        "    throw new NotImplementedException('" + ep.method + ' ' + ep.path + " is documented in PROJECT_API.md but not yet implemented');",
        '  }',
      ].join('\n');
    }).join('\n\n');

    var imports = ["import { Controller, Get, Post, Put, Patch, Delete, Param, Body, NotImplementedException } from '@nestjs/common';"];
    var content = imports.join('\n') + '\n\n' +
      "@Controller('" + gk + "')\n" +
      'export class ' + className + ' {\n' +
      methodBodies + '\n' +
      '}\n';

    if (!dryRun) {
      if (!fs.existsSync(moduleDir)) fs.mkdirSync(moduleDir, { recursive: true });
      fs.writeFileSync(ctrlPath, content);
      // Register in module file if one exists
      if (moduleFile) {
        var modPath = path.join(moduleDir, moduleFile);
        var modSrc = fs.readFileSync(modPath, 'utf-8');
        if (modSrc.indexOf(className) === -1) {
          // add import — NestJS convention is to omit '.controller' from
          // the import specifier; tsconfig.moduleResolution=node picks up
          // the .ts file. Match the resource controller's import style.
          var importLine = "import { " + className + " } from './" + ctrlBase + ".controller';";
          modSrc = importLine + '\n' + modSrc;
          // inject into controllers: [ ... ]
          modSrc = modSrc.replace(/controllers\s*:\s*\[([^\]]*)\]/, function (_, inner) {
            var trimmed = inner.trim();
            var sep = trimmed.length > 0 && !/,\s*$/.test(trimmed) ? ', ' : '';
            return 'controllers: [' + inner + sep + className + ']';
          });
          fs.writeFileSync(modPath, modSrc);
        }
      }
    }
    emitted.push({ path: ctrlPath, prefix: gk, className: className, content: content });
  });
  return emitted;
}

function singularize(s) {
  if (/ies$/i.test(s)) return s.replace(/ies$/i, 'y');
  if (/sses$/i.test(s)) return s.replace(/es$/i, '');
  if (/[^s]s$/i.test(s)) return s.replace(/s$/i, '');
  return s;
}
function pascalize(s) {
  return s.replace(/(^|[-_])(\w)/g, function (_, __, c) { return c.toUpperCase(); });
}

function main() {
  var args = parseArgs(process.argv);
  if (!fs.existsSync(args.apiMd)) {
    console.log('scaffold-contract-doctor: ' + args.apiMd + ' not found — skipping');
    return;
  }
  var modulesDir = path.join(args.target, 'src/modules');
  if (!fs.existsSync(modulesDir)) {
    console.log('scaffold-contract-doctor: no src/modules — skipping');
    return;
  }

  var apiMdContent = fs.readFileSync(args.apiMd, 'utf-8');
  var endpoints = parseEndpoints(apiMdContent);
  console.log('scaffold-contract-doctor: parsed ' + endpoints.length + ' endpoints from PROJECT_API.md');

  var controllers = discoverControllers(modulesDir);
  console.log('scaffold-contract-doctor: discovered ' + controllers.length + ' controllers');

  // v108: emit access-prefix controllers (admin/X, company/X, worker/X) when
  // a documented prefix has no matching controller. Include them in the
  // controllers list so subsequent stubbing skips them as alreadyImpl.
  var emitted = emitAccessPrefixControllers(controllers, endpoints, modulesDir, args.dryRun);
  if (emitted.length) {
    console.log('scaffold-contract-doctor: emitted ' + emitted.length +
      ' new access-prefix controller(s) (admin/company/worker)');
    emitted.forEach(function (c) {
      if (args.verbose) console.log('  emitted ' + c.prefix + ' → ' + path.basename(c.path));
      controllers.push(c);
    });
  }

  var stubbed = 0, alreadyImpl = 0, noController = 0;
  endpoints.forEach(function (ep) {
    var existing = controllers.find(function (c) { return hasMethodForPath(c, ep.method, ep.path); });
    if (existing) { alreadyImpl++; return; }
    var target = pickController(controllers, ep.path);
    if (!target) {
      noController++;
      if (args.verbose) console.log('  no controller for ' + ep.method + ' ' + ep.path);
      return;
    }
    if (injectStub(target, ep.method, ep.path, ep.description, ep.auth)) {
      stubbed++;
      if (args.verbose) console.log('  stubbed ' + ep.method + ' ' + ep.path + ' → ' + path.basename(target.path));
    }
  });

  // Write back any modified controllers. v108: skip files that don't exist
  // on disk yet (newly-emitted controllers in --dry-run mode) and dedupe by
  // path so we don't write the same file multiple times.
  var written = {};
  controllers.forEach(function (c) {
    if (written[c.path]) return;
    written[c.path] = true;
    if (!fs.existsSync(c.path)) return; // dry-run, file not yet on disk
    var orig = fs.readFileSync(c.path, 'utf-8');
    if (c.content !== orig && !args.dryRun) {
      fs.writeFileSync(c.path, c.content);
    }
  });

  console.log('scaffold-contract-doctor: ' + stubbed + ' endpoint(s) stubbed, ' +
    alreadyImpl + ' already implemented, ' + noController + ' missing target controller');
}

main();
