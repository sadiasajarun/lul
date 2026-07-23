# API Reference: intelligent-data-dashboard

## Overview

This project has **no backend of its own**. All "API" traffic is direct
browser-to-provider calls made from `src/app/utils/openAIHelper.ts`. There is no
authentication layer; provider API keys are entered by the user in the Settings
modal and kept in `localStorage`.

## Providers

| Provider | Endpoint | Model | Auth |
|----------|----------|-------|------|
| Gemini (default) | `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={apiKey}` | gemini-2.5-flash | key in query string |
| OpenAI | `POST https://api.openai.com/v1/chat/completions` | gpt-4o-mini | `Authorization: Bearer {apiKey}` |
| Local fallback | none (in-browser) | — | used when provider is `local` or key is empty |

Provider selection lives in `localStorage`:

| Key | Values |
|-----|--------|
| `api_provider` | `"gemini"` \| `"openai"` \| `"local"` |
| `gemini_api_key` | user-supplied key |
| `openai_api_key` | user-supplied key |

## Request Contract

`queryDashboardData(prompt, provider, apiKey)`:

1. Runs `performRagRetrieval(prompt)` (`ragHelper.ts`) → matching CSV rows.
2. Sends a system prompt = `SYSTEM_METADATA_SUMMARY` (schema of
   `summary_dataset.json`) + RAG context + strict JSON-shape instructions.
3. Expects the model to return **JSON only**, matching:

```typescript
interface DynamicDashboardResponse {
  summary: string;              // markdown, 3-4 bullet points of key insights
  widgets: DashboardWidget[];
}

interface DashboardWidget {
  type: "chart" | "metrics" | "table" | "text";
  title: string;
  width?: "full" | "half" | "third";
  // chart
  chartType?: "bar" | "line" | "area" | "pie" | "radar" | "scatter";
  xAxisKey?: string;
  seriesKeys?: string[];
  // metrics
  metricsList?: { label: string; value: string; sub: string;
                  trend?: string; trendDirection?: "up" | "down" | "neutral" }[];
  // table
  tableHeaders?: string[];
  data?: any[];                 // chart points / table rows
  content?: string;             // text widgets
}
```

## Error Handling

- Missing/empty API key silently degrades to the local analysis path.
- Malformed LLM JSON must be handled defensively in `App.tsx` (parse guards).

## Notes for Future Backend Work

If a real backend is added later, follow `.claude/templates/claude-project/docs/PROJECT_API.template.md`
conventions (httpOnly cookie auth, `/api` base path) and move the provider calls
server-side so keys leave the browser.
