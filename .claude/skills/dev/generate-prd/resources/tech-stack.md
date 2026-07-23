# Tech Stack Template

Template for documenting the technology stack of any software project.

---

## 🔒 Fill from the declared stack only (read first)

This is a **formatting template**, not a place to choose the stack. The PRD is written
BEFORE the fullstack pipeline runs, so `CLAUDE.md` / `PIPELINE_STATUS.md` do not exist yet —
do not rely on them. Fill every placeholder below (`[Framework]`, `[ORM / DB client]`,
`[State management]`, `[Database]`, …) **only** from the stack rules that ship with the
`.claude` submodule — never from memory, habit, or a generic default:

- `.claude/rules/stacks/*.rules.md` — declares the backend framework + ORM and the
  frontend framework + data layer + any prohibited libraries
- `.claude/<backend>/` and `.claude/<frontend>/` submodule guides — detailed patterns

**Versions** are not in the stack rules — take them from the scaffold `package.json` (the
version source of truth): `.claude/<frontend>/templates/package.json` for the frontend, and
the backend scaffold `package.json` (init blueprint, or `backend/package.json` once
scaffolded). Reflect the major version line (e.g. `^10.3.0` → "10.x").

If a value is pinned in neither the stack rules nor the scaffold, write "TBD — client
confirmation needed" instead of guessing. Do not introduce any library that contradicts the
declared stack. (See SKILL.md Step 4 "Tech Stack Source of Truth" and Step 5.4.1 trace check.)

---

## How to Write This Section

Cover four areas:
1. **Architecture overview** — high-level structure (monorepo? microservices? serverless?)
2. **Technologies per layer** — backend, frontend, database, infrastructure
3. **Third-party integrations** — external services and APIs
4. **Environment variables** — configuration reference

Use tables. Include versions where they matter.

---

## Template

```markdown
## Tech Stack

### Architecture Overview

[Describe the overall structure in 1-3 sentences. Example: "Monorepo with separate backend API, user web app, and admin dashboard. Backend communicates with frontend via REST API and SSE for real-time updates."]

```
[Project Name]/
├── [backend-dir]/        ← [Backend framework] API (port [xxxx])
├── [frontend-dir]/       ← [Frontend framework] user app (port [xxxx])
├── [admin-dir]/          ← Admin dashboard (port [xxxx])  ← (if separate)
└── docker-compose.yml
```

---

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **[Framework]** | [x.x] | API server framework |
| **[Language]** | [x.x] | Programming language |
| **[ORM / DB client]** | [x.x] | Database access layer |
| **[Auth library]** | — | Authentication middleware |
| **[Validation]** | — | Input validation |
| **[Other]** | — | [Purpose] |

**Architecture pattern:** [e.g., "Four-layer: Controller → Service → Repository → Entity"]

**Key conventions:**
- [Convention 1, e.g., "All entities use UUID primary keys and soft deletes via deletedAt"]
- [Convention 2, e.g., "Auth via JWT stored in HTTP-only cookies"]
- [Convention 3]

---

### Frontend (User App)

| Technology | Version | Purpose |
|------------|---------|---------|
| **[Framework]** | [x.x] | UI framework |
| **[Routing]** | [x.x] | Client-side routing |
| **[State management]** | — | Global state |
| **[CSS framework]** | [x.x] | Styling |
| **[Component library]** | — | UI components |
| **[HTTP client]** | — | API requests |
| **[Build tool]** | — | Bundler / dev server |

**Key patterns:**
- [e.g., "Axios instance with base URL from env var and cookie credentials"]
- [e.g., "SSE via EventSource for real-time progress with fallback polling"]

---

### Admin Dashboard *(if separate application)*

| Technology | Version | Purpose |
|------------|---------|---------|
| **[Framework]** | [x.x] | UI framework |
| **[Other]** | — | [Purpose] |

---

### Database

| Technology | Version | Purpose |
|------------|---------|---------|
| **[Database]** | [x.x] | Primary data store |
| **[Cache]** | [x.x] | Caching layer *(if applicable)* |

**Key decisions:**
- [e.g., "All entities use soft deletes — records are never hard-deleted"]
- [e.g., "UUID primary keys on all tables"]
- [e.g., "[N] migration files managed by ORM"]

---

### Third-Party Integrations

| Service | Purpose | Notes |
|---------|---------|-------|
| **[Service 1]** | [What it does] | [Auth method, SDK or raw API, etc.] |
| **[Service 2]** | [What it does] | [Notes] |
| **[AI/ML service]** | [Purpose] | [Model used, streaming support, etc.] |
| **[Payment processor]** | [Subscriptions, one-time payments] | [Webhook required?] |
| **[Storage]** | [File/asset storage] | [Bucket/container config] |
| **[Email]** | [Transactional email] | [SMTP or API-based] |
| **[Notifications]** | [Push notifications] | [Service used] |

---

### Infrastructure & DevOps

| Tool | Purpose |
|------|---------|
| **[Container tool]** | Local development environment |
| **[Process manager]** | Production process management |
| **[CI/CD]** | Continuous integration and deployment |
| **[Hosting]** | Cloud provider / hosting platform |

**Development setup:**
```bash
# [Backend]
cd [backend-dir] && [install] && [run dev]

# [Frontend]
cd [frontend-dir] && [install] && [run dev]
```

---

### Environment Variables

**Backend:**

| Variable | Description | Required |
|----------|-------------|----------|
| `[DB_URL]` | Database connection string | Yes |
| `[AUTH_SECRET]` | JWT or session secret | Yes |
| `[EXTERNAL_API_KEY]` | [Service] API key | Yes |
| `[STORAGE_BUCKET]` | File storage bucket name | Yes |
| `[SMTP_HOST]` | Email server host | Yes |
| `[FRONTEND_URL]` | Frontend URL for links in emails | Yes |

**Frontend:**

| Variable | Description |
|----------|-------------|
| `[VITE_API_URL]` | Backend API base URL |
| `[Other env var]` | [Description] |

---

### Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| [Technology choice] | [Why it was chosen] |
| [Architecture decision] | [Why this approach] |
| [Framework version] | [Reason for specific version] |
```

---

## Checklist

When filling in the tech stack section, make sure to include:

- [ ] All major technologies with versions
- [ ] Purpose of each layer (don't just list names)
- [ ] All third-party services (even email, storage, notifications)
- [ ] Key architectural patterns or conventions
- [ ] All environment variables (backend and frontend)
- [ ] Key technical decisions with rationale

---

**Related:** [prd-template.md](prd-template.md)
