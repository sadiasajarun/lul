/**
 * Guarantees that CANNOT be left to a prompt.
 *
 * The source data holds ONE lifetime attendance percentage per learner, with no dates attached.
 * There is therefore no time series in Real mode and no honest way to project attendance forward.
 * Asked anyway, a language model will happily invent a trend — so the refusal is enforced here, in
 * code, before any model call. Preview mode is unaffected: its simulated monthly series exists
 * precisely to demonstrate what dated attendance would unlock, and is watermarked wherever it shows.
 */
import type { AskResult } from './pipeline';

/** Forward-looking attendance questions: "rising risk", "will decline", "forecast attendance". */
const FORWARD_ATTENDANCE =
  /(rising|growing|increasing) risk|at risk of low attendance|forecast|predict|projection|trend(ing)? (down|up)|going to (drop|fall|decline)|will (drop|fall|decline|worsen)|next (month|term|week)/i;

const ATTENDANCE_SUBJECT = /attend|absent|absence|turnout|coming to (class|school)|drop(-| )?out rate/i;

/**
 * Returns a finished answer when the active dataset genuinely cannot support the question, or null
 * to let the normal pipeline run. Costs nothing — no model call is made.
 */
export function modeGuard(question: string, dataMode: string): AskResult | null {
  const q = question ?? '';
  const isRealMode = dataMode !== 'tuned';
  if (!isRealMode) return null;
  if (!FORWARD_ATTENDANCE.test(q) || !ATTENDANCE_SUBJECT.test(q)) return null;

  const finding =
    'Attendance cannot be projected forward in Real mode. The recorded data holds a single lifetime attendance figure for each child, with no dates attached — so there is no month-by-month history to read a direction from. Any trend shown here would be invented, so none is shown.';

  const interpretation =
    'This is a limit of what is collected, not of the analysis. Attendance is stored as one number per child for the whole programme. To see whether a centre is getting better or worse, attendance needs to be logged with a date — monthly would be enough. Once a few months of dated attendance exist, this question can be answered for real. Preview mode already shows what that would look like, using simulated months, so you can see the capability before the data exists.';

  const action =
    'Switch to Preview mode to see the simulated version of this view, clearly marked as estimated and not for decisions. For a real answer today, ask "Which low-attendance centres also show economic pressure?" — that uses current recorded attendance alongside household hardship, with no forecasting involved. To unlock true forward risk, start logging attendance with a month against it.';

  return {
    question,
    intent: 'unsupported',
    sql: null,
    refused: false,
    attempts: 0,
    response: { summary: finding, widgets: [] },
    reasoning: {
      intent: 'predictive',
      finding,
      factors: [],
      protective: null,
      requested: [],
      requestedUnavailable: [],
      interpretation,
      confidence: {
        level: 'high',
        note: 'This limit is certain, not a judgement call: the attendance export contains no date column at all.',
      },
      action,
    },
  };
}
