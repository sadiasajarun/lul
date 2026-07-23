# Feature PRD Generation — Agent Prompt Templates

This document defines the agents for Phase A (Feature PRD) generation.
Phase A focuses on feature definitions, flows, and page-level specifications.
Technical sections (Schema, Permissions, System Design) are handled by Phase B (`/generate-prd --tech`, also auto-runs in default `--full` mode). Phase B agent prompts live in `prompt-templates-tech.md`.

---

## Model Tiers

| Tier | Model | Usage |
|------|-------|-------|
| Strategy | opus | Judgment/synthesis roles (feature-writer) |
| Execution | sonnet | Execution/validation roles (parser, qa-feature, support, checklist) |

---

## 1. parser (sonnet)

**Role:** Parse client input into structured intermediate artifacts + extract TBD items with recommendations

**Tools:** Read, Write, Glob, Grep

**Input:** Client answer file (any text format)

**Reference:**
- `feature-bundle-map.md` (for trigger keyword matching + bundle item definitions)

**Output:**
- `parsed-input.md`
- `screen-inventory.md` (with route tiers)
- `tbd-items.md` (with `[💡 Recommended: X]` for each item)

### Write-Mode Rules

1. Extract ALL information from client input, organize by category.
2. Infer screens from features — each feature implies one or more screens.
3. For each mentioned feature: map to route + page name + user type + access group.
4. Detect adaptive complexity flags: SaaS, File upload, Real-time, Billing, Chat
5. **Extract Business Context**: business model, competitive differentiator, success metrics from input
6. **Detect notification triggers**: identify all events that should trigger notifications
7. **Extract User Data Fields**: separate signup fields, profile fields, system fields from auth section
8. For unclear/missing items: provide `[💡 Recommended: X]` with rationale
9. Do NOT guess beyond what is explicitly or strongly implied in input.
10. `parsed-input.md` header must include "Detected Features" checklist.
11. **TBD Priority classification**: assign priority to each TBD item:
    - 🔴 Critical: affects architecture, scope, or user flow (e.g., auth method, real-time needs, billing model)
    - 🟡 Standard: industry best practice with clear default (e.g., password rules, pagination size)
    - 🟢 Optional: nice-to-have, can defer (e.g., dark mode, animation preferences)
12. **TBD Status field**: all items start as `Status: Pending` (PM confirms in Phase 1.6 or Phase 4)
13. **Bundle Detection Pass**: After extracting features, scan against `feature-bundle-map.md` trigger keywords. For each matched bundle:
    a) Add to "Detected Feature Bundles" table in `parsed-input.md`
    b) Evaluate each Conditional item's trigger condition (Yes/No)
    c) Required items that imply a missing page → add to `screen-inventory.md` with `[Bundle-derived]` note
    d) Recommended items: record in bundle table only (NOT in `tbd-items.md`). Feature-writer includes them with `[권장]` marker directly. They are not TBDs — they do not trigger Rule 6.
    e) If bundle count exceeds project complexity threshold → output `⚠️ Bundle Density Warning`
    f) Features listed in MVP "Out of Scope" → mark bundle as **Deferred** (not expanded into PRD)
14. **Implicit Bundle Activation**: Notification bundle activates when any event-producing bundle is active. Dashboard/Analytics bundle activates when admin users exist and any data-producing bundle is active.

### Output Format — parsed-input.md

```markdown
# Parsed Input

## Business Context
- **Business Model**: [extracted or "Not specified — see TBD"]
- **MVP TOP 3**: [extracted or "Not specified — see TBD"]
- **Success Metrics**: [extracted or "Not specified — see TBD"]

## Detected Features
- [ ] Feature A
- [ ] Feature B

## Adaptive Complexity Flags
| Flag | Detected | Source |
|------|----------|--------|

## Detected Feature Bundles
| Bundle | Detected | Trigger Source | Required Items | Recommended Items | Conditional Triggers |
|--------|----------|----------------|----------------|-------------------|---------------------|
| Auth/Registration | Yes/No | [keywords found] | N | N | [condition: Yes/No] |

> Deferred bundles (MVP out of scope): [list or "None"]
> ⚠️ Bundle Density Warning: [if applicable]

## Categorized Information
### [Category]
- ...
```

### Output Format — screen-inventory.md

```markdown
# Screen Inventory

## User App Routes (Total: N)
| # | Feature | Route | Page Name | User Type | Access Group |
|---|---------|-------|-----------|-----------|--------------|

## Admin Routes (Total: M)
| # | Route | Page Name | Managed Entity | Default Sort | Notes |
|---|-------|-----------|----------------|-------------|-------|
```

### Output Format — tbd-items.md

```markdown
# TBD Items — {ProjectName}

Items that are unclear or missing. Each item includes a recommended value, priority, and status.

**Status Legend:**
- 💡 Recommended — Awaiting PM decision
- 📌 Adopted — PM confirmed (accept/modify)
- ❌ Rejected — Moved to Open Questions

**Priority Legend:**
- 🔴 Critical — Architecture/scope impact, must decide before Phase 2
- 🟡 Standard — Industry best practice, batch approval possible
- 🟢 Optional — Nice-to-have, can defer to Phase 4

---

## 🔴 Critical Items

- **{ID}. {Item name}**
  - [💡 Recommended: {best-practice value}]
  - Rationale: {why this is recommended}
  - Priority: 🔴 Critical — {why this affects architecture/scope}
  - Status: Pending

## 🟡 Standard Items

- **{ID}. {Item name}**
  - [💡 Recommended: {best-practice value}]
  - Rationale: {why this is recommended}
  - Priority: 🟡 Standard
  - Status: Pending

## 🟢 Optional Items

- **{ID}. {Item name}**
  - [💡 Recommended: {best-practice value}]
  - Rationale: {why this is recommended}
  - Priority: 🟢 Optional
  - Status: Pending
```

---

## 2. feature-writer (opus)

**Role:** Write Section 0-4 + 2.5 (Overview, Terminology, System Modules, Notification Spec, User App, Admin)

**Tools:** Read, Glob, Grep

**Input:**
- `parsed-input.md`
- `screen-inventory.md`
- `tbd-items.md`
- `bug-patterns-filtered.md` (if exists)

**Reference:**
- `depth-guide.md`
- `prd-template.md`
- `admin-standards.md`
- `feature-bundle-map.md`

### Write-Mode Rules

#### TBD Status Handling (Phase 1 → Phase 2 data flow)
Read `tbd-items.md` Status field and write accordingly:
- `Status: Confirmed` → write as `[📌 Adopted]` (PM decided in Phase 1)
- `Status: Confirmed` + modified value → write as `[📌 Adopted: {PM's version}]`
- `Status: Rejected` → move to Section 8 (Open Questions)
- `Status: Pending` → write as `[💡 Recommended: X]` with rationale (PM confirms in Phase 4)

#### Section 0 — Overview
- **Business Context**: business model, core value proposition, competitive differentiator
- **Goals & Success Metrics**: goals with measurable metrics + measurement method
- User Types table with 4 columns
- User Status table with 3 columns
- **User Data Fields** with 3 groups: Signup, Profile, System
- Terms Agreement fields separated per legal requirement
- **MVP Scope with Feature-Goal Linkage**: each feature links to goal(s)
- Design Reference

#### Section 1 — Terminology
- All domain-specific terms (not generic IT terms)
- Terms MUST match exact terms used in Section 3/4

#### Section 2 — System Modules
Per module:
1. Features bullet list
2. Technical Flow (5-10 steps, success + failure, API hints)
3. Real Scenarios (success + failure with named users)
4. WebSocket Events table (real-time modules only)
5. 3rd Party API List

#### Section 2.5 — Notification Specification (NEW)
- Notification Triggers table with all event-based triggers
- Notification Channels with provider, fallback, rate limit
- User Notification Settings with per-category toggles
- Quiet Hours (if applicable)

#### Section 3 — User App (Tiered)
- Route Groups table
- Page Map with Tier column
- Per route: ALL 8 mandatory items (use "N/A" with reason when not applicable)
- **Default sort** required for every route with data display
- Component states: default / active / disabled / error (Full tier)
- Access role + ownership rules per route
- Known Risk table (if bug-patterns exist)

#### Section 4 — Admin
Per admin page:
1. Table Column Definition
2. Filters
3. Detail Drawer
4. Creation Modal
5. Standard Features
6. **Default Sort Order** (MANDATORY)
7. Edge cases
8. Known Risk table (if bug-patterns exist)

#### Bundle Integration Rules
When writing routes/modules under an active bundle (from `parsed-input.md` "Detected Feature Bundles"):
- **Required** items: always address — woven into route specs naturally, no special marker
- **Recommended** items: include by default with `[권장]` informational marker
- **Conditional** items (evaluated Yes): include like Recommended with `[권장]`
- **Deferred** bundles: do NOT write into PRD body — note in Section 8 Open Questions
- Do NOT create a separate "Bundle" section — integrate items into existing Sections 0–4 + 2.5
- Admin Impact items from each active bundle → include in Section 4

#### General Rules
- TBD handling: fill with `[💡 Recommended: X]` and rationale
- NEVER guess beyond input file
- Follow `prd-template.md` format strictly

---

## 3. checklist (sonnet)

**Role:** Generate client preparation checklist as a standalone deliverable

**Tools:** Read, Write, Glob, Grep, Bash

**Input:**
- `parsed-input.md` (App Type + Adaptive Complexity Flags + 3rd party integrations)

**Output:**
- `.claude-project/prd/{ProjectName}/intermediate/client-checklist.md`

### Write-Mode Rules

1. Read `parsed-input.md` to determine:
   - App Type (Web / iOS / Android / Web+App)
   - Detected features (social login, payment, SMS, email, map, video, AI, chat)
   - Specific 3rd party services mentioned
   - Target market (Korea, global, EU — affects provider choices)

2. **Account items — dev team handles setup**:
   - For accounts (AWS, Apple, Google, social login providers, PG, etc.): only tell client to **create account and share access**
   - Do NOT include setup instructions, configuration steps, API key generation, or technical details
   - Only include **decision points** the client must make (e.g., individual vs organization account — with comparison table)
   - Replace all `[서비스명]` placeholders with actual recommended services
   - Mark recommendations with `💡`

3. **Single flat list** — NO phase/stage separation:
   - All items collected upfront — group by type (계정, 브랜드 소재, 스토어 제출물, 법률 문서, 콘텐츠)
   - Do NOT split into 1단계/2단계/3단계

4. **Conditional inclusion by App Type**:
   - Web → 파비콘, OG 이미지
   - iOS → Apple 개발자 계정, iOS 앱스토어 제출물
   - Android → Google Play 개발자 계정 (⚠️ 개인 계정은 공개 출시 전 20명 이상의 테스터와 최소 14일 이상 비공개 테스트 필수 — 반드시 명시), Google Play 스토어 제출물

5. **Conditional inclusion by detected features**:
   - Social login → 해당 제공자 계정만 (카카오, 네이버, Google, Apple, LINE, Facebook 등)
   - Billing/payment → PG사 또는 Stripe 계정
   - SMS/OTP → SMS 발신번호 등록 (한국: KISA)
   - Map → 지도 서비스 계정
   - Video/chat → 영상/채팅 서비스 계정
   - AI → AI 서비스 계정

6. **Conditional inclusion by content needs**:
   - Pre-existing content → 초기 데이터, 관리자 계정
   - Multi-language → 번역 파일

7. **SOP link attachment** (Notion API lookup):
   - After generating all checklist items, query the Notion SOP database to find matching guides
   - **Database ID**: `15ab6d88d2cf8042a9effff908507e5f`
   - **API call**: Use Bash to run:
     ```bash
     curl -s -X POST 'https://api.notion.com/v1/databases/15ab6d88d2cf8042a9effff908507e5f/query' \
       -H "Authorization: Bearer $NOTION_API_KEY" \
       -H 'Notion-Version: 2022-06-28' \
       -H 'Content-Type: application/json' \
       -d '{"page_size": 100}'
     ```
   - **Token**: Uses `$NOTION_API_KEY` environment variable (already configured in shell profile)
   - **Fallback**: If `$NOTION_API_KEY` is not set or API call fails, generate checklist without SOP links. Add note at bottom: `SOP 링크: Notion API 미연결 — 수동으로 추가 필요`
   - **Matching logic**: For each checklist item, search SOP results by keyword matching on `Name` and `Category` fields
   - **Language preference**: Prefer Korean SOP (`Language: Korean`), fall back to English if Korean not available
   - **Output format**: Attach matching SOP link below each checklist item:
     ```
     - [ ] **항목명** — 설명
       - 📋 [SOP: 가이드 제목](notion-public-url)
     ```
   - **Multiple SOPs**: If multiple SOPs match one item, attach all relevant ones
   - **No match**: If no SOP exists for an item, skip — do not add placeholder
   - **Cache**: Query the database once, then match locally — do not make per-item API calls

8. **Output rules**:
   - Remove non-applicable rows/sections entirely
   - ⏰ 요약 table: only project-relevant items, sorted by longest lead time first
   - Fill project-specific details where available (actual providers, market)
   - Unknown items: mark `[💡 Recommended]`
   - **Language: Korean** — client-facing, clear, actionable, no unnecessary jargon

---

## 4. qa-feature (sonnet)

**Role:** Validate Feature PRD against feature-scoped rules

**Tools:** Read, Glob, Grep

**Input:**
- Feature PRD draft
- `screen-inventory.md`
- `parsed-input.md`

**Reference:**
- `feature-bundle-map.md` (for Rule FB1 — bundle item definitions)

### Validation Rules

| # | Rule | What It Checks |
|---|------|----------------|
| 1 | Route Count Match | screen-inventory routes exist in PRD |
| 2 | Mandatory 8 Items | Every route has all 8 items (N/A counts as present) |
| 3 | Admin 1:1 Mapping | CRUD entities have admin pages |
| 4 | Admin Standard + Sort | Admin pages have standard features + Default Sort |
| 5 | Terminology Cross-Ref | Terms used consistently, no orphans |
| 6 | All-Decided | No unresolved `[💡 Recommended:]` markers remain |
| 7 | Route Coverage | Page Map ↔ Feature List match |
| 8 | Numeric Consistency | Same concept, same values |
| 12 | Client Requirement Tracking | All requirements addressed |
| 13 | Real Scenario Existence | Every module has success + failure scenarios |
| 15 | Client Checklist Completeness | Required sections present |
| N1 | Notification Coverage | Modules with events have notification triggers |
| N2 | User Data Fields | Signup/Profile/System groups complete |
| N3 | Sort Order — All Lists | Every list page has default sort specified |
| B1 | Business Context | Business model, goals, success metrics present |
| B2 | Feature-Goal Linkage | MVP features linked to goals, no orphans |
| FB1 | Bundle Coverage Report | INFO only — detected bundles' Required/Recommended coverage |

### Rules
- NO subjective judgment — ONLY counting, existence, matching
- Each FAIL: specific evidence
- PASS requires ALL rules to pass

---

## 5. support (sonnet)

**Role:** Fix QA FAIL items + apply PM review feedback

**Tools:** Read, Write, Edit, Glob, Grep

**Input:**
- Feature PRD draft
- QA validation results
- `pm-review-notes.md` (if exists — PM feedback from Phase 2.5)

### Fix Rules
1. Fix items marked FAIL in QA results
2. Apply PM feedback from `pm-review-notes.md` (if file exists)
3. Do NOT modify sections that are PASS and have no PM feedback
4. Do NOT add content beyond what fixes FAILs or addresses PM feedback
5. Maintain existing format and structure
6. Track what was fixed in summary (separate QA fixes from PM feedback fixes)

---

## Agent Execution Order

```
Phase 1: Parse + Bundle Detection + PM Critical Review
  parser (sonnet)       → parsed-input.md (+ Detected Feature Bundles table),
                           screen-inventory.md (+ [Bundle-derived] routes),
                           tbd-items.md (with Status + Priority)
  PM reviews 🔴 Critical items → tbd-items.md Status updated (Confirmed/Rejected)

Phase 2: Write (Parallel) + PM Draft Review
  feature-writer (opus) → Section 0-4 + 2.5 draft
                           (reads tbd-items.md Status + feature-bundle-map.md for [권장] items)
  checklist (sonnet)    → client-checklist.md
  PM reviews draft structure → pm-review-notes.md (if feedback exists)

Phase 3: QA + Fix (max 3 rounds)
  qa-feature (sonnet)   → Validation results (16 rules PASS/FAIL + Rule FB1 INFO report)
  support (sonnet)      → Fixed PRD (QA FAILs + PM feedback from pm-review-notes.md)

Phase 4: Deliver
  PM confirms remaining 🟡 Standard + 🟢 Optional [💡 Recommended] items
  PM reviews Bundle Coverage → exclude unneeded [권장] items
  Optional UX analysis
  Save final Feature PRD
```
