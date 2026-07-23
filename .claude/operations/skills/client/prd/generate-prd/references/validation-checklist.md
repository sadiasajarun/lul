# QA Validation Rules — Feature PRD (Phase A)

> All rules use **only** counting/existence checks — no subjective judgment.
> "Needs more depth", "could be better" — these judgments are PROHIBITED.

---

## Rule 1: Route Count Match

### Verification Method
1. Count user app routes (N) + admin routes (M) from `screen-inventory.md`
2. Count routes defined in PRD Section 3
3. Count admin pages defined in PRD Section 4
4. Verify `screen-inventory routes ≤ PRD routes`

### PASS Condition
- ALL routes from `screen-inventory.md` exist in PRD
- PRD having additional routes is allowed (agent-enriched)

### FAIL Condition
- Any route from `screen-inventory.md` missing from PRD

### Bundle-derived Routes
Routes with `[Bundle-derived]` notation in `screen-inventory.md` are treated identically to client-specified routes for this rule. If a bundle was detected and its Required items generated routes, those routes must appear in the PRD.

### Evidence Format
```
User app: screen-inventory {N} → PRD {M} (missing: [route1, route2])
Admin: screen-inventory {N} → PRD {M} (missing: [route1])
```

---

## Rule 2: Mandatory 8 Items

### Verification Method
Check each route in Section 3 for presence of all 8 item sections:

| # | Item | Keyword Search |
|---|------|----------------|
| 1 | Component Detail | "Component", "UI element", state definitions |
| 2 | Input Validation Rules | "Validation", "Field", "Type", "Required" table OR "N/A" |
| 3 | State Screens | "Loading", "Empty", "Error" state definitions OR "N/A" |
| 4 | Interactions | "Interaction", "Click", "Hover", "Drag" OR "Click navigation only" |
| 5 | Navigation | "Navigation", "Back", reachable screens |
| 6 | Data Display | "Data", "Sort", "Pagination" OR "N/A" |
| 7 | Error Handling | "Error", "Network", "Server", "Permission" |
| 8 | Edge Cases | "Edge", "Zero", "Maximum", "Concurrent", "Offline" |

### PASS Condition
- ALL routes have all 8 items present
- "N/A" with reason counts as PASS for items 2, 3, 4, 6

### FAIL Condition
- Any route missing any item

### Evidence Format
```
Total {N} routes verified
FAIL: [route] — missing: [item1, item2]
FAIL: [route] — missing: [item3]
```

---

## Rule 3: Admin 1:1 Mapping

### Verification Method
1. Identify CRUD-capable entities from Section 3
2. Verify each entity has a corresponding admin page in Section 4

### PASS Condition
- All CRUD entities from Section 3 have corresponding admin pages

### FAIL Condition
- CRUD entity exists without admin page

### Evidence Format
```
CRUD entities identified: {N}
Mapped: {M}
Missing: [entity] — Section 3 location: [route], no admin page in Section 4
```

---

## Rule 4: Admin Standard Features + Sort Order

### Verification Method
1. Check each admin page for required standard features from `admin-standards.md`
2. Check each admin list page has **Default Sort** specified

### PASS Condition
- All admin pages include required standard features
- All list pages have Default Sort specified with column and direction

### FAIL Condition
- Admin page missing standard features
- List page missing Default Sort

### Evidence Format
```
{N} admin pages verified
FAIL: [page] — missing: [feature1, feature2]
FAIL: [page] — missing Default Sort
```

---

## Rule 5: Terminology Cross-Reference

### Verification Method
1. Extract all terms from Section 1 Terminology tables
2. Check each term's usage in Section 3 + Section 4 body text
3. Find domain terms in Section 3/4 not defined in Section 1

### PASS Condition
- All glossary terms used in body text at least once
- All domain terms in body text defined in glossary

### FAIL Condition
- **Glossary-only term**: defined but never used (unnecessary)
- **Body-only term**: used but not in glossary (missing definition)

### Evidence Format
```
Glossary terms: {N}
Unused in body: [term1, term2]
Body-only terms: [term3, term4]
```

---

## Rule 6: All-Decided (replaces TBD Zero)

### Verification Method
Search entire PRD for unresolved markers:
- `[💡 Recommended:` — PM has NOT confirmed yet
- `TBD`
- `undecided`
- `to be determined`
- `[?]`

Exclude from search:
- Items inside Open Questions section
- `[📌 Adopted]` markers (these are resolved)

### PASS Condition
- Zero unresolved `[💡 Recommended:]` markers in PRD body
- All items either `[📌 Adopted]` or moved to Open Questions

### FAIL Condition
- Any unresolved `[💡 Recommended:]` or TBD pattern found

### Evidence Format
```
Unresolved item search: {N} matches
Locations:
- [section/route]: "[found text]"
```

---

## Rule 7: Route Coverage

### Verification Method
1. Extract all routes from Section 3 Page Map tables
2. Extract all routes from Section 3 Feature List by Route
3. Bidirectional comparison

### PASS Condition
- All Page Map routes exist in Feature List
- All Feature List routes exist in Page Map

### FAIL Condition
- Orphan routes in either direction

---

## Rule 8: Numeric Consistency

### Verification Method
1. Extract all `number+unit` patterns from PRD
2. Check if same concept has different values

### PASS Condition
- All numeric values for same concept consistent throughout document

### FAIL Condition
- Same concept with different values

---

## Rule 12: Client Requirement Tracking

### Verification Method
1. Extract explicit requirements from `parsed-input.md`
2. Verify each requirement has corresponding spec in PRD or is in Open Questions

### PASS Condition
- All explicit requirements exist in PRD or Open Questions

### FAIL Condition
- Requirement missing from both (silently dropped)

---

## Rule 13: Real Scenario Existence

### Verification Method
1. Identify all modules in Section 2
2. Check each has at least 1 Real Scenario — Success + 1 Failure

### PASS Condition
- Every module has both scenarios with named user, specific action, result

### FAIL Condition
- Module without Real Scenario or scenario too vague

---

## Rule 15: Client Checklist Completeness

### Verification Method
1. Read App Type from Section 0
2. Read Adaptive Complexity Flags from `parsed-input.md`
3. Verify `client-checklist.md` has all required sections for the detected platform/features
4. Verify non-applicable items are NOT included
5. Verify account items do NOT contain setup instructions

### PASS Condition
- All required sections present
- No irrelevant items
- Account items = "가입 후 공유" only

### FAIL Condition
- Missing required section
- Irrelevant item present
- Setup instructions in account items

---

## Rule N1 (NEW): Notification Coverage

### Verification Method
1. Identify all modules in Section 2 that have user-facing events (booking, payment, message, status change, reminder)
2. Check Section 2.5 Notification Specification has triggers for each event
3. Verify notification channels are defined
4. **Conditional trigger checks** — verify feature-specific notifications:

| If feature exists... | Then verify trigger for... |
|---------------------|---------------------------|
| Chat / Messaging | New message notification |
| Booking / Scheduling | Reminder notification (before event) |
| Payment / Order | Status change notification (success, failure, refund) |
| User registration / Auth | Welcome notification, verification email |
| Content creation (post, comment) | New content notification to relevant users |
| Status change (approval, rejection) | Status update notification to owner |

### PASS Condition
- Every module with user-facing events has at least one notification trigger in Section 2.5
- Notification channels section exists with at least one channel defined
- All conditional trigger checks pass for detected features

### FAIL Condition
- Module with events but no notification trigger
- Section 2.5 missing entirely when notifications are detected
- Detected feature has no corresponding conditional trigger

### Evidence Format
```
Modules with events: {N}
Covered by notification triggers: {M}
Missing: [module] — event [event_name] has no notification trigger
Conditional: [feature] detected but [trigger_type] notification not defined
```

---

## Rule N2 (NEW): User Data Fields Completeness

### Verification Method
1. Check Section 0 has User Data Fields with 3 groups (Signup, Profile, System)
2. Verify Signup fields match Sign Up Page input fields in Section 3
3. Verify Terms Agreement fields are present
4. Verify soft delete (deletedAt) in System Fields
5. **Social login check**: If social login (Google, Apple, Kakao, etc.) is supported → verify `provider` and `providerId` fields exist in System Fields or Signup Fields
6. **Recommended fields audit**: Cross-reference against Standard Recommended Fields Reference in Section 0 — flag any commonly needed field that is absent without explanation

### PASS Condition
- All 3 field groups present
- Signup fields match Section 3 signup page fields
- deletedAt included
- If social login detected → provider/providerId fields present
- Recommended fields audit completed (missing fields noted in Open Questions or justified as N/A)

### FAIL Condition
- Missing field group
- Mismatch between signup fields and signup page
- Missing deletedAt
- Social login detected but provider/providerId fields absent
- No evidence of recommended fields audit

### Evidence Format
```
Field groups: [Signup: ✅/❌] [Profile: ✅/❌] [System: ✅/❌]
Signup ↔ Section 3 match: {N}/{M} fields
Social login: [detected/not detected] → provider fields: [present/missing]
Recommended fields audit: {N} fields reviewed, {M} flagged
```

---

## Rule N3 (NEW): Default Sort Order — All List Pages

### Verification Method
1. Identify ALL list/table pages across Section 3 (User App) AND Section 4 (Admin)
2. Check each list page has **Default Sort** specified with column and direction
3. Classify each page:
   - **Creation pages** (have Add/Create button): expect `createdAt DESC`
   - **Reference/lookup pages** (no create, just browse/select): expect business-logical sort (e.g., `number ASC`, `name ASC`, `difficulty ASC`)
4. If sort order is ambiguous for a reference page → must be in Open Questions

### PASS Condition
- ALL list/table pages specify a default sort column and direction
- Creation pages use `createdAt DESC`
- Reference pages have a business-logical sort defined or are in Open Questions
- No list page has sort order undefined without explanation

### FAIL Condition
- List page with no Default Sort specified
- Creation page not using `createdAt DESC` without justification
- Reference page with no sort and not in Open Questions

### Evidence Format
```
Total list pages: {N} (Section 3: {A}, Section 4: {B})
Creation pages: {N} — all createdAt DESC: ✅/❌
Reference pages: {N} — sort defined: {M}, in Open Questions: {K}
Missing: [page] — no sort order specified
```

---

## Rule B1 (NEW): Business Context Completeness

### Verification Method
1. Check Section 0 has Business Context subsection
2. Verify Business Model field is present and not empty
3. Verify Goals & Success Metrics table has minimum 2 goals
4. Each goal must have: Goal description, Success Metric, Measurement Method — all 3 columns filled
5. If business model not provided by client → `[💡 Recommended]` is acceptable (not FAIL)

### PASS Condition
- Business Context subsection exists
- Business Model field present (value or `[���� Recommended]`)
- Minimum 2 goals with all 3 columns filled
- Measurement Method is specific (analytics event, DB query) — not vague ("track it")

### FAIL Condition
- Business Context subsection missing entirely
- Goals table has fewer than 2 rows
- Goal row missing Success Metric or Measurement Method column

### Evidence Format
```
Business Context: [present/missing]
Business Model: [specified/recommended/missing]
Goals: {N} goals, all with metrics: ✅/❌
Missing: [goal #] — missing [column]
```

---

## Rule B2 (NEW): MVP Feature-Goal Linkage

### Verification Method
1. Extract all MVP features from Section 0 MVP Scope (In Scope table)
2. Extract all goals from Goals & Success Metrics table
3. Verify each MVP feature links to at least one goal
4. Verify each goal has at least one supporting MVP feature

### PASS Condition
- Every MVP feature links to at least one goal (via "Supports Goal #" column)
- Every goal has at least one supporting feature
- No orphan goals (goal with no feature) — unless noted in Open Questions
- No orphan features (feature linked to no goal) — unless noted in Open Questions

### FAIL Condition
- MVP feature with no goal linkage and not in Open Questions
- Goal with no supporting feature and not in Open Questions
- "Supports Goal #" column missing from MVP Scope table

### Evidence Format
```
MVP features: {N}, all linked to goals: ��/❌
Goals: {N}, all with supporting features: ✅/❌
Orphan features: [feature] — no goal linked
Orphan goals: [goal #] — no feature supports it
```

---

## Rule FB1 (NEW): Bundle Coverage Report (INFO — NOT FAIL)

> This rule produces an informational coverage report. It does NOT affect the overall PASS/FAIL result.
> Its purpose is to surface what was included vs. skipped from detected bundles for PM awareness in Phase 4.

### Verification Method
1. Read "Detected Feature Bundles" table from `parsed-input.md`
2. For each active (non-Deferred) bundle:
   a) Check if Required items are present in PRD (Section 0–4 + 2.5)
   b) Check if Recommended items are present (with or without `[권장]` marker)
   c) For Conditional items evaluated as "Yes", check presence
3. For Deferred bundles: verify they are NOT expanded in PRD body

### Output: Coverage Report Table
```
| Bundle | Required Coverage | Recommended Coverage | Conditional Coverage | Status |
|--------|------------------|---------------------|---------------------|--------|
| Auth   | 9/9 (100%)       | 5/6 (83%)          | 1/2 (50%)          | Active |
| Chat   | 6/6 (100%)       | 7/9 (78%)          | 0/0 (N/A)          | Active |
| Payment | —               | —                   | —                   | Deferred |
```

### Verdict: Always INFO (never FAIL)
- Missing Required item from active bundle → **WARNING** flag (not FAIL): `"⚠️ Auth bundle Required item 'Forgot Password Flow' not found in PRD. PM should confirm exclusion."`
- Missing Recommended item → listed for PM review in Phase 4 Bundle Coverage Review
- This rule does NOT affect the overall PASS/FAIL result

### Evidence Format
```
Active bundles: {N}, Deferred: {M}
Required coverage: {total covered}/{total expected} across all active bundles
Recommended coverage: {total covered}/{total expected}
Warnings: [list of missing Required items, if any]
Skipped Recommended: [list for PM review]
```

---

## QA Output Format

```markdown
## QA Validation Results — Feature PRD

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | Route Count Match | PASS/FAIL | {evidence} |
| 2 | Mandatory Items by Tier | PASS/FAIL | {evidence} |
| 3 | Admin 1:1 Mapping | PASS/FAIL | {evidence} |
| 4 | Admin Standard + Sort | PASS/FAIL | {evidence} |
| 5 | Terminology Cross-Ref | PASS/FAIL | {evidence} |
| 6 | All-Decided | PASS/FAIL | {evidence} |
| 7 | Route Coverage | PASS/FAIL | {evidence} |
| 8 | Numeric Consistency | PASS/FAIL | {evidence} |
| 12 | Client Requirement Tracking | PASS/FAIL | {evidence} |
| 13 | Real Scenario Existence | PASS/FAIL | {evidence} |
| 15 | Client Checklist Completeness | PASS/FAIL | {evidence} |
| N1 | Notification Coverage | PASS/FAIL | {evidence} |
| N2 | User Data Fields | PASS/FAIL | {evidence} |
| N3 | Sort Order — All Lists | PASS/FAIL | {evidence} |
| B1 | Business Context | PASS/FAIL | {evidence} |
| B2 | Feature-Goal Linkage | PASS/FAIL | {evidence} |
| FB1 | Bundle Coverage Report | INFO | {coverage report} |

**Overall: PASS / FAIL** (FB1 is INFO only — excluded from PASS/FAIL calculation)
```

### Rules
- NO subjective judgment
- ONLY counting, existence, and matching checks
- Each FAIL must include specific evidence
- PASS requires ALL rules to pass
