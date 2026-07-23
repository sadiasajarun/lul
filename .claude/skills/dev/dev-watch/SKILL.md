---
description: Starts dev servers in watch mode during implementation phases for real-time error feedback. Framework-agnostic — detects npm scripts from package.json, uses PM2 for process management. Non-breaking — phases work without PM2.
---

# Dev-Watch Skill

Real-time error feedback during agentic implementation nodes. Dev servers run in watch/HMR mode so the agent sees compilation and runtime errors **immediately after each file modification**, not at the end of the phase.

**Purpose**: Eliminate the pattern where errors accumulate across many files before being caught by the typecheck/build nodes at phase end.

**Generic**: Detects dev scripts from `package.json`, reads ports from config/env, works with any Node.js framework. Non-Node backends (Django, Rails, Go) supported via `DEV_CMD` override.

**Non-breaking**: All dev-watch nodes use `on_failure: ignore`. If PM2 is not installed or servers fail to start, the phase continues exactly as before.

---

## When to Use

Called by **deterministic blueprint nodes** before implementation agentic work:

- Phase 5 (backend) — before `implement` node
- Phase 6 (frontend) — before `convert` node
- Phase 7 (integrate) — before `integrate` node

NOT needed for:

- Phase 8/9 (testing) — use `ensure-servers` skill instead (full health check + port collision resolution)
- Design/spec phases — no code compilation

---

## Relationship to ensure-servers

| Concern             | ensure-servers                              | dev-watch                                       |
| ------------------- | ------------------------------------------- | ----------------------------------------------- |
| **Purpose**         | Production-ready server startup for testing | Lightweight startup for implementation feedback |
| **Port collisions** | Full resolution with auto-increment         | Delegates to ensure-servers if needed           |
| **PM2 naming**      | `{PREFIX}-backend`, `{PREFIX}-frontend`     | Same — compatible, idempotent                   |
| **Health check**    | 5 retries, 3s intervals                     | 3 retries, 3s intervals (faster)                |
| **When**            | Before test phases (8, 9)                   | Before implementation phases (5, 6, 7)          |

If `ensure-servers` already started servers, `dev-watch` detects them via PM2 and skips startup.

---

## Protocol

### Step 1: Detect Project Structure

```bash
cd {TARGET_DIR}

# Detect backend directory (check multiple indicators, not just src/)
BACKEND_DIR=""
for candidate in backend server api; do
  if [ -d "$candidate" ]; then
    # Accept if it has package.json, src/, manage.py, go.mod, or Gemfile
    if [ -f "$candidate/package.json" ] || [ -d "$candidate/src" ] || \
       [ -f "$candidate/manage.py" ] || [ -f "$candidate/go.mod" ] || \
       [ -f "$candidate/Gemfile" ]; then
      BACKEND_DIR="$candidate"
      break
    fi
  fi
done

# Detect frontend directory
FRONTEND_DIR=""
for candidate in frontend frontend-web web client app; do
  [ -d "$candidate" ] && [ -f "$candidate/package.json" ] && FRONTEND_DIR="$candidate" && break
done
```

### Step 2: Detect Dev Scripts from package.json

```bash
# Backend dev script detection (priority order)
detect_dev_script() {
  local dir=$1
  local role=$2  # "backend" or "frontend"
  [ ! -f "$dir/package.json" ] && echo "" && return

  # Extract script names from package.json
  local scripts=$(node -e "
    const pkg = require('./$dir/package.json');
    const s = pkg.scripts || {};
    console.log(Object.keys(s).join(' '));
  " 2>/dev/null)

  if [ "$role" = "backend" ]; then
    # Priority: start:dev > dev > start > serve
    for script in "start:dev" "dev" "start" "serve"; do
      echo "$scripts" | grep -qw "$script" && echo "$script" && return
    done
  else
    # Priority: dev > start > serve > develop
    for script in "dev" "start" "serve" "develop"; do
      echo "$scripts" | grep -qw "$script" && echo "$script" && return
    done
  fi
  echo ""
}

BACKEND_SCRIPT=$(detect_dev_script "$BACKEND_DIR" "backend")
FRONTEND_SCRIPT=$(detect_dev_script "$FRONTEND_DIR" "frontend")
```

### Step 3: Read PM2 Prefix and Ports

```bash
# Read from ecosystem.config.js (preferred)
PREFIX=""
BACKEND_PORT=""
FRONTEND_PORT=""

if [ -f ecosystem.config.js ]; then
  eval $(node -e "
    const c = require('./ecosystem.config.js');
    const apps = c.apps || [];
    let prefix = '';
    apps.forEach(app => {
      const name = app.name || '';
      const port = app.env?.PORT || '';
      if (!prefix && name.includes('-')) prefix = name.split('-')[0];
      if (name.includes('backend') || name.includes('server') || name.includes('api'))
        console.log('BACKEND_PORT=' + port);
      if (name.includes('frontend') || name.includes('web') || name.includes('client')) {
        const fp = app.env?.PORT || (app.args?.match(/--port\s+(\d+)/)?.[1]) || '';
        console.log('FRONTEND_PORT=' + fp);
      }
    });
    console.log('PREFIX=' + prefix);
  " 2>/dev/null)
fi

# Fallbacks — read from .env or package.json
[ -z "$PREFIX" ] && PREFIX=$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')

if [ -z "$BACKEND_PORT" ] && [ -n "$BACKEND_DIR" ]; then
  BACKEND_PORT=$(grep '^PORT=' "$BACKEND_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d ' "')
  # Try package.json scripts for --port flag
  [ -z "$BACKEND_PORT" ] && BACKEND_PORT=$(node -e "
    const pkg = require('./$BACKEND_DIR/package.json');
    const s = pkg.scripts?.['${BACKEND_SCRIPT}'] || '';
    const m = s.match(/--port\s+(\d+)|-p\s+(\d+)/);
    console.log(m ? (m[1]||m[2]) : '');
  " 2>/dev/null)
fi
[ -z "$BACKEND_PORT" ] && BACKEND_PORT=3000

if [ -z "$FRONTEND_PORT" ] && [ -n "$FRONTEND_DIR" ]; then
  FRONTEND_PORT=$(grep '^PORT=' "$FRONTEND_DIR/.env" 2>/dev/null | cut -d= -f2 | tr -d ' "')
  [ -z "$FRONTEND_PORT" ] && FRONTEND_PORT=$(node -e "
    const pkg = require('./$FRONTEND_DIR/package.json');
    const dev = pkg.scripts?.['${FRONTEND_SCRIPT}'] || '';
    const m = dev.match(/--port\s+(\d+)|-p\s+(\d+)/);
    console.log(m ? (m[1]||m[2]) : '');
  " 2>/dev/null)
fi
[ -z "$FRONTEND_PORT" ] && FRONTEND_PORT=5173
```

### Step 4: Check If Already Running

```bash
check_pm2_status() {
  local name=$1
  pm2 jlist 2>/dev/null | node -e "
    let d='';
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => {
      try {
        const proc = JSON.parse(d).find(p => p.name === '${name}' && p.pm2_env.status === 'online');
        console.log(proc ? 'online' : 'offline');
      } catch(e) { console.log('offline'); }
    });
  " 2>/dev/null || echo "offline"
}

BACKEND_STATUS=$(check_pm2_status "${PREFIX}-backend")
FRONTEND_STATUS=$(check_pm2_status "${PREFIX}-frontend")
```

If the target server is already `online`, skip startup for that server.

### Step 5: Start Servers (if not running)

**Backend** (when `LAYER` includes backend):

```bash
if [ "$BACKEND_STATUS" != "online" ] && [ -n "$BACKEND_DIR" ] && [ -n "$BACKEND_SCRIPT" ]; then
  # Kill anything on our port
  lsof -ti:${BACKEND_PORT} | xargs kill -9 2>/dev/null || true
  sleep 1

  cd "$BACKEND_DIR"
  if command -v pm2 &>/dev/null; then
    PORT=$BACKEND_PORT pm2 start npm --name "${PREFIX}-backend" -- run $BACKEND_SCRIPT 2>&1
  else
    PORT=$BACKEND_PORT nohup npm run $BACKEND_SCRIPT > /tmp/dev-watch-${PREFIX}-backend.log 2>&1 &
    echo $! > /tmp/dev-watch-${PREFIX}-backend.pid
  fi
  cd ..
  sleep 5
fi
```

**Frontend** (when `LAYER` includes frontend):

```bash
if [ "$FRONTEND_STATUS" != "online" ] && [ -n "$FRONTEND_DIR" ] && [ -n "$FRONTEND_SCRIPT" ]; then
  lsof -ti:${FRONTEND_PORT} | xargs kill -9 2>/dev/null || true
  sleep 1

  cd "$FRONTEND_DIR"
  if command -v pm2 &>/dev/null; then
    PORT=$FRONTEND_PORT pm2 start npm --name "${PREFIX}-frontend" -- run $FRONTEND_SCRIPT 2>&1
  else
    PORT=$FRONTEND_PORT nohup npm run $FRONTEND_SCRIPT > /tmp/dev-watch-${PREFIX}-frontend.log 2>&1 &
    echo $! > /tmp/dev-watch-${PREFIX}-frontend.pid
  fi
  cd ..
  sleep 5
fi
```

> **Note**: Port is passed via `PORT` env var (universal). We do NOT pass `--port` flags — the project's npm script should read `PORT` from env or define its own port flag internally. This avoids framework-specific flag syntax (`--port` for Vite, `-p` for Next.js, etc.).

### Step 6: Health Check (3 retries)

```bash
health_check() {
  local port=$1
  local name=$2
  for i in 1 2 3; do
    # Accept any non-connection-refused response (200, 404, 301 all mean server is up)
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${port}" 2>/dev/null)
    if [ "$STATUS" != "000" ]; then
      echo "$name healthy on port $port (HTTP $STATUS)"
      return 0
    fi
    echo "$name not ready (attempt $i/3)..."
    sleep 3
  done
  echo "$name failed health check — continuing anyway (non-blocking)"
  return 1
}

[ -n "$BACKEND_DIR" ] && [ "$LAYER" != "frontend" ] && \
  health_check "${BACKEND_PORT}" "Backend"

[ -n "$FRONTEND_DIR" ] && [ "$LAYER" != "backend" ] && \
  health_check "${FRONTEND_PORT}" "Frontend"
```

### Step 7: Write Sentinel File

```bash
mkdir -p {TARGET_DIR}/.claude-project/status
cat > {TARGET_DIR}/.claude-project/status/DEV_WATCH_ACTIVE.md <<EOF
# Dev-Watch Active
DEV_WATCH=true
PREFIX=${PREFIX}
LAYER=${LAYER}
BACKEND_PM2=${PREFIX}-backend
FRONTEND_PM2=${PREFIX}-frontend
BACKEND_PORT=${BACKEND_PORT}
FRONTEND_PORT=${FRONTEND_PORT}
CHECK_BACKEND=pm2 logs ${PREFIX}-backend --lines 30 --nostream 2>/dev/null
CHECK_FRONTEND=pm2 logs ${PREFIX}-frontend --lines 30 --nostream 2>/dev/null
CHECK_ALL=pm2 logs --lines 30 --nostream 2>/dev/null
CHECK_STATUS=pm2 jlist 2>/dev/null
EOF

echo "Dev-watch active: ${LAYER} server(s) running"
```

---

## Shutdown Protocol

```bash
cd {TARGET_DIR}

# Read sentinel
[ ! -f .claude-project/status/DEV_WATCH_ACTIVE.md ] && exit 0
PREFIX=$(grep '^PREFIX=' .claude-project/status/DEV_WATCH_ACTIVE.md | cut -d= -f2 | tr -d ' ')
LAYER=$(grep '^LAYER=' .claude-project/status/DEV_WATCH_ACTIVE.md | cut -d= -f2 | tr -d ' ')

if command -v pm2 &>/dev/null; then
  # Stop only this project's servers
  [ "$LAYER" != "frontend" ] && pm2 delete ${PREFIX}-backend 2>/dev/null || true
  [ "$LAYER" != "backend" ] && pm2 delete ${PREFIX}-frontend 2>/dev/null || true
else
  # Kill by PID (PREFIX-scoped files)
  [ -f /tmp/dev-watch-${PREFIX}-backend.pid ] && kill $(cat /tmp/dev-watch-${PREFIX}-backend.pid) 2>/dev/null && rm /tmp/dev-watch-${PREFIX}-backend.pid
  [ -f /tmp/dev-watch-${PREFIX}-frontend.pid ] && kill $(cat /tmp/dev-watch-${PREFIX}-frontend.pid) 2>/dev/null && rm /tmp/dev-watch-${PREFIX}-frontend.pid
fi

# Remove sentinel
rm -f .claude-project/status/DEV_WATCH_ACTIVE.md
echo "Dev-watch stopped"
```

---

## Universal Error Patterns

These patterns indicate compilation or runtime errors across any framework:

| Pattern                                                     | Meaning                      |
| ----------------------------------------------------------- | ---------------------------- |
| `ERROR` / `Error:` / `error:`                               | Generic error                |
| `error TS`                                                  | TypeScript compilation error |
| `TypeError` / `ReferenceError` / `SyntaxError`              | JavaScript runtime error     |
| `Cannot find module` / `Module not found`                   | Missing import/dependency    |
| `Failed to compile` / `Build failed` / `compilation failed` | Build-level failure          |
| `EADDRINUSE`                                                | Port conflict                |
| `ECONNREFUSED`                                              | Service unreachable          |
| `status: "errored"` / `status: "stopped"`                   | PM2 process crashed          |
| `Cannot read properties of`                                 | Null reference error         |
| `is not a function` / `is not defined`                      | Missing export or typo       |

---

## LAYER Parameter

The `LAYER` parameter controls which servers to start:

| LAYER Value | Servers Started    | Used By             |
| ----------- | ------------------ | ------------------- |
| `backend`   | Backend only       | Phase 5 (backend)   |
| `frontend`  | Frontend only      | Phase 6 (frontend)  |
| `both`      | Backend + Frontend | Phase 7 (integrate) |

---

## Error Handling

| Scenario                             | Action                                                     |
| ------------------------------------ | ---------------------------------------------------------- |
| PM2 not installed                    | Fall back to `nohup npm run ... &` with PID files          |
| No package.json in directory         | Skip that server (no script to run)                        |
| No matching dev script found         | Skip that server, log warning                              |
| Server fails to start                | Log warning, continue phase (non-blocking)                 |
| Port occupied                        | Kill process on port, retry start                          |
| Health check fails                   | Log warning, continue (server may start later)             |
| Server crashes during implementation | Agent detects via log check, runs `pm2 restart`            |
| Sentinel file missing on stop        | No-op, exit cleanly                                        |
| Multiple projects running            | PREFIX-scoped PID files prevent cross-project interference |
