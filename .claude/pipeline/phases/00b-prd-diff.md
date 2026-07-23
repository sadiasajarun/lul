# Phase 0b: PRD Diff Analysis (for Update mode)

When updating an existing project with new requirements, this phase diffs the new PRD against the existing PRD to produce a structured change plan. The change plan drives scoped execution — only affected phases run, and only for the changed features.

This phase runs automatically when `--update` is specified, after the audit phase (0a).

## Prerequisites

- Phase 0a (audit) complete
- Existing PRD at `.claude-project/prd/`
- New/updated PRD provided via `--prd <path>`

## Execution

### Step 0b.1: Load PRDs

```
1. Read EXISTING PRD:
   Path: {TARGET_DIR}/.claude-project/prd/*.md
   Hash the content for change tracking

2. Read NEW PRD:
   Read from --prd path (resolved from cwd)
   Determine next version number:
     List existing PRDs in {TARGET_DIR}/.claude-project/prd/
     Find highest version suffix (_v2, _v3, ...) or none (v1)
     Next version = max + 1
   Save as: {TARGET_DIR}/.claude-project/prd/{ProjectName}_PRD_v{N}.md
   Hash the new content
   Note: Original PRD is FROZEN — never overwrite, only add new versions

3. IF hashes match:
   Report: "No PRD changes detected. Nothing to update."
   EXIT (skip update mode)
```

### Step 0b.2: Diff PRDs

Compare old and new PRDs section by section to identify changes:

```
FOR each section in [Modules, Pages, Entities, Endpoints, User Types, Features]:

  1. Parse section from OLD PRD
  2. Parse section from NEW PRD
  3. Compute diff:
     - ADDED: items in new but not in old
     - MODIFIED: items in both but with different specs
     - REMOVED: items in old but not in new

  4. Classify each change:
     | Change Type | Example |
     |-------------|---------|
     | new_entity | "Review" entity added to Entities section |
     | new_endpoint | "POST /api/reviews" added to Endpoints section |
     | new_page | "reviews-list" page added to Pages section |
     | new_module | "reviews" module added to Modules section |
     | modified_entity | "Booking" entity: added 'notes' field |
     | modified_endpoint | "PATCH /api/bookings/:id" now accepts 'notes' |
     | modified_page | "booking-form" page: added notes textarea |
     | removed_entity | "Referral" entity removed |
     | removed_endpoint | "/api/referrals/*" endpoints removed |
     | removed_page | "referrals" page removed |
```

### Step 0b.3: Map Changes to Affected Phases

For each change, determine which pipeline phases need to re-run:

```
CHANGE TYPE → AFFECTED PHASES:

new_entity      → prd (update docs), database, backend, test-api
new_endpoint    → prd (update docs), backend, test-api
new_page        → prd (update docs), frontend, integrate, test-browser
new_module      → prd (update docs), database, backend, frontend, integrate, test-api, test-browser
modified_entity → prd (update docs), database, backend (only that module)
modified_endpoint → prd (update docs), backend (only that module), test-api
modified_page   → prd (update docs), frontend (only that page), integrate
removed_entity  → prd (update docs), database (remove), backend (remove module), test-api
removed_endpoint → prd (update docs), backend (remove routes), test-api
removed_page    → prd (update docs), frontend (remove component), integrate

ALWAYS unaffected: spec, init (project already exists), design (skipped for updates — new pages go straight to React)
```

### Step 0b.4: Generate Change Plan

Write the change plan to PIPELINE_STATUS.md:

```markdown
## Change Plan

diff_date: {DATE}
old_prd_hash: {OLD_HASH}
new_prd_hash: {NEW_HASH}
change_count: {N}

### Changes

| # | Type | Name | Description | Affected Phases |
|---|------|------|-------------|-----------------|
| 1 | add_feature | reviews | New reviews module with entity, CRUD API, 2 pages | prd, database, backend, frontend, integrate, test-api, test-browser |
| 2 | modify_feature | booking | Added 'notes' field to booking entity and form | prd, database, backend, frontend |
| 3 | remove_feature | referrals | Removed referral system entirely | prd, database, backend, frontend |

### Per-Phase Scope

| Phase | Action | Scope |
|-------|--------|-------|
| prd | update | Re-run PRD-to-docs conversion with new PRD |
| database | incremental | Create ReviewEntity, add 'notes' to BookingEntity, remove ReferralEntity |
| backend | incremental | Create reviews module, update bookings module, remove referrals module |
| frontend | incremental | Create review pages, update booking form, remove referral page |
| integrate | incremental | Wire new review pages, update booking form API calls |
| test-api | incremental | Generate tests for new/changed endpoints only |
| test-browser | incremental | Run stories for new/changed pages only |
| design | skip | Design phase is always skipped for updates — new pages go directly to React |
| spec | skip | Spec is frozen |
| init | skip | Project already initialized |
| ship | skip | Will run after all changes complete |
```

### Step 0b.5: Update Phase Statuses

```
FOR each affected phase in change plan:
  Set status = Pending (will be re-executed with scoped instructions)
  Set notes = "Update: {scope description}"

FOR each unaffected phase:
  Keep status = Complete (or whatever it was from audit)
```

### Step 0b.6: Update Project Docs from New PRD

Before proceeding to build phases, re-run PRD-to-docs conversion:

```
1. Load skill: .claude/$BACKEND/guides/workflow-convert-prd-to-knowledge.md
2. Input: NEW PRD
3. Output: Updated PROJECT_KNOWLEDGE.md, PROJECT_API.md, PROJECT_DATABASE.md
4. Generate new/updated user stories for changed features only
```

## Quality Gate

```yaml
gate: diff_complete AND change_plan_written
checks:
  - prds_loaded: "Both old and new PRDs read successfully?"
  - diff_computed: "Changes identified and classified?"
  - phases_mapped: "Each change mapped to affected phases?"
  - change_plan: "Change Plan section written to PIPELINE_STATUS.md?"
  - docs_updated: "PROJECT_KNOWLEDGE/API/DATABASE.md updated from new PRD?"
method: "Verify PIPELINE_STATUS.md has Change Plan section with at least 1 change"
```

## Scope Guard

- ONLY modify: PIPELINE_STATUS.md, PROJECT_KNOWLEDGE.md, PROJECT_API.md, PROJECT_DATABASE.md
- May update user story YAML files for new/changed features
- May save new versioned PRD to .claude-project/prd/ (never overwrite existing PRDs)
- Do NOT modify source code (that happens in downstream phases)
- Do NOT create entities, controllers, or components (downstream phases handle that)

## Change Log

After the update pipeline completes, append to the Change Log in PIPELINE_STATUS.md:

```markdown
## Change Log

| Date | Type | Feature | Phases Affected | Status |
|------|------|---------|-----------------|--------|
| 2026-03-13 | add_feature | reviews | prd,db,be,fe,int,test | Complete |
| 2026-03-13 | modify_feature | booking | prd,db,be,fe | Complete |
| 2026-03-13 | remove_feature | referrals | prd,db,be,fe | Complete |
```

---

## Phase Completion — Status Update (MANDATORY)

**No gate script exists for this phase.** Status updates must be done manually via the blueprint's `update-pipeline-status` agentic node.

Update `{TARGET_DIR}/.claude-project/status/{project}/PIPELINE_STATUS.md`:
1. Progress Table: Status, Score (from evaluation), Output
2. Execution Log: Append row
3. Config: Update `last_run`, recalculate `pipeline_score`
