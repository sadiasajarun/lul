# Data Integrity Findings — Database/

> Found while verifying the revamp, 2026-07-17. Each is evidenced against the raw CSVs.
> These are **source-data problems**, not app bugs — they constrain what the dashboard can
> honestly claim, and several need the data owner to resolve.

## 1 · Attendance zeros dominate — the metric measures coverage, not behaviour

| Programme | Rows | Zeros | Nonzero | Coverage | Mean (nonzero) |
|---|---|---|---|---|---|
| ABAL | 55,363 | 16,305 | 39,058 | 70.5% | 86.43% |
| Catchup | 191,556 | **188,662** | 2,894 | **1.5%** | 86.54% |
| Innovation | 3,877 | 3,809 | 68 | 1.8% | 97.02% |

Among learners with a non-zero record every programme sits at **86–97%**. The headline spread
(60.98 / 1.31 / 1.70 in `summary_dataset.json`) is a coverage artifact.

**UNRESOLVED — needs data owner.** Does `0` mean *"no record kept"* or *"genuinely never
attended"*? Not determinable from the data. It changes the honest headline from **86.5%** (zeros =
missing) to **14.5%** (zeros = real non-attendance). Currently recorded as
`zero_meaning: "unknown"` in `Database/aggregates/attendance.json` and captioned in the UI.

Partial evidence for "left the programme": Catchup is 98.3% mainstreamed and 98.5% zeros — those
learners have moved to formal school and would have no NFPE attendance. **But the hypothesis fails
for Innovation** (9.9% mainstreamed vs 98.2% zeros), so it cannot be assumed.

## 2 · Student IDs do not join between profiles and attendance

- `student_profiles_*.csv` → `Student ID` = `="264814181329"` — **Excel formula-escaped**, 12 digits.
- `Student_attendance_*.csv` → `Student ID` = `4010430358` — raw, 10 digits, and in observed rows
  **identical to that row's `Center ID`**.

A join on Student ID matches **zero rows**. Consequence: attendance cannot currently be attributed
to a student, so **per-student risk scoring (A2) is not computable** until the ID spaces are
reconciled. This blocks REVAMP C5's at-risk list.

## 3 · Test/seed data is present in the attendance exports

| Programme | Garbage-ID rows | Example |
|---|---|---|
| ABAL | 184 | `Iure iusto hic rerum test` / `Shay Richardson test mgml` / 100 |
| Catchup | 2,012 | `৪0১0২৩0৫৩0৩` (Bengali numerals in an ID) / `Shadi Akter` / 100 |
| Innovation | 0 | — |

Lorem-ipsum faker rows and names containing "test" carry attendance of exactly 100. Impact on the
mean is small (86.43% with vs 86.43% without) but they should be excluded at source, and their
presence means **these exports are not clean production data**.

## 4 · Verified CORRECT (checked, no action needed)

- **Mainstream counts** — `summary_dataset.json` matches the `Mainstream Status` column exactly:
  ABAL 21,006/55,200 (38.1%), Catchup 188,223/191,555 (98.3%), Innovation 385/3,877 (9.9%).
  The **83.6% overall** headline is real.
- **Divisions** — match the profile CSVs within rounding (Dhaka 108,330 · Chattogram 60,788 ·
  Mymensingh 81,503 · **Rangpur 8** · **Sylhet 3**). Rangpur/Sylhet really are near-empty; the
  figures are not a bug, but any "by division" view must not imply they are comparable samples.
- **Teachers** — 3,397 rows, matching `summary_dataset.json`.
