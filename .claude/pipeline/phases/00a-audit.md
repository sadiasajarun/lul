# Phase 0a: Project Audit (for Adopt and Update modes)

The audit phase scans an existing project to inventory what artifacts already exist and at what completeness level. It produces a structured audit report that drives adopt mode (skip what's done) and update mode (scope changes to what's new).

This phase runs automatically when `--adopt` or `--update` is specified. It does NOT run in greenfield mode.

## Prerequisites

- None (runs before all other phases)

## Execution

### Step 0a.1: Scan Project Artifacts

For each pipeline phase, check for expected artifacts on disk:

```
FOR each phase in [spec, init, prd, user-stories, design, database, backend, frontend, integrate, test-api, test-browser, ship]:

  Run artifact checks (see Artifact Checks table below)
  Classify phase:
    - COMPLETE: all expected artifacts present AND gate passes (or no gate)
    - PARTIAL:  some artifacts present but not all
    - MISSING:  no artifacts for this phase

  For PARTIAL phases, list:
    - existing_artifacts: what was found
    - missing_artifacts: what's expected but not found (compare against PRD/PROJECT_API.md/PROJECT_DATABASE.md)
```

### Artifact Checks

| Phase | Check Command | Complete When |
|-------|--------------|---------------|
| spec | `ls {TARGET_DIR}/.claude-project/status/{project}/seed-*.yaml 2>/dev/null` | seed file exists |
| init | `test -f {TARGET_DIR}/backend/package.json` | backend scaffolded |
| prd | `test -f {TARGET_DIR}/.claude-project/prd/*.md && test -f {TARGET_DIR}/.claude-project/docs/PROJECT_KNOWLEDGE.md && test -f {TARGET_DIR}/.claude-project/docs/PROJECT_API.md && test -f {TARGET_DIR}/.claude-project/docs/PROJECT_DATABASE.md` | PRD + all 3 docs exist |
| user-stories | `ls {TARGET_DIR}/.claude-project/user_stories/*.yaml 2>/dev/null \| wc -l` | at least 1 story file |
| design | `ls {TARGET_DIR}/.claude-project/generated-screens/{project}/*.html 2>/dev/null \| wc -l` OR `ls {TARGET_DIR}/.claude-project/design/html/*.html 2>/dev/null \| wc -l` | HTML files exist |
| database | `find {TARGET_DIR}/backend/src -name '*.entity.ts' \| wc -l` | entity files with @Entity decorator |
| backend | `find {TARGET_DIR}/backend/src -name '*.controller.ts' \| wc -l` AND `find {TARGET_DIR}/backend/src -name '*.service.ts' \| wc -l` | controllers + services per module |
| frontend | `find {TARGET_DIR}/frontend/app/pages -name '*.tsx' 2>/dev/null \| wc -l` | React page components exist |
| integrate | Check if frontend pages import from services/api/ (not mock data) | API service calls present |
| test-api | `find {TARGET_DIR}/backend/test -name '*.e2e-spec.ts' 2>/dev/null \| wc -l` | e2e test files exist |
| test-browser | `test -f {TARGET_DIR}/.claude-project/status/{project}/QA_REPORT.md` | QA report exists |
| ship | `test -d {TARGET_DIR}/frontend/dist && test -d {TARGET_DIR}/backend/dist` | build outputs exist |

### Step 0a.2: Deep Inventory for Partial Phases

For phases classified as PARTIAL, produce a detailed inventory by comparing existing artifacts against the spec:

```
IF database is PARTIAL:
  1. Read PROJECT_DATABASE.md to get expected entity list
  2. List existing *.entity.ts files
  3. Report: "Found 3/5 entities: User, Booking, Service. Missing: Review, Payment"

IF backend is PARTIAL:
  1. Read PROJECT_API.md to get expected endpoint list
  2. List existing *.controller.ts files and their routes
  3. Report: "Found 3/5 modules: users, bookings, services. Missing: reviews, payments"

IF frontend is PARTIAL:
  1. List HTML files from design phase (expected pages)
  2. List existing React page components
  3. Report: "Found 4/8 pages: Landing, Login, Dashboard, Booking. Missing: Reviews, Profile, Settings, Admin"

IF integrate is PARTIAL:
  1. For each React page, check if it imports from services/api/
  2. Report: "3/4 pages integrated. Mock data remaining in: BookingPage"
```

### Step 0a.3: Build Feature Inventory

Cross-reference artifacts across layers to build a feature-level view:

```
FOR each feature/module in PROJECT_KNOWLEDGE.md:
  Check:
    - PRD section exists?
    - Entity file exists?
    - Controller + Service exist?
    - Frontend page exists?
    - API integration done?
    - Tests exist?

  Output row in Feature Inventory table
```

### Step 0a.4: Write Audit Results to PIPELINE_STATUS.md

Update PIPELINE_STATUS.md with:

1. Set `mode` field in Configuration
2. Update Progress table: set each phase status based on audit (Complete/Partial/Pending)
3. Write `## Audit Results` section with detailed per-phase findings
4. Write `## Feature Inventory` section

```markdown
## Audit Results

audit_date: {DATE}
audit_mode: adopt | update

| Phase | Audit Status | Artifacts Found | Missing Artifacts | Notes |
|-------|-------------|-----------------|-------------------|-------|
| spec | Complete | seed-abc.yaml | - | - |
| prd | Complete | PRD.md, KNOWLEDGE.md, API.md, DB.md | - | - |
| database | Partial | User, Booking, Service entities | Review, Payment entities | 3/5 |
| backend | Partial | users, bookings, services modules | reviews, payments modules | 3/5 |
| frontend | Partial | Landing, Login, Dashboard, Booking | Reviews, Profile, Settings | 4/7 |
| integrate | Missing | - | all pages need wiring | - |

## Feature Inventory

| Feature | PRD | Entity | Controller | Service | Page | Integrated | Tests |
|---------|-----|--------|------------|---------|------|------------|-------|
| auth | Y | User | Y | Y | Login | Y | Y |
| booking | Y | Booking, TimeSlot | Y | Y | Booking | N | N |
| reviews | Y | - | - | - | - | - | - |
```

## Quality Gate

```yaml
gate: audit_complete
checks:
  - all_phases_scanned: "Every pipeline phase has been checked?"
  - inventory_written: "Audit Results section written to PIPELINE_STATUS.md?"
  - feature_inventory: "Feature Inventory table populated?"
method: "Verify PIPELINE_STATUS.md has Audit Results and Feature Inventory sections"
```

## Scope Guard

- ONLY modify: PIPELINE_STATUS.md (audit sections)
- Do NOT modify any source code
- Do NOT create new files except status updates
- Read-only access to all project files for scanning

---

## Phase Completion — Status Update (MANDATORY)

**No gate script exists for this phase.** Status updates must be done manually via the blueprint's `update-pipeline-status` agentic node.

Update `{TARGET_DIR}/.claude-project/status/{project}/PIPELINE_STATUS.md`:
1. Progress Table: Status, Score (from evaluation), Output
2. Execution Log: Append row
3. Config: Update `last_run`, recalculate `pipeline_score`
