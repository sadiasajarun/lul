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

// Cleaning helpers are shared with the v2 pipeline so both exports normalise identically.
import {
  unwrap, idOf, nz, isCleanId, isTestRow, incomeToTk, incomeBand, yearOf,
  subjectOf, phaseOf, makeLoad, makeWrite,
} from './lib/source-csv.mjs';

const files = fs.readdirSync(DB).filter((f) => f.endsWith('.csv'));
const family = (re) => files.filter((f) => re.test(f));
const progOf = (f) => (/_abal_/i.test(f) ? 'ABAL' : /_catchup_/i.test(f) ? 'Catchup' : /_innovation_/i.test(f) ? 'Innovation' : 'Unknown');
const load = makeLoad(DB);
const write = makeWrite(OUT);

const stats = {};

// ── STUDENTS ─────────────────────────────────────────────────────────────────
function buildStudents() {
  // work_type / work_duration / student & mother income / parental education / residency come from
  // the source profiles and were previously discarded. They are the strongest NON-circular signals
  // available for explaining absence, so the reasoning layer needs them.
  const cols = ['student_id', 'center_id', 'programme', 'gender', 'division', 'district', 'upazila',
    'religion', 'ethnicity', 'nutrition', 'disability_type', 'father_income_tk', 'income_band',
    'mainstream_status', 'mainstreamed', 'mainstream_date', 'dropout_reason', 'admitted_grade',
    'education_start_date', 'enrollment_year', 'follow_up_6m',
    'work_type', 'work_duration', 'student_income_tk', 'mother_income_tk', 'household_income_tk',
    'father_education', 'mother_education', 'residency_type', 'guardian_occupation'];
  const out = []; let dropped = 0, duplicates = 0;
  const seenIds = new Set();
  for (const f of family(/^student_profiles_/)) {
    const { idx, body } = load(f); const programme = progOf(f);
    const c = {
      sid: idx('Student ID'), cid: idx('Center ID'), gen: idx('Gender'), div: idx('Division'),
      dist: idx('District'), upa: idx('Upazila'), rel: idx('Religion'), eth: idx('Ethnicity'),
      nut: idx('Nutrition'), dis: idx('Disability Type'), finc: idx('Father Income'),
      ms: idx('Mainstream Status'), msd: idx('Mainstream Date'), drop: idx('Reason for Dropout'),
      grade: idx('Admitted Grade'), esd: idx('Education Start Date'), fu: idx('Follow-up After 6 Months'),
      work: idx('Work Type/Occupation'), wdur: idx('Work Duration'), sinc: idx('Student Income'),
      minc: idx('Mother Income'), fedu: idx('Father Education'), medu: idx('Mother Education'),
      res: idx('Type of Residency'),
    };
    for (const r of body) {
      const sid = idOf(r[c.sid]);
      if (!isCleanId(sid) || isTestRow(r.join(' '))) { dropped++; continue; }
      // A few learners appear twice in this export; counting them twice inflates every total.
      // Keep the first occurrence, as the v2 pipeline does.
      if (seenIds.has(sid)) { duplicates++; continue; }
      seenIds.add(sid);
      out.push({
        student_id: sid, center_id: idOf(r[c.cid]), programme,
        gender: nz(r[c.gen]), division: nz(r[c.div]), district: nz(r[c.dist]), upazila: nz(r[c.upa]),
        religion: nz(r[c.rel]), ethnicity: nz(r[c.eth]), nutrition: nz(r[c.nut]),
        disability_type: nz(r[c.dis]), father_income_tk: incomeToTk(r[c.finc]), income_band: incomeBand(r[c.finc]),
        mainstream_status: nz(r[c.ms]), mainstreamed: nz(r[c.ms]) === 'Mainstreamed' ? 1 : 0,
        mainstream_date: nz(r[c.msd]), dropout_reason: nz(r[c.drop]), admitted_grade: nz(r[c.grade]),
        education_start_date: nz(r[c.esd]), enrollment_year: yearOf(r[c.esd]), follow_up_6m: nz(r[c.fu]),
        work_type: nz(r[c.work]), work_duration: nz(r[c.wdur]),
        student_income_tk: incomeToTk(r[c.sinc]), mother_income_tk: incomeToTk(r[c.minc]),
        // Household income = father + mother where either is recorded (null only when both are blank).
        household_income_tk: (() => {
          const f = incomeToTk(r[c.finc]), m = incomeToTk(r[c.minc]);
          return f == null && m == null ? null : (f ?? 0) + (m ?? 0);
        })(),
        father_education: nz(r[c.fedu]), mother_education: nz(r[c.medu]), residency_type: nz(r[c.res]),
        // Not collected in this export — present so v1 and v2 share one column shape.
        guardian_occupation: null,
      });
    }
  }
  stats.students_dropped = dropped; stats.students_duplicate_rows = duplicates;
  write('students.csv', cols, out);
}

// ── ATTENDANCE ───────────────────────────────────────────────────────────────
function buildAttendance() {
  // is_estimated marks a value Preview invented. Everything here is measured, so it is always 0 —
  // the column exists in every dataset so the semantic layer can rely on it.
  const cols = ['student_id', 'student_name', 'center_id', 'attendance_pct', 'is_estimated'];
  const out = []; let dropped = 0;
  for (const f of family(/^Student_attendance_/i)) {
    const { idx, body } = load(f);
    const c = { sid: idx('Student ID'), name: idx('Student Name'), cid: idx('Center ID'), pct: idx('Attendance(In Percent)') };
    for (const r of body) {
      const sid = idOf(r[c.sid]);
      if (!isCleanId(sid) || isTestRow(r.join(' '))) { dropped++; continue; }
      const pct = parseFloat(unwrap(r[c.pct]));
      out.push({ student_id: sid, student_name: nz(r[c.name]), center_id: idOf(r[c.cid]), attendance_pct: Number.isFinite(pct) ? pct : null, is_estimated: 0 });
    }
  }
  stats.attendance_dropped = dropped;
  write('attendance.csv', cols, out);
}

// ── ASSESSMENTS (melted to long: one row per student×subject×phase with a mark) ─
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
