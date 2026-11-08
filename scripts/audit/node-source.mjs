// Native-DuckDB stand-in for src/app/lib/db/duckdb-source.ts, so the real pipeline can run in Node.
// Reads the same CSVs and the same semantic layer as the browser.
import duckdb from 'duckdb';
import fs from 'node:fs';
import path from 'node:path';
import { TABLES, typesClause } from '../../src/app/lib/db/types.ts';

const ROOT = process.cwd();
const FOLDER = { real: 'data', tuned: 'data-tuned', v2: 'data-v2' };
const PREVIEW_ONLY = {
  attendance_monthly: '(month_num INTEGER, month VARCHAR, division VARCHAR, programme VARCHAR, n_students INTEGER, sum_attendance DOUBLE)',
  attendance_center_monthly: '(center_id VARCHAR, month_num INTEGER, month VARCHAR, n_students INTEGER, sum_attendance DOUBLE)',
  attendance_gaps: '(student_id VARCHAR, last_attended_month VARCHAR, days_since_last_attendance INTEGER, recent_attendance_pct DOUBLE)',
};
const PREVIEW_TYPES = { attendance_gaps: `, types={'student_id':'VARCHAR'}`, attendance_center_monthly: `, types={'center_id':'VARCHAR'}` };

const normalize = (v) => (typeof v === 'bigint' ? Number(v) : v);

export class DuckDbSource {
  kind = 'duckdb-wasm';

  constructor(mode = 'real') { this.mode = mode; this.ready = null; this.sideFetches = []; }

  get dataMode() { return this.mode; }

  init() {
    if (!this.ready) this.ready = this.boot();
    return this.ready;
  }

  async reload(mode) { this.mode = mode; this.ready = null; return this.init(); }

  all(sql) { return new Promise((res, rej) => this.db.all(sql, (e, r) => (e ? rej(e) : res(r)))); }

  async boot() {
    const dir = path.join(ROOT, 'public', FOLDER[this.mode]).replace(/\\/g, '/');
    this.dir = dir;
    this.db = new duckdb.Database(':memory:');
    await this.all(`PRAGMA memory_limit='${process.env.E2E_MEMORY_LIMIT || '768MB'}'`);
    await this.all('PRAGMA threads=1');
    await this.all(`PRAGMA temp_directory='${path.join(ROOT, 'node_modules', '.cache', 'duckdb-audit').replace(/\\/g, '/')}'`);
    for (const t of TABLES) await this.all(`CREATE TABLE ${t} AS SELECT * FROM read_csv_auto('${dir}/${t}.csv', header=true, sample_size=-1${typesClause(t)})`);
    for (const [t, cols] of Object.entries(PREVIEW_ONLY)) {
      await this.all(`CREATE TABLE ${t} ${cols}`);
      const file = `${dir}/${t}.csv`;
      if (this.mode === 'tuned' && fs.existsSync(file)) {
        await this.all(`CREATE OR REPLACE TABLE ${t} AS SELECT * FROM read_csv_auto('${file}', header=true, sample_size=-1${PREVIEW_TYPES[t] ?? ''})`);
      }
    }
    const semantic = fs.readFileSync(path.join(ROOT, 'src', 'app', 'lib', 'db', 'semantic.sql'), 'utf8');
    for (const s of semantic.replace(/--[^\n]*/g, '').split(';').map((x) => x.trim()).filter(Boolean)) await this.all(s);
  }

  async query(sql) {
    await this.init();
    const rows = (await this.all(sql)).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normalize(v)])));
    return { columns: rows.length ? Object.keys(rows[0]) : [], rows, rowCount: rows.length };
  }

  async exec(sql) { await this.init(); await this.all(sql); }

  /** Loads one Preview side-table CSV (the browser fetches it instead). */
  async loadPreviewCsv(table, columns) {
    await this.init();
    this.sideFetches.push(table);
    if (this.mode !== 'tuned') return;
    const file = `${this.dir}/${table}.csv`;
    if (!fs.existsSync(file)) return;
    await this.all(`CREATE OR REPLACE TABLE ${table} AS SELECT * FROM read_csv('${file}', header=true, columns={${columns}})`);
  }
}
