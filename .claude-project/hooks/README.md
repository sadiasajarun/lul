# Project-Specific Hooks

This directory contains Claude Code hooks specific to intelligent-data-dashboard.

## What Are Hooks?

Hooks are scripts that run automatically at key moments in the Claude workflow:

| Event | When It Runs | Use Case |
|-------|--------------|----------|
| `UserPromptSubmit` | Before Claude sees your prompt | Skill suggestions, context injection |
| `PreToolUse` | Before a tool executes | Validation, guardrails |
| `PostToolUse` | After a tool completes | Status tracking, caching |
| `Stop` | When user presses Escape | TypeScript checks, cleanup |

## Hook Configuration

Hooks are registered in `.claude/settings.json` (or `settings.local.json`):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude-project/hooks/my-hook.sh"
          }
        ]
      }
    ]
  }
}
```

## Shared hooks available in the toolkit

See `.claude/hooks/`: auto-commit, auto-format, auto-lint, auto-test,
block-dangerous, log-commands, protect-sensitive, remind-read-docs,
require-tests-before-pr. None are wired up for this project yet.

**Windows note:** these are `.sh` scripts — they require Git Bash on this machine.

## Available Hooks in This Project

None yet.
