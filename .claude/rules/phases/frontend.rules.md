# Frontend Phase Rules

## Architecture

- This is a CONVERSION phase — convert HTML designs to React components
- No design decisions here — follow the HTML source exactly
- Extract shared components (Navbar, Footer, Sidebar) into Layout wrapper
- Use React Router matching HTML page slugs

## Code Quality

- Use TypeScript strict mode for all components ✅ gate: `ts-strict-mode`
- Use Tailwind CSS v4 for styling (matching HTML source)
- Use Redux async thunks (`createAsyncThunk` in service files) for data fetching — do NOT use TanStack Query
- No inline styles — convert to Tailwind classes
- No inline domain/state interfaces — all domain types and `*State` interfaces MUST be in `~/types/{domain}.d.ts` ✅ gate: `no-inline-domain-interfaces`
  - Only component Props interfaces and local UI unions (`FilterType`, `SortType`) may stay inline
  - Violation: frontend-gate FAIL

## Conversion Rules

- class → className, for → htmlFor
- Extract inline styles to Tailwind utilities
- Every HTML page gets a corresponding React component
- Shared navigation must be extracted to <Layout /> component
- Routes must match HTML filenames (01-landing.html → /)

## PRD Compliance

### RULE-F1: PRD NFR (Non-Functional Requirements) Implementation ✅ gate: `prd-nfr-compliance`

<!-- Why: Agent implemented all functional features but skipped i18n and accessibility
     requirements listed in PRD's NFR section. App shipped without language toggle
     despite PRD explicitly requiring multilingual support.
     Pattern: C-04 — Missing PRD Features
     Ref: frontend-gate.sh → prd-nfr-compliance check -->

- If PRD requires i18n/multilingual → install react-i18next + initialize (i18n.init) + create locale files + use useTranslation() + language toggle UI
- If PRD requires accessibility → use aria attributes
- Violation: frontend-gate FAIL

### RULE-F2: Dead Buttons Prohibited ✅ gate: `no-dead-buttons`

<!-- Why: 15+ buttons deployed without onClick handlers — they rendered visually
     but did nothing when clicked. Users reported "button not working" bugs.
     Pattern: stub_button-001
     Ref: agent-learnings → LRN-003
     Instances: Observed across multiple projects -->

- All `<button>` elements must have onClick or type="submit"
- "Dead buttons" that only render UI with no functionality are prohibited
- Violation: frontend-gate FAIL

### RULE-F3: PRD Role-Based Layout Separation ✅ gate: `layout-role-coverage`

<!-- Why: Agent merged SuperAdmin (dark header) and Admin (sidebar) into a single
     Layout component because their JSX structure was similar. Resulted in wrong
     visual identity per role — both roles saw the same header.
     Pattern: C-06 — CSS Value Drift (layout merging variant)
     Ref: frontend-gate.sh → layout-role-coverage check -->

- If PRD defines N layouts, code must have N or more Layout variants
- Even if structure (syntax) is similar, separate when roles (semantic) differ
- Example: SuperAdmin (dark header) vs Admin (sidebar) → separate return blocks
- Violation: frontend-gate FAIL

### RULE-F4: Essential UX Patterns Required (PRD-independent) ✅ gate: `logo-home-link`, `404-catch-all`

<!-- Why: Users navigated to invalid routes and saw a blank white screen — no 404 page.
     Logos were static images without navigation, so users had no way to return home
     except manually editing the URL. Empty list pages showed nothing instead of
     "No items found" guidance.
     Pattern: UX baseline — these are expected in any production web app
     Ref: frontend-gate.sh → logo-home-link, 404-catch-all checks -->

- All Layout logos/brand names must be wrapped in `<Link>` pointing to role-specific home path
- `routes.ts` must have `route('*', 'pages/not-found.tsx')` catch-all route (404 page)
- List pages must have empty state UI when no data
- Async data pages must have loading state UI
- Violation: frontend-gate FAIL

### RULE-F5: Role-Based Route Guards ✅ gate: `role-based-ui` (FAIL when PRD has roles)

<!-- Why: Admin-only action buttons (create/delete/settings) were visible to team members.
     Backend had permission checks, but frontend rendered all buttons regardless of role,
     confusing users who clicked buttons only to get 403 errors.
     Pattern: C-04 �� Missing PRD Features (RBAC variant)
     Ref: agent-learnings → LRN-004 (rbac_ui-001) -->

- When PRD defines multiple roles (admin, superadmin, manager, etc.), role-specific pages must have ProtectedRoute or useRole/usePermission checks
- Example: `/admin/*` → `<ProtectedRoute requiredRole="admin" />`, `/superadmin/*` → `<ProtectedRoute requiredRole="superadmin" />`
- Separate from backend permission checks, frontend must have dual guards at route level + UI level
- Violation: frontend-gate FAIL (when PRD defines roles)

### RULE-F6: Hardcoded Mock Data/Fallback Values Prohibited ✅ promoted from GP-001 (3 instances)

<!-- Why: Admin dashboard KPI cards displayed hardcoded values (e.g., MRR always showed "$8.4K",
     user count always "12,345") that never changed regardless of actual data. Agent used
     placeholder arrays during development and never replaced them with API calls.
     Pattern: GP-001 — Hardcoded Mock Data
     Ref: agent-learnings → LRN-001, LRN-005 | bug-patterns-global.yaml (multiple projects)
     Instances: 3+ projects -->

- Directly assigning mock data as inline array literals in table/list components is prohibited
  - ❌ `const payments = [{ id: 1, org: 'Acme' }, ...]`
  - ✅ Use data fetched from API, show empty state UI if none
- Using specific strings/numbers as fallback values is prohibited:
  - ❌ `user?.role || 'admin'`, `org?.mrr ?? 8.4`
  - ✅ `user?.role || null`, `stats?.mrr ?? 0`
- KPI/statistics values must come from API responses; displaying hardcoded numbers is prohibited
- Violation: frontend-gate FAIL

### RULE-F7: HTML Prototype = Source of Truth (Conditional) ✅ gate: `html-prototype-coverage` (C-05 prevention)

<!-- Why: Agent received 12 HTML prototypes but designed React pages from memory instead of
     reading them. The resulting UI had different layouts, missing sections, and
     invented features not present in the approved designs.
     Pattern: C-05 — Independent Design
     Ref: frontend-gate.sh → html-prototype-coverage check
     Instances: Recurring pattern — agents default to generating from training data -->

- **When HTML prototypes EXIST** (MODE A):
  - `DESIGN_SYSTEM.md` is for color token/type reference only — not the final standard for layout structure
  - Before implementing each page, MUST Read the corresponding HTML file completely using Read tool
  - HTML_STRUCTURE_INVENTORY.md MUST be created before any React page is written (RULE-F9)
  - Per-page content fidelity requirements — every element present in HTML MUST appear in React:
    - ALL visible text from HTML must appear in React (character-for-character match)
    - ALL form fields from HTML must appear in React (same names, types, placeholders)
    - ALL buttons from HTML must appear in React (same labels, same count)
    - ALL interactive elements from HTML must appear in React (toggles, checkboxes, icons, etc.)
    - ALL decorative/structural elements from HTML must appear in React (dividers, separators, etc.)
    - Zero tolerance for omissions — if it's in the HTML, it MUST be in the React component
  - Creating independent UI structures different from HTML prototypes is prohibited (independent design = C-05 pattern)
  - React pages count less than 80% of HTML file count → frontend-gate FAIL
- **When HTML prototypes DO NOT exist** (MODE B):
  - Agent designs pages from PROJECT_KNOWLEDGE.md / PRD as source of truth
  - DESIGN_SYSTEM.md tokens should be followed for colors, typography, spacing
  - All features, roles, and flows from PRD must be implemented
  - html-prototype-coverage gate is skipped (no HTML to compare against)
- Violation: frontend-gate FAIL

### RULE-F9: HTML Structure Inventory Required (When HTML Exists) ✅ gate: `html-inventory-exists`

<!-- Why: Without a pre-extracted inventory, agent skimmed HTML files and missed
     commonly-overlooked elements (social login buttons, password toggles, dividers,
     consent checkboxes). The inventory forces exhaustive extraction BEFORE conversion
     so these elements appear in the checklist.
     Pattern: C-05 — Independent Design (prevention mechanism)
     Ref: frontend.yaml → html-extract node -->

- When HTML prototypes exist, `.claude-project/docs/HTML_STRUCTURE_INVENTORY.md` MUST be created BEFORE the `convert` node runs
- The inventory MUST contain a section for EVERY HTML prototype file (count must match)
- Each section MUST include: semantic structure, content text (exact), CSS values, interactive elements, missing element traps
- The `convert` node MUST reference the inventory as a checklist when creating each React component
- When HTML prototypes do NOT exist, this rule is skipped
- Violation: frontend-gate FAIL

### RULE-F10: Test-stable selectors required ✅ gate: `has-stable-testids`

<!-- Why: Acceptance test specs (Playwright) generated by Phase 9 rely on
     data-testid selectors, but the HTML-to-React converter preserves HTML
     verbatim and HTML prototypes rarely include test hooks. Result: tests
     author optimistic selectors like [data-testid="filter-status"] that
     the pages don't expose, causing large-scale selector-mismatch failures.
     Pattern: pipeline contract drift (producer/consumer mismatch between
     html-to-react-converter and e2e-test-generator skills).
     Ref: html-to-react-converter.md → Step 0.5 (data-testid emission)
          e2e-testing/SKILL.md (consumer of the contract)
     Instances: Recurring across projects with HTML prototypes + Playwright. -->

- Every interactive element MUST carry a `data-testid` attribute.
- Coverage: `<input>`, `<textarea>`, `<select>`, `<button>`, action `<a>`, modal containers + triggers, list/table row roots, filter chips, tabs, status badges, empty/error placeholders, language/theme switchers.
- Naming: `data-testid="{page}-{element}[-{action}]"` — lowercase, kebab-case.
- Decorative elements (icons inside buttons, static headings, dividers) do NOT need `data-testid`.
- `data-testid` values must be unique within a page (reusing the same value for different elements is prohibited).
- Gate `has-stable-testids` counts interactive elements and requires ≥ 70% carry a `data-testid`. FAIL below threshold.
- Violation: frontend-gate FAIL.

### RULE-F8: CSS Value Accuracy Required (Pixel-Perfect) — C-06 prevention

<!-- Why: Agent used standard Tailwind scale classes (p-8 = 32px) when HTML specified
     padding: 40px. Visually, spacing was consistently wrong by 8-20px across pages.
     Also omitted box-shadow and backdrop-filter effects entirely.
     Pattern: C-06 — CSS Value Drift
     Ref: frontend.yaml → css-value-check node, frontend-gate.sh
     Instances: Recurring — agents prefer clean Tailwind classes over arbitrary values -->

- Convert px values from HTML `<style>` blocks to Tailwind arbitrary values `[Xpx]` exactly
- Only use Tailwind standard scale (p-4=16px, p-8=32px, etc.) when it matches the HTML value
- When mismatched, must use arbitrary values: `p-[40px]`, `rounded-[24px]`, `mb-[40px]`
- CSS variables in shared components/utility CSS must also use exact HTML values
- Missing visual effects like box-shadow, backdrop-filter is prohibited
- Violation pattern: using `p-8` (32px) when HTML has `padding: 40px` → FAIL

## File Organization (MANDATORY)

- **MUST Read** `.claude/$FRONTEND/docs/file-organization.md` before creating ANY frontend files
- Source directory: `app/` (NOT `src/`) — this is the React Router 7 standard
- Import alias: `~/` (NOT `@/`)
- Follow the exact folder structure defined in file-organization.md
- Violation of this structure = frontend-gate FAIL

## Environment Setup (MANDATORY) ✅ gate: `frontend-env-example`

- **BEFORE writing `.env.example`**, read `.claude-project/docs/PROJECT_KNOWLEDGE.md` frontend environment variables section — this is the **primary source of truth**
- Include vars for ALL planned frontend integrations even if not yet implemented in code
- Cross-reference with `import.meta.env.*` usage in code for exact variable names
- Create `frontend/.env.example` with placeholder values
- Create `frontend/.env` from `.env.example` with development values
- At minimum: `VITE_API_URL=http://localhost:3000/api`
- Code-only grep (`import.meta.env.*`) is insufficient — it misses planned features
- Violation: frontend-gate FAIL

## Scope Guard

- ONLY modify files under: frontend/app/
- Do NOT modify backend code during this phase
- Do NOT modify HTML prototypes in generated-screens/
- Do NOT change database entities
- Do NOT install backend packages
