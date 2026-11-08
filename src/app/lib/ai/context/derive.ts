// Works out what a finished answer put on screen. Purely observational: it runs after the answer is
// built and cannot change it.
import type { DataMode } from '../../db/duckdb-source';
import type { DataSource } from '../../db/types';
import type { AskResult } from '../pipeline';
import type { CohortRef, EntityKind, ListItem, ListRef, MetricDef, TurnDelta } from './types';

const MAX_IDS = 200;
const MAX_ITEMS = 50;

const LOWER_IS_BETTER = /dropout|risk|absent|absence|gap|below/i;

const ENTITY_COLUMNS: { kind: EntityKind; id: string; label?: string }[] = [
  { kind: 'student', id: 'student_id', label: 'student_name' },
  { kind: 'teacher', id: 'teacher_name' },
  { kind: 'center', id: 'center_id', label: 'center_name' },
  { kind: 'center', id: 'center_name' },
  { kind: 'upazila', id: 'upazila' },
  { kind: 'district', id: 'district' },
  { kind: 'division', id: 'division' },
];

type Row = Record<string, unknown>;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pretty = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const distinct = (rows: Row[], col: string) => rows.every((r) => r[col] != null) && new Set(rows.map((r) => String(r[col]))).size === rows.length;

export function metricFrom(sql: string, columns: string[], rows: Row[]): MetricDef | undefined {
  const orderBy = [...sql.matchAll(/\border\s+by\s+([\w."]+)/gi)].pop()?.[1].replace(/"/g, '').split('.').pop();
  const numeric = columns.filter((c) => !/(^|_)id$/i.test(c) && rows.some((r) => isNum(r[c])));
  const column = orderBy && numeric.includes(orderBy) ? orderBy : numeric[0];
  if (!column) return undefined;
  return { column, label: pretty(column), betterWhen: LOWER_IS_BETTER.test(column) ? 'lower' : 'higher' };
}

function primaryResult(res: AskResult): { sql: string; columns: string[]; rows: Row[]; rowCount: number } | null {
  if (res.evidence?.rows.length) return res.evidence;
  const table = res.response.widgets.find((w) => w.type === 'table' && w.data?.length);
  if (!table?.data || !table.tableHeaders) return null;
  return { sql: res.sql ?? '', columns: table.tableHeaders, rows: table.data, rowCount: table.data.length };
}

function entityOf(columns: string[], rows: Row[]) {
  return ENTITY_COLUMNS.find((e) => columns.includes(e.id) && distinct(rows, e.id)) ?? null;
}

async function centerIdsByName(names: string[], ds: DataSource): Promise<Map<string, string>> {
  const list = names.map((n) => `'${n.replace(/'/g, "''")}'`).join(',');
  const r = await ds.query(`SELECT center_id, center_name FROM v_center_enrollment WHERE center_name IN (${list})`);
  return new Map(r.rows.map((row) => [String(row.center_name), String(row.center_id)]));
}

/** The cohort behind a result. Evidence stops at 20 rows, so longer results re-read their ids. */
async function cohortFor(kind: EntityKind, idColumn: string, sql: string, shown: string[], total: number, ds: DataSource): Promise<CohortRef> {
  if (total <= shown.length || !sql) return { kind, ids: shown, total };
  const body = sql.trim().replace(/;+\s*$/, '');
  const r = await ds.query(`SELECT "${idColumn}" AS id FROM (${body}) LIMIT ${MAX_IDS}`);
  const ids = r.rows.map((row) => String(row.id));
  return total > ids.length ? { kind, ids, total, sql: body } : { kind, ids, total };
}

/** The record for a finished answer, or undefined when it adds nothing to the conversation. */
export async function deriveTurn(res: AskResult, mode: DataMode, ds: DataSource): Promise<TurnDelta | undefined> {
  if (res.refused || res.explained || res.clarifying) return undefined;
  const primary = primaryResult(res);
  if (!primary) return res.response.widgets.length ? { v: 1, mode } : undefined;

  const entity = entityOf(primary.columns, primary.rows);
  if (!entity || primary.rowCount < 2) return { v: 1, mode };

  const metric = metricFrom(primary.sql, primary.columns, primary.rows);
  const byName = entity.kind === 'center' && entity.id === 'center_name'
    ? await centerIdsByName(primary.rows.map((r) => String(r.center_name)), ds)
    : null;
  const idOf = (r: Row) => {
    if (byName) return byName.get(String(r.center_name)) ?? String(r.center_name);
    if (entity.kind === 'teacher' && r.center_id != null) return `${r.center_id}|${r.teacher_name}`;
    return String(r[entity.id]);
  };

  const items: ListItem[] = primary.rows.slice(0, MAX_ITEMS).map((r) => ({
    id: idOf(r),
    label: entity.label && r[entity.label] != null ? String(r[entity.label]) : String(r[entity.id]),
    value: metric && isNum(r[metric.column]) ? r[metric.column] as number : undefined,
  }));
  const list: ListRef = { kind: entity.kind, items, total: primary.rowCount, metric };
  const cohort = byName
    ? { kind: entity.kind, ids: items.map((i) => i.id), total: primary.rowCount }
    : await cohortFor(entity.kind, entity.id, primary.sql, items.map((i) => i.id), primary.rowCount, ds);
  return { v: 1, mode, list, cohort, metric };
}
