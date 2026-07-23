# System Modules Template

Document the major functional modules of the product and their step-by-step flows. Modules are higher-level than pages — each module typically spans multiple screens and involves backend logic, third-party services, or device features.

Use this section to describe **how key features work end-to-end**, not just what UI appears on each page.

---

## How to Write This Section

- Identify the 3–6 major feature areas of the product (e.g., Authentication, Core Feature, Social, Notifications)
- For each module: describe the entry point, main features, and the technical flow
- Use numbered steps for flows — makes handoff to engineers unambiguous
- Note success and failure paths separately

---

## Template

```markdown
## [N]. System Modules

---

### Module 1 — [Module Name]

[1–2 sentence description of what this module does and why it exists.]

#### Main Features

1. [Feature name] — [brief description]
2. [Feature name] — [brief description]
3. [Feature name] — [brief description]

#### Technical Flow

##### [Flow 1 Name]

1. User [action that triggers the flow]
2. App [what happens client-side]
3. [Service/API] receives [what] and [does what]
4. On success:
   - [Result A]
   - [Result B]
5. On failure:
   - [Error case A] → [what user sees / what system does]
   - [Error case B] → [fallback behavior]

##### [Flow 2 Name] *(if applicable)*

1. [Step 1]
2. [Step 2]
3. [Step 3]

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

### Module [N] — [Module Name]

[Description]

#### Main Features

1. [Feature]
2. [Feature]

#### Technical Flow

1. [Step]
2. [Step]
```

---

## Common Module Patterns

These are the most common modules to document for software products:

| Module | What to Cover |
|--------|--------------|
| **Authentication** | Signup, login, social auth, token refresh, password reset, account status checks |
| **Core Feature / Primary Action** | The main thing the product does — capture, generate, book, purchase, etc. |
| **Content / Feed** | How content is aggregated, ranked, and displayed |
| **Search** | Search types (keyword, visual, geo), result ranking, empty states |
| **Social / Community** | Follow, like, comment, share, notifications |
| **Notifications** | Triggers, channels (push/email/in-app), templates, deep links |
| **Payments / Billing** | Checkout, subscription lifecycle, webhook handling |
| **Admin / Moderation** | Content review, user management actions, push sending |
| **AI / ML Integration** | Model call flow, success/failure handling, fallback behavior |
| **Location / Device** | GPS check-in, camera, photo library, permissions flow |

---

## Tips

- **Flows > Feature lists** — "User taps Capture → App encodes Base64 → Backend calls AI → ..." is more useful than "Supports artwork capture"
- **Always document failure paths** — what happens when the API fails, the model returns no match, the user denies a permission
- **Link to API specs** if your endpoints are documented separately
- **Note edge cases** inline — e.g., "Check-in resets on app restart" or "Session maintained if same session after termination and re-entry"

---

**Related:** [prd-template.md](prd-template.md) | [user-app-architecture.md](user-app-architecture.md)
