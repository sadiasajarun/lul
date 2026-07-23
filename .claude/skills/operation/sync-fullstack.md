---
description: Pull latest claude-fullstack pipeline + nested submodules, report changes and affected bot files
argument-hint: Optional branch to pull from (default: main)
---

You are a sync assistant. Your task is to pull the latest claude-fullstack pipeline into the current project and report what changed.

## CRITICAL RULES

1. **Read-only for bot code** — This command only updates `.claude/` (submodule pull). Never modify bot files.
2. **Report affected tools** — After pulling, cross-reference changes against DEPENDENCY_MAP.yaml to warn which bot files may need updating.
3. **Recursive submodule update** — Always update nested submodules (nestjs, react) too.

---

## Step 1: Locate the Fullstack Agent

Find the `.claude` submodule that points to `claude-fullstack`:

```bash
# From repo root, find fullstack .claude directories
git config --file .gitmodules --get-regexp 'submodule\..*\.url' | grep claude-fullstack
```

Parse the output to get the submodule path (e.g., `agent-house-bot/agents/fullstack/.claude`).

If not found:
```
This repo does not use claude-fullstack as a submodule. Nothing to sync.
```
STOP.

---

## Step 2: Record Current State

```bash
cd <submodule-path>

# Record current commit before pull
BEFORE_COMMIT=$(git rev-parse HEAD)
echo "Current commit: $BEFORE_COMMIT"
```

---

## Step 3: Pull Latest Changes

```bash
# Determine branch (use $ARGUMENTS if provided, default to main)
PULL_BRANCH="${ARGUMENTS:-main}"

# Fetch and pull
git fetch origin
git checkout "$PULL_BRANCH" 2>/dev/null || git checkout -b "$PULL_BRANCH" "origin/$PULL_BRANCH"
git pull origin "$PULL_BRANCH"

# Update nested submodules (nestjs, react)
git submodule update --init --recursive

AFTER_COMMIT=$(git rev-parse HEAD)
echo "Updated to: $AFTER_COMMIT"
```

---

## Step 4: Report Changes

```bash
# If no changes, report and stop
if [ "$BEFORE_COMMIT" = "$AFTER_COMMIT" ]; then
  echo "Already up to date. No changes to report."
  # STOP here
fi

# Show what changed
echo "=== Changes pulled ==="
git log --oneline "$BEFORE_COMMIT..$AFTER_COMMIT"
echo ""

echo "=== Files changed ==="
git diff --name-only "$BEFORE_COMMIT..$AFTER_COMMIT"
```

Return to repo root:
```bash
cd <back-to-repo-root>
```

---

## Step 5: Cross-Reference with DEPENDENCY_MAP.yaml

Check if any changed `.claude/` files are referenced by bot tools:

1. Read `DEPENDENCY_MAP.yaml` from the fullstack agent directory (parent of `.claude/`)
2. For each changed file in Step 4, check if it appears in any dependency list
3. Report affected bot files:

```
=== Affected Bot Files ===

Changed: pipeline/phases/03-design.md
  → Referenced by: _shared/tools/run_pipeline.ts (phases)
  → Referenced by: barbershop/persona.md (phases)

Changed: rules/stacks/nestjs.rules.md
  → Referenced by: _shared/tools/run_pipeline.ts (rules)

Changed: skills/design/generate-html-gemini/SKILL.md
  → Referenced by: _shared/tools/run_pipeline.ts (skills)
```

If no bot files are affected:
```
No bot files reference the changed pipeline files. Safe to use as-is.
```

---

## Step 6: Summary Report

```
Sync Complete

Pipeline: claude-fullstack
Branch: <branch>
Commits pulled: <count>
Files changed: <count>

Affected bot files: <count>
<list affected files if any>

Next steps:
- Review affected bot files to see if they need updating
- Use /commit-all when ready to commit both bot and pipeline changes
```

---

## Error Handling

- **Merge conflicts**: STOP and report. Do NOT force-resolve.
- **Network error**: STOP and report. User should check connectivity.
- **No DEPENDENCY_MAP.yaml**: Skip Step 5, just report changed files.
- **Detached HEAD in submodule**: Checkout the target branch before pulling.
