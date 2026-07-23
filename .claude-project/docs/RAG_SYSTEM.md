# RAG & Learning System — cost-efficient AI over the NFPE database

> How the dashboard's AI answers from the database **without scanning the whole database every
> time**, at a fraction of the token cost, and gets sharper as it's used. Built 2026-07-19.
> Companion: [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md).

## The problem it solves

The original RAG streamed up to **105 MB of CSVs per question** and fed raw rows to the LLM. That is
slow, expensive, and forces the model to compute statistics over rows (which it does unreliably).

## The design: three layers, computed once, read cheaply

```
                    build time (npm run kb)                    query time (per ask)
  ┌───────────────────────────────────────────┐   ┌────────────────────────────────────────┐
  │ CSVs 105 MB ─► aggregate.mjs ─► aggregates │   │ query                                   │
  │                24 kB JSON                  │   │   │                                     │
  │                    │                       │   │   ├─ 0. answer cache? ─► HIT = 0 tokens │
  │        build-knowledge-base.mjs            │   │   │                                     │
  │                    ▼                       │   │   ├─ 1. retrieveFacts() ─► ~130 tokens  │
  │  Database/kb/  facts·metrics·schema·manifest│  │   │      of relevant grounded facts     │
  │  34 facts · 14 kB · version hash           │   │   │                                     │
  └───────────────────────────────────────────┘   │   ├─ 2. entity lookup? ─► CSV rows only │
                                                    │   │      then (rare)                    │
                                                    │   └─ 3. LLM builds widgets from facts   │
                                                    │      ─► cache + reinforce               │
                                                    └────────────────────────────────────────┘
```

### Layer 1 — Aggregates (`scripts/aggregate.mjs` → `Database/aggregates/`)
Reads every CSV once, streaming (a 59 MB file never lands in memory whole), emits per-programme /
per-division / per-subject rollups with **coverage** on every partial metric. ~105 MB → 24 kB.

### Layer 2 — Knowledge base (`scripts/build-knowledge-base.mjs` → `Database/kb/`)
Distils aggregates into **34 atomic facts**, each: a grounded one-number statement, a `category`,
a `subject`, a decision `lens` (`kpi|win|issue|action|quality|context`), a `severity`, retrieval
`tags`, and a `source`. Plus:
- `metrics.json` — the **decision dashboard**: KPIs · wins · issues · actions · data-quality.
- `schema.json` — tables, columns, and the measured relation graph.
- `manifest.json` — a **version hash** of the facts. This is the incremental-update pivot.

Total facts payload: **~14 kB** (vs 105 MB). The AI never reads a CSV for an analytical question.

### Layer 3 — Retriever (`src/app/lib/knowledgeBase.ts`)
`retrieveFacts(query, limit, weights)` scores facts by tag/keyword overlap with the query, plus a
**decision-intent boost** (asking about "problems/risks" surfaces `issue`+`quality` facts; "where to
act" surfaces `action`; "what's going well" surfaces `win`). Returns the top ~8 facts as a compact
grounded context block. Measured: **~100–190 tokens per query** of highly relevant facts.

## The learning-pattern loop (`src/app/utils/learningStore.ts`)

Three mechanisms, all keyed to the KB **version** so new data self-heals:

1. **Answer cache** — normalised `query → answer`. A repeat question costs **0 tokens**
   (case/punctuation-insensitive). LRU-capped at 200.
2. **Fact-usefulness weights** — every answered query reinforces `term → fact` mappings, which bias
   the retriever so it sharpens with use. Weights are capped (≤3) and decay slightly so stale
   patterns fade. Because term→fact mapping is stable, weights **survive a data refresh**.
3. **Version guard** — when new data is ingested and `npm run kb` emits a new version hash, every
   cached answer is invalidated automatically; the next ask recomputes against fresh facts.

## The query path (`queryDashboardData` in `openAIHelper.ts`)

```
0. getCachedAnswer(query)           → HIT? return, 0 tokens.
1. retrieveFacts(query, 8, weights) → ~130-token grounded fact pack (cheap primary context).
2. isEntityLookup(query)?           → only THEN stream CSV rows (ragHelper). Analytical asks skip it.
3. provider(gemini|openai|local)    → build widgets grounded in the fact pack.
4. cacheAnswer + reinforce          → the loop learns.
```

`isEntityLookup` = the query has an ID (`\d{5,15}`) or asks to "find/show/profile" a specific
student/teacher/centre. Everything else (the common case) answers from facts alone.

The `insights.ts` `validateNarrative` guardrail still runs on top: any number the LLM emits that
isn't in the fact pack (or a total/share derived from it) is rejected.

## Incremental update — "every new data input, the system updates"

```
new/updated CSV in Database/  ─►  npm run kb  ─►  aggregates refresh, facts recomputed,
                                                   manifest version hash changes
                                                        │
                                   old cached answers (old version) auto-invalidate on next ask
                                   learned term→fact weights carry over (mapping is stable)
                                                        │
                                   next ask recomputes from fresh facts ─► updated AI output
```

One command (`npm run kb`) after ingesting data refreshes the entire knowledge layer. No manual
cache clearing — the version hash does it.

## Cost/scale summary

| | Old RAG | This system |
|---|---|---|
| Bytes touched per analytical ask | up to 105 MB streamed | ~14 kB facts, ~130 tokens sent |
| Repeat question | full cost again | **0 tokens** (cache) |
| Who computes the stats | the LLM, over raw rows | precomputed at build time |
| New data | re-scan every time | `npm run kb`, version auto-invalidates |
| Gets better with use | no | yes (fact-usefulness weights) |

## Four guarantees (added 2026-07-19)

1. **Clean data only.** `ragHelper.isCleanRow()` gates every retrieved row: the key must be pure
   ASCII digits, and rows with faker/test markers are dropped. The ~184 ABAL + ~2,012 Catchup
   faker rows and Bengali-numeral-ID rows never reach the AI or a chart. Verified 6/6.
2. **No unnecessary data in the answer.** The system prompt is decision-first and minimal: answer
   only the question, often one stat or one chart, lead with the "so what", never pad. Single
   subject/programme asks stay single.
3. **Micro drill-down.** `retrieveDetail(query)` attaches exactly ONE relevant structured slice for
   detail asks — full dropout breakdown per programme, subject averages, division/grade/nutrition
   counts, teacher education/experience, worst centres, lowest Bangla marks. So "dropout reason for
   Catchup" is answered at that grain, not zoomed back to network totals. Lean by default (returns
   "" for non-detail asks).
4. **Consistent decision points.** All thresholds/bands live once in the KB builder's `RULES`,
   emitted to `Database/kb/rules.json`, and imported by `src/app/lib/decisionRules.ts`. A fact
   flagged an "issue" and a badge shown in the UI use identical cut-offs — they cannot diverge.
   Centre grade (Good ≥3 · Fair ≥2 · Poor), mainstream verdict, coverage-caption, baseline bands,
   risk tiers all resolve through the same rules.

## Files

| File | Role |
|---|---|
| `scripts/aggregate.mjs` | CSVs → `Database/aggregates/` |
| `scripts/build-knowledge-base.mjs` | aggregates → `Database/kb/` (facts, metrics, schema, manifest) |
| `src/app/lib/knowledgeBase.ts` | typed KB access + `retrieveFacts` |
| `src/app/utils/learningStore.ts` | answer cache + fact weights + version guard |
| `src/app/utils/openAIHelper.ts` | `queryDashboardData` orchestration (cache → facts → entity-RAG → LLM → learn) |
| `npm run kb` | rebuild the whole knowledge layer after new data |
