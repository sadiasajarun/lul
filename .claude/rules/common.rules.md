# Project Rules — tirebank

## Git
- Branch from `dev`, PR to `dev`, never push directly to `main`
- Branch naming: `feature/<name>`, `fix/<name>`, `chore/<name>`
- Commit messages: imperative mood, concise, reference ticket if exists

## Code Quality
- No `console.log` in production code (use proper logger)
- No `any` type — use specific types or `unknown` with type guards
- No commented-out code — delete it, git has history
- No TODO comments without a ticket reference

## Documentation
- Update `.claude-project/docs/PROJECT_API.md` when adding endpoints
- Update `.claude-project/docs/PROJECT_DATABASE.md` when adding entities
- Update `.claude-project/docs/PROJECT_KNOWLEDGE.md` when adding features

## Environment
- All secrets in `.env` files (never committed)
- `.env.example` with placeholder values for every `.env` variable
- Environment-specific config via environment variables, not code branches
