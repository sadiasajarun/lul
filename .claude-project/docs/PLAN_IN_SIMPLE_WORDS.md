# Our Plan — In Simple Words

> A short, plain-language guide for the next person. For deeper detail see
> `PREDICTIVE_FEATURE_HANDOFF.md` (workflow + phases) and `FEATURE_DISCUSSION_CONTEXT.md`
> (paste into a Claude chat to design features).

---

## What we are building

A **risk / predictive layer** on top of the existing dashboard. It will flag things like
"these students are most likely to drop out" or "these centers' data can't be trusted" — each
with a **reason** and a **suggested action**, not just a number.

---

## The one big idea: two databases

The app has a **Real / Preview** switch at the top.

- **Real DB** = the true data, but it has **gaps** (lots of missing attendance, status, etc.).
- **Preview DB** = the same data with the **gaps filled in by estimates** (made-up numbers, for
  showing what a complete picture looks like).

**How predictions use them:**
- In **Real** mode → the score is real → you can act on it → we show **how complete the data is**
  ("based on 30% coverage").
- In **Preview** mode → the score uses made-up data → we always stamp it
  **"estimated — demo only, do not make decisions from this."**

The same code works in both modes automatically — flipping the switch just changes the data underneath.

---

## What we CAN build now vs LATER

- **CAN do now:** "**Who is at risk right now?**" — using the fields we already have. Simple, honest,
  rule-based scoring (a clear formula, no complicated AI/ML).
- **CANNOT do yet:** "**What will happen and when?**" (real forecasting). The data is a single snapshot
  with no dates, so trends over time aren't possible until new data is collected (dated attendance,
  dropout dates, etc.). Preview mode can *demonstrate* what forecasting would look like.

---

## The 3 kinds of features (how we sort every idea)

- **Type A** — works in both DBs; Preview just shows more. (e.g. dropout risk). *No data changes needed.*
- **Type B** — the real data is already complete, so Real and Preview look the same. (e.g. over-age
  for grade, inactive students). *Safest to start with.*
- **Type C** — needs Preview's made-up data because the real programme never collected it. (e.g. monthly
  attendance trend). Preview shows a demo; Real mode politely says "not available — needs this data."

---

## How a feature gets added (step by step)

1. **Someone describes the feature** in plain words (often planned in a separate Claude chat).
2. **Claude Code checks the plan** against our real system and the Real/Preview rules — and flags
   anything that won't work here *before* building.
3. **Claude builds it on a separate branch, on the computer only** — nothing goes live yet.
4. **Claude only checks it doesn't break anything** (quick technical checks). **No heavy QA during this step.**
5. **You review it** locally (run the app on `http://localhost:5180`).
6. When you're happy and say **"push to main"** → then (and only then) we run **full QA / e2e tests**,
   fix issues, and push. Pushing to main **automatically updates the live site**.

---

## Build order (do it in this sequence)

1. **Foundation** — a "how complete is the data" layer that every score uses.
2. **Type B features** first (safest — real data already complete).
3. **Type A features** next (real + preview, checked against the 5,332 known dropouts so the scores make sense).
4. **Type C features** last (Preview demos; may add a *small* amount of realistic made-up data to Preview).

Each step stands alone — we can pause or reorder anytime without breaking earlier work.

---

## Before anything goes live (the safety checklist)

1. Technical checks pass (build, types, schema).
2. **Now** run QA / e2e tests and fix failures.
3. Merge the feature branch into **main** and push → live site updates.
4. Log in to the live site, test the feature in **both** Real and Preview, make sure nothing else broke.
5. If something's wrong, roll back to the saved safe point **`v1.0-live`**.

---

## Rules we never break

- Simple, explainable formulas — **no black-box ML**.
- Every score shows **how complete its data is**.
- Preview scores are **always marked "estimated — not for decisions."**
- We only make up data that was **never collected**, and only in **Preview**, always clearly labeled.
- New features are **added on top** — we never change the existing dashboard or question-answering flow.
- **Nothing reaches the live site** without your go-ahead and the safety checklist above.
