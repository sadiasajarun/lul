// ─────────────────────────────────────────────────────────────────────────────
// build-analytics-data.mjs — clean the REAL NFPE CSVs into query-ready tables.
//
// Reads Database/*.csv (the raw per-programme exports), cleans/normalises them,
// and writes tidy CSVs into public/data/ for the in-browser DuckDB-wasm engine.
//
// Local & private build: names/PII are KEPT (owner runs this locally). When we
// later swap to a backend, only the *loader target* changes — the cleaning stays.
//
//   node scripts/build-analytics-data.mjs
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'Database');
const OUT = path.join(ROOT, 'public', 'data');

// ── tiny quote-aware CSV parser (handles "…" and Excel ="…") ──────────────────
function parseCsv(text) {
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
const bnToAscii = (s) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
const unwrap = (s) => bnToAscii((s ?? '').replace(/^="?/, '').replace(/"$/, '').trim());
// An ID is its DIGIT SEQUENCE. The source formats real IDs with embedded spaces
// ("26301 619 5315" → Mabiya) or a stray decimal ("26361238.7305", an Excel artifact), so strip
// every non-digit for ID fields ONLY — never names. Genuine text/blank IDs collapse to '' and are
// still dropped by isCleanId; too-short numeric IDs still fail the >=3-digit gate. Bengali numerals
// were already converted to ASCII by unwrap() above. Use idOf() for every student_id/center_id read.
const idOf = (s) => unwrap(s).replace(/\D/g, '');
const files = fs.readdirSync(DB).filter((f) => f.endsWith('.csv'));
const family = (re) => files.filter((f) => re.test(f));
const progOf = (f) => (/_abal_/i.test(f) ? 'ABAL' : /_catchup_/i.test(f) ? 'Catchup' : /_innovation_/i.test(f) ? 'Innovation' : 'Unknown');

function load(file) {
  const rows = parseCsv(fs.readFileSync(path.join(DB, file), 'utf8'));
  const header = rows[0].map(unwrap);
  const idx = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const body = rows.slice(1).filter((r) => r.some((c) => c && c.trim()));
  return { header, idx, body };
}

// ── normalisers ──────────────────────────────────────────────────────────────
const nz = (v) => { const s = unwrap(v); return s === '' || s === '-' || s.toLowerCase() === 'not applicable' ? null : s; };
const isCleanId = (id) => /^[0-9]{3,}$/.test(id);
const isTestRow = (line) => /\btest\b|lorem|ipsum|faker|dolor|\bipsa\b/i.test(line);
function incomeToTk(raw) {                       // "8000 TK" → 8000 ; "Avobe 15000 TK" → 15000 ; "-" → null
  const s = unwrap(raw); if (!s || s === '-') return null;
  const m = s.match(/(\d[\d,]*)/); return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
}
function incomeBand(raw) {
  const tk = incomeToTk(raw); if (tk == null) return null;
  if (/avobe|above/i.test(unwrap(raw))) return '15000+';
  if (tk < 5000) return '<5000';
  if (tk < 10000) return '5000-9999';
  if (tk < 15000) return '10000-14999';
  return '15000+';
}
const yearOf = (raw) => { const s = unwrap(raw); const m = s.match(/\b(19|20)\d{2}\b/); return m ? parseInt(m[0], 10) : null; };

// ── CSV writer (RFC-4180 quoting) ────────────────────────────────────────────
function toCsv(cols, records) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.join(',')];
  for (const rec of records) lines.push(cols.map((c) => esc(rec[c])).join(','));
  return lines.join('\n') + '\n';
}
function write(name, cols, records) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), toCsv(cols, records));
  console.log(`  ✓ ${name.padEnd(22)} ${records.length.toLocaleString()} rows`);
}

const stats = {};

// ── STUDENTS ─────────────────────────────────────────────────────────────────
function buildStudents() {
  const cols = ['student_id', 'center_id', 'programme', 'gender', 'division', 'district', 'upazila',
    'religion', 'ethnicity', 'nutrition', 'disability_type', 'father_income_tk', 'income_band',
    'mainstream_status', 'mainstreamed', 'mainstream_date', 'dropout_reason', 'admitted_grade',
    'education_start_date', 'enrollment_year', 'follow_up_6m'];
  const out = []; let dropped = 0;
  for (const f of family(/^student_profiles_/)) {
    const { idx, body } = load(f); const programme = progOf(f);
    const c = {
      sid: idx('Student ID'), cid: idx('Center ID'), gen: idx('Gender'), div: idx('Division'),
      dist: idx('District'), upa: idx('Upazila'), rel: idx('Religion'), eth: idx('Ethnicity'),
      nut: idx('Nutrition'), dis: idx('Disability Type'), finc: idx('Father Income'),
      ms: idx('Mainstream Status'), msd: idx('Mainstream Date'), drop: idx('Reason for Dropout'),
      grade: idx('Admitted Grade'), esd: idx('Education Start Date'), fu: idx('Follow-up After 6 Months'),
    };
    for (const r of body) {
      const sid = idOf(r[c.sid]);
      if (!isCleanId(sid) || isTestRow(r.join(' '))) { dropped++; continue; }
      out.push({
        student_id: sid, center_id: idOf(r[c.cid]), programme,
        gender: nz(r[c.gen]), division: nz(r[c.div]), district: nz(r[c.dist]), upazila: nz(r[c.upa]),
        religion: nz(r[c.rel]), ethnicity: nz(r[c.eth]), nutrition: nz(r[c.nut]),
        disability_type: nz(r[c.dis]), father_income_tk: incomeToTk(r[c.finc]), income_band: incomeBand(r[c.finc]),
        mainstream_status: nz(r[c.ms]), mainstreamed: nz(r[c.ms]) === 'Mainstreamed' ? 1 : 0,
        mainstream_date: nz(r[c.msd]), dropout_reason: nz(r[c.drop]), admitted_grade: nz(r[c.grade]),
        education_start_date: nz(r[c.esd]), enrollment_year: yearOf(r[c.esd]), follow_up_6m: nz(r[c.fu]),
      });
    }
  }
  stats.students_dropped = dropped;
  write('students.csv', cols, out);
}

// ── ATTENDANCE ───────────────────────────────────────────────────────────────
function buildAttendance() {
  const cols = ['student_id', 'student_name', 'center_id', 'attendance_pct'];
  const out = []; let dropped = 0;
  for (const f of family(/^Student_attendance_/i)) {
    const { idx, body } = load(f);
    const c = { sid: idx('Student ID'), name: idx('Student Name'), cid: idx('Center ID'), pct: idx('Attendance(In Percent)') };
    for (const r of body) {
      const sid = idOf(r[c.sid]);
      if (!isCleanId(sid) || isTestRow(r.join(' '))) { dropped++; continue; }
      const pct = parseFloat(unwrap(r[c.pct]));
      out.push({ student_id: sid, student_name: nz(r[c.name]), center_id: idOf(r[c.cid]), attendance_pct: Number.isFinite(pct) ? pct : null });
    }
  }
  stats.attendance_dropped = dropped;
  write('attendance.csv', cols, out);
}

// ── ASSESSMENTS (melted to long: one row per student×subject×phase with a mark) ─
function subjectOf(h) {
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
function phaseOf(h) { const m = h.match(/\b(BL|C[1-5])\b/i); return m ? m[1].toUpperCase() : null; }
function buildAssessments() {
  const cols = ['student_id', 'center_id', 'programme', 'subject', 'phase', 'mark'];
  const out = []; let dropped = 0, studentsWithMark = 0;
  for (const f of family(/^student_assessment_/)) {
    const { header, idx, body } = load(f); const programme = progOf(f);
    const sidI = idx('Student ID'), cidI = idx('Center ID');
    const markCols = header.map((h, i) => ({ i, subject: subjectOf(h), phase: phaseOf(h) }))
      .filter((m) => m.i > 1 && m.subject && m.phase);
    for (const r of body) {
      const sid = idOf(r[sidI]);
      if (!isCleanId(sid) || isTestRow(r.join(' '))) { dropped++; continue; }
      let any = false;
      for (const m of markCols) {
        const v = unwrap(r[m.i]);
        if (!/^[0-9]+(\.[0-9]+)?$/.test(v)) continue;
        const mark = parseFloat(v);
        // Marks are on a 0–100 scale (p99≈74). A handful of rows carry data-entry errors
        // (e.g. 3438) that badly skew subject averages — drop anything out of range.
        if (mark < 0 || mark > 100) { stats.marks_out_of_range = (stats.marks_out_of_range || 0) + 1; continue; }
        out.push({ student_id: sid, center_id: idOf(r[cidI]), programme, subject: m.subject, phase: m.phase, mark });
        any = true;
      }
      if (any) studentsWithMark++;
    }
  }
  stats.assessments_dropped = dropped; stats.students_with_any_mark = studentsWithMark;
  write('assessments.csv', cols, out);
}

// ── TEACHERS ─────────────────────────────────────────────────────────────────
function buildTeachers() {
  const cols = ['center_id', 'teacher_name', 'division', 'district', 'upazila', 'gender',
    'employment_status', 'education', 'experience', 'religion', 'marital_status'];
  const out = []; let dropped = 0;
  for (const f of family(/^teacher_profiles_/)) {
    const { idx, body } = load(f);
    const c = {
      cid: idx('Center ID'), name: idx('Teacher Name'), div: idx('Division'), dist: idx('District'),
      upa: idx('Upazila'), gen: idx('Gender'), emp: idx('Employment Status'), edu: idx('Teacher Education'),
      exp: idx('Teacher Experience'), rel: idx('Religion'), mar: idx('Marital Status'),
    };
    for (const r of body) {
      if (isTestRow(r.join(' '))) { dropped++; continue; }
      // Teachers carry their own Division/District, so a missing centre link ("-")
      // is NOT a reason to drop a real teacher — keep the row with a null center_id.
      const cid = idOf(r[c.cid]);
      out.push({
        center_id: isCleanId(cid) ? cid : null, teacher_name: nz(r[c.name]), division: nz(r[c.div]), district: nz(r[c.dist]),
        upazila: nz(r[c.upa]), gender: nz(r[c.gen]), employment_status: nz(r[c.emp]),
        education: nz(r[c.edu]), experience: nz(r[c.exp]), religion: nz(r[c.rel]), marital_status: nz(r[c.mar]),
      });
    }
  }
  stats.teachers_dropped = dropped;
  write('teachers.csv', cols, out);
}

// ── CENTERS (from M&E evaluations; one row per center_id) ─────────────────────
function buildCenters() {
  const cols = ['center_id', 'center_name', 'gps_lat', 'gps_lng', 'program', 'sub_program',
    'division', 'district', 'upazila', 'pedagogy', 'assessments', 'documentation',
    'learning_environment', 'engagement', 'overall_score'];
  const seen = new Map(); let dropped = 0;
  for (const f of family(/^me_evaluation_/)) {
    const { idx, body } = load(f);
    const c = {
      cid: idx('Center ID'), name: idx('Center Name'), lat: idx('GPS latitude'), lng: idx('GPS longitude'),
      prog: idx('Program'), sub: idx('Sub Program'), div: idx('Division'), dist: idx('District'), upa: idx('Upazila'),
      ped: idx('Pedagogy'), ass: idx('Assessments'), doc: idx('Documentation'),
      env: idx('Learning Environment'), eng: idx('Community & Family Engagement'),
    };
    for (const r of body) {
      const cid = idOf(r[c.cid]);
      if (!isCleanId(cid) || isTestRow((unwrap(r[c.name]) + ' ' + r.slice(0, 3).join(' ')))) { dropped++; continue; }
      if (seen.has(cid)) continue;
      const num = (i) => { const v = parseFloat(unwrap(r[i])); return Number.isFinite(v) ? v : null; };
      const ped = num(c.ped), ass = num(c.ass), doc = num(c.doc), env = num(c.env), eng = num(c.eng);
      const parts = [ped, ass, doc, env, eng].filter((x) => x != null);
      seen.set(cid, {
        center_id: cid, center_name: nz(r[c.name]), gps_lat: num(c.lat), gps_lng: num(c.lng),
        program: nz(r[c.prog]), sub_program: nz(r[c.sub]), division: nz(r[c.div]), district: nz(r[c.dist]),
        upazila: nz(r[c.upa]), pedagogy: ped, assessments: ass, documentation: doc,
        learning_environment: env, engagement: eng,
        overall_score: parts.length ? +(parts.reduce((a, b) => a + b, 0) / parts.length).toFixed(4) : null,
      });
    }
  }
  stats.centers_dropped = dropped;
  write('centers.csv', cols, [...seen.values()]);
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log('Building analytics tables → public/data/');
buildStudents();
buildAttendance();
buildAssessments();
buildTeachers();
buildCenters();
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  built_at_note: 'run npm run build:data to refresh', tables: ['students', 'attendance', 'assessments', 'teachers', 'centers'], stats,
}, null, 2));
console.log('Drop/quality stats:', stats);
console.log('Done.');
