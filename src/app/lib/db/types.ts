// The swappable data-source seam. The AI pipeline (intent → SQL → validate → execute →
// interpret) talks ONLY to this interface, so moving from the in-browser DuckDB-wasm engine
// to a real backend (Postgres/Supabase) later means writing one new implementation of
// `DataSource` — the pipeline, semantic layer, few-shot examples, and eval harness are unchanged.

export interface QueryResult {
  /** Column names in select order. */
  columns: string[];
  /** One object per row, keyed by column name. BigInt counts are coerced to Number. */
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface DataSource {
  /** Which backend is live — surfaced in the UI and useful for debugging. */
  readonly kind: 'duckdb-wasm' | 'backend';
  /** Idempotent: instantiate the engine and load the tables. Safe to await repeatedly. */
  init(): Promise<void>;
  /** Run a read-only SQL SELECT and return rows. Throws on SQL/engine error. */
  query(sql: string): Promise<QueryResult>;
}

/** The analytics tables loaded from public/data/*.csv (built by scripts/build-analytics-data.mjs). */
export const TABLES = ['students', 'attendance', 'assessments', 'teachers', 'centers'] as const;
export type TableName = (typeof TABLES)[number];
