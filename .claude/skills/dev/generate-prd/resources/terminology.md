# Terminology Template

A glossary of project-specific terms. Include every term that a new team member or stakeholder would need to understand the product.

---

## How to Write This Section

**Format:** Table with `Term` and `Definition` columns.
**Rule:** Define terms in plain language — no jargon inside the definition.
**Coverage:** Include domain terms, technical terms, user roles, and status/enum values.

---

## Template

```markdown
## Terminology

### Core Concepts

| Term | Definition |
|------|------------|
| **[Product Name]** | Brief description of what the product is |
| **[Core Entity 1]** | What this entity represents in the system |
| **[Core Entity 2]** | What this entity represents in the system |
| **[Key Feature]** | What this feature does and why it exists |

### [Domain-Specific Group]

| Term | Definition |
|------|------------|
| **[Term]** | Definition |

### User Roles

| Role | Description |
|------|-------------|
| **Guest** | Unauthenticated visitor — what they can access |
| **User** | Authenticated user — what they can do |
| **Admin** | Administrator — what they manage |
| **[Custom Role]** | Description |

### Status Values

| Term | Values | Meaning |
|------|--------|---------|
| **[StatusEnum]** | `PENDING`, `ACTIVE`, `COMPLETED`, `FAILED` | When each status applies |
| **[TypeEnum]** | `TYPE_A`, `TYPE_B` | What each type means |

### Technical Terms

| Term | Definition |
|------|------------|
| **[Tech Term]** | Plain-language explanation |
| **SSE** | Server-Sent Events — real-time one-way push from server to client |
| **JWT** | JSON Web Token — compact format for transmitting authentication claims |
```

---

## Categories to Cover

- **Core concepts** — main entities and features
- **Domain vocabulary** — industry/product-specific language
- **User roles** — who uses the product and at what permission level
- **Status/enum values** — all finite-state values in the system
- **Technical terms** — any technical abbreviations referenced in the PRD

---

**Related:** [prd-template.md](prd-template.md)
