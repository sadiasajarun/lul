// ANALYSIS PLAYBOOKS — the in-context "knowledge" layer for predictive analysis (NOT a trained model).
//
// Each playbook turns a raw query into an actionable analysis: it supplies the honest coverage note
// (per data mode), the advisory recommendation (the "what to do"), and the drill-down follow-ups (the
// relational chain). The numbers still come from SQL over the semantic views — the playbook only adds
// the framing/action/next-steps around them. Matched by a keyword regex over the user's prompt.

export interface Playbook {
  id: string;
  /** matches the user's prompt (or a curated card) to this analysis */
  match: RegExp;
  /** advisory recommendation — the "what to do" (the human decides) */
  recommendation: string;
  /** honest coverage/confidence note, shown as a caption; picked by the active data mode */
  coverage: { real: string; preview: string };
  /** drill-down follow-up questions — the relational chain (rendered as chips) */
  followups: string[];
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'dropout_risk',
    match: /dropout risk|risk of drop(ping)?|at.?risk student|high(est|er)?.?risk student|who (is|are)( the)?( most)? at.?risk|risk score|most likely to (drop|leave)/i,
    recommendation:
      'Prioritise home visits and guardian meetings for the highest-risk students, and screen the lowest-income among them for cash support.',
    coverage: {
      real: 'Scores are strongest where attendance/assessment data exists (attendance ~17% coverage). Treat low-confidence scores as indicative, not precise.',
      preview: 'Estimated — attendance and marks are gap-filled in Preview. For demonstration only, not for decisions.',
    },
    followups: [
      'Why are these students at risk?',
      'Family income of the highest-risk students',
      'Which centers have the most at-risk students?',
    ],
  },
  {
    id: 'vulnerability',
    match: /vulnerab|stacked risk|multiple risk|compound(ing)? (risk|vulnerab)|most.?vulnerable/i,
    recommendation:
      'Target outreach at students stacking the most markers first — they carry compounding risk. Combine a home visit with economic screening.',
    coverage: {
      real: 'Markers vary in coverage — gender and income are near-complete, but disability (~1%) and ethnicity (~4%) are sparse, so counts under-state the true picture.',
      preview: 'Estimated — sparse markers are gap-filled in Preview. For demonstration only, not for decisions.',
    },
    followups: ['Their family income', 'Which division has the most vulnerable students?', 'Their weakest subjects'],
  },
  {
    id: 'worst_centers',
    match: /worst.?performing cent|lowest.?scor|cent(er|re)s? .*lowest|cent(er|re).*need.*(visit|support|help)/i,
    recommendation:
      'Send field support to the lowest-scoring centres first, starting with the weakest evaluation category (usually pedagogy).',
    coverage: {
      real: 'Based on the M&E evaluation, which covers ~1,398 of ~1,630 centres — unevaluated centres are not ranked here.',
      preview: 'Estimated — centre scores are gap-filled in Preview. For demonstration only, not for decisions.',
    },
    followups: ['Why are these centres worst?', 'Their attendance coverage', 'Which centres have the most at-risk students?'],
  },
  {
    id: 'center_data_trust',
    match: /data.?trust|trust.*data|data (is )?(too )?(sparse|incomplete)|can.?t be trusted|reporting.?health|untrustworthy cent/i,
    recommendation:
      'Fix reporting at the untrustworthy centres before acting on their numbers — otherwise every other analysis is blind for them.',
    coverage: {
      real: 'This IS the coverage view — it flags centres whose attendance/evaluation data is too thin to trust.',
      preview: 'In Preview the gaps are filled, so most centres read as reliable — the real gaps only show in Real mode.',
    },
    followups: ['Which division has the least reliable data?', 'Worst-performing centres', 'Attendance coverage by programme'],
  },
  {
    id: 'weakest_subjects',
    match: /weak(est)? subject|lowest (average )?mark|worst subject|subject.*(lowest|weak)/i,
    recommendation:
      'Focus teaching support on the weakest subject first — but confirm the sample size, since assessment coverage is partial.',
    coverage: {
      real: 'Assessment marks cover only ~29% of students and mix valid ranges — averages are over graded students only; read with the sample size.',
      preview: 'Estimated — marks are gap-filled in Preview. For demonstration only, not for decisions.',
    },
    followups: ['Weakest subject in Catchup', 'Which centres score lowest in Mathematics?', 'Cycle-wise marks progression'],
  },
  {
    id: 'economic_pressure',
    match: /lowest.?income|poorest|economic pressure|working child|cash support|income band/i,
    recommendation:
      'Screen the lowest-income students for cash support, and cross-check against dropout risk — poverty is the leading dropout driver.',
    coverage: {
      real: 'Income is banded/approximate (~83% coverage). Read bands, not exact figures.',
      preview: 'Estimated — income gaps are filled in Preview. For demonstration only, not for decisions.',
    },
    followups: ['Which of them are highest dropout risk?', 'Their weakest subjects', 'Which division has the most low-income students?'],
  },
  {
    id: 'attendance_trend',
    match: /attendance (trend|over time|month|decline)|month.?by.?month|attendance.*declin|trend.*attendance/i,
    recommendation:
      'Watch centres whose attendance is sliding month-on-month and intervene before the decline hardens into dropout.',
    coverage: {
      real: 'Not available in Real mode — real attendance is a single lifetime figure with no dates.',
      preview: 'Estimated monthly series (simulated) — a demonstration of the trend capability, not for decisions.',
    },
    followups: ['Which centres are declining fastest?', 'Attendance by programme', 'Students with the worst attendance'],
  },
  {
    id: 'ghost',
    match: /ghost|inactive student|no activity|enrolled but|zero (attendance|activity)/i,
    recommendation:
      'Verify the flagged students are real and still enrolled — sustained inactivity is often a silent dropout to follow up.',
    coverage: {
      real: 'Unreliable in Real mode — with ~17% attendance coverage, "no activity" mostly means "not recorded", not truly inactive.',
      preview: 'Estimated — activity is gap-filled in Preview, so inactivity is meaningful here. For demonstration only.',
    },
    followups: ['Which centres have the most inactive students?', 'Their family income', 'Their dropout risk'],
  },
  {
    id: 'teacher_impact',
    match: /teacher.*(subject|batch|weak|impact|handl|responsible|experience)|who teaches|teachers? of (the|these)|which teacher/i,
    recommendation:
      'Pair the least-experienced teachers on the weakest subjects with a mentor, and rebalance assignments where one teacher covers too many weak areas.',
    coverage: {
      real: 'Simulated — the real data links teachers to a centre only, not to subjects or batches. This teacher-subject mapping is illustrative.',
      preview: 'Estimated — teacher-batch-subject links are simulated for Preview. For demonstration only, not for decisions.',
    },
    followups: ['Their experience levels', 'Which centres have the least-experienced teachers?', 'Who to contact about this centre?'],
  },
];

/** Find the playbook matching a prompt, if any. */
export function matchPlaybook(prompt: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.match.test(prompt));
}

/** The coverage note for a prompt at the active data mode ('tuned' = preview), or undefined. */
export function playbookCoverage(prompt: string, mode: string | undefined): string | undefined {
  const pb = matchPlaybook(prompt);
  if (!pb) return undefined;
  return mode === 'tuned' ? pb.coverage.preview : pb.coverage.real;
}
