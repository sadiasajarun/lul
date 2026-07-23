# Operation Scripts

Runnable scripts backing operation skills. Each subdirectory is a standalone Node package with its own `package.json`, `node_modules/`, and credential wiring.

## Conventions

All scripts that need credentials follow the cross-module [**Credentials with 1Password**](../../resources/docs/credentials-with-1password.md) pattern defined at the root. Check that doc before wiring any new service. Never paste secrets into `.env` or code.

## Scripts

| Dir | Purpose | Skill |
|-----|---------|-------|
| [bolta/](bolta/) | Issue and amend Korean electronic tax invoices (세금계산서) via Bolta API | [`tax-invoice`](../skills/client/billing/tax-invoice/SKILL.md) |

## Adding a new script directory

Follow the onboarding checklist in [`../../resources/docs/credentials-with-1password.md`](../../resources/docs/credentials-with-1password.md). Copy [`bolta/`](bolta/) as the reference implementation and adapt.

Minimum required files:
- `package.json` — with `check`, mode-pair npm scripts using `op run`
- `.env.1password.test` and `.env.1password.live` — committed reference files
- `.env.example` — fallback for non-op usage (gitignored for real values)
- `.gitignore` — excludes `.env*` except `.env.1password.*`
- `check-env.mjs` — credential diagnostic
- `README.md` — Team Onboarding section at the top

Then:
1. Add a row to the **Scripts** table above
2. Link from the owning skill's `SKILL.md` → Prerequisites section
