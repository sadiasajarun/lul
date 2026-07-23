# PRD — Assembled Template

Copy and fill in this template to produce a complete PRD. Replace all `[bracketed placeholders]` with project-specific content. Remove sections that don't apply.

---

```markdown
# [Product Name] — Product Requirements Document

**Version:** 1.0
**Date:** [DATE]
**Status:** Draft

---

## 0. Project Overview

### Product

**Name:** [Product Name]
**Type:** [Mobile App / Web App / SaaS Platform]
**Deadline:** [Date or milestone]
**Status:** Draft

### Description

[2–4 sentences. What does this product do, who is it for, what makes it distinctive?]

### Goals

1. [Primary goal — main problem this product solves]
2. [Secondary goal]
3. [Secondary goal]

### Target Audience

| Audience | Description |
|----------|-------------|
| **Primary** | [Main user group — who they are, what they want] |
| **Secondary** | [Second group, if applicable] |

### User Types

| Type | DB Value | Description | Key Actions |
|------|----------|-------------|-------------|
| **[General User]** | `0` | [Who they are] | [What they mainly do] |
| **[Power User / Artist / etc.]** | `1` | [Who they are] | [What they mainly do] |
| **Admin** | `99` | Platform administrator | Manage users, content, settings |

### User Status

| Status | DB Value | Behavior |
|--------|----------|----------|
| **Active** | `0` | Full access |
| **Suspended** | `1` | Cannot log in — show: "[suspension message]" |
| **Withdrawn** | `2` | Data retained [X] days then deleted |

### MVP Scope

**Included:**
- [Feature 1]
- [Feature 2]
- [Feature 3]

**Excluded (deferred):**
- [Feature deferred to later phase]
- [Feature deferred to later phase]

---

## 1. Terminology

### Core Concepts

| Term | Definition |
|------|------------|
| **[Product Name]** | [One-sentence description] |
| **[Core Entity]** | [What it represents in the system] |
| **[Key Feature]** | [What it does] |

### User Roles

| Role | Description |
|------|-------------|
| **Guest** | [What a guest can access] |
| **User** | [What an authenticated user can do] |
| **Admin** | [What an admin manages] |

### Status Values

| Enum | Values | Description |
|------|--------|-------------|
| **[StatusEnum]** | `PENDING`, `ACTIVE`, `COMPLETED` | [When each applies] |

### Technical Terms

| Term | Definition |
|------|------------|
| **[Term]** | [Plain-language explanation] |

---

## 2. System Modules

### Module 1 — [Module Name]

[1–2 sentence description of what this module does.]

#### Main Features

1. [Feature] — [brief description]
2. [Feature] — [brief description]
3. [Feature] — [brief description]

#### Technical Flow

##### [Flow Name]

1. User [triggers action]
2. App [client-side behavior]
3. [Backend/Service] receives [what] and [does what]
4. On success:
   - [Result A]
   - [Result B]
5. On failure:
   - [Error case] → [what user sees / fallback]

---

### Module 2 — [Module Name]

[Description]

#### Main Features

1. [Feature]
2. [Feature]

#### Technical Flow

1. [Step]
2. [Step]
3. On success: [result]
4. On failure: [fallback]

---

### Module 3 — [Module Name]

[Description]

#### Main Features

1. [Feature]
2. [Feature]

#### Technical Flow

1. [Step]
2. [Step]

---

## 3. User Application

### 3.1 Page Architecture

**Stack:** [Framework, Router, State management, CSS]

#### Route Groups

| Group | Access |
|-------|--------|
| Public | Anyone |
| Auth | Unauthenticated only |
| Protected | Logged-in users |

#### Page Map

**Public**
| Route | Page |
|-------|------|
| `/` | Home |
| `/[resource]` | [Resource] List |
| `/pricing` | Pricing |

**Auth**
| Route | Page |
|-------|------|
| `/auth/login` | Login |
| `/auth/register` | Register |
| `/auth/forgot-password` | Forgot Password |

**Protected**
| Route | Page |
|-------|------|
| `/dashboard` | Dashboard |
| `/[resource]` | My [Resources] |
| `/[resource]/:id` | [Resource] Editor |
| `/settings` | Settings |
| `/billing` | Billing |

---

### 3.2 Feature List by Page

#### `/` — Home

- [Feature 1]
- [Feature 2]
- [Feature 3]

---

#### `/[resource]` — [Resource] List

- Search by keyword
- Filter by: [filter1], [filter2]
- Sort by: [option1], [option2]
- [Resource] card with: [fields shown]
- Actions: [view, quick-action]

---

#### `/auth/login` — Login

- Email + password form
- Link to register and forgot password
- Redirect to dashboard on success

---

#### `/auth/register` — Register

- [Required fields]
- Email verification
- Redirect after signup

---

#### `/dashboard` — Dashboard

- Stats: [stat1], [stat2], [stat3]
- Recent [items]
- Quick actions

---

#### `/[resource]` — My [Resources]

- List/grid with search and filters
- Actions: [edit, delete, export, share]
- Empty state with CTA

---

#### `/[resource]/:id` — [Resource] Editor

- [Resource] preview/viewer
- Edit: [how — inline / form / modal]
- Manage [sub-items] (if applicable)
- Actions: Save, Export, Delete

---

#### `/settings` — Settings

- **Profile:** name, avatar
- **Security:** change password
- **Account:** change email, delete account

---

#### `/billing` — Billing

- Current plan and renewal date
- Usage vs. quota
- Payment history
- Manage subscription

---

## 4. Admin Dashboard

> Skip this section if there is no separate admin interface.

### 4.1 Page Architecture

**Access:** Admin role only

| Route | Page |
|-------|------|
| `/` | Dashboard Overview |
| `/users` | User Management |
| `/users/:id` | User Detail |
| `/[entity]` | [Entity] Management |
| `/[entity]/:id` | [Entity] Detail |
| `/[operations]` | Operations Monitor |
| `/metadata` | Metadata Management |
| `/settings` | Platform Settings |

---

### 4.2 Feature List by Page

#### `/` — Dashboard Overview

- Stats: total users, [key metric], [active operations]
- Charts: [metric] over time, [distribution]
- Recent activity feed

---

#### `/users` — User Management

- List with search and filters (role, status)
- Edit role, status
- Override [quota/limits]
- Bulk actions: [status change, delete]

---

#### `/users/:id` — User Detail

- Full profile and account info
- Subscription/plan status
- List of [user's resources and activity]
- Admin actions: edit role, override limits, suspend

---

#### `/[entity]` — [Entity] Management

- List with search and filters
- Toggle status (active/inactive)
- Create new, edit, delete
- Bulk actions

---

#### `/[operations]` — Operations Monitor

- All [jobs/sessions] with status filter
- Status summary cards
- Per-item actions: view details, cancel, retry

---

#### `/metadata` — Metadata Management

- CRUD for dynamic lookup values
- Organized by type (categories, tags, etc.)
- Usage count per item
- Reorder capability

---

#### `/settings` — Platform Settings

- General config (name, logo, limits)
- API key management (masked view, update)
- Email / SMTP configuration
- Storage configuration

---

## 5. Tech Stack

### Architecture

[1–2 sentence overview]

```
[project]/
├── [backend]/    ← [Backend framework] API
├── [frontend]/   ← [Frontend framework] user app
└── [admin]/      ← Admin dashboard (if separate)
```

### Technologies

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Backend | [Framework] | [x.x] | API server |
| Language | [Language] | [x.x] | — |
| ORM | [ORM] | [x.x] | Database access |
| Database | [DB] | [x.x] | Primary data store |
| Frontend | [Framework] | [x.x] | UI |
| Routing | [Router] | [x.x] | Client routing |
| State | [State mgmt] | — | Global state |
| CSS | [CSS lib] | [x.x] | Styling |
| Build | [Build tool] | — | Bundler |

### Third-Party Integrations

| Service | Purpose |
|---------|---------|
| [Auth provider] | [Authentication] |
| [AI service] | [AI features] |
| [Payment] | [Subscriptions/payments] |
| [Storage] | [File storage] |
| [Email] | [Transactional email] |

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| [Choice] | [Why] |
| [Choice] | [Why] |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `[DB_URL]` | Database connection |
| `[API_KEY]` | External service key |
| `[FRONTEND_URL]` | Frontend base URL |

---

## 6. Open Questions

| # | Question | Context / Impact | Owner | Status |
|:-:|----------|-----------------|-------|--------|
| 1 | [Question?] | [Why it matters — what gets blocked if unresolved] | [Owner] | ⏳ Open |
| 2 | [Question?] | [Context] | [Owner] | ⏳ Open |
```

---

**Instructions:**
1. Replace all `[bracketed placeholders]` with actual content
2. Delete sections that don't apply (e.g., skip admin section if no admin dashboard)
3. Add rows and sub-sections as needed — the template is a starting point
4. Keep descriptions concise — one clear sentence per feature
5. Mark open questions ✅ Resolved when answered, or remove them

---

**Related:** [SKILL.md](../SKILL.md) | [project-overview.md](project-overview.md) | [terminology.md](terminology.md) | [modules.md](modules.md) | [user-app-architecture.md](user-app-architecture.md) | [admin-dashboard-architecture.md](admin-dashboard-architecture.md) | [tech-stack.md](tech-stack.md) | [open-questions.md](open-questions.md)
