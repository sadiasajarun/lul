# AI Copilot — How to Use & Test

_Last updated: 2026-07-31_

The copilot is a **text-to-SQL analyst**, not a keyword matcher. You ask a question in plain
English → an LLM (Gemini) writes a SQL query against a **semantic layer of views** → the query is
safety-checked, run in-browser on the real 250k-row dataset (DuckDB-wasm) → the result is rendered as
widgets. Every number shown comes straight from a SQL result — nothing is model-invented.

---

## 1. Running it

```bash
npm run dev            # http://localhost:5173
```

Requires AI keys in `.env` (git-ignored):

```
VITE_GEMINI_API_KEY="…"        # primary key
VITE_GEMINI_API_KEY_2="…"      # second key — round-robin + failover
VITE_GEMINI_MODEL=gemini-flash-latest
VITE_OPENAI_API_KEY=           # optional last-resort fallback (empty = off)
```

**Two Gemini keys** alternate per request (≈2× the free-tier throughput) and fail over for each other
on a rate-limit (429). If both are cooling down and an OpenAI key is set, it takes over. After editing
`.env`, **restart `npm run dev`** (Vite reads env at boot).

---

## 2. Real vs Preview (the navbar switch)

The top-navbar **Real ⇄ Preview** toggle flips the *entire* app — dashboards **and** the copilot.

| | **Real** | **Preview** |
|---|---|---|
| Data | The actual records, gaps and all | Real records **kept unchanged**, only blanks filled |
| Use for | The source of truth, honest reporting | Demos, "what the dashboards look like when full" |
| Attendance | ~83% blank (0 = not recorded) | Filled from real distributions (~87% avg) |
| Marks | ~30% coverage | Every student × subject has a mark |
| Monthly attendance | Not available (no monthly data) | 12-month trend (estimated) |
| Banner | none | ⚠️ "Preview — estimated, not for decisions" |

**Golden rule of Preview:** any value that *exists* in Real is **identical** in Preview — only genuine
blanks get imputed. So real metrics (poverty dropouts = 64,133, mainstreamed = 209,606, teacher counts)
match exactly in both modes. Preview is a demo aid — never a decision source or external report.

---

## 3. Using the copilot

- **Ask anything** in the chat box: _"How many girls are in Catchup in Dhaka?"_, _"Which centres need
  support?"_, _"Average Bangla score in ABAL"_.
- **Follow-ups work** — it keeps recent turns, so _"what's that student's name?"_ or _"now break it
  down by division"_ resolves against the previous answer.
- **Quick-analysis chips** run canned questions.
- **It refuses honestly.** If the data can't support a question (e.g. a breakdown the columns don't
  have), it says so and suggests answerable alternatives instead of fabricating a chart.

### What it can answer well
Counts, gender %, income bands, enrollment by year, dropout drivers, per-subject/programme/division
marks, student-teacher ratios, centre size & M&E, attendance (with honest coverage caveats), and — in
**Preview** — attendance **month by month**.

### Known data caveats (the copilot states these itself)
- Attendance `0` = a month not recorded (~83% in Real) — shown transparently, never hidden.
- Income is banded/approximate; "15000+" stored as 15000.
- Assessment coverage ~30% in Real; subject averages are over graded students only.
- Teacher division may not align with student division — ratios interpreted with care.

---

## 4. Testing

### A. Automated — free, no LLM tokens (run this first)

```bash
npm run e2e
```

Exercises the copilot's backbone — **validate → execute → interpret** — against **both** datasets, plus
the cross-mode invariants. Expect **26 passed, 0 failed**. It checks:
- Tables load + semantic views build (real + tuned)
- 6 query shapes (count, group, trend, ratio, list, aggregate) each produce rows + a widget
- The safety gate blocks bad SQL (DROP, non-whitelisted table, multi-statement)
- Invariants: student count & poverty dropouts **identical** across modes; attendance & marks **fuller**
  in tuned; monthly trend has 12 months in Preview and is **empty in Real** (no fabrication)

Exit code is non-zero on any failure → CI-ready.

```bash
npm run e2e -- --live   # optional: +1 real Gemini question per mode (spends 2 calls)
```

### B. Automated — live accuracy (spends LLM tokens)

```bash
npm run eval            # Gemini writes SQL live for 12 known questions; scores accuracy
npm run verify:sql      # runs the semantic views directly (no LLM) — sanity of the SQL layer
```

### C. Manual — in the browser

Switch to **Preview**, ask each, then flip to **Real** and re-ask group 2 to confirm they're identical.

**1) Gap-fills — should be FULL in Preview, thin in Real**
- "What's the average attendance by division?"
- "Show attendance month by month" ← Preview only; Real says no monthly data
- "Average marks by subject"

**2) Invariants — must be IDENTICAL in both modes**
- "How many students dropped out due to poverty?" → **64,133** both
- "How many students were mainstreamed?" → **209,606** both
- "Total number of students?" → **250,617** both
- "How many teachers per division?" → same both

**3) Follow-up + named record**
- "List ABAL students weak in Bangla" → then "what's the first student's name?"
- "Show attendance and marks for student Mabiya"

**What good looks like:** group 1 rich in Preview / thin in Real; group 2 returns the **same numbers**
in both. If any group-2 answer differs between modes, a real value is being altered — report it.

---

## 5. Debugging (browser console)

```js
showSystemPrompt()   // prints the exact system prompt sent to the model
aiDebug(true)        // turn on [AI] stage logs (aiDebug(false) to silence)
```

With `aiDebug` on, each answer logs the provider that served it (`gemini` / `gemini-2` / `openai`), the
SQL written, token cost, and total time. Alternating `gemini` / `gemini-2` confirms round-robin.

---

## 6. Regenerating data

```bash
npm run build:data          # rebuild Real cleaned tables from the raw CSVs
npm run build:data:tuned    # rebuild the Preview (gap-filled) dataset
```

Both `public/data/` and `public/data-tuned/` hold **real PII** (names, income, GPS) and are
git-ignored — never commit or publish them. Preview is regenerated deterministically from Real, so it's
always reproducible.

---

## 7. How the pieces fit (map)

| Concern | File |
|---|---|
| Semantic views (the query surface) | `src/app/lib/db/semantic.sql` |
| Catalog shown to the model | `src/app/lib/db/catalog.ts` |
| Few-shot SQL examples | `src/app/lib/ai/fewshot.ts` |
| SQL safety gate (whitelist, SELECT-only) | `src/app/lib/ai/validate.ts` |
| Pipeline (prompt → SQL → run → interpret) | `src/app/lib/ai/pipeline.ts` |
| Provider round-robin + failover | `src/app/lib/ai/resilient.ts` |
| In-browser engine + Real/Preview loader | `src/app/lib/db/duckdb-source.ts` |
| Preview data builder | `scripts/build-tuned-data.mjs` |
| Tests | `scripts/e2e-copilot.mjs`, `scripts/eval.mjs` |
