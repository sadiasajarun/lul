/**
 * COVERAGE FIGURES PER DATASET.
 *
 * The caveats and examples the model reads were written for the older Real export ("attendance ~17%",
 * "~30% of students have a mark"). They are right there and wrong elsewhere: Preview is gap-filled to
 * almost 100%, and Real ·26 records attendance for about two thirds of learners. Repeated in a Preview
 * answer, the old figures told readers most of the data was missing.
 *
 * Real keeps its wording exactly. Other datasets get the same sentences with their own figures, so
 * nothing else in the instructions moves. Figures measured from public/data-v2 and public/data-tuned.
 */

interface Coverage {
  /** Attendance rows with no value or a 0. */
  attendanceRowsMissing: number;
  /** Learners with at least one recorded attendance value. */
  learnersWithAttendance: number;
  /** Learners with at least one mark. */
  learnersWithMark: number;
}

const COVERAGE: Record<string, Coverage> = {
  v2: { attendanceRowsMissing: 36, learnersWithAttendance: 64, learnersWithMark: 99 },
  tuned: { attendanceRowsMissing: 0, learnersWithAttendance: 100, learnersWithMark: 100 },
};

/** [text written for Real, the same text for this dataset]. Empty for Real. */
export function coverageReplacements(dataMode: string | undefined): [string, string][] {
  const c = dataMode ? COVERAGE[dataMode] : undefined;
  if (!c) return [];
  const estimated = dataMode === 'tuned' ? ', mostly estimated' : '';
  return [
    ['(~83% of rows)', `(~${c.attendanceRowsMissing}% of rows in this dataset)`],
    ['always state coverage (~17%)', `always state coverage (~${c.learnersWithAttendance}% of learners in this dataset${estimated})`],
    ['only ~30% of students have any mark', `~${c.learnersWithMark}% of students in this dataset have a mark${estimated}`],
    ['(~30% of students have any mark)', `(~${c.learnersWithMark}% of students in this dataset have a mark)`],
    ['(~30% of learners have a mark)', `(~${c.learnersWithMark}% of learners in this dataset have a mark)`],
    ['Only ~30% of learners have any mark', `About ${c.learnersWithMark}% of learners in this dataset have a mark`],
  ];
}

/** The text with Real-only coverage figures swapped for this dataset's. Identity for Real. */
export function withCoverage(text: string, dataMode: string | undefined): string {
  let out = text;
  for (const [from, to] of coverageReplacements(dataMode)) out = out.split(from).join(to);
  return out;
}

/** The data caveats as they apply to this dataset. */
export function caveatsFor(caveats: string[], dataMode: string | undefined): string[] {
  return caveats.map((c) => withCoverage(c, dataMode));
}
