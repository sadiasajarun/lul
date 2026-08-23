// Single entry point for the query engine. Today it returns the in-browser DuckDB-wasm source;
// to move to a backend later, implement `DataSource` (e.g. BackendSource that POSTs SQL to an API)
// and swap the one line below — nothing else in the pipeline changes.
//
// Data MODE: the whole app can switch between the REAL dataset and the gap-filled PREVIEW dataset.
// setDataSourceMode() re-points the same engine at the other folder; the mode persists in localStorage.
import { DuckDbSource, type DataMode } from './duckdb-source';
import type { DataSource } from './types';

const MODE_KEY = 'dataMode';
function savedMode(): DataMode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === 'tuned' || m === 'v2' ? m : 'real';
  } catch { return 'real'; }
}

let instance: DuckDbSource | null = null;

export function getDataSource(): DataSource {
  if (!instance) instance = new DuckDbSource(savedMode());
  return instance;
}

export function getDataMode(): DataMode {
  return instance ? instance.dataMode : savedMode();
}

/** Switch the whole app between 'real' and 'tuned'; reloads the engine tables from the other folder. */
export async function setDataSourceMode(mode: DataMode): Promise<void> {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
  if (!instance) instance = new DuckDbSource(mode);
  await instance.reload(mode);
}

export type { DataSource, QueryResult } from './types';
export type { DataMode } from './duckdb-source';
export { TABLES } from './types';
