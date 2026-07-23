# Project Knowledge: intelligent-data-dashboard

## Overview

**Intelligent Data Dashboard** is an AI-powered analytics dashboard for the
**Non-Formal Primary Education (NFPE) – Education Management Data Center (EMDC)**
program in Bangladesh. It visualizes student, teacher, and center data across three
education programs and lets users ask natural-language questions that are answered
with **dynamically generated dashboards** (charts, metric cards, tables, and text
summaries) produced by an LLM.

The project was exported from Figma Make
(original design: https://www.figma.com/design/8Codf6G70x3HO8Os2dO4TR/Intelligent-Data-Dashboard).

### The Three Programs

| Program | Students | Boys / Girls | Avg Attendance | Mainstreamed |
|---------|----------|--------------|----------------|--------------|
| ABAL (Ability Based Accelerated Learning) | 55,200 | 24,868 / 30,323 | 60.98% | 21,006 |
| Catchup | 191,555 | 84,478 / 107,031 | 1.31% | 188,223 |
| Innovation | 3,877 | 1,981 / 1,895 | 1.70% | 385 |

## Tech Stack

- **Frontend**: React 18.3 + TypeScript, Vite 6.3.5, Tailwind CSS 4 (via `@tailwindcss/vite`)
- **UI kit**: shadcn/ui primitives (Radix UI) in `src/app/components/ui/`, lucide-react icons
- **Charts**: Recharts 2.15 (Bar, Line, Area, Pie, Radar, Scatter)
- **Backend**: None — fully client-side SPA
- **Database**: Static files served from `Database/` (CSV + `summary_dataset.json`)
- **AI providers**: Google Gemini 2.5 Flash (default), OpenAI `gpt-4o-mini`, or a local
  no-API fallback. Keys are entered in the in-app Settings modal and stored in
  `localStorage` (`api_provider`, `gemini_api_key`, `openai_api_key`).
- **Deployment**: Static build via `npm run build` → `dist/`

## Architecture

### Project Structure

```
Intelligent Data Dashboard/
├── Database/                  # Static datasets (CSV + summary_dataset.json)
├── src/
│   ├── main.tsx               # Entry point (NOT root.tsx — Figma Make convention)
│   ├── app/
│   │   ├── App.tsx            # ~2,400 lines — ALL views, mock SCHOOLS data, app shell
│   │   ├── components/
│   │   │   ├── ui/            # shadcn/ui primitives (do not hand-edit heavily)
│   │   │   └── figma/         # ImageWithFallback helper
│   │   └── utils/
│   │       ├── openAIHelper.ts  # LLM orchestration → DynamicDashboardResponse
│   │       └── ragHelper.ts     # Streaming keyword search over CSV files (RAG)
│   └── styles/                # Tailwind v4 + theme CSS
├── index.html                 # Vite entry
├── vite.config.ts             # @ → ./src alias, figma:asset resolver, CSV as assets
├── .claude/                   # claude-fullstack toolkit (+ operations/ nested)
└── .claude-project/           # This documentation
```

### Data / AI Flow

1. User types a natural-language question in the dashboard.
2. `ragHelper.ts` extracts keywords (stop-word filtered) and **streams each CSV**
   in `Database/` via `fetch` + `ReadableStream`, collecting up to 15 matching rows
   per file (memory-efficient, stops early).
3. `openAIHelper.ts` builds a system prompt containing `SYSTEM_METADATA_SUMMARY`
   (schema of `summary_dataset.json`) plus the RAG rows, and calls the selected provider:
   - `gemini` → `generativelanguage.googleapis.com/.../gemini-2.5-flash:generateContent`
   - `openai` → `api.openai.com/v1/chat/completions`, model `gpt-4o-mini`
   - `local` (or missing key) → deterministic local analysis fallback, no network call
4. The LLM must return JSON matching `DynamicDashboardResponse`:
   `{ summary: string (markdown bullets), widgets: DashboardWidget[] }`
5. `App.tsx` renders each `DashboardWidget` (`chart` | `metrics` | `table` | `text`;
   chart types: bar, line, area, pie, radar, scatter; widths: full/half/third).

### Views in App.tsx

`AIDashboardView` (dynamic AI results), `OverviewView`, `TopPerformersView`,
`RiskView`, `StudentsView`, `TrendsView`, `ChatView`, `OperationsView`,
`SectionsView`, `TeachersView`, `HealthView`, `ComparisonView`.
`classifyPrompt()` routes canned prompts to a `ViewMode`; `generateAIResponse()`
produces scripted chat replies with rich data.

Note: `App.tsx` also contains a hardcoded `SCHOOLS` array (10 fictional US-style
schools) used by the demo views; the real NFPE data lives in `Database/`.

## Conventions (differ from the .claude fullstack defaults!)

This is a **Figma Make export**, not a `/fullstack`-pipeline project. The
`.claude/templates/claude.template.md` mandates (React Router 7 framework mode,
`app/` source dir, `~/` alias, `root.tsx`, Redux) **do not apply here**:

- Source dir: `src/`, entry `src/main.tsx`
- Import alias: `@/` → `src/` (see `vite.config.ts`)
- No router — single-page app with view switching via state
- State: plain `useState`/`useRef` (no Redux, no TanStack Query)
- `figma:asset/*` imports resolve to `src/assets/` via a custom Vite plugin
- `.csv` files are importable as asset URLs (`?url`) — `assetsInclude` covers `**/*.csv`
- Never add `.css`, `.tsx`, `.ts` to `assetsInclude`
- The React and Tailwind Vite plugins are both required by Figma Make — do not remove

## Development Setup

```bash
npm install       # deps (node_modules can be stale — reinstall if 'vite' not found)
npm run dev       # Vite dev server (default port 5173; falls back to 5174+)
npm run build     # production build → dist/
```

No environment variables are needed. AI keys are user-supplied at runtime via the
Settings modal and persisted in `localStorage`.

## External Services

| Service | Purpose | Notes |
|---------|---------|-------|
| Google Gemini API | Default AI dashboard generation | `gemini-2.5-flash`, key in localStorage |
| OpenAI API | Alternative provider | `gpt-4o-mini`, key in localStorage |
| (none) local mode | Offline fallback | Used when provider = local or key missing |

## Key Decisions

| Decision | Rationale | Date |
|----------|-----------|------|
| Client-side RAG over static CSVs (no backend) | Keeps the demo deployable as a static site; CSVs streamed to limit memory | 2026-07 (pre-existing) |
| Multi-provider AI with local fallback | Works without any API key; user chooses provider in Settings | 2026-07 (pre-existing) |
| `.claude` = claude-fullstack + operations toolkit | Reuse company pipeline/skills; see DECISIONS.md | 2026-07-17 |

See [PROJECT_DATABASE.md](PROJECT_DATABASE.md) for dataset schemas and
[PROJECT_API.md](PROJECT_API.md) for the external AI API contracts.

## As-Built State

For what is **actually built and running locally** — verified status, the real data/AI flow,
which views use real vs fictional data, build output sizes, and the prioritized gap list — see
[LOCAL_BUILD_KNOWLEDGE.md](LOCAL_BUILD_KNOWLEDGE.md).

## Design Origin

This app is the React implementation of the **OOSC-BD / "Let Us Learn" admin dashboard**, first
designed as a clickable prototype in the Laravel backend repo
(`D:\letuslearn\let-us-learn-backend-stage\prototype\`). The prototype defines the product's
information architecture, the A1/A2/A3 scoring semantics, the grounded-AI "Ask" pipeline (which
`openAIHelper.ts` mirrors), the bilingual EN/BN discipline, and the domain band colours. See
[PROTOTYPE_DESIGN_KNOWLEDGE.md](PROTOTYPE_DESIGN_KNOWLEDGE.md) for the full distillation and the
prototype → React mapping.
