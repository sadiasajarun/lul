// Real-data loader for the Learning dashboard section — average marks by subject × programme, and
// the weakest subject per programme, computed from v_marks (the same marks the chat uses).
import type { QueryResult } from './types';

export type RunFn = (sql: string) => Promise<QueryResult>;

export interface LearningData {
  subjects: string[];
  subjectData: { subject: string; ABAL: number; Catchup: number; Innovation: number }[];
  weakestByProgramme: { programme: string; subject: string; value: number }[];
  /** % of students who have any recorded mark (assessment coverage). */
  coveragePct: number;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const PROGS = ['ABAL', 'Catchup', 'Innovation'] as const;

export async function loadLearning(run: RunFn): Promise<LearningData> {
  const rows = (await run(
    `SELECT subject, programme, round(avg(mark), 1) avg FROM v_marks GROUP BY subject, programme`,
  )).rows;
  const cov = (await run(
    `SELECT round(100.0 * count(DISTINCT student_id) / (SELECT count(*) FROM v_students), 1) pct FROM v_marks`,
  )).rows[0] ?? {};

  // Pivot subject × programme → one row per subject with a column per programme.
  const subjects = [...new Set(rows.map((r) => String(r.subject)))];
  const subjectData = subjects.map((subject) => {
    const row: { subject: string; ABAL: number; Catchup: number; Innovation: number } = { subject, ABAL: 0, Catchup: 0, Innovation: 0 };
    for (const p of PROGS) {
      const hit = rows.find((r) => r.subject === subject && r.programme === p);
      row[p] = hit ? num(hit.avg) : 0;
    }
    return row;
  });

  // Weakest (lowest-average) subject per programme.
  const weakestByProgramme = PROGS.map((p) => {
    let subject = subjects[0] ?? '—';
    let value = Infinity;
    for (const sd of subjectData) {
      if (sd[p] > 0 && sd[p] < value) { value = sd[p]; subject = sd.subject; }
    }
    return { programme: p, subject, value: value === Infinity ? 0 : value };
  });

  return { subjects, subjectData, weakestByProgramme, coveragePct: num(cov.pct) };
}
