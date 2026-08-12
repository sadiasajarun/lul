# Final Plan — Predictive Analysis System (verified fit + task plan)

> The authoritative build plan. Verified against the real code. Consolidates:
> `PREDICTIVE_SYSTEM_PLAN.md`, `ANALYSIS_LAUNCHER_DECISION.md`, `FEATURE_DISCUSSION_CONTEXT.md`.

---

## 1. Fit check — verified against the codebase ✅

| Plan piece | Where it plugs in (real code) | Fit |
|---|---|---|
| Predictive cards on welcome screen | `QUICK_PROMPTS` in `src/app/views/ChatView.tsx` (rendered ~:266) | ✅ edit array + make mode-aware |
| Analysis output (score/chart/table) | `DashboardResponse{summary,widgets[]}` in `lib/ai/interpret.ts` (types: metrics/chart/table) | ✅ existing widgets cover viz |
| Coverage badge + drivers + recommendations + chips | same contract | ⚠️ needs one **additive** extension (Task 3) |
| Rule-based analyses | new views in `lib/db/semantic.sql` + `lib/db/catalog.ts` | ✅ guarded by `check:catalog` |
| Real/Preview awareness | `getDataMode()` already threaded into the pipeline | ✅ done |
| Behavioral learning (A) | `utils/learningStore.ts` (`getWeights`,`reinforce`,`cacheAnswer`) | ✅ extend existing store |
| Current chat / dashboards | untouched | ✅ additive only |

**Verdict:** fits cleanly. Everything is additive; the one non-trivial change is extending the response
contract for richer analysis output (isolated to `interpret.ts` + the ChatView renderer).

---

## 2. Architecture (final)

**Client-side first.** Nothing in the features needs a server — SQL runs in browser DuckDB, the LLM writes
SQL + interprets, all from the browser (as today). No cold-start, no new protocol, lowest breakage risk.

**Three layers:**
1. **Data (truth):** rule-based SQL views → deterministic numbers. No ML.
2. **Brain + Knowledge:** per-analysis **playbooks** (factors, interpretation, prioritize, actions,
   drill-downs, mode notes) injected in-context — makes output better; *not* a trained model. **Keep.**
3. **Learning:** split honestly —
   - **(A) Behavioral → improves OUTPUT/UX** (rank most-used analyses, better follow-up suggestions,
     remembered focus, 👍/👎 reinforcement). Heuristic, no ML. Build on `learningStore`. **Client-side now.**
   - **(B) Prediction accuracy → improves only with NEW OUTCOME DATA + periodic weight re-tuning**
     (validate vs real dropouts). Not driven by clicks. A periodic script, run when new data lands.

**Deferred backend (its own later task):** a persistent server-side store is needed **only** for
*team-wide* learning that accumulates across users (localStorage is per-browser). ⚠️ Render free tier's
disk is **ephemeral** → real persistence needs a paid disk or an external DB. Also fold the LLM **key-proxy**
(`/api`) into that same later change. Keep the LLM-call boundary clean now so it can move server-side
without rework.

---

## 3. Analysis set (Tiers 1–3, mode-gated)

- **Real + Preview (both):** dropout risk, irregular→dropout, worst centers, center data-trust, economic
  pressure, weakest subjects, vulnerability stacking, ghost/over-age.
- **Preview-only (hidden in Real):** attendance trend/decline, teacher-batch impact.
- Every result = **score + coverage badge + plain-language driver + suggested action** (never a bare number).
- **Mode visibility:** Real shows the honest subset (coverage badges); Preview shows all (watermarked
  "estimated"), incl. month toggles + teacher drill-down + contacts.

---

## 4. TASK PLAN (run in order · each is additive + break-checked · no commit until "push")

> **Break-check every task:** `npm run typecheck` · `npm run check:catalog` · `npm run build`. Then review
> locally on `http://localhost:5180`. No e2e/QA until "push to main". Work on branch `feature/predictive`.

### Phase 0 — data foundation (no UI, no LLM — safest)
- **T1 · `v_coverage` view** — per-field completeness per mode, in `semantic.sql` + `catalog.ts`. Pure SQL.
- **T2 · `v_dropout_risk` view** — rule-based weighted score in `semantic.sql` + `catalog.ts`, + a node
  script asserting **known dropouts score higher than actives** (validation, no ML).

### Phase 1 — first analysis end-to-end (Dropout risk)
- **T3 · extend the response contract** — add analysis metadata (coverage, drivers[], recommendations[],
  drilldowns[]) to `DashboardResponse`/widgets in `interpret.ts`; render it in `ChatView.tsx`. Additive.
- **T4 · playbook infra** — a `playbooks` module (per-analysis spec) injected into the prompt/interpret.
- **T5 · welcome card (Dropout risk)** — add to `QUICK_PROMPTS` (mode-aware) → click runs the curated prompt.
- **T6 · drill-down chips** — suggested follow-ups for the dropout chain (reuse the chip UI).

### Phase 2 — behavioral learning (A), client-side
- **T7 · extend `learningStore`** — usage ranking of analyses, 👍/👎 reinforcement, remembered focus;
  surface most-used cards + smarter follow-up suggestions.

### Phase 3 — roll out remaining analyses (repeat T2 + T5 + T6 pattern)
- **T8+ ·** `v_center_health`, `v_worst_centers`, `v_weakest_subjects`, `v_economic_pressure`,
  `v_vulnerability`, `v_ghost_overage` — each: view + catalog + card + chips + break-check.

### Phase 4 — Preview extensions (Bucket C, preview-only)
- **T… ·** in `scripts/build-tuned-data.mjs`, add (mode-gated like `attendance_monthly`): dated attendance,
  teacher↔batch↔subject, contact/field-officer reference → month toggles, teacher drill-down, contacts +
  the Preview-only cards. Watermarked, real-mode-graceful.

### Phase 5 — optional, later (only if/when needed)
- Persistent **team-wide learning** store + **LLM key-proxy** on a backend (infra decision: paid disk /
  external DB). Prediction re-tuning (B) script.

---

## 5. Guardrails (non-negotiable)

- Rule-based + explainable — **no ML / trained model**. LLM writes SQL + reasons; numbers come from SQL.
- Every analysis shows **data coverage**; low coverage says so.
- Preview results **always** watermarked "estimated — not for decisions."
- Simulate only genuinely-uncollected data, **only in Preview**, clearly labeled.
- Recommendations are **advisory + explainable**; the human decides.
- **Additive only** — never change the existing chat/query flow.
- Behavioral learning improves **output/UX**, never claimed to improve prediction accuracy (that needs new
  outcome data + re-tuning).
- Any incoming plan checked vs real code + Real/Preview reality **before** building.
- Branch + local; **no commit/push, no QA/e2e until "push to main."**
