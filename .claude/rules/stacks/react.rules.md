# React Stack Rules

## Project Structure (MANDATORY)

- **MUST follow** the file organization defined in `.claude/react/docs/file-organization.md` — this is the single source of truth for frontend folder structure
- Vite + React + TypeScript + Tailwind CSS v4
- Source directory: `app/` (NOT `src/`)
- Import alias: `~/` mapped to `app/` (NOT `@/`)
- Components in: `app/components/` (organized by type: `ui/`, `atoms/`, `modals/`, `shared/`, `layouts/`, `guards/`)
- Pages in: `app/pages/` (organized by route area)
- Services in: `app/services/` (`httpService.ts` + `httpMethods/` + `httpServices/`)
- Redux slices with async thunks for data fetching (READ ops via `createAsyncThunk` in service files)
- Types in: `app/types/` (one `.d.ts` file per domain)
- Enums in: `app/enums/` (synced from backend + frontend-only)
- Redux in: `app/redux/` (features/ + store/)
- Routes in: `app/routes/` (declarative config files — `auth.routes.ts`, `protected.routes.ts`, `admin.routes.ts`)
- Route aggregator: `app/routes.ts` imports from `app/routes/*.routes.ts` ONLY — NO inline route definitions
- Utils in: `app/utils/` (errorHandler, validations/)
- Contexts in: `app/contexts/`
- Hooks in: `app/hooks/`
- Lib in: `app/lib/` (cn() utility)
- Styles in: `app/styles/` (Tailwind + theme variables)

## Component Organization (MANDATORY)

- `components/ui/` — Shadcn/UI primitives ONLY (lowercase filenames: `button.tsx`, `card.tsx`)
- `components/atoms/` — Custom reusable atomic components (PascalCase: `StatusBadge.tsx`, `LoadingSpinner.tsx`)
- `components/modals/` — All modal/dialog overlay components (PascalCase + Modal suffix: `ConfirmModal.tsx`)
- `components/shared/` — Feature-specific shared components (Navbar, Sidebar, Breadcrumb)
- `components/layouts/` — Layout wrappers only (AdminLayout, ClientLayout, AuthLayout)
- `components/guards/` — Route guards (AuthGuard, AdminGuard, GuestGuard)
- **NEVER** define reusable components inline inside page files — extract to the correct folder

## Service Layer (MANDATORY)

- `services/httpService.ts` — Axios orchestrator (do not modify)
- `services/httpMethods/` — HTTP method factories (get.ts, post.ts, put.ts, delete.ts, patch.ts, interceptors)
- `services/httpServices/` — Domain-specific services (authService.ts, userService.ts, etc.)
- `services/httpServices/` — Domain services with `createAsyncThunk` for READ ops, plain methods for mutations

## Coding Patterns (MANDATORY)

### Component Pattern

- **MUST Read** `.claude/$FRONTEND/docs/component-patterns.md` before writing components
- **MUST Read** `.claude/$FRONTEND/docs/best-practices.md` before writing components — file organization, typed props
- **MUST Read** `.claude/$FRONTEND/docs/common-patterns.md` before writing forms — mandatory React Hook Form + Zod + shadcn pattern
- Function components ONLY (no class components)
- Props interface defined separately with JSDoc comments
- Destructure props in function parameters
- Use Shadcn/UI components from `~/components/ui/` — do NOT create custom equivalents
- All forms MUST use: `react-hook-form` + `zodResolver` + Shadcn `<Form>` components
- Use `cn()` utility from `~/lib/utils` for conditional classNames

### Service Pattern (httpService Architecture)

- **MUST Read** `.claude/$FRONTEND/docs/data-fetching.md` before writing services
- **MUST Read** `.claude/$FRONTEND/docs/api-integration.md` before mapping screens to API endpoints
- **MUST Read** `.claude/$FRONTEND/docs/crud-operations.md` before implementing CRUD operations
- `httpService.ts` is the Axios orchestrator — do NOT modify unless adding global behavior
- `httpMethods/` contains factory functions (get, post, put, delete, patch) — do NOT modify
- `httpMethods/requestInterceptor.ts` — token handled via httpOnly cookies (no manual injection)
- `httpMethods/responseInterceptor.ts` — error handling with `createErrorResponse()`
- Feature services go in `httpServices/` and MUST use `httpMethods` factories (get, post, put, patch, del), NOT raw axios
- READ operations: `createAsyncThunk` defined in service files, consumed by Redux slices via `extraReducers`
- MUTATION operations: direct service calls in components (NO `createAsyncThunk`), use local `useState` for loading

### State Management Pattern

- **MUST Read** `.claude/$FRONTEND/docs/loading-and-error-states.md` before handling async UI — Redux loading/error state patterns
- **Redux** for all server + global state: one slice per domain in `redux/features/`
- Use typed hooks: `useAppDispatch`, `useAppSelector` from `redux/store/hooks.ts`
- **READ ops** → `createAsyncThunk` in service files → `extraReducers` in slices (pending/fulfilled/rejected)
- **MUTATION ops** → direct service calls in components → `dispatch(fetchThunk())` to refresh data
- `createAsyncThunk` MUST NOT appear in slice files — thunks live in service files only
- **React Context** for auth state only: `contexts/AuthContext.tsx` (wraps Redux auth slice)
- **Component useState** for UI-only state: form inputs, modals, toggles, local loading during mutations
- Do NOT use TanStack Query — all data fetching goes through Redux async thunks

### Authentication Pattern

- **MUST Read** `.claude/$FRONTEND/docs/authentication-architecture.md` before implementing auth
- **MUST Read** `.claude/$FRONTEND/docs/authentication.md` before implementing auth flows — project-specific auth strategies
- Auth state managed via Redux slice or Context (project-specific)
- AuthGuard component wraps layouts: `guestOnly` for auth pages, `requiredRole` for protected pages
- On app load: validate session via API, dispatch `loginSuccess` or stay logged out
- `mapToAuthUser()` maps backend user to frontend AuthUser type
- `getHomeRouteForRole()` returns role-specific home route
- NEVER store tokens in localStorage — tokens are in httpOnly cookies

### TypeScript Standards

- **MUST Read** `.claude/$FRONTEND/docs/typescript-standards.md` for full standards
- Strict mode enabled: no implicit `any`, strict null checks
- Use `import type` for type-only imports
- Use `unknown` instead of `any` — add type guards to narrow
- Props interfaces: defined separately, with JSDoc, PascalCase + `Props` suffix
- Event handlers: use specific types (`ChangeEvent<HTMLInputElement>`, NOT `any`)
- Enum pattern: use TypeScript `enum` synced from backend via `~/enums/`

### Route Guard Pattern

- **MUST Read** `.claude/$FRONTEND/docs/auth-guards.md` before writing guards — GuestGuard, AuthGuard, RoleGuard
- **MUST Read** `.claude/$FRONTEND/docs/routing-guide.md` before touching routes — RR7 framework mode, route(), layout(), index()
- Guards in `components/guards/`: `AuthGuard`, `GuestGuard`, `RoleGuard`
- `GuestGuard` — renders `<Outlet />` for unauthenticated users, redirects authenticated
- `AuthGuard` — one-off auth check
- `RoleGuard` — checks required role
- Preferred: inline auth + RBAC in `ProtectedLayout` (single wrapper handles both)
- Use `storageState` pattern for role-based route config

## Styling

- **MUST Read** `.claude/$FRONTEND/docs/styling-guide.md` before styling — Tailwind CSS 4, Shadcn/UI, CSS variables
- Tailwind CSS v4 for all styling
- No CSS-in-JS or styled-components
- Responsive: mobile-first with sm:, md:, lg: breakpoints
- Brand colors defined in Tailwind config
- Use Shadcn/UI design tokens where available

## Naming Conventions

- Components: PascalCase (`UserCard.tsx`)
- Shadcn/UI: lowercase (`button.tsx`, `card.tsx`)
- Pages: PascalCase (`LoginPage.tsx`)
- Services: camelCase + Service (`userService.ts`)
- Redux slices: camelCase + Slice (`userSlice.ts`)
- Types: `.d.ts` per domain (`user.d.ts`)
- Routes: kebab-case (`auth.routes.ts`)
- Enums: kebab-case + .enum (`role.enum.ts`)

## Performance

- **MUST Read** `.claude/$FRONTEND/docs/performance.md` before optimizing components — memoization, preventing re-renders

## Security

- **MUST Read** `.claude/$FRONTEND/docs/security-best-practices.md` before handling user content — XSS prevention, dangerouslySetInnerHTML

## Internationalization

- **MUST Read** `.claude/$FRONTEND/docs/i18n-architecture.md` before adding i18n — react-i18next setup, locale files

## Browser Testing

- **MUST Read** `.claude/$FRONTEND/docs/browser-testing.md` before writing browser tests — UI and API integration testing

## Import Rules

- Use `~/` alias for ALL imports (NOT relative paths like `../../`)
- All imports use single quotes (project standard)
- Import order:
  1. React and React-related
  2. Third-party libraries
  3. Redux hooks and actions
  4. Enums
  5. Components
  6. Utilities
  7. Type imports (grouped with `import type`)
  8. Relative imports (same feature only)
