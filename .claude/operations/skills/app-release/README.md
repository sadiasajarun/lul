# App Release Skills

App store release pipeline — from information gathering to review response.

## Orchestrator

**`/store-ship`** — Runs the full pipeline in sequence, tracks progress, detects blockers.

## Pipeline Flow

```
prep ──┬── assets ──┐
       ├── native ──┼── build ── submit ── review
       └── deploy ──┘
```

## Skills

| Phase | Skill | Command | Description |
|-------|-------|---------|-------------|
| 1 | [prep](prep/) | `/store-prep` | Interview, document generation, client guide |
| 2 | [assets](assets/) | `/store-assets` | App icons, screenshots, splash screens, Feature Graphic |
| 3 | [native](native/) | `/store-native` | Capacitor wrapper, push, deep links, biometric, Apple login, ATT |
| 4 | [deploy](deploy/) | `/store-deploy` | Production server, HTTPS, env vars, Docker |
| 5 | [build](build/) | `/store-build` | Keystore/certificate, release build, AAB/IPA |
| 6 | [submit](submit/) | `/store-submit` | Store console metadata entry, upload, submission |
| 7 | [review](review/) | `/store-review` | Rejection analysis, fix guide, resubmission |

## Parallelizable

After Phase 1 (prep), Phases 2-4 can run simultaneously.
Phase 5 (build) requires 2-4 complete.

## Reference Docs

- [service-launch-checklist.md](../../resources/docs/references/service-launch-checklist.md) — Master checklist with conditional tags
- [appstore-age-ratings.md](../../resources/docs/references/appstore-age-ratings.md) — Age rating questionnaire guide

## Naming Convention

- **Operations repo**: Short names (`app-release/prep/`, `app-release/assets/`, orchestrator: `app-release/_ship/`)
- **Global skills** (`~/.claude/skills/`): Prefixed names (`store-prep/`, `store-assets/`)
- **Slash commands**: Always `/store-prep`, `/store-assets`, etc.

See sync commands in [CLAUDE.md](../../CLAUDE.md#store-skills-sync).
