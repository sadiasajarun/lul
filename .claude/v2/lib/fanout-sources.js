/**
 * fanout-sources.js — pluggable subject resolvers for node-level fanout
 *
 * A node may declare a `fanout:` block in its blueprint:
 *
 *   fanout:
 *     source: backend_modules     # name of a resolver registered here
 *     concurrency: 4              # max parallel cells (default 3)
 *     subject_var: module         # template var name surfaced as {module}
 *
 * The orchestrator calls resolveSubjects(source, ...) to get an array of
 * subject values, then runs the node once per subject in parallel (capped by
 * concurrency). Each cell sees its subject value substituted into prompt,
 * required_output_file, verification_pattern, and additional_read paths via
 * resolveVars (extended with the cell's subject_var).
 *
 * Resolvers are deterministic and read-only — they parse status/docs files
 * already produced by upstream phases. If the source file is absent the
 * resolver returns []; the orchestrator treats that as a no-op (single cell
 * fallback or skip).
 */

const fs = require('fs');
const path = require('path');
const { getFrontends, statusDirFor, projectDir } = require('./config');

/**
 * frontends — preserves existing per-frontend fanout behavior.
 * Returns the same descriptor objects getFrontends() returns. The orchestrator
 * already knows how to clone config.frontend per-cell.
 */
function frontendsResolver(config, projectName) {
  return getFrontends(config, projectName);
}

/**
 * backend_modules — list of module names to fan implementation across.
 *
 * The names are kebab-case slugs that match the `backend/src/modules/{name}/`
 * directory the agent will create. Source-of-truth ordering:
 *
 *   1. Explicit MODULE_INVENTORY.yaml under status/{project}/
 *      Format: { modules: [{ name: auth }, { name: payment }] }
 *      Use this to override or augment automated extraction.
 *
 *   2. PROJECT_API.md route prefixes — the unique top-level segment after
 *      `/api/`. This matches actual controller surface (e.g. `email-history`,
 *      `audit-logs`, `dashboard`) so cells produce code that maps 1:1 to
 *      routes RED tests will hit. Earlier versions used "### Module:"
 *      headings from PROJECT_KNOWLEDGE.md, which mismatched route names
 *      (e.g. KB heading "Authentication & Authorization" vs route `/api/auth`)
 *      and missed modules implied by API but absent from KB.
 *
 *   3. PROJECT_KNOWLEDGE.md "### Module:" headings — fallback only when
 *      PROJECT_API.md is absent or has no route literals (early-pipeline
 *      states before prd phase produces the API doc).
 *
 *   4. PRD.md "### Module:" headings — last-resort fallback.
 *
 * Returns kebab-case strings, de-duplicated, sorted.
 */
function backendModulesResolver(config, projectName) {
  // 1. Explicit inventory wins.
  const inventoryFile = path.join(statusDirFor(config, projectName), 'MODULE_INVENTORY.yaml');
  if (fs.existsSync(inventoryFile)) {
    const content = fs.readFileSync(inventoryFile, 'utf-8');
    const names = [];
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*-\s*name:\s*([A-Za-z0-9_-]+)/);
      if (m) names.push(m[1].trim());
    }
    if (names.length) return dedupe(names).sort();
  }

  // 2. Routes in PROJECT_API.md are the most accurate source.
  // v53 evidence: this resolver was using the legacy pre-per-PRD path
  // `<target>/.claude-project/docs/` and returning 0 subjects under the
  // per-PRD layout `<target>/.claude-project/<project>/docs/`. Same
  // defect class as v42's htmlPagesResolver. Use projectDir() helper —
  // already imported above — to match every other resolver.
  const apiPath = path.join(projectDir(config, projectName), 'docs', 'PROJECT_API.md');
  if (fs.existsSync(apiPath)) {
    const apiContent = fs.readFileSync(apiPath, 'utf-8');
    const routeNames = extractApiRouteSegments(apiContent);
    if (routeNames.length) return dedupe(routeNames).sort();
  }

  // 3 + 4. Heading-based fallbacks for early-pipeline states.
  const fallbackPaths = [
    path.join(projectDir(config, projectName), 'docs', 'PROJECT_KNOWLEDGE.md'),
    path.join(projectDir(config, projectName), 'prd', 'PRD.md'),
  ];
  for (const docPath of fallbackPaths) {
    if (!fs.existsSync(docPath)) continue;
    const content = fs.readFileSync(docPath, 'utf-8');
    const names = extractModuleNames(content);
    if (names.length) return dedupe(names).sort();
  }

  return [];
}

/**
 * Pull unique top-level route segments from PROJECT_API.md. A "module" is the
 * first path segment after `/api/`, kebab-case. Trailing path components and
 * query strings are dropped.
 *
 *   /api/auth/login              → auth
 *   /api/email-history           → email-history
 *   /api/admin/accounts          → admin
 *   /api/dashboard/kpi           → dashboard
 */
function extractApiRouteSegments(content) {
  const out = new Set();
  const re = /\/api\/([a-z][a-z0-9-]*)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}

/**
 * Pull module names from headings shaped like:
 *   ### Module: Authentication & Authorization
 *   ### Module: Service Application
 * Falls back to "## <Word>" inside a "## System Modules" section.
 */
function extractModuleNames(content) {
  const out = [];
  const moduleHeading = /^###\s+Module:\s+(.+?)\s*$/gm;
  let m;
  while ((m = moduleHeading.exec(content)) !== null) {
    out.push(slugify(m[1]));
  }
  if (out.length) return out;

  const systemSection = content.match(/^##\s+System Modules[\s\S]*?(?=^##\s|\Z)/m);
  if (systemSection) {
    const sectionContent = systemSection[0];
    const subHeadings = sectionContent.match(/^###\s+(.+?)\s*$/gm) || [];
    for (const h of subHeadings) {
      const name = h.replace(/^###\s+/, '').trim();
      out.push(slugify(name));
    }
  }
  return out;
}

/**
 * html_pages — list page slugs from .claude-project/design/html/*.html
 *
 * Each subject value is the basename without extension, e.g. "01-login"
 * for "01-login.html". The orchestrator can substitute {page} → "01-login"
 * into required_output_file paths and prompt text.
 */
function htmlPagesResolver(config, projectName) {
  const htmlDir = path.join(projectDir(config, projectName), 'design', 'html');
  if (!fs.existsSync(htmlDir)) return [];

  // When a frontend descriptor declares html_dir or role_prefixes, filter to
  // only the HTML files owned by this frontend. Uses html-filter.js which is
  // the single source of truth shared with frontend-gate.sh.
  const fe = config.frontend || null;
  if (fe && (fe.html_dir || (fe.role_prefixes && fe.role_prefixes.length && fe.role_prefixes[0] !== '*'))) {
    const { enumerateHtmlForFrontend } = require('./html-filter');
    const filtered = enumerateHtmlForFrontend(htmlDir, fe)
      .map(f => path.basename(f).replace(/\.html$/, ''))
      .sort();
    // v42 evidence: scaffold-project writes a placeholder frontend descriptor
    // (`{html_dir: 'frontend'}`) BEFORE design phase decides the actual
    // subdirectory layout. By design time the HTML is in `frontend-admin/`,
    // `frontend-worker/`, etc. — html_dir='frontend' filter then returns 0
    // and convert-pages fanout dies with "0 subjects". Treat an empty
    // filtered result as "descriptor is stale" and fall through to the
    // recursive scan below — gives us SOMETHING to convert rather than
    // crashing the whole frontend phase.
    if (filtered.length > 0) return filtered;
  }

  // Flat-or-nested mode — walk recursively so HTMLs in subdirectories like
  // <root>/frontend-admin/*.html, <root>/frontend-worker/*.html are picked
  // up. v42 evidence: pre-recurse, this returned 0 because non-recursive
  // readdirSync only saw the subdir entries (not .html files).
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
        out.push(entry.name.replace(/\.html$/i, ''));
      }
    }
  })(htmlDir);
  // Dedupe (file may exist under multiple subdirs by accident) then sort.
  return [...new Set(out)].sort();
}

/**
 * roles — list role names from PROJECT_KNOWLEDGE.md / PRD User Types section.
 * Used by gates and tests that want a per-role cell.
 */
function rolesResolver(config, projectName) {
  const pd = projectDir(config, projectName);
  const docs = [
    path.join(pd, 'docs', 'PROJECT_KNOWLEDGE.md'),
    path.join(pd, 'prd', 'PRD.md'),
  ];
  for (const docPath of docs) {
    if (!fs.existsSync(docPath)) continue;
    const content = fs.readFileSync(docPath, 'utf-8');
    const names = extractRoleNames(content);
    if (names.length) return dedupe(names);
  }
  return [];
}

function extractRoleNames(content) {
  const out = [];
  const userTypesSection = content.match(/(?:^##\s+(?:Section\s+\d+:\s+)?User Types|^###\s+User Types)[\s\S]*?(?=^##\s|^###\s+(?!User Types)|\Z)/m);
  if (!userTypesSection) return out;
  const rows = userTypesSection[0].match(/^\|\s*([A-Za-z][A-Za-z _-]+?)\s*\|/gm) || [];
  for (const row of rows) {
    const m = row.match(/^\|\s*([A-Za-z][A-Za-z _-]+?)\s*\|/);
    if (!m) continue;
    const name = m[1].trim();
    if (/^(Type|User Type|Role|---+)$/i.test(name)) continue;
    out.push(slugify(name));
  }
  return out;
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dedupe(arr) {
  return [...new Set(arr)];
}

const RESOLVERS = {
  frontends: frontendsResolver,
  backend_modules: backendModulesResolver,
  html_pages: htmlPagesResolver,
  roles: rolesResolver,
};

/**
 * resolveSubjects — returns an array of subject values for the named source.
 * Throws if the source is unknown (caller should validate at blueprint load).
 */
function resolveSubjects(source, config, projectName) {
  const fn = RESOLVERS[source];
  if (!fn) throw new Error(`unknown fanout source: '${source}' (known: ${Object.keys(RESOLVERS).join(', ')})`);
  return fn(config, projectName);
}

/**
 * normalizeSubject — convert a subject (which may be a string or descriptor
 * object like {name, dir, ...}) into a (label, varValue) pair.
 *
 *   - string subject ("auth")        → label "auth",       varValue "auth"
 *   - frontend descriptor            → label desc.name,    varValue desc.name
 *
 * The orchestrator uses `label` for log lines / event records and `varValue`
 * for template substitution into resolveVars.
 */
function normalizeSubject(subject) {
  if (typeof subject === 'string') return { label: subject, varValue: subject, raw: subject };
  if (subject && typeof subject === 'object' && subject.name) {
    return { label: subject.name, varValue: subject.name, raw: subject };
  }
  return { label: String(subject), varValue: String(subject), raw: subject };
}

module.exports = {
  resolveSubjects,
  normalizeSubject,
  RESOLVERS,
  // exported for unit testing / re-use
  _internal: { extractModuleNames, extractRoleNames, slugify, dedupe },
};
