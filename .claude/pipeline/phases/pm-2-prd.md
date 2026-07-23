# Phase P2: PRD (PM track — PRD-only variant)

PM-track variant of Phase 2. Generates the PRD document only. Does **NOT** derive `PROJECT_KNOWLEDGE.md`, `PROJECT_API.md`, `PROJECT_DATABASE.md` — that derivation belongs to `D2-tech-spec` on the Dev side. Does **NOT** generate user story YAMLs — those belong to `D3-user-stories`.

The handoff to Dev is PRD + approved HTML (produced by P3). Everything else is machine-derivable by `/fullstack-dev`.

## Prerequisites

- P1 (spec) complete, or `--skip-spec` used
- **NOTE:** Phase 1 (init) is **not** required for PM track — PM phases create any directories they need via `mkdir -p` on-demand.

## Scope Rules (PM-track — HARD STOP)

- This phase is part of the `pm` group. Do **not** read, invoke, or depend on Dev-track phase files (`01-init.md`, `02-prd.md`, `03-design.md`, `dev-*.md`, or any D-series).
- Do **not** write `PROJECT_KNOWLEDGE.md`, `PROJECT_API.md`, `PROJECT_DATABASE.md`.
- Do **not** write `user_stories/` files.

## ⚠️ PRD File Reading Rules (A-02 prevention)

Same rules as legacy Phase 2 apply when an existing PRD is provided via `--prd <path>`:

```
After confirming PRD_FILE path:
  wc -l < "$PRD_FILE"
  400 lines or fewer → single Read allowed
  Over 400 lines     → chunk reading required (offset/limit in 400-line increments)
```

## Execution

### Step P2.1: Ensure output directories

```bash
mkdir -p "{TARGET_DIR}/.claude-project/prd"
mkdir -p "{TARGET_DIR}/.claude-project/docs"
```

### Step P2.2: Generate OR validate PRD

```
IF --prd <path> is provided:
  1. Apply PRD File Reading Rules (size check → chunk strategy)
  2. Copy to {TARGET_DIR}/.claude-project/prd/{PROJECT_NAME}_PRD.md
  3. Also mirror to {TARGET_DIR}/.claude-project/docs/PRD.md (canonical handoff path)
  4. Skip to Step P2.3

IF no --prd and PRD exists at {TARGET_DIR}/.claude-project/prd/*.md OR docs/PRD.md:
  1. Apply PRD File Reading Rules
  2. Validate required sections (Overview, Terminology, Modules, Pages, Tech Stack)
  3. If canonical copy missing at docs/PRD.md → copy from prd/*.md
  4. Skip to Step P2.3

IF no PRD exists:
  1. MANDATORY: Read skill .claude/skills/dev/generate-prd/SKILL.md (and resource templates it references)
  2. Use seed from P1 (.claude-project/status/{project}/seed-*.yaml) as input context:
     - seed.goal           → Project Overview
     - seed.ontology       → Terminology
     - seed.constraints    → Tech Stack decisions
     - seed.acceptance_criteria → Feature lists
  3. Follow skill workflow: ask 4 clarifying questions → fill prd-template.md
  4. Write output to:
     a. {TARGET_DIR}/.claude-project/prd/{PROJECT_NAME}_PRD.md
     b. {TARGET_DIR}/.claude-project/docs/PRD.md   (copy of same content — canonical handoff)
```

### Step P2.3: Record PRD version snapshot

```bash
mkdir -p "{TARGET_DIR}/.claude-project/prd/history"

PRD_FILE="{TARGET_DIR}/.claude-project/docs/PRD.md"

# Normalize: trim trailing whitespace, ensure LF line endings, strip trailing newline
PRD_HASH=$(sed -e 's/[[:space:]]*$//' "$PRD_FILE" | tr -d '\r' | sha256sum | awk '{print $1}')

# Find next version number
LAST_VER=$(ls "{TARGET_DIR}/.claude-project/prd/history"/PRD_v*.hash 2>/dev/null | sed 's/.*PRD_v\([0-9]*\)\.hash/\1/' | sort -n | tail -1)
NEXT_VER=$((${LAST_VER:-0} + 1))

# Only snapshot if hash differs from last
LAST_HASH=$([ -f "{TARGET_DIR}/.claude-project/prd/history/PRD_v${LAST_VER}.hash" ] && cat "{TARGET_DIR}/.claude-project/prd/history/PRD_v${LAST_VER}.hash" || echo "")

if [ "$PRD_HASH" != "$LAST_HASH" ]; then
  cp "$PRD_FILE" "{TARGET_DIR}/.claude-project/prd/history/PRD_v${NEXT_VER}.md"
  echo "$PRD_HASH" > "{TARGET_DIR}/.claude-project/prd/history/PRD_v${NEXT_VER}.hash"
  echo "PRD snapshot recorded: v${NEXT_VER}"
else
  echo "PRD unchanged since v${LAST_VER} — no new snapshot"
fi
```

### Step P2.4: Update PIPELINE_STATUS.md

Row key: **`P2-prd`** (not `2-prd` — PM-track uses logical name from `pipeline/phase-groups.yaml`).

Update:
- Progress Table row for `P2-prd` → Status=Complete, Score=(from evaluation), Output=`.claude-project/docs/PRD.md`
- Execution Log: append row with timestamp
- Config: update `last_run`, recalculate `pipeline_score`

## Quality Gate

No shell-based gate. Evaluation-only:

```yaml
gate: prd_exists AND all_sections_present AND feature_coverage >= 90%
checks:
  - prd_canonical_exists: "{TARGET_DIR}/.claude-project/docs/PRD.md present?"
  - prd_archive_exists:   "{TARGET_DIR}/.claude-project/prd/*.md present?"
  - sections_complete:    "Overview, Terminology, Modules, Pages, Tech Stack all present in PRD?"
  - no_ambiguity:         "No vague terms like 'should', 'might', 'optionally'?"
  - seed_aligned:         "PRD features match seed acceptance criteria (if seed exists)?"
  - version_snapshot:     "{TARGET_DIR}/.claude-project/prd/history/PRD_v*.{md,hash} recorded?"
method: "Check canonical PRD path, parse sections, verify no placeholders, check snapshot recorded."
```

## Loop Integration

- **Command**: `/fullstack-pm {project} --phase P2-prd --loop`
- **When**: Sections missing or ambiguity > threshold
- **Skill**: `.claude/skills/dev/generate-prd/SKILL.md`

## Phase Completion — Status Update (MANDATORY)

No gate script exists for this phase. Status update is done by the blueprint's `update-pipeline-status` agentic node, which writes the `P2-prd` row (not `2-prd`).

## What This Phase Does NOT Do

- ❌ Generate `PROJECT_KNOWLEDGE.md`, `PROJECT_API.md`, `PROJECT_DATABASE.md` → D2-tech-spec owns these
- ❌ Generate `user_stories/*.yaml` → D3-user-stories owns these
- ❌ Generate `CLAUDE.md`, `.claude-rules`, `backend/`, `frontend/` → D1-init owns these
- ❌ Create `.claude-project/context/PRD_chunk_*.md` → not needed since Dev regenerates docs fresh from current PRD (no chunk cache)
