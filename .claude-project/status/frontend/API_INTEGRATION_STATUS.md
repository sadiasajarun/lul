# API Integration Status: intelligent-data-dashboard

> **Framework:** React 18 + Vite (no in-house backend)
> **Last Updated:** 2026-07-17

## Integration Matrix

| Screen / Feature | External Call | Status | Service Method |
|------------------|---------------|--------|----------------|
| AI Dynamic Dashboard | Gemini `gemini-2.5-flash:generateContent` | Complete | `queryDashboardData` (`src/app/utils/openAIHelper.ts`) |
| AI Dynamic Dashboard | OpenAI `POST /v1/chat/completions` (gpt-4o-mini) | Complete | `queryDashboardData` |
| AI Dynamic Dashboard | Local fallback (no network) | Complete | `queryDashboardData` |
| RAG retrieval | Static `Database/*.csv` via fetch/stream | Complete | `performRagRetrieval` (`src/app/utils/ragHelper.ts`) |

## Status Legend

| Status | Meaning |
|--------|---------|
| Pending | Not integrated |
| In Progress | Currently integrating |
| Complete | Integrated and working |
| Blocked | API not ready |

## Notes

- No axios/interceptors — plain `fetch`. Keys come from localStorage at call time.
- If a backend proxy is added later, migrate these calls and update this file.
