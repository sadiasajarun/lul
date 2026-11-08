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
  /** APP-ONLY write seam (INSERT/UPDATE/ALTER) for the editable-data overlay. NEVER exposed to the
   *  LLM — LLM queries always go through validateSql (SELECT-only). Throws on error. */
  exec(sql: string): Promise<void>;
  /** Loads one optional Preview-only CSV into a table of that name. Does nothing in other datasets. */
  loadPreviewCsv?(table: string, columns: string): Promise<void>;
}

/** The analytics tables loaded from public/data/*.csv (built by scripts/build-analytics-data.mjs). */
export const TABLES = ['students', 'attendance', 'assessments', 'teachers', 'centers'] as const;

/**
 * Columns that MUST load as numbers. read_csv_auto types a column by sampling its values, so a
 * column that happens to be entirely empty in one dataset (father_income_tk is never reported in
 * the 14-08-26 export) lands as VARCHAR — and then avg()/sum() over it fails at bind time with
 * "No function matches the given name and argument types". Forcing the type keeps every dataset
 * interchangeable. Same defect the attendance_monthly stub already guards against.
 */
export const NUMERIC_COLUMNS: Record<string, string[]> = {
  students: ['father_income_tk', 'mother_income_tk', 'student_income_tk', 'household_income_tk', 'enrollment_year', 'mainstreamed'],
  attendance: ['attendance_pct', 'is_estimated'],
  assessments: ['mark'],
  centers: ['gps_lat', 'gps_lng', 'pedagogy', 'assessments', 'documentation', 'learning_environment', 'engagement', 'overall_score'],
};
/** DuckDB `types={...}` clause for a table, or '' when it has no forced columns. */
export function typesClause(table: string): string {
  const cols = NUMERIC_COLUMNS[table];
  if (!cols?.length) return '';
  return `, types={${cols.map((c) => `'${c}':'DOUBLE'`).join(', ')}}`;
}
export type TableName = (typeof TABLES)[number];
