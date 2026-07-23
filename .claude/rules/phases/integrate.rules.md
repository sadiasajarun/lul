# Integrate Phase Rules

## Process

- Wire every frontend component to its corresponding backend API
- Replace mock/placeholder data with real API calls
- Use Redux async thunks for READ operations (`createAsyncThunk` in service files, `extraReducers` in slices)
- Use direct service calls for MUTATION operations (create/update/delete) with local `useState` for loading
- Do NOT use TanStack Query — all data fetching goes through Redux
- Handle loading, error, and empty states for every API call
- Read PROJECT_API_ROUTES.md (auto-generated) for exact backend route paths

## Code Quality

- No `any` types in API response types — use proper DTOs ✅ gate: `no-any-types`
- Every API call must have error handling (try-catch or error boundary) ✅ gate: `error-handling`
- Every async operation must show loading state ✅ gate: `loading-states`
- Form submissions must use proper API service calls
- Error messages should use server response (`err.response?.data?.message`) or i18n, not hardcoded strings ✅ gate: `no-hardcoded-error-messages`
- No inline domain/state interfaces — all domain types, `*State` interfaces, and API DTOs MUST be in `~/types/{domain}.d.ts` ✅ gate: `no-inline-domain-interfaces`
  - Only component Props interfaces and local UI unions may stay inline
  - Violation: integrate-gate FAIL

## Safety Patterns

### RULE-I1: Axios Interceptor Retry Limit ✅ gate: `interceptor-retry-limit`

<!-- Why: Response interceptor retried 401 requests indefinitely — when the refresh
     token was also expired, the app entered an infinite loop of refresh attempts,
     freezing the browser tab. Users had to force-close the tab.
     Pattern: auth-001 — Session expiry/credential error repeated display
     Ref: bug-patterns-global.yaml → auth-001 | integrate-gate.sh -->

- Response interceptor must have `_isRetry` or `_retry` flag
- On 401 response, attempt refresh token renewal only once
- On refresh failure, logout immediately (no retry)
- Violation: integrate-gate FAIL

### RULE-I2: setTimeout Navigation Prohibited ✅ gate: `no-settimeout-navigate`

<!-- Why: Agent used setTimeout(() => navigate('/dashboard'), 1500) after login API call.
     On slow networks the navigation fired before the cookie was set, redirecting to
     dashboard without auth — which then redirected back to login, creating a loop.
     Pattern: auth-003 — Redirect to wrong screen after authentication
     Ref: bug-patterns-global.yaml → auth-003 | integrate-gate.sh -->

- `setTimeout(() => navigate(...))` after API response is prohibited
- Instead: call `navigate()` immediately after `await mutateAsync()`
- Or: `useEffect` + state-based navigation
- Violation: integrate-gate FAIL

### RULE-I3: API Routes Must Match Backend Controller ✅ gate: `api-route-matching`

<!-- Why: Agent guessed frontend API paths from PRD role names (e.g., /client/projects,
     /admin/users) but backend controllers used different prefixes (e.g., /projects,
     /users). Every API call returned 404. The fix: read PROJECT_API_ROUTES.md which
     is auto-generated from actual @Controller decorators.
     Pattern: A-01 — Field Name Mismatch (route variant)
     Ref: integrate.yaml → api-contract-check node, integrate-gate.sh -->

- Frontend API call paths must match backend @Controller decorator paths exactly
- Do not guess URL prefixes from PRD role names (client, admin)
- Use exact paths by referencing PROJECT_API_ROUTES.md or PROJECT_API.md
- Violation: integrate-gate FAIL

### RULE-I4: CORS Port Consistency ✅ gate: `cors-port-consistency`

<!-- Why: Backend CORS allowed localhost:5173 but Vite started on port 5175 (collision
     with another project). All API calls were blocked by CORS. Playwright tests also
     failed because baseURL pointed to 5173 while the app ran on 5175.
     Pattern: Port mismatch — three config sources must agree
     Ref: integrate-gate.sh → cors-port-consistency check -->

- Backend CORS origin, Playwright baseURL, and Vite port must match
- Violation: integrate-gate FAIL
- **v114 — backend LISTEN port too:** the backend `.env PORT`, frontend `VITE_API_URL`, CORS `ALLOW_ORIGINS`, `ensure-servers`/health-check, and `scaffold-global-setup-verify` (login-proof) must ALL resolve to the same `{BACKEND_PORT}` (the cell's assigned port, e.g. 3601 — NOT hardcoded 3000). If pre-build writes `PORT=3000` while the cell runs on 3601, ensure-servers watches 3601, nothing boots on 3000, login-proof gets HTTP 0 → test-api false-fails at pre-check. Enforced: `deterministic.js` passes the real `BACKEND_PORT` to scaffolds; `scaffold-environment` + `pre-build-2.yaml`/`init-2.yaml` emit `{BACKEND_PORT}`.

### RULE-I5: Socket Client Required When Backend Has Gateway ✅ gate: `socket-client-integration`, `socket-cleanup-exists`

<!-- Why: Backend had a WebSocket gateway for real-time board updates, but frontend
     never installed socket.io-client. The integrate phase "completed" with REST-only
     wiring, leaving the real-time feature dead. Also: socket listeners without cleanup
     in useEffect caused memory leaks and duplicate event handlers on re-render.
     Pattern: C-04 — Missing PRD Features (socket variant)
     Ref: integrate-gate.sh → socket-client-integration, socket-cleanup-exists checks -->

- If backend has `@WebSocketGateway`, frontend MUST have `socket.io-client` integration
- MUST create: socket service (`socketService.ts`), socket context (`SocketContext.tsx`), useSocket hook (`useSocket.ts`)
- Socket listeners MUST have cleanup in `useEffect` return (`socket.off()`)
- Socket context provider MUST call `disconnectSocket()` on unmount
- Redux state MUST be updated from socket events via `dispatch(action)`
- Read `.claude/$FRONTEND/docs/socket-integration.md` for implementation patterns
- Violation: integrate-gate FAIL (conditional — only checked when backend has gateway)

## Scope Guard

- ONLY modify files under: frontend/app/ (to add API calls)
- May READ backend/src/ (to understand API contracts)
- Do NOT modify backend code — APIs are frozen at this point
- Do NOT modify design or HTML files
- Do NOT add new endpoints — only consume existing ones
