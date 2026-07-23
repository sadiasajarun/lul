/**
 * Typed access to the build-time aggregates (REVAMP PART 5).
 *
 * Dashboard views read ONLY from here — never the raw CSVs. Regenerate with `npm run aggregate`
 * after any change to Database/*.csv.
 *
 * GOLDEN RULE: every number exposed here traces to a named CSV column or a
 * summary_dataset.json field. Nothing is invented.
 */

import byProgramJson from "../../../Database/demo/aggregates/by_program.json";
import byDivisionJson from "../../../Database/demo/aggregates/by_division.json";
import attendanceJson from "../../../Database/demo/aggregates/attendance.json";

export type ProgramKey = "abal" | "catchup" | "innovation";

export const PROGRAM_LABELS: Record<ProgramKey, string> = {
  abal: "ABAL",
  catchup: "Catchup",
  innovation: "Innovation",
};

export interface ProgramAttendance {
  /** Mean over students with a NON-ZERO record. The honest behaviour signal. */
  recorded_mean: number | null;
  /** recorded_count / rows. Below 0.9 → the UI must show a coverage caption. */
  coverage: number;
  recorded_count: number;
  /** Mean including zero rows — what summary_dataset.json reports. Coverage-contaminated. */
  raw_mean_including_zeros: number | null;
  summary_dataset_value: number;
}

export interface Program {
  students: number;
  boys: number;
  girls: number;
  mainstreamed: number;
  mainstream_rate: number | null;
  dropout_reasons: Record<string, number>;
  attendance: ProgramAttendance;
}

export interface Totals {
  students: number;
  teachers: number;
  programs: number;
  mainstreamed: number;
  mainstream_rate: number | null;
}

export const programs = byProgramJson.programs as unknown as Record<ProgramKey, Program>;
export const totals = byProgramJson.totals as unknown as Totals;

export const divisions = byDivisionJson.students as unknown as Record<string, number>;
export const teachersByDivision = byDivisionJson.teachers as unknown as Record<string, number>;

export interface AttendanceOverall {
  rows: number;
  recorded_count: number;
  coverage: number;
  recorded_mean_student_weighted: number;
  raw_mean_student_weighted_including_zeros: number;
}

export const attendance = {
  overall: attendanceJson.overall as unknown as AttendanceOverall,
  byProgram: attendanceJson.by_program as unknown as Record<
    ProgramKey,
    ProgramAttendance & { rows: number; zero_count: number; distribution: { bin: string; count: number }[] }
  >,
  note: attendanceJson.note as string,
  zeroMeaning: attendanceJson.zero_meaning as string,
};

export const PROGRAM_KEYS: ProgramKey[] = ["abal", "catchup", "innovation"];

/** Coverage below this triggers a mandatory caption (prototype rule D5). */
export const COVERAGE_THRESHOLD = 0.9;
