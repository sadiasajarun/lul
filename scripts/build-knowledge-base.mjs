/**
 * Knowledge-Base builder — the cost-efficient RAG foundation.
 *
 * Reads the WHOLE database once (summary_dataset.json + the aggregates produced by
 * aggregate.mjs) and distils it into a small, retrievable knowledge base under Database/kb/:
 *
 *   facts.json     — atomic, grounded facts (one number each), tagged for retrieval
 *   metrics.json   — the decision dashboard: KPIs · wins · issues · actions · data-quality
 *   schema.json    — tables, columns, relations, join reality (what can/can't join)
 *   manifest.json  — version hash + counts (drives incremental invalidation & the learning loop)
 *
 * WHY: the old RAG streamed up to 105 MB of CSVs per question and fed raw rows to the LLM.
 * Instead the AI now reads a handful of relevant *facts* (a few KB) selected by the retriever.
 * Same answer, a fraction of the tokens. Row-level CSV lookup is kept only for "find student X".
 *
 * Run:  npm run kb      (runs aggregate first, then this)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.resolve(__dirname, "../Database");
const AGG = path.join(DB, "aggregates");
const OUT = path.join(DB, "kb");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const pct = (x) => Math.round(x * 1000) / 10;
const round = (x, d = 2) => { const m = 10 ** d; return Math.round(x * m) / m; };

// ── CANONICAL DECISION RULES — the single source of truth for every threshold/band ───────────
// Emitted to kb/rules.json and imported by the app (src/app/lib/decisionRules.ts) so a decision
// made here (a fact flagged an "issue") and a decision shown in the UI ALWAYS use identical cut-offs.
// Change a number here and both the facts and the app move together. This is what makes
// "decision points always follow consistency" true by construction.
const RULES = {
  mainstream: { winAtOrAbovePct: 50, issueBelowPct: 15 },
  attendance: { captionBelowCoveragePct: 90, criticalBelowCoveragePct: 10, qualityBelowCoveragePct: 50 },
  centerGrade: { goodAtOrAbove: 3, fairAtOrAbove: 2, outOf: 4 }, // Good ≥3 · Fair 2–2.99 · Poor <2
  genderParity: { minGirlPct: 45, maxGirlPct: 55 },
  smallDivisionBelow: 100,
  baselineBands: [
    { maxExclusive: 40, band: "Red" },
    { maxExclusive: 50, band: "Yellow" },
    { maxExclusive: 60, band: "Green" },
    { maxExclusive: 80, band: "Pink" },
    { maxExclusive: Infinity, band: "Blue" },
  ],
  riskBands: { criticalAtOrAbove: 81, highAtOrAbove: 61, elevatedAtOrAbove: 31 },
};
const classifyMainstream = (r) => r >= RULES.mainstream.winAtOrAbovePct ? "win" : r < RULES.mainstream.issueBelowPct ? "issue" : "context";
const classifyGrade = (s) => s >= RULES.centerGrade.goodAtOrAbove ? "Good" : s >= RULES.centerGrade.fairAtOrAbove ? "Fair" : "Poor";

// ── Load everything (already aggregated — cheap) ──────────────────────────────
const summary = readJson(path.join(DB, "summary_dataset.json"));
const byProgram = readJson(path.join(AGG, "by_program.json"));
const attendance = readJson(path.join(AGG, "attendance.json"));
const subjects = readJson(path.join(AGG, "by_subject.json"));
const demographics = readJson(path.join(AGG, "demographics.json"));
const teachers = readJson(path.join(AGG, "teachers.json"));

const PROGRAMS = ["abal", "catchup", "innovation"];
const PLABEL = { abal: "ABAL", catchup: "Catchup", innovation: "Innovation" };

// ── Fact accumulator ──────────────────────────────────────────────────────────
const facts = [];
const KW = (s) => Array.from(new Set(String(s).toLowerCase().match(/[a-z0-9]+/g) ?? []));

/**
 * @param f {id, category, subject, lens, severity?, statement, value, unit?, coverage?, source, tags?}
 * `lens`: kpi | win | issue | action | quality | context
 * `severity`: info | watch | warn | critical
 */
function fact(f) {
  const tags = Array.from(new Set([
    f.category, f.subject, f.lens,
    ...(f.tags ?? []),
    ...KW(f.statement),
  ].filter(Boolean).map((t) => String(t).toLowerCase())));
  facts.push({ severity: "info", unit: "", ...f, tags });
}

// ── 1 · Network KPIs ──────────────────────────────────────────────────────────
const T = byProgram.totals;
fact({ id: "kpi.students.total", category: "enrolment", subject: "network", lens: "kpi",
  statement: `The programme serves ${T.students.toLocaleString("en-US")} enrolled learners across ${T.programs} programmes.`,
  value: T.students, unit: "count", source: "summary_dataset.programs", tags: ["enrolment", "students", "total", "size"] });

fact({ id: "kpi.teachers.total", category: "teachers", subject: "network", lens: "kpi",
  statement: `There are ${T.teachers.toLocaleString("en-US")} teachers.`,
  value: T.teachers, unit: "count", source: "teacher_profiles", tags: ["teachers", "staff", "total"] });

fact({ id: "kpi.mainstream.rate", category: "mainstreaming", subject: "network", lens: "kpi",
  statement: `${pct(T.mainstream_rate)}% of learners have been mainstreamed into formal school (${T.mainstreamed.toLocaleString("en-US")} of ${T.students.toLocaleString("en-US")}).`,
  value: pct(T.mainstream_rate), unit: "%", source: "student_profiles.Mainstream Status", tags: ["mainstream", "mainstreaming", "formal school", "graduation", "goal", "outcome"] });

// ── 2 · Per-programme facts + decision logic ─────────────────────────────────
for (const k of PROGRAMS) {
  const p = byProgram.programs[k];
  const label = PLABEL[k];
  const msRate = pct(p.mainstream_rate);

  fact({ id: `enrolment.${k}`, category: "enrolment", subject: k, lens: "context",
    statement: `${label} has ${p.students.toLocaleString("en-US")} learners (${p.boys.toLocaleString("en-US")} boys, ${p.girls.toLocaleString("en-US")} girls).`,
    value: p.students, unit: "count", source: "summary_dataset.programs", tags: ["enrolment", label, "boys", "girls", "gender"] });

  // gender parity
  const girlShare = pct(p.girls / (p.boys + p.girls));
  fact({ id: `equity.gender.${k}`, category: "equity", subject: k,
    lens: girlShare >= RULES.genderParity.minGirlPct && girlShare <= RULES.genderParity.maxGirlPct ? "win" : "context",
    statement: `${label} is ${girlShare}% girls.`,
    value: girlShare, unit: "%", source: "student_profiles.Gender",
    tags: ["gender", "girls", "equity", "parity", label] });

  // mainstreaming — the north-star outcome (thresholds from RULES → consistent with the app)
  const lens = classifyMainstream(msRate);
  const sev = lens === "issue" ? "warn" : "info";
  fact({ id: `mainstream.${k}`, category: "mainstreaming", subject: k, lens, severity: sev,
    statement: `${label} has mainstreamed ${msRate}% of its learners (${p.mainstreamed.toLocaleString("en-US")} of ${p.students.toLocaleString("en-US")}).`,
    value: msRate, unit: "%", source: "student_profiles.Mainstream Status",
    tags: ["mainstream", "outcome", "graduation", label] });
  if (lens === "issue") {
    fact({ id: `action.mainstream.${k}`, category: "mainstreaming", subject: k, lens: "action", severity: "warn",
      statement: `${label}'s ${msRate}% mainstreaming rate is far below the network's ${pct(T.mainstream_rate)}% — investigate whether this cohort is early in its cycle or genuinely stalling.`,
      value: msRate, unit: "%", source: "derived", tags: ["mainstream", "action", "underperform", label] });
  }

  // attendance — coverage-aware
  const a = p.attendance;
  const cov = pct(a.coverage);
  fact({ id: `attendance.${k}`, category: "attendance", subject: k,
    lens: cov < RULES.attendance.qualityBelowCoveragePct ? "quality" : "context",
    severity: cov < RULES.attendance.criticalBelowCoveragePct ? "critical" : cov < RULES.attendance.captionBelowCoveragePct ? "warn" : "info",
    statement: `${label}: among learners with an attendance record, attendance averages ${round(a.recorded_mean, 1)}%, but only ${cov}% of learners have any record.`,
    value: round(a.recorded_mean, 1), unit: "%", coverage: a.coverage, source: "Student_attendance",
    tags: ["attendance", "coverage", "present", label] });

  // dropout reasons — top driver
  const dr = p.dropout_reasons;
  const total = Object.values(dr).reduce((s, v) => s + v, 0);
  const top = Object.entries(dr).sort((x, y) => y[1] - x[1])[0];
  fact({ id: `dropout.${k}.top`, category: "dropout", subject: k, lens: "issue", severity: "watch",
    statement: `In ${label}, the leading dropout reason is ${top[0]} (${top[1].toLocaleString("en-US")} learners, ${pct(top[1] / total)}% of ${label} dropouts).`,
    value: top[1], unit: "count", source: "student_profiles.Reason for Dropout",
    tags: ["dropout", "attrition", "leaving", top[0], label] });
}

// ── 3 · Learning (subject averages) with the coverage caveat ──────────────────
for (const k of PROGRAMS) {
  const subj = subjects.by_program[k]?.subjects ?? {};
  const ranked = Object.entries(subj)
    .map(([name, s]) => ({ name, mean: s.overall_mean ?? 0, blCov: s.by_stage?.BL?.coverage ?? 0 }))
    .filter((s) => s.mean > 0)
    .sort((a, b) => a.mean - b.mean);
  if (ranked.length === 0) continue;
  const weakest = ranked[0];
  fact({ id: `learning.${k}.weakest`, category: "learning", subject: k, lens: "action", severity: "watch",
    statement: `${PLABEL[k]}'s weakest subject is ${weakest.name}, averaging ${round(weakest.mean, 1)}.`,
    value: round(weakest.mean, 1), unit: "score", source: "student_assessment",
    tags: ["learning", "assessment", "subject", "weakest", "marks", weakest.name, PLABEL[k]] });
}
// global learning data-quality caveat (cycle marks barely recorded)
{
  const bl = subjects.by_program.abal?.subjects?.Bangla?.by_stage?.BL?.coverage ?? 0;
  const c1 = subjects.by_program.abal?.subjects?.Bangla?.by_stage?.C1?.coverage ?? 0;
  fact({ id: "quality.assessment.cycle-coverage", category: "learning", subject: "network", lens: "quality", severity: "warn",
    statement: `Assessment cycle marks are barely recorded: baseline coverage is ${pct(bl)}% but Cycle-1 coverage is only ${pct(c1)}%, so subject averages mostly reflect the baseline, not progress.`,
    value: pct(c1), unit: "%", coverage: c1, source: "student_assessment",
    tags: ["assessment", "coverage", "cycle", "data quality", "learning", "progress"] });
}

// ── 4 · Equity / demographics ─────────────────────────────────────────────────
{
  // disability across network
  let cwd = 0, known = 0;
  for (const k of PROGRAMS) {
    const dis = demographics.by_program[k]?.disability ?? {};
    for (const [type, n] of Object.entries(dis)) {
      if (type === "Not Applicable" || type === "-" || type === "Unknown") { known += n; continue; }
      cwd += n; known += n;
    }
  }
  fact({ id: "equity.disability.total", category: "equity", subject: "network", lens: "context",
    statement: `${cwd.toLocaleString("en-US")} learners are recorded with a disability (children with disabilities).`,
    value: cwd, unit: "count", source: "student_profiles.Disability Type",
    tags: ["disability", "cwd", "special needs", "equity", "inclusion"] });

  // nutrition (from summary_dataset)
  const nut = summary.nutrition ?? {};
  const nutTotal = Object.values(nut).reduce((s, v) => s + v, 0);
  if (nut.Bad != null) {
    fact({ id: "equity.nutrition.bad", category: "equity", subject: "network",
      lens: "issue", severity: "watch",
      statement: `${(nut.Bad).toLocaleString("en-US")} learners have "Bad" nutrition status (${pct(nut.Bad / nutTotal)}% of assessed).`,
      value: nut.Bad, unit: "count", source: "summary_dataset.nutrition",
      tags: ["nutrition", "health", "malnutrition", "equity", "welfare"] });
  }
}

// ── 5 · Divisions (concentration) ────────────────────────────────────────────
{
  const div = summary.divisions ?? {};
  const entries = Object.entries(div).sort((a, b) => b[1] - a[1]);
  const totalDiv = entries.reduce((s, [, v]) => s + v, 0);
  const [topName, topVal] = entries[0];
  fact({ id: "geography.concentration", category: "geography", subject: "network", lens: "context",
    statement: `Enrolment is concentrated in ${topName} (${topVal.toLocaleString("en-US")} learners, ${pct(topVal / totalDiv)}% of ${totalDiv.toLocaleString("en-US")}).`,
    value: topVal, unit: "count", source: "summary_dataset.divisions",
    tags: ["division", "geography", "concentration", topName, "region"] });
  for (const [name, v] of entries) {
    if (v < RULES.smallDivisionBelow) {
      fact({ id: `geography.thin.${name}`, category: "geography", subject: `division:${name}`, lens: "quality", severity: "watch",
        statement: `${name} has only ${v.toLocaleString("en-US")} learners — too few to compare against the large divisions.`,
        value: v, unit: "count", source: "summary_dataset.divisions",
        tags: ["division", name, "small sample", "data quality"] });
    }
  }
}

// ── 6 · Centres (M&E evaluation scores) ──────────────────────────────────────
{
  const evals = summary.me_evaluations ?? [];
  if (evals.length) {
    const scores = evals.map((e) => Number(e.score)).filter(Number.isFinite);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    // Center grade bands from the backend: 3-4 Good, 2-2.99 Fair, 1-1.99 Poor
    const good = scores.filter((s) => classifyGrade(s) === "Good").length;
    const fair = scores.filter((s) => classifyGrade(s) === "Fair").length;
    const poor = scores.filter((s) => classifyGrade(s) === "Poor").length;
    fact({ id: "centers.grade.mean", category: "centers", subject: "network", lens: "kpi",
      statement: `Across ${scores.length.toLocaleString("en-US")} evaluated centres the mean M&E score is ${round(mean, 2)} (of 4).`,
      value: round(mean, 2), unit: "score", source: "summary_dataset.me_evaluations",
      tags: ["center", "centre", "evaluation", "me", "grade", "quality", "score"] });
    fact({ id: "centers.grade.poor", category: "centers", subject: "network", lens: "action", severity: poor > good ? "warn" : "watch",
      statement: `${poor.toLocaleString("en-US")} centres score Poor (below 2 of 4), ${fair.toLocaleString("en-US")} Fair, and ${good.toLocaleString("en-US")} Good — the Poor centres are where field support should go first.`,
      value: poor, unit: "count", source: "summary_dataset.me_evaluations",
      tags: ["center", "poor", "action", "field visit", "support", "grade", "quality"] });

    // weakest M&E category on average
    const cats = ["pedagogy", "assessments", "documentation", "learning_environment", "engagement"];
    const catMeans = cats.map((c) => {
      const vals = evals.map((e) => Number(e[c])).filter(Number.isFinite);
      return { c, m: vals.reduce((s, v) => s + v, 0) / (vals.length || 1) };
    }).sort((a, b) => a.m - b.m);
    const weak = catMeans[0];
    fact({ id: "centers.weakest-category", category: "centers", subject: "network", lens: "action", severity: "watch",
      statement: `The weakest centre-quality dimension network-wide is ${weak.c.replace(/_/g, " ")}, averaging ${round(weak.m, 2)} of 4.`,
      value: round(weak.m, 2), unit: "score", source: "summary_dataset.me_evaluations",
      tags: ["center", "pedagogy", "documentation", "engagement", "weakest", "action", weak.c] });
  }

  // worst centres by attendance
  const worst = summary.worst_centers_by_attendance ?? [];
  if (worst.length) {
    fact({ id: "centers.worst-attendance", category: "centers", subject: "network", lens: "action", severity: "warn",
      statement: `${worst.length} centres are flagged for the lowest attendance and need a visit.`,
      value: worst.length, unit: "count", source: "summary_dataset.worst_centers_by_attendance",
      tags: ["center", "attendance", "worst", "visit", "action", "low"] });
  }
}

// ── 7 · Data-quality facts (the integrity findings, machine-readable) ─────────
fact({ id: "quality.attendance.zeros", category: "attendance", subject: "network", lens: "quality", severity: "critical",
  statement: `Attendance coverage network-wide is only ${pct(attendance.overall.coverage)}% — most rows are recorded as 0, and whether 0 means "no record" or "never attended" is unresolved.`,
  value: pct(attendance.overall.coverage), unit: "%", coverage: attendance.overall.coverage, source: "Student_attendance",
  tags: ["attendance", "coverage", "data quality", "zeros", "unresolved"] });

fact({ id: "quality.id-join", category: "schema", subject: "network", lens: "quality", severity: "warn",
  statement: `Attendance cannot be joined to a learner: profiles/assessment use a 12-digit Student ID while attendance uses a different key, so per-student attendance and risk scoring are not yet computable.`,
  value: 0, unit: "", source: "schema", tags: ["join", "id", "schema", "attendance", "risk", "data quality"] });

// ── Build the decision dashboard (metrics.json) ──────────────────────────────
const byLens = (lens) => facts.filter((f) => f.lens === lens);
const metrics = {
  kpis: byLens("kpi").map((f) => ({ id: f.id, statement: f.statement, value: f.value, unit: f.unit })),
  wins: byLens("win").map((f) => ({ id: f.id, statement: f.statement })),
  issues: byLens("issue").concat(byLens("quality").filter((f) => f.severity === "critical"))
    .map((f) => ({ id: f.id, statement: f.statement, severity: f.severity })),
  actions: byLens("action").map((f) => ({ id: f.id, statement: f.statement, severity: f.severity })),
  dataQuality: byLens("quality").map((f) => ({ id: f.id, statement: f.statement, severity: f.severity })),
};

// ── Schema + relations (the "flow" of the database) ──────────────────────────
const schema = {
  tables: {
    student_profiles: { grain: "one row per learner", key: "Student ID (12-digit, Excel-escaped =\"…\")",
      rows: PROGRAMS.reduce((s, k) => s + (demographics.by_program[k]?.rows ?? 0), 0),
      columns: 34, notable: ["Mainstream Status", "Reason for Dropout", "Gender", "Disability Type", "Nutrition", "Division", "Center ID"] },
    student_assessment: { grain: "one row per learner", key: "Student ID (12-digit, clean)",
      columns: 44, notable: ["<Subject> BL (baseline)", "<Subject> C1..C5 (cycles)"] },
    student_attendance: { grain: "one row per learner (contaminated)", key: "Student ID (≠ profiles format)",
      columns: 4, notable: ["Attendance(In Percent)"] },
    me_evaluation: { grain: "one row per centre visit", key: "Center ID",
      columns: 36, notable: ["Pedagogy", "Assessments", "Documentation", "Learning Environment", "Community & Family Engagement", "GPS"] },
    teacher_profiles: { grain: "one row per teacher", key: "Center ID",
      rows: teachers.rows, columns: 17, notable: ["Teacher Education", "Teacher Experience", "Employment Status", "Division"] },
  },
  relations: [
    { from: "student_profiles.Student ID", to: "student_assessment.Student ID", type: "1:1", strength: "strong (~99.6%)", note: "strip =\"…\" wrapper first" },
    { from: "student_profiles.Center ID", to: "me_evaluation.Center ID", type: "N:1", strength: "partial (~64%)" },
    { from: "student_profiles.Center ID", to: "teacher_profiles.Center ID", type: "N:1", strength: "partial (~50%)" },
    { from: "student_profiles.Student ID[0:9]", to: "student_profiles.Center ID", type: "prefix", strength: "~85%", note: "Student ID embeds Center ID" },
    { from: "student_attendance.Student ID", to: "student_profiles.Student ID", type: "BROKEN", strength: "0% — different key space + test rows" },
  ],
  programs: PROGRAMS,
};

// ── Manifest (version hash → drives incremental invalidation + learning loop) ─
const factsJson = JSON.stringify(facts);
const version = crypto.createHash("sha1").update(factsJson).digest("hex").slice(0, 12);
const manifest = {
  version,
  generated_from: "summary_dataset.json + Database/aggregates/*",
  counts: {
    facts: facts.length,
    kpis: metrics.kpis.length, wins: metrics.wins.length,
    issues: metrics.issues.length, actions: metrics.actions.length, dataQuality: metrics.dataQuality.length,
  },
  // stamped by the caller, not here (Date.now would break determinism if invoked in a workflow)
};

// ── Write ─────────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const write = (name, data) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
  const kb = (fs.statSync(path.join(OUT, name)).size / 1024).toFixed(1);
  console.log(`  → kb/${name} (${kb} kB)`);
};
console.log("Building knowledge base → Database/kb/ …\n");
write("facts.json", { version, facts });
write("metrics.json", { version, ...metrics });
write("schema.json", { version, ...schema });
write("rules.json", { version, rules: RULES });
write("manifest.json", manifest);

console.log(`\nKB version ${version}: ${facts.length} facts · ` +
  `${metrics.kpis.length} KPIs · ${metrics.wins.length} wins · ${metrics.issues.length} issues · ` +
  `${metrics.actions.length} actions · ${metrics.dataQuality.length} data-quality flags`);
console.log(`Facts payload: ${(factsJson.length / 1024).toFixed(1)} kB (vs ~105 MB of raw CSVs)`);
