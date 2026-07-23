---
name: init-workspace
description: Initialize .claude-project folder with documentation templates
tags: [workspace, setup, initialization, templates]
---

# Init Workspace

Initialize the `.claude-project/` folder structure with all necessary templates for project tracking.

Invoked by `fullstack {project}` Phase 1 (init) or standalone.

---

## Step 0: Check Prerequisites

### Check for existing .claude-project folder

```bash
ls -la .claude-project 2>/dev/null
```

If `.claude-project/` already exists, use **AskUserQuestion** to ask:

**Options:**
1. **Skip** - Keep existing folder, don't overwrite
2. **Merge** - Add missing files only, don't overwrite existing
3. **Overwrite** - Remove existing and create fresh

Store the choice as `$OVERWRITE_MODE`.

### Verify templates exist

```bash
ls .claude/templates/claude-project/
```

If templates don't exist, report error and stop:
```
Error: Template directory not found at .claude/templates/claude-project/
Please ensure the claude-fullstack submodule is properly initialized.
```

## Step 1: Auto-detect Project Information

### Get Project Name

If `$ARGUMENTS` is provided, use it as the project name.

Otherwise, auto-detect from git remote:
```bash
git remote get-url origin 2>/dev/null | sed 's/.*\/\([^\/]*\)\.git$/\1/' | sed 's/.*\/\([^\/]*\)$/\1/'
```

If git remote fails, use folder name:
```bash
basename "$PWD"
```

Store as `$PROJECT_NAME` (lowercase, hyphenated).

### Detect Tech Stack

Check for backend framework:
```bash
# Check for NestJS
grep -q '"@nestjs/core"' backend/package.json 2>/dev/null && echo "nestjs"

# Check for Django
ls backend/manage.py 2>/dev/null && echo "django"
```

Store as `$BACKEND` = "NestJS" | "Django" | "Unknown"

Check for frontend frameworks:
```bash
# Check for React in frontend/
grep -q '"react"' frontend/package.json 2>/dev/null && echo "react"

# Check for React Native
grep -q '"react-native"' mobile/package.json 2>/dev/null && echo "react-native"

# Check for dashboard
ls frontend-dashboard/package.json 2>/dev/null && echo "dashboard"
```

Store as `$FRONTENDS` = array of detected frameworks
Store as `$HAS_DASHBOARD` = true | false

## Step 2: Confirm Project Details

Use **AskUserQuestion** to confirm detected values:

**Project Name:** `$PROJECT_NAME`
- Confirm or provide different name

**Tech Stack:**
- Backend: `$BACKEND`
- Frontend(s): `$FRONTENDS`

Only prompt if auto-detection failed or user wants to change values.

## Step 3: Create Directory Structure

Based on `$OVERWRITE_MODE`:
- **Skip**: Exit with message "Keeping existing .claude-project/ folder"
- **Overwrite**: `rm -rf .claude-project`
- **Merge**: Continue (will skip existing files)

Create the folder structure:

```bash
# Create main directories
mkdir -p .claude-project/docs
mkdir -p .claude-project/memory
mkdir -p .claude-project/status/backend
mkdir -p .claude-project/status/frontend
mkdir -p .claude-project/status/temp
mkdir -p .claude-project/prd
mkdir -p .claude-project/secrets

# Create project-specific Claude config directories
mkdir -p .claude-project/hooks
mkdir -p .claude-project/agents
mkdir -p .claude-project/skills
```

If `$HAS_DASHBOARD` is true:
```bash
mkdir -p .claude-project/status/frontend-dashboard
```

Create .gitkeep files:
```bash
touch .claude-project/status/temp/.gitkeep
touch .claude-project/prd/.gitkeep
touch .claude-project/secrets/.gitkeep
```

## Step 4: Process and Copy Templates

For each template file in `.claude/templates/claude-project/`:

1. Read the template content
2. Replace placeholders:
   - `$PROJECT_NAME` → actual project name
   - `$BACKEND` → detected backend framework
   - `$FRONTENDS` → comma-separated list of frontend frameworks
3. Write to `.claude-project/` with `.template` removed from filename

### Template Mapping

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

If `$HAS_DASHBOARD` is true, also copy:
| `status/frontend-dashboard/SCREEN_IMPLEMENTATION_STATUS.template.md` | `.claude-project/status/frontend-dashboard/SCREEN_IMPLEMENTATION_STATUS.md` |
| `status/frontend-dashboard/API_INTEGRATION_STATUS.template.md` | `.claude-project/status/frontend-dashboard/API_INTEGRATION_STATUS.md` |
| `status/frontend-dashboard/E2E_QA_STATUS.template.md` | `.claude-project/status/frontend-dashboard/E2E_QA_STATUS.md` |

**For merge mode**: Skip files that already exist.

## Step 5: Update .gitignore

Check if `.gitignore` contains `.claude-project` entries:

```bash
grep -q "claude-project/secrets" .gitignore 2>/dev/null
```

If not present, append to `.gitignore`:

```
# Claude Code project documentation
.claude-project/secrets/*
!.claude-project/secrets/.gitkeep
.claude-project/status/temp/*
!.claude-project/status/temp/.gitkeep
```

## Step 6: Check PM2 Installation

```bash
which pm2 && pm2 --version || echo "PM2 not installed"
```

**If PM2 is not installed globally:**
Inform the user and run:
```bash
npm install -g pm2
```

## Step 7: Create ecosystem.config.js

Check if `ecosystem.config.js` already exists at project root:

```bash
ls ecosystem.config.js 2>/dev/null
```

- **Merge mode**: If file exists, skip this step
- **Overwrite mode**: Replace existing file

Create the dynamic service discovery config:

```javascript
const fs = require('fs');
const path = require('path');

// Port configuration
const PORTS = {
  backend: 3000,
  frontend: 5173,
  // Dashboards start at 5174 and increment
  dashboardBasePort: 5174,
};

// Auto-detect services from folder structure
function discoverServices() {
  const apps = [];
  const rootDir = __dirname;

  // Check for backend
  if (fs.existsSync(path.join(rootDir, 'backend', 'package.json'))) {
    apps.push({
      name: 'backend',
      cwd: './backend',
      script: 'npm',
      args: 'run start:dev',
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: PORTS.backend,
      },
    });
  }

  // Check for main frontend (with explicit --port for Vite)
  if (fs.existsSync(path.join(rootDir, 'frontend', 'package.json'))) {
    apps.push({
      name: 'frontend',
      cwd: './frontend',
      script: 'npm',
      args: `run dev -- --port ${PORTS.frontend}`,
      watch: false,
      env: {
        NODE_ENV: 'development',
      },
    });
  }

  // Auto-discover all frontend-*-dashboard folders
  const folders = fs.readdirSync(rootDir);
  let dashboardPort = PORTS.dashboardBasePort;

  folders
    .filter(folder => folder.startsWith('frontend-') && folder.endsWith('-dashboard'))
    .sort() // Alphabetical order for consistent port assignment
    .forEach(folder => {
      const packagePath = path.join(rootDir, folder, 'package.json');
      if (fs.existsSync(packagePath)) {
        // Extract dashboard name (e.g., 'admin' from 'frontend-admin-dashboard')
        const dashboardName = folder.replace('frontend-', '').replace('-dashboard', '');
        apps.push({
          name: dashboardName,
          cwd: `./${folder}`,
          script: 'npm',
          args: `run dev -- --port ${dashboardPort}`,
          watch: false,
          env: {
            NODE_ENV: 'development',
          },
        });
        dashboardPort++;
      }
    });

  return apps;
}

module.exports = {
  apps: discoverServices(),
};
```

## Step 8: Add PM2 Scripts to Root package.json

Check if root `package.json` exists:

```bash
ls package.json 2>/dev/null
```

**If it exists:** Read it and merge the PM2 scripts into the existing scripts (do not overwrite existing scripts).

**If it doesn't exist:** Create a new one using `$PROJECT_NAME`.

Add these scripts:
```json
{
  "scripts": {
    "dev": "pm2 start ecosystem.config.js",
    "dev:logs": "pm2 logs",
    "dev:stop": "pm2 stop all",
    "dev:restart": "pm2 restart all",
    "dev:status": "pm2 status",
    "dev:monit": "pm2 monit",
    "dev:kill": "pm2 kill"
  },
  "devDependencies": {
    "pm2": "^5.3.0"
  }
}
```

## Step 9: Verify PM2 Setup

Run the discovery to show what services were detected:

```bash
node -e "const config = require('./ecosystem.config.js'); console.log('Detected services:'); config.apps.forEach(app => console.log('  -', app.name, 'on port', app.env?.PORT || app.args.match(/--port (\d+)/)?.[1]))"
```

## Step 10: Report Results

```
Workspace initialized for $PROJECT_NAME

Project: $PROJECT_NAME
Tech Stack:
  - Backend: $BACKEND
  - Frontend: $FRONTENDS

Created directories:
  - .claude-project/docs/         (API, Database, Knowledge docs)
  - .claude-project/memory/       (Decisions, Learnings, Preferences)
  - .claude-project/status/       (Implementation status tracking)
  - .claude-project/prd/          (Product requirements)
  - .claude-project/secrets/      (Sensitive config - gitignored)
  - .claude-project/hooks/        (Project-specific Claude hooks)
  - .claude-project/agents/       (Project-specific Claude agents)
  - .claude-project/skills/       (Project-specific Claude skills)

PM2 Setup:
  - ecosystem.config.js           (dynamic service discovery)
  - package.json                  (PM2 scripts added)
  - Detected services:
    - backend → port 3000
    - frontend → port 5173
    - [dashboard names] → port 5174+

Quick Start:
  npm run dev          # Start all servers
  npm run dev:logs     # View all logs
  npm run dev:stop     # Stop all servers
  npm run dev:restart  # Restart all

Individual control:
  pm2 restart backend  # Restart one server
  pm2 logs frontend    # View one server's logs

Next steps:
1. Edit .claude-project/docs/PROJECT_KNOWLEDGE.md with project overview
2. Review and customize .claude-project/memory/PREFERENCES.md
3. Run `npm run dev` to start all services
```

## Error Handling

- If template directory not found: Report error with setup instructions
- If permission denied: Report error with permission fix suggestion
- If git operations fail: Continue with folder name detection
- If user cancels: Exit gracefully with partial work summary

---

## Related

- **Pipeline orchestrator**: `.claude/commands/fullstack.md`
- **Templates**: `.claude/templates/claude-project/`
