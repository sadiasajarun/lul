---
name: mm
description: "Generate meeting minutes from a transcript — short summary, decisions approved, mismatches, blockers from both sides, and action items. Outputs an internal .md report (for the dev team and project history) + a Slack-ready summary to share with the client."
user-invocable: true
argument-hint: "[--project 'name'] [--date 'YYYY-MM-DD'] [--source 'path/to/transcript.txt']"
---

# Meeting Minutes Generator

Analyse a meeting transcript and produce two precision artifacts:

1. **Internal `.md` report** — structured minutes for the dev team and project history. Precise enough that any team member who was not in the meeting can act immediately.
2. **Slack summary** — a short, copy-pasteable block to send to the client and all attendees.

> **Principle:** Every line must be precise and actionable. No filler. If it cannot be acted on or referenced, cut it.

---

## Workflow Overview

```
┌─────────────────────┐
│ Step 1: Collect     │  Arguments + transcript input (paste or file)
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ Step 2: Analyse     │  Parse transcript → extract structured data
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ Step 3: Generate    │  Write .md report + Slack summary
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ Step 4: Report      │
└─────────────────────┘
```

---

## Step 1: Collect Input

### 1.1 Parse Arguments

Extract from `$ARGUMENTS`:

| Arg | Required | Default |
|-----|----------|---------|
| `--project` | No | Auto-detect from CWD folder name or `package.json` name |
| `--date` | No | Today's local date (`YYYY-MM-DD`). If the transcript explicitly mentions a meeting date in its first 200 words, use that instead. Override with `--date` for any past meeting. |
| `--source` | No | Path to a `.txt` / `.md` transcript file |

### 1.2 Obtain Transcript

**If `--source` is provided:**
Read the file at that path. Accept `.txt`, `.md`, `.vtt`, or any plain-text format.

**If no `--source` is provided:**
Ask the user in chat (free-form prompt — `AskUserQuestion` is not appropriate here because it expects preset choice options, not pasted text):

> Paste the meeting transcript below. Accepts Zoom / Meet / Teams auto-transcripts, dashboard recordings, typed summaries, or Slack thread recaps. Paste everything — completeness improves accuracy.

Accept the full pasted block as the transcript. Do not truncate or pre-process it before analysis.

### 1.3 Collect Attendees (optional fast-follow)

If attendees are not clearly identifiable from the transcript, ask in one follow-up in chat:

> Who attended? List name and role, one per line. Reply `skip` if already in the transcript or unknown.

Accept "skip" to proceed without a named attendee list.

---

## Step 2: Analyse the Transcript

Perform a single structured analysis pass. Extract all of the following from the transcript. Do not invent, assume, or pad — only include what is explicitly stated or directly implied.

### 2.0 Pre-Analysis Setup

Run both sub-steps below before extracting any data from the transcript.

#### Meeting Type Detection

Classify the meeting type by scanning for these keywords (case-insensitive, first match wins):

| Keywords present in transcript | Meeting type |
|-------------------------------|--------------|
| "weekly", "week N", "W0N", "weekly sync" | Weekly sync |
| "demo", "showcase", "show you", "let me show" | Demo |
| "design review", "FRD review", "milestone review" | Design review |
| "kickoff", "kick off", "first meeting", "onboarding" | Kickoff |
| "retrospective", "retro", "what went well" | Retrospective |
| "feedback", "client feedback", "review feedback" | Feedback session |
| None of the above | Ad-hoc |

Write the detected value into `**Meeting type:**` in the .md header. Do not ask the user.

**Optional subtitle:** If the meeting has a clear secondary theme dominant in the transcript (e.g., post-client debrief, scope review, blocker triage), append it after an em-dash: `Ad-hoc — Post-Client Debrief`. Subtitle must be 2–4 words and traceable to a phrase used in the transcript. Skip the subtitle if no clear theme emerges — do not fabricate one.

#### Prior MM Carry-Forward (Recurring Mismatch Detection)

Search for prior MM files for this project:

```
.claude-project/meetings/{ProjectName}/minutes/[MM] *.md
```

Sort by the `(YYYY-MM-DD)` suffix descending. Read the **most recent** file only.

Extract every row from its **Mismatches** table where `Status = Open`.

During §2.3 analysis, if a mismatch in the current transcript matches a topic from that list, mark it with a `⚠ Recurring` tag:

| Topic | Client understood | Team understood | Status |
|-------|-----------------|-----------------|--------|
| {item} | … | … | ⚠ Recurring — Open |

If no prior MM file exists, skip silently.

### 2.1 Short Summary

Write **3–5 sentences** covering:
- The purpose of the meeting
- What was discussed at a high level
- The overall outcome or tone

No bullet points. Plain prose. Write it so someone who skipped the meeting understands the context in 30 seconds.

### 2.2 Decisions Taken / Approved

List every decision that was explicitly agreed to, approved, or confirmed during the meeting. Include:
- **What** was decided
- **Who** approved it (if stated)
- **Any conditions** attached (e.g., "approved if X is delivered by Friday")

Format as a numbered list. If nothing was formally decided, write: *No formal decisions recorded.*

**Decision criteria:** A decision is recorded only if both parties acknowledged it. Do not list items that were merely discussed or proposed without agreement.

### 2.3 Mismatches

List every point where the **client's expectation or understanding differed from the team's**. Include:
- The topic
- What the client understood / expected
- What the team understood / built
- Whether it was resolved in the meeting or remains open

Format as the 4-column table shown in §3.2 (`Topic | Client understood | Team understood | Status`). If no mismatches occurred, write: *No mismatches identified.*

**Mismatch criteria:** A mismatch is a gap — something the client thought was done, planned differently, or interpreted differently than the team. It is not the same as a blocker or a decision.

### 2.4 Blockers

List all blockers raised by **either side**. Separate clearly:

**Client-side blockers** — things the team is waiting on from the client (assets, approvals, content, credentials, decisions not yet made).

**Team-side blockers** — things the team has flagged as blocking their progress (unresolved technical issues, unclear requirements, missing access, third-party delays).

For each blocker include:
- What is blocked
- Who owns unblocking it
- Target resolution date (if mentioned)

If no blockers were raised, write: *No blockers raised.*

### 2.5 Action Items

List every task, follow-up, or commitment mentioned in the meeting. For each:

| Field | Rule |
|-------|------|
| **Task** | One clear sentence. What exactly needs to happen. |
| **Owner** | Name or role. If unclear from transcript, write "TBD". |
| **Deadline** | Convert relative references to absolute `YYYY-MM-DD` using the meeting date: "today" → meeting date, "tomorrow" → meeting date + 1, "this week" → Friday of meeting week, "next week" → Friday of following week. If no deadline mentioned, write "Not specified". |
| **Side** | Client or Team |
| **Priority** | Assign by deadline — do not infer from tone: **High** = deadline is today or transcript uses "urgent / ASAP / immediately"; **Medium** = deadline within 7 days or transcript says "this week / soon"; **Low** = no deadline mentioned. |

Include every commitment made, even informally ("I'll send that over by tomorrow"). Do not filter.

**Sort order** (apply in both .md table and Slack output):
1. Priority descending — High → Medium → Low
2. Within same priority: deadline ascending — earliest YYYY-MM-DD first; "Ongoing" and "Not specified" last
3. Within same priority + deadline: owner alphabetical

### 2.6 Next Meeting Agenda

Derive agenda items for the **next** meeting automatically from the analysis above. Do not fabricate — only include items that are directly traceable to an open item, pending decision, or upcoming deadline.

Pull from these sources in order:

| Source | Agenda item rule |
|--------|-----------------|
| Open mismatches | "Status of [topic] — was the gap resolved?" |
| High-priority team action items | Include if deadline is within 7 days or marked High |
| Pending client decisions | Include if no deadline or deadline is upcoming |
| Upcoming sprint / milestone deadlines | Include if mentioned in transcript |
| Explicit "we'll discuss next time" phrases | Include verbatim as an agenda item |

Format as a flat numbered list. Max 6 items. If fewer than 2 items can be derived, write: *No agenda items derived — all items resolved or no follow-up indicated.*

---

## Step 3: Generate Artifacts

### 3.1 Output Location

Save the `.md` file at:

```
.claude-project/meetings/{ProjectName}/minutes/[MM] {ProjectName} ({YYYY-MM-DD}).md
```

Create the directory if it does not exist.

### 3.2 Internal `.md` Report Template

```markdown
# {PROJECT} — Meeting Minutes

**Date:** {YYYY-MM-DD}
**Attendees:** {list or "See transcript"}
**Meeting type:** {auto-detected — see §2.0}
**Command:** `/mm --project "{ProjectName}" --date "{YYYY-MM-DD}"`
**Source:** {Transcript source — dashboard recording, paste, etc.}

---

## Summary

{3–5 sentence plain prose summary}

---

## Decisions Taken

{Numbered list — each decision on one line.
 Mark approved decisions with ✅
 Mark conditional decisions with ⚠ and state the condition.}

---

## Mismatches

| Topic | Client understood | Team understood | Status |
|-------|------------------|-----------------|--------|
| {item} | {client view} | {team view} | Resolved / Open |

---

## Blockers

### Client Side
{Numbered list. Each item: what is blocked, who unblocks it, target date.}

### Team Side
{Numbered list. Each item: what is blocked, who unblocks it, target date.}

---

## Action Items

| # | Task | Owner | Side | Deadline | Priority |
|---|------|-------|------|----------|----------|
| 1 | {task} | {owner} | Client/Team | {date or "Not specified"} | High/Med/Low |

---

## Next Meeting Agenda

{Numbered list — derived from §2.6. Max 6 items.}

---

## Notes

{Any additional context that does not fit above — quotes worth preserving, tone observations,
 follow-up meeting scheduled, etc. Keep brief. Delete this section if empty.}
```

### 3.3 Slack Summary

After writing the `.md` file, print the following block to the conversation so the PM can copy-paste it directly into Slack. Do not save this as a file.

Format:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 {PROJECT} · Meeting Minutes
📅 {YYYY-MM-DD}  ·  🏷 {Meeting type}
━━━━━━━━━━━━━━━━━━━━━━━━━━

💬 Summary
{1–2 tight sentences — who flagged what, what was resolved, what is next.}

━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Decisions ({N})
1. {decision — full sentence, no emoji prefix}
2. {decision}
...

━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ Open Mismatches ({N})   ← omit section entirely if none
• {Topic} — {client expected X; team built/understood Y}
• {Topic} — {one-line gap. Mark ⚠️ Recurring if seen in prior MM}

━━━━━━━━━━━━━━━━━━━━━━━━━━

🚧 Blockers ({N})   ← omit section entirely if none; N = total client + team blockers
Client → {one blocker per line}
Team → {one blocker per line — repeat "Team →" for each distinct blocker}
Team → {second team blocker if any}

━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 Action Items ({N})
🔴 [{Owner}] {Task} — {YYYY-MM-DD}
🟡 [{Owner}] {Task} — {YYYY-MM-DD}
⚪ [{Owner}] {Task} — TBD
(Full list in meeting minutes doc if > 8 items)

━━━━━━━━━━━━━━━━━━━━━━━━━━

📅 Next Meeting Agenda ({N})
• {agenda item derived from open mismatch, pending decision, or upcoming deadline}
• {agenda item}
...

━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated {YYYY-MM-DD} · /mm --project "{PROJECT}" · Potential INC
```

**Priority dot legend:**
- 🔴 High (deadline = today, or "urgent / ASAP / immediately")
- 🟡 Medium (deadline within 7 days, or "this week / soon")
- ⚪ Low (no deadline mentioned)

**Slack formatting rules:**
- **Plain text only** — no `*bold*`, no `_italic_`. Slack's "Format messages with markup" preference is off by default in many workspaces, so markup pastes as literal `*` / `_` characters. Visual hierarchy comes from emoji + `━━━` dividers, not text styling.
- One blocker per line — repeat `Client →` or `Team →` prefix for each distinct blocker; never combine two blockers on one line with `·`
- All deadlines in action items use absolute `YYYY-MM-DD` — convert "today / tomorrow / this week" using the meeting date
- Count badges `({N})` on **every** section header: Decisions, Mismatches, Blockers, Action Items, Next Meeting Agenda
- **Vertical spacing**: exactly one blank line between header and first item; no blank lines between items within a section; one `━━━` divider line between sections (no blank line above or below the divider — divider acts as the separator)
- **Sort**: action items by priority desc → deadline asc → owner asc (matches §2.5 sort order)
- Max 8 action items; truncate Low-priority ones first with `(Full list in meeting minutes doc)`
- Keep the entire block under 50 lines. If over, cut in this order until it fits:
  1. Reduce action items to 5, remove Low-priority ones
  2. Collapse resolved mismatches — show Open / Recurring only
  3. Condense each blocker to topic only (drop owner)
  4. Shorten summary to 1 sentence
  Never cut: Decisions, High-priority action items, Recurring mismatches, or Next Meeting Agenda.
- No HTML, no triple backticks in the final Slack block

**Empty-section handling — single rule:**
- Slack output: omit the entire section (header + body) if it has zero items. Never print a section with `(none recorded)` body.
- `.md` output: required sections (Summary, Decisions, Action Items) must use a fallback phrase ("No formal decisions recorded", "No action items recorded"); optional sections (Mismatches, Blockers, Next Meeting Agenda, Notes) are omitted entirely if empty.

---

## Step 4: Report Result

After all artifacts are generated, print:

```
Meeting minutes generated.

Project:    {PROJECT_NAME}
Date:       {YYYY-MM-DD}
Source:     {transcript source}

Report:     .claude-project/meetings/{ProjectName}/minutes/[MM] {ProjectName} ({YYYY-MM-DD}).md

Summary:    {decisions count} decisions  ·  {mismatches count} mismatches  ·  {total action items} action items
            {client blockers count} client blockers  ·  {team blockers count} team blockers

Slack summary printed above — copy and paste directly into Slack.
```

---

## Error Handling

| Scenario | Action |
|----------|--------|
| Transcript is empty or too short (<50 words) | Ask user to paste the transcript again — the input may have been cut off |
| No attendees identifiable | Proceed without attendee list; write "Not recorded" in the header |
| Transcript is in a non-English language | Analyse in the original language, generate all outputs in English. Note the source language in the report header. |
| No action items found | Write "No action items recorded" in the table section — do not fabricate tasks |
| No decisions found | Write "No formal decisions recorded" — do not infer decisions from discussion |
| Output directory creation fails | Fall back to `.claude-project/meetings/minutes/` |

---

## Quality Rules

Before outputting either artifact, verify:

| # | Check | Severity |
|---|-------|----------|
| 1 | Every action item has an owner (Name, role, or "TBD") — never owner-less | HIGH |
| 2 | Every decision is explicitly stated as agreed — not merely discussed | HIGH |
| 3 | Mismatches table separates "client view" from "team view" in distinct columns | HIGH |
| 4 | Blockers are split into Client Side and Team Side — never mixed | HIGH |
| 5 | Slack summary is ≤50 lines and uses plain text only — no `*bold*` / `_italic_` markup (relies on emoji + `━━━` dividers for visual hierarchy) | MEDIUM |
| 6 | Summary prose is 3–5 sentences — not bullet points, not longer | MEDIUM |
| 7 | No invented data — every item traceable to the transcript | HIGH |
| 8 | Action items table includes Priority column populated for all rows using the deterministic deadline rule | MEDIUM |
| 9 | Next Meeting Agenda is present in both .md and Slack output; all items are traceable to an open mismatch, pending decision, or upcoming deadline — no fabricated topics | HIGH |
| 10 | All action item deadlines in the Slack block are absolute YYYY-MM-DD dates — no relative words like "today", "tomorrow", or "this week" | MEDIUM |
| 11 | Each blocker is on its own line in the Slack block with its own `Client →` or `Team →` prefix — never two blockers on one line | MEDIUM |

---

## Examples

### Example 1: Paste transcript

```bash
/mm --project "Artlive"
```
→ Prompts for transcript paste → Analyses → Writes `[MM] Artlive (2026-04-24).md` → Prints Slack summary

### Example 2: From file

```bash
/mm --project "Artlive" --source ".claude-project/meetings/transcript-2026-04-24.txt"
```
→ Reads the file → Analyses → Writes `.md` → Prints Slack summary

### Example 3: Override date

```bash
/mm --project "Artlive" --date "2026-04-21"
```
→ Uses April 21st as the meeting date regardless of today's date
→ Useful when processing a transcript from a past meeting
