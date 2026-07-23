# Phase 6: Frontend (HTML-to-React Conversion)

Phase 6 receives validated HTML from Phase 3 (design) and converts it to React components. No design decisions are made here -- this is purely a conversion phase. It runs in parallel with Phase 5 (backend) since frontend depends on design while backend depends on database.

## Prerequisites

- Phase 3 (design) complete

## CRITICAL: File Organization (MANDATORY)

Before creating ANY files, Read `.claude/$FRONTEND/docs/file-organization.md` and follow its folder structure EXACTLY:

- Source directory: `app/` (NOT `src/`)
- Import alias: `~/` mapped to `app/` (NOT `@/`)
- Components: `app/components/` organized by type (`ui/`, `atoms/`, `modals/`, `shared/`, `layouts/`, `guards/`)
- Pages: `app/pages/` organized by route area
- Services: `app/services/` (`httpService.ts` + `httpMethods/` + `httpServices/`)
- Query hooks: `app/services/httpServices/queries/`
- Types: `app/types/` (one `.d.ts` file per domain)
- Enums: `app/enums/`
- Redux: `app/redux/` (features/ + store/)
- Routes: `app/routes/` (declarative config files)
- Utils: `app/utils/`
- Contexts: `app/contexts/`
- Hooks: `app/hooks/`
- Lib: `app/lib/`
- Styles: `app/styles/`

**Violation of this structure = frontend-gate FAIL**

## Execution

### Step 6.1: Locate and READ HTML Source Files (or detect absence)

```
1. Check for HTML source files:
   Path: ./.claude-project/generated-screens/{project}/ or .claude-project/design/html/ or HTML/

   TWO MODES — determined by whether HTML prototypes exist:

   === MODE A: HTML EXISTS ===
   If HTML files found:
   a. Read EVERY HTML file completely using the Read tool (entire file, not skim)
   b. For each HTML file, extract and record in .claude-project/docs/HTML_STRUCTURE_INVENTORY.md:
      - Semantic structure (root container, layout type, major sections)
      - ALL content text verbatim (titles, headings, button labels, placeholders, link text)
      - ALL CSS values from <style> blocks (padding, margin, border-radius, font-size, box-shadow, colors)
      - ALL interactive elements (forms with field types, buttons with labels, toggles, checkboxes)
      - Commonly-missed elements: OAuth buttons, dividers, password toggles, terms checkboxes, input icons
   c. HTML_STRUCTURE_INVENTORY.md becomes the conversion checklist for Step 6.4

   >>> CHECKPOINT (MANDATORY before Step 6.2):
   === HTML READING CHECKPOINT ===
   HTML files found: [count]
   HTML files read completely: [count — MUST equal found]
   HTML_STRUCTURE_INVENTORY.md written: [yes/no — MUST be yes]
   Sample — first HTML file:
     Page title text: [exact text from HTML]
     Number of buttons: [count with labels]
     Main container classes: [exact classes from HTML]
   === END HTML READING CHECKPOINT ===
   ❌ If files read != files found, read missing files NOW.
   ❌ If any sample field is blank, you did NOT read the HTML. Go back and read it.

   === MODE B: NO HTML ===
   If no HTML files found:
   a. Read PROJECT_KNOWLEDGE.md for features, user flows, roles
   b. Read DESIGN_SYSTEM.md for colors, typography, spacing tokens (if exists)
   c. Agent designs pages from scratch using PRD/KNOWLEDGE as source of truth
   d. Skip HTML_STRUCTURE_INVENTORY.md — not needed
   e. Proceed to Step 6.2
```

### Step 6.2: Load Conversion Skill and Coding Guides

```
2. Load skill and coding guides (MUST Read before writing code):
   a. .claude/$FRONTEND/skills/converters/html-to-react-converter.md (conversion rules)
   b. .claude/$FRONTEND/docs/file-organization.md (folder structure — single source of truth)
   c. .claude/$FRONTEND/docs/component-patterns.md (component coding patterns)
   d. .claude/$FRONTEND/docs/data-fetching.md (httpService + httpMethods architecture)
   e. .claude/$FRONTEND/docs/typescript-standards.md (TypeScript strict mode, type safety)
   f. .claude/$FRONTEND/docs/authentication-architecture.md (auth flow, guards, role-based access)
   g. .claude/$FRONTEND/docs/routing-guide.md (route config patterns)

   Follow ALL coding patterns from these guides:
   - Components: function components + Shadcn/UI + react-hook-form + zod
   - Services: httpService architecture (httpMethods/ factories, NOT raw axios)
   - State: Redux slices (createAsyncThunk for READ ops, direct service calls for mutations) + Context (auth only)
   - Types: .d.ts per domain, import type, no any
   - Imports: ~/alias, single quotes, ordered by category

   >>> CHECKPOINT (MANDATORY before writing ANY code):
   === FRONTEND PATTERN CHECKPOINT ===
   From file-organization.md:
   - Source directory: [what you read]
   - Import alias: [what you read]
   - Component directories: [what you read]
   From routing-guide.md:
   - Router mode: [what you read]
   - Route config function: [what you read]
   - Entry point file: [what you read]
   From data-fetching.md:
   - Data fetching approach: [what you read]
   - HTTP service architecture: [what you read]
   From component-patterns.md:
   - Form library pattern: [what you read]
   - UI component library: [what you read]
   === END FRONTEND PATTERN CHECKPOINT ===
   ❌ If any field is blank, re-read the guide. Do NOT proceed with blank fields.
   ❌ Do NOT fill from memory — fill ONLY from what you just read.

   VALIDATION — these answers indicate you read from memory instead of docs:
   - If Router mode = "library mode" or "SPA mode with createBrowserRouter" → WRONG. Re-read routing-guide.md.
   - If Route config function = "createBrowserRouter" → WRONG. Re-read routing-guide.md.
   - If Entry point file = "main.tsx" or "App.tsx" → WRONG. Re-read routing-guide.md.
   - If Data fetching = "TanStack Query" or "React Query" → WRONG. Re-read data-fetching.md.
   - If Source directory = "src/" → WRONG. Re-read file-organization.md.
   - If Import alias = "@/" → WRONG. Re-read file-organization.md.
```

### Step 6.3: Extract Shared Components (Follow file-organization.md)

```
3. Extract shared components following file-organization.md structure:
   a. Navbar HTML -> app/components/shared/ClientNavbar.tsx (or AdminSidebar.tsx)
   b. Footer HTML -> app/components/layouts/footer.tsx
   c. Sidebar HTML -> app/components/shared/AdminSidebar.tsx
   d. Create Layout wrappers in app/components/layouts/ (AdminLayout, ClientLayout, AuthLayout)
   e. Create route guards in app/components/guards/ (AuthGuard, AdminGuard, GuestGuard)
   f. Small reusable UI -> app/components/atoms/ (LoadingSpinner, EmptyState, StatusBadge)
   g. Shadcn/UI primitives -> app/components/ui/ (lowercase filenames)
   h. Modals -> app/components/modals/ (PascalCase + Modal suffix)
```

### Step 6.4: Build Page React Components

```
4. TWO MODES — depends on Step 6.1 result:

   === MODE A: HTML EXISTS (HTML_STRUCTURE_INVENTORY.md was created) ===
   For each page HTML, convert using MANDATORY workflow:
   a. Open HTML_STRUCTURE_INVENTORY.md — locate the section for this page
   b. Re-read the actual HTML file using Read tool (see full structure again)
   c. Extract <main> content from HTML
   d. Convert to JSX (class->className, for->htmlFor, etc.)
   e. Use EXACT CSS values from inventory using Tailwind arbitrary values [Xpx] (RULE-F8)
   f. Include ALL content text from inventory verbatim — character-for-character (RULE-F7)
   g. Include ALL interactive elements from inventory (forms, buttons, toggles, icons)
   h. Include ALL "Missing Element Traps" items from inventory (OAuth buttons, dividers, checkboxes)
   i. Create page component with proper imports
   j. Add to React Router route config

   SELF-CHECK after each page (MANDATORY):
   === PAGE FIDELITY CHECK: {filename} ===
   Inventory text items: [count] → React text items: [count]
   Inventory interactive elements: [count] → React elements: [count]
   Missing items: [list any — fix NOW before next page]
   === END PAGE CHECK ===

   === MODE B: NO HTML (designing from PRD) ===
   For each page defined in PROJECT_KNOWLEDGE.md:
   a. Read the feature description and user flow from PROJECT_KNOWLEDGE.md
   b. Design page layout following styling-guide.md and component-patterns.md
   c. Include all features, forms, and interactions described in the PRD
   d. Use design system tokens from DESIGN_SYSTEM.md (if exists) or sensible defaults
   e. Include proper loading, error, and empty states
   f. Create page component with proper imports
   g. Add to React Router route config
```

### Step 6.5: Set Up React Router (Framework Mode — MUST follow routing-guide.md)

```
5. ⚠️ STOP — Re-read .claude/$FRONTEND/docs/routing-guide.md NOW using Read tool.
   ⚠️ STOP — Re-read .claude/$FRONTEND/docs/auth-guards.md NOW using Read tool.

   >>> ROUTING CHECKPOINT (MANDATORY — do NOT write any routing code until filled):
   === ROUTING PATTERN CHECKPOINT ===
   From routing-guide.md (MUST be from the file you just read, NOT memory):
   - Package name: [must be 'react-router', NOT 'react-router-dom']
   - Route config location: [must be 'routes.ts']
   - Route helper imports: [must be from '@react-router/dev/routes']
   - Route helper functions: [must be route(), layout(), index()]
   - Config file: [must be 'react-router.config.ts']
   - Vite plugin: [must be reactRouter() from '@react-router/dev/vite']
   - Entry point: [must be 'root.tsx', NOT 'main.tsx']
   From routing-guide.md (route splitting):
   - Route files location: [must be 'app/routes/*.routes.ts']
   - routes.ts role: [must be 'aggregator only — import from routes/*.routes.ts']
   - Protected routes type: [must be 'RouteConfigEntry' with layout() wrapper]
   - Auth routes type: [must be exported array]
   From auth-guards.md:
   - Protected layout pattern: [must have routeAccess RBAC map]
   - Auth layout pattern: [must delegate to GuestGuard]
   - Guard imports from: [must be 'react-router', NOT 'react-router-dom']
   === END ROUTING PATTERN CHECKPOINT ===

   ❌ ANTI-PATTERNS — if you write ANY of these, the gate WILL FAIL:
   - createBrowserRouter → GATE FAIL (no-createBrowserRouter)
   - import from 'react-router-dom' → GATE FAIL (no-react-router-dom)
   - Missing react-router.config.ts → GATE FAIL (react-router-config-exists)
   - Missing ProtectedLayout routeAccess → GATE FAIL (protected-layout-rbac)
   - Using @/ imports → GATE FAIL (import-alias-tilde)
   - Using src/ directory → GATE FAIL (source-dir-app)
   - Empty routes/ folder (no *.routes.ts files) → GATE FAIL (route-files-split)
   - Inline route()/index() calls in routes.ts (>2) → GATE FAIL (no-inline-routes)
     routes.ts is an AGGREGATOR ONLY — define routes in routes/*.routes.ts, import in routes.ts

   Set up React Router 7 framework mode routes following .claude/$FRONTEND/docs/routing-guide.md EXACTLY:
   a. Create react-router.config.ts (ssr: false for SPA mode)
   b. Update vite.config.ts to use reactRouter() plugin from @react-router/dev/vite
   c. Create app/root.tsx (replaces main.tsx + index.html — provides Redux Provider + AuthProvider)
   d. Create app/routes.ts using route(), layout(), index() from @react-router/dev/routes
   e. Create app/routes/auth.routes.ts (guest-only routes: login, signup, forgot-password)
   f. Create app/routes/protected.routes.ts (auth+RBAC routes wrapped in ProtectedLayout)
   g. Create app/pages/auth/layout.tsx (GuestGuard + auth page styling)
   h. Create app/components/layouts/ProtectedLayout.tsx (auth check + routeAccess RBAC map)
   i. Create app/pages/redirect-home.tsx (root / redirect based on auth state)
   j. Create app/pages/not-found.tsx (404 catch-all)
   k. Map HTML page slugs to route() entries:
      01-landing.html -> index('pages/redirect-home.tsx')
      02-login.html -> route('login', 'pages/auth/LoginPage.tsx')
      03-dashboard.html -> route('dashboard', 'pages/protected/DashboardPage.tsx')
      etc.
   l. Delete main.tsx, App.tsx, index.html (replaced by framework mode)
   m. All imports use 'react-router' (NOT 'react-router-dom')

   CRITICAL: Do NOT use JSX <Routes>/<Route> or BrowserRouter — use declarative route() config only.
```

### Step 6.6: Design Fidelity Verification (MANDATORY — Primary Gate)

**This is the primary quality check for Phase 6. It is NOT optional.**

```
6. Invoke agentic node `design-fidelity-check` (blueprint: .claude/blueprints/frontend.yaml)
   Skill: .claude/react/skills/qa/design-qa-html.md

   The skill:
   - Reads every HTML prototype from .claude-project/design/html/
   - Maps to corresponding React TSX in frontend/src/pages/
   - Compares by 6 categories (Layout 25%, Spacing 20%, Typography 20%, Colors 15%, Effects 10%, Components 10%)
   - Also compares Korean text tokens + structural element counts
   - Writes DESIGN_FIDELITY_REPORT.md with avg_fidelity, min_fidelity, per-page scores, fix suggestions

   Post-check `verify-fidelity-artifact` (deterministic) then confirms the artifact exists.
   Gate `design-fidelity` in frontend-gate.sh parses the artifact and checks:
     - avg_fidelity >= 0.95
     - min_fidelity >= 0.85
   If the skill is not invoked → artifact missing → gate FAILS.
   If scores below threshold → gate FAILS with list of failing pages.

   This replaces the previous file-count-only check that allowed 20%-complete
   React pages to pass Phase 6.
```

### Step 6.7: i18n Setup (When PRD Requires Multilingual Support)

```
7. If PRD requires internationalization (i18n / multilingual / EN+KO / react-i18next):
   a. Create src/i18n.ts — i18next.use(initReactI18next).init({ lng, resources, ... })
   b. Create public/locales/en/translation.json with all UI string keys
   c. Create public/locales/ko/translation.json with all UI string keys (Korean values)
   d. Import i18n.ts in root.tsx (or wrap root with I18nextProvider in root.tsx)
   e. In every page component: import { useTranslation } from 'react-i18next'
      Replace all hardcoded UI strings with t('key') calls
   f. Coverage check: every visible UI text string must go through a t() call
      (nav labels, headings, buttons, placeholders, error messages, tooltips)
   Note: Installing react-i18next in package.json alone is NOT sufficient.
         The gate requires init file + locale files + useTranslation in ≥5 components.
```

### Step 6.8: Runtime Verification (MANDATORY — DO NOT SKIP)

⚠️ This step prevents the #1 frontend failure: pages with mock/hardcoded data instead of real API connections.

```
1. Build check:
   cd frontend && npm run build
   → MUST succeed (exit 0). If fails: fix TypeScript/build errors.

2. Mock data detection:
   grep -r "mock\|Mock\|MOCK\|hardcoded\|fakeDat\|sampleDat\|dummyDat" frontend/app/pages/ --include="*.tsx" -l
   → MUST return 0 files. If > 0: pages contain mock data that must be replaced with real API calls.

3. API connection verification:
   For each page in frontend/app/pages/ that displays data:
   a. File MUST import from services/httpServices/ or redux/
   b. File MUST use useAppDispatch + useAppSelector for READ data (Redux thunks)
   c. File MUST handle loading state (loading from Redux state)
   d. File MUST handle error state (error from Redux state)
   e. File MUST handle empty state (data is empty array/null)

   Quick check:
   for f in frontend/app/pages/**/*.tsx; do
     if ! grep -q "useAppDispatch\|useAppSelector\|dispatch(" "$f"; then
       echo "WARNING: $f has no Redux hooks — likely uses mock data"
     fi
   done

4. i18n coverage check:
   grep -r "hardcoded.*=.*['\"]" frontend/app/pages/ --include="*.tsx" | grep -v "t(" | grep -v "import\|from\|className\|key=\|id=\|name=\|type=" | head -20
   → Should return minimal results. Non-translated visible strings = i18n gap.

5. Missing page check:
   Compare routes.ts and routes/*.routes.ts against actual page files:
   - Every route in routes.ts must have a corresponding page component
   - Every page component must be a real implementation (not re-export of another page)

6. httpService env variable check:
   grep -q "import.meta.env.VITE_API_URL" frontend/app/services/httpService.ts
   → MUST pass. If fails: httpService.ts has hardcoded baseURL instead of using env variable.
   → Fix: baseURL must be `import.meta.env.VITE_API_URL || '/api'`
   → This is defined in .claude/$FRONTEND/docs/data-fetching.md — follow it exactly.

7. httpService withCredentials check:
   grep -q "withCredentials.*true" frontend/app/services/httpService.ts
   → MUST pass. Required for httpOnly cookie authentication.
   → This is defined in .claude/$FRONTEND/docs/authentication-architecture.md.

8. Redux extraReducers wired check:
   grep -rl "extraReducers" frontend/app/redux/features/ --include="*Slice.ts" | \
     xargs grep -l "// .*will be wired\|// .*thunks.*here"
   → MUST return 0 files. Empty/placeholder extraReducers are prohibited.
   → Every slice with extraReducers MUST use builder.addCase to handle pending/fulfilled/rejected.

9. No mock data in pages check:
   grep -rl "mockUsers\|mockProjects\|mockData\|sampleData\|dummyData" frontend/app/pages/ --include="*.tsx"
   → MUST return 0 files. Hardcoded mock data arrays in pages are prohibited (RULE-F6).
   → Pages must fetch data via Redux thunks from httpServices/.
```

## Quality Gate

```yaml
gate: screen_coverage >= 90% AND fidelity >= 85%
checks:
  - all_screens_built: "Every HTML page has a React component?"
  - design_fidelity: "Visual match to HTML source >= 85%?"
  - responsive: "Works at mobile/tablet/desktop?"
  - components_extracted: "Shared components (navbar, footer) extracted as React layout?"
method: "Count React components vs HTML pages, run design QA fidelity scoring"
```

## Loop Integration

- **Command**: `fullstack {project} --phase frontend --loop`
- **When**: After HTML-to-React conversion, if fidelity < 85%
- **Skill**: `.claude/$FRONTEND/skills/qa/design-qa-html.md` + `qa/design-qa-figma.md`
- **Status file**: `SCREEN_STATUS.md`

---

## Phase Completion — Status Update

**Status updates are handled AUTOMATICALLY by the gate script (`_gate-runner.sh`).**

When the blueprint's `gate` deterministic node runs `bash gates/frontend-gate.sh`, the gate-runner:
- Updates Progress Table (Status, Score, Output, Gate Run At)
- Updates Gate Results section with check details
- Writes gate proof file to `.gate-proofs/frontend.proof`
- Appends to Execution Log
- Updates `last_run` and `pipeline_score` in Config

The blueprint's `verify-gate-proof` node confirms the gate ran. **No manual status updates needed.**
