// Deterministic ROW / RANKING / RESULT-SHEET / GROUP engine.
//
// The aggregate engines (local keyword router + LLM over summaries) cannot answer per-student
// questions like "best student result sheet", "4th best student", "top 10 students in Rangpur",
// "which student has the worst nutrition", or grouping questions like "which centre has the most
// at-risk students" — the row data never reaches them and superlatives need real ranking. This
// module loads the clean demo CSVs, filters, ranks/aggregates, and returns an exact answer (table +
// chart). It runs regardless of provider because correctness > phrasing.

import studentsUrl from "../../../Database/demo/students.csv?url";
import assessmentsUrl from "../../../Database/demo/assessments.csv?url";
import evaluationsUrl from "../../../Database/demo/evaluations.csv?url";
import db from "../../../Database/demo/summary_dataset.json";
import type { DashboardWidget, DynamicDashboardResponse } from "./openAIHelper";

type Row = Record<string, string>;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.replace(/^=/, "").trim());
}

/** Parse a CSV into row objects, dropping faker/test rows (numeric key in column 1 only). */
function parseCsv(text: string): { headers: string[]; rows: Row[] } {
  const lines = text.split(/\r?\n/);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]);
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (!/^"?=?"?[0-9]{3,}/.test(line)) continue;             // clean-data gate: numeric key
    if (/\btest\b|lorem|ipsum|faker/i.test(line)) continue;
    const cells = splitCsvLine(line);
    const row: Row = {};
    headers.forEach((h, j) => { row[h] = cells[j] ?? ""; });
    rows.push(row);
  }
  return { headers, rows };
}

let _students: { headers: string[]; rows: Row[] } | null = null;
let _assessments: { headers: string[]; rows: Row[] } | null = null;
let _evaluations: { headers: string[]; rows: Row[] } | null = null;
async function loadStudents() { if (!_students) _students = parseCsv(await (await fetch(studentsUrl)).text()); return _students; }
async function loadAssessments() { if (!_assessments) _assessments = parseCsv(await (await fetch(assessmentsUrl)).text()); return _assessments; }
async function loadEvaluations() { if (!_evaluations) _evaluations = parseCsv(await (await fetch(evaluationsUrl)).text()); return _evaluations; }

const DIVISIONS = ["Dhaka", "Chattogram", "Rajshahi", "Khulna", "Barishal", "Sylhet", "Rangpur", "Mymensingh"];
const PROGRAMS: Record<string, string> = { abal: "ABAL", catchup: "Catchup", innovation: "Innovation" };
const CENTER_NAME: Record<string, string> = {};
for (const e of (db as { me_evaluations: { center_id: string; center_name: string }[] }).me_evaluations) CENTER_NAME[e.center_id] = e.center_name;
const fmt = (n: number) => n.toLocaleString("en-US");

/** M&E / centre-evaluation question (uses evaluations.csv). Deliberately NOT triggered by student
 *  metrics (attendance / marks / nutrition / dropout), which are per-student, not per-centre. */
function isMEQuery(p: string): boolean {
  if (/attendance|nutrition|\bmarks?\b|dropout|enrol/.test(p)) return false;
  if (/\bm&e\b|\bm ?and ?e\b|\bmonitor(ing)?\b|\bevaluation\b|pedagog|documentation|learning environment|\bengagement\b|days since|overdue|\binspect|assessment practice/.test(p)) return true;
  if (/\bvisit(ed|s|ing)?\b/.test(p) && /\b(centre|center)s?\b/.test(p)) return true;
  if (/\b(centre|center)s?\b/.test(p) && /\b(score|band|rating)\b/.test(p)) return true; // "centre score/band"
  return false;
}

/** Is this a per-student row / ranking / result-sheet / grouping / M&E question? */
export function isRowQuery(prompt: string): boolean {
  const p = prompt.toLowerCase();
  if (isMEQuery(p)) return true;
  if (/result sheet|report card|mark ?sheet|marksheet/.test(p)) return true;
  const perStudent = /\bstudents?\b|\blearners?\b|\bpupils?\b|\bchild(ren)?\b/.test(p);
  const ranking = /\btop\s*\d+\b|\b\d+\s*(?:st|nd|rd|th)\b|\b(top|bottom|best|worst|highest|lowest|strongest|weakest|most|least|fewest)\b/.test(p);
  const risk = /\b(at.?risk|at\s+\w+\s+risk|drop.?out risk|risk of drop|dropouts?|may leave|likely to (leave|drop)|risk of (drop|leav))\b/.test(p);
  const which = /\bwhich\s+(student|learner|pupil|child|centre|center|division|district)\b|\bname (the|of)\b|\b(list (of )?(students?|learners?|pupils?)|(students?|learners?|pupils?)'? list)\b/.test(p);
  if (perStudent && (ranking || risk)) return true;
  if (which) return true;
  return false;
}

interface Parsed {
  metricCol: string; metricLabel: string; desc: boolean;
  limit: number; rankIndex: number; resultSheet: boolean; singular: boolean;
  nutrition: string | null;
  filters: { key: string; val: string; label: string }[];
}

function parseQuery(p: string): Parsed {
  // metric to rank by
  let metricCol = "latest_avg_score", metricLabel = "Avg score";
  if (/attendance|present|absent|attend/.test(p)) { metricCol = "attendance_pct"; metricLabel = "Attendance %"; }
  else if (/\bbaseline|\bintake|starting (score|mark)|entry (score|mark)/.test(p)) { metricCol = "baseline_avg_score"; metricLabel = "Baseline score"; }
  else if (/\brisk\b|drop ?out|may leave|at.?risk|leave school/.test(p)) { metricCol = "risk_score"; metricLabel = "Risk score"; }

  // order — best/top → desc; worst/lowest → asc. For risk, "most at risk" = highest = desc.
  const worst = /\b(worst|lowest|bottom|weakest|least|poor|struggl|fail)\b/.test(p);
  let desc = !worst;
  if (metricCol === "risk_score") desc = !/\b(least|lowest|safest|low risk)\b/.test(p);

  // ordinal ("4th best") vs count ("top 10")
  const ordM = p.match(/\b(\d+)\s*(?:st|nd|rd|th)\b/);
  const rankIndex = ordM ? Math.max(0, parseInt(ordM[1], 10) - 1) : 0;
  const resultSheet = /result sheet|report card|mark ?sheet|marksheet/.test(p);
  const singular = !ordM && !/\d/.test(p) && /\b(the )?(best|worst|top|highest|lowest) (student|learner|performer|pupil)\b|\bwhich (student|learner|pupil)\b/.test(p);
  const nMatch = !ordM ? p.match(/\b(?:top|bottom|first|last)?\s*(\d{1,3})\b/) : null;
  let limit = nMatch ? Math.min(parseInt(nMatch[1], 10), 50) : (resultSheet || singular || ordM ? 1 : 10);
  if (limit < 1) limit = 1;

  // nutrition (categorical)
  let nutrition: string | null = null;
  if (/nutrition|malnour|malnutri|underweight/.test(p)) {
    if (/\b(bad|worst|poor|critical|malnour|severe)\b/.test(p)) nutrition = "Bad";
    else if (/not so good|moderate|concern/.test(p)) nutrition = "Not so good";
    else if (/\bgood\b|healthy/.test(p)) nutrition = "Good";
    else nutrition = "Bad";
  }

  // filters
  const filters: { key: string; val: string; label: string }[] = [];
  for (const d of DIVISIONS) if (p.includes(d.toLowerCase())) filters.push({ key: "division", val: d, label: d });
  for (const k of Object.keys(PROGRAMS)) if (new RegExp(`\\b${k}\\b`).test(p)) filters.push({ key: "program", val: PROGRAMS[k], label: PROGRAMS[k] });
  if (/\bgirls?\b|\bfemale\b/.test(p)) filters.push({ key: "gender", val: "Girl", label: "Girls" });
  else if (/\bboys?\b|\bmale\b/.test(p)) filters.push({ key: "gender", val: "Boy", label: "Boys" });
  const gradeM = p.match(/\bgrade\s*([1-5])\b|\bg([1-5])\b|\bclass\s*([1-5])\b/);
  if (gradeM) { const g = gradeM[1] || gradeM[2] || gradeM[3]; filters.push({ key: "grade", val: `G${g}`, label: `Grade ${g}` }); }

  return { metricCol, metricLabel, desc, limit, rankIndex, resultSheet, singular, nutrition, filters };
}

/** Answer an M&E / centre-evaluation question from evaluations.csv (visit recency + score ranking). */
async function meQuery(p: string): Promise<DynamicDashboardResponse | null> {
  const { rows } = await loadEvaluations();
  if (!rows.length) return null;

  let ev = rows;
  const scopeParts: string[] = [];
  for (const d of DIVISIONS) if (p.includes(d.toLowerCase())) { ev = ev.filter((r) => (r.division || "").toLowerCase() === d.toLowerCase()); scopeParts.push(d); }
  for (const k of Object.keys(PROGRAMS)) if (new RegExp(`\\b${k}\\b`).test(p)) { ev = ev.filter((r) => (r.program || "").toLowerCase().includes(k)); scopeParts.push(PROGRAMS[k]); }
  const scope = scopeParts.join(" · ") || "all centres";
  if (!ev.length) return { summary: `* No centres match this scope (${scope}).`, widgets: [] };

  // ── VISIT RECENCY: "which centres didn't have M&E in the last 2 months / are overdue" ──
  const timeM = p.match(/(\d+)\s*(month|week|day)/);
  const negation = /\b(didn'?t|did not|not|no|without|missed|overdue|haven'?t|hasn'?t|never|due for|pending)\b/.test(p);
  const visitWord = /\b(visit|m&e|m ?and ?e|monitor|evaluat|inspect|seen)\b/.test(p);
  if (visitWord && (timeM || negation)) {
    let thresholdDays = 60;
    let windowLabel = "2 months";
    if (timeM) {
      const n = parseInt(timeM[1], 10);
      const unit = timeM[2];
      thresholdDays = unit === "month" ? n * 30 : unit === "week" ? n * 7 : n;
      windowLabel = `${n} ${unit}${n > 1 ? "s" : ""}`;
    }
    const overdue = ev
      .filter((r) => Number(r.days_since_visit) > thresholdDays)
      .sort((a, b) => Number(b.days_since_visit) - Number(a.days_since_visit));
    if (!overdue.length) return { summary: `* Every centre in scope (${scope}) has had an M&E visit within the last ${windowLabel} — none are overdue.`, widgets: [] };
    const show = overdue.slice(0, 20);
    return {
      summary: `* **${overdue.length} centres** (${scope}) have had **no M&E visit in the last ${windowLabel}** (> ${thresholdDays} days).\n* Longest gap: **${overdue[0].center_name}** — **${overdue[0].days_since_visit} days** since its last visit.`,
      widgets: [
        { type: "metrics", title: "Overdue M&E", width: "full", metricsList: [
          { label: `No visit in ${windowLabel}`, value: String(overdue.length), sub: `centres · ${scope}`, trendDirection: "down" },
          { label: "Longest gap", value: `${overdue[0].days_since_visit} days`, sub: overdue[0].center_name },
        ]},
        { type: "table", title: `Centres with no M&E visit in the last ${windowLabel}`, width: "full",
          tableHeaders: ["Centre", "Division", "Program", "Days since visit", "Last score", "Band"],
          data: show.map((r) => ({ Centre: r.center_name, Division: r.division, Program: r.program, "Days since visit": Number(r.days_since_visit), "Last score": Number(r.score), Band: r.band })) },
      ],
    };
  }

  // ── M&E SCORE / DIMENSION RANKING ──
  let col = "score", label = "M&E score";
  if (/pedagog/.test(p)) { col = "pedagogy"; label = "Pedagogy"; }
  else if (/document/.test(p)) { col = "documentation"; label = "Documentation"; }
  else if (/learning environment|environment/.test(p)) { col = "learning_environment"; label = "Learning env"; }
  else if (/engagement/.test(p)) { col = "engagement"; label = "Engagement"; }
  else if (/assessment/.test(p)) { col = "assessments"; label = "Assessments"; }
  const asc = /\b(lowest|worst|bottom|weakest|poor|least)\b/.test(p);
  const limM = p.match(/\btop\s*(\d+)\b|\b(\d+)\s*(?:centre|center)/);
  const limit = limM ? Math.min(parseInt(limM[1] || limM[2], 10), 40) : 10;
  const sorted = [...ev].sort((a, b) => asc ? Number(a[col]) - Number(b[col]) : Number(b[col]) - Number(a[col]));
  const show = sorted.slice(0, limit);
  const dir = asc ? "Lowest" : "Highest";
  return {
    summary: `* ${dir}-${label.toLowerCase()} centre in scope (${scope}): **${show[0].center_name}** at **${Number(show[0][col])}** (band ${show[0].band}).\n* Centres ranked by ${label}; full list below.`,
    widgets: [
      { type: "chart", title: `${dir} ${label} — ${scope}`, width: "full", chartType: "bar", xAxisKey: "name", seriesKeys: [label],
        data: show.map((r) => ({ name: r.center_name.length > 16 ? r.center_name.slice(0, 15) + "…" : r.center_name, [label]: Number(r[col]) })) },
      { type: "table", title: `Centres ranked by ${label}`, width: "full", tableHeaders: ["Rank", "Centre", "Division", "Program", label, "Band"],
        data: show.map((r, i) => ({ Rank: i + 1, Centre: r.center_name, Division: r.division, Program: r.program, [label]: Number(r[col]), Band: r.band })) },
    ],
  };
}

/** Answer a row/ranking/result-sheet/group/M&E question from the CSVs, or null if it can't be built. */
export async function rowQuery(prompt: string): Promise<DynamicDashboardResponse | null> {
  const p = prompt.toLowerCase();
  if (isMEQuery(p)) { const me = await meQuery(p); if (me) return me; }
  const q = parseQuery(p);
  const { rows } = await loadStudents();
  if (!rows.length) return null;

  let filtered = rows;
  for (const f of q.filters) filtered = filtered.filter((r) => (r[f.key] || "").toLowerCase() === f.val.toLowerCase());
  const scope = q.filters.map((f) => f.label).join(" · ") || "all students";
  if (!filtered.length) return { summary: `* No students match this scope (${scope}).`, widgets: [] };

  // ── GROUP AGGREGATION: "which centre/division has the most [at-risk/bad-nutrition/low-scoring] students" ──
  const specificDiv = q.filters.some((f) => f.key === "division");
  const groupCentre = /\b(centre|center)s?\b/.test(p);
  const groupDivision = !specificDiv && (/\b(which|per|by|each)\s+(division|district)\b/.test(p) || /\b(division|district)s?\s+(with|has|got|have|having)\b/.test(p) || /\bmost\b[\s\S]*\b(division|district)\b/.test(p));
  const dimKey = groupCentre ? "center_id" : groupDivision ? (/\bdistrict\b/.test(p) ? "district" : "division") : null;
  if (dimKey) {
    const dimLabelG = dimKey === "center_id" ? "Centre" : dimKey === "district" ? "District" : "Division";
    const nameOfG = (g: string) => dimKey === "center_id" ? (CENTER_NAME[g] || `Centre ${g}`) : g;

    // ── AVERAGE a metric per group: "which centre has the lowest attendance / highest avg score" ──
    const avgAttendance = /attendance|present|absent/.test(p);
    const avgScore = !avgAttendance && /\b(score|marks?|result|grade|performance|perform)\b/.test(p) && !/\brisk\b/.test(p);
    if (avgAttendance || avgScore) {
      const col = avgAttendance ? "attendance_pct" : "latest_avg_score";
      const metricLabel = avgAttendance ? "Avg attendance %" : "Avg score";
      const unit = avgAttendance ? "%" : "";
      const agg = new Map<string, { sum: number; n: number }>();
      for (const r of filtered) {
        const v = Number(r[col]);
        if (!Number.isFinite(v)) continue;
        const cur = agg.get(r[dimKey]) ?? { sum: 0, n: 0 };
        cur.sum += v; cur.n += 1; agg.set(r[dimKey], cur);
      }
      const rowsA = [...agg.entries()].map(([g, s]) => ({ g, avg: Math.round((s.sum / s.n) * 10) / 10, n: s.n }));
      if (!rowsA.length) return { summary: `* No data to average by ${dimLabelG.toLowerCase()} in scope (${scope}).`, widgets: [] };
      const asc = /\b(lowest|worst|least|bottom|poorest|weakest)\b/.test(p);
      rowsA.sort((a, b) => asc ? a.avg - b.avg : b.avg - a.avg);
      const showA = rowsA.slice(0, 12);
      const topA = rowsA[0];
      const widgetsA: DashboardWidget[] = [
        { type: "metrics", title: "Group summary", width: "full", metricsList: [
          { label: `${asc ? "Lowest" : "Highest"} ${dimLabelG.toLowerCase()}`, value: nameOfG(topA.g), sub: `${metricLabel} ${topA.avg}${unit} · ${topA.n} students`, trendDirection: asc ? "down" : "up" },
          { label: `${dimLabelG}s ranked`, value: String(rowsA.length), sub: scope },
        ]},
        { type: "chart", title: `${metricLabel} by ${dimLabelG.toLowerCase()}`, width: "full", chartType: "bar", xAxisKey: "name", seriesKeys: [metricLabel],
          data: showA.map((e) => ({ name: nameOfG(e.g).length > 16 ? nameOfG(e.g).slice(0, 15) + "…" : nameOfG(e.g), [metricLabel]: e.avg })) },
        { type: "table", title: `${dimLabelG}s by ${metricLabel}`, width: "full", tableHeaders: ["Rank", dimLabelG, metricLabel, "Students"],
          data: showA.map((e, i) => ({ Rank: i + 1, [dimLabelG]: nameOfG(e.g), [metricLabel]: `${e.avg}${unit}`, Students: e.n })) },
      ];
      return {
        summary: `* **${nameOfG(topA.g)}** has the ${asc ? "lowest" : "highest"} ${metricLabel.toLowerCase()} — **${topA.avg}${unit}** (across ${topA.n} students).\n* ${dimLabelG}s ranked by average ${avgAttendance ? "attendance" : "score"}; full list below.`,
        widgets: widgetsA,
      };
    }

    const atRisk = /risk|drop ?out|leave|attrition/.test(p);
    const badNut = /nutrition|malnour/.test(p);
    const lowScore = /(low|fail|weak|poor|struggl|underperform).*(score|mark|result|perform)|underperform/.test(p);
    const cond = (r: Row) =>
      atRisk ? /^(high|critical)$/i.test(r.risk_band) :
      badNut ? (r.nutrition || "").toLowerCase() === "bad" :
      lowScore ? Number(r.latest_avg_score) < 45 : true;
    const condLabel = atRisk ? "at-risk (High/Critical)" : badNut ? "Bad-nutrition" : lowScore ? "low-scoring" : "";
    const most = !/\b(fewest|least)\b/.test(p);
    const counts = new Map<string, number>();
    for (const r of filtered) if (cond(r)) counts.set(r[dimKey], (counts.get(r[dimKey]) || 0) + 1);
    const entries = [...counts.entries()].sort((a, b) => most ? b[1] - a[1] : a[1] - b[1]);
    if (!entries.length) return { summary: `* No ${condLabel} students found in scope (${scope}).`, widgets: [] };
    const dimLabel = dimKey === "center_id" ? "Centre" : dimKey === "district" ? "District" : "Division";
    const nameOf = (g: string) => dimKey === "center_id" ? (CENTER_NAME[g] || `Centre ${g}`) : g;
    const showN = entries.slice(0, 12);
    const top = entries[0];
    const noun = condLabel ? `${condLabel} students` : "students";
    const widgets: DashboardWidget[] = [
      { type: "metrics", title: "Group summary", width: "full", metricsList: [
        { label: `${most ? "Top" : "Lowest"} ${dimLabel.toLowerCase()}`, value: nameOf(top[0]), sub: `${top[1]} ${noun}`, trendDirection: "down" },
        { label: `${dimLabel}s counted`, value: String(entries.length), sub: scope },
      ]},
      { type: "chart", title: `${noun} by ${dimLabel.toLowerCase()}`, width: "full", chartType: "bar", xAxisKey: "name", seriesKeys: ["Students"],
        data: showN.map((e) => ({ name: nameOf(e[0]).length > 18 ? nameOf(e[0]).slice(0, 16) + "…" : nameOf(e[0]), Students: e[1] })) },
      { type: "table", title: `${dimLabel}s ranked by ${noun}`, width: "full", tableHeaders: ["Rank", dimLabel, "Students"],
        data: showN.map((e, i) => ({ Rank: i + 1, [dimLabel]: nameOf(e[0]), Students: e[1] })) },
    ];
    return {
      summary: `* **${nameOf(top[0])}** has the most ${noun} — **${top[1]}**.\n* Ranked ${dimLabel.toLowerCase()}s by their count of ${noun}; full list below.`,
      widgets,
    };
  }

  // ── NUTRITION listing ───────────────────────────────────────────────────────
  if (q.nutrition) {
    const nutr = filtered
      .filter((r) => (r.nutrition || "").toLowerCase() === q.nutrition!.toLowerCase())
      .sort((a, b) => Number(a.latest_avg_score) - Number(b.latest_avg_score));
    if (!nutr.length) return { summary: `* No students in scope (${scope}) are recorded with **${q.nutrition}** nutrition.`, widgets: [] };
    const show = nutr.slice(0, 15);
    const widgets: DashboardWidget[] = [
      { type: "metrics", title: "Nutrition flag", width: "full", metricsList: [
        { label: `${q.nutrition} nutrition`, value: fmt(nutr.length), sub: `students · ${scope}`, trendDirection: "down" },
        { label: "Lowest scorer", value: show[0].name, sub: `avg ${show[0].latest_avg_score}` },
      ]},
      { type: "table", title: `Students with ${q.nutrition} nutrition`, width: "full",
        tableHeaders: ["Name", "Student ID", "Centre", "Division", "Program", "Nutrition", "Avg score"],
        data: show.map((r) => ({ Name: r.name, "Student ID": r.student_id, Centre: CENTER_NAME[r.center_id] || r.center_id, Division: r.division, Program: r.program, Nutrition: r.nutrition, "Avg score": Number(r.latest_avg_score) })) },
    ];
    return {
      summary: `* **${fmt(nutr.length)} students** in scope (${scope}) have **${q.nutrition}** nutrition status.\n* Lowest-scoring among them is **${show[0].name}** (avg ${show[0].latest_avg_score}) — prioritise combined nutrition + learning support here.`,
      widgets,
    };
  }

  // ── RESULT SHEET (Nth-ranked single student, per-subject) ───────────────────
  const wantsSheet = q.resultSheet || q.singular || (q.rankIndex > 0 && q.metricCol === "latest_avg_score");
  if (wantsSheet) {
    const sorted = [...filtered].sort((a, b) => q.desc ? Number(b.latest_avg_score) - Number(a.latest_avg_score) : Number(a.latest_avg_score) - Number(b.latest_avg_score));
    const idx = Math.min(q.rankIndex, sorted.length - 1);
    const top = sorted[idx];
    const { rows: aRows } = await loadAssessments();
    const sheet = aRows.filter((r) => r.student_id === top.student_id);
    const ordLabel = idx === 0 ? (q.desc ? "top-performing" : "lowest-performing") : `#${idx + 1} ${q.desc ? "highest" : "lowest"}-scoring`;
    const widgets: DashboardWidget[] = [
      { type: "metrics", title: "Student", width: "full", metricsList: [
        { label: "Student", value: top.name, sub: `${top.program} · ${top.division} · ${top.grade}` },
        { label: "Average score", value: `${top.latest_avg_score}`, sub: `${sheet.length} subjects`, trendDirection: "up" },
        { label: "Attendance", value: `${top.attendance_pct}%`, sub: "recorded" },
      ]},
    ];
    if (sheet.length) {
      widgets.push({ type: "chart", title: `${top.name} — latest score by subject`, width: "full", chartType: "bar", xAxisKey: "subject", seriesKeys: ["Latest"], data: sheet.map((r) => ({ subject: r.subject, Latest: Number(r.latest) })) });
      widgets.push({ type: "table", title: `Result sheet — ${top.name}`, width: "full", tableHeaders: ["Subject", "Baseline", "Latest", "Gain", "Band"], data: sheet.map((r) => ({ Subject: r.subject, Baseline: Number(r.baseline), Latest: Number(r.latest), Gain: Number(r.latest) - Number(r.baseline), Band: r.band })) });
    }
    return {
      summary: `* The ${ordLabel} student in scope (${scope}) is **${top.name}** — ${top.program}, ${top.division}, ${top.grade}, with an average of **${top.latest_avg_score}**.\n* Their full result sheet (baseline → latest by subject) is below.`,
      widgets,
    };
  }

  // ── TOP-N RANKING ───────────────────────────────────────────────────────────
  const val = (r: Row) => Number(r[q.metricCol]) || 0;
  const sorted = [...filtered].sort((a, b) => q.desc ? val(b) - val(a) : val(a) - val(b));
  const show = sorted.slice(0, q.limit);
  const dir = q.desc ? "highest" : "lowest";
  const unit = q.metricCol === "attendance_pct" ? "%" : "";
  const widgets: DashboardWidget[] = [
    { type: "chart", title: `${dir[0].toUpperCase()}${dir.slice(1)} ${q.metricLabel} — ${scope}`, width: "full", chartType: "bar", xAxisKey: "name", seriesKeys: [q.metricLabel], data: show.map((r) => ({ name: r.name.split(" ")[0], [q.metricLabel]: val(r) })) },
    { type: "table", title: `Students ranked by ${q.metricLabel}`, width: "full", tableHeaders: ["Rank", "Name", "Student ID", "Centre", "Division", "Program", q.metricLabel], data: show.map((r, i) => ({ Rank: i + 1, Name: r.name, "Student ID": r.student_id, Centre: CENTER_NAME[r.center_id] || r.center_id, Division: r.division, Program: r.program, [q.metricLabel]: val(r) })) },
  ];
  return {
    summary: `* ${show.length === 1 ? "The" : `Top ${show.length}`} ${dir}-${q.metricLabel.toLowerCase()} student${show.length > 1 ? "s" : ""} in scope (${scope}): **${show[0].name}** leads with **${val(show[0])}${unit}**.\n* Ranked by ${q.metricLabel}; the full list is in the table below.`,
    widgets,
  };
}
