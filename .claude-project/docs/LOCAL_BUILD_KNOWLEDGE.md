# Intelligent Data Dashboard — As-Built Knowledge (Local)

> **What is actually built and running locally**, verified by inspection + a real production build
> on **2026-07-17**. This is the "as-built" record — it documents reality, including the gaps.
> Companions: [PROJECT_KNOWLEDGE.md](PROJECT_KNOWLEDGE.md) (orientation),
> [PROTOTYPE_DESIGN_KNOWLEDGE.md](PROTOTYPE_DESIGN_KNOWLEDGE.md) (the design origin),
> [PROJECT_DATABASE.md](PROJECT_DATABASE.md) (dataset schemas).

---

## 1 · Status at a glance

| Check | Result |
|---|---|
| Dev server | ✅ Running — **http://localhost:5174/** (5173 occupied by another app) |
| Production build | ✅ Succeeds — **2,234 modules**, no errors, ~12s |
| AI ask → dashboard | ✅ Works on all 3 providers |
| Works with **no API key** | ✅ Yes — local engine fallback |
| Real NFPE data used | ✅ **Overview** (`summary_dataset.json`) + **AI-ask** (RAG over CSVs) |
| Remaining 9 views | ⚠️ Render **fictional** `SCHOOLS` demo data |
| Type checking | ❌ None (no `tsconfig.json`) |
| Tests | ❌ None |
| Production-ready | ❌ No (keys in browser, 59 MB CSV shipped) |

**Verdict:** a working, demo-ready prototype. The AI pipeline genuinely functions end-to-end
(including offline). It is not a finished product and not deployable as-is.

---

## 2 · How to run

```bash
npm install     # required if 'vite' is not recognized (node_modules can be stale)
npm run dev     # Vite dev server → http://localhost:5173, falls back to 5174+
npm run build   # production build → dist/
```

No env vars. AI keys are entered at runtime in the in-app **Settings** modal and stored in
`localStorage`. Only two npm scripts exist: `dev` and `build` (no lint/test/typecheck).

---

## 3 · Stack (as built)

| Layer | What |
|---|---|
| Framework | React **18.3** + TypeScript, **Vite 6.3.5** |
| Entry | `index.html` → `src/main.tsx` → `createRoot(...).render(<App />)` |
| Styling | **Tailwind CSS 4** via `@tailwindcss/vite`; `src/styles/index.css` imports `fonts.css` + `tailwind.css` + `theme.css` |
| UI kit | **shadcn/ui** (Radix primitives) — 45 files in `src/app/components/ui/` |
| Charts | **Recharts 2.15** (Bar, Line, Area, Pie, Radar, Scatter) |
| Icons | lucide-react |
| Backend | **None** — pure client-side SPA |
| Data | Static `Database/` — 13 CSVs + `summary_dataset.json` |

Installed but **unused** in app code: MUI, react-router, react-dnd, react-slick, embla-carousel,
motion, react-hook-form, sonner, vaul, canvas-confetti, etc. (Figma Make ships a fat dependency list.)

### Vite specifics (`vite.config.ts`)
- Alias **`@` → `./src`**
- Custom **`figma:asset/*` → `src/assets/`** plugin — *currently unused; `src/assets/` doesn't exist*
- `assetsInclude: ['**/*.svg', '**/*.csv']` — enables `?url` CSV imports. **Never add `.css`/`.ts`/`.tsx`**
- React + Tailwind plugins are both required by Figma Make — do not remove

---

## 4 · File map

```
src/
├── main.tsx                     # entry (3 lines)
├── app/
│   ├── App.tsx                  # 2,375 lines — EVERYTHING: all views, demo data, app shell
│   ├── components/
│   │   ├── ui/                  # 45 shadcn primitives (generated — don't hand-edit)
│   │   └── figma/ImageWithFallback.tsx
│   └── utils/
│       ├── openAIHelper.ts      # 1,038 lines — provider dispatch + local engine
│       └── ragHelper.ts         #   307 lines — streaming CSV retrieval
└── styles/                      # fonts / tailwind / theme / globals / index
Database/                        # 13 CSVs + summary_dataset.json
```

---

## 5 · The data + AI flow (the core of the app)

```
user prompt
   → handleSubmit()                        [App.tsx ~1807]
   → queryDashboardData(prompt, provider, key)   [openAIHelper.ts:897]
       → performRagRetrieval(prompt)             [ragHelper.ts:206]
           → keyword + ID extraction → parallel streaming CSV search → markdown tables
       → provider branch:
           • gemini → gemini-2.5-flash:generateContent (enforced responseSchema)
           • openai → /v1/chat/completions, gpt-4o-mini, temp 0.2 (strips ``` fences)
           • local / no key → queryLocalDatabase(prompt, ragContext)
           • ANY provider error → falls back to queryLocalDatabase
   → DynamicDashboardResponse { summary, widgets[] }
   → setAiResponse() + push summary into chat + setActiveMode("ai-dashboard")
   → AIDashboardView renders widgets                [App.tsx:483]
```

**Every submitted prompt lands on the `ai-dashboard` view.** The 5-colour widget palette is
`#8b5cf6, #3b82f6, #10b981, #ef4444, #f59e0b`.

### The contract (`DynamicDashboardResponse`)
```ts
{ summary: string,              // markdown bullets (3-4 key insights)
  widgets: DashboardWidget[] }  // type: chart|metrics|table|text
                                // chartType: bar|line|area|pie|radar|scatter
                                // width: full|half|third
                                // + xAxisKey, seriesKeys, metricsList, tableHeaders, data, content
```
Gemini enforces this via `responseSchema`; OpenAI is instructed by prompt + fence-stripping.

### RAG scoping (`ragHelper.ts`)
Smarter than a blind scan — it classifies the query and only fetches relevant files:
- **Flags:** `isTeacherQuery`, `isAssessmentQuery`, `isAttendanceQuery`, `isEvaluationQuery`
- **Program filter:** `abal` / `catchup` / `innovation` mentioned → only that program; otherwise
  ABAL + Catchup + Innovation profiles all fetched
- Extracts long numbers (`\b\d{5,15}\b`) as Student/Center IDs
- Streams via `ReadableStream`, **caps at 15 rows/file**, cancels the reader early
- **Sample fallback:** zero matches on an assessment/teacher query → `getCsvSample()` returns first 10 rows
- Output: markdown tables prefixed `### RETRIEVED DATABASE RECORDS (RAG CONTEXT)`

### The local engine (`queryLocalDatabase`, openAIHelper.ts:160)
**Not a stub.** With no API key it: parses the RAG markdown tables, applies a **subject filter**
(Bangla / Mathematics / English / Science / BGS / Life Skills / Religion), keeps identity columns,
slices 15 rows, computes **per-column numeric averages**, and emits metrics + table + chart widgets.
~39 keyword branches. This is why the app is usable offline.

---

## 6 · What's on screen

`ViewMode` (App.tsx:267) — **14 modes**, switched by nav buttons (App.tsx:1907):

Branded **"EduIntel — AI Data Dashboard"** (App.tsx:1888). Left sidebar = Navigation + 10 Quick
Prompts (`PROMPTS`, App.tsx:255). Header shows scope chips (3 Programs · 250,632 Students ·
3,397 Teachers) and a **provider badge** that reads **"Local RAG (Key Missing)"** when no key is
set (App.tsx:1999). Right rail = Conversation; bottom = prompt bar + "Analyze".

**Data source audit** (verified per-view, not assumed):

| Mode | Component | Data source |
|---|---|---|
| `overview` | `OverviewView` | ✅ **Real** — `db` = `summary_dataset.json` |
| `ai-dashboard` | `AIDashboardView` | ✅ **Real** — LLM/local over `Database/` |
| `top-performers` | `TopPerformersView` | ⚠️ fictional `SCHOOLS` |
| `risk` / `critical` | `RiskView` | ⚠️ fictional |
| `students` | `StudentsView` | ⚠️ fictional |
| `trends` | `TrendsView` | ⚠️ fictional |
| `operations` | `OperationsView` | ⚠️ fictional |
| `sections` | `SectionsView` | ⚠️ fictional |
| `teachers` | `TeachersView` | ⚠️ fictional |
| `health` | `HealthView` | ⚠️ fictional |
| `comparison` | `ComparisonView` | ⚠️ fictional (A/B school picker) |
| `chat` | `ChatView` | renders `messages`; scripted `generateAIResponse()` uses `SCHOOLS` |
| `scatter` | (attendance vs pass rate) | ⚠️ fictional |

Plus a **Settings modal** (provider radio + Gemini/OpenAI key fields).

### What `OverviewView` actually computes (App.tsx:783)
Pure real data from `db`: `totalStudents` = ABAL+Catchup+Innovation students (**250,632**);
`mainstreamRate` = mainstreamed/total (**83.6%**); `totalTeachers` = `db.teachers.total` (**3,397**);
`avgAttendance` = mean of the 3 programs' `avg_attendance` (**21.3%**); Enrollment-by-Program bar
(students vs mainstreamed) and Enrollment-by-Division list sorted desc (Dhaka 108,330 → Sylhet 3).

> ⚠️ **`avgAttendance` is a naive unweighted mean** of the three programme rates
> (60.98 + 1.31 + 1.70)/3 = 21.3% — it ignores the 50× difference in programme size. A
> student-weighted mean would read far lower. The tile says "Avg Attendance / Across programs",
> which reads as a network rate. **Treat 21.3% as suspect** and confirm the intended definition.

### ⚠️ The two-data-worlds problem
`App.tsx` hardcodes a **`SCHOOLS` array of 10 fictional US-style schools** ("Westbrook Academy",
"Greenfield High", districts North/East/West…) with invented passRate/attendance/cafeteria data.
**9 of the 14 modes render this fake data**, sitting behind the same nav as the two real views —
so a user moving from Overview (real Bangladesh NFPE) to Academic Rankings (fake US schools) gets
no signal that the data universe changed. **This is the single biggest gap.**

### App state (all `useState` — no Redux/router)
`prompt`, `activeMode`, `apiProvider`, `geminiApiKey`, `openaiApiKey`, `selectedProvider`,
`temp*Key`, `isSettingsOpen`, `aiResponse`, `messages` (seeded greeting), `isThinking`,
`queryLabel`, `compSchoolA/B`. localStorage keys: `api_provider`, `gemini_api_key`, `openai_api_key`.

---

## 7 · Verified build output

`npm run build` → `dist/` — succeeds, but ships the entire `Database/` as assets:

| Asset | Size |
|---|---|
| `student_profiles_..._catchup_*.csv` | **59.4 MB** |
| `student_assessment_..._catchup_*.csv` | 21.0 MB |
| `student_profiles_..._abal_*.csv` | 16.5 MB |
| `Student_attendance_..._catchup_*.csv` | 7.4 MB |
| `student_assessment_..._abal_*.csv` | 6.4 MB |
| …8 more CSVs | 0.07–2.3 MB |
| `index-*.js` | 1.37 MB (gzip 255 kB) — single chunk |
| `index-*.css` | 109 kB (gzip 17.5 kB) |

Build warns: chunks > 500 kB; no code-splitting configured.

---

## 8 · Known gaps (prioritized)

1. **9 of 14 modes run on fictional `SCHOOLS` data** — Overview and AI-ask are real; the rest
   (Rankings, Risk, Students, Trends, Operations, Sections, Teachers, Health, Comparison) are not
   wired to `Database/`, with no on-screen signal that the data universe changed. *(highest value to fix)*
1b. **`OverviewView.avgAttendance` is an unweighted mean** across programmes of wildly different
   size (55k / 191k / 3.8k) → the headline **21.3%** is statistically misleading. Verify the intent.
2. **~105 MB of CSVs shipped to the browser.** A generic query fetches ABAL + Catchup + Innovation
   profiles; streaming stops at 15 matches, but **a non-matching term reads the whole file**.
   Fine on localhost, unworkable hosted. Needs a backend/index/pre-aggregation.
3. **API keys in the browser** — Gemini's key travels in the **URL query string**; both keys sit in
   `localStorage`. Needs a server proxy before any real deployment.
4. **No `tsconfig.json`** → types are stripped by esbuild but **never checked**; no typecheck script.
   `any` used freely (e.g. `data?: any[]`).
5. **No tests** — no runner, no Playwright, no CI.
6. **No grounded-narrative guardrail.** The prototype's `validateNarrative()` (every numeral must
   exist in the payload, else fall back to a template) was **not ported**. This app renders whatever
   numbers the LLM returns — the exact failure mode the design docs called a "liability".
7. **Not ported from the prototype:** bilingual EN/বাংলা, A1/A2/A3 scoring engine, 360° entity
   pages, voice input, report export (PDF/Excel/Word), domain band colours.
8. **LLM output trusted structurally** — `JSON.parse` guarded by try/catch, but widget shape isn't
   validated before render; chart guards only check `data/xAxisKey/seriesKeys` presence.
9. **2 high-severity npm vulnerabilities** reported at install; not triaged.
10. **Dead config:** `figma:asset` resolver with no `src/assets/`; ~20 unused dependencies.

---

## 9 · Conventions (do not "fix" these)

This is a **Figma Make export**, *not* a `/fullstack`-pipeline project. The `.claude/` template
mandates (React Router 7 framework mode, `app/` dir, `~/` alias, `root.tsx`, Redux, NestJS) **do not
apply**. Reality: `src/`, `@/` alias, `main.tsx`, no router, plain `useState`, no backend.

- New dataset → drop in `Database/`, add a `?url` import in `ragHelper.ts`, document in `PROJECT_DATABASE.md`
- Keep it deployable as a static site
- Never hardcode API keys; never add `.css`/`.ts`/`.tsx` to `assetsInclude`
- Don't hand-edit `src/app/components/ui/*` (generated shadcn)

## 10 · Data sensitivity

`Database/*.csv` holds **real children's PII** — names, parents' names/income, GPS, disability,
religion, ethnicity. Under a UNICEF-programme context. Do not publish `dist/` (it embeds every CSV),
don't commit derived copies, and note that RAG rows are sent to whichever AI provider the user selects.
