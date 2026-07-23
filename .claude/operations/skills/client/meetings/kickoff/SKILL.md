---
name: kickoff
description: "Generate a branded HTML slide presentation for client kick-off meetings. Collects project info via interview, then generates a navigable browser-based presentation with Potential INC branding."
user-invocable: true
argument-hint: "[--project 'name'] [--client 'name']"
---

# Kickoff Meeting Presentation Generator

Generate a branded, browser-based slide presentation for client kick-off meetings. The presentation introduces "how we will work" after the contract is signed.

---

## Workflow Overview

```
┌─────────────────────┐
│  Step 1              │
│  Interview           │
│  (Collect Info)      │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Step 2              │
│  Auto-generate       │
│  Timeline & Tasks    │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Step 3              │
│  Confirm Summary     │
│  (Brief review)      │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Step 4              │
│  Generate HTML       │
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│  Step 5              │
│  Report Result       │
└─────────────────────┘
```

---

## Step 1: Interview (Collect Project Info)

### 1.1 Parse Arguments

Extract from `$ARGUMENTS`:
- **--project**: Project name (e.g., "Activity Coaching")
- **--client**: Client name with honorific (e.g., "김철수 대표님")

### 1.2 Collect Required Info

Use AskUserQuestion to collect missing information. Ask as few rounds as possible by grouping questions.

**Round 1 — Project Basics** (skip any already provided via arguments):

1. **Project name** — "What is the project name?"
2. **Client name** — "Client name with title/honorific? (e.g., 김철수 대표님)"
3. **Tech stack** — "Select tech stack (can combine multiple):"
   - React + NestJS (web)
   - React Native + NestJS (mobile)
   - React + Django (web)
   - React Native + Django (mobile)
   - Custom (specify)
4. **Project duration** — "Project start and end month? (e.g., 2026.04 ~ 2026.07)"

**Round 2 — Team Members:**

The following members are **always included** (do not ask):
- CEO: Lukas
- CTO: Siam
- COO: Jayden

Ask for the remaining project team members:
```
Who are the team members for this project?
(Typical roles: PM, Designer, Backend, Frontend, QA — provide name and role)

Example:
- PM: 김민수
- Designer: 이지은
- Backend: 박준혁
- Frontend: 최서연
- QA: 정하늘
```

Multiple people can share the same role, or roles can be omitted if not needed.

**Round 3 — Phase Breakdown:**

Ask the user to define phases and their week ranges. Provide a pre-filled example based on the project duration:

```
Please confirm or adjust the phase breakdown (week ranges):

1. PM / Planning: 1-2주
2. Design: 2-4주
3. DB / Backend: 3-8주
4. Frontend: 5-10주
5. Testing / QA: 9-12주
6. Deploy: 11-12주
```

The number of total weeks is auto-calculated from the project duration. Adjust the example accordingly.

---

## Step 2: Auto-generate Timeline & Weekly Tasks

### 2.1 Generate Timeline

From the phase breakdown, create a Gantt-style timeline mapping phases to weeks/months.

### 2.2 Generate Weekly Tasks

Auto-generate weekly task descriptions from the phase breakdown. Rules:
- Each week lists the active phases and their key deliverables
- Overlap weeks show multiple active phases
- Use concise task descriptions

Example output for a 12-week project:
```
Week 1: PM - Requirements gathering, Scope definition
Week 2: PM - PRD finalization, Design - Wireframe start
Week 3: Design - UI Design, DB - Schema design
Week 4: Design - Design review, Backend - API development start
...
Week 12: QA - Final testing, Deploy - Production release
```

---

## Step 3: Confirm Summary

Present a brief summary to the user for confirmation before generating:

```
## Kick-off Presentation Summary

- Project: [PROJECT_NAME]
- Client: [CLIENT_NAME]
- Team: Lukas (CEO), Siam (CTO), Jayden (COO), [PROJECT_MEMBERS]
- Tech Stack: [TECH_STACK]
- Duration: [START] ~ [END] ([N] weeks)
- Phases: [PHASE_SUMMARY]

Proceed with generation? (Y/adjust)
```

If the user wants adjustments, collect corrections and update. Otherwise, proceed to Step 4.

---

## Step 4: Generate HTML Presentation

### 4.1 Output Location

**Directory**: `.claude-project/meetings/{ProjectName}/kickoff/`
**Filename**: `[Kickoff] {ProjectName}.html`

### 4.2 Slide Structure

The presentation consists of the following slides:

| # | Slide | Content |
|---|-------|---------|
| 1 | Cover | Project name, client name, Copyright |
| 2 | Team | Team members with roles (fixed + project-specific) |
| 3 | Index | Table of contents (clickable) |
| 4 | Tech Stack | Selected technologies with icons |
| 5 | Timeline | Gantt chart visualization |
| 6 | Weekly Tasks | Week-by-week task breakdown |
| 7 | Communication | Slack + pm.potentialai.com |
| 8 | Deliverables | PRD, Swagger |
| 9 | Meeting Agenda | Discussion items, decisions |
| 10 | Q&A | Question & answer slide |
| 11 | Thank You | Contact info, closing |

### 4.3 Brand Guidelines — Canonical Tokens

All generated CSS references these custom properties so the deck supports a **runtime light/dark theme toggle** (button + `T` keybinding, persisted to `localStorage.meetingTheme`, initial value honors `prefers-color-scheme`). Primitives match the proposal deck (`proposal-template.html`) — one Potential brand system across every client-facing material.

**Never emit raw hex values outside `:root` / `[data-theme]` blocks.** If a slide needs a color, reference a token.

```css
:root {
  /* Brand primitives — shared across themes */
  --brand-purple: #5C4EFF;
  --brand-lime:   #DDFE52;
  --brand-navy:   #050042;

  /* Phase palette (gantt + timeline) */
  --phase-discovery: #8B7AFF;
  --phase-design:    #5C4EFF;
  --phase-dev:       #4834CC;
  --phase-qa:        #A594FF;
  --phase-launch:    #C4BAFF;

  /* Status */
  --ok: #10B981; --warn: #F59E0B; --err: #EF4444;

  /* Typography */
  --font-sans: 'Plus Jakarta Sans', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
  --w-body: 400; --w-medium: 500; --w-bold: 700; --w-black: 900;

  /* Spacing (4-pt scale) */
  --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-6: 24px;
  --s-8: 32px; --s-10: 40px; --s-14: 56px; --s-16: 64px;

  /* Radii & motion */
  --r-sm: 6px; --r-md: 12px; --r-lg: 16px; --r-xl: 24px;
  --ease-slide: cubic-bezier(0.4, 0, 0.2, 1);
  --dur-slide: 500ms;
  --dur-theme: 200ms;
}

[data-theme="light"] {
  --bg: #ffffff;
  --bg-soft: #f8f7ff;
  --surface: #ffffff;
  --border: rgba(92, 78, 255, 0.12);
  --heading: #050042;
  --body: #333333;
  --muted: #6b7280;
  --accent: var(--brand-purple);
  --accent-contrast: var(--brand-purple);
  --accent-glow: rgba(92, 78, 255, 0.15);
  --on-accent: #ffffff;
  --nav-bg: rgba(5, 0, 66, 0.95);
  --nav-dot-idle: rgba(255, 255, 255, 0.55);   /* AA-compliant on --nav-bg */
}

[data-theme="dark"] {
  --bg: #050505;
  --bg-soft: #0A0A0A;
  --surface: rgba(255, 255, 255, 0.03);
  --border: rgba(255, 255, 255, 0.08);
  --heading: #ffffff;
  --body: rgba(255, 255, 255, 0.82);
  --muted: rgba(255, 255, 255, 0.58);
  --accent: var(--brand-lime);                 /* lime pops on dark */
  --accent-contrast: var(--brand-lime);
  --accent-glow: rgba(221, 254, 82, 0.18);
  --on-accent: #050505;
  --nav-bg: rgba(255, 255, 255, 0.06);
  --nav-dot-idle: rgba(255, 255, 255, 0.55);
}
```

| Token group | Use for |
|---|---|
| `--bg`, `--bg-soft`, `--surface` | Slide backgrounds, card fills |
| `--heading`, `--body`, `--muted` | Typography hierarchy |
| `--accent`, `--on-accent` | Interactive elements, emphasis, badge fills |
| `--phase-*` | Gantt bars, timeline swatches — **required** (no hardcoded phase colors) |
| `--ok`, `--warn`, `--err` | Status pills, deadline tags |

### 4.4 HTML Template

Generate a single self-contained HTML file with embedded CSS and JS. The presentation must support:
- **Keyboard navigation**: Left/Right arrow keys to switch slides
- **Click navigation**: Bottom dot indicators
- **Slide counter**: "3 / 10" format
- **Fullscreen**: F key or button to toggle fullscreen
- **Smooth transitions**: Slide or fade animation
- **Print-friendly**: Each slide maps to one page when printed
- **Responsive**: Works on projector resolutions

> **IMPORTANT**: The HTML file must be completely self-contained (no external dependencies except Google Fonts). All CSS, JS, and SVG assets must be inline.

```html
<!DOCTYPE html>
<html lang="ko" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>[Kickoff] [PROJECT_NAME]</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        /* === Design tokens (see §4.3) === */
        :root {
            --brand-purple: #5C4EFF; --brand-lime: #DDFE52; --brand-navy: #050042;
            --phase-discovery: #8B7AFF; --phase-design: #5C4EFF; --phase-dev: #4834CC;
            --phase-qa: #A594FF; --phase-launch: #C4BAFF;
            --ok: #10B981; --warn: #F59E0B; --err: #EF4444;
            --font-sans: 'Plus Jakarta Sans', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
            --w-body: 400; --w-medium: 500; --w-bold: 700; --w-black: 900;
            --r-sm: 6px; --r-md: 12px; --r-lg: 16px; --r-xl: 24px;
            --ease-slide: cubic-bezier(0.4, 0, 0.2, 1);
            --dur-slide: 500ms; --dur-theme: 200ms;
        }
        [data-theme="light"] {
            --bg: #ffffff; --bg-soft: #f8f7ff; --surface: #ffffff;
            --border: rgba(92, 78, 255, 0.12);
            --heading: #050042; --body: #333333; --muted: #6b7280;
            --accent: var(--brand-purple); --accent-glow: rgba(92, 78, 255, 0.15);
            --on-accent: #ffffff;
            --nav-bg: rgba(5, 0, 66, 0.95); --nav-dot-idle: rgba(255, 255, 255, 0.55);
        }
        [data-theme="dark"] {
            --bg: #050505; --bg-soft: #0A0A0A;
            --surface: rgba(255, 255, 255, 0.03);
            --border: rgba(255, 255, 255, 0.08);
            --heading: #ffffff; --body: rgba(255, 255, 255, 0.82); --muted: rgba(255, 255, 255, 0.58);
            --accent: var(--brand-lime); --accent-glow: rgba(221, 254, 82, 0.18);
            --on-accent: #050505;
            --nav-bg: rgba(255, 255, 255, 0.06); --nav-dot-idle: rgba(255, 255, 255, 0.55);
        }

        /* === Reset & base === */
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { color-scheme: light dark; }
        body {
            font-family: var(--font-sans);
            background: var(--bg);
            color: var(--body);
            overflow: hidden;
            width: 100vw;
            height: 100vh;
            transition: background var(--dur-theme) ease, color var(--dur-theme) ease;
        }

        /* === Slide container === */
        .slides-container { width: 100vw; height: 100vh; position: relative; overflow: hidden; }

        .slide {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            display: flex; flex-direction: column;
            justify-content: center; align-items: center;
            padding: 60px 80px;
            opacity: 0;
            transform: translateX(100%);
            transition: opacity var(--dur-slide) var(--ease-slide),
                        transform var(--dur-slide) var(--ease-slide),
                        background var(--dur-theme) ease;
            background: var(--bg);
            color: var(--body);
        }
        .slide.active { opacity: 1; transform: translateX(0); }
        .slide.prev   { opacity: 0; transform: translateX(-100%); }

        /* === Cover + Thank-you (theme-aware, shared formula) ===
           Both slides use var(--bg) so they truly respect the active theme
           instead of forcing a purple gradient. Brand identity comes from the
           centered .cover-mark (real Potential icon) + decorative glow orbs.
           Purple gradient bg removed — it was the same in light/dark and
           made cover/thankyou feel disconnected from content slides. */
        .slide-cover, .slide-thankyou {
            background: var(--bg);
            color: var(--heading);
            text-align: center;
            overflow: hidden;
        }
        .slide-cover::before, .slide-thankyou::before {
            content: ''; position: absolute;
            top: -20%; right: -10%;
            width: 60vw; height: 60vw;
            background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
            filter: blur(60px);
            pointer-events: none; z-index: 0;
        }
        .slide-cover::after, .slide-thankyou::after {
            content: ''; position: absolute;
            bottom: -30%; left: -20%;
            width: 70vw; height: 70vw;
            background: radial-gradient(circle, rgba(92, 78, 255, 0.18) 0%, transparent 70%);
            filter: blur(80px);
            pointer-events: none; z-index: 0;
        }
        [data-theme="dark"] .slide-cover::after,
        [data-theme="dark"] .slide-thankyou::after {
            background: radial-gradient(circle, rgba(92, 78, 255, 0.28) 0%, transparent 70%);
        }
        .slide-cover > *, .slide-thankyou > * { position: relative; z-index: 1; }

        /* Large centered brand mark (real Potential icon, not text) */
        .cover-mark {
            width: 128px; height: auto;
            margin-bottom: 40px;
            color: var(--accent);
            display: inline-block;
        }
        .cover-mark svg { width: 100%; height: auto; display: block; }
        .cover-mark svg path { fill: currentColor; }

        .slide-cover .project-label {
            font-size: 13px; font-weight: var(--w-bold);
            letter-spacing: 8px; text-transform: uppercase;
            color: var(--accent);
            margin-bottom: 36px;
        }
        .slide-cover .project-name {
            font-size: 92px; font-weight: var(--w-black);
            color: var(--heading);
            letter-spacing: -1px; margin-bottom: 28px; line-height: 1.05;
        }
        .slide-cover .client-name {
            font-size: 28px; font-weight: var(--w-medium);
            color: var(--body); margin-bottom: 12px;
        }
        .slide-cover .project-date {
            font-size: 18px; color: var(--muted);
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            letter-spacing: 2px;
        }
        .slide-cover .copyright,
        .slide-thankyou .copyright {
            position: absolute; bottom: 56px; left: 50%;
            transform: translateX(-50%);
            font-size: 12px; color: var(--muted);
            letter-spacing: 1px;
            z-index: 1;
        }

        /* === Section title === */
        .slide h1.slide-title {
            font-size: 44px; font-weight: var(--w-bold);
            color: var(--heading);
            margin-bottom: 40px; align-self: flex-start;
            line-height: 1.2;
        }
        .slide .section-number {
            font-size: 96px; font-weight: var(--w-black);
            color: var(--accent); opacity: 0.15;
            position: absolute; top: 40px; left: 80px;
            pointer-events: none;
        }

        /* === Content === */
        .content-grid { display: grid; gap: 24px; width: 100%; }

        .tech-card {
            background: var(--bg-soft);
            border-radius: var(--r-lg);
            padding: 36px;
            display: flex; align-items: center; gap: 24px;
            border: 1px solid var(--border);
            color: var(--body);
        }
        .tech-card .tech-icon {
            width: 64px; height: 64px;
            background: var(--accent);
            border-radius: 14px;
            display: flex; align-items: center; justify-content: center;
            color: var(--on-accent);
            font-size: 28px; font-weight: var(--w-bold);
            flex-shrink: 0;
        }
        .tech-card .tech-info h3 {
            font-size: 24px; font-weight: var(--w-bold);
            color: var(--heading); margin-bottom: 6px;
        }
        .tech-card .tech-info p {
            font-size: 17px; color: var(--muted);
            line-height: 1.6; max-width: 65ch;
        }

        /* === Team slide === */
        .team-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 24px; width: 100%; max-width: 900px;
        }
        .team-member { text-align: center; padding: 24px 16px; }
        .team-avatar {
            width: 88px; height: 88px; border-radius: 50%;
            background: var(--accent);
            display: flex; align-items: center; justify-content: center;
            margin: 0 auto 14px;
            color: var(--on-accent);
            font-size: 32px; font-weight: var(--w-bold);
        }
        .team-avatar.executive { background: var(--brand-navy); color: #ffffff; }
        [data-theme="dark"] .team-avatar.executive { background: var(--brand-purple); }
        .team-member .member-name { font-size: 22px; font-weight: var(--w-bold); color: var(--heading); margin-bottom: 6px; }
        .team-member .member-role { font-size: 17px; font-weight: var(--w-medium); color: var(--accent); }
        .team-divider { width: 100%; max-width: 900px; border: none; border-top: 1px solid var(--border); margin: 8px 0 16px; }
        .team-section-label {
            font-size: 15px; font-weight: 600; color: var(--muted);
            text-transform: uppercase; letter-spacing: 2px;
            margin-bottom: 18px; align-self: flex-start;
            max-width: 900px; width: 100%;
        }

        /* === Timeline (Gantt) === */
        .gantt-container { width: 100%; overflow-x: auto; }
        .gantt-table { width: 100%; border-collapse: collapse; font-size: 16px; }
        .gantt-table th {
            padding: 14px 4px; text-align: center;
            font-weight: 600; color: var(--heading);
            border-bottom: 2px solid var(--accent);
            font-size: 13px;
        }
        .gantt-table th.phase-col { text-align: left; padding-left: 16px; width: 180px; min-width: 180px; }
        .gantt-table td {
            padding: 12px 4px; text-align: center;
            border-bottom: 1px solid var(--border);
            position: relative;
        }
        .gantt-table td.phase-name {
            text-align: left; padding-left: 16px;
            font-weight: 600; color: var(--heading);
            white-space: nowrap;
        }
        .gantt-bar {
            height: 32px; border-radius: var(--r-sm);
            position: absolute; top: 50%; left: 2px; right: 2px;
            transform: translateY(-50%);
        }
        /* Phase bars reference tokens only (no hardcoded hex) */
        .gantt-bar.pm       { background: var(--phase-discovery); }
        .gantt-bar.design   { background: var(--phase-design); }
        .gantt-bar.backend  { background: var(--phase-dev); }
        .gantt-bar.frontend { background: var(--phase-qa); }
        .gantt-bar.qa       { background: var(--phase-qa); }
        .gantt-bar.deploy   { background: var(--phase-launch); }

        /* === Weekly tasks === */
        .tasks-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 16px; width: 100%;
            max-height: calc(100vh - 180px); overflow-y: auto;
        }
        .task-card {
            background: var(--bg-soft);
            border-radius: var(--r-md); padding: 28px;
            border-left: 4px solid var(--accent);
        }
        .task-card .week-label {
            font-size: 15px; font-weight: var(--w-bold);
            color: var(--accent);
            text-transform: uppercase; letter-spacing: 1px;
            margin-bottom: 10px;
        }
        .task-card .task-list {
            font-size: 17px; color: var(--body);
            line-height: 1.6; max-width: 65ch;
        }

        /* === Info cards (Communication / Deliverables) === */
        .info-cards { display: flex; gap: 32px; width: 100%; }
        .info-card {
            flex: 1;
            background: var(--bg-soft);
            border-radius: var(--r-lg); padding: 40px;
            text-align: center;
            border: 1px solid var(--border);
        }
        .info-card .card-icon {
            width: 72px; height: 72px;
            background: var(--accent);
            border-radius: var(--r-lg);
            display: flex; align-items: center; justify-content: center;
            margin: 0 auto 24px;
            color: var(--on-accent);
            font-size: 32px;
        }
        .info-card h3 { font-size: 24px; font-weight: var(--w-bold); color: var(--heading); margin-bottom: 12px; }
        .info-card p  { font-size: 19px; color: var(--muted); line-height: 1.7; max-width: 55ch; margin: 0 auto; }
        .info-card a  { color: var(--accent); text-decoration: none; font-weight: 600; }
        .info-card a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

        /* === Agenda === */
        .agenda-list { width: 100%; max-width: 700px; }
        .agenda-item {
            display: flex; align-items: center; gap: 24px;
            padding: 24px 0;
            border-bottom: 1px solid var(--border);
        }
        .agenda-item .agenda-num {
            width: 48px; height: 48px;
            background: var(--accent);
            color: var(--on-accent);
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-weight: var(--w-bold); font-size: 20px;
            flex-shrink: 0;
        }
        .agenda-item .agenda-text {
            font-size: 26px; color: var(--heading);
            font-weight: var(--w-medium);
        }

        /* === Q&A === */
        .slide-qa {
            background: linear-gradient(135deg, var(--bg-soft) 0%, var(--bg) 100%);
            text-align: center;
        }
        .slide-qa .qa-title {
            font-size: 96px; font-weight: var(--w-black);
            color: var(--accent); margin-bottom: 20px;
        }
        .slide-qa .qa-sub { font-size: 28px; color: var(--muted); }

        /* === Thank-you text (background + mark handled together with .slide-cover above) === */
        .slide-thankyou .thankyou-title {
            font-size: 88px; font-weight: var(--w-black);
            color: var(--heading);
            margin-bottom: 24px; letter-spacing: 8px;
        }
        .slide-thankyou .contact-email {
            font-size: 22px; color: var(--accent);
            font-weight: var(--w-medium);
            margin-bottom: 16px;
        }

        /* === Navigation bar === */
        .nav-bar {
            position: fixed; bottom: 0; left: 0; right: 0;
            height: 48px;
            background: var(--nav-bg);
            display: flex; align-items: center; justify-content: center;
            gap: 12px; z-index: 100;
            backdrop-filter: blur(10px);
            transition: background var(--dur-theme) ease;
        }

        /* Nav dot: visual 10px, hit-target 44×44 (WCAG 2.5.5) */
        .nav-dot {
            position: relative;
            width: 10px; height: 10px;
            border-radius: 50%;
            background: var(--nav-dot-idle);
            cursor: pointer;
            transition: background 0.3s, width 0.3s;
            border: none; padding: 0;
        }
        .nav-dot::before {
            content: ''; position: absolute;
            inset: -17px;                  /* extends hit area */
        }
        .nav-dot.active {
            background: var(--accent);
            width: 28px; border-radius: 5px;
        }
        .nav-dot:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 4px;
        }

        .slide-counter {
            position: fixed; bottom: 56px; right: 24px;
            font-size: 13px;
            color: var(--muted);
            font-weight: var(--w-medium);
            z-index: 100;
        }

        /* === Chrome buttons (top-right cluster) === */
        .chrome-btn {
            position: fixed; top: 16px;
            width: 36px; height: 36px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--r-sm);
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            z-index: 100;
            color: var(--heading);
            transition: background var(--dur-theme) ease, transform var(--dur-theme) ease;
        }
        .chrome-btn:hover  { transform: translateY(-1px); }
        .chrome-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .chrome-btn svg    { width: 18px; height: 18px; }
        .theme-toggle      { right: 64px; }
        .fullscreen-btn    { right: 16px; font-size: 16px; }
        .theme-toggle .ico-moon { display: none; }
        [data-theme="dark"] .theme-toggle .ico-sun  { display: none; }
        [data-theme="dark"] .theme-toggle .ico-moon { display: block; }

        /* === Potential logo (top-left on content slides) === */
        /* Top-left wordmark lockup on content slides (not cover/thankyou).
           Mark paths use class .mk → accent; text uses class .wm → heading.
           Both adapt to theme automatically. */
        .slide-logo { position: absolute; top: 24px; left: 40px; }
        .slide-logo svg { width: 132px; height: auto; }
        .slide-logo svg .mk { fill: var(--accent); }
        .slide-logo svg .wm { fill: var(--heading); }

        /* === Responsive breakpoints === */
        @media (max-width: 1366px) {
            .slide { padding: 40px 56px; }
            .slide .section-number { font-size: 72px; top: 28px; left: 56px; }
            .slide h1.slide-title  { font-size: 36px; margin-bottom: 28px; }
            .slide-cover .project-name { font-size: 64px; }
            .slide-cover .client-name  { font-size: 32px; }
            .tech-card { padding: 28px; }
            .info-card { padding: 32px; }
        }
        @media (max-width: 900px) {
            .slide { padding: 28px 32px; }
            .slide .section-number { font-size: 56px; top: 20px; left: 32px; }
            .slide h1.slide-title  { font-size: 28px; margin-bottom: 20px; }
            .team-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 16px; }
            .team-avatar { width: 64px; height: 64px; font-size: 24px; }
            .info-cards  { flex-direction: column; gap: 16px; }
            .tasks-grid  { grid-template-columns: 1fr; }
            .slide-cover .project-name { font-size: 44px; letter-spacing: 1px; }
            .slide-cover .client-name  { font-size: 24px; }
            .slide-cover .project-date { font-size: 18px; }
        }

        /* === Focus visibility (global safety net) === */
        :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }

        /* === Reduced motion === */
        @media (prefers-reduced-motion: reduce) {
            *, *::before, *::after {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.01ms !important;
                scroll-behavior: auto !important;
            }
            .slide { transform: none !important; }
            .slide:not(.active) { opacity: 0 !important; visibility: hidden; }
            .slide.active { opacity: 1 !important; visibility: visible; }
        }

        /* === Print === */
        @media print {
            body { overflow: visible; background: #ffffff; color: #000; }
            :root, [data-theme="dark"] {   /* force light palette for print */
                --bg: #ffffff; --bg-soft: #f8f7ff; --surface: #ffffff;
                --heading: #050042; --body: #333333; --muted: #6b7280;
                --accent: var(--brand-purple); --on-accent: #ffffff;
            }
            .slides-container { height: auto; overflow: visible; }
            .slide {
                position: relative; transform: none; opacity: 1;
                page-break-after: always; height: 100vh;
            }
            .slide.prev { transform: none; opacity: 1; }
            .nav-bar, .slide-counter, .chrome-btn { display: none; }
        }
    </style>
</head>
<body>
```

> The template above provides the CSS framework. When generating, produce the complete HTML with all slide content filled in. See Section 4.5 for slide content templates.

### 4.5 Slide Content Templates

#### Slide 1: Cover

The cover is theme-aware: its background is `var(--bg)` (white in light, near-black in dark). Brand identity comes from the centered `.cover-mark` (real Potential icon, `var(--accent)` color) and decorative purple + accent glow orbs — not a purple gradient. Do **not** add a `.slide-logo` here; the big centered mark replaces the small top-left logo.

```html
<div class="slide slide-cover active" data-slide="0">
    <div class="cover-mark">
        <!-- Real Potential icon — see §4.7 for the full SVG -->
        [POTENTIAL_MARK_SVG]
    </div>
    <div class="project-label">KICKOFF MEETING</div>
    <h1 class="project-name">[PROJECT_NAME]</h1>
    <div class="project-date">[START_MONTH] ~ [END_MONTH]</div>
    <div class="copyright">Copyright [YEAR]. Potential INC. All rights reserved</div>
</div>
```

The cover intentionally omits the client's name — the client already knows who they are, and the cover reads cleaner with just the project name + dates. Keep `[CLIENT_NAME]` captured internally for later slides (e.g. greetings, agenda) if needed.

**Heading semantics (all content slides):** emit the slide title as `<h1 class="slide-title">…</h1>`. Screen readers announce one `h1` per active slide. Decorative `.section-number` (e.g. `02`) stays in a `<div aria-hidden="true">` so it is not read out.

#### Chrome markup (once, outside `.slides-container`)

Add this block inside `<body>` — the nav bar, counter, theme toggle, and fullscreen button live **outside** the slide container so they stay fixed during transitions:

```html
<button class="chrome-btn theme-toggle" type="button" aria-label="Toggle light/dark theme" aria-pressed="false" title="Toggle theme (T)">
    <svg class="ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
    <svg class="ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
</button>
<button class="chrome-btn fullscreen-btn" type="button" aria-label="Toggle fullscreen" title="Fullscreen (F)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
</button>

<nav class="nav-bar" aria-label="Slide navigation">
    <!-- One .nav-dot per slide: <button class="nav-dot" type="button" aria-label="Go to slide N"></button> -->
</nav>
<div class="slide-counter" aria-live="polite">1 / 11</div>
```

#### Slide 2: Team
```html
<div class="slide" data-slide="1">
    <div class="slide-logo"><!-- LOGO_SVG --></div>
    <div class="section-number" aria-hidden="true">02</div>
    <h1 class="slide-title">Team</h1>

    <div class="team-section-label">Leadership</div>
    <div class="team-grid">
        <div class="team-member">
            <div class="team-avatar executive">L</div>
            <div class="member-name">Lukas</div>
            <div class="member-role">CEO</div>
        </div>
        <div class="team-member">
            <div class="team-avatar executive">S</div>
            <div class="member-name">Siam</div>
            <div class="member-role">CTO</div>
        </div>
        <div class="team-member">
            <div class="team-avatar executive">J</div>
            <div class="member-name">Jayden</div>
            <div class="member-role">COO</div>
        </div>
    </div>

    <hr class="team-divider">

    <div class="team-section-label">Project Team</div>
    <div class="team-grid">
        <!-- Repeat for each project team member -->
        <div class="team-member">
            <div class="team-avatar">[INITIAL]</div>
            <div class="member-name">[NAME]</div>
            <div class="member-role">[ROLE]</div>
        </div>
    </div>
</div>
```

The avatar shows the first character of the member's name. For Korean names, use the first syllable. For English names, use the first letter.
- Executive avatars use `.team-avatar.executive` — fills with `var(--brand-navy)` in light theme, `var(--brand-purple)` in dark
- Project team avatars use `.team-avatar` — fills with `var(--accent)` (purple in light, lime in dark)

#### Slide 3: Index
Content slide listing all sections (01~08) as a vertical list. Each item shows the section number and title. Style with `.agenda-list` / `.agenda-item` pattern.

Sections:
```
01  Team
02  Tech Stack
03  Timeline
04  Weekly Tasks
05  Communication
06  Deliverables
07  Meeting Agenda
08  Q&A
```

#### Slide 4: Tech Stack
Display selected technologies as `.tech-card` items in a grid.

Tech icon mappings (use first letter as icon text):
| Tech | Icon Letter | Description |
|------|-------------|-------------|
| React | R | Frontend Web Framework |
| React Native | RN | Cross-platform Mobile Framework |
| NestJS | N | Backend API Framework (Node.js) |
| Django | D | Backend API Framework (Python) |
| PostgreSQL | P | Relational Database |
| TypeScript | TS | Primary Language |

Always include PostgreSQL and TypeScript alongside the user's selection.

#### Slide 5: Timeline (Gantt Chart)
Render a `.gantt-table` with:
- Columns: Phase name + one column per week (grouped by month headers)
- Rows: One per phase (PM, Design, DB/Backend, Frontend, QA, Deploy)
- Colored bars spanning the active weeks for each phase

Use `colspan` for month groupings in the header row.

#### Slide 6: Weekly Tasks
Render `.task-card` items in a `.tasks-grid`. Each card shows:
- Week number label
- Comma-separated list of active tasks for that week

If the project exceeds 12 weeks, split into two slides (Weeks 1-12, Weeks 13+).

#### Slide 7: Communication
Two `.info-card` items side by side:

**Card 1 — Slack**
- Icon: `#` (hash symbol)
- Title: Slack
- Description: "Real-time communication channel for project updates, questions, and quick coordination."

**Card 2 — Project Dashboard**
- Icon: `📊` (or grid icon via SVG)
- Title: Project Dashboard
- Description: "Track project progress, milestones, and deliverables."
- Link: pm.potentialai.com

#### Slide 8: Deliverables
Two `.info-card` items:

**Card 1 — PRD**
- Title: PRD (Product Requirements Document)
- Description: "Comprehensive requirements document defining features, user stories, and acceptance criteria."

**Card 2 — Swagger**
- Title: Swagger (API Documentation)
- Description: "Interactive API documentation for all backend endpoints. Available after backend development phase."

#### Slide 9: Meeting Agenda
Standard agenda items using `.agenda-list`:
1. Project overview & scope confirmation
2. Tech stack & architecture
3. Timeline & milestones review
4. Communication & collaboration process
5. Q&A and open discussion

#### Slide 10: Q&A
```html
<div class="slide slide-qa" data-slide="9">
    <div class="qa-title">Q&A</div>
    <div class="qa-sub">Questions & Discussion</div>
</div>
```

#### Slide 11: Thank You

Matches cover: theme-aware background, centered `.cover-mark`, same glow orbs. No top-left logo — the large mark is the logo.

```html
<div class="slide slide-thankyou" data-slide="10">
    <div class="cover-mark">
        <!-- Real Potential icon — see §4.7 -->
        [POTENTIAL_MARK_SVG]
    </div>
    <h1 class="thankyou-title">THANK YOU</h1>
    <div class="contact-email">contact@potentialai.com</div>
    <div class="copyright">Copyright [YEAR]. Potential INC. All rights reserved</div>
</div>
```

### 4.6 JavaScript (Navigation + Theme Toggle)

Include at the bottom of `<body>`. Two IIFEs — one for the theme system (runs early to avoid FOUC), one for slide navigation.

```html
<script>
/* === Theme: runs FIRST to avoid flash-of-wrong-theme === */
(function() {
    const root = document.documentElement;
    const saved = localStorage.getItem('meetingTheme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', saved ?? (prefersDark ? 'dark' : 'light'));
})();

/* === Navigation === */
(function() {
    const slides = document.querySelectorAll('.slide');
    const counter = document.querySelector('.slide-counter');
    const nav = document.querySelector('.nav-bar');
    const themeBtn = document.querySelector('.theme-toggle');
    const fsBtn = document.querySelector('.fullscreen-btn');
    let current = 0;

    /* Auto-populate nav dots (one per slide) */
    if (nav && !nav.querySelector('.nav-dot')) {
        slides.forEach((_, i) => {
            const b = document.createElement('button');
            b.className = 'nav-dot';
            b.type = 'button';
            b.setAttribute('aria-label', 'Go to slide ' + (i + 1));
            b.addEventListener('click', () => goTo(i));
            nav.appendChild(b);
        });
    }

    function goTo(n) {
        if (n < 0 || n >= slides.length || n === current) return;
        slides.forEach((s, i) => {
            s.classList.remove('active', 'prev');
            if (i < n) s.classList.add('prev');
        });
        slides[n].classList.add('active');
        current = n;
        updateNav();
    }
    function next() { goTo(current + 1); }
    function prev() { goTo(current - 1); }

    function updateNav() {
        document.querySelectorAll('.nav-dot').forEach((d, i) => {
            d.classList.toggle('active', i === current);
            d.setAttribute('aria-current', i === current ? 'true' : 'false');
        });
        if (counter) counter.textContent = (current + 1) + ' / ' + slides.length;
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
    }

    function toggleTheme() {
        const root = document.documentElement;
        const nextTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', nextTheme);
        localStorage.setItem('meetingTheme', nextTheme);
        if (themeBtn) themeBtn.setAttribute('aria-pressed', nextTheme === 'dark');
    }

    document.addEventListener('keydown', (e) => {
        /* Ignore modifier keys to avoid hijacking OS shortcuts */
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
        else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
        else if (e.key === 't' || e.key === 'T') { e.preventDefault(); toggleTheme(); }
    });

    if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
    if (themeBtn) {
        themeBtn.setAttribute('aria-pressed', document.documentElement.getAttribute('data-theme') === 'dark');
        themeBtn.addEventListener('click', toggleTheme);
    }

    updateNav();
})();
</script>
```

**Key behaviors:**
- Theme script runs first inline so the correct `data-theme` is set before first paint (no flash).
- Nav dots are generated from `slides.length` — template authors don't hand-write one `<button>` per slide.
- `T` toggles theme, persists to `localStorage.meetingTheme`. `F` toggles fullscreen. Modifier keys (`⌘`, `⌃`, `⌥`) are ignored to avoid hijacking OS shortcuts.
- `aria-current="true"` on the active dot + `aria-live="polite"` on the counter keep screen readers in sync.

### 4.7 Logo SVG (inline, theme-aware)

Two logo assets — both inline, both theme-aware via `currentColor`. No external file reference (global-sync safe).

#### A. Brand Mark (icon-only) — for cover & thank-you

The real Potential geometric mark. Paths are inlined verbatim from `.claude/resources/brand/logo/potential_logo.svg`, with the hardcoded `fill="#624DFF"` removed so `.cover-mark { color: var(--accent); }` drives the fill via `currentColor`.

```svg
<svg viewBox="0 0 49 39" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Potential">
    <path d="M26.1264 30.228H12.4889C11.4431 30.228 10.4587 30.6176 9.72044 31.3559C8.98217 32.1147 8.57202 33.099 8.59253 34.1449C8.59253 36.2777 10.3972 38.0208 12.571 38.0208H22.3735C23.604 38.0208 24.7114 37.18 25.06 35.9906L26.5571 30.8022C26.5981 30.6586 26.5776 30.5151 26.4955 30.392C26.4135 30.2895 26.27 30.228 26.1264 30.228Z"/>
    <path d="M44.4597 22.7223H31.4579C30.4121 22.7223 29.4277 23.1119 28.6894 23.8502C27.9512 24.609 27.541 25.5933 27.541 26.6392C27.5615 28.772 29.3662 30.5151 31.54 30.5151H40.7068C41.9372 30.5151 43.0446 29.6743 43.3933 28.5054L44.8903 23.2965C44.9313 23.153 44.9108 23.0094 44.8083 22.9069C44.7263 22.7838 44.6032 22.7223 44.4597 22.7223Z"/>
    <path d="M46.0597 2.87104C44.2346 1.02537 41.8147 0 39.2308 0H30.146C29.0796 0 28.1157 0.717761 27.8286 1.74313L26.6802 5.72158C26.3726 6.76746 25.3882 7.50573 24.3013 7.50573H13.5554C11.3611 7.50573 9.55647 9.24886 9.53596 11.3816C9.53596 12.4275 9.94611 13.4119 10.6844 14.1501C11.4226 14.8884 12.407 15.2986 13.4529 15.2986H22.9273C24.1783 15.2986 25.2652 14.4578 25.6138 13.2683L26.7212 9.45394C27.0083 8.49009 27.9106 7.81335 28.9155 7.81335H37.6722C38.1644 7.81335 38.6565 8.01841 39.0052 8.36704C39.3538 8.71566 39.5179 9.14632 39.5179 9.59748C39.5179 10.0692 39.3333 10.4998 39.0052 10.8279C38.677 11.1766 38.2259 11.3611 37.7542 11.3611H29.7563C28.6899 11.3611 27.7261 12.0789 27.439 13.1043L26.2905 17.0622C25.9829 18.1081 25.0191 18.8464 23.9117 18.8464H3.89642C1.76364 18.8464 0 20.5895 0 22.7428C0 24.896 1.76364 26.6392 3.89642 26.6392H22.5377C23.7886 26.6392 24.896 25.8189 25.2242 24.6295L26.3316 20.7946C26.6187 19.8307 27.5005 19.1745 28.5054 19.1745H39.0667C44.3576 19.1745 48.7052 14.9499 48.8077 9.74104C48.8487 7.1571 47.8644 4.71671 46.0597 2.87104Z"/>
</svg>
```

Usage: wrap in `<div class="cover-mark">…</div>`. The container sets `color: var(--accent)` (purple in light, lime in dark) and the paths pick it up via `fill: currentColor`.

#### B. Wordmark (mark + "Potential" text) — for top-left of content slides

Small horizontal lockup. The `.slide-logo` CSS controls fill so the mark + text adapt to theme automatically (never hardcode a color on the SVG elements).

```svg
<svg width="132" height="28" viewBox="0 0 132 28" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Potential">
    <g transform="translate(0, 0) scale(0.55)">
        <path d="M26.1264 30.228H12.4889C11.4431 30.228 10.4587 30.6176 9.72044 31.3559C8.98217 32.1147 8.57202 33.099 8.59253 34.1449C8.59253 36.2777 10.3972 38.0208 12.571 38.0208H22.3735C23.604 38.0208 24.7114 37.18 25.06 35.9906L26.5571 30.8022C26.5981 30.6586 26.5776 30.5151 26.4955 30.392C26.4135 30.2895 26.27 30.228 26.1264 30.228Z" class="mk"/>
        <path d="M44.4597 22.7223H31.4579C30.4121 22.7223 29.4277 23.1119 28.6894 23.8502C27.9512 24.609 27.541 25.5933 27.541 26.6392C27.5615 28.772 29.3662 30.5151 31.54 30.5151H40.7068C41.9372 30.5151 43.0446 29.6743 43.3933 28.5054L44.8903 23.2965C44.9313 23.153 44.9108 23.0094 44.8083 22.9069C44.7263 22.7838 44.6032 22.7223 44.4597 22.7223Z" class="mk"/>
        <path d="M46.0597 2.87104C44.2346 1.02537 41.8147 0 39.2308 0H30.146C29.0796 0 28.1157 0.717761 27.8286 1.74313L26.6802 5.72158C26.3726 6.76746 25.3882 7.50573 24.3013 7.50573H13.5554C11.3611 7.50573 9.55647 9.24886 9.53596 11.3816C9.53596 12.4275 9.94611 13.4119 10.6844 14.1501C11.4226 14.8884 12.407 15.2986 13.4529 15.2986H22.9273C24.1783 15.2986 25.2652 14.4578 25.6138 13.2683L26.7212 9.45394C27.0083 8.49009 27.9106 7.81335 28.9155 7.81335H37.6722C38.1644 7.81335 38.6565 8.01841 39.0052 8.36704C39.3538 8.71566 39.5179 9.14632 39.5179 9.59748C39.5179 10.0692 39.3333 10.4998 39.0052 10.8279C38.677 11.1766 38.2259 11.3611 37.7542 11.3611H29.7563C28.6899 11.3611 27.7261 12.0789 27.439 13.1043L26.2905 17.0622C25.9829 18.1081 25.0191 18.8464 23.9117 18.8464H3.89642C1.76364 18.8464 0 20.5895 0 22.7428C0 24.896 1.76364 26.6392 3.89642 26.6392H22.5377C23.7886 26.6392 24.896 25.8189 25.2242 24.6295L26.3316 20.7946C26.6187 19.8307 27.5005 19.1745 28.5054 19.1745H39.0667C44.3576 19.1745 48.7052 14.9499 48.8077 9.74104C48.8487 7.1571 47.8644 4.71671 46.0597 2.87104Z" class="mk"/>
    </g>
    <text x="36" y="20" font-family="Plus Jakarta Sans, sans-serif" font-size="18" font-weight="800" class="wm">Potential</text>
</svg>
```

The matching `.slide-logo svg .mk` / `.wm` fill rules live in §4.4 — `.mk` → `var(--accent)` (purple in light, lime in dark), `.wm` → `var(--heading)` (navy in light, white in dark).

**Usage:**
- Cover & Thank-you: `<div class="cover-mark">…mark svg from A…</div>` (large, centered)
- All other slides (2–10): `<div class="slide-logo">…wordmark svg from B…</div>` (top-left, small)

### 4.8 Pre-delivery Checklist (UI UX Pro Max rubric)

Before reporting the deck to the user in Step 6, walk this checklist. Any **HIGH** fail blocks delivery — fix in the generated HTML and, if structural, propagate to §4.4 per Step 5.4 rules.

| # | Category | Check | Severity |
|---|---|---|---|
| 1 | Accessibility | Contrast ≥4.5:1 body / ≥3:1 large text in **both** themes (spot-check cover, task card, nav dot idle) | HIGH |
| 2 | Accessibility | Every slide has exactly one `<h1 class="slide-title">`; decorative numbers use `aria-hidden="true"` | HIGH |
| 3 | Accessibility | `:focus-visible` ring visible on every chrome button, nav dot, and in-slide link | HIGH |
| 4 | Accessibility | Icon-only buttons carry `aria-label` (theme toggle, fullscreen, nav dots) | HIGH |
| 5 | Touch & Interaction | Nav dots: visual 10 px, pseudo-element hit target ≥44×44 px (WCAG 2.5.5) | HIGH |
| 6 | Performance | Fonts loaded with `display=swap`; no `<img>` references external files; no layout shift when theme swaps | HIGH |
| 7 | Layout & Responsive | Renders clean at 1920×1080, 1366×768, 1024×768; no horizontal scroll on `.slide.active` | HIGH |
| 8 | Typography & Color | Line-height 1.5–1.7 on body copy; body paragraphs capped via `max-width: 65ch` | MEDIUM |
| 9 | Typography & Color | Every color value is a `var(--…)` token — grep the deck for raw hex outside `:root` / `[data-theme]` blocks | MEDIUM |
| 10 | Animation | Slide transition 500 ms, theme swap 200 ms; `prefers-reduced-motion: reduce` disables both | MEDIUM |
| 11 | Style Selection | Icons are inline SVG (Lucide stroke style); **no emoji** in final client deck | MEDIUM |
| 12 | Style Selection | Theme toggle reflects current mode — sun visible in light, moon visible in dark | MEDIUM |
| 13 | Charts & Data | Gantt bars reference `--phase-*` tokens only (no raw hex); phase label table present for screen readers | LOW |

---

## Step 5: Playwright QA Verification (Auto)

After HTML generation, **automatically** verify the presentation using Playwright MCP before reporting to the user. This catches layout issues (overflow, clipping, element collision) that would otherwise surface only when the client opens the file.

### 5.1 Launch Browser

1. Navigate Playwright to the generated file: `file:///<absolute path to [Kickoff] PROJECT_NAME.html>`
2. Set viewport to **1920×1080** (Full HD projector standard)
3. Wait for network idle + 500ms for fonts to settle

### 5.2 Slide-by-Slide Inspection

For each slide from 0 to N-1:

1. Navigate to the slide:
   - Slide 0 is already active on load
   - Subsequent slides: click `.nav-dot[data-goto="N"]` or press `ArrowRight`
2. Wait 600ms for the transition animation to finish
3. Capture a full-page screenshot
4. Run DOM inspection (via Playwright `evaluate`):
   - **Vertical overflow**: `.slide.active` children extend below `window.innerHeight - 48px` (nav bar)
   - **Horizontal overflow**: any element `scrollWidth > clientWidth`
   - **Text clipping**: headings/paragraphs with `overflow: hidden` and truncated content
   - **Grid wrapping**: team/tech grid items breaking onto too many rows
   - **Nav-bar collision**: content covered by `.nav-bar`

### 5.3 Per-Slide Checklist

| Slide | Specific Checks |
|-------|-----------------|
| 1. Cover | `project-name` fits one line; `client-name` not wrapping mid-word; `project-date` visible above copyright |
| 2. Team | All members fit in grid without overflow; avatars not clipped; Leadership + Project Team both visible |
| 3. Index | All 8 sections visible without scroll |
| 4. Tech Stack | 2-column grid aligned; icons and text vertically centered in each card |
| 5. Timeline (Gantt) | All week columns visible; phase-col text not truncated; bars aligned to correct weeks |
| 6. Weekly Tasks | Cards fit grid; if too many → vertical scroll works; no horizontal scroll |
| 7. Communication | Two info-cards equal width; text fits in card |
| 8. Deliverables | Two info-cards equal width; text fits in card |
| 9. Meeting Agenda | All items visible without scroll |
| 10. Q&A | Centered; no overflow |
| 11. Thank You | Centered; copyright at bottom, not clipped |

### 5.4 Fix Issues

For each issue found, classify and apply the fix:

**Structural issue** (CSS/layout) → Fix in **BOTH** the generated HTML AND the skill template
- Examples: font-size too large causing wrap, grid column count wrong, padding misalignment, gap insufficient, max-width too small
- Propagate to: `~/.claude/skills/kickoff/skill.md` (section 4.4 CSS)
- Rationale: future generations benefit from the fix

**Content-specific issue** → Fix in the generated HTML only
- Examples: a particularly long client name needs `<br>`, a project name is too long for the chosen font-size, a team has 8+ members instead of typical 5
- Do NOT propagate to skill.md — these are project-specific

### 5.5 Re-Verify

After applying fixes, re-run Step 5.2 inspection to confirm all issues are resolved. Maximum **3 iterations**; if issues persist after 3 rounds, report the remaining ones to the user in Step 6 and let them decide.

### 5.6 Close Browser

Close the Playwright browser session after verification is complete (pass or max iterations).

### 5.7 QA Report (feed into Step 6)

Collect findings for the final report:
- Slides inspected: N
- Issues found: M
- Issues auto-fixed: K
- Issues propagated to skill.md: J (structural only)
- Remaining issues: M - K (reported to user)

---

## Step 6: Report Result

### Success Message

```
Kickoff presentation generated and verified.

File: [OUTPUT_PATH]
Slides: [SLIDE_COUNT]
Project: [PROJECT_NAME]
Client: [CLIENT_NAME]
Duration: [START] ~ [END] ([N] weeks)

QA (Playwright, 1920×1080):
- Slides inspected: [N]
- Issues found: [M]
- Auto-fixed in HTML: [K]
- Propagated to skill template: [J]
- Remaining issues: [M - K] ([list or "none"])

Open the HTML file in a browser to present.
- Arrow keys: Navigate slides
- F: Toggle fullscreen
- Click dots: Jump to slide
```

---

## Fixed Content Reference

### Communication Tools (hardcoded)
- **Slack**: Real-time communication
- **pm.potentialai.com**: Project dashboard with client view

### Deliverables (hardcoded)
- **PRD**: Product Requirements Document
- **Swagger**: API Documentation

### Company Info (hardcoded)
- Company: Potential INC
- Email: contact@potentialai.com
- Copyright year: Current year

---

## Error Handling

| Scenario | Action |
|----------|--------|
| Project name missing | Ask via AskUserQuestion |
| Client name missing | Ask via AskUserQuestion |
| Tech stack not selected | Ask via AskUserQuestion |
| Duration not provided | Ask via AskUserQuestion |
| Phase breakdown unclear | Provide sensible defaults, ask to confirm |
| User cancels at confirmation | Stop and report |
| Playwright MCP unavailable | Skip Step 5 QA, warn user in Step 6 report, continue with HTML file |
| QA iteration limit reached (3) | Report remaining issues in Step 6, let user decide whether to fix manually |
| Screenshot/inspection fails mid-run | Close browser, report partial QA results, do not block the final output |

---

## Examples

### Example 1: Full Arguments

```bash
/kickoff-meeting --project "Activity Coaching" --client "김철수 대표님"
```
-> Asks for: tech stack, duration, phase breakdown
-> Output: `.claude-project/meetings/Activity Coaching/kickoff/[Kickoff] Activity Coaching.html`

### Example 2: No Arguments (Fully Interactive)

```bash
/kickoff-meeting
```
-> Asks for: everything (project name, client, tech stack, duration, phases)
-> Brief confirmation -> Generate

### Example 3: Mobile Project

```bash
/kickoff-meeting --project "Health App"
```
-> User selects: React Native + NestJS
-> Duration: 2026.05 ~ 2026.09 (20 weeks)
-> Output: `.claude-project/meetings/Health App/kickoff/[Kickoff] Health App.html`
