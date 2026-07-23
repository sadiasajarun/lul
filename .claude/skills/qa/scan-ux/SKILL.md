---
name: ux-scanner
description: Autonomous UX heuristic scanner — inspects all routes against 10-category checklist via browser (playwright) + source (grep) dual verification. Produces structured issue reports and feeds learning pipeline.
tags: [qa, ux, heuristic, i18n, accessibility, text-quality, scanner]
related_skills: [acceptance-test, smoke-test, ui-review, bug-feedback-loop, playwright-cli]
---

# UX Heuristic Scanner

Autonomous scanner that detects UX quality violations not covered by user stories. Runs 10-category heuristic checklist against every route — combining browser inspection (playwright-cli snapshot/screenshot) with source code analysis (grep).

```
Routes → Parallel Agents (1 per route) → Issue Files → Summary Report → Learning Feed
```

---

## When to Use

- Phase 9e of the fullstack pipeline (after auto-bug-feedback, before regression-check)
- Standalone via `/ux-audit` command
- After major frontend changes to catch regressions
- When adding new routes/pages to verify baseline quality

---

## Prerequisites

1. Frontend and backend servers running (use `ensure-servers` skill)
2. Database seeded with test data (use `database-seeding` skill)
3. Route manifest exists: `.claude-project/routes.yaml`
4. Heuristic checklist loaded: `.claude/skills/qa/scan-ux/references/heuristic-checklist.yaml`

---

## Inputs

| Input | Path | Purpose |
|-------|------|---------|
| Routes | `.claude-project/routes.yaml` | Route manifest with auth_level per route |
| Checklist | `.claude/skills/qa/scan-ux/references/heuristic-checklist.yaml` | 10 categories, 65+ checks |
| Issue Schema | `.claude/skills/qa/scan-ux/references/ux-issue-schema.md` | Issue file format |
| Fixtures | `.claude-project/user_stories/_fixtures.yaml` | Test credentials for auth |

## Outputs

| Output | Path | Purpose |
|--------|------|---------|
| Issue Files | `.claude-project/ux_issues/UX-{NNN}.md` | Individual issue reports |
| Summary | `.claude-project/status/{project}/UX_QA_SUMMARY.md` | Aggregate report (gate-verified) |
| Screenshots | `.claude-project/qa/ux-scanner/{route-kebab}/` | Visual evidence |

---

## Algorithm

### Phase 1: Setup

1. **Verify servers running**
   - Load `.claude/skills/dev/ensure-servers/SKILL.md`
   - Capture `FRONTEND_URL` and `BACKEND_URL`
   - If servers fail: EXIT with status "blocked"

2. **Load route manifest**
   - Read `.claude-project/routes.yaml`
   - Parse all routes into list with auth_level
   - Group by auth_level: `public`, `auth`, `admin`, `client`

3. **Load checklist**
   - Read `.claude/skills/qa/scan-ux/references/heuristic-checklist.yaml`
   - Validate all 10 categories present

4. **Prepare output directories**
   ```bash
   mkdir -p {TARGET_DIR}/.claude-project/ux_issues
   mkdir -p {TARGET_DIR}/.claude-project/qa/ux-scanner
   ```

5. **Load test credentials**
   - Read `_fixtures.yaml` for login credentials per auth level
   - If missing: use default test credentials from seed

### Phase 2: Browser Scan (Parallel Agents)

**For each auth_level group, sequentially:**

1. **Open browser session** with playwright-cli:
   ```bash
   playwright-cli -s=ux-scan-{auth_level} open {FRONTEND_URL} --persistent
   ```

2. **Authenticate** (if not public):
   - Navigate to login page
   - Fill credentials for this auth_level
   - Wait for redirect to authenticated area

3. **Spawn parallel ux-scanner-agents** (one per route in this auth group):
   ```
   For each route in group:
     Spawn agent: ux-scanner-agent
       route: {route.path}
       auth_level: {auth_level}
       component_path: {route.component} (if known)
       session: ux-scan-{auth_level}
       FRONTEND_URL: {FRONTEND_URL}
       PROJECT_DIR: {TARGET_DIR}
   ```

   **Parallelism**: Spawn ALL agents for this auth group in a single message block.
   Wait for all to complete before moving to next auth group.

4. **Collect results** from all agents in this group.

5. **Close session** (or reuse for next group if same browser needed).

**Repeat for each auth_level group.**

### Phase 3: Source Code Scan (Global)

After browser scans complete, run source-only checks that span the entire codebase:

1. **TQ-10 (hardcoded strings not in t())** — grep all .tsx files
2. **TQ-09 (tone inconsistency)** — analyze locale JSON files
3. **RT-03 (event mismatch)** — cross-grep backend emits vs frontend listeners
4. **SEC-03 (rate limiting)** — grep auth endpoint files

These checks are NOT per-route — they scan the entire project once.

### Phase 4: Issue Generation

1. **Collect all findings** from Phase 2 (browser agents) + Phase 3 (global source)

2. **Deduplicate**:
   - Same check_id + same route = merge into single issue
   - Same check_id + different routes = separate issues

3. **Assign sequential IDs**: UX-001, UX-002, ...
   - Check existing `.claude-project/ux_issues/` for last used number
   - Continue from next number (don't overwrite previous runs)

4. **Generate issue files**:
   - Read schema from `references/ux-issue-schema.md`
   - Write each issue as `.claude-project/ux_issues/UX-{NNN}.md`
   - Include all required fields: severity, category, check, route, file, evidence, fix direction

### Phase 5: Summary Report

Generate `.claude-project/status/{project}/UX_QA_SUMMARY.md`:

```markdown
# UX Heuristic Scan Report

**Project**: {project_name}
**Date**: {YYYY-MM-DD}
**Routes Scanned**: {count}
**Total Issues**: {count}

## Severity Summary

| Severity | Count | Percentage |
|----------|-------|------------|
| P0 (Critical) | {n} | {%} |
| P1 (High) | {n} | {%} |
| P2 (Medium) | {n} | {%} |
| P3 (Low) | {n} | {%} |

## Category Summary

| Category | ID | Issues | Top Severity |
|----------|----|--------|-------------|
| {name} | {id} | {count} | {highest_severity} |
| ... | ... | ... | ... |

## Per-Route Findings

| Route | P0 | P1 | P2 | P3 | Total |
|-------|----|----|----|----|-------|
| {path} | {n} | {n} | {n} | {n} | {n} |
| ... | ... | ... | ... | ... | ... |

## Health Score

`ux_scanner_health` = {score}
Formula: max(0.0, 1.0 - P0_count × 0.3 - P1_count × 0.1)

## Priority Fix Order

1. {P0 issues first, grouped by category}
2. {P1 issues next}
3. {P2/P3 as advisory}
```

**Critical**: This file MUST contain real data (dates, counts, routes). Template placeholders like `YYYY-MM-DD` or `{project_name}` trigger evidence-check failure.

### Phase 6: Feed Learning Pipeline

1. **P0/P1 issues → bug-feedback-loop**:
   - For each P0/P1 issue: create a lightweight bug reference
   - Feed to `.claude/skills/qa/run-feedback-loop/SKILL.md` for RCA + missing story generation
   - Only if the issue represents an actual bug (not a polish item)

2. **All issues → learn-bugs --global**:
   - Extract patterns from recurring issues (same check across multiple projects)
   - Feed to `.claude/skills/qa/learn-bugs/SKILL.md` with `--global` flag
   - New patterns added to `bug-patterns-global.yaml` for Tier 14 preventive stories

3. **Update status**: Mark UX scanner phase as complete in pipeline status.

---

## Iteration (Loop Mode)

When invoked with `--loop`:

1. Run full scan (Phases 1-5)
2. If P0 issues found:
   - Attempt auto-fix for P0 issues with clear fix direction
   - Re-run affected routes only (not full rescan)
   - Max 3 fix iterations
3. Generate final summary after last iteration
4. Feed learning (Phase 6)

**Convergence**: Exit when P0 count reaches 0 or after 3 iterations (whichever first).

---

## Filters

The orchestrator or `/ux-audit` command can pass filters:

| Filter | Effect |
|--------|--------|
| `--route /admin/users` | Scan only this route |
| `--category text-quality` | Run only text-quality checks |
| `--severity-min P1` | Report only P1+ findings (skip P2/P3) |

When filtered, still produce UX_QA_SUMMARY.md but note the filter in the header.

---

## Error Handling

| Error | Action |
|-------|--------|
| Server not running | EXIT with "blocked" — do not attempt to start servers |
| Route 404 | Report as MF-01 finding, skip remaining checks for that route |
| Playwright session crash | Log error, skip route, continue with next |
| No routes.yaml | EXIT with "missing prerequisite" |
| Zero issues found | Generate summary with "0 issues — all checks passed" |

---

## Related

- `skills/qa/test-acceptance/SKILL.md` — story-based testing (complements this skill)
- `skills/qa/test-smoke/SKILL.md` — basic route health check (runs before this)
- `skills/qa/review-ui/SKILL.md` — parallel agent orchestration pattern (this skill follows same pattern)
- `skills/qa/run-feedback-loop/SKILL.md` — consumes P0/P1 findings for RCA
- `skills/qa/learn-bugs/SKILL.md` — consumes all findings for global pattern learning
- `react/skills/responsive-design/SKILL.md` — responsive checks are handled separately by this dedicated skill
