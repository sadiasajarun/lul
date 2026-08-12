# Latest Decision — Predictive Analysis via the Chat Welcome Screen

> Supersedes the earlier "separate Analysis nav/page" idea. This is the current agreed design.
> Companion docs: `PLAN_IN_SIMPLE_WORDS.md`, `PREDICTIVE_FEATURE_HANDOFF.md`,
> `FEATURE_DISCUSSION_CONTEXT.md`.

---

## The decision (in one line)

**No new navigation and no separate page.** The existing AI Chat stays as-is; we turn its **welcome
screen** (the "What can I generate for you?" page with the suggested-prompt cards) into a **predictive
analysis launcher**. Users click a card → the analysis runs in the chat → they drill down by asking
follow-up questions.

---

## Why this instead of a separate Analysis page

- **Far less new UI** — the welcome screen and its cards already exist; we swap/augment the cards.
- **The chat IS the drill-down tool** — the follow-up mechanism already exists, so pattern chains
  (dropout → family income → weakest subject) work naturally as follow-up questions.
- **Existing flow untouched** — we only change the landing cards + add the backing data views. Chat,
  dashboards, and query logic stay exactly as they are.
- **Trade-off accepted:** we give up an "all analyses in one grid" view. Fine for now; can be added later
  as an extra if wanted.

---

## How it works

1. **Welcome screen shows ~6–8 predictive analysis cards** (replacing / grouped with the current
   suggested prompts).
2. **Each card is a curated prompt.** Clicking it sends that prompt to the normal AI pipeline, which
   returns a score + chart + short narrative (backed by new rule-based views).
3. **Drill-down = follow-up questions.** After an analysis, the user asks the next question, or clicks a
   **suggested follow-up chip** (2–3 smart next steps). The pipeline scopes each follow-up to the
   previous result.
4. Everything runs in the same chat thread — one conversation, deepening step by step.

---

## The analysis cards (starting set — refine later)

| Card | What it shows |
|------|----------------|
| **Dropout risk** | Top at-risk students + drivers (validated vs 5,332 known dropouts) |
| **Irregular → dropout** | Which of 17,693 irregular students are escalating |
| **Worst-performing centers** | Lowest center evaluation scores |
| **Center data-trust** | Centers whose data is too incomplete/stale to trust |
| **Economic pressure** | Lowest-income / working-child cohort |
| **Weakest subjects** | Lowest average marks by subject (valid marks only) |
| **Vulnerability stacking** | Students with multiple risk markers at once |
| **Ghost / over-age students** | Enrolled-but-inactive; age above grade norm |

Each result follows the contract: **score + data-coverage badge + plain-language reason + suggested action.**

---

## Example drill-down (all in one chat)

1. Click **Dropout risk** → see the at-risk cohort and why.
2. Ask (or tap a chip) **"their family income"** → income breakdown of that cohort.
3. Ask **"weakest subject of the lowest-income ones"** → subject marks for that sub-group.

> **Discipline:** show data coverage at **every** hop. Sparsity compounds — by step 3 the sample with
> valid marks can be small; the answer must say so.

---

## Real DB vs Preview DB (unchanged rules)

- Analyses run on whichever database the **Real/Preview toggle** has selected.
- **Real mode** → honest scores + coverage badge (some may be thin).
- **Preview mode** → fuller results, always watermarked **"estimated — demonstration only."**
- Same views serve both; only the label/watermark differs.

## Filtering / time ("toggles") — the caveat

- Filtering happens **conversationally** ("now for Dhaka", "Catchup only").
- **No "1 month / 6 month" filter on Real data** — real data has no dates (attendance is one lifetime
  number). In Real, filter by **division / programme / assessment cycle / enrollment period** instead.
- **Month-based filtering works only in Preview** (simulated monthly data), watermarked.

---

## What needs building (the real work)

1. **Rule-based SQL views** — `v_dropout_risk`, `v_center_health`, `v_weakest_subjects`, etc. (additive to `semantic.sql`).
2. **Catalog entries** for each, so the AI can query them (guarded by `check:catalog`).
3. **Coverage/confidence + mode handling** (reuse the ACTIVE DATASET line + `getDataMode()`).
4. **Predictive cards** on the welcome screen (curated prompts) + **drill-down suggestion chips** (reuse
   the existing chip UI).

## What stays exactly the same

The chat itself, the Ask pipeline, the dashboards, the data flow, the auth/deploy setup. This is purely
additive.

---

## Hard rules (still apply)

- Rule-based, explainable — **no ML**. The LLM writes SQL; numbers come from the database.
- Every analysis shows its **data coverage**; low coverage says so.
- Preview results **always** watermarked "estimated — not for decisions."
- Only simulate data that was **never collected**, and only in Preview, clearly labeled.
- **Additive only** — never change the existing chat/query flow.
- Build on a branch, locally; **no commit/push and no QA/e2e until you say "push to main."**
