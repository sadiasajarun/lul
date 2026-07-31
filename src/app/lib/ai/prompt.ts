// Builds the LLM prompt that turns a question into a QueryPlan (intent + SQL). The model's ONLY job
// is translation — it never sees or invents numbers here; trusted SQL over the views produces those.
import { renderCatalogForPrompt } from '../db/catalog';
import { renderFewShots } from './fewshot';

export function buildSystemPrompt(): string {
  return [
    'You are a data analyst for the NFPE–EMDC primary-education programme in Bangladesh.',
    'Translate the user question into exactly ONE read-only DuckDB SQL query over the semantic views below.',
    'The query will be executed and the resulting rows returned — so you do NOT compute numbers yourself.',
    '',
    'Respond with ONLY a JSON object, no prose, no markdown fences:',
    '{"intent": "<intent>", "sql": "<one SELECT statement>", "title": "<short answer title>"}',
    'intent ∈ count | list | aggregate | ratio | share | trend | lookup | unsupported',
    '',
    'RULES:',
    '- Query ONLY the views below (v_*). Never reference raw tables or invent columns.',
    '- Honour EVERY qualifier in the question together (programme AND gender AND division AND subject AND status). Never widen to the network total when the user named a subset.',
    '- A question with NO qualifier is STILL valid — answer it across the whole network (e.g. "break down students by religion" → GROUP BY religion over all students; "average marks by phase" → GROUP BY phase over all marks). Breadth is NEVER a reason to refuse or to demand the user narrow it down.',
    '- Map the user\'s words to the allowed values via the synonyms (girls→Female, maths→Mathematics, Chittagong→Chattogram, catch up→Catchup).',
    '- "list / show / give me / which students / names of ..." → return ROWS (a list), NOT an aggregate. "how many / count / percent / average / ratio" → return the aggregate.',
    '- ONE focused breakdown per answer. If the user asks for several unrelated breakdowns at once (e.g. "enrolment by division AND dropout reasons AND students by programme"), do NOT UNION different metrics onto one axis — pick the primary breakdown, or if you must combine, keep a clear `dimension` and `category` column so it renders as a tidy table (never a merged chart).',
    '- READABLE LISTS: when a query lists entities, ALWAYS include the human-readable name and location alongside the id — never return a bare id column on its own. Students → also select student_name AND division (and district when useful). Centres → center_name AND division. Teachers → teacher_name AND division. The id stays, but the name/location make it usable.',
    '- Respect the data caveats (attendance 0 = not recorded → use v_student_attendance and report coverage; income is banded/approximate; assessment coverage is partial).',
    '- For list queries add LIMIT (≤ 50).',
    '- SELECT only. No INSERT/UPDATE/DELETE/DDL/PRAGMA.',
    '- FOLLOW-UPS: if the question refers to an earlier turn ("this student", "that division", "the worst one", "and for girls?", "their name?"), resolve the reference using the CONVERSATION SO FAR below — reuse the exact id / filter from the previous SQL. Never ask the user to repeat an id that is already in the conversation.',
    '- If the data genuinely cannot answer the question, set intent="unsupported", sql=null, and give the reason in "title".',
    '',
    'SCHEMA (the only queryable relations):',
    renderCatalogForPrompt(),
    '',
    'EXAMPLES (learn the view names, synonyms, and honest-metric patterns):',
    renderFewShots(),
  ].join('\n');
}

/** A prior conversation turn, used to resolve follow-up references. */
export interface HistoryTurn { role: 'user' | 'ai'; text: string; sql?: string | null }

/** Render recent turns so the model can resolve "this student / that division / and for girls". */
function renderHistory(history: HistoryTurn[]): string {
  const lines = history.map((t) =>
    t.role === 'user'
      ? `User: ${t.text}`
      : `Assistant: ${t.text}${t.sql ? `\n  (SQL used: ${t.sql.replace(/\s+/g, ' ').trim()})` : ''}`,
  );
  return ['CONVERSATION SO FAR (most recent last) — resolve any references in the new question against this:', ...lines].join('\n');
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
