# Predictive Analysis Feature — Plan & Working Handoff

> Plain-language summary of what we decided, how to work with Claude Code on this, the build
> phases, and what to do before going live. Read this first. Companion docs:
> `Downloads/PREDICTIVE_ANALYSIS_HANDOFF.md` (the data findings) and the live-deploy notes.

---

## 1. What this project is (1 line)

An AI analytics dashboard for the NFPE–EMDC education programme in Bangladesh. Users ask questions
in plain language; the app writes SQL over static CSV data (in the browser) and shows charts. It's
live, **team-only behind a login**, on Render. We are now adding a **predictive / risk-analysis** layer.

---

## 2. The two databases (the most important concept)

The app has a **Real / Preview toggle** (top of the screen):

- **Real DB** = the honest data, *with gaps* (e.g. attendance recorded for only ~17% of students,
  status blank for 88%). What you see is true, but incomplete.
- **Preview DB** = the same data with the **blanks filled in by estimates** ("gap-filled"). Looks
  complete, but the filled values are **made up for demonstration — not real**.

When you flip the toggle, the whole app (dashboards AND the AI) switches which dataset it uses.

---

## 3. Decisions we made about predictive analysis

1. **Rule-based, explainable scoring — NOT machine learning.** The data is too sparse for ML; ML would
   just "learn the gaps." Every score is a transparent weighted formula in SQL.
2. **Every prediction shows 4 things, never a bare number:** the score + a **confidence/coverage badge**
   ("based on 30% data") + a **plain-language reason** ("mostly zero attendance + child works") + a
   **suggested action** ("home visit").
3. **Real vs Preview handling (the core rule):**
   - Predictions in **Real mode** = computed on real data → safe to act on, shown with honest coverage.
   - Predictions in **Preview mode** = computed on estimated data → always **watermarked
     "estimated — demonstration only, not for decisions."**
   - The same score view works in both modes automatically (the toggle just swaps the data underneath).
4. **Three feature buckets** (how each feature relates to the two DBs):
   - **Bucket A — both DBs can do it; Preview is more complete.** Real shows an honest partial score;
     Preview shows the fuller score (watermarked). *Needs no database changes.*
     → dropout risk, irregular→dropout, economic pressure, low-support, learning-gap, mainstreaming readiness.
   - **Bucket B — Real is already complete, so Real = Preview.** Built on the always-filled fields
     (enrollment date, date of birth, geography, admitted grade). *Safest.*
     → over-age-for-grade, ghost/inactive student, vulnerability-stacking, first-generation learner,
       center reporting-health, center anomaly, teacher overload, programme comparison.
   - **Bucket C — needs Preview's made-up data (Real can't).** These need info the programme never
     collected (dated attendance, dropout dates). Preview *simulates* it to demo the capability;
     Real mode honestly says "not available — needs this data."
     → attendance decline/trend, seasonality, learning velocity, timing windows.
5. **Extending the Preview DB — only "to some extent," only for Bucket C.** We may add small, realistic
   simulated fields (e.g. a fake dropout date, a monthly attendance series) to Preview to power the
   forecasting demos. We copy the existing pattern (`attendance_monthly`: present in Preview, empty in
   Real). We do **not** fabricate anything we can instead derive from real columns.

---

## 4. What Claude Code can do here

- **Build features from a plain prompt** — write the SQL views, wire the AI catalog, build the UI panel.
- **Everything is additive:** new database views + new catalog entries + a new screen. It does **not**
  change the existing Ask pipeline, dashboards, or data flow.
- **Break-check during development:** after building, it runs `typecheck`, `build`, and `check:catalog`
  to confirm nothing broke. (No heavy QA during development — see the workflow below.)
- **Cannot** magically create data that was never collected — for those, it simulates in Preview only,
  clearly labeled.

---

## 5. How the next person gives a feature or a change

Just describe it in plain words, e.g.:
- "Add a dropout-risk score to the Predictions panel, top 20 highest-risk students, with reasons."
- "Change the risk formula: weight attendance higher than income."
- "Add a center reporting-health score and list the 10 least-reliable centers."

Say **which bucket / mode** if you care ("real mode only", "this is a Preview demo"). Claude will build
it, break-check it, and show you — **nothing is committed or deployed** until you explicitly say so.

---

## 6. The working rules (how development runs)

- **Main branch = the live site.** Pushing to `main` on GitHub auto-deploys to Render. So:
- **Feature work happens on a branch, locally.** Claude does **not** commit or push until told.
- **During development:** Claude builds on prompt and only checks it doesn't break (typecheck/build/
  check:catalog). **No e2e / QA / pipeline commands during development.**
- **QA / e2e is run ONLY at "push to main" time** (the pre-live gate — see §8).
- A safety checkpoint tag **`v1.0-live`** marks the current stable live state — we can always roll back to it.

---

## 7. Step-by-step build phases

Build in this order (each ships as: score + confidence + reason + action):

- **Phase 0 — Foundation:** a coverage/confidence layer (how complete is each field, per mode) that
  every later score reads. Plus a validation check using the real labelled groups (5,332 known dropouts,
  17,693 irregular students).
- **Phase 1 — Bucket B** (safest, Real = Preview): over-age-for-grade, ghost/inactive student,
  vulnerability-stacking, center reporting-health.
- **Phase 2 — Bucket A** (adapts to mode): dropout risk + irregular→dropout escalation (validate that
  real dropouts score higher than active students — a simple check, no ML), then economic / low-support /
  learning-gap.
- **Phase 3 — Bucket C** (Preview demos): extend the Preview DB lightly (simulated dropout date,
  monthly attendance series) → attendance decline/trend, timing windows. Real mode declines gracefully.

Each phase is independent and additive — you can stop or reorder without breaking earlier work.

---

## 8. Before going live (the "push to main" checklist)

When a feature is ready and you tell Claude to push:

1. **Break-check:** `npm run typecheck` · `npm run check:catalog` · `npm run build` — all green.
2. **QA / e2e now** (only at this point): run the QA/e2e checks and fix anything that fails.
3. **Merge the feature branch into `main`** and **push** → Render auto-deploys.
4. **Verify live:** log in (admin), test the feature in both Real and Preview, watch the browser
   console `🛰 AI MONITOR` for the model/tokens, confirm nothing else regressed.
5. **If anything is wrong:** roll back — `git reset --hard v1.0-live` (or Render → Deploys → redeploy
   the last good one).

---

## 9. How the live site works (quick reference)

- **Render Web Service** at `lul-e9es.onrender.com`, **login-protected** (admin email + password).
- Auto-builds from `main`: `npm install && npm run build`, then `npm start` runs `server.mjs`
  (the login gate + compression + serves the built app).
- **The browser does the real work:** it downloads the CSVs and runs the database (DuckDB) locally, and
  calls the AI (Gemini → Gemini backup → OpenAI) directly. Render just serves files behind the login.
- **Free tier:** the site sleeps after ~15 min idle; first visit after that takes ~50s to wake, then fast.
- **AI keys/model** are set as environment variables on Render (Gemini uses `gemini-flash-latest`, not
  `gemini-2.5-flash`, for these keys). Changing them needs a redeploy.

---

## 10. Hard rules (do not break)

- Rule-based + explainable before any ML.
- Every prediction states its data coverage; low-coverage says so.
- Preview-mode predictions are **always** watermarked "estimated — not for decisions."
- Don't fabricate data you can derive from real columns; only simulate genuinely-uncollected fields, in
  Preview, clearly labeled.
- New work is additive; never alter the existing Ask pipeline / dashboards / data flow.
- Nothing reaches `main`/live without the §8 checklist and an explicit go-ahead.
