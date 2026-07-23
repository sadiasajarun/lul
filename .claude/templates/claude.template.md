# {PROJECT_NAME} - Project Configuration

## Overview

**Project**: {PROJECT_NAME}
**Type**: {PROJECT_TYPE}
**Status**: Development
**Version**: 1.0

{PROJECT_DESCRIPTION}

**Key Differentiator**: {KEY_DIFFERENTIATOR}

---

## Behavioral Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## MANDATORY: Submodule Docs Are the Source of Truth

This project uses `.claude/react/` and `.claude/nestjs/` submodules that define **exact** coding patterns. You MUST read the relevant submodule doc BEFORE writing ANY code. Do not generate code from memory or invent your own patterns.

### Path Variable Resolution
The rules files (`.claude/rules/`) use `$FRONTEND` and `$BACKEND` as path variables. Always resolve them as:
- `$FRONTEND` = `react` → e.g., `.claude/$FRONTEND/docs/...` = `.claude/react/docs/...`
- `$BACKEND` = `nestjs` → e.g., `.claude/$BACKEND/guides/...` = `.claude/nestjs/guides/...`

Always resolve these variables before reading any referenced doc path.

### Before Writing Frontend Code

Read these docs (match patterns exactly — same imports, same structure, same variable names):

| Doc | When to Read |
|-----|-------------|
| `.claude/react/docs/file-organization.md` | Before creating ANY file — defines directory structure, `root.tsx`, `routes.ts` |
| `.claude/react/docs/routing-guide.md` | Before touching routes — RR7 framework mode, `route()`, `layout()`, `index()` |
| `.claude/react/docs/component-patterns.md` | Before writing any component |
| `.claude/react/docs/best-practices.md` | Before writing components — file organization, typed props |
| `.claude/react/docs/common-patterns.md` | Before writing forms — mandatory React Hook Form + Zod + shadcn pattern |
| `.claude/react/docs/data-fetching.md` | Before writing services — httpService.ts, httpMethods/, Redux thunk pattern |
| `.claude/react/docs/api-integration.md` | Before mapping screens to API endpoints |
| `.claude/react/docs/crud-operations.md` | Before implementing CRUD — createAsyncThunk for reads, direct calls for mutations |
| `.claude/react/docs/authentication-architecture.md` | Before writing auth — cookie auth, guards, withCredentials |
| `.claude/react/docs/authentication.md` | Before implementing auth flows — project-specific auth strategies |
| `.claude/react/docs/auth-guards.md` | Before writing guards — GuestGuard, AuthGuard, RoleGuard |
| `.claude/react/docs/typescript-standards.md` | Before writing types — strict mode, import type, Props interfaces |
| `.claude/react/docs/styling-guide.md` | Before styling — Tailwind CSS 4, Shadcn/UI, CSS variables |
| `.claude/react/docs/loading-and-error-states.md` | Before handling async UI — Redux loading/error state patterns |
| `.claude/react/docs/performance.md` | Before optimizing components — memoization, preventing re-renders |
| `.claude/react/docs/security-best-practices.md` | Before handling user content — XSS prevention, dangerouslySetInnerHTML |
| `.claude/react/docs/i18n-architecture.md` | Before adding i18n — react-i18next setup, locale files |
| `.claude/react/docs/browser-testing.md` | Before writing browser tests — UI and API integration testing |

### Before Writing Backend Code

Read these docs:

| Doc | When to Read |
|-----|-------------|
| `.claude/nestjs/guides/architecture-overview.md` | Before creating ANY module — 4-layer pattern, base classes, main.ts |
| `.claude/nestjs/guides/best-practices.md` | Before writing any backend code — coding standards, critical rules |
| `.claude/nestjs/guides/nestjs-backend-guide.md` | General NestJS reference — navigation guide linking all detailed guides |
| `.claude/nestjs/guides/routing-and-controllers.md` | Before writing controllers |
| `.claude/nestjs/guides/services-and-repositories.md` | Before writing services |
| `.claude/nestjs/guides/database-patterns.md` | Before writing entities |
| `.claude/nestjs/guides/validation-patterns.md` | Before writing DTOs |
| `.claude/nestjs/guides/authentication-cookies.md` | Before writing auth — JWT, httpOnly cookies, token rotation |
| `.claude/nestjs/guides/setup-role-base-access.md` | Before implementing RBAC — roles, guards, JWT integration |
| `.claude/nestjs/guides/async-and-errors.md` | Before writing async code — async/await patterns, error handling |
| `.claude/nestjs/guides/middleware-guide.md` | Before writing middleware — guards, interceptors, pipes, exception filters |
| `.claude/nestjs/guides/configuration.md` | Before managing config — UnifiedConfig pattern for env/secrets |
| `.claude/nestjs/guides/update-swagger.md` | Before documenting APIs — Swagger decorators, DTO documentation |
| `.claude/nestjs/guides/testing-guide.md` | Before writing tests — Jest patterns, mocking, best practices |
| `.claude/nestjs/guides/sentry-and-monitoring.md` | Before adding monitoring — Sentry v8 error tracking, performance |
| `.claude/nestjs/guides/workflow-convert-prd-to-knowledge.md` | Before converting PRD — structured PROJECT_KNOWLEDGE.md generation |
| `.claude/nestjs/guides/workflow-design-database.md` | Before designing database — TypeORM + PostgreSQL schema design |
| `.claude/nestjs/guides/workflow-generate-api-docs.md` | Before generating API docs — Markdown docs from controllers/DTOs |
| `.claude/nestjs/guides/workflow-generate-e2e-tests.md` | Before generating e2e tests — test generation for controllers |
| `.claude/nestjs/guides/workflow-implement-redis-caching.md` | Before adding caching — Redis with @Cacheable/@CacheInvalidate |

### Key Patterns (Do NOT Deviate)

**Frontend:**
- React Router 7 **framework mode** (NOT library mode, NOT `createBrowserRouter`)
- Entry point: `root.tsx` (NOT `main.tsx`)
- Route config: `routes.ts` with `route()`, `layout()`, `index()` from `@react-router/dev/routes`
- Imports from `react-router` (NOT `react-router-dom`)
- Route protection: inline RBAC in `ProtectedLayout` with `routeAccess` map
- Auth pages: `GuestGuard` renders `<Outlet />` or redirects
- Data fetching: Redux `createAsyncThunk` in service files (NOT TanStack Query)
- Source directory: `app/` (NOT `src/`)
- Import alias: `~/` (NOT `@/`)

**Backend:**
- NestJS 4-layer: Controller → Service → Repository → Entity
- ALL layers extend base classes from `src/core/base/`
- Guards, decorators, filters in `src/core/` (NOT inside feature modules)
- JWT via httpOnly cookies (NEVER localStorage)
- Repository pattern via TypeORM (NEVER query directly in services)

### Doc Reading Enforcement (MANDATORY)

**NEVER generate code from memory.** You MUST read the referenced submodule doc using the Read tool and match its patterns EXACTLY before writing any code.

Process:
1. Read the doc file with the Read tool (NOT from your training data)
2. Extract the specific class names, import paths, decorators, and file structures it defines
3. Use THOSE exact patterns in your code — not what you "know" about NestJS or React in general

**Anti-patterns (these indicate you skipped reading the docs):**
- Using `createBrowserRouter` or `<BrowserRouter>` → doc says: framework mode with `route()`
- Using `@/` imports → doc says: `~/`
- Using `src/` as source dir → doc says: `app/`
- Putting guards inside feature modules → doc says: `src/core/`
- Using TanStack Query → doc says: Redux `createAsyncThunk`
- Using `react-router-dom` → doc says: `react-router`
- Creating `main.tsx` entry point → doc says: `root.tsx`
- Writing raw axios calls → doc says: use `httpMethods/` factories
- Skipping base class extension → doc says: ALL layers extend base classes

If you find yourself writing code that matches any anti-pattern above, STOP — you are generating from memory, not from the docs. Read the doc and correct your code.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | {BACKEND} |
| Frontend | {FRONTEND} |
| Admin Dashboard | {ADMIN_DASHBOARD} |
| Database | {DATABASE} |
| ORM | {ORM} |
| Authentication | {AUTH} |
| Deployment | {DEPLOYMENT} |

---

## Project Structure

```
{PROJECT_NAME}/
├── backend/                      # {BACKEND} API
│   ├── src/
│   │   ├── core/                # Base classes, guards, decorators, filters
│   │   │   ├── base/            # BaseEntity, BaseRepository, BaseService, BaseController
│   │   │   ├── decorators/      # @Public(), @Roles(), @CurrentUser()
│   │   │   ├── guards/          # JwtAuthGuard, RolesGuard
│   │   │   ├── filters/         # HttpExceptionFilter
│   │   │   ├── interceptors/    # TransformInterceptor, LoggingInterceptor
│   │   │   └── pipes/           # ValidationPipe
│   │   ├── modules/             # Feature modules (entity, repo, service, controller, module)
│   │   ├── infrastructure/      # External services (mail, s3, token, logging)
│   │   └── database/            # Migrations, seeds
│   └── test/                    # E2E tests
├── frontend/                    # {FRONTEND} user application
│   └── app/                     # Source directory (NOT src/)
│       ├── components/          # ui/, atoms/, modals/, shared/, layouts/, guards/
│       ├── pages/               # Route pages
│       ├── services/            # httpService.ts, httpMethods/, httpServices/
│       ├── redux/               # features/, store/
│       ├── types/               # .d.ts per domain
│       ├── enums/               # Synced from backend
│       ├── contexts/            # AuthContext
│       ├── hooks/               # Custom hooks
│       ├── lib/                 # cn() utility
│       ├── utils/               # errorHandler, validations/
│       └── styles/              # Tailwind + theme variables
├── frontend-admin-dashboard/    # Admin dashboard
├── .claude/                     # Claude Code configuration + submodule docs
├── .claude-project/             # Project documentation
└── docker-compose.yml           # Docker configuration
```

---

## Git Rules

- Branch from `dev`, PR to `dev`, never push directly to `main`
- Branch naming: `feature/<name>`, `fix/<name>`, `chore/<name>`
- Commit messages: imperative mood, concise, reference ticket if exists

---

## User Roles

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| Guest | Unauthenticated visitor | View public pages, Login, Signup |
| {ROLE_1} | {ROLE_1_DESCRIPTION} | {ROLE_1_PERMISSIONS} |
| {ROLE_2} | {ROLE_2_DESCRIPTION} | {ROLE_2_PERMISSIONS} |
| Admin | Platform administrator | {ADMIN_PERMISSIONS} |

---

## Core Enums

| Enum | Values |
|------|--------|
| RoleEnum | {ROLE_ENUM_VALUES} |
| UserStatusEnum | `active`, `suspended` |

---

## Key Documentation

| Document | Path | Description |
|----------|------|-------------|
| Project Knowledge | [.claude-project/docs/PROJECT_KNOWLEDGE.md](.claude-project/docs/PROJECT_KNOWLEDGE.md) | Core project info, features, roles |
| API Documentation | [.claude-project/docs/PROJECT_API.md](.claude-project/docs/PROJECT_API.md) | API endpoints and specifications |
| Database Schema | [.claude-project/docs/PROJECT_DATABASE.md](.claude-project/docs/PROJECT_DATABASE.md) | Entity definitions and relationships |
| API Integration | [.claude-project/docs/PROJECT_API_INTEGRATION.md](.claude-project/docs/PROJECT_API_INTEGRATION.md) | Frontend-backend integration |

### Status Tracking

| Status File | Path |
|-------------|------|
| Backend API Status | [.claude-project/status/backend/API_IMPLEMENTATION_STATUS.md](.claude-project/status/backend/API_IMPLEMENTATION_STATUS.md) |
| Frontend Screens | [.claude-project/status/frontend/SCREEN_IMPLEMENTATION_STATUS.md](.claude-project/status/frontend/SCREEN_IMPLEMENTATION_STATUS.md) |
| Frontend API Integration | [.claude-project/status/frontend/API_INTEGRATION_STATUS.md](.claude-project/status/frontend/API_INTEGRATION_STATUS.md) |

### Memory (Persistent Context)

| File | Purpose |
|------|---------|
| [DECISIONS.md](.claude-project/memory/DECISIONS.md) | Architecture decisions log |
| [LEARNINGS.md](.claude-project/memory/LEARNINGS.md) | Patterns and insights |
| [PREFERENCES.md](.claude-project/memory/PREFERENCES.md) | Coding style preferences |

---

## API Base URLs

| Environment | URL |
|-------------|-----|
| Development | `http://localhost:3000/api` |
| Staging | `https://staging.{PROJECT_DOMAIN}/api` |
| Production | `https://api.{PROJECT_DOMAIN}/api` |

---

## Authentication Flow

- JWT via httpOnly cookies (NEVER localStorage)
- Access Token: 1 hour expiry
- Refresh Token: 7 days expiry
- Cookie config: `httpOnly: true, secure: true, sameSite: 'strict'`

---

## Development Conventions

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Components | PascalCase | `UserProfile.tsx` |
| Shadcn/UI | lowercase | `button.tsx`, `card.tsx` |
| Pages | PascalCase | `LoginPage.tsx` |
| Services | camelCase + Service | `userService.ts` |
| Redux slices | camelCase + Slice | `userSlice.ts` |
| Types | `.d.ts` per domain | `user.d.ts` |
| Entities | kebab-case | `user.entity.ts` |
| DTOs | PascalCase | `CreateUserDto` |
| Enums | kebab-case + .enum | `role.enum.ts` |
| Routes | kebab-case | `auth.routes.ts` |

### Import Rules (Frontend)

- Use `~/` alias for ALL imports (NOT `@/`, NOT relative paths like `../../`)
- All imports use single quotes
- Import order:
  1. React and React-related
  2. Third-party libraries
  3. Redux hooks and actions
  4. Enums
  5. Components
  6. Utilities
  7. Type imports (grouped with `import type`)
  8. Relative imports (same feature only)

### TypeScript Guidelines

- Strict mode enabled — no implicit `any`, strict null checks
- Use `import type` for type-only imports
- Use `unknown` over `any` — add type guards to narrow
- Props interfaces: defined separately, with JSDoc, PascalCase + `Props` suffix

---

## Design System

### Primary Color
- **{PRIMARY_COLOR_NAME}**: {PRIMARY_COLOR_HEX}

---

## Available Commands

| Command | Description |
|---------|-------------|
| `/commit` | Smart git commit with branch and PR management |
| `/pull` | Pull latest changes for all submodules |
| `/fullstack <project>` | Build any product from idea to deployment with infinite iteration loops |
| `/new-project <name>` | Create complete new project with Claude config |

---

## Enabled MCP Servers

- **sequential-thinking** - Step-by-step reasoning
- **playwright** - Browser automation and E2E testing

---

*Last Updated: {DATE}*
