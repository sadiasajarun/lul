# Project-Specific Hooks

This directory contains Claude Code hooks specific to {PROJECT_NAME}.

## What Are Hooks?

Hooks are scripts that run automatically at key moments in the Claude workflow:

| Event | When It Runs | Use Case |
|-------|--------------|----------|
| `UserPromptSubmit` | Before Claude sees your prompt | Skill suggestions, context injection |
| `PreToolUse` | Before a tool executes | Validation, guardrails |
| `PostToolUse` | After a tool completes | Status tracking, caching |
| `Stop` | When user presses Escape | TypeScript checks, cleanup |

## Hook Configuration

Hooks are registered in `.claude/settings.json` or `.claude-project/settings.json`:

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

## Directory Structure

```
.claude-project/hooks/
├── skill-activation-prompt.sh/.ts   # Suggests relevant skills
├── status-auto-updater.sh/.ts       # Updates status files on edits
├── lib/                              # Shared hook utilities
│   ├── detectors/                    # File change detection
│   └── updaters/                     # Status file updaters
├── package.json                      # Node dependencies
└── tsconfig.json                     # TypeScript config
```

## Creating New Hooks

1. Create a shell script (`.sh`) that calls your TypeScript/JavaScript logic
2. Add the hook to `settings.json` under the appropriate event
3. Use `$CLAUDE_PROJECT_DIR` variable for paths

## Available Hooks in This Project

- **skill-activation-prompt** - Auto-suggests skills based on prompt keywords
- **status-auto-updater** - Updates status files when code is modified

See `.claude/hooks/` for shared hooks available to all projects.
