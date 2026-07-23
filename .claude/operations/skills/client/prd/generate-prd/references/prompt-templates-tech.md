# Technical PRD Generation (v4) — Agent Prompt Templates

This document defines the agents for Phase B (Technical PRD) generation.
Phase B takes a completed Feature PRD as input and generates Sections 5-7 (Tech Stack, Schema, Permissions).

---

## Model Tiers

| Tier | Model | Usage |
|------|-------|-------|
| Strategy | opus | Judgment/synthesis roles (tech-writer) |
| Execution | sonnet | Execution/validation roles (tech-parser, config-allocator, qa-tech, support) |

---

## 1. tech-parser (sonnet)

**Role:** Extract entities, permissions, and integrations from Feature PRD

**Tools:** Read, Write, Glob, Grep

**Input:** Completed Feature PRD (Phase A output)

**Output:**
- `entity-inventory.md`
- `permission-inventory.md`
- `integration-inventory.md`

### Pre-check

Before processing, scan the Feature PRD for unresolved markers:
- If ANY `[💡 Recommended:]` markers found → **ABORT** with message:
  ```
  Error: Feature PRD contains {N} unresolved [💡 Recommended:] items.
  PM must confirm all items in Phase A before Technical PRD can be generated.
  Unresolved items:
  - [item 1]
  - [item 2]
  ```

### Write-Mode Rules

1. Read entire Feature PRD
2. **Entity extraction**: Scan Section 3/4 for CRUD operations → derive entities
   - Create/Update forms → entity with listed fields
   - Delete operations → entity name
   - List/table pages → entity with column fields
   - Detail views → entity with display fields
3. **Permission extraction**: Scan Section 3/4 for access/ownership rules
   - Per route: who can access (roles)
   - Per action: who can create/edit/delete (ownership rules)
4. **Integration extraction**: Scan Section 2 3rd Party API List + Section 2.5 Notification channels
5. Output structured inventories

### Output Format — entity-inventory.md

```markdown
# Entity Inventory — {ProjectName}

Derived from Feature PRD Section 3/4.

## Entities (Total: N)

| # | Entity | Source Routes | CRUD Operations | Estimated Columns |
|---|--------|-------------|-----------------|-------------------|
| 1 | [User] | /signup, /profile, /admin/users | C, R, U, D | 12 |
| 2 | [Post] | /posts, /posts/new, /admin/posts | C, R, U, D | 9 |

## Relationships

| Entity A | Relationship | Entity B | Source |
|----------|-------------|----------|--------|
| [User] | 1:N | [Post] | Section 3: "author creates posts" |

## Status Enums (from Section 1)

| Enum | Values | Used By |
|------|--------|---------|
| [UserStatus] | PENDING(0), ACTIVE(1), SUSPENDED(2) | User |
```

### Output Format — permission-inventory.md

```markdown
# Permission Inventory — {ProjectName}

## Actions × Roles

| Resource | Action | Source | Roles with Access | Ownership |
|----------|--------|--------|-------------------|-----------|
| [Post] | Create | Section 3: /posts/new | User, Admin | N/A |
| [Post] | Edit | Section 3: /posts/:id/edit | User(own), Admin | authorId |
| [Post] | Delete | Section 3: /posts/:id | User(own), Admin | authorId |
```

### Output Format — integration-inventory.md

```markdown
# Integration Inventory — {ProjectName}

## 3rd Party Services (from Section 2)

| Service | Purpose | Env Variables Needed |
|---------|---------|---------------------|
| [Stripe] | Payment | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET |

## Notification Channels (from Section 2.5)

| Channel | Provider | Env Variables |
|---------|---------|--------------|
| Push | FCM | FIREBASE_SERVER_KEY |
| Email | SendGrid | SENDGRID_API_KEY |

## Detected Features → Conditional Sections

| Feature | Detected | Conditional Section |
|---------|----------|-------------------|
| Auth | Yes/No | Auth Flow |
| File Upload | Yes/No | File Pipeline |
| Real-time | Yes/No | Real-time Architecture |
| Billing | Yes/No | Billing Flow |
| Multi-tenancy | Yes/No | Multi-tenancy |
```

---

## 2. config-allocator (sonnet)

**Role:** Allocate unique environment config values to prevent cross-project conflicts

**Tools:** Read, Write, Glob, Grep

**Input:**
- `docs/project-registry.md`
- Project name from Feature PRD

**Output:**
- `project-config.md`
- Updated `docs/project-registry.md`

### Write-Mode Rules

1. Read `docs/project-registry.md` for all existing allocations
2. Allocate next available values:
   - `backend_port`: Next unused in range 3000-3099
   - `frontend_ports`: Next two unused in range 5173-5299
   - `redis_prefix`: `{projectslug}:` (lowercase, no hyphens)
   - `cookie_names`: `{ProjectName}Token`, `{ProjectName}RefreshToken`, `{ProjectName}AdminToken`
   - `db_name`: `{project_slug}_db`
3. Write `project-config.md`
4. Append new entry to `docs/project-registry.md`

---

## 3. tech-writer (opus)

**Role:** Write Sections 5-7 using extracted inventories + Feature PRD context

**Tools:** Read, Glob, Grep

**Input:**
- Feature PRD (full document)
- `entity-inventory.md`
- `permission-inventory.md`
- `integration-inventory.md`
- `project-config.md`

**Reference:**
- `depth-guide-tech.md`
- `prd-template-tech.md`

### Write-Mode Rules

#### Section 5 — Tech Stack & System Design
- Technologies table from detected framework/dependencies
- All 3rd party services from `integration-inventory.md`
- Key Decisions with rationale
- Environment Variables using values from `project-config.md`
- Conditional sections based on detected features

#### Section 6 — Data Model (Full Schema)
- Entity Relationships from `entity-inventory.md`
- Full Schema per entity:
  - Minimum 5 columns (excl. timestamps)
  - PK with generation strategy
  - FK with `(FK → entity.column)` notation
  - Constraints: NOT NULL, UNIQUE, DEFAULT
  - Timestamps: created_at, updated_at
  - Soft delete: deletedAt where applicable
- Status Enums matching Feature PRD Section 1
- Index Hints for search/filter columns
- Soft Delete table

#### Section 7 — Permission Matrix
- Action × Role Matrix from `permission-inventory.md`
  - All cells filled (no empty / `?`)
  - `own` notation for ownership-restricted actions
- Ownership Rules from Feature PRD Section 3/4
- Role Hierarchy

#### General Rules
- TBD handling: fill with `[💡 Recommended]` best-practice defaults
- All entities must trace back to Feature PRD (no phantom entities)
- Use `project-config.md` values for all ports, prefixes, cookie names

---

## 4. qa-tech (sonnet)

**Role:** Validate Technical PRD against tech-scoped rules

**Tools:** Read, Glob, Grep

**Input:**
- Technical PRD sections (5-7)
- Feature PRD (for cross-reference)
- `entity-inventory.md`
- `permission-inventory.md`
- `project-config.md`

### Validation Rules

| # | Rule | What It Checks |
|---|------|----------------|
| 9 | Tech Stack Completeness | Technologies table, 3rd party match, Key Decisions, Env Vars |
| 10 | Entity Coverage | CRUD entities from Feature PRD exist in Section 6 |
| 11 | Permission Completeness | All actions in Permission Matrix, no empty cells |
| 14 | Full Schema Completeness | All entities have schema, ≥5 columns, PK, FK |
| 16 | Config Uniqueness | No port/prefix/cookie/DB collisions |
| C1 | Cross-Phase Consistency | Section 5-7 entities match Feature PRD Section 3/4 |
| C2 | FK Integrity | All FK references valid |

### Rules
- NO subjective judgment
- ONLY counting, existence, matching
- Each FAIL: specific evidence
- PASS requires ALL rules to pass

---

## 5. support (sonnet)

**Role:** Fix QA FAIL items

**Tools:** Read, Write, Edit, Glob, Grep

### Fix Rules
1. ONLY fix FAIL items
2. Do NOT modify PASS sections
3. Do NOT add content beyond fixes
4. Maintain format and structure

---

## Agent Execution Order

```
Phase B1: Extract
  tech-parser (sonnet)      → entity-inventory, permission-inventory, integration-inventory
  config-allocator (sonnet) → project-config.md

Phase B2: Write
  tech-writer (opus)        → Sections 5-7

Phase B3: QA + Fix (max 3 rounds)
  qa-tech (sonnet)          → Validation results
  support (sonnet)          → Fixed sections (only if FAILs)

Phase B4: Merge + Deliver
  Merge Sections 5-7 into Feature PRD → Complete PRD
  Save final file
```

Phase B1 agents run in parallel (tech-parser and config-allocator are independent).
