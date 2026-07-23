#!/usr/bin/env node
/**
 * normalize-modules.js — deterministic post-implement normalizer.
 *
 * Why: across runs (v37 kimi, v40 minimax), the implement fanout reliably
 * produces a small set of structural errors that block typecheck regardless
 * of which model wrote the code:
 *
 *   - TS2307  wrong import depth for `core/base/...` and `shared/...`
 *             (e.g. `../../../core/base/base.repository` from a file two
 *              levels deep when one level deep would work)
 *   - TS2304  service references its sibling Repository class without an
 *             explicit `import { XxxRepository } from './xxx.repository'`
 *   - TS2339  `this.repository` used in repository classes that didn't
 *             call `super(repository)` in their constructor
 *   - TS2307  `app.module.ts` imports `./modules/X/X.module` where the
 *             module directory was never created (implement fanout drift
 *             or a `pre-wire-app-module` step that listed all PRD modules
 *             but the fanout only delivered some). v37's primary root
 *             cause: 10 orphan imports → 14 TS errors → backend FAIL.
 *             We prune any `./modules/X/X.module` import + its imports[]
 *             entry when the file doesn't exist on disk.
 *
 * Auto-fixing these here means we never have to chase per-model drift in
 * prompts: kimi/minimax/deepseek can all produce slightly-wrong-but-fixable
 * code, and the typecheck gate downstream stays untouched.
 *
 * Scope strict — only fixes that are mechanically safe:
 *   1. Rewrite `from '<any-depth>/core/...'` and `from '<any-depth>/shared/...'`
 *      to use the *correct* depth based on the file's location relative
 *      to `src/`.
 *   2. If a `<feature>.service.ts` references `<Feature>Repository` and
 *      no import for it exists, insert `import { <Feature>Repository } from './<feature>.repository';`
 *
 * Runs idempotently — re-running on a clean tree is a no-op.
 * Exits 0 with a JSON summary on stdout; exits 1 only on usage error.
 *
 * Usage:
 *   node normalize-modules.js <backend_src_dir>
 *
 * Example:
 *   node .claude/v2/scripts/normalize-modules.js backend/src
 */

const fs = require('fs');
const path = require('path');

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.isFile() && full.endsWith('.ts')) files.push(full);
  }
  return files;
}

/**
 * For a file at src/modules/foo/foo.service.ts, the correct prefix to
 * reach src/core/base/X is `../../core/base/X` (two levels up).
 */
function relativeFromFileToSrcChild(filePath, srcDir, childSegments) {
  const fileDir = path.dirname(filePath);
  const targetDir = path.join(srcDir, ...childSegments);
  const rel = path.relative(fileDir, targetDir);
  // path.relative may return '..' or 'sibling'; ensure it leads with ./ or ../
  if (!rel.startsWith('.')) return './' + rel;
  return rel;
}

/**
 * Fix 1 — rewrite imports whose path lands inside src/core or src/shared
 * but uses the wrong depth.
 *
 * v47 evidence: also fix `common/decorators` → `core/decorators` when the
 * LLM picked the wrong folder name (decorators live in core/, not common/).
 * This is mechanically safe: if `<srcDir>/common/decorators/X.ts` doesn't
 * exist but `<srcDir>/core/decorators/X.ts` does, rewrite.
 */
function fixImportDepth(content, filePath, srcDir) {
  let changed = false;
  let out = content;

  // v47: common/decorators/X → core/decorators/X when common/ variant
  // doesn't exist on disk. Check before the generic depth-fix because
  // that one would only correct depth, not the folder name.
  out = out.replace(
    /(from\s+['"])([./][^'"]*?)\/common\/decorators\/([^'"]+)(['"])/g,
    (m, pre, prefix, tail, post) => {
      const commonFile = path.join(srcDir, 'common', 'decorators', `${tail}.ts`);
      const coreFile = path.join(srcDir, 'core', 'decorators', `${tail}.ts`);
      if (fs.existsSync(commonFile)) return m; // common/ has it — leave alone
      if (!fs.existsSync(coreFile)) return m;   // neither exists — don't guess
      changed = true;
      // Recompute correct depth to core/decorators/<tail>
      const correctRel = relativeFromFileToSrcChild(filePath, srcDir, ['core', 'decorators', tail]);
      return pre + correctRel + post;
    }
  );

  // Match `from '...' or "..."` capturing the path
  out = out.replace(
    /(from\s+['"])([./][^'"]*?)(\/core\/[^'"]+|\/shared\/[^'"]+|\/infrastructure\/[^'"]+|\/common\/[^'"]+|\/config\/[^'"]+)(['"])/g,
    (_, pre, prefix, tail, post) => {
      // tail starts with /core/... etc; strip leading slash for path segments
      const segs = tail.slice(1).split('/'); // e.g. ['core','base','base.repository']
      const correctRel = relativeFromFileToSrcChild(filePath, srcDir, segs);
      const fullMatch = pre + prefix + tail + post;
      const fixed = pre + correctRel + post;
      if (fullMatch === fixed) return fullMatch;
      changed = true;
      return fixed;
    }
  );
  return { content: out, changed };
}

/**
 * Fix 4 — v47: AuthGuard → JwtAuthGuard rename.
 * The nestjs template exports `JwtAuthGuard` from core/guards/jwt-auth.guard,
 * but LLMs sometimes import `AuthGuard` (sibling name from passport-jwt). The
 * TS error is TS2724 ("no exported member named 'AuthGuard'. Did you mean
 * 'JwtAuthGuard'?"). Safe to rewrite: only when import path ends in
 * `/jwt-auth.guard` AND identifier is `AuthGuard`. Also rewrites all
 * usages of bare `AuthGuard` (e.g. `@UseGuards(AuthGuard)`) in the same file.
 */
function fixAuthGuardRename(content) {
  // Only fire when an import like `import { AuthGuard } from '.../jwt-auth.guard'`
  // exists. Otherwise `AuthGuard` may legitimately come from @nestjs/passport.
  const importRe = /import\s*\{[^}]*\bAuthGuard\b[^}]*\}\s*from\s*['"][^'"]*\/jwt-auth\.guard['"]/;
  if (!importRe.test(content)) return { content, changed: false };
  let out = content;
  // 1) Rewrite the import identifier
  out = out.replace(
    /(import\s*\{[^}]*?)\bAuthGuard\b([^}]*?\}\s*from\s*['"][^'"]*\/jwt-auth\.guard['"])/g,
    '$1JwtAuthGuard$2'
  );
  // 2) Rewrite usages of bare AuthGuard in the rest of the file
  //    (decorators like @UseGuards(AuthGuard), type refs, etc.).
  //    Word-boundary regex prevents matching e.g. RolesAuthGuard.
  out = out.replace(/\bAuthGuard\b/g, 'JwtAuthGuard');
  return { content: out, changed: out !== content };
}

/**
 * Fix 2 — if a service file references `XxxRepository` but doesn't import
 * it, insert the import. Only when the sibling `<base>.repository.ts`
 * actually exists.
 */
function fixMissingRepositoryImport(content, filePath) {
  if (!filePath.endsWith('.service.ts')) return { content, changed: false };
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, '.service.ts');
  const repoFile = path.join(dir, `${base}.repository.ts`);
  if (!fs.existsSync(repoFile)) return { content, changed: false };
  // Derive PascalCase identifier
  const repoClass = base
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') + 'Repository';
  // Already imported?
  const importRe = new RegExp(`import\\s*\\{[^}]*\\b${repoClass}\\b[^}]*\\}\\s*from`);
  if (importRe.test(content)) return { content, changed: false };
  // Referenced at all?
  const refRe = new RegExp(`\\b${repoClass}\\b`);
  if (!refRe.test(content)) return { content, changed: false };
  // Insert after last existing import line, or at top
  const lines = content.split('\n');
  let lastImportIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^import\b/.test(lines[i])) lastImportIdx = i;
  }
  const insertion = `import { ${repoClass} } from './${base}.repository';`;
  if (lastImportIdx >= 0) lines.splice(lastImportIdx + 1, 0, insertion);
  else lines.unshift(insertion);
  return { content: lines.join('\n'), changed: true };
}

/**
 * Fix 3 — prune `./modules/<name>/<name>.module` imports from app.module.ts
 * (and their entries in the imports[] array) when the referenced module
 * file doesn't exist on disk. This is the model-agnostic version of the
 * v38-intended "wire-app-module POST-fanout" — instead of an LLM step,
 * a deterministic prune that runs after implement.
 *
 * Returns the new file content + a list of pruned module names.
 */
function pruneOrphanAppModuleImports(content, srcDir) {
  const importRe = /import\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*from\s*['"](\.\/modules\/([^'"\/]+)\/\3\.module)['"]\s*;\s*\n/g;
  const pruned = [];
  let result = content;
  let m;
  // Iterate via match-then-replace — re must be global for exec to advance.
  const matches = [];
  while ((m = importRe.exec(content)) !== null) {
    const [_, className, modPath, modBase] = m;
    const file = path.join(srcDir, modPath.replace(/^\.\//, '') + '.ts');
    if (!fs.existsSync(file)) {
      matches.push({ className, modPath, modBase, fullMatch: m[0] });
    }
  }
  for (const { className, modBase, fullMatch } of matches) {
    // Remove the import line
    result = result.replace(fullMatch, '');
    // Remove the className from imports: [...] array — common shapes:
    //   `ClassName,` or `ClassName\n` or `  ClassName,`
    // Use a careful regex that handles leading comma OR trailing comma.
    const idRe = new RegExp(`\\s*${className}\\s*,?`, 'g');
    // Only touch within @Module({...imports: [...]...}) blocks — easiest
    // approximation: replace any line containing only the class name and
    // optional whitespace/comma, or remove inline occurrences.
    result = result.replace(new RegExp(`^\\s*${className}\\s*,\\s*$\\n?`, 'gm'), '');
    result = result.replace(new RegExp(`^(\\s*)${className}\\s*$\\n?`, 'gm'), '');
    // Inline occurrence (rare with formatter): `[A, ClassName, B]` → `[A, B]`
    result = result.replace(new RegExp(`,\\s*${className}\\b`, 'g'), '');
    result = result.replace(new RegExp(`\\b${className}\\s*,\\s*`, 'g'), '');
    pruned.push({ class: className, module: modBase });
  }
  return { content: result, pruned };
}

function main() {
  const srcArg = process.argv[2];
  if (!srcArg) {
    console.error('usage: normalize-modules.js <backend_src_dir>');
    process.exit(1);
  }
  const srcDir = path.resolve(srcArg);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    console.error(`not a directory: ${srcDir}`);
    process.exit(1);
  }
  const modulesDir = path.join(srcDir, 'modules');
  const files = walk(modulesDir);
  const summary = {
    src_dir: srcDir,
    files_scanned: files.length,
    files_changed: 0,
    import_depth_fixes: 0,
    repository_import_inserts: 0,
    app_module_orphans_pruned: 0,
    pruned_modules: [],
    changes: [],
  };

  // app.module.ts orphan-import prune (model-agnostic post-fanout wire fix).
  const appModulePath = path.join(srcDir, 'app.module.ts');
  if (fs.existsSync(appModulePath)) {
    const original = fs.readFileSync(appModulePath, 'utf8');
    const r = pruneOrphanAppModuleImports(original, srcDir);
    if (r.pruned.length > 0) {
      fs.writeFileSync(appModulePath, r.content, 'utf8');
      summary.app_module_orphans_pruned = r.pruned.length;
      summary.pruned_modules = r.pruned;
      summary.files_changed++;
      summary.changes.push({ file: 'app.module.ts', orphans_pruned: r.pruned.length });
    }
  }
  for (const f of files) {
    const original = fs.readFileSync(f, 'utf8');
    let content = original;
    const r1 = fixImportDepth(content, f, srcDir);
    content = r1.content;
    const r2 = fixMissingRepositoryImport(content, f);
    content = r2.content;
    const r3 = fixAuthGuardRename(content);
    content = r3.content;
    if (content !== original) {
      fs.writeFileSync(f, content, 'utf8');
      summary.files_changed++;
      if (r1.changed) summary.import_depth_fixes++;
      if (r2.changed) summary.repository_import_inserts++;
      if (r3.changed) {
        summary.authguard_renames = (summary.authguard_renames || 0) + 1;
      }
      summary.changes.push({
        file: path.relative(srcDir, f),
        import_depth: r1.changed,
        repo_import: r2.changed,
        authguard_rename: r3.changed,
      });
    }
  }
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) main();

module.exports = { fixImportDepth, fixMissingRepositoryImport, walk };
