// SQL safety gate. The model writes SQL; this decides whether it may run.
// Read-only by construction: single SELECT/WITH statement, only the semantic views, no DDL/DML,
// and a hard row cap. Even though the engine is a local read-only DuckDB, this stops a bad query
// from hanging the tab and keeps behaviour identical when we later swap in a real backend.

import { VIEWS } from '../db/catalog';

// Allowed relations = every view documented in the catalog (single source of truth), so any new
// view added there is automatically queryable — no separate list to keep in sync.
const ALLOWED_RELATIONS = new Set(VIEWS.map((v) => v.name.toLowerCase()));

// Statement types / extension commands that must never appear.
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|attach|detach|copy|pragma|install|load|export|import|truncate|grant|revoke|vacuum|reindex)\b/i;

const ROW_CAP = 1000;

export interface ValidationResult {
  ok: boolean;
  /** The sanitized SQL to actually run (row cap appended when missing). */
  sql: string;
  error?: string;
}

export function validateSql(raw: string): ValidationResult {
  let sql = (raw ?? '').trim().replace(/;+\s*$/, ''); // drop trailing semicolons
  if (!sql) return { ok: false, sql, error: 'empty SQL' };
  if (sql.includes(';')) return { ok: false, sql, error: 'multiple statements are not allowed' };
  if (!/^(select|with)\b/i.test(sql)) return { ok: false, sql, error: 'only SELECT queries are allowed' };
  if (FORBIDDEN.test(sql)) return { ok: false, sql, error: 'query contains a forbidden (non-read) keyword' };

  // Every relation after FROM/JOIN must be an allowed view or a CTE defined in this query.
  const refs = [...sql.matchAll(/\b(?:from|join)\s+("?[a-zA-Z_][\w]*"?)/gi)].map((m) => m[1].replace(/"/g, '').toLowerCase());
  const ctes = new Set([...sql.matchAll(/\b([a-zA-Z_][\w]*)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));
  for (const r of refs) {
    if (!ALLOWED_RELATIONS.has(r) && !ctes.has(r)) {
      return { ok: false, sql, error: `relation "${r}" is not queryable — use only the semantic views (v_*)` };
    }
  }

  if (!/\blimit\b/i.test(sql)) sql = `${sql}\nLIMIT ${ROW_CAP}`;
  return { ok: true, sql };
}

export const ALLOWED_VIEW_NAMES = [...ALLOWED_RELATIONS];
