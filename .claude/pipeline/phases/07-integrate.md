# Phase 7: Integrate (Wire Frontend to Backend)

Phase 7 connects the React frontend to the NestJS backend API. All mock data is replaced with real API calls, error handling and loading states are implemented, and type safety is enforced across the integration boundary. This is the sync point where the parallel frontend and backend tracks converge.

## Prerequisites

- Phase 5 (backend) complete
- Phase 6 (frontend) complete

## Execution

### Step 7.1: Load Integration Skill

```
1. Load skill: .claude/$FRONTEND/skills/api-integration/SKILL.md
```

### Step 7.2: Wire Frontend to Backend API

```
2. For each page component with data requirements:
   a. Identify which backend API endpoints provide the data
   b. Create or update API service files (e.g., api.service.ts, hooks)
   c. Replace mock/static data with real API calls
   d. Use Redux async thunks (createAsyncThunk in service files) for READ data fetching, direct service calls for mutations
   e. Ensure proper authentication headers (JWT Bearer token)
```

### Step 7.3: Implement Error Handling

```
3. For each API integration point:
   a. Add error boundaries around API-dependent components
   b. Handle common error responses:
      - 401: Redirect to login / refresh token
      - 403: Show "Access Denied" message
      - 404: Show "Not Found" state
      - 500: Show generic error with retry option
   c. Implement toast/notification for user feedback
```

### Step 7.4: Implement Loading States

```
4. For each async operation:
   a. Show loading spinner or skeleton during data fetch
   b. Show empty state when data returns empty array
   c. Show error state on API failure
   d. Implement optimistic updates where appropriate (e.g., cart updates)
```

### Step 7.5: Enforce Type Safety

```
5. Type safety across the integration:
   a. No 'any' types in API response handling
   b. Create TypeScript interfaces matching backend DTOs
   c. Validate API response shapes match expected types
   d. Use discriminated unions for state management (loading | success | error)
```

### Step 7.6: Validate Data Flows

```
6. End-to-end data flow verification:
   a. Form submit -> API call -> response -> UI update
   b. List page -> click item -> detail page with correct data
   c. CRUD operations: create -> appears in list -> edit -> delete -> removed
   d. Auth flow: login -> token stored -> authenticated requests work
```

### Integration Verification (MANDATORY)

After wiring frontend to backend, verify the integration is real:

```
1. Redux hook usage in pages:
   Every data-displaying page MUST import and use Redux dispatch + selector hooks.

   # Find pages that DON'T use Redux hooks (excluding static pages like Landing, 404)
   grep -rL "useAppDispatch\|useAppSelector\|dispatch(" frontend/app/pages/ --include="*.tsx"
   → Only static/auth pages should appear. Data pages MUST have Redux hooks.

2. Socket.io connection:
   ScreenDetailPage (or equivalent real-time page) MUST import useScreenSocket or equivalent.
   grep -r "useSocket\|useScreenSocket\|socket" frontend/app/pages/ --include="*.tsx" -l
   → At least 1 page must use socket.

3. Auth flow end-to-end:
   - Login page calls authApi.login()
   - Token stored in authStore
   - Axios interceptor attaches token
   - Protected pages redirect to login when no token
   - 401 response triggers token refresh

4. Form submission check:
   Every form MUST have an onSubmit that calls a mutation:
   grep -r "onSubmit\|handleSubmit" frontend/app/pages/ --include="*.tsx" -l
   → Compare against pages that have forms. All forms must submit to API.

5. Redux extraReducers functional check:
   Every Redux slice with extraReducers MUST have builder.addCase calls (not empty/placeholder).
   grep -rl "extraReducers" frontend/app/redux/features/ --include="*Slice.ts" | \
     xargs grep -L "builder.addCase"
   → MUST return 0 files. Slices with empty extraReducers = data never reaches components.

6. No mock data remaining after integration:
   grep -rl "mockUsers\|mockProjects\|mockData\|sampleData\|dummyData" frontend/app/pages/ --include="*.tsx"
   → MUST return 0 files. All pages must use real API data via Redux thunks.

7. Empty state UI check:
   For each page that uses useAppSelector to display lists:
   - Page MUST handle empty array state (show "No data found" or EmptyState component)
   - Page MUST NOT show blank screen when API returns []
   grep -rl "useAppSelector" frontend/app/pages/ --include="*.tsx" | \
     xargs grep -L "length.*0\|No.*found\|empty\|EmptyState"
   → Pages returned = missing empty state UI. Fix before proceeding.
```

## Quality Gate

```yaml
gate: api_connection_rate >= 95%
checks:
  - all_apis_connected: "Every screen's data comes from real API?"
  - error_boundaries: "API failures show error states?"
  - loading_states: "Async operations show loading?"
  - type_safety: "No 'any' types in API responses?"
method: "Grep for API calls per component, check error handling"
```

## Loop Integration

- **Command**: `fullstack {project} --phase integrate --loop`
- **When**: If APIs are not connected or error handling is missing
- **Skill**: `.claude/$FRONTEND/skills/api-integration/SKILL.md`
- **Status file**: `INTEGRATION_STATUS.md`
- **Completion promise**: `INTEGRATION_QA_COMPLETE`

### Integration QA Checks

```yaml
integration-qa:
  stack: $FRONTEND
  checks:
    - api_call_exists (each page has real API calls)
    - error_handling (try-catch or error boundary)
    - loading_states (async ops show spinner/skeleton)
    - type_safety (no 'any' types for API data)
    - data_flows (form submit -> API -> response -> UI update)
  per_item: each page component with API calls
  completion_promise: "INTEGRATION_QA_COMPLETE"
```

---

## Phase Completion — Status Update

**Status updates are handled AUTOMATICALLY by the gate script (`_gate-runner.sh`).**

When the blueprint's `gate` deterministic node runs `bash gates/integrate-gate.sh`, the gate-runner:
- Updates Progress Table (Status, Score, Output, Gate Run At)
- Updates Gate Results section with check details
- Writes gate proof file to `.gate-proofs/integrate.proof`
- Appends to Execution Log
- Updates `last_run` and `pipeline_score` in Config

The blueprint's `verify-gate-proof` node confirms the gate ran. **No manual status updates needed.**
