// The semantic CATALOG — a compact, machine- and LLM-readable description of the query surface.
// It documents the views the AI is allowed to query, their columns, the allowed categorical values,
// the synonym map (girls→Girl, maths→Mathematics, Chittagong→Chattogram…), and the data caveats
// that keep answers honest. `renderCatalogForPrompt()` turns it into the schema block for the LLM,
// and `SYNONYMS`/`ALLOWED_VALUES` back a deterministic normaliser used before/independent of the LLM.

export interface ColumnDoc { name: string; desc: string }
export interface ViewDoc {
  name: string;
  grain: string;               // what one row represents
  desc: string;
  columns: ColumnDoc[];
}

/** The ONLY relations the AI may query. Raw base tables are intentionally omitted. */
export const VIEWS: ViewDoc[] = [
  {
    name: 'v_students',
    grain: 'one row per student',
    desc: 'Canonical student record with business flags. Use for counts, gender %, income, enrollment year, mainstreamed/dropout/active.',
    columns: [
      { name: 'student_id', desc: 'unique student id (string)' },
      { name: 'student_name', desc: 'student name (from attendance; may be NULL) — include it when listing students' },
      { name: 'center_id', desc: 'centre the student belongs to' },
      { name: 'programme', desc: "ABAL | Catchup | Innovation" },
      { name: 'division', desc: 'administrative division (Dhaka, Mymensingh, Chattogram, Sylhet, Rangpur)' },
      { name: 'district', desc: 'district name' },
      { name: 'upazila', desc: 'sub-district (upazila) within the district' },
      { name: 'gender', desc: "raw: 'Boy' | 'Girl' | 'Other'" },
      { name: 'gender_label', desc: "normalised: 'Male' | 'Female' | 'Other' (prefer this)" },
      { name: 'religion', desc: "'Islam' | 'Hindu' | 'Buddhist' | 'Christian' | '' (blank = not recorded)" },
      { name: 'ethnicity', desc: "ethnic group: 'Marma' | 'Chakma' | 'Garo' | 'Kuki' | 'Others'; blank = the Bengali majority (not separately recorded). DO answer ethnicity questions — GROUP BY ethnicity over the whole table and, if useful, note that blank is the majority. Never refuse just because most rows are blank." },
      { name: 'nutrition', desc: "'Good' | 'Not so good' | 'Bad' | NULL" },
      { name: 'disability_type', desc: "type of recorded disability: 'Physical' | 'Speech' | 'Mental' | 'Vision' | 'Hearing' | 'Multiple' | 'Other'. Empty string ('') = no disability recorded — filter disability_type <> '' for students WITH a disability. Only ~2,061 of ~250k students have one recorded." },
      { name: 'father_income_tk', desc: 'father monthly income in TK (integer, NULL if unknown; top band recorded as 15000)' },
      { name: 'income_band', desc: "'<5000' | '5000-9999' | '10000-14999' | '15000+' | NULL" },
      { name: 'enrollment_year', desc: 'year of Education Start Date (integer)' },
      { name: 'admitted_grade', desc: "grade the student was admitted into: 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | '' (blank if unknown)" },
      { name: 'mainstream_status', desc: "raw status text: 'Mainstreamed' | 'Not Mainstreamed' | '' — for filtering prefer the boolean is_mainstreamed" },
      { name: 'is_mainstreamed', desc: 'boolean — transitioned into formal school' },
      { name: 'is_dropout', desc: 'boolean — has a recorded dropout reason' },
      { name: 'dropout_reason', desc: "Poverty | Others | Family Awareness | Inattentive | Distance | Migration | Working child | NULL" },
      { name: 'is_active', desc: 'boolean — still in programme (NOT mainstreamed AND NOT dropout). DERIVED — confirm definition.' },
    ],
  },
  {
    name: 'v_teachers',
    grain: 'one row per teacher',
    desc: 'Teachers with an active flag. Note: a teacher links to a centre via center_id (may be NULL) but always has their own division.',
    columns: [
      { name: 'center_id', desc: 'centre id (NULL if unassigned)' },
      { name: 'teacher_name', desc: 'teacher name — include it when listing teachers' },
      { name: 'division', desc: 'division' },
      { name: 'district', desc: 'district name' },
      { name: 'upazila', desc: 'sub-district (upazila)' },
      { name: 'gender', desc: "raw: 'Man' | 'Woman' | 'Other' (prefer gender_label)" },
      { name: 'gender_label', desc: "'Male' | 'Female' | 'Other'" },
      { name: 'employment_status', desc: "'Active' | 'Resigned' | 'Replaced' | NULL" },
      { name: 'is_active', desc: "boolean — employment_status = 'Active'" },
      { name: 'education', desc: "teacher education level ('H.S.C' | 'S.S.C' | 'Graduation' | 'Masters' | …). DATA QUALITY: partly contaminated — some rows hold district/status values instead; treat aggregates as approximate." },
      { name: 'experience', desc: "teacher experience band ('Below 1 year' | '1 Year' | '2 Years' | 'Above 10 Years' | …). DATA QUALITY: partly contaminated; treat as approximate." },
      { name: 'religion', desc: "teacher religion ('Islam' | 'Hindu' | 'Buddhist' | 'Christian'). DATA QUALITY: partly contaminated with other fields; treat with caution." },
      { name: 'marital_status', desc: "'Married' | 'Unmarried' | 'Widowed' | ''. DATA QUALITY: partly contaminated with other fields; treat with caution." },
    ],
  },
  {
    name: 'v_student_attendance',
    grain: 'one row per student',
    desc: 'Per-student attendance with CORRECT semantics. attendance 0 = not recorded; avg is over recorded months only.',
    columns: [
      { name: 'student_id', desc: 'student id' },
      { name: 'student_name', desc: 'student name (from attendance export)' },
      { name: 'center_id', desc: 'centre id' },
      { name: 'avg_attendance_recorded', desc: 'average % over months that HAVE a real value (NULL if none recorded)' },
      { name: 'avg_attendance_all', desc: 'average % over ALL months, counting 0/not-recorded months as 0 — never NULL (the transparent value to show for a single learner)' },
      { name: 'recorded_months', desc: 'number of months with a real value (0 = nothing recorded)' },
      { name: 'total_months', desc: 'number of attendance rows' },
    ],
  },
  {
    name: 'v_attendance_monthly',
    grain: 'one row per division × programme × month',
    desc: 'Monthly attendance trend — grain: division × programme × month. Answers "attendance month by month / over time". Its availability follows the ACTIVE DATASET note at the very top of this prompt: when that says PREVIEW, this view IS populated — query it directly and ANSWER (note the figures are estimated). Weighted average = sum(sum_attendance)/sum(n_students); group by month (ORDER BY month_num) and optionally division/programme.',
    columns: [
      { name: 'month_num', desc: 'month number 1–12 (use for ORDER BY)' },
      { name: 'month', desc: 'month label (Jan..Dec)' },
      { name: 'division', desc: 'division' },
      { name: 'programme', desc: 'ABAL | Catchup | Innovation' },
      { name: 'n_students', desc: 'students behind this group-month' },
      { name: 'sum_attendance', desc: 'sum of attendance % (divide by n_students for the average)' },
      { name: 'avg_attendance_pct', desc: 'convenience: this group-month average (sum_attendance/n_students)' },
    ],
  },
  {
    name: 'v_marks',
    grain: 'one row per student × subject × phase',
    desc: 'Every assessment mark (0–100) with the student\'s programme/division/gender for filtering. phase is BL (baseline) or C1..C5 (cycles).',
    columns: [
      { name: 'student_id', desc: 'student id' },
      { name: 'student_name', desc: 'student name (include it when listing students)' },
      { name: 'center_id', desc: 'centre id' },
      { name: 'programme', desc: 'ABAL | Catchup | Innovation' },
      { name: 'subject', desc: 'Bangla | Mathematics | English | Science | BGS | Life Skills | Religion' },
      { name: 'phase', desc: "'BL' | 'C1'..'C5'" },
      { name: 'mark', desc: 'score 0–100' },
      { name: 'division', desc: 'student division' },
      { name: 'district', desc: 'student district' },
      { name: 'gender', desc: 'raw gender (prefer gender_label)' },
      { name: 'gender_label', desc: "'Male' | 'Female' | 'Other'" },
    ],
  },
  {
    name: 'v_student_subject',
    grain: 'one row per student × subject',
    desc: "A student's average mark in a subject. Use for \"students with poor/low <subject>\", thresholds, and per-student subject ranking.",
    columns: [
      { name: 'student_id', desc: 'student id' },
      { name: 'student_name', desc: 'student name (include it when listing students)' },
      { name: 'center_id', desc: 'centre id' },
      { name: 'programme', desc: 'ABAL | Catchup | Innovation' },
      { name: 'subject', desc: 'subject name' },
      { name: 'avg_mark', desc: 'average mark across that student\'s marks in the subject' },
      { name: 'n_marks', desc: 'how many marks the average is over' },
      { name: 'division', desc: 'student division' },
      { name: 'district', desc: 'student district' },
      { name: 'gender', desc: 'raw gender' },
    ],
  },
  {
    name: 'v_teacher_ratio_by_division',
    grain: 'one row per division',
    desc: 'Student-to-teacher ratio using ACTIVE teachers as the denominator. (Answers "student-teacher ratio by division".)',
    columns: [
      { name: 'division', desc: 'division' },
      { name: 'students', desc: 'student count in the division' },
      { name: 'active_teachers', desc: 'active teacher count in the division' },
      { name: 'students_per_teacher', desc: 'students / active_teachers (NULL if no teachers)' },
    ],
  },
  {
    name: 'v_enrollment_by_year',
    grain: 'one row per year',
    desc: 'Enrollment counts by year of Education Start Date. Use for "this year vs last year".',
    columns: [
      { name: 'enrollment_year', desc: 'year (integer)' },
      { name: 'enrolled', desc: 'students enrolled that year' },
    ],
  },
  {
    name: 'v_center_enrollment',
    grain: 'one row per centre',
    desc: 'Centre size and quality. Use for "centres with more than N students", biggest centres, centre attendance/quality.',
    columns: [
      { name: 'center_id', desc: 'centre id' },
      { name: 'center_name', desc: 'centre name (NULL if not in M&E export)' },
      { name: 'division', desc: 'division (from M&E, else from students)' },
      { name: 'district', desc: 'centre district (from M&E export; NULL if not evaluated)' },
      { name: 'students', desc: 'enrolled students' },
      { name: 'teachers', desc: 'teachers at the centre' },
      { name: 'avg_attendance_recorded', desc: 'centre mean attendance over recorded months' },
      { name: 'me_score', desc: 'M&E overall evaluation score (NULL if not evaluated)' },
    ],
  },
  {
    name: 'v_coverage',
    grain: 'one row per data field',
    desc: 'DATA-COMPLETENESS reference for predictive analysis. For each key field, how many students carry a real (non-null, non-blank) value vs the total, network-wide. Use it to report the confidence/coverage behind any score ("based on X% coverage"), and it powers the "data-trust" analysis. Reflects the ACTIVE DATASET: Real shows the true gaps (attendance ~17%, status mostly blank), Preview is near-complete (gap-filled).',
    columns: [
      { name: 'field', desc: "the data field: 'attendance' | 'assessment' | 'income' | 'income_band' | 'mainstream_status' | 'dropout_reason' | 'disability_type' | 'religion' | 'ethnicity' | 'admitted_grade' | 'enrollment_year'" },
      { name: 'present', desc: 'count of students with a real (non-null, non-blank) value for this field' },
      { name: 'total', desc: 'total students in scope' },
      { name: 'coverage_pct', desc: 'round(100 * present / total, 1) — % completeness; low coverage means report low confidence' },
    ],
  },
  {
    name: 'v_dropout_risk',
    grain: 'one row per student',
    desc: 'Rule-based DROPOUT RISK score (0–100) per student — higher = more at risk. Built only from leading indicators (income, attendance, assessment, vulnerability), never from the dropout outcome. The r_* columns are the drivers behind the score (use them for the plain-language "why"). confidence_pct says how much real data backs it. For an "at-risk now" list, filter is_active = true and ORDER BY risk_score DESC. Always report confidence_pct alongside the score.',
    columns: [
      { name: 'student_id', desc: 'student id' },
      { name: 'student_name', desc: 'student name (include when listing)' },
      { name: 'programme', desc: 'ABAL | Catchup | Innovation' },
      { name: 'division', desc: 'student division' },
      { name: 'district', desc: 'student district' },
      { name: 'gender_label', desc: "'Male' | 'Female' | 'Other'" },
      { name: 'income_band', desc: "family income band ('<5000' … '15000+')" },
      { name: 'avg_attendance_recorded', desc: 'attendance % over recorded months (NULL if none recorded)' },
      { name: 'avg_mark', desc: 'average assessment mark (NULL if none)' },
      { name: 'risk_score', desc: 'total risk 0–100 (higher = more at risk) = r_income + r_attendance + r_assessment + r_vulnerability, capped at 100' },
      { name: 'r_income', desc: 'driver: income component (0–15; capped low — income weakly predicts dropout in this data)' },
      { name: 'r_attendance', desc: 'driver: attendance component (0–30; 0 when attendance not recorded)' },
      { name: 'r_assessment', desc: 'driver: assessment component (0–35; strongest predictor; 0 when no marks)' },
      { name: 'r_vulnerability', desc: 'driver: vulnerability component (0–20; disability + poor nutrition + minority ethnicity)' },
      { name: 'confidence_pct', desc: 'how many of the 4 signal groups had real data (25/50/75/100) — the confidence badge for this student' },
      { name: 'is_active', desc: 'boolean — still in programme (filter to this for an at-risk-now list)' },
      { name: 'is_mainstreamed', desc: 'boolean — successfully transitioned into formal school (the positive outcome)' },
      { name: 'is_true_dropout', desc: 'boolean — CLEAN dropout label (has a dropout reason AND was not mainstreamed). Use this for a real dropout definition; the raw dropout_reason field is contaminated by ~101k mainstreamed students.' },
    ],
  },
  {
    name: 'v_center_health',
    grain: 'one row per centre',
    desc: 'CENTER DATA-TRUST: which centres have too little/stale data to trust their numbers. Filter trust <> \'reliable\' to find centres to fix first. attendance_coverage_pct = share of the centre\'s students with any recorded attendance.',
    columns: [
      { name: 'center_id', desc: 'centre id' },
      { name: 'center_name', desc: 'centre name (NULL if not in M&E export)' },
      { name: 'division', desc: 'division' },
      { name: 'students', desc: 'enrolled students' },
      { name: 'me_score', desc: 'M&E overall evaluation score (NULL if never evaluated)' },
      { name: 'attendance_coverage_pct', desc: 'share of students with any recorded attendance (0–100)' },
      { name: 'is_evaluated', desc: 'boolean — has an M&E evaluation score' },
      { name: 'trust', desc: "'untrustworthy' (no eval or <10% attendance) | 'partial' (<40%) | 'reliable'" },
    ],
  },
  {
    name: 'v_vulnerability',
    grain: 'one row per student',
    desc: 'VULNERABILITY STACKING: students carrying multiple risk markers at once. marker_count (0–5) sums girl + lowest-income + disability + minority ethnicity + poor nutrition. Higher = more vulnerable; filter is_active and ORDER BY marker_count DESC for the most-at-risk group.',
    columns: [
      { name: 'student_id', desc: 'student id' },
      { name: 'student_name', desc: 'student name (include when listing)' },
      { name: 'programme', desc: 'ABAL | Catchup | Innovation' },
      { name: 'division', desc: 'student division' },
      { name: 'gender_label', desc: "'Male' | 'Female' | 'Other'" },
      { name: 'income_band', desc: 'family income band' },
      { name: 'marker_count', desc: 'number of risk markers stacked (0–5): girl, lowest-income, disability, minority ethnicity, poor nutrition' },
      { name: 'is_active', desc: 'boolean — still in programme' },
    ],
  },
  {
    name: 'v_ghost_students',
    grain: 'one row per active student',
    desc: 'GHOST / INACTIVE students: active students with no recorded attendance AND no assessment activity. Filter is_inactive = true. Only meaningful when the ACTIVE DATASET is Preview (gap-filled) — in Real, ~17% attendance coverage means "no activity" mostly reflects missing data, not true inactivity, so say so.',
    columns: [
      { name: 'student_id', desc: 'student id' },
      { name: 'student_name', desc: 'student name' },
      { name: 'programme', desc: 'ABAL | Catchup | Innovation' },
      { name: 'division', desc: 'student division' },
      { name: 'enrollment_year', desc: 'year enrolled' },
      { name: 'recorded_months', desc: 'months with a recorded attendance value (0 = none)' },
      { name: 'n_marks', desc: 'number of assessment marks (0 = none)' },
      { name: 'is_inactive', desc: 'boolean — no recorded attendance AND no marks (a "ghost"). Reliable only in Preview.' },
    ],
  },
  {
    name: 'v_teacher_batch',
    grain: 'one row per teacher',
    desc: 'SIMULATED teacher -> subject -> batch mapping (Preview-only). The real data links teachers to a centre only, so this illustrative link lets the "who teaches the weak subjects" drill-down be demonstrated. Join to a weak-subject cohort on center_id + subject. Always say the teacher-subject link is simulated, not real.',
    columns: [
      { name: 'center_id', desc: 'centre id the teacher belongs to' },
      { name: 'teacher_name', desc: 'teacher name' },
      { name: 'division', desc: 'division' },
      { name: 'subject', desc: "assigned subject (SIMULATED): Bangla | Mathematics | English | Science | BGS | Life Skills | Religion" },
      { name: 'batch', desc: 'assigned batch label (SIMULATED)' },
      { name: 'experience', desc: 'teacher experience band' },
    ],
  },
  {
    name: 'v_field_contact',
    grain: 'one row per division',
    desc: 'SIMULATED field-officer contact per division (Preview-only) — the escalation/"who to report to" reference. The real data has no contacts, so this is illustrative. If a division has no entry, advise reporting via the monthly review.',
    columns: [
      { name: 'division', desc: 'division' },
      { name: 'field_officer', desc: 'field officer name (SIMULATED)' },
      { name: 'phone', desc: 'contact phone (SIMULATED)' },
    ],
  },
];

/**
 * Views that EXIST in the engine but are intentionally NOT offered to the LLM, with the reason.
 * (Usually low-level/intermediate views whose grain or raw semantics would mislead the model.)
 * The `check:catalog` guard skips these instead of flagging them as undocumented.
 */
export const HIDDEN_VIEWS: Record<string, string> = {
  v_attendance: 'raw per-row attendance where 0 = not-recorded (a trap); the model must use v_student_attendance, which encodes the correct semantics + coverage',
};

/**
 * Columns that EXIST in a view but are intentionally NOT exposed to the LLM, with the reason.
 * The `check:catalog` guard treats these as accounted-for, so every real view column is either
 * documented above or listed here — nothing can be silently missing (the disability_type class of bug).
 * Keyed by view name → { column: reason }.
 */
export const HIDDEN_COLUMNS: Record<string, Record<string, string>> = {
  v_students: {
    education_start_date: 'raw date string; the queryable form is the derived enrollment_year',
  },
};

/** Allowed categorical values, so the LLM (and normaliser) map user words to exact stored values. */
export const ALLOWED_VALUES: Record<string, string[]> = {
  programme: ['ABAL', 'Catchup', 'Innovation'],
  division: ['Dhaka', 'Mymensingh', 'Chattogram', 'Sylhet', 'Rangpur'],
  gender_label: ['Male', 'Female', 'Other'],
  subject: ['Bangla', 'Mathematics', 'English', 'Science', 'BGS', 'Life Skills', 'Religion'],
  phase: ['BL', 'C1', 'C2', 'C3', 'C4', 'C5'],
  dropout_reason: ['Poverty', 'Others', 'Family Awareness', 'Inattentive', 'Distance', 'Migration', 'Working child'],
  income_band: ['<5000', '5000-9999', '10000-14999', '15000+'],
  employment_status: ['Active', 'Resigned', 'Replaced'],
  religion: ['Islam', 'Hindu', 'Buddhist', 'Christian'],
  admitted_grade: ['G1', 'G2', 'G3', 'G4', 'G5'],
};

/** User phrasing → canonical stored value. Case-insensitive keys. */
export const SYNONYMS: Record<string, string> = {
  // gender
  girl: 'Female', girls: 'Female', female: 'Female', woman: 'Female', women: 'Female',
  boy: 'Male', boys: 'Male', male: 'Male', man: 'Male', men: 'Male',
  // subjects
  math: 'Mathematics', maths: 'Mathematics', mathematics: 'Mathematics',
  bangla: 'Bangla', bengali: 'Bangla', english: 'English', science: 'Science',
  'life skill': 'Life Skills', 'life skills': 'Life Skills', religion: 'Religion', bgs: 'BGS',
  // divisions (common alternate spellings)
  chittagong: 'Chattogram', chattagram: 'Chattogram', chattogram: 'Chattogram',
  barisal: 'Barishal', dacca: 'Dhaka', dhaka: 'Dhaka', mymensingh: 'Mymensingh',
  sylhet: 'Sylhet', rangpur: 'Rangpur',
  // programmes
  abal: 'ABAL', catchup: 'Catchup', 'catch up': 'Catchup', 'catch-up': 'Catchup', innovation: 'Innovation',
};

/** Honesty caveats the LLM MUST respect (also shown to users). */
export const CAVEATS: string[] = [
  'Attendance: 0 = a month where attendance was not taken (~83% of rows). Show it TRANSPARENTLY, never hide it. For a SINGLE learner, return avg_attendance_all (never NULL) WITH recorded_months/total_months so the viewer sees whether it is a real value or a not-recorded 0. For an AVERAGE across learners, use avg_attendance_recorded (over months with a value) and always state coverage (~17%).',
  'Income is banded/approximate (parsed from free text; top band "15000+" stored as 15000). Report "average income" as approximate or as a band distribution, not an exact mean.',
  'Life Skills marks are ~84% zero (largely not assessed) — flag low Life Skills averages as a coverage artefact, not necessarily poor performance.',
  'Assessment coverage: only ~30% of students have any mark. Subject averages are over graded students only — say so.',
  'Teacher division may not align with student division (e.g. many teachers recorded in Sylhet where few students are). Interpret student-teacher ratios by division with care.',
  'is_active is a DERIVED status (not mainstreamed AND not dropout) — the source has no explicit status column; confirm the definition with the client.',
  'Teacher demographic columns (education, experience, religion, marital_status) are partly column-contaminated in the source export (some rows carry a neighbouring field\'s value, e.g. a district or status string in marital_status). Report distributions/counts over these as APPROXIMATE and never as exact figures.',
];

/** Render the catalog as the schema block injected into the LLM system prompt. */
export function renderCatalogForPrompt(): string {
  const views = VIEWS.map((v) => {
    const cols = v.columns.map((c) => `    - ${c.name}: ${c.desc}`).join('\n');
    return `${v.name}  (${v.grain})\n  ${v.desc}\n${cols}`;
  }).join('\n\n');
  const vals = Object.entries(ALLOWED_VALUES).map(([k, v]) => `  ${k}: ${v.join(', ')}`).join('\n');
  const caveats = CAVEATS.map((c) => `  - ${c}`).join('\n');
  return [
    'You may ONLY query these views (never the raw base tables):',
    '',
    views,
    '',
    'Allowed categorical values (map the user\'s words to these EXACT values):',
    vals,
    '',
    'Data caveats you MUST respect for honest answers:',
    caveats,
  ].join('\n');
}

/** Deterministic term normaliser (used independently of the LLM, e.g. for UI filters). */
export function canonicalize(term: string): string {
  return SYNONYMS[term.trim().toLowerCase()] ?? term.trim();
}
