# Database Schema: intelligent-data-dashboard

## Overview

- **Database**: Static files in `Database/` — no DBMS, no ORM, no migrations.
- Data is consumed two ways:
  1. `Database/summary_dataset.json` is imported directly (bundled) for
     aggregate statistics and the LLM system prompt.
  2. The CSV files are imported as **asset URLs** (`?url`, enabled by
     `assetsInclude: ['**/*.csv']` in `vite.config.ts`) and streamed at runtime by
     `src/app/utils/ragHelper.ts` for keyword retrieval (RAG).

## summary_dataset.json (top-level keys)

| Key | Contents |
|-----|----------|
| `programs` | Per-program (ABAL / Catchup / Innovation): student counts, gender split, avg attendance, mainstreamed count, dropout reasons (Poverty, Family Awareness, Distance, Inattentive, Migration, Working child, Others) |
| `grades` | Enrollment: G1 19,598 · G2 54,280 · G3 60,295 · G4 42,833 · G5 27,631 |
| `divisions` | Dhaka 108,330 · Chattogram 60,788 · Mymensingh 81,503 · Rangpur 8 · Sylhet 3 |
| `nutrition` | Good 205,767 · Not so good 6,421 · Bad 336 |
| `teachers` | Total 3,397 (202 men / 3,194 women); experience & education breakdowns |
| `subject_averages` | Avg exam scores by subject (Bangla, Mathematics, English, Science, BGS, Religion, Life Skills) per program |
| `worst_centers_by_attendance` | Centers with lowest attendance |
| `poor_bangla_students` | Students with low Bangla marks |
| `me_evaluations` | Center evaluation scores (pedagogy, assessments, documentation, learning environment, engagement, overall score) |
| `student_marks_sample` | Sample of individual student marks |

## CSV Datasets

Each dataset exists in three program variants (`abal`, `catchup`, `innovation`)
unless noted. Filenames carry an export timestamp suffix — if files are re-exported,
**update the `?url` imports at the top of `ragHelper.ts`**.

### student_profiles_nfpe_emdc_{program}_*.csv

Columns: `Student ID`, `Center ID`, `Gender`, `Education Start Date`, `Father Name`,
`Father Income`, `Mother Name`, `Mother Income`, `Disability Type`, `Ethnicity`,
`Religion`, `Weight`, `Height`, `Nutrition`, `Vision`, `Cleanliness`,
`Work Type/Occupation`, `Work Duration`, `Student Income`, `Division`, `District`,
`Upazila`, `Union`, `Date Of Birth`, `Father Education`, `Mother Education`,
`Type of Residency`, `Birth Registration`, `Student Education`, …

### Student_attendance_nfpe_emdc_{program}_*.csv

Columns: `Student ID`, `Student Name`, `Center ID`, `Attendance(In Percent)`

### student_assessment_nfpe_cycle_wise_emdc_{program}_*.csv

Columns: `Student ID`, `Center ID`, then per-subject baseline + cycle marks:
`{Subject} BL` and `{Subject} C1..C5` for Bangla, Math(ematics), English, Science,
BGS, Life Skills, Religion.

### me_evaluation_mark_avg_nfpe_emdc_{program}_*.csv

Center-level M&E evaluations. Columns: `Center ID`, `Center Name`, `GPS latitude`,
`GPS longitude`, `Program`, `Sub Program`, `Center Create Date`, `Division`,
`District`, `Upazila`, then category averages (`Pedagogy`, `Assessments`,
`Documentation`, `Learning Environment`, `Community & Family Engagement`) followed
by many per-indicator sub-columns (e.g. "Pedagogy-The teacher prepares and utilises
daily lesson plans").

### teacher_profiles_*.csv (single file, all programs)

Columns: `Center ID`, `Teacher Name`, `Father Name`, `Spouse Name`, `Mothers Name`,
`Division`, `District`, `Upazila`, `Union`, `Gender`, `Date Of Birth`,
`Date Of Joining`, `Religion`, `Marital Status`, `Teacher Education`,
`Teacher Experience`, `Employment Status`

## Entity Relationships (logical)

```
Center (Center ID)
 ├── 1:N Student  (student_profiles / attendance / assessments via Center ID)
 ├── 1:N Teacher  (teacher_profiles via Center ID)
 └── 1:1 M&E Evaluation (me_evaluation_mark_avg via Center ID)

Student (Student ID)
 ├── 1:1 attendance row
 └── 1:1 assessment row (baseline + up to 5 cycles per subject)
```

## Caveats

- The `SCHOOLS` array hardcoded in `src/app/App.tsx` is **fictional demo data**
  (Westbrook Academy etc.) and is unrelated to the `Database/` files.
- CSVs contain **personally identifiable information** (names, parents, GPS,
  income). Treat exports and deployments accordingly; do not commit derived
  copies to public repos.
