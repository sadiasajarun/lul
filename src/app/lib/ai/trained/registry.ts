// Answers the specific standalone questions today's path provably cannot. Anything that does not
// match an entry here continues down the normal path, untouched.
import type { DataMode } from '../../db/duckdb-source';
import type { DataSource, QueryResult } from '../../db/types';
import { executeValidatedSql } from '../exec';
import { toResponse, type DashboardResponse } from '../interpret';
import type { AskResult } from '../pipeline';
import type { ConversationContext } from '../context/types';
import { NOTES, TRAINED_ENTRIES, type Param, type TrainedEntry } from './entries';
import { ensureSide, ensureTrained, TRAINED_RELATIONS } from './setup';
import { unavailableAnswer } from './unavailable';

export interface TrainedDeps { ds: DataSource; mode: DataMode }

const PREVIEW_NOTE = '* Preview data: figures are estimated and not for decisions.';
const LINK_NOTE = '* The teacher-to-student link is simulated in Preview. Real data links teachers to a center only.';

function normalize(q: string): string {
  return q.trim().toLowerCase()
    .replace(/centres?/g, (m) => (m.endsWith('s') ? 'centers' : 'center'))
    .replace(/[’]/g, "'")
    .replace(/[.?!]+\s*$/, '')
    .replace(/^(please )?(show me|give me)\b/, 'show')
    .replace(/\s+/g, ' ');
}

type Bound = { value: string } | { ask: string };

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Turns "Center X" into a real id, using the selected center when the user wrote a placeholder. */
async function bindParam(kind: Param, raw: string, ctx: ConversationContext | undefined, ds: DataSource): Promise<Bound> {
  const text = raw.trim();
  const placeholder = text.toLowerCase() === 'x';
  if (kind === 'center') {
    if (placeholder) return ctx?.selected?.kind === 'center' ? { value: ctx.selected.id } : { ask: 'Which center do you mean? Please give its name or id, or select one from a list first.' };
    const found = await ds.query(`SELECT center_id, center_name FROM tv_center_scorecard WHERE center_id = ${quote(text)} OR lower(center_name) = ${quote(text.toLowerCase())} LIMIT 5`);
    if (found.rowCount === 1) return { value: String(found.rows[0].center_id) };
    return { ask: found.rowCount ? `More than one center matches "${text}". Please give its id.` : `I couldn't find a center called "${text}". Please check the name or id.` };
  }
  if (placeholder) return { ask: `Which ${kind} do you mean? Please give the ${kind === 'student' ? 'student id' : 'name'}.` };
  if (kind === 'student') return { value: text };
  if (kind === 'staff') return { value: text.toUpperCase().replace(/\s+/g, '-') };
  // Teacher names are stored in their original case.
  const found = await ds.query(`SELECT DISTINCT teacher_name FROM v_teachers WHERE lower(teacher_name) = ${quote(text.toLowerCase())} LIMIT 2`);
  return found.rowCount ? { value: String(found.rows[0].teacher_name) } : { ask: `I couldn't find a teacher called "${text}". Please check the name.` };
}

/** One row of headline figures. Different units, so they are shown side by side and never charted. */
function tiles(title: string, r: QueryResult): DashboardResponse {
  const label = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const value = (v: unknown) => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v == null ? '—' : String(v));
  const metricsList = r.columns.map((c) => ({ label: label(c), value: value(r.rows[0][c]), sub: '' }));
  return { summary: `* **${title}**: ${metricsList.map((m) => `${m.label} ${m.value}`).join(' · ')}.`, widgets: [{ type: 'metrics', title, width: 'full', metricsList }] };
}

function findEntry(normalized: string, mode: DataMode): { entry: TrainedEntry; capture?: string } | null {
  for (const entry of TRAINED_ENTRIES) {
    if (entry.previewOnly && mode !== 'tuned') continue;
    const m = normalized.match(entry.match);
    if (m) return { entry, capture: entry.param ? m[1] : undefined };
  }
  return null;
}

/** The answer for a question with a fixed one, or null to let the normal path handle it. */
export async function answerTrained(question: string, ctx: ConversationContext | undefined, deps: TrainedDeps): Promise<AskResult | null> {
  const n = normalize(question);
  const hit = findEntry(n, deps.mode);
  if (!hit) return deps.mode === 'tuned' ? null : unavailableAnswer(n, question);

  await ensureTrained(deps.ds, deps.mode);
  let param = '';
  if (hit.entry.param && hit.capture != null) {
    const bound = await bindParam(hit.entry.param, hit.capture, ctx, deps.ds);
    if ('ask' in bound) {
      return { question, intent: 'lookup', sql: null, refused: false, attempts: 0, clarifying: true, provider: 'none', trained: true, response: { summary: bound.ask, widgets: [] } };
    }
    param = bound.value;
  }
  await ensureSide(deps.ds, deps.mode, hit.entry.side ?? []);
  const sql = hit.entry.sql(param);
  const result = await executeValidatedSql(sql, deps.ds, TRAINED_RELATIONS);
  const response = hit.entry.intent === 'lookup' && result.rowCount === 1 ? tiles(hit.entry.title, result) : toResponse(hit.entry.title, hit.entry.intent, result);
  const notes = [
    ...NOTES.filter((x) => x.match.test(n)).map((x) => `* ${x.note}`),
    ...(hit.entry.simulatedLink ? [LINK_NOTE] : []),
    ...(deps.mode === 'tuned' ? [PREVIEW_NOTE] : []),
  ];
  return {
    question, intent: hit.entry.intent, sql, refused: false, attempts: 1, trained: true, provider: 'none',
    response: { summary: [response.summary, ...notes].join('\n'), widgets: response.widgets },
    evidence: result.rowCount ? { sql, columns: result.columns, rows: result.rows.slice(0, 20), rowCount: result.rowCount } : undefined,
  };
}
