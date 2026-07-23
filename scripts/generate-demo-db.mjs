/**
 * generate-demo-db.mjs — builds a clean, fully-consistent DEMO database into Database/demo/.
 *
 * Fixes every issue in the real data: one `student_id` joins students↔attendance↔assessments;
 * geography is consistent across students/teachers/centres; programme labels are normalized;
 * every field is populated; attendance is a real monthly series; assessments span baseline→cycle-5;
 * centres carry visit logs + risk. From these it derives summary_dataset.json, aggregates/* and
 * kb/* so the RAG and all dashboard tabs read answerable data with no "honest gaps".
 *
 * Run: node scripts/generate-demo-db.mjs   (deterministic — seeded PRNG)
 */
import fs from "node:fs";
import path from "node:path";

// ── seeded PRNG (mulberry32) — reproducible ──────────────────────────────────
let seed = 20260720;
const rng = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ri = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const weighted = (pairs) => { const tot = pairs.reduce((s, p) => s + p[1], 0); let r = rng() * tot; for (const [v, w] of pairs) if ((r -= w) <= 0) return v; return pairs[0][0]; };
const round = (n, d = 2) => { const f = 10 ** d; return Math.round(n * f) / f; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ── constants ────────────────────────────────────────────────────────────────
const OUT = path.resolve("Database/demo");
const PROGRAMS = ["ABAL", "Catchup", "Innovation"];
const PKEY = { ABAL: "abal", Catchup: "catchup", Innovation: "innovation" };
const DIVISIONS = ["Dhaka", "Chattogram", "Rajshahi", "Khulna", "Barishal", "Sylhet", "Rangpur", "Mymensingh"];
const DISTRICTS = {
  Dhaka: ["Dhaka", "Gazipur", "Narayanganj"], Chattogram: ["Chattogram", "Coxs Bazar", "Cumilla"],
  Rajshahi: ["Rajshahi", "Bogura", "Pabna"], Khulna: ["Khulna", "Jashore", "Satkhira"],
  Barishal: ["Barishal", "Bhola", "Patuakhali"], Sylhet: ["Sylhet", "Habiganj", "Moulvibazar"],
  Rangpur: ["Rangpur", "Kurigram", "Dinajpur"], Mymensingh: ["Mymensingh", "Jamalpur", "Netrokona"],
};
const SUBJECTS = ["Bangla", "Mathematics", "English", "Science", "BGS", "Life Skills", "Religion"];
const SUBJECT_BASE = { Bangla: 42, Mathematics: 38, English: 34, Science: 30, BGS: 36, "Life Skills": 22, Religion: 40 };
const CYCLES = ["Baseline", "Cycle 1", "Cycle 2", "Cycle 3", "Cycle 4", "Cycle 5"];
const MONTHS = [];
for (let m = 8; m <= 12; m++) MONTHS.push(`2025-${String(m).padStart(2, "0")}`);
for (let m = 1; m <= 7; m++) MONTHS.push(`2026-${String(m).padStart(2, "0")}`);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (d) => `${String(d.getDate()).padStart(2, "0")} ${MON[d.getMonth()]} ${d.getFullYear()}`;

const GENDERS = [["Boy", 48], ["Girl", 52]];
const GRADES = ["G1", "G2", "G3", "G4", "G5"];
const DISABILITY = [["None", 94], ["Speech", 1.6], ["Vision", 1.3], ["Physical", 1.1], ["Hearing", 0.8], ["Mental", 0.7], ["Multiple", 0.5]];
const ETHNICITY = [["Bengali", 92], ["Chakma", 2.4], ["Marma", 1.8], ["Garo", 1.4], ["Santal", 1.2], ["Tripura", 0.7], ["Other", 0.5]];
const RELIGION = [["Islam", 88], ["Hindu", 8], ["Christian", 2], ["Buddhist", 2]];
const NUTRITION = [["Good", 84], ["Fair", 13], ["Bad", 3]];
const INCOME = [["Low", 40], ["Lower-middle", 34], ["Middle", 21], ["Upper", 5]];
const DROPOUT_REASONS = [["Poverty", 45], ["Family Awareness", 18], ["Distance", 12], ["Inattentive", 9], ["Migration", 8], ["Working child", 5], ["Others", 3]];
const EDU = [["H.S.C", 52], ["S.S.C", 20], ["Graduation", 15], ["Masters", 6], ["Lower Secondary Level", 4], ["Primary Level", 3]];
const EXP = [["Below 1 year", 34], ["1 Year", 20], ["2 Years", 24], ["3-5 Years", 12], ["Above 10 Years", 10]];
const POS = ["Karim Uddin", "Salma Akter", "Rafiq Islam", "Nasrin Jahan", "Jahangir Alam", "Ruma Begum", "Habibur Rahman", "Shirin Sultana"];
const FIRST = ["Rahim", "Karim", "Nusrat", "Jahan", "Alifa", "Sadia", "Tanvir", "Mizanur", "Ruma", "Fatima", "Abdul", "Salma", "Rafiq", "Nasrin", "Jamal", "Ayesha", "Habib", "Shirin", "Sohel", "Tania", "Imran", "Mim", "Sabbir", "Lamia", "Arif", "Jarin", "Hasib", "Meherin"];
const LAST = ["Uddin", "Islam", "Akter", "Begum", "Ahmed", "Hossain", "Khatun", "Rahman", "Sultana", "Miah", "Chowdhury", "Karim"];
const CNAME_A = ["Anandadhara", "Alokito Shishu", "Nabajatak", "Shapla", "Kishalay", "Projapoti", "Surjomukhi"];
const CNAME_B = ["Shikkha Kendro", "Prathomik Kendro", "Learning Centre", "Shishu Kendro"];
const name = () => `${pick(FIRST)} ${pick(LAST)}`;

// ── id generators (numeric, unique — the join keys) ──────────────────────────
let _sid = 100000000000, _cid = 0, _tid = 500000, _vid = 900000;
const studentId = () => String(_sid++);
const centerId = () => String(3030000000 + _cid++);
const teacherId = () => String(_tid++);
const visitId = () => String(_vid++);

// ── centres ──────────────────────────────────────────────────────────────────
const NUM_CENTERS = 40;
const centers = [];
for (let i = 0; i < NUM_CENTERS; i++) {
  const division = DIVISIONS[i % DIVISIONS.length];
  const district = pick(DISTRICTS[division]);
  const program = weighted([["ABAL", 30], ["Catchup", 55], ["Innovation", 15]]);
  const tier = weighted([["good", 60], ["fair", 28], ["poor", 12]]);
  const base = tier === "good" ? ri(30, 38) / 10 : tier === "fair" ? ri(21, 29) / 10 : ri(11, 19) / 10;
  const sub = () => round(clamp(base + (rng() - 0.5) * 0.7, 1, 4), 2);
  const pedagogy = sub(), assessments = sub(), documentation = sub(), learning_environment = sub(), engagement = sub();
  const score = round((pedagogy + assessments + documentation + learning_environment + engagement) / 5, 2);
  const daysSince = weighted([[ri(0, 20), 50], [ri(21, 39), 28], [ri(40, 72), 22]]);
  const lastVisit = new Date(2026, 6, 20); lastVisit.setDate(lastVisit.getDate() - daysSince);
  centers.push({
    center_id: centerId(), center_name: `${400 + i} ${pick(CNAME_A)} ${pick(CNAME_B)}`, program, division, district,
    upazila: `Ward ${ri(1, 9)}`, union: pick(["Union A", "Union B", "Union C"]), po: pick(POS), to: `TO ${ri(1, 4)}`, shift: pick(["Morning", "Day"]),
    pedagogy, assessments, documentation, learning_environment, engagement, score,
    days_since_visit: daysSince, last_visit: fmtDate(lastVisit), visit_count: ri(2, 12),
    students: 0, attSum: 0, atRisk: 0,
  });
}

// ── teachers ─────────────────────────────────────────────────────────────────
const NUM_TEACHERS = 200;
const teachers = [];
for (let i = 0; i < NUM_TEACHERS; i++) {
  const c = centers[i % centers.length];
  teachers.push({ teacher_id: teacherId(), name: name(), gender: weighted([["Woman", 90], ["Man", 10]]), education: weighted(EDU), experience: weighted(EXP), center_id: c.center_id, division: c.division });
}

// ── students + attendance + assessments ──────────────────────────────────────
const NUM_STUDENTS = 4000;
const students = [];
const attendanceRows = [];
const assessmentRows = [];
for (let i = 0; i < NUM_STUDENTS; i++) {
  const c = centers[i % centers.length];
  const program = c.program;
  const gender = weighted(GENDERS);
  const status = weighted([["Active", 78], ["Mainstreamed", 15], ["Left", 7]]);
  const income = weighted(INCOME);
  const enroll = new Date(2025, ri(0, 6), ri(1, 28));
  const sid = studentId();
  const nm = name();

  // per-student attendance level (poorer income & 'Left' → lower)
  let attLevel = ri(62, 96) - (income === "Low" ? 6 : 0) - (status === "Left" ? 22 : 0);
  attLevel = clamp(attLevel, 8, 99);
  let attSum = 0;
  MONTHS.forEach((month, mi) => {
    const drift = (mi - 5.5) * 1.3; // gentle rise across the year → a visible trend
    const days_total = ri(20, 24);
    const pct = clamp(Math.round(attLevel + drift + (rng() - 0.5) * 10), 0, 100);
    const days_present = Math.round((pct / 100) * days_total);
    attSum += pct;
    attendanceRows.push({ student_id: sid, name: nm, program, month, days_present, days_total, attendance_pct: pct });
  });
  const attAvg = Math.round(attSum / MONTHS.length);

  // per-student assessments: baseline low, improving; ability offset per student
  const ability = (rng() - 0.5) * 18;
  let latestSum = 0, baselineSum = 0;
  for (const subject of SUBJECTS) {
    const b0 = SUBJECT_BASE[subject] + ability + (rng() - 0.5) * 10;
    const baseline = clamp(Math.round(b0 - 8), 0, 100);
    baselineSum += baseline;
    const cyc = [];
    let v = baseline;
    for (let ci = 0; ci < 5; ci++) { v = clamp(v + ri(1, 6) + (rng() - 0.3) * 3, 0, 100); cyc.push(Math.round(v)); }
    const latest = cyc[4];
    latestSum += latest;
    const band = latest < 40 ? "Red" : latest < 50 ? "Yellow" : latest < 60 ? "Green" : latest < 80 ? "Pink" : "Blue";
    assessmentRows.push({ student_id: sid, name: nm, program, subject, baseline, cycle1: cyc[0], cycle2: cyc[1], cycle3: cyc[2], cycle4: cyc[3], cycle5: latest, latest, band });
  }
  const latestAvg = Math.round(latestSum / SUBJECTS.length);
  const baselineAvg = Math.round(baselineSum / SUBJECTS.length);

  const cashEnrolled = rng() < 0.6;
  const cashMissed = cashEnrolled ? weighted([[0, 55], [1, 25], [2, 13], [3, 7]]) : 0;
  const disability = weighted(DISABILITY);
  const ethnicity = weighted(ETHNICITY);
  const religion = weighted(RELIGION);
  const nutrition = weighted(NUTRITION);
  const dropout_reason = status === "Left" ? weighted(DROPOUT_REASONS) : "";
  const mainstreamed = status === "Mainstreamed";

  // risk score 0-100 (higher = more at risk); Left/low-att/low-score/missed-cash push up
  let risk = (100 - attAvg) * 0.4 + (100 - latestAvg) * 0.3 + cashMissed * 8 + (status === "Left" ? 20 : 0) - (mainstreamed ? 30 : 0);
  risk = clamp(Math.round(risk), 0, 100);
  const risk_band = risk >= 70 ? "Critical" : risk >= 55 ? "High" : risk >= 40 ? "Elevated" : "Low";

  c.students++; c.attSum += attAvg; if (risk >= 55 && status === "Active") c.atRisk++;

  students.push({
    student_id: sid, name: nm, program, gender, grade: pick(GRADES), division: c.division, district: c.district, center_id: c.center_id,
    status, disability, ethnicity, religion, nutrition, income_band: income, enrollment_date: fmtDate(enroll),
    mainstreamed: mainstreamed ? "Yes" : "No", dropout_reason, attendance_pct: attAvg, baseline_avg_score: baselineAvg, latest_avg_score: latestAvg, risk_score: risk, risk_band,
    cash_enrolled: cashEnrolled ? "Yes" : "No", cash_missed: cashMissed,
  });
}
for (const c of centers) c.avg_attendance = c.students ? Math.round(c.attSum / c.students) : 0;

// ── visits log ───────────────────────────────────────────────────────────────
const visits = [];
for (const c of centers) {
  const last = new Date(2026, 6, 20); last.setDate(last.getDate() - c.days_since_visit);
  for (let v = 0; v < Math.min(c.visit_count, 6); v++) {
    const d = new Date(last); d.setDate(d.getDate() - v * ri(18, 40));
    visits.push({ visit_id: visitId(), center_id: c.center_id, visit_date: fmtDate(d), po: c.po, notes: pick(["Routine monitoring", "Attendance follow-up", "Learning support", "Documentation check", "Parent meeting"]) });
  }
}

// ═══════════════════════════ DERIVE AGGREGATES ═══════════════════════════════
const byKey = (arr, keyFn) => arr.reduce((m, x) => { const k = keyFn(x); (m[k] ||= []).push(x); return m; }, {});
const count = (arr, keyFn) => arr.reduce((m, x) => { const k = keyFn(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

const studentsByProg = byKey(students, (s) => PKEY[s.program]);
const programsAgg = {};
for (const p of PROGRAMS) {
  const key = PKEY[p];
  const ss = studentsByProg[key] || [];
  const boys = ss.filter((s) => s.gender === "Boy").length;
  const girls = ss.filter((s) => s.gender === "Girl").length;
  const mainstreamed = ss.filter((s) => s.mainstreamed === "Yes").length;
  const left = ss.filter((s) => s.status === "Left");
  const dropout_reasons = count(left, (s) => s.dropout_reason);
  const attMean = ss.length ? round(sum(ss, (s) => s.attendance_pct) / ss.length, 2) : 0;
  programsAgg[key] = {
    students: ss.length, boys, girls, mainstreamed,
    mainstream_rate: ss.length ? round(mainstreamed / ss.length, 4) : 0,
    dropout_reasons,
    attendance: { recorded_mean: attMean, coverage: 1, recorded_count: ss.length, raw_mean_including_zeros: attMean, summary_dataset_value: attMean },
  };
}
const totalStudents = students.length;
const totalMain = students.filter((s) => s.mainstreamed === "Yes").length;
const totals = { students: totalStudents, teachers: teachers.length, programs: 3, mainstreamed: totalMain, mainstream_rate: round(totalMain / totalStudents, 4) };

const divisionStudents = count(students, (s) => s.division);
const divisionTeachers = count(teachers, (t) => t.division);

// attendance aggregate (coverage now 100%)
const attMeanAll = round(sum(students, (s) => s.attendance_pct) / totalStudents, 2);
const distBins = () => { const bins = []; for (let lo = 0; lo < 100; lo += 10) bins.push({ bin: `${lo}-${lo + 10}`, count: 0 }); return bins; };
const attByProgram = {};
for (const p of PROGRAMS) {
  const key = PKEY[p];
  const ss = studentsByProg[key] || [];
  const dist = distBins();
  ss.forEach((s) => { const b = Math.min(9, Math.floor(s.attendance_pct / 10)); dist[b].count++; });
  const mean = ss.length ? round(sum(ss, (s) => s.attendance_pct) / ss.length, 2) : 0;
  attByProgram[key] = { rows: ss.length, zero_count: 0, recorded_count: ss.length, coverage: 1, recorded_mean: mean, raw_mean_including_zeros: mean, distribution: dist };
}
const attendanceAgg = {
  generated_by: "scripts/generate-demo-db.mjs", source: "Database/demo (synthetic, fully recorded)",
  zero_meaning: "recorded — every learner has a monthly attendance record in the demo dataset",
  note: "Demo dataset: attendance coverage is 100% and joins to each learner via student_id (unlike the real export).",
  by_program: attByProgram,
  overall: { rows: totalStudents, recorded_count: totalStudents, coverage: 1, recorded_mean_student_weighted: attMeanAll, raw_mean_student_weighted_including_zeros: attMeanAll },
};

// demographics per programme (complete — no blanks)
const demographics = { generated_by: "scripts/generate-demo-db.mjs", source: "Database/demo", by_program: {} };
for (const p of PROGRAMS) {
  const key = PKEY[p];
  const ss = studentsByProg[key] || [];
  demographics.by_program[key] = {
    rows: ss.length,
    gender: count(ss, (s) => s.gender),
    disability: count(ss, (s) => s.disability),
    ethnicity: count(ss, (s) => s.ethnicity),
    religion: count(ss, (s) => s.religion),
    nutrition: count(ss, (s) => s.nutrition),
    division: count(ss, (s) => s.division),
  };
}

// subject averages per programme (mean of latest scores)
const subjectAverages = {};
for (const p of PROGRAMS) {
  const key = PKEY[p];
  subjectAverages[key] = {};
  for (const subj of SUBJECTS) {
    const rows = assessmentRows.filter((a) => PKEY[a.program] === key && a.subject === subj);
    subjectAverages[key][subj] = rows.length ? round(sum(rows, (r) => r.latest) / rows.length, 2) : 0;
  }
}
const bySubject = { generated_by: "scripts/generate-demo-db.mjs", source: "Database/demo", subject_averages: subjectAverages };

// teachers aggregate
const teachersAgg = {
  generated_by: "scripts/generate-demo-db.mjs", source: "Database/demo",
  total: teachers.length, gender: count(teachers, (t) => (t.gender === "Woman" ? "Woman" : "Man")),
  experience: count(teachers, (t) => t.experience), education: count(teachers, (t) => t.education),
  by_division: divisionTeachers,
};

// me_evaluations + worst centres + poor bangla
const me_evaluations = centers.map((c) => ({ center_id: c.center_id, center_name: c.center_name, program: `EMDC-${c.program.toUpperCase()}`, pedagogy: c.pedagogy, assessments: c.assessments, documentation: c.documentation, learning_environment: c.learning_environment, engagement: c.engagement, score: c.score }));
const worst_centers_by_attendance = [...centers].sort((a, b) => a.avg_attendance - b.avg_attendance).slice(0, 10).map((c) => ({ center_id: c.center_id, avg_attendance: c.avg_attendance, program: PKEY[c.program] }));
const poor_bangla_students = assessmentRows.filter((a) => a.subject === "Bangla").sort((a, b) => a.latest - b.latest).slice(0, 15).map((a) => { const s = students.find((x) => x.student_id === a.student_id); return { student_id: a.student_id, name: a.name, enrollment_date: s ? s.enrollment_date : "", bangla_mark: a.latest }; });

// ── extra aggregates for the newly-available features (trend / risk / visits / map) ──
for (const c of centers) {
  const daysC = clamp(c.days_since_visit / 45, 0, 1);
  const attC = clamp((100 - c.avg_attendance) / 60, 0, 1);
  const meC = clamp((4 - c.score) / 3, 0, 1);
  const riskC = clamp((c.students ? c.atRisk / c.students : 0) / 0.3, 0, 1);
  c.urgency = Math.round((0.3 * daysC + 0.3 * attC + 0.2 * meC + 0.2 * riskC) * 100);
}
const centersAgg = [...centers].sort((a, b) => b.urgency - a.urgency).map((c) => ({
  center_id: c.center_id, center_name: c.center_name, program: PKEY[c.program], division: c.division, district: c.district,
  score: c.score, avg_attendance: c.avg_attendance, days_since_visit: c.days_since_visit, visit_count: c.visit_count,
  at_risk: c.atRisk, students: c.students, urgency: c.urgency, band: c.score < 2 ? "Poor" : c.score < 3 ? "Fair" : "Good",
}));

const monthLabel = (m) => `${MON[parseInt(m.slice(5, 7), 10) - 1]} ${m.slice(2, 4)}`;
const trend = MONTHS.map((m) => {
  const rows = attendanceRows.filter((a) => a.month === m);
  const row = { month: m, label: monthLabel(m), overall: rows.length ? round(sum(rows, (r) => r.attendance_pct) / rows.length, 1) : 0 };
  for (const p of PROGRAMS) { const pr = rows.filter((r) => r.program === p); row[p] = pr.length ? round(sum(pr, (r) => r.attendance_pct) / pr.length, 1) : 0; }
  return row;
});

const active = students.filter((s) => s.status === "Active");
const riskBands = count(active, (s) => s.risk_band);
const riskReason = (s) => (s.attendance_pct < 60 ? "Low attendance" : s.latest_avg_score < 40 ? "Falling scores" : s.cash_missed >= 2 ? "Missed cash payments" : "Multiple warning signs");
const atRiskTop = active.filter((s) => s.risk_band === "Critical" || s.risk_band === "High").sort((a, b) => b.risk_score - a.risk_score).slice(0, 15)
  .map((s) => ({ student_id: s.student_id, name: s.name, program: s.program, center_id: s.center_id, division: s.division, risk_score: s.risk_score, risk_band: s.risk_band, attendance_pct: s.attendance_pct, baseline_avg_score: s.baseline_avg_score, latest_avg_score: s.latest_avg_score, cash_missed: s.cash_missed, reason: riskReason(s) }));
const riskAgg = {
  generated_by: "scripts/generate-demo-db.mjs", source: "Database/demo", active: active.length,
  bands: { Critical: riskBands.Critical || 0, High: riskBands.High || 0, Elevated: riskBands.Elevated || 0, Low: riskBands.Low || 0 },
  avg_score: round(sum(active, (s) => s.risk_score) / active.length, 1), top: atRiskTop,
};

// disability × division cross-tab (for the equity map)
const disabilityByDivision = {};
DIVISIONS.forEach((d) => (disabilityByDivision[d] = 0));
students.filter((s) => s.disability !== "None").forEach((s) => disabilityByDivision[s.division]++);
demographics.disability_by_division = disabilityByDivision;

const summaryDataset = {
  _meta: "Synthetic DEMO dataset generated by scripts/generate-demo-db.mjs — clean, fully-keyed, complete.",
  programs: Object.fromEntries(PROGRAMS.map((p) => { const k = PKEY[p]; const a = programsAgg[k]; return [k, { students: a.students, boys: a.boys, girls: a.girls, avg_attendance: a.attendance.recorded_mean, mainstreamed: a.mainstreamed, dropout_reasons: a.dropout_reasons }]; })),
  grades: count(students, (s) => s.grade),
  divisions: divisionStudents,
  nutrition: count(students, (s) => (s.nutrition === "Fair" ? "Not so good" : s.nutrition)),
  teachers: { total: teachers.length, experience: teachersAgg.experience, education: teachersAgg.education, gender: teachersAgg.gender },
  me_evaluations,
  worst_centers_by_attendance,
  poor_bangla_students,
  subject_averages: subjectAverages,
  student_marks_sample: assessmentRows.slice(0, 20).map((a) => ({ student_id: a.student_id, name: a.name, subject: a.subject, baseline: a.baseline, latest: a.latest })),
};

// ═══════════════════════════ KNOWLEDGE BASE ══════════════════════════════════
const VERSION = "demo-" + Date.now().toString(36);
const meanME = round(sum(centers, (c) => c.score) / centers.length, 2);
const poorC = centers.filter((c) => c.score < 2).length, fairC = centers.filter((c) => c.score >= 2 && c.score < 3).length, goodC = centers.filter((c) => c.score >= 3).length;
const girlsAll = students.filter((s) => s.gender === "Girl").length;
const girlPct = round((girlsAll / totalStudents) * 100, 1);
const netDropout = {}; students.filter((s) => s.status === "Left").forEach((s) => (netDropout[s.dropout_reason] = (netDropout[s.dropout_reason] || 0) + 1));
const totalDropouts = Object.values(netDropout).reduce((a, b) => a + b, 0);
const poverty = netDropout["Poverty"] || 0;
const disabledAll = students.filter((s) => s.disability !== "None").length;
const topDiv = Object.entries(divisionStudents).sort((a, b) => b[1] - a[1])[0];
const weakestSubjKey = (key) => { let sName = SUBJECTS[0], sv = Infinity; for (const s of SUBJECTS) { const v = subjectAverages[key][s]; if (v < sv) { sv = v; sName = s; } } return sName; };

const facts = [];
const fact = (id, category, subject, lens, severity, statement, value, unit, tags, coverage) => facts.push({ id, category, subject, lens, severity, statement, value, unit, ...(coverage != null ? { coverage } : {}), source: "Database/demo", tags });
fact("kpi.students.total", "kpi", "enrolment", "kpi", "info", `The programme serves ${totalStudents.toLocaleString()} enrolled learners across 3 programmes.`, totalStudents, "count", ["students", "total", "enrolment", "learners", "count"]);
fact("kpi.teachers.total", "kpi", "teachers", "kpi", "info", `There are ${teachers.length.toLocaleString()} teachers.`, teachers.length, "count", ["teachers", "total", "staff", "educators"]);
fact("kpi.mainstream.rate", "kpi", "mainstreaming", "kpi", "info", `${round(totals.mainstream_rate * 100, 1)}% of learners have been mainstreamed into formal school (${totalMain.toLocaleString()} of ${totalStudents.toLocaleString()}).`, round(totals.mainstream_rate * 100, 1), "%", ["mainstream", "mainstreamed", "rate", "formal", "school"]);
fact("kpi.attendance.mean", "kpi", "attendance", "kpi", "info", `Average recorded attendance is ${attMeanAll}% across ${totalStudents.toLocaleString()} learners (100% coverage in the demo dataset).`, attMeanAll, "%", ["attendance", "average", "present", "coverage"], 1);
fact("centers.grade.mean", "kpi", "centres", "kpi", "info", `Across ${centers.length} centres the mean M&E score is ${meanME} (of 4).`, meanME, "score", ["centre", "center", "score", "m&e", "evaluation", "quality"]);
fact("equity.gender.girls", "win", "gender", "win", "info", `${girlPct}% of learners are girls (${girlsAll.toLocaleString()} of ${totalStudents.toLocaleString()}) — at or above parity.`, girlPct, "%", ["girls", "gender", "parity", "equity", "female"]);
for (const p of PROGRAMS) {
  const k = PKEY[p]; const a = programsAgg[k];
  fact(`program.${k}.students`, "context", k, "kpi", "info", `${p} has ${a.students.toLocaleString()} students (${a.boys} boys, ${a.girls} girls).`, a.students, "count", [k, p.toLowerCase(), "students", "enrolment", "boys", "girls", "gender"]);
  fact(`program.${k}.mainstream`, a.mainstream_rate < 0.3 ? "issue" : "win", k, a.mainstream_rate < 0.3 ? "issue" : "win", a.mainstream_rate < 0.3 ? "warn" : "info", `${p} has mainstreamed ${round(a.mainstream_rate * 100, 1)}% of its learners (${a.mainstreamed.toLocaleString()} of ${a.students.toLocaleString()}).`, round(a.mainstream_rate * 100, 1), "%", [k, p.toLowerCase(), "mainstream", "mainstreamed", "rate"]);
  fact(`program.${k}.attendance`, "quality", k, "kpi", "info", `${p} attendance averages ${a.attendance.recorded_mean}% (fully recorded).`, a.attendance.recorded_mean, "%", [k, p.toLowerCase(), "attendance", "present"], 1);
  const topReason = Object.entries(a.dropout_reasons).sort((x, y) => y[1] - x[1])[0];
  if (topReason) fact(`dropout.${k}.top`, "issue", k, "issue", "watch", `In ${p}, the leading dropout reason is ${topReason[0]} (${topReason[1].toLocaleString()} learners).`, topReason[1], "count", [k, p.toLowerCase(), "dropout", "leave", "reason", topReason[0].toLowerCase()]);
  fact(`learning.${k}.weakest`, "action", k, "action", "watch", `${p}'s weakest subject is ${weakestSubjKey(k)}, averaging ${subjectAverages[k][weakestSubjKey(k)]}.`, subjectAverages[k][weakestSubjKey(k)], "score", [k, p.toLowerCase(), "subject", "marks", "weakest", "learning", weakestSubjKey(k).toLowerCase()]);
}
fact("dropout.network.top", "issue", "dropout", "issue", "warn", `Poverty is the leading dropout reason network-wide — ${poverty.toLocaleString()} learners (${round((poverty / totalDropouts) * 100, 1)}% of ${totalDropouts.toLocaleString()} dropouts).`, poverty, "count", ["dropout", "leave", "poverty", "reason", "cash", "income"]);
fact("centers.grade.dist", "action", "centres", "action", "watch", `${poorC} centres score Poor (below 2 of 4), ${fairC} Fair and ${goodC} Good — field support should go to the Poor centres first.`, poorC, "count", ["centre", "center", "poor", "visit", "support", "quality", "score"]);
fact("centers.worst-attendance", "action", "centres", "action", "warn", `${worst_centers_by_attendance.filter((c) => c.avg_attendance < 60).length} centres are flagged for low attendance and need a visit.`, worst_centers_by_attendance.filter((c) => c.avg_attendance < 60).length, "count", ["centre", "center", "attendance", "visit", "worst", "low"]);
fact("geography.top", "context", "divisions", "context", "info", `${topDiv[0]} holds the most learners (${topDiv[1].toLocaleString()}); enrolment spans all ${DIVISIONS.length} divisions.`, topDiv[1], "count", ["division", "district", "geography", "location", topDiv[0].toLowerCase()]);
fact("equity.disability", "context", "equity", "context", "watch", `${disabledAll.toLocaleString()} learners have a recorded disability (${round((disabledAll / totalStudents) * 100, 1)}% of enrolment).`, disabledAll, "count", ["disability", "disabled", "equity", "special", "needs"]);
fact("equity.nutrition.bad", "issue", "nutrition", "issue", "watch", `${count(students, (s) => s.nutrition)["Bad"] || 0} learners are recorded with "Bad" nutrition status.`, count(students, (s) => s.nutrition)["Bad"] || 0, "count", ["nutrition", "health", "bad", "food", "welfare"]);
fact("risk.atrisk", "action", "risk", "action", "warn", `${students.filter((s) => s.risk_band === "Critical" || s.risk_band === "High").length} active learners are High or Critical risk of dropping out (from attendance, scores and missed cash).`, students.filter((s) => s.risk_band === "Critical" || s.risk_band === "High").length, "count", ["risk", "dropout", "may", "leave", "early", "warning", "at-risk"]);

const factsJson = { version: VERSION, generated_by: "scripts/generate-demo-db.mjs", facts };

const metrics = {
  version: VERSION,
  kpis: [
    { id: "kpi.students.total", statement: `The programme serves ${totalStudents.toLocaleString()} enrolled learners across 3 programmes.`, value: totalStudents, unit: "count" },
    { id: "kpi.teachers.total", statement: `There are ${teachers.length.toLocaleString()} teachers.`, value: teachers.length, unit: "count" },
    { id: "kpi.mainstream.rate", statement: `${round(totals.mainstream_rate * 100, 1)}% of learners have been mainstreamed into formal school.`, value: round(totals.mainstream_rate * 100, 1), unit: "%" },
    { id: "centers.grade.mean", statement: `Across ${centers.length} centres the mean M&E score is ${meanME} (of 4).`, value: meanME, unit: "score" },
  ],
  wins: [
    { id: "equity.gender", statement: `Girls are at or above parity network-wide (${girlPct}% girls).` },
    { id: "attendance.coverage", statement: `Attendance is fully recorded (100% coverage) and joins to each learner.` },
  ],
  issues: PROGRAMS.filter((p) => programsAgg[PKEY[p]].mainstream_rate < 0.3).map((p) => ({ id: `mainstream.${PKEY[p]}`, statement: `${p} has mainstreamed only ${round(programsAgg[PKEY[p]].mainstream_rate * 100, 1)}% of its learners.`, severity: "warn" }))
    .concat([{ id: "dropout.poverty", statement: `Poverty drives ${round((poverty / totalDropouts) * 100, 1)}% of dropouts (${poverty.toLocaleString()} learners).`, severity: "warn" }]),
  actions: [
    { id: "centers.poor", statement: `${poorC} centres score Poor (below 2/4) — route field support here first.`, severity: "warn" },
    { id: "cash.target", statement: `Target cash support at the ${poverty.toLocaleString()} poverty-linked dropouts — the largest addressable driver.`, severity: "watch" },
    { id: "learning.weakest", statement: `Life Skills and Science are the weakest subjects network-wide — concentrate teaching support.`, severity: "watch" },
  ],
  dataQuality: [
    { id: "demo.clean", statement: `Synthetic demo dataset: every table joins on student_id / center_id, attendance & assessments are fully recorded, and all fields are populated.`, severity: "info" },
    { id: "demo.synthetic", statement: `These are generated demonstration figures, not the real programme data.`, severity: "watch" },
  ],
};

const schema = {
  version: VERSION,
  programs: ["abal", "catchup", "innovation"],
  tables: {
    students: { key: "student_id", columns: ["student_id", "name", "program", "gender", "grade", "division", "district", "center_id", "status", "disability", "ethnicity", "religion", "nutrition", "income_band", "enrollment_date", "mainstreamed", "dropout_reason", "attendance_pct", "baseline_avg_score", "latest_avg_score", "risk_score", "risk_band"] },
    attendance: { key: "student_id", columns: ["student_id", "name", "program", "month", "days_present", "days_total", "attendance_pct"] },
    assessments: { key: "student_id", columns: ["student_id", "name", "program", "subject", "baseline", "cycle1", "cycle2", "cycle3", "cycle4", "cycle5", "latest", "band"] },
    centers: { key: "center_id", columns: ["center_id", "center_name", "program", "division", "pedagogy", "assessments", "documentation", "learning_environment", "engagement", "score", "days_since_visit"] },
    teachers: { key: "teacher_id", columns: ["teacher_id", "name", "gender", "education", "experience", "center_id", "division"] },
  },
  relations: [
    { from: "attendance.student_id", to: "students.student_id", type: "many-to-one", strength: "strong" },
    { from: "assessments.student_id", to: "students.student_id", type: "many-to-one", strength: "strong" },
    { from: "students.center_id", to: "centers.center_id", type: "many-to-one", strength: "strong" },
    { from: "teachers.center_id", to: "centers.center_id", type: "many-to-one", strength: "strong" },
  ],
};

const manifest = { version: VERSION, generated_by: "scripts/generate-demo-db.mjs", generated_at_note: "demo", students: totalStudents, centers: centers.length, teachers: teachers.length, tables: Object.keys(schema.tables) };

// ═══════════════════════════ WRITE FILES ═════════════════════════════════════
fs.mkdirSync(path.join(OUT, "aggregates"), { recursive: true });
fs.mkdirSync(path.join(OUT, "kb"), { recursive: true });
const toCsv = (rows, cols) => [cols.join(","), ...rows.map((r) => cols.map((c) => { const v = r[c] ?? ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(","))].join("\n");
const writeJson = (rel, obj) => fs.writeFileSync(path.join(OUT, rel), JSON.stringify(obj, null, 2));
const writeCsv = (rel, rows, cols) => fs.writeFileSync(path.join(OUT, rel), toCsv(rows, cols));

writeCsv("students.csv", students, schema.tables.students.columns.concat(["cash_enrolled", "cash_missed"]));
writeCsv("attendance.csv", attendanceRows, schema.tables.attendance.columns);
writeCsv("assessments.csv", assessmentRows, schema.tables.assessments.columns);
writeCsv("teachers.csv", teachers, ["teacher_id", "name", "gender", "education", "experience", "center_id", "division"]);
writeCsv("evaluations.csv", me_evaluations.map((e, i) => ({ ...e, division: centers[i].division, band: e.score < 2 ? "Poor" : e.score < 3 ? "Fair" : "Good", days_since_visit: centers[i].days_since_visit })), ["center_id", "center_name", "program", "division", "pedagogy", "assessments", "documentation", "learning_environment", "engagement", "score", "band", "days_since_visit"]);
writeCsv("visits.csv", visits, ["visit_id", "center_id", "visit_date", "po", "notes"]);
writeCsv("centers.csv", centers, ["center_id", "center_name", "program", "division", "district", "upazila", "union", "po", "to", "shift", "score", "avg_attendance", "days_since_visit", "visit_count", "students", "atRisk"]);

writeJson("summary_dataset.json", summaryDataset);
writeJson("aggregates/by_program.json", { generated_by: "scripts/generate-demo-db.mjs", source: "Database/demo", programs: programsAgg, totals });
writeJson("aggregates/by_division.json", { generated_by: "scripts/generate-demo-db.mjs", source: "Database/demo", students: divisionStudents, teachers: divisionTeachers });
writeJson("aggregates/attendance.json", attendanceAgg);
writeJson("aggregates/demographics.json", demographics);
writeJson("aggregates/teachers.json", teachersAgg);
writeJson("aggregates/by_subject.json", bySubject);
writeJson("aggregates/trends.json", { generated_by: "scripts/generate-demo-db.mjs", source: "Database/demo", months: trend });
writeJson("aggregates/risk.json", riskAgg);
writeJson("aggregates/centers.json", { generated_by: "scripts/generate-demo-db.mjs", source: "Database/demo", centers: centersAgg });
writeJson("kb/facts.json", factsJson);
writeJson("kb/metrics.json", metrics);
writeJson("kb/schema.json", schema);
writeJson("kb/manifest.json", manifest);

// copy rules.json from the real kb if present (decisionRules.ts needs it)
try {
  const rulesSrc = path.resolve("Database/kb/rules.json");
  if (fs.existsSync(rulesSrc)) fs.copyFileSync(rulesSrc, path.join(OUT, "kb/rules.json"));
} catch { /* optional */ }

console.log(`✓ demo DB written to ${OUT}`);
console.log(`  students=${totalStudents} centers=${centers.length} teachers=${teachers.length} attendanceRows=${attendanceRows.length} assessmentRows=${assessmentRows.length}`);
console.log(`  mainstream=${round(totals.mainstream_rate * 100, 1)}% attMean=${attMeanAll}% meanME=${meanME} poorCentres=${poorC} facts=${facts.length}`);
