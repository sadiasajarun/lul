# Skills

All reusable Claude Code skills, organized by purpose.

## Top-Level Buckets

| Bucket | Description | Skill Count |
|--------|-------------|-------------|
| [client/](client/) | Everything the client sees — PRD, meetings, billing, reports, proposals | 13 |
| [internal/](internal/) | Team-only tools — SOP, knowledge base, tickets, training data | 4 |
| [app-release/](app-release/) | App store release pipeline (`/store-ship` orchestrator) | 7 |

## Client Sub-Categories

| Path | Description |
|------|-------------|
| [client/prd/](client/prd/) | PRD lifecycle — generate, update, classify |
| [client/meetings/](client/meetings/) | Meeting presentations — kickoff, weekly, closing |
| [client/billing/](client/billing/) | Invoices and transaction statements |
| [client/reports/](client/reports/) | Government project result report |
| [client/proposals/](client/proposals/) | Interactive HTML slide proposals (bilingual KO/EN) |

## Category README Convention

Every category folder **must** have a `README.md` with these sections:

| Section | Required | Content |
|---------|----------|---------|
| `# {Name} Skills` | Yes | One-line description |
| `## Orchestrator` | If exists | Orchestrator skill and what it does |
| `## Pipeline Flow` | If exists | ASCII diagram showing dependencies |
| `## Skills` | Yes | Table: Skill, Command, Description |
| `## Shared Rules` | If exists | What `_shared/` contains and how skills use it |
| `## Naming Convention` | Yes | Operations repo path ↔ global skills path mapping |

Reference model: [app-release/README.md](app-release/README.md)
