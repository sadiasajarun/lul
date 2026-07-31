// Turns query rows + intent into the DynamicDashboardResponse the existing renderer expects
// (summary + widgets). Deterministic: the widget/summary are derived from the actual rows, so
// every number shown came straight from the SQL result — nothing is model-invented at this stage.
import type { QueryResult } from '../db/types';

export interface DashboardWidget {
  type: 'chart' | 'metrics' | 'table' | 'text';
  title: string;
  width?: 'full' | 'half' | 'third';
  chartType?: 'bar' | 'line' | 'area' | 'pie' | 'radar' | 'scatter';
  xAxisKey?: string;
  seriesKeys?: string[];
  metricsList?: { label: string; value: string; sub: string }[];
  tableHeaders?: string[];
  data?: Record<string, unknown>[];
  content?: string;
}
export interface DashboardResponse { summary: string; widgets: DashboardWidget[] }

export type Intent = 'count' | 'list' | 'aggregate' | 'ratio' | 'share' | 'trend' | 'lookup' | 'unsupported';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmt = (v: unknown) => (isNum(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v == null ? '—' : String(v));

/** A one-row, mostly-numeric result → headline metric tiles. */
function scalarResponse(title: string, r: QueryResult): DashboardResponse {
  const row = r.rows[0];
  const metricsList = r.columns.map((c) => ({ label: pretty(c), value: fmt(row[c]), sub: '' }));
  const lead = metricsList.map((m) => `${m.label}: ${m.value}`).join(' · ');
  return { summary: `${title} — ${lead}.`, widgets: [{ type: 'metrics', title, width: 'full', metricsList }] };
}

/** Build the response from the SQL result, choosing a widget from the intent + data shape. */
export function toResponse(title: string, intent: Intent, r: QueryResult): DashboardResponse {
  if (r.rowCount === 0) {
    return { summary: `No matching records for: ${title}.`, widgets: [] };
  }

  // Single scalar-ish row → metric tiles (count / share / ratio-of-one / single lookup).
  if (r.rowCount === 1 && r.columns.length <= 4) {
    return scalarResponse(title, r);
  }

  const table: DashboardWidget = {
    type: 'table', title, width: 'full',
    tableHeaders: r.columns, data: r.rows.slice(0, 100),
  };

  // Category + numeric columns → chartable.
  const numCols = r.columns.filter((c) => r.rows.every((row) => row[c] == null || isNum(row[c])));
  const catCols = r.columns.filter((c) => !numCols.includes(c));
  // Split into per-dimension tables ONLY when the model returned an explicit discriminator column
  // named "dimension" (its convention for combining several breakdowns into one query). A plain list
  // that merely has several text columns (center_id, center_name, division) must NOT be split.
  const dimCol = r.columns.find((c) => /^(dimension|breakdown|group|metric)$/i.test(c) && catCols.includes(c));
  const multiDim = !!dimCol && catCols.length >= 2;
  const catCol = multiDim ? null : catCols[0];
  const canChart = !!catCol && numCols.length >= 1 && r.rowCount <= 30;

  if (canChart && (intent === 'trend' || intent === 'aggregate' || intent === 'share' || intent === 'ratio' || intent === 'count')) {
    // The headline metric: for a ratio, the "per"/"ratio" column — NOT the raw counts beside it.
    const primary =
      (intent === 'ratio' ? numCols.find((c) => /per|ratio/i.test(c)) : undefined) ?? numCols[0];

    // Only co-plot multiple series when their magnitudes are comparable; otherwise the big series
    // (e.g. 108k students) flattens the small one (a ratio of 167) into an invisible sliver.
    const peak = (c: string) => Math.max(0, ...r.rows.map((row) => (isNum(row[c]) ? Math.abs(row[c] as number) : 0)));
    const peaks = numCols.map(peak).filter((x) => x > 0);
    const spread = peaks.length ? Math.max(...peaks) / Math.min(...peaks) : 1;
    const series = intent === 'ratio' || spread > 25 ? [primary] : numCols;

    const chartType = intent === 'trend' ? 'line' : intent === 'share' ? 'pie' : 'bar';
    const chart: DashboardWidget = {
      type: 'chart', title, width: 'full', chartType,
      xAxisKey: catCol, seriesKeys: series, data: r.rows,
    };
    const summary = `${title}: ${r.rows.map((row) => `${fmt(row[catCol!])} ${fmt(row[primary])}`).slice(0, 5).join(', ')}${r.rowCount > 5 ? '…' : ''}.`;
    return { summary, widgets: [chart, table] };
  }

  // Multi-dimension result → SPLIT into one table per breakdown, instead of one merged table.
  // The discriminator is the lowest-cardinality categorical column (e.g. "Division" / "Dropout
  // Reason" / "Programme"); each of its values becomes its own titled table.
  if (multiDim && dimCol) {
    const cols = r.columns.filter((c) => c !== dimCol); // drop the discriminator (it's the title)
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of r.rows) {
      const key = String(row[dimCol] ?? '—');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(Object.fromEntries(cols.map((c) => [c, row[c]])));
    }
    const widgets: DashboardWidget[] = [...groups.entries()].map(([dim, rows]) => ({
      type: 'table', title: dim, width: 'full',
      tableHeaders: cols, data: rows.slice(0, 100),
    }));
    const summary = `${title}: ${[...groups.entries()].map(([dim, rows]) => `${dim} (${rows.length})`).join(', ')}.`;
    return { summary, widgets };
  }

  // Otherwise a list/table.
  const summary = `${title} — ${r.rowCount.toLocaleString()} row${r.rowCount === 1 ? '' : 's'}${r.rowCount > 100 ? ' (showing first 100)' : ''}.`;
  return { summary, widgets: [table] };
}
