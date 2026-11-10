/**
 * ANSWERS A TURN THAT REFERS BACK TO AN EARLIER ONE.
 *
 * Runs after the resolver has decided what the turn points at. Every figure comes from fixed SQL
 * bound to the exact rows or center from earlier turns. Only the optional wording of a postmortem or
 * a diagnosis goes through the model, and a numbers check falls back to the plain text if it strays.
 */
import type { DataMode } from '../../db/duckdb-source';
import type { DataSource, QueryResult } from '../../db/types';
import { executeValidatedSql, extractJson } from '../exec';
import { unsupportedNumbers } from '../explain';
import { toResponse, type DashboardResponse, type DashboardWidget, type Intent } from '../interpret';
import type { AskResult, Generate } from '../pipeline';
import type { HistoryTurn } from '../prompt';
import { resolveTurn, type Criterion, type FacetKey, type Resolved, type Scope } from '../context/resolve';
import type { ConversationContext, DerivedItem, EntityRef, MetricDef, TurnDelta } from '../context/types';
import { facetParts, metaFor, METRICS, type MetricMeta, type Part, type Where } from './facets';
import { ensureSide, ensureTrained, networkStats, TRAINED_RELATIONS, type ScoreColumn } from './setup';

export interface BoundDeps { ds: DataSource; mode: DataMode; generate: Generate }

type Row = Record<string, unknown>;

const POSTMORTEM_FACETS: FacetKey[] = ['attendance', 'results', 'cycle', 'dropout', 'mainstream', 'teachers', 'monitoring', 'visits', 'observations', 'cmc', 'cash'];

const ESTIMATED = '* Preview data: figures are estimated and not for decisions.';
const SMALL_GROUP = 30;

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (n: number) => Math.round(n * 10) / 10;
const fmt = (v: unknown) => (isNum(v) ? round(v).toLocaleString() : v == null ? 'not recorded' : String(v));

// Geography comes from the students, because a center's learners can span more than one area.
const inArea = (column: string, value: string) => `center_id IN (SELECT DISTINCT center_id FROM v_students WHERE ${column} = ${quote(value)})`;

interface Focus { where: Where; label: string; grouped: boolean; entity?: EntityRef }

/** What a scope means in SQL. Null when the scope is not something these analyses can cover. */
function focusFor(scope: Scope, ctx: ConversationContext): Focus | null {
  if (scope.kind === 'cohort') {
    const c = ctx.cohort;
    if (!c?.ids.length) return null;
    const list = c.sql ? `SELECT center_id FROM (${c.sql}) AS prior` : c.ids.map(quote).join(',');
    return {
      where: (a) => `${a ? `${a}.` : ''}center_id IN (${list})`,
      label: `These ${c.total} centers`,
      grouped: true,
    };
  }
  const e = scope.entity;
  const label = e.label ?? e.id;
  if (e.kind === 'center') return { where: (a) => `${a ? `${a}.` : ''}center_id = ${quote(e.id)}`, label, grouped: false, entity: e };
  if (e.kind === 'district' || e.kind === 'upazila' || e.kind === 'division') {
    return { where: (a) => `${a ? `${a}.` : ''}${inArea(e.kind, e.id)}`, label: `${label} ${e.kind}`, grouped: true, entity: e };
  }
  return null;
}

async function run(deps: BoundDeps, sql: string): Promise<QueryResult> {
  return executeValidatedSql(sql, deps.ds, TRAINED_RELATIONS);
}

interface Built { part: Part; result: QueryResult }

async function runParts(deps: BoundDeps, parts: Part[]): Promise<Built[]> {
  const out: Built[] = [];
  for (const part of parts) {
    if (part.side) await ensureSide(deps.ds, deps.mode, part.side);
    const result = await run(deps, part.sql);
    out.push({ part, result });
  }
  return out;
}

function table(title: string, rows: Row[], caption?: string): DashboardWidget {
  return { type: 'table', title, width: 'full', caption, tableHeaders: rows.length ? Object.keys(rows[0]) : [], data: rows };
}

interface Answer {
  summary: string[];
  widgets?: DashboardWidget[];
  built?: Built[];
  primary?: { sql: string; columns: string[]; rows: Row[]; rowCount: number };
  turn?: Partial<TurnDelta>;
}

function finish(question: string, deps: BoundDeps, a: Answer): AskResult {
  const widgets: DashboardWidget[] = [...(a.widgets ?? [])];
  const seen = new Set(widgets.map((w) => w.title));
  for (const { part, result } of a.built ?? []) {
    const r: DashboardResponse = toResponse(part.title, part.intent, result);
    for (const w of r.widgets) {
      const key = `${w.type}:${w.title}`;
      if (!seen.has(key)) { seen.add(key); widgets.push(w); }
    }
  }
  const first = a.built?.find((b) => b.result.rowCount > 0);
  const primary = a.primary ?? (first && { sql: first.part.sql, columns: first.result.columns, rows: first.result.rows.slice(0, 20), rowCount: first.result.rowCount });
  const lines = [...a.summary];
  if (deps.mode === 'tuned') lines.push(ESTIMATED);
  const turn: TurnDelta = { v: 1, mode: deps.mode, bound: true, ...a.turn };
  return {
    question, intent: 'lookup', sql: primary?.sql ?? null, refused: false, attempts: 1, trained: true, provider: 'none',
    response: { summary: lines.join('\n'), widgets }, evidence: primary, turn,
  };
}

function clarify(question: string, text: string, options: EntityRef[] | undefined, mode: DataMode): AskResult {
  const numbered = options?.length ? `\n${options.map((o, i) => `${i + 1}. ${o.label ?? o.id}`).join('\n')}` : '';
  return {
    question, intent: 'lookup', sql: null, refused: false, attempts: 0, clarifying: true, provider: 'none', trained: true,
    response: { summary: `${text}${numbered}`, widgets: [] },
    turn: options?.length ? { v: 1, mode, bound: true, pending: options } : undefined,
  };
}

/* ───────────────────────── measures compared with the network or a peer ───────────────────────── */

interface Gap { meta: MetricMeta; a: number; b: number; gap: number; z: number; aBetter: boolean }

function gapsBetween(a: Row, bValue: (k: ScoreColumn) => number | null): Gap[] {
  const stats = networkStats();
  const gaps: Gap[] = [];
  for (const meta of METRICS) {
    const av = a[meta.key];
    const bv = bValue(meta.key);
    const sd = stats[meta.key].sd;
    if (!isNum(av) || bv == null || !sd) continue;
    const gap = av - bv;
    gaps.push({ meta, a: av, b: bv, gap, z: gap / sd, aBetter: meta.better === 'higher' ? gap >= 0 : gap <= 0 });
  }
  return gaps.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
}

const network = (k: ScoreColumn) => networkStats()[k].median;
const NETWORK = 'network_median';
const NETWORK_NOTE = 'Network median: the middle value across all centers.';

/** Measures with no value here, so a missing row is stated rather than silently dropped. */
function notRecorded(row: Row, label: string, mode: DataMode): string[] {
  const datasetWide: ScoreColumn[] = mode === 'tuned' ? [] : ['visits', 'negative_observations'];
  const missing = METRICS.filter((m) => !datasetWide.includes(m.key) && !isNum(row[m.key])).map((m) => m.label);
  const lines = missing.length ? [`* Not recorded for ${label}: ${missing.join(', ')}.`] : [];
  if (datasetWide.length) lines.push('* Not recorded in this dataset: staff and PO visits, monitoring observations.');
  return lines;
}

async function scorecardRows(deps: BoundDeps, where: string): Promise<Row[]> {
  return (await run(deps, `SELECT * FROM tv_center_scorecard WHERE ${where} ORDER BY center_id`)).rows;
}

/** One row of means, so a group can be compared on the same footing as a single center. */
function meanRow(rows: Row[]): Row {
  const out: Row = {};
  for (const m of METRICS) {
    const vals = rows.map((r) => r[m.key]).filter(isNum);
    out[m.key] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }
  return out;
}

async function focusRow(deps: BoundDeps, focus: Focus): Promise<{ rows: Row[]; row: Row } | null> {
  const rows = await scorecardRows(deps, focus.where());
  if (!rows.length) return null;
  return { rows, row: rows.length === 1 ? rows[0] : meanRow(rows) };
}

function gapRows(gaps: Gap[], aName: string, bName: string): Row[] {
  return gaps.map((g) => ({ measure: g.meta.label, [aName]: round(g.a), [bName]: round(g.b), difference: round(g.gap) }));
}

/* ──────────────────────────────────── narration (optional) ────────────────────────────────────── */

async function narrate(deps: BoundDeps, question: string, facts: string, fallback: string[]): Promise<string[]> {
  const system = [
    'You are an education programme analyst. Write the answer from the FACTS only.',
    'Reply as JSON: {"bullets": ["...", "..."]} with 3 to 5 short plain-language bullets.',
    'Use only numbers that appear in FACTS. Describe associations, never proven causes.',
  ].join(' ');
  try {
    const out = extractJson<{ bullets?: string[] }>(await deps.generate(system, `QUESTION: ${question}\n\nFACTS:\n${facts}`));
    const bullets = (out?.bullets ?? []).filter((b) => typeof b === 'string' && b.trim());
    if (bullets.length && !unsupportedNumbers(bullets.join(' '), facts).length) return bullets.map((b) => `* ${b.replace(/^[*\-•]\s*/, '')}`);
  } catch { /* the deterministic text below is a complete answer */ }
  return fallback;
}

const factsOf = (gaps: Gap[]) => gaps.map((g) => `${g.meta.label}: ${round(g.a)} vs ${round(g.b)}`).join('\n');

/* ────────────────────────────────────── individual handlers ───────────────────────────────────── */

async function selectEntity(question: string, entity: EntityRef, deps: BoundDeps): Promise<AskResult> {
  const lines: string[] = [];
  let enriched = entity;
  let widgets: DashboardWidget[] = [];
  if (entity.kind === 'center') {
    const row = (await scorecardRows(deps, `center_id = ${quote(entity.id)}`))[0];
    if (row) {
      enriched = { ...entity, label: String(row.center_name), division: String(row.division ?? ''), district: String(row.district ?? ''), upazila: String(row.upazila ?? '') };
      const gaps = gapsBetween(row, network);
      widgets = [table(`${enriched.label}: compared with the network`, gapRows(gaps, 'this_center', NETWORK), NETWORK_NOTE)];
      lines.push(`* Selected **${enriched.label}**${row.district ? ` in ${row.district}` : ''}: ${fmt(row.students)} students.`);
      if ((row.students as number) < SMALL_GROUP) lines.push(`* With so few students, its rates can swing on one or two learners.`);
      lines.push(...notRecorded(row, 'this center', deps.mode));
    }
  } else if (entity.kind === 'district' || entity.kind === 'upazila' || entity.kind === 'division') {
    const rows = await scorecardRows(deps, inArea(entity.kind, entity.id));
    const row = meanRow(rows);
    widgets = [table(`${entity.label ?? entity.id}: compared with the network`, gapRows(gapsBetween(row, network), 'this_area', NETWORK), `This area: the mean across its ${rows.length} centers. ${NETWORK_NOTE}`)];
    const students = (await run(deps, `SELECT count(*) AS n FROM v_students WHERE ${entity.kind} = ${quote(entity.id)}`)).rows[0].n as number;
    lines.push(`* Selected **${entity.label ?? entity.id}** ${entity.kind}: ${rows.length} center${rows.length === 1 ? '' : 's'}, ${students.toLocaleString()} students.`);
    if (students < SMALL_GROUP) lines.push(`* With so few students, its rates can swing on one or two learners.`);
    lines.push(...notRecorded(row, 'any center in this area', deps.mode));
  }
  if (!lines.length) lines.push(`* Selected **${entity.label ?? entity.id}**.`);
  return finish(question, deps, { summary: lines, widgets, turn: { selected: enriched } });
}

async function takeRows(question: string, ctx: ConversationContext, n: number, end: 'top' | 'bottom', deps: BoundDeps): Promise<AskResult> {
  const list = ctx.list!;
  const items = end === 'top' ? list.items.slice(0, n) : list.items.slice(-n);
  const nameCol = list.kind === 'center' ? 'center' : list.kind;
  const rows = items.map((i) => ({ [nameCol]: i.label ?? i.id, ...(list.metric && i.value != null ? { [list.metric.column]: i.value } : {}) }));
  const cohort = { kind: list.kind, ids: items.map((i) => i.id), total: items.length };
  return finish(question, deps, {
    summary: [`* The ${end} ${items.length} of the ${list.total} shown above.`],
    widgets: [table(`${end === 'top' ? 'Top' : 'Bottom'} ${items.length} from the previous list`, rows)],
    primary: { sql: '', columns: Object.keys(rows[0] ?? {}), rows, rowCount: rows.length },
    turn: { list: { ...list, items, total: items.length }, cohort },
  });
}

const CRITERION_LABEL: Record<string, string> = { dropout_rate_pct: 'dropout rate', avg_attendance: 'attendance', avg_mark: 'results', mainstream_rate_pct: 'mainstream transition', visits: 'PO visits', me_score: 'M&E score' };

async function refine(question: string, ctx: ConversationContext, criteria: Criterion[], limit: number | undefined, deps: BoundDeps): Promise<AskResult> {
  const focus = focusFor({ kind: 'cohort' }, ctx)!;
  const stats = networkStats();
  const usable = criteria.filter((c) => deps.mode === 'tuned' || c.metric !== 'visits');
  const notes: string[] = criteria.length > usable.length ? ['* PO visits are not recorded in this dataset, so that condition could not be applied. The earlier group of centers stays as it was.'] : [];
  if (!usable.length) return finish(question, deps, { summary: notes });

  const conds = [focus.where()];
  for (const c of usable) {
    const avg = stats[c.metric as ScoreColumn].avg;
    conds.push(`${c.metric} IS NOT NULL`);
    if (c.direction === 'above' && avg != null) conds.push(`${c.metric} > ${avg}`);
    if (c.direction === 'below' && avg != null) conds.push(`${c.metric} < ${avg}`);
  }
  const ranked = usable.find((c) => c.direction === 'highest' || c.direction === 'lowest');
  const sortMetric = (ranked ?? usable[0]).metric;
  const dir = ranked ? (ranked.direction === 'highest' ? 'DESC' : 'ASC') : metaFor(sortMetric)?.better === 'lower' ? 'ASC' : 'DESC';
  const columns = [...new Set(usable.map((c) => c.metric))].join(', ');
  // Ties go to the larger center: a 0% rate over 200 learners says more than one over 10.
  const base = `SELECT center_id, center_name, district, ${columns}, students FROM tv_center_scorecard WHERE ${conds.join(' AND ')} ORDER BY ${sortMetric} ${dir}, students DESC, center_id`;
  const all = await run(deps, base);
  if (!all.rowCount) {
    return finish(question, deps, { summary: [...notes, `* None of those ${ctx.cohort?.total ?? ''} centers meet that condition.`] });
  }
  const shown = limit ? all.rows.slice(0, limit) : all.rows;
  const lastValue = shown[shown.length - 1][sortMetric];
  const tiedAll = all.rows.filter((r) => r[sortMetric] === lastValue).length;
  const tiedShown = shown.filter((r) => r[sortMetric] === lastValue).length;
  const metric: MetricDef = { column: sortMetric, label: CRITERION_LABEL[sortMetric] ?? sortMetric, betterWhen: metaFor(sortMetric)?.better ?? 'higher' };
  const items = shown.map((r) => ({ id: String(r.center_id), label: String(r.center_name), value: isNum(r[sortMetric]) ? r[sortMetric] as number : undefined }));
  const title = `${shown.length} of the previous ${ctx.cohort?.total ?? ''} centers by ${metric.label}`;
  const result: QueryResult = { columns: all.columns, rows: shown, rowCount: shown.length };
  const valueText = (v: unknown) => `${fmt(v)}${sortMetric.endsWith('_pct') ? '%' : ''} ${metric.label}`;
  const summary = [`* **${shown.length}** of the previous ${ctx.cohort?.total ?? ''} centers. First: **${String(shown[0].center_name)}** (${valueText(shown[0][sortMetric])}).`, ...notes];
  if (tiedAll > tiedShown) {
    summary.push(`* ${tiedAll} of the ${ctx.cohort?.total ?? all.rowCount} centers have ${valueText(lastValue)}; showing the ${tiedShown} with the most students.`);
  }
  return finish(question, deps, {
    summary,
    built: [{ part: { title, intent: 'list', sql: base }, result }],
    // The list remembers this ranking, but "performance" later in the chain keeps its original meaning.
    turn: { list: { kind: 'center', items, total: shown.length, metric }, cohort: { kind: 'center', ids: items.map((i) => i.id), total: shown.length } },
  });
}

async function analyse(question: string, focus: Focus, facets: FacetKey[], diagnose: boolean, deps: BoundDeps, full = false): Promise<AskResult> {
  const parts: Part[] = [];
  const missing: string[] = [];
  for (const key of facets) {
    const out = facetParts(key, focus.where, focus.label, deps.mode, focus.grouped);
    parts.push(...out.parts);
    if (out.missing) missing.push(out.missing);
  }
  const built = await runParts(deps, parts);
  const widgets: DashboardWidget[] = [];
  const summary: string[] = [];

  if (diagnose || full) {
    const data = await focusRow(deps, focus);
    if (data) {
      const gaps = gapsBetween(data.row, network);
      widgets.push(table(`${focus.label}: compared with the network`, gapRows(gaps, 'this_focus', NETWORK), NETWORK_NOTE));
      const worst = gaps.filter((g) => !g.aBetter && g.meta.controllable).slice(0, 3);
      const strongest = gaps.filter((g) => g.aBetter && g.meta.controllable).slice(0, 3);
      const fallback = [
        worst.length ? `* Furthest behind the network: ${worst.map((g) => `**${g.meta.label}** (${fmt(g.a)} vs ${fmt(g.b)})`).join('; ')}.` : '* No measure is behind the network median.',
        strongest.length ? `* Furthest ahead: ${strongest.map((g) => `**${g.meta.label}** (${fmt(g.a)} vs ${fmt(g.b)})`).join('; ')}.` : '',
        '* These are associations in the data, not proven causes.',
      ].filter(Boolean);
      summary.push(...await narrate(deps, question, `${focus.label}\n${factsOf(gaps)}`, fallback));
      // Dataset-wide gaps are already named by the facets that needed them.
      summary.push(...notRecorded(data.row, focus.grouped ? 'any of these centers' : 'this center', deps.mode).filter((l) => !l.includes('in this dataset')));
    }
  } else {
    const firstRows = built.find((b) => b.result.rowCount > 0);
    if (firstRows) summary.push(`**${firstRows.part.title}**`, toResponse(firstRows.part.title, firstRows.part.intent, firstRows.result).summary);
  }
  const empty = built.filter((b) => !b.result.rowCount).map((b) => b.part.title.split(': ').pop());
  if (empty.length) summary.push(`* No records in this dataset for **${focus.label}**: ${empty.join(', ')}.`);
  if (missing.length) summary.push(`* Not recorded in this dataset: ${missing.join('; ')}.`);
  return finish(question, deps, { summary, widgets, built, turn: { facet: facets[0] } });
}

async function dropoutContributors(question: string, focus: Focus, n: number, deps: BoundDeps): Promise<AskResult> {
  const area = focus.entity!;
  const dropped = `s.is_dropout AND s.mainstream_status IS DISTINCT FROM 'Mainstreamed'`;
  const sql = `SELECT s.center_id, c.center_name, count(*) FILTER (WHERE ${dropped}) AS dropouts, count(*) AS students_in_area, round(100.0 * count(*) FILTER (WHERE ${dropped}) / count(*), 1) AS dropout_rate_pct FROM v_students s JOIN tv_center_scorecard c ON c.center_id = s.center_id WHERE s.${area.kind} = ${quote(area.id)} GROUP BY s.center_id, c.center_name ORDER BY dropouts DESC, s.center_id LIMIT ${n}`;
  const result = await run(deps, sql);
  if (!result.rowCount) return finish(question, deps, { summary: [`* No centers are recorded for ${focus.label}.`] });
  const metric: MetricDef = { column: 'dropouts', label: 'Dropouts', betterWhen: 'lower' };
  const items = result.rows.map((r) => ({ id: String(r.center_id), label: String(r.center_name), value: r.dropouts as number }));
  return finish(question, deps, {
    summary: [`* ${result.rowCount === 1 ? 'The only center' : `The ${result.rowCount} centers with the most dropouts`} in **${focus.label}**. First: **${String(result.rows[0].center_name)}** (${fmt(result.rows[0].dropouts)} dropouts).`],
    built: [{ part: { title: `${focus.label}: centers contributing most to dropout`, intent: 'list', sql }, result }],
    turn: { list: { kind: 'center', items, total: result.rowCount, metric }, cohort: { kind: 'center', ids: items.map((i) => i.id), total: result.rowCount }, metric },
  });
}

/** A scorecard column a list can be ranked by: any compared measure, or the combined score. */
type RankColumn = ScoreColumn | 'performance_score';

const COLUMN_ALIASES: [RegExp, RankColumn][] = [[/performance/i, 'performance_score'], [/drop/i, 'dropout_rate_pct'], [/attend/i, 'avg_attendance'], [/mark|result/i, 'avg_mark'], [/mainstream/i, 'mainstream_rate_pct'], [/me_score|overall|m_e|score/i, 'me_score']];

/** The scorecard column for the metric the user has been ranking by. */
function rankingColumn(ctx: ConversationContext): RankColumn {
  const col = ctx.metric?.column ?? '';
  return COLUMN_ALIASES.find(([re]) => re.test(col))?.[1] ?? 'me_score';
}

const rankLabel = (c: string) => (c === 'performance_score' ? 'performance score' : metaFor(c)?.label ?? c);

async function compareWithPeer(question: string, ctx: ConversationContext, focus: Focus, target: 'best' | 'worst', geo: 'district' | 'upazila', deps: BoundDeps): Promise<AskResult> {
  const self = focus.entity;
  if (!self || self.kind !== 'center') return clarify(question, 'Which single center should I compare? Please select one first.', undefined, deps.mode);
  const place = self[geo];
  if (!place) return finish(question, deps, { summary: [`* The ${geo} of **${self.label ?? self.id}** is not recorded, so I can't find a center in the same ${geo}.`] });

  let column: RankColumn = rankingColumn(ctx);
  const conds = `${geo} = ${quote(place)} AND center_id <> ${quote(self.id)}`;
  const anyWith = async (c: RankColumn) => (await run(deps, `SELECT count(*) AS n FROM tv_center_scorecard WHERE ${conds} AND ${c} IS NOT NULL`)).rows[0].n as number;
  const notes: string[] = [];
  if (!(await anyWith(column))) {
    const others = (await run(deps, `SELECT count(*) AS n FROM tv_center_scorecard WHERE ${conds}`)).rows[0].n as number;
    if (!others) return finish(question, deps, { summary: [`* **${self.label ?? self.id}** is the only center recorded in ${place}, so there is no other center to compare it with.`] });
    notes.push(column === 'performance_score'
      ? `* The other centers in ${place} are too small, or have too few measures, for a performance score, so average marks were used to rank them.`
      : `* ${rankLabel(column)} is not recorded for the other centers in ${place}, so average marks were used to rank them.`);
    column = 'avg_mark';
    if (!(await anyWith(column))) return finish(question, deps, { summary: [`* The other centers in ${place} have no comparable measures recorded.`] });
  }
  const better = metaFor(column)?.better ?? 'higher';
  const desc = (target === 'best') === (better === 'higher');
  const peerSql = `SELECT center_id, center_name FROM tv_center_scorecard WHERE ${conds} AND ${column} IS NOT NULL ORDER BY ${column} ${desc ? 'DESC' : 'ASC'}, center_id LIMIT 1`;
  const peer = (await run(deps, peerSql)).rows[0];
  const [a] = await scorecardRows(deps, `center_id = ${quote(self.id)}`);
  const [b] = await scorecardRows(deps, `center_id = ${quote(String(peer.center_id))}`);
  const peerRef: EntityRef = { kind: 'center', id: String(peer.center_id), label: String(peer.center_name), district: String(b.district ?? ''), upazila: String(b.upazila ?? '') };
  const gaps = gapsBetween(a, (k) => (isNum(b[k]) ? b[k] as number : null));
  const rows = gapRows(gaps, String(a.center_name), String(b.center_name));
  return finish(question, deps, {
    summary: [`* **${self.label ?? self.id}** compared with **${peerRef.label}**, the ${target} center in ${place} by ${rankLabel(column)}.`, ...notes],
    widgets: [table(`${a.center_name} vs ${b.center_name}`, rows)],
    primary: { sql: peerSql, columns: Object.keys(rows[0] ?? {}), rows: rows.slice(0, 20), rowCount: rows.length },
    turn: { comparison: { a: self, b: peerRef } },
  });
}

/** The gaps the current chain is reasoning about: a chosen pair if there is one, else the network. */
async function currentGaps(ctx: ConversationContext, focus: Focus, deps: BoundDeps): Promise<{ gaps: Gap[]; aName: string; bName: string } | null> {
  if (ctx.comparison) {
    const [a] = await scorecardRows(deps, `center_id = ${quote(ctx.comparison.a.id)}`);
    const [b] = await scorecardRows(deps, `center_id = ${quote(ctx.comparison.b.id)}`);
    if (a && b) return { gaps: gapsBetween(a, (k) => (isNum(b[k]) ? b[k] as number : null)), aName: String(a.center_name), bName: String(b.center_name) };
  }
  const data = await focusRow(deps, focus);
  return data ? { gaps: gapsBetween(data.row, network), aName: focus.label, bName: NETWORK } : null;
}

function toDerived(gaps: Gap[], aName: string, bName: string): DerivedItem[] {
  return gaps.map((g) => ({ key: g.meta.key, label: g.meta.label, detail: `${aName}: ${fmt(g.a)}, ${bName}: ${fmt(g.b)}`, controllable: g.meta.controllable }));
}

/** "The best center" with no pair chosen yet means the best one in the same district. */
async function withBestPeer(ctx: ConversationContext, focus: Focus, deps: BoundDeps): Promise<ConversationContext> {
  const self = focus.entity;
  if (ctx.comparison || self?.kind !== 'center' || !self.district) return ctx;
  const column = rankingColumn(ctx);
  const dir = metaFor(column)?.better === 'lower' ? 'ASC' : 'DESC';
  const peer = (await run(deps, `SELECT center_id, center_name FROM tv_center_scorecard WHERE district = ${quote(self.district)} AND center_id <> ${quote(self.id)} AND ${column} IS NOT NULL ORDER BY ${column} ${dir}, center_id LIMIT 1`)).rows[0];
  return peer ? { ...ctx, comparison: { a: self, b: { kind: 'center', id: String(peer.center_id), label: String(peer.center_name) } } } : ctx;
}

async function biggestDifferences(question: string, ctx: ConversationContext, focus: Focus, n: number, deps: BoundDeps): Promise<AskResult> {
  const data = await currentGaps(ctx, focus, deps);
  if (!data) return finish(question, deps, { summary: ['* No comparable measures are recorded for that center.'] });
  const top = data.gaps.slice(0, n);
  const rows = gapRows(top, data.aName, data.bName);
  return finish(question, deps, {
    summary: [
      `* The ${top.length} biggest differences, ranked by how unusual each gap is across the network: ${top.map((g) => `**${g.meta.label}**`).join(', ')}.`,
      '* Different measures use different scales, so each gap is ranked relative to the normal spread of that measure.',
    ],
    widgets: [table(`${top.length} biggest differences: ${data.aName} vs ${data.bName}`, rows)],
    primary: { sql: '', columns: Object.keys(rows[0] ?? {}), rows, rowCount: rows.length },
    turn: { derived: { type: 'differences', items: toDerived(top, data.aName, data.bName) } },
  });
}

async function derivedItems(ctx: ConversationContext, focus: Focus, deps: BoundDeps): Promise<DerivedItem[]> {
  if (ctx.derived?.items.length) return ctx.derived.items;
  const data = await currentGaps(ctx, focus, deps);
  return data ? toDerived(data.gaps.slice(0, 5), data.aName, data.bName) : [];
}

async function controllable(question: string, ctx: ConversationContext, focus: Focus, deps: BoundDeps): Promise<AskResult> {
  const items = await derivedItems(ctx, focus, deps);
  const rows = items.map((i) => ({ measure: i.label, operationally_controllable: i.controllable ? 'Yes' : 'No', why: metaFor(i.key)?.why ?? '', figures: i.detail }));
  const yes = items.filter((i) => i.controllable);
  return finish(question, deps, {
    summary: [yes.length ? `* Likely controllable: ${yes.map((i) => `**${i.label}**`).join(', ')}.` : '* None of these differences looks operationally controllable.', '* This is a judgement about each type of measure, not something the data proves.'],
    widgets: [table('What management can realistically change', rows)],
    turn: ctx.derived ? undefined : { derived: { type: 'differences', items } },
  });
}

async function lessons(question: string, ctx: ConversationContext, focus: Focus, deps: BoundDeps): Promise<AskResult> {
  const data = await currentGaps(ctx, focus, deps);
  if (!data) return finish(question, deps, { summary: ['* No comparable measures are recorded for that center.'] });
  const wanted = ctx.derived?.items.length ? new Set(ctx.derived.items.map((i) => i.key)) : null;
  const strong = data.gaps.filter((g) => g.aBetter && g.meta.controllable && g.meta.lesson && (!wanted || wanted.has(g.meta.key))).slice(0, 5);
  const fallback = strong.length
    ? strong.map((g) => `* **${g.meta.lesson}**: ${g.meta.label} is ${fmt(g.a)} here vs ${fmt(g.b)}.`)
    : ['* Nothing in these measures stands out as a practice worth copying.'];
  const summary = await narrate(deps, question, factsOf(strong), fallback);
  summary.push('* Treat these as practices to test elsewhere: the data shows association, not cause.');
  const rows = strong.map((g) => ({ practice: g.meta.lesson, measure: g.meta.label, here: round(g.a), comparison: round(g.b) }));
  return finish(question, deps, {
    summary,
    widgets: rows.length ? [table('Practices worth testing elsewhere', rows)] : [],
    turn: { derived: { type: 'lessons', items: strong.map((g) => ({ key: g.meta.key, label: g.meta.lesson, detail: g.meta.label, controllable: true })) } },
  });
}

async function priorities(ctx: ConversationContext, focus: Focus, deps: BoundDeps): Promise<Gap[]> {
  const data = await currentGaps(ctx, focus, deps);
  return data ? data.gaps.filter((g) => !g.aBetter && g.meta.controllable && g.meta.fix) : [];
}

async function interventions(question: string, ctx: ConversationContext, focus: Focus, n: number, deps: BoundDeps): Promise<AskResult> {
  const gaps = (await priorities(ctx, focus, deps)).slice(0, n);
  if (!gaps.length) return finish(question, deps, { summary: ['* This center is not behind the comparison on any measure management can act on.'] });
  const rows = gaps.map((g, i) => ({ priority: i + 1, intervention: g.meta.fix, measure: g.meta.label, current: round(g.a), comparison: round(g.b) }));
  return finish(question, deps, {
    summary: [`* The ${gaps.length} priorities below target the largest gaps management can act on.`, '* They are suggestions based on these gaps, so check them against local knowledge first.'],
    widgets: [table(`${gaps.length} priority interventions: ${focus.label}`, rows)],
    primary: { sql: '', columns: Object.keys(rows[0]), rows, rowCount: rows.length },
  });
}

async function plan(question: string, ctx: ConversationContext, focus: Focus, deps: BoundDeps): Promise<AskResult> {
  const gaps = (await priorities(ctx, focus, deps)).slice(0, 3);
  if (!gaps.length) return finish(question, deps, { summary: ['* This center is not behind the comparison on any measure management can act on.'] });
  const rows = [
    ...gaps.map((g) => ({ period: 'Days 1-30', action: g.meta.fix, target_measure: g.meta.label, starting_point: round(g.a), reference_level: round(g.b) })),
    ...gaps.map((g) => ({ period: 'Days 31-60', action: `Review progress on ${g.meta.label.toLowerCase()} and adjust the approach.`, target_measure: g.meta.label, starting_point: round(g.a), reference_level: round(g.b) })),
    ...gaps.map((g) => ({ period: 'Days 61-90', action: `Re-measure ${g.meta.label.toLowerCase()} and decide what to continue.`, target_measure: g.meta.label, starting_point: round(g.a), reference_level: round(g.b) })),
  ];
  return finish(question, deps, {
    summary: [`* A 90-day plan for **${focus.label}**, built around its ${gaps.length} largest gaps that management can act on.`, '* The reference level is what the comparison achieves, not a guaranteed target.'],
    widgets: [table(`90-day improvement plan: ${focus.label}`, rows)],
  });
}

async function characteristics(question: string, ctx: ConversationContext, n: number | undefined, deps: BoundDeps): Promise<AskResult> {
  const focus = focusFor({ kind: 'cohort' }, ctx);
  if (!focus) return clarify(question, 'Which centers do you mean? Please show a list first.', undefined, deps.mode);
  const data = await focusRow(deps, focus);
  if (!data) return finish(question, deps, { summary: ['* No measures are recorded for those centers.'] });
  const gaps = gapsBetween(data.row, network);
  const shareBetter = (g: Gap) => {
    const vals = data.rows.map((r) => r[g.meta.key]).filter(isNum);
    const avg = network(g.meta.key)!;
    const hits = vals.filter((v) => (g.gap >= 0 ? v >= avg : v <= avg)).length;
    return vals.length ? Math.round((100 * hits) / vals.length) : 0;
  };
  const scored = gaps.filter((g) => shareBetter(g) > 50).map((g) => ({ g, share: shareBetter(g) })).sort((x, y) => y.share * Math.abs(y.g.z) - x.share * Math.abs(x.g.z));
  const top = scored.slice(0, n ?? 6);
  const rows = top.map(({ g, share }) => ({ pattern: `${g.meta.label} ${g.gap >= 0 ? 'above' : 'below'} the network`, group_average: round(g.a), [NETWORK]: round(g.b), pct_of_these_centers_sharing_it: share }));
  return finish(question, deps, {
    summary: [
      top.length ? `* Most consistent across these ${data.rows.length} centers: ${top.slice(0, 3).map(({ g }) => `**${g.meta.label}**`).join(', ')}.` : '* These centers do not share a consistent pattern.',
      ...(data.rows.length < 15 ? [`* With only ${data.rows.length} centers, treat these patterns as indicative.`] : []),
    ],
    widgets: rows.length ? [table(`Shared patterns across ${data.rows.length} centers`, rows)] : [],
    primary: rows.length ? { sql: '', columns: Object.keys(rows[0]), rows, rowCount: rows.length } : undefined,
    turn: { derived: { type: 'patterns', items: top.map(({ g, share }) => ({ key: g.meta.key, label: g.meta.label, detail: `${fmt(g.a)} vs ${fmt(g.b)} network, shared by ${share}% of centers`, controllable: g.meta.controllable })) } },
  });
}

async function applyToBottom(question: string, ctx: ConversationContext, n: number, deps: BoundDeps): Promise<AskResult> {
  const column = rankingColumn(ctx);
  const dir = metaFor(column)?.better === 'lower' ? 'DESC' : 'ASC';
  const keys = (ctx.derived?.items ?? []).filter((i) => i.controllable).map((i) => i.key).filter((k) => metaFor(k)).slice(0, 4);
  const cols = keys.length ? keys : ['avg_attendance', 'avg_mark', 'dropout_rate_pct'];
  const sql = `SELECT center_id, center_name, district, ${[...new Set([column, ...cols])].join(', ')} FROM tv_center_scorecard WHERE ${column} IS NOT NULL ORDER BY ${column} ${dir}, center_id LIMIT ${n}`;
  const result = await run(deps, sql);
  const fixes = cols.map((k) => metaFor(k)).filter((m): m is MetricMeta => !!m && !!m.fix);
  const rows = fixes.map((m) => {
    const avg = network(m.key);
    const behind = result.rows.filter((r) => isNum(r[m.key]) && avg != null && (m.better === 'higher' ? (r[m.key] as number) < avg : (r[m.key] as number) > avg)).length;
    return { pattern: m.label, action_for_these_centers: m.fix, centers_behind_network: behind, of_centers: result.rowCount };
  });
  return finish(question, deps, {
    summary: [`* The bottom **${result.rowCount}** centers by ${rankLabel(column)}, and how each replicable pattern applies to them.`, '* Start where most of these centers fall behind the network.'],
    widgets: [table('How to apply each pattern', rows)],
    built: [{ part: { title: `Bottom ${result.rowCount} centers`, intent: 'list', sql }, result }],
  });
}

const HYPOTHESIS_MEASURES: ScoreColumn[] = ['pedagogy', 'assessment_quality', 'avg_attendance', 'students_per_teacher', 'visits'];

async function hypothesis(question: string, ctx: ConversationContext, step: 'test' | 'evidence' | 'missing', deps: BoundDeps): Promise<AskResult> {
  if (step === 'missing') {
    const needed = [
      'Classroom observations of teaching practice, rated the same way across centers',
      ...(deps.mode === 'tuned' ? [] : ['A record of which teacher teaches which students', 'Teacher attendance records']),
      'Teacher training and coaching history',
      'Measured student progress over time for the same learners',
      ...(deps.mode === 'tuned' ? ['Real records to replace the simulated Preview figures'] : []),
    ];
    return finish(question, deps, {
      summary: ['* Confirming this needs data that links teaching directly to learner progress.', ...needed.map((d) => `* ${d}.`)],
      widgets: [table('Data needed before confirming', needed.map((d) => ({ data_needed: d })))],
    });
  }
  const focus = focusFor({ kind: 'cohort' }, ctx);
  const data = focus ? await focusRow(deps, focus) : null;
  if (!focus || !data) return clarify(question, 'Which centers do you mean? Please show a list first.', undefined, deps.mode);
  const gaps = gapsBetween(data.row, network).filter((g) => HYPOTHESIS_MEASURES.includes(g.meta.key));
  const pedagogy = gaps.find((g) => g.meta.key === 'pedagogy');
  const assess = gaps.find((g) => g.meta.key === 'assessment_quality');
  const weak = [pedagogy, assess].filter((g): g is Gap => !!g && !g.aBetter);
  const rows = gaps.map((g) => ({
    measure: g.meta.label, these_centers: round(g.a), [NETWORK]: round(g.b),
    reading: g.meta.key === 'pedagogy' || g.meta.key === 'assessment_quality'
      ? (g.aBetter ? 'Against the hypothesis' : 'Supports the hypothesis')
      : 'Context: another possible explanation',
  }));
  const verdict = !pedagogy && !assess
    ? '* Teaching-quality scores are not recorded for these centers, so the data cannot test this.'
    : weak.length
      ? `* Possibly. ${weak.map((g) => `${g.meta.label} is ${fmt(g.a)} vs ${fmt(g.b)} across the network`).join('; ')}. That is consistent with weaker teaching, but does not prove it.`
      : '* The M&E teaching scores for these centers are not below the network, so they do not point to teaching quality.';
  const summary = step === 'test'
    ? [verdict, ...(data.rows.length < 15 ? [`* With only ${data.rows.length} centers, this is indicative at most.`] : [])]
    : [verdict, '* The table marks which measures support or weaken the idea, and which point to other explanations.'];
  return finish(question, deps, {
    summary,
    widgets: [table(step === 'test' ? 'Teaching quality: what the scores show' : 'Evidence for and against', rows)],
    primary: { sql: '', columns: Object.keys(rows[0] ?? {}), rows, rowCount: rows.length },
    turn: { hypothesis: { factor: 'teaching quality', text: verdict } },
  });
}

async function strongestFactor(question: string, focus: Focus, deps: BoundDeps): Promise<AskResult> {
  const sql = `SELECT (s.is_dropout AND s.mainstream_status IS DISTINCT FROM 'Mainstreamed') AS dropped, count(*) AS n, avg(a.avg_attendance_recorded) AS attendance, avg(b.bl) AS baseline, 100.0 * avg(CASE WHEN s.income_band IN ('<5000', '5000-9999') THEN 1 ELSE 0 END) AS low_income_pct, 100.0 * avg(CASE WHEN s.disability_type IS NOT NULL AND s.disability_type <> '' THEN 1 ELSE 0 END) AS cwd_pct, 100.0 * avg(CASE WHEN s.gender = 'Girl' THEN 1 ELSE 0 END) AS girls_pct FROM v_students s LEFT JOIN v_student_attendance a USING (student_id) LEFT JOIN (SELECT student_id, avg(mark) AS bl FROM v_marks WHERE phase = 'BL' GROUP BY student_id) b USING (student_id) WHERE ${focus.where('s')} GROUP BY 1`;
  const result = await run(deps, sql);
  const left = result.rows.find((r) => r.dropped === true);
  const stayed = result.rows.find((r) => r.dropped === false);
  if (!left || !stayed) return finish(question, deps, { summary: [`* **${focus.label}** has no recorded dropouts to compare against retained learners, or no retained learners.`] });
  const labels: [string, string][] = [['attendance', 'Attendance (%)'], ['baseline', 'Baseline marks'], ['low_income_pct', 'Low-income learners (%)'], ['cwd_pct', 'Learners with disabilities (%)'], ['girls_pct', 'Girls (%)']];
  const rows = labels
    .filter(([k]) => isNum(left[k]) && isNum(stayed[k]))
    .map(([k, label]) => {
      const a = left[k] as number, b = stayed[k] as number;
      return { factor: label, dropped_out: round(a), stayed: round(b), relative_gap_pct: Math.round((100 * Math.abs(a - b)) / (Math.max(Math.abs(a), Math.abs(b)) || 1)) };
    })
    .sort((x, y) => y.relative_gap_pct - x.relative_gap_pct);
  const top = rows[0];
  return finish(question, deps, {
    summary: [
      top ? `* The largest difference between learners who left and those who stayed is **${top.factor}** (${top.dropped_out} vs ${top.stayed}).` : '* No comparable factors are recorded.',
      `* Based on ${fmt(left.n)} dropouts and ${fmt(stayed.n)} other learners. This is an association, not a proven cause.`,
    ],
    widgets: [table(`${focus.label}: learners who left vs stayed`, rows)],
    primary: { sql, columns: Object.keys(rows[0] ?? {}), rows, rowCount: rows.length },
  });
}

/** The instruction for a refinement the fixed conditions cannot express. The model still writes it. */
function refineInstruction(ctx: ConversationContext, question: string): string | null {
  const c = ctx.cohort;
  if (!c?.ids.length) return null;
  const column = c.kind === 'student' ? 'student_id' : c.kind === 'center' ? 'center_id' : c.kind;
  return [
    'THIS TURN NARROWS THE PREVIOUS RESULT. It is not a new question.',
    `The user is asking: "${question}"`,
    `Restrict the query to exactly these ${c.kind} values with ${column} IN (${c.ids.map(quote).join(', ')}).`,
    'Do not widen the group. Say in your title that the result is limited to the previous list.',
  ].join('\n');
}

export interface BoundOutcome { result?: AskResult; instruction?: string }

/** Answers the turn if it refers back to an earlier one. Empty outcome means it stands alone. */
export async function answerBoundTurn(question: string, ctx: ConversationContext | undefined, deps: BoundDeps, history: HistoryTurn[] = []): Promise<BoundOutcome> {
  const last = [...history].reverse().find((t) => t.role === 'ai' && t.rows?.length);
  const priorSingleCenter = !!last && (last.rowCount ?? last.rows!.length) === 1 && !!last.columns?.some((c) => c === 'center_id' || c === 'center_name');
  const r: Resolved | null = resolveTurn(question, ctx, { priorSingleCenter });
  if (!r || !ctx) return {};
  if (r.type === 'clarify') return { result: clarify(question, r.question, r.options, deps.mode) };
  if (r.type === 'refine_open') {
    const instruction = refineInstruction(ctx, question);
    return instruction ? { instruction } : {};
  }

  await ensureTrained(deps.ds, deps.mode);
  const withFocus = (scope: Scope) => focusFor(scope, ctx);

  switch (r.type) {
    case 'select': return { result: await selectEntity(question, r.entity, deps) };
    case 'take': return { result: await takeRows(question, ctx, r.n, r.end, deps) };
    case 'refine': return { result: await refine(question, ctx, r.criteria, r.limit, deps) };
    case 'characteristics': return { result: await characteristics(question, ctx, r.n, deps) };
    case 'hypothesis': return { result: await hypothesis(question, ctx, r.step, deps) };
    case 'apply_bottom': return { result: await applyToBottom(question, ctx, r.n, deps) };
    default: break;
  }

  const focus = withFocus(r.scope);
  if (!focus) return {};
  switch (r.type) {
    case 'facets': return { result: await analyse(question, focus, r.facets, !!r.diagnose, deps) };
    case 'postmortem': return { result: await analyse(question, focus, POSTMORTEM_FACETS, false, deps, true) };
    case 'compare': return { result: await compareWithPeer(question, ctx, focus, r.target, r.geo, deps) };
    case 'compare_similar': return { result: await analyse(question, focus, [], true, deps) };
    case 'differences': return { result: await biggestDifferences(question, r.versusBest ? await withBestPeer(ctx, focus, deps) : ctx, focus, r.n, deps) };
    case 'contributors': return { result: await dropoutContributors(question, focus, r.n, deps) };
    case 'controllable': return { result: await controllable(question, ctx, focus, deps) };
    case 'lessons': return { result: await lessons(question, ctx, focus, deps) };
    case 'interventions': return { result: await interventions(question, ctx, focus, r.n, deps) };
    case 'plan': return { result: await plan(question, ctx, focus, deps) };
    case 'strongest_factor': return { result: await strongestFactor(question, focus, deps) };
  }
}

export type { Intent };
