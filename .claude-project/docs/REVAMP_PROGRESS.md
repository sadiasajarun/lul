# Revamp Progress — REACT_DASHBOARD_REVAMP_PROMPT.md

> Verified 2026-07-17. Build order steps **1, 2, 3, 4 complete** — the prompt's designated
> "stop and show" checkpoint. Steps 5-7 (4-block answer, rebuilt views, bilingual, org pass)
> not yet started.

## Done

| Step | What | Status |
|---|---|---|
| **1 · Phase A** | Delete every lie | ✅ |
| **2 · B1** | Attendance fix + coverage rule | ✅ |
| **3 · PART 5** | Aggregation layer | ✅ |
| **4 · C1-C2** | Tokens + Card Law + Overview refactor | ✅ |
| *(bonus)* **C3** | Grounded-narrative guardrail + widget validation | ✅ |

### Phase A — removed
`SCHOOLS` array (10 invented US schools) and the views rendering it: `top-performers`, `risk`,
`critical`, `students`, `trends`, `operations`, `sections`, `teachers`, `health`, `comparison`,
`scatter`; the scripted `generateAIResponse()`/`classifyPrompt()` chat path; the hardcoded
"DISTRICT HEALTH 76% +0.8 YoY" sidebar widget; the "All Schools" fake sidebar list.

`ViewMode` is now `overview | ai-dashboard | chat`. **Zero fictional numbers remain in `src/`.**

### B1 — the attendance finding

The investigation the prompt asked for found the metric was worse than assumed. Three candidates:

| Number | Meaning | Verdict |
|---|---|---|
| **21.3%** | unweighted mean of 3 programme rates (old tile) | describes nothing |
| **14.5%** | student-weighted, zeros included | still a coverage artifact |
| **86.5%** | mean among learners **with a record** (coverage 16.8%) | ✅ shipped, with caption |

Evidence (`npm run aggregate`):

| Programme | Rows | Zeros | Recorded | Coverage | Recorded mean |
|---|---|---|---|---|---|
| ABAL | 55,363 | 16,305 | 39,058 | 70.5% | 86.43% |
| Catchup | 191,556 | **188,662** | 2,894 | **1.5%** | 86.54% |
| Innovation | 3,877 | 3,809 | 68 | 1.8% | 97.02% |

**Among learners with a record, every programme sits at 86-97%.** The programme spread measured
*record coverage*, not attendance behaviour. The tile now reads "Attendance (recorded) 86.5%" with
a mandatory coverage caption, and the card's bars plot coverage — the thing that actually differs.

> **UNRESOLVED — needs the data owner.** Whether a `0` means "no record kept" or "genuinely never
> attended" is not determinable from this dataset. Recorded as `zero_meaning: "unknown"` in
> `attendance.json`. If 0 truly means non-attendance, the honest headline is ~14.5%, not 86.5%.

### Step 3 — aggregation layer
`scripts/aggregate.mjs` (`npm run aggregate`) reads the CSVs once → `Database/aggregates/`:
`by_program`, `by_division`, `by_subject`, `attendance`, `demographics`, `teachers`.
**~105 MB of CSVs → 24 kB of JSON, in 10s.** Views read only these (`src/app/lib/aggregates.ts`).
PII rule honoured: counts and means only — no names, income, or GPS.

### Step 4 + C3 — design + guardrail
- `src/styles/theme.css`: prototype tokens verbatim (`--oo-*`, `--band-*`, 24/24/56 spacing, grid system).
- `fonts.css`: Quicksand / Open Sans / Noto Sans Bengali.
- `DashCard` (Card Law: head/toolbar/body/insight, mandatory `(i)`), `SectionHead`, `StatTile`
  (mandatory `type` badge + `goodDirection` colouring + coverage caption).
- `utils/insights.ts`: `validateNarrative()` — a narrative may only contain numerals present in its
  payload. Applied to the AI summary and every Overview insight. Rejected text is replaced and the
  UI says so. Widget **shape** validated too; malformed widgets render a visible error card.
- Chart palette swapped from `#8b5cf6…` to the prototype categorical sequence.

Guardrail verified 6/6, including rejecting a subtly-wrong `55,201` against a payload of `55,200`.

## Verification
- `npm run typecheck` → **passes** (new `tsconfig.json`, `strict: true`)
- `npm run build` → **passes** (2,206 modules)
- Dev server hot-reloads clean, no console errors

## Not done (steps 5-7)
4-block answer ordering + graceful refuse (C4); rebuilt Students/Learning/Teachers/Comparison
views + A2 risk scoring (C5); bilingual EN/BN (C6); full `App.tsx` organization pass (PART 4);
`FUTURE_METRICS.md`. The ~105 MB of CSVs still ship in `dist/` — the RAG path needs them; the
launch blockers (server proxy for keys, PII in `dist/`) remain open per PART 5.4.
