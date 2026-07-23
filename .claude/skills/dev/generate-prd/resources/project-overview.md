# Project Overview Template

The first section of any PRD. Gives readers everything they need to understand what the product is, who it's for, and what success looks like — before diving into details.

---

## How to Write This Section

Cover these sub-sections in order. Keep each concise — this is a summary, not the full spec.

---

## Template

```markdown
## 0. Project Overview

### Product

**Name:** [Product Name]
**Type:** [e.g., Mobile App / Web App / SaaS Platform / API Service]
**Version:** [1.0 / MVP / Phase 2]
**Deadline:** [Date or milestone] *(if applicable)*
**Status:** [Draft / In Review / Approved]

---

### Description

[2–4 sentences describing what the product does, who it's for, and what makes it distinctive.
Focus on the user value, not technical implementation.]

---

### Goals

1. [Primary goal — the main problem this product solves]
2. [Secondary goal]
3. [Secondary goal]
4. [Secondary goal]

---

### Target Audience

| Audience | Description |
|----------|-------------|
| **Primary** | [Main user group — who they are, what they want] |
| **Secondary** | [Second user group, if applicable] |
| **Tertiary** | [Third user group, e.g., admins, artists, gallery operators] |

---

### User Types

| Type | DB Value | Description | Key Actions |
|------|----------|-------------|-------------|
| **[Type 1]** | `0` | [Who they are] | [What they mainly do] |
| **[Type 2]** | `1` | [Who they are] | [What they mainly do] |
| **Admin** | `99` | Platform administrator | [Manage users, content, settings] |

---

### User Status

| Status | DB Value | Description | Behavior |
|--------|----------|-------------|----------|
| **Active** | `0` | Normal account | Full access |
| **Suspended** | `1` | Temporarily restricted | Cannot log in; show message: "[message]" |
| **Withdrawn** | `2` | Deactivated account | Data retained for [X] days then deleted |

---

### MVP Scope

**Included in MVP:**
- [Feature or module 1]
- [Feature or module 2]
- [Feature or module 3]

**Explicitly excluded from MVP:**
- [Feature deferred to later phase]
- [Feature deferred to later phase]

---

### Out of Scope

> Features that are intentionally not part of this product at any phase (not just deferred).

- [Feature that will never be built here]
- [Integration that is out of scope]
```

---

## Checklist

- [ ] Product name, type, deadline, status
- [ ] 2–4 sentence description (user-focused, not technical)
- [ ] Goals listed in priority order
- [ ] Target audience broken out by group
- [ ] User types with DB values if applicable
- [ ] User status with behaviors (what happens on login failure, auto-logout, etc.)
- [ ] MVP scope — explicit list of what's in and what's out
- [ ] Out of scope — features intentionally never being built

---

**Related:** [prd-template.md](prd-template.md)
