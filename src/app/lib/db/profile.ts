// WHOLE-DATABASE KNOWLEDGE. A live profile of every queryable view — row count and, per column,
// how filled it is (coverage %), how many distinct values, and the numeric range — computed from the
// ACTIVE DuckDB dataset (Real or Preview). Injected into the agent's system prompt so it always knows
// the full shape of the DB and WHERE the data actually is: it routes to the right view and refuses
// far less. Combined with the catalog's declared value domains, this is the agent's data dictionary.
import type { DataSource } from './types';
import { VIEWS, HIDDEN_COLUMNS } from './catalog';

export interface ColumnStat { name: string; type: string; filledPct: number; distinct: number; min?: string; max?: string }
export interface ViewStat { view: string; rows: number; columns: ColumnStat[] }
export interface DbProfile { dataMode: string; views: ViewStat[] }

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(String(v ?? '').replace(/[%,]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** SUMMARIZE one view → per-column stats. Returns null if the view can't be summarised (e.g. empty in
 *  Real mode) so it's simply skipped. Runs the introspection SQL directly (app-internal, not LLM). */
async function profileView(dataSource: DataSource, view: string): Promise<ViewStat | null> {
  try {
    // SUMMARIZE cols: column_name, column_type, min, max, approx_unique, avg, std, q25, q50, q75, count, null_percentage
    const s = await dataSource.query(`SUMMARIZE SELECT * FROM ${view}`);
    if (!s.rows.length) return { view, rows: 0, columns: [] };
    const columns: ColumnStat[] = s.rows.map((r) => {
      const type = String(r.column_type ?? '');
      const isNumeric = /INT|DEC|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT/i.test(type);
      return {
        name: String(r.column_name ?? ''),
        type,
        filledPct: Math.max(0, Math.min(100, Math.round((100 - num(r.null_percentage)) * 10) / 10)),
        distinct: Math.round(num(r.approx_unique)),
        min: isNumeric && r.min != null ? String(r.min) : undefined,
        max: isNumeric && r.max != null ? String(r.max) : undefined,
      };
    });
    // A 0%-null column's non-null count == total rows, so max(count) is the true row count.
    const rows = Math.max(0, ...s.rows.map((r) => num(r.count)));
    return { view, rows, columns };
  } catch {
    return null;
  }
}

let _cache: { mode: string; profile: DbProfile } | null = null;

/** Build (and memoize per data-mode) the live profile of every queryable view. */
export async function getDbProfile(dataSource: DataSource, dataMode: string): Promise<DbProfile> {
  if (_cache && _cache.mode === dataMode) return _cache.profile;
  const stats = await Promise.all(VIEWS.map((v) => profileView(dataSource, v.name)));
  const profile: DbProfile = { dataMode, views: stats.filter((x): x is ViewStat => !!x) };
  _cache = { mode: dataMode, profile };
  return profile;
}

/** Reset the memoized profile — call on data-mode switch or after an overlay edit. */
export function invalidateDbProfile(): void { _cache = null; }

/** Render the profile as a compact block for the agent system prompt. */
/**
 * Columns the catalogue deliberately hides must not reappear here. The catalogue tells the model to
 * use the curated column on v_students and hides the raw passthrough copies on v_student_ext /
 * v_center_ext — but the profile was listing all of them again, contradicting that instruction and
 * costing ~550 tokens on EVERY planning call. Same rule, one place.
 */
function visibleColumns(view: string, columns: ColumnStat[]): ColumnStat[] {
  const hidden = HIDDEN_COLUMNS[view];
  if (!hidden) return columns;
  return columns.filter((c) => !(c.name in hidden));
}

export function renderDbProfile(p: DbProfile): string {
  const lines: string[] = [
    `DATABASE PROFILE (active dataset: ${p.dataMode.toUpperCase()}) — every queryable view with its row count and, per column, how FILLED it is. Route to the view/column that actually holds the answer; treat low-fill columns as coverage-limited (note it), and prefer a well-filled alternative when one exists.`,
  ];
  for (const v of p.views) {
    const cols = visibleColumns(v.view, v.columns);
    if (!cols.length) continue;                 // nothing left to say about this view
    lines.push(`### ${v.view} — ${v.rows.toLocaleString()} rows`);
    for (const c of cols) {
      const range = c.min != null && c.max != null ? `, range ${c.min}..${c.max}` : '';
      lines.push(`- ${c.name}: ${c.type}, ${c.filledPct}% filled, ~${c.distinct.toLocaleString()} distinct${range}`);
    }
  }
  return lines.join('\n');
}
