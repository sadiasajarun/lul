# Phase 1: Init (Project Scaffolding)

Phase 1 sets up the target project directory, bootstraps `.claude/` configuration, scaffolds the directory structure, and generates directory-scoped rule files. After this phase, the project has a working skeleton ready for code generation.

## Prerequisites

- Phase 0 (spec) complete, or `--skip-spec` used

## Execution

### Step 1.1: Resolve Target Project Directory

```
IF --path is provided:
  1. TARGET_DIR = resolve to absolute path (e.g., /Users/.../projects/tirebank)
  2. Verify TARGET_DIR exists -> if not, mkdir -p TARGET_DIR
  3. ALL file operations below use TARGET_DIR as root (not cwd)
     - Status file:   TARGET_DIR/.claude-project/status/{project}/PIPELINE_STATUS.md
     - PRD:           TARGET_DIR/.claude-project/prd/
     - Skills/agents: still read from cwd's .claude/ (the source project)
     - Code output:   TARGET_DIR/backend/, TARGET_DIR/frontend/, etc.
  4. If --prd path is relative, resolve it from cwd (not TARGET_DIR)
ELSE:
  TARGET_DIR = cwd (current behavior, no change)
```

**Key principle:** `.claude/` (commands, skills, agents) is read from the **source project** (where you run the command). All generated output goes to **TARGET_DIR**.

### Step 1.2: Bootstrap .claude in Target Project

During Phase 1 (init), if `--path` was used and TARGET_DIR has no `.claude/`:

```bash
cd TARGET_DIR
git init  # if not already a git repo
git submodule add -b main https://github.com/potentialInc/claude-fullstack.git .claude
git submodule update --init --recursive
```

This ensures the target project becomes self-sufficient -- after the first run, it has its own `.claude` and can run `/fullstack` natively.

### Step 1.3: Generate Directory-Scoped Rule Files

After scaffolding directories, generate `.claude-rules` files from stack-specific templates. Each tech-stack submodule owns its own rule template, keeping rules accurate per framework.

```
RULE FILE SOURCES (read from stack submodules):
  Common:   .claude/templates/rules/common.claude-rules.template  -> TARGET_DIR/.claude-rules
  Backend:  .claude/$BACKEND/templates/backend.claude-rules.template -> TARGET_DIR/backend/.claude-rules
  Frontend: .claude/$FRONTEND/templates/frontend.claude-rules.template -> TARGET_DIR/frontend/.claude-rules
```

```bash
# 1. Common rules (from claude-fullstack -- stack-agnostic)
COMMON_TMPL=".claude/templates/rules/common.claude-rules.template"
if [ -f "$COMMON_TMPL" ]; then
  sed -e "s/{PROJECT_NAME}/$PROJECT_NAME/g" \
      -e "s/{BACKEND}/$BACKEND/g" \
      -e "s/{FRONTEND}/$FRONTEND/g" \
      "$COMMON_TMPL" > "$TARGET_DIR/.claude-rules"
fi

# 2. Backend rules (from $BACKEND stack submodule -- e.g., nestjs, django)
BACKEND_TMPL=".claude/$BACKEND/templates/backend.claude-rules.template"
if [ -f "$BACKEND_TMPL" ] && [ -d "$TARGET_DIR/backend" ]; then
  sed -e "s/{PROJECT_NAME}/$PROJECT_NAME/g" \
      -e "s/{BACKEND}/$BACKEND/g" \
      "$BACKEND_TMPL" > "$TARGET_DIR/backend/.claude-rules"
fi

# 3. Frontend rules (from $FRONTEND stack submodule -- e.g., react, react-native)
FRONTEND_TMPL=".claude/$FRONTEND/templates/frontend.claude-rules.template"
if [ -f "$FRONTEND_TMPL" ]; then
  # Auto-detect frontend directory name
  for candidate in frontend frontend-web web client app; do
    if [ -d "$TARGET_DIR/$candidate" ]; then
      sed -e "s/{PROJECT_NAME}/$PROJECT_NAME/g" \
          -e "s/{FRONTEND}/$FRONTEND/g" \
          "$FRONTEND_TMPL" > "$TARGET_DIR/$candidate/.claude-rules"
      break
    fi
  done
fi
```

### Stack Submodule Ownership Table

| Stack            | Template Location                                       | Target                    |
| ---------------- | ------------------------------------------------------- | ------------------------- |
| claude-fullstack | `templates/rules/common.claude-rules.template`          | `/.claude-rules`          |
| nestjs           | `nestjs/templates/backend.claude-rules.template`        | `/backend/.claude-rules`  |
| django           | `django/templates/backend.claude-rules.template`        | `/backend/.claude-rules`  |
| react            | `react/templates/frontend.claude-rules.template`        | `/frontend/.claude-rules` |
| react-native     | `react-native/templates/frontend.claude-rules.template` | `/frontend/.claude-rules` |

This way, when a new stack is added (e.g., `claude-django`), it brings its own rule template -- no changes needed in claude-fullstack.

### Step 1.4: Create Status File

```
Status file path: {TARGET_DIR}/.claude-project/status/{project}/PIPELINE_STATUS.md

If status file doesn't exist:
1. Copy template from .claude/templates/PIPELINE_STATUS.template.md (read from source cwd)
2. Replace {PROJECT_NAME} with actual project name
3. Set all phases to Pending status
4. Set generation: 1
5. Write to {TARGET_DIR}/.claude-project/status/{project}/
```

### Step 1.5: Resolve and Validate Tech Stack

```
1. Read the tech_stack section from PIPELINE_STATUS.md:
   tech_stack:
     backend: nestjs          # or django
     frontends: [react]       # one or more
     dashboards: [admin]      # optional

2. Set variables:
   - $BACKEND = tech_stack.backend
   - $FRONTEND = tech_stack.frontends[0] (primary)

3. Validate required submodules exist:
   For backend and each frontend, check .claude/$STACK/ directory exists.
   If missing, report install instructions and stop.

4. Resolve skill paths for all phases (see skill path table below).
```

### Step 1.6: Generate CLAUDE.md (MANDATORY)

CLAUDE.md is the project's primary configuration file — it tells Claude Code about the tech stack, coding patterns, doc reading requirements, and anti-patterns. It MUST exist before any code phase runs.

```
1. Read template: .claude/templates/claude.template.md

2. Replace ALL placeholders using resolved values from Step 1.5:

   Project:
   - {PROJECT_NAME}         → project name
   - {PROJECT_TYPE}         → "Fullstack Web Application"
   - {PROJECT_DESCRIPTION}  → from seed.goal or PRD overview (if available), else "TODO"
   - {KEY_DIFFERENTIATOR}   → from seed or PRD, else "TODO"
   - {PROJECT_DOMAIN}       → from seed or PRD (e.g., "taskboard.com"), else "{PROJECT_NAME}.com"
   - {DATE}                 → current date (YYYY-MM-DD)

   Tech Stack:
   - {BACKEND}              → tech_stack.backend (e.g., "nestjs")
   - {FRONTEND}             → tech_stack.frontends[0] (e.g., "react")
   - {ADMIN_DASHBOARD}      → tech_stack.dashboards[0] or "React (same app)" or "N/A"
   - {DATABASE}             → "PostgreSQL" (default)
   - {ORM}                  → "TypeORM" (for nestjs) or "Prisma" (for django)
   - {AUTH}                 → "JWT httpOnly cookies"
   - {DEPLOYMENT}           → "Docker" (default)

   Roles (from seed ontology or PRD user types):
   - {ROLE_1}               → primary non-admin role name (e.g., "Project Owner")
   - {ROLE_1_DESCRIPTION}   → role description from PRD
   - {ROLE_1_PERMISSIONS}   → key permissions summary
   - {ROLE_2}               → secondary role name (e.g., "Team Member")
   - {ROLE_2_DESCRIPTION}   → role description from PRD
   - {ROLE_2_PERMISSIONS}   → key permissions summary
   - {ADMIN_PERMISSIONS}    → admin role permissions summary
   - {ROLE_ENUM_VALUES}     → comma-separated enum values (e.g., "`project_owner`, `team_member`, `admin`")

   Design:
   - {PRIMARY_COLOR_NAME}   → from DESIGN_SYSTEM.md or PRD, else "Blue"
   - {PRIMARY_COLOR_HEX}    → from DESIGN_SYSTEM.md or PRD, else "#4A90D9"

   NOTE: If seed/PRD is not yet available (Phase 0 skipped, Phase 2 not run),
   use "TODO" for description/role fields. Phase 2 will re-generate CLAUDE.md
   with full values after PRD conversion.

3. Write to: {TARGET_DIR}/CLAUDE.md

4. Verify: CLAUDE.md exists and contains no remaining {PLACEHOLDER} tokens
   bash: grep -cE '\{[A-Z_]+\}' {TARGET_DIR}/CLAUDE.md
   Expected: 0 (all placeholders resolved)
   If > 0: FAIL — unresolved placeholders found, fix before proceeding
```

### Skill Path Resolution Table

```
Phase -> Tier -> Skill Path
---------------------------
spec      -> ooo       -> .claude/spec/commands/ouroboros/interview.md + seed.md
init      -> core      -> .claude/skills/operation/phase-1-init.md
prd       -> core+back -> .claude/skills/dev/generate-prd/SKILL.md (generate)
                       -> .claude/$BACKEND/guides/workflow-convert-prd-to-knowledge.md (convert)
design    -> core      -> .claude/skills/design-orchestrator.md (orchestrator)
                       -> .claude/skills/design-system-creator.md (3a)
                       -> .claude/skills/design-prompts-generator.md (3b)
                       -> .claude/skills/html-generator.md (3c)
                       -> .claude/skills/design-qa-validator.md (3d)
database  -> $BACKEND  -> .claude/$BACKEND/guides/workflow-design-database.md
backend   -> $BACKEND  -> .claude/$BACKEND/skills/api-development/SKILL.md
frontend  -> $FRONTEND -> .claude/$FRONTEND/skills/converters/html-to-react-converter.md
integrate -> $FRONTEND -> .claude/$FRONTEND/skills/api-integration/SKILL.md
test      -> $BACKEND  -> .claude/$BACKEND/guides/workflow-generate-e2e-tests.md (backend API tests)
           + $FRONTEND -> .claude/$FRONTEND/skills/e2e-test-generator.md (frontend E2E tests)
qa        -> $FRONTEND -> .claude/$FRONTEND/skills/qa/design-qa-html.md + qa/design-qa-figma.md
ship      -> core      -> .claude/skills/deployment.md
```

## Quality Gate

```yaml
gate: directories_exist AND status_file_created AND tech_stack_validated AND claude_md_generated
checks:
  - project_dir_exists: "TARGET_DIR exists and is a git repo?"
  - claude_submodule: ".claude/ exists in TARGET_DIR (if --path used)?"
  - status_file: "PIPELINE_STATUS.md created with all phases?"
  - rule_files: ".claude-rules files generated for common/backend/frontend?"
  - tech_stack_valid: "Required submodules ($BACKEND, $FRONTEND) exist?"
  - claude_md: "CLAUDE.md exists at TARGET_DIR root with no unresolved {PLACEHOLDER} tokens?"
```

## Loop Integration

- No loop workflow runs for this phase
- Phase 1 is deterministic scaffolding only

---

## Phase Completion — Status Update (MANDATORY)

**No gate script exists for this phase.** Status updates must be done manually via the blueprint's `update-pipeline-status` agentic node.

Update `{TARGET_DIR}/.claude-project/status/{project}/PIPELINE_STATUS.md`:
1. Progress Table: Status, Score (from evaluation), Output
2. Execution Log: Append row
3. Config: Update `last_run`, recalculate `pipeline_score`
