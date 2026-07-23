# User Preferences: {PROJECT_NAME}

This document captures coding style preferences and patterns to maintain consistency.

---

## Coding Style

### General
- [ ] Prefer functional over class-based approaches
- [ ] Use early returns for guard clauses
- [ ] Explicit types over type inference
- [ ] Descriptive variable names over comments

### TypeScript
- [ ] Strict mode enabled
- [ ] Prefer `interface` over `type` for objects
- [ ] Use `unknown` over `any`
- [ ] Prefer `const` assertions where applicable

---

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Components | PascalCase | `UserProfile.tsx` |
| Hooks | camelCase with `use` prefix | `useAuth.ts` |
| Utilities | camelCase | `formatDate.ts` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Types/Interfaces | PascalCase | `UserResponse` |
| Files (components) | PascalCase | `UserCard.tsx` |
| Files (utilities) | kebab-case | `date-utils.ts` |

---

## Code Organization

### File Structure Preferences
- [ ] Collocate tests with source files
- [ ] Group by feature, not by type
- [ ] Keep files under 300 lines
- [ ] One component per file

### Import Order
1. External packages
2. Internal aliases (@/)
3. Relative imports
4. Styles

---

## Communication Preferences

- [ ] Concise responses preferred
- [ ] Show code examples over explanations
- [ ] Explain trade-offs when relevant
- [ ] Ask before making large refactors

---

## Patterns to Follow

<!-- Add project-specific patterns as they emerge -->

## Patterns to Avoid

<!-- Add anti-patterns discovered -->
