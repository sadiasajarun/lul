# Skill Guide

> Practical reference for all Claude Code skills in this repo.
> When to use, how to invoke, what to prepare, and what you get.

---

## Quick Start: 5 Most-Used Skills

### 1. `/generate-prd` — Create a Feature PRD

- **When**: After kickoff meeting, when client answers are compiled into a single file
- **Command**: `/generate-prd /path/to/client-answers.md`
- **Prerequisites**: Client answer file (from pre-intake form + interview)
- **Output**: `{AppName}_FeaturePRD_{YYMMDD}.md` + `client-checklist.md`
- **Tip**: Send `templates/pre-intake-en.md` (or `-kr.md`) to the client BEFORE the first meeting. The PM is involved at 3 decision points during generation (Critical items, Draft review, Final review).

### 2. `/update-prd` — Update PRD with Client Feedback

- **When**: Client answers open questions or requests scope changes
- **Command**: `/update-prd /path/to/client-feedback.md`
- **Prerequisites**: Existing PRD in `.claude-project/prd/`
- **Output**: Updated PRD (version incremented), updated Change Log
- **Tip**: Input is auto-classified (Q&A vs Change Request vs Mixed) — no manual separation needed. Change Requests go through a Safety Gate (Impact Analysis → Diff Preview → Conflict Detection).

### 3. `/generate-korean-prd` — Korean PRD PDF for Client Delivery

- **When**: Need a polished Korean PDF to deliver to clients
- **Command**: `/generate-korean-prd /path/to/content.txt [--client "CompanyName"] [--contact "Name"]`
- **Prerequisites**: Project content file; Google Chrome installed
- **Output**: HTML + PDF in `.claude-project/prd/`
- **Tip**: Place company logo at `.claude/templates/logo.svg` for watermark branding. If no logo, proceeds without watermark.

### 4. `/generate-sop` — Create SOP in Notion

- **When**: Documenting a new process for the team
- **Command**: `/generate-sop "Topic description"`
- **Prerequisites**: `NOTION_API_KEY` environment variable set; Notion Team SOP database access
- **Output**: Notion page with 7 sections (Task Description, Step-by-Step, Checklist, Example, Links, Definition of Done, Next Steps)
- **Tip**: You will be asked to select Category, Type, Language, and Writer — do not skip this step.

### 5. `/store-ship` — App Store Release Pipeline

- **When**: Ready to submit an app to Google Play / App Store
- **Command**: `/store-ship status` (check progress) or `/store-ship start` (begin pipeline)
- **Prerequisites**: Working web app in buildable state
- **Output**: 7-phase pipeline orchestration with status dashboard
- **Tip**: Use `/store-ship blockers` to see what is blocking progress (client-side vs developer-side).

---

## A. PRD Lifecycle (5 skills + 1 agent)

### Pipeline Flow

```
Client answers ──→ /generate-prd (default --full: Phase A → Phase B)
                       ↓
                   Complete PRD (Feature + Technical)
                       ↓
                   Development begins

                   /generate-prd --feature  → Phase A only (stop after Feature PRD)
                   /generate-prd --tech     → Phase B only (Tech sections from existing Feature PRD)
                   /generate-prd --interview → Live interactive interview, then full pipeline

Client feedback ──→ /update-prd (auto-triggers /input-classifier)

Existing PDF    ──→ /pdf-to-prd (converts to markdown)

Korean delivery ──→ /generate-korean-prd (branded PDF)

Status check    ──→ prd-manager agent ("PRD status")
```

### Common PRD Workflow (Step-by-Step)

1. Send pre-intake form to client
2. Conduct kickoff meeting using interview template
3. Compile answers into a single file
4. Run `/generate-prd <answers-file>` → complete PRD (Feature + Technical) in one pipeline
   - Or split: `/generate-prd --feature <answers-file>`, then later `/generate-prd --tech <prd-file>` after PM resolves recommendations
5. Send `client-checklist.md` to client
6. Collect client answers to open questions
7. Run `/update-prd` with feedback (repeat until all resolved)
8. Run `/generate-korean-prd` for client deliverable

### Skill Details

| Skill | Command | Prerequisites | Output |
|-------|---------|---------------|--------|
| **generate-prd** (full) | `/generate-prd <answers-file>` | Client answer file | Complete PRD (Sections 0-7 + 8) |
| **generate-prd** (feature only) | `/generate-prd --feature <answers-file>` | Client answer file | Feature PRD only (Sections 0-4 + 2.5 + 8) |
| **generate-prd** (tech only) | `/generate-prd --tech <feature-prd>` | Completed Feature PRD with NO unresolved `[💡 Recommended]` markers | Merged Sections 5-7 into existing `{App}_PRD.md` |
| **generate-prd** (interview) | `/generate-prd --interview` | None (or pre-intake file) | Live interview → full pipeline (combine with `--feature` to stop after A) |
| **update-prd** | `/update-prd <feedback-file>` | Existing PRD + client feedback file | Updated PRD (version incremented) |
| **pdf-to-prd** | `/pdf-to-prd <pdf-file>` | PDF file with PRD content | Markdown PRD in `.claude-project/prd/` |
| **generate-korean-prd** | `/generate-korean-prd <content-file>` | Content file + Chrome | HTML + PDF with branding |
| **input-classifier** | *(auto-triggered)* | — | Classification: Q&A / Change Request / Mixed |

**Notes:**
- `--tech` mode ABORTs if Feature PRD still has unresolved `[💡 Recommended]` items — resolve them via `/update-prd` (or use `--full` mode which handles them in Phase 4)
- `input-classifier` runs automatically before `/update-prd` — never invoke it directly
- `generate-prd` uses 9 agents internally (Phase A: parser, feature-writer, checklist, qa-feature; Phase B: tech-parser, config-allocator, tech-writer, qa-tech; shared: support)
- Output filename is stable `{App}_PRD.md` — Phase B merges into the same file written by Phase A
- Version tracking: 1.0 → 1.1 → 1.2 on each update

### prd-manager Agent

Not a slash command — invoked by natural language (e.g., "PRD status", "Review these changes").

- **Dashboard**: Scans `.claude-project/prd/` for all PRDs, shows lifecycle status
- **Status Classification**: Draft → In Progress → Near Complete → Complete
- **Question Tracking**: Lists all pending Required/Recommended questions
- **Safety Review**: 3-gate process for Change Requests (Impact Analysis → Diff Preview → Conflict Detection)
- **Read-only**: Never modifies PRD files directly

---

## B. Document Generation (4 skills)

| Skill | Command | Prerequisites | Output | Language |
|-------|---------|---------------|--------|----------|
| **generate-sop** | `/generate-sop "Topic"` | `NOTION_API_KEY` env var | Notion page in Team SOP database | EN or KR (user selects) |
| **generate-invoice** | `/generate-invoice [--client "Name"] [--no-vat]` | Client info; Chrome for PDF | HTML + PDF + JSON record in `.claude-project/billing/invoice/` | Korean (견적서) |
| **generate-project-report** | `/generate-project-report <repo-path or URL>` | Local repo or GitHub URL (supports multiple, comma-separated) | `{ProjectName}_결과보고서_{YYMMDD}.md` (10 sections) | Korean |
| **generate-random-project** | `/generate-random-project` | None | Training project spec → auto-triggers `/generate-prd` | English |

**Notes:**
- `generate-invoice` amounts in 만원 units are auto-converted to 원 on display (×10,000). VAT 10% included by default.
- `generate-project-report` follows "Hallucination Zero" — only facts verified from code. Unverified items marked `[⚠️ 확인 필요]`.
- `generate-random-project` lets you pick difficulty (5 levels), domain (12 options), and tech stack before generating

---

## C. QA Suite (7 skills + 1 orchestrator)

### Entry Point

**`/qa-scan`** is the main entry point. It orchestrates all other QA skills automatically.

```
/qa-scan [module] [--quick|--deep]
  → Runs layers in order: data → api → guard → form → ui
  → Cross-layer findings auto-trigger related checks
```

| Mode | Scope | Use When |
|------|-------|----------|
| `--quick` | Changed files only, Critical/High severity | Quick check before demo |
| *(default)* | Changed features, all severities | After feature completion |
| `--deep` | Entire project, all checks + cross-feature analysis | Before release |

### Individual QA Skills

Use these when you need to audit a specific layer only.

| Skill | Command | What It Checks |
|-------|---------|---------------|
| **qa-api** | `/qa-api [module]` | CRUD completeness, frontend-backend sync, response shapes, error handling, pagination |
| **qa-data** | `/qa-data [module]` | Schema consistency, migrations, dead columns, FK relations, indexes, soft delete |
| **qa-form** | `/qa-form [module] [--group name]` | Entity → DTO → Schema → Form UI consistency, validation, mutability, security |
| **qa-guard** | `/qa-guard [module]` | Role guards, route protection, permissions, token handling, SQL injection, XSS, rate limiting |
| **qa-ui** | `/qa-ui [module] [--sub category]` | States, buttons, modals, lists, navigation, accessibility, layout, performance |
| **qa-runtime** | `/qa-runtime [--layer=name]` | Browser-based testing: actionability, console errors, modals, a11y, CLS, user flows, forms, responsive |

**Notes:**
- All QA skills are **framework-agnostic** — auto-detect React/Vue/Angular + NestJS/Express/Django/Spring/Laravel
- `qa-form` includes Business Questions (BQ1-BQ4): field mutability, role-based editability, state transitions, sensitive field exposure
- `qa-ui` supports subcategory filtering: `--sub states|buttons|modals|lists|nav|a11y|layout|perf`
- `qa-runtime` requires **running backend + frontend servers** and Playwright installed
- `qa-runtime` L8 tests across 6 device matrices (Galaxy S9+, S24, iPhone SE, 14, 14 Pro Max, Pixel 7)
- Individual skills run in **diagnose-only** mode (no fixes). Use `/qa-scan` for diagnose + fix + verify cycle.

---

## D. Store Submission Pipeline (8 skills)

### Pipeline Diagram

```
/store-ship orchestrates 7 phases:

  Phase 1: /store-prep    → Collect app info, generate listings, legal docs, tech checklist
  Phase 2: /store-assets  → Icons, screenshots, splash screen, feature graphic
      ┌─── (parallel) ────┐
  Phase 3: /store-native  → Capacitor wrapper, push, deeplinks, biometric, Apple login, ATT
  Phase 4: /store-deploy  → Production server, HTTPS, Docker, env vars
      └───────────────────┘
  Phase 5: /store-build   → Signing keys, ProGuard, release AAB/IPA
  Phase 6: /store-submit  → Upload to store consoles, metadata, submit for review
  Phase 7: /store-review  → Handle rejections, fix, resubmit
```

### Phase Details

| Phase | Skill | Command | Prerequisites | Key Output |
|-------|-------|---------|---------------|------------|
| 1 | **store-prep** | `/store-prep [phase 0-6]` | Project with package.json | app-info.md, listing files, legal docs, tech-checklist.md, client-guide.md |
| 2 | **store-assets** | `/store-assets [icon\|screenshot\|splash\|all]` | store-prep completed | Resized icons, screenshot designer HTML, splash images, feature graphic |
| 3 | **store-native** | `/store-native [init\|push\|deeplink\|biometric\|apple-login\|account-deletion\|all]` | store-prep completed, Node.js 18+ | Capacitor project, native services, platform configs |
| 4 | **store-deploy** | `/store-deploy [check\|env\|docker\|ssl\|all]` | Infrastructure decided | Production Docker config, nginx, SSL, env template |
| 5 | **store-build** | `/store-build [android\|ios\|all]` | store-native init + icons + production server | Keystore/certificate, signed AAB/IPA |
| 6 | **store-submit** | `/store-submit [google\|apple\|all]` | All previous phases + store accounts | Submission guides, checklist verification |
| 7 | **store-review** | `/store-review [google\|apple] [reason]` | Rejection email received | Rejection analysis, fix guide, resubmission strategy |

### Orchestrator Commands

| Command | What It Does |
|---------|-------------|
| `/store-ship status` | Dashboard showing completion status of all 7 phases |
| `/store-ship start` | Begin pipeline from Phase 1 |
| `/store-ship resume` | Continue from where interrupted |
| `/store-ship from <phase>` | Start from a specific phase (e.g., `from native`) |
| `/store-ship checklist` | Integrated checklist across all phases |
| `/store-ship blockers` | Show what is blocking progress |
| `/store-ship update` | Version bump workflow for existing apps |

### Common Blockers to Watch

| Blocker | Affects | Action Needed |
|---------|---------|---------------|
| Store console accounts not created | store-submit | Google ($25 one-time), Apple ($99/year) |
| App icon source not provided | store-assets | 1024×1024 PNG required |
| Production domain not purchased | store-deploy | Domain + HTTPS needed |
| Privacy policy URL not hosted | store-submit | Required for Google Play (2024+) |
| Social login exists but no Apple Login | store-native | Mandatory per Guideline 4.8 |
| No account deletion feature | store-native | Mandatory for both stores |
| Tracking SDKs without ATT prompt | store-native | Mandatory for iOS 14.5+ |

**Notes:**
- `store-native` Phase 0 auto-detects which features are needed (push, deeplinks, biometric, Apple Login, ATT) based on existing code
- `store-build`: **Never lose the keystore or password** — app updates become impossible without them
- `store-build` auto-generates ProGuard/R8 rules for detected Capacitor plugins
- `store-deploy` scans for security issues: test keys, localhost URLs, debug code, permissive CORS
- Common Apple rejections: Guideline 4.2 (minimum functionality), 5.1.1 (data collection), 4.8 (Sign in with Apple)
- Common Google Play rejections: WebView policy, data safety incomplete, account deletion missing

---

## E. Client Meetings (3 skills — `skills/client/meetings/`)

End-to-end artifacts for a client engagement: kickoff → weekly meeting → closing.

### Pipeline Flow

```
Contract signed
  └─→ /kickoff  → Branded kickoff HTML presentation

Ongoing phase
  └─→ /weekly   → agenda.md + client presentation.html

Project completion
  └─→ /closing  → pre-close check → deliverables → client guide → cleanup → closing report + HTML presentation
```

### Skill Details

| Skill | Command | When to Use | Output |
|-------|---------|-------------|--------|
| **kickoff** | `/kickoff` | Project start — kickoff meeting prep | Branded HTML slide presentation (11 slides) |
| **weekly** | `/weekly [--project N] [--week N]` | Weekly client meeting prep | Agenda markdown + client presentation HTML |
| **closing** | `/closing` | Project completion | 5-phase closing: check → deliverables → client guide → repo cleanup → HTML closing report + presentation |

**Notes:**
- `weekly` auto-collects git log, prior meeting notes (carry-forward), and scope docs; interview covers only items the codebase can't infer (Slack excerpts, blockers, client feedback)
- `weekly` reuses the CSS framework and slide structure from `kickoff` for visual consistency — all client-facing materials share one design language
- `closing` runs pre-close checks BEFORE generating deliverables — blockers in pre-close halt the pipeline
- `closing` Phase 5 reuses `kickoff`'s HTML template for the closing meeting presentation

---

## Skill Pipelines & Dependencies

```
PRD Pipeline:
  /generate-prd (default --full: Feature → Technical) ──→ Development
        ↕                  ↑
  /update-prd          (--feature / --tech split mode for incremental work)
  (with /input-classifier auto-trigger)
        ↓
  /generate-korean-prd (client delivery)

Store Pipeline (/store-ship orchestrates):
  /store-prep ──→ /store-assets ──┬── /store-native ──┐
                                  └── /store-deploy ──┘
                                          ↓
                                    /store-build ──→ /store-submit ──→ /store-review

QA Pipeline (/qa-scan orchestrates):
  /qa-data → /qa-api → /qa-guard → /qa-form → /qa-ui
  (+ /qa-runtime separately for browser testing)

Training Pipeline:
  /generate-random-project ──→ /generate-prd (auto-triggered)

Client Meetings:
  /kickoff (project start)
  /weekly  (weekly)
  /closing (end of engagement)
```

---

## Prerequisites Cheat Sheet

| Prerequisite | Required By |
|-------------|-------------|
| `NOTION_API_KEY` env var | generate-sop |
| Google Chrome | generate-korean-prd, generate-invoice |
| Logo at `.claude/templates/logo.svg` | generate-korean-prd, generate-invoice |
| Running backend + frontend servers | qa-runtime |
| Playwright installed | qa-runtime, kickoff (QA verification) |
| `.claude-project/meetings/{ProjectName}/weekly/` writable | weekly (auto-created) |
| Node.js 18+ | store-native |
| Capacitor installed | store-native, store-build |
| Store console accounts (Google/Apple) | store-submit |
| Production domain + HTTPS | store-deploy, store-submit |

---

## Practical Tips

1. **Start PRD work with `/generate-prd`** — it drives the entire PRD lifecycle and produces the checklist for the client
2. **Check PRD status with natural language** — just say "PRD status" and the prd-manager agent responds
3. **Use `/qa-scan` as the default QA entry point** — it picks the right individual checks automatically
4. **Use `/store-ship status` before asking for updates** — the dashboard shows exactly what is done and what is blocking
5. **All skills auto-detect frameworks** — no need to specify React, NestJS, Django, etc.
6. **Review markdown before final generation** — `/generate-prd` produces intermediate files for review
7. **Keep client answer files as .md or .txt** — binary formats (.xlsx, .csv) are not supported by PRD skills
