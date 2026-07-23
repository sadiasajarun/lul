# Project-Specific Agents

This directory contains agents specific to {PROJECT_NAME} that override or extend the shared agents.

## 3-Tier Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  TIER 3: Project-Specific (Highest Priority) - THIS DIRECTORY      │
│  .claude-project/agents/  → Project overrides (tracked by project) │
├─────────────────────────────────────────────────────────────────────┤
│  TIER 2: Framework-Specific                                         │
│  .claude/nestjs/agents/   → NestJS-specific agents                 │
│  .claude/react/agents/    → React-specific agents                  │
├─────────────────────────────────────────────────────────────────────┤
│  TIER 1: Base (Lowest Priority)                                     │
│  .claude/agents/     → Shared agents for ALL projects         │
└─────────────────────────────────────────────────────────────────────┘
```

## How to Add Project-Specific Agents

1. Create agent file: `.claude-project/agents/my-agent.md`
2. Follow the agent template format (see `.claude/agents/` for examples)
3. If the agent has the same name as a base agent, it will OVERRIDE the base version

## Available Base Agents

See `.claude/agents/README.md` for the list of shared agents available to all projects.

## Current Project Agents

None yet. Add project-specific agents here as needed.
