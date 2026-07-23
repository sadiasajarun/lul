# Internal Skills

Team-only tools — not client-facing.

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| [sop/](sop/) | `/generate-sop` | SOP creation + Notion integration |
| [kb/](kb/) | `/kb <command>` | Knowledge base — ingest, compile, query |
| [tickets/](tickets/) | `/ticketcreator` | Structured ticket generation |
| [training/](training/) | `/generate-random-project` | Random project specs for team training |

## Naming Convention

- **Operations repo**: `skills/internal/{skill-name}/`
- **Global skills** (`~/.claude/skills/`): `{skill-name}/` (flattened — e.g., `sop/`, `kb/`, `tickets/`, `training/`)
