# Feature Discussion Context — NFPE/OOSC Dashboard (paste this into a Claude chat)

> **Purpose:** Give a fresh Claude chat the real context to help design predictive-analysis features
> for this project. Read all of it before suggesting anything. The golden rule: **only suggest what
> this data and architecture can actually support** — no generic "add ML" ideas.

---

## 1. What the product is

An **AI analytics dashboard** for the Non-Formal Primary Education (NFPE / OOSC) programme in Bangladesh
(run for/with UNICEF). Users type questions in plain language; the app turns them into SQL, runs the
query, and renders charts + a short answer. It is **live, team-only (behind a login)**, hosted on Render.
We are now adding a **predictive / risk-analysis** layer on top.

### Architecture (this constrains what's feasible)
- **Frontend-only React SPA (Vite).** No application backend / no server-side compute for analytics.
- **The database runs in the browser** (DuckDB-wasm) over **static CSV files**. All queries are SQL over
  a set of **semantic views** (`v_students`, `v_marks`, `v_center_enrollment`, etc.).
- **The AI writes SQL** (Gemini/OpenAI) against those views — it never invents numbers; SQL produces them.
- **So a new analytic = a new SQL view + a catalog entry + (optionally) a UI panel.** No ML service, no
  training pipeline, no server. Anything proposed must be expressible as **rule-based SQL**.
- **Two data modes** via a Real/Preview toggle (see §3).

---

## 2. The data — ground truth (real dataset)

~**250,632 students · 3,397 teachers · ~1,400 centers · 3 programmes** (ABAL, Catchup, Innovation).

**Tables & key columns:**
- **student_profiles:** Student ID, Center ID, Gender, Education Start Date, Father/Mother Name+Income,
  Disability Type, Ethnicity, Religion, Weight, Height, Nutrition, Vision, Work Type/Occupation, Work
  Duration, Student Income, Division/District/Upazila/Union, Date of Birth, Father/Mother Education,
  Residency Type, Birth Registration, Reason for Dropout, Mainstream Status, Mainstream Date,
  Admitted Grade, Follow-up After 6 Months.
- **Student_attendance:** one row per student, a **single lifetime %** — **NO date column**.
- **student_assessment_cycle_wise:** Baseline + Cycle 1–5 for 7 subjects — **no dates on any cycle**.
- **me_evaluation (center level):** GPS, Program, dates + 5 category scores (Pedagogy, Assessments,
  Documentation, Learning Environment, Community/Family Engagement) + ~25 sub-indicators.
- **teacher_profiles:** links to **Center ID only — NOT to individual students**.

**Data-quality facts you MUST respect (already verified):**
- **Status field (`Student Education`) is 88% blank** — filled for only ~30k of 250k. Codes: 1 Active,
  2 Dropout, 3 Irregular, 4 Replaced, 5 Mainstream-code, `-` blank.
- **`Mainstream Status`** is the correct mainstream field (209,614 = 83.6%). Do **not** use status-code 5.
- **Attendance zeros = "not recorded," not "absent."** Recorded mean ≈ 86.5%, but coverage only
  ~17% network (Catchup 1.5%, ABAL 70.5%, Innovation 1.8%). Always report coverage.
- **Assessments sparse (8–64% filled) and dirty:** impossible values exist, and **two scales mixed
  (0–5 and 0–100)** — filter to valid range, never average across scales.
- **Geography sparse:** only Dhaka, Mymensingh, Chattogram have real counts (Rangpur 8, Sylhet 3).
- **100%-complete fields:** Education Start Date, Date of Birth, geography chain, Admitted Grade.
- **Labelled groups for validation:** **5,332 known dropouts** + **17,693 irregular** students.
- Junk exists (Lorem-Ipsum test rows) — filter it.

---

## 3. The two databases (central concept)

- **Real DB** = honest data, **with the gaps above**. True but incomplete.
- **Preview DB** = same data with **blanks filled by estimates** ("gap-filled"). Looks complete, but the
  filled values are **synthetic — for demonstration, not real decisions**.
- A toggle switches the whole app (and the AI) between them.

**Rule for predictions:**
- **Real mode** → scores computed on real data → safe to act on, shown with a **coverage/confidence badge**.
- **Preview mode** → scores computed on estimated data → **always watermarked "estimated — not for decisions."**
- The *same* SQL view serves both modes (the toggle just swaps the underlying data). Only the
  confidence/watermark label differs.

---

## 4. What's buildable — the 3 buckets (use these to place any idea)

- **Bucket A — both DBs can do it; Preview is fuller.** Real = honest partial score; Preview = fuller,
  watermarked. *No DB changes needed.* → dropout risk, irregular→dropout escalation, economic-pressure,
  low-support, learning-gap, mainstreaming readiness, high-potential/retention.
- **Bucket B — Real already complete, so Real = Preview** (built on 100%-complete fields). *Safest.*
  → over-age-for-grade, ghost/inactive student (days enrolled with no activity), vulnerability-stacking,
  first-generation-learner, center reporting-health, center performance anomaly, teacher-overload,
  programme comparison, at-risk group concentration.
- **Bucket C — needs Preview's simulated data (Real can't).** Requires fields never collected. Preview
  *simulates* them to demo the capability; Real mode says "not available — needs this data."
  → attendance decline/trend, seasonality, learning velocity, dropout timing windows.

**Presentation contract (all predictions):** score **+** confidence/coverage badge **+** plain-language
driver **+** suggested action. **Never a bare number.**

---

## 5. What CANNOT be built yet (and why)

The data is a **single snapshot with no time series**:
- No dated attendance (one lifetime %), no assessment dates, no dropout date, no event/history log.
- 88% of status labels blank; teacher↔student link missing; no distance/sibling/intervention data.

So today you can build **"who is at risk RIGHT NOW"** (rule-based classification of current risk) — you
**cannot** build **"what will happen and when"** (true forecasting) until new data is collected. The six
additions that would unlock real forecasting (priority order): **1) dated attendance, 2) dropout date,
3) status for all students, 4) dated assessments, 5) intervention log, 6) distance + sibling link.**
(#1 and #2 alone move it from risk-scoring to forecasting.)

---

## 6. Decisions already made (don't relitigate)

1. **Rule-based, explainable scoring — NOT machine learning.** Sparse data + ML = overfitting to
   missingness. Every score is a transparent weighted SQL formula.
2. **Coverage/confidence on every score**; low-coverage says so.
3. **Real = decisions; Preview = demo (watermarked).**
4. **Validate with real labels:** dropouts (5,332) should score higher than actives — a simple
   statistical check, no ML.
5. **Extend the Preview DB only "to some extent," only for Bucket C** — small, realistic simulated fields
   (e.g. a fake dropout date, a monthly attendance series), following the existing `attendance_monthly`
   pattern (present in Preview, empty in Real). Never fabricate what can be derived from real columns.
6. **All work is additive** — new views + catalog + a panel; never change the existing Ask pipeline,
   dashboards, or data flow.

---

## 7. How to propose a feature (so suggestions are grounded)

For any idea, state:
1. **Which bucket** (A / B / C) and **why**.
2. **Which real columns** it uses, and their **coverage** (from §2) — flag if sparse.
3. **The rule/formula** in plain terms (it must be expressible as SQL).
4. **How it validates** (against the 5,332 dropouts / 17,693 irregular, or a sanity check).
5. **Real-mode behavior** (coverage badge / partial) vs **Preview-mode behavior** (fuller / watermark).
6. **The action** it suggests to a user.

**Do NOT suggest:** ML/training; features that need uncollected data presented as if real; averaging
across the mixed assessment scales; treating attendance 0 as "absent"; using status-code 5 for
mainstreaming; anything that rewrites the existing query pipeline.

---

## 8. Recommended build order

**Phase 0** coverage/confidence layer + validation harness → **Phase 1** Bucket B (safest) →
**Phase 2** Bucket A (mode-adaptive, validated) → **Phase 3** Bucket C (Preview demos + light DB extension).
Each phase is independent and additive.

---

## 9. One-paragraph honest framing (for UNICEF / stakeholders)

"Today the dashboard can tell you **who is at risk right now**, using real fields where they exist and
saying clearly how complete each signal is. It **cannot yet forecast what will happen and when** — that
needs dated attendance and dropout dates, which the programme already collects but currently stores as a
single number. Preview mode shows what the full forecasting picture would look like once that data is
captured."
