---
description: "TRIGGER when user pastes a pm.potentialai.com ticket URL. Full ticket lifecycle: create branch + worktree workspace, then finish by creating PR, monitoring CI, merging, and deploying."
argument-hint: "[--all] [--manual] <ticket-url>"
---

Read and execute the full protocol from `.claude/skills/dev/start-ticket/SKILL.md`.

CRITICAL: This skill has two phases. Phase A (steps 1-7) is infrastructure setup — it MUST complete fully before any codebase exploration, planning, or implementation begins.

The arguments are: $ARGUMENTS

If the arguments contain `--manual`, follow the "Manual Mode (`--manual`)" section of the skill.
If the arguments contain `--all`, follow the "Batch Mode (--all)" section of the skill.
Otherwise, follow the normal single-ticket flow (the ticket URL is the arguments).
