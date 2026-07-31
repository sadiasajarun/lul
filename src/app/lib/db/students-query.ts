// Real-data loader for the Students dashboard section (replaces Database/demo/* imports).
// Injectable `run` (a DataSource.query) so it's testable in Node like the rest of the engine.
import type { QueryResult } from './types';

export type RunFn = (sql: string) => Promise<QueryResult>;

export interface StudentsData {
  total: number;
  mainstreamed: number;
  remaining: number;
  rate: number;
  genderByProgramme: { name: string; Boys: number; Girls: number }[];
  dropoutReasons: { reason: string; count: number }[];
  totalDropouts: number;
  poverty: number;
  // Real early-warning: among NOT-mainstreamed learners, count adverse signals
  // (recorded dropout reason, recorded attendance < 50%, avg mark < 20). No synthetic score.
  risk: {
    bands: { Critical: number; High: number; Elevated: number };
    nonMainstreamed: number;
    top: {
      student_id: string; student_name: string | null; programme: string; division: string | null;
      reason: string | null; attendance: number | null; avg_mark: number | null; signals: number;
    }[];
  };
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export async function loadStudents(run: RunFn): Promise<StudentsData> {
  const one = async (sql: string) => (await run(sql)).rows[0] ?? {};
  const many = async (sql: string) => (await run(sql)).rows;

  const status = await one(
    `SELECT count(*) total, count(*) FILTER (WHERE is_mainstreamed) mainstreamed FROM v_students`,
  );
  const gender = await many(
    `SELECT programme,
       count(*) FILTER (WHERE gender_label='Male')   boys,
       count(*) FILTER (WHERE gender_label='Female') girls
     FROM v_students GROUP BY programme`,
  );
  const dropout = await many(
    `SELECT dropout_reason reason, count(*) count FROM v_students WHERE is_dropout GROUP BY 1 ORDER BY 2 DESC`,
  );

  // Early-warning signals over non-mainstreamed learners.
  const riskCte = `
    WITH marks AS (SELECT student_id, avg(avg_mark) avg_mark FROM v_student_subject GROUP BY student_id),
    base AS (
      SELECT s.student_id, s.programme, s.division, s.dropout_reason,
             sa.student_name, sa.avg_attendance_recorded att, m.avg_mark,
             (CASE WHEN s.dropout_reason IS NOT NULL THEN 1 ELSE 0 END
            + CASE WHEN sa.avg_attendance_recorded IS NOT NULL AND sa.avg_attendance_recorded < 50 THEN 1 ELSE 0 END
            + CASE WHEN m.avg_mark IS NOT NULL AND m.avg_mark < 20 THEN 1 ELSE 0 END) signals
      FROM v_students s
      LEFT JOIN v_student_attendance sa USING (student_id)
      LEFT JOIN marks m USING (student_id)
      WHERE NOT s.is_mainstreamed
    )`;
  const bands = await one(
    `${riskCte}
     SELECT count(*) FILTER (WHERE signals>=3) critical, count(*) FILTER (WHERE signals=2) high,
            count(*) FILTER (WHERE signals=1) elevated, count(*) total FROM base`,
  );
  const top = await many(
    `${riskCte}
     SELECT student_id, student_name, programme, division, dropout_reason reason,
            att attendance, round(avg_mark,1) avg_mark, signals
     FROM base WHERE signals >= 1 ORDER BY signals DESC, att ASC NULLS LAST LIMIT 8`,
  );

  const total = num(status.total);
  const mainstreamed = num(status.mainstreamed);
  const dropoutReasons = dropout.map((r) => ({ reason: String(r.reason), count: num(r.count) }));
  const totalDropouts = dropoutReasons.reduce((s, d) => s + d.count, 0);

  return {
    total, mainstreamed, remaining: total - mainstreamed,
    rate: total ? Math.round((mainstreamed / total) * 1000) / 10 : 0,
    genderByProgramme: gender
      .map((r) => ({ name: String(r.programme), Boys: num(r.boys), Girls: num(r.girls) }))
      .sort((a, b) => b.Boys + b.Girls - (a.Boys + a.Girls)),
    dropoutReasons, totalDropouts,
    poverty: dropoutReasons.find((d) => d.reason === 'Poverty')?.count ?? 0,
    risk: {
      bands: { Critical: num(bands.critical), High: num(bands.high), Elevated: num(bands.elevated) },
      nonMainstreamed: num(bands.total),
      top: top.map((r) => ({
        student_id: String(r.student_id), student_name: r.student_name ? String(r.student_name) : null,
        programme: String(r.programme), division: r.division ? String(r.division) : null,
        reason: r.reason ? String(r.reason) : null, attendance: r.attendance == null ? null : num(r.attendance),
        avg_mark: r.avg_mark == null ? null : num(r.avg_mark), signals: num(r.signals),
      })),
    },
  };
}
