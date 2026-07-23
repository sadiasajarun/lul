# Backend Phase Rules

## Architecture (MANDATORY)

- **MUST follow** the architecture defined in `.claude/$BACKEND/guides/architecture-overview.md`
- **MUST use** `.claude/$BACKEND/skills/api-development/SKILL.md` when creating modules
- Follow NestJS 4-layer pattern: Controller -> Service -> Repository -> Entity
- ALL layers MUST extend Base Classes from `src/core/base/`
- Every controller method must have Swagger decorators (@ApiTags, @ApiOperation, @ApiResponse) ✅ gate: `swagger-all-controllers`
- Use class-validator decorators on all DTOs ✅ gate: `class-validator-usage`
- Repository pattern via TypeORM — never query directly in services

## Directory Structure (MANDATORY)

- Guards, decorators, filters, interceptors, pipes MUST be in `src/core/` — NOT inside feature modules
- Each feature module in `src/modules/{feature}/` MUST have:
  - `{feature}.entity.ts` — extends BaseEntity
  - `{feature}.repository.ts` — extends BaseRepository
  - `{feature}.service.ts` — extends BaseService
  - `{feature}.controller.ts` — extends BaseController
  - `{feature}.module.ts` — NestJS module
  - `dtos/` — DTOs folder (plural `dtos/`, NOT `dto/`)
- External services in `src/infrastructure/` (mail, s3, token, logging)
- Violation of this structure = backend-gate FAIL

## Base Classes (MANDATORY)

- Entity: `extends BaseEntity` from `src/core/base/base.entity.ts`
- Repository: `extends BaseRepository<Entity>` from `src/core/base/base.repository.ts`
- Service: `extends BaseService<Entity>` from `src/core/base/base.service.ts`
- Controller: `extends BaseController<Entity, CreateDto, UpdateDto>` from `src/core/base/base.controller.ts`
- Creating modules WITHOUT extending base classes is prohibited

## Code Quality

- No raw SQL queries — use TypeORM QueryBuilder or repository methods
- Every endpoint must handle: 400 (validation), 401 (unauth), 403 (forbidden), 404 (not found) ✅ gate: `nestjs-error-handling`
- Use proper HTTP status codes (201 for creation, 204 for deletion)
- DTOs must validate all user input with class-validator
- Avoid `as unknown as` unsafe type casting ✅ gate: `no-unsafe-cast` (threshold: 3)

## Auth Security Checklist ✅ gate: `httponly-refresh-token`, `no-jwt-secret-fallback`, `logout-uses-remove-token-interceptor`

- **refreshToken**: Must be delivered as `httpOnly: true, sameSite: 'strict', secure: true` cookie. Returning in JSON body is prohibited
- **JWT_SECRET**: When environment variable is missing, `throw new Error('JWT_SECRET is required')`. Fallback strings (`|| 'default'`) are strictly prohibited
- **Logout**: `@Public()` decorator + MUST use `@UseInterceptors(RemoveTokenInterceptor)` — manual `res.clearCookie()` in controller is prohibited. Must be able to logout with expired token
- **Token Rotation**: On refresh, delete previous refreshToken from DB before issuing new one

### RULE-B8: Role representation must reconcile numeric ↔ name (v114) ✅ gate: enforced by `scaffold-rolesguard-coerce-doctor` + `scaffold-jwt-role-nullish-doctor`

The DB/PRD use NUMERIC roles (`role SMALLINT`, e.g. `0=foreign_worker, 1=company_staff, 2=company_lead, 10=operator, 99=super_admin`). Two bugs follow if this isn't handled:

- **Falsy-zero JWT role (PROHIBITED):** building the token payload as `role: user.role || 'default'` turns `foreign_worker` (role `0`) into `'default'` because `0 || x === x` in JS. Login succeeds, then EVERY worker request 403s. Use `role: user.role ?? defaultRole` (nullish), NEVER `||`, for any field whose valid value can be `0`.
- **RolesGuard must reconcile numeric ↔ string:** the JWT carries the numeric role but `@Roles()` decorators may use the NAME (`@Roles('foreign_worker')`). A plain `String(userRole) === String(requiredRole)` can't bridge `"0"` to `"foreign_worker"` → 403 on every name-only-guarded endpoint. The guard MUST map every form to a canonical role (number↔name table derived from the PRD discriminator) before comparing, so `@Roles('foreign_worker')` AND `@Roles('0')` both match a user with role `0`.

Violation: worker/role-guarded stories fail with 403 even though login returns 200.

## Testing

- Generate at least one e2e test per endpoint (Phase 5b)
- Test files go in: backend/test/e2e/{module}.e2e-spec.ts
- Use Jest + Supertest for API testing
- Test happy path + auth + validation + not-found for each endpoint

## API Response Contract ✅ promoted from GP-004 (9 instances)

### RULE-B1: TypeORM Field Mapping Required

<!-- Why: Frontend displayed "undefined" or wrong values because backend returned raw
     TypeORM entities with snake_case columns and nested relation counts. Frontend
     expected camelCase fields and flattened count properties.
     Pattern: GP-004 — Missing Computed Fields
     Ref: bug-patterns-global.yaml (multiple projects) | prompt-templates.md → GP-004
     Instances: 9+ projects -->

- When service methods return TypeORM entities to the frontend, ensure proper field mapping
- Must return explicit mapping objects when needed:
  - snake_case -> camelCase: `created_at -> createdAt`, `updated_at -> updatedAt`
  - Count relations -> flatten to direct property: `_count.projects -> projectsCount`
  - Missing computed fields prohibited: `membersCount`, `projectsCount`, `screensCount`, etc.

### RULE-B2: Missing Computed Fields Prohibited

<!-- Why: Frontend type interfaces declared fields like projectsCount and membersCount,
     but backend returned entities without those computed values. Agent used hardcoded
     placeholders (projectsCount: 0) instead of actual TypeORM count queries, so
     dashboards always showed zero.
     Pattern: GP-004 — Missing Computed Fields (placeholder variant)
     Ref: agent-learnings → LRN-005 (kpi_data_integrity-001) -->

- If a field is defined in frontend types (TypeScript interface), backend must return it
- Hardcoded placeholders like `projectsCount: 0` prohibited — use actual TypeORM count queries
- Violation: backend-gate FAIL

## Seed Data

### RULE-B3: Seed Script Required ✅ gate: `seed-script-exists`, `seed-script-registered`

<!-- Why: Without seed data, all Phase 9 browser tests silently skipped (D-01 variant) —
     no users to log in with, no projects to display. Agent hardcoded test credentials
     that diverged from _fixtures.yaml, causing global-setup.ts to fail.
     Pattern: D-01 — Silent Pass (seed data gap)
     Ref: backend-gate.sh → checks 17-18 (seed script validation) -->

- Seed script is a required deliverable upon backend phase completion
- Read `.claude-project/user_stories/_fixtures.yaml` users section and create DB users with those credentials (Single Source of Truth)
- Hardcoding email/password in seed script is prohibited — must parse \_fixtures.yaml
- Minimum data to create:
  a) All users defined in \_fixtures.yaml (bcrypt hashed password)
  b) Related Organization, Project (minimum data needed for user story testing)
- Idempotency required: upsert or findOne -> skip if exists, create if not
- Violation: backend-gate FAIL

## Environment Setup (MANDATORY) ✅ gate: `backend-env-example`

### RULE-B4: .env.example Must Derive from PROJECT_KNOWLEDGE.md

<!-- Why: Agent grepped code for process.env.* and built .env.example from that, but
     missed env vars for planned-but-not-yet-coded services (S3, mail, Redis).
     Deployment failed because required vars were absent from .env.example.
     Pattern: Incomplete env — code grep misses planned infrastructure
     Ref: backend-gate.sh → backend-env-example check -->

- **BEFORE writing `.env.example`**, read `.claude-project/docs/PROJECT_KNOWLEDGE.md` environment variables section — this is the **primary source of truth** for all required env vars
- **THEN** read `.claude/$BACKEND/guides/configuration.md` for correct **naming format** (quoted strings, human-readable time formats like `1h`, `7d`)
- **THEN** cross-reference with actual code (`process.env.*`, `configService.get()`) for exact variable names
- `.env.example` must include vars for ALL planned infrastructure even if not yet implemented in code
- Code-only grep (`process.env.*`) is insufficient — it misses planned services with empty placeholder modules
- Violation: backend-gate FAIL

## Infrastructure Services (MANDATORY) ✅ gate: `infrastructure-implemented`, `file-upload-capability`

### RULE-B5: Infrastructure Modules Must Be Implemented

<!-- Why: Agent created infrastructure/ directories with .gitkeep files but no actual
     service implementations. The attachment controller accepted metadata (title,
     description) but had no FileInterceptor — uploads silently did nothing.
     Pattern: Hollow infrastructure — directories exist but contain no real code
     Ref: backend-gate.sh → infrastructure-implemented check -->

- All infrastructure services mentioned in PRD/PROJECT_KNOWLEDGE.md MUST be implemented
- At least 2 of the `infrastructure/` subdirectories MUST contain actual .ts files (not just .gitkeep)
- Infrastructure services MUST use generic interface + adapter pattern (e.g., `IFileStorageService` with S3/Local adapters)
- Metadata-only APIs (attachment controller without FileInterceptor/UploadedFile) are prohibited
- Violation: backend-gate FAIL

### RULE-B6: File Upload Must Use Real Storage

<!-- Why: Attachment module existed with full CRUD endpoints but only stored metadata
     in the database. No actual file was uploaded or stored — the controller lacked
     FileInterceptor and @UploadedFile() decorators. Users could "attach" files
     that were never persisted anywhere.
     Pattern: Metadata-only API — endpoint exists but core functionality is missing
     Ref: backend-gate.sh → file-upload-capability check -->

- When an attachment module exists, a FileStorageService or equivalent storage service MUST be implemented
- Controller MUST use `FileInterceptor` and `@UploadedFile()` decorators
- Service MUST inject a storage adapter and handle upload/delete/presignedUrl operations
- Violation: backend-gate FAIL

## WebSocket Gateway (CONDITIONAL) ✅ gate: `websocket-gateway-exists`, `websocket-handlers-exist`, `websocket-auth`

### RULE-B7: WebSocket Gateway Required When PRD Specifies Real-Time

<!-- Why: PRD specified real-time Kanban board updates but agent only built REST APIs.
     When one user moved a card, other users didn't see it until page refresh.
     The feature was listed in PRD but agent skipped it because REST was "sufficient."
     Pattern: C-04 — Missing PRD Features (real-time variant)
     Ref: backend-gate.sh → websocket-gateway-exists, websocket-auth checks -->

- If PRD mentions real-time updates, live data, push notifications, or WebSocket — a `@WebSocketGateway` MUST be implemented
- Gateway MUST have at least one `@SubscribeMessage` event handler
- Gateway MUST authenticate connections via httpOnly cookie JWT extraction in `handleConnection()`
- Gateway file location: `src/modules/{feature}/{feature}.gateway.ts`
- Gateway is registered as a **provider** in the feature module (not a controller)
- Read `.claude/$BACKEND/guides/websocket-gateway.md` for implementation patterns
- Violation: backend-gate FAIL (conditional — only checked when PRD has real-time requirements)

## Scope Guard

- ONLY modify files under: backend/src/
- ONLY create test files under: backend/test/
- Do NOT create or modify frontend files during this phase
- Do NOT modify design files or HTML prototypes
- Do NOT change entity files unless fixing a bug discovered during API implementation
