# Admin Dashboard — Architecture & Features Template

Template for documenting the page architecture and feature list of an admin dashboard. Applies to any platform that has a separate admin interface for managing users, content, settings, and operational data.

> **Note:** If the product does not have a separate admin dashboard, skip this section entirely from the PRD.

---

## Section 3.1 — Page Architecture

### How to Write This Section

List every admin route organized by management area. Admin dashboards typically follow CRUD patterns — adapt the template to match actual modules.

### Template

```markdown
### 3.1 Page Architecture

**Access:** Admin role only

#### Route Map

| Route | Page |
|-------|------|
| `/` | Dashboard Overview |
| `/[entity-1]` | [Entity 1] Management (list) |
| `/[entity-1]/:id` | [Entity 1] Detail / Edit |
| `/[entity-1]/new` | Create [Entity 1] |
| `/[entity-2]` | [Entity 2] Management |
| `/[entity-2]/:id` | [Entity 2] Detail / Edit |
| `/[operations]` | [Operations] Monitor |
| `/metadata` | Metadata / Reference Data |
| `/settings` | Platform Settings |
| `/tools` | Tools / Configuration |
```

---

## Section 3.2 — Feature List by Page

### How to Write This Section

For each admin page, describe what admins can see and do. Organize by management domain. Include both read and write capabilities.

### Template

```markdown
### 3.2 Feature List by Page

---

#### `/` — Dashboard Overview

**Stats Cards:**
- Total [primary entity count] (all time + this period)
- Active [operations/sessions] count
- [Revenue / API usage / other key metric]
- [Custom KPI relevant to the platform]

**Charts:**
- [Registrations / activity] over time (weekly/monthly)
- [Key metric] distribution by type or status
- [Usage/conversion] trends

**Recent Activity:**
- Latest [events] feed
- Quick navigation to common management tasks

---

#### `/[entity]` — [Entity] Management

**List View:**
- Table with columns: [Name], [Key Field], [Status], [Created Date], [Actions]
- Search by [name or identifier]
- Filter by: [status], [type], [date range]
- Sort by any column

**Bulk Actions:**
- [Status change] for selected items
- [Delete / archive] selected items
- Export list as CSV

**Per-Item Actions:**
- View detail
- Edit [fields]
- Change status (active/inactive)
- Delete (soft delete with confirmation)

---

#### `/[entity]/:id` — [Entity] Detail / Edit

- Full [entity] profile: all fields displayed
- Edit form for all editable fields
- Related records (e.g., user's orders, sessions, activity)
- Activity log for this [entity]
- [Entity]-specific actions: [e.g., impersonate, reset password, override quota]

---

#### `/[entity]/new` — Create [Entity]

- Form for all required fields
- Validation with clear error messages
- Preview before saving (if applicable)
- Save → redirects to list or detail page

---

#### `/[operations]` — [Operations] Monitor

- List of all active and historical [operations/sessions/jobs]
- Columns: ID, User/Owner, Type, Status, Started, Completed, Duration
- Filter by: Status (`PENDING`, `IN_PROGRESS`, `COMPLETED`, `FAILED`)
- Filter by: Type, Date range, User
- Status summary cards (count per status)
- Per-operation actions: View details, Cancel (if in-progress), Retry (if failed)

---

#### `/metadata` — Metadata / Reference Data

Manage dynamic lookup values used throughout the platform (e.g., categories, tags, types).

- List all metadata items with type and usage count
- Add / edit / delete metadata values
- Organize by type (e.g., `CATEGORY`, `TAG`, `STYLE`, `STATUS`)
- Reorder items (drag-and-drop or numeric order field)
- Prevent deletion if item is in use (show warning)

---

#### `/settings` — Platform Settings

**General:**
- Platform name, logo, contact info
- Feature flags (enable/disable major features)
- Default limits and quotas

**Integrations:**
- [Third-party API key management] (view masked, update)
- [Webhook URLs or endpoint configuration]
- [Email/SMTP settings]

**Storage:**
- [File storage configuration]

**Notifications:**
- [System alert thresholds]
- [Admin notification preferences]

---

#### `/tools` — Tools / Configuration

Manage reusable templates, prompts, scripts, or configurations used by the platform.

- List all tools with name, type, last modified
- Create / edit / delete tools
- [Variable/template support if applicable]
- Preview tool output with sample inputs
- Version or audit history (if applicable)
```

---

## Common Admin Patterns

| Pattern | When to Use |
|---------|-------------|
| **CRUD pages per entity** | User management, content management, product management |
| **Operations monitor** | Job queues, generation sessions, async tasks |
| **Metadata management** | Dynamic dropdowns, categories, tags |
| **Settings page** | API keys, feature flags, system config |
| **Tools/templates** | Reusable content or AI prompt management |
| **Bulk actions** | Any list page where admins need to act on many items |

---

**Related:** [user-app-architecture.md](user-app-architecture.md) | [prd-template.md](prd-template.md)
