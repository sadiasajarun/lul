# User Application — Architecture & Features Template

Template for documenting the page architecture and feature list of a user-facing web or mobile application.

---

## Section 2.1 — Page Architecture

### How to Write This Section

List every route/screen in the app organized by access level. Use a table with route, page name, and access control.

**Access levels:**
- **Public** — accessible without login
- **Auth only** — login/registration pages (redirect if already logged in)
- **Protected** — requires authentication

### Template

```markdown
### 2.1 Page Architecture

#### Route Groups

| Group | Description |
|-------|-------------|
| **Public** | Accessible to anyone without an account |
| **Auth** | Login, register, password flows (guest only) |
| **Protected** | Requires an active session |

#### Page Map

**Public Routes**
| Route | Page Name | Notes |
|-------|-----------|-------|
| `/` | Home / Landing | Hero, features, CTA |
| `/[resource]` | [Resource] List | Browse/search |
| `/[resource]/:id` | [Resource] Detail | View single item |
| `/pricing` | Pricing | Plan comparison |
| `/about` | About | Company/product info |

**Auth Routes**
| Route | Page Name |
|-------|-----------|
| `/auth/login` | Login |
| `/auth/register` | Register |
| `/auth/forgot-password` | Forgot Password |

**Protected Routes**
| Route | Page Name | Notes |
|-------|-----------|-------|
| `/dashboard` | Dashboard | User home |
| `/[resource]` | My [Resources] | User's own items |
| `/[resource]/:id` | [Resource] Detail/Editor | View and edit |
| `/settings` | Settings | Profile, security, preferences |
| `/billing` | Billing | Subscription and payments |
```

---

## Section 2.2 — Feature List by Page

### How to Write This Section

For each page, list its features as bullet points or sub-tables. Be specific — "Search by keyword" is better than "Search".

### Template

```markdown
### 2.2 Feature List by Page

---

#### `/` — Home / Landing

- Hero section with primary CTA
- Product feature highlights
- [Feature showcase] (e.g., demo, screenshots, examples)
- Social proof (testimonials, logos, stats)
- Navigation to main sections

---

#### `/[resource]` — [Resource] List / Gallery

- Search by keyword
- Filter by: [filter1], [filter2], [filter3]
- Sort by: [option1], [option2]
- Pagination or infinite scroll
- [Resource] card with: [thumbnail/title/meta/CTA]

---

#### `/[resource]/:id` — [Resource] Detail

- Full [resource] display
- [Resource] metadata: [field1], [field2]
- Primary action: [e.g., Buy, Use, Fork, Edit]
- Related [resources] or recommendations

---

#### `/auth/login` — Login

- Email + password form
- "Remember me" option
- Link to register and forgot password
- OAuth social login (if applicable)
- Redirect to dashboard on success

---

#### `/auth/register` — Register

- [Required fields: name, email, password]
- Email verification (OTP or link)
- Terms of service acceptance
- Redirect to onboarding or dashboard

---

#### `/auth/forgot-password` — Forgot Password

- Email input for reset link/code
- OTP or link verification
- New password form

---

#### `/dashboard` — Dashboard / Home

- Welcome message with user info
- Summary stats: [stat1], [stat2], [stat3]
- Recent activity or items
- Quick action shortcuts

---

#### `/[resource]` — My [Resources]

- List/grid of user's own [resources]
- Search and filter controls
- Sort options
- Actions per item: [open, edit, delete, export, share]
- Empty state with CTA if no items

---

#### `/[resource]/:id` — [Resource] Editor / Detail

- [Resource] viewer / preview
- Edit controls: [inline edit / form / modal]
- [Page/section] management (if multi-part)
- Action buttons: [Save, Export, Share, Delete]
- History or version list (if applicable)

---

#### `/settings` — Settings

**Profile:**
- Edit name, avatar, display preferences

**Security:**
- Change password (current password required)
- [Two-factor auth, if applicable]

**Account:**
- Change email (with verification)
- Delete account (with confirmation)

**Preferences:**
- [Notification settings]
- [Display/theme settings]

---

#### `/billing` — Billing & Subscription

- Current plan name, status, renewal date
- Usage vs. quota display
- Upgrade / downgrade options
- Payment history table
- Link to billing portal or payment method management
```

---

**Related:** [admin-dashboard-architecture.md](admin-dashboard-architecture.md) | [prd-template.md](prd-template.md)
