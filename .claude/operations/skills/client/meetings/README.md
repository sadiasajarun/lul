# Meeting Skills

Branded HTML presentations for live client meetings.

## Skills

| Skill | Command | When | Output |
|-------|---------|------|--------|
| [kickoff/](kickoff/SKILL.md) | `/kickoff` | Project start meeting | `[Kickoff] {ProjectName}.html` (11 slides) |
| [weekly/](weekly/SKILL.md) | `/weekly` | Weekly client meeting | `[Weekly] {ProjectName} ({YYYY-MM-DD}).md` + `.html` |
| [closing/](closing/SKILL.md) | `/closing` | Project completion meeting | `[Closing] {ProjectName} ({YYYY-MM-DD}).html` (11 slides) |
| [mm/](mm/SKILL.md) | `/mm` | After any meeting | `[MM] {ProjectName} ({YYYY-MM-DD}).md` + Slack summary |

## Shared Design

All three decks share one Potential brand system. The canonical source lives in [kickoff/SKILL.md](kickoff/SKILL.md):

| Section | What it defines |
|---|---|
| §4.3 | Design tokens — `--brand-purple`, `--brand-lime`, `--phase-*`, typography, spacing, motion |
| §4.4 | Complete CSS framework (slide container, components, responsive breakpoints, `:focus-visible`, `prefers-reduced-motion`, print) |
| §4.5 | Chrome markup (theme toggle + fullscreen button + nav bar + slide counter) |
| §4.6 | JavaScript — slide nav (arrows / dots), theme toggle (`T` key, `localStorage`), fullscreen (`F` key) |
| §4.7 | Inline logo SVG (theme-aware fill via `.slide-logo` parent class) |
| §4.8 | 13-point pre-delivery checklist (UI UX Pro Max rubric) |

**Runtime theme:** every deck ships a light/dark toggle (button top-right, `T` keybinding). Initial theme = `localStorage.meetingTheme` → `prefers-color-scheme` → `light`.

Weekly and closing reference these sections by anchor — they never duplicate CSS or JS. One visual language across every client meeting.

## Naming Convention

- **Operations repo**: `skills/client/meetings/{name}/`
- **Global skills** (`~/.claude/skills/`): `{name}/` (e.g., `kickoff/`, `weekly/`, `closing/`)
- **Slash commands**: `/kickoff`, `/weekly`, `/closing`, `/mm`
