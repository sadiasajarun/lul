#!/usr/bin/env node
// scaffold-api-client-types.js — v74 derives frontend TS types from
// backend DTOs (the class-validator/class-transformer .dto.ts files
// scaffold-crud-module produces). Outputs one `types/<entity>.d.ts`
// per backend module with matching shape.
//
// Single source of truth: when backend DTOs change, re-run this and
// frontend types follow. Eliminates the "frontend says role: string but
// backend says role: RoleEnum" drift class of bugs.
'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  for (var i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--backend-dir') out.backendDir = argv[++i];
    else if (a === '--target') out.target = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--force') out.force = true;
  }
  if (!out.backendDir || !out.target) { console.error('Usage: scaffold-api-client-types --backend-dir BACKEND --target FRONTEND'); process.exit(1); }
  return out;
}

function walkDtos(dir, out) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var f = path.join(dir, e.name);
    if (e.isDirectory()) walkDtos(f, out);
    else if (e.isFile() && /\.dto\.ts$/.test(e.name)) out.push(f);
  });
}

function parseDtoFields(content) {
  // Extract: name + ts type from `<decorators>... <name>!: <type>;`
  // We keep this LIGHT — class-validator gives runtime info but TS type
  // is on the property declaration.
  var fields = [];
  // Match field declarations: optional decorators, optional `?`/`!`, type
  var re = /(?:^|\n)\s*([a-zA-Z_]\w*)\s*([?!])?:\s*([^;\n]+?);/g;
  var m;
  while ((m = re.exec(content)) !== null) {
    var name = m[1];
    var optional = m[2] === '?';
    var rawType = m[3].trim();
    // Skip method signatures or constructor params
    if (/[()]/.test(rawType)) continue;
    if (/^(constructor|static)$/.test(name)) continue;
    fields.push({ name: name, optional: optional, type: rawType });
  }
  return fields;
}

function dtoToTsInterface(dtoName, fields) {
  var lines = ['export interface ' + dtoName + ' {'];
  fields.forEach(function (f) {
    // Normalize backend types to frontend types
    var t = f.type;
    if (/Date/.test(t)) t = 'string';
    // v77: enum-looking types (RoleEnum / UserStatusEnum / SomeStatus) get
    // normalized to `string` since the FE doesn't import backend enums by
    // default. Future: sync enums via `~/enums/<name>.enum.ts` and keep type.
    t = t.replace(/\b([A-Z]\w*Enum)\b/g, 'string').replace(/\b([A-Z]\w*Status)\b/g, 'string');
    lines.push('  ' + f.name + (f.optional ? '?' : '') + ': ' + t + ';');
  });
  lines.push('}');

  // v77: emit alias re-exports so LLM-generated pages that import
  // `UpdateUserRequest` / `LoginResponse` / `User` resolve. Mapping:
  //   CreateUserDto    → CreateUser, CreateUserRequest
  //   UpdateUserDto    → UpdateUser, UpdateUserRequest
  //   UserResponseDto  → UserResponse, User
  //   LoginDto         → Login, LoginRequest
  var aliases = [];
  if (/Dto$/.test(dtoName)) {
    var stripped = dtoName.replace(/Dto$/, '');
    aliases.push('export type ' + stripped + ' = ' + dtoName + ';');
    if (/^Create|^Update|^Delete/.test(stripped)) {
      aliases.push('export type ' + stripped + 'Request = ' + dtoName + ';');
    } else if (/Response$/.test(stripped)) {
      aliases.push('export type ' + stripped.replace(/Response$/, '') + ' = ' + dtoName + ';');
    } else if (/^Login|^Register|^Refresh/.test(stripped)) {
      aliases.push('export type ' + stripped + 'Request = ' + dtoName + ';');
    }
  }
  if (aliases.length) lines.push('', aliases.join('\n'));
  return lines.join('\n');
}

function findDtoClassName(content, fallback) {
  var m = /export\s+class\s+(\w+)/.exec(content);
  return m ? m[1] : fallback;
}

// v93: derive fallback aliases for symbol names commonly imported by
// LLM-emitted pages that may not match any actual DTO class. Strategy:
//   1. For auth module — emit Login{,Response,Request} aliases that map
//      to whatever response DTO the auth module produced (e.g. AuthResponseDto).
//   2. For every module — if Update<Entity>Dto wasn't emitted but
//      Create<Entity>Dto was, alias Update<Entity>{,Request} to a partial.
//   3. Skip aliases that would conflict with already-emitted symbols.
function computeFallbackAliases(moduleName, emittedClassNames) {
  function pascalize(s) {
    return s.split(/[-_\s]+/).map(function (w) {
      return w ? w[0].toUpperCase() + w.slice(1) : w;
    }).join('');
  }
  var entityPascal = pascalize(moduleName); // 'user' → 'User', 'refund-record' → 'RefundRecord'
  var emitted = {};
  emittedClassNames.forEach(function (n) { emitted[n] = true; });

  var aliases = [];

  // --- Auth module convention: Login* aliases ---
  if (/^auth$/i.test(moduleName)) {
    // Find any *ResponseDto or AuthResponseDto in emitted classes — alias
    // it as LoginResponse so frontend login form can `import { LoginResponse }`.
    var authResponseDto = emittedClassNames.find(function (n) {
      return /^(Auth|Login)ResponseDto$/.test(n);
    }) || emittedClassNames.find(function (n) { return /ResponseDto$/.test(n); });
    if (authResponseDto && !emitted['LoginResponse']) {
      aliases.push("export type LoginResponse = " + authResponseDto + ";");
    }
    // Same for LoginRequest / SignupRequest if not present (often LoginDto)
    var loginDto = emittedClassNames.find(function (n) { return /^Login(Dto)?$/.test(n); });
    if (loginDto && !emitted['LoginRequest']) {
      aliases.push("export type LoginRequest = " + loginDto + ";");
    }
  }

  // --- Per-entity convention: Update*Request fallback ---
  // If Create<Entity>Dto exists but Update<Entity>Dto doesn't, alias
  // Update<Entity> + Update<Entity>Request to Partial<Create<Entity>Dto>.
  var createDto = 'Create' + entityPascal + 'Dto';
  var updateDto = 'Update' + entityPascal + 'Dto';
  if (emitted[createDto] && !emitted[updateDto]) {
    if (!emitted['Update' + entityPascal]) {
      aliases.push("export type Update" + entityPascal + " = Partial<" + createDto + ">;");
    }
    if (!emitted['Update' + entityPascal + 'Request']) {
      aliases.push("export type Update" + entityPascal + "Request = Partial<" + createDto + ">;");
    }
  }

  // --- Per-entity convention: <Entity>Response fallback ---
  var responseDto = entityPascal + 'ResponseDto';
  if (emitted[responseDto] && !emitted[entityPascal + 'Response']) {
    aliases.push("export type " + entityPascal + "Response = " + responseDto + ";");
  }
  if (emitted[responseDto] && !emitted[entityPascal]) {
    aliases.push("export type " + entityPascal + " = " + responseDto + ";");
  }

  return aliases;
}

function main() {
  var args = parseArgs(process.argv);
  var modulesDir = path.join(args.backendDir, 'src/modules');
  var dtos = [];
  walkDtos(modulesDir, dtos);
  if (dtos.length === 0) {
    console.log('scaffold-api-client-types: no DTOs found in ' + modulesDir);
    return;
  }

  // Group DTOs by module dir
  var byModule = {};
  for (var i = 0; i < dtos.length; i++) {
    var d = dtos[i];
    var rel = path.relative(modulesDir, d);
    var moduleName = rel.split(path.sep)[0];
    if (!byModule[moduleName]) byModule[moduleName] = [];
    byModule[moduleName].push(d);
  }

  var written = 0;
  Object.keys(byModule).forEach(function (moduleName) {
    var dst = path.join(args.target, 'app/types', moduleName + '.d.ts');
    if (fs.existsSync(dst) && !args.force) {
      if (args.verbose) console.log('  skip (exists): ' + path.relative(args.target, dst));
      return;
    }
    var emittedClassNames = [];
    var parts = byModule[moduleName].map(function (dtoFile) {
      var content = fs.readFileSync(dtoFile, 'utf-8');
      var fields = parseDtoFields(content);
      if (fields.length === 0) return null;
      var className = findDtoClassName(content, path.basename(dtoFile, '.dto.ts'));
      emittedClassNames.push(className);
      return dtoToTsInterface(className, fields);
    }).filter(Boolean);
    if (parts.length === 0) return;

    // v93: emit fallback aliases for symbol names that frontend pages
    // commonly import, even when the underlying DTO doesn't exist.
    // Without this:
    //   - user.d.ts had CreateUserRequest but no UpdateUserRequest because
    //     backend had no UpdateUserDto (PATCH used Partial<CreateUserDto>
    //     inline). LLM-emitted user pages broke at compile time.
    //   - auth.d.ts had AuthResponseDto but no LoginResponse because the
    //     login endpoint returned AuthResponseDto, not LoginResponseDto.
    // Strategy: when expected symbol is missing, alias to closest peer.
    var aliasLines = computeFallbackAliases(moduleName, emittedClassNames);

    // v100: when emitting auth.d.ts, also emit AuthState + AuthUser interfaces.
    // The React template ships an auth.d.ts with these Redux types, but this
    // scaffold overwrites that file with DTO-derived content. LLM-emitted
    // guards/slices/pages reference `state.auth.isAuthenticated`/etc, so
    // dropping AuthState produces a flood of TS2339 across the cell
    // (v99b admin-dashboard had 42 TS2339 errors driven by this).
    var reduxStateLines = (moduleName === 'auth') ? [
      "",
      "// v100: Redux state shape (preserves the template-shipped contract).",
      "// Without these, guards/slices/pages that read state.auth.* fail TS2339.",
      "export type Role = 'user' | 'admin' | 'manager' | 'company_manager' | string;",
      "",
      "export interface AuthUser {",
      "  id: string;",
      "  email: string;",
      "  name?: string;",
      "  role: Role;",
      "  createdAt?: string;",
      "  [k: string]: unknown;",
      "}",
      "",
      "export interface AuthState {",
      "  user: AuthUser | null;",
      "  isAuthenticated: boolean;",
      "  isLoading: boolean;",
      "  authChecked: boolean;",
      "  error: string | null;",
      "}",
    ] : [];

    var header = [
      "/**",
      " * Generated by scaffold-api-client-types from backend module '" + moduleName + "'.",
      " * Derived from " + byModule[moduleName].length + " DTOs. DO NOT EDIT BY HAND —",
      " * re-run scaffold-api-client-types when backend DTOs change.",
      " */",
      "",
    ].join('\n');
    var content = header + parts.join('\n\n')
      + (aliasLines.length ? '\n\n// v93 fallback aliases (LLM-emitted pages expect these symbols)\n' + aliasLines.join('\n') : '')
      + (reduxStateLines.length ? '\n' + reduxStateLines.join('\n') : '')
      + '\n';

    if (args.dryRun) {
      console.log('  [dry] would write ' + path.relative(args.target, dst));
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, content);
    }
    written++;
  });
  console.log('scaffold-api-client-types: wrote ' + written + ' types files');
}

main();
