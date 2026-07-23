# Technical PRD Output Template (v4 — Phase B)

This file defines the exact structure for `/generate-prd --tech` (Phase B — Technical PRD) output.
Phase B is derived FROM a completed Feature PRD (Phase A). It generates Sections 5-7 and merges them into the Feature PRD to produce a complete PRD.

> **Template Maintenance Rule**: All sections, fields, and checklists must remain generic and applicable to ANY project.
> Project-specific terms may ONLY appear in `Example:` blocks. When adding a useful pattern, generalize it first.

> **Input Requirement**: Phase B REFUSES to run if the Feature PRD contains unresolved `[💡 Recommended:]` markers.
> All feature decisions must be confirmed by PM before technical specs are generated.

> **TBD Handling**: All technical decisions use `[💡 Recommended]` with best-practice defaults.
> Developer team reviews (not PM/client). No PM confirmation gate for Phase B.

> **Conditional Sections**: Section 5 contains conditional subsections (Auth Flow, File Pipeline, Real-time Architecture, Billing Flow, Multi-tenancy).
> Include each subsection ONLY when the corresponding feature is detected.

---

## Section 5: Tech Stack & System Design

### Technologies

| Category | Technology | Version | Rationale |
|----------|-----------|---------|-----------|
| Frontend Framework | [Next.js / Nuxt / etc.] | [Version] | [Why chosen] |
| Backend Framework | [NestJS / Express / FastAPI / etc.] | [Version] | [Why chosen] |
| Database | [PostgreSQL / MySQL / MongoDB / etc.] | [Version] | [Why chosen] |
| ORM | [Prisma / TypeORM / Sequelize / etc.] | [Version] | [Why chosen] |
| Cache | [Redis / Memcached / None] | [Version] | [Why chosen] |
| Search | [Elasticsearch / Meilisearch / None] | [Version] | [Why chosen] |
| File Storage | [S3 / GCS / Local / None] | - | [Why chosen] |
| Deployment | [Vercel / AWS / Docker / etc.] | - | [Why chosen] |

### Third-Party Integrations

| Service | Purpose | SDK/API | Env Variables Required |
|---------|---------|---------|----------------------|
| [Stripe] | [Payment processing] | [stripe npm package] | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| [SendGrid] | [Transactional email] | [REST API] | `SENDGRID_API_KEY` |

### Key Architectural Decisions

| # | Decision | Rationale | Trade-offs |
|---|----------|-----------|------------|
| 1 | [Decision] | [Why] | [Trade-off] |

### Environment Variables

> Port and prefix values MUST be unique per project.
> Check `claude-operations/docs/project-registry.md` for allocated values.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | Yes | `{BACKEND_PORT}` | Backend server port (unique, range 3000-3099) |
| `FRONTEND_URL` | Yes | `http://localhost:{FRONTEND_PORT}` | Frontend dev server URL |
| `DATABASE_URL` | Yes | — | Database connection string |
| `POSTGRES_DATABASE` | Yes | `{project_slug}_db` | Database name (unique) |
| `JWT_SECRET` | Yes | — | Secret for signing JWT tokens |
| `AUTH_TOKEN_COOKIE_NAME` | No | `{ProjectName}Token` | JWT cookie name (unique) |
| `AUTH_ADMIN_TOKEN_COOKIE_NAME` | No | `{ProjectName}AdminToken` | Admin JWT cookie name (unique) |
| `REDIS_PREFIX` | No | `{projectslug}:` | Redis key prefix (unique) |
| `VITE_API_URL` | Yes | `http://localhost:{BACKEND_PORT}/api` | Public API base URL |

---

### Conditional Section: Auth Flow

> Include ONLY when authentication features are detected.

**Authentication Method:** [JWT / Session / OAuth2]

**Token Strategy:**
- Access token: [Type, expiry, storage (httpOnly cookie / localStorage)]
- Refresh token: [Type, expiry, rotation policy]
- Token refresh flow: [Auto silent refresh / redirect on expiry]

**Login Flow:**
```
1. User submits credentials → POST /api/auth/login
2. Server validates credentials
3. Server issues access + refresh tokens
4. Client stores tokens in [storage]
5. Client redirects to [dashboard/home]
```

**Social Login Flow** *(if applicable)*
```
1. User clicks [Provider] login button
2. Redirect to OAuth consent screen
3. Provider redirects back with auth code
4. Server exchanges code for tokens
5. Server creates/links user account
6. Server issues application tokens
7. Client redirects to [dashboard/home]
```

**Password Reset Flow:**
```
1. User submits email → POST /api/auth/forgot-password
2. Server generates reset token (expires [duration])
3. Server sends email with reset link
4. User clicks link → GET /reset-password?token=[token]
5. User submits new password → POST /api/auth/reset-password
6. Server validates token, updates password, invalidates sessions
7. Redirect to login
```

---

### Conditional Section: File Pipeline

> Include ONLY when file upload features are detected.

**Upload Config:**
- Max file size: [e.g., 10MB]
- Allowed types: [e.g., image/jpeg, image/png, application/pdf]
- Upload method: [Direct / Server proxy / Presigned URL]

**Processing Pipeline:**

| Step | Process | Input | Output | Async |
|------|---------|-------|--------|-------|
| 1 | [Virus scan] | [Raw upload] | [Clean file] | [Yes/No] |
| 2 | [Image resize] | [Original] | [thumb 150x150, medium 600x600, large 1200x1200] | [Yes/No] |

**Storage:**
- Provider: [S3 / GCS / local]
- Path: `[bucket]/[entity-type]/[entity-id]/[timestamp]-[hash].[ext]`
- Access: [Public / Signed URLs / Private]
- CDN: [CloudFront / Cloudflare / None]
- Cleanup: [Orphan files deleted after X days]

---

### Conditional Section: Real-time Architecture

> Include ONLY when WebSocket or real-time features are detected.

**Connection:**
- Protocol: [WebSocket / SSE / Socket.IO]
- Auth: [Token in query / Cookie / First message auth]
- Heartbeat: [30s]

**Channel Structure:**

| Channel Pattern | Purpose | Subscribers | Publishers |
|----------------|---------|-------------|-----------|
| `user:{userId}` | [Personal notifications] | [The user] | [Server] |
| `room:{roomId}` | [Chat messages] | [Room members] | [Room members] |

**Reconnection:**
- Strategy: [Exponential backoff]
- Initial: [1s], Max: [30s], Attempts: [10]
- Recovery: [Fetch missed events / Full refresh]

---

### Conditional Section: Billing Flow

> Include ONLY when billing/subscription features are detected.

**Provider:** [Stripe / Paddle / etc.]

**Plans:**

| Plan | Price | Cycle | Features | Limits |
|------|-------|-------|----------|--------|
| [Free] | $0 | — | [Features] | [Limits] |
| [Pro] | $[X]/mo | Monthly/Annual | [Features] | [Limits] |

**Webhook Events:**

| Event | Action | Retry Policy |
|-------|--------|-------------|
| `checkout.session.completed` | [Activate subscription] | [3 retries] |
| `invoice.payment_failed` | [Downgrade, notify user] | [3 retries] |

---

### Conditional Section: Multi-tenancy

> Include ONLY when SaaS/multi-tenant features are detected.

**Isolation:** [Row-level / Schema per tenant / DB per tenant]
**Tenant ID:** [Column on all tables / Schema name / DB name]
**Query enforcement:** [Middleware / ORM filter / RLS]
**Cross-tenant rules:** [API scoping, DB layer, file storage, cache]

---

## Section 6: Data Model — Full Schema

### Entity Relationships

| Entity A | Relationship | Entity B | Description |
|----------|-------------|----------|-------------|
| [User] | 1:N | [Post] | [A user can create many posts] |
| [Post] | N:N | [Tag] | [Join table: PostTag] |
| [User] | 1:1 | [Profile] | [Each user has one profile] |

**Join Tables:**

| Join Table | Left Entity | Right Entity | Extra Columns |
|-----------|-------------|-------------|---------------|
| [PostTag] | [Post] | [Tag] | [None / createdAt] |

---

### Full Schema

> Column-level schema for every entity. Include ALL columns.

#### [entity_name]

| Column | Type | Constraints |
|--------|------|------------|
| id | String | PK, cuid() |
| [field] | [Type] | [Constraints: NOT NULL, UNIQUE, DEFAULT, FK → entity.column] |
| createdAt | DateTime | NOT NULL, DEFAULT now() |
| updatedAt | DateTime | NOT NULL, auto-update |
| deletedAt | DateTime | NULLABLE (soft delete) |

*(Minimum 5 columns excluding timestamps. Repeat for every entity.)*

---

### Status Enums

| Enum Name | Value | Label | Used By |
|-----------|-------|-------|---------|
| [UserStatus.ACTIVE] | `1` | Active | users |

### Index Hints

| Entity | Column(s) | Type | Reason |
|--------|-----------|------|--------|
| users | email | UNIQUE | Login lookup |
| users | status, createdAt | COMPOSITE | Admin filter + sort |

### Soft Delete

| Entity | Soft Delete | Retention Period | Hard Delete Policy |
|--------|------------|-----------------|-------------------|
| users | Yes | 90 days | GDPR request or after retention |

---

## Section 7: Permission Matrix

### Action x Role Matrix

> `own` means the user can only perform the action on resources they own.

| Action | [Guest] | [User] | [Moderator] | [Admin] |
|--------|---------|--------|-------------|---------|
| View public [resources] | Yes | Yes | Yes | Yes |
| Create [resource] | No | Yes | Yes | Yes |
| Edit [resource] | No | own | Yes | Yes |
| Delete [resource] | No | own | Yes | Yes |
| Manage users | No | No | No | Yes |
| Access admin | No | No | No | Yes |

### Ownership Rules

| Resource | Owner Field | Ownership Determined By |
|----------|-----------|------------------------|
| [Post] | `authorId` | [User who created the post] |

### Role Hierarchy

```
[Guest] (no auth)
  └── [User] (authenticated)
       └── [Moderator] (elevated)
            └── [Admin] (full access)
```

**Escalation rules:**
- [Only Admin can promote roles]
- [Role changes logged in audit trail]
