// Shared low-level helpers reused by BOTH the single-hop pipeline and the agentic loop, so the
// grounding/validation seam never diverges.
import type { DataSource, QueryResult } from '../db/types';
import { validateSql } from './validate';

/** Validate + run ONE read-only SQL over the DataSource. Throws with a clear message on a
 *  validation or execution error, so callers can feed it back to the model or surface it. */
export async function executeValidatedSql(sql: string, dataSource: DataSource): Promise<QueryResult> {
  const check = validateSql(sql);
  if (!check.ok) throw new Error(check.error ?? 'invalid SQL');
  return dataSource.query(check.sql);
}

/** Extract a JSON object from model text, tolerating ```json fences / surrounding prose. Null on failure. */
export function extractJson<T>(raw: string): T | null {
  try {
    let t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}
