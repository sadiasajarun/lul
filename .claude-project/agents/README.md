# Project-Specific Agents

This directory contains agents specific to intelligent-data-dashboard that override or extend the shared agents.

## 3-Tier Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  TIER 3: Project-Specific (Highest Priority) - THIS DIRECTORY      │
│  .claude-project/agents/  → Project overrides (tracked by project) │
├─────────────────────────────────────────────────────────────────────┤
│  TIER 2: Framework-Specific                                         │
│  .claude/react/agents/    → React-specific agents (if present)     │
├─────────────────────────────────────────────────────────────────────┤
│  TIER 1: Base (Lowest Priority)                                     │
│  .claude/agents/          → Shared agents for ALL projects         │
└─────────────────────────────────────────────────────────────────────┘
```

## Available Base Agents

- `.claude/agents/playwright-qa-agent.md`
- `.claude/agents/ux-scanner-agent.md`

## Current Project Agents

None yet. Add project-specific agents here as needed.
