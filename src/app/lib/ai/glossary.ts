/**
 * WHAT THE NUMBERS MEAN — the definitions behind every score, flag and term the app displays.
 *
 * This file exists because a definition the user reads MUST be the definition the database
 * computes. Explaining a score with invented weights is worse than not explaining it: the reader
 * then trusts a number they now misunderstand. So every computed entry carries its ACTUAL parts and
 * ACTUAL maximum contributions, copied from `semantic.sql`, plus an `anchor` — a literal fragment
 * of that SQL. `npm run e2e:full` asserts every anchor still exists and every declared weight is
 * still present in the view, so changing a calculation without changing its explanation FAILS THE
 * BUILD.
 *
 * The prose is written for a field officer with no statistics training. It is the ground truth an
 * explanation is composed from — the model may re-word it for the question actually asked, but may
 * not add a fact or a number that is not here.
 */

export interface GlossaryPart {
  /** Plain-language name of this component. */
  label: string;
  /** Its maximum contribution to the score. MUST match semantic.sql. */
  max: number;
  /** What it is measured from, in plain words. */
  meaning: string;
}

export interface GlossaryEntry {
  id: string;
  term: string;
  /** Every phrasing a user might type. Matched longest-first. */
  aliases: string[];
  /** One plain sentence — the answer to "what is it?". */
  short: string;
  /** The fuller explanation, in plain language. */
  plain: string;
  /** For a COMPUTED score: its real parts and weights. */
  parts?: GlossaryPart[];
  scale?: string;
  highMeans?: string;
  lowMeans?: string;
  /** Which view/column produces it — shown to the user as provenance. */
  source: string;
  /** A literal fragment that must still exist in semantic.sql (drift guard). */
  anchor?: string;
  /** Only meaningful in Preview mode. */
  previewOnly?: boolean;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: 'dropout_risk',
    term: 'Dropout risk score',
    aliases: ['dropout risk', 'risk score', 'risk_score', 'dropout risk score', 'at risk score', 'risk rating'],
    short: 'A 0–100 warning score for one child, built from four things we can actually see in their record.',
    plain: [
      'It is an early-warning number, not a prediction. It adds up the warning signs already visible in a',
      "child's record and turns them into one number from 0 to 100. A high number means several warning",
      'signs are stacking up on the same child.',
      '',
      'It is deliberately NOT built from whether children like this dropped out before. It only uses things',
      'you could see today, so it can never quietly "predict" dropout by looking at dropout.',
    ].join(' '),
    parts: [
      { label: 'Falling behind in schoolwork', max: 35, meaning: "the child's average test mark — the lower the mark, the more points" },
      { label: 'Missing class', max: 30, meaning: 'recorded attendance — the lower it is, the more points, and only counted if attendance was ever recorded' },
      { label: 'Money trouble at home', max: 15, meaning: 'the income band: under 5,000 Tk adds 15, 5,000–9,999 adds 9, 10,000–14,999 adds 4, 15,000+ adds nothing, unknown adds 5' },
      { label: 'Extra hardship', max: 20, meaning: 'a disability adds 6, poor nutrition adds 7, and belonging to a minority group adds 7' },
    ],
    scale: '0–100 (the four parts add up, then the total is capped at 100)',
    highMeans: 'Several warning signs at once. This child needs a look now.',
    lowMeans: 'Few visible warning signs — but check the confidence figure, because a low score can also mean the record is mostly empty.',
    source: 'v_dropout_risk.risk_score, with r_assessment, r_attendance, r_income and r_vulnerability showing each part',
    anchor: 'CREATE OR REPLACE VIEW v_dropout_risk',
  },
  {
    id: 'confidence_pct',
    term: 'Confidence',
    aliases: ['confidence', 'confidence pct', 'confidence_pct', 'confidence percent', 'confidence score', 'how confident', 'confidence level'],
    short: "How much of a child's record was actually filled in when the score was worked out.",
    plain: [
      'Confidence is about the RECORD, not about the child. The risk score looks at four things. Confidence',
      'says how many of those four had real data behind them.',
      '',
      'All four present is 100%. Two of four is 50%. The lowest it can go is 25%, because the hardship check',
      'always counts.',
      '',
      'This matters most when a score is LOW. A low risk score at low confidence does not mean the child is',
      'safe — it usually means nobody has recorded their attendance or their marks yet. That child is',
      'invisible, not fine.',
    ].join(' '),
    parts: [
      { label: 'Income band known', max: 25, meaning: 'the income band is recorded for this child' },
      { label: 'Attendance recorded', max: 25, meaning: 'attendance exists for at least one month' },
      { label: 'Any test mark', max: 25, meaning: 'the child has at least one assessment mark' },
      { label: 'Hardship check', max: 25, meaning: 'always counted, because disability, nutrition and ethnicity are recorded for everyone' },
    ],
    scale: '25–100%',
    highMeans: 'The record is well filled in, so the score can be trusted as a signal.',
    lowMeans: 'Most of this record is blank. Treat the score as a rough hint and go and check the child.',
    source: 'v_dropout_risk.confidence_pct',
    anchor: 'signals_present',
  },
  {
    id: 'vulnerability',
    term: 'Vulnerability markers',
    aliases: ['vulnerability score', 'vulnerability', 'vulnerable', 'marker count', 'marker_count', 'vulnerability markers', 'most vulnerable'],
    short: 'A count from 0 to 5 of how many disadvantages one child carries at the same time.',
    plain: [
      'Children rarely face just one problem. This counts how many stack up on the same child. Each one that',
      'applies adds a single point:',
      '',
      '* being a girl',
      '* household income under 5,000 Tk',
      '* a recorded disability',
      '* belonging to a minority group',
      "* poor nutrition (recorded as 'Bad' or 'Not so good')",
      '',
      'Every marker counts the same. It is a count of disadvantages, not a weighted score — so a child at 4',
      'is carrying four separate problems at once, and that stacking is the strongest signal in the data.',
      '',
      'Careful: the dropout risk score ALSO has a part called hardship, and it is not the same thing. That',
      'one is worth up to 20 points inside the risk score and counts neither gender nor income. This one is',
      'a simple count out of 5, standing on its own.',
    ].join('\n'),
    scale: '0–5',
    highMeans: 'Several disadvantages at once. These children are the most exposed in the programme.',
    lowMeans: 'None of the five recorded disadvantages apply.',
    source: 'v_vulnerability.marker_count',
    anchor: 'CREATE OR REPLACE VIEW v_vulnerability',
  },
  {
    id: 'coverage',
    term: 'Coverage',
    aliases: ['coverage', 'data coverage', 'attendance coverage', 'coverage pct', 'completeness', 'how complete'],
    short: 'The share of records that actually have a value, rather than being blank.',
    plain: [
      'Coverage is how much of the data is really there. If attendance coverage is 17%, then only about 17',
      'children in every 100 have any attendance recorded at all — the rest are blank.',
      '',
      'It is the single most important thing to read next to any average here. An average over 17% of',
      'children is a real number, but it describes those children, not the whole programme. Two places with',
      'very different coverage cannot be compared as equals.',
      '',
      'Coverage is never hidden in this system. Where it is thin, the answer says so.',
    ].join(' '),
    scale: '0–100%',
    highMeans: 'Nearly every record has a value, so an average over it represents almost everyone.',
    lowMeans: 'Most records are blank. The number is real, but it only speaks for the few who have data.',
    source: 'Measured live from the active dataset for every column (the database profile).',
  },
  {
    id: 'attendance_zero',
    term: 'Attendance (and what 0 means)',
    aliases: ['attendance', 'attendance rate', 'attendance percentage', 'zero attendance', 'avg_attendance_recorded', 'attendance figure'],
    short: 'A percentage of days attended — but a 0 means attendance was never taken, not that the child was absent.',
    plain: [
      'This is the most important rule in the whole dataset. A 0 in the attendance data means NOBODY TOOK THE',
      'REGISTER for that child that month. It does not mean the child stayed home.',
      '',
      'Treating those zeros as absence would drag every average down and invent a crisis that is not there.',
      'So averages here are taken over recorded months only, and the number of recorded months is always',
      'reported next to them.',
      '',
      'In the Real data attendance is ONE lifetime figure per child, with no date attached. That is why',
      'month-by-month questions and forecasts can only be answered in Preview.',
    ].join(' '),
    scale: '0–100%',
    source: 'v_student_attendance.avg_attendance_recorded, with recorded_months alongside it',
    anchor: 'avg_attendance_recorded',
  },
  {
    id: 'me_score',
    term: 'Monitoring score',
    aliases: ['monitoring score', 'me score', 'me_score', 'm&e score', 'centre score', 'center score', 'overall monitoring score'],
    short: 'A 0–5 quality rating for a centre — the average of five things an observer scores on a visit.',
    plain: [
      'When a monitor visits a centre they rate five separate things. The monitoring score is the average of',
      'those five ratings, on a scale of 0 to 5.',
      '',
      'Because it is an average, a centre can look middling while being very weak in one area. That is why',
      'the five parts are worth looking at separately before acting on the overall number.',
      '',
      'It is a 0–5 rating and attendance is a 0–100 percentage. The two must never be averaged together.',
    ].join(' '),
    parts: [
      { label: 'Teaching quality', max: 5, meaning: 'how well lessons are taught (pedagogy)' },
      { label: 'How well tests are run', max: 5, meaning: 'the quality of assessment practice' },
      { label: 'Record keeping', max: 5, meaning: 'whether the centre keeps its paperwork properly (documentation)' },
      { label: 'The classroom and safety', max: 5, meaning: 'the physical learning environment' },
      { label: 'Working with parents', max: 5, meaning: 'community and family engagement' },
    ],
    scale: '0–5',
    highMeans: 'The centre was rated well across the visit.',
    lowMeans: 'The centre was rated poorly — check which of the five parts is dragging it down.',
    source: 'v_center_enrollment.me_score, with pedagogy, assessment_quality, documentation, learning_environment and engagement as its five parts',
  },
  {
    id: 'me_indicator',
    term: 'Monitoring indicator',
    aliases: ['m&e indicator', 'me indicator', 'monitoring indicator', 'indicator', 'five indicators', 'dimension'],
    short: 'One of the five things a monitor rates on a centre visit, each scored 0 to 5.',
    plain: [
      'There are exactly five, and each is scored 0 to 5 on a centre visit:',
      '',
      '* Teaching quality — how lessons are taught',
      '* How well tests are run',
      "* Record keeping — the centre's paperwork",
      '* The classroom and safety',
      '* Working with parents and the community',
      '',
      "The centre's monitoring score is simply the average of these five. Asking which indicator is weakest",
      'across the network shows where support would help the most centres at once.',
    ].join('\n'),
    scale: '0–5 each',
    source: 'v_center_enrollment: pedagogy, assessment_quality, documentation, learning_environment, engagement',
  },
  {
    id: 'mainstreamed',
    term: 'Mainstreamed',
    aliases: ['mainstreamed', 'mainstream', 'mainstream status', 'mainstreaming'],
    short: 'The child moved on into a government primary school. It is the programme succeeding, not a loss.',
    plain: [
      'Mainstreaming is the goal. These centres exist to get children ready for formal school, so a child',
      'recorded as mainstreamed has finished what the programme set out to do.',
      '',
      'This matters when you count dropouts. A large number of mainstreamed children ALSO carry a reason for',
      'dropout in their record, which would make the programme look like it is failing when the opposite',
      'happened. So an honest dropout count needs a dropout reason AND no mainstreaming.',
    ].join(' '),
    source: 'v_students.mainstream_status / is_mainstreamed',
  },
  {
    id: 'true_dropout',
    term: 'Dropout (true dropout)',
    aliases: ['dropout', 'true dropout', 'is_true_dropout', 'dropped out', 'left the programme'],
    short: 'A child with a recorded reason for leaving who was NOT mainstreamed.',
    plain: [
      'The raw dropout flag cannot be trusted on its own, because around a hundred thousand children who were',
      'successfully mainstreamed also carry a reason for dropout in their record.',
      '',
      'So the honest definition used here is: a reason for leaving is recorded, AND the child was not',
      'mainstreamed. Counting the raw flag instead would badly overstate dropout.',
      '',
      'This overlap is a known data problem and is still awaiting confirmation from the programme team.',
    ].join(' '),
    source: 'v_dropout_risk.is_true_dropout',
    anchor: 'is_true_dropout',
  },
  {
    id: 'is_active',
    term: 'Active student',
    aliases: ['active', 'is_active', 'active student', 'active status', 'currently enrolled'],
    short: 'A child who is neither mainstreamed nor recorded as having dropped out.',
    plain: [
      'There is no column in the source data that says whether a child is still attending. So "active" is',
      'worked out by elimination: not mainstreamed, and no dropout reason recorded.',
      '',
      'That is a reasonable reading, but it is our definition rather than the programme\'s, and it should be',
      'confirmed with the client. Because mainstreaming and dropout overlap so heavily in the newer export,',
      'the active count there is unreliable, and any answer using it says so.',
    ].join(' '),
    source: 'v_students.is_active (derived, not a source column)',
  },
  {
    id: 'ghost',
    term: 'Ghost / inactive student',
    aliases: ['ghost', 'ghost student', 'ghost students', 'inactive student', 'silent dropout', 'activity status', 'activity_status'],
    short: 'A child still on the register who has quietly stopped taking part.',
    plain: [
      'A ghost is the silent dropout — the register still counts them, but nothing about them is moving. Two',
      'things must both be true, and only children marked active are considered:',
      '',
      '* no attendance in the last two weeks, or no attendance ever recorded, AND',
      '* no assessment marks at all',
      '',
      'Children who meet only the first test are shown as at risk rather than ghosts — they are fading, not',
      'yet gone.',
      '',
      'In Real mode there is no recency data, so this collapses to "never recorded". At around 17% attendance',
      'coverage that mostly reflects MISSING PAPERWORK rather than missing children, and a Real-mode answer',
      'must always say so.',
    ].join('\n'),
    source: 'v_ghost_students.activity_status (ghost / at_risk / active)',
    anchor: 'CREATE OR REPLACE VIEW v_ghost_students',
  },
  {
    id: 'trust',
    term: 'Centre data trust',
    aliases: ['trust', 'untrustworthy', 'data trust', 'reliable centre', 'too incomplete', 'incomplete to trust'],
    short: 'A flag saying whether a centre has enough data behind it to be judged fairly.',
    plain: [
      "Before you act on a centre's numbers, it is worth knowing whether the numbers exist. Each centre is",
      'labelled one of three ways:',
      '',
      '* untrustworthy — no monitoring score, or fewer than one in ten of its children have any attendance',
      '* partial — fewer than four in ten of its children have attendance recorded',
      '* reliable — everything else',
      '',
      'This is a data-quality label, not a judgement of the centre. An untrustworthy centre is not a bad',
      'centre; it is one you cannot yet fairly assess.',
    ].join('\n'),
    source: 'v_center_health.trust',
    anchor: 'CREATE OR REPLACE VIEW v_center_health',
  },
  {
    id: 'likelihood_worst',
    term: 'Likelihood of being among the worst',
    aliases: ['likelihood worst', 'likelihood_worst_pct', 'probability', 'likelihood', 'chance of being worst'],
    short: 'An estimate of how likely a centre is to be among the poorest performers next month.',
    plain: [
      "It blends two things: where the centre's attendance is heading (60% of it) and its monitoring score",
      "(40%). The attendance side comes from that centre's OWN recent months, so it follows that centre's",
      'direction rather than a regional average.',
      '',
      'Read it as a ranking aid, not a probability. It is a relative estimate — a way of ordering centres by',
      'concern — and it is NOT a calibrated statistical probability. A centre at 70 is of more concern than',
      'one at 40; it does not mean seven chances in ten.',
      '',
      'It exists only in Preview, because Real mode has no month-by-month attendance to read a direction from.',
    ].join(' '),
    scale: '0–100 (relative, not a true probability)',
    source: 'v_center_forecast.likelihood_worst_pct',
    anchor: 'CREATE OR REPLACE VIEW v_center_forecast',
    previewOnly: true,
  },
  {
    id: 'forecast',
    term: 'Attendance forecast',
    aliases: ['forecast', 'attendance forecast', 'next month attendance', 'projection', 'predicted attendance', 'seasonal'],
    short: "Next month's attendance, projected from the recent trend after the monsoon pattern is removed.",
    plain: [
      'Attendance in Bangladesh has a strong seasonal shape — it dips from June to September and recovers in',
      'November and December. Projecting the raw numbers forward would read that seasonal recovery as real',
      'improvement and call almost every centre "improving".',
      '',
      'So it is done in three steps. First the seasonal pattern is measured from the data itself and divided',
      'out. Then the underlying trend is fitted over the last six months. Then next month\'s seasonal shape is',
      'put back, and the result is held between 0 and 100.',
      '',
      'It is an estimate from a short recent window, not a promise. It exists only in Preview.',
    ].join(' '),
    source: 'v_attendance_forecast and v_center_forecast',
    anchor: 'CREATE OR REPLACE VIEW v_attendance_forecast',
    previewOnly: true,
  },
  {
    id: 'economic_pressure',
    term: 'Economic pressure',
    aliases: ['economic pressure', 'economic hardship', 'household hardship', 'financial pressure'],
    short: 'Centres where low attendance sits alongside money trouble in the families they serve.',
    plain: [
      'It exists to separate two problems that look identical on a chart. A centre with low attendance',
      'because families are under economic strain needs cash support and family outreach. A centre with low',
      'attendance and no economic strain needs help with the centre itself — teaching, or the classroom.',
      '',
      "Each hardship marker is shown both as the centre's own figure and as the network figure on the same",
      'row, so you can see whether the centre really is worse than usual or only looks it.',
      '',
      'This is an association, not proof. Poor families and low attendance appearing together does not',
      'establish that one caused the other.',
    ].join(' '),
    source: 'v_center_economic_pressure',
  },
  {
    id: 'income_band',
    term: 'Income band',
    aliases: ['income band', 'income_band', 'household income', 'family income', 'income', 'poorest band'],
    short: 'Household income grouped into bands, because the source figure is approximate.',
    plain: [
      'Income arrives as free text and is cleaned into bands: under 5,000 Tk, 5,000–9,999, 10,000–14,999, and',
      '15,000 or more. The top band is open-ended and stored as 15,000, so it is a floor, not an amount.',
      '',
      'Because of that, an exact average income is not an honest figure here. Income should be reported as a',
      'spread across bands, or clearly labelled approximate.',
      '',
      "One caution: in the older Real data this band is the FATHER's income; in the newer export it is the",
      "whole household's. They are not the same measure, so do not compare them across datasets.",
    ].join(' '),
    source: 'v_students.income_band / household_income_band',
  },
  {
    id: 'score_levels',
    term: 'Score levels',
    aliases: ['score level', 'score levels', 'reading level', 'reading levels', 'mark band', 'grade level'],
    short: "The programme's own mark bands: under 40, 40–49, 50–59, 60–79, and 80 or above.",
    plain: [
      'Marks are grouped into five bands the programme already uses: under 40, 40 to 49, 50 to 59, 60 to 79,',
      'and 80 or above. These carry meaning for the programme and are never improvised.',
      '',
      'One honest limit: there is NO separate reading assessment in this data. Reading level is approximated',
      'by the language subjects, Bangla and English. Everything else is a plain score level.',
      '',
      'Only children who have a mark appear at all — around 30% of them. These are counts of assessed',
      'children, never of every child enrolled.',
    ].join(' '),
    source: 'v_score_levels',
    anchor: 'CREATE OR REPLACE VIEW v_score_levels',
  },
  {
    id: 'programme',
    term: 'Programme (ABAL, Catchup, Innovation)',
    aliases: ['programme', 'program', 'abal', 'catchup', 'catch up', 'innovation', 'programme variant'],
    short: 'The three variants of the programme that run on one shared data model.',
    plain: [
      'Three variants run side by side: ABAL, Catchup and Innovation. Catchup is much the largest, ABAL is',
      'next, and Innovation is small.',
      '',
      'They differ sharply in how well their data is recorded, which matters more than it sounds. In the',
      'newer export attendance is recorded for nearly every ABAL child and about four in five Catchup',
      'children, but fewer than one in ten Innovation children. Comparing the three on attendance without',
      'saying that would mislead.',
      '',
      'What the names stand for is not recorded anywhere in the data, so the programme team is the right',
      'place to confirm what each variant actually does.',
    ].join(' '),
    source: 'v_students.programme',
  },
  {
    id: 'student_teacher_ratio',
    term: 'Student-teacher ratio',
    aliases: ['student teacher ratio', 'student-teacher ratio', 'teacher ratio', 'students per teacher', 'pupil teacher ratio'],
    short: 'How many children there are for each active teacher, worked out by division.',
    plain: [
      'It counts children against ACTIVE teachers only, so teachers who have left do not flatter the number.',
      '',
      "Read it with care by division. A teacher's recorded division does not always match where their",
      'children are — there are divisions with many teachers recorded and few children. That makes some',
      'divisional ratios look far better or worse than reality.',
    ].join(' '),
    source: 'v_teacher_ratio_by_division',
  },
  {
    id: 'associated_factor',
    term: 'Associated factor',
    aliases: ['associated factor', 'contributing factor', 'factor', 'factors', 'driver', 'drivers'],
    short: 'Something measurably more common in this group than in the rest of the network.',
    plain: [
      'When you ask why a group is struggling, the system compares that exact group against everyone else and',
      'reports the real differences it finds. Every figure is measured in the database, never written by the AI.',
      '',
      'A difference has to survive four tests before it is shown. It must not simply restate the thing being',
      'explained. It must point the wrong way for the children — a group that is HEALTHIER than average is not',
      'a driver of their problems. It must not be mere composition, like a gender split. And it must be big',
      'enough to matter: at least 8 points apart and at least a quarter more common, or a 10% difference for',
      'averages.',
      '',
      'These are things that happen TOGETHER. None of them is proof that one causes the other. When nothing',
      'passes the tests, the answer says so instead of padding the list.',
    ].join(' '),
    source: 'Computed in SQL by the factor engine, for the exact group in your answer.',
  },
  {
    id: 'protective_factor',
    term: 'Counter-signal (protective factor)',
    aliases: ['protective factor', 'counter signal', 'counter-signal', 'protective'],
    short: 'Something this group is BETTER at than the rest of the network.',
    plain: [
      'Sometimes a group differs from everyone else in a good way — better nutrition, better attendance, a',
      'stronger centre. That is worth knowing, but it is not an explanation of their problem, so it is shown',
      'separately and never listed as a cause.',
      '',
      'Without this split the analysis would happily report "0% poor nutrition" as a driver of absence, which',
      'is exactly backwards.',
    ].join(' '),
    source: 'Computed by the factor engine alongside the drivers.',
  },
];

/** Normalise for matching: strip punctuation, collapse spaces, pad so whole-phrase matching works. */
const norm = (s: string): string => ` ${s.toLowerCase().replace(/[^a-z0-9&%]+/g, ' ').trim()} `;

/** Every alias, longest first, so "dropout risk score" beats "dropout". */
const INDEX: { alias: string; entry: GlossaryEntry }[] = GLOSSARY
  .flatMap((e) => [e.term, ...e.aliases].map((alias) => ({ alias: norm(alias), entry: e })))
  .sort((a, b) => b.alias.length - a.alias.length);

/** Which glossary terms does this question mention? Longest alias wins; each entry at most once. */
export function findTerms(question: string): GlossaryEntry[] {
  const q = norm(question ?? '');
  const hits: GlossaryEntry[] = [];
  for (const { alias, entry } of INDEX) {
    if (hits.includes(entry)) continue;
    if (q.includes(alias)) hits.push(entry);
  }
  return hits;
}

/** The ground-truth block an explanation is composed from. Nothing outside this may be asserted. */
export function renderTermFacts(entries: GlossaryEntry[]): string {
  return entries.map((e) => {
    const lines = [`TERM: ${e.term}`, `IN ONE LINE: ${e.short}`, `EXPLANATION: ${e.plain}`];
    if (e.parts?.length) {
      lines.push('WHAT IT IS MADE OF (these weights are the real ones used in the calculation):');
      for (const p of e.parts) lines.push(`  - ${p.label} — worth up to ${p.max}: ${p.meaning}`);
    }
    if (e.scale) lines.push(`SCALE: ${e.scale}`);
    if (e.highMeans) lines.push(`A HIGH VALUE MEANS: ${e.highMeans}`);
    if (e.lowMeans) lines.push(`A LOW VALUE MEANS: ${e.lowMeans}`);
    if (e.previewOnly) lines.push('AVAILABLE IN: Preview mode only.');
    lines.push(`COMES FROM: ${e.source}`);
    return lines.join('\n');
  }).join('\n\n');
}

/** Deterministic answer — used when no model is available, or when a composed answer is rejected. */
export function renderTermAnswer(e: GlossaryEntry): string {
  const out = [`**${e.term}** — ${e.short}`, '', e.plain];
  if (e.parts?.length) {
    out.push('', '**What goes into it:**');
    for (const p of e.parts) out.push(`* **${p.label}** — worth up to ${p.max}. ${p.meaning}.`);
  }
  if (e.highMeans) out.push('', `**A high value means:** ${e.highMeans}`);
  if (e.lowMeans) out.push(`**A low value means:** ${e.lowMeans}`);
  out.push('', `*Comes from: ${e.source}*`);
  return out.join('\n');
}
