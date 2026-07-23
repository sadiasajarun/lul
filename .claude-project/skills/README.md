# Project-Specific Skills

This directory contains skills specific to intelligent-data-dashboard that override or extend the shared skills.

## 3-Tier Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  TIER 3: Project-Specific (Highest Priority) - THIS DIRECTORY      │
│  .claude-project/skills/  → Project overrides only                 │
├─────────────────────────────────────────────────────────────────────┤
│  TIER 2: Framework/Domain-Specific                                  │
│  .claude/skills/design|dev|qa|operation/                            │
│  .claude/operations/skills/  → client/ops skills                    │
├─────────────────────────────────────────────────────────────────────┤
│  TIER 1: Base (Lowest Priority)                                     │
│  .claude/skills/          → Shared skills for ALL projects         │
└─────────────────────────────────────────────────────────────────────┘
```

## How to Add Project-Specific Skills

1. Create a skill directory: `.claude-project/skills/my-skill/`
2. Add `SKILL.md` with skill content
3. Add entry to `skill-rules.json` in this directory

## Current Project Skills

None yet. Add project-specific skills here as needed.
