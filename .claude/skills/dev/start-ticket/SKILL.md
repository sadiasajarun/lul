---
name: start-ticket
description: "TRIGGER when user pastes a pm.potentialai.com ticket URL. Full ticket lifecycle: create branch + worktree workspace, then finish by creating PR, monitoring CI, merging, and deploying."
argument-hint: "[--all | --manual] [<ticket-url>]"
---

# Start Ticket

## Overview

Full ticket lifecycle skill. When the user pastes a ticket URL from `pm.potentialai.com`, this skill:

1. Fetches ticket details from the production API
2. Creates a properly named branch + isolated git worktree
3. Plans and implements the fix/feature
4. Creates a PR, waits for review bot review, watches deploy

---

## Modes

This skill supports three modes controlled by flags:

### Default (no flag) — Single Ticket
```
/start-ticket https://pm.potentialai.com/projects/{projectId}/tickets/{ticketId}
```
Runs the full lifecycle for a single ticket: Phase A (workspace setup) → Phase B (implementation) → Phase C (PR + review + merge + deploy). Asks for merge confirmation before merging.

### `--all` — Batch Mode
```
/start-ticket --all https://pm.potentialai.com/projects/{projectId}/tickets
```
Requires a **project URL** (ending in `/tickets`). Fetches all open tickets for that project, then runs the full lifecycle for each one sequentially. Auto-merges each ticket if all 3 conditions pass: Review ✅ PASS + no conflicts + CI ✅ all passed. If any condition fails, notifies the user and waits before continuing to the next ticket.

**How `--all` fetches tickets:**
```bash
PHC_API_URL="${PHC_API_URL:-https://pm.potentialai.com/api}"
# Extract projectId from the URL argument
PROJECT_ID="<extracted from url>"
# Authenticate first (same as Phase A Step 2)
# Then fetch open tickets for this project:
curl -s -b /tmp/phc-cookies.txt \
  "${PHC_API_URL}/projects/${PROJECT_ID}/tickets?status=OPEN&limit=50" \
  | node -e "
    const data = JSON.parse(require('fs').readFileSync(0,'utf8'));
    const tickets = data.data || data.tickets || data;
    tickets.forEach(t => console.log(t.id + '\t' + t.projectId + '\t' + t.ticketNumber + '\t' + t.title));
  "
```
For each ticket returned, construct the full ticket URL (`/projects/{projectId}/tickets/{ticketId}`) and run the full Phase A → B → C flow.

### `--manual` — Manual Handoff Mode
```
/start-ticket --manual https://pm.potentialai.com/projects/{projectId}/tickets/{ticketId}
```
Runs Phase A (full workspace setup: branch, worktree, deps, dev servers), then produces a detailed `IMPLEMENTATION_PLAN.md` and **stops**. No code is written, no PR is created — the developer implements it themselves. See the **Manual Mode** section below for full details.

---

**Announce at start:** "I'm using the start-ticket skill to set up a workspace for this ticket."

---

## Ticket Dashboard Sync

Every phase that changes ticket state MUST sync it back to the PHC dashboard. Each sync point below includes a **complete, self-contained bash script** — do NOT extract a shared function, because each Bash tool call runs in a separate shell.

### Status Lifecycle

| Trigger | New Status | Phase |
|---------|-----------|-------|
| Branch created | `IN_PROGRESS` | Phase A Step 5 |
| PR created | `IN_REVIEW` | Phase C Step 1 |
| PR merged | `RESOLVED` | Phase C Step 3c |

### PATCH Field Reference (`PATCH /api/tickets/{id}`)

| Field | Type | Example | When |
|-------|------|---------|------|
| `status` | string | `"IN_PROGRESS"`, `"IN_REVIEW"`, `"RESOLVED"` | Status transitions |
| `size` | int (1-9) | `3` | After planning |
| `linkedPrs` | array of objects | `[{"url":"...","title":"...","number":3,"state":"open"}]` | After PR creation |

### Sync Script Template

Every sync point uses this pattern. Replace `<PAYLOAD>` and `<DESCRIPTION>` with the specific values. `TICKET_UUID` comes from Phase A Step 3.

```bash
PHC_API_URL="${PHC_API_URL:-https://pm.potentialai.com/api}" && \
PHC_EMAIL="${PHC_EMAIL:-lukas@potentialai.com}" && \
TICKET_UUID="<ticket-uuid>" && \
if [ -z "$PHC_PASSWORD" ]; then
  echo "WARN: PHC_PASSWORD not set — skipping ticket sync"
else
  curl -s -c /tmp/phc-cookies.txt \
    -X POST "${PHC_API_URL}/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${PHC_EMAIL}\",\"password\":\"${PHC_PASSWORD}\"}" > /dev/null 2>&1 && \
  SYNC_RESP=$(curl -s -w "\n%{http_code}" -b /tmp/phc-cookies.txt \
    -X PATCH "${PHC_API_URL}/tickets/${TICKET_UUID}" \
    -H "Content-Type: application/json" \
    -d '<PAYLOAD>') && \
  SYNC_CODE=$(echo "$SYNC_RESP" | tail -n1) && \
  if [ "$SYNC_CODE" -ge 200 ] && [ "$SYNC_CODE" -lt 300 ]; then
    echo "✓ Ticket synced: <DESCRIPTION>"
  else
    echo "WARN: Ticket sync failed (HTTP ${SYNC_CODE}) — continuing"
  fi
fi
```

### Error Policy

Dashboard sync is **never a gate**. If PATCH fails (auth error, network, unexpected 4xx/5xx), log a warning and continue. The ticket lifecycle must not block on dashboard metadata.

---

## Phase A: Setup Workspace

### Step 1: Parse Ticket URL

Extract IDs from the URL pattern: `https://pm.potentialai.com/projects/{projectId}/tickets/{ticketId}`

```
PROJECT_ID=<extracted>
TICKET_ID=<extracted>
```

If the URL doesn't match this pattern, ask the user for a valid ticket URL. STOP.

### Step 2: Authenticate with PHC API

```bash
PHC_API_URL="${PHC_API_URL:-https://pm.potentialai.com/api}" && \
PHC_EMAIL="${PHC_EMAIL:-lukas@potentialai.com}" && \
if [ -z "$PHC_PASSWORD" ]; then
  echo "ERROR: PHC_PASSWORD environment variable is not set."
  echo "Set it in .claude/settings.local.json under env, or export it in your shell."
  exit 1
fi && \
LOGIN_RESPONSE=$(curl -s -c /tmp/phc-cookies.txt \
  -X POST "${PHC_API_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${PHC_EMAIL}\",\"password\":\"${PHC_PASSWORD}\"}") && \
if echo "$LOGIN_RESPONSE" | grep -q "Unauthorized\|Invalid"; then
  echo "ERROR: Login failed. Check PHC_EMAIL and PHC_PASSWORD."
  rm -f /tmp/phc-cookies.txt
  exit 1
fi && \
echo "Authenticated as ${PHC_EMAIL}"
```

### Step 3: Fetch Ticket and Project Data

```bash
PHC_API_URL="${PHC_API_URL:-https://pm.potentialai.com/api}" && \
TICKET_ID="<ticket-id>" && \
PROJECT_ID="<project-id>" && \
TICKET_JSON=$(curl -s -b /tmp/phc-cookies.txt "${PHC_API_URL}/tickets/${TICKET_ID}") && \
PROJECT_JSON=$(curl -s -b /tmp/phc-cookies.txt "${PHC_API_URL}/projects/${PROJECT_ID}") && \
node -e "
const t = ${TICKET_JSON};
const p = ${PROJECT_JSON};
console.log(JSON.stringify({
  ticketNumber: t.ticketNumber,
  title: t.title,
  category: t.category || 'GENERAL',
  priority: t.priority || 'MEDIUM',
  status: t.status || 'OPEN',
  assignee: t.assignee?.name || 'Unassigned',
  dueDate: t.dueDate || 'No due date',
  ticketPrefix: p.ticketPrefix || '',
  projectName: p.name || '',
  description: t.description || ''
}, null, 2));
"
```

### Step 4: Determine Branch Name

Rules:

- **Prefix**: `fix` if category is `BUG`, otherwise `feature`
- **Ticket ID**: `{ticketPrefix}-{ticketNumber zero-padded to 3}`
- **Slug**: title → lowercase → non-alphanumeric to hyphens → collapse multiple hyphens → trim → max 50 chars
- **Branch**: `{prefix}/{ticketId}-{slug}`
- **Worktree**: `.worktrees/{prefix}/{ticketId}`

### Step 5: Create Worktree

```bash
BRANCH_PREFIX="<feature|fix>" && \
TICKET_TITLE="<title>" && \
SLUG=$(echo "$TICKET_TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//' | cut -c1-50) && \
PADDED_NUM=$(printf "%03d" "<ticketNumber>") && \
TICKET_PREFIX="<prefix>" && \
if [ -n "$TICKET_PREFIX" ]; then
  BRANCH_NAME="${BRANCH_PREFIX}/${TICKET_PREFIX}-${PADDED_NUM}-${SLUG}"
  TICKET_ID_SHORT="${TICKET_PREFIX}-${PADDED_NUM}"
else
  BRANCH_NAME="${BRANCH_PREFIX}/${PADDED_NUM}-${SLUG}"
  TICKET_ID_SHORT="${PADDED_NUM}"
fi && \
echo "Branch: $BRANCH_NAME" && \
WORKTREE_PATH="$(pwd)/.worktrees/${BRANCH_PREFIX}/${TICKET_ID_SHORT}" && \
echo "Worktree: $WORKTREE_PATH" && \

# Check if worktree already exists
for PREFIX_DIR in feature fix; do
  EXISTING_PATH="$(pwd)/.worktrees/${PREFIX_DIR}/${TICKET_ID_SHORT}"
  if [ -d "$EXISTING_PATH" ]; then
    echo "ERROR: Ticket ${TICKET_ID_SHORT} already has an active worktree at ${EXISTING_PATH}"
    exit 1
  fi
done && \

# Ensure .worktrees is gitignored
git check-ignore -q .worktrees 2>/dev/null || {
  echo ".worktrees/" >> .gitignore
  echo "Added .worktrees/ to .gitignore"
} && \

# Fetch latest dev
git fetch origin dev 2>/dev/null && \

# Create worktree
mkdir -p "$(dirname "$WORKTREE_PATH")" && \
git worktree add "$WORKTREE_PATH" -b "${BRANCH_NAME}" origin/dev && \
echo "Worktree created at ${WORKTREE_PATH}" && \

# Push branch
cd "$WORKTREE_PATH" && \
git push -u origin "${BRANCH_NAME}" && \
echo "Branch pushed to origin"
```

#### Sync: Branch created → `IN_PROGRESS`

Authenticate with PHC and PATCH the ticket status. Use the Sync Script Template from the "Ticket Dashboard Sync" section with:
- `<PAYLOAD>`: `{"status": "IN_PROGRESS"}`
- `<DESCRIPTION>`: `status → IN_PROGRESS`

### Step 5.5: Allocate Ports and Configure Worktree Environment

Each worktree gets unique dev server ports so multiple tickets can run simultaneously.

**Detection priority:**
1. `.claude/base/project-manifest.json` (if present — explicit always wins)
2. Auto-detect from project files (see table below)

**Auto-detection rules:**

| Marker | Backend type | Port | Install | Start |
|--------|-------------|------|---------|-------|
| `backend/manage.py` | Django | 8000 | `pip install -r requirements.txt` | `python3 manage.py runserver 0.0.0.0:{PORT} 2>/dev/null \|\| python manage.py runserver 0.0.0.0:{PORT}` |
| `backend/nest-cli.json` or `@nestjs/core` in deps | NestJS | 3000 | `npm install` | `npm run start:dev` |
| `backend/package.json` (no nest) | Node.js | 3000 | `npm install` | `npm run dev` |
| `backend/go.mod` | Go | 8080 | `go mod download` | `go run main.go` |
| `backend/requirements.txt` (no Django) | Python | 8000 | `pip install -r requirements.txt` | `python3 -m uvicorn main:app --reload --port {PORT} 2>/dev/null \|\| python -m uvicorn main:app --reload --port {PORT}` |
| `manage.py` (root) | Django | 8000 | `pip install -r requirements.txt` | `python3 manage.py runserver 0.0.0.0:{PORT} 2>/dev/null \|\| python manage.py runserver 0.0.0.0:{PORT}` |

| Marker | Frontend type | Port | Install | Start |
|--------|--------------|------|---------|-------|
| `vite` in deps | Vite | 5173 | `npm install` | `npm run dev -- --port {PORT}` |
| `react` in deps (no vite) | React | 3000 | `npm install` | `npm run dev -- --port {PORT}` |
| `next` in deps | Next.js | 3000 | `npm install` | `npm run dev -- --port {PORT}` |

**Auto-detected patches (applied only when no manifest is present):**
- NestJS backend + Vite frontend: patch `frontend/vite.config.ts` proxy + `backend/src/main.ts` CORS

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)

# 1. Load or auto-detect the project manifest, then allocate ports for every service
#    Outputs: SLOT, PREFIX, PROJECT_TYPE, and {name}Port for each service
#    Also writes env files, applies temporary patches, and records the slot in port-registry.json
eval $(node -e "
  const fs = require('fs'), path = require('path');

  // --- Auto-detect manifest from project structure (primary path) ---
  // An optional .claude/base/project-manifest.json can override auto-detected values
  // (e.g., deployWorkflow, reviewBot, or custom service config).
  function loadManifest(root) {
    const svcs = [];
    const detect = (dir, name) => {
      const d = path.join(root, dir);
      if (!fs.existsSync(d)) return null;
      const join = (...parts) => path.join(d, ...parts);
      const fex = (p) => fs.existsSync(path.join(root, p));

      // Django: manage.py or requirements.txt with Django
      if (fex(dir + '/manage.py')) return { name, dir, type: 'django', port: 8000, install: 'python3 -m pip install -r requirements.txt 2>/dev/null || pip install -r requirements.txt', start: 'python3 manage.py runserver 0.0.0.0:{PORT} 2>/dev/null || python manage.py runserver 0.0.0.0:{PORT}', health: '/api/health/', envFile: '.env', envPortKey: 'PORT', envFallback: true };
      if (fs.existsSync(join('requirements.txt'))) {
        const txt = fs.readFileSync(join('requirements.txt'), 'utf8');
        if (/django/i.test(txt)) return { name, dir, type: 'django', port: 8000, install: 'python3 -m pip install -r requirements.txt 2>/dev/null || pip install -r requirements.txt', start: 'python3 manage.py runserver 0.0.0.0:{PORT} 2>/dev/null || python manage.py runserver 0.0.0.0:{PORT}', health: '/api/health/', envFile: '.env', envPortKey: 'PORT', envFallback: true };
        return { name, dir, type: 'python', port: 8000, install: 'python3 -m pip install -r requirements.txt 2>/dev/null || pip install -r requirements.txt', start: 'python3 -m uvicorn main:app --reload --port {PORT} 2>/dev/null || python -m uvicorn main:app --reload --port {PORT}', health: '/', envFile: '.env', envPortKey: 'PORT' };
      }

      // Node.js
      if (fs.existsSync(join('package.json'))) {
        const pkg = JSON.parse(fs.readFileSync(join('package.json'), 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

        // NestJS
        if (deps['@nestjs/core'] || fs.existsSync(join('nest-cli.json')))
          return { name, dir, type: 'nestjs', port: 3000, install: 'npm install', start: 'npm run start:dev', health: '/api', envFile: '.env', envPortKey: 'PORT' };

        // Frontend frameworks
        if (name === 'frontend') {
          if (deps['vite']) return { name, dir, type: 'vite', port: 5173, install: 'npm install', start: 'npm run dev -- --port {PORT}', health: '/', envFile: '.env.local', envTemplate: '{backendPort}' };
          if (deps['next']) return { name, dir, type: 'next', port: 3000, install: 'npm install', start: 'npm run dev -- --port {PORT}', health: '/', envFile: '.env.local', envTemplate: '{backendPort}' };
          if (deps['react']) return { name, dir, type: 'react', port: 3000, install: 'npm install', start: 'npm run dev -- --port {PORT}', health: '/', envFile: '.env.local', envTemplate: '{backendPort}' };
        }

        // Generic Node.js backend
        return { name, dir, type: 'node', port: 3000, install: 'npm install', start: 'npm run dev', health: '/', envFile: '.env', envPortKey: 'PORT' };
      }

      // Go
      if (fs.existsSync(join('go.mod')))
        return { name, dir, type: 'go', port: 8080, install: 'go mod download', start: 'go run main.go', health: '/health', envFile: '.env', envPortKey: 'PORT' };

      // Python (pyproject.toml / Pipfile)
      if (fs.existsSync(join('pyproject.toml')) || fs.existsSync(join('Pipfile')))
        return { name, dir, type: 'python', port: 8000, install: 'python3 -m pip install -r requirements.txt 2>/dev/null || pip install -r requirements.txt', start: 'python3 -m uvicorn main:app --reload --port {PORT} 2>/dev/null || python -m uvicorn main:app --reload --port {PORT}', health: '/', envFile: '.env', envPortKey: 'PORT' };

      return null;
    };

    // Check backend/ and frontend/ directories
    if (fs.existsSync(path.join(root, 'backend'))) {
      const be = detect('backend', 'backend');
      if (be) svcs.push(be);
    }
    if (fs.existsSync(path.join(root, 'frontend'))) {
      const fe = detect('frontend', 'frontend');
      if (fe) svcs.push(fe);
    }

    // If no service directories found, try root-level detection
    if (svcs.length === 0) {
      // Root-level Django
      if (fs.existsSync(path.join(root, 'manage.py'))) {
        svcs.push({ name: 'backend', dir: '.', type: 'django', port: 8000, install: 'python3 -m pip install -r requirements.txt 2>/dev/null || pip install -r requirements.txt', start: 'python3 manage.py runserver 0.0.0.0:{PORT} 2>/dev/null || python manage.py runserver 0.0.0.0:{PORT}', health: '/api/health/', envFile: '.env', envPortKey: 'PORT', envFallback: true });
      }
      // Root-level Node
      else if (fs.existsSync(path.join(root, 'package.json'))) {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (deps['@nestjs/core'] || fs.existsSync(path.join(root, 'nest-cli.json')))
          svcs.push({ name: 'backend', dir: '.', type: 'nestjs', port: 3000, install: 'npm install', start: 'npm run start:dev', health: '/api', envFile: '.env', envPortKey: 'PORT' });
        else
          svcs.push({ name: 'backend', dir: '.', type: 'node', port: 3000, install: 'npm install', start: 'npm run dev', health: '/', envFile: '.env', envPortKey: 'PORT' });
      }
      // Root-level Go
      else if (fs.existsSync(path.join(root, 'go.mod'))) {
        svcs.push({ name: 'backend', dir: '.', type: 'go', port: 8080, install: 'go mod download', start: 'go run main.go', health: '/health', envFile: '.env', envPortKey: 'PORT' });
      }
    }

    // Wrap every install command with a type-specific fallback so
    // the raw strings stay simple and all resilience lives in one place.
    // Also assign buildCheck defaults per type.
    svcs.forEach(s => {
      // Build check defaults
      if (!s.buildCheck) {
        if (s.type === 'django') s.buildCheck = 'python3 manage.py check 2>/dev/null || python manage.py check';
        else if (s.type === 'nestjs') s.buildCheck = 'npm run build';
        else if (['vite', 'react', 'next', 'node'].includes(s.type)) s.buildCheck = 'npx tsc --noEmit';
        else if (s.type === 'go') s.buildCheck = 'go build ./...';
      }
      const raw = s.install;
      if (s.type === 'django' || s.type === 'python') {
        s.install = '([ -f venv/bin/activate ] && . venv/bin/activate; ' + raw + ') || (' + raw + ' --break-system-packages)';
      } else if (['nestjs', 'vite', 'react', 'next', 'node'].includes(s.type)) {
        s.install = raw + ' || ' + raw + ' --legacy-peer-deps';
      }
      // go: no fallback needed — `go mod download` has no PEP-668 equivalent
    });

    // Build manifest from detected services
    let manifest = {
      version: 1,
      portSlotMultiplier: 100,
      docsUrl: svcs.find(s => s.type === 'nestjs') ? 'http://localhost:{backendPort}/api/docs' : null,
      deployWorkflow: null,
      reviewBot: '@codex',
      pm2Prefix: null,
      services: svcs.map(s => ({
        name: s.name,
        dir: s.dir,
        install: s.install,
        start: s.start,
        buildCheck: s.buildCheck || null,
        defaultPort: s.port,
        envFile: s.envFile,
        envPortKey: s.envPortKey || undefined,
        type: s.type,
        envFallback: s.envFallback || false,
        envTemplate: s.envTemplate
          ? (s.envTemplate === '{backendPort}'
              ? 'VITE_API_BASE_URL=http://localhost:{backendPort}/api'
              : s.envTemplate)
          : undefined,
        healthCheck: s.health
      })),
      patches: []
    };

    // Auto-detect patches: NestJS backend + Vite frontend
    const hasNestjs = svcs.some(s => s.type === 'nestjs' && s.name === 'backend');
    const hasVite = svcs.some(s => s.type === 'vite' && s.name === 'frontend');
    if (hasNestjs && hasVite) {
      manifest.patches.push(
        { file: 'frontend/vite.config.ts', sed: 's|localhost:[0-9]*\\\\'|localhost:{backendPort}\\\\'|' },
        { file: 'backend/src/main.ts', sed: 's|\\\\'http://localhost:[0-9]*\\\\'|&, \\\\'http://localhost:{frontendPort}\\\\'|' }
      );
    }

    // Load explicit manifest overrides (optional — for customizing deployWorkflow,
    // reviewBot, buildCheck, or adding services not detected automatically)
    const explicitPath = path.join(root, '.claude', 'base', 'project-manifest.json');
    if (fs.existsSync(explicitPath)) {
      try {
        const explicit = JSON.parse(fs.readFileSync(explicitPath, 'utf8'));
        manifest.deployWorkflow = explicit.deployWorkflow || manifest.deployWorkflow;
        manifest.reviewBot = explicit.reviewBot || manifest.reviewBot;
        manifest.docsUrl = explicit.docsUrl !== undefined ? explicit.docsUrl : manifest.docsUrl;
        manifest.pm2Prefix = explicit.pm2Prefix || manifest.pm2Prefix;
        // If explicit manifest provides services, use them as an override
        // (only if they exist in the project's directory structure)
        if (explicit.services && explicit.services.length > 0) {
          const validServices = explicit.services.filter(s => fs.existsSync(path.join(root, s.dir)));
          if (validServices.length > 0) {
            manifest.services = validServices;
          }
        }
        if (explicit.patches && explicit.patches.length > 0) {
          manifest.patches = explicit.patches;
        }
        process.stderr.write('  Loaded explicit manifest overrides (deployWorkflow, reviewBot, etc.)\\n');
      } catch(e) { /* ignore malformed manifest */ }
    }

    return { manifest, detected: true };
  }

  const { manifest, detected } = loadManifest('${PROJECT_ROOT}');
  const services = manifest.services || [];
  const patches = manifest.patches || [];
  const portSlotMultiplier = manifest.portSlotMultiplier || 100;

  if (services.length === 0) {
    console.error('ERROR: No services detected. Create .claude/base/project-manifest.json to configure manually.');
    process.exit(1);
  }

  if (detected) {
    process.stderr.write('  Auto-detected: ' + services.map(s => s.name).join(' + ') + ' (create .claude/base/project-manifest.json to customize)\\n');
  }

  // Determine PM2 prefix: use manifest.pm2Prefix, then ecosystem.config.js, then project dir name
  let prefix = manifest.pm2Prefix;
  if (!prefix) {
    try {
      const cfg = require(path.join('${PROJECT_ROOT}', 'ecosystem.config.js'));
      const name = (cfg.apps || [])[0]?.name || '';
      prefix = name.split('-')[0] || path.basename('${PROJECT_ROOT}');
    } catch(e) { prefix = path.basename('${PROJECT_ROOT}'); }
  }

  // Allocate a port slot (1-8) via .worktrees/port-registry.json
  const regDir = path.join('${PROJECT_ROOT}', '.worktrees');
  if (!fs.existsSync(regDir)) fs.mkdirSync(regDir, { recursive: true });
  const regPath = path.join(regDir, 'port-registry.json');
  let reg = {};
  try { reg = JSON.parse(fs.readFileSync(regPath, 'utf8')); } catch(e) {}
  const used = new Set(Object.values(reg).map(v => v.slot));
  let slot = 0;
  for (let i = 1; i <= 8; i++) { if (!used.has(i)) { slot = i; break; } }
  if (!slot) { console.error('ERROR: max 8 worktrees exceeded'); process.exit(1); }

  // Compute ports: defaultPort + (slot * portSlotMultiplier)
  const portMap = {};
  services.forEach(s => {
    const svcPort = s.defaultPort + (slot * portSlotMultiplier);
    portMap[s.name + 'Port'] = svcPort;
    portMap[s.name + '_port'] = svcPort;
  });

  // Record slot in registry
  reg['${TICKET_ID_SHORT}'] = { slot, ...portMap };
  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));

  // Configure environment for each service
  const worktreeRoot = '${WORKTREE_PATH}';
  services.forEach(s => {
    const svcDir = path.join(worktreeRoot, s.dir);
    const svcPort = portMap[s.name + 'Port'];

    // Copy env file from main project and override port key
    if (s.envFile && s.envPortKey) {
      const srcEnv = path.join('${PROJECT_ROOT}', s.dir, s.envFile);
      const dstEnv = path.join(svcDir, s.envFile);
      if (fs.existsSync(srcEnv)) {
        fs.copyFileSync(srcEnv, dstEnv);
        let content = fs.readFileSync(dstEnv, 'utf8');
        const portRegex = new RegExp('^' + s.envPortKey + '=.*', 'm');
        if (portRegex.test(content)) {
          content = content.replace(portRegex, s.envPortKey + '=' + svcPort);
        } else {
          content += '\\n' + s.envPortKey + '=' + svcPort;
        }
        fs.writeFileSync(dstEnv, content);
      } else if (s.envFallback) {
        // No source .env — scan Django settings to find all required env() calls
        // without defaults, then generate sensible dev-friendly dummy values.
        const settingsDir = (() => {
          // Try common Django settings directory layouts
          for (const candidate of [
            path.join(svcDir, 'core', 'settings'),
            path.join(svcDir, 'config', 'settings'),
            path.join(svcDir, 'app', 'settings'),
            path.join(svcDir, s.name, 'settings'),
            path.join(svcDir, 'settings'),
          ]) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
          }
          // Fallback: find first directory containing settings files
          const walk = (dir, depth) => {
            if (depth > 3) return null;
            try {
              for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.isDirectory()) {
                  const p = path.join(dir, entry.name);
                  const files = fs.readdirSync(p);
                  if (files.some(f => f.endsWith('_settings.py') || f === 'base.py' || f === 'settings.py'))
                    return p;
                  const sub = walk(p, depth + 1);
                  if (sub) return sub;
                }
              }
            } catch(e) {}
            return null;
          };
          return walk(svcDir, 1) || svcDir;
        })();

        const requiredVars = new Set();
        const scanFile = (fp) => {
          try {
            const content = fs.readFileSync(fp, 'utf8');
            const re = /env(?:\.\w+)?\(\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\)/g;
            let m;
            while ((m = re.exec(content)) !== null) requiredVars.add(m[1]);
          } catch(e) {}
        };

        // Scan settings directory and any __init__.py that imports them
        if (fs.existsSync(settingsDir)) {
          for (const f of fs.readdirSync(settingsDir)) {
            if (f.endsWith('.py')) scanFile(path.join(settingsDir, f));
          }
        }
        // Also scan the base dir for settings.py / base.py
        for (const f of ['settings.py', 'base.py', 'config.py']) {
          const fp = path.join(svcDir, f);
          if (fs.existsSync(fp)) scanFile(fp);
        }

        if (requiredVars.size > 0) {
          const lines = ['# Auto-generated dev .env — worktree fallback (no source .env found)'];
          for (const v of [...requiredVars].sort()) {
            const low = v.toLowerCase();
            let val = 'dev';
            if (v === 'SECRET_KEY') val = 'dev-secret-key-worktree-not-for-production';
            else if (v === 'PROJECT_NAME') val = 'dev-' + s.name;
            else if (v === 'DEBUG') val = 'True';
            else if (v === 'ALLOWED_HOSTS') val = 'localhost,127.0.0.1';
            else if (v.startsWith('CSRF_') || v.startsWith('CORS_')) val = 'http://localhost:' + svcPort;
            else if (v.startsWith('DB_')) val = '';
            else if (low.includes('ssl') || low.includes('tls') || low.includes('secure_ssl')) val = 'False';
            else if (low.includes('verification')) val = 'False';
            else if (low.endsWith('_port')) val = '6379';
            else if (low.endsWith('_host')) val = 'localhost';
            else if (low.endsWith('_url') || low.endsWith('_uri')) val = 'http://localhost:' + svcPort;
            else if (low.includes('key') || low.includes('secret') || low.includes('password') || low.includes('token') || low.includes('credential')) val = 'dev';
            else if (low.startsWith('aws_') || low.startsWith('s3_')) val = 'dev';
            else if (low.startsWith('social_auth_') || low.startsWith('google_') || low.startsWith('apple_') || low.includes('client_id')) val = 'dev';
            lines.push(v + '=' + val);
          }
          lines.push('PORT=' + svcPort);

          // Scan ALL env var references (including ones with defaults) and
          // force-disable SSL/TLS/HTTPS-related settings for local dev.
          // runserver doesn't speak HTTPS, so any redirect upgrade would break.
          const allVarRe = /env(?:\.\w+)?\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g;
          for (const f of fs.readdirSync(settingsDir)) {
            if (!f.endsWith('.py')) continue;
            let content;
            try { content = fs.readFileSync(path.join(settingsDir, f), 'utf8'); } catch(e) { continue; }
            let m;
            while ((m = allVarRe.exec(content)) !== null) {
              const v = m[1];
              const low = v.toLowerCase();
              if ((low.includes('ssl') || low.includes('tls') || low.includes('secure_ssl') || low.includes('https')) && !lines.some(l => l.startsWith(v + '='))) {
                lines.push(v + '=False');
              }
            }
          }

          fs.writeFileSync(dstEnv, lines.join('\\n') + '\\n');
          process.stderr.write('  Generated fallback .env for ' + s.name + ' (' + requiredVars.size + ' vars from settings scan)\\n');
        }
      }
    } else if (s.envFile) {
      // Copy env file without port override
      const srcEnv = path.join('${PROJECT_ROOT}', s.dir, s.envFile);
      const dstEnv = path.join(svcDir, s.envFile);
      if (fs.existsSync(srcEnv)) fs.copyFileSync(srcEnv, dstEnv);
    }

    // Create env file from template
    if (s.envTemplate) {
      const dstEnv = path.join(svcDir, s.envFile || '.env.local');
      let template = s.envTemplate;
      // Replace {namePort} placeholders in the template
      services.forEach(other => {
        template = template.replace(new RegExp('\\\\{' + other.name + 'Port\\\\}', 'g'), portMap[other.name + 'Port']);
      });
      fs.writeFileSync(dstEnv, template + '\\n');
    }
  });

  // --- Generic dev-safety overrides ---
  // Local dev servers never speak HTTPS. Many frameworks default SSL redirects
  // to ON (production-safe), which breaks local dev with ERR_SSL_PROTOCOL_ERROR.
  // Also, the server must accept requests from the local network (192.168.x.x).
  //
  // Table: { type, pattern, replacement } — add rows here for new frameworks.
  // `pattern` is a regex tested against the .env file. If matched, `replacement`
  // is appended. Matches are keyed on the framework `type` from auto-detection.
  const DEV_OVERRIDES = {
    django: [
      { pattern: /^SECURE_SSL_REDIRECT\s*=.*/m,  append: 'SECURE_SSL_REDIRECT=False' },
      { pattern: /^ALLOWED_HOSTS\s*=.*/m,         append: 'ALLOWED_HOSTS=*' },
    ],
    nestjs: [
      // NestJS HTTPS redirect is controlled by middleware or env; commonly:
      { pattern: /^HTTPS_REDIRECT\s*=.*/m,  append: 'HTTPS_REDIRECT=false' },
    ],
    node: [
      // Express/Node often use:
      { pattern: /^FORCE_HTTPS\s*=.*/m,  append: 'FORCE_HTTPS=false' },
    ],
    python: [
      { pattern: /^UVICORN_SSL\s*=.*/m,  append: 'UVICORN_SSL=false' },
    ],
    go: [
      { pattern: /^TLS_ENABLED\s*=.*/m,  append: 'TLS_ENABLED=false' },
    ],
  };

  services.forEach(s => {
    const overrides = DEV_OVERRIDES[s.type];
    if (!overrides || overrides.length === 0) return;

    const envPath = path.join(worktreeRoot, s.dir, s.envFile || '.env');
    if (!fs.existsSync(envPath)) {
      // No .env at all — create one with just the overrides
      fs.writeFileSync(envPath, overrides.map(o => o.append).join('\n') + '\n');
      return;
    }

    let content = fs.readFileSync(envPath, 'utf8');
    overrides.forEach(({ pattern, append }) => {
      if (pattern.test(content)) {
        // Var exists — replace its value
        content = content.replace(pattern, append);
      } else {
        // Var missing — append
        content += '\n' + append + '\n';
      }
    });
    fs.writeFileSync(envPath, content);
  });

  // Apply temporary patches (worktree-only, reverted before commit)
  patches.forEach(p => {
    const filePath = path.join(worktreeRoot, p.file);
    if (!fs.existsSync(filePath)) return;
    let sedExpr = p.sed;
    // Replace {namePort} placeholders in the sed expression
    services.forEach(s => {
      sedExpr = sedExpr.replace(new RegExp('\\\\{' + s.name + 'Port\\\\}', 'g'), portMap[s.name + 'Port']);
    });
    // Execute sed via shell
    const { execFileSync } = require('child_process');
    try {
      execFileSync('sed', ['-i', '', sedExpr, filePath], { stdio: 'ignore' });
    } catch(e) { /* non-fatal */ }
  });

  // Output shell variables
  console.log('SLOT=' + slot);
  console.log('PREFIX=' + prefix);
  Object.entries(portMap).forEach(([k, v]) => console.log(k + '=' + v));
  // Also output all port variables concatenated for reporting
  const portList = services.map(s => s.name + '=' + portMap[s.name + 'Port']).join(', ');
  console.log('PORT_SUMMARY=\\\"' + portList + '\\\"');

  // Write resolved state (manifest + ports) to temp file for cross-shell access
  const tmpDir = process.env.TMPDIR || '/tmp';
  const state = { manifest, ports: portMap, slot, prefix };
  fs.writeFileSync(path.join(tmpDir, 'start-ticket-' + '${TICKET_ID_SHORT}' + '.json'), JSON.stringify(state, null, 2));
")

echo "Ports allocated: ${PORT_SUMMARY}"
```

> **Important:** Temporary patches (from `manifest.patches`) are worktree-only. They MUST be reverted before committing in Phase B Step 5 — see the `patches[].file` list in the manifest.

> **To customize auto-detection:** create `.claude/base/project-manifest.json` with `deployWorkflow`, `reviewBot`, or custom service overrides. The auto-detected services take priority — only matching `services[*].dir` entries from the manifest are used.

### Step 6: Install Dependencies

Iterate over each service defined in the project manifest (read from temp file written by Step 5.5) and run its `install` command. Failures are non-blocking — dependencies may already be installed from a previous worktree or system packages.

```bash
MANIFEST_FILE="${TMPDIR:-/tmp}/start-ticket-${TICKET_ID_SHORT}.json"
node -e "
  const fs = require('fs'), path = require('path');
  const state = JSON.parse(fs.readFileSync('${MANIFEST_FILE}', 'utf8'));
  const m = state.manifest;
  (m.services || []).forEach(s => {
    const dir = path.join('${WORKTREE_PATH}', s.dir);
    console.log(path.resolve(dir));
    console.log(s.install);
  });
" | while read -r SVC_DIR && read -r INSTALL_CMD; do
  echo "--- Installing in ${SVC_DIR} ---"
  if (cd "$SVC_DIR" && eval "$INSTALL_CMD" 2>&1); then
    echo "  ✓ Install succeeded: ${SVC_DIR}"
  else
    echo "  ⚠ Install had errors but continuing — dependencies may be pre-installed: ${SVC_DIR}"
  fi
done
```

### Step 6.5: Start Dev Servers

Start each service defined in the manifest via PM2 with a unique process name per worktree.

```bash
MANIFEST_FILE="${TMPDIR:-/tmp}/start-ticket-${TICKET_ID_SHORT}.json"
cd "$WORKTREE_PATH"

# Launch each service via PM2, substituting {PORT} with the allocated port.
# Uses the quoted-command form: pm2 start "executable args" --name X
node -e "
  const fs = require('fs'), path = require('path');
  const state = JSON.parse(fs.readFileSync('${MANIFEST_FILE}', 'utf8'));
  const m = state.manifest;
  const ports = state.ports;
  (m.services || []).forEach(s => {
    var port = ports[s.name + 'Port'];
    var startCmd = s.start.replace(/\\{PORT\\}/g, port);
    var pm2Name = '${PREFIX}-${TICKET_ID_SHORT}-' + s.name;
    var svcDir = path.resolve(path.join('${WORKTREE_PATH}', s.dir));
    console.log([
      'cd', svcDir, '&&',
      'pm2', 'start', '\"' + startCmd + '\"',
      '--name', pm2Name
    ].join(' '));
  });
" | while read -r PM2_CMD; do
  echo "PM2: $PM2_CMD"
  eval "$PM2_CMD"
done

# Health check for each service (max 5 attempts, 3s interval)
check_service() {
  local name="$1" port="$2" path="$3"
  for i in $(seq 1 5); do
    local code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${port}${path}" 2>/dev/null)
    if [ "$code" != "000" ]; then
      echo "  ✓ ${name} (${port}${path}) → ${code}"
      return 0
    fi
    sleep 3
  done
  echo "  ✗ ${name} (${port}${path}) failed health check"
  return 1
}

FAILED_SERVICES=""
node -e "
  const fs = require('fs'), path = require('path');
  const state = JSON.parse(fs.readFileSync('${MANIFEST_FILE}', 'utf8'));
  const m = state.manifest;
  const ports = state.ports;
  (m.services || []).forEach(s => {
    var port = ports[s.name + 'Port'];
    var hc = s.healthCheck || '/';
    console.log(s.name + ' ' + port + ' ' + hc);
  });
" | while read -r SVC_NAME SVC_PORT SVC_HC; do
  if ! check_service "$SVC_NAME" "$SVC_PORT" "$SVC_HC"; then
    FAILED_SERVICES="${FAILED_SERVICES} ${SVC_NAME}"
  fi
done

if [ -n "$FAILED_SERVICES" ]; then
  echo "WARN: Some services failed health checks:${FAILED_SERVICES}"
fi
```

If health check fails, show logs via `pm2 logs ${PREFIX}-${TICKET_ID_SHORT}-<serviceName> --lines 20`.

### Step 7: Report

First, run the bash snippet below to compute the LAN IP and generate the dev server URLs. Then print the summary, replacing placeholders and pasting the snippet's console output into the `Dev Servers` section.

```
══════════════════════════════════════════════════════════════
 ✅ Ticket Ready: {TICKET_ID_SHORT}
══════════════════════════════════════════════════════════════

 📋 Ticket
 ──────────────────────────────────────────────────────────
  Title:      {title}
  Category:   {category}
  Priority:   {priority}
  Assignee:   {assignee}
  Due:        {dueDate}
  Dashboard:  https://pm.potentialai.com/projects/{projectId}/tickets/{ticketId}

 🔧 Workspace
 ──────────────────────────────────────────────────────────
  Branch:     {branchName}
  Worktree:   {worktreePath}

 🌐 Dev Servers
 ──────────────────────────────────────────────────────────
  <paste the console output from the bash snippet run just above>
  Status:     ✅ Running (or ❌ Failed — check pm2 logs)

 📝 Ticket Description
 ──────────────────────────────────────────────────────────
  {ticket description summary, 2-3 lines}

══════════════════════════════════════════════════════════════
 → Entering plan mode to investigate and design the implementation.
══════════════════════════════════════════════════════════════
```

**Run this bash snippet to generate the dev server URLs (MUST run before printing the report):**

```bash
MANIFEST_FILE="${TMPDIR:-/tmp}/start-ticket-${TICKET_ID_SHORT}.json"

# Detect local network IP (primary interface, IPv4). Prefer en0 (Wi-Fi) on macOS,
# eth0 on Linux. Falls back to 127.0.0.1 if no external IP is available.
LOCAL_IP=$(ifconfig 2>/dev/null | awk '/^en0:/{found=1} found && /inet /{print $2; exit}' 2>/dev/null)
[ -z "$LOCAL_IP" ] && LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$LOCAL_IP" ] && LOCAL_IP="127.0.0.1"
export LOCAL_IP
export MANIFEST_FILE

node -e "
  const fs = require('fs'), path = require('path');
  const localIp = process.env.LOCAL_IP || '127.0.0.1';
  const manifestFile = process.env.MANIFEST_FILE || '/tmp/start-ticket-unknown.json';
  const state = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const m = state.manifest;
  const ports = state.ports;
  (m.services || []).forEach(s => {
    var port = ports[s.name + 'Port'];
    var hc = s.healthCheck || '/';
    var name = s.name.charAt(0).toUpperCase() + s.name.slice(1);
    console.log('  ' + name + ':    http://localhost:' + port + hc);
    console.log('            http://' + localIp + ':' + port + hc);
  });
  if (m.docsUrl) {
    var docsUrl = m.docsUrl;
    (m.services || []).forEach(s => {
      docsUrl = docsUrl.replace(new RegExp('\\\\{' + s.name + 'Port\\\\}', 'g'), ports[s.name + 'Port']);
    });
    console.log('  Docs:      ' + docsUrl);
  }
"
```

**Phase A is complete.**

- If `--manual` flag was passed → go to **Manual Mode** section below.
- Otherwise → automatically enter plan mode:
  1. Call `EnterPlanMode`
  2. Explore the worktree codebase to understand the affected area
  3. Design the implementation plan based on the ticket description
  4. Present the plan via `ExitPlanMode` for user approval
  5. After approval, proceed to Phase B implementation

---

## Manual Mode (`--manual`)

When `--manual` is passed, Phase A runs exactly the same (workspace setup, branch, worktree, deps, dev servers). After Phase A completes, Claude produces an implementation plan but does **not** write any code. The developer implements the changes themselves.

### What happens

1. **Full Phase A** (Steps 1–7) executes normally — ticket fetch, branch, worktree, deps, servers
2. **Explore** — Read relevant files in the worktree to understand the affected area
3. **Plan** — Produce a detailed implementation plan covering:
   - Which files to modify and what to change in each
   - Suggested order of changes
   - Key code references (file paths, line numbers, function/class names)
   - Edge cases and gotchas to watch for
   - Any new files that need to be created
4. **Write plan** — Save the plan to `{WORKTREE_PATH}/IMPLEMENTATION_PLAN.md`
5. **Handoff** — Print the summary below and **stop**. No Phase B, no Phase C.

### Handoff summary

**Before printing the summary**, compute the dev server URLs with their LAN IP addresses by running the same snippet as Step 7 (the `export LOCAL_IP` + `node -e` block above). Use its console output to fill the `{...}` placeholders below.

```
══════════════════════════════════════════════════════════════
 📋 Manual Mode: Implementation Plan Ready
══════════════════════════════════════════════════════════════

 Ticket:     {TICKET_ID_SHORT} — {title}
 Branch:     {branchName}
 Worktree:   {worktreePath}
 Plan:       {worktreePath}/IMPLEMENTATION_PLAN.md
 Size:       <N>/9 (~<N>h human work)

 Dev Servers:
   <paste output from the Step 7 bash snippet here>

 Next steps (you):
  1. cd {worktreePath}
  2. Read IMPLEMENTATION_PLAN.md
  3. Implement the changes
  4. git add && git commit -m "{fix|feat}: {ticketPrefix}-{NNN} {description}"
  5. gh pr create --base dev

══════════════════════════════════════════════════════════════
```

### IMPLEMENTATION_PLAN.md format

The plan file should follow this structure:

```markdown
# {TICKET_ID_SHORT}: {title}

## Summary

Brief description of what this ticket requires and why.

## Affected Files

| File                  | Action | Description         |
| --------------------- | ------ | ------------------- |
| `path/to/file.ts`     | Modify | What to change      |
| `path/to/new-file.ts` | Create | What this file does |

## Implementation Steps

1. **Step name** — detailed description of what to do
   - File: `path/to/file.ts`
   - Key references: function/class names, line numbers
   - Code hint: brief description or pseudo-code

2. **Step name** — ...

## Edge Cases & Gotchas

- Things to watch out for
- Existing patterns to follow
- Related code that might be affected

## Testing

- How to verify the changes work
- Relevant existing tests to run
```

**Manual mode sync:** If Claude creates the PR on behalf of the developer in manual mode, authenticate with PHC and PATCH the ticket using the Sync Script Template with:
- `<PAYLOAD>`: `{"status": "IN_REVIEW", "linkedPrs": [{"url": "<PR_URL>", "title": "<PR_TITLE>", "number": <PR_NUMBER>, "state": "open"}]}`
- `<DESCRIPTION>`: `status → IN_REVIEW, PR #<PR_NUMBER> linked`

If the developer creates the PR themselves, remind them to update the ticket status on the dashboard.

**After printing the handoff summary, STOP. Do not proceed to Phase B or Phase C.**

---

## Phase B: Implementation

1. **Explore** — Read relevant files in the worktree to understand the codebase area affected by the ticket
2. **Plan** — Design the implementation approach, identify files to modify
3. **Estimate size and update ticket** — After the plan is drafted and before writing code, pick a size 1-9 (human-hours equivalent) based on the plan, then PATCH it back to the dashboard. See the **Size Estimation** section below.
4. **Implement** — Make the changes in the worktree
5. **Build check** — Run the project's type-check / build command (from manifest, or auto-detect: `npx tsc --noEmit` for TypeScript projects, `python manage.py check` for Django, etc.) in each service directory to verify compilation
6. **Revert temporary patches + Commit**:

```bash
MANIFEST_FILE="${TMPDIR:-/tmp}/start-ticket-${TICKET_ID_SHORT}.json"
cd "$WORKTREE_PATH"

# Revert temporary patches from Step 5.5 (these must NOT be committed)
# Read the patch file list from the resolved manifest (auto-detected or explicit)
node -e "
  const fs = require('fs'), path = require('path');
  const state = JSON.parse(fs.readFileSync('${MANIFEST_FILE}', 'utf8'));
  const m = state.manifest;
  (m.patches || []).forEach(p => console.log(p.file));
" | while read -r PATCH_FILE; do
  git checkout -- "$PATCH_FILE" 2>/dev/null || true
  echo "  Reverted patch: $PATCH_FILE"
done

# Stage and commit actual changes only
git add <changed-files>
git commit -m "{fix|feat}: {ticketPrefix}-{NNN} {description}"
```

> **Critical:** Always revert ALL files listed in `manifest.patches[*].file` before committing. These were temporarily modified in Step 5.5 for worktree port isolation and must not be included in the PR.

---

## Size Estimation (run once after Phase B Step 2, before Step 4)

**Why:** Writes an objective effort estimate back to the ticket so the dashboard has size data without needing a human PM to fill it in (Zero-Human-Report principle).

**Scale — human-hours equivalent (NOT Claude wall-clock):**

The 1-9 number is how many hours a **human developer** would take to complete this ticket. Claude Code typically finishes in ~10-20% of that time, but the score must stay comparable to historical PM estimates so velocity data remains consistent.

> Note: the production UI placeholder shows a Fibonacci hint ("1, 2, 3, 5, 8, 13"). This skill uses a 1-9 linear human-hours scale per project convention. Both are valid `int >= 0` values the backend accepts; update this rubric if the project policy changes.

**Rubric:**

| Size | Human effort | Typical scope                                                              |
| ---- | ------------ | -------------------------------------------------------------------------- |
| 1    | <1h          | Trivial one-liner: typo, copy fix, single config value                     |
| 2    | ~2h          | Small isolated change in 1 file: rename, guard, simple validation          |
| 3    | ~3h          | Small multi-file change, no new logic: prop threading, minor refactor      |
| 4    | ~4h          | Standard bug fix with targeted debugging + test                            |
| 5    | ~5h          | Small feature: 1 new endpoint OR 1 new component end-to-end                |
| 6    | ~6h          | Medium feature: 1 endpoint + 1 component + 1 hook + types                  |
| 7    | ~7h          | Cross-cutting change touching 5+ files across backend + frontend           |
| 8    | ~8h          | Large feature: new module (entity + migration + service + controller + UI) |
| 9    | 9h+          | Architectural change, multi-day human work                                 |

**How to pick the number** — weigh from the drafted plan:

- Number of files you expect to edit
- Backend + frontend, or just one side
- Migrations / new entities needed
- Tests to write or update
- Debugging uncertainty (known root cause vs. needs investigation)

Pick one integer 1-9. If between two, round up. Do **not** re-estimate mid-implementation; if scope turns out drastically different, mention it to the user in a message — do not silently re-PATCH.

**Sync size to dashboard:**

Validate the size (1-9), then authenticate with PHC and PATCH the ticket. Use the Sync Script Template with:
- `<PAYLOAD>`: `{"size": <SIZE>}` (replace `<SIZE>` with the chosen integer)
- `<DESCRIPTION>`: `size → <SIZE>/9`

Before running, validate:

```bash
SIZE=<SIZE>
if [ "$SIZE" -lt 1 ] || [ "$SIZE" -gt 9 ]; then
  echo "ERROR: Size must be 1-9, got $SIZE"; exit 1
fi
```

**Report to user** alongside the plan summary:

```
Size estimate: <N>/9 (~<N>h human work)
Reasoning: <one-line justification — files touched, scope, uncertainty>
```

**Errors:**

| Error                   | Action                                                                |
| ----------------------- | --------------------------------------------------------------------- |
| `PHC_PASSWORD` missing  | Log warning, skip size write, continue — size is metadata, not a gate |
| PATCH returns non-2xx   | Log HTTP status + body, skip, continue                                |
| Chosen size outside 1-9 | Hard error — pick a valid integer                                     |

**Manual mode:** Run Size Estimation after writing `IMPLEMENTATION_PLAN.md` and before the handoff summary. Include the chosen size in the handoff output.

---

## Phase C: PR, Review, Merge, and Deploy

### Step 1: Create PR

Use `gh pr create --base dev` with ticket context in the body. Save the PR number and URL.

#### Sync: PR created → `IN_REVIEW` + link PR

Authenticate with PHC and PATCH the ticket. Use the Sync Script Template with:
- `<PAYLOAD>`: `{"status": "IN_REVIEW", "linkedPrs": [{"url": "<PR_URL>", "title": "<PR_TITLE>", "number": <PR_NUMBER>, "state": "open"}]}`
- `<DESCRIPTION>`: `status → IN_REVIEW, PR #<PR_NUMBER> linked`

Get the PR title first: `PR_TITLE=$(gh pr view "$PR_NUMBER" --json title -q '.title')`

### Step 2: Monitor CI and Review Bot (never skip)

#### 2a: Wait for CI checks

```bash
gh pr checks "$PR_NUMBER" --watch
```

#### 2b: Read review bot comments (never skip — even in batch mode)

```bash
# Read all PR comments to find review bot feedback
gh pr view "$PR_NUMBER" --comments
```

Classify the review result:

- ✅ **PASS** — no issues found → proceed to Step 3
- ⚠️ **NEEDS CHANGES** — non-critical issues → go to 2c
- 🚨 **CRITICAL** — blocking issues → go to 2c

#### 2c: Fix and re-review loop (repeat until PASS)

1. Analyze each issue the review bot raised
2. Fix the code in the worktree
3. Revert temporary patches before committing (same as Phase B Step 6 — read `patches[].file` from manifest, run `git checkout -- <file>` for each)
4. Commit and push
5. Re-trigger review: read `manifest.reviewBot` from the state file (default `@codex`) and comment that bot handle on the PR. Example: `gh pr comment "$PR_NUMBER" --body "@${REVIEW_BOT}"`
6. Go back to 2a (wait for CI + re-read review bot)

Repeat until the review bot returns ✅ PASS with no warnings. Do not proceed to Step 3 until the review is clean.

### Step 3: Merge Approval (never skip, never bypass)

> **This step is mandatory.** Even in batch mode, all evidence must be collected and evaluated before merging.

#### 3a: Collect merge evidence (all items required)

```bash
# 1. Review bot result (from Step 2b above)

# 2. Conflict status (retry up to 3 times if UNKNOWN, 5s interval)
for i in 1 2 3; do
  MERGEABLE=$(gh pr view "$PR_NUMBER" --json mergeable -q '.mergeable')
  [ "$MERGEABLE" != "UNKNOWN" ] && break
  sleep 5
done

# 3. CI check results
gh pr checks "$PR_NUMBER"
```

#### 3b: Present evidence to user (never omit)

```
══════════════════════════════════════════════════
 Merge Approval: PR #${PR_NUMBER}
══════════════════════════════════════════════════

 Review Bot:   ✅ PASS (or ⚠️/🚨 + summary)
 Conflict:      ✅ No conflicts (or ❌ Conflicts detected)
 CI Checks:     ✅ All passed (or ❌ N failed)

 PR:            ${PR_URL}

══════════════════════════════════════════════════
 Proceed with merge? (yes/no)
```

#### 3c: Merge only on approval

- User says "yes" → merge
- Conflicts detected → guide user to resolve, then re-collect evidence
- Review bot CRITICAL remaining → warn, but user can override

```bash
gh pr merge "$PR_NUMBER" --squash --delete-branch
```

#### Sync: PR merged → `RESOLVED`

Authenticate with PHC and PATCH the ticket. Use the Sync Script Template with:
- `<PAYLOAD>`: `{"status": "RESOLVED"}`
- `<DESCRIPTION>`: `status → RESOLVED`

If merge fails due to conflicts, resolve in worktree, push, and re-run Step 2 + Step 3.

**Batch mode:** Auto-merge ONLY if all 3 conditions pass (Review PASS + no conflict + CI all pass). If any condition fails, notify user and wait.

### Step 4: Watch Deploy (until successful)

After merge, monitor the deploy workflow on `dev` **until it finishes with a `success` conclusion**. The workflow name comes from `manifest.deployWorkflow` (read from the state temp file), falling back to `"Deploy Dev"` if not configured. Back-to-back merges (especially in batch mode) cause GitHub to cancel in-flight deploys when a newer commit arrives — a `cancelled` run is NOT a failure, it's a signal that a newer run is underway. The loop below skips `cancelled` runs and keeps watching the latest dev-branch deploy run until it succeeds or a non-superseded failure occurs.

```bash
MANIFEST_FILE="${TMPDIR:-/tmp}/start-ticket-${TICKET_ID_SHORT}.json"
DEPLOY_WF=$(node -e "
  try {
    const state = JSON.parse(require('fs').readFileSync('${MANIFEST_FILE}', 'utf8'));
    console.log(state.manifest.deployWorkflow || 'Deploy Dev');
  } catch(e) { console.log('Deploy Dev'); }
")
echo "Watching deploy workflow: ${DEPLOY_WF}"

# Wait for a completed deploy run that isn't cancelled (superseded).
# Poll every 15s for up to ~10 minutes.
for attempt in $(seq 1 40); do
  READ=$(gh run list --workflow="${DEPLOY_WF}" --branch dev --limit 1 \
    --json databaseId,status,conclusion -q '.[0]')
  RUN_ID=$(echo "$READ" | node -e "const d=require('fs').readFileSync(0,'utf8');console.log(JSON.parse(d).databaseId||'')")
  STATUS=$(echo "$READ" | node -e "const d=require('fs').readFileSync(0,'utf8');console.log(JSON.parse(d).status||'')")
  CONCLUSION=$(echo "$READ" | node -e "const d=require('fs').readFileSync(0,'utf8');console.log(JSON.parse(d).conclusion||'')")

  if [ "$STATUS" = "completed" ]; then
    if [ "$CONCLUSION" = "success" ]; then
      echo "✓ Deploy succeeded (run $RUN_ID)"; break
    elif [ "$CONCLUSION" = "cancelled" ]; then
      echo "  run $RUN_ID cancelled (superseded) — waiting for newer run..."
      sleep 10
      continue
    else
      echo "✗ Deploy $CONCLUSION (run $RUN_ID) — see: gh run view $RUN_ID --web"
      exit 1
    fi
  fi

  # Still queued/in_progress — attach to it
  if [ -n "$RUN_ID" ]; then
    gh run watch "$RUN_ID" --exit-status 2>&1 | tail -5 || true
  else
    sleep 5
  fi
done
```

**Batch mode:** Run this watcher after each merge (simplest) OR once after the final merge of the batch (fastest). Either way, a `cancelled` conclusion between rapid merges must be treated as transient, not a failure. Report success only after a `success` conclusion on the most recent run.

### Step 5: Cleanup and Report

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PROJECT_ROOT")

# 1. Stop worktree PM2 processes (read service names from manifest)
node -e "
  const state = JSON.parse(require('fs').readFileSync('${MANIFEST_FILE}', 'utf8'));
  (state.manifest.services || []).forEach(s => {
    console.log('${PREFIX}-${TICKET_ID_SHORT}-' + s.name);
  });
" | while read -r PM2_PROC; do
  pm2 delete "$PM2_PROC" 2>/dev/null || true
done

# 2. Release port allocation
node -e "
  const fs = require('fs'), path = require('path');
  const regPath = path.join('${PROJECT_ROOT}', '.worktrees', 'port-registry.json');
  try {
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    delete reg['${TICKET_ID_SHORT}'];
    fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
  } catch(e) {}
"

# 3. Clean up PHC session cookies and temp manifest
MANIFEST_FILE="${TMPDIR:-/tmp}/start-ticket-${TICKET_ID_SHORT}.json"
rm -f /tmp/phc-cookies.txt
rm -f "$MANIFEST_FILE"

# 4. Remove worktree and local branch
cd "$PROJECT_ROOT"
git worktree remove "$WORKTREE_PATH" 2>/dev/null || true
git branch -d "${BRANCH_NAME}" 2>/dev/null || true

# 5. Pull latest changes to main project
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" = "dev" ]; then
  git pull origin dev
  echo "dev branch updated to latest"
else
  git fetch origin dev
  echo "Main is not on dev ($CURRENT_BRANCH). Fetched only."
fi
```

Show the change summary (`git diff --stat` from before merge) and final report:

```
══════════════════════════════════════════════════════════════
 ✅ Ticket Complete: {TICKET_ID_SHORT}
══════════════════════════════════════════════════════════════

 📋 Summary
 ──────────────────────────────────────────────────────────
  Title:      {title}
  PR:         {PR_URL}

 📊 Review Results
 ──────────────────────────────────────────────────────────
  Review:     ✅ PASS
  Conflict:   ✅ None
  CI:         ✅ All passed

 🚀 Deploy
 ──────────────────────────────────────────────────────────
  Status:     ✅ Success (or ❌ Failed — {run link})

 📝 Changes (git diff --stat)
 ──────────────────────────────────────────────────────────
  N files changed (+XX, -YY)
  {file list}

 🔄 Post-merge
 ──────────────────────────────────────────────────────────
  Pull:       ✅ dev up to date
  Cleanup:    ✅ Worktree / branch / PM2 cleaned up

══════════════════════════════════════════════════════════════
```

---

## Team Setup

Each developer must configure their own credentials before using this skill.

### 1. Create local settings file

Create `.claude/settings.local.json` in the project root (this file is gitignored and never committed):

```json
{
  "env": {
    "PHC_EMAIL": "your-name@potentialai.com",
    "PHC_PASSWORD": "your-password"
  }
}
```

### 2. Verify access

```bash
curl -s -X POST https://pm.potentialai.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-name@potentialai.com","password":"your-password"}'
```

A successful response returns user data with a 200 status.

### 3. Optional: Custom API URL

If targeting a non-production environment, also set:

```json
{
  "env": {
    "PHC_API_URL": "http://localhost:3000/api",
    "PHC_EMAIL": "your-name@potentialai.com",
    "PHC_PASSWORD": "your-password"
  }
}
```

---

## Error Handling

- **Login fails**: Check `PHC_EMAIL` and `PHC_PASSWORD` env vars. They should be in `.claude/settings.local.json` under `env`.
- **Ticket not found**: Verify the URL is correct and the ticket exists.
- **Worktree already exists**: Report the existing path. User can `cd` to it or remove it first.
- **Build fails**: Fix the issues before committing.
- **Conflicts**: Pull latest dev, resolve, commit, push, re-check.
- **Review bot rejects**: Address the feedback, push, and wait for re-review.
- **Deploy fails**: Report the failure with a link to the run.

## Environment Variables

| Variable       | Default                          | Source                        |
| -------------- | -------------------------------- | ----------------------------- |
| `PHC_API_URL`  | `https://pm.potentialai.com/api` | `.claude/settings.local.json` |
| `PHC_EMAIL`    | `lukas@potentialai.com`          | `.claude/settings.local.json` |
| `PHC_PASSWORD` | (required)                       | `.claude/settings.local.json` |
