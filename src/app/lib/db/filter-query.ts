// Powers the dashboard Overview from the REAL data via the engine, filter-aware — so Division +
// Programme + Gender genuinely COMPOSE (the old code ignored division entirely). Injectable `run`
// (a DataSource.query) keeps it testable in Node exactly like the pipeline.
import type { QueryResult } from './types';

export interface OvFilter { program?: string; division?: string; sex?: string }
export type RunFn = (sql: string) => Promise<QueryResult>;

export interface OverviewData {
  // scoped to the active filter
  students: number; girls: number; boys: number; mainstreamed: number;
  mainstreamRate: number;         // %
  attMean: number;                // % over recorded
  attCoverageFrac: number;        // 0..1
  programData: { name: string; Enrolled: number; Mainstreamed: number }[];
  divisionData: { division: string; students: number }[];
  enrollmentByYear: { year: number; enrolled: number }[];
  // network (unfiltered) context
  networkStudents: number; networkRate: number; networkAttMean: number;
  teachers: number; meScore: number;
  povertyDropouts: number; totalDropouts: number;
  poorCentres: number; fairCentres: number; goodCentres: number;
  programmeNetwork: Record<string, { students: number; rate: number }>;
}

const esc = (s: string) => s.replace(/'/g, "''");
const sexVal = (s?: string) => (s === 'Girls' ? 'Female' : s === 'Boys' ? 'Male' : null);

/** WHERE clause for v_students from the filter. `division:false` drops the division predicate
 *  (so the division chart still shows every division, re-scoped by programme/gender). */
function whereFor(f: OvFilter, opts: { division?: boolean } = {}): string {
  const c: string[] = [];
  if (f.program) c.push(`programme = '${esc(f.program)}'`);
  if (f.division && opts.division !== false) c.push(`division = '${esc(f.division)}'`);
  const sx = sexVal(f.sex);
  if (sx) c.push(`gender_label = '${sx}'`);
  return c.length ? `WHERE ${c.join(' AND ')}` : '';
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export async function loadOverview(filter: OvFilter, run: RunFn): Promise<OverviewData> {
  const wAll = whereFor(filter);
  const wNoDiv = whereFor(filter, { division: false });
  const one = async (sql: string) => (await run(sql)).rows[0] ?? {};
  const many = async (sql: string) => (await run(sql)).rows;

  const [scoped, att, prog, div, byYear, net, netAtt, teachers, me, drop, centres, progNet] = await Promise.all([
    one(`SELECT count(*) students, count(*) FILTER (WHERE gender_label='Female') girls,
         count(*) FILTER (WHERE gender_label='Male') boys, count(*) FILTER (WHERE is_mainstreamed) mainstreamed
         FROM v_students ${wAll}`),
    one(`SELECT round(avg(sa.avg_attendance_recorded),1) mean, count(*) total,
         count(*) FILTER (WHERE sa.avg_attendance_recorded IS NOT NULL) recorded
         FROM v_student_attendance sa JOIN v_students s USING (student_id) ${wAll}`),
    many(`SELECT programme, count(*) enrolled, count(*) FILTER (WHERE is_mainstreamed) mainstreamed
          FROM v_students ${wAll} GROUP BY programme`),
    many(`SELECT division, count(*) students FROM v_students ${wNoDiv} GROUP BY division ORDER BY students DESC`),
    many(`SELECT enrollment_year yr, count(*) n FROM v_students ${wAll ? wAll + ' AND' : 'WHERE'} enrollment_year IS NOT NULL GROUP BY 1 ORDER BY 1`),
    one(`SELECT count(*) students, count(*) FILTER (WHERE is_mainstreamed) mainstreamed FROM v_students`),
    one(`SELECT round(avg(attendance_pct) FILTER (WHERE is_recorded),1) mean FROM v_attendance`),
    one(`SELECT count(*) total FROM v_teachers`),
    one(`SELECT round(avg(me_score),2) score FROM v_center_enrollment WHERE me_score IS NOT NULL`),
    one(`SELECT count(*) FILTER (WHERE dropout_reason='Poverty') poverty, count(*) FILTER (WHERE is_dropout) total FROM v_students`),
    one(`SELECT count(*) FILTER (WHERE me_score<2) poor, count(*) FILTER (WHERE me_score>=2 AND me_score<3) fair,
         count(*) FILTER (WHERE me_score>=3) good FROM v_center_enrollment WHERE me_score IS NOT NULL`),
    many(`SELECT programme, count(*) enrolled, count(*) FILTER (WHERE is_mainstreamed) mainstreamed FROM v_students GROUP BY programme`),
  ]);

  const students = num(scoped.students);
  const totalAtt = num(att.total), recorded = num(att.recorded);
  const programmeNetwork: OverviewData['programmeNetwork'] = {};
  for (const r of progNet) {
    const en = num(r.enrolled);
    programmeNetwork[String(r.programme)] = { students: en, rate: en ? (100 * num(r.mainstreamed)) / en : 0 };
  }

  return {
    students, girls: num(scoped.girls), boys: num(scoped.boys), mainstreamed: num(scoped.mainstreamed),
    mainstreamRate: students ? (100 * num(scoped.mainstreamed)) / students : 0,
    attMean: num(att.mean), attCoverageFrac: totalAtt ? recorded / totalAtt : 0,
    programData: prog.map((r) => ({ name: String(r.programme), Enrolled: num(r.enrolled), Mainstreamed: num(r.mainstreamed) }))
      .sort((a, b) => b.Enrolled - a.Enrolled),
    divisionData: div.map((r) => ({ division: String(r.division), students: num(r.students) })),
    enrollmentByYear: byYear.map((r) => ({ year: num(r.yr), enrolled: num(r.n) })),
    networkStudents: num(net.students),
    networkRate: num(net.students) ? (100 * num(net.mainstreamed)) / num(net.students) : 0,
    networkAttMean: num(netAtt.mean),
    teachers: num(teachers.total), meScore: num(me.score),
    povertyDropouts: num(drop.poverty), totalDropouts: num(drop.total),
    poorCentres: num(centres.poor), fairCentres: num(centres.fair), goodCentres: num(centres.good),
    programmeNetwork,
  };
}
