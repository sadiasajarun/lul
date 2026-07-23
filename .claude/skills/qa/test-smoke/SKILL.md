---
name: smoke-test
description: Visits every route in the app via playwright-cli, checks for runtime errors (console errors, network 4xx/5xx, unhandled rejections, white screens). Captures and counts console errors per route. Produces a health report with console error summary.
---

# Smoke Test Skill

Fast, shallow health check of every route in the application. Opens each page in a headless browser and verifies it loads without runtime errors. This is the "pulse check" before deep E2E testing.

**Purpose**: Catch the class of bugs where pages build successfully but fail at runtime (e.g., 401 on public endpoints, unhandled promise rejections, white screens from missing imports, infinite console error loops).

---

## Prerequisites

1. `playwright-cli` installed: `npm install -g @playwright/cli@latest`
2. **Servers should ALREADY be running** — the orchestrator's `ensure-servers`
   deterministic node ran BEFORE invoking you (see test-api-2.yaml). Do NOT
   start `npm run dev` / `npm run start` yourself — if the dev server is hung
   or unresponsive, that's a real bug to report, not something to retry.
   - **Verify** servers with `pm2 status` (or `pm2 list`):
     ```bash
     pm2 status 2>&1 | grep -E "fsp-backend|fsp-frontend|online|stopped"
     ```
   - If backend or frontend is `stopped` / `errored`: the test environment is
     broken upstream — report `phase: test-api-smoke` with `crashes: 1` and
     `failed_routes: ['__servers_down__: <which one>']`. Exit immediately.
     Do NOT attempt to `npm run dev` — vite/react-router-dev hangs on
     unresolved imports (v92 evidence: 71-turn timeout chasing a hung frontend
     that had unresolved @tanstack imports). Reporting the bug is the right
     move; the next pipeline iteration will fix the upstream cause.
   - Read ports from `ecosystem.config.js` to compute URLs:
     ```bash
     BACKEND_PORT=$(node -e "console.log(require('./ecosystem.config.js').apps.find(a => a.name === 'fsp-backend').env.PORT)")
     FRONTEND_PORT=$(node -e "console.log(require('./ecosystem.config.js').apps.find(a => a.name === 'fsp-frontend').env.PORT)")
     export BACKEND_URL="http://localhost:$BACKEND_PORT"
     export FRONTEND_URL="http://localhost:$FRONTEND_PORT"
     ```
   - Use these values below — do NOT hardcode `localhost:3000` or `localhost:5173`
3. **Seed data verified** (for auth/admin routes):
   - Read credentials from `.claude-project/<project>/user_stories/_fixtures.yaml`
     under the `users:` section. Each entry has `email` + `password`.
     Pick one non-admin user (for auth routes) and one admin user (for
     admin routes). Do NOT hardcode emails or passwords — the fixture file
     is the single source of truth (RULE-B3).
   - Verify via:
     ```bash
     TEST_EMAIL="$(yq '.users[] | select(.role == "foreign_worker" or .role == "user") | .email' fixtures.yaml | head -1)"
     TEST_PASSWORD="$(yq ".users[] | select(.email == \"$TEST_EMAIL\") | .password" fixtures.yaml)"
     curl -s -X POST "${BACKEND_URL}/auth/login" \
       -H 'Content-Type: application/json' \
       -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"
     ```
   - If login returns 401: mark auth routes as BLOCKED (not FAIL)
   - Record: `TEST_USER_AVAILABLE=true|false`, `ADMIN_USER_AVAILABLE=true|false`

---

## Route Discovery

### Option A: Route Manifest (preferred)

Read `.claude-project/routes.yaml` for explicit route definitions with categories:

```yaml
routes:
  public:
    - path: /
      name: Home
  auth_required:
    - path: /cart
      name: Cart
  admin_required:
    - path: /admin
      name: Admin Dashboard
```

### Option B: Auto-discover from Router

If no routes.yaml exists, read the frontend router config:

```bash
# Find route config files
cat frontend/app/routes.ts frontend/app/routes/*.routes.ts 2>/dev/null
```

Extract all `route('path', 'file.tsx')` entries. Classify based on layout wrappers:
- Inside `layout('pages/auth/layout.tsx', ...)` = auth (guest-only)
- Inside `layout('components/layouts/ProtectedLayout.tsx', ...)` = protected
- `<ProtectedRoute>` = auth_required
- `<ProtectedRoute requiredRole="admin">` = admin_required

---

## Execution Protocol

### Step 0: Clean Console Logs

Archive previous console log files so each run starts fresh:

```bash
mkdir -p .claude-project/qa/smoke/console-logs-archive/
mv .claude-project/.playwright-cli/console-*.log \
   .claude-project/qa/smoke/console-logs-archive/ 2>/dev/null || true
```

### Step 1: Classify Routes

Group all routes into three categories:
- **public**: Visit directly, no auth needed
- **auth_required**: Login as test user first (skip if `TEST_USER_AVAILABLE=false`)
- **admin_required**: Login as admin user first (skip if `ADMIN_USER_AVAILABLE=false`)

### Step 2: Test Public Routes

For each public route:

```bash
# 1. Open session
SESSION="smoke-public-$(echo $ROUTE | tr '/' '-' | sed 's/^-//')-$(openssl rand -hex 2)"
PLAYWRIGHT_MCP_VIEWPORT_SIZE=1440x900 playwright-cli -s=$SESSION open "${FRONTEND_URL}${ROUTE}" --persistent

# 2. Wait for page load (snapshot triggers wait)
playwright-cli -s=$SESSION snapshot

# 3. Wait 3 seconds for async errors to fire (API calls, auth checks)
sleep 3

# 4. Take second snapshot to capture post-load state
playwright-cli -s=$SESSION snapshot

# 5. Screenshot for evidence
playwright-cli -s=$SESSION screenshot
# Save to: .claude-project/qa/smoke/{route-kebab}.png

# 6. Capture console errors (see Console Error Capture Protocol below)

# 7. Close session
playwright-cli -s=$SESSION close
```

**Evaluate each route:**

| Check | How | PASS | FAIL |
|-------|-----|------|------|
| Page loads | Snapshot returns content | Elements visible in accessibility tree | Timeout or empty tree |
| No white screen | Snapshot has > 3 meaningful elements | Content nodes present | Only root div, no children |
| No error overlay | Check snapshot for error boundary text | No error boundary triggered | React error boundary or "Something went wrong" |
| Content renders | Snapshot shows expected page elements | Page-specific content visible | Generic fallback or loading stuck |
| Console errors within budget | Read console log, count errors | Total <= budget for category | Total exceeds budget OR infinite loop |
| No P0 error patterns | Check console log for crash/loop patterns | No P0 patterns found | ErrorBoundary caught, infinite auth loop |

### Step 3: Test Auth-Required Routes

**Pre-check**: If `TEST_USER_AVAILABLE=false`:
- Mark ALL auth-required routes as **BLOCKED** (not FAIL)
- Reason: "No test user in database — run seed script"
- Skip login attempt entirely (avoids triggering auth refresh loop)
- In the report, show as:
  ```
  | /cart | Cart | BLOCKED | 0 | No test user in DB | - |
  ```
- BLOCKED routes do NOT count against pass rate
- Report: "Pass Rate: 10/12 (83%) + 6 BLOCKED"

If `TEST_USER_AVAILABLE=true`:
1. Open a session and navigate to `/login`
2. Login via UI:
   ```bash
   playwright-cli -s=$SESSION snapshot
   # Find email field ref, password field ref, submit button ref
   playwright-cli -s=$SESSION fill {email_ref} "$TEST_EMAIL"      # from _fixtures.yaml
   playwright-cli -s=$SESSION fill {password_ref} "$TEST_PASSWORD" # from _fixtures.yaml
   playwright-cli -s=$SESSION click {submit_ref}
   playwright-cli -s=$SESSION waitfortext "..."  # Wait for redirect
   ```
3. Navigate to each auth-required route and run the same checks as public routes
4. Capture console errors for each route
5. Close session after all auth routes are tested

### Step 4: Test Admin-Required Routes

**Pre-check**: If `ADMIN_USER_AVAILABLE=false`:
- Mark ALL admin-required routes as **BLOCKED** (not FAIL)
- Same handling as auth-required BLOCKED routes

If `ADMIN_USER_AVAILABLE=true`:
- Same as Step 3 but login with admin credentials read from
  `_fixtures.yaml` (pick a user whose role indicates admin authority —
  e.g. `admin`, `operator`, `super_admin`, depending on the project's
  RoleEnum).

### Step 5: Network Error Detection

For each route, after loading, check for network errors by examining the page state:
- Look for error toast notifications or error messages in the snapshot
- Check if the page shows an error boundary ("Something went wrong")
- Look for "401", "403", "404", "500" text in error messages
- If the page shows login redirect when it shouldn't (public route), that's a FAIL

---

## Console Error Capture Protocol

The `playwright-cli` automatically captures browser console errors to log files when
`.playwright/cli.config.json` has `"console": {"level": "error"}`.

**Log location**: `.claude-project/.playwright-cli/console-{timestamp}.log`

**Log format**:
```
[{ms}ms] [ERROR] {message} @ {source_url}:{line}
```

### Per-Route Console Error Check

After visiting each route and waiting 3 seconds:

```bash
# 1. Find the most recent console log file (corresponds to current session)
CONSOLE_LOG=$(ls -t .claude-project/.playwright-cli/console-*.log 2>/dev/null | head -1)

# 2. If log exists, count errors
if [ -f "$CONSOLE_LOG" ]; then
  # Total error lines
  TOTAL_ERRORS=$(grep -c '\[ERROR\]' "$CONSOLE_LOG" 2>/dev/null || echo "0")

  # Unique error messages (deduplicated)
  UNIQUE_ERRORS=$(grep '\[ERROR\]' "$CONSOLE_LOG" 2>/dev/null | \
    sed 's/^\[.*ms\] //' | sort -u | wc -l | tr -d ' ')

  # Check for auth refresh loop pattern
  AUTH_LOOP=$(grep -c 'auth/refresh\|/users/me.*401\|auth/logout.*401' "$CONSOLE_LOG" 2>/dev/null || echo "0")

  # Detect infinite loop: > 100 total errors from a single page
  if [ "$TOTAL_ERRORS" -gt 100 ]; then
    INFINITE_LOOP="YES"
  else
    INFINITE_LOOP="NO"
  fi

  # Extract top error message
  TOP_ERROR=$(grep '\[ERROR\]' "$CONSOLE_LOG" 2>/dev/null | \
    sed 's/^\[.*ms\] //' | sort | uniq -c | sort -rn | head -1 | sed 's/^ *[0-9]* //')
fi
```

### Error Classification

| Error Pattern | Category | Severity |
|---------------|----------|----------|
| `TypeError: X.map is not a function` | Envelope mismatch | P0 (page crash) |
| `ErrorBoundary caught:` | Component crash | P0 |
| Auth refresh loop (> 100 occurrences of 401) | Infinite loop | P0 |
| `Failed to load resource: 401` on public endpoint | Missing @Public() | P1 |
| `Failed to load resource: 404` | Missing API route | P1 |
| `Failed to load resource: 500` | Server error | P1 |
| `Uncaught TypeError` / `ReferenceError` | Code bug | P1 |
| React hydration warnings | Framework noise | Ignore |
| `[WARNING]` level messages | Not errors | Ignore |
| `chrome-extension://` errors | Browser extension | Ignore |

### Console Error Budget

| Route Category | Max Unique Errors | Max Total Errors |
|----------------|-------------------|------------------|
| Public | 0 | 0 |
| Auth (logged in) | 3 | 10 |
| Auth (not logged in) | 0 | 0 |
| Admin (logged in) | 3 | 10 |

A route FAILS the console error check if:
- Total errors exceed the budget for its category, OR
- An infinite loop is detected (total > 100), OR
- Any P0-classified error pattern is found

### Console Log File Management

Console log files accumulate across runs. The cleanup at Step 0 archives old logs.

**Per-session log isolation**: Each `playwright-cli` session generates its own console log.
To associate logs with routes:
1. Before opening a new session, note the current timestamp
2. After the session completes, find the console log with the nearest matching timestamp
3. Quick check: if log file size > 1MB, likely contains an infinite loop

---

## Report Format

```markdown
# Smoke Test Report

**Date**: {YYYY-MM-DD HH:MM}
**Routes Tested**: {N}/{total}
**Passed**: {pass}
**Failed**: {fail}
**Blocked**: {blocked} (no seed data)
**Pass Rate**: {pass}/{tested} ({percentage}%) + {blocked} BLOCKED
**Total Console Errors**: {sum across all routes}
**Infinite Loops Detected**: {count}

---

## Console Error Summary

| Route | Category | Total Errors | Unique Errors | Infinite Loop | Top Error |
|-------|----------|-------------|---------------|---------------|-----------|
| / | public | 0 | 0 | NO | - |
| /products | public | 12 | 3 | NO | TypeError: products.map... |
| /login | public | 0 | 0 | NO | - |
| /cart | auth | BLOCKED | - | - | No test user in DB |

---

## Results

### Public Routes

| Route | Name | Status | Console Errors | Issues | Screenshot |
|-------|------|--------|----------------|--------|------------|
| / | Home | PASS | 0 | - | smoke/home.png |
| /products | Product List | FAIL | 12 (3 unique) | ErrorBoundary crash | smoke/products.png |
| /events | Event List | FAIL | 8 (2 unique) | ErrorBoundary crash | smoke/events.png |

### Auth-Required Routes

| Route | Name | Status | Console Errors | Issues | Screenshot |
|-------|------|--------|----------------|--------|------------|
| /cart | Cart | BLOCKED | - | No test user in DB | - |
| /my-page | My Page | BLOCKED | - | No test user in DB | - |

### Admin-Required Routes

| Route | Name | Status | Console Errors | Issues | Screenshot |
|-------|------|--------|----------------|--------|------------|
| /admin | Dashboard | BLOCKED | - | No admin user in DB | - |

---

## Failures

### 1. /products - FAIL (P0: Component Crash)
**Category**: public
**Console Errors**: 12 total, 3 unique
**Top Error**: `TypeError: products.map is not a function`
**Evidence**: ErrorBoundary visible in snapshot. Console log shows envelope mismatch.
**Fix Suggestion**: Unwrap API response envelope in Axios interceptor.

### 2. /events - FAIL (P0: Component Crash)
**Category**: public
**Console Errors**: 8 total, 2 unique
**Top Error**: `TypeError: eventList.map is not a function`
**Evidence**: Same envelope mismatch pattern.
**Fix Suggestion**: Same as /products — fix Axios interceptor.

---

## Summary

| Category | Total | Passed | Failed | Blocked | Console Errors |
|----------|-------|--------|--------|---------|----------------|
| Public | 12 | 10 | 2 | 0 | 20 |
| Auth-Required | 6 | 0 | 0 | 6 | - |
| Admin-Required | 7 | 0 | 0 | 7 | - |
| **Total** | **25** | **10** | **2** | **13** | **20** |

**Infinite Loops**: 0
**P0 Issues**: 2 (component crashes)
**Overall Health**: 10/12 tested = 83% (FAIL - target is 100%) + 13 BLOCKED
```

---

## Status File Integration

Update `.claude-project/status/tirebank/SMOKE_TEST_STATUS.md`:

```markdown
# Smoke Test Status

**Last Run**: {date}
**Pass Rate**: {N}/{total} ({percentage}%) + {blocked} BLOCKED
**Console Errors**: {total_errors} total, {unique_errors} unique
**Infinite Loops**: {loop_count}

| # | Route | Category | Status | Console Errors | Last Checked |
|---|-------|----------|--------|----------------|-------------|
| 1 | / | public | PASS | 0 | {date} |
| 2 | /products | public | FAIL | 12 (3 unique) | {date} |
| 3 | /cart | auth | BLOCKED | - | {date} |
...
```

---

## Loop Integration

This skill works with the fullstack loop system:

```yaml
smoke-test:
  stack: base
  skill: qa/smoke-test/SKILL.md
  status_file: SMOKE_TEST_STATUS.md
  per_item: each route
  completion_promise: "SMOKE_TEST_COMPLETE"
  default_iterations: 50
```

In loop mode, each route is one item. The loop iterates through failing routes, and the agent is expected to fix the underlying issue and re-test.

---

## Error Handling

| Situation | Action |
|-----------|--------|
| `playwright-cli` not installed | FAIL with: `npm install -g @playwright/cli@latest` |
| Frontend not running | Run ensure-servers skill first. FAIL with: "Connection refused at ${FRONTEND_URL}" |
| Backend not running | Run ensure-servers skill first. FAIL with: "Connection refused at ${BACKEND_URL}" |
| Login fails (bad credentials) | Mark auth routes as BLOCKED: "Test user credentials not working. Run database seeds." |
| Route returns 404 | Mark FAIL, suggest checking route definition in routes.ts and routes/*.routes.ts |
| Page loads but is empty | Mark FAIL, suggest checking component imports and data fetching |
| Timeout on page load | Mark FAIL with timeout duration, suggest checking for infinite loops |
| Console log file > 1MB | Flag as P0 infinite loop, report top error pattern |

---

## Common Fix Patterns

| Failure | Typical Fix |
|---------|-------------|
| 401 on public route | Add/verify `@Public()` decorator on backend controller |
| White screen | Fix missing import or component crash |
| Console TypeError | Fix null reference (data not loaded yet) |
| Network 500 | Fix backend service/controller error |
| Login redirect on public page | Check ProtectedLayout routeAccess map and routes/protected.routes.ts |
| Stuck loading spinner | Fix API hook or add error handling |
| Error boundary triggered | Fix uncaught exception in component |
| Infinite auth refresh loop | Skip `/users/me` when no token; don't call `logout()` on refresh 401 |
| `.map() is not a function` | Unwrap API response envelope in Axios interceptor |
