# intelligent-data-dashboard - Project Configuration

## Overview

**Project**: intelligent-data-dashboard
**Type**: Frontend-only React SPA (Figma Make export)
**Status**: Development
**Version**: 0.0.1

AI-powered analytics dashboard for the Non-Formal Primary Education (NFPE) –
Education Management Data Center (EMDC) program in Bangladesh. Users ask
natural-language questions; an LLM (Gemini / OpenAI / local fallback) returns a
JSON widget spec that is rendered as a dynamic dashboard over static CSV/JSON
datasets in `Database/`.

**Key Differentiator**: Client-side RAG over streamed CSVs + LLM-generated
dashboard layouts — deployable as a pure static site with no backend.

---

## Behavioral Guidelines

Bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.

### 2. Simplicity First
- Minimum code that solves the problem. Nothing speculative.
- No abstractions for single-use code.

### 3. Surgical Changes
- Touch only what you must. Match existing style.
- Every changed line should trace directly to the request.

### 4. Goal-Driven Execution
- Define success criteria, verify each step (run `npm run dev` / `npm run build`).

---

## IMPORTANT: This Project Does NOT Follow the Fullstack Template Stack

`.claude/` contains the claude-fullstack toolkit whose docs mandate React Router 7,
`app/` source dir, `~/` alias, Redux, and a NestJS backend. **Those mandates do not
apply here.** This is a Figma Make Vite export:

| Aspect | This project |
|--------|--------------|
| Source dir | `src/` (entry `src/main.tsx`) |
| Import alias | `@/` → `src/` |
| Routing | None — view switching via state in `src/app/App.tsx` |
| State | `useState`/`useRef` only (no Redux, no TanStack Query) |
| Styling | Tailwind CSS 4 + shadcn/ui in `src/app/components/ui/` |
| Backend | None — direct browser calls to Gemini/OpenAI, keys in localStorage |
| Data | Static `Database/*.csv` + `summary_dataset.json` |

Do not "migrate" the app toward the template patterns unless explicitly asked.

Special Vite rules (`vite.config.ts`):
- `figma:asset/*` imports resolve to `src/assets/`
- CSVs import as URLs (`?url`); never add `.css`/`.ts`/`.tsx` to `assetsInclude`
- React + Tailwind plugins are both required by Figma Make — do not remove

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18.3 + TypeScript + Vite 6.3.5 |
| UI | shadcn/ui (Radix), Tailwind CSS 4, lucide-react, Recharts 2.15 |
| Backend | None (client-side only) |
| Database | Static CSV/JSON in `Database/` |
| AI | Gemini 2.5 Flash (default) / OpenAI gpt-4o-mini / local fallback |
| Deployment | Static build (`npm run build` → `dist/`) |

---

## Commands

```bash
npm install      # install deps (rerun if 'vite' is not recognized)
npm run dev      # dev server — 5173, falls back to 5174+ if occupied
npm run build    # production build → dist/
npm run typecheck # tsc --noEmit (strict)
npm run aggregate # CSVs → Database/aggregates/ (24 kB rollups)
npm run kb       # aggregate + build Database/kb/ (facts for the AI). RUN AFTER NEW DATA.
```

**After any change to `Database/*.csv` or `summary_dataset.json`, run `npm run kb`.** It refreshes
the aggregates and the knowledge base; the version hash change auto-invalidates the AI's answer
cache so outputs update. See [RAG_SYSTEM.md](.claude-project/docs/RAG_SYSTEM.md).

---

## Key Documentation

| Document | Path | Description |
|----------|------|-------------|
| Project Knowledge | [.claude-project/docs/PROJECT_KNOWLEDGE.md](.claude-project/docs/PROJECT_KNOWLEDGE.md) | Architecture, data/AI flow, conventions |
| **As-Built (Local)** | [.claude-project/docs/LOCAL_BUILD_KNOWLEDGE.md](.claude-project/docs/LOCAL_BUILD_KNOWLEDGE.md) | **What's actually built: verified status, real vs demo data, gaps** |
| **Database Architecture** | [.claude-project/docs/DATABASE_ARCHITECTURE.md](.claude-project/docs/DATABASE_ARCHITECTURE.md) | Tables, relations, join reality, flow, business logic |
| **RAG & Learning System** | [.claude-project/docs/RAG_SYSTEM.md](.claude-project/docs/RAG_SYSTEM.md) | Cost-efficient AI: facts, retriever, learning loop, incremental update (`npm run kb`) |
| **Data Integrity Findings** | [.claude-project/docs/DATA_INTEGRITY_FINDINGS.md](.claude-project/docs/DATA_INTEGRITY_FINDINGS.md) | Attendance coverage, broken joins, test rows, verified-correct metrics |
| Prototype Design | [.claude-project/docs/PROTOTYPE_DESIGN_KNOWLEDGE.md](.claude-project/docs/PROTOTYPE_DESIGN_KNOWLEDGE.md) | Design origin: scoring, Ask pipeline, tokens |
| API (external AI) | [.claude-project/docs/PROJECT_API.md](.claude-project/docs/PROJECT_API.md) | Provider endpoints + JSON widget contract |
| Database Schema | [.claude-project/docs/PROJECT_DATABASE.md](.claude-project/docs/PROJECT_DATABASE.md) | CSV/JSON dataset schemas |
| API Integration | [.claude-project/docs/PROJECT_API_INTEGRATION.md](.claude-project/docs/PROJECT_API_INTEGRATION.md) | Feature → data source mapping |

### Status Tracking

| Status File | Path |
|-------------|------|
| Frontend Screens | [.claude-project/status/frontend/SCREEN_IMPLEMENTATION_STATUS.md](.claude-project/status/frontend/SCREEN_IMPLEMENTATION_STATUS.md) |
| Frontend API Integration | [.claude-project/status/frontend/API_INTEGRATION_STATUS.md](.claude-project/status/frontend/API_INTEGRATION_STATUS.md) |
| E2E QA | [.claude-project/status/frontend/E2E_QA_STATUS.md](.claude-project/status/frontend/E2E_QA_STATUS.md) |

### Memory (Persistent Context)

| File | Purpose |
|------|---------|
| [DECISIONS.md](.claude-project/memory/DECISIONS.md) | Architecture decisions log |
| [LEARNINGS.md](.claude-project/memory/LEARNINGS.md) | Patterns, pitfalls, session notes |
| [PREFERENCES.md](.claude-project/memory/PREFERENCES.md) | Coding style preferences |

---

## Toolkit Layout

- `.claude/` — claude-fullstack toolkit (pipeline, blueprints, gates, skills,
  templates). Copied (not a submodule) on 2026-07-17; project is not yet a git repo.
- `.claude/operations/` — claude-operations skills (client meetings, billing,
  proposals, PRD, QA, app-release).
- `.claude-project/` — project-specific docs, memory, status, and override
  points for skills/agents/hooks.

## Data Sensitivity

`Database/*.csv` contains real personal data (student/teacher names, parents,
income, GPS). Do not publish these files or paste bulk rows into external
services beyond the user-configured AI providers.
