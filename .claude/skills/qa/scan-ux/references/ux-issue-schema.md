# UX Issue File Schema

Each issue found by the UX scanner is saved as an individual markdown file in `.claude-project/ux_issues/`.

## File Naming

```
UX-{NNN}.md
```

Where `{NNN}` is a zero-padded 3-digit sequential number (UX-001, UX-002, ..., UX-999).
If >999 issues, extend to 4 digits (UX-1000+).

## Template

```markdown
# UX-{NNN}: {Title}

- **Severity**: P0|P1|P2|P3
- **Category**: {category_id} ({category_name})
- **Check**: {check_id}
- **Status**: Open
- **Route**: {path}
- **File**: {component_path}:{line}
- **Found**: {YYYY-MM-DD}

## Problem

{Clear description of what's wrong. Be specific — include what was expected vs what was observed.}

## Evidence

{One of:
- Screenshot reference: `qa/ux-scanner/{route-kebab}/desktop.png`
- Code snippet with file:line reference
- Console output
- Network response excerpt
}

## Fix Direction

{Suggested approach to fix. Keep it actionable — reference specific files, components, or patterns.}
```

## Field Rules

| Field | Required | Rules |
|-------|----------|-------|
| Title | Yes | Short (< 80 chars), describes the issue, not the check |
| Severity | Yes | P0 = blocker, P1 = high, P2 = medium, P3 = low |
| Category | Yes | Must match a `category.id` from `heuristic-checklist.yaml` |
| Check | Yes | Must match a `check.id` from `heuristic-checklist.yaml` |
| Status | Yes | Always `Open` when created. Changed by fix process. |
| Route | Yes | The URL path where the issue was found (e.g., `/admin/users`) |
| File | If known | Source file and line number (e.g., `src/pages/admin/UsersPage.tsx:45`) |
| Found | Yes | Date in YYYY-MM-DD format. Never use template placeholders. |

## Severity Guidelines

| Severity | Criteria | Gate Impact |
|----------|----------|-------------|
| **P0** | Core functionality broken, security vulnerability, data exposed | Blocks gate (score penalty 0.3 per issue) |
| **P1** | Major feature unusable, significant UX degradation | Advisory (score penalty 0.1 per issue) |
| **P2** | Usability issue, inconsistency, confusing behavior | Advisory |
| **P3** | Polish item, minor visual imperfection | Advisory |

## Deduplication

Before creating a new issue:
1. Check if an issue with the same `check_id` + `route` already exists
2. If yes: update the existing issue instead of creating a duplicate
3. If same `check_id` on different routes: create separate issues (each route is distinct)
