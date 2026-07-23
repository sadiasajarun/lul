# Operation Resources (Tier 2 — Operation-Shared Assets)

Assets shared across **multiple operation skills** only. Not needed by design or mobile submodules.

## What belongs here

- Client logos reused across proposal + invoice + report skills
- Tech stack icons reused across proposal + PRD skills
- Office location imagery used by contact slides in proposals and kickoff decks
- Stamps, signatures, boilerplate imagery specific to client-facing operation deliverables

## What does NOT belong here

- Company brand (logo, seal) → Tier 1 at [`../../resources/`](../../resources/)
- Assets used by only one skill → keep skill-local
- Portfolio or project-specific screenshots → skill-local

## Consumption rules

Same global-sync constraint as Tier 1. A skill in `~/.claude/skills/{skill-name}/` loses the `operation/` parent. Options:

1. **Sync-time bake**: sync script copies required Tier 2 assets into each skill's own `images/` or `assets/` dir before pushing to `~/.claude/skills/`.
2. **Local-only skills**: skills that never auto-sync can reference `../../resources/` directly.

Per [`../CLAUDE.md`](../CLAUDE.md) *Auto-Sync to Global Skills* rule, most operation skills DO sync — prefer option 1.

## Current contents

| File | Purpose |
|------|---------|
| `stamp.png` | Operation-level stamp asset |

## When to promote to Tier 1

Move an asset up to root `.claude/resources/` the moment a design or mobile skill needs it too.
