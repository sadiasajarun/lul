// NOTE: the `*.csv?url` module declaration lives in src/vite-env.d.ts — declaring it here too
// is illegal inside a module (TS2666) and duplicated the ambient type.

// Demo database — clean, unified CSVs (one row per entity, numeric join key in column 1).
import studentsUrl from "../../../Database/demo/students.csv?url";
import assessmentsUrl from "../../../Database/demo/assessments.csv?url";
import attendanceUrl from "../../../Database/demo/attendance.csv?url";
import evaluationsUrl from "../../../Database/demo/evaluations.csv?url";
import teachersUrl from "../../../Database/demo/teachers.csv?url";

export interface SearchResult {
  source: string;
  header: string;
  rows: string[];
}

/** First CSV cell (quote-aware), unwrapped from Excel's `="…"`. */
function firstCell(line: string): string {
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === "," && !q) break;
    cur += c;
  }
  return cur.replace(/^=/, "").trim();
}

/**
 * CLEAN-DATA GATE (user rule: "rag always use clean and accurate data").
 *
 * Every table here is keyed by a numeric ID in column 1 (Student ID or Center ID). The exports are
 * contaminated with faker/test rows whose key is lorem text (`Iure iusto hic rerum test`) or Bengali
 * numerals. A real key is pure ASCII digits. Anything else is not real data and must never reach the
 * AI or a chart.
 */
function isCleanRow(line: string): boolean {
  const id = firstCell(line);
  if (!/^[0-9]{3,}$/.test(id)) return false;            // key must be ASCII digits
  if (/\btest\b|lorem|ipsum|faker/i.test(line)) return false; // obvious seed markers
  return true;
}

/**
 * Extracts searchable keywords from the user prompt, excluding common stop words.
 */
export function extractSearchTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, " ")
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 2);

  const stopWords = new Set([
    "show", "find", "list", "get", "view", "what", "where", "when", "who", "why", "how",
    "details", "profile", "profiles", "student", "students", "teacher", "teachers",
    "center", "centers", "program", "programs", "data", "database", "record", "records",
    "search", "about", "for", "with", "the", "and", "from", "each", "some", "many",
    "average", "total", "percentage", "rate", "performance", "score", "scores", "mark", "marks",
    "please", "information", "report", "reports", "table", "chart", "graph", "trend", "trends"
  ]);

  return words.filter(w => !stopWords.has(w));
}

/**
 * Scans a remote/local CSV file via ReadableStream to find matching lines.
 * This is memory efficient because it stops streaming once maxResults is reached.
 */
async function searchCsvFile(url: string, terms: string[], sourceName: string, maxResults = 15): Promise<SearchResult> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${sourceName}: ${response.statusText}`);
    }
    if (!response.body) {
      return { source: sourceName, header: "", rows: [] };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let { value: chunk, done: readerDone } = await reader.read();
    let buffer = "";
    const rows: string[] = [];
    let header = "";
    let isFirst = true;

    while (!readerDone || buffer) {
      if (chunk) {
        buffer += decoder.decode(chunk, { stream: true });
      }
      const lines = buffer.split(/\r?\n/);
      // Keep last incomplete chunk in buffer
      buffer = readerDone ? "" : lines.pop() || "";

      if (isFirst && lines.length > 0) {
        header = lines[0];
        isFirst = false;
      }

      for (const line of lines) {
        if (!line.trim()) continue;
        if (!isCleanRow(line)) continue; // drop faker/test rows before matching
        const lowerLine = line.toLowerCase();
        // Check if ALL terms are included in this line
        const match = terms.every(term => lowerLine.includes(term));
        if (match) {
          // Prevent duplicates
          if (!rows.includes(line)) {
            rows.push(line);
          }
          if (rows.length >= maxResults) {
            reader.cancel(); // Stop network download
            return { source: sourceName, header, rows };
          }
        }
      }

      if (readerDone) break;
      const next = await reader.read();
      chunk = next.value;
      readerDone = next.done;
    }

    return { source: sourceName, header, rows };
  } catch (error) {
    console.error(`Error searching CSV ${sourceName}:`, error);
    return { source: sourceName, header: "", rows: [] };
  }
}

/**
 * Format CSV results as a clean Markdown table.
 */
export function csvToMarkdown(header: string, rows: string[]): string {
  if (rows.length === 0) return "No matches found.";
  
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim().replace(/^"|"$/g, ""));
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^"|"$/g, ""));
    return result;
  };

  const headers = parseRow(header);
  let md = "| " + headers.join(" | ") + " |\n";
  md += "| " + headers.map(() => "---").join(" | ") + " |\n";
  for (const row of rows) {
    const fields = parseRow(row);
    // Align columns
    while (fields.length < headers.length) fields.push("");
    md += "| " + fields.slice(0, headers.length).join(" | ") + " |\n";
  }
  return md;
}

/**
 * Fetches the first few lines of a CSV to serve as a sample when no specific keyword match is found.
 */
async function getCsvSample(url: string, sourceName: string, count = 10): Promise<SearchResult> {
  try {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      return { source: sourceName, header: "", rows: [] };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let { value: chunk, done: readerDone } = await reader.read();
    let buffer = "";
    const rows: string[] = [];
    let header = "";
    let isFirst = true;

    while (!readerDone || buffer) {
      if (chunk) {
        buffer += decoder.decode(chunk, { stream: true });
      }
      const lines = buffer.split(/\r?\n/);
      buffer = readerDone ? "" : lines.pop() || "";

      if (isFirst && lines.length > 0) {
        header = lines[0];
        isFirst = false;
      }

      for (const line of lines) {
        if (!line.trim()) continue;
        if (!isCleanRow(line)) continue; // clean-data gate for sample rows too
        rows.push(line);
        if (rows.length >= count) {
          reader.cancel();
          return { source: sourceName, header, rows };
        }
      }

      if (readerDone) break;
      const next = await reader.read();
      chunk = next.value;
      readerDone = next.done;
    }
    return { source: sourceName, header, rows };
  } catch (error) {
    console.error(`Error loading sample for ${sourceName}:`, error);
    return { source: sourceName, header: "", rows: [] };
  }
}

/**
 * Runs parallel RAG search over relevant files based on user keywords.
 */
export async function performRagRetrieval(query: string): Promise<string> {
  const terms = extractSearchTerms(query);
  // Add direct numeric keys if present (student_id, center_id, teacher_id).
  const numbers = query.match(/\b\d{3,15}\b/g) || [];
  const searchTerms = Array.from(new Set([...terms, ...numbers]));

  const q = query.toLowerCase();
  const isTeacher = /teacher|instructor|staff|educator|experience/.test(q);
  const isAssessment = /assessment|exam|mark|score|subject|fail|poor|bangla|math|english|science|cycle|baseline|life skill|religion|bgs/.test(q);
  const isAttendance = /attendance|absent|present|days|worst/.test(q);
  const isEvaluation = /evaluation|pedagogy|audit|compliance|engagement|centre|center|visit/.test(q);

  if (searchTerms.length === 0) return "";

  // students is the default table (name/id/division/status/risk all live here); add the others by intent.
  const searchPromises: Promise<SearchResult>[] = [searchCsvFile(studentsUrl, searchTerms, "Students")];
  if (isTeacher) searchPromises.push(searchCsvFile(teachersUrl, searchTerms, "Teachers"));
  if (isAssessment) searchPromises.push(searchCsvFile(assessmentsUrl, searchTerms, "Assessments"));
  if (isAttendance) searchPromises.push(searchCsvFile(attendanceUrl, searchTerms, "Attendance"));
  if (isEvaluation) searchPromises.push(searchCsvFile(evaluationsUrl, searchTerms, "Centre Evaluations"));

  const results = await Promise.all(searchPromises);
  let activeResults = results.filter((r) => r.rows.length > 0);

  // Fallback: no keyword match → return a small sample of the most relevant table.
  if (activeResults.length === 0) {
    const sampleUrl = isAssessment ? assessmentsUrl : isTeacher ? teachersUrl : isEvaluation ? evaluationsUrl : isAttendance ? attendanceUrl : studentsUrl;
    const sampleName = isAssessment ? "Assessments" : isTeacher ? "Teachers" : isEvaluation ? "Centre Evaluations" : isAttendance ? "Attendance" : "Students";
    const samples = await Promise.all([getCsvSample(sampleUrl, sampleName)]);
    activeResults = samples.filter((r) => r.rows.length > 0);
  }

  if (activeResults.length === 0) {
    return "";
  }

  let ragContext = "### RETRIEVED DATABASE RECORDS (RAG CONTEXT)\n";
  ragContext += "The following real-time matches were extracted from the database CSV files:\n\n";

  for (const res of activeResults) {
    ragContext += `#### Dataset: ${res.source}\n`;
    ragContext += csvToMarkdown(res.header, res.rows);
    ragContext += "\n\n";
  }

  return ragContext;
}
