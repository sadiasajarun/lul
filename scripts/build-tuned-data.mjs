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

// ── VERIFIED OVERLAY (public/data-v2) ────────────────────────────────────────
// The 14-08-26 export re-measured many of the SAME learners (99.9% id overlap). Wherever it holds a
// real value, Preview uses THAT instead of inventing one. Every replacement turns a guess into a
// measurement, so the demo dataset gets steadily more honest as better exports arrive.
// Absent? Preview still builds exactly as before.
const V2 = path.join(ROOT, 'public', 'data-v2');
const haveV2 = fs.existsSync(path.join(V2, 'students.csv'));
function loadFrom(dir, name) {
  const rows = parseCsv(fs.readFileSync(path.join(dir, name), 'utf8'));
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return { header, idx, rows: rows.slice(1).filter((r) => r.some((c) => c && c.trim())) };
}
const verified = { att: new Map(), stu: new Map(), cen: new Map(), teacherCentre: new Map() };
if (haveV2) {
  const va = loadFrom(V2, 'attendance.csv');
  for (const r of va.rows) {
    const pct = parseFloat(r[va.idx.attendance_pct]);
    if (Number.isFinite(pct) && pct > 0) verified.att.set(r[va.idx.student_id], pct);
  }
  const vs = loadFrom(V2, 'students.csv');
  for (const r of vs.rows) verified.stu.set(r[vs.idx.student_id], { row: r, idx: vs.idx });
  const vc = loadFrom(V2, 'centers.csv');
  for (const r of vc.rows) if (nz(r[vc.idx.overall_score])) verified.cen.set(r[vc.idx.center_id], { row: r, idx: vc.idx });
  const vt = loadFrom(V2, 'teachers.csv');
  for (const r of vt.rows) {
    const cid = (r[vt.idx.center_id] ?? '').trim();
    const nm = (r[vt.idx.teacher_name] ?? '').trim().toLowerCase();
    if (cid && nm) verified.teacherCentre.set(nm, cid);
  }
  console.log(`  verified overlay: ${verified.att.size.toLocaleString()} attendance, ${verified.stu.size.toLocaleString()} students, ${verified.cen.size.toLocaleString()} centres, ${verified.teacherCentre.size.toLocaleString()} teachers`);
} else {
  console.log('  (no public/data-v2 — building from real data only)');
}
const vField = (sid, field) => {
  const v = verified.stu.get(sid);
  if (!v || v.idx[field] == null) return null;
  return nz(v.row[v.idx[field]]);
};
const prov = { attReal: 0, attGuessed: 0, centreReal: 0, centreGuessed: 0, fieldsVerified: 0 };

// ── real distributions (to sample imputations from) ──────────────────────────
const students = load('students.csv');
const si = students.idx;
const studentProg = new Map(), studentDiv = new Map(), centerOfAll = new Map();
const incomePool = [], nutritionPool = [], gradePool = [];
const divisionCount = {};
for (const r of students.rows) {
  studentProg.set(r[si.student_id], r[si.programme]);
  studentDiv.set(r[si.student_id], r[si.division]);
  centerOfAll.set(r[si.student_id], r[si.center_id]);
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
  const sid = row[si.student_id];
  // Copy across anything the newer export actually measured for THIS learner before falling back to
  // a sampled value. guardian_occupation exists only there, so it is a pure addition.
  for (const f of ['household_income_tk', 'mother_education', 'father_education', 'work_type',
                   'work_duration', 'residency_type', 'nutrition', 'guardian_occupation']) {
    if (si[f] == null || nz(row[si[f]])) continue;
    const v = vField(sid, f);
    if (v != null) { row[si[f]] = v; prov.fieldsVerified++; }
  }
  if (!nz(row[si.father_income_tk]) && incomePool.length) { const [tk, band] = pick(incomePool); row[si.father_income_tk] = tk; row[si.income_band] = band; filledIncome++; }
  if (!nz(row[si.nutrition]) && nutritionPool.length) { row[si.nutrition] = pick(nutritionPool); filledNut++; }
  if (!nz(row[si.admitted_grade]) && gradePool.length) { row[si.admitted_grade] = pick(gradePool); filledGrade++; }
  return row;
});
// (students.csv is written after the ghost cohort is appended, below.)

// ── 2) ATTENDANCE — fill every 0/blank with a sampled real recorded value ─────
let filledAtt = 0;
const estIdx = ai.is_estimated;
const tunedAtt = attendance.rows.map((r) => {
  const row = r.slice();
  const sid = row[ai.student_id];
  const v = parseFloat(row[ai.attendance_pct]);
  if (Number.isFinite(v) && v > 0) { row[estIdx] = 0; return row; }   // already measured in Real
  const real = verified.att.get(sid);
  if (real != null) {                                                  // measured in the newer export
    row[ai.attendance_pct] = real;
    row[estIdx] = 0;
    prov.attReal++;
    return row;
  }
  const pool = attPoolByProg[studentProg.get(sid)] || attPoolAll;      // otherwise estimate, and say so
  row[ai.attendance_pct] = pool.length ? Math.round(pick(pool) * 10) / 10 : 85;
  row[estIdx] = 1;
  prov.attGuessed++;
  filledAtt++;
  return row;
});
// ── 2a) GHOST STUDENTS (Preview only) — a small, clearly-labelled cohort of DUMMY learners that are
//    genuinely inactive, so the "ghost / inactive student" rule has something to find. Every other
//    Preview student is gap-filled (attendance + a baseline mark for every subject), which by
//    construction leaves ZERO real ghosts. These carry: an attendance row of 0 (= never recorded),
//    NO assessment rows at all, and a long gap in attendance_gaps.csv. Ids start at 99… so they are
//    trivially separable from real children, and names are synthetic. ─
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GHOST_COUNT = 150;
const GHOST_FIRST = ['Rifat', 'Sumi', 'Jahid', 'Nusrat', 'Rakib', 'Mitu', 'Sabbir', 'Tania', 'Arif', 'Poly', 'Hasan', 'Roksana'];
const GHOST_LAST = ['Hossain', 'Akter', 'Islam', 'Khatun', 'Miah', 'Begum', 'Ali', 'Sultana', 'Rahman', 'Parvin'];
const existingIds = new Set(students.rows.map((r) => r[si.student_id]));
// Spread the ghosts over real centres so every join (centre, division, programme) resolves.
const centreSeeds = [];
{
  const seen = new Set();
  for (const r of students.rows) {
    const cid = r[si.center_id];
    if (seen.has(cid)) continue;
    seen.add(cid);
    centreSeeds.push({ center_id: cid, division: r[si.division], district: r[si.district], upazila: r[si.upazila], programme: r[si.programme] });
  }
}
const ghostStudentRows = [], ghostAttRows = [], ghostIds = [];
for (let g = 0; g < GHOST_COUNT; g++) {
  let id = String(9900000000001 + g);
  while (existingIds.has(id)) id = String(Number(id) + 1);
  existingIds.add(id);
  ghostIds.push(id);
  const c = centreSeeds[(rng() * centreSeeds.length) | 0];
  const row = students.header.map(() => '');
  row[si.student_id] = id;
  row[si.center_id] = c.center_id;
  row[si.programme] = c.programme;
  row[si.gender] = rng() < 0.5 ? 'Girl' : 'Boy';
  row[si.division] = c.division; row[si.district] = c.district; row[si.upazila] = c.upazila;
  row[si.religion] = 'Islam';
  row[si.nutrition] = pick(nutritionPool.length ? nutritionPool : ['Good']);
  const [tk, band] = incomePool.length ? pick(incomePool) : ['4000', '<5000'];
  row[si.father_income_tk] = tk; row[si.income_band] = band;
  row[si.mainstream_status] = 'Running';
  row[si.mainstreamed] = '0';          // not mainstreamed …
  row[si.dropout_reason] = '';         // … and not dropped out → is_active = true
  row[si.admitted_grade] = pick(gradePool.length ? gradePool : ['G1']);
  row[si.enrollment_year] = String(2022 + ((rng() * 3) | 0));
  row[si.follow_up_6m] = 'Irregular';
  ghostStudentRows.push(row);
  // Attendance row: 0 = NOT RECORDED (the semantic layer's convention) → recorded_months = 0.
  const arow = attendance.header.map(() => '');
  arow[ai.student_id] = id;
  arow[ai.student_name] = `${pick(GHOST_FIRST)} ${pick(GHOST_LAST)}`;
  arow[ai.center_id] = c.center_id;
  arow[ai.attendance_pct] = '0';
  ghostAttRows.push(arow);
}
tunedStudents.push(...ghostStudentRows);
tunedAtt.push(...ghostAttRows);
// students.csv is written above WITHOUT the ghosts, so rewrite it now that they exist.
write('students.csv', students.header, tunedStudents);
write('attendance.csv', attendance.header, tunedAtt);

// ── 2c) ATTENDANCE GAPS (Preview only) — the RECENCY dimension the source data lacks entirely
//    (attendance.csv holds one lifetime % per learner, with no dates). Only students WITH a gap are
//    written; anyone absent from this file is treated as currently attending (gap = 0). A learner
//    with no attendance for >= 14 days AND no assessments is a GHOST. Gap likelihood is driven by
//    the learner's own attendance %, so the flagged tail is the genuinely weak-attendance tail. ─
const gapRows = [];
const ghostIdSet = new Set(ghostIds);
for (const r of tunedAtt) {
  const sid = r[ai.student_id];
  if (ghostIdSet.has(sid)) continue;                // ghosts handled below with long gaps
  const pct = parseFloat(r[ai.attendance_pct]);
  if (!Number.isFinite(pct)) continue;
  // Weak attenders are far likelier to be mid-absence right now.
  const pGap = pct < 50 ? 0.34 : pct < 65 ? 0.18 : pct < 80 ? 0.06 : 0.012;
  if (rng() >= pGap) continue;
  const days = 3 + ((rng() * 40) | 0);              // 3–42 days; >= 14 trips the two-week rule
  const lastMonth = MONTHS[Math.max(0, 11 - Math.floor(days / 30))];
  gapRows.push([sid, lastMonth, days, Math.round(Math.max(0, pct - days) * 10) / 10]);
}
for (const id of ghostIds) gapRows.push([id, '', 30 + ((rng() * 90) | 0), 0]);
write('attendance_gaps.csv', ['student_id', 'last_attended_month', 'days_since_last_attendance', 'recent_attendance_pct'], gapRows);

// ── 2b) MONTHLY ATTENDANCE (Preview only) — the source keeps just ONE aggregate % per student, so a
//    month-by-month trend does not exist in real data. For Preview we synthesise a 12-month series by
//    spreading each division×programme's real mean over a seasonal curve (monsoon dip Jun–Sep).
//    Grain: division × programme × month, storing n + sum so any weighted average is exact.
//    Each group also gets its OWN linear TREND (%-points/month) centred on the mid-year, so the
//    annual mean still equals the real mean while the series genuinely rises or falls — without a
//    trend there is nothing for a forecast to extrapolate (every centre came out "stable"). ─
const SEASON = [1.03, 1.03, 1.02, 1.00, 0.99, 0.96, 0.94, 0.95, 0.97, 1.00, 1.03, 1.05]; // mean ≈ 1.0
const MID = 5.5; // centring the trend on the mid-year preserves the annual mean
/** A deterministic trend for one series: ~22% declining, ~22% improving, the rest broadly flat. */
function trendSlope() {
  const kind = weightedPick([['declining', 22], ['improving', 22], ['stable', 56]]);
  if (kind === 'declining') return -(0.45 + rng() * 1.25);   // −0.45 … −1.70 pts/month
  if (kind === 'improving') return 0.45 + rng() * 1.25;
  return (rng() - 0.5) * 0.3;                                 // −0.15 … +0.15 → "stable"
}
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
  const base = grpSum[k] / grpCnt[k], n = grpCnt[k], slope = trendSlope();
  for (let m = 0; m < 12; m++) {
    const jitter = 1 + (rng() - 0.5) * 0.03;                       // ±1.5% deterministic wobble
    const avg = Math.max(0, Math.min(100, (base + slope * (m - MID)) * SEASON[m] * jitter));
    monthlyRows.push([m + 1, MONTHS[m], div, prog, n, Math.round(avg * n)]);
  }
}
write('attendance_monthly.csv', ['month_num', 'month', 'division', 'programme', 'n_students', 'sum_attendance'], monthlyRows);

// ── 2d) PER-CENTRE MONTHLY ATTENDANCE (Preview only) — the series a per-centre FORECAST needs.
//    Division×programme monthly cannot forecast a centre: every centre in a division would inherit
//    one identical trend. Here each centre carries its OWN slope, so "which centres are declining /
//    likely worst next month" is answered by regressing that centre's own recent months. ─
const centreAgg = {};
for (const r of tunedAtt) {
  const sid = r[ai.student_id];
  const cid = centerOfAll.get(sid);
  if (!cid) continue;
  const v = parseFloat(r[ai.attendance_pct]);
  if (!Number.isFinite(v)) continue;
  const a = (centreAgg[cid] ??= { sum: 0, n: 0 });
  a.sum += v; a.n += 1;
}
const centreMonthlyRows = [];
for (const cid of Object.keys(centreAgg)) {
  const { sum, n } = centreAgg[cid];
  if (!n) continue;
  const base = sum / n, slope = trendSlope();
  for (let m = 0; m < 12; m++) {
    const jitter = 1 + (rng() - 0.5) * 0.04;
    const avg = Math.max(0, Math.min(100, (base + slope * (m - MID)) * SEASON[m] * jitter));
    centreMonthlyRows.push([cid, m + 1, MONTHS[m], n, Math.round(avg * n)]);
  }
}
write('attendance_center_monthly.csv', ['center_id', 'month_num', 'month', 'n_students', 'sum_attendance'], centreMonthlyRows);

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
const ti = teachers.idx;
let teacherLinks = 0;
const tunedTeachers = teachers.rows.map((r) => {
  const row = r.slice();
  if (!nz(row[ti.center_id])) {
    // Every teacher in the newer export carries a centre; the older one links only ~66%.
    const cid = verified.teacherCentre.get((row[ti.teacher_name] ?? '').trim().toLowerCase());
    if (cid) { row[ti.center_id] = cid; teacherLinks++; }
  }
  return row;
});
write('teachers.csv', teachers.header, tunedTeachers);

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
  const v = verified.cen.get(cid);
  if (v) {
    // Measured in the newer export — copy the whole M&E block instead of inventing a score.
    for (const f of ['center_name', 'pedagogy', 'assessments', 'documentation', 'learning_environment', 'engagement', 'overall_score']) {
      if (ci[f] != null && v.idx[f] != null && nz(v.row[v.idx[f]])) row[ci[f]] = v.row[v.idx[f]];
    }
    prov.centreReal++;
  } else if (ci.overall_score != null) {
    row[ci.overall_score] = (meScores.length ? pick(meScores) : 3).toFixed(4);
    prov.centreGuessed++;
  }
  tunedCenters.push(row);
  addedCentres++;
}
write('centers.csv', centers.header, tunedCenters);

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  note: 'PREVIEW dataset — every real value kept UNCHANGED; only blanks/zeros imputed from real distributions. Real metrics (poverty dropouts, mainstream rate, teacher counts) match Real mode exactly. Estimated, not measured.',
  imputed: { filledIncome, filledNutrition: filledNut, filledGrade, filledAttendance: filledAtt, filledMarks, addedCentres, monthlyAttendanceRows: monthlyRows.length },
  provenance: {
    note: 'Preview prefers a MEASURED value from public/data-v2 over an invented one. These counts say how much of this dataset is real.',
    attendance_from_verified_export: prov.attReal,
    attendance_still_estimated: prov.attGuessed,
    student_fields_from_verified_export: prov.fieldsVerified,
    centres_scored_from_verified_export: prov.centreReal,
    centres_score_still_invented: prov.centreGuessed,
    teacher_centre_links_recovered: teacherLinks,
  },
  synthetic: {
    ghostStudents: GHOST_COUNT,
    ghostIdPrefix: '99…  (DUMMY learners — deliberately inactive so the ghost/inactive rule has something to find; NOT real children)',
    attendanceGapRows: gapRows.length,
    centreMonthlyRows: centreMonthlyRows.length,
  },
}, null, 2));
console.log('\nImputed (blanks only):', { filledIncome, filledNut, filledGrade, filledAtt, filledMarks, addedCentres });
console.log('Provenance (measured vs invented):', prov, '| teacher links recovered:', teacherLinks);
console.log('Synthetic (Preview demo):', { ghostStudents: GHOST_COUNT, attendanceGaps: gapRows.length, centreMonthly: centreMonthlyRows.length });
console.log('Done.');
