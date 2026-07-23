---
name: prd-to-design-guide
description: Convert PRD to Design Guide (used in both Path A automated and Path B external designer)
---

# PRD to Design Guide - Generic Template for All Projects

This is a **comprehensive reusable template** for converting any Product Requirements Document (PRD) into a Design Guide. Used in the fullstack pipeline Phase 3 (Design) as the first sub-phase for both Path A (Full AI Generation) and Path B (External Designer). The Design Guide serves as a human-readable review checkpoint before HTML generation.

---

## HOW TO USE THIS TEMPLATE

1. **Read your PRD thoroughly**
2. **Extract information using the tables below**
3. **Fill in the Design Guide template** with extracted data
4. **Follow the conversion patterns** for each section
5. **Output a complete Design Guide** ready for your designer

---

## EXTRACTION WORKFLOW

### Phase 1: Extract Basic Information
### Phase 2: Define Design Philosophy
### Phase 3: Create Design System
### Phase 4: Convert Pages to Design Briefs
### Phase 5: Create Component Patterns
### Phase 6: Add Design Rules & Tips
### Phase 7: Create Deliverables Plan

---

## PHASE 1: EXTRACT BASIC INFORMATION

### From PRD, Extract:

| Information | Where to Find in PRD | Example | Variable |
|-------------|---------------------|---------|----------|
| Project Name | Title/Header | "Crowd Builder", "MediCare+", "ShopEase" | `[PROJECT_NAME]` |
| Project Version | Version number | "v3.1", "1.0", "MVP" | `[VERSION]` |
| Designer Name | Team section | "Habib", "Sarah", "TBD" | `[DESIGNER_NAME]` |
| Timeline | Timeline/Deadline section | "4 weeks", "2 months", "6 weeks" | `[TIMELINE]` |
| Project Type | App Type section | "Web Application", "Mobile App", "Dashboard" | `[TYPE]` |
| Target Platform | Platform section | "Desktop-first", "Mobile-first", "Cross-platform" | `[PLATFORM]` |
| User Types | User Roles section | "Guest, User, Admin", "Patient, Doctor, Admin" | `[USER_TYPES]` |
| Total Pages | Count from Page Breakdown section | "28 pages", "15 pages", "42 pages" | `[TOTAL_PAGES]` |

### Page Count Breakdown:

Count pages from PRD's "Page Breakdown" or "Feature Specifications" section:

| User Type | PRD Section to Count | Example Count |
|-----------|---------------------|---------------|
| Guest/Public Pages | Common section, Public features | 6 pages |
| Logged In User Pages | User features section | 13 pages |
| Admin Pages | Admin Dashboard section | 9 pages |

**Total Pages** = Guest + User + Admin

---

## PHASE 2: DEFINE DESIGN PHILOSOPHY

### 2.1 Find Reference Applications

**From PRD, look for:**
- "Design Reference" section
- "Reference apps" mentioned
- "What makes your app special" section
- Feature descriptions that imply UI patterns

### 2.2 Derive Design Inspiration

**Pattern Recognition:**

| PRD Feature | Design Inspiration | Reference App |
|-------------|-------------------|---------------|
| "Upvoting system" | Voting UI, ranking | **Product Hunt** |
| "Threaded comments", "Nested replies" | Comment threading | **Reddit** |
| "Feed of items", "Professional network" | Card-based feed | **LinkedIn** |
| "Dashboard", "Analytics", "Admin panel" | Clean minimal dashboard | **Stripe**, **Linear** |
| "Stories", "Timeline", "Posts" | Social feed | **Instagram**, **Twitter** |
| "Drag and drop", "Kanban board" | Task management | **Trello**, **Asana** |
| "Chat", "Messaging" | Messaging UI | **Slack**, **Discord** |
| "Calendar", "Scheduling" | Calendar UI | **Google Calendar**, **Calendly** |
| "E-commerce", "Products", "Cart" | Shopping UI | **Amazon**, **Shopify** |

### 2.3 Create Design Pillars

**Based on key features, create 3-4 design pillars:**

**Template:**
```
**Design Philosophy:**

**Core Inspiration (Must Study):**
1. **[Reference App 1]** - [Key feature to study]
2. **[Reference App 2]** - [Key feature to study]
3. **[Reference App 3]** - [Key feature to study]
4. **[Reference App 4]** - [Key feature to study]

**The [Number] Pillars:**
- [Feature Area 1] = [Reference App] ([specific pattern])
- [Feature Area 2] = [Reference App] ([specific pattern])
- [Feature Area 3] = [Reference App] ([specific pattern])
```

**Example:**
```
**Core Inspiration (Must Study):**
1. **Product Hunt** - Upvote buttons, card layout, ranking
2. **Reddit** - Comment threading, nested replies
3. **LinkedIn** - Professional feed, achievement feel
4. **Stripe** - Clean dashboard, minimal design

**The Three Pillars:**
- Feed = LinkedIn (professional cards, achievement vibes)
- Comments = Reddit (threaded, vertical lines, indentation)
- Dashboard = Stripe (clean, content-first, one action per page)
```

---

## PHASE 2.5: DOMAIN & REFERENCE RESEARCH (MANDATORY)

> **This step MUST be performed before generating the Design Guide.**
> **Purpose:** Research the top products in the relevant domain to automatically identify standard UI patterns and essential sections.
> **Instead of hardcoding a checklist**, discover "what should naturally exist in this domain" through research.

### 2.5.1 Competitor / Similar Product Research

Perform WebSearch based on the industry and core features extracted from the PRD:

```
Search queries:
  1. "[industry] best [product type] UI design 2025" (e.g., "design feedback SaaS best UI 2025")
  2. "[competitor1] landing page" (competitors specified in PRD)
  3. "[competitor2] dashboard UI"
  4. "best [industry] web app design examples"
```

Research targets: Landing pages, dashboards, and core feature screens of the **top 3-5 products**.

### 2.5.2 Derive Standard Patterns by Page Type

Extract **"elements present in 80%+ of top products"** from research results:

| Page Type | Research Perspective |
|-----------|---------------------|
| Landing | What sections exist? (Hero, Features, How it Works, Pricing, Testimonials, Social Proof, CTA, Footer, etc.) |
| Dashboard | What UI elements exist? (Search, Notifications, KPIs, Activity Feed, Tables, Quick Actions, etc.) |
| Detail/Editor | What tools/panels exist? (Toolbar, Filters, Canvas/Content, Side Panel, Status Bar, etc.) |
| Auth | What flows exist? (Social Login, Form Layout, Error States, Redirect, etc.) |
| Settings | What sections exist? (Profile, Billing, Team, Notifications, Danger Zone, etc.) |

### 2.5.3 Deep Dive into PRD-Specified References

If the PRD contains specific UI references (e.g., "Notion-style Org Switcher"), research the **actual latest UI patterns** of that product:

```
Example:
  PRD says: "Notion-style Org Switcher"
  → WebSearch: "Notion workspace switcher UI 2025"
  → Findings: icon + org name + dropdown arrow, "+ New Workspace" at bottom, search feature
  → Reflect in the Org Switcher brief in the Design Guide
```

### 2.5.4 Save Research Results

Save to `.claude-project/design/{PROJECT}_DomainResearch.md`:

```markdown
# Domain Research — [PROJECT_NAME]

## Industry: [Industry]
## Competitors Analyzed: [Product1], [Product2], [Product3]

## Landing Page — Standard Sections
(List of common sections discovered from research)

## Dashboard — Standard Elements
(Common UI elements discovered from research)

## [Core Feature Screen] — Standard Patterns
(Common patterns discovered from research)

## PRD Reference Analysis
| PRD Reference | Actual UI Pattern | Notes |
|--------------|-------------------|-------|
```

This file is **injected as context** during Design Guide generation and HTML generation, ensuring domain standards are followed without omissions.

---

## PHASE 3: CREATE DESIGN SYSTEM

### 3.1 Color Palette

**From PRD, extract:**

| PRD Field | Design System Color | Default if Not Specified |
|-----------|-------------------|-------------------------|
| "Preferred Main Color" | Primary Color | #0066FF (Blue - trust) |
| Success states | Success Color | #10B981 (Green) |
| Warning states | Warning Color | #F59E0B (Orange/Yellow) |
| Error states | Error Color | #EF4444 (Red) |
| N/A | Background | #F9FAFB (Light Gray) |
| N/A | Surface (Cards) | #FFFFFF (White) |
| N/A | Text Primary | #1E293B (Dark Gray) |
| N/A | Text Secondary | #64748B (Medium Gray) |
| N/A | Border | #E5E7EB (Light Gray) |

**Additional Context Colors:**

Look at PRD features for color usage hints:
- "Original ideas badge" → Success color
- "Similar ideas warning" → Warning color
- "Duplicate ideas" → Error color
- Status indicators → Map to success/warning/error

**Template:**
```
### Colors
- Primary [Color Name]: [HEX] ([Usage from PRD])
- Success [Color]: [HEX] ([Usage from PRD])
- Warning [Color]: [HEX] ([Usage from PRD])
- Error/Danger [Color]: [HEX] ([Usage from PRD])
- Grays: 50-900 scale (standard)
```

### 3.2 Typography

**From PRD, extract:**

| PRD Field | Design System Value | Default if Not Specified |
|-----------|-------------------|-------------------------|
| "Preferred Font" | Font Family | Inter, SF Pro, Poppins |
| N/A | H1 Size | 48px (hero sections only) |
| N/A | H2 Size | 36px (page titles) |
| N/A | H3 Size | 24px (section headings) |
| N/A | H4 Size | 20px (card titles) |
| N/A | Body Size | 16px (main content) |
| N/A | Small Size | 14px (metadata, labels) |
| N/A | Caption Size | 12px (fine print) |

**Font Weights:**
- 400 (regular) - Body text
- 500 (medium) - Emphasis
- 600 (semibold) - Headings, buttons
- 700 (bold) - H1, H2, important headings

**Template:**
```
### Typography
- Font: [FONT_FAMILY from PRD or Inter/SF Pro]
- H1: 48px (hero only), H2: 36px, H3: 24px, H4: 20px
- Body: 16px, Small: 14px, Caption: 12px
- Weights: 400 (regular), 500 (medium), 600 (semibold), 700 (bold)
```

### 3.3 Spacing System

**Always use a grid system:**

| Spacing Type | Value | Usage |
|--------------|-------|-------|
| Base Unit | 4px or 8px | Grid system foundation |
| Card Padding | 20px or 24px | Inside cards/containers |
| Section Padding | 32px or 40px | Between major sections |
| Between Cards | 16px or 24px | Gap in grids/lists |
| Input Height | 40px or 48px | Form inputs |
| Button Height | 40px or 48px | Buttons |

**Template:**
```
### Spacing
- Base: [4px or 8px] grid
- Card padding: [20px or 24px]
- Section padding: [32px or 40px]
- Between cards: [16px or 24px]
```

### 3.4 Component Specifications

**From PRD features, identify needed components:**

| PRD Feature | Component Needed | Standard Specs |
|-------------|-----------------|----------------|
| Login/Signup forms | Input fields | Height: 48px, Radius: 6px |
| Submit buttons | Primary button | Height: 48px, Radius: 6px |
| Cards/Lists | Card component | Padding: 20px, Radius: 12px |
| Voting | Upvote button | Custom size based on prominence |
| Images | Image container | Aspect ratio: 16:9 or 1:1 |
| Icons | Icon size | 16px (inline), 24px (buttons), 32px (features) |

**Template:**
```
### Key Components

**[Component Name from PRD feature]:**
- [Dimension 1]: [Value]
- [Dimension 2]: [Value]
- [Special feature]: [Description]
- [States]: [Default, Hover, Active]

**[Component Name 2]:**
- ...
```

---

## PHASE 3.5: VARIATION ARCHETYPE APPLICATION (Differentiating 3 DESIGN_SYSTEMs)

> **This section MUST be followed when generating 3 DESIGN_SYSTEM variants.**
> **Purpose:** Enforce that each variation has a visually completely different identity.

### Core Principles

The PRD's design tokens (colors, fonts, icons) are a **functional foundation**.
Each DESIGN_SYSTEM **freely reinterprets** these tokens to match the selected archetype.

**NEVER do this:**
- ❌ Apply the PRD background color (e.g., #F8FAFC) identically across all 3 variations
- ❌ Use the PRD primary color the same way in all 3 (e.g., all solid buttons)
- ❌ Only vary spacing/corners while keeping color/theme identical

**ALWAYS do this:**
- ✅ Apply a **different background color theme** to each variation (dark vs cream vs white, etc.)
- ✅ **Interpret PRD primary color differently** (gradient glow vs pastel+accent colors vs sparse accent)
- ✅ Apply shadows/borders/corners/typography weights **differently per archetype**

### PRD Token Reinterpretation Table (Examples per Archetype)

This table is an **example**. Adapt appropriately based on the actual archetype combination.

| PRD Token | Dark Vibrant Reinterpretation | Warm Playful Reinterpretation | Editorial Minimal Reinterpretation |
|-----------|------------------------------|-------------------------------|-------------------------------------|
| Primary color | → Gradient (primary→purple→blue) + glow shadow | → Solid primary + 4 accent colors (coral, teal, amber, lavender) | → Use Primary for CTA/active only, 95% grayscale otherwise |
| Background | → #0B0F1A (deep navy dark) | → #FFFBF5 (warm cream) | → #FFFFFF (pure white) |
| Card background | → rgba(255,255,255,0.05) + backdrop-blur (glass) | → #FFFFFF solid + warm shadow | → #FFFFFF + 0.5px hairline border only |
| Sidebar | → Pure dark + gradient accent on active | → Warm dark purple (#1A1625) + colored icons | → Light sidebar (#F8FAFC) + 2px left border active |
| Status Open | → #FF4757 neon + glow box-shadow | → #FEE2E2 bg + #DC2626 text (pastel pill) | → 6px red dot only, no text label |
| Status In Progress | → #FFB74D neon + glow | → #FEF3C7 bg + #D97706 text | → 6px amber dot only |
| Status Resolved | → #4ADE80 neon + glow | → #D1FAE5 bg + #059669 text | → 6px green dot only |
| Border | → rgba(255,255,255,0.08) transparent | → #F0E7DB warm tone | → #F3F4F6 hairline 0.5px |
| Shadow | → 0 0 20px rgba(primary,0.3) glow | → 0 2px 8px rgba(0,0,0,0.04) warm | → None (no shadows) |
| Corner radius | → 12-16px (rounded-xl) | → 16-20px + pill buttons (rounded-2xl/full) | → 0-6px max (rounded-md) |
| Heading weight | → 700 bold + tight tracking | → 600 semibold + friendly | → 300 light + editorial size (up to 4.5rem) |
| Button style | → Gradient bg + glow hover | → Pill shape + lift hover | → Minimal border + subtle fill hover |

### Differentiation Verification Checklist

After generating 3 DESIGN_SYSTEMs, compare the 7 items below. **5 or more must differ to pass:**

| # | Item | A | B | C | Different? |
|---|------|---|---|---|------------|
| 1 | Background color theme | (dark/light/white/cream/gradient) | | | □ |
| 2 | Shadow style | (glow/soft/none/hard/glass) | | | □ |
| 3 | Border treatment | (transparent/warm/hairline/solid) | | | □ |
| 4 | Corner radius | (3xl/2xl/xl/lg/md/0) | | | □ |
| 5 | Typography weight | (700/600/500/400/300) | | | □ |
| 6 | Status color expression | (neon/pastel/dot/solid/badge) | | | □ |
| 7 | Sidebar theme | (dark/warm-dark/light/gradient/none) | | | □ |

**Pass:** 5/7 or more → proceed
**Fail:** swap archetypes and regenerate

---

## PHASE 4: CONVERT PAGES TO DESIGN BRIEFS

### 4.1 Extract All Pages from PRD

**From PRD's "Page Breakdown" or feature sections:**

| PRD Section | Page Number | Page Name | Category |
|-------------|-------------|-----------|----------|
| Common/Auth | 1, 2, 3, 4 | Login, Signup, Forgot PW | auth |
| Public | 1, 5, 6 | Landing, About, Browse (Guest) | public |
| User Features | 7, 8, 9... | Dashboard, Profile, Settings | user |
| Admin Dashboard | 20, 21, 22... | Admin Home, Queue, Reports | admin |

### 4.2 Convert PRD Page Specs to Design Brief

**For each page in PRD, create design brief:**

| PRD Element | Design Guide Format |
|-------------|-------------------|
| Page Name | **PAGE [N]: [Name]** |
| Feature description | Brief one-line description |
| Components listed | Section breakdown with components |
| User actions | Implied in layout description |

**Conversion Pattern:**

**PRD Format:**
```
#### 3.1 Login Page

**Input:**
- Email Address (required)
- Password (required, show/hide toggle)

**Next Action:**
- Login button
- "Forgot Password?" link
- Social login (Google, Apple)

**Rules:**
- Email validation
- Password minimum 8 characters
```

**Design Guide Format:**
```
**PAGE 2: Login**
Split screen 40/60: Left (brand gradient) | Right (form: email, password, social buttons)
- Email input (48px, mail icon)
- Password input (48px, lock icon, eye toggle)
- Login button (primary, full-width)
- Forgot password link
- Social buttons: Google, Apple
```

**Shorthand Template for Pages:**
```
**PAGE [N]: [Name]**
[Layout type]: [Section 1] | [Section 2] | [Section 3]
- [Key element 1]
- [Key element 2]
- [Key element 3]
```

### 4.3 Common Layout Patterns

**Recognize these patterns from PRD:**

| PRD Description | Layout Pattern | Design Brief Format |
|----------------|---------------|-------------------|
| "Login/Signup form" | Split screen auth | "Split screen 40/60: Left (branding) \| Right (form)" |
| "List of items", "Feed" | Vertical scroll list | "List/Grid view: Cards with [elements]" |
| "Dashboard" | Sidebar + main content | "Sidebar nav (200px) \| Stats cards \| Activity feed" |
| "Detail page" | Two column | "Two columns 70/30: Left (content) \| Right (sidebar)" |
| "Form submission" | Multi-step or single page | "Multi-step progress bar \| Sections: [list]" OR "Single form: [fields]" |
| "Table/List management" | Table with filters | "Filter tabs \| Sortable table \| Action buttons" |
| "Modal/Popup" | Overlay | "Modal: [trigger] → [content] → [actions]" |

---

## PHASE 5: CREATE COMPONENT PATTERNS

### 5.1 Identify Reusable Components

**From PRD, look for repeated elements:**

| PRD Pattern | Component to Define | Specs to Include |
|-------------|-------------------|-----------------|
| "Idea card", "Post card", "Product card" | Card component | Width, padding, elements, hover state |
| "Upvote", "Like", "Vote" | Vote button | Size, icon, count display |
| "Comment", "Reply" | Comment thread | Nesting, indentation, avatar size |
| "Stats", "Metrics", "Count" | Stats card | Layout, icon size, number size |
| "Form" appears multiple times | Form pattern | Input height, spacing, validation |

### 5.2 Component Pattern Template

**For each reusable component:**

```
**[Component Name] ([Style reference]):**
- [Dimension 1]: [Value]
- [Dimension 2]: [Value]
- Elements: [List of sub-elements with sizes]
- States: [Hover, active, disabled, etc.]
- Usage: [Where it's used]
```

**Example:**
```
**Idea Card (Reusable):**
- Width: 280px
- Padding: 20px
- Border radius: 12px
- Shadow on hover
- Elements: Avatar(48px), Title, Tagline, Thumbnail, Tags, Metrics
- Usage: Browse page, Featured section, Saved ideas
```

### 5.3 Add ASCII Diagrams (Optional but Helpful)

**Create simple visual representations:**

```
**[Component Name]:**
┌─────────────────────────────┐
│ [Element 1]  [Element 2]    │
│ [Element 3]                 │
│ [Element 4 with sizing]     │
└─────────────────────────────┘
```

---

## PHASE 6: CREATE CRITICAL DESIGN RULES

### 6.1 Extract Rules from PRD Features

**Look for these in PRD:**

| PRD Content | Design Rule |
|-------------|------------|
| "18+ platform", "Age verification" | "Show age notice on landing, signup, footer" |
| "Upvoting is core feature" | "Make upvote button HUGE and prominent" |
| "Professional platform" | "Professional typography, generous whitespace" |
| "Fast user experience" | "Loading states on all async actions" |
| Specific status (Original, Similar, Duplicate) | "Color-coded status badges: Green, Orange, Red" |
| "Mobile app" | "Mobile-first design, thumb-friendly tap targets" |

### 6.2 Add Universal Design Principles

**Always include:**

1. **Whitespace** - Don't cramp, be generous
2. **One Primary Action** - Per page (reduces cognitive load)
3. **Consistent Components** - Reuse design system
4. **Hover States** - Feedback on interactive elements
5. **Loading States** - For all async operations
6. **Empty States** - For zero-data scenarios
7. **Error States** - Clear, helpful error messages
8. **Accessibility** - 4.5:1 contrast ratio minimum
9. **Responsive** - Mobile/tablet/desktop considerations
10. **Performance** - Optimize images, lazy load

### 6.3 Template

```
## Critical Design Rules

1. **[Rule from PRD feature]** - [Specific guideline]
2. **[Universal principle]** - [Application]
3. **[Platform-specific requirement]** - [Implementation]
...
10. **[Performance/accessibility rule]** - [Standard]
```

---

## PHASE 7: CREATE DELIVERABLES PLAN

### 7.1 Timeline from PRD

**Extract timeline and create phases:**

| PRD Timeline | Design Phases | Days Allocated |
|-------------|--------------|----------------|
| 1 week | Research & Wireframes | 1-2 days |
| 2 weeks | Wireframes, Mockups | 3-5 days |
| 4 weeks | Wireframes, Mockups, System, Handoff | 5 days |
| 2 months | Full design cycle with iterations | 2-3 weeks |

### 7.2 Deliverables Checklist Template

**Adapt based on timeline:**

```
## Deliverables Checklist

**Day 1-2: Research & Wireframes**
- [ ] Study inspiration sites ([list from Design Philosophy])
- [ ] Collect reference images
- [ ] Low-fidelity wireframes (all [TOTAL_PAGES] pages)

**Day 3-[N]: High-Fidelity Mockups**
- [ ] High-fidelity mockups ([N] key pages):
  - [Page 1 from PRD]
  - [Page 2]
  - [Page 3]
  - ...
- [ ] Remaining pages

**Day [N+1]-[N+2]: Design System & Components**
- [ ] Design system (colors, typography, spacing)
- [ ] Component library creation
- [ ] Interactive prototype (key flows)

**Day [N+3]-[Final]: Finalization**
- [ ] Dark mode variants (if applicable)
- [ ] Responsive designs (mobile, tablet)
- [ ] Design QA, final polish
- [ ] Handoff documentation

**Final Delivery:**
- [ ] Figma file with all pages
- [ ] Component library (organized, documented)
- [ ] Design system guide
- [ ] Icon set (SVG exports)
- [ ] Image assets (optimized)
- [ ] Interactive prototype link
- [ ] Developer handoff notes
```

### 7.3 Priority Order

**From PRD, determine page priority:**

**Criteria:**
- Landing page = Highest (first impression)
- Auth pages = High (entry point)
- Core features = High (main value)
- Admin pages = Medium (internal tool)
- Legal/Settings = Low (necessary but not core)

**Template:**
```
**Priority Order:**
1. [Landing/Homepage] (first impression)
2. [Auth pages] (entry point)
3. [Core feature pages] (main value)
4. [Dashboard] (regular use)
5. [Admin pages] (internal)
6. [Settings/Legal] (necessary)
```

---

## COMPLETE DESIGN GUIDE TEMPLATE

**Use this template structure:**

```markdown
# [PROJECT_NAME] - Design Guide for [DESIGNER_NAME]

**Project:** [PROJECT_NAME] [VERSION]
**Designer:** [DESIGNER_NAME]
**Timeline:** [TIMELINE]

---

## Design Philosophy

**Core Inspiration (Must Study):**
1. **[Reference App 1]** - [Feature to study]
2. **[Reference App 2]** - [Feature to study]
3. **[Reference App 3]** - [Feature to study]
4. **[Reference App 4]** - [Feature to study]

**The [Number] Pillars:**
- [Feature Area 1] = [Reference] ([pattern])
- [Feature Area 2] = [Reference] ([pattern])
- [Feature Area 3] = [Reference] ([pattern])

---

## Page Count: [TOTAL_PAGES] Total Pages

**[User Type 1] ([N] pages):**
[Page numbers]: [Page names]

**[User Type 2] ([N] pages):**
[Page numbers]: [Page names]

**[User Type 3] ([N] pages):**
[Page numbers]: [Page names]

---

## Design System Quick Reference

### Colors
- Primary [Name]: [HEX] ([Usage])
- Success [Name]: [HEX] ([Usage])
- Warning [Name]: [HEX] ([Usage])
- Error [Name]: [HEX] ([Usage])
- Grays: 50-900 scale

### Typography
- Font: [FONT_FAMILY]
- H1: [SIZE]px (hero only), H2: [SIZE]px, H3: [SIZE]px, H4: [SIZE]px
- Body: [SIZE]px, Small: [SIZE]px, Caption: [SIZE]px
- Weights: 400 (regular), 500 (medium), 600 (semibold), 700 (bold)

### Spacing
- Base: [BASE_UNIT] grid
- Card padding: [VALUE]
- Section padding: [VALUE]
- Between cards: [VALUE]

### Key Components

**[Component 1 Name]:**
- [Spec 1]: [Value]
- [Spec 2]: [Value]
- [Usage]: [Where used]

**[Component 2 Name]:**
- [Spec 1]: [Value]
- [Spec 2]: [Value]

---

## Page-by-Page Design Brief

### [USER_TYPE_1] PAGES

**PAGE 1: [Page Name]**
[Layout description]: [Section 1] | [Section 2] | [Section 3]
- [Key element 1]
- [Key element 2]
- [Key element 3]

**PAGE 2: [Page Name]**
[Layout description]
- [Elements]

### [USER_TYPE_2] PAGES

**PAGE [N]: [Page Name]**
[Layout description]
- [Elements]

### [USER_TYPE_3] PAGES

**PAGE [N]: [Page Name]**
[Layout description]
- [Elements]

---

## Critical Design Rules

1. **[Rule 1]** - [Description]
2. **[Rule 2]** - [Description]
3. **[Rule 3]** - [Description]
...
10. **[Rule 10]** - [Description]

---

## Component Patterns

### [Component 1] (Reusable)
```
[ASCII diagram if helpful]
```
- [Specs]
- [Elements]
- [Usage]

### [Component 2]
```
[ASCII diagram if helpful]
```
- [Specs]

---

## Deliverables Checklist

**Day 1-2:**
- [ ] [Tasks]

**Day 3-[N]:**
- [ ] [Tasks]

**Day [N+1]:**
- [ ] [Tasks]

**Final Delivery:**
- [ ] Figma file
- [ ] Component library
- [ ] Design system guide
- [ ] Assets
- [ ] Prototype
- [ ] Handoff docs

---

## Design Tips

1. **Consistency First** - Use design system components everywhere
2. **Accessibility** - 4.5:1 contrast ratio minimum
3. **Performance** - Optimize images, use SVG icons
4. **Responsive** - [Desktop/Mobile]-first approach
5. **States** - Loading, empty, error for everything
6. **Real Content** - Use realistic text, not Lorem Ipsum
7. **Whitespace** - Generous spacing
8. **Hierarchy** - Clear visual importance
9. **Feedback** - User knows what's happening
10. **Polish** - Subtle animations, consistent shadows

---

## Success Criteria

Your design succeeds if:
- ✅ [Feature 1] looks like [Reference App] ([pattern])
- ✅ [Feature 2] feels [adjective]
- ✅ Users can [core action] easily
- ✅ Platform feels [brand adjective - professional/playful/trustworthy]
- ✅ All [TOTAL_PAGES] pages designed
- ✅ Component library complete
- ✅ Responsive at all breakpoints

---

**Priority Order:**
1. [Page 1] (reason)
2. [Page 2] (reason)
3. [Page 3] (reason)
4. [Page 4] (reason)
5. [Page 5] (reason)

Good luck! 🎨🚀
```

---

## CONVERSION EXAMPLES

### Example 1: Login Page

**PRD Input:**
```
#### 2.1 Login Page

**Input:**
- Email Address (required)
- Password (required)
- Show/hide password toggle

**Actions:**
- Login button (primary)
- "Forgot Password?" link
- Social login: Google, Apple

**Next:**
- Success → Dashboard
- Error → Show message
```

**Design Guide Output:**
```
**PAGE 2: Login**
Split screen 40/60: Left (brand gradient) | Right (form: email, password, social buttons)

Elements:
- Email input (48px height, mail icon)
- Password input (48px height, lock icon, eye toggle)
- Login button (primary, full-width, 48px)
- "Forgot Password?" link (below form)
- Divider: "Or continue with"
- Social buttons: Google (white bg), Apple (black bg)
```

### Example 2: Dashboard

**PRD Input:**
```
#### 5.1 Admin Dashboard

**Sidebar Navigation:**
1. Overview
2. Pending Approvals
3. Reports
4. Settings

**Main Content:**
- Stats cards (4 metrics)
- Recent activity feed
- Quick actions
```

**Design Guide Output:**
```
**PAGE 20: Admin Home**
Sidebar nav (200px, collapsible) | Stats cards (4 across) | Activity feed | Quick actions

Layout:
- Sidebar: Navigation items, icons 20px, active state with primary color
- Stats cards: Icon 32px, metric 32px bold, label 14px gray
- Activity feed: Timeline style, avatar 32px, timestamp
- Quick actions: Button row at top
```

### Example 3: Form Submission

**PRD Input:**
```
#### 3.2 Submit Idea

**Step 1: Basic Info**
- Project Name (max 100 chars)
- Tagline (max 150 chars)
- Category (dropdown)

**Step 2: Story**
- Rich text editor (max 5000 chars)

**Step 3: SWOT Analysis**
- Strengths, Weaknesses, Opportunities, Threats

**Step 4: Media**
- Upload images (max 5)
- Upload video OR YouTube link
```

**Design Guide Output:**
```
**PAGE 8: Submit Idea**
Multi-step progress bar | Sections: Basic Info | Story (rich editor) | SWOT (2x2 grid) | Media upload | Actions

Progress bar: 5 steps, show completion, click to navigate completed steps
- Step 1: Project name input, tagline input, category dropdown
- Step 2: Rich text editor (400px height, char counter)
- Step 3: SWOT grid (2x2, equal quadrants, textarea each)
- Step 4: Image uploader (drag-drop, preview grid), video upload/URL
- Actions: Back, Next/Submit buttons (bottom, full-width on mobile)
```

---

## QUICK REFERENCE CHECKLIST

**Before starting conversion:**
- [ ] PRD read completely
- [ ] Project name, timeline, designer extracted
- [ ] All pages counted
- [ ] User types identified

**Phase 1 - Basic Info:**
- [ ] Project metadata extracted
- [ ] Page count calculated
- [ ] User types listed

**Phase 2 - Design Philosophy:**
- [ ] Reference apps identified from features
- [ ] Design pillars created (3-4)
- [ ] Inspiration mapped to features

**Phase 3 - Design System:**
- [ ] Colors defined (primary, success, warning, error + neutrals)
- [ ] Typography specified (font, sizes, weights)
- [ ] Spacing system created (base unit, padding, gaps)
- [ ] Component specs started

**Phase 4 - Page Conversion:**
- [ ] All pages from PRD listed
- [ ] Each page converted to shorthand design brief
- [ ] Layout patterns identified
- [ ] Key elements listed

**Phase 5 - Component Patterns:**
- [ ] Reusable components identified
- [ ] Specs for each component
- [ ] ASCII diagrams (optional)
- [ ] Usage notes

**Phase 6 - Design Rules:**
- [ ] PRD-specific rules extracted
- [ ] Universal principles added
- [ ] Platform requirements noted

**Phase 7 - Deliverables:**
- [ ] Timeline converted to phases
- [ ] Checklist created
- [ ] Priority order defined
- [ ] Success criteria listed

**Final Review:**
- [ ] All [PLACEHOLDERS] filled
- [ ] Page count matches PRD
- [ ] Design philosophy makes sense
- [ ] Component patterns are reusable
- [ ] Design Guide is actionable for designer

---

## OUTPUT FILE

**Save as:**
- **Filename:** `[ProjectName]_DesignGuide_[YYMMDD].md`
- **Location:** `.claude-project/design/` or project root
- **Format:** Markdown (.md)

**Share with:**
- Designer (primary recipient)
- Developer (for context)
- Project Manager (for timeline)

---

**Template Version:** 1.0
**Created:** January 15, 2026
**Purpose:** Convert any PRD to Design Guide
**Reusable:** Yes, for all projects
