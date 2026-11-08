// Honest answers for questions a real dataset cannot support. Without this a model might stretch a
// nearby field into an answer, or reach for a simulated view. Shaped like modeGuard's answer.
import type { AskResult } from '../pipeline';

interface Gap {
  id: string;
  /** Deliberately specific, so ordinary questions that merely mention a word are not caught. */
  match: RegExp;
  missing: string;
  needed: string;
  instead: string;
}

const GAPS: Gap[] = [
  { id: 'cash', match: /\bcash transfers?\b|\bpayment (history|records?)\b|\bexpected payments?\b|\bpayment amounts?\b|\bduplicate transaction\b/, missing: 'cash transfer payments', needed: 'a payment record for each learner, with date, amount and transaction number', instead: 'Show low-income students and their academic performance.' },
  { id: 'teacher_att', match: /\bteacher attendance\b|\bteacher has the best attendance\b/, missing: 'teacher attendance', needed: 'a dated attendance log for each teacher', instead: 'Which centers have the highest attendance?' },
  { id: 'visits', match: /\b(po|staff)[- ]?(wise )?visits?\b|\bvisit (frequency|counts?)\b|\b(received|receive) (the )?(most |fewest |fewer[- ]than[- ]average )?visits\b|\bfrequently visited\b|\bnot been visited\b|\brepeated visits\b|\blimited monitoring\b|\bstaff member covers\b|\bsupervised teachers under\b/, missing: 'staff and PO visit logs', needed: 'a dated log of each visit, showing who visited which center', instead: 'Which centers have the lowest M&E scores?' },
  { id: 'obs_history', match: /\bobservations?\b.*\b(repeated|history|negative|unresolved|last three|fail|categories)\b|\b(repeated|negative|unresolved|observation)\b.*\bobservations?\b|\bobservation categories\b|\blast three observations\b|\bmost common monitoring issues\b|\bunresolved issues\b|\bdespite repeated monitoring\b/, missing: 'dated monitoring observations', needed: 'each monitoring round recorded with its date, findings and follow-up', instead: 'Which centers have the lowest M&E scores?' },
  { id: 'ppe', match: /\bppe\b/, missing: 'PPE centers and learners (every center in this dataset is NFPE)', needed: 'PPE center and learner records', instead: 'Show center count by sub-program.' },
  { id: 'org', match: /\borgani[sz]ation\b.*\bcenters?\b/, missing: 'which organization runs each center', needed: 'a partner organization field on each center', instead: 'Which district has the highest average center performance?' },
  { id: 'dropout_date', match: /\bmonth\b.*\bdropouts?\b|\bincrease in dropout\b|\breduced dropout\b/, missing: 'the date each student dropped out', needed: 'a dropout date on each student record', instead: 'Which district has the highest dropout rate?' },
  { id: 'unit', match: /\bunit[- ]wise\b/, missing: 'unit-level marks (marks are recorded by subject and assessment phase only)', needed: 'marks recorded per unit', instead: 'Show subject-wise student performance.' },
  { id: 'ready', match: /\bready for mainstream|\bpreparing students for mainstream/, missing: 'a ready-for-mainstreaming flag', needed: 'an agreed readiness definition and a field recording it', instead: 'Which centers have the highest mainstream conversion rate?' },
  { id: 'dated', match: /\blast six months\b/, missing: 'dates on most activity, so two six-month periods cannot be compared', needed: 'dated attendance, dropout and visit records', instead: 'Show the student status distribution.' },
  { id: 'center_monthly', match: /\bmonthly attendance\b/, missing: 'month-by-month attendance (each child has one lifetime figure)', needed: 'attendance logged with a month against it', instead: 'Which centers have the lowest attendance?' },
  { id: 'student_monthly', match: /\battendance decline\b|\bunusual attendance patterns\b/, missing: 'month-by-month attendance (each child has one lifetime figure)', needed: 'attendance logged with a month against it', instead: 'Show students with attendance below 60%.' },
  { id: 'teacher_link', match: /^(show the top \d+ teachers|which teachers?\b.*\b(students?|dropout|outcomes?|improvement)\b|compare teachers\b|analy[sz]e teacher\b)/, missing: 'which teacher teaches which students (teachers are linked to a center only)', needed: 'a link between each teacher and their class or students', instead: 'Show the top 10 centers based on student results.' },
];

/** A finished "not available" answer, or null when this question is not about a known gap. */
export function unavailableAnswer(normalized: string, question: string): AskResult | null {
  const gap = GAPS.find((g) => g.match.test(normalized));
  if (!gap) return null;
  const finding = `This dataset does not record ${gap.missing}, so this cannot be answered here. Nothing has been estimated in its place.`;
  const interpretation = `To answer this for real, the program would need ${gap.needed}.`;
  const action = `Switch to Preview to see a simulated version, clearly marked as estimated. For a real answer today, ask: "${gap.instead}"`;
  return {
    question, intent: 'unsupported', sql: null, refused: false, attempts: 0, trained: true, provider: 'none',
    response: { summary: `* ${finding}\n* ${interpretation}\n* ${action}`, widgets: [] },
    reasoning: {
      intent: 'retrieval', finding, factors: [], protective: null, requested: [], requestedUnavailable: [], interpretation,
      confidence: { level: 'high', note: 'This limit is certain: the field does not exist in this dataset.' }, action,
    },
  };
}
