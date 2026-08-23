// EDITABLE / EXTENDABLE dataset overlay. Users can add data fields, add records, and edit cells to
// "complete the DB". Edits are applied to the in-memory DuckDB base tables and PERSISTED to
// localStorage, then re-applied on every load (boot + mode switch) so they survive. The LLM stays
// strictly SELECT-only; ONLY the app writes, through this controlled seam (bypassing validateSql).
import { invalidateDbProfile } from './profile';
import type { DataSource } from './types';

export type OverlayOp =
  | { op: 'addField'; table: string; name: string; type: string }
  | { op: 'addRow'; table: string; idCol: string; values: Record<string, unknown> }
  | { op: 'setCell'; table: string; idCol: string; id: string; col: string; value: unknown };

const KEY = 'lul_overlay_v1';
/** Only these base tables may be edited. */
export const EDITABLE_TABLES = ['students', 'centers'] as const;
export type EditableTable = (typeof EDITABLE_TABLES)[number];
/** The primary-key column per editable table. */
export const ID_COL: Record<EditableTable, string> = { students: 'student_id', centers: 'center_id' };

export function loadOverlay(): OverlayOp[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as OverlayOp[]; } catch { return []; }
}
function saveOverlay(ops: OverlayOp[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(ops)); } catch { /* quota */ }
}
export function clearOverlay(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

function ident(s: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(s)) throw new Error(`invalid identifier: ${s}`);
  return s;
}
function lit(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** The SQL statement(s) that apply one op. Guards the table + identifiers against injection. */
function opToSql(op: OverlayOp): string[] {
  if (!(EDITABLE_TABLES as readonly string[]).includes(op.table)) throw new Error(`table not editable: ${op.table}`);
  const T = ident(op.table);
  if (op.op === 'addField') return [`ALTER TABLE ${T} ADD COLUMN IF NOT EXISTS ${ident(op.name)} ${/^(INTEGER|DOUBLE|VARCHAR|BOOLEAN|DATE)$/i.test(op.type) ? op.type.toUpperCase() : 'VARCHAR'}`];
  if (op.op === 'addRow') {
    const cols = [op.idCol, ...Object.keys(op.values).filter((c) => c !== op.idCol)];
    const vals = cols.map((c) => lit(c === op.idCol ? op.values[op.idCol] : op.values[c]));
    return [`INSERT INTO ${T} (${cols.map(ident).join(', ')}) VALUES (${vals.join(', ')})`];
  }
  // setCell — edit one existing cell
  return [`UPDATE ${T} SET ${ident(op.col)} = ${lit(op.value)} WHERE ${ident(op.idCol)} = ${lit(op.id)}`];
}

/** Re-apply all persisted overlay ops to the freshly-loaded base tables (called inside loadTables,
 *  BEFORE the semantic views are built, so added columns exist for the *_ext views). Best-effort. */
export async function applyOverlay(exec: (sql: string) => Promise<void>): Promise<void> {
  const ops = loadOverlay();
  const ordered = [...ops.filter((o) => o.op === 'addField'), ...ops.filter((o) => o.op !== 'addField')];
  for (const o of ordered) {
    try { for (const sql of opToSql(o)) await exec(sql); }
    catch (e) { console.warn('[overlay] op skipped', o, (e as Error).message); }
  }
}

/** Apply one edit live AND persist it. Refreshes the DB profile so the agent sees new fields/rows. */
export async function applyAndPersist(dataSource: DataSource, op: OverlayOp): Promise<void> {
  for (const sql of opToSql(op)) await dataSource.exec(sql);
  const ops = loadOverlay();
  ops.push(op);
  saveOverlay(ops);
  invalidateDbProfile();
}
