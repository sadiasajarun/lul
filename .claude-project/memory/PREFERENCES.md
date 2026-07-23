# User Preferences: intelligent-data-dashboard

This document captures coding style preferences and patterns to maintain consistency.

---

## Coding Style

### General
- [x] Prefer functional components (no class components in codebase)
- [x] Descriptive variable names over comments
- [ ] Explicit types over type inference (codebase is mixed; several `any`s exist)

### TypeScript
- [x] Use `interface` for object shapes (see `DashboardWidget`, `SearchResult`)
- [ ] Strict mode — not currently enforced; do not introduce new `any`

---

## Naming Conventions (as found in this codebase)

| Element | Convention | Example |
|---------|------------|---------|
| View components | PascalCase + `View` suffix | `OverviewView`, `TeachersView` |
| shadcn/ui files | lowercase | `button.tsx`, `card.tsx` |
| Utility modules | camelCase + `Helper` suffix | `openAIHelper.ts`, `ragHelper.ts` |
| Interfaces | PascalCase | `DynamicDashboardResponse` |
| localStorage keys | snake_case | `api_provider`, `gemini_api_key` |

---

## Code Organization

- Views currently live inside the single `src/app/App.tsx` (~2,400 lines).
  If splitting, extract one `View` per file under `src/app/components/` and keep
  the `SCHOOLS` demo data in its own module.
- Import alias: `@/` → `src/` — do NOT use `~/` (that is the fullstack template
  convention, not this project's).
- Do not modify `src/app/components/ui/*` (generated shadcn primitives) except
  to sync with upstream shadcn.

---

## Communication Preferences

- [x] Concise responses preferred
- [x] Show code examples over explanations
- [x] Ask before making large refactors (e.g., splitting App.tsx)

---

## Patterns to Follow

- Keep the app deployable as a static site (no server assumptions).
- Any new dataset goes in `Database/` and gets registered in `ragHelper.ts`
  (`?url` import) and documented in `docs/PROJECT_DATABASE.md`.

## Patterns to Avoid

- Hardcoding API keys anywhere (keys are user-supplied at runtime).
- Adding `.css`/`.ts`/`.tsx` to `assetsInclude` in `vite.config.ts`.
- Removing the React or Tailwind Vite plugins (required by Figma Make).
