// Turns query rows + intent into the DynamicDashboardResponse the existing renderer expects
// (summary + widgets). Deterministic: the widget/summary are derived from the actual rows, so
// every number shown came straight from the SQL result — nothing is model-invented at this stage.
import type { QueryResult } from '../db/types';

export interface DashboardWidget {
  type: 'chart' | 'metrics' | 'table' | 'text';
  title: string;
  /** One line under the title saying, in words, what is plotted / listed. */
  caption?: string;
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

/** A plain-language headline insight computed straight from the rows — the leader (top of the SQL's
 *  ORDER BY), its share of the total when that's meaningful, and the runner-up. No model call, so it
 *  stays grounded and costs no API quota. This is what the user reads as the "KEY INSIGHT". */
function insightSummary(rows: Record<string, unknown>[], catCol: string, valCol: string, intent: Intent): string {
  const first = rows[0];
  if (!first || !isNum(first[valCol])) return `${rows.length.toLocaleString()} result${rows.length === 1 ? '' : 's'}.`;
  const catLabel = pretty(catCol).toLowerCase();
  const metric = pretty(valCol).toLowerCase();
  const total = rows.reduce((s, row) => s + (isNum(row[valCol]) ? (row[valCol] as number) : 0), 0);
  const showShare = (intent === 'count' || intent === 'share') && total > 0;
  const share = showShare ? Math.round(((first[valCol] as number) / total) * 100) : 0;
  const second = rows[1];
  const lead = `**${fmt(first[catCol])}** tops the list — **${fmt(first[valCol])}** ${metric}${showShare ? ` (${share}% of the ${fmt(total)} total)` : ''}`;
  const rest = second && isNum(second[valCol])
    ? `\n* Next is **${fmt(second[catCol])}** (${fmt(second[valCol])}); ${rows.length} ${catLabel} compared in all.`
    : `\n* ${rows.length} ${catLabel} compared.`;
  return `* ${lead}.${rest}`;
}

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

  // ── ONE ROW, SEVERAL NUMBERS = a comparison of measures ───────────────────────────────────────
  // "Which indicator is weakest?" can come back either as five ROWS or as one row with five
  // COLUMNS, depending on how the query was written. The wide shape used to render as a single
  // unreadable table row (or, at four columns or fewer, as tiles that showed only the winner) — so
  // the reader's evidence depended on the query's shape. Melt it into one bar per measure instead,
  // and the comparison survives either way.
  const allNumeric = r.columns.length >= 3 && r.columns.every((c) => r.rows.every((row) => row[c] == null || isNum(row[c])));
  if (r.rowCount === 1 && allNumeric) {
    const row = r.rows[0];
    const measures = r.columns
      .filter((c) => isNum(row[c]))
      .map((c) => ({ measure: pretty(c).replace(/^Avg /i, ''), value: row[c] as number }))
      .sort((a, b) => a.value - b.value);
    if (measures.length >= 3) {
      const lo = measures[0], hi = measures[measures.length - 1];
      const chart: DashboardWidget = {
        type: 'chart', title, width: 'full', chartType: 'bar',
        caption: `Each measure compared, lowest first — ${measures.length} measures, from ${fmt(lo.value)} (${lo.measure}) to ${fmt(hi.value)} (${hi.measure}).`,
        xAxisKey: 'measure', seriesKeys: ['value'], data: measures,
      };
      const summary = [
        `* **${lo.measure}** is the lowest at **${fmt(lo.value)}**.`,
        `* **${hi.measure}** is the highest at **${fmt(hi.value)}**.`,
        `* ${measures.length} measures compared; the gap between them is ${fmt(Math.round((hi.value - lo.value) * 100) / 100)}.`,
      ].join('\n');
      return { summary, widgets: [chart, { type: 'table', title, width: 'full', tableHeaders: ['measure', 'value'], data: measures, caption: `The same ${measures.length} measures as a table.` }] };
    }
  }

  // Single scalar-ish row → metric tiles (count / share / ratio-of-one / single lookup).
  if (r.rowCount === 1 && r.columns.length <= 4) {
    return scalarResponse(title, r);
  }

  const table: DashboardWidget = {
    type: 'table', title, width: 'full',
    caption: `Full result — ${r.rowCount.toLocaleString()} row${r.rowCount === 1 ? '' : 's'}, ${r.columns.length} column${r.columns.length === 1 ? '' : 's'}${r.rowCount > 100 ? ' (first 100 shown)' : ''}.`,
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

  // ── TWO-DIMENSION RESULT (e.g. division × dropout_reason × students) ───────────────────────────
  // Plotting this with only the first category on the X axis repeats "Chattogram, Chattogram, …"
  // once per reason and leaves every bar unlabelled — the chart says nothing. Pivot instead: the
  // first dimension becomes the axis, each value of the second becomes its own named series, so the
  // legend explains every bar. Falls back to a combined "Division · Reason" label when the pivot
  // would produce too many series to read. Restricted to genuine breakdowns: a LIST of people also
  // has several text columns, but those are identifiers — charting them draws one bar per person.
  const groupingIntent = intent === 'aggregate' || intent === 'count' || intent === 'share' || intent === 'ratio';
  const distinctOf = (c: string) => new Set(r.rows.map((row) => String(row[c] ?? '—'))).size;
  const isIdLike = (c: string) => /(^|_)(id|name|code)$/i.test(c) || distinctOf(c) === r.rowCount;
  const chartableTwoDim =
    groupingIntent && !multiDim && catCols.length >= 2 && numCols.length === 1 &&
    r.rowCount > 1 && r.rowCount <= 60 && !isIdLike(catCols[0]) && !isIdLike(catCols[1]);
  if (chartableTwoDim) {
    const [dimA, dimB] = catCols;
    const measure = numCols[0];
    const groups = [...new Set(r.rows.map((row) => String(row[dimA] ?? '—')))];
    const seriesVals = [...new Set(r.rows.map((row) => String(row[dimB] ?? '—')))];

    if (groups.length >= 2 && groups.length <= 15 && seriesVals.length >= 2 && seriesVals.length <= 8) {
      const pivot = groups.map((g) => {
        const out: Record<string, unknown> = { [dimA]: g };
        for (const s of seriesVals) out[s] = 0;
        for (const row of r.rows) {
          if (String(row[dimA] ?? '—') !== g) continue;
          const key = String(row[dimB] ?? '—');
          if (isNum(row[measure])) out[key] = row[measure];
        }
        return out;
      });
      const chart: DashboardWidget = {
        type: 'chart', title, width: 'full', chartType: 'bar',
        caption: `${pretty(measure)} by ${pretty(dimB).toLowerCase()} (coloured bars), grouped by ${pretty(dimA).toLowerCase()} — ${groups.length} ${pretty(dimA).toLowerCase()}${groups.length === 1 ? '' : 's'} × ${seriesVals.length} ${pretty(dimB).toLowerCase()}${seriesVals.length === 1 ? '' : 's'}.`,
        xAxisKey: dimA, seriesKeys: seriesVals, data: pivot,
      };
      // Headline: the single biggest cell, named in full so the number is self-explanatory.
      const top = [...r.rows].sort((a, b) => (isNum(b[measure]) ? (b[measure] as number) : 0) - (isNum(a[measure]) ? (a[measure] as number) : 0))[0];
      const summary = top
        ? `* **${fmt(top[dimB])}** is the largest single ${pretty(dimB).toLowerCase()}, in **${fmt(top[dimA])}** — **${fmt(top[measure])}** ${pretty(measure).toLowerCase()}.\n* ${groups.length} ${pretty(dimA).toLowerCase()}s compared across ${seriesVals.length} ${pretty(dimB).toLowerCase()}s.`
        : `* ${r.rowCount} results.`;
      return { summary, widgets: [chart, table] };
    }

    // Too many series to colour-code → one bar per pair, labelled with BOTH dimensions.
    const labelKey = `${pretty(dimA)} · ${pretty(dimB)}`;
    const labelled = r.rows.slice(0, 30).map((row) => ({
      [labelKey]: `${fmt(row[dimA])} · ${fmt(row[dimB])}`,
      [measure]: row[measure],
    }));
    const chart: DashboardWidget = {
      type: 'chart', title, width: 'full', chartType: 'bar',
      caption: `${pretty(measure)} for each ${pretty(dimA).toLowerCase()} and ${pretty(dimB).toLowerCase()} pair${r.rowCount > 30 ? ` — top 30 of ${r.rowCount}` : ''}.`,
      xAxisKey: labelKey, seriesKeys: [measure], data: labelled,
    };
    return { summary: insightSummary(r.rows, dimB, measure, intent), widgets: [chart, table] };
  }

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

    // The DEFAULT view only — the reader can switch to any other chart type in the widget.
    const chartType = intent === 'trend' ? 'line' : intent === 'share' ? 'pie' : 'bar';
    const measures = series.map((s) => pretty(s).toLowerCase()).join(' and ');
    const chart: DashboardWidget = {
      type: 'chart', title, width: 'full', chartType,
      caption: `${measures.charAt(0).toUpperCase()}${measures.slice(1)} ${intent === 'trend' ? 'over' : 'for each'} ${pretty(catCol!).toLowerCase()} — ${r.rowCount} ${pretty(catCol!).toLowerCase()}${r.rowCount === 1 ? '' : 's'}.`,
      xAxisKey: catCol, seriesKeys: series, data: r.rows,
    };
    const summary = insightSummary(r.rows, catCol!, primary, intent);
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

  // Otherwise a list/table — lead with the count, and name the top row when there's a numeric column.
  const num0 = numCols[0];
  const cat0 = catCols[0];
  const topLine = num0 && cat0 && r.rows[0] && isNum(r.rows[0][num0])
    ? ` Top: **${fmt(r.rows[0][cat0])}** (${fmt(r.rows[0][num0])} ${pretty(num0).toLowerCase()}).`
    : '';
  const summary = `* **${r.rowCount.toLocaleString()}** result${r.rowCount === 1 ? '' : 's'}${r.rowCount > 100 ? ' — showing the first 100' : ''}.${topLine}`;
  return { summary, widgets: [table] };
}
