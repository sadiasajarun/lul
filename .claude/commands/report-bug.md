---
description: Log a bug report as a structured YAML file for future RL reward attribution
argument-hint: "[--escaped]"
---

# Report Bug

**Purpose**: capture bugs as training data. Every logged bug will become a
negative reward credit against its root-cause phase when Stage 3 of the RL
system ships. Today this command only writes the YAML file — no reward
recomputation yet. That is intentional: the file is the commitment, Stage 3
will consume it later.

**Do not skip logging a bug just because you're not sure of the RCA.** A bug
report with `rca_phase: unknown` is still useful. A forgotten bug is worthless.

---

## What to do

### Step 1 — Collect the fields

Use **AskUserQuestion** to gather each field in its own question.

1. **Severity** — ask with options:
   - `P0` — crash / data loss / security
   - `P1` — wrong behavior / broken feature
   - `P2` — cosmetic / layout issue
   - `P3` — minor / polish

2. **Discovered in phase** — ask with options (plus "production"):
   - `init`, `spec`, `prd`, `design`, `database`, `user-stories`, `backend`,
     `frontend`, `integrate`, `test-api`, `test-browser`, `ship`, `production`

3. **Root cause phase (rca_phase)** — "which phase should have caught this bug earlier?"
   - Same options as above (minus `production`)
   - Also accept `unknown` if the user isn't sure — do not pressure them to guess

4. **Description** — free-form, one-line summary. One AskUserQuestion with
   no options (or just use the conversation flow).

5. **Escaped to production?** — ONLY ask if `--escaped` was NOT in $ARGUMENTS.
   - If `--escaped` was passed, skip this question and set `escaped_to_production: true`
   - Options: `yes` / `no`

### Step 2 — Generate the bug ID

```
bug-YYYYMMDD-XXXX
```

Where `YYYYMMDD` is today's date UTC and `XXXX` is 4 lowercase alphanumeric
characters (just pick a short random string — this is for human readability,
not cryptographic uniqueness).

Example: `bug-20260410-8wqr`

### Step 3 — Write the YAML file

Use the **Write** tool to create `.claude-project/bugs/{bug_id}.yaml`.
The Write tool will create the `bugs/` directory if it doesn't exist.

**Exact schema** (keep keys in this order for stability):

```yaml
id: bug-20260410-8wqr
reported_at: 2026-04-10T07:52:00Z
severity: P1
discovered_in_phase: test-browser
rca_phase: backend
escaped_to_production: false
description: |
  JWT refresh token not rotated on use — allows token replay after logout.
status: open
affected_episodes: []
```

Field notes:
- `reported_at`: full ISO 8601 UTC, use the current time
- `description`: YAML block scalar (`|`), even if it's just one line — keeps
  multi-line descriptions easy to add later without reformatting
- `affected_episodes`: empty list for now. Stage 3 will populate this by
  scanning past episode JSONL files for the phase transition where the bug
  was introduced.
- `status`: always `open` on creation. Closing bugs is a future feature.

### Step 4 — Confirm to the user

Print a short confirmation. Two or three lines is enough:

```
✅ bug-20260410-8wqr logged at .claude-project/bugs/bug-20260410-8wqr.yaml
   severity: P1 | discovered in test-browser | rca: backend
   Stage 3 will credit this against the backend phase's reward history.
```

---

## What NOT to do

- **Do not** try to recompute episode rewards — Stage 3 owns that pipeline
- **Do not** try to root-cause the bug automatically — the user provides `rca_phase`
- **Do not** modify any existing bug files — always create a new one
- **Do not** edit reward.yaml, any episode file, or any blueprint
- **Do not** ask the user "are you sure?" — just log the bug and confirm
- **Do not** use emojis in the YAML fields (emojis in the confirmation message are fine)

## Edge cases

- **`--escaped` passed** → skip the "escaped to production?" question, set `escaped_to_production: true`. Also bump the severity question's default to P1 if the user hasn't picked one yet (escaped bugs are rarely P3).
- **User bails mid-interview** (interrupts or cancels) → do NOT write a partial file. Either write the full YAML or write nothing.
- **User says rca_phase is `unknown`** → set the field to the literal string `unknown`. Stage 3 will handle this as "no retroactive credit" rather than forcing a guess.
- **`.claude-project/bugs/` directory doesn't exist** → the Write tool creates parent dirs automatically. No `mkdir` needed.
