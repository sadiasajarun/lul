# Mandatory Density Requirements — Feature PRD (Phase A)

> Goal: Not "write more" but "if these items are missing, QA FAIL".
> Phase A covers Sections 0-4 + 2.5. Technical density (Sections 5-7) is in Phase B.

---

## Section 0 — Project Overview Density

### Business Context (NEW)
- Business Model field required — specify revenue structure
- Core Value Proposition — one sentence differentiator
- If client did not specify business model → `[💡 Recommended]` with rationale based on app type

### Goals & Success Metrics
- Minimum 2 goals required
- Each goal MUST have a measurable metric (not vague like "improve UX")
- Each goal MUST have a measurement method (analytics event, DB query, manual)
- Goals must connect to MVP features — orphan goals (no feature supports it) → FAIL

### MVP Scope — Feature-Goal Linkage
- Each MVP feature MUST link to at least one goal
- Features with no goal linkage → flag in Open Questions ("why is this in MVP?")
- Out-of-scope items MUST state reason for deferral

### User Types Table
- Type, DB Value, Description, Key Actions — 4 columns required
- DB Value is integer (0, 1, 2, ..., 99) — for ORM enum mapping
- All user types included (including Admin)

### User Status Table
- Status, DB Value, Behavior — 3 columns required
- Suspended/Withdrawn: specify exact behavior (displayed message, data retention period)

### User Data Fields (NEW)
- Signup fields, Profile fields, System fields — 3 groups required
- Signup fields = NOT NULL in DB
- Profile fields = NULLABLE in DB
- Terms Agreement fields separated per legal requirement (ToS / Privacy / Marketing)
- Review against Standard Recommended Fields Reference for missing fields

### MVP Scope
- Both Included and Excluded must be specified
- Excluded items must state "deferred to [phase/version]"

---

## Section 1 — Terminology Density

### Core Concepts
- Include ALL domain terms used in the project
- Exclude generic IT terms (API, DB, etc.)
- 1:1 correspondence with terms used in Section 3/4 body text

### Status Values
- All enums stored in DB
- Each enum: list of values + when each value applies

---

## Section 2 — System Modules Density

### Technical Flow
- 5-10 steps per module (minimum 5)
- Each step: `[Actor] does [Action]` format
- Both **success branch** and **failure branch** included
- Failure: specify what user sees
- **API Hint required**: expected endpoint per step (`→ POST /api/...`)

### Real Scenarios (MANDATORY)
Each module MUST have:
- **Real Scenario — Success**: Named user, specific action, server response, UI reaction
- **Real Scenario — Failure**: Failure trigger, error code, user-visible result
- Minimum: 1 success + 1 failure per module
- Complex modules (auth, payment): 2+ scenarios each

### WebSocket Events
- Required for real-time feature modules
- Channel, Event, Payload, Direction — 4 columns

### 3rd Party API List
Each API requires 4 fields: Service, Purpose, Integration Point, Alternative

---

## Section 2.5 — Notification Specification Density (NEW)

### Notification Triggers
- Every module with user-facing events must have notification triggers defined
- Each trigger: Event, Channel(s), Recipient, Template Key, Delay — 5 fields required
- Conditional triggers based on detected features:
  - Chat feature → message notification trigger
  - Booking/scheduling feature → reminder notification trigger
  - Payment/order feature → status change notification trigger

### Notification Channels
- All channels listed: Push, Email, SMS, In-app
- Each channel: Provider, Fallback, Rate Limit

### User Notification Settings
- Per-category toggle defined
- Quiet hours specified (if applicable)

---

## Section 3 — Route-Level Mandatory 8 Items

Every route/page MUST have all 8 items below. Missing even one = QA FAIL.
When an item does not apply, write "N/A" with a brief reason. N/A counts as present.

### 1. Component Detail
- List all UI elements on the screen
- Define each component's states: **default / active / disabled / error**

### 2. Input Validation Rules
If the route has inputs, define as table:

| Field | Type | Required | Min/Max | Pattern | Error Message |
|-------|------|----------|---------|---------|---------------|

Routes without inputs: state "N/A (no inputs on this page)".

### 3. State Screens
Define all 3 states:
- **Loading**: skeleton UI / spinner / loading text
- **Empty**: message when 0 items + CTA (Call to Action)
- **Error**: error message + retry method

Static pages: "N/A (static content, no data fetching)"

### 4. Interactions
All possible user interactions:
- Click, Hover, Drag & drop, Keyboard shortcuts, Pull to refresh (mobile)
- If minimal: "Click navigation only"

### 5. Navigation
- All reachable screens from this route
- Back button behavior (previous screen / tab home / app home)
- Deep link entry: back button behavior

### 6. Data Display
- Display fields (which data is shown)
- **Default sort:** [field] [ASC/DESC] | Changeable: [Yes/No]
- Pagination method (infinite scroll / page numbers / Load More)

No dynamic data: "N/A (static page)"

### 7. Error Handling
3 error types:
- **Network error**: offline / timeout
- **Server error**: 500 / 503
- **Permission error**: login required / access denied

### 8. Edge Cases
Minimum 4 for dynamic pages, minimum 2 for static pages:
- **Zero items**: behavior when no data
- **Maximum capacity**: behavior with large data
- **Concurrent access**: multiple users manipulating same data
- **Offline**: behavior without network

### Additional Density Requirements
- Each route: specify **accessible roles** (must match Page Map)
- Edit/delete features: specify **ownership rules** (own only / all)

---

## Section 4 — Admin Page Density

### Per Admin Page Required Items

1. **Table Column Definition** (as table): Column, Type, Sortable, Description
2. **Filter Options**: Dropdown values, Date range, Search target fields
3. **Detail Drawer/Modal**: Display fields, Actions, Related data
4. **Creation Modal**: Validation rules, Required/optional, Error messages
5. **Standard Features Applied**: Confirm all items from `admin-standards.md`
6. **Default Sort Order** (MANDATORY): `[column] [ASC/DESC]`
   - Creation pages: `createdAt DESC`
   - Reference/lookup pages: business-logical column (e.g., `number ASC`, `name ASC`)
   - Unclear → add to Open Questions
7. **Edge Cases** (minimum 3): Bulk operation, Concurrent edit, FK dependency

---

## Section 9 — Client Preparation Checklist Density (Separate File)

> Unchanged from v3. See depth-guide.md for full checklist density rules.

- Single flat list — NO phase/stage separation
- Grouped by type: 계정, 브랜드 소재, 스토어 제출물, 법률 문서, 콘텐츠
- Conditional inclusion by App Type and detected features
- Account items: client creates + shares access only (no setup instructions)
- SOP link attachment via Notion API

---

## QA Usage

QA agent validates against this guide:
- Section 0 business context: missing business model or goals → FAIL (rule B1)
- Section 0 MVP scope: feature without goal linkage → FAIL (rule B2)
- Section 0 user data fields: missing signup/profile/system separation → FAIL
- Section 2 modules: missing Real Scenario → FAIL (rule 13)
- Section 2.5 notifications: module with events but no notification trigger → FAIL
- Section 3 routes: missing any of 8 items (N/A counts as present) → FAIL (rule 2)
- Section 4 admin pages: missing sort order → FAIL (rule 4)
- Section 4 admin pages: missing required items → FAIL (rule 4)
- Section 9 checklist: required subsection missing → FAIL (rule 15)
