---
description: Ensures dev servers (backend + frontend) are running on the correct ports with health verification. Kills only this project's stale processes (via PM2 PREFIX), auto-resolves port collisions, and starts fresh. Supports multiple projects running simultaneously.
---

# Ensure Servers Skill

Deterministic server startup protocol. Reads ports and PM2 prefix from project config, auto-resolves port collisions with other projects, kills only this project's stale processes, starts servers via PM2, and health-checks before returning.

**Purpose**: Eliminate the class of bugs where QA/tests fail because servers aren't running, are on wrong ports, or another project occupies the port.

**Multi-project safe**: Uses PM2 PREFIX from `ecosystem.config.js` to only manage this project's processes. If preferred ports are occupied by another project, auto-resolves to free ports.

---

## When to Use

Call this skill BEFORE any phase that needs running servers:
- Phase 8 (test-api) — smoke tests, backend API tests
- Phase 9 (test-browser) — all sub-phases
- `fullstack --phase test-browser` — smoke, acceptance
- Smoke test skill — needs both servers
- Any manual testing

---

## Protocol

### Step 1: Read Port Configuration + PM2 Prefix

Read `ecosystem.config.js` in the project root to get the canonical ports and prefix:

```bash
node -e "
const config = require('./ecosystem.config.js');
const apps = config.apps || [];
apps.forEach(app => {
  const port = app.env?.PORT || (app.args?.match(/--port\s+(\d+)/)?.[1]);
  console.log(app.name + ':' + (port || 'default'));
});
"
```

Expected output (tirebank uses prefix `tb`):
```
tb-backend:3003
tb-frontend:5175
```

Extract:
- `PREFIX`: the common prefix before `-backend` / `-frontend` (e.g., `tb`)
- `BACKEND_PORT`: port for the backend service
- `FRONTEND_PORT`: port for the frontend service

If `ecosystem.config.js` doesn't exist, fall back to:
- Backend: read `backend/.env` for `PORT=` line, default to `3000`
- Frontend: default to `5173`
- PREFIX: use project folder name

### Step 2: Verify Frontend .env Matches Backend Port

```bash
# Read frontend API base URL
cat frontend/.env.local 2>/dev/null || cat frontend/.env 2>/dev/null
```

Check that `VITE_API_BASE_URL` uses the same port as `BACKEND_PORT`.

**If mismatched**: Fix `frontend/.env.local` to use the correct backend port:
```
VITE_API_BASE_URL=http://localhost:{BACKEND_PORT}/api
```

This is the #1 cause of "everything compiles but nothing works" failures.

### Step 3: Check for Port Collisions

Before killing anything, check if a **different project** already owns the port.

Define helper function:
```bash
find_free_port() {
  local port=$1
  while lsof -ti:$port >/dev/null 2>&1; do
    port=$((port + 1))
  done
  echo $port
}
```

Check each port:
```bash
BACKEND_PID=$(lsof -ti:${BACKEND_PORT} 2>/dev/null)
FRONTEND_PID=$(lsof -ti:${FRONTEND_PORT} 2>/dev/null)

# If port is occupied, check if it's OUR process or another project's
if [ -n "$BACKEND_PID" ]; then
  # Look up PM2 process name for this PID
  PM2_NAME=$(pm2 jlist 2>/dev/null | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{JSON.parse(d).forEach(p=>{
        if(p.pid==${BACKEND_PID})console.log(p.name)
      })}catch(e){}
    })" 2>/dev/null)
  if [ -n "$PM2_NAME" ] && ! echo "$PM2_NAME" | grep -q "^${PREFIX}-"; then
    echo "WARNING: Port ${BACKEND_PORT} is used by another project ($PM2_NAME)"
    BACKEND_PORT=$(find_free_port $((BACKEND_PORT + 1)))
    echo "Resolved to port ${BACKEND_PORT}"
  fi
fi

if [ -n "$FRONTEND_PID" ]; then
  PM2_NAME=$(pm2 jlist 2>/dev/null | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{JSON.parse(d).forEach(p=>{
        if(p.pid==${FRONTEND_PID})console.log(p.name)
      })}catch(e){}
    })" 2>/dev/null)
  if [ -n "$PM2_NAME" ] && ! echo "$PM2_NAME" | grep -q "^${PREFIX}-"; then
    echo "WARNING: Port ${FRONTEND_PORT} is used by another project ($PM2_NAME)"
    FRONTEND_PORT=$(find_free_port $((FRONTEND_PORT + 1)))
    echo "Resolved to port ${FRONTEND_PORT}"
  fi
fi
```

### Step 4: Kill Only This Project's Stale Processes

**IMPORTANT**: Do NOT use `pm2 delete all` — that kills other projects' servers too.

```bash
# Stop only this project's PM2 processes (by prefix)
pm2 delete ${PREFIX}-backend 2>/dev/null || true
pm2 delete ${PREFIX}-frontend 2>/dev/null || true
# Delete any other prefixed processes (dashboards, etc.)
pm2 list 2>/dev/null | grep "${PREFIX}-" | awk '{print $4}' | xargs -I{} pm2 delete {} 2>/dev/null || true

# Kill anything on our FINAL resolved ports (only if not owned by another project)
lsof -ti:${BACKEND_PORT} | xargs kill -9 2>/dev/null || true
lsof -ti:${FRONTEND_PORT} | xargs kill -9 2>/dev/null || true

# Wait for ports to free up
sleep 1

# Verify ports are free
lsof -ti:${BACKEND_PORT} && echo "ERROR: Port ${BACKEND_PORT} still occupied" && exit 1
lsof -ti:${FRONTEND_PORT} && echo "ERROR: Port ${FRONTEND_PORT} still occupied" && exit 1
```

### Step 5: Update Config If Ports Changed

If Step 3 resolved to different ports than the defaults in `ecosystem.config.js`:

1. Update `frontend/.env.local` — set `VITE_API_BASE_URL=http://localhost:${BACKEND_PORT}/api`
2. Update `backend/.env` — set `PORT=${BACKEND_PORT}`
3. Log the resolved ports clearly so downstream skills use the right values

### Step 6: Start Servers

If ports match `ecosystem.config.js` defaults:
```bash
pm2 start ecosystem.config.js
```

If ports were changed by collision detection, start with explicit overrides:
```bash
# Backend with port override
cd backend && PORT=${BACKEND_PORT} pm2 start npm --name "${PREFIX}-backend" -- run start:dev

# Frontend with port override
cd frontend && pm2 start npm --name "${PREFIX}-frontend" -- run dev -- --port ${FRONTEND_PORT}
```

```bash
# Wait for startup
sleep 5

# Check PM2 status (shows all projects' processes)
pm2 list
```

If PM2 is not available, start manually:
```bash
cd backend && PORT=${BACKEND_PORT} npm run start:dev &
cd frontend && npm run dev -- --port ${FRONTEND_PORT} &
sleep 8
```

### Step 7: Health Check

```bash
# Backend health check (try up to 5 times with 3s intervals)
for i in {1..5}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${BACKEND_PORT}/api 2>/dev/null)
  if [ "$STATUS" = "200" ] || [ "$STATUS" = "404" ]; then
    echo "Backend healthy on port ${BACKEND_PORT}"
    break
  fi
  echo "Backend not ready (attempt $i/5)..."
  sleep 3
done

# Frontend health check
for i in {1..5}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${FRONTEND_PORT} 2>/dev/null)
  if [ "$STATUS" = "200" ]; then
    echo "Frontend healthy on port ${FRONTEND_PORT}"
    break
  fi
  echo "Frontend not ready (attempt $i/5)..."
  sleep 3
done
```

### Step 8: Final Verification

```bash
BACKEND_OK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${BACKEND_PORT}/api)
FRONTEND_OK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${FRONTEND_PORT})

echo "Backend (port ${BACKEND_PORT}): ${BACKEND_OK}"
echo "Frontend (port ${FRONTEND_PORT}): ${FRONTEND_OK}"

if [ "$BACKEND_OK" != "000" ] && [ "$FRONTEND_OK" = "200" ]; then
  echo "READY: All servers running"
else
  echo "FAIL: Server startup failed"
  pm2 logs ${PREFIX}-backend --lines 20
  pm2 logs ${PREFIX}-frontend --lines 20
  exit 1
fi
```

---

## Output

On success, this skill produces:

```
SERVERS_READY=true
PREFIX={prefix}
BACKEND_PORT={port}
FRONTEND_PORT={port}
BACKEND_URL=http://localhost:{port}/api
FRONTEND_URL=http://localhost:{port}
```

These values should be used by downstream skills (smoke-test, playwright-qa-agent, etc.) instead of hardcoded URLs.

---

## Port Registry (Known Projects)

Each project uses a unique preferred port range to allow simultaneous development:

| Project | PREFIX | Backend | Frontend | Dashboards |
|---------|--------|---------|----------|------------|
| hire-agent | `ah` | 3000 | 5173 | 5174+ |
| tirebank | `tb` | 3003 | 5175 | 5176+ |

If a preferred port is occupied by another project, the skill auto-increments to find a free one.

When adding new projects, assign the next available range:
- Backend: next available 3xxx port
- Frontend: next available 517x port

---

## Error Handling

| Error | Action |
|-------|--------|
| Port occupied by another project | Auto-resolve: find next free port via `find_free_port` |
| Port occupied by same project | `pm2 delete ${PREFIX}-*` then restart |
| PM2 not installed | Fall back to `npm run start:dev &` |
| Backend crashes on startup | Check `pm2 logs ${PREFIX}-backend --lines 50` for DB connection errors |
| Frontend crashes on startup | Check `pm2 logs ${PREFIX}-frontend --lines 50` for build errors |
| Health check timeout after 5 attempts | FAIL — report the issue, do not proceed |
| `.env.local` port mismatch | Auto-fix and restart frontend |

---

## Integration with Other Skills

This skill is a **prerequisite** for:
- `smoke-test` — must run ensure-servers first
- `playwright-qa-agent` — needs servers running
- `e2e-test-generator` — needs servers for Playwright tests
- Phase 8 (test-api) — Step 1 (smoke test)
- Phase 9 (test-browser) — Steps 9b, 9c, 9d
