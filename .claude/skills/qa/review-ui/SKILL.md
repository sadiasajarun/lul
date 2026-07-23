---
name: ui-review
description: Parallel QA orchestrator. Discovers YAML user stories, spawns one playwright-qa-agent per story simultaneously, aggregates PASS/FAIL results with screenshot evidence.
tags: [qa, acceptance, playwright, parallel]
---

# UI Review Skill

Parallel QA orchestrator. Auto-discovers YAML user stories, spawns one `playwright-qa-agent` per story simultaneously, aggregates PASS/FAIL results with screenshot evidence.

Called internally by:
- `acceptance-test/SKILL.md` (iterative loop)
- Phase 9 (test-browser) in fullstack pipeline

---

## Input

Optional `filename_filter` — if provided, only run stories from files matching this substring.

---

## Phase 1: Discover

### 1.1 Find Story Files

```
Glob: .claude-project/user_stories/*.yaml
```

### 1.2 Apply Filter (if provided)

If `filename_filter` is provided, filter filenames containing the substring.
If no filter, use all discovered YAML files.

### 1.3 Parse Stories

Read each YAML file. Expected format:

```yaml
stories:
  - name: "Story name"
    url: "http://localhost:5173/path"
    workflow: |
      Step 1 instruction
      Step 2 instruction
      ...
```

Extract all individual stories into a flat list.

### 1.4 Generate Run Directory

```bash
RUN_DIR=".claude-project/qa/runs/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$RUN_DIR"
```

### 1.5 Validate

- If no YAML files found: show error and suggest creating `.claude-project/user_stories/` with example
- If no stories parsed: show error about YAML format
- Report: "Found {N} stories across {M} files"

---

## Phase 2: Spawn (Parallel)

### 2.1 Create Team

```
TeamCreate("ui-review")
```

### 2.2 Spawn Agents

**CRITICAL: Spawn ALL agents in a SINGLE message turn to guarantee parallel execution.**

For each story, use the Agent tool:

```
Agent(
  subagent_type: "general-purpose",
  name: "qa-{story-kebab}",
  team_name: "ui-review",
  prompt: """
    You are a playwright-qa-agent. Read the agent instructions at:
    .claude/agents/playwright-qa-agent.md

    Execute this user story:

    story_name: {story.name}
    story_url: {story.url}
    FRONTEND_URL: {FRONTEND_URL}
    workflow: |
      {story.workflow}

    RUN_DIR: {RUN_DIR}

    IMPORTANT: The story_url may contain a hardcoded port. Use FRONTEND_URL to rewrite
    the host:port before opening the browser. See "URL Rewriting" in the agent protocol.

    Follow the agent protocol exactly. Return the structured report.
  """
)
```

All Agent calls must be in the same message -- do NOT spawn sequentially.

---

## Phase 3: Collect

1. Await all agent completions
2. Parse each agent's report:
   - Extract `STATUS: PASS|FAIL`
   - Extract step counts (total, passed, failed, skipped)
   - Extract `FAILURE_DETAILS` if present
3. Track results per story

---

## Phase 4: Cleanup & Report

### 4.1 Shutdown Team

Send shutdown requests to all teammates, then:
```
TeamDelete()
```

### 4.2 Generate Aggregate Report

Display to user:

```markdown
# UI Review Report

**Date**: {YYYY-MM-DD HH:MM}
**Stories**: {total}
**Screenshots**: {RUN_DIR}/

---

| Story | Source File | Status | Steps | Details |
|-------|-----------|--------|-------|---------|
| Home page loads with branding | home.yaml | PASS | 5/5 | - |
| Events list page loads | events.yaml | FAIL | 3/4 | Step 3: 401 error visible |
| Login page loads with all elements | login.yaml | PASS | 6/6 | - |
| Portal members page shows list | portal-members.yaml | PASS | 4/4 | - |

---

**Result: {passed}/{total} PASSED ({percentage}%)**

### Failures

1. **Events list page loads** (events.yaml)
   - Step 3: 401 error visible on page
   - Screenshot: {RUN_DIR}/events-list-page-loads/02_verify-no-error.png
```

---

## Error Handling

| Error | Action |
|-------|--------|
| No YAML files found | Show example YAML format and directory structure |
| `playwright-cli` not installed | Show install command and exit |
| Servers not running | Report as `__servers_down__` failure — orchestrator's ensure-servers ran upstream; if servers are still down it indicates a real boot bug (don't restart yourself) |
| Agent timeout | Mark story as FAIL with "Agent timeout" |
| All stories fail | Show full report, suggest checking server status |

---

## Prerequisites

1. `@playwright/cli` installed globally: `npm install -g @playwright/cli@latest`
2. **Servers should ALREADY be running** — the pipeline orchestrator runs
   `ensure-servers` as a deterministic step before invoking this skill (see
   test-browser-2.yaml / test-api-2.yaml). Do NOT start `npm run dev` yourself.
   If servers are not up, that's a real bug to report (see test-smoke SKILL
   for the rationale — v92 evidence shows agents waste 70+ turns chasing hung
   dev servers with unresolved imports).
   - Verify via `pm2 status` and compute URLs from `ecosystem.config.js`:
     ```bash
     pm2 status 2>&1 | grep -E "fsp-backend|fsp-frontend"
     BACKEND_PORT=$(node -e "console.log(require('./ecosystem.config.js').apps.find(a => a.name === 'fsp-backend').env.PORT)")
     FRONTEND_PORT=$(node -e "console.log(require('./ecosystem.config.js').apps.find(a => a.name === 'fsp-frontend').env.PORT)")
     export FRONTEND_URL="http://localhost:$FRONTEND_PORT"
     export BACKEND_URL="http://localhost:$BACKEND_PORT"
     ```
   - Pass `FRONTEND_URL` to each playwright-qa-agent — this ensures correct
     ports and prevents port mismatch failures.
3. YAML story files in `.claude-project/user_stories/`

---

## Related

- **Agent protocol**: `.claude/agents/playwright-qa-agent.md`
- **Story generation**: `.claude/skills/dev/generate-user-stories/SKILL.md`
- **Acceptance loop**: `.claude/skills/qa/test-acceptance/SKILL.md`
- **Fullstack pipeline**: `.claude/commands/fullstack.md` (Phase 8 test, Phase 9 qa)
