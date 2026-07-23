/**
 * contract-hints.js — turn a verification regex into a model-agnostic
 * "do/don't" cheat-sheet appended to the MANDATORY ARTIFACT CONTRACT block.
 *
 * Why: v40 evidence on minimax-m2.7 (and v37+ on kimi-k2.6) — both models
 * understood the contract semantically but emitted formats the literal regex
 * rejected: markdown tables, JSON, `key=value`. Telling each model
 * individually "don't use tables" is not scalable as we add deepseek, mimo,
 * etc. Instead, synthesise a positive example from the regex itself and
 * pair it with three canonical drift patterns to reject. Same hint serves
 * every model.
 *
 * Used by both lib/agent.js (Claude Code) and lib/agent-opencode.js +
 * lib/agent-opencode-http.js (opencode-go) so the contract message is
 * literally identical regardless of backend.
 */

/**
 * Synthesise one or two concrete lines that satisfy the regex.
 * The set covers the patterns we use across blueprints — extend as new
 * shapes appear in *-2.yaml.
 */
function exampleForPattern(pattern) {
  // Strip the leading multiline-anchor `^` for matching purposes; we keep
  // it semantically in the example.
  const p = pattern.replace(/^\^/, '');

  // Pattern: `key:\s*[0-9.]+` or `key:\s*[0-9]+` → numeric YAML value
  let m = p.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\\s\*\[0-9(\.)?\]\+/);
  if (m) return [`${m[1]}: 42`];

  // Pattern: `key:\s*(opt1|opt2|...)` → enum
  m = p.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\\s\*\(([^)]+)\)/);
  if (m) {
    const first = m[2].split('|')[0].trim();
    return [`${m[1]}: ${first}`];
  }

  // Pattern: `key:\s*\S` or `key:\s*\S+` → arbitrary string
  m = p.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\\s\*\\S/);
  if (m) return [`${m[1]}: <value>`];

  // Pattern: `key:\s*true|false` (boolean) — handled by enum pattern above.

  // Pattern: markdown heading `^#+\s+...` or `^#\s+...`
  if (/^#\+\?\\s\+/.test(p) || /^#\\s/.test(p)) {
    return [`# Section title`];
  }

  // Pattern: `^\|\s*Method\s*\|` → markdown table header — the model
  // actually NEEDS to emit a markdown table here, so swap the negative
  // examples accordingly.
  if (/^\\\|/.test(p)) {
    return [`| Method | Path | ... |`];
  }

  // Pattern: `page_parity_generated:\s*true`-style literal value
  m = p.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\\s\*([a-zA-Z0-9]+)$/);
  if (m) return [`${m[1]}: ${m[2]}`];

  // Fallback: nothing we recognise — let the regex speak for itself.
  return null;
}

/**
 * Build the negative-example section: which common drift formats are
 * regex-illegal. Suppress drift hints for nodes whose pattern *expects*
 * markdown (e.g. PROJECT_API.md endpoint tables) so we don't lie to the
 * model.
 */
function driftWarningsFor(pattern) {
  const isTablePattern = /^\^?\\\|/.test(pattern);
  if (isTablePattern) {
    return [
      `Drift to avoid (regex won't match):`,
      `  ✗ YAML key:value           (this contract wants a pipe-table row, not a colon line)`,
      `  ✗ JSON object              (this contract wants a pipe-table row, not braces)`,
    ];
  }
  return [
    `Common drift patterns that look right but the regex rejects:`,
    `  ✗ | key | value |            (markdown table cell — pipe ≠ colon)`,
    `  ✗ {"key": "value"}           (JSON object — colon is inside quotes)`,
    `  ✗ key=value                  (assignment — equals ≠ colon)`,
    `  ✗ <key>value</key>           (XML/HTML — no colon at all)`,
  ];
}

/**
 * Render the full hint block (returns an array of lines to push() onto
 * the prompt parts). Empty array if no node.verification_pattern.
 */
function buildContractHints(resolvedPattern) {
  if (!resolvedPattern) return [];
  const lines = [];
  lines.push(`\nThe file MUST contain content matching this regex:`);
  lines.push(`  ${resolvedPattern}`);
  lines.push(`This pattern is verified by code, not interpretation.`);

  const examples = exampleForPattern(resolvedPattern);
  if (examples && examples.length > 0) {
    lines.push(``);
    lines.push(`Example line(s) that match:`);
    for (const ex of examples) lines.push(`  ✓ ${ex}`);
  }

  lines.push(``);
  for (const warn of driftWarningsFor(resolvedPattern)) lines.push(warn);
  lines.push(``);
  lines.push(`Write the field as the regex literally requires. Equivalent-`);
  lines.push(`looking shapes are NOT accepted — code reads the file with a`);
  lines.push(`flat RegExp.test() call.`);

  // v44a evidence: minimax intermittently emitted literal `{PROJECT_NAME}`,
  // `YYYY-MM-DD`, `<ISO>`, `[TODO]`, `<PLACEHOLDER>` tokens in PROJECT_API.md
  // and tripped downstream gates that grep for stale placeholders.
  // normalize-docs.js (post-process) is the bulletproof backstop, but
  // also include a prompt-level reminder for any model that responds to it.
  lines.push(``);
  lines.push(`NEVER write these literal template tokens (substitute real values):`);
  lines.push(`  {PROJECT_NAME}  → the actual project name`);
  lines.push(`  YYYY-MM-DD      → today's date (YYYY-MM-DD)`);
  lines.push(`  <ISO>           → today's ISO-8601 timestamp`);
  lines.push(`  [TODO]          → a real value, or omit the line entirely`);
  lines.push(`  <PLACEHOLDER>   → a real value`);

  return lines;
}

module.exports = { buildContractHints, exampleForPattern, driftWarningsFor };
