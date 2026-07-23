/**
 * fullstack-2 config — shared paths and constants
 */

const path = require('path');
const fs = require('fs');

function findProjectRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, '.claude')) && fs.existsSync(path.join(dir, '.claude-project'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`No .claude/.claude-project root found from ${startDir}`);
}

/**
 * Build a config where .claude/ (blueprints, gates, scripts) is read from the SOURCE project
 * (where the orchestrator script lives — i.e. the cwd when --path isn't given, or the source
 * project containing claude-fullstack when --path is given), while .claude-project/ (status,
 * agent logs, generated output) is written to the TARGET project.
 */
function makeConfig(targetDir, sourceDir = null) {
  const target = path.resolve(targetDir);
  const source = sourceDir ? path.resolve(sourceDir) : target;
  return {
    targetDir: target,
    sourceDir: source,
    claudeDir: path.join(source, '.claude'),
    blueprintsDir: path.join(source, '.claude', 'blueprints'),
    gatesDir: path.join(source, '.claude', 'gates'),
    // Per-PRD layout: .claude-project/<project>/{status,agent-logs,docs,...}/
    // projectsDir is the parent that holds every <project>/ folder.
    // The legacy `statusDir` alias points at the same place (was the parent
    // of `<project>/PIPELINE_STATUS.md` in the old `.claude-project/status/`
    // layout) so older callers that compute path.join(statusDir, projectName, X)
    // need to be migrated to use projectDir/statusDir helpers (below).
    projectsDir: path.join(target, '.claude-project'),
    statusDir: path.join(target, '.claude-project'),
    agentRunnerScript: path.join(source, '.claude', 'scripts', 'claude-agent-runner.js'),
  };
}

/**
 * Per-project path helpers — call these instead of path.join(config.statusDir, ...).
 *
 * Layout (per-PRD restructure):
 *   <target>/.claude-project/<project>/
 *     ├── docs/                  PROJECT_KNOWLEDGE.md, PROJECT_API.md, ...
 *     ├── design/                DESIGN_SYSTEM.md, generated-screens/
 *     ├── user_stories/          *.yaml + _fixtures.yaml
 *     ├── memory/                LEARNINGS, DECISIONS, FAILURE_PATTERNS
 *     ├── archive/               episodes/, manifest.csv, VERSIONS.md
 *     ├── agent-logs/            per-node opencode logs
 *     └── status/                PIPELINE_STATUS.md, *_REPORT.md, .gate-proofs/,
 *                                .blueprint-<phase>.json
 */
function projectDir(config, projectName) {
  return path.join(config.projectsDir, projectName);
}
function statusDirFor(config, projectName) {
  return path.join(projectDir(config, projectName), 'status');
}
function agentLogsDirFor(config, projectName) {
  return path.join(projectDir(config, projectName), 'agent-logs');
}
function gateProofsDirFor(config, projectName) {
  return path.join(statusDirFor(config, projectName), '.gate-proofs');
}

function loadYaml() {
  try {
    return require('yaml');
  } catch {
    const { execSync } = require('child_process');
    let globalPath;
    try {
      globalPath = execSync('npm root -g', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch (err) {
      throw new Error(`yaml package not found and 'npm root -g' failed: ${err.message}. Install: npm install yaml (in project) or npm install -g yaml`);
    }
    try {
      return require(path.join(globalPath, 'yaml'));
    } catch {
      throw new Error('yaml package not found. Install: npm install -g yaml');
    }
  }
}

/**
 * Reads tech_stack.backend / tech_stack.frontends[0] from PIPELINE_STATUS.md.
 * Cached per config object to avoid re-parsing.
 */
function getTechStack(config, projectName) {
  if (config._techStackCache) return config._techStackCache;
  const defaults = { backend: 'nestjs', frontend: 'react' };
  const statusFile = path.join(statusDirFor(config, projectName), 'PIPELINE_STATUS.md');
  if (!fs.existsSync(statusFile)) {
    config._techStackCache = defaults;
    return defaults;
  }
  const content = fs.readFileSync(statusFile, 'utf-8');
  // Match: backend: nestjs   (inside tech_stack: block)
  const backendMatch = content.match(/^\s*backend:\s*([A-Za-z0-9_-]+)/m);

  // Frontend tech resolution — three formats:
  //   1. Inline scalar:    frontends: [react]         → tech = "react"
  //   2. Legacy list:      frontends:\n    - react     → tech = "react"
  //   3. Structured list:  frontends:\n    - name: frontend-worker\n      dir: ...
  //      In format 3, list items are app descriptors (not tech names).
  //      The tech is always the submodule name — default to "react".
  const frontendsInline = content.match(/^\s*frontends:\s*\[\s*([A-Za-z0-9_-]+)/m);
  // Legacy list: "- react" where the first token after "- " is a bare tech name (no colon)
  const frontendsLegacy = content.match(/^\s*frontends:\s*\n\s*-\s+([A-Za-z0-9_-]+)\s*$/m);
  // Structured list: "- name: ..." — detected but tech is NOT in the list items
  const frontendsStructured = content.match(/^\s*frontends:\s*\n\s*-\s+name:/m);

  let frontend;
  if (frontendsInline) {
    frontend = frontendsInline[1];
  } else if (frontendsStructured) {
    // Structured multi-frontend — tech is the submodule, not the app name.
    // Default to "react"; override if a frontend_tech: field exists.
    const techOverride = content.match(/^\s*frontend_tech:\s*([A-Za-z0-9_-]+)/m);
    frontend = techOverride ? techOverride[1] : defaults.frontend;
  } else if (frontendsLegacy) {
    frontend = frontendsLegacy[1];
  } else {
    frontend = defaults.frontend;
  }

  const result = {
    backend: backendMatch ? backendMatch[1] : defaults.backend,
    frontend,
  };
  config._techStackCache = result;
  return result;
}

function resolveVars(str, config, projectName, cellVars = null) {
  if (typeof str !== 'string') return str;
  const stack = getTechStack(config, projectName);

  // Directory and port variables — sourced from config.frontend (set by orchestrator
  // during per-frontend fanout) or from defaults. Non-frontend-scoped phases get defaults.
  const frontendDir = config.frontend?.dir || 'frontend';
  const frontendPort = String(config.frontend?.dev_port || process.env.FRONTEND_PORT || 5173);
  // FRONTEND_NAME is the frontend's logical name (e.g. "frontend",
  // "frontend-admin-dashboard"). Used to build per-frontend artifact paths
  // so multi-frontend fanout doesn't race on a shared file
  // (e.g. STORY_QA_REPORT_{FRONTEND_NAME}.md). Empty string when no frontend
  // is set so single-frontend projects keep clean filenames.
  const frontendName = config.frontend?.name || '';
  const frontendNameSuffix = frontendName ? `_${frontendName}` : '';
  const backendDir = 'backend';
  const backendPort = String(process.env.BACKEND_PORT || '3000');

  // PROJECT_DIR = relative path to the per-PRD root
  // (.claude-project/<project>). Use this in blueprints instead of
  // hardcoding ".claude-project/<project>" so the layout can evolve in
  // one place. STATUS_DIR / AGENT_LOGS_DIR / GATE_PROOFS_DIR follow the
  // same pattern.
  const projectRel = path.join('.claude-project', projectName);
  const statusRel = path.join(projectRel, 'status');
  const agentLogsRel = path.join(projectRel, 'agent-logs');
  const gateProofsRel = path.join(statusRel, '.gate-proofs');

  let out = str
    .replace(/\{TARGET_DIR\}/g, config.targetDir)
    .replace(/\{SOURCE_DIR\}/g, config.sourceDir)
    .replace(/\{CLAUDE_DIR\}/g, config.claudeDir)
    .replace(/\{PROJECT_DIR\}/g, projectRel)
    .replace(/\{STATUS_DIR\}/g, statusRel)
    .replace(/\{AGENT_LOGS_DIR\}/g, agentLogsRel)
    .replace(/\{GATE_PROOFS_DIR\}/g, gateProofsRel)
    .replace(/\{project\}/g, projectName)
    // Tech stack names (submodule dirs: nestjs, react)
    .replace(/\{BACKEND\}/g, stack.backend)
    .replace(/\{FRONTEND\}/g, stack.frontend)
    // Project directory names (backend/, frontend-worker/, etc.)
    .replace(/\{BACKEND_DIR\}/g, backendDir)
    .replace(/\{FRONTEND_DIR\}/g, frontendDir)
    .replace(/\{FRONTEND_NAME\}/g, frontendName)
    .replace(/\{FRONTEND_NAME_SUFFIX\}/g, frontendNameSuffix)
    // Dev server ports
    .replace(/\{BACKEND_PORT\}/g, backendPort)
    .replace(/\{FRONTEND_PORT\}/g, frontendPort)
    // Shell variable equivalents — word-boundary to avoid rewriting prefixes
    // (e.g., $FRONTEND_DIR must NOT become react_DIR)
    .replace(/\$BACKEND_DIR(?![A-Za-z0-9_])/g, backendDir)
    .replace(/\$FRONTEND_DIR(?![A-Za-z0-9_])/g, frontendDir)
    .replace(/\$BACKEND_PORT(?![A-Za-z0-9_])/g, backendPort)
    .replace(/\$FRONTEND_PORT(?![A-Za-z0-9_])/g, frontendPort)
    .replace(/\$BACKEND(?![A-Za-z0-9_])/g, stack.backend)
    .replace(/\$FRONTEND(?![A-Za-z0-9_])/g, stack.frontend);

  // Per-cell fanout vars — substituted last so they cannot collide with the
  // reserved tokens above. Keys are user-defined subject_var names from the
  // blueprint (e.g. `module`, `page`, `role`). Each `{name}` and `$NAME` form
  // is replaced with the cell's subject value.
  if (cellVars && typeof cellVars === 'object') {
    for (const [key, value] of Object.entries(cellVars)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      const safe = String(value);
      out = out
        .replace(new RegExp(`\\{${key}\\}`, 'g'), safe)
        .replace(new RegExp(`\\$${key.toUpperCase()}(?![A-Za-z0-9_])`, 'g'), safe);
    }
  }

  return out;
}

/**
 * Find the project name. Preference order:
 *   1. If `preferred` matches a subdirectory of statusDir with a PIPELINE_STATUS.md, return it.
 *   2. Otherwise return the first subdirectory that has a PIPELINE_STATUS.md.
 *   3. Fall back to basename(targetDir).
 */
function findProjectName(config, preferred = null) {
  if (!fs.existsSync(config.projectsDir)) return preferred || path.basename(config.targetDir);

  // Per-PRD layout: PIPELINE_STATUS.md lives at <projectsDir>/<project>/status/PIPELINE_STATUS.md.

  // Preference 1: exact match of the argv project name
  if (preferred) {
    const preferredFile = path.join(statusDirFor(config, preferred), 'PIPELINE_STATUS.md');
    if (fs.existsSync(preferredFile)) return preferred;
  }

  // Preference 2: first subdirectory with status/PIPELINE_STATUS.md
  for (const entry of fs.readdirSync(config.projectsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const statusFile = path.join(statusDirFor(config, entry.name), 'PIPELINE_STATUS.md');
      if (fs.existsSync(statusFile)) return entry.name;
    }
  }

  return preferred || path.basename(config.targetDir);
}

/**
 * getFrontends — read all declared frontends from PIPELINE_STATUS.md.
 *
 * Supports two formats:
 *   1. Structured list (format_version >= 2):
 *        frontends:
 *          - name: frontend-worker
 *            dir: frontend-worker
 *            html_dir: worker
 *            dev_port: 5173
 *   2. Legacy scalar list:
 *        frontends: [react]
 *      or
 *        frontends:
 *          - react
 *
 * Returns an array of frontend descriptor objects. Each object has at minimum:
 *   { name, dir, dev_port, html_dir?, role_prefixes? }
 *
 * If no frontends block is declared in PIPELINE_STATUS.md, auto-detects
 * frontends from the PRD's User Roles section. Each non-Guest role generates
 * one frontend app: the first role → `frontend` (main app), subsequent roles
 * → `frontend-{role_stem}-dashboard`. The detected block is persisted to
 * PIPELINE_STATUS.md so it only auto-detects once.
 *
 * Falls back to a single implicit entry when the status file is absent.
 */
function getFrontends(config, projectName) {
  const statusFile = path.join(statusDirFor(config, projectName), 'PIPELINE_STATUS.md');
  if (!fs.existsSync(statusFile)) {
    return [{ name: config.frontend || 'react', dir: 'frontend', dev_port: 5173, html_dir: 'frontend', role_prefixes: ['*'] }];
  }

  const content = fs.readFileSync(statusFile, 'utf-8');

  // Legacy scalar: frontends: [react]
  const inlineMatch = content.match(/^\s*frontends:\s*\[\s*([A-Za-z0-9_-]+)/m);

  // Line-by-line parser for structured YAML frontend list
  const lines = content.split('\n');
  const frontendsIdx = lines.findIndex(l => /^\s*frontends:\s*$/.test(l));

  if (frontendsIdx >= 0) {
    const entries = [];
    let current = null;
    for (let i = frontendsIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      // Stop when we leave the frontends block (non-indented line or end of YAML block)
      if (/^\s*[a-z_]+:/.test(line) && !/^\s{2,}/.test(line)) break;
      if (/^\s*dashboards:/.test(line)) break;
      // New list item
      const itemMatch = line.match(/^\s+-\s+name:\s+(.+)/);
      if (itemMatch) {
        if (current) entries.push(current);
        current = { name: itemMatch[1].trim(), dir: '', dev_port: 5173, html_dir: '', role_prefixes: [] };
        continue;
      }
      if (!current) continue;
      // Key: value lines
      const kvMatch = line.match(/^\s+(\w[\w_-]*):\s+(.+)/);
      if (kvMatch) {
        const [, key, val] = kvMatch;
        if (key === 'dir') current.dir = val.trim();
        else if (key === 'dev_port') current.dev_port = parseInt(val, 10) || 5173;
        else if (key === 'html_dir') current.html_dir = val.trim();
      }
      // role_prefixes: ["a", "b"]
      const rpMatch = line.match(/^\s+role_prefixes:\s*\[([^\]]+)\]/);
      if (rpMatch) {
        current.role_prefixes = rpMatch[1].split(',').map(s => s.trim().replace(/["']/g, ''));
      }
    }
    if (current) entries.push(current);
    // Ensure dir + html_dir default to name
    entries.forEach(e => { if (!e.dir) e.dir = e.name; if (!e.html_dir) e.html_dir = e.dir; });
    if (entries.length > 0) return entries;
  }

  if (inlineMatch) {
    return [{ name: inlineMatch[1], dir: 'frontend', dev_port: 5173, html_dir: 'frontend', role_prefixes: ['*'] }];
  }

  // Auto-detect frontends from PRD's User Roles section
  const detected = detectFrontendsFromPRD(config);
  if (detected) {
    writeFrontendsToStatus(statusFile, content, detected);
    return detected;
  }

  // Last-resort fallback
  return [{ name: config.frontend || 'react', dir: 'frontend', dev_port: 5173, html_dir: 'frontend', role_prefixes: ['*'] }];
}

/**
 * detectFrontendsFromPRD — read PROJECT_KNOWLEDGE.md User Roles table
 * and generate frontend entries. One frontend per non-Guest role.
 *
 * Role → frontend mapping:
 *   First non-Guest role  →  `frontend` (main/shared app)
 *   Subsequent roles       →  `frontend-{stem}-dashboard`
 *
 * Stem extraction prefers the "Internal Name" column (snake_case). Falls
 * back to parsing the human-readable "Role" column.
 */
function detectFrontendsFromPRD(config) {
  const candidates = [
    path.join(config.targetDir, '.claude-project', 'docs', 'PROJECT_KNOWLEDGE.md'),
    path.join(config.targetDir, '.claude-project', 'prd', 'PRD.md'),
  ];
  let content = '';
  for (const p of candidates) {
    if (fs.existsSync(p)) { content = fs.readFileSync(p, 'utf-8'); break; }
  }
  if (!content) return null;

  const roles = extractRoleNamesFromMD(content);
  if (!roles.length) return null;

  // Normalize all roles to stems, deduplicate, exclude admin.
  // First non-admin stem = primary user → main `frontend` app.
  // Remaining non-admin stems → `frontend-{stem}-dashboard`.
  const adminStems = new Set(['admin']);
  const extraStems = [];
  const seen = new Set();

  for (const role of roles) {
    const stem = normalizeRoleToStem(role);
    if (!stem || seen.has(stem)) continue;
    seen.add(stem);
    if (adminStems.has(stem)) continue;
    extraStems.push(stem);
  }

  // Always: frontend (main) + frontend-admin-dashboard
  const frontends = [];
  let port = 5173;

  frontends.push({ name: 'frontend', dir: 'frontend', html_dir: 'frontend', dev_port: port++, role_prefixes: [] });
  frontends.push({ name: 'frontend-admin-dashboard', dir: 'frontend-admin-dashboard', html_dir: 'frontend-admin-dashboard', dev_port: port++, role_prefixes: [] });

  // Extra stakeholder dashboards (skip first — it's the primary user of `frontend`)
  for (let i = 1; i < extraStems.length; i++) {
    const stem = extraStems[i];
    const name = `frontend-${stem}-dashboard`;
    frontends.push({ name, dir: name, html_dir: name, dev_port: port++, role_prefixes: [] });
  }

  return frontends;
}

/** Parse the User Roles table from markdown. Returns role names in table order. */
function extractRoleNamesFromMD(content) {
  const roles = [];

  // Try parsing the "Role" column from a markdown table
  const tableStart = content.search(/\| Role\s*\|/i);
  if (tableStart >= 0) {
    const tableLines = content.slice(tableStart).split('\n');
    let headerFound = false;
    for (const line of tableLines) {
      if (!line.startsWith('|')) break;
      if (line.includes('---')) { headerFound = true; continue; }
      if (!headerFound) continue;
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (!cells.length) continue;
      const roleName = cells[0].replace(/`/g, '');
      if (roleName && !/unauthenticated/i.test(roleName) && !/^guest$/i.test(roleName) && !/^role$/i.test(roleName)) {
        roles.push(roleName);
      }
    }
  }

  // Fallback: look for role names in a "User Types" list
  if (!roles.length) {
    const userTypesSection = content.match(/(?:^##\s+(?:Section\s+\d+:\s+)?User Types|^###\s+User Types)[\s\S]*?(?=^##\s|^###\s+(?!User Types)|\Z)/m);
    if (userTypesSection) {
      for (const line of userTypesSection[0].split('\n')) {
        const m = line.match(/^\|\s*([A-Za-z\s]+)\s*\|/);
        if (m) {
          const name = m[1].trim();
          if (name && !/unauthenticated/i.test(name) && !/^guest$/i.test(name) && !/^role$/i.test(name) && !/^-+$/.test(name)) {
            roles.push(name);
          }
        }
      }
    }
  }

  return roles;
}

/** Normalize a role name to a kebab-case stem for frontend directory naming. */
function normalizeRoleToStem(roleName) {
  const lower = roleName.toLowerCase().replace(/[^a-z\s]/g, '').trim();
  if (!lower) return '';

  const words = lower.split(/\s+/).filter(Boolean);
  if (!words.length) return '';

  // Try "Internal Name" style: single snake_case word like "company_staff"
  if (words.length === 1 && words[0].includes('_')) {
    const parts = words[0].split('_').filter(Boolean);
    const roleTypes = new Set(['staff', 'lead', 'head', 'manager', 'supervisor', 'member', 'user', 'owner', 'admin', 'administrator', 'worker', 'representative', 'person', 'operator']);
    const modifiers = new Set(['super', 'lead', 'head', 'senior', 'junior', 'foreign', 'external']);
    let stem = parts[0];
    for (const p of parts) { if (!modifiers.has(p)) { stem = p; break; } }
    if (roleTypes.has(stem)) {
      stem = parts[parts.length - 1];
      for (let i = parts.length - 1; i >= 0; i--) { if (!roleTypes.has(parts[i]) && !modifiers.has(parts[i])) { stem = parts[i]; break; } }
    }
    return shortenRoleStem(stem);
  }

  // Multi-word role name: strip role-type suffixes and modifier prefixes
  const roleTypes = new Set(['staff', 'lead', 'head', 'manager', 'supervisor', 'member', 'user', 'owner', 'admin', 'administrator', 'worker', 'representative', 'person', 'operator']);
  const modifiers = new Set(['super', 'operations', 'platform', 'senior', 'junior', 'foreign', 'external', 'internal', 'lead', 'head']);

  while (words.length > 1 && roleTypes.has(words[words.length - 1])) words.pop();
  while (words.length > 1 && modifiers.has(words[0])) words.shift();
  // If the only remaining word is a modifier, strip it too (use fallback)
  if (words.length === 1 && modifiers.has(words[0])) words.pop();

  // Fallback to the last word when stripping leaves us empty
  const raw = words.length ? words.join('-') : (lower.split(/\s+/).pop() || lower);
  return shortenRoleStem(raw);
}

/** Shorten overly long role-type words to canonical short forms. */
function shortenRoleStem(stem) {
  const SHORT_FORMS = {
    'administrator': 'admin',
    'administration': 'admin',
  };
  return SHORT_FORMS[stem] || stem;
}

/** Persist auto-detected frontends to PIPELINE_STATUS.md so detection runs once. */
function writeFrontendsToStatus(statusFile, content, frontends) {
  try {
    const indent = '  ';
    const lines = [indent + 'frontends:'];
    for (const fe of frontends) {
      lines.push(indent + indent + '- name: ' + fe.name);
      lines.push(indent + indent + indent + 'dir: ' + fe.dir);
      lines.push(indent + indent + indent + 'html_dir: ' + fe.html_dir);
      lines.push(indent + indent + indent + 'dev_port: ' + fe.dev_port);
    }
    const block = '\n' + lines.join('\n') + '\n';

    // Insert after the YAML config block (after the ``` closing fence)
    const fenceEnd = content.indexOf('```\n', content.indexOf('tech_stack:'));
    if (fenceEnd >= 0) {
      const newContent = content.slice(0, fenceEnd) + block + content.slice(fenceEnd);
      fs.writeFileSync(statusFile, newContent);
    }
  } catch (_) {
    // Non-fatal — detection will run again next call
  }
}

module.exports = {
  findProjectRoot,
  makeConfig,
  loadYaml,
  resolveVars,
  findProjectName,
  getFrontends,
  projectDir,
  statusDirFor,
  agentLogsDirFor,
  gateProofsDirFor,
};
