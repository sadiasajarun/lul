# Phase 10: Ship (Deploy to Production)

Phase 10 performs final production verification, validates environment configuration, calculates specification drift, and deploys to the target environment. This is the final gate before the product goes live.

## Prerequisites

- Phase 9 (test-browser) complete

## Execution

### Step 10.1: Production Build Verification

```
1. Run production builds for both frontend and backend:
   a. Frontend: cd frontend && npm run build
      - Verify build completes without errors
      - Check bundle size is reasonable
      - Verify all assets are included
   b. Backend: cd backend && npx tsc --noEmit
      - Verify TypeScript compilation succeeds
      - No type errors or warnings

2. Verify Docker builds (if applicable):
   a. docker compose -f docker-compose.prod.yml build
   b. All services build successfully
```

### Step 10.2: Environment Variable Validation

```
1. Check all required environment variables are set:
   - Database connection (DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME)
   - JWT secrets (JWT_SECRET, JWT_REFRESH_SECRET)
   - OAuth credentials (if applicable)
   - API URLs (FRONTEND_URL, BACKEND_URL)
   - File storage configuration

2. Verify .env.example is up to date:
   - Every env var used in code has an entry in .env.example
   - No secrets are hardcoded in source code

3. Validate environment-specific configs:
   - Production API base URL is correct
   - CORS origins are properly configured
   - Logging level is appropriate for production
```

### Step 10.3: Drift Calculation

Calculate how far the implementation has drifted from the original seed specification.

```
drift = 0.5 * goal_drift + 0.3 * constraint_drift + 0.2 * ontology_drift

goal_drift: Does the built product still serve the original goal?
constraint_drift: Were any constraints violated?
ontology_drift: Are the key entities/terms still as defined?
```

### Drift Actions

| Drift Score | Meaning | Action |
|-------------|---------|--------|
| <= 0.1 | On track | Ship confidently |
| 0.1 - 0.2 | Minor drift | Document what changed, ship |
| 0.2 - 0.4 | Moderate drift | Review with user: evolve spec or fix code? |
| > 0.4 | Major drift | STOP. Re-interview or major redesign needed |

If drift > 0.2, offer:
```
1. Evolve the spec (accept the drift, update seed)
2. Fix the code (revert drift, match original spec)
3. Re-interview (requirements fundamentally changed)
```

### Step 10.4: Deploy

```
1. Based on deployment target:
   a. Docker Compose: docker compose -f docker-compose.prod.yml up -d
   b. Cloud platform: follow deployment guide at .claude-project/docs/DEPLOYMENT.md
   c. Custom: follow project-specific deployment instructions

2. Post-deploy verification:
   a. Health check endpoints respond
   b. Database migrations applied
   c. Frontend loads and connects to backend
   d. Core user flows work in production
```

## Drift Monitoring (Between Generations)

At Phase 10 and optionally between generations in `--loop` mode, check specification drift:

```
drift = 0.5 * goal_drift + 0.3 * constraint_drift + 0.2 * ontology_drift
```

This is calculated by comparing the current implementation against the seed YAML:
- **goal_drift**: Does the built product still serve the original goal?
- **constraint_drift**: Were any constraints violated (tech stack, performance, security)?
- **ontology_drift**: Are the key entities/terms still as defined in the seed?

### Drift in Loop Mode

In `--loop` mode, drift is checked at the end of each generation. If drift exceeds 0.2:
- The loop pauses
- The user is presented with the three options (evolve spec, fix code, re-interview)
- The loop resumes after the user's decision

## Quality Gate

```yaml
gate: build_ok AND drift <= 0.2
checks:
  - build_succeeds: "Production build completes?"
  - env_configured: "All env vars set?"
  - drift_acceptable: "Spec drift <= 0.2?"
method: "Run build, check env, calculate drift from seed"
```

## Loop Integration

- No loop workflow runs for ship phase
- Ship is a deterministic verification + deployment step
- If drift is too high, the pipeline routes back to earlier phases
- Related command: `/ouroboros:status` -- Check drift from spec

## Production Escape Tracking (Post-Ship)

After deployment, any bug reported against production triggers the **production escape protocol** — the strongest RL learning signal in the system.

### How Production Escapes are Reported

Use `/report-bug` with the production flag:
```
/report-bug --escaped
```

Or manually create a bug report with `escaped: true` in `.claude-project/bug_reports/BUG-{NNN}.yaml`.

### What Happens

1. **Normal RCA** runs via `run-feedback-loop/SKILL.md` (same as any bug)
2. **Reward attribution** is set to catastrophic:
   - `shift_left_multiplier = -50.0`
   - `reward_impact = -50.0 × severity_weight` (P0 escape = -500 reward)
3. **Policy memory updated**:
   - Per-project: escape event logged in `.claude-project/policy-memory.yaml`
   - Global: prevention strategy added to `.claude/pipeline/loop/policy-memory-global.yaml` → `production_escapes[]`
4. **Future loop runs** read the global policy memory and:
   - Increase testing depth for the bug category
   - Boost priority of the `should_have_caught_phase`
   - Add the escape pattern as a mandatory check in relevant phases

### Why This Matters

The -50x multiplier means a single escaped P0 bug (-500) outweighs an entire episode of positive rewards (~160 typical). This creates an asymmetric incentive: the system will invest disproportionate effort in prevention rather than risk an escape.

### Escape Severity Impact

| Severity | severity_weight | × -50 escape multiplier | Impact |
|----------|----------------|------------------------|--------|
| P0 (crash) | -10 | -500 | Dominates entire episode |
| P1 (wrong behavior) | -5 | -250 | Outweighs most generation rewards |
| P2 (cosmetic) | -2 | -100 | Significant penalty |
| P3 (minor) | -1 | -50 | Notable but recoverable |

---

## Phase Completion — Status Update

**Status updates are handled AUTOMATICALLY by the gate script (`_gate-runner.sh`).**

When the blueprint's `gate` deterministic node runs `bash gates/ship-gate.sh`, the gate-runner:
- Updates Progress Table (Status, Score, Output, Gate Run At)
- Updates Gate Results section with check details
- Writes gate proof file to `.gate-proofs/ship.proof`
- Appends to Execution Log
- Updates `last_run` and `pipeline_score` in Config

The blueprint's `verify-gate-proof` node confirms the gate ran. **No manual status updates needed.**
