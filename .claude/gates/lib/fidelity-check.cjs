#!/usr/bin/env node
/**
 * fidelity-check.cjs — HTML ↔ React structural fidelity scorer (DEBUG HELPER)
 *
 * ⚠️ DEMOTED (2026-04-15): No longer called by frontend-gate.sh.
 *
 * The PRIMARY Phase 6 fidelity check is now:
 *   agentic node `design-fidelity-check` in .claude/blueprints/frontend.yaml
 *     → invokes .claude/react/skills/qa/design-qa-html.md
 *     → writes DESIGN_FIDELITY_REPORT.md
 *     → gate (.claude/gates/frontend-gate.sh check "design-fidelity") parses it
 *
 * This .cjs remains as a debug/quick-check helper for developers who want
 * a fast structural sanity check without invoking an LLM. It is NOT
 * authoritative and NOT part of the gate contract. Do not rely on it for
 * CI decisions.
 *
 * Usage: node fidelity-check.cjs <TARGET_DIR>
 *
 * Reads HTML files from <TARGET_DIR>/.claude-project/design/html/*.html and
 * maps each to a React page in <TARGET_DIR>/frontend/src/pages/**.tsx via
 * filename heuristics. For each mapped pair, computes a 0.0–1.0 fidelity
 * score across five weighted categories:
 *   - Layout (25%): sections + headers + navs + articles
 *   - Typography (20%): h1-h6
 *   - Components (15%): buttons + links + forms + inputs
 *   - Visual (15%): svg + img
 *   - Text tokens (25%): Korean static text tokens
 *
 * Emits a single JSON object to stdout. Always exits 0.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TARGET_DIR = process.argv[2] || '.';
// Per-PRD layout: .claude-project/<project>/design/html/. Project name is
// argv[3] if the caller (gate) passes it, else auto-detect by globbing for
// the first .claude-project/<project>/status/PIPELINE_STATUS.md.
function detectProjectName() {
  const root = path.join(TARGET_DIR, '.claude-project');
  if (!fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.') &&
        fs.existsSync(path.join(root, entry.name, 'status', 'PIPELINE_STATUS.md'))) {
      return entry.name;
    }
  }
  return null;
}
const PROJECT_NAME = process.argv[3] || detectProjectName() || 'fsp';
const HTML_DIR = path.join(TARGET_DIR, '.claude-project', PROJECT_NAME, 'design', 'html');

// Auto-detect frontend layout: prefer app/ (RR7 framework mode, what
// scaffold-frontend-shell produces) over src/ (legacy Vite/CRA). v25 evidence:
// hardcoded src/ paths caused fidelity-check to silently score every page
// as "missing" against RR7-templated frontends. Same fix shape as PR #57
// frontend-gate.sh / has-stable-testids.sh / verify-page-coverage.
const FE_ROOT = path.join(TARGET_DIR, 'frontend');
const FE_LAYOUT = fs.existsSync(path.join(FE_ROOT, 'app', 'pages')) ? 'app'
  : fs.existsSync(path.join(FE_ROOT, 'src', 'pages')) ? 'src'
  : 'app';
const PAGES_DIR = path.join(FE_ROOT, FE_LAYOUT, 'pages');
const I18N_DIR = path.join(FE_ROOT, FE_LAYOUT, 'i18n');
const LOCALES_DIR = path.join(TARGET_DIR, 'frontend', 'public', 'locales');

// --- Helpers ---

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function walk(dir, filter, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}

function countMatches(text, regex) {
  const m = text.match(regex);
  return m ? m.length : 0;
}

// Strip HTML comments and <script>/<style> blocks before counting text tokens.
function stripNonText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
}

// Extract visible Korean text tokens (>=2 consecutive Korean chars, optionally
// with spaces/punctuation). Duplicates deduped.
function extractKoreanTokens(html) {
  const stripped = stripNonText(html);
  const textOnly = stripped.replace(/<[^>]+>/g, ' ');
  const tokens = new Set();
  const re = /[가-힣][가-힣0-9\s·,./()\-]{1,30}/g;
  let m;
  while ((m = re.exec(textOnly)) !== null) {
    const t = m[0].trim();
    // Require at least 2 Korean chars
    const koreanChars = (t.match(/[가-힣]/g) || []).length;
    if (koreanChars >= 2 && t.length <= 30) tokens.add(t);
  }
  return [...tokens];
}

// --- Count HTML structural elements ---

function countHtml(html) {
  return {
    section: countMatches(html, /<section\b/gi),
    header:  countMatches(html, /<header\b/gi),
    nav:     countMatches(html, /<nav\b/gi),
    article: countMatches(html, /<article\b/gi),
    h1_6:    countMatches(html, /<h[1-6]\b/gi),
    button:  countMatches(html, /<button\b/gi),
    a:       countMatches(html, /<a\b/gi),
    form:    countMatches(html, /<form\b/gi),
    input:   countMatches(html, /<input\b/gi),
    svg:     countMatches(html, /<svg\b/gi),
    img:     countMatches(html, /<img\b/gi),
  };
}

// --- Count React JSX equivalents ---

function countReact(jsx) {
  return {
    section: countMatches(jsx, /<section\b/g),
    header:  countMatches(jsx, /<header\b/g),
    nav:     countMatches(jsx, /<nav\b/g),
    article: countMatches(jsx, /<article\b/g),
    h1_6:    countMatches(jsx, /<h[1-6]\b/g),
    button:  countMatches(jsx, /<button\b/g) + countMatches(jsx, /<Button\b/g),
    // count both <a ...> and <Link ...>
    a:       countMatches(jsx, /<a\s/g) + countMatches(jsx, /<Link\b/g) + countMatches(jsx, /<NavLink\b/g),
    form:    countMatches(jsx, /<form\b/g),
    input:   countMatches(jsx, /<input\b/g) + countMatches(jsx, /<Input\b/g),
    svg:     countMatches(jsx, /<svg\b/g) + countMatches(jsx, /<Icon\b/g) + countMatches(jsx, /<(?:[A-Z][A-Za-z]*Icon)\b/g),
    img:     countMatches(jsx, /<img\b/g) + countMatches(jsx, /<Image\b/g),
  };
}

// --- HTML → React mapping ---

// Strip prefix like "b-" or "admin-" → base slug
function slugVariants(htmlFile) {
  const base = htmlFile.replace(/\.html$/, '');
  const variants = new Set([base]);
  // Common prefixes
  const prefixes = ['b-', 'admin-', 'company-', 'worker-'];
  for (const p of prefixes) {
    if (base.startsWith(p)) variants.add(base.slice(p.length));
  }
  return [...variants];
}

function toPascal(slug) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

// Build candidate React filenames from HTML filename.
function reactCandidates(htmlFile) {
  const variants = slugVariants(htmlFile);
  const candidates = new Set();
  for (const v of variants) {
    const pascal = toPascal(v);
    candidates.add(`${pascal}Page.tsx`);
    candidates.add(`${pascal}.tsx`);
    // Drop trailing words like "-page"
    const stripped = v.replace(/-page$/, '');
    if (stripped !== v) {
      const sp = toPascal(stripped);
      candidates.add(`${sp}Page.tsx`);
      candidates.add(`${sp}.tsx`);
    }
  }
  return [...candidates];
}

// Determine role directory hint from HTML filename prefix
function roleHint(htmlFile) {
  if (htmlFile.startsWith('admin-')) return 'admin';
  if (htmlFile.startsWith('company-')) return 'company';
  if (htmlFile.startsWith('b-')) return 'worker';
  if (/^(login|signup|landing|forgot-password|reset-password|verify-email|change-password)/.test(htmlFile)) {
    return 'auth';
  }
  return null;
}

function findReactFile(htmlFile, allTsx) {
  const candidates = reactCandidates(htmlFile);
  const role = roleHint(htmlFile);

  // 1. Prefer role dir match
  if (role) {
    for (const c of candidates) {
      const hit = allTsx.find(p =>
        p.endsWith(path.sep + c) && p.includes(path.sep + role + path.sep)
      );
      if (hit) return hit;
    }
  }
  // 2. Any dir match
  for (const c of candidates) {
    const hit = allTsx.find(p => p.endsWith(path.sep + c));
    if (hit) return hit;
  }
  // 3. Relaxed: case-insensitive endsWith
  for (const c of candidates) {
    const lc = c.toLowerCase();
    const hit = allTsx.find(p => p.toLowerCase().endsWith(path.sep.toLowerCase() + lc));
    if (hit) return hit;
  }
  return null;
}

// --- i18n token check ---

function loadI18nCorpus() {
  let corpus = '';
  const files = [
    ...walk(I18N_DIR, p => /\.(ts|tsx|json)$/.test(p)),
    ...walk(LOCALES_DIR, p => /\.json$/.test(p)),
  ];
  for (const f of files) corpus += '\n' + safeRead(f);
  return corpus;
}

function tokenPresentInReact(token, reactSrc, i18nCorpus) {
  if (reactSrc.includes(token)) return true;
  if (i18nCorpus.includes(token)) return true;
  return false;
}

// --- Scoring ---

function scorePair(htmlSrc, reactSrc, i18nCorpus) {
  const h = countHtml(htmlSrc);
  const r = countReact(reactSrc);

  const layoutH = h.section + h.header + h.nav + h.article;
  const layoutR = r.section + r.header + r.nav + r.article;
  const layoutScore = layoutH === 0 ? 1 : Math.min(layoutR / layoutH, 1);

  const typoH = h.h1_6;
  const typoR = r.h1_6;
  const typoScore = typoH === 0 ? 1 : Math.min(typoR / typoH, 1);

  const compH = h.button + h.a + h.form + h.input;
  const compR = r.button + r.a + r.form + r.input;
  const compScore = compH === 0 ? 1 : Math.min(compR / compH, 1);

  const visualH = h.svg + h.img;
  const visualR = r.svg + r.img;
  const visualScore = visualH === 0 ? 1 : Math.min(visualR / visualH, 1);

  const tokens = extractKoreanTokens(htmlSrc);
  const total = tokens.length;
  let matched = 0;
  for (const t of tokens) {
    if (tokenPresentInReact(t, reactSrc, i18nCorpus)) matched++;
  }
  const tokenScore = total === 0 ? 1 : matched / total;

  const fidelity =
    layoutScore * 0.25 +
    typoScore   * 0.20 +
    compScore   * 0.15 +
    visualScore * 0.15 +
    tokenScore  * 0.25;

  return {
    score: Number(fidelity.toFixed(3)),
    missing: {
      layout:       `${layoutR}/${layoutH}`,
      typography:   `${typoR}/${typoH}`,
      components:   `${compR}/${compH}`,
      visual:       `${visualR}/${visualH}`,
      text_tokens:  `${matched}/${total}`,
    },
    category_scores: {
      layout:     Number(layoutScore.toFixed(3)),
      typography: Number(typoScore.toFixed(3)),
      components: Number(compScore.toFixed(3)),
      visual:     Number(visualScore.toFixed(3)),
      text_tokens:Number(tokenScore.toFixed(3)),
    },
  };
}

// --- Main ---

function main() {
  const result = {
    avg_fidelity: 0,
    min_fidelity: 0,
    pages: [],
    unmapped_html: [],
    unmapped_react: [],
  };

  let htmlFiles = [];
  try {
    htmlFiles = fs.readdirSync(HTML_DIR)
      .filter(f => f.endsWith('.html'))
      .sort();
  } catch {
    process.stdout.write(JSON.stringify(result));
    return;
  }

  const allTsx = walk(PAGES_DIR, p => p.endsWith('.tsx'));
  const i18nCorpus = loadI18nCorpus();

  const mappedReact = new Set();
  const scores = [];

  for (const hf of htmlFiles) {
    const htmlPath = path.join(HTML_DIR, hf);
    const htmlSrc = safeRead(htmlPath);
    const reactFile = findReactFile(hf, allTsx);

    if (!reactFile) {
      result.unmapped_html.push(hf);
      // Unmapped HTML counts as score 0 against fidelity average
      scores.push(0);
      result.pages.push({
        html: hf,
        react: null,
        score: 0,
        missing: { reason: 'no matching React page found' },
      });
      continue;
    }

    mappedReact.add(reactFile);
    const reactSrc = safeRead(reactFile);
    const rel = path.relative(TARGET_DIR, reactFile);
    const s = scorePair(htmlSrc, reactSrc, i18nCorpus);
    scores.push(s.score);
    result.pages.push({
      html: hf,
      react: rel,
      score: s.score,
      missing: s.missing,
      category_scores: s.category_scores,
    });
  }

  for (const p of allTsx) {
    if (!mappedReact.has(p)) {
      result.unmapped_react.push(path.relative(TARGET_DIR, p));
    }
  }

  if (scores.length) {
    const sum = scores.reduce((a, b) => a + b, 0);
    result.avg_fidelity = Number((sum / scores.length).toFixed(3));
    result.min_fidelity = Number(Math.min(...scores).toFixed(3));
  }

  process.stdout.write(JSON.stringify(result));
}

try { main(); }
catch (err) {
  process.stdout.write(JSON.stringify({
    avg_fidelity: 0, min_fidelity: 0, pages: [],
    unmapped_html: [], unmapped_react: [],
    error: String(err && err.message || err),
  }));
}
