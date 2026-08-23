// ─────────────────────────────────────────────────────────────────────────────
// build-analytics-data-v2.mjs — normalise the 14-08-26 export into the SAME
// canonical tables the app already reads, so nothing downstream has to change.
//
// The new export differs from Database/ only in file layout and column NAMES:
//   • attendance is a COLUMN inside student_profiles, not a separate file
//   • "Father Income" + "Mother Income"  →  a single "Family Income"
//   • "Work Type/Occupation"             →  "Work Type" (child) + "Occupation" (household)
//   • "Education Start Date"             →  "EMDC Join Date"
//   • NO student names anywhere (removed at source — a deliberate privacy change)
// Everything else is a case-only rename, absorbed by the shared case-insensitive idx().
//
// Output: public/data-v2/ — identical column shape to public/data/, plus guardian_occupation.
//   node scripts/build-analytics-data-v2.mjs
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  unwrap, idOf, nz, isCleanId, isTestRow, incomeToTk, incomeBand, yearOf,
  subjectOf, phaseOf, makeLoad, makeWrite,
} from './lib/source-csv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.V2_SRC
  || 'C:/Users/Sajarun Sadia/Downloads/26-20260820T182248Z-1-001/Data - 14-08-26';
const OUT = path.join(ROOT, 'public', 'data-v2');

if (!fs.existsSync(SRC)) {
  console.error('Source not found: ' + SRC + '\nSet V2_SRC to the export folder and re-run.');
  process.exit(1);
}
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.csv'));
const family = (re) => files.filter((f) => re.test(f));
const progOf = (f) => (/EMDC-ABAL/i.test(f) ? 'ABAL' : /EMDC-Catchup/i.test(f) ? 'Catchup' : /EMDC-Innovation/i.test(f) ? 'Innovation' : 'Unknown');
const load = makeLoad(SRC);
const write = makeWrite(OUT);
const stats = {};

// ── STUDENTS ─────────────────────────────────────────────────────────────────
// Same output columns as v1 so the semantic layer is untouched, plus guardian_occupation.
// father_income_tk / mother_income_tk are NULL here: this export reports only a combined
// "Family Income". income_band is therefore banded HOUSEHOLD income in v2, not father income —
// recorded in the manifest caveats so answers can say which they mean.
function buildStudents() {
  const cols = ['student_id', 'center_id', 'programme', 'gender', 'division', 'district', 'upazila',
    'religion', 'ethnicity', 'nutrition', 'disability_type', 'father_income_tk', 'income_band',
    'mainstream_status', 'mainstreamed', 'mainstream_date', 'dropout_reason', 'admitted_grade',
    'education_start_date', 'enrollment_year', 'follow_up_6m',
    'work_type', 'work_duration', 'student_income_tk', 'mother_income_tk', 'household_income_tk',
    'father_education', 'mother_education', 'residency_type', 'guardian_occupation'];
  const out = []; let dropped = 0, duplicates = 0;
  const seenIds = new Set();
  for (const f of family(/^student_profiles_/i)) {
    const { idx, body } = load(f); const programme = progOf(f);
    const c = {
      sid: idx('Student ID'), cid: idx('Center ID'), gen: idx('Gender'), div: idx('Division'),
      dist: idx('District'), upa: idx('Upazila'), rel: idx('Religion'), eth: idx('Ethnicity'),
      nut: idx('Nutrition'), dis: idx('Disability Type'), finc: idx('Family Income'),
      ms: idx('Mainstream status'), msd: idx('Mainstream Date'), drop: idx('Reason for dropout'),
      grade: idx('Admitted grade'), esd: idx('EMDC Join Date'), fu: idx('Follow-up After 6 Months'),
      work: idx('Work Type'), wdur: idx('Work Duration'), sinc: idx('Student Income'),
      fedu: idx('Father education qualification'), medu: idx('Mother education qualification'),
      res: idx('Type of residency'), occ: idx('Occupation'),
    };
    for (const r of body) {
      const sid = idOf(r[c.sid]);
      if (!isCleanId(sid) || isTestRow(r.join(' '))) { dropped++; continue; }
      // This export repeats each learner ~3.55x (verified byte-identical rows; one id appears 84
      // times). Almost certainly a join fan-out upstream. Deduplicate on student_id — without this
      // every count is inflated 3.55x.
      if (seenIds.has(sid)) { duplicates++; continue; }
      seenIds.add(sid);
      out.push({
        student_id: sid, center_id: idOf(r[c.cid]), programme,
        gender: nz(r[c.gen]), division: nz(r[c.div]), district: nz(r[c.dist]), upazila: nz(r[c.upa]),
        religion: nz(r[c.rel]), ethnicity: nz(r[c.eth]), nutrition: nz(r[c.nut]),
        disability_type: nz(r[c.dis]),
        father_income_tk: null, mother_income_tk: null,
        household_income_tk: incomeToTk(r[c.finc]), income_band: incomeBand(r[c.finc]),
        mainstream_status: nz(r[c.ms]), mainstreamed: nz(r[c.ms]) === 'Mainstreamed' ? 1 : 0,
        mainstream_date: nz(r[c.msd]), dropout_reason: nz(r[c.drop]), admitted_grade: nz(r[c.grade]),
        education_start_date: nz(r[c.esd]), enrollment_year: yearOf(r[c.esd]), follow_up_6m: nz(r[c.fu]),
        work_type: nz(r[c.work]), work_duration: nz(r[c.wdur]), student_income_tk: incomeToTk(r[c.sinc]),
        father_education: nz(r[c.fedu]), mother_education: nz(r[c.medu]), residency_type: nz(r[c.res]),
        guardian_occupation: nz(r[c.occ]),
      });
    }
  }
  stats.students_dropped = dropped; stats.students_duplicate_rows = duplicates;
  write('students.csv', cols, out);
}

// ── ATTENDANCE (from the Attendance COLUMN of student_profiles) ───────────────
// One row per learner, matching v1's grain. student_name is empty: this export carries no
// student names at all, so lists show ids. Values read like "87.50 %" → 87.5.
function buildAttendance() {
  // is_estimated marks a value Preview invented. Everything here is measured, so it is always 0 —
  // the column exists in every dataset so the semantic layer can rely on it.
  const cols = ['student_id', 'student_name', 'center_id', 'attendance_pct', 'is_estimated'];
  const out = []; let dropped = 0, missing = 0;
  const seenAtt = new Set();
  for (const f of family(/^student_profiles_/i)) {
    const { idx, body } = load(f);
    const c = { sid: idx('Student ID'), cid: idx('Center ID'), att: idx('Attendance') };
    for (const r of body) {
      const sid = idOf(r[c.sid]);
      if (!isCleanId(sid) || isTestRow(r.join(' '))) { dropped++; continue; }
      if (seenAtt.has(sid)) continue;   // same 3.55x fan-out as the profiles
      seenAtt.add(sid);
      const pct = parseFloat(unwrap(r[c.att]).replace('%', '').trim());
      if (!Number.isFinite(pct)) missing++;
      out.push({
        student_id: sid, student_name: null, center_id: idOf(r[c.cid]),
        attendance_pct: Number.isFinite(pct) ? pct : null, is_estimated: 0,
      });
    }
  }
  stats.attendance_dropped = dropped; stats.attendance_missing = missing;
  write('attendance.csv', cols, out);
}

// ── ASSESSMENTS — identical 44-column shape to v1, so the same melt applies ───
function buildAssessments() {
  const cols = ['student_id', 'center_id', 'programme', 'subject', 'phase', 'mark'];
  const out = []; let dropped = 0, studentsWithMark = 0, dupMarks = 0;
  const seenMark = new Set();
  for (const f of family(/^student_assessment_/i)) {
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
        // Marks are on a 0–100 scale; data-entry errors outside it skew subject averages.
        if (mark < 0 || mark > 100) { stats.marks_out_of_range = (stats.marks_out_of_range || 0) + 1; continue; }
        const key = sid + '|' + m.subject + '|' + m.phase;
        if (seenMark.has(key)) { dupMarks++; continue; }
        seenMark.add(key);
        out.push({ student_id: sid, center_id: idOf(r[cidI]), programme, subject: m.subject, phase: m.phase, mark });
        any = true;
      }
      if (any) studentsWithMark++;
    }
  }
  stats.assessments_dropped = dropped; stats.students_with_any_mark = studentsWithMark; stats.duplicate_marks = dupMarks;
  write('assessments.csv', cols, out);
}

// ── TEACHERS (a single file in this export) ──────────────────────────────────
function buildTeachers() {
  const cols = ['center_id', 'teacher_name', 'division', 'district', 'upazila', 'gender',
    'employment_status', 'education', 'experience', 'religion', 'marital_status'];
  const out = []; let dropped = 0;
  for (const f of family(/^teacher_profiles/i)) {
    const { idx, body } = load(f);
    const c = {
      cid: idx('Center ID'), name: idx('Teacher Name'), div: idx('Division'), dist: idx('District'),
      upa: idx('Upazila'), gen: idx('Gender'), emp: idx('Employment Status'), edu: idx('Teacher Education'),
      exp: idx('Teacher Experience'), rel: idx('Religion'), mar: idx('Marital Status'),
    };
    for (const r of body) {
      if (isTestRow(r.join(' '))) { dropped++; continue; }
      // Teachers carry their own Division/District, so a missing centre link is not a reason to drop.
      const cid = idOf(r[c.cid]);
      out.push({
        center_id: isCleanId(cid) ? cid : null, teacher_name: nz(r[c.name]), division: nz(r[c.div]),
        district: nz(r[c.dist]), upazila: nz(r[c.upa]), gender: nz(r[c.gen]),
        employment_status: nz(r[c.emp]), education: nz(r[c.edu]), experience: nz(r[c.exp]),
        religion: nz(r[c.rel]), marital_status: nz(r[c.mar]),
      });
    }
  }
  stats.teachers_dropped = dropped;
  write('teachers.csv', cols, out);
}

// ── CENTERS (from centre monitoring; one row per center_id) ──────────────────
function buildCenters() {
  const cols = ['center_id', 'center_name', 'gps_lat', 'gps_lng', 'program', 'sub_program',
    'division', 'district', 'upazila', 'pedagogy', 'assessments', 'documentation',
    'learning_environment', 'engagement', 'overall_score'];
  const seen = new Map(); let dropped = 0;
  for (const f of family(/^center_monitoring_/i)) {
    const { idx, body } = load(f);
    const c = {
      cid: idx('Center ID'), name: idx('Center Name'), lat: idx('GPS Latitude'), lng: idx('GPS Longitude'),
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

console.log('Building v2 analytics tables → public/data-v2/\n  source: ' + SRC);
buildStudents();
buildAttendance();
buildAssessments();
buildTeachers();
buildCenters();
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  source: '14-08-26 export',
  note: 'Canonical shape identical to public/data/. NO student names in this export (removed at source).',
  caveats: [
    'income_band here is banded HOUSEHOLD income (Family Income); father/mother income are not reported separately.',
    'Mainstream status and Reason for dropout overlap heavily — the active/dropout split needs a client definition before it is reported.',
  ],
  tables: ['students', 'attendance', 'assessments', 'teachers', 'centers'], stats,
}, null, 2));
console.log('Drop/quality stats:', stats);
console.log('Done.');
