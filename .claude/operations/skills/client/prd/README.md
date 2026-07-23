# PRD Skills

PRD lifecycle management — generate, update, convert, and classify PRD documents.

## Pipeline Flow

```
input-classifier ── determine input type
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   generate-prd     update-prd      pdf-to-prd
   (Feature + Tech       │
    in one pipeline)     ▼
         │         generate-korean-prd
         ▼
   generate-korean-prd
```

`/generate-prd` runs the full Feature → Technical pipeline by default. Use `--feature` or `--tech` flags to run only one phase (see the skill's SKILL.md for invocation modes).

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| [generate-prd/](generate-prd/) | `/generate-prd` | Generate complete PRD (Feature + Technical). Default `--full`; supports `--feature`, `--tech`, `--interview` flags. |
| [generate-korean-prd/](generate-korean-prd/) | `/generate-korean-prd` | Korean PRD PDF with company branding |
| [update-prd/](update-prd/) | `/update-prd` | Update existing PRD with client feedback |
| [pdf-to-prd/](pdf-to-prd/) | `/pdf-to-prd` | Convert PDF to structured markdown PRD |
| [input-classifier/](input-classifier/) | `/input-classifier` | Auto-classify input type before PRD modification |

## Naming Convention

- **Operations repo**: `skills/client/prd/{skill-name}/`
- **Global skills** (`~/.claude/skills/`): `{skill-name}/` (e.g., `generate-prd/`)
- **Slash commands**: `/generate-prd`, `/update-prd`, etc.
