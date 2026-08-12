// In-browser query engine: DuckDB-wasm over the cleaned CSVs in public/data/.
//
// Bundles are imported as URLs (Vite `?url`) from the installed package rather than a CDN, so
// the app runs fully offline/local — no network, matching the private single-user deployment.
import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import semanticSql from './semantic.sql?raw';
import { TABLES, type DataSource, type QueryResult } from './types';

/** Split a multi-statement SQL script into individual statements (no ';' appears in our literals). */
function splitStatements(sql: string): string[] {
  return sql
    // Strip -- line comments FIRST, so a ';' inside a comment can never split a statement in two.
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

/** Arrow values → plain JS. BigInt (DuckDB counts) → Number so React/JSON handle them. */
function normalize(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  return v;
}

export type DataMode = 'real' | 'tuned';
const FOLDER: Record<DataMode, string> = { real: 'data', tuned: 'data-tuned' };

export class DuckDbSource implements DataSource {
  readonly kind = 'duckdb-wasm' as const;
  private db: duckdb.AsyncDuckDB | null = null;
  private ready: Promise<void> | null = null;
  private mode: DataMode;

  constructor(mode: DataMode = 'real') { this.mode = mode; }

  get dataMode(): DataMode { return this.mode; }

  init(): Promise<void> {
    // Single-flight: concurrent callers share one instantiation.
    if (!this.ready) this.ready = this.boot();
    return this.ready;
  }

  /** Switch dataset (real ⇄ tuned) — re-points the tables at the other folder on the same engine. */
  async reload(mode: DataMode): Promise<void> {
    this.mode = mode;
    if (!this.ready) return this.init(); // not booted yet → boot with this mode
    await this.loadTables();             // booted → just reload the tables
  }

  private async boot(): Promise<void> {
    const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
    const worker = new Worker(bundle.mainWorker!);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    this.db = db;
    await this.loadTables();
  }

  private async loadTables(): Promise<void> {
    if (!this.db) throw new Error('DuckDB not instantiated');
    const base = import.meta.env.BASE_URL || '/';
    const folder = FOLDER[this.mode];
    const conn = await this.db.connect();
    try {
      for (const t of TABLES) {
        const url = `${base}${folder}/${t}.csv`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}. Run: npm run build:data${this.mode === 'tuned' ? ':tuned' : ''}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        await this.db.registerFileBuffer(`${t}.csv`, buf); // overwrites any prior registration on reload
        // CREATE OR REPLACE so a mode switch rebuilds the table from the other folder.
        // sample_size=-1 scans the whole file so numeric columns (marks, income, year) type correctly.
        await conn.query(`CREATE OR REPLACE TABLE ${t} AS SELECT * FROM read_csv_auto('${t}.csv', header=true, sample_size=-1)`);
      }
      // Monthly attendance is PREVIEW-only (present in data-tuned/, absent in data/). ALWAYS start from
      // a correctly-typed EMPTY table so v_attendance_monthly type-checks — a header-only or missing CSV
      // would otherwise make read_csv_auto infer every column as VARCHAR, breaking the numeric division
      // `sum_attendance / n_students` and cascading a failure to every dashboard section.
      await conn.query(`CREATE OR REPLACE TABLE attendance_monthly (month_num INTEGER, month VARCHAR, division VARCHAR, programme VARCHAR, n_students INTEGER, sum_attendance DOUBLE)`);
      // In tuned/preview mode, replace it with the real monthly data — but only when the file actually
      // has rows (so an empty/served-as-HTML file can never re-introduce the all-VARCHAR bug). Real mode
      // does not fetch at all → no 404 noise and guaranteed correct types.
      if (this.mode === 'tuned') {
        const mRes = await fetch(`${base}${folder}/attendance_monthly.csv`).catch(() => null);
        const mText = mRes && mRes.ok ? await mRes.text() : '';
        const hasRows = mText.startsWith('month_num') && mText.trim().split('\n').length > 1;
        if (hasRows) {
          await this.db.registerFileBuffer('attendance_monthly.csv', new TextEncoder().encode(mText));
          await conn.query(`CREATE OR REPLACE TABLE attendance_monthly AS SELECT * FROM read_csv_auto('attendance_monthly.csv', header=true, sample_size=-1)`);
        }
      }
      // Rebuild the semantic layer (views are CREATE OR REPLACE) on top of the tables.
      for (const stmt of splitStatements(semanticSql)) await conn.query(stmt);
    } finally {
      await conn.close();
    }
  }

  async query(sql: string): Promise<QueryResult> {
    await this.init();
    if (!this.db) throw new Error('DuckDB not instantiated');
    const conn = await this.db.connect();
    try {
      const table = await conn.query(sql);
      const columns = table.schema.fields.map((f) => f.name);
      const rows = table.toArray().map((row) => {
        const obj = row.toJSON() as Record<string, unknown>;
        for (const k of Object.keys(obj)) obj[k] = normalize(obj[k]);
        return obj;
      });
      return { columns, rows, rowCount: rows.length };
    } finally {
      await conn.close();
    }
  }
}
