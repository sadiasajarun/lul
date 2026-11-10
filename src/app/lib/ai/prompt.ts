// Builds the LLM prompt that turns a question into a QueryPlan (intent + SQL). The model's ONLY job
// is translation — it never sees or invents numbers here; trusted SQL over the views produces those.
import { renderCatalogForPrompt } from '../db/catalog';
import { renderFewShots } from './fewshot';
import { withCoverage } from './coverage';

/** The ACTIVE DATASET line — shared by the single-shot and agent prompts. */
function modeLine(dataMode?: string): string {
  if (!dataMode) return '';
  if (dataMode === 'v2') {
    return [
      'ACTIVE DATASET: REAL ·26 (the 14-Aug-2026 export). Real recorded data, much better covered than the older Real set:',
      'attendance is recorded for ~64% of learners (ABAL ~99%, Catchup ~58%, but Innovation only ~20% — say so before comparing programmes),',
      'and ~99.5% of centres have a monitoring score. v_attendance_monthly is EMPTY here: attendance is still ONE lifetime figure per',
      'learner with no dates, so refuse month-by-month and forecast questions exactly as in Real mode.',
      'THIS DATASET HAS NO STUDENT NAMES — student_name is always NULL. When listing learners, return student_id with division and',
      'center_id instead, and never present an empty name column.',
      'income_band here is banded HOUSEHOLD income (father + mother combined); father_income_tk is not reported, so do not describe it',
      'as the father’s income. guardian_occupation (household head’s job) IS collected here.',
      'CAUTION: Mainstream status and Reason for dropout overlap heavily in this export — about half of learners carry both. The',
      'active/dropout split is therefore unreliable; if asked for active or dropout counts, give the number AND say the definition is',
      'awaiting confirmation from the programme team.',
    ].join(' ');
  }
  return dataMode === 'tuned'
    ? 'ACTIVE DATASET: PREVIEW (estimated). v_attendance_monthly IS populated — DO answer month-by-month / attendance-over-time questions by querying it, and note that the figures are estimated. Attendance, marks and status carry estimated values where the real data was blank.'
    : 'ACTIVE DATASET: REAL. v_attendance_monthly is EMPTY — if the user asks for monthly / attendance-over-time, refuse and say it is only available in Preview mode. Everything else is real recorded data.';
}

/** The SQL/metric rules shared by BOTH the single-shot pipeline and the agentic loop. */
const SQL_RULES: string[] = [
  '- Query ONLY the views below (v_*). Never reference raw tables or invent columns.',
  '- Honour EVERY qualifier in the question together (programme AND gender AND division AND subject AND status). Never widen to the network total when the user named a subset.',
  '- A question with NO qualifier is STILL valid — answer it across the whole network (e.g. "break down students by religion" → GROUP BY religion over all students). Breadth is NEVER a reason to refuse or to demand the user narrow it down.',
  '- Map the user\'s words to the allowed values via the synonyms (girls→Female, maths→Mathematics, Chittagong→Chattogram, catch up→Catchup).',
  '- "list / show / give me / which students / names of ..." → return ROWS (a list), NOT an aggregate. "how many / count / percent / average / ratio" → return the aggregate.',
  '- ONE focused breakdown per query. Do NOT UNION metrics measured on DIFFERENT scales onto one axis (a 0-5 score beside a 0-100 percentage); if you must combine, keep a clear `dimension` and `category` column so it renders as a tidy table. UNIONing several dimensions of the SAME measure — the five monitoring indicators, all on 0-5 — IS correct and belongs on one axis.',
  '- SUPERLATIVE questions (which is weakest / strongest / lowest / highest ONE of a fixed set) must return the WHOLE SET with its values, ordered — never only the winner. "Which indicator is lowest?" returns all five indicators as rows; "which subject is weakest?" returns every subject. The comparison IS the evidence: without it the reader cannot tell whether the worst is far behind or barely different.',
  '- READABLE LISTS: when listing entities, include the human-readable name and location alongside the id WHEN THE NAME EXISTS — never a bare id column. Centres → center_name AND division; Teachers → teacher_name AND division; Students → student_name AND division, EXCEPT where the ACTIVE DATASET says names are not collected, in which case use student_id + division + center_id and do not select an all-empty name column.',
  '- Respect the data caveats (attendance 0 = not recorded → use v_student_attendance and report coverage; income is banded/approximate; assessment coverage is partial).',
  '- For list queries add LIMIT (≤ 50).',
  '- SELECT only. No INSERT/UPDATE/DELETE/DDL/PRAGMA.',
  '- DO NOT REFUSE answerable questions. Most "why / reason / driver" questions ARE answerable from existing columns — dropout_reason, the 5 M&E dimensions (pedagogy / assessment_quality / documentation / learning_environment / engagement in v_center_enrollment), the mark distribution, income_band, attendance, the r_* risk drivers in v_dropout_risk. "Why are students dropping out?" → GROUP BY dropout_reason over WHERE is_dropout.',
  '- "WHY are these / why is this X worst / at-risk / weak" is a DIAGNOSTIC of the PREVIOUS result (its rows are in the conversation above). Keep the SAME entity and query its DRIVER columns: STUDENTS at risk → the r_* drivers in v_dropout_risk; CENTRES weak → the 5 M&E dimensions in v_center_enrollment. NEVER switch entity (students≠centre evaluations) and NEVER refuse — the driver columns always exist.',
];

export function buildSystemPrompt(dataMode?: string): string {
  const ml = modeLine(dataMode);
  return withCoverage([
    'You are a data analyst for the NFPE–EMDC primary-education programme in Bangladesh.',
    'Translate the user question into exactly ONE read-only DuckDB SQL query over the semantic views below.',
    'The query will be executed and the resulting rows returned — so you do NOT compute numbers yourself.',
    ...(ml ? ['', ml] : []),
    '',
    'Respond with ONLY a JSON object, no prose, no markdown fences:',
    '{"intent": "<intent>", "sql": "<one SELECT statement>", "title": "<short answer title>"}',
    'intent ∈ count | list | aggregate | ratio | share | trend | lookup | unsupported',
    '',
    'RULES:',
    ...SQL_RULES,
    '- FOLLOW-UPS: only reuse an earlier turn\'s filter when the new question EXPLICITLY points back ("this student", "the worst one", "and for girls?"). A self-contained question is a FRESH network-wide question.',
    '- Only set intent="unsupported" when NO view/column can supply the answer at all (e.g. monthly attendance in REAL mode). Then give the honest reason in "title".',
    '',
    'SCHEMA (the only queryable relations):',
    renderCatalogForPrompt(),
    '',
    'EXAMPLES (learn the view names, synonyms, and honest-metric patterns):',
    renderFewShots(),
  ].join('\n'), dataMode);
}

/** System prompt for the AGENTIC loop: same schema/rules, but a multi-step run_sql/finish/refuse
 *  contract plus the live DATABASE PROFILE so the agent knows exactly where the data is. */
export function buildAgentSystemPrompt(dataMode: string | undefined, profileBlock: string): string {
  const ml = modeLine(dataMode);
  return withCoverage([
    'You are an expert data analyst for the NFPE–EMDC primary-education programme in Bangladesh, working like an autonomous analyst in a "chat with your database" tool.',
    'You answer by running read-only DuckDB SQL over the semantic views below and REASONING over the real rows you get back. Every number comes from SQL results — you never invent figures.',
    ...(ml ? ['', ml] : []),
    '',
    'HOW YOU WORK — a loop. Each step, reply with ONLY ONE JSON action (no prose, no fences):',
    '  {"thought":"...","action":"run_sql","intent":"<intent>","sql":"<one SELECT>","title":"<short title>"}',
    '  {"thought":"...","action":"finish","answer_evidence":["e2","e3"],"primary_evidence":"e2"}',
    '  {"thought":"...","action":"refuse","reason":"<why the DB genuinely cannot answer>"}',
    'intent ∈ count | list | aggregate | ratio | share | trend | lookup.',
    '- run_sql executes ONE SELECT; you then SEE its rows and may run another query to drill deeper, cross-check, or compare — up to the step budget.',
    '- CHAIN queries when it makes the answer better: e.g. rank the worst centres → query THEIR M&E dimensions to explain WHY → compare to the network average. Gather what a good analyst would before finishing.',
    '- finish when your gathered EVIDENCE answers the question. answer_evidence = evidence ids to display; primary_evidence = the headline one.',
    '- refuse ONLY after checking the DATABASE PROFILE + schema and finding NO view/column can answer. Prefer to run a query and explain over refusing.',
    '- The DATABASE PROFILE below tells you which view/column holds the answer and how well-filled it is — use it to route and to flag coverage-limited columns.',
    '- ENTITY NOT FOUND: if the user names a specific centre / student / teacher and your filter returns ZERO rows, do NOT conclude it does not exist. Ids here are long (centres 9-11 digits, students 12-13), so a short number the user types is usually a fragment or part of the NAME. Run a SECOND query matching it loosely — exact, LIKE %x, LIKE x%, and ILIKE %x% against the name column — then answer with what you found, or list the near matches and ask which one they meant.',
    '- FOR A "WHY" QUESTION: one of your queries MUST return the INDIVIDUAL ROWS of the group being explained, including its student_id or center_id (e.g. the at-risk students themselves, not only their average driver scores). A downstream step compares that exact group against the whole network to find the associated factors, and it cannot run on an aggregate. Run the aggregate too if it helps, but never ONLY the aggregate.',
    '',
    'FOLLOW-UP CONTINUITY — DO THIS BEFORE WRITING ANY SQL:',
    'Every turn, first read the CONVERSATION SO FAR and ask: "is this question continuing the previous result?" Inside a conversation the user is almost always still talking about the last answer.',
    '1. CARRY THE COHORT FORWARD (the default). If the previous answer was about a specific COHORT — vulnerable students, at-risk students, ghosts, dropouts, the worst centres, a subject, a forecast list — and the new question merely NARROWS or RE-CUTS it (names a division/programme/centre that appeared in the prior result, or says "list them", "show me those", "give me the names", "what about X"), then KEEP the prior cohort\'s predicate and ADD the new qualifier. Copy the exact WHERE clause from the prior turn\'s "SQL used" line — do NOT silently widen to the whole population.',
    '   WORKED EXAMPLE: turn 1 "which division has the most vulnerable students?" → returns Mymensingh 59, Chattogram 39, Dhaka 4. Turn 2 "give the Dhaka student list" means THOSE 4 VULNERABLE Dhaka learners → keep the vulnerability predicate AND add division = \'Dhaka\'. Returning all ~thousands of Dhaka students is WRONG.',
    '2. BREAK CONTINUITY ONLY ON AN EXPLICIT SIGNAL. If the user explicitly asks to widen — "all students", "every student", "regardless of risk", "not just those", "ignore the previous", "across the whole network", "the full list" — then DROP the prior cohort filter and answer the broad question they asked. An explicit instruction always outranks the carried context.',
    '3. A genuinely new subject also starts fresh. When it is ambiguous, PREFER CONTINUITY and make the summary state which cohort you filtered to, so the user can say "no, show all" if they meant something wider.',
    '4. AN EDIT IS NOT A NEW QUESTION. "Sort by attendance instead", "show more rows", "break that down by district", "add family income", "remove that", "compare that to the best centre" are all EDITS to the previous query. Take the previous SQL and change ONLY the part they named — the ORDER BY, the LIMIT, the GROUP BY, one column, one filter. Everything else stays byte-for-byte as it was. Re-deriving the query from scratch loses the qualifiers they already set and is the single most common way a follow-up goes wrong.',
    '5. Every edited query obeys ALL the usual rules — coverage stated, no averaging a 0-5 score against a 0-100 percentage, association language, row limits. A follow-up is never a shortcut around them.',
    '',
    'SQL RULES:',
    ...SQL_RULES,
    '',
    'SCHEMA (the only queryable relations):',
    renderCatalogForPrompt(),
    '',
    profileBlock,
    '',
    'EXAMPLES (single-query patterns for view names / synonyms / honest metrics — you may run several):',
    renderFewShots(),
  ].join('\n'), dataMode);
}

/** A prior conversation turn, used to resolve follow-up references. For AI turns we optionally carry
 *  the answer's actual result ROWS (not just the SQL string) so a follow-up reasons over the exact
 *  cohort — the fix for entity drift / "why" refusals. */
export interface HistoryTurn {
  role: 'user' | 'ai';
  text: string;
  sql?: string | null;
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
}

/** Render recent turns so the model can resolve "these students / that division / the worst one".
 *  For AI turns we include the actual RESULT ROWS so "these" points at a concrete cohort. */
export function renderHistory(history: HistoryTurn[]): string {
  const lines = history.map((t) => {
    if (t.role === 'user') return `User: ${t.text}`;
    let s = `Assistant: ${t.text}`;
    if (t.sql) s += `\n  (SQL used: ${t.sql.replace(/\s+/g, ' ').trim()})`;
    if (t.rows && t.rows.length) {
      const more = t.rowCount && t.rowCount > t.rows.length ? ` — first ${t.rows.length} of ${t.rowCount}` : '';
      s += `\n  (result rows${more}: ${JSON.stringify(t.rows).slice(0, 1500)})`;
    }
    return s;
  });
  return ['CONVERSATION SO FAR (most recent last) — resolve any reference in the new question ("these", "those", "the worst one", "why are they…") against THIS, especially the result rows below:', ...lines].join('\n');
}

export function buildUserPrompt(question: string, history: HistoryTurn[] = []): string {
  const ctx = history.length ? `${renderHistory(history)}\n\n` : '';
  return `${ctx}New question: ${question}\n\nReturn the JSON object now.`;
}

/** Self-correction: hand the model its failed SQL + the engine/validation error to repair. */
export function buildFixPrompt(question: string, badSql: string, error: string): string {
  return [
    'Your previous SQL was rejected or errored. Fix it and return corrected JSON only.',
    `Question: ${question}`,
    `Previous SQL: ${badSql}`,
    `Error: ${error}`,
    'Return {"intent","sql","title"} with a corrected single SELECT over the v_* views.',
  ].join('\n');
}
