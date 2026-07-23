/**
 * rubric.js — rubric + calibration-example handling for the evaluator node type.
 *
 * Responsibilities:
 *   - load and validate `{phase}-rubric.yaml`
 *   - load and validate the optional `{phase}-examples.yaml`
 *   - render both into prompt-friendly strings for the evaluator agent
 *   - parse + validate the JSON the evaluator returns, including recomputing
 *     overall_score authoritatively from the weighted breakdown
 *
 * Rubric YAML shape (authoritative example:
 * .claude/blueprints/evaluators/design-rubric.yaml):
 *
 *   name: design-evaluation
 *   version: 1
 *   scope: "<one paragraph>"
 *   criteria:
 *     <name>:
 *       weight: 0.25            # all weights must sum to 1.0
 *       question: "<one sentence>"
 *       anchors:
 *         - { score: 1.0, description: "<concrete test>" }
 *         - { score: 0.7, description: "..." }
 *         - ...                 # descending order, >= 2 anchors
 *   output_format:
 *     required_fields: [overall_score, weighted_breakdown, blockers, rationale]
 *     blocker_severities: [P0, P1, P2]
 */

const fs = require('fs');
const { loadYaml } = require('./config');

const WEIGHT_SUM_TOLERANCE = 1e-6;
const OVERALL_SCORE_MISMATCH_WARN = 0.02;

function loadRubric(rubricPath) {
  if (!fs.existsSync(rubricPath)) {
    throw new Error(`rubric file not found: ${rubricPath}`);
  }
  const yaml = loadYaml();
  const parsed = yaml.parse(fs.readFileSync(rubricPath, 'utf-8'));
  validateRubric(parsed, rubricPath);
  return parsed;
}

function validateRubric(rubric, source = '<rubric>') {
  const errors = [];
  if (!rubric || typeof rubric !== 'object') {
    throw new Error(`invalid rubric at ${source}: not an object`);
  }
  if (!rubric.name) errors.push('missing top-level: name');
  if (!rubric.criteria || typeof rubric.criteria !== 'object') {
    errors.push('missing top-level: criteria');
  }

  if (rubric.criteria) {
    let weightSum = 0;
    for (const [critName, crit] of Object.entries(rubric.criteria)) {
      const prefix = `criteria.${critName}`;
      if (typeof crit.weight !== 'number') {
        errors.push(`${prefix}: weight must be a number`);
      } else {
        weightSum += crit.weight;
      }
      if (!crit.question || typeof crit.question !== 'string') {
        errors.push(`${prefix}: missing or non-string question`);
      }
      if (!Array.isArray(crit.anchors) || crit.anchors.length < 2) {
        errors.push(`${prefix}: anchors must be an array with >= 2 entries`);
      } else {
        let prev = Infinity;
        for (let i = 0; i < crit.anchors.length; i++) {
          const a = crit.anchors[i];
          const anchorPrefix = `${prefix}.anchors[${i}]`;
          if (typeof a.score !== 'number' || a.score < 0 || a.score > 1) {
            errors.push(`${anchorPrefix}: score must be a number in [0, 1]`);
          }
          if (!a.description || typeof a.description !== 'string') {
            errors.push(`${anchorPrefix}: description missing or non-string`);
          }
          if (typeof a.score === 'number' && a.score > prev) {
            errors.push(`${anchorPrefix}: anchors must be sorted descending by score`);
          }
          if (typeof a.score === 'number') prev = a.score;
        }
      }
    }
    if (Math.abs(weightSum - 1.0) > WEIGHT_SUM_TOLERANCE) {
      errors.push(`criteria weights must sum to 1.0 (got ${weightSum.toFixed(6)})`);
    }
  }

  if (errors.length) {
    throw new Error(`invalid rubric at ${source}:\n  - ${errors.join('\n  - ')}`);
  }
  return true;
}

/**
 * Load calibration examples. Examples are optional — a missing file returns
 * an empty set rather than throwing. `rubric` (optional) enables per-example
 * validation that the referenced criterion exists.
 */
function loadExamples(examplesPath, rubric = null) {
  if (!examplesPath || !fs.existsSync(examplesPath)) {
    return { examples: [] };
  }
  const yaml = loadYaml();
  const parsed = yaml.parse(fs.readFileSync(examplesPath, 'utf-8'));
  if (rubric) validateExamples(parsed, rubric, examplesPath);
  return parsed;
}

function validateExamples(obj, rubric, source = '<examples>') {
  if (!obj || !Array.isArray(obj.examples)) {
    throw new Error(`invalid examples at ${source}: missing examples[] array`);
  }
  const critNames = new Set(Object.keys(rubric.criteria || {}));
  const errors = [];
  for (let i = 0; i < obj.examples.length; i++) {
    const ex = obj.examples[i];
    const prefix = `examples[${i}]`;
    if (!ex.criterion || !critNames.has(ex.criterion)) {
      errors.push(`${prefix}: criterion '${ex.criterion}' is not declared in rubric`);
    }
    if (typeof ex.correct_score !== 'number' || ex.correct_score < 0 || ex.correct_score > 1) {
      errors.push(`${prefix}: correct_score must be a number in [0, 1]`);
    }
    if (!ex.excerpt || typeof ex.excerpt !== 'string') {
      errors.push(`${prefix}: excerpt missing or non-string`);
    }
    if (!ex.rationale || typeof ex.rationale !== 'string') {
      errors.push(`${prefix}: rationale missing or non-string`);
    }
  }
  if (errors.length) {
    throw new Error(`invalid examples at ${source}:\n  - ${errors.join('\n  - ')}`);
  }
  return true;
}

function renderRubricPrompt(rubric) {
  const parts = [];
  parts.push(`# GRADING RUBRIC: ${rubric.name} (v${rubric.version || 1})`);
  if (rubric.scope) {
    parts.push('\n## Scope');
    parts.push(rubric.scope.trim());
  }
  parts.push('\n## Criteria');
  for (const [name, crit] of Object.entries(rubric.criteria)) {
    parts.push(`\n### ${name}  (weight: ${crit.weight})`);
    parts.push(`**Question:** ${crit.question.trim()}`);
    parts.push('\n**Score anchors (you must match one of these):**');
    for (const a of crit.anchors) {
      parts.push(`- **${a.score.toFixed(1)}** — ${a.description.trim()}`);
    }
  }
  const fmt = rubric.output_format || {};
  if (fmt.required_fields) {
    parts.push('\n## Required output fields');
    parts.push(fmt.required_fields.map(f => `- \`${f}\``).join('\n'));
  }
  if (fmt.blocker_severities) {
    parts.push(`\n## Allowed blocker severities\n${fmt.blocker_severities.join(', ')}`);
  }
  return parts.join('\n');
}

function renderExamplesPrompt(examplesObj) {
  if (!examplesObj || !Array.isArray(examplesObj.examples) || examplesObj.examples.length === 0) {
    return '';
  }
  const parts = ['# CALIBRATION EXAMPLES'];
  parts.push('Hand-graded excerpts showing what each score level means in practice.');
  parts.push('Match this calibration. If your scoring drifts higher than these anchors, you are being generous — lower it.');
  for (let i = 0; i < examplesObj.examples.length; i++) {
    const ex = examplesObj.examples[i];
    parts.push(`\n## Example ${i + 1} — criterion: ${ex.criterion}, correct score: ${ex.correct_score.toFixed(1)}`);
    parts.push('```');
    parts.push(ex.excerpt.trim());
    parts.push('```');
    parts.push(`**Why this score:** ${ex.rationale.trim()}`);
  }
  return parts.join('\n');
}

function computeOverallScore(breakdown, rubric) {
  let total = 0;
  for (const [name, crit] of Object.entries(rubric.criteria)) {
    const score = breakdown[name];
    if (typeof score !== 'number') {
      throw new Error(`weighted_breakdown missing criterion: ${name}`);
    }
    total += score * crit.weight;
  }
  return Math.round(total * 1000) / 1000;
}

/**
 * Validate + normalize the JSON the evaluator agent produced.
 *
 * Returns `{ valid, errors, normalized }`. The normalized object has scores
 * clamped to [0, 1] and an authoritative `overall_score` recomputed from the
 * weighted breakdown — we never trust the agent's self-reported total.
 *
 * `normalized.mismatch` captures the gap between the agent's claimed total
 * and our derived total; values above OVERALL_SCORE_MISMATCH_WARN (0.02)
 * indicate the agent can't do basic arithmetic, which is a calibration
 * smell worth logging.
 */
function validateEvaluation(evaluation, rubric) {
  const errors = [];
  if (!evaluation || typeof evaluation !== 'object') {
    return { valid: false, errors: ['evaluation must be a JSON object'], normalized: null };
  }

  const required = (rubric.output_format && rubric.output_format.required_fields) ||
    ['overall_score', 'weighted_breakdown', 'blockers', 'rationale'];
  for (const field of required) {
    if (!(field in evaluation)) errors.push(`missing field: ${field}`);
  }

  const breakdown = { ...(evaluation.weighted_breakdown || {}) };
  for (const [name] of Object.entries(rubric.criteria)) {
    const s = breakdown[name];
    if (typeof s !== 'number') {
      errors.push(`weighted_breakdown.${name}: must be a number`);
      continue;
    }
    // Clamp silently — agents occasionally return 1.05 or -0.01. No reason
    // to fail the whole node over a minor overshoot.
    breakdown[name] = Math.max(0, Math.min(1, s));
  }

  const blockers = Array.isArray(evaluation.blockers) ? evaluation.blockers : [];
  const allowedSeverities = new Set(
    (rubric.output_format && rubric.output_format.blocker_severities) || ['P0', 'P1', 'P2']
  );
  for (let i = 0; i < blockers.length; i++) {
    const b = blockers[i];
    if (!b || typeof b !== 'object') {
      errors.push(`blockers[${i}]: must be an object`);
      continue;
    }
    if (!b.severity || !allowedSeverities.has(b.severity)) {
      errors.push(`blockers[${i}]: invalid severity '${b.severity}'`);
    }
    if (!b.criterion) errors.push(`blockers[${i}]: missing criterion`);
    if (!b.issue) errors.push(`blockers[${i}]: missing issue`);
  }

  if (errors.length) {
    return { valid: false, errors, normalized: null };
  }

  const claimed = typeof evaluation.overall_score === 'number'
    ? Math.max(0, Math.min(1, evaluation.overall_score))
    : null;
  const derived = computeOverallScore(breakdown, rubric);
  const mismatch = claimed !== null ? Math.abs(claimed - derived) : 0;

  const normalized = {
    overall_score: derived,
    claimed_overall_score: claimed,
    mismatch,
    mismatch_significant: mismatch > OVERALL_SCORE_MISMATCH_WARN,
    weighted_breakdown: breakdown,
    blockers,
    rationale: typeof evaluation.rationale === 'string' ? evaluation.rationale : '',
    p0_count: blockers.filter(b => b && b.severity === 'P0').length,
    p1_count: blockers.filter(b => b && b.severity === 'P1').length,
    p2_count: blockers.filter(b => b && b.severity === 'P2').length,
    evaluator_metadata: (evaluation.evaluator_metadata && typeof evaluation.evaluator_metadata === 'object')
      ? evaluation.evaluator_metadata
      : {},
  };

  return { valid: true, errors: [], normalized };
}

module.exports = {
  loadRubric,
  validateRubric,
  loadExamples,
  validateExamples,
  renderRubricPrompt,
  renderExamplesPrompt,
  computeOverallScore,
  validateEvaluation,
  // Exported for test/debug harnesses:
  WEIGHT_SUM_TOLERANCE,
  OVERALL_SCORE_MISMATCH_WARN,
};
