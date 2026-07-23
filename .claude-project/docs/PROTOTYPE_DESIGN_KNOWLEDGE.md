# Prototype Design Knowledge — OOSC-BD / "Let Us Learn" Admin Dashboard

> Distilled from the clickable prototype and design docs at
> `D:\letuslearn\let-us-learn-backend-stage\prototype\` and `…\docs\` (verified 2026-07-17).
> This prototype is the **design origin** of the current Intelligent Data Dashboard React app —
> same domain, same product vision. Read this before changing the dashboard's IA, scoring,
> AI-ask behaviour, or visual language.

## What it is

A **clickable front-end prototype (v3)** of the revamped admin dashboard for **OOSC-BD /
"Let Us Learn"** — a UNICEF-Bangladesh **Non-Formal Primary Education (NFPE)** programme that gets
out-of-school children into learning centers, tracks them through a curriculum, and "mainstreams"
them into formal school. Fully additive: lives under `prototype/`, touches no app file, opens with
no build step (`prototype/index.html`; Bootstrap 4 + Google Charts + Google Fonts via CDN).

Backed by a Laravel 8 admin/API (`let-us-learn-backend-stage`) whose full reference is in that
repo's `PROJECT_KNOWLEDGE.md`. The prototype markup is kept **Blade-portable** (token-driven
classes paste into `resources/views/admin/dashboard/**`), and `scores.js` is written to transcribe
directly to a PHP nightly cron.

## Product principles (the non-negotiables)

1. **Grounded AI, never free-generated numbers.** The LLM translates intent → query/filters and
   *reports the result*. It must never state a statistic it didn't compute. `insights.js`
   enforces this: `validateNarrative()` extracts every numeral from generated text and asserts each
   exists in the payload; on any unlisted number it **falls back to a safe template**. This is the
   single rule separating a trustworthy copilot from a liability.
2. **Fully bilingual EN / বাংলা** on every string, including Bengali numerals and `bn-BD` voice.
3. **Decision surface, not a data dump.** The Overview is built to answer "what should I do today",
   with big Ask hero + three "Today" cards (Health / May-leave / Need-a-visit) + a proactive
   morning briefing.
4. **Children's PII under a UNICEF programme** — purpose limitation, human-in-the-loop on any
   child-affecting decision, model explainability. Several backend export/cron routes are
   unauthenticated (`/export-students`, `/export-teachers`, `/c/update-*`) — a launch blocker to
   gate before exposing any AI endpoint.

## Information architecture

- **5-tab IA**, URL-addressable (`#overview` …): **Overview** (decision surface), **Students**,
  **Learning**, **Centers & Field**, **Equity** — plus **Reports**, **All Centers**, **Center on Map**.
- **360° read-only pages** reached by clicking any entity/search result (Esc/Back closes):
  **Student 360°**, **Center 360°** (the "money shot" — *"Why this center scores X"* M&E-category
  breakdown), **Teacher 360°** (auto development plan), **PO 360°** (visits done vs allocated),
  **Region 360°** (division rollup).
- Cross-cutting: **Ask bar (C1)**, universal search (C3), saved views (C4, localStorage),
  breadcrumbs (C5), `(i)` help tips, a collapsible **14-dimension filter panel** with an orange
  **Apply** button, and a first-visit spotlight tour.
- **Reports (E1)**: four templates (Weekly / Monthly / Donor / SDG 4) → live self-drafting preview
  grounded in aggregates → EN/BN → PDF / Excel / Word export.

## The scoring engine (`prototype/assets/js/scores.js` — pure functions, PHP-portable)

Three composite scores drive the whole dashboard. **Do not improvise the weights.**

### A1 — Program Health (0–100, weighted composite of driver sub-scores)
`score = round(Σ(driver.score × driver.weight) / Σ weight)`; weakest driver is surfaced.
Bands (3 tiers): **≥80 Healthy** (`#28D094`) · **50–79 Needs Attention** (`#FF9149`) ·
**<50 Critical** (`#FF4961`). (The demo's canonical value is **68 = Needs Attention**.)

### A2 — Dropout / at-risk (0–100)
`score = 0.40·attendanceTrend + 0.25·scoreTrajectory + 0.20·missedCash + 0.15·incomeProxy`
Semantic bands (not domain bands): **≥81 crit · 61–80 high · 31–60 elevated · ≤30 low**.

### A3 — Center visit urgency (0–100)
`score = 0.30·daysSinceVisit + 0.30·attendanceTrend + 0.20·gradeInverted + 0.20·atRiskCount`
Bands: **≥80 crit · 60–79 high · 40–59 elevated · 20–39 normal · <20 healthy**.

The nightly cron is meant to compute A1/A2/A3 per entity; the Laravel scheduler is currently almost
entirely commented out (only `delete:old_activity_logs` runs) and must be enabled.

## The Ask pipeline (`prototype/assets/js/ask.js` — constrained intent)

`matchIntent(question)` maps free text onto the dashboard's existing vocabulary via priority-ordered
regex rules (first/most-specific wins), returning the **same JSON contract a real LLM will produce**:
```
{ metric, dimensions:{division?}, timeframe, comparison:'vs_previous_period', sort, limit, confidence }
```
- Covers **17 metrics / 27 seeded questions** across EN + BN (e.g. `dropout_students`,
  `center_performance`, `center_urgency`, `program_health`, `attendance`, `mainstream_students`,
  `total_teachers/centers/students`, `gender_wise_students`, `disability`, `ethnic`, `religion`,
  `po_visits`, `family_income`, `baseline`, `make_report`). Detects 8 Bangladesh divisions and a
  timeframe from the text.
- `buildAnswer(intent)` → the mandatory **4-block answer**: **number · picture · what-it-means ·
  what-next** (title, big number+label, delta with `goodDirection`, a chart, a grounded narrative,
  and follow-up chips) — bilingual.
- **Graceful refuse:** low confidence (no rule matched) → refuse + suggest in-vocabulary questions.

This `question → intent → answer` pipeline is production-shaped: swap the regex matcher for a real
LLM and the rest is unchanged — exactly the pattern the React app's `openAIHelper.ts` implements.

## Design system (`prototype/assets/css/tokens.css` — live-extracted, do not edit values)

Extracted from the real theme + live computed styles of `v3-stage.rtmedu.org/admin/dashboard_main`.
Where hand-CSS and live differ, **live wins**. Full source: backend `docs/DASHBOARD_DESIGN_SYSTEM.md`.

**Brand / semantic**: primary `#666EE8` (indigo) · success `#28D094` · danger `#FF4961` ·
warning `#FF9149` (**the Filter/Apply button colour**) · info `#1E9FF2`.
**Surfaces**: canvas `#F4F5FA` · card `#FFFFFF` · sidebar `#2C343B` (260px) · body text `#6B6F82` ·
heading `#464855` · deep-indigo emphasis `#3B4781` · table-header `#2B325E` · border `#E3EBF3`.
**Shape**: card radius 6px · input 3.5px · button 4px · card shadow `0 2px 18px 1px rgba(49,53,72,.10)`.
**Fonts**: body **Open Sans** · headings **Quicksand** · Bengali **Almarai / Noto Sans Bengali**.

**DOMAIN BANDS (these carry meaning — never improvise):**
| Band | Colour | Baseline range | MGML cycle |
|------|--------|----------------|-----------|
| Red | `#D70027` | < 40 | Cycle 1 |
| Yellow | `#FED236` | 40–49 | Cycle 2 |
| Green | `#00C19C` | 50–59 | Cycle 3 |
| Pink | `#CC6AC2` | 60–79 | Cycle 4 |
| Blue | `#36A9E2` | ≥ 80 | Cycle 5 |

**Consistency rule:** all charts use **Google Charts** in the prototype/Blade world (not Chart.js /
ApexCharts). *The React app uses Recharts instead — a deliberate stack change; see mapping below.*

## Shared card anatomy ("the Card Law", redesign pass 2)

One card everywhere: `head` (title 18/600 + meta 13/muted + actions with `(i)`), optional `toolbar`,
`body`, full-bleed `insight` footer. Shared sub-components: `.seg` (segmented control), `.score`
badge, `.factor` chip, `.geo` breadcrumb (Division › District › Upazila), grid system
`grid-3 / grid-2 / grid-2-1`. All spacing snapped to **24 / 24 / 56**. Stat tiles (D2) must declare
their `type` (total / rate / delta) and carry comparison context with correct `goodDirection`
colouring — a fix for the live tiles that "mix semantics" (e.g. "Total 606" vs "Active 2").

## Domain model (essentials — full detail in backend PROJECT_KNOWLEDGE.md)

- **Two programmes, one data model**: **MGML/NFPE** (`center_type_id=2`, cycle→unit, 5×9) and
  **PPE** (`=1`, year→unit, 1×12). Almost every subsystem has an MGML and a PPE variant.
- **Geography chain**: Division → District → Upazila → Union (Dhaka city uses thanas; DSCC=492/DNCC=493).
- **Staff hierarchy**: **PD → DC → UC → TO → PO** (self-referencing tree); PO sits directly above
  centers with monthly `*_min_visit` quotas.
- **Center Grade** = avg of ME evaluation marks: **3–4 Good · 2–2.99 Fair · 1–1.99 Poor**. The
  category decomposition (Teaching / Record-keeping / Community / Infrastructure) already exists in
  `me_evaluation_marks` ← `me_evaluation_mark_details` — nothing new to store to answer
  *"why is this center Fair?"*.
- **Mainstreaming** = moving a student to formal school (`education_status`, `student_mainstream_plans`
  with 6-month follow-up). Labels for dropout/mainstream ML already exist (`students.status`:
  Dropout=2, Main Stream=5).
- Staging scale is small (**606 students / 26 centers**) — confirm prod volume before committing to
  ML-heavy features; rule-based + LLM items are the true quick-wins at small scale.

## Prototype → current React app mapping

| Prototype (OOSC-BD)                         | Intelligent Data Dashboard (React)                    |
|---------------------------------------------|-------------------------------------------------------|
| `ask.js` regex intent → 4-block answer      | `src/app/utils/openAIHelper.ts` → `DynamicDashboardResponse` widgets |
| `insights.js` grounded narrative + guardrail | LLM `summary` field (KEEP the grounding discipline)   |
| `scores.js` A1/A2/A3 pure functions          | Not yet ported — candidate for a real analytics layer |
| `mock-data.js` (one swappable object)        | `Database/*.csv` + `summary_dataset.json` via `ragHelper.ts` |
| Google Charts                                | Recharts (deliberate stack swap)                      |
| Bootstrap 4 + `tokens.css`                   | Tailwind CSS 4 + shadcn/ui (re-implement the tokens)  |
| Program names ABAL/Catchup/Innovation        | Same real programme; backend groups as MGML/PPE       |

**When evolving the React dashboard**, reuse the prototype's *thinking*, not its stack: keep the
grounded-narrative guardrail, the 4-block answer shape, the A1/A2/A3 scoring semantics, the domain
band colours, bilingual EN/BN, and the decision-surface IA. Re-express visuals in Tailwind/Recharts.

## Source pointers (in the backend repo)

- `prototype/README.md` — full build log (steps 1–10), findings, Blade-porting notes
- `prototype/assets/js/{scores,ask,insights,mock-data,i18n,voice,tabs,bdmap}.js`
- `prototype/assets/css/{tokens,dashboard-v3}.css`
- `docs/DASHBOARD_DESIGN_SYSTEM.md` — the authoritative design system (live-extracted)
- `docs/AI_OPPORTUNITY_ROADMAP.md` — prioritized AI feature map tied to real tables
- `PROJECT_KNOWLEDGE.md` — full Laravel backend reference (domain, data model, cron, M&E)
- `docs/DASHBOARD_FEASIBILITY_AUDIT.md`, `DASHBOARD_ENHANCEMENTS_ON_EXISTING_DATA.md`,
  `EXTENDED_FEATURES_PHASE_3.md`
