# Proposals Skills

Client-facing proposal generation — interactive HTML slide decks (PPT-style) with bilingual Korean/English support.

## Skills

| Skill | Command | Output |
|-------|---------|--------|
| [generate-proposal/](generate-proposal/) | `/generate-proposal` | `[Proposal] {ProjectName}.html` — 26-variable template with base64-embedded assets, Korean or English per-file. |

## Naming Convention

- **Operations repo**: `skills/client/proposals/{skill-name}/`
- **Global skills** (`~/.claude/skills/`): `{skill-name}/` (e.g., `generate-proposal/`)
- **Slash commands**: `/generate-proposal`
