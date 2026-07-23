#!/usr/bin/env node
/**
 * normalize-docs.js — deterministic placeholder substitution for
 * LLM-generated markdown docs.
 *
 * Why: across v40–v44a, agentic nodes (prd/design/init) intermittently
 * leave literal template placeholders in their output:
 *   {PROJECT_NAME}, {project}, YYYY-MM-DD, <ISO>, [TODO], <PLACEHOLDER>
 *
 * The placeholders pass the artifact verification regex (which only
 * checks structure, not content) but then trip later gates that
 * scan for stale tokens. v44a evidence: prd evidence-check FAIL on
 * "PROJECT_API.md contains template placeholders". Same model produced
 * a clean doc in v42/v43 — model variance.
 *
 * Patching prompts (telling each model "don't write placeholders") is
 * unreliable. Patching the docs is bulletproof: a 50-line shell-out
 * after every doc-producing phase substitutes the well-known tokens
 * deterministically, regardless of which model wrote what.
 *
 * Substitutions:
 *   {PROJECT_NAME}    → <project>                   (typically "fsp")
 *   {project}         → <project>                   (lowercase variant)
 *   YYYY-MM-DD        → today's UTC date
 *   <ISO>             → today's UTC ISO-8601 timestamp
 *   <PLACEHOLDER>     → [unspecified]               (visible-but-non-blocking)
 *   [TODO]            → <!-- TODO -->               (kept as HTML comment; flags
 *                                                    the gap without tripping
 *                                                    placeholder regexes)
 *
 * Idempotent: re-running on a normalized file is a no-op (the substitution
 * targets are gone).
 *
 * Usage:
 *   node normalize-docs.js <project_name> <doc_path> [<doc_path> ...]
 *
 * Exits 0 with a JSON summary on stdout. Missing files are skipped (not a
 * failure — caller decides whether absence is fatal).
 */

const fs = require('fs');
const path = require('path');

function todayUTC() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function nowISO() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * v46 evidence: minimax wrote `| phase_complete | true |` (markdown
 * table row) in DESIGN_FULL_GENERATION_REPORT.md, tripping the
 * `phase_complete:\s*true` verification regex. Same family of drift
 * affects every YAML-key verification_pattern across the blueprints
 * (variations_generated, tests_generated, module:, refactor_status:,
 * directories_created, etc.). buildContractHints in agent prompts
 * tells the model to avoid this, but it's intermittent — so this
 * normalizer is the bulletproof backstop.
 *
 * For each line matching `| <key> | <value> |` (markdown 2-col row,
 * not header separator `| --- | --- |`), emit a duplicate `<key>: <value>`
 * line BELOW the table row. The original table stays intact (readable
 * for humans); the new YAML line satisfies the regex.
 *
 * Key gating: only keys that look like identifiers (snake_case or
 * camelCase, no spaces) are converted — protects against false
 * positives like `| Field | Value |` headers.
 */
function ensureYamlPairsFromTableRows(content) {
  const lines = content.split('\n');
  const out = [];
  const keyRe = /^[a-z][a-zA-Z0-9_]+$/;
  let injected = 0;
  for (const line of lines) {
    out.push(line);
    // Match a 2-column markdown row: |<sp>key<sp>|<sp>value<sp>|
    const m = line.match(/^\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    // Skip table headers ("Field" / "Value") and separator rows.
    if (!keyRe.test(key)) continue;
    if (/^-+$/.test(val)) continue;
    // Skip if this exact `key: value` line is already adjacent (avoid duplicate).
    const flatLine = `${key}: ${val}`;
    if (out.indexOf(flatLine) >= out.length - 2) continue;
    out.push(flatLine);
    injected++;
  }
  return { content: out.join('\n'), injected };
}

function normalize(content, projectName) {
  const date = todayUTC();
  const iso = nowISO();
  const subs = [
    [/\{PROJECT_NAME\}/g, projectName],
    [/\{project\}/g, projectName.toLowerCase()],
    [/YYYY-MM-DD/g, date],
    [/<ISO>/g, iso],
    [/<PLACEHOLDER>/g, '[unspecified]'],
    [/\[TODO\]/g, '<!-- TODO -->'],
  ];
  let out = content;
  const hits = {};
  for (const [re, repl] of subs) {
    const m = out.match(re);
    if (m && m.length) hits[re.source] = m.length;
    out = out.replace(re, repl);
  }
  // Markdown-table → YAML-pair injection. Idempotent because the dedupe
  // check (out.indexOf(flatLine)) skips when the YAML pair already exists.
  const tableResult = ensureYamlPairsFromTableRows(out);
  out = tableResult.content;
  if (tableResult.injected > 0) hits['md_table_to_yaml_pairs'] = tableResult.injected;
  return { content: out, hits };
}

function main() {
  const [projectName, ...paths] = process.argv.slice(2);
  if (!projectName || paths.length === 0) {
    console.error('usage: normalize-docs.js <project_name> <doc_path> [...]');
    process.exit(2);
  }
  const summary = {
    project: projectName,
    files_scanned: 0,
    files_missing: 0,
    files_changed: 0,
    total_substitutions: 0,
    changes: [],
  };
  for (const p of paths) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) {
      summary.files_missing++;
      continue;
    }
    summary.files_scanned++;
    const original = fs.readFileSync(abs, 'utf8');
    const { content, hits } = normalize(original, projectName);
    if (content !== original) {
      fs.writeFileSync(abs, content, 'utf8');
      summary.files_changed++;
      const subCount = Object.values(hits).reduce((a, b) => a + b, 0);
      summary.total_substitutions += subCount;
      summary.changes.push({ file: path.relative(process.cwd(), abs), substitutions: hits });
    }
  }
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) main();

module.exports = { normalize, todayUTC, nowISO };
