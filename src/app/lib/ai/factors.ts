/**
 * The ranked "associated factors" — computed in SQL, never written by the model.
 *
 * Measuring a difference is the easy half. The hard half is refusing to show a difference that
 * isn't an explanation, and four tests below do that. They exist because the naive version produced
 * exactly the garbage they now block:
 *
 *   1. NOT CIRCULAR      — explaining "regularly absent" with "flagged irregular" is the outcome
 *                          restated. Factors in the same family as the thing being explained, or
 *                          already shown as a column in the result, are dropped.
 *   2. DIRECTIONALLY OK  — "0% poor nutrition vs 3.2%" means this group is HEALTHIER; listing it as
 *                          a driver of absence is backwards. Each factor declares which direction is
 *                          worse, and a factor pointing the good way becomes a counter-signal, never
 *                          a driver.
 *   3. NON-TRIVIAL       — a gender split is composition, not a cause. Demographic factors are never
 *                          drivers.
 *   4. MATERIAL          — 3.1 vs 3.4 is not a finding. Shares must move >= 8pp AND >= 1.25x (or
 *                          <= 0.8x); means must move >= 10% relative.
 *
 * When nothing survives, that is the honest answer and the caller says so — the list is never padded
 * to look thorough.
 */
import type { DataSource } from '../db/types';
import type { OutcomeTopic } from './intent';
import { aiLog } from './debug';

export type FactorKind = 'share' | 'mean';
export type CohortEntity = 'student' | 'centre';
/** Grouping used for the circularity ban. */
export type FactorFamily = 'attendance' | 'performance' | 'performance_component' | 'assessment' | 'socioeconomic' | 'demographic';

export interface FactorComparison {
  id: string;
  /** Technical name — kept for logs and the model's context. */
  label: string;
  /** What a field officer with no statistics training would call this. Shown in the UI. */
  plainLabel: string;
  kind: FactorKind;
  cohortValue: number;
  baselineValue: number;
  unit: '%' | 'score' | 'pct-attendance';
  delta: number;
  ratio: number;
  cohortN: number;
  baseN: number;
  coveragePct: number;
  strength: number;
  direction: 'higher' | 'lower';
  /** driver = moves the way that worsens the outcome. protective = moves the good way. */
  role: 'driver' | 'protective';
  family: FactorFamily;
  /** Did it clear the materiality bar? False only for a factor the USER asked for by name, which is
   *  reported with its real numbers so "you asked, and it makes no difference here" can be said. */
  material: boolean;
}

interface FactorDef {
  id: string;
  label: string;
  plainLabel: string;
  kind: FactorKind;
  unit: FactorComparison['unit'];
  expr: string;
  covered: string;
  /** Result columns this factor would merely restate. */
  derivedFrom: string[];
  family: FactorFamily;
  /** Which direction makes the outcome worse — drives the driver/protective split. */
  worseWhen: 'higher' | 'lower';
}

const MIN_COHORT = 15;
const MIN_BASE_SHARE = 0.5;
const MIN_COVERAGE = 15;
/** Materiality — a factor must clear BOTH the absolute and the relative bar. */
const MIN_SHARE_PP = 8;
const MIN_SHARE_RATIO = 1.25;
const MIN_MEAN_REL = 0.10;

const STUDENT_FACTORS: FactorDef[] = [
  { id: 'household_income_low', plainLabel: 'Families here are poor', label: 'Household income — two lowest bands', kind: 'share', unit: '%',
    expr: `household_income_band IN ('<5000', '5000-9999')`, covered: `household_income_band`,
    derivedFrom: ['household_income_band', 'household_income_tk'], family: 'socioeconomic', worseWhen: 'higher' },
  { id: 'income_lowest', plainLabel: 'Families here are very poor', label: 'Father’s income in the lowest band (under 5,000 Tk)', kind: 'share', unit: '%',
    expr: `income_band = '<5000'`, covered: `income_band`,
    derivedFrom: ['income_band', 'father_income_tk'], family: 'socioeconomic', worseWhen: 'higher' },
  { id: 'child_labour', plainLabel: 'Children here are doing labour work', label: 'Child labour — work type recorded as “Labour”', kind: 'share', unit: '%',
    expr: `is_child_labour`, covered: `work_type`,
    derivedFrom: ['is_child_labour', 'work_type'], family: 'socioeconomic', worseWhen: 'higher' },
  { id: 'working', plainLabel: 'Children here are working', label: 'Child has any recorded occupation', kind: 'share', unit: '%',
    expr: `is_working`, covered: `work_type`,
    derivedFrom: ['is_working', 'work_type'], family: 'socioeconomic', worseWhen: 'higher' },
  { id: 'parent_no_education', plainLabel: 'Parents here never went to school', label: 'Parent with no schooling', kind: 'share', unit: '%',
    expr: `parent_no_education`, covered: `father_education`,
    derivedFrom: ['parent_no_education', 'father_education', 'mother_education'], family: 'socioeconomic', worseWhen: 'higher' },
  { id: 'guardian_day_labour', plainLabel: 'The main earner is a day labourer', label: 'Household head works as a day labourer', kind: 'share', unit: '%',
    expr: `guardian_day_labour`, covered: `guardian_occupation`,
    derivedFrom: ['guardian_occupation', 'guardian_day_labour'], family: 'socioeconomic', worseWhen: 'higher' },
  { id: 'insecure_housing', plainLabel: 'Families here rent, or have no land', label: 'Rented or landless household', kind: 'share', unit: '%',
    expr: `insecure_housing`, covered: `residency_type`,
    derivedFrom: ['insecure_housing', 'residency_type'], family: 'socioeconomic', worseWhen: 'higher' },
  { id: 'nutrition_poor', plainLabel: 'Children here are not eating well', label: 'Poor nutrition status', kind: 'share', unit: '%',
    expr: `nutrition IN ('Bad', 'Not so good')`, covered: `nutrition`,
    derivedFrom: ['nutrition'], family: 'socioeconomic', worseWhen: 'higher' },
  { id: 'disability', plainLabel: 'Children here have a disability', label: 'Disability recorded', kind: 'share', unit: '%',
    expr: `disability_type IS NOT NULL AND disability_type <> ''`, covered: `disability_type`,
    derivedFrom: ['disability_type'], family: 'socioeconomic', worseWhen: 'higher' },
  { id: 'female', plainLabel: 'Girls', label: 'Girls', kind: 'share', unit: '%',
    expr: `gender_label = 'Female'`, covered: `gender_label`,
    derivedFrom: ['gender_label', 'gender'], family: 'demographic', worseWhen: 'higher' },
  { id: 'irregular', plainLabel: 'Already marked as irregular', label: 'Flagged irregular at 6-month follow-up', kind: 'share', unit: '%',
    expr: `follow_up_6m IN ('Running but irregular', 'Irregular', 'Dropout')`, covered: `follow_up_6m`,
    derivedFrom: ['follow_up_6m'], family: 'attendance', worseWhen: 'higher' },
  { id: 'centre_engagement', plainLabel: 'Their centre works less with families', label: 'Centre’s community & family engagement score', kind: 'mean', unit: 'score',
    expr: `engagement`, covered: `engagement`,
    derivedFrom: ['engagement'], family: 'performance_component', worseWhen: 'lower' },
  { id: 'centre_me', plainLabel: 'Their centre scores lower overall', label: 'Centre’s overall monitoring score', kind: 'mean', unit: 'score',
    expr: `me_score`, covered: `me_score`,
    derivedFrom: ['me_score'], family: 'performance', worseWhen: 'lower' },
  { id: 'attendance', plainLabel: 'They come to class less often', label: 'Recorded attendance', kind: 'mean', unit: 'pct-attendance',
    expr: `avg_attendance_recorded`, covered: `avg_attendance_recorded`,
    derivedFrom: ['avg_attendance_recorded', 'avg_attendance_all', 'attendance_pct'], family: 'attendance', worseWhen: 'lower' },
];

const CENTRE_FACTORS: FactorDef[] = [
  { id: 'me_score', plainLabel: 'Overall centre score', label: 'Overall monitoring score', kind: 'mean', unit: 'score', expr: `me_score`, covered: `me_score`,
    derivedFrom: ['me_score'], family: 'performance', worseWhen: 'lower' },
  { id: 'pedagogy', plainLabel: 'Teaching quality', label: 'Pedagogy', kind: 'mean', unit: 'score', expr: `pedagogy`, covered: `pedagogy`,
    derivedFrom: ['pedagogy'], family: 'performance_component', worseWhen: 'lower' },
  { id: 'assessment_quality', plainLabel: 'How well tests are run', label: 'Assessments', kind: 'mean', unit: 'score', expr: `assessment_quality`, covered: `assessment_quality`,
    derivedFrom: ['assessment_quality'], family: 'performance_component', worseWhen: 'lower' },
  { id: 'documentation', plainLabel: 'Record keeping', label: 'Documentation', kind: 'mean', unit: 'score', expr: `documentation`, covered: `documentation`,
    derivedFrom: ['documentation'], family: 'performance_component', worseWhen: 'lower' },
  { id: 'learning_environment', plainLabel: 'The classroom and safety', label: 'Learning environment', kind: 'mean', unit: 'score', expr: `learning_environment`, covered: `learning_environment`,
    derivedFrom: ['learning_environment'], family: 'performance_component', worseWhen: 'lower' },
  { id: 'engagement', plainLabel: 'Working with parents and the community', label: 'Community & family engagement', kind: 'mean', unit: 'score', expr: `engagement`, covered: `engagement`,
    derivedFrom: ['engagement'], family: 'performance_component', worseWhen: 'lower' },
  { id: 'catchment_poverty', plainLabel: 'The families they serve are poor', label: 'Catchment poverty — students in the two lowest income bands', kind: 'mean', unit: '%',
    expr: `catchment_low_income_pct`, covered: `catchment_low_income_pct`, derivedFrom: [], family: 'socioeconomic', worseWhen: 'higher' },
  { id: 'catchment_child_labour', plainLabel: 'Children there are working', label: 'Catchment child labour — students with recorded work', kind: 'mean', unit: '%',
    expr: `catchment_working_pct`, covered: `catchment_working_pct`, derivedFrom: [], family: 'socioeconomic', worseWhen: 'higher' },
  { id: 'attendance', plainLabel: 'Attendance at these centres', label: 'Recorded attendance', kind: 'mean', unit: 'pct-attendance',
    expr: `avg_attendance_recorded`, covered: `avg_attendance_recorded`,
    derivedFrom: ['avg_attendance_recorded', 'avg_attendance_all', 'attendance_pct', 'forecast_next_month_pct', 'current_attendance_pct'],
    family: 'attendance', worseWhen: 'lower' },
];

/** Families banned per topic because they restate the outcome instead of explaining it. */
const CIRCULAR_FAMILIES: Record<OutcomeTopic, FactorFamily[]> = {
  attendance: ['attendance'],
  performance: ['performance'],
  assessment: ['assessment'],
  risk: ['attendance'],
  general: [],
};

function populationSql(entity: CohortEntity, ids: string[]): string {
  const list = ids.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(',');
  if (entity === 'student') {
    return `WITH pop AS (
      SELECT s.student_id, s.income_band, s.household_income_band, s.nutrition, s.disability_type,
             s.gender_label, s.work_type, s.is_working, s.is_child_labour, s.parent_no_education,
             s.father_education, s.mother_education, s.residency_type, s.insecure_housing,
             s.guardian_occupation, s.guardian_day_labour,
             x.follow_up_6m, c.engagement, c.me_score, a.avg_attendance_recorded
      FROM v_students s
      LEFT JOIN (SELECT student_id, follow_up_6m FROM v_student_ext) x USING (student_id)
      LEFT JOIN v_center_enrollment c USING (center_id)
      LEFT JOIN v_student_attendance a USING (student_id)
    ), tagged AS (SELECT *, student_id IN (${list}) AS in_cohort FROM pop)`;
  }
  return `WITH cat AS (
      SELECT center_id,
             100.0 * avg(CASE WHEN income_band IN ('<5000', '5000-9999') THEN 1 ELSE 0 END) AS catchment_low_income_pct,
             100.0 * avg(CASE WHEN is_working THEN 1 ELSE 0 END) AS catchment_working_pct
      FROM v_students GROUP BY center_id
    ), pop AS (
      SELECT c.center_id, c.me_score, c.pedagogy, c.assessment_quality, c.documentation,
             c.learning_environment, c.engagement, c.avg_attendance_recorded,
             cat.catchment_low_income_pct, cat.catchment_working_pct
      FROM v_center_enrollment c LEFT JOIN cat USING (center_id)
    ), tagged AS (SELECT *, center_id IN (${list}) AS in_cohort FROM pop)`;
}

function factorSelect(f: FactorDef): string {
  const value = f.kind === 'share'
    ? (scope: string) => `100.0 * count(*) FILTER (WHERE ${scope}(${f.expr})) / nullif(count(*) FILTER (WHERE ${scope}TRUE), 0)`
    : (scope: string) => `avg(${f.expr}) FILTER (WHERE ${scope}TRUE)`;
  return `SELECT '${f.id}' AS id,
    ${value('in_cohort AND ')} AS cohort_value,
    ${value('')} AS baseline_value,
    count(*) FILTER (WHERE in_cohort) AS cohort_n,
    count(*) AS base_n,
    100.0 * count(*) FILTER (WHERE (${f.covered}) IS NOT NULL) / nullif(count(*), 0) AS coverage_pct
  FROM tagged`;
}

export interface FactorResult {
  /** Valid, ranked contributing factors. May legitimately be empty. */
  drivers: FactorComparison[];
  /** At most one notable counter-signal (the group is BETTER here) — never presented as a driver. */
  protective: FactorComparison | null;
  /** Factors measured but rejected, with why — for the debug log, not the UI. */
  rejected: { id: string; reason: string }[];
  /** Factors the user named that could NOT be measured here, with the plain reason why. Reporting
   *  this is the difference between an answer and a dead end: "family income is not recorded in
   *  this dataset" is useful; silently dropping the request looks like it was ignored. */
  requestedUnavailable: { id: string; label: string; plainLabel: string; reason: string }[];
  /** Factors the USER named. Shown even when they make no difference — that IS the answer to
   *  "add family income and show it again", and hiding it would look like the request was ignored. */
  requested: FactorComparison[];
}

export async function computeFactors(
  dataSource: DataSource,
  entity: CohortEntity,
  ids: string[],
  resultColumns: string[] = [],
  topic: OutcomeTopic = 'general',
  /** Factor ids the USER explicitly asked to see ("add family income as a factor"). These skip the
   *  automatic filters: an explicit request outranks our judgement about what is interesting, and
   *  being shown that a factor does NOT matter is a real answer to the question they asked. */
  forced: string[] = [],
): Promise<FactorResult> {
  const empty: FactorResult = { drivers: [], protective: null, rejected: [], requested: [], requestedUnavailable: [] };
  const unique = [...new Set(ids.filter(Boolean).map(String))].slice(0, 500);
  if (unique.length < MIN_COHORT) return empty;

  const shown = new Set(resultColumns.map((c) => c.toLowerCase()));
  const banned = CIRCULAR_FAMILIES[topic] ?? [];
  const rejected: FactorResult['rejected'] = [];

  const force = new Set(forced);
  const defs = (entity === 'student' ? STUDENT_FACTORS : CENTRE_FACTORS).filter((f) => {
    if (force.has(f.id)) return true;   // asked for by name — measure it and let the reader judge
    if (f.derivedFrom.some((c) => shown.has(c.toLowerCase()))) { rejected.push({ id: f.id, reason: 'restates a column already in the result' }); return false; }
    if (banned.includes(f.family)) { rejected.push({ id: f.id, reason: `circular — same family as the "${topic}" outcome` }); return false; }
    if (f.family === 'demographic') { rejected.push({ id: f.id, reason: 'demographic composition is not a driver' }); return false; }
    return true;
  });
  if (!defs.length) return { ...empty, rejected, requested: [], requestedUnavailable: [] };

  let rows: Record<string, unknown>[];
  try {
    rows = (await dataSource.query(`${populationSql(entity, unique)}\n${defs.map(factorSelect).join('\nUNION ALL\n')}`)).rows;
  } catch (e) {
    aiLog('factors: comparison query failed —', (e as Error).message);
    return { ...empty, rejected, requested: [], requestedUnavailable: [] };
  }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const drivers: FactorComparison[] = [];
  const protectives: FactorComparison[] = [];
  const requested: FactorComparison[] = [];
  const requestedUnavailable: FactorResult['requestedUnavailable'] = [];
  // A factor the user NAMED that cannot be measured is reported, not dropped. Anything else would
  // look like the request was ignored.
  const unavailable = (def: FactorDef, reason: string) => {
    if (force.has(def.id)) requestedUnavailable.push({ id: def.id, label: def.label, plainLabel: def.plainLabel, reason });
  };

  for (const def of defs) {
    const r = rows.find((x) => x.id === def.id);
    if (!r) { unavailable(def, 'it could not be measured for this group'); continue; }
    const cohortValue = num(r.cohort_value);
    const baselineValue = num(r.baseline_value);
    const cohortN = num(r.cohort_n) ?? 0;
    const coveragePct = num(r.coverage_pct) ?? 0;
    if (cohortValue === null || baselineValue === null || baselineValue === 0) {
      unavailable(def, 'this is not recorded in the dataset you are using');
      continue;
    }
    if (cohortN < MIN_COHORT) {
      rejected.push({ id: def.id, reason: `cohort too small (${cohortN})` });
      unavailable(def, `only ${cohortN} of these records carry it — too few to compare fairly`);
      continue;
    }
    if (coveragePct < MIN_COVERAGE) {
      rejected.push({ id: def.id, reason: `field only ${Math.round(coveragePct)}% populated` });
      unavailable(def, `it is filled in for only ${Math.round(coveragePct)}% of records, too thin to compare`);
      continue;
    }
    if (def.kind === 'share' && baselineValue < MIN_BASE_SHARE) {
      rejected.push({ id: def.id, reason: 'too rare network-wide to compare' });
      unavailable(def, 'it is too rare across the whole programme to compare against');
      continue;
    }

    const delta = cohortValue - baselineValue;
    const ratio = cohortValue / baselineValue;
    const material = def.kind === 'share'
      ? Math.abs(delta) >= MIN_SHARE_PP && (ratio >= MIN_SHARE_RATIO || ratio <= 1 / MIN_SHARE_RATIO)
      : Math.abs(delta / baselineValue) >= MIN_MEAN_REL;
    const isForced = force.has(def.id);
    if (!material && !isForced) { rejected.push({ id: def.id, reason: 'difference from the network is not material' }); continue; }

    const direction: 'higher' | 'lower' = delta >= 0 ? 'higher' : 'lower';
    const role: 'driver' | 'protective' = direction === def.worseWhen ? 'driver' : 'protective';
    const f: FactorComparison = {
      id: def.id, label: def.label, plainLabel: def.plainLabel, kind: def.kind, unit: def.unit, family: def.family, role, direction,
      cohortValue: Math.round(cohortValue * 10) / 10,
      baselineValue: Math.round(baselineValue * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      ratio: Math.round(ratio * 100) / 100,
      cohortN, baseN: num(r.base_n) ?? 0,
      coveragePct: Math.round(coveragePct),
      strength: Math.round((def.kind === 'share' ? Math.abs(delta) : Math.abs(delta / baselineValue) * 100) * 10) / 10,
      material,
    };
    if (isForced) requested.push(f);
    if (material) (role === 'driver' ? drivers : protectives).push(f);
  }

  drivers.sort((a, b) => b.strength - a.strength);
  protectives.sort((a, b) => b.strength - a.strength);
  if (rejected.length) aiLog('factors: rejected —', rejected.map((r) => `${r.id} (${r.reason})`).join('; '));

  return { drivers: drivers.slice(0, 4), protective: protectives[0] ?? null, rejected, requested, requestedUnavailable };
}

export function detectCohort(columns: string[], rows: Record<string, unknown>[]): { entity: CohortEntity; ids: string[] } | null {
  if (columns.includes('student_id')) return { entity: 'student', ids: rows.map((r) => String(r.student_id ?? '')) };
  if (columns.includes('center_id')) return { entity: 'centre', ids: rows.map((r) => String(r.center_id ?? '')) };
  return null;
}

/** Numbers only, so the model can describe but not invent. */
export function renderFactors(f: FactorResult): string {
  const line = (x: FactorComparison, i: number) => {
    const v = x.kind === 'share'
      ? `${x.cohortValue}% of this group vs ${x.baselineValue}% network-wide (${x.ratio}x, ${x.delta > 0 ? '+' : ''}${x.delta}pp)`
      : `${x.cohortValue} for this group vs ${x.baselineValue} network-wide (${x.delta > 0 ? '+' : ''}${x.delta})`;
    return `${i + 1}. ${x.plainLabel} (${x.label}): ${v} — ${x.cohortN} records, field ${x.coveragePct}% populated`;
  };
  const parts: string[] = [];
  parts.push(f.drivers.length ? f.drivers.map(line).join('\n') : '(none — no factor passed the validity tests)');
  if (f.protective) parts.push(`COUNTER-SIGNAL (this group is BETTER here — do not call it a driver):\n${line(f.protective, 0)}`);
  if (f.requested.length) {
    // The user named these. Report them either way: "you asked, and it makes no difference here" is
    // a real answer, and silently dropping one looks like the request was ignored.
    parts.push(
      'THE USER ASKED FOR THESE BY NAME — say what each one shows, including when it shows no real difference:\n' +
        f.requested
          .map((x, i) => `${line(x, i)}${x.material ? '' : '  [NO MEANINGFUL DIFFERENCE from the network — say so plainly]'}`)
          .join('\n'),
    );
  }
  if (f.requestedUnavailable?.length) {
    parts.push(
      'THE USER ASKED FOR THESE BUT THEY COULD NOT BE MEASURED — say so plainly and say why, then move on:\n' +
        f.requestedUnavailable.map((x) => `- ${x.plainLabel} (${x.label}): ${x.reason}`).join('\n'),
    );
  }
  return parts.join('\n\n');
}
