// Real-data loader for the Centers dashboard section. Ranks evaluated centres by how much they
// need attention, using REAL signals only: M&E score + recorded attendance (the raw export has no
// per-centre visit log or at-risk count, so those demo chips are dropped).
import type { QueryResult } from './types';

export type RunFn = (sql: string) => Promise<QueryResult>;

export interface CentreRow {
  center_id: string; center_name: string | null; division: string | null;
  students: number; teachers: number; me_score: number; attendance: number | null;
  urgency: number; band: 'Poor' | 'Fair' | 'Good';
}
export interface CentersData {
  totalCentres: number;
  totalEvaluated: number;
  bands: { Poor: number; Fair: number; Good: number };
  worst: CentreRow[];
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bandOf = (s: number): CentreRow['band'] => (s < 2 ? 'Poor' : s < 3 ? 'Fair' : 'Good');
// M&E is 0–4; lower score = more urgent. Attendance below 70 nudges urgency up.
const urgencyOf = (score: number, att: number | null) =>
  Math.min(100, Math.round(((4 - score) / 4) * 80 + (att != null && att < 70 ? 20 : 0)));

export async function loadCenters(run: RunFn): Promise<CentersData> {
  const agg = (await run(
    `SELECT count(*) total, count(*) FILTER (WHERE me_score IS NOT NULL) evaluated,
       count(*) FILTER (WHERE me_score < 2) poor,
       count(*) FILTER (WHERE me_score >= 2 AND me_score < 3) fair,
       count(*) FILTER (WHERE me_score >= 3) good
     FROM v_center_enrollment`,
  )).rows[0] ?? {};

  const rows = (await run(
    `SELECT center_id, center_name, division, students, teachers, me_score, avg_attendance_recorded attendance
     FROM v_center_enrollment WHERE me_score IS NOT NULL
     ORDER BY me_score ASC, attendance ASC NULLS LAST LIMIT 10`,
  )).rows;

  const worst: CentreRow[] = rows.map((r) => {
    const me = num(r.me_score);
    const att = r.attendance == null ? null : num(r.attendance);
    return {
      center_id: String(r.center_id), center_name: r.center_name ? String(r.center_name) : null,
      division: r.division ? String(r.division) : null, students: num(r.students), teachers: num(r.teachers),
      me_score: me, attendance: att, urgency: urgencyOf(me, att), band: bandOf(me),
    };
  });

  return {
    totalCentres: num(agg.total), totalEvaluated: num(agg.evaluated),
    bands: { Poor: num(agg.poor), Fair: num(agg.fair), Good: num(agg.good) },
    worst,
  };
}
