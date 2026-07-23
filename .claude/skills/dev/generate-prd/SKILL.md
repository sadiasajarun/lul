---
skill_name: generate-prd
applies_to_local_project_only: false
auto_trigger_regex: [prd, product requirements, requirements document, generate prd, write prd, create prd, specification, spec document, product spec]
tags: [prd, documentation, product, requirements, planning]
related_skills: [generate-proposal, generate-invoice]
---

# Generate PRD

Generate a comprehensive Product Requirements Document (PRD) from a client input file. The PRD covers Basic Information, User Application, Admin Dashboard, and Additional Questions — all in a single document.

---

## Workflow Overview

1. Read and validate input file
2. Analyze client answers
3. Check for existing PRD (ask update vs new)
4. Generate PRD document
5. Validate PRD against input (1:1 verification)
6. Generate additional questions list
7. Ask user about UX analysis
8. (If yes) Generate UX flow improvements
9. Save file and report results

---

## Step 1: Read and Validate Input File

Read the file path from `$ARGUMENTS`.

**Supported formats**: .md, .pdf, .txt, or any text-based file

**Validation checks**:
1. File path is provided
2. File exists and is readable
3. File is not empty

**If validation fails**, output error and stop:
```
Error: [specific error message]
Usage: /generate-prd /path/to/client-answers.md
```

---

## Step 2: Analyze Client Answers

Parse the client answer file and extract information for each question category:

### 2.1 Basic Information
- App Name (CRITICAL - required for file naming)
- App Type (Web / App / Dashboard)
- Deadline
- User Types and their roles/permissions
- User Relationships (1:1, 1:N, independent)

### 2.2 Design Reference
- Reference apps and points to reference
- Unique selling points / differentiators
- Preferred main color
- Preferred font

### 2.3 Features
- Main features per user type
- Main feature module flows (Actor -> Action -> Result)
- Authentication method (login, signup fields)
- Communication features (chat, video call, push notifications)

### 2.4 Data
- Data to collect (forms, surveys, logs)
- Data to export (CSV downloads)

### 2.5 Technical
- 3rd party integrations
- Domain terminology

### 2.6 Other
- Additional important information

**For missing or unclear items**: Mark as "TBD - Client confirmation needed" AND add to the Additional Questions section.

---

## Step 2.5: Load Bug Patterns (Optional)

Load known bug patterns from the accumulated knowledge base to insert ⚠️ Known Risks into the PRD.

### 2.5.1 Read Pattern Files

1. **Global patterns**: Read `skills/qa/learn-bugs/references/bug-patterns-global.yaml`
   - IF not found: WARN "No global bug patterns found. Run /learn-bugs --global to populate."
2. **Project patterns**: Read `.claude-project/knowledge/bug-patterns.yaml`
   - IF not found: Skip (optional)

### 2.5.2 Merge Patterns

- If both exist: project patterns override global (by pattern ID)
- If pattern has `skip: true` in project file: exclude from merged set

### 2.5.3 Filter by Frequency

- **high** (5+): Always include
- **medium** (3-4): Include if matching screen type exists in PRD
- **low** (1-2): Skip

### 2.5.4 Match Patterns to Screens

For each screen/module identified in Step 2, match bug patterns using:

| Bug Category | Screen Matches When |
|---|---|
| auth | Login, Signup, OAuth, password screens |
| form_input | Any screen with `<form>`, input fields, submit buttons |
| list_pagination | Any list/table screen with 10+ potential items |
| search_filter | Screens with search bars or filter controls |
| file_upload | Screens with file/image upload |
| admin_dashboard | Admin portal screens |
| payment | Payment, cart, checkout, invoice screens |
| navigation | Dynamic routes, nested navigation |
| data_sync | Screens with multiple data sources |
| realtime | Chat, live updates, WebSocket screens |
| performance | Large data lists, heavy data fetch screens |
| push_notification | Screens that trigger or display notifications |

### 2.5.5 Store Matched Patterns

Store matched patterns per screen for use in Step 4.

---

## Step 3: Check for Existing PRD

After extracting the App Name:

1. Check `.claude-project/prd/` directory for existing PRD files matching the app name
2. If found, ask user:
   ```
   Existing PRD found: [filename]
   Would you like to:
   1. Update the existing PRD (changes will be logged)
   2. Create a new PRD
   ```
3. If updating: Load existing PRD content for comparison and change tracking
4. If creating new: Proceed with fresh PRD generation

---

## Step 4: Generate PRD Document

### 🔒 Tech Stack Source of Truth (MANDATORY — read before writing the Tech Stack section)

**The PRD is NEVER where the tech stack is first decided** — but it is also written BEFORE
the fullstack pipeline runs, so the pipeline's own artifacts (`CLAUDE.md`,
`PIPELINE_STATUS.md`) **do NOT exist yet — do not try to read them here.** Instead derive
the Tech Stack section from the stack rules that ship with the `.claude` submodule and are
present whenever the PRD is written. Never invent a framework, ORM, state library, or
database from memory or generic defaults.

Read the declared stack from these (always available at PRD-creation time):

1. **`.claude/rules/stacks/*.rules.md`** — the declared stack patterns for this project:
   the backend rules file declares the backend framework + ORM; the frontend rules file
   declares the frontend framework + data layer + any **prohibited** libraries.
2. **`.claude/<backend>/` and `.claude/<frontend>/` submodule guides** — the detailed
   patterns the chosen stack mandates.

(`CLAUDE.md` and `PIPELINE_STATUS.md` are generated later by `init`; they must agree with
the above once the pipeline runs, but they are not available when the PRD is created.)

Rules:

- Every framework / ORM / state-lib / database / data-fetching tool you write into the
  PRD MUST be traceable to a stack-rules file above. If you cannot trace it, do not write it.
- If the client input names a tool that **contradicts** the stack rules, do NOT adopt it.
  Keep the declared stack and record the conflict in the **Open Questions** section as a
  "stack mismatch — client confirmation needed" item.
- **Library versions** are not in the stack rules — follow the version pinned in the
  project's scaffold `package.json` (the version source of truth): the frontend scaffold
  `.claude/<frontend>/templates/package.json`, and the backend scaffold `package.json`
  (defined in the init blueprint, or `backend/package.json` once scaffolded). Reflect the
  major version line (e.g. `^10.3.0` → "10.x", `^0.3.20` → "0.3.x"). Never invent a version.
- If a choice is declared in **neither** the stack rules nor the scaffold, write **"TBD —
  client confirmation needed"** — never guess.
- Do not hardcode any specific library name or version as "the stack" — read whatever the
  stack-rules files and scaffold `package.json` declare (they differ per project).

Before generating, read the section templates from `resources/` for consistent formatting:

| Section | Template |
|---------|----------|
| Project Overview | [resources/project-overview.md](resources/project-overview.md) |
| Terminology | [resources/terminology.md](resources/terminology.md) |
| System Modules | [resources/modules.md](resources/modules.md) |
| User App | [resources/user-app-architecture.md](resources/user-app-architecture.md) |
| Admin Dashboard | [resources/admin-dashboard-architecture.md](resources/admin-dashboard-architecture.md) |
| Tech Stack | [resources/tech-stack.md](resources/tech-stack.md) |
| Open Questions | [resources/open-questions.md](resources/open-questions.md) |
| Full Template | [resources/prd-template.md](resources/prd-template.md) |

### Bug Pattern Risk Insertion

If Step 2.5 produced matched patterns, insert a `⚠️ Known Risks` table after each screen specification that has matching patterns:

```markdown
#### ⚠️ Known Risks
| Risk | Frequency | Prevention Spec |
|------|-----------|----------------|
| [Pattern Name] | [N] occurrences ([severity]) | [prevention_spec from pattern] |
```

- **high** severity patterns: Always insert (mandatory)
- **medium** severity patterns: Insert if screen clearly matches (recommended)
- Only include patterns relevant to that specific screen

Create the PRD following this 3-part structure:

```markdown
# [App Name] PRD ([Date: YYYY-MM-DD])

---

# Part 1: Basic Information

## Title
[App Name]

## Terminology

| Term | Definition |
|------|------------|
| [Term 1] | [Definition] |
| [Term 2] | [Definition] |

## Project Information

### Description
[Project description in 2-3 sentences]

### Goals
1. [Goal 1]
2. [Goal 2]
3. [Goal 3]

### User Types
- **[User Type 1]**: [Description and permissions]
- **[User Type 2]**: [Description and permissions]
- **Admin**: [Description and permissions]

### User Relationships
[Describe relationships between user types - 1:1, 1:N, etc.]

### Project Type
- [Platform 1] - [Tech Stack]
- [Platform 2] - [Tech Stack]

## System Modules (Step-by-step Flows)

### Module 1 - [Feature Name]
1. [Actor] does [Action]
2. [Actor] does [Action]
3. [Result]

### Module 2 - [Feature Name]
1. ...

## 3rd Party API List
- [Service Name]: [Purpose]

---

# Part 2: User Application PRD

## User Types: [User Type 1], [User Type 2]
[Special notes if any]

## 1. Common

### Splash Page
- Design: [Status]

### Login Page
- **Input**:
  - [Field 1]
  - [Field 2]
- **Next Action**:
  - [Validation rules]
  - [Error handling]
  - [Success response]

### Forgot Password Page
- **Main**
  - Input: [Fields]
- **Reset Password Page**
  - [Process description]

### Sign Up Page
- **Input**:
  - [Field 1] (required/optional)
  - [Field 2]
- **Rules**:
  - [Rule 1]
  - [Rule 2]

## 2. [User Type 1]

### 2.1 Navigation Menu
1. [Tab 1]
2. [Tab 2]
3. [Tab 3]
4. [Tab 4]

### 2.2 Page Architecture & Feature Specification

#### 1. [Tab 1] Tab

**Main Page**
1) [Component 1]
   - [Feature details]
   - [Status display]
   - [Buttons/Actions]

2) [Component 2]
   - ...

**[Sub-page Name] Page**
- [Feature description]
- [Component list]

#### 2. [Tab 2] Tab
...

## 3. [User Type 2]

### 3.1 Navigation Menu
1. [Tab 1]
2. [Tab 2]
3. [Tab 3]

### 3.2 Page Architecture & Feature Specification
...

---

# Part 3: Admin Dashboard PRD

## Admin Dashboard Standard Features

All admin dashboard pages should include the following standard features unless otherwise specified.

### List Page Standard Features

| Feature | Description | Required |
|---------|-------------|:--------:|
| **Search** | Keyword search field (name, ID, email, etc.) | Yes |
| **Filters** | Status / Date / Category dropdown filters | Yes |
| **Column Sorting** | Click table header to sort ASC/DESC | Yes |
| **Checkbox Selection** | Row checkboxes + Select All checkbox | Yes |
| **Bulk Actions** | Bulk delete / Status change / Export for selected items | Yes |
| **Pagination** | Page navigation + Items per page selector (10/25/50/100) | Yes |

### Table UI Standard Features

| Feature | Description | Required |
|---------|-------------|:--------:|
| **Loading State** | Skeleton or spinner while data loads | Yes |
| **Empty State** | Message displayed when no data exists | Yes |
| **Action Column** | Edit / Delete / View Detail buttons per row | Yes |

### Detail/Edit Standard Features

| Feature | Description | Required |
|---------|-------------|:--------:|
| **Detail Drawer/Modal** | Click row to open detail panel | Yes |
| **Edit Form** | Switch to edit mode within detail view | Yes |
| **Delete Confirmation** | Confirmation dialog before deletion | Yes |
| **Audit Log** | Track who/when/what was modified | Optional |

### Data Export Standard Features

| Feature | Description | Required |
|---------|-------------|:--------:|
| **CSV/Excel Download** | Export current filtered/searched results | Yes |
| **Date Range Selection** | Period filter for export | Yes |

### Common UI/UX Standard Features

| Feature | Description | Required |
|---------|-------------|:--------:|
| **Toast Notifications** | Success/Error feedback messages | Yes |
| **Breadcrumb** | Current location navigation | Yes |
| **Create Modal/Drawer** | Form for adding new items | Yes |

---

## Page Architecture & Feature Specification

### Dashboard Home Page

**Statistics Cards**
- [Key metrics - total users, today's signups, active sessions, etc.]
- Show increase/decrease percentage compared to previous period

**Period Filter**
- Today / Last 7 days / Last 30 days / Custom date range

**Charts**
- [Trend visualization - line/bar charts based on app metrics]

**Recent Activity**
- [Recently created/modified items list]

---

## User Management

[Management pages for each user type - create based on app's User Types]

### [User Type] Management Page

**Main Page**
1. Top Area:
   - Search: [Keyword search - name, email, ID]
   - Filters: [Status (Active/Inactive), Date range, Role]
   - Create button -> Creation Modal
   - Bulk Action dropdown: [Delete / Activate / Deactivate / Export]

2. Table Component:
   - Checkbox column (with Select All)
   - [Data columns - name, email, status, created at, last login, etc.]
   - Action column: [View / Edit / Delete]

3. Table Features:
   - Column sorting (click header)
   - Pagination with items per page selector

**Creation Modal**
- Input fields: [Required fields based on user type]
- Create button / Cancel button

**Detail Drawer**
- Header Info: [User profile information]
- Account Actions:
  - Activate / Deactivate account
  - Reset password (issue temporary password)
  - Change role/permissions
- Activity Log: [Recent user activities]
- Timestamps: Created at / Last login / Last modified

---

## Feature Management

[Management pages for each core feature - create based on app features]

### [Feature Name] Management Page

**Main Page**
1. Top Area:
   - Search: [Relevant search fields]
   - Filters: [Status, Category, Date range]
   - Create button -> Creation Modal
   - Bulk Action dropdown: [Delete / Status change / Export]

2. Table Component:
   - Checkbox column (with Select All)
   - [Data columns specific to feature]
   - Action column: [View / Edit / Delete]

**Creation Modal**
- Input fields: [Fields specific to feature]
- Create button / Cancel button

**Detail Drawer/Modal**
- [Detail information display]
- Edit mode toggle
- Delete with confirmation
- Audit log (if applicable)

---

## Export / Data Download

**Data Download**
- [Downloadable data - based on collected data in the app]
- Format: CSV / Excel
- Filter Options:
  - All time
  - Custom date range
  - Current filtered results

---

# Additional Questions (Client Confirmation Required)

## Required Clarifications
| # | Question | Context |
|:-:|:---------|:--------|
| 1 | [Question 1] | [Why this is needed] |

## Recommended Clarifications
| # | Question | Context |
|:-:|:---------|:--------|
| 1 | [Question 1] | [Why this is needed] |

---

# Feature Change Log

## Version X.X (YYYY-MM-DD)

| Change Type | Before | After | Source |
|:-----------|:-------|:------|:-------|
| **Feature Replaced** | [Previous feature] | [New feature] | [Source document] |
| **Feature Extended** | [Existing feature] | [Added details] | [Source document] |
| **Feature Removed** | [Removed feature] | - | [Source document] |

### Change Details
#### [Change Title]
- **Source Document**: [Document name]
- **Change Description**: [Detailed description]

---

# UX Flow Improvement Suggestions (Optional)

UX flow issues identified during PRD creation:

## Suggestions
| # | Current Flow | Issue | Suggestion | Priority |
|:-:|:------------|:------|:-----------|:--------:|
| 1 | [Current flow] | [Issue] | [Improvement suggestion] | High/Medium/Low |

### Suggestion Details
#### Suggestion 1: [Suggestion Title]
- **Current**: [Current state]
- **Issue**: [Problem]
- **Suggestion**: [Improvement approach]
- **Expected Benefit**: [Benefit]

---
```

---

## Step 5: Validate PRD Against Input (1:1 Verification)

After generating the PRD, perform validation against the input file:

### 5.1 User Types Verification (CRITICAL)
- [ ] All user types from input are included in Part 1 User Types
- [ ] Each user type's permissions are accurately reflected
- [ ] User relationships (1:1, 1:N) are correct
- [ ] **Part 2 Section Mapping**: All user types (except Admin) have separate sections in Part 2
- [ ] Each user type section has Navigation Menu and Page Architecture defined

### 5.2 Feature Verification
- [ ] All main features from input are included in PRD
- [ ] Module flows match the input file
- [ ] Navigation menu structure matches input

### 5.3 Authentication Verification
- [ ] All login methods are included (ID/PW, OAuth types, etc.)
- [ ] Signup required/optional fields are correct
- [ ] Social login options are all included (Apple, Google, Kakao, etc.)

### 5.4 Tech Stack Verification
- [ ] All 3rd party APIs/integrations are included
- [ ] Platforms (iOS, Android, Web) are correct
- [ ] Backend tech stack is correct

### 5.4.1 Tech Stack Trace Check (CRITICAL)

Reconcile the generated Tech Stack section against the declared source from Step 4
(`.claude/rules/stacks/*.rules.md` + the `.claude/<backend>` / `.claude/<frontend>` guides):

- [ ] Every framework / ORM / state-lib / database / data-fetching tool in the PRD traces
      to the declared source (no tool invented from memory or generic defaults)
- [ ] No tool in the PRD **contradicts** the declared stack or its stack rules (e.g. a
      data-fetching or ORM choice the declared stack prohibits)
- [ ] Any client-requested tool that conflicts with the declared stack is recorded in
      **Open Questions** (not silently adopted)
- [ ] If the declared source had no stack, the section reads "TBD — client confirmation needed"

If any check fails, fix the Tech Stack section (align to the declared source) before
finalizing — do not ship a PRD whose stack cannot be traced to the declared source.

### 5.5 Terminology Verification
- [ ] All domain terms from input are in Terminology section
- [ ] Terms are used consistently throughout the PRD

### 5.6 Screen/Page Verification
- [ ] All screens mentioned in input are included in PRD
- [ ] Each screen's components (items) are included without omission
- [ ] Both key screens and basic screens are reflected

### 5.7 Feature Update Verification (When Updating Existing PRD - CRITICAL)

When updating an existing PRD with new input:

- [ ] **Feature Replacement Check**: Does new input replace existing features?
  - Example: "My Collection" -> "Art Feed" - replace all My Collection content with Art Feed
  - Old feature name should be completely replaced with new feature name
- [ ] **Feature Extension vs Replacement**:
  - Replacement: Existing feature completely changes to new feature
  - Extension: New details added to existing feature
- [ ] **Navigation Menu Update**: Update navigation menu when feature names change
- [ ] **Terminology Sync**: New feature names reflected in Terminology
- [ ] **Change Log Recording**: Record all changes in "Feature Change Log" section

### Feature Update Rules:
1. **New input takes priority**: New document content takes priority over existing PRD
2. **Explicit replacement**: If different feature is specified at same location (e.g., Home Tab), treat as replacement
3. **No arbitrary additions**: Do not add details not in the input document
4. **Document changes**: Record change history in PRD's "Feature Change Log" section

### PRD Writing Principles (CRITICAL - Must Follow):

#### 1. Reference Only Input Resources
- **No re-referencing old PRD**: When updating PRD, do not reference previously written PRD content
- **Use only new input file**: Base PRD only on PDF, documents, images provided by user
- **No accumulation**: If previous PRD details are not in new input file, delete or move to question list

#### 2. Handling Ambiguous Items
- **No guessing**: Never guess content not specified in input file
- **All ambiguous items -> Question list**: If even slightly unclear, don't write in PRD, add to question list
- **Empty sections allowed**: If no information, mark as "TBD - Client confirmation needed"

#### 3. Source Tracking
- **All content must be traceable**: Every feature/screen/flow in PRD must be traceable to input file source
- **Content without source = Delete**: Content that cannot cite a source should not be included in PRD

#### Example:
```
Wrong:
- Keep "Collection Detail Page" because it was in previous PRD
- Add "read receipts, reply feature" when PDF only says "DM feature"

Correct:
- No mention of "Collection Detail Page" in new PDF -> Delete or move to question list
- PDF only says "DM feature" -> Write only "DM feature", add details to question list
  - Question: "DM feature details - Read receipts? Reply enabled? Notification method?"
```

### Validation Result Handling:
1. **If omissions found**: Immediately fix PRD
2. **If inconsistencies found**: Fix PRD based on input file
3. **If ambiguous**: Add to Additional Questions list

### Validation Complete Output:
```markdown
## Validation Results

### Modified Items
- [Item 1]: [Before] -> [After]
- [Item 2]: [Before] -> [After]

### Validation Complete
- Total items verified: [N]
- Items modified: [N]
- Items moved to questions: [N]
```

---

## Step 6: Generate Additional Questions

When generating the question list, include ALL unclear features:

### Question Generation Rules (CRITICAL):

1. **Feature details undefined**: Only feature name exists, no detailed behavior
   - Example: "DM feature" -> "DM notification method? Read receipts? Reply enabled?"

2. **Data flow undefined**: Unclear where data flows from/to
   - Example: "Share Collection" -> "URL format when sharing? Non-member access allowed?"

3. **Conditions/branches undefined**: Unclear behavior under specific conditions
   - Example: "Recognition Fail" -> "How many seconds until fail? Retry limit?"

4. **UI/UX details undefined**: Unclear screen component behavior
   - Example: "Artist Page Stats" -> "Clicking Followers shows list? Or just number?"

5. **Permissions/access undefined**: Unclear who can access what features
   - Example: "Delete Comment" -> "Author only? Artist too? Admin only?"

6. **External integration undefined**: Unclear 3rd party integration details
   - Example: "Kakao Login" -> "What profile info to retrieve? Friend list?"

---

## Step 7: Ask About UX Analysis

After completing the PRD and validation, ask the user:

```
PRD generation complete. Would you like to include UX flow analysis?

This will analyze:
- Navigation flow issues
- User journey optimization
- Information architecture
- Common UX problem patterns

[Yes] / [No]
```

If user selects **Yes**, proceed with UX analysis below.
If user selects **No**, skip to Step 9.

---

## Step 8: UX Flow Analysis (If Requested)

### 8.1 Navigation Flow Verification
- [ ] Back/close available from all pages?
- [ ] No dead-end pages? (pages with nowhere to go)
- [ ] Deep depth screens (3+ levels)? -> Suggest shortcuts
- [ ] Frequently used features require too many tab changes?

### 8.2 User Journey Verification
- [ ] Steps to reach core features appropriate? (recommend 3 or less)
- [ ] Clear path to new user's first success (Aha moment)?
- [ ] Recovery path when errors occur?
- [ ] Clear next action from empty states?

### 8.3 Information Architecture Verification
- [ ] Related features grouped in same area?
- [ ] Same feature not scattered across multiple places?
- [ ] Structure matches user mental model?

### 8.4 Common UX Problem Patterns
1. **Orphan Pages**: Important pages with only one access path
   - Suggestion: Add multiple entry points
2. **Hidden Features**: Core features hard to discover
   - Suggestion: Guide in onboarding or adjust placement
3. **Broken Flows**: Need to navigate away mid-task
   - Suggestion: Inline handling or change to modal
4. **Excessive Confirmations**: Too many unnecessary confirmation steps
   - Suggestion: Consolidate steps or add skip option
5. **Context Loss**: Data loss when going back
   - Suggestion: Auto-save or confirmation dialog

### Improvement Suggestion Rules:
- Content not in input file -> Mark as **suggestion** (no arbitrary additions)
- Show priority: High (core feature related) / Medium (convenience) / Low (nice-to-have)
- Show implementation complexity: Simple / Medium / Complex
- State rationale: Why it's a problem, which users are affected

---

## Step 9: Save File and Report

### 9.1 Create Output Directory
```bash
mkdir -p .claude-project/prd
```

### 9.2 Save File
Filename format: `[AppName]_PRD_[YYMMDD].md`
- Sanitize app name: Replace spaces with underscores, remove special characters
- Example: `ActivityCoaching_PRD_260112.md`

Location: `.claude-project/prd/`

### 9.3 Report Results
```markdown
## PRD Generation Complete

### Output
- File: `.claude-project/prd/[filename].md`
- Mode: [New / Update]

### Summary
- Sections included: [list]
- Validation: [N] items verified, [N] modified
- Additional questions: [N] items
- UX suggestions: [N] items (or "Skipped")

### Next Steps
1. Review the Additional Questions section
2. Send questions to client for clarification
3. Update PRD with client responses using `/generate-prd` again
```

---

## Error Handling

- **File not found**:
  ```
  Error: File not found at [path]
  Please check the file path and try again.
  Usage: /generate-prd /path/to/client-answers.md
  ```

- **Empty file**:
  ```
  Error: The input file is empty.
  Please provide a file with client answers.
  ```

- **Missing app name**:
  ```
  Error: App Name not found in the input file.
  App Name is required to generate the PRD.
  Please ensure the input file includes the App Name.
  ```

- **Read error**:
  ```
  Error: Unable to read the file at [path]
  Please check file permissions and try again.
  ```

---

## Client Question List Reference

The following questions should be answered by the client. PMs can use this list when gathering requirements:

```
=== Basic Info ===
1. App Name:

2. App Type (Web / App / Dashboard):

3. Deadline:

4. All User Types:

5. User Roles & Permissions (what can each user do?):

6. User Relationships (1:1, 1:N, independent, etc.):

=== Design Reference ===
7. Reference App:
   - Points to reference for development:

8. What makes your app special (Difference between your service and other services already launched):

9. Preferred Main Color:

10. Preferred Font:

=== Features ===
11. Main Features (per user type):

12. Main Feature Module Flow (User A does -> What changes -> Result) for MVP:

13. Authentication Method:
    - Login: (ID/PW, Social login, Phone verification, etc.)
    - Signup required fields:
    - Signup optional fields:

14. Communication Features:
    - Chat: (Yes/No)
    - Video call: (Zoom, etc.)
    - Push notifications: (Yes/No)

=== Data ===
15. Data to Collect (forms, surveys, logs, etc.):

16. Data to Export (CSV downloads - what data needs to be downloadable?):

=== Technical ===
17. 3rd Party Integrations (SMS, payment, maps, analytics, etc.):

18. Domain Terminology (special terms that need definition):

=== Other ===
19. Is there any additional important information we should be aware of?
```

---

## Notes

- Single file contains Part 1, 2, 3 (all sections)
- Sections can be added/removed based on project characteristics
- Part 3 (Admin Dashboard) can be omitted for projects without admin dashboard
- User type count is flexible per project
- Unclear content is output in **Additional Questions** section at the end
- When updating existing PRD, changes are tracked in **Feature Change Log**
