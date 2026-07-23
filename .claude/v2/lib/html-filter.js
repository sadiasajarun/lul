/**
 * html-filter.js — single source of truth for "which HTML mockups belong to
 * which frontend". Used by the frontend-2 blueprint's html-inventory node and
 * by frontend-gate.sh. Keeping one implementation prevents the orchestrator
 * and gate from disagreeing about the file set.
 *
 * Two selection modes:
 *   (a) folder mode — frontend entry declares `html_dir: admin`, so all
 *       HTML files under <designRoot>/admin/**\/*.html belong to it.
 *       Preferred for new projects; matches React `src/pages/admin/` layout.
 *   (b) glob mode — frontend entry declares `role_prefixes: ["admin-*"]`,
 *       so all files in <designRoot> whose basename matches a glob belong
 *       to it. Legacy-compatible for projects that dump HTML flat.
 *
 * The dispatcher `enumerateHtmlForFrontend(designRoot, fe)` picks the right
 * mode based on which field the manifest entry declares.
 */

const fs = require('fs');
const path = require('path');

function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * List HTML files in `dir` (non-recursive) whose basename (without .html)
 * matches any of the provided globs. Returns absolute paths, sorted.
 */
function filterHtmlByGlobs(dir, globs) {
  if (!fs.existsSync(dir)) return [];
  const patterns = (globs && globs.length ? globs : ['*']).map(globToRegex);
  const files = fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.html'))
    .filter(f => {
      const stem = f.replace(/\.html$/i, '');
      return patterns.some(re => re.test(stem));
    })
    .sort();
  return files.map(f => path.join(dir, f));
}

/**
 * Recursively list every *.html file under `root/subfolder`. Paths are
 * absolute and sorted. Missing folders return an empty list.
 */
function filterHtmlByFolder(root, subfolder) {
  const base = path.join(root, subfolder);
  if (!fs.existsSync(base)) return [];
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) out.push(full);
    }
  })(base);
  out.sort();
  return out;
}

/**
 * Dispatcher — given a design root and a frontend manifest entry, return the
 * list of HTML files belonging to that frontend.
 *
 * Precedence:
 *   1. fe.html_dir (non-empty string) → folder mode.
 *   2. fe.role_prefixes (non-empty array) → glob mode.
 *   3. Otherwise → everything under the design root (legacy default `['*']`).
 */
function enumerateHtmlForFrontend(designRoot, fe) {
  if (fe && typeof fe.html_dir === 'string' && fe.html_dir.trim()) {
    return filterHtmlByFolder(designRoot, fe.html_dir.trim());
  }
  const globs = fe && Array.isArray(fe.role_prefixes) && fe.role_prefixes.length
    ? fe.role_prefixes
    : ['*'];
  return filterHtmlByGlobs(designRoot, globs);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error('usage:');
    console.error('  html-filter.js <designRoot> [glob...]          # glob mode');
    console.error('  html-filter.js <designRoot> --folder <sub>     # folder mode');
    process.exit(2);
  }
  const [designRoot, ...rest] = argv;
  const folderIdx = rest.indexOf('--folder');
  let files;
  if (folderIdx !== -1) {
    const sub = rest[folderIdx + 1];
    if (!sub) { console.error('--folder requires a subfolder name'); process.exit(2); }
    files = filterHtmlByFolder(designRoot, sub);
  } else {
    files = filterHtmlByGlobs(designRoot, rest);
  }
  for (const f of files) console.log(f);
}

module.exports = { filterHtmlByGlobs, filterHtmlByFolder, enumerateHtmlForFrontend, globToRegex };
