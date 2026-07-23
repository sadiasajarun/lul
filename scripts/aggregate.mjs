/**
 * Build-time aggregation (REVAMP PART 5).
 *
 * Reads the raw CSVs in Database/ ONCE and emits small, PII-free JSON aggregates to
 * Database/aggregates/. All dashboard views read only those aggregates — never the raw CSVs.
 * (The ask/RAG path still reads raw CSVs for row-level lookups; that is by design.)
 *
 * Run:  npm run aggregate
 *
 * PII RULE: aggregates contain counts and means only. No names, parent income, GPS,
 * or row-level religion/ethnicity. Student IDs appear only in risk_scores.json.
 *
 * NOTE: written as .mjs (not .ts) so it runs on plain `node` with zero extra deps.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = path.resolve(__dirname, "../Database");
const OUT = path.join(DB, "aggregates");

// ── CSV parsing ───────────────────────────────────────────────────────────────

/** Parse one CSV line, honouring quoted fields containing commas. */
function parseLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (c === "," && !q) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Stream a CSV, invoking `onRow(rowObject)` per well-formed row.
 * Reads in chunks so a 59 MB file never lands in memory whole.
 */
function readCsv(file, onRow) {
  const full = path.join(DB, file);
  if (!fs.existsSync(full)) {
    console.warn(`  ! missing: ${file}`);
    return { rows: 0, malformed: 0 };
  }
  const fd = fs.openSync(full, "r");
  const CHUNK = 1 << 20; // 1 MiB
  const buf = Buffer.alloc(CHUNK);
  let leftover = "";
  let header = null;
  let rows = 0;
  let malformed = 0;

  for (;;) {
    const bytes = fs.readSync(fd, buf, 0, CHUNK, null);
    if (bytes <= 0) break;
    const text = leftover + buf.toString("utf8", 0, bytes);
    const lines = text.split(/\r?\n/);
    leftover = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const cells = parseLine(line);
      if (!header) { header = cells.map((h) => h.trim().replace(/^"|"$/g, "")); continue; }
      if (cells.length !== header.length) { malformed++; continue; }
      const row = {};
      for (let i = 0; i < header.length; i++) row[header[i]] = cells[i];
      onRow(row);
      rows++;
    }
  }
  fs.closeSync(fd);

  if (leftover.trim() && header) {
    const cells = parseLine(leftover);
    if (cells.length === header.length) {
      const row = {};
      for (let i = 0; i < header.length; i++) row[header[i]] = cells[i];
      onRow(row);
      rows++;
    } else malformed++;
  }
  return { rows, malformed };
}

const num = (v) => {
  const n = parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
};

// ── File map ──────────────────────────────────────────────────────────────────

const PROGRAMS = ["abal", "catchup", "innovation"];

const FILES = {
  attendance: {
    abal: "Student_attendance_nfpe_emdc_abal_1753591706_54883675213.csv",
    catchup: "Student_attendance_nfpe_emdc_catchup_1753589584_47273904490.csv",
    innovation: "Student_attendance_nfpe_emdc_innovation_1753589529_23649853491.csv",
  },
  profiles: {
    abal: "student_profiles_nfpe_emdc_abal_1753357534_53025529570.csv",
    catchup: "student_profiles_nfpe_emdc_catchup_1753352569_1473735157.csv",
    innovation: "student_profiles_nfpe_emdc_innovation_1753351727_78908433930.csv",
  },
  assessments: {
    abal: "student_assessment_nfpe_cycle_wise_emdc_abal_1753593880_11894330390.csv",
    catchup: "student_assessment_nfpe_cycle_wise_emdc_catchup_1753593862_32092086077.csv",
    innovation: "student_assessment_nfpe_cycle_wise_emdc_innovation_1753593848_60993298022.csv",
  },
  teachers: "teacher_profiles_1753674396_32784295895.csv",
};

const SUBJECTS = ["Bangla", "Mathematics", "English", "Science", "BGS", "Life Skills", "Religion"];

// ── 1 · Attendance ────────────────────────────────────────────────────────────
//
// THE HEADLINE FINDING. The per-programme means in summary_dataset.json (60.98 / 1.31 / 1.70)
// are dominated by rows recorded as 0. Among students with a NON-ZERO record, every programme
// sits at 86-97%. So the programme spread measures RECORD COVERAGE, not attendance behaviour.
//
// We therefore publish `recorded_mean` (mean over students with a >0 record) alongside an
// explicit `coverage` so the UI can never present a coverage artifact as a behaviour fact.
//
// UNRESOLVED: whether a 0 means "no record kept" or "genuinely never attended" is not
// determinable from this data. `zero_meaning: "unknown"` records that honestly.

function aggregateAttendance() {
  const byProgram = {};
  // distribution bins over students WITH a record (>0)
  const BINS = [
    [0, 10], [10, 20], [20, 30], [30, 40], [40, 50],
    [50, 60], [60, 70], [70, 80], [80, 90], [90, 100.01],
  ];

  for (const p of PROGRAMS) {
    let total = 0, zeros = 0, recorded = 0, sumRecorded = 0, sumAll = 0;
    const bins = BINS.map(() => 0);

    readCsv(FILES.attendance[p], (row) => {
      const key = Object.keys(row).find((k) => /attendance/i.test(k));
      const v = num(row[key]);
      if (v === null) return;
      total++;
      sumAll += v;
      if (v === 0) { zeros++; return; }
      recorded++;
      sumRecorded += v;
      const bi = BINS.findIndex(([lo, hi]) => v >= lo && v < hi);
      if (bi >= 0) bins[bi]++;
    });

    byProgram[p] = {
      rows: total,
      zero_count: zeros,
      recorded_count: recorded,
      coverage: total ? recorded / total : 0,
      recorded_mean: recorded ? sumRecorded / recorded : null,
      raw_mean_including_zeros: total ? sumAll / total : null,
      distribution: BINS.map(([lo, hi], i) => ({ bin: `${lo}-${hi === 100.01 ? 100 : hi}`, count: bins[i] })),
    };
    console.log(
      `  attendance/${p}: rows=${total} recorded=${recorded} ` +
      `coverage=${(byProgram[p].coverage * 100).toFixed(1)}% ` +
      `recorded_mean=${byProgram[p].recorded_mean?.toFixed(2)}%`
    );
  }

  const totalRows = PROGRAMS.reduce((s, p) => s + byProgram[p].rows, 0);
  const totalRecorded = PROGRAMS.reduce((s, p) => s + byProgram[p].recorded_count, 0);
  const weightedRecorded =
    PROGRAMS.reduce((s, p) => s + (byProgram[p].recorded_mean ?? 0) * byProgram[p].recorded_count, 0) /
    (totalRecorded || 1);
  const weightedRaw =
    PROGRAMS.reduce((s, p) => s + (byProgram[p].raw_mean_including_zeros ?? 0) * byProgram[p].rows, 0) /
    (totalRows || 1);

  return {
    zero_meaning: "unknown",
    note:
      "Rows recorded as 0 dominate Catchup (98.5%) and Innovation (98.2%). Among students with a " +
      "non-zero record every programme sits at 86-97%, so the programme-level spread reflects record " +
      "coverage, not attendance behaviour. Whether 0 means 'no record' or 'never attended' is not " +
      "determinable from this dataset and must be confirmed with the data owner.",
    by_program: byProgram,
    overall: {
      rows: totalRows,
      recorded_count: totalRecorded,
      coverage: totalRows ? totalRecorded / totalRows : 0,
      recorded_mean_student_weighted: weightedRecorded,
      raw_mean_student_weighted_including_zeros: weightedRaw,
    },
  };
}

// ── 2 · Assessment averages by subject ────────────────────────────────────────
// Columns are `<Subject> BL` (baseline) and `<Subject> C1..C5` (cycles).

function aggregateSubjects() {
  const byProgram = {};
  for (const p of PROGRAMS) {
    const acc = {};
    let rows = 0;
    readCsv(FILES.assessments[p], (row) => {
      rows++;
      for (const subj of SUBJECTS) {
        // "Math BL" is the baseline header for Mathematics in these exports.
        const blKey = subj === "Mathematics" ? "Math BL" : `${subj} BL`;
        const cols = [blKey, ...[1, 2, 3, 4, 5].map((c) => `${subj} C${c}`)];
        for (const col of cols) {
          if (!(col in row)) continue;
          const v = num(row[col]);
          if (v === null) continue;
          const stage = col.endsWith("BL") ? "BL" : col.slice(-2);
          acc[subj] ??= {};
          acc[subj][stage] ??= { sum: 0, n: 0 };
          acc[subj][stage].sum += v;
          acc[subj][stage].n++;
        }
      }
    });

    const subjects = {};
    for (const [subj, stages] of Object.entries(acc)) {
      const perStage = {};
      let sum = 0, n = 0;
      for (const [stage, { sum: s, n: c }] of Object.entries(stages)) {
        perStage[stage] = { mean: c ? s / c : null, count: c, coverage: rows ? c / rows : 0 };
        sum += s; n += c;
      }
      subjects[subj] = { overall_mean: n ? sum / n : null, graded_count: n, by_stage: perStage };
    }
    byProgram[p] = { rows, subjects };
    console.log(`  subjects/${p}: rows=${rows} subjects=${Object.keys(subjects).length}`);
  }
  return { by_program: byProgram };
}

// ── 3 · Demographics from student profiles (counts only — no PII) ─────────────

function aggregateDemographics() {
  const byProgram = {};
  const tally = (map, key) => {
    const k = String(key ?? "").trim() || "Unknown";
    map[k] = (map[k] ?? 0) + 1;
  };

  for (const p of PROGRAMS) {
    const gender = {}, disability = {}, ethnicity = {}, religion = {}, nutrition = {}, division = {};
    let rows = 0;
    readCsv(FILES.profiles[p], (row) => {
      rows++;
      tally(gender, row["Gender"]);
      tally(disability, row["Disability Type"]);
      tally(ethnicity, row["Ethnicity"]);
      tally(religion, row["Religion"]);
      tally(nutrition, row["Nutrition"]);
      tally(division, row["Division"]);
    });
    byProgram[p] = { rows, gender, disability, ethnicity, religion, nutrition, division };
    console.log(`  demographics/${p}: rows=${rows}`);
  }
  return { by_program: byProgram };
}

// ── 4 · Teachers (counts only) ────────────────────────────────────────────────

function aggregateTeachers() {
  const gender = {}, division = {}, education = {}, experience = {}, employment = {};
  let rows = 0;
  const tally = (map, key) => {
    const k = String(key ?? "").trim() || "Unknown";
    map[k] = (map[k] ?? 0) + 1;
  };
  readCsv(FILES.teachers, (row) => {
    rows++;
    tally(gender, row["Gender"]);
    tally(division, row["Division"]);
    tally(education, row["Teacher Education"]);
    tally(experience, row["Teacher Experience"]);
    tally(employment, row["Employment Status"]);
  });
  console.log(`  teachers: rows=${rows}`);
  return { rows, gender, division, education, experience, employment };
}

// ── 5 · Programme rollup (summary_dataset + computed attendance) ──────────────

function buildByProgram(summary, attendance) {
  const out = {};
  for (const p of PROGRAMS) {
    const s = summary.programs[p];
    const a = attendance.by_program[p];
    out[p] = {
      students: s.students,
      boys: s.boys,
      girls: s.girls,
      mainstreamed: s.mainstreamed,
      mainstream_rate: s.students ? s.mainstreamed / s.students : null,
      dropout_reasons: s.dropout_reasons,
      attendance: {
        recorded_mean: a.recorded_mean,
        coverage: a.coverage,
        recorded_count: a.recorded_count,
        raw_mean_including_zeros: a.raw_mean_including_zeros,
        summary_dataset_value: s.avg_attendance, // the number the old tile used
      },
    };
  }
  const totalStudents = PROGRAMS.reduce((t, p) => t + out[p].students, 0);
  const totalMainstreamed = PROGRAMS.reduce((t, p) => t + out[p].mainstreamed, 0);
  return {
    programs: out,
    totals: {
      students: totalStudents,
      teachers: summary.teachers.total,
      programs: PROGRAMS.length,
      mainstreamed: totalMainstreamed,
      mainstream_rate: totalStudents ? totalMainstreamed / totalStudents : null,
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  const t0 = Date.now();
  fs.mkdirSync(OUT, { recursive: true });
  const summary = JSON.parse(fs.readFileSync(path.join(DB, "summary_dataset.json"), "utf8"));

  console.log("Aggregating Database/ → Database/aggregates/ …\n");

  console.log("· attendance");
  const attendance = aggregateAttendance();

  console.log("· subjects");
  const subjects = aggregateSubjects();

  console.log("· demographics");
  const demographics = aggregateDemographics();

  console.log("· teachers");
  const teachers = aggregateTeachers();

  const byProgram = buildByProgram(summary, attendance);
  const byDivision = {
    students: summary.divisions,
    teachers: teachers.division,
    source: "summary_dataset.json:divisions + teacher_profiles",
  };

  const generated = { generated_by: "scripts/aggregate.mjs", source: "Database/*.csv + summary_dataset.json" };
  const write = (name, data) => {
    fs.writeFileSync(path.join(OUT, name), JSON.stringify({ ...generated, ...data }, null, 2));
    const kb = (fs.statSync(path.join(OUT, name)).size / 1024).toFixed(1);
    console.log(`  → ${name} (${kb} kB)`);
  };

  console.log("\nWriting aggregates:");
  write("by_program.json", byProgram);
  write("by_division.json", byDivision);
  write("by_subject.json", subjects);
  write("attendance.json", attendance);
  write("demographics.json", demographics);
  write("teachers.json", teachers);

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
