// ─────────────────────────────────────────────────────────────────────────────
// Shared cleaning helpers for the raw NFPE exports.
//
// Extracted verbatim from build-analytics-data.mjs so the v1 (Database/) and
// v2 (Data - 14-08-26) pipelines clean identically — the two exports differ only
// in column NAMES and file layout, never in how a value must be normalised.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';

// ── tiny quote-aware CSV parser (handles "…" and Excel ="…") ──────────────────
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// Some Student/Center IDs (and occasionally numeric values) are written in Bengali numerals
// (০–৯). Normalise them to ASCII digits so real learners like "Bajid mia" (id ৪0১0২৩0৫৩১২) pass
// the numeric-ID gate and join correctly instead of being silently dropped.
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const bnToAscii = (s) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
export const unwrap = (s) => bnToAscii((s ?? '').replace(/^="?/, '').replace(/"$/, '').trim());

// An ID is its DIGIT SEQUENCE. The source formats real IDs with embedded spaces
// ("26301 619 5315" → Mabiya) or a stray decimal ("26361238.7305", an Excel artifact), so strip
// every non-digit for ID fields ONLY — never names.
export const idOf = (s) => unwrap(s).replace(/\D/g, '');

// ── normalisers ──────────────────────────────────────────────────────────────
export const nz = (v) => { const s = unwrap(v); return s === '' || s === '-' || s.toLowerCase() === 'not applicable' ? null : s; };
export const isCleanId = (id) => /^[0-9]{3,}$/.test(id);
export const isTestRow = (line) => /\btest\b|lorem|ipsum|faker|dolor|\bipsa\b/i.test(line);

export function incomeToTk(raw) {                // "8000 TK" → 8000 ; "Avobe 15000 TK" → 15000 ; "-" → null
  const s = unwrap(raw); if (!s || s === '-') return null;
  const m = s.match(/(\d[\d,]*)/); return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}
export function incomeBand(raw) {
  const tk = incomeToTk(raw); if (tk == null) return null;
  if (/avobe|above/i.test(unwrap(raw))) return '15000+';
  if (tk < 5000) return '<5000';
  if (tk < 10000) return '5000-9999';
  if (tk < 15000) return '10000-14999';
  return '15000+';
}
export const yearOf = (raw) => { const s = unwrap(raw); const m = s.match(/\b(19|20)\d{2}\b/); return m ? parseInt(m[0], 10) : null; };

// ── assessment column parsing (headers like "Bangla BL", "Math C3") ──────────
export function subjectOf(h) {
  const s = h.toLowerCase();
  if (s.startsWith('bangla')) return 'Bangla';
  if (s.startsWith('math')) return 'Mathematics';
  if (s.startsWith('english')) return 'English';
  if (s.startsWith('science')) return 'Science';
  if (s.startsWith('bgs')) return 'BGS';
  if (s.startsWith('life skill')) return 'Life Skills';
  if (s.startsWith('religion')) return 'Religion';
  return null;
}
export function phaseOf(h) { const m = h.match(/\b(BL|C[1-5])\b/i); return m ? m[1].toUpperCase() : null; }

// ── CSV writer (RFC-4180 quoting) ────────────────────────────────────────────
export function toCsv(cols, records) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.join(',')];
  for (const rec of records) lines.push(cols.map((c) => esc(rec[c])).join(','));
  return lines.join('\n') + '\n';
}

/** Reader bound to a source directory. `idx` is CASE-INSENSITIVE, which absorbs the many
 *  case-only header renames between the two exports ("GPS latitude" → "GPS Latitude"). */
export function makeLoad(dir) {
  return function load(file) {
    const rows = parseCsv(fs.readFileSync(path.join(dir, file), 'utf8'));
    const header = rows[0].map(unwrap);
    const idx = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    const body = rows.slice(1).filter((r) => r.some((c) => c && c.trim()));
    return { header, idx, body };
  };
}

export function makeWrite(outDir) {
  return function write(name, cols, records) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, name), toCsv(cols, records));
    console.log(`  ✓ ${name.padEnd(22)} ${records.length.toLocaleString()} rows`);
  };
}
