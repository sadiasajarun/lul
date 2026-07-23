# claude-operations

Claude Code operations skills - PRD generation, SOP creation, client meetings, billing, and store submission.

## Overview

This repo contains operations-focused skills for Claude Code. Add it as a submodule to projects that need document generation, project management, store submission, or automated QA capabilities.

## Installation

```bash
cd your-project/.claude
git submodule add https://github.com/potentialInc/claude-operations.git operations
```

## Available Skills

### Client — PRD Lifecycle (`skills/client/prd/`)

| Skill | Description | Usage |
|-------|-------------|-------|
| `generate-prd` | Generate complete PRD (Feature + Technical). Default `--full`; `--feature` / `--tech` / `--interview` flags supported. | `/generate-prd [--feature\|--tech\|--full] [--interview] <input-file>` |
| `generate-korean-prd` | Generate Korean PRD with company watermark | `/generate-korean-prd <input-file>` |
| `update-prd` | Update PRD with client feedback | `/update-prd <feedback-file>` |
| `pdf-to-prd` | Convert PRD PDF to structured markdown | `/pdf-to-prd <pdf-file>` |
| `input-classifier` | Auto-classify input before PRD modification | Auto-triggered on PRD edit |

### Client — Meetings (`skills/client/meetings/`)

| Skill | Description | Usage |
|-------|-------------|-------|
| `kickoff` | Branded kickoff HTML presentation | `/kickoff` |
| `weekly` | Weekly meeting agenda markdown + client presentation HTML | `/weekly` |
| `closing` | 5-phase closing pipeline + branded HTML closing presentation | `/closing` |

### Client — Billing / Reports / Presentations (`skills/client/`)

| Skill | Description | Usage |
|-------|-------------|-------|
| `generate-invoice` | Invoice (견적서) HTML/PDF | `/generate-invoice` |
| `generate-statement` | Transaction statement (거래명세서) HTML/PDF | `/generate-statement` |
| `generate-project-report` | Korean government project result report | `/generate-project-report <repo-path>` |

### Internal Tools (`skills/internal/`)

| Skill | Description | Usage |
|-------|-------------|-------|
| `generate-sop` | SOP creation + Notion integration | `/generate-sop <process>` |
| `kb` | Knowledge base (ingest, compile, query) | `/kb <command> [project]` |
| `ticketcreator` | Structured ticket generation | `/ticketcreator` |
| `generate-random-project` | Random project specs for team training | `/generate-random-project` |

### QA Skills (`skills/qa/`) — 7 individual + 1 orchestrator

Framework-agnostic full-stack QA auditing. Works with any frontend (React, Vue, Angular, Svelte) and backend (NestJS, Express, Spring Boot, Django, Laravel).

| Skill | Description | Usage |
|-------|-------------|-------|
| `qa-api` | API layer audit — CRUD, sync, response shapes | `/qa-api [module]` |
| `qa-data` | Data layer audit — schema, migrations, indexes | `/qa-data [module]` |
| `qa-form` | Full-stack input field consistency | `/qa-form [module]` |
| `qa-guard` | Auth & security audit — guards, permissions | `/qa-guard [module]` |
| `qa-runtime` | Playwright-based browser QA | `/qa-runtime [module]` |
| `qa-scan` | Universal QA orchestrator (quick/standard/deep) | `/qa-scan [module]` |
| `qa-ui` | UI/UX layer audit — states, modals, a11y | `/qa-ui [module]` |

### App Release (`skills/app-release/`)

| Skill | Description | Usage |
|-------|-------------|-------|
| `store-prep` | App store submission preparation | `/store-prep` |
| `store-assets` | App icon, screenshots, splash screen | `/store-assets` |
| `store-native` | Capacitor native app wrapper | `/store-native` |
| `store-deploy` | Production server deployment | `/store-deploy` |
| `store-build` | Release build (AAB/IPA) | `/store-build` |
| `store-submit` | Store console upload & submission | `/store-submit` |
| `store-review` | Store rejection handling | `/store-review` |
| `store-ship` | Full pipeline orchestrator | `/store-ship` |

**KB commands:**
- `/kb ingest <project> <type> <path>` — Ingest Slack exports, standups, meetings
- `/kb standup <project>` — Log today's standup
- `/kb decision <project> "<title>"` — Record architecture decision
- `/kb ask "<question>"` — Query knowledge base
- `/kb compile <project> [weekly|monthly]` — Generate summaries
- `/kb reindex` — Rebuild all indexes
- `/kb recent [days]` — Show recent activity
- `/kb search "<query>"` — Full-text search

## Available Agents

| Agent | Description | Invocation |
|-------|-------------|------------|
| `prd-manager` | PRD lifecycle dashboard, question tracking, Safety Gate guardian | "PRD status" or "Review these changes" |

## Structure

```
claude-operations/
├── README.md
├── CLAUDE.md
├── agents/
│   └── prd-manager.md
├── skills/
│   ├── client/
│   │   ├── prd/
│   │   │   ├── generate-prd/        ← Feature + Technical pipeline (--feature / --tech / --full)
│   │   │   ├── generate-korean-prd/
│   │   │   ├── update-prd/
│   │   │   ├── pdf-to-prd/
│   │   │   └── input-classifier/
│   │   ├── meetings/
│   │   │   ├── kickoff/
│   │   │   ├── weekly/
│   │   │   └── closing/
│   │   ├── billing/
│   │   │   ├── invoice/
│   │   │   └── transaction-statement/
│   │   └── reports/
│   │       └── korean-government/
│   │           └── result-report/
│   ├── internal/
│   │   ├── sop/
│   │   ├── kb/
│   │   ├── tickets/
│   │   └── training/
│   ├── qa/
│   │   ├── _qa-shared/
│   │   ├── qa-api/  qa-data/  qa-form/  qa-guard/
│   │   └── qa-runtime/  qa-scan/  qa-ui/
│   └── app-release/
│       ├── _ship/  _store-shared/
│       └── assets/  build/  deploy/  native/  prep/  review/  submit/
├── docs/
│   ├── project-registry.md
│   ├── references/
│   └── sop/
└── scripts/
```

## Usage Examples

```bash
# Generate a PRD from client requirements
/generate-prd client-requirements.pdf

# Update PRD with client answers or scope changes (auto-detects)
/update-prd client-feedback.md

# Create an SOP and add to Notion
/generate-sop "New Employee Onboarding"

# Run QA scan
/qa-scan users

# Run specific QA check
/qa-api products
```

## When to Use

Add this submodule when your project involves:
- Document generation (PRD, SOP, invoices, statements, reports)
- Project initialization and setup workflows
- Deployment pipelines
- Git workflow automation
- Team training with generated projects
- Automated QA auditing (full-stack, framework-agnostic)
- App store submission pipeline

## Related Repos

| Repo | Purpose |
|------|---------|
| [claude-base](https://github.com/potentialInc/claude-base) | Core shared configuration |
| [claude-marketing](https://github.com/potentialInc/claude-marketing) | Marketing and growth skills |
| [claude-react](https://github.com/potentialInc/claude-react) | React frontend skills |
| [claude-nestjs](https://github.com/potentialInc/claude-nestjs) | NestJS backend skills |
