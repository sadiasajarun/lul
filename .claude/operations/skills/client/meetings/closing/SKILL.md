---
name: closing
description: "Generate a branded HTML slide presentation for the final client closing meeting. Interviews the user for accomplishments, metrics, lessons, and warranty terms, then renders an 11-slide deck that reuses the kickoff CSS framework."
user-invocable: true
argument-hint: "[--project 'name'] [--client 'name'] [--lang 'ko|en'] [--date 'YYYY-MM-DD']"
---

# Closing Meeting Presentation Generator

Generate a branded, browser-based slide presentation for the **final client closing meeting** — the handover ceremony where the project is formally wrapped up.

Scope: this skill produces **only the closing meeting presentation HTML**. Internal close-out artifacts (developer handoff package, maintenance guide, repo cleanup, sign-off forms) are not part of this skill.

---

## Workflow Overview

```
┌──────────────────────┐
│ Step 1: Arguments    │  --project, --client, --lang, --date
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│ Step 2: Interview    │  accomplishments, metrics, lessons, warranty, thank-yous
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│ Step 3: Generate     │  11-slide HTML using kickoff CSS framework
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│ Step 4: QA (opt.)    │  Playwright MCP (skip if unavailable)
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│ Step 5: Report       │
└──────────────────────┘
```

---

## Step 1: Parse Arguments

Extract from `$ARGUMENTS`:

| Arg | Required | Default |
|-----|----------|---------|
| `--project` | No | Auto-detect from `package.json` `name` field, falling back to CWD folder name |
| `--client` | No | Ask in interview |
| `--lang` | No | `ko` |
| `--date` | No | Today's date in `YYYY-MM-DD` (the closing meeting date) |

No subcommands, no phase orchestration, no state file.

---

## Step 2: Interview (Collect Content)

Use `AskUserQuestion` in 2 rounds.

**Round 1 — Project summary:**

```
1. Project duration — start date → closing date (e.g., "2026-01-15 → 2026-04-20, 3 months")
2. Core team — PM / Dev Lead / Designer names
3. Scope delivered — 3-5 bullet points summarizing what shipped
4. Key metrics — optional numbers (commits, PRs merged, features shipped, uptime %, test coverage)
```

**Round 2 — Reflection & handover:**

```
1. Lessons learned — 2-3 bullets (what went well, what to improve)
2. Warranty period — e.g., "3 months post-launch for bug fixes"
3. Ongoing support contact — PM name + email/phone, or "via GitHub issues"
4. Next steps for client — what the client needs to do after today (credentials handover, domain renewals, etc.)
5. Thank-you message — optional custom closing note
```

Accept free-form text for all answers. Paste-friendly — PMs should be able to drop Slack excerpts or bullet lists directly.

---

## Step 3: Generate Presentation HTML

### 3.1 Output Location

Save the file at:

```
.claude-project/meetings/{ProjectName}/closing/[Closing] {ProjectName} ({YYYY-MM-DD}).html
```

Create parent directories if missing.

### 3.2 Slide Structure (11 slides)

| # | Slide | Content |
|---|-------|---------|
| 1 | Cover | "Closing Meeting" label, {ProjectName}, {ClientName}, {ClosingDate} |
| 2 | Index | Agenda for today's meeting (match slide titles below) |
| 3 | Project Summary | Duration, team, scope delivered (3-5 bullets from Round 1) |
| 4 | Key Accomplishments | Feature highlights (bullets/cards) |
| 5 | By the Numbers | Metrics grid — commits, PRs, features, uptime, coverage |
| 6 | Deliverables | What the client receives (code repo, design files, docs, credentials) |
| 7 | Lessons Learned | "What went well" + "What we'd improve" columns |
| 8 | Warranty & Support | Warranty period, contact, support channel |
| 9 | Next Steps for You | Action items for the client after today |
| 10 | Thank You | Team photo or brand visual, thank-you message |
| 11 | Q&A | Prompt for questions |

### 3.3 CSS & JS Framework

**Do not re-invent the styles.** Reuse the exact CSS + JS + logo SVG from [../kickoff/SKILL.md](../kickoff/SKILL.md) §4.3 (tokens) + §4.4 (CSS) + §4.6 (JS) + §4.7 (logo).

Use the same classes: `.slide`, `.slide-cover`, `.slide-title`, `.section-number`, `.task-card`, `.tasks-grid`, `.info-card`, `.agenda-list`, `.nav-bar`, `.nav-dot`, `.slide-counter`, `.chrome-btn`, `.theme-toggle`, `.fullscreen-btn`, `.slide-logo`.

Include the chrome markup block from kickoff §4.5 verbatim (theme toggle + fullscreen button + nav bar + slide counter). Nav dots auto-populate from `slides.length` — don't hand-write them.

This keeps kickoff / weekly / closing decks visually consistent (same Potential brand family), theme-aware (light/dark toggle + `prefers-color-scheme` honored), and accessible (`:focus-visible`, `prefers-reduced-motion`).

### 3.4 Language Toggle

- `--lang ko`: set `<html lang="ko" data-theme="light">`, use Korean copy
- `--lang en`: set `<html lang="en" data-theme="light">`, use English copy

The `data-theme` attribute is overridden at runtime by the theme-init IIFE (§4.6) — honors `localStorage.meetingTheme` → `prefers-color-scheme` → `light` in that order.

All user-facing strings (slide titles, labels, thank-you message) must respect the chosen language. Client-facing team honorifics and copy tone differ between ko and en — follow the same conventions as [../kickoff/SKILL.md](../kickoff/SKILL.md) and [../weekly/SKILL.md](../weekly/SKILL.md).

### 3.5 Branding

All brand values come from the canonical token set in [../kickoff/SKILL.md §4.3](../kickoff/SKILL.md) — reference `var(--…)` only, never raw hex.

- **Accent**: `var(--accent)` (→ `--brand-purple` in light, `--brand-lime` in dark)
- **Heading**: `var(--heading)`
- **Backgrounds**: `var(--bg)` / `var(--bg-soft)` / `var(--surface)`
- **Logo**: inline SVG from [kickoff/SKILL.md §4.7](../kickoff/SKILL.md) — text-based, `fill` driven by parent `.slide-logo` class. **Do not** reference `.claude/resources/brand/logo/` — external paths break after the global skill sync strips parent directories.
- **Font**: Plus Jakarta Sans from Google Fonts (preconnect + `display=swap`)

---

## Step 4: Playwright QA (Optional)

If Playwright MCP is available:

1. `page.goto(file://<absolute path>)`
2. Assert `document.querySelectorAll('.slide').length === 11`
3. Assert no broken image refs (every `<img>` either base64 or has valid src)
4. Screenshot slide 1 and slide 10 for spot-check

If Playwright MCP is unavailable, skip with a warning: "Playwright MCP not available — skipping auto-QA. Open the file in a browser to validate visually."

### 4.5 Pre-delivery Checklist (UI UX Pro Max rubric)

Run the full 13-point checklist from [../kickoff/SKILL.md §4.8](../kickoff/SKILL.md). Any HIGH fail blocks delivery.

**Closing-specific additions:**

| # | Check | Severity |
|---|---|---|
| C-1 | Slide 5 "By the Numbers" — when metrics present, each stat card uses `var(--accent)` for the number and `var(--muted)` for the label; when metrics absent, render qualitative bullets (per Error Handling) | HIGH |
| C-2 | Slide 7 "Lessons Learned" — two-column grid with `var(--ok)` accent on "What went well" and `var(--warn)` on "What we'd improve"; neither column uses `var(--err)` (closing tone stays forward-looking) | MEDIUM |
| C-3 | Slide 8 "Warranty & Support" — contact email is a real `<a href="mailto:…">`, not plain text, and receives focus ring | HIGH |
| C-4 | Slide 10 "Thank You" — honors selected `--lang`; never renders the default English fallback when `--lang ko` is set | MEDIUM |
| C-5 | No reference to `.claude/resources/…` anywhere in the emitted HTML (verify via grep — would break after global sync) | HIGH |

---

## Step 5: Report Result

```
Closing presentation generated successfully.

File: .claude-project/meetings/{ProjectName}/closing/[Closing] {ProjectName} ({YYYY-MM-DD}).html
Size: [SIZE] KB
Slides: 11
Language: [ko|en]

Open in a browser to present. Keyboard: ← → for navigation, F for fullscreen.
```

---

## Error Handling

| Scenario | Action |
|----------|--------|
| `--project` not provided and no `package.json` | Ask via AskUserQuestion |
| `--client` not provided | Ask via AskUserQuestion |
| User skips metrics in Round 1 | Render Slide 5 ("By the Numbers") with qualitative bullets instead of a number grid |
| User skips thank-you custom note | Use a default: "Thank you for trusting Potential Inc with {ProjectName}." |
| Logo asset missing | Use the inline text SVG from kickoff §4.7 (there is no external asset fallback — inline SVG is the only path) |
| Playwright MCP unavailable | Skip Step 4, warn user |

---

## Examples

### Example 1: Full invocation

```bash
/closing --project "Blink" --client "오누이" --lang ko --date 2026-04-20
```

→ Output: `.claude-project/meetings/Blink/closing/[Closing] Blink (2026-04-20).html`

### Example 2: Minimal (auto-detect)

```bash
/closing
```

→ Auto-detects project from `package.json`, asks for client name + content, defaults to `--lang ko` and today's date.

### Example 3: English

```bash
/closing --project "Health App" --client "HealthCo" --lang en
```

→ All slide copy in English, `<html lang="en">`.

---

## Design Principles

1. **One deliverable only** — the HTML presentation. Nothing else.
2. **Consistent family** — reuse kickoff / weekly CSS and slide shape so all three client meeting materials look like one deck series.
3. **Client-facing tone** — this is the handover ceremony, not an internal retrospective. Keep lessons-learned positive and forward-looking.
4. **No destructive ops** — this skill never touches git, never writes to repo root, never modifies anything outside `.claude-project/meetings/{ProjectName}/closing/`.
