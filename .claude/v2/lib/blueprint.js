/**
 * blueprint.js — loads and validates blueprint YAML
 *
 * Looks up "{phase}-2.yaml" first (v2 blueprints with artifact contracts).
 * Falls back to "{phase}.yaml" (v1 blueprint) only if v2 missing.
 */

const fs = require('fs');
const path = require('path');
const { loadYaml } = require('./config');

function findBlueprint(config, phaseName) {
  // Multi-stack: prefer a stack-specific blueprint when one exists, so a second
  // backend/frontend (e.g. django) can ship `{phase}-{stack}-2.yaml` without
  // touching the existing path. Backward-compatible — with NO stack-specific
  // file (the only state today) this falls through to `{phase}-2.yaml` exactly
  // as before (FSP=nestjs has no `database-nestjs-2.yaml` → unchanged). Stack
  // comes from the tech_stack cache populated by resolveVars/getTechStack.
  const stack = config._techStackCache || {};
  const quals = [];
  if (stack.backend) quals.push(stack.backend);
  if (stack.frontend && stack.frontend !== stack.backend) quals.push(stack.frontend);
  for (const q of quals) {
    const sp = path.join(config.blueprintsDir, `${phaseName}-${q}-2.yaml`);
    if (fs.existsSync(sp)) return { path: sp, version: 2 };
  }
  const v2Path = path.join(config.blueprintsDir, `${phaseName}-2.yaml`);
  if (fs.existsSync(v2Path)) {
    return { path: v2Path, version: 2 };
  }
  const v1Path = path.join(config.blueprintsDir, `${phaseName}.yaml`);
  if (fs.existsSync(v1Path)) {
    return { path: v1Path, version: 1 };
  }
  return null;
}

function loadBlueprint(config, phaseName) {
  const found = findBlueprint(config, phaseName);
  if (!found) {
    throw new Error(`Blueprint not found for phase '${phaseName}'. Looked for ${phaseName}-2.yaml and ${phaseName}.yaml in ${config.blueprintsDir}`);
  }
  const yaml = loadYaml();
  const content = fs.readFileSync(found.path, 'utf-8');
  const parsed = yaml.parse(content);
  parsed._meta = {
    path: found.path,
    version: found.version,
    filename: path.basename(found.path),
  };
  return parsed;
}

const KNOWN_FANOUT_SOURCES = new Set(['frontends', 'backend_modules', 'html_pages', 'roles']);

/**
 * Validates a v2 blueprint has artifact contracts on every agentic node,
 * and validates the optional `fanout:` block on any node.
 * Returns { valid: bool, errors: [] }
 */
function validateV2Contracts(blueprint) {
  const errors = [];
  if (!Array.isArray(blueprint.nodes)) {
    return { valid: false, errors: ['blueprint has no nodes array'] };
  }
  for (const node of blueprint.nodes) {
    if (node.type === 'agentic') {
      if (!node.required_output_file) {
        errors.push(`agentic node '${node.id}' missing required_output_file`);
      }
      // verification_pattern is optional but recommended
    }

    if (node.fanout) {
      const f = node.fanout;
      if (typeof f !== 'object' || Array.isArray(f)) {
        errors.push(`node '${node.id}' fanout must be an object`);
        continue;
      }
      if (!f.source || typeof f.source !== 'string') {
        errors.push(`node '${node.id}' fanout.source must be a string`);
      } else if (!KNOWN_FANOUT_SOURCES.has(f.source)) {
        errors.push(`node '${node.id}' fanout.source '${f.source}' unknown (known: ${[...KNOWN_FANOUT_SOURCES].join(', ')})`);
      }
      if (!f.subject_var || typeof f.subject_var !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.subject_var)) {
        errors.push(`node '${node.id}' fanout.subject_var must be a valid identifier (got '${f.subject_var}')`);
      }
      if (f.concurrency !== undefined) {
        const c = Number(f.concurrency);
        if (!Number.isFinite(c) || c < 1 || c > 32) {
          errors.push(`node '${node.id}' fanout.concurrency must be 1..32 (got ${f.concurrency})`);
        }
      }
      // When a node fans out, the per-cell required_output_file MUST reference
      // {subject_var} so each cell writes a distinct artifact. Otherwise all
      // cells overwrite the same file and verification is meaningless.
      if (node.required_output_file && f.subject_var) {
        const tok = `{${f.subject_var}}`;
        if (!String(node.required_output_file).includes(tok)) {
          errors.push(`node '${node.id}' fans out on '${f.subject_var}' but required_output_file does not reference ${tok}`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  findBlueprint,
  loadBlueprint,
  validateV2Contracts,
};
