# Phase 5: Backend (TDD — RED → GREEN → REFACTOR)

Phase 5 follows a test-driven development cycle: write failing tests from specs FIRST, then implement the minimum code to pass them, then refactor. This ensures tests encode acceptance criteria rather than merely documenting existing implementation.

This phase runs in parallel with Phase 6 (frontend) since backend depends on database while frontend depends on design.

## Prerequisites

- Phase 4 (database) complete

## Execution

### Step 5-env: Generate Environment Files (MANDATORY before any code)

```
1. Read .claude-project/docs/PROJECT_KNOWLEDGE.md — Environment Variables section (primary source)
2. Read .claude/$BACKEND/guides/configuration.md — for correct naming format
3. Cross-reference with code: grep for configService.get/getOrThrow and process.env usage
4. Create backend/.env.example with ALL required vars (including planned infrastructure)
5. Copy backend/.env.example → backend/.env with development values
6. REQUIRED vars that MUST be present (interceptors use getOrThrow — app crashes without):
   - AUTH_TOKEN_COOKIE_NAME
   - AUTH_REFRESH_TOKEN_COOKIE_NAME
   - JWT_SECRET (no fallback allowed)

SCOPE GUARD: Only create/modify backend/.env.example and backend/.env
```

### Step 5a: RED — Generate Failing Tests from Acceptance Criteria

```
1. Load guide: .claude/$BACKEND/guides/workflow-generate-e2e-tests.md
2. For each PRD endpoint (from PROJECT_API.md):
   a. Generate e2e test encoding expected behavior:
      - Success path with correct status codes (200, 201, 204)
      - Auth guard tests (401 without token, 403 with wrong role)
      - Validation tests (400 with invalid/missing fields)
      - Not found tests (404 for non-existent resources)
   b. Use GIVEN/WHEN/THEN style for clarity
   c. Write to: backend/test/e2e/{module}.e2e-spec.ts
3. Tests WILL fail — no implementation exists yet (this is correct)

SCOPE GUARD: Only create/modify files under backend/test/
             Do NOT touch backend/src/modules/ (no controllers, services, or DTOs)
```

### Step 5b: GREEN — Implement Minimum Code to Pass Tests

```
1. Load skill: .claude/$BACKEND/skills/api-development/SKILL.md
2. Load architecture: .claude/$BACKEND/guides/architecture-overview.md
3. Load coding guides (MUST Read before writing code):
   - .claude/$BACKEND/guides/routing-and-controllers.md (controller patterns)
   - .claude/$BACKEND/guides/services-and-repositories.md (service/repository patterns)
   - .claude/$BACKEND/guides/database-patterns.md (entity patterns)
   - .claude/$BACKEND/guides/authentication-cookies.md (auth implementation)
   - .claude/$BACKEND/guides/validation-patterns.md (DTO validation)

   >>> CHECKPOINT (MANDATORY before writing ANY code):
   === BACKEND PATTERN CHECKPOINT ===
   From architecture-overview.md:
   - Base classes path: [what you read]
   - Layer pattern: [what you extracted]
   - PROHIBITED patterns: [what the doc says NOT to do]
   From routing-and-controllers.md:
   - Controller decorator pattern: [what you read]
   From services-and-repositories.md:
   - Service injection pattern: [what you read]
   - Repository base class: [what you read]
   === END BACKEND PATTERN CHECKPOINT ===
   ❌ If any field is blank, re-read the guide. Do NOT proceed with blank fields.
   ❌ Do NOT fill from memory — fill ONLY from what you just read.

4. For each module with failing tests, create ALL 4 layers:
   a. {feature}.entity.ts — extends BaseEntity from src/core/base/
   b. {feature}.repository.ts — extends BaseRepository from src/core/base/
   c. {feature}.service.ts — extends BaseService from src/core/base/
   d. {feature}.controller.ts — extends BaseController from src/core/base/
   e. {feature}.module.ts — NestJS module registering all layers
   f. dtos/ — DTOs with class-validator decorators
5. Follow coding patterns from guides AND the PROHIBITED patterns in architecture-overview.md:
   - Controllers: extend BaseController, override only when custom behavior needed
   - Services: extend BaseService, inject custom repository classes
   - Repositories: extend BaseRepository, all query logic goes here
   - DTOs: class-validator decorators + @ApiProperty() for Swagger
   - Auth: httpOnly cookies (NEVER localStorage), JwtStrategy extracts from cookie
   - Responses: wrapped in ResponsePayloadDto via TransformInterceptor
6. Guards/decorators MUST be in src/core/ — NOT inside feature modules
7. Run tests after each module — verify they turn green
8. Iterate until all e2e tests pass

SCOPE GUARD: Only create/modify files under backend/src/
             Do NOT modify backend/test/ — tests define the contract
             Do NOT put guards/decorators inside feature modules
```

### Step 5b-seed: Create Database Seed Files

```
1. Load skill: .claude/$BACKEND/skills/database-seeding/SKILL.md
2. Create seed files in backend/src/database/seeders/:
   a. index.ts — Main orchestrator (bootstraps NestJS app via NestFactory.create, loads fixtures once, runs seeders in dependency order)
   b. One seed file per domain: user.seed.ts, {domain}.seed.ts, etc.
3. Rules:
   - Credentials MUST come from .claude-project/user_stories/_fixtures.yaml
   - Hardcoding email/password is PROHIBITED
   - Idempotent: findOne check before insert
   - Seed in dependency order (parents before children)
   - Use Logger from @nestjs/common in each seeder (not console.log)
   - Cross-entity lookups by unique field (email, etc.)
   - Use proper ES imports (no require())
   - Each seeder exports a single async function: seedX(dataSource, fixtures)
4. Register npm script in package.json:
   "seed": "ts-node -r tsconfig-paths/register src/database/seeders/index.ts"

SCOPE GUARD: Only create files under backend/src/database/seeders/
             May modify backend/package.json (to add seed script)
```

### Step 5c: REFACTOR — Improve Code Quality (Tests Stay Green)

```
1. Review implementation for:
   a. Code duplication → extract shared utilities
   b. Missing Swagger decorators (@ApiTags, @ApiOperation, @ApiResponse)
   c. Missing class-validator decorators on DTOs
   d. Naming consistency with NestJS conventions
2. After each refactoring change, verify tests still pass
3. Do NOT add new features or change behavior

SCOPE GUARD: Only modify files under backend/src/
             Do NOT modify backend/test/ — tests must remain unchanged
```

### Review Step

After refactoring, a review node checks spec compliance:

- Every PRD endpoint has a corresponding controller route
- Request/response DTOs match documented shapes
- Correct HTTP status codes used
- Auth guards applied where documented
- No over-engineering beyond what's in the spec

### Step 5d: Runtime Verification (MANDATORY — DO NOT SKIP)

⚠️ This step prevents the #1 backend failure: agent generates files with TODO stubs instead of real implementations.

```
1. Check for stubs/TODOs:
   grep -r "TODO\|FIXME\|stub\|not.implemented\|logger.log.*TODO" backend/src/modules/ --include="*.ts" -c
   → MUST be 0. If > 0: re-enter 5b GREEN to implement missing logic.

2. Verify ALL PRD services are implemented (not just declared):
   For each module in PROJECT_API.md:
   a. Controller file exists with all documented endpoints
   b. Service file has actual Prisma queries (not empty methods)
   c. DTOs have class-validator decorators

3. Verify critical integrations exist (not stubbed):
   | Integration | Check | Required Files |
   |------------|-------|---------------|
   | Email (Resend) | grep -r "Resend\|resend" backend/src/ | email.service.ts or similar |
   | Cron Jobs | grep -r "@Cron\|@Interval" backend/src/ | At least 1 cron decorator |
   | Socket.io | grep -r "@WebSocketGateway" backend/src/ | gateway file with events |
   | Stripe | grep -r "stripe\|Stripe" backend/src/modules/billing/ | webhook handler with event types |
   | Storage/Sharp | grep -r "sharp\|Sharp" backend/src/ | image processing pipeline |
   | All SSO providers | Check strategies/ for each PRD-required provider | jwt + google + apple (if PRD requires) |
   | Rate Limiting | grep -r "Throttle\|throttle\|ThrottlerGuard" backend/src/ | Applied on auth endpoints |
   | Sentry | grep -r "Sentry\|sentry" backend/src/ | Error tracking initialized |

4. Global interceptor & filter registration:
   grep -q 'useGlobalInterceptors' backend/src/main.ts
   → MUST pass. If fails: add app.useGlobalInterceptors(new TransformInterceptor())
   grep -q 'useGlobalFilters' backend/src/main.ts
   → MUST pass. If fails: add app.useGlobalFilters(new HttpExceptionFilter())

5. Infrastructure modules implemented (not empty):
   For each dir in infrastructure/{mail,s3,token,logging}:
     find backend/src/infrastructure/$dir -name '*.ts' ! -name '.gitkeep' | wc -l
   → At least 2 of 4 modules MUST have actual .ts files (not just .gitkeep)

6. File upload check (if attachment module exists):
   grep -q 'FileInterceptor\|UploadedFile' backend/src/modules/attachment/attachment.controller.ts
   → MUST pass. Metadata-only attachment API without real file upload is prohibited.

7. CORS credentials check:
   grep -q 'credentials.*true' backend/src/main.ts
   → MUST pass. Required for httpOnly cookie authentication.

8. Server start test:
   cd backend && timeout 30 npm run start:dev &
   sleep 10
   curl -f http://localhost:${BACKEND_PORT:-3001}/api/health
   → MUST return 200. If fails: fix compilation/runtime errors.
   → Kill server after check.

9. Migration test:
   cd backend && npx typeorm migration:run
   → MUST succeed. If no migrations exist: generate them first.
```

## Backend Test Coverage Requirements

```yaml
per_endpoint:
  - happy_path: "At least 1 success case per route"
  - auth_guard: "Verify 401 without token, 403 with wrong role"
  - validation: "Verify 400 with invalid/missing fields"
  - not_found: "Verify 404 for non-existent resources"
per_module:
  - crud_flow: "Full create -> read -> update -> delete cycle"
  - pagination: "If list endpoint exists, test limit/offset"
  - relationships: "Test entity relationships and cascades"
```

## Quality Gate

```yaml
gate: tests_pass AND endpoint_coverage >= 90%
checks:
  - all_endpoints_exist: "Every PRD endpoint has a controller route?"
  - dtos_match_spec: "Request/response DTOs match PRD?"
  - error_handling: "404, 400, 401, 403 handled?"
  - tests_exist: "At least one e2e test per endpoint?"
  - tests_compile: "All backend test files compile without errors?"
  - tests_execute: "Tests actually run and pass (not just compile)?"
  - tests_pass_rate: "At least 80% of tests pass?"
  - crud_coverage: "Full CRUD cycle tested for each entity?"
method: "Compare PRD endpoints vs controller routes, run tests, check pass rate"
```

## TDD Principles (from Foyzul's Framework)

1. **Tests encode specs, not implementation** — Tests are written from PROJECT_API.md, not from reading source code
2. **Scope isolation** — Test writer cannot touch src/, implementer cannot touch test/
3. **Minimum implementation** — Write just enough code to pass. No speculative features
4. **Refactor safely** — Improve structure only when tests provide a safety net
5. **Review against specs** — Final check that implementation matches PRD, not just passes tests

## Loop Integration

- **Command**: `fullstack {project} --phase backend --loop`
  - **When**: If tests don't pass or endpoints are incomplete
  - **Skills**:
    - E2E test generation: `.claude/$BACKEND/guides/workflow-generate-e2e-tests.md`
    - API development: `.claude/$BACKEND/skills/api-development/SKILL.md`
  - **Status file**: `BACKEND_E2E_STATUS.md`
  - **Completion promise**: `BACKEND_E2E_COMPLETE`

### Backend E2E Checks

```yaml
backend-e2e:
  stack: $BACKEND
  trigger: "Phase 5a (generate tests), Phase 5b (implement), Phase 8c (fix failures)"
  skill: .claude/$BACKEND/guides/workflow-generate-e2e-tests.md
  checks:
    - tests_compile: "All test files compile without errors?"
    - tests_pass: "All backend API e2e tests pass?"
    - crud_coverage: "Each entity has full CRUD test cycle?"
    - auth_coverage: "Protected routes tested with valid/invalid/missing tokens?"
    - error_coverage: "400, 401, 403, 404 responses tested?"
  per_item: each controller/module test file
  completion_promise: "BACKEND_E2E_COMPLETE"
  notes: |
    In Phase 5a: generates test cases BEFORE implementation (RED state).
    In Phase 5b: implements code to pass tests (GREEN state).
    In Phase 5c: refactors code while keeping tests green.
    In Phase 8c: fixes any failures found during full suite execution.
```

---

## Phase Completion — Status Update

**Status updates are handled AUTOMATICALLY by the gate script (`_gate-runner.sh`).**

When the blueprint's `gate` deterministic node runs `bash gates/backend-gate.sh`, the gate-runner:
- Updates Progress Table (Status, Score, Output, Gate Run At)
- Updates Gate Results section with check details
- Writes gate proof file to `.gate-proofs/backend.proof`
- Appends to Execution Log
- Updates `last_run` and `pipeline_score` in Config

The blueprint's `verify-gate-proof` node confirms the gate ran. **No manual status updates needed.**
