# API Integration Status: intelligent-data-dashboard

## Overview

Maps app features to their data sources / external calls. There is no in-house
backend; "integration" means LLM provider calls plus static dataset reads.

## Feature → Data Source Mapping

| Feature / View (in `src/app/App.tsx`) | Data Source | Status |
|--------------------------------------|-------------|--------|
| AI question → dynamic dashboard (`AIDashboardView`) | Gemini / OpenAI / local via `queryDashboardData()` | Working |
| RAG context retrieval | `Database/*.csv` streamed by `ragHelper.ts` | Working |
| Aggregate stats in prompts | `Database/summary_dataset.json` (bundled import) | Working |
| Overview / TopPerformers / Risk / Students / Trends / Operations / Sections / Teachers / Health / Comparison views | Hardcoded `SCHOOLS` demo array in `App.tsx` | Working (demo data) |
| Chat replies (`ChatView`) | Scripted `generateAIResponse()` + `classifyPrompt()` | Working (canned) |
| Settings modal (provider + keys) | `localStorage` | Working |

## Service Files

| Service | Location | Responsibility |
|---------|----------|----------------|
| openAIHelper | `src/app/utils/openAIHelper.ts` | Provider dispatch, system prompt, JSON contract |
| ragHelper | `src/app/utils/ragHelper.ts` | Keyword extraction, streaming CSV search (15 rows/file cap) |

## Integration Checklist

- [x] Provider dispatch (gemini / openai / local)
- [x] Local no-key fallback
- [x] RAG over all 13 CSV files
- [ ] Robust JSON-parse error surface in UI (verify on malformed LLM output)
- [ ] Replace hardcoded `SCHOOLS` demo views with real NFPE data (if desired)
- [ ] Server-side proxy for API keys (only if a backend is introduced)
