# Mandatory Density Requirements — Technical PRD (Phase B)

> Goal: If these items are missing, QA FAIL.
> Phase B covers Sections 5-7. Feature density (Sections 0-4) is validated in Phase A.

---

## Section 5 — Tech Stack & System Design Density

### Technologies Table
- Layer, Technology, Version, Purpose — 4 columns required
- All layers: Backend, Language, ORM, Database, Frontend, Routing, State, CSS, Build

### Third-Party Integrations
- All services from Feature PRD Section 2's 3rd Party API List must also appear here
- Service, Purpose — minimum 2 columns

### Key Decisions
- Major technology choices with rationale
- Minimum 2

### Environment Variables
- All env vars needed for external service integration
- Variable, Description — 2 columns
- **Port and prefix values MUST be unique per project** (verified against project-registry.md)

### Conditional Sections Density
Only include when detected by parser. When included, minimum requirements:

**Auth Flow** (when auth features present):
- Authentication method (email/PW, OAuth providers)
- Token strategy (JWT access + refresh, session, etc.)
- Token storage location (httpOnly cookie, localStorage, etc.)
- Password requirements
- Social login callback flow

**File Pipeline** (when file upload present):
- Max file size
- Allowed MIME types
- Processing steps (resize dimensions, thumbnail generation)
- Storage destination (S3 bucket, CDN URL pattern)
- Cleanup policy for orphaned files

**Real-time Architecture** (when WebSocket/real-time present):
- Transport (WebSocket, SSE, polling fallback)
- Channel naming convention
- Authentication for WS connections
- Reconnection strategy (backoff, max retries)
- Key events summary table

**Billing Flow** (when billing/subscription present):
- Payment provider
- Plan structure (free/pro/enterprise)
- Webhook events to handle
- Refund/cancellation policy
- Grace period for failed payments

**Multi-tenancy** (when SaaS detected):
- Isolation level (row-level, schema-level, DB-level)
- Tenant identification (subdomain, header, path)
- Cross-tenant data access rules

---

## Section 6 — Data Model Density

### Entity Relationships
- All relationship types: 1:1, 1:N, N:N, self-reference
- N:N relationships: **join table name required**
- No ambiguous relationships — specific cardinality required

### Full Schema (MANDATORY)
Every entity MUST have a column-level table:

| Column | Type | Constraints |
|--------|------|-------------|

Requirements per entity:
- **Minimum 5 columns** (excluding timestamps)
- PK column with generation strategy (cuid, uuid, autoincrement)
- All FK columns with `(FK → entity.column)` notation
- NOT NULL / UNIQUE / DEFAULT constraints specified
- Enum columns reference Status Enum name
- created_at, updated_at timestamps included

### Status Enums
- Must match Feature PRD Section 1 Status Values
- Include DB stored value (integer)
- Specify which entity uses each enum

### Index Hints
- Index hints for search/filter target columns
- Entity, Column(s), Type, Reason — 4 columns
- Distinguish: UNIQUE, COMPOSITE, BTREE

### Soft Delete
- List of entities with soft delete
- Data retention period per entity

---

## Section 7 — Permission Matrix Density

### Action × Role Matrix
- **All CRUD resources** × **All roles** — no empty cells
- Edit/delete: specify ownership condition: `✅own` = own resources only
- No missing cells: `?` not allowed — must be `Yes` / `No` / `own`

### Ownership Rules
- "Own resource" definition: `resource.user_id === currentUser.id`
- Admin override rules

### Role Hierarchy
- Lower role → higher role order
- Inheritance rules specified

---

## QA Usage

QA agent validates against this guide:
- Section 5: Technologies empty or < 5 layers → FAIL (rule 9)
- Section 5: 3rd party service from Feature PRD missing → FAIL (rule 9)
- Section 5: Config value collision → FAIL (rule 16)
- Section 6: CRUD entity from Feature PRD missing → FAIL (rule 10)
- Section 6: Entity without Full Schema → FAIL (rule 14)
- Section 6: Schema with < 5 non-timestamp columns → FAIL (rule 14)
- Section 7: Action without Permission Matrix entry → FAIL (rule 11)
- Section 7: Empty cells → FAIL (rule 11)
- Cross-phase: entity in Section 5-7 not in Feature PRD Section 3/4 → FAIL (rule C1)
