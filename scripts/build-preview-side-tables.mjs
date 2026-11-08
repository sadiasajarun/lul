// Builds the extra simulated tables Preview needs for questions no dataset can otherwise answer:
// visits, observations, cash transfers, teacher attendance, dated dropouts, cycle and unit marks,
// monthly student attendance, and PPE records.
//
// It reads public/data-tuned and only ever writes new side_* files, so no existing row can change.
// Every row is seeded from its own key, so a re-run produces identical files.
//
//   npm run build:data:side
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import duckdb from 'duckdb';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'public', 'data-tuned');
const src = (t) => path.join(DIR, `${t}.csv`).replace(/\\/g, '/');

const db = new duckdb.Database(':memory:');
const q = (s) => new Promise((res, rej) => db.all(s, (e, r) => (e ? rej(e) : res(r))));

// ── Seeded randomness: one independent stream per row key ────────────────────────────────────────
function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngFor(key) {
  let a = seedOf(key);
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, lo, hi) => lo + r() * (hi - lo);
const int = (r, lo, hi) => Math.floor(between(r, lo, hi + 1));
const noise = (r) => r() + r() + r() - 1.5; // roughly bell-shaped, -1.5..1.5
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const utc = (y, m, d) => Date.UTC(y, m - 1, d);
const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function writeCsv(name, header, rows) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n';
  fs.writeFileSync(path.join(DIR, `${name}.csv`), body);
  const manifestEntry = { rows: rows.length, bytes: Buffer.byteLength(body), sha256: crypto.createHash('sha256').update(body).digest('hex') };
  manifest.tables[name] = manifestEntry;
  console.log(`  ${name}: ${rows.length.toLocaleString()} rows, ${(manifestEntry.bytes / 1048576).toFixed(1)} MB`);
}

const manifest = {
  note: 'PREVIEW ONLY. Simulated tables for questions no dataset can answer. Estimated, not for decisions. Existing Preview files are never modified.',
  tables: {},
};

// ── Inputs ───────────────────────────────────────────────────────────────────────────────────────
console.log('Reading Preview data...');
const studentTypes = `types={'student_id':'VARCHAR','center_id':'VARCHAR'}`;
await q(`CREATE TABLE s AS SELECT student_id, center_id, programme, gender, division, district, upazila, income_band, disability_type, mainstream_status, dropout_reason, education_start_date, enrollment_year, mainstreamed FROM read_csv_auto('${src('students')}', sample_size=-1, ${studentTypes})`);
await q(`CREATE TABLE c AS SELECT * FROM read_csv_auto('${src('centers')}', sample_size=-1, types={'center_id':'VARCHAR'})`);
await q(`CREATE TABLE t AS SELECT * FROM read_csv_auto('${src('teachers')}', sample_size=-1, types={'center_id':'VARCHAR'})`);
await q(`CREATE TABLE att AS SELECT student_id, avg(attendance_pct) AS pct FROM read_csv_auto('${src('attendance')}', sample_size=-1, types={'student_id':'VARCHAR'}) GROUP BY student_id`);
await q(`CREATE TABLE m AS SELECT student_id, center_id, programme, subject, phase, mark FROM read_csv_auto('${src('assessments')}', sample_size=-1, ${studentTypes})`);

// The centers that actually have students, with geography taken from those students.
const centers = await q(`
  SELECT sc.center_id, sc.division, sc.district, sc.upazila, c.sub_program, c.overall_score, c.pedagogy, c.assessments, c.documentation, c.learning_environment, c.engagement
  FROM (SELECT center_id, mode(division) AS division, mode(district) AS district, mode(upazila) AS upazila FROM s GROUP BY center_id) sc
  LEFT JOIN c USING (center_id) ORDER BY sc.center_id`);
const score = (ct) => ct.overall_score ?? 3;

// ── Visits ───────────────────────────────────────────────────────────────────────────────────────
console.log('Generating...');
const PURPOSES = ['Routine supervision', 'Classroom observation', 'Records check', 'Community meeting'];
const staffCode = (ct, n) => `${(ct.district ?? ct.division ?? 'Area').replace(/\s+/g, '')}-${n}`;
const visits = [];
for (const ct of centers) {
  const r = rngFor(`visits|${ct.center_id}`);
  const count = clamp(Math.round(7 + (score(ct) - 3) * 2 + noise(r) * 3), 1, 18);
  const po = int(r, 1, 3);
  const staff = int(r, 1, 2);
  for (let i = 0; i < count; i++) {
    const isPo = r() < 0.65;
    const code = isPo ? `PO-${staffCode(ct, po)}` : `STAFF-${staffCode(ct, staff)}`;
    visits.push([`V${ct.center_id}-${String(i + 1).padStart(2, '0')}`, ct.center_id, iso(utc(2025, 1, 1) + int(r, 0, 364) * DAY), code, code.replace('-', ' ').replace(/-/g, ' '), isPo ? 'PO' : 'Staff', ct.sub_program, PURPOSES[int(r, 0, 3)]]);
  }
}
writeCsv('side_center_visits', ['visit_id', 'center_id', 'visit_date', 'staff_id', 'staff_name', 'staff_role', 'sub_program', 'purpose'], visits);

// ── Observations: the latest round is exactly the existing M&E score ─────────────────────────────
const CATEGORIES = [['pedagogy', 'Teaching practice needs coaching'], ['assessments', 'Assessment records are incomplete'], ['documentation', 'Registers are not up to date'], ['learning_environment', 'Classroom materials are inadequate'], ['engagement', 'Parent meetings are irregular']];
const ROUNDS = [[1, utc(2024, 11, 10)], [2, utc(2025, 4, 10)], [3, utc(2025, 9, 10)]];
const ratingFor = (v) => (v < 2.5 ? 'Negative' : v < 3.5 ? 'Fair' : 'Good');
const observations = [];
for (const ct of centers) {
  for (const [round, base] of ROUNDS) {
    const rDate = rngFor(`obsdate|${ct.center_id}|${round}`);
    const date = iso(base + int(rDate, 0, 20) * DAY);
    for (const [cat, issue] of CATEGORIES) {
      const latest = ct[cat] ?? ct.overall_score;
      if (latest == null) continue;
      const r = rngFor(`obs|${ct.center_id}|${round}|${cat}`);
      const value = round === 3 ? latest : round1(clamp(latest + noise(r) * (4 - round) * 0.35, 0, 5));
      const rating = ratingFor(value);
      observations.push([ct.center_id, round, date, cat, value, rating, rating === 'Negative' ? issue : '', rating === 'Negative' ? (round < 3 && r() < 0.6) : '']);
    }
  }
}
writeCsv('side_center_observations', ['center_id', 'round_no', 'obs_date', 'category', 'score', 'rating', 'issue', 'resolved'], observations);

// ── Organization and CMC ─────────────────────────────────────────────────────────────────────────
const org = centers.map((ct) => {
  const r = rngFor(`org|${ct.center_id}`);
  const eng = ct.engagement ?? ct.overall_score ?? 3;
  const status = eng >= 3.5 ? 'Functioning' : eng >= 2.5 ? 'Partly functioning' : 'Weak';
  const meetings = status === 'Functioning' ? int(r, 8, 12) : status === 'Partly functioning' ? int(r, 4, 7) : int(r, 0, 3);
  return [ct.center_id, `Partner Organization ${String.fromCharCode(65 + (seedOf(ct.district ?? 'x') % 8))}`, status, meetings, int(r, 7, 13), iso(utc(2025, 12, 31) - int(r, 5, 200) * DAY)];
});
writeCsv('side_center_org', ['center_id', 'organization', 'cmc_status', 'cmc_meetings_per_year', 'cmc_members', 'cmc_last_meeting'], org);

// ── Teacher attendance: linked, active teachers at centers with students ─────────────────────────
const teachers = await q(`SELECT DISTINCT t.center_id, t.teacher_name FROM t JOIN (SELECT DISTINCT center_id FROM s) x USING (center_id) WHERE t.employment_status = 'Active' AND t.teacher_name IS NOT NULL ORDER BY 1, 2`);
const centerById = new Map(centers.map((c) => [c.center_id, c]));
const teacherAttendance = [];
for (const tch of teachers) {
  const r = rngFor(`tatt|${tch.center_id}|${tch.teacher_name}`);
  const level = clamp(0.86 + (score(centerById.get(tch.center_id)) - 3) * 0.04 + noise(r) * 0.04, 0.55, 0.995);
  for (let mn = 1; mn <= 12; mn++) {
    const days = int(r, 20, 24);
    teacherAttendance.push([tch.center_id, tch.teacher_name, mn, MONTHS[mn - 1], days, Math.min(days, Math.round(days * clamp(level + noise(r) * 0.03, 0, 1)))]);
  }
}
writeCsv('side_teacher_attendance', ['center_id', 'teacher_name', 'month_num', 'month', 'working_days', 'present_days'], teacherAttendance);

// ── Dropout dates: only learners already marked as true dropouts ─────────────────────────────────
const dropouts = await q(`SELECT student_id, center_id, education_start_date, enrollment_year FROM s WHERE dropout_reason IS NOT NULL AND mainstream_status IS DISTINCT FROM 'Mainstreamed' ORDER BY student_id`);
const dropoutDate = new Map();
const dropoutRows = dropouts.map((d) => {
  const r = rngFor(`drop|${d.student_id}`);
  const parsed = d.education_start_date ? Date.parse(`${d.education_start_date} UTC`) : NaN;
  const start = Number.isFinite(parsed) ? parsed : utc(Number(d.enrollment_year) || 2023, 6, 1);
  const ms = Math.min(start + int(r, 30, 540) * DAY, utc(2025, 12, 31));
  dropoutDate.set(d.student_id, ms);
  return [d.student_id, d.center_id, iso(ms)];
});
writeCsv('side_dropout_events', ['student_id', 'center_id', 'dropout_date'], dropoutRows);

// ── Cash transfers: a stratified group of low-income learners per center ─────────────────────────
const CASH_PER_CENTER = 12;
const eligible = await q(`SELECT student_id, center_id FROM s WHERE income_band IN ('<5000', '5000-9999') AND mainstream_status IS DISTINCT FROM 'Running' ORDER BY student_id`);
const pickPerCenter = (rows, perCenter, salt) => {
  const byCenter = new Map();
  for (const row of rows) {
    if (!byCenter.has(row.center_id)) byCenter.set(row.center_id, []);
    byCenter.get(row.center_id).push(row);
  }
  const out = [];
  for (const [, list] of [...byCenter.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    out.push(...list.map((row) => ({ row, k: seedOf(`${salt}|${row.student_id}`) })).sort((a, b) => a.k - b.k).slice(0, perCenter).map((x) => x.row));
  }
  return out;
};
const cash = [];
let lastTxn = null;
for (const st of pickPerCenter(eligible, CASH_PER_CENTER, 'cash')) {
  const r = rngFor(`cash|${st.student_id}`);
  const amount = 300 + int(r, 0, 4) * 50;
  const left = dropoutDate.get(st.student_id);
  for (const [i, mn] of [3, 6, 9, 12].entries()) {
    const ms = utc(2025, mn, int(r, 5, 25));
    if (left != null && ms > left) break;
    const roll = r();
    const id = `P${st.student_id}-${i + 1}`;
    const txn = `TXN${String(seedOf(id)).padStart(10, '0')}`;
    if (roll < 0.03) { cash.push([id, '', st.student_id, st.center_id, mn, '', 0, 'Missed']); continue; }
    const missingTxn = roll < 0.032;
    const duplicated = roll >= 0.032 && roll < 0.034 && lastTxn;
    const high = roll >= 0.034 && roll < 0.036;
    const useTxn = missingTxn ? '' : duplicated ? lastTxn : txn;
    cash.push([id, useTxn, st.student_id, st.center_id, mn, iso(ms), high ? amount * 5 : amount, 'Paid']);
    if (useTxn) lastTxn = useTxn;
  }
}
writeCsv('side_cash_transfers', ['payment_id', 'transaction_no', 'student_id', 'center_id', 'month_num', 'pay_date', 'amount_tk', 'status'], cash);

// ── Unit marks: offsets sum to zero, so each center-subject mean is preserved ────────────────────
const UNITS = 6;
const centerSubjects = await q(`SELECT center_id, subject, avg(mark) AS m, count(DISTINCT student_id) AS n FROM m WHERE mark IS NOT NULL AND center_id IN (SELECT center_id FROM s) GROUP BY 1, 2 ORDER BY 1, 2`);
const unitRows = [];
for (const cs of centerSubjects) {
  const r = rngFor(`unit|${cs.center_id}|${cs.subject}`);
  const raw = Array.from({ length: UNITS }, () => noise(r) * 6);
  const mean = raw.reduce((a, b) => a + b, 0) / UNITS;
  raw.forEach((v, i) => unitRows.push([cs.center_id, cs.subject, i + 1, Math.round((cs.m + v - mean) * 100) / 100, Number(cs.n)]));
}
writeCsv('side_unit_marks', ['center_id', 'subject', 'unit', 'avg_mark', 'n_students'], unitRows);

// ── Cycle marks and monthly attendance: one stratified cohort, anchored to existing values ───────
const COHORT_PER_CENTER = 10;
const CORE_SUBJECTS = ['Bangla', 'English', 'Maths', 'Science'];
const cohort = pickPerCenter(await q(`SELECT student_id, center_id, programme FROM s WHERE mainstream_status IS DISTINCT FROM 'Running' ORDER BY student_id`), COHORT_PER_CENTER, 'cohort');
await q(`CREATE TABLE cohort (student_id VARCHAR)`);
for (let i = 0; i < cohort.length; i += 2000) {
  await q(`INSERT INTO cohort VALUES ${cohort.slice(i, i + 2000).map((c) => `('${c.student_id}')`).join(',')}`);
}
const marks = await q(`SELECT m.student_id, m.subject, m.phase, avg(m.mark) AS mark FROM m JOIN cohort USING (student_id) WHERE m.mark IS NOT NULL GROUP BY 1, 2, 3`);
const baseline = new Map();
const existing = new Set();
for (const row of marks) {
  existing.add(`${row.student_id}|${row.subject}|${row.phase}`);
  if (row.phase === 'BL') baseline.set(`${row.student_id}|${row.subject}`, row.mark);
}
const cycleRows = [];
for (const st of cohort) {
  const trajectory = rngFor(`traj|${st.student_id}`)();
  const slope = trajectory < 0.15 ? -2.5 : trajectory < 0.3 ? 0.3 : 4;
  const ct = centerById.get(st.center_id);
  for (const subject of CORE_SUBJECTS) {
    const bl = baseline.get(`${st.student_id}|${subject}`);
    if (bl == null) continue;
    const r = rngFor(`cycle|${st.student_id}|${subject}`);
    ['C1', 'C2', 'C3'].forEach((phase, i) => {
      if (existing.has(`${st.student_id}|${subject}|${phase}`)) return;
      const mark = bl + slope * (i + 1) + (score(ct) - 3) * 1.5 + noise(r) * 1.2;
      cycleRows.push([st.student_id, st.center_id, st.programme, subject, phase, round1(clamp(mark, 0, 100))]);
    });
  }
}
writeCsv('side_cycle_marks', ['student_id', 'center_id', 'programme', 'subject', 'phase', 'mark'], cycleRows);

const attendance = new Map((await q(`SELECT a.student_id, a.pct FROM att a JOIN cohort USING (student_id)`)).map((a) => [a.student_id, a.pct]));
const monthlyRows = [];
for (const st of cohort) {
  const pct = attendance.get(st.student_id);
  if (pct == null || pct <= 0) continue;
  const r = rngFor(`monthly|${st.student_id}`);
  const drift = r() < 0.12 ? -between(r, 1.5, 3) : 0;
  const raw = Array.from({ length: 12 }, (_, i) => drift * (i - 5.5) + noise(r) * 4);
  const mean = raw.reduce((a, b) => a + b, 0) / 12;
  // Clamping at 0 or 100 shifts the average, so hand the difference back to months with room.
  let months = raw.map((v) => clamp(pct + v - mean, 0, 100));
  for (let pass = 0; pass < 8; pass++) {
    const diff = pct - months.reduce((a, b) => a + b, 0) / 12;
    if (Math.abs(diff) < 0.05) break;
    const room = months.map((v) => (diff > 0 ? 100 - v : v));
    const total = room.reduce((a, b) => a + b, 0);
    if (!total) break;
    months = months.map((v, i) => clamp(v + (diff * 12 * room[i]) / total, 0, 100));
  }
  months.forEach((v, i) => monthlyRows.push([st.student_id, st.center_id, i + 1, MONTHS[i], round1(v)]));
}
writeCsv('side_student_monthly', ['student_id', 'center_id', 'month_num', 'month', 'attendance_pct'], monthlyRows);

// ── PPE: entirely new records, using geography that already exists ───────────────────────────────
const PPE_CENTERS = 150;
const PPE_PER_CENTER = 40;
const ppeCenters = [];
const ppeStudents = [];
const ppeMarks = [];
const placed = centers.filter((c) => c.district);
for (let i = 1; i <= PPE_CENTERS; i++) {
  const id = `PPE-${String(i).padStart(4, '0')}`;
  const r = rngFor(`ppe|${id}`);
  const home = placed[int(r, 0, placed.length - 1)];
  const quality = clamp(3.2 + noise(r) * 0.6, 1.5, 5);
  ppeCenters.push([id, `PPE Center ${String(i).padStart(3, '0')}`, home.division, home.district, home.upazila, round1(quality)]);
  for (let n = 1; n <= PPE_PER_CENTER; n++) {
    const sid = `${id}-${String(n).padStart(3, '0')}`;
    const rs = rngFor(`ppes|${sid}`);
    const roll = rs();
    const dropped = roll < 0.07;
    const mainstreamed = !dropped && roll < 0.68;
    ppeStudents.push([sid, id, rs() < 0.53 ? 'Girl' : 'Boy', ['<5000', '5000-9999', '10000-14999', '15000+'][Math.min(3, Math.floor(rs() * rs() * 4.5))], rs() < 0.01 ? 'Physical' : '', mainstreamed ? 'Mainstreamed' : 'Not Mainstreamed', dropped ? 'Poverty' : '', round1(clamp(80 + (quality - 3) * 4 + noise(rs) * 8, 20, 100))]);
    for (const subject of ['Bangla', 'English', 'Maths', 'Science']) {
      const rm = rngFor(`ppem|${sid}|${subject}`);
      const bl = clamp(46 + (quality - 3) * 3 + noise(rm) * 10, 5, 95);
      ppeMarks.push([sid, id, subject, 'BL', round1(bl)]);
      ppeMarks.push([sid, id, subject, 'C1', round1(clamp(bl + 7 + noise(rm) * 4, 0, 100))]);
    }
  }
}
writeCsv('side_ppe_centers', ['center_id', 'center_name', 'division', 'district', 'upazila', 'overall_score'], ppeCenters);
writeCsv('side_ppe_students', ['student_id', 'center_id', 'gender', 'income_band', 'disability_type', 'mainstream_status', 'dropout_reason', 'attendance_pct'], ppeStudents);
writeCsv('side_ppe_marks', ['student_id', 'center_id', 'subject', 'phase', 'mark'], ppeMarks);

fs.writeFileSync(path.join(DIR, 'side_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const total = Object.values(manifest.tables).reduce((n, t) => n + t.bytes, 0);
console.log(`Done: ${(total / 1048576).toFixed(1)} MB of new Preview-only tables.`);
process.exit(0);
