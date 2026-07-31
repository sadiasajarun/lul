// ─────────────────────────────────────────────────────────────────────────────
// build-tuned-data.mjs — the "Preview" dataset.
//
// Starts from the REAL cleaned data (public/data/*.csv), KEEPS every real value, and IMPUTES only the
// blanks — sampled from the real distributions — so every dashboard is populated and the AI can
// compute on complete data. Writes public/data-tuned/*.csv with the IDENTICAL schema, so the whole
// pipeline (semantic views, dashboards, chat) is reused unchanged.
//
// ⚠️ This attaches ESTIMATED values to real children — a PREVIEW/demo aid only, never a decision source.
// Deterministic (seeded) so it's reproducible.   Run: npm run build:data:tuned
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public', 'data');
const OUT = path.join(ROOT, 'public', 'data-tuned');
const SUBJECTS = ['Bangla', 'Mathematics', 'English', 'Science', 'BGS', 'Life Skills', 'Religion'];

// ── seeded RNG (mulberry32) — reproducible ───────────────────────────────────
let _s = 42 >>> 0;
const rng = () => { _s |= 0; _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr[(rng() * arr.length) | 0];
const weightedPick = (entries) => { const tot = entries.reduce((s, e) => s + e[1], 0); let r = rng() * tot; for (const [k, w] of entries) { if ((r -= w) <= 0) return k; } return entries[0][0]; };

// ── minimal CSV parse/write (quote-aware) ────────────────────────────────────
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function load(name) {
  const rows = parseCsv(fs.readFileSync(path.join(SRC, name), 'utf8'));
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return { header, idx, rows: rows.slice(1).filter((r) => r.some((c) => c && c.trim())) };
}
const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function write(name, header, rows) {
  fs.mkdirSync(OUT, { recursive: true });
  const out = [header.join(',')].concat(rows.map((r) => r.map(esc).join(','))).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, name), out);
  console.log(`  ✓ ${name.padEnd(18)} ${rows.length.toLocaleString()} rows`);
}
const nz = (v) => { const s = (v ?? '').trim(); return s === '' || s === '-' ? null : s; };

console.log('Building PREVIEW (gap-filled) dataset → public/data-tuned/');

// ── real distributions (to sample imputations from) ──────────────────────────
const students = load('students.csv');
const si = students.idx;
const studentProg = new Map(), studentDiv = new Map();
const incomePool = [], nutritionPool = [], gradePool = [];
const divisionCount = {};
for (const r of students.rows) {
  studentProg.set(r[si.student_id], r[si.programme]);
  studentDiv.set(r[si.student_id], r[si.division]);
  divisionCount[r[si.division]] = (divisionCount[r[si.division]] || 0) + 1;
  if (nz(r[si.father_income_tk])) incomePool.push([r[si.father_income_tk], r[si.income_band]]);
  if (nz(r[si.nutrition])) nutritionPool.push(r[si.nutrition]);
  if (nz(r[si.admitted_grade])) gradePool.push(r[si.admitted_grade]);
}

const attendance = load('attendance.csv');
const ai = attendance.idx;
const attPoolByProg = {};
for (const r of attendance.rows) {
  const v = parseFloat(r[ai.attendance_pct]);
  if (Number.isFinite(v) && v > 0) { const p = studentProg.get(r[ai.student_id]) || 'ABAL'; (attPoolByProg[p] ??= []).push(v); }
}
const attPoolAll = Object.values(attPoolByProg).flat();

const assessments = load('assessments.csv');
const asi = assessments.idx;
const markPool = {}; const hasMark = new Set();
for (const r of assessments.rows) {
  const key = `${r[asi.programme]}|${r[asi.subject]}`;
  const m = parseFloat(r[asi.mark]);
  if (Number.isFinite(m)) (markPool[key] ??= []).push(m);
  hasMark.add(`${r[asi.student_id]}|${r[asi.subject]}`);
}

// ── 1) STUDENTS — fill demographic BLANKS only. Real values (incl. dropout_reason, mainstreamed)
//    are left EXACTLY as-is, so real metrics (poverty dropouts, mainstream rate) match Real mode. ─
let filledIncome = 0, filledNut = 0, filledGrade = 0;
const tunedStudents = students.rows.map((r) => {
  const row = r.slice();
  if (!nz(row[si.father_income_tk]) && incomePool.length) { const [tk, band] = pick(incomePool); row[si.father_income_tk] = tk; row[si.income_band] = band; filledIncome++; }
  if (!nz(row[si.nutrition]) && nutritionPool.length) { row[si.nutrition] = pick(nutritionPool); filledNut++; }
  if (!nz(row[si.admitted_grade]) && gradePool.length) { row[si.admitted_grade] = pick(gradePool); filledGrade++; }
  return row;
});
write('students.csv', students.header, tunedStudents);

// ── 2) ATTENDANCE — fill every 0/blank with a sampled real recorded value ─────
let filledAtt = 0;
const tunedAtt = attendance.rows.map((r) => {
  const row = r.slice();
  const v = parseFloat(row[ai.attendance_pct]);
  if (!(Number.isFinite(v) && v > 0)) {
    const pool = attPoolByProg[studentProg.get(row[ai.student_id])] || attPoolAll;
    row[ai.attendance_pct] = pool.length ? Math.round(pick(pool) * 10) / 10 : 85;
    filledAtt++;
  }
  return row;
});
write('attendance.csv', attendance.header, tunedAtt);

// ── 2b) MONTHLY ATTENDANCE (Preview only) — the source keeps just ONE aggregate % per student, so a
//    month-by-month trend does not exist in real data. For Preview we synthesise a 12-month series by
//    spreading each division×programme's real mean over a seasonal curve (monsoon dip Jun–Sep).
//    Grain: division × programme × month, storing n + sum so any weighted average is exact. ─
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASON = [1.03, 1.03, 1.02, 1.00, 0.99, 0.96, 0.94, 0.95, 0.97, 1.00, 1.03, 1.05]; // mean ≈ 1.0
const grpSum = {}, grpCnt = {};
for (const r of tunedAtt) {
  const sid = r[ai.student_id];
  const div = studentDiv.get(sid), prog = studentProg.get(sid);
  if (!div || !prog) continue;
  const v = parseFloat(r[ai.attendance_pct]);
  if (!Number.isFinite(v)) continue;
  const k = `${div}|${prog}`;
  grpSum[k] = (grpSum[k] || 0) + v; grpCnt[k] = (grpCnt[k] || 0) + 1;
}
const monthlyRows = [];
for (const k of Object.keys(grpCnt)) {
  const [div, prog] = k.split('|');
  const base = grpSum[k] / grpCnt[k], n = grpCnt[k];
  for (let m = 0; m < 12; m++) {
    const jitter = 1 + (rng() - 0.5) * 0.03;                       // ±1.5% deterministic wobble
    const avg = Math.max(0, Math.min(100, base * SEASON[m] * jitter));
    monthlyRows.push([m + 1, MONTHS[m], div, prog, n, Math.round(avg * n)]);
  }
}
write('attendance_monthly.csv', ['month_num', 'month', 'division', 'programme', 'n_students', 'sum_attendance'], monthlyRows);

// ── 3) ASSESSMENTS — keep real; add a Baseline mark for every missing student×subject ─
const tunedAssess = assessments.rows.slice();
const centerOf = new Map(students.rows.map((r) => [r[si.student_id], r[si.center_id]]));
let filledMarks = 0;
for (const sid of studentProg.keys()) {
  const prog = studentProg.get(sid), cid = centerOf.get(sid) || '';
  for (const subj of SUBJECTS) {
    if (hasMark.has(`${sid}|${subj}`)) continue;
    const pool = markPool[`${prog}|${subj}`] || markPool[`ABAL|${subj}`] || [25];
    const mark = Math.max(0, Math.min(100, Math.round(pick(pool) * 10) / 10));
    const row = [];
    row[asi.student_id] = sid; row[asi.center_id] = cid; row[asi.programme] = prog;
    row[asi.subject] = subj; row[asi.phase] = 'BL'; row[asi.mark] = mark;
    tunedAssess.push(assessments.header.map((_, i) => row[i] ?? ''));
    filledMarks++;
  }
}
write('assessments.csv', assessments.header, tunedAssess);

// ── 4) TEACHERS — copied unchanged. Division/district/centre are real values, so teacher counts
//    per division match Real mode exactly. (No gap to fill here.) ─
const teachers = load('teachers.csv');
write('teachers.csv', teachers.header, teachers.rows);

// ── 5) CENTRES — keep real M&E; add a placeholder row for every un-evaluated student-centre ─
const centers = load('centers.csv');
const ci = centers.idx;
const known = new Set(centers.rows.map((r) => r[ci.center_id]));
const divOfCentre = {};
for (const r of students.rows) divOfCentre[r[si.center_id]] ??= r[si.division];
const meScores = centers.rows.map((r) => parseFloat(r[ci.overall_score])).filter(Number.isFinite);
const tunedCenters = centers.rows.slice();
let addedCentres = 0;
for (const cid of new Set(students.rows.map((r) => r[si.center_id]))) {
  if (known.has(cid)) continue;
  const row = centers.header.map(() => '');
  row[ci.center_id] = cid;
  row[ci.center_name] = `Centre ${cid}`;
  row[ci.gps_lat] = (22 + rng() * 4).toFixed(4);
  row[ci.gps_lng] = (88 + rng() * 4).toFixed(4);
  row[ci.division] = divOfCentre[cid] || '';
  if (ci.overall_score != null) row[ci.overall_score] = (meScores.length ? pick(meScores) : 3).toFixed(4);
  tunedCenters.push(row);
  addedCentres++;
}
write('centers.csv', centers.header, tunedCenters);

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  note: 'PREVIEW dataset — every real value kept UNCHANGED; only blanks/zeros imputed from real distributions. Real metrics (poverty dropouts, mainstream rate, teacher counts) match Real mode exactly. Estimated, not measured.',
  imputed: { filledIncome, filledNutrition: filledNut, filledGrade, filledAttendance: filledAtt, filledMarks, addedCentres, monthlyAttendanceRows: monthlyRows.length },
}, null, 2));
console.log('\nImputed (blanks only):', { filledIncome, filledNut, filledGrade, filledAtt, filledMarks, addedCentres });
console.log('Done.');
