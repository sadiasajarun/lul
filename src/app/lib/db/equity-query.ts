// Real-data loader for the Equity dashboard section — disability, ethnicity, religion, nutrition,
// and disability-by-division, all counted from v_students. (In cleaning, "Not Applicable" / "-"
// already became NULL, so IS NOT NULL isolates real disability/ethnicity records.)
import type { QueryResult } from './types';

export type RunFn = (sql: string) => Promise<QueryResult>;
export interface NameValue { name: string; value: number }

export interface EquityData {
  disability: NameValue[];
  ethnicity: NameValue[];
  religion: NameValue[];
  nutrition: NameValue[];
  disabilityByDivision: { division: string; value: number }[];
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const toNV = (rows: Record<string, unknown>[]): NameValue[] =>
  rows.map((r) => ({ name: String(r.name), value: num(r.value) }));

export async function loadEquity(run: RunFn): Promise<EquityData> {
  const q = async (sql: string) => (await run(sql)).rows;

  // "name" and "value" are reserved in DuckDB — quote the aliases.
  const [disability, ethnicity, religion, nutrition, disDiv] = await Promise.all([
    q(`SELECT disability_type AS "name", count(*) AS "value" FROM v_students WHERE disability_type IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
    q(`SELECT ethnicity AS "name", count(*) AS "value" FROM v_students WHERE ethnicity IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
    q(`SELECT religion AS "name", count(*) AS "value" FROM v_students WHERE religion IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
    q(`SELECT nutrition AS "name", count(*) AS "value" FROM v_students WHERE nutrition IS NOT NULL GROUP BY 1`),
    q(`SELECT division, count(*) AS "value" FROM v_students WHERE disability_type IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`),
  ]);

  // Nutrition in a sensible order: Good → Not so good → Bad.
  const nutOrder = ['Good', 'Not so good', 'Bad'];
  const nutrition2 = toNV(nutrition).sort((a, b) => {
    const ia = nutOrder.findIndex((o) => a.name.toLowerCase().startsWith(o.toLowerCase()));
    const ib = nutOrder.findIndex((o) => b.name.toLowerCase().startsWith(o.toLowerCase()));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  return {
    disability: toNV(disability),
    ethnicity: toNV(ethnicity),
    religion: toNV(religion),
    nutrition: nutrition2,
    disabilityByDivision: disDiv.map((r) => ({ division: String(r.division), value: num(r.value) })),
  };
}
