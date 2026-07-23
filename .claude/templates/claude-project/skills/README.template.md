# Project-Specific Skills

This directory contains skills specific to {PROJECT_NAME} that override or extend the shared skills.

## 3-Tier Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  TIER 3: Project-Specific (Highest Priority) - THIS DIRECTORY      │
│  .claude-project/skills/  → Project overrides only                 │
├─────────────────────────────────────────────────────────────────────┤
│  TIER 2: Framework-Specific                                         │
│  .claude/nestjs/skills/   → NestJS-specific skills                 │
│  .claude/react/skills/    → React-specific skills                  │
├─────────────────────────────────────────────────────────────────────┤
│  TIER 1: Base (Lowest Priority)                                     │
│  .claude/skills/          → Shared skills for ALL projects         │
└─────────────────────────────────────────────────────────────────────┘
```

## How to Add Project-Specific Skills

1. Create a skill directory: `.claude-project/skills/my-skill/`
2. Add `SKILL.md` with skill content
3. Add entry to `skill-rules.json` in this directory

## skill-rules.json

The `skill-rules.json` in this directory can:
- Add new project-specific skills
- Override trigger patterns for existing skills
- Disable skills for this project

Example:
```json
{
  "my-project-skill": {
    "type": "domain",
    "enforcement": "suggest",
    "priority": "high",
    "file": "my-project-skill/SKILL.md",
    "promptTriggers": {
      "keywords": ["project-specific", "custom"]
    }
  }
}
```

## Current Project Skills

None yet. Add project-specific skills here as needed.
