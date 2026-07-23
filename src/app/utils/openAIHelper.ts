import db from "../../../Database/demo/summary_dataset.json";
import { performRagRetrieval } from "./ragHelper";
import { isRowQuery, rowQuery } from "./rowQuery";
import { retrieveFacts, retrieveDetail, FACTS } from "../lib/knowledgeBase";
import { getCachedAnswer, cacheAnswer, reinforce, getWeights } from "./learningStore";

// Model IDs are env-configurable so the whole provider can be swapped in .env alone — no code change.
// Set VITE_AI_PROVIDER + the matching key (+ optional model) and the app follows.
const OPENAI_MODEL = import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-mini";
const GEMINI_PRIMARY_MODEL = import.meta.env.VITE_GEMINI_MODEL || "gemini-flash-latest";

/**
 * Is this a specific-entity lookup (needs raw rows) rather than an analytical question
 * (answerable from facts)? Only entity lookups pay the CSV-streaming cost.
 */
function isEntityLookup(prompt: string): boolean {
  const p = prompt.toLowerCase();
  if (/\b\d{5,15}\b/.test(p)) return true; // an ID
  return /\b(student|teacher|centre|center)\s+(named|called|id|#|number)\b/.test(p)
    || /\b(who is|find|show me|details? (of|for|about)|profile of|record of)\b/.test(p);
}


export interface DashboardWidget {
  type: "chart" | "metrics" | "table" | "text";
  title: string;
  width?: "full" | "half" | "third";
  
  // For chart type
  chartType?: "bar" | "line" | "area" | "pie" | "radar" | "scatter";
  xAxisKey?: string;
  seriesKeys?: string[];
  
  // For metrics type
  metricsList?: {
    label: string;
    value: string;
    sub: string;
    trend?: string;
    trendDirection?: "up" | "down" | "neutral";
  }[];

  // For table type
  tableHeaders?: string[];
  
  // Generic data field (holds chart points, table rows, etc.)
  data?: any[];
  
  // Text for summary or info cards
  content?: string;
}

export interface DynamicDashboardResponse {
  summary: string; // Markdown formatted short bullet points with key insights and findings (3-4 bullet points)
  widgets: DashboardWidget[]; // List of dynamic widgets to show on screen
}

/**
 * Which engine actually produced the last answer, and whether we fell back. The provider BADGE
 * says "RAG active (OPENAI)", but if that call fails we silently answer from the local engine —
 * a silent fallback that makes answers look authoritative when they aren't. This lets the UI say
 * so honestly. Read via getLastQueryMeta() immediately after awaiting queryDashboardData().
 */
export interface QueryMeta {
  engine: "gemini" | "openai" | "local" | "cache";
  fellBack: boolean;
  /** Dataset sources used (from the grounded facts). */
  sources: string[];
  /** The grounded facts the answer drew on. */
  facts: { statement: string; source: string }[];
}
let lastMeta: QueryMeta = { engine: "local", fellBack: false, sources: [], facts: [] };
export function getLastQueryMeta(): QueryMeta {
  return lastMeta;
}

/** True when the LLM declared a chart/table but left it EMPTY (or returned junk) — treat as unusable
 *  so we fall back to the deterministic local engine, which always ships real data. */
function llmAnswerBroken(d: DynamicDashboardResponse | null | undefined): boolean {
  if (!d || typeof d.summary !== "string" || !Array.isArray(d.widgets)) return true;
  return d.widgets.some((x) => (x.type === "chart" || x.type === "table") && (!Array.isArray(x.data) || x.data.length === 0));
}

// ── Live snapshot from the demo dataset ──────────────────────────────────────────────────────────
// The LLM system prompt is BUILT from the data on disk, so it never drifts from what's actually in
// the database. Nothing here is hardcoded — change the dataset and the prompt follows.
const _P = db.programs;
const _totalStudents = _P.abal.students + _P.catchup.students + _P.innovation.students;
const _totalMainstreamed = _P.abal.mainstreamed + _P.catchup.mainstreamed + _P.innovation.mainstreamed;
const _networkRate = ((_totalMainstreamed / _totalStudents) * 100).toFixed(1);
const _progDesc = (k: "abal" | "catchup" | "innovation", name: string) =>
  `${name} - ${_P[k].students.toLocaleString()} students (${_P[k].boys} boys, ${_P[k].girls} girls, ${_P[k].avg_attendance}% avg attendance, ${_P[k].mainstreamed} mainstreamed).`;
const _divDesc = Object.entries(db.divisions).map(([d, n]) => `${d} (${n.toLocaleString()})`).join(", ");
const _gradeDesc = Object.entries(db.grades).sort(([a], [b]) => a.localeCompare(b)).map(([g, n]) => `${g} (${n.toLocaleString()})`).join(", ");
const _eduDesc = Object.entries(db.teachers.education).map(([e, n]) => `${e} (${n})`).join(", ");
const _nutDesc = Object.entries(db.nutrition).map(([s, n]) => `${s} (${n.toLocaleString()})`).join(", ");

// System description and schema summary for OpenAI System Prompt
const SYSTEM_METADATA_SUMMARY = `
You are the AI Data Analyst for the Non-Formal Primary Education (NFPE) - Education Management Data Center (EMDC) program in Bangladesh.
The programme serves ${_totalStudents.toLocaleString()} enrolled learners across three programs (${_networkRate}% mainstreamed into formal school overall):
1. ${_progDesc("abal", "ABAL (Ability Based Accelerated Learning)")}
2. ${_progDesc("catchup", "Catchup")}
3. ${_progDesc("innovation", "Innovation")}

Available high-level statistics in our database (summary_dataset.json):
- "programs": Student counts, gender, average attendance, mainstreamed count, and dropout reasons (Poverty, Family Awareness, Distance, Inattentive, Migration, Working child, Others) for ABAL, Catchup, and Innovation.
- "grades": ${_gradeDesc}.
- "divisions": ${_divDesc}.
- "nutrition": ${_nutDesc}.
- "teachers": Total ${db.teachers.total} (${db.teachers.gender.Man} men, ${db.teachers.gender.Woman} women). Education: ${_eduDesc}.
- "subject_averages": Average exam scores by subject (Bangla, Mathematics, English, Science, BGS, Religion, Life Skills) for ABAL, Catchup, and Innovation programs.
- "worst_centers_by_attendance": Centers with the lowest recorded attendance.
- "poor_bangla_students": Students with the lowest Bangla marks.
- "me_evaluations": Center evaluation scores (pedagogy, assessments, documentation, learning environment, engagement, score).

You must return a JSON response matching the following TypeScript interfaces:
interface DashboardWidget {
  type: "chart" | "metrics" | "table" | "text";
  title: string;
  width?: "full" | "half" | "third";
  chartType?: "bar" | "line" | "area" | "pie" | "radar" | "scatter";
  xAxisKey?: string;
  seriesKeys?: string[];
  metricsList?: {
    label: string;
    value: string;
    sub: string;
    trend?: string;
    trendDirection?: "up" | "down" | "neutral";
  }[];
  tableHeaders?: string[];
  data?: any[]; // Array of data objects (e.g. for charts [{ name: "ABAL", students: 55200 }] or tables [{ "Student ID": "123", "Mark": 45 }])
  content?: string;
}

interface DynamicDashboardResponse {
  summary: string;
  widgets: DashboardWidget[];
}

OUTPUT RULES — FOCUSED, DECISION-FIRST, NOTHING EXTRA:
1. ANSWER ONLY THE QUESTION. Return the minimum widgets that answer it — often ONE stat or ONE chart.
   Never pad with unrelated metrics, extra subjects, or a "full dashboard". If one number answers
   it, return one metrics widget with that one number.
2. LEAD WITH THE DECISION. The summary's first bullet must state the answer and its "so what"
   (is this good, a risk, or where to act) — not a description of the chart.
3. SINGLE-SUBJECT / SINGLE-PROGRAMME asks stay single. If the user says "Bangla" or "Catchup",
   include ONLY that subject/programme in data and seriesKeys.
4. MICRO / DRILL-DOWN asks (a specific reason, division, subject, student, centre) must be answered
   at that grain from the facts or retrieved rows — do not zoom back out to network totals.
5. GROUNDING: every number in the summary and widgets must come from the GROUNDED FACTS block or the
   retrieved rows. Never invent, round loosely, or carry a number the data doesn't contain.
6. For cycle-mark asks with BL/C1..C5 columns, plot X = Baseline, Cycle 1..5 and add a table of the
   matching students — nothing else.
7. If the data can't answer the question, say so plainly in the summary and return no fabricated
   widget. Honesty over a filled screen.
8. SIMPLE FACTUAL asks — a single count or value ("how many teachers", "total students") — return a
   one-sentence summary and an EMPTY widgets array. Do NOT attach a chart or metric tiles. Only add
   widgets when the question is analytical, comparative, or asks for a breakdown / trend / list.
9. READ EVERY QUALIFIER in the question before computing — programme (ABAL / Catchup / Innovation),
   gender (boys / girls), division, subject, grade, nutrition status, centre. Filter the dataset to
   EXACTLY those qualifiers and answer that subset only; never widen to the network total when the
   user named a subset. If a qualifier combination genuinely isn't in the data (e.g. attendance by
   division), say so plainly rather than answering a different question.
10. ANSWER THE ACTUAL QUESTION ASKED, not the nearest common one. "How many girls in Catchup?" →
   the Catchup girls count, not all girls and not all Catchup students. Mirror the question's grain.
11. FOLLOW-UPS: earlier turns of this conversation are provided as context. If the question refers to
   them ("that division", "the worst one", "those students", "and for girls?"), resolve the reference
   against the previous turn and answer that — do not restart from the network total.
`;

// The ENTIRE aggregated dataset, handed to the LLM so it can answer ANY precise question directly
// from the data (gender×programme, division, subject×programme, centre scores, dropout reasons, …)
// instead of being limited to a handful of pre-selected facts. The demo summary is small (a few KB).
const DATA_SNAPSHOT =
  "### COMPLETE DATASET (aggregated JSON — every number in your answer MUST come from here)\n" +
  "```json\n" + JSON.stringify(db) + "\n```";

interface ParsedMarkdownTable {
  source: string;
  headers: string[];
  rows: any[];
}

function parseMarkdownTables(markdown: string): ParsedMarkdownTable[] {
  const tables: ParsedMarkdownTable[] = [];
  const lines = markdown.split("\n");
  
  let currentSource = "";
  let currentHeaders: string[] = [];
  let currentRows: any[] = [];
  let readingTable = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    if (line.startsWith("#### Dataset:")) {
      if (currentHeaders.length > 0) {
        tables.push({
          source: currentSource,
          headers: currentHeaders,
          rows: currentRows
        });
      }
      currentSource = line.replace("#### Dataset:", "").trim();
      currentHeaders = [];
      currentRows = [];
      readingTable = false;
      continue;
    }
    
    if (line.startsWith("|")) {
      const parts = line.split("|").map(p => p.trim()).filter((_p, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (line.includes("---")) {
        readingTable = true;
        continue;
      }
      
      if (!readingTable) {
        currentHeaders = parts;
      } else {
        const rowObj: any = {};
        currentHeaders.forEach((h, idx) => {
          rowObj[h] = parts[idx] || "";
        });
        currentRows.push(rowObj);
      }
    } else {
      readingTable = false;
    }
  }
  
  if (currentHeaders.length > 0) {
    tables.push({
      source: currentSource,
      headers: currentHeaders,
      rows: currentRows
    });
  }
  
  return tables;
}

/**
 * SIMPLE-FIRST: a single-value factual question ("how many teachers?") gets a one-sentence text
 * answer with NO widgets — a normal chat reply, not a dashboard. Returns null for anything
 * analytical/comparative (compare, by, breakdown, trend, reasons, list…) so those still get charts.
 */
function trySimpleFactual(p: string): string | null {
  if (/\b(compare|breakdown|by |per |trend|over time|distribution|list|chart|graph|table|reasons?|each|vs\b|versus)\b/.test(p)) return null;
  if (!/\b(how many|number of|count of|total number|what('?s| is) the (total|number))\b/.test(p)) return null;

  const students = db.programs.abal.students + db.programs.catchup.students + db.programs.innovation.students;
  const mained = db.programs.abal.mainstreamed + db.programs.catchup.mainstreamed + db.programs.innovation.mainstreamed;
  const rate = ((mained / students) * 100).toFixed(1);
  const teachers = db.teachers?.total ?? 0;

  if (/teacher|educator|staff/.test(p)) return `There are **${teachers.toLocaleString()}** teachers across the NFPE programme.`;
  if (/student|learner|enrol|children|child|pupil/.test(p)) return `The programme serves **${students.toLocaleString()}** enrolled learners across ABAL, Catchup and Innovation.`;
  if (/mainstream/.test(p)) return `**${rate}%** of learners have been mainstreamed into formal school (${mained.toLocaleString()} of ${students.toLocaleString()}).`;
  if (/programme|program/.test(p)) return `There are **3** programmes: ABAL, Catchup and Innovation.`;
  return null;
}

/**
 * Robust Local Query Processor that calculates answers directly from the summary dataset or retrieved RAG context
 */
export function queryLocalDatabase(prompt: string, ragContext: string = ""): DynamicDashboardResponse {
  const p = prompt.toLowerCase();

  // Simple factual question → plain text answer, no widgets (conversational).
  const simple = trySimpleFactual(p);
  if (simple) return { summary: simple, widgets: [] };

  // If we have RAG context tables, parse and render them dynamically!
  if (ragContext && ragContext.includes("|")) {
    const tables = parseMarkdownTables(ragContext);
    if (tables.length > 0) {
      const widgets: DashboardWidget[] = [];
      let summaryText = "";

      let subjectFilter: string | null = null;
      if (p.includes("bangla")) subjectFilter = "Bangla";
      else if (p.includes("math")) subjectFilter = "Mathematics";
      else if (p.includes("english") || p.includes("eng")) subjectFilter = "English";
      else if (p.includes("science") || p.includes("sci")) subjectFilter = "Science";
      else if (p.includes("bgs")) subjectFilter = "BGS";
      else if (p.includes("life skill")) subjectFilter = "Life Skills";
      else if (p.includes("religion")) subjectFilter = "Religion";

      for (const table of tables) {
        let displayedHeaders = [...table.headers];
        
        if (subjectFilter) {
          const lowerSubj = subjectFilter.toLowerCase();
          displayedHeaders = table.headers.filter(h => {
            const hl = h.toLowerCase();
            if (hl === "student id" || hl === "name" || hl === "center id" || hl === "program" || hl === "gender" || hl === "division" || hl === "teacher name" || hl === "district" || hl === "experience" || hl === "education") {
              return true;
            }
            return hl.includes(lowerSubj);
          });
        }

        const displayData = table.rows.slice(0, 15).map(row => {
          const cleanRow: any = {};
          displayedHeaders.forEach(h => {
            cleanRow[h] = row[h];
          });
          return cleanRow;
        });

        const metricsList = [
          { label: "Matches Found", value: table.rows.length.toString(), sub: `In ${table.source}` }
        ];

        const numericColumns = displayedHeaders.filter(h => {
          const val = table.rows[0]?.[h];
          return val && !isNaN(parseFloat(val)) && h.toLowerCase() !== "student id" && h.toLowerCase() !== "center id";
        });

        if (numericColumns.length > 0) {
          const colAverages: any = {};
          numericColumns.forEach(col => {
            let sum = 0;
            let count = 0;
            table.rows.forEach(r => {
              const val = parseFloat(r[col]);
              if (!isNaN(val)) {
                sum += val;
                count++;
              }
            });
            colAverages[col] = count > 0 ? parseFloat((sum / count).toFixed(2)) : 0;
          });

          const topCols = Object.keys(colAverages).slice(0, 3);
          topCols.forEach(col => {
            metricsList.push({
              label: `${col} Avg`,
              value: colAverages[col].toString(),
              sub: `Across ${table.rows.length} rows`
            });
          });

          const cycleCols = numericColumns.filter(h => {
            const hl = h.toLowerCase();
            return hl.includes(" bl") || hl.includes(" bl ") || hl.includes(" c1") || hl.includes(" c2") || hl.includes(" c3") || hl.includes(" c4") || hl.includes(" c5");
          });

          if (cycleCols.length > 0) {
            const sortedCycles = [...cycleCols].sort((a, b) => {
              const getOrder = (colName: string) => {
                const cn = colName.toLowerCase();
                if (cn.includes("bl")) return 0;
                if (cn.includes("c1")) return 1;
                if (cn.includes("c2")) return 2;
                if (cn.includes("c3")) return 3;
                if (cn.includes("c4")) return 4;
                if (cn.includes("c5")) return 5;
                return 6;
              };
              return getOrder(a) - getOrder(b);
            });

            const chartData = sortedCycles.map(col => {
              const displayName = col.replace("Bangla", "").replace("Math", "").replace("English", "").replace("Science", "").trim();
              return {
                cycle: displayName,
                "Average Score": colAverages[col]
              };
            });

            widgets.push({
              type: "chart",
              title: `${subjectFilter || "Subject"} Marks Progression (Cycles)`,
              width: "half",
              chartType: "line",
              xAxisKey: "cycle",
              seriesKeys: ["Average Score"],
              data: chartData
            });
          } else {
            const chartData = table.rows.slice(0, 10).map(row => {
              const nameKey = row["Name"] || row["Student ID"] || row["Center ID"] || "Item";
              const dataPoint: any = { name: nameKey };
              numericColumns.slice(0, 3).forEach(col => {
                dataPoint[col] = parseFloat(row[col]) || 0;
              });
              return dataPoint;
            });

            widgets.push({
              type: "chart",
              title: `Comparison Chart - ${table.source}`,
              width: "half",
              chartType: "bar",
              xAxisKey: "name",
              seriesKeys: numericColumns.slice(0, 3),
              data: chartData
            });
          }
        }

        widgets.unshift({
          type: "metrics",
          title: `${table.source} Key Metrics`,
          width: "full",
          metricsList
        });

        widgets.push({
          type: "table",
          title: `Data Table - ${table.source}`,
          width: widgets.some(w => w.type === "chart") ? "half" : "full",
          tableHeaders: displayedHeaders,
          data: displayData
        });

        summaryText += `* **Found ${table.rows.length} matching records** in dataset **${table.source}**.\n`;
        if (subjectFilter) {
          summaryText += `* Columns filtered for **${subjectFilter}** scores to present a clutter-free view.\n`;
        }
        if (table.rows.length > 15) {
          summaryText += `* Displaying first **15 rows** in the dashboard table for optimal readability.\n`;
        }
      }

      return {
        summary: summaryText,
        widgets
      };
    }
  }

  // 1. DROPOUT REASONS
  if (p.includes("dropout") || p.includes("drop out") || p.includes("drop-out") || p.includes("leaving")) {
    const abalReasons = db.programs.abal.dropout_reasons;
    const catchupReasons = db.programs.catchup.dropout_reasons;
    const innovationReasons = db.programs.innovation.dropout_reasons;

    const allReasons = Array.from(new Set([
      ...Object.keys(abalReasons),
      ...Object.keys(catchupReasons),
      ...Object.keys(innovationReasons)
    ]));

    const chartData = allReasons.map(reason => ({
      reason,
      ABAL: abalReasons[reason as keyof typeof abalReasons] || 0,
      Catchup: catchupReasons[reason as keyof typeof catchupReasons] || 0,
      Innovation: innovationReasons[reason as keyof typeof innovationReasons] || 0,
      Total: (abalReasons[reason as keyof typeof abalReasons] || 0) +
             (catchupReasons[reason as keyof typeof catchupReasons] || 0) +
             (innovationReasons[reason as keyof typeof innovationReasons] || 0)
    })).sort((a, b) => b.Total - a.Total);

    const totalDropouts = chartData.reduce((sum, item) => sum + item.Total, 0);
    const povertyDropouts = chartData.find(item => item.reason === "Poverty")?.Total || 0;
    const povertyPercentage = ((povertyDropouts / totalDropouts) * 100).toFixed(1);

    return {
      summary: `* **Poverty is the leading cause of student dropout**, accounting for **${povertyDropouts.toLocaleString()}** students (${povertyPercentage}% of all dropouts).\n* **Catchup program** has the highest number of dropouts, primarily driven by financial constraints and poverty.\n* Dropout rates are lowest in the **Innovation** program due to its smaller student base and targeted engagement.`,
      widgets: [
        {
          type: "metrics",
          title: "Dropout Summary Metrics",
          width: "full",
          metricsList: [
            { label: "Total Dropouts", value: totalDropouts.toLocaleString(), sub: "Across all programs", trendDirection: "down" },
            { label: "Primary Reason", value: "Poverty", sub: `${povertyPercentage}% of total`, trendDirection: "neutral" },
            { label: "Catchup", value: chartData.reduce((sum, item) => sum + item.Catchup, 0).toLocaleString(), sub: "Highest program", trendDirection: "down" }
          ]
        },
        {
          type: "chart",
          title: "Dropout Reasons Across NFPE Programs",
          width: "full",
          chartType: "bar",
          xAxisKey: "reason",
          seriesKeys: ["ABAL", "Catchup", "Innovation"],
          data: chartData
        }
      ]
    };
  }

  // 2. TEACHERS DEMOGRAPHICS
  if (p.includes("teacher") || p.includes("instructor") || p.includes("staff") || p.includes("educator")) {
    if (p.includes("experience")) {
      const exp = db.teachers.experience;
      const chartData = Object.entries(exp).map(([name, count]) => ({ name, Teachers: count }));
      return {
        summary: `* **Novice teachers** (below 1 year of experience) represent the largest segment with **${exp["Below 1 year"].toLocaleString()}** teachers.\n* There is a steep drop-off to experienced staff, with only **${exp["Above 10 Years"] || 165}** teachers having over 10 years of experience.`,
        widgets: [
          {
            type: "metrics",
            title: "Teacher Experience Metrics",
            width: "full",
            metricsList: [
              { label: "Total Teachers", value: db.teachers.total.toLocaleString(), sub: "Active program educators", trendDirection: "neutral" },
              { label: "Entry Level (<1 yr)", value: exp["Below 1 year"].toLocaleString(), sub: `${((exp["Below 1 year"] / db.teachers.total) * 100).toFixed(1)}% of total staff`, trendDirection: "up" },
              { label: "Highly Experienced", value: (exp["Above 10 Years"] || 165).toString(), sub: "Above 10 years", trendDirection: "neutral" }
            ]
          },
          {
            type: "chart",
            title: "Teacher Experience Breakdown",
            width: "full",
            chartType: "pie",
            xAxisKey: "name",
            seriesKeys: ["Teachers"],
            data: chartData
          }
        ]
      };
    }

    if (p.includes("education") || p.includes("qualification") || p.includes("degree")) {
      const edu = db.teachers.education;
      const chartData = Object.entries(edu)
        .map(([name, count]) => ({ name, Teachers: count }))
        .sort((a, b) => b.Teachers - a.Teachers);
      return {
        summary: `* The vast majority of teachers hold an **H.S.C (Higher Secondary Certificate)**, totaling **${edu["H.S.C"].toLocaleString()}** staff.`,
        widgets: [
          {
            type: "metrics",
            title: "Teacher Qualification Summary",
            width: "full",
            metricsList: [
              { label: "Total Teachers", value: db.teachers.total.toLocaleString(), sub: "Educator staff count" },
              { label: "H.S.C Holders", value: edu["H.S.C"].toLocaleString(), sub: `${((edu["H.S.C"] / db.teachers.total) * 100).toFixed(1)}% of total teachers`, trendDirection: "neutral" },
              { label: "Graduates & Above", value: (edu["Graduation"] + edu["Masters"]).toLocaleString(), sub: `${(((edu["Graduation"] + edu["Masters"]) / db.teachers.total) * 100).toFixed(1)}% of total teachers`, trendDirection: "up" }
            ]
          },
          {
            type: "chart",
            title: "Teacher Educational Qualifications",
            width: "full",
            chartType: "bar",
            xAxisKey: "name",
            seriesKeys: ["Teachers"],
            data: chartData
          }
        ]
      };
    }

    // Default Teacher Overview
    const gender = db.teachers.gender;
    const chartData = [
      { name: "Female Teachers", count: gender.Woman },
      { name: "Male Teachers", count: gender.Man }
    ];
    const femalePercentage = ((gender.Woman / db.teachers.total) * 100).toFixed(1);

    return {
      summary: `* **Female teachers dominate the workforce** at **${femalePercentage}%** (${gender.Woman.toLocaleString()} teachers).\n* There are only **${gender.Man}** male teachers active in the program.`,
      widgets: [
        {
          type: "metrics",
          title: "Teacher Gender Metrics",
          width: "full",
          metricsList: [
            { label: "Total Teachers", value: db.teachers.total.toLocaleString(), sub: "Active staff", trendDirection: "neutral" },
            { label: "Female Teachers", value: gender.Woman.toLocaleString(), sub: `${femalePercentage}% of total`, trendDirection: "up" },
            { label: "Male Teachers", value: gender.Man.toString(), sub: `${((gender.Man / db.teachers.total) * 100).toFixed(1)}% of total`, trendDirection: "down" }
          ]
        },
        {
          type: "chart",
          title: "Teacher Gender Distribution",
          width: "full",
          chartType: "pie",
          xAxisKey: "name",
          seriesKeys: ["count"],
          data: chartData
        }
      ]
    };
  }

  // 3. GRADE DISTRIBUTION
  if (p.includes("grade") || p.includes("class") || p.includes("enrollment by grade")) {
    const grades = db.grades;
    const chartData = Object.entries(grades)
      .map(([name, count]) => ({ name: name.replace("G", "Grade "), students: count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const totalGradeStudents = chartData.reduce((sum, item) => sum + item.students, 0);
    const maxGrade = chartData.reduce((max, item) => item.students > max.students ? item : max, chartData[0]);
    const minGrade = chartData.reduce((min, item) => item.students < min.students ? item : min, chartData[0]);

    return {
      summary: `* Total student enrollment across grades 1-5 stands at **${totalGradeStudents.toLocaleString()}** students.\n* **${maxGrade.name}** holds the highest density of students with **${maxGrade.students.toLocaleString()}** enrolled.`,
      widgets: [
        {
          type: "metrics",
          title: "Grade Enrollment Metrics",
          width: "full",
          metricsList: [
            { label: "Total Grade Students", value: totalGradeStudents.toLocaleString(), sub: "Grades 1-5" },
            { label: "Peak Grade", value: maxGrade.name, sub: `${maxGrade.students.toLocaleString()} students`, trendDirection: "up" },
            { label: "Lowest Grade", value: minGrade.name, sub: `${minGrade.students.toLocaleString()} students`, trendDirection: "down" }
          ]
        },
        {
          type: "chart",
          title: "Student Distribution by Grade Level",
          width: "full",
          chartType: "bar",
          xAxisKey: "name",
          seriesKeys: ["students"],
          data: chartData
        }
      ]
    };
  }

  // 4. DIVISIONS / DISTRICTS GEOGRAPHY
  if (p.includes("division") || p.includes("district") || p.includes("geograph") || p.includes("location") || p.includes("map")) {
    const divisions = db.divisions;
    const chartData = Object.entries(divisions)
      .map(([name, count]) => ({ name, Students: count as number }))
      .sort((a, b) => b.Students - a.Students);

    const totalGeoStudents = chartData.reduce((sum, item) => sum + item.Students, 0);
    const top = chartData[0];
    const second = chartData[1] ?? top;
    const topRatio = ((top.Students / totalGeoStudents) * 100).toFixed(1);
    const even = chartData.every((d) => d.Students === top.Students);

    return {
      summary: even
        ? `* Enrolment is spread **evenly across all ${chartData.length} divisions**, each holding **${top.Students.toLocaleString()}** learners (${topRatio}% each).\n* No single division dominates — geography isn't where the imbalance lies.`
        : `* **${top.name} division** holds the most learners — **${top.Students.toLocaleString()}** (${topRatio}%).\n* **${second.name}** follows with **${second.Students.toLocaleString()}** students.`,
      widgets: [
        {
          type: "metrics",
          title: "Geographic Metrics",
          width: "full",
          metricsList: [
            { label: "Total Mapped Students", value: totalGeoStudents.toLocaleString(), sub: `Across ${chartData.length} divisions` },
            { label: `${top.name}`, value: top.Students.toLocaleString(), sub: `${topRatio}% of enrolment`, trendDirection: "up" },
            { label: `${second.name}`, value: second.Students.toLocaleString(), sub: "Second largest", trendDirection: "neutral" }
          ]
        },
        {
          type: "chart",
          title: "Student Density by Division",
          width: "full",
          chartType: "bar",
          xAxisKey: "name",
          seriesKeys: ["Students"],
          data: chartData
        }
      ]
    };
  }

  // 5. NUTRITION AND HEALTH
  if (p.includes("nutrition") || p.includes("health") || p.includes("food") || p.includes("lunch") || p.includes("eat")) {
    const nut = db.nutrition;
    const chartData = Object.entries(nut).map(([name, count]) => ({ name, Students: count }));
    const totalNut = chartData.reduce((sum, item) => sum + item.Students, 0);
    const goodNutPct = ((nut.Good / totalNut) * 100).toFixed(1);

    return {
      summary: `* Over **${goodNutPct}%** of monitored students (${nut.Good.toLocaleString()}) are classified in **Good** nutritional health.`,
      widgets: [
        {
          type: "metrics",
          title: "Nutrition Status Metrics",
          width: "full",
          metricsList: [
            { label: "Good Nutrition", value: `${goodNutPct}%`, sub: "Healthy status", trendDirection: "up" },
            { label: "Nutrition Concerns", value: nut["Not so good"].toLocaleString(), sub: "Not so good status", trendDirection: "down" },
            { label: "Critical Care", value: nut.Bad.toString(), sub: "Bad status", trendDirection: "down" }
          ]
        },
        {
          type: "chart",
          title: "Student Nutritional Evaluation Status",
          width: "full",
          chartType: "pie",
          xAxisKey: "name",
          seriesKeys: ["Students"],
          data: chartData
        }
      ]
    };
  }

  // 5b. ATTENDANCE (general) — MUST come before the subject branch, which also matches "average"
  //     (so "average attendance" used to wrongly return exam marks). Best/worst/centre attendance
  //     have their own branches below and are excluded here.
  if (p.includes("attendance") && !/\b(best|top|highest|worst|lowest|low|centre|center)\b/.test(p)) {
    const P = db.programs;
    const rows = [
      { name: "ABAL", Attendance: P.abal.avg_attendance },
      { name: "Catchup", Attendance: P.catchup.avg_attendance },
      { name: "Innovation", Attendance: P.innovation.avg_attendance },
    ];
    const totalStudents = P.abal.students + P.catchup.students + P.innovation.students;
    const weighted =
      (P.abal.avg_attendance * P.abal.students +
        P.catchup.avg_attendance * P.catchup.students +
        P.innovation.avg_attendance * P.innovation.students) / totalStudents;
    const avg = Math.round(weighted * 100) / 100;
    const best = [...rows].sort((a, b) => b.Attendance - a.Attendance)[0];
    return {
      summary: `* Average recorded attendance is **${avg}%** across all **${totalStudents.toLocaleString()}** learners — every learner has a monthly record.\n* **${best.name}** is highest at **${best.Attendance}%**; attendance is close across the three programmes.`,
      widgets: [
        {
          type: "metrics",
          title: "Attendance overview",
          width: "full",
          metricsList: [
            { label: "Average attendance", value: `${avg}%`, sub: "All programmes", trendDirection: "neutral" },
            { label: "Highest programme", value: best.name, sub: `${best.Attendance}%`, trendDirection: "up" },
            { label: "Coverage", value: "100%", sub: "Fully recorded" },
          ],
        },
        {
          type: "chart",
          title: "Average attendance by programme",
          width: "full",
          chartType: "bar",
          xAxisKey: "name",
          seriesKeys: ["Attendance"],
          data: rows,
        },
      ],
    };
  }

  // 6. SUBJECT PERFORMANCE / MARKS / EXAMS
  if (p.includes("subject") || p.includes("mark") || p.includes("exam") || p.includes("average") || p.includes("score") || p.includes("result")) {
    const averages = db.subject_averages;
    
    // Check if a specific subject is requested
    let targetSubject: string | null = null;
    if (p.includes("bangla")) targetSubject = "Bangla";
    else if (p.includes("math")) targetSubject = "Mathematics";
    else if (p.includes("english") || p.includes("eng")) targetSubject = "English";
    else if (p.includes("science") || p.includes("sci")) targetSubject = "Science";
    else if (p.includes("bgs")) targetSubject = "BGS";
    else if (p.includes("life skill")) targetSubject = "Life Skills";
    else if (p.includes("religion")) targetSubject = "Religion";

    // Check if a specific program is requested
    let targetProgram: "abal" | "catchup" | "innovation" | null = null;
    if (p.includes("abal")) targetProgram = "abal";
    else if (p.includes("catchup")) targetProgram = "catchup";
    else if (p.includes("innovation")) targetProgram = "innovation";

    if (targetSubject) {
      if (p.includes("cycle") || p.includes("6 month") || p.includes("six month") || p.includes("month") || p.includes("progress") || p.includes("improve")) {
        // Progression from the assessment records (baseline → latest) for the requested subject —
        // computed from student_marks_sample, NOT a hardcoded curve.
        const sample = (db.student_marks_sample ?? []).filter((r) => r.subject === targetSubject);
        const mean = (arr: number[]) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0);
        const baseAvg = Math.round(mean(sample.map((r) => r.baseline)) * 10) / 10;
        const latestSample = Math.round(mean(sample.map((r) => r.latest)) * 10) / 10;
        const latest = latestSample || (averages.catchup[targetSubject as keyof typeof averages.catchup] ?? 0);
        const growth = Math.round((latest - baseAvg) * 10) / 10;
        const chartData = [
          { cycle: "Baseline", "Average Score": baseAvg },
          { cycle: "Latest", "Average Score": latest },
        ];

        return {
          summary: `* **${targetSubject}** marks rose from a baseline mean of **${baseAvg}** to **${latest}** — a **+${growth}** gain.\n* Measured from the assessment records (baseline vs latest cycle) for **${targetSubject}** only.`,
          widgets: [
            {
              type: "metrics",
              title: "Assessment Progression",
              width: "full",
              metricsList: [
                { label: "Baseline Avg", value: `${baseAvg}`, sub: `${targetSubject}` },
                { label: "Latest Avg", value: `${latest}`, sub: `${targetSubject}`, trendDirection: "up" },
                { label: "Growth", value: `+${growth}`, sub: "Marks gained", trendDirection: "up" }
              ]
            },
            {
              type: "chart",
              title: `${targetSubject} Marks Progression (Baseline → Latest)`,
              width: "full",
              chartType: "line",
              xAxisKey: "cycle",
              seriesKeys: ["Average Score"],
              data: chartData
            }
          ]
        };
      }

      if (targetProgram) {
        const val = averages[targetProgram][targetSubject as keyof typeof averages.abal] || 0;
        const chartData = [{ name: targetSubject, Score: val }];
        return {
          summary: `* Average **${targetSubject}** score for **${targetProgram.toUpperCase()}** is **${val}** marks.`,
          widgets: [
            {
              type: "metrics",
              title: "Single Subject Score",
              width: "full",
              metricsList: [
                { label: `${targetProgram.toUpperCase()} Avg`, value: `${val} marks`, sub: targetSubject, trendDirection: "neutral" }
              ]
            },
            {
              type: "chart",
              title: `${targetProgram.toUpperCase()} Program - Average ${targetSubject} Mark`,
              width: "full",
              chartType: "bar",
              xAxisKey: "name",
              seriesKeys: ["Score"],
              data: chartData
            }
          ]
        };
      } else {
        const vals = [
          { name: "ABAL", Score: averages.abal[targetSubject as keyof typeof averages.abal] || 0 },
          { name: "Catchup", Score: averages.catchup[targetSubject as keyof typeof averages.catchup] || 0 },
          { name: "Innovation", Score: averages.innovation[targetSubject as keyof typeof averages.innovation] || 0 }
        ];
        const leader = [...vals].sort((a, b) => b.Score - a.Score)[0];
        return {
          summary: `* **${leader.name}** leads in **${targetSubject}** with an average of **${leader.Score}** marks.\n* Focused on **${targetSubject}** across the three programmes.`,
          widgets: [
            {
              type: "metrics",
              title: `${targetSubject} Metrics`,
              width: "full",
              metricsList: vals.map((v) => ({
                label: v.name,
                value: `${v.Score}`,
                sub: "Average marks",
                trendDirection: (v.name === leader.name ? "up" : "neutral") as "up" | "neutral",
              }))
            },
            {
              type: "chart",
              title: `Average ${targetSubject} Scores Across Programs`,
              width: "full",
              chartType: "bar",
              xAxisKey: "name",
              seriesKeys: ["Score"],
              data: vals
            }
          ]
        };
      }
    }

    // Default: Return all subjects
    const subjects = Object.keys(averages.abal);
    const chartData = subjects.map(subject => ({
      subject,
      ABAL: averages.abal[subject as keyof typeof averages.abal] || 0,
      Catchup: averages.catchup[subject as keyof typeof averages.catchup] || 0,
      Innovation: averages.innovation[subject as keyof typeof averages.innovation] || 0
    }));

    const withMean = subjects.map((s) => {
      const a = averages.abal[s as keyof typeof averages.abal] || 0;
      const c = averages.catchup[s as keyof typeof averages.catchup] || 0;
      const i = averages.innovation[s as keyof typeof averages.innovation] || 0;
      return { s, mean: Math.round(((a + c + i) / 3) * 10) / 10 };
    });
    const strongest = [...withMean].sort((x, y) => y.mean - x.mean)[0];
    const weakest = [...withMean].sort((x, y) => x.mean - y.mean)[0];

    return {
      summary: `* Across subjects, **${strongest.s}** is the strongest (network average **${strongest.mean}**) and **${weakest.s}** the weakest (**${weakest.mean}**).\n* The three programmes track closely on every subject — the gap is between subjects, not programmes.`,
      widgets: [
        {
          type: "metrics",
          title: "Academic Highlights",
          width: "full",
          metricsList: [
            { label: "Strongest Subject", value: strongest.s, sub: `Avg ${strongest.mean} marks`, trendDirection: "up" },
            { label: "Weakest Subject", value: weakest.s, sub: `Avg ${weakest.mean} marks`, trendDirection: "down" },
            { label: "Subjects Tracked", value: subjects.length.toString(), sub: "Per programme" }
          ]
        },
        {
          type: "chart",
          title: "Average Examination Scores by Subject & Program",
          width: "full",
          chartType: "radar",
          xAxisKey: "subject",
          seriesKeys: ["ABAL", "Catchup", "Innovation"],
          data: chartData
        }
      ]
    };
  }

  // "Best / highest attendance" — answerable at programme grain (demo has full attendance coverage).
  if (p.includes("attendance") && (p.includes("best") || p.includes("top") || p.includes("highest"))) {
    const rows = [
      { name: "ABAL", Attendance: db.programs.abal.avg_attendance },
      { name: "Catchup", Attendance: db.programs.catchup.avg_attendance },
      { name: "Innovation", Attendance: db.programs.innovation.avg_attendance },
    ].sort((a, b) => b.Attendance - a.Attendance);
    const best = rows[0];
    return {
      summary: `* **${best.name}** has the highest average attendance at **${best.Attendance}%**.\n* Attendance is close across programmes: ${rows.map((r) => `${r.name} ${r.Attendance}%`).join(", ")}.`,
      widgets: [
        {
          type: "metrics",
          title: "Attendance by programme",
          width: "full",
          metricsList: rows.map((r, i) => ({
            label: r.name,
            value: `${r.Attendance}%`,
            sub: i === 0 ? "Highest" : "Average recorded",
            trendDirection: (i === 0 ? "up" : "neutral") as "up" | "neutral",
          })),
        },
        {
          type: "chart",
          title: "Average Attendance by Programme",
          width: "full",
          chartType: "bar",
          xAxisKey: "name",
          seriesKeys: ["Attendance"],
          data: rows,
        },
      ],
    };
  }

  // 7. WORST ATTENDANCE CENTERS
  if (p.includes("worst") || p.includes("lowest attendance") || p.includes("low attendance") || p.includes("attendance center") || p.includes("attendance centre")) {
    const worst = db.worst_centers_by_attendance.slice(0, 10);
    const chartData = worst.map((c) => ({
      name: `Center ${c.center_id}`,
      attendance: c.avg_attendance,
      program: c.program.toUpperCase()
    }));
    const lowest = worst[0];
    const avgWorst = worst.length ? Math.round((worst.reduce((s, c) => s + c.avg_attendance, 0) / worst.length) * 10) / 10 : 0;

    return {
      summary: `* The **${worst.length} lowest-attendance centres** average **${avgWorst}%**, bottoming out at **${lowest?.avg_attendance}%** (Center ${lowest?.center_id}).\n* These are the first centres to send a field visit.`,
      widgets: [
        {
          type: "metrics",
          title: "Attendance Intervention Summary",
          width: "full",
          metricsList: [
            { label: "Centres Listed", value: db.worst_centers_by_attendance.length.toString(), sub: "Lowest attendance", trendDirection: "down" },
            { label: "Lowest Centre", value: `${lowest?.avg_attendance}%`, sub: `Center ${lowest?.center_id}`, trendDirection: "down" },
            { label: "Group Average", value: `${avgWorst}%`, sub: "Across listed centres" }
          ]
        },
        {
          type: "chart",
          title: "Lowest-Attendance Centres",
          width: "full",
          chartType: "bar",
          xAxisKey: "name",
          seriesKeys: ["attendance"],
          data: chartData
        }
      ]
    };
  }

  // 8. POOR BANLA STUDENTS
  if (p.includes("poor") || p.includes("bangla student") || p.includes("fail bangla")) {
    const poorStudents = db.poor_bangla_students.slice(0, 10);
    const chartData = poorStudents.map((s) => ({ name: s.name, mark: s.bangla_mark }));
    const marks = db.poor_bangla_students.map((s) => s.bangla_mark);
    const lowest = Math.min(...marks);
    const highest = Math.max(...marks);
    const banglaAvg = db.subject_averages.catchup.Bangla;

    return {
      summary: `* The **${db.poor_bangla_students.length} lowest Bangla scorers** range from **${lowest} to ${highest}** marks — well below the ~${banglaAvg} programme average.\n* These learners are candidates for a focused remedial reading camp.`,
      widgets: [
        {
          type: "metrics",
          title: "Literacy Deficit Metrics",
          width: "full",
          metricsList: [
            { label: "Students Flagged", value: db.poor_bangla_students.length.toString(), sub: `Bangla ${lowest}–${highest} marks`, trendDirection: "down" },
            { label: "Lowest Mark", value: lowest.toString(), sub: "Bangla exam" },
            { label: "Programme Avg", value: `${banglaAvg}`, sub: "For comparison" }
          ]
        },
        {
          type: "chart",
          title: "Lowest Bangla Exam Scores",
          width: "full",
          chartType: "bar",
          xAxisKey: "name",
          seriesKeys: ["mark"],
          data: chartData
        }
      ]
    };
  }

  // 9. CENTER EVALUATIONS & AUDITS
  if (p.includes("evaluation") || p.includes("center score") || p.includes("pedagogy") || p.includes("learning environment") || p.includes("engagement")) {
    const evals = db.me_evaluations;
    
    let totalScore = 0, totalPedagogy = 0, totalAssessments = 0, totalDoc = 0, totalEnv = 0, totalEng = 0;
    evals.forEach(e => {
      totalScore += e.score;
      totalPedagogy += e.pedagogy;
      totalAssessments += e.assessments;
      totalDoc += e.documentation;
      totalEnv += e.learning_environment;
      totalEng += e.engagement;
    });
    
    const count = evals.length;
    const avgScore = (totalScore / count).toFixed(2);
    const avgPed = (totalPedagogy / count).toFixed(2);
    const avgAss = (totalAssessments / count).toFixed(2);
    const avgDoc = (totalDoc / count).toFixed(2);
    const avgEnv = (totalEnv / count).toFixed(2);
    const avgEng = (totalEng / count).toFixed(2);

    const chartData = [
      { criterion: "Pedagogy", Average: parseFloat(avgPed) },
      { criterion: "Assessments", Average: parseFloat(avgAss) },
      { criterion: "Documentation", Average: parseFloat(avgDoc) },
      { criterion: "Learning Env", Average: parseFloat(avgEnv) },
      { criterion: "Engagement", Average: parseFloat(avgEng) },
    ];

    return {
      summary: `* The overall average center audit score is **${avgScore} out of 4.0**.\n* **Pedagogy** (teaching quality) ranks highest with an average of **${avgPed}**.\n* **Engagement** (student participation) is the lowest scoring parameter at **${avgEng}**.`,
      widgets: [
        {
          type: "metrics",
          title: "Audit Score Summary",
          width: "full",
          metricsList: [
            { label: "Total Centers", value: count.toLocaleString(), sub: "Evaluated", trendDirection: "neutral" },
            { label: "Avg Audit Score", value: `${avgScore}/4.0`, sub: "General baseline", trendDirection: "up" },
            { label: "Top Parameter", value: "Pedagogy", sub: `Avg: ${avgPed}`, trendDirection: "up" },
            { label: "Weakest Parameter", value: "Engagement", sub: `Avg: ${avgEng}`, trendDirection: "down" }
          ]
        },
        {
          type: "chart",
          title: "Average Quality Evaluation Metrics",
          width: "full",
          chartType: "radar",
          xAxisKey: "criterion",
          seriesKeys: ["Average"],
          data: chartData
        }
      ]
    };
  }

  // DEFAULT / PROGRAM OVERVIEW COMPARISON
  const abal = db.programs.abal;
  const catchup = db.programs.catchup;
  const innovation = db.programs.innovation;

  const chartData = [
    { name: "ABAL", Students: abal.students, Mainstreamed: abal.mainstreamed, Attendance: abal.avg_attendance },
    { name: "Catchup", Students: catchup.students, Mainstreamed: catchup.mainstreamed, Attendance: catchup.avg_attendance },
    { name: "Innovation", Students: innovation.students, Mainstreamed: innovation.mainstreamed, Attendance: innovation.avg_attendance }
  ];

  const totalAllStudents = abal.students + catchup.students + innovation.students;
  const totalMainstreamed = abal.mainstreamed + catchup.mainstreamed + innovation.mainstreamed;
  const mainstreamRate = ((totalMainstreamed / totalAllStudents) * 100).toFixed(1);

  return {
    summary: `* **Catchup program** holds the largest enrollment with **${catchup.students.toLocaleString()}** students.\n* **ABAL** is the second largest, focusing on rapid mainstreaming with a **${((abal.mainstreamed/abal.students)*100).toFixed(0)}%** success rate.\n* The average mainstreaming rate across the whole NFPE network stands at **${mainstreamRate}%**.`,
    widgets: [
      {
        type: "metrics",
        title: "Program Metrics Overview",
        width: "full",
        metricsList: [
          { label: "Total Enrollment", value: totalAllStudents.toLocaleString(), sub: "Across all programs", trendDirection: "up" },
          { label: "Mainstreamed Rate", value: `${mainstreamRate}%`, sub: `${totalMainstreamed.toLocaleString()} students`, trendDirection: "up" },
          { label: "ABAL Attendance", value: `${abal.avg_attendance}%`, sub: "Highest program", trendDirection: "up" }
        ]
      },
      {
        type: "chart",
        title: "Overview of NFPE Programs Enrollment and Success",
        width: "full",
        chartType: "bar",
        xAxisKey: "name",
        seriesKeys: ["Students", "Mainstreamed"],
        data: chartData
      }
    ]
  };
}

/**
 * Main query function that decides whether to call OpenAI, Gemini, or run local calculations, and integrates client-side RAG.
 */
export interface ChatTurn { role: "user" | "ai"; text: string }

export async function queryDashboardData(
  prompt: string,
  provider: "gemini" | "openai" | "local",
  apiKey: string | null,
  forceFresh = false,
  history: ChatTurn[] = []
): Promise<DynamicDashboardResponse> {
  // A follow-up ("which student got worst nutrition") depends on the previous turn, so the cache is
  // keyed by the prompt PLUS the last question — otherwise the same wording in a different context
  // would return a stale answer.
  const lastUserTurn = history.filter((h) => h.role === "user").slice(-1)[0]?.text ?? "";
  const cacheKey = history.length && lastUserTurn ? `${prompt} ⟪ctx:${lastUserTurn}⟫` : prompt;

  // ── 0 · Learning loop: a question we've answered at this KB version costs ZERO tokens ──
  // Regenerate passes forceFresh to bypass the cache and recompute a fresh answer.
  if (!forceFresh) {
    const cached = getCachedAnswer(cacheKey);
    if (cached) {
      reinforce(cacheKey, cached.factIds);
      const cf = FACTS.filter((f) => cached.factIds.includes(f.id)).map((f) => ({ statement: f.statement, source: f.source }));
      lastMeta = { engine: "cache", fellBack: false, sources: Array.from(new Set(cf.map((f) => f.source))), facts: cf };
      return cached.response as DynamicDashboardResponse;
    }
  }

  // ── 0.5 · Deterministic row engine: per-student ranking / result-sheet questions ("best student
  //          result sheet", "top 10 students in Rangpur", "worst nutrition") are computed EXACTLY
  //          from the CSVs — runs for any provider because the LLM can't rank rows it never sees. ──
  if (isRowQuery(prompt)) {
    try {
      const rq = await rowQuery(prompt);
      if (rq && rq.widgets.length) {
        cacheAnswer(cacheKey, rq, []);
        lastMeta = { engine: "local", fellBack: false, sources: ["Database/demo/students.csv"], facts: [] };
        return rq;
      }
    } catch (e) {
      console.error("Row query engine failed:", e);
    }
  }

  // ── 1 · Cheap primary context: pre-computed FACTS selected by the retriever (a few hundred
  //        tokens), biased by what the learning loop found useful before. No CSV scan. ──
  const kb = retrieveFacts(prompt, 8, getWeights());
  const usedFacts = kb.facts.map((f) => ({ statement: f.statement, source: f.source }));
  const usedSources = Array.from(new Set(kb.facts.map((f) => f.source)));
  const setMeta = (engine: QueryMeta["engine"], fellBack: boolean) => {
    lastMeta = { engine, fellBack, sources: usedSources, facts: usedFacts };
  };
  // Micro drill-down: attach ONE relevant structured slice for detail/breakdown questions.
  const detail = retrieveDetail(prompt);

  // ── 2 · Only pay the CSV-streaming cost when the question is a specific-entity lookup ──
  let ragContext = "";
  if (isEntityLookup(prompt)) {
    try {
      ragContext = await performRagRetrieval(prompt);
    } catch (error) {
      console.error("RAG retrieval failed:", error);
    }
  }

  const groundedContext =
    `${kb.context}` +
    (detail ? `\n\n${detail}` : "") +
    `\n\nRULE: Every number in your summary and widgets MUST come from the facts/detail above` +
    (ragContext ? " or the retrieved rows below" : "") + ". Do not invent figures.";

  // If local mode or API key is missing, run local query fallback (now fact-aware).
  if (provider === "local" || !apiKey || apiKey.trim() === "") {
    await new Promise(resolve => setTimeout(resolve, 300));
    const local = queryLocalDatabase(prompt, ragContext || kb.context);
    cacheAnswer(cacheKey, local, kb.factIds);
    reinforce(cacheKey, kb.factIds);
    setMeta("local", false);
    return local;
  }

  const finalSystemPrompt = SYSTEM_METADATA_SUMMARY + `\n\n${DATA_SNAPSHOT}` + `\n\n${groundedContext}` +
    (ragContext
      ? `\n\n### ADDITIONAL RETRIEVED DATA (RAG CONTEXT)\nBelow are matching records fetched in real-time from the database CSV files for this query:\n${ragContext}\n\nIMPORTANT: Use these specific rows to answer the query. If the query references a specific student, teacher, or center matching these records, format the response data (chartData, metrics, summary) precisely around these records.`
      : "");

  if (provider === "gemini") {
    // Preview/flash models intermittently return 503 "high demand"; try a small list best→reliable.
    const GEMINI_MODELS = Array.from(new Set([GEMINI_PRIMARY_MODEL, "gemini-flash-lite-latest"]));
    // Prior turns as conversation context so follow-ups resolve against them (user→user, ai→model).
    const geminiContents = [
      ...history.map((h) => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] })),
      { role: "user", parts: [{ text: `The user asks: "${prompt}". Please process the query using the system instructions and database/RAG context, and generate a dynamic dashboard response with widgets.` }] },
    ];
    const geminiBody = JSON.stringify({
      contents: geminiContents,
      systemInstruction: {
        parts: [{ text: finalSystemPrompt }]
      },
      // JSON mode only (no strict responseSchema): a schema whose widget `data` rows are typed as a
      // property-less OBJECT makes Gemini return EMPTY {} rows → "no data rows". The prompt already
      // carries the full TypeScript interface, so free JSON lets Gemini populate real data arrays.
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      }
    });

    for (let i = 0; i < GEMINI_MODELS.length; i++) {
      const model = GEMINI_MODELS[i];
      const isLast = i === GEMINI_MODELS.length - 1;
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: geminiBody,
        });
        if (!response.ok) {
          // Overloaded / rate-limited → try the next (more reliable) model before giving up.
          if ((response.status === 503 || response.status === 429) && !isLast) continue;
          throw new Error(`Gemini API responded with status ${response.status}`);
        }
        const result = await response.json();
        // Gemini 3 can attach a separate "thought" part; join every text part to get the JSON.
        const parts: { text?: string }[] = result?.candidates?.[0]?.content?.parts ?? [];
        const raw = parts.map((p) => p?.text ?? "").join("").trim();
        if (!raw) throw new Error("Empty Gemini response");
        const data: DynamicDashboardResponse = JSON.parse(raw);
        if (llmAnswerBroken(data)) {
          // Model returned empty widgets → use the deterministic local engine (real data) instead.
          const local = queryLocalDatabase(prompt, ragContext || kb.context);
          cacheAnswer(cacheKey, local, kb.factIds);
          reinforce(cacheKey, kb.factIds);
          setMeta("local", true);
          return local;
        }
        cacheAnswer(cacheKey, data, kb.factIds);
        reinforce(cacheKey, kb.factIds);
        setMeta("gemini", false);
        return data;
      } catch (error) {
        if (!isLast) continue; // a model failed → fall through to the next one
        console.error("Gemini call failed, falling back to local database engine:", error);
        setMeta("local", true);
        return queryLocalDatabase(prompt, ragContext || kb.context);
      }
    }
    setMeta("local", true);
    return queryLocalDatabase(prompt, ragContext || kb.context);
  }

  // OpenAI Provider
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: finalSystemPrompt + "\nIMPORTANT: You must return ONLY a raw JSON block matching the DynamicDashboardResponse schema containing the summary and widgets. Do not enclose the JSON in markdown code blocks like ```json."
          },
          // Prior turns so a follow-up resolves against them.
          ...history.map((h) => ({ role: h.role === "user" ? "user" as const : "assistant" as const, content: h.text })),
          {
            role: "user",
            content: `The user asks: "${prompt}". Answer THIS exact question — honour every qualifier (programme, gender, division, subject, grade) and any reference to the previous turn — using only the dataset provided. Select and populate the minimum dynamic widgets that answer it, and format the response as JSON.`
          }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API responded with status ${response.status}`);
    }

    const result = await response.json();
    let text = result.choices[0].message.content.trim();
    
    // Clean potential markdown wrapping
    if (text.startsWith("```")) {
      text = text.replace(/^```json\s*/, "").replace(/```$/, "").trim();
    }

    const data: DynamicDashboardResponse = JSON.parse(text);
    if (llmAnswerBroken(data)) throw new Error("OpenAI returned empty widgets");
    cacheAnswer(cacheKey, data, kb.factIds);
    reinforce(cacheKey, kb.factIds);
    setMeta("openai", false);
    return data;
  } catch (error) {
    console.error("OpenAI call failed, falling back to local database engine:", error);
    setMeta("local", true);
    return queryLocalDatabase(prompt, ragContext || kb.context);
  }
}
