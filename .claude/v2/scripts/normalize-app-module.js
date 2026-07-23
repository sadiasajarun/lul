#!/usr/bin/env node
//
// normalize-app-module.js — emit canonical app.module.ts from on-disk modules.
//
// Scans BACKEND/src/modules/FEATURE/NAME.module.ts, extracts the exported
// Module-decorated classes, and writes BACKEND/src/app.module.ts with all
// of them registered in the imports array.
//
// Why: scaffold-crud-modules + LLM-implement-fanout both write per-module
// files to src/modules/*. Without this normalizer, AppModule is missing or
// stale (v62-att2 evidence). Custom imports/providers go between
// NORMALIZE_KEEP_TOP / NORMALIZE_KEEP_BOTTOM markers and are preserved.
//
// Usage: normalize-app-module --target BACKEND_DIR [--dry-run] [-v]
//

'use strict';

var fs = require('fs');
var path = require('path');

function parseArgs(argv) {
  var out = {};
  var i;
  for (i = 2; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: normalize-app-module --target BACKEND_DIR [--dry-run] [-v]');
      process.exit(0);
    } else {
      console.error('bad arg: ' + a);
      process.exit(1);
    }
  }
  if (!out.target) {
    console.error('--target required');
    process.exit(1);
  }
  return out;
}

function main() {
  var args = parseArgs(process.argv);
  var srcDir = path.join(args.target, 'src');
  var modulesDir = path.join(srcDir, 'modules');
  var appModulePath = path.join(srcDir, 'app.module.ts');

  if (!fs.existsSync(modulesDir)) {
    console.log('normalize-app-module: no modules dir at ' + modulesDir + ' — skipping');
    return;
  }

  var discovered = [];
  var dirEntries = fs.readdirSync(modulesDir, { withFileTypes: true });
  for (var di = 0; di < dirEntries.length; di++) {
    var dirent = dirEntries[di];
    if (!dirent.isDirectory()) continue;
    var featureDir = path.join(modulesDir, dirent.name);
    var fileEntries = fs.readdirSync(featureDir, { withFileTypes: true });
    for (var fi = 0; fi < fileEntries.length; fi++) {
      var mf = fileEntries[fi];
      if (!mf.isFile() || !mf.name.endsWith('.module.ts')) continue;
      var filePath = path.join(featureDir, mf.name);
      var content = fs.readFileSync(filePath, 'utf-8');
      var m = content.match(/export\s+class\s+([A-Z][A-Za-z0-9_]*Module)\b/);
      if (!m) {
        if (args.verbose) console.log('  skip ' + path.relative(args.target, filePath) + ' (no exported Module class)');
        continue;
      }
      discovered.push({
        className: m[1],
        importPath: './modules/' + dirent.name + '/' + mf.name.replace(/\.ts$/, ''),
        source: filePath,
      });
    }
  }

  if (discovered.length === 0) {
    console.log('normalize-app-module: no feature modules — leaving app.module.ts alone');
    return;
  }

  // Dedupe by class name
  var seen = {};
  var modules = [];
  for (var mi = 0; mi < discovered.length; mi++) {
    var d = discovered[mi];
    if (!seen[d.className]) {
      seen[d.className] = true;
      modules.push(d);
    }
  }
  modules.sort(function (a, b) { return a.className.localeCompare(b.className); });

  // Preserve custom regions between markers
  var topCustom = '';
  var bottomCustom = '';
  if (fs.existsSync(appModulePath)) {
    var existing = fs.readFileSync(appModulePath, 'utf-8');
    var topMatch = existing.match(/\/\/ <NORMALIZE_KEEP_TOP>([\s\S]*?)\/\/ <\/NORMALIZE_KEEP_TOP>/);
    if (topMatch) topCustom = topMatch[1].trim() + '\n';
    var botMatch = existing.match(/\/\/ <NORMALIZE_KEEP_BOTTOM>([\s\S]*?)\/\/ <\/NORMALIZE_KEEP_BOTTOM>/);
    if (botMatch) bottomCustom = botMatch[1].trim() + '\n';
  }

  // v93: detect optional config files so we can wire them into ConfigModule.load.
  // Without this, ConfigService.get('authTokenExpiredTime') etc. return undefined
  // because the camelCase keys live in config/jwt.config.ts but aren't loaded.
  // v92 evidence: AuthService.signAccess threw "Invalid JWT expiry time: undefined"
  // on every login, so even with a working schema+seed, no auth ever succeeded.
  var configLoads = [];
  var configImports = [];
  var configFilesDir = path.join(srcDir, 'config');
  if (fs.existsSync(configFilesDir)) {
    var configFiles = fs.readdirSync(configFilesDir)
      .filter(function (f) { return /^[a-zA-Z][\w-]*\.config\.ts$/.test(f); });
    configFiles.forEach(function (f) {
      // Verify the file has a `export default` to be ConfigModule-loadable
      var src = fs.readFileSync(path.join(configFilesDir, f), 'utf-8');
      if (!/export\s+default\s+/.test(src)) return;
      var ident = f.replace(/\.config\.ts$/, '') + 'Config'; // e.g. jwt -> jwtConfig
      configImports.push("import " + ident + " from './config/" + f.replace(/\.ts$/, '') + "';");
      configLoads.push(ident);
    });
  }

  var lines = [];
  lines.push("import { Module } from '@nestjs/common';");
  lines.push("import { TypeOrmModule } from '@nestjs/typeorm';");
  lines.push("import { ConfigModule, ConfigService } from '@nestjs/config';");
  lines.push("import { TokenModule } from './infrastructure/token/token.module';");
  configImports.forEach(function (imp) { lines.push(imp); });
  for (var ii = 0; ii < modules.length; ii++) {
    lines.push("import { " + modules[ii].className + " } from '" + modules[ii].importPath + "';");
  }
  lines.push('');
  if (topCustom) {
    lines.push('// <NORMALIZE_KEEP_TOP>');
    lines.push(topCustom.trim());
    lines.push('// </NORMALIZE_KEEP_TOP>');
    lines.push('');
  }
  lines.push('/**');
  lines.push(' * AppModule — generated by normalize-app-module.js.');
  lines.push(' * Custom imports/providers go between NORMALIZE_KEEP_TOP/BOTTOM markers.');
  lines.push(' * Anything outside the markers is regenerated.');
  lines.push(' */');
  lines.push('@Module({');
  lines.push('  imports: [');
  if (configLoads.length > 0) {
    lines.push('    ConfigModule.forRoot({ isGlobal: true, load: [' + configLoads.join(', ') + '] }),');
  } else {
    lines.push('    ConfigModule.forRoot({ isGlobal: true }),');
  }
  lines.push('    TypeOrmModule.forRootAsync({');
  lines.push('      imports: [ConfigModule],');
  lines.push('      inject: [ConfigService],');
  // Note: TypeORM factory's full body is below as a single template string to
  // avoid placing `key: Type` patterns inside source lines that Node 25's
  // TS-detection heuristic might treat as a type annotation outside string.
  lines.push("      useFactory: makeTypeOrmConfig,");
  lines.push('    }),');
  lines.push('    TokenModule,');
  for (var fii = 0; fii < modules.length; fii++) {
    lines.push('    ' + modules[fii].className + ',');
  }
  lines.push('  ],');
  if (bottomCustom) {
    lines.push('// <NORMALIZE_KEEP_BOTTOM>');
    lines.push(bottomCustom.trim());
    lines.push('// </NORMALIZE_KEEP_BOTTOM>');
  }
  lines.push('})');
  lines.push('export class AppModule {}');
  lines.push('');
  lines.push('function makeTypeOrmConfig(config: ConfigService) {');
  lines.push('  return {');
  lines.push("    type: 'postgres' as const,");
  lines.push("    host: config.get('POSTGRES_HOST') || 'localhost',");
  lines.push("    port: parseInt(config.get('POSTGRES_PORT') || '5432', 10),");
  lines.push("    username: config.get('POSTGRES_USER') || 'postgres',");
  lines.push("    password: config.get('POSTGRES_PASSWORD') || 'postgres',");
  lines.push("    database: config.get('POSTGRES_DATABASE') || 'app',");
  lines.push('    autoLoadEntities: true,');
  // v93: dev/test environments need either synchronize OR migrationsRun to
  // get a working schema. v92 evidence: backend booted with both OFF
  // (NODE_ENV undefined → !== 'test', migrationsRun missing → defaults
  // false), schema never created, every auth call returned HTTP 500,
  // story-runner couldn't authenticate, 0/28 stories passed.
  // Pattern mirrors data-source.ts:
  //   - synchronize:    OFF by default; opt-in via TYPEORM_SYNCHRONIZE=true
  //                     (also: NODE_ENV=test for unit-test runs)
  //   - migrationsRun:  ON by default; opt-out via MIGRATIONS_AUTO_RUN=false
  // Pipeline .env sets TYPEORM_SYNCHRONIZE=true (belt+suspenders with the
  // initial migration scaffold) so the schema exists even when migrations/
  // ends up empty (e.g. typeorm:generate falls back to a stub).
  lines.push("    synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true' || process.env.NODE_ENV === 'test',");
  lines.push("    migrationsRun: process.env.MIGRATIONS_AUTO_RUN !== 'false',");
  lines.push('  };');
  lines.push('}');
  lines.push('');

  var rendered = lines.join('\n');

  if (args.dryRun) {
    console.log('normalize-app-module: would write ' + appModulePath + ' (' + modules.length + ' modules, ' + rendered.length + ' bytes)');
    if (args.verbose) console.log(rendered);
    return;
  }

  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(appModulePath, rendered);
  console.log('normalize-app-module: wrote ' + appModulePath + ' (' + modules.length + ' feature modules)');
  if (args.verbose) {
    for (var li = 0; li < modules.length; li++) console.log('  - ' + modules[li].className);
  }
}

main();
