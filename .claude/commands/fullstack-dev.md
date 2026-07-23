---
description: Dev workflow — init, tech-spec, user-stories, database, backend, frontend, integrate, tests, ship (D1–D10). Requires PRD + approved design HTML from /fullstack-pm (or external sources).
argument-hint: "<project> [--run | --run-all | --loop | --phase <D1-init|...|D10-ship> [--loop] | --resume | --reset <phase>] [--path <dir>] [--frontend <name>] [--trust-design] [--accept-design-drift] [--strict-roles]"
---

# /fullstack-dev — Dev Pipeline (D1–D10)

Dev-track orchestrator. Runs only the engineering slice of the fullstack pipeline: scaffolding + design-intent extraction (D1), tech spec derivation from PRD + intent (D2), user stories (D3), database → backend → frontend → integrate → tests → ship (D4–D10).

## Entry Requirements (3-Tier handoff check)

Before any Dev phase runs, this command validates that PM artifacts (or equivalent external artifacts) are in place. The check is defined in `.claude/pipeline/phase-groups.yaml` under `handoff:`.

### Tier 1 — Required artifacts (hard-fail)

- `.claude-project/docs/PRD.md` OR `.claude-project/prd/*.md` must exist
- `.claude-project/design/html/**/*.html` must have ≥ 1 file
- At least one of:
  - `DESIGN_STATUS.md` with `approved: true`
  - `--trust-design` flag passed (external-designer acceptance)

### Tier 2 — PRD ↔ design consistency

- If `DESIGN_STATUS.md` has `prd_hash_at_generation` → must match current PRD SHA256 (normalized).
- If missing → warn; require `--accept-design-drift` to continue.
- If mismatch → hard-fail with:
  ```
  PRD has changed since design was approved.
  Run /fullstack-pm {project} --update --prd <path> first.
  ```

### Tier 3 — Role-based folder structure

- Role folders under `design/html/<role>/` should match `DESIGN_STATUS.roles` list, ≥ 1 HTML per role.
- Flat structure → warn (treat as single `app` role).
- With `--strict-roles` → hard-fail on flat structure or role mismatch.

Tier failures prevent all phase execution. Tier guidance messages are printed from the `handoff.*_fail_message` fields in phase-groups.yaml.

## Dev Phase List

| Logical | Physical file | Status |
|---|---|---|
| **D1-init** | `pipeline/phases/dev-1-init.md` (new) | scaffold + design-intent.yaml extraction |
| **D2-tech-spec** | `pipeline/phases/dev-2-tech-spec.md` (new) | PRD + intent → PROJECT_*.md (frontmatter hashes) |
| **D3-user-stories** | `pipeline/phases/03.5-user-stories.md` (reused) | existing logic, row key `D3-user-stories` |
| **D4-database** | `pipeline/phases/04-database.md` (reused) | row key `D4-database` |
| **D5-backend** | `pipeline/phases/05-backend.md` (reused) | row key `D5-backend` |
| **D6-frontend** | `pipeline/phases/06-frontend.md` (reused) | row key `D6-frontend` |
| **D7-integrate** | `pipeline/phases/07-integrate.md` (reused) | row key `D7-integrate` |
| **D8-test-api** | `pipeline/phases/08-test-api.md` (reused) | row key `D8-test-api` |
| **D9-test-browser** | `pipeline/phases/09-test-browser.md` (reused) | row key `D9-test-browser` |
| **D10-ship** | `pipeline/phases/10-ship.md` (reused) | row key `D10-ship` |

## HARD STOP — Dev-track scope enforcement

This command runs ONLY D1–D10.

**Forbidden:**
- Reading or invoking `00-spec.md`, `02-prd.md`, `03-design.md`, any `pm-*.md`
- Writing to `.claude-project/docs/PRD.md` (PM-owned source of truth)
- Writing to `.claude-project/design/html/` or `DESIGN_STATUS.md` (PM-owned)
- Writing to `.claude-project/prd/history/` (PM-owned)
- Updating PIPELINE_STATUS.md rows for any PM phase (P1–P3)

If a user passes `--phase <name>` with a PM phase name (e.g., `P1-spec`), reject with:

```
Error: Phase "<name>" is not in the Dev track (D1-init through D10-ship).
Use /fullstack-pm for PM phases, or /fullstack for the legacy full pipeline.
```

---

## Execution Instructions

### Step 1: Parse Arguments

```
project = $1
action = --run | --run-all | --loop | --phase <name> [--loop] | --resume | --reset <name>
target_path = --path <dir>
frontend_name = --frontend <name>
trust_design = --trust-design
accept_design_drift = --accept-design-drift
strict_roles = --strict-roles
```

### Step 2: Resolve TARGET_DIR

```
IF --path: TARGET_DIR = absolute(path), must exist (else error)
ELSE:      TARGET_DIR = cwd
```

### Step 3: Resolve active phase group

- Load `.claude/pipeline/phase-groups.yaml`
- Active group = `dev` = [D1-init, D2-tech-spec, D3-user-stories, D4-database, …, D10-ship]

### Step 4: **3-Tier Handoff Validation** (blocks all phase execution)

Execute inline Bash to evaluate each tier's conditions from `phase-groups.yaml`:

#### Tier 1 check

```bash
PRD_OK=0
for p in "$TARGET_DIR/.claude-project/docs/PRD.md" "$TARGET_DIR/.claude-project/prd"/*.md; do
  [ -f "$p" ] && PRD_OK=1 && break
done

HTML_COUNT=$(find "$TARGET_DIR/.claude-project/design/html" -name '*.html' -type f 2>/dev/null | wc -l | tr -d ' ')

APPROVED=0
for s in "$TARGET_DIR/.claude-project/status"/*/DESIGN_STATUS.md \
         "$TARGET_DIR/.claude-project/design/DESIGN_STATUS.md"; do
  [ -f "$s" ] && grep -qE '^approved:[[:space:]]*true' "$s" && APPROVED=1 && break
done

# Tier 1 evaluation:
# Required: PRD_OK=1 AND HTML_COUNT>=1
# Any-of:   APPROVED=1 OR --trust-design flag set
```

If Tier 1 fails → print handoff.tier1_fail_message → exit non-zero.

#### Tier 2 check (if Tier 1 passed)

```bash
# Compute current PRD hash
PRD_FILE="$TARGET_DIR/.claude-project/docs/PRD.md"
[ -f "$PRD_FILE" ] || PRD_FILE=$(ls "$TARGET_DIR/.claude-project/prd"/*.md | head -1)
CURRENT_HASH=$(sed -e 's/[[:space:]]*$//' "$PRD_FILE" | tr -d '\r' | sha256sum | awk '{print $1}')

# Extract snapshot hash from DESIGN_STATUS
SNAPSHOT_HASH=""
for s in "$TARGET_DIR/.claude-project/status"/*/DESIGN_STATUS.md \
         "$TARGET_DIR/.claude-project/design/DESIGN_STATUS.md"; do
  if [ -f "$s" ]; then
    SNAPSHOT_HASH=$(awk '/^prd_hash_at_generation:/{gsub(/"/,"",$2); print $2; exit}' "$s")
    [ -n "$SNAPSHOT_HASH" ] && break
  fi
done

# Evaluate:
# - SNAPSHOT_HASH empty → warn unless --accept-design-drift
# - SNAPSHOT_HASH != CURRENT_HASH → hard_fail with guidance
# - SNAPSHOT_HASH == CURRENT_HASH → pass
```

#### Tier 3 check (if Tier 1 and 2 passed)

```bash
HTML_ROOT="$TARGET_DIR/.claude-project/design/html"
ROLE_DIRS=$(find "$HTML_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')

if [ "$ROLE_DIRS" -eq 0 ]; then
  # Flat structure
  if [ "$strict_roles" = "1" ]; then
    echo "Tier 3 hard-fail: flat HTML structure, --strict-roles requires role folders"
    exit 1
  else
    echo "Tier 3 warning: flat HTML structure (treating as single 'app' role)"
  fi
fi

# Compare role dirs to STATUS.roles if present
```

### Step 5: Status file

- Ensure `.claude-project/status/{project}/PIPELINE_STATUS.md` exists
- Row keys use **D-series logical names** (D1-init, D2-tech-spec, …, D10-ship)
- Do not touch P-series rows

### Step 6: Legacy-mixing detection

Warn if legacy `/fullstack` artifacts detected that conflict with neo expectations:
- `.claude-project/docs/PROJECT_*.md` that lack `prd_hash:` frontmatter → will be overwritten by D2
- PIPELINE_STATUS.md has legacy row keys (`database`, `backend`, …) → will be updated with new D-series keys

Print warning, continue unless `--force` is negative.

### Step 7: Action handler

- **No action** → show Dev-track status (D1–D10 row snapshots) + Tier 1/2/3 status
- **`--run`** → run next pending Dev phase
- **`--run-all`** → run D1 → D10 sequentially; stop on gate failure
- **`--loop`** → infinite-loop until gates converge or max-generations hit
- **`--phase <D#>`** → run specific Dev phase. If `--loop`, loop it.
- **`--resume`** → after manual `design-intent.yaml` edit, re-enter from D2 onwards
- **`--reset <phase>`** → set Dev phase row to Pending (must be Dev phase)

### Step 8: Phase execution

Same pattern as `/fullstack`:

1. Load module from `phase-groups.yaml` mapping
2. Load manifest (`dev-*.manifest.yaml` for new phases; legacy `*.manifest.yaml` for reused phases)
3. Pre-hydrate context
4. Execute blueprint
5. Run gate
6. **Important:** When updating PIPELINE_STATUS.md, use **D-series row keys** (D4-database, not `database`) — even for reused phases. Blueprint's `update-pipeline-status` node must map the row key to the logical name from `phase-groups.yaml:row_key_map`.
7. Gate fail → report + non-zero exit

### Step 9: Reused phase + new row-key mapping

Reused phases (D3–D10) use existing blueprints (`user-stories.yaml`, `database.yaml`, etc.) unchanged. But PIPELINE_STATUS.md row key must be `D3-user-stories`, `D4-database`, etc.

Implementation: after legacy blueprint runs, run a post-update step that reads `phase-groups.yaml:row_key_map` and rewrites the row header in PIPELINE_STATUS.md from the legacy name to the D-series name (if a legacy row was accidentally created).

### Step 10: Loop mode

Infinite-loop behavior scoped to Dev phases only. Skip phases already at Complete. On convergence or max-generations, print summary.

---

## Flag Matrix

See `/fullstack-pm` for full matrix. Dev-specific flags:

- `--trust-design` — proceed without `approved: true` signal (use with external designer HTML)
- `--accept-design-drift` — proceed when `DESIGN_STATUS.md` has no `prd_hash_at_generation` field
- `--strict-roles` — escalate Tier 3 to hard-fail when flat HTML structure detected

## Runtime Artifacts

### New artifacts /fullstack-dev creates (beyond what /fullstack would):

- `.claude-project/design/design-intent.yaml` — D1 output, bridge artifact
- `PROJECT_*.md` frontmatter with `prd_hash` + `intent_hash` + `generated_at` — D2
- `PROJECT_API.md` extra sections: Screen↔Endpoints, Endpoint→Screens, Role×Endpoint — D2

### Artifacts /fullstack-dev creates at existing paths (same as legacy):

- `CLAUDE.md`, `.claude-rules`, `backend/.claude-rules`, `frontend/.claude-rules`
- `backend/`, `frontend/` scaffolds
- `.claude-project/memory/{DECISIONS,LEARNINGS,PREFERENCES}.md`
- `.claude-project/user_stories/*.yaml`, `_fixtures.yaml`
- `backend/src/**`, `frontend/app/**`, tests, etc.
- `.claude-project/routes.yaml` — D6
- Status files: SMOKE_TEST_STATUS.md, STORY_TEST_REPORT.md, DEPLOYMENT_STATUS.md

### Gate proof file names

All gate proofs live at `.claude-project/status/.gate-proofs/{LOGICAL_NAME}.proof`:
- `D1-init.proof`, `D2-tech-spec.proof`, `D3-user-stories.proof`, …, `D10-ship.proof`

---

## Example Usage

```bash
# After /fullstack-pm completed — run Dev
/fullstack-dev my-saas --run-all

# External PRD + external HTML (no PM run)
/fullstack-dev my-ext --trust-design --accept-design-drift --run-all

# Run only tech-spec (e.g., after editing design-intent.yaml manually)
/fullstack-dev my-saas --phase D2-tech-spec

# Loop backend until AC compliance hits threshold
/fullstack-dev my-saas --phase D5-backend --loop

# Re-extract design intent (PM updated HTML)
/fullstack-dev my-saas --phase D1-init

# Check status
/fullstack-dev my-saas
```

## After Tier 2 hard-fail

If `/fullstack-dev` reports:
```
PRD has changed since design was approved.
Current PRD hash: <sha256>
DESIGN_STATUS.prd_hash_at_generation: <sha256>
Run /fullstack-pm <project> --update --prd <path> first.
```

Run:
```bash
/fullstack-pm my-saas --update --prd .claude-project/docs/PRD.md
```

This regenerates design (P3 re-approval may be needed) and writes a new snapshot. Then:
```bash
/fullstack-dev my-saas
```
will pass Tier 2.
