# Database Architecture — NFPE/EMDC dataset

> The complete map of `Database/`: what each table is, how they relate, the flow, and the logic.
> Verified against the raw files 2026-07-19. Companion: [RAG_SYSTEM.md](RAG_SYSTEM.md) (how the AI
> reads this cheaply), [DATA_INTEGRITY_FINDINGS.md](DATA_INTEGRITY_FINDINGS.md) (the caveats).

## The domain in one paragraph

A Non-Formal Primary Education (NFPE) programme in Bangladesh gets out-of-school children into
**learning centres**, tracks them through a curriculum (baseline → 5 cycles), records **attendance**
and **assessments**, has field staff run **M&E centre evaluations**, and ultimately **mainstreams**
children into formal school. Three programme variants run on one data model: **ABAL** (55,200),
**Catchup** (191,555), **Innovation** (3,877) — **250,632 learners, 3,397 teachers**.

## The five tables (grain + key)

| Table | Grain | Key | Cols | What it holds |
|---|---|---|---|---|
| `student_profiles_*` | one row per **learner** | `Student ID` (12-digit, Excel-escaped `="…"`) | 34 | demographics, family, health, `Mainstream Status`, `Reason for Dropout`, geography, `Center ID` |
| `student_assessment_*` | one row per **learner** | `Student ID` (12-digit, clean) | 44 | `<Subject> BL` baseline + `<Subject> C1..C5` cycle marks, 7 subjects |
| `student_attendance_*` | one row per **learner** | `Student ID` (**different key space**) | 4 | `Attendance(In Percent)` |
| `me_evaluation_*` | one row per **centre visit** | `Center ID` | 36 | 5 category scores (Pedagogy, Assessments, Documentation, Learning Environment, Community & Family Engagement) + 21 indicator sub-scores, GPS, geography |
| `teacher_profiles` | one row per **teacher** | `Center ID` | 17 | education, experience, employment, geography |

Each of the first four exists in **three programme files** (abal/catchup/innovation); teachers is one file.
`summary_dataset.json` is a pre-baked rollup (programmes, grades, divisions, nutrition, teachers,
`me_evaluations` ×2800, `subject_averages`, `worst_centers_by_attendance`, `poor_bangla_students`).

## The flow (a learner's lifecycle)

```
enrol ─► student_profiles (demographics, baseline captured)
   │
   ├─► student_assessment   baseline BL ─► Cycle 1 ─► … ─► Cycle 5   (progress)
   ├─► student_attendance   monthly attendance %
   │
   simultaneously, the learner's CENTRE is:
   ├─► me_evaluation        scored by field staff (quality grade of 4)
   └─► teacher_profiles     staffed by teacher(s)
   │
   ▼
outcome ─► Mainstream Status = "Mainstreamed"  (the north-star goal)
        └─ or  Reason for Dropout recorded     (the failure to prevent)
```

## The relation graph (measured, not assumed)

```
                 Student ID (strip ="…")            ~99.6%
   student_profiles ─────────────────────────────► student_assessment   [1:1 STRONG]

   Student ID[0:9] ≈ Center ID  (~85%)  — Student ID embeds its centre

                 Center ID                          ~64%
   student_profiles ─────────────────────────────► me_evaluation        [N:1 PARTIAL]
                 Center ID                          ~50%
   student_profiles ─────────────────────────────► teacher_profiles     [N:1 PARTIAL]

   student_attendance  ✗  different key space + test rows  ✗  BROKEN — cannot join to a learner
```

**Consequences for analysis:**
- Learner ⇄ assessment questions are safe (strong join).
- Learner ⇄ centre-quality / teacher questions are **partial** — always report coverage.
- **Per-student attendance and risk scoring (A2) are NOT computable** until the attendance key is
  reconciled. Attendance can only be analysed at the aggregate/coverage level.

## The logic (business rules encoded in the data)

| Concept | Rule |
|---|---|
| **Mainstreaming** | `Mainstream Status = "Mainstreamed"` = child moved to formal school. The programme's success metric. Overall **83.6%**. |
| **Dropout** | `Reason for Dropout` ∈ {Poverty, Family Awareness, Distance, Inattentive, Migration, Working child, Others}. Poverty dominates every programme (~51–57%). |
| **Centre grade** | mean of M&E category scores, of 4. Bands (from the source system): **3–4 Good · 2–2.99 Fair · 1–1.99 Poor**. |
| **Baseline bands** | assessment score bands: `<40` Red · `40–49` Yellow · `50–59` Green · `60–79` Pink · `≥80` Blue (also MGML cycle colours). |
| **Attendance** | recorded 0–100%. **But 0-rows dominate** — the field measures *coverage*, not behaviour (see integrity findings). |
| **Geography** | Division → District → Upazila → Union. Enrolment concentrates in Dhaka (43%); Rangpur (8) and Sylhet (3) are near-empty. |

## Derived aggregates (the analysis layer)

`scripts/aggregate.mjs` (`npm run aggregate`) reads the CSVs once → `Database/aggregates/`:
`by_program`, `by_division`, `by_subject`, `attendance`, `demographics`, `teachers` — **~105 MB → 24 kB**.
`scripts/build-knowledge-base.mjs` (`npm run kb`) distils those into `Database/kb/` (facts, metrics,
schema, manifest) — the retrieval layer the AI reads. See [RAG_SYSTEM.md](RAG_SYSTEM.md).

## Known data-quality constraints (must caption, not hide)

1. **Attendance coverage 16.8%** network-wide; `0` means unknown (no record vs never attended).
2. **Assessment cycle marks barely recorded** — baseline ~64% coverage, Cycle-1 ~5% — so subject
   averages reflect the baseline, not progress.
3. **Attendance Student IDs don't join** to profiles/assessment.
4. **Test/seed rows** present in attendance exports (~184 ABAL, ~2,012 Catchup faker rows).
5. **Small divisions** (Rangpur 8, Sylhet 3) are not comparable samples.

Full detail + evidence: [DATA_INTEGRITY_FINDINGS.md](DATA_INTEGRITY_FINDINGS.md).
