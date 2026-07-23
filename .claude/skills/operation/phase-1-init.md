# Project Init Skill

Phase 1 (init) of the `/fullstack` pipeline. Scaffolds a new project with `.claude` submodule and `.claude-project/` documentation structure.

## Inputs

- `$PROJECT_NAME` — project name (lowercase, hyphenated)
- `$TARGET_DIR` — absolute path to target project directory
- `$BACKEND` — backend tech stack (e.g., nestjs, django)
- `$FRONTENDS` — array of frontend frameworks (e.g., [react])

## Steps

### 1. Initialize Git Repository

```bash
cd $TARGET_DIR
git init  # if not already a git repo
```

### 2. Add .claude Submodule

If `$TARGET_DIR/.claude/` doesn't exist:

```bash
cd $TARGET_DIR
git submodule add -b main https://github.com/potentialInc/claude-fullstack.git .claude
git submodule update --init --recursive
```

### 3. Add Tech Stack Submodules

Based on `$BACKEND` and `$FRONTENDS`, add the corresponding submodules inside `.claude/`:

```bash
# Backend (e.g., nestjs)
git submodule add -b main https://github.com/potentialInc/claude-$BACKEND.git .claude/$BACKEND

# Frontend (e.g., react)
for FRONTEND in $FRONTENDS; do
  git submodule add -b main https://github.com/potentialInc/claude-$FRONTEND.git .claude/$FRONTEND
done
```

If submodule repos don't exist yet, skip with a warning — the user can add them later.

### 4. Scaffold .claude-project/

Create the `.claude-project/` directory structure from templates:

```bash
# Create directories
mkdir -p .claude-project/docs
mkdir -p .claude-project/memory
mkdir -p .claude-project/status/backend
mkdir -p .claude-project/status/frontend
mkdir -p .claude-project/status/temp
mkdir -p .claude-project/prd
mkdir -p .claude-project/secrets
mkdir -p .claude-project/hooks
mkdir -p .claude-project/agents
mkdir -p .claude-project/skills
```

If dashboards detected:
```bash
mkdir -p .claude-project/status/frontend-dashboard
```

### 4.5. Scaffold Backend & Frontend Directory Structure

Create the full directory structure defined in the tech stack submodule guides. This ensures the backend/frontend phases fill in existing directories rather than creating ad-hoc structures.

**Backend (NestJS)** — based on `.claude/$BACKEND/guides/architecture-overview.md`:

```bash
# Core framework directories (MUST exist before backend phase)
mkdir -p $TARGET_DIR/backend/src/core/base
mkdir -p $TARGET_DIR/backend/src/core/decorators
mkdir -p $TARGET_DIR/backend/src/core/filters
mkdir -p $TARGET_DIR/backend/src/core/guards
mkdir -p $TARGET_DIR/backend/src/core/interceptors
mkdir -p $TARGET_DIR/backend/src/core/pipes
mkdir -p $TARGET_DIR/backend/src/core/dto

# Feature modules (created empty, backend phase fills per entity)
mkdir -p $TARGET_DIR/backend/src/modules

# Infrastructure (external service integrations)
mkdir -p $TARGET_DIR/backend/src/infrastructure/mail
mkdir -p $TARGET_DIR/backend/src/infrastructure/s3
mkdir -p $TARGET_DIR/backend/src/infrastructure/token
mkdir -p $TARGET_DIR/backend/src/infrastructure/logging

# Database (migrations + seeders)
mkdir -p $TARGET_DIR/backend/src/database/migrations
mkdir -p $TARGET_DIR/backend/src/database/seeders

# Shared utilities
mkdir -p $TARGET_DIR/backend/src/common/enums

# Configuration
mkdir -p $TARGET_DIR/backend/src/config

# Tests
mkdir -p $TARGET_DIR/backend/test/e2e

# .gitkeep for empty placeholder dirs
touch $TARGET_DIR/backend/src/database/migrations/.gitkeep
touch $TARGET_DIR/backend/src/infrastructure/mail/.gitkeep
touch $TARGET_DIR/backend/src/infrastructure/s3/.gitkeep
touch $TARGET_DIR/backend/src/infrastructure/token/.gitkeep
touch $TARGET_DIR/backend/src/infrastructure/logging/.gitkeep
```

**Frontend (React)** — based on `.claude/$FRONTEND/docs/file-organization.md`:

```bash
for FRONTEND in $FRONTENDS; do
  FRONTEND_DIR=$TARGET_DIR/$FRONTEND
  mkdir -p $FRONTEND_DIR/app/components/ui
  mkdir -p $FRONTEND_DIR/app/components/atoms
  mkdir -p $FRONTEND_DIR/app/components/modals
  mkdir -p $FRONTEND_DIR/app/components/shared
  mkdir -p $FRONTEND_DIR/app/components/layouts
  mkdir -p $FRONTEND_DIR/app/components/guards
  mkdir -p $FRONTEND_DIR/app/contexts
  mkdir -p $FRONTEND_DIR/app/enums
  mkdir -p $FRONTEND_DIR/app/hooks
  mkdir -p $FRONTEND_DIR/app/lib
  mkdir -p $FRONTEND_DIR/app/pages
  mkdir -p $FRONTEND_DIR/app/redux/features
  mkdir -p $FRONTEND_DIR/app/redux/store
  mkdir -p $FRONTEND_DIR/app/routes
  mkdir -p $FRONTEND_DIR/app/services/httpMethods
  mkdir -p $FRONTEND_DIR/app/services/httpServices/queries
  mkdir -p $FRONTEND_DIR/app/styles
  mkdir -p $FRONTEND_DIR/app/types
  mkdir -p $FRONTEND_DIR/app/utils/validations
done
```

### 5. Copy and Process Templates

Template source: `.claude/templates/claude-project/`

For each template file:
1. Read the template content
2. Replace placeholders:
   - `$PROJECT_NAME` → actual project name
   - `$BACKEND` → detected backend framework
   - `$FRONTENDS` → comma-separated frontend list
3. Write to `.claude-project/` with `.template` removed from filename

#### Template Mapping

| Template | Destination |
|----------|-------------|
| `docs/PROJECT_API.template.md` | `.claude-project/docs/PROJECT_API.md` |
| `docs/PROJECT_DATABASE.template.md` | `.claude-project/docs/PROJECT_DATABASE.md` |
| `docs/PROJECT_KNOWLEDGE.template.md` | `.claude-project/docs/PROJECT_KNOWLEDGE.md` |
| `docs/PROJECT_API_INTEGRATION.template.md` | `.claude-project/docs/PROJECT_API_INTEGRATION.md` |
| `memory/DECISIONS.template.md` | `.claude-project/memory/DECISIONS.md` |
| `memory/LEARNINGS.template.md` | `.claude-project/memory/LEARNINGS.md` |
| `memory/PREFERENCES.template.md` | `.claude-project/memory/PREFERENCES.md` |
| `status/backend/API_IMPLEMENTATION_STATUS.template.md` | `.claude-project/status/backend/API_IMPLEMENTATION_STATUS.md` |
| `status/frontend/SCREEN_IMPLEMENTATION_STATUS.template.md` | `.claude-project/status/frontend/SCREEN_IMPLEMENTATION_STATUS.md` |
| `status/frontend/API_INTEGRATION_STATUS.template.md` | `.claude-project/status/frontend/API_INTEGRATION_STATUS.md` |
| `status/frontend/E2E_QA_STATUS.template.md` | `.claude-project/status/frontend/E2E_QA_STATUS.md` |
| `hooks/README.template.md` | `.claude-project/hooks/README.md` |
| `agents/README.template.md` | `.claude-project/agents/README.md` |
| `skills/README.template.md` | `.claude-project/skills/README.md` |
| `skills/skill-rules.template.json` | `.claude-project/skills/skill-rules.json` |

If dashboards:
| `status/frontend-dashboard/SCREEN_IMPLEMENTATION_STATUS.template.md` | `.claude-project/status/frontend-dashboard/SCREEN_IMPLEMENTATION_STATUS.md` |
| `status/frontend-dashboard/API_INTEGRATION_STATUS.template.md` | `.claude-project/status/frontend-dashboard/API_INTEGRATION_STATUS.md` |

### 6. Generate CLAUDE.md

Copy `.claude/templates/claude.template.md` to `$TARGET_DIR/CLAUDE.md`.

Replace placeholders with project-specific values:
- `$PROJECT_NAME`
- `$BACKEND`
- `$FRONTENDS`

### 7. Create .gitkeep Files

```bash
touch .claude-project/prd/.gitkeep
touch .claude-project/secrets/.gitkeep
touch .claude-project/status/temp/.gitkeep
```

### 8. Update .gitignore

Append if not already present:

```
# Claude Code project documentation
.claude-project/secrets/*
!.claude-project/secrets/.gitkeep
.claude-project/status/temp/*
!.claude-project/status/temp/.gitkeep
```

### 9. Create Pipeline Status File

Copy `.claude/templates/PIPELINE_STATUS.template.md` to `.claude-project/status/$PROJECT_NAME/PIPELINE_STATUS.md`.

Replace `{PROJECT_NAME}` with actual project name. Set all phases to `Pending`, generation to `1`.

## Quality Gate

Phase 1 is complete when:
- `.claude/` submodule exists and is initialized
- `.claude-project/` directory exists with all template files
- `CLAUDE.md` exists at project root
- `PIPELINE_STATUS.md` exists with all phases set to Pending
- `.gitignore` includes secret/temp exclusions

## Output

Report created structure summary to user.
