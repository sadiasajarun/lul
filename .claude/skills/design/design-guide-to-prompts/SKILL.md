---
name: design-guide-to-prompts
description: Convert Design Guide to AI design tool compatible design prompts
---

# Design Prompt Format (from Design Guide)

This template generates design prompts compatible with `/prompts-to-html` command from a Design Guide document.

---

## WORKFLOW

1. Read Design Guide file
2. Extract design system (colors, typography, spacing, components)
3. Extract page-by-page design instructions
4. Generate tool-compatible prompts for each page
5. Output single markdown file with all pages

---

## INPUT: DESIGN GUIDE STRUCTURE

The Design Guide should contain:
- **Design Philosophy**: Inspiration references, design pillars
- **Design System**: Colors, typography, spacing, components
- **Page-by-Page Design Brief**: Layout and component descriptions for each page
- **Component Patterns**: Reusable component specifications
- **Page Count**: Total number of pages to design

---

## OUTPUT FORMAT

The generated file should follow this exact structure:

```markdown
---
project_name: "[PROJECT_NAME from Design Guide]"
total_pages: [TOTAL_PAGE_COUNT from Design Guide]
design_system:
  type: "[Derived from Design Guide - Web/Mobile/Desktop]"
  style: "[From Design Philosophy section]"
  industry: "[From Project Description]"
  primary_color: "[From Design System Colors]"
  secondary_color: "[From Design System Colors]"
  font: "[From Typography section]"
  icons: "[From Design System or default to Lucide Icons]"
---

# [PROJECT_NAME] - Design Prompts

## Design System

[PROJECT_NAME] - [TYPE] for [INDUSTRY].
Style: [STYLE_DESCRIPTION] with [PRIMARY_COLOR] primary and [SECONDARY_COLOR] secondary colors.

**Design Inspiration:**
[List from Design Philosophy - e.g., "Product Hunt for upvoting, Reddit for comments, LinkedIn for feed, Stripe for dashboard"]

**Colors:**
- Primary: [PRIMARY_COLOR] - [Usage from Design Guide]
- Secondary: [SECONDARY_COLOR] - [Usage]
- Success: [SUCCESS_COLOR] - [Usage - e.g., Original ideas]
- Warning: [WARNING_COLOR] - [Usage - e.g., Similar ideas]
- Error: [ERROR_COLOR] - [Usage - e.g., Duplicates]
- Background: [BACKGROUND_COLOR]
- Surface: [SURFACE_COLOR]
- Text Primary: [TEXT_PRIMARY]
- Text Secondary: [TEXT_SECONDARY]
- Border: [BORDER_COLOR]

**Typography:**
- Font Family: [FONT_FAMILY from Design Guide]
- H1: [SIZE]px - [USAGE]
- H2: [SIZE]px - [USAGE]
- H3: [SIZE]px - [USAGE]
- H4: [SIZE]px - [USAGE]
- Body: [SIZE]px
- Small: [SIZE]px
- Caption: [SIZE]px
- Weights: [LIST_WEIGHTS from Design Guide]

**Spacing:**
- Base Unit: [BASE from Design Guide - e.g., 4px]
- Card Padding: [VALUE from Design Guide]
- Section Padding: [VALUE]
- Between Cards: [VALUE]

**Styling:**
- Card Radius: [BORDER_RADIUS_CARD from Component Patterns]
- Button Radius: [BORDER_RADIUS_BUTTON]
- Input Radius: [BORDER_RADIUS_INPUT or default to sm]
- Shadow: [SHADOW value from Design Guide or default]
- Transition: [TRANSITION from Design Guide or 200ms ease]
- Icons: [ICONS from Design Guide or Lucide Icons]

**Component Standards:**
[Extract key component patterns from Design Guide]
- [Component 1]: [Specifications]
- [Component 2]: [Specifications]
- [Component 3]: [Specifications]

---

## Page: 01-[page-slug]
name: [Page Display Name from Design Guide]
category: [auth|user|admin|public - derived from page type]

### SCREEN OVERVIEW
[Extract from Design Guide page description. Convert "PAGE N: [Name]" section into 2-4 sentence overview explaining purpose, role in flow, and key objectives.]

Purpose:
- [Extract from Design Guide or infer from page description]
- [Secondary purpose]
- [Additional goals]

### LAYOUT INSTRUCTIONS

[Convert Design Guide's layout description into detailed prompt format]

**[SECTION NAME from Design Guide]:**
- [Element from Design Guide]: [Add specifications - size, color, positioning]
- [Element]: [Detailed description with measurements]
- [Sub-elements with spacing and styling]

**[SECTION NAME]:**
- [Convert Design Guide components to detailed layout specs]
- [Include measurements in px or %]
- [Add styling details from Design System]

**[SECTION NAME]:**
- [Form fields / Content areas from Design Guide]
- [Add input heights, widths, styling from Design System]
- [States and variations]

### KEY FEATURES
[Extract from Design Guide page description]
- [Feature 1 with component details from Design Guide]
- [Feature 2 - add interaction details]
- [Feature 3 - add responsive notes]
- [Animation/interaction details from Critical Design Rules]
- [Responsive behavior - mobile/tablet adaptations]
- [State management - loading, error, empty states]

### MAIN ACTIONS
| Action | Trigger | Behavior |
|--------|---------|----------|
| [Action from Design Guide flow] | [User interaction] | [Expected outcome - navigation, state change] |
| [Infer additional actions from components] | [Interaction] | [Behavior] |
| [Add standard actions - submit, cancel, delete] | [Trigger] | [Outcome] |

### BRANDING ELEMENTS
[Extract from Design Philosophy and Critical Design Rules]
- [Design Philosophy inspiration - e.g., "Product Hunt style upvote"]
- [Color usage specific to this page]
- [Component patterns from Component Patterns section]
- [Consistency notes from Design Tips]

---

[Repeat for each page from Design Guide's Page-by-Page section]

---
```

---

## EXTRACTION RULES

### 1. Design System Extraction

**From Design Guide, extract:**

| Design Guide Section | Prompt Field | Transformation |
|---------------------|------------|----------------|
| `Project Name` (header) | `project_name` | Direct copy |
| `Page Count: N Total Pages` | `total_pages` | Extract number N |
| `Design Philosophy` → Inspiration | `style` | Convert to style description |
| `Colors` → Primary | `primary_color` | Extract hex code |
| `Colors` → Success/Warning/Error | Color palette | Map to success/warning/error |
| `Typography` → Font | `font` | Extract font family |
| `Typography` → Sizes | Typography section | Map H1-H4, Body, Small |
| `Spacing` → Base | Spacing section | Extract grid system |
| `Key Components` | Styling section | Extract radius, shadows |

**Example Transformation:**
```
Design Guide:
"Primary Blue: #0066FF"

Prompt Output:
primary_color: "#0066FF"
```

### 2. Page Extraction

**From Design Guide Page-by-Page section:**

| Design Guide Format | Prompt Format | Notes |
|-------------------|-------------|-------|
| `PAGE 1: Landing Page` | `## Page: 01-landing` | Convert to slug |
| `PAGE 7: Dashboard Home` | `## Page: 07-dashboard` | Use page number from Design Guide |
| `Sections: Header \| Hero \| ...` | LAYOUT INSTRUCTIONS | Expand each section |
| Guest/User/Admin label | `category:` | Map to auth/user/admin/public |

**Category Mapping:**
- "Guest Users" pages → `category: public`
- "Logged In Users" pages → `category: user`
- "Admin" pages → `category: admin`
- Login/Signup/Forgot Password → `category: auth`

### 3. Layout Conversion

**Design Guide Format:**
```
**PAGE 2: Login**
Split screen 40/60: Left (brand gradient) | Right (form: email, password, social buttons)
```

**Prompt Format:**
```
**OVERALL LAYOUT:**
- Split screen: 40% branding panel (left), 60% form panel (right)
- Branding panel: Gradient background using primary color
- Form panel: White background, centered content

**BRANDING PANEL (Left 40%):**
- Background: Linear gradient using primary (#0066FF) and secondary colors
- Content: Logo, welcome text, illustration
- Padding: 32px

**FORM PANEL (Right 60%):**
- Max-width: 400px
- Centered vertically
- Heading: "Sign In" (H2 size from Design System: 36px)
- Fields: Email input, Password input (48px height from Design System)
- Button: Primary button (full-width)
```

**Conversion Rules:**
1. **Add measurements**: "Split screen 40/60" → "40% left, 60% right"
2. **Reference Design System**: "form" → "48px height inputs per Design System"
3. **Expand abbreviations**: "social buttons" → "Google OAuth button, Apple OAuth button"
4. **Add styling**: "gradient bg" → "Linear gradient using primary (#0066FF)"

### 4. Component Pattern Integration

**Design Guide has component patterns:**
```
**Upvote Button (Product Hunt style):**
- Large arrow (32px)
- Vote count (24px bold)
- Size: 120x100px
- Border changes when voted
```

**Use in page layouts:**
```
**UPVOTE SECTION:**
- Component: Upvote button (Product Hunt style from Component Patterns)
- Position: Top-right of idea card
- Size: 120x100px
- Arrow icon: 32px
- Vote count: 24px bold
- States: Default (gray border), Voted (primary color border)
- Interaction: Click toggles vote, count updates with animation
```

### 5. Critical Design Rules Integration

**From Design Guide's Critical Design Rules, add to relevant pages:**

Example:
```
Design Guide Rule:
"1. Upvote Button - Make it HUGE and prominent like Product Hunt"

Add to Browse Ideas page BRANDING ELEMENTS:
- Upvote button is prominently sized (120x100px) following Product Hunt pattern
- Always visible in card top-right corner
- Primary color when voted for visual feedback
```

---

## PAGE NAMING CONVENTIONS

Use Design Guide page numbers + descriptive slugs:

| Design Guide | Slug | Category |
|--------------|-----------|----------|
| PAGE 1: Landing Page | `01-landing` | public |
| PAGE 2: Login | `02-login` | auth |
| PAGE 3: Signup | `03-signup` | auth |
| PAGE 4: Forgot Password | `04-forgot-password` | auth |
| PAGE 5: How It Works | `05-how-it-works` | public |
| PAGE 6: Browse (Guest) | `06-browse-guest` | public |
| PAGE 7: Dashboard Home | `07-dashboard` | user |
| PAGE 8: Submit Idea | `08-submit-idea` | user |
| PAGE 20: Admin Home | `20-admin-dashboard` | admin |
| PAGE 21: Pending Queue | `21-pending-queue` | admin |

**Slug Rules:**
1. Start with page number (01, 02, 03...)
2. Use kebab-case for name
3. Keep concise but descriptive
4. Match Design Guide numbering

---

## COMPONENT PATTERN LIBRARY

**Extract from Design Guide Component Patterns section:**

### Idea Card Pattern
```
Design Guide:
**Idea Card:**
- Width: 280px
- Padding: 20px
- Border radius: 12px
- Shadow on hover
- Elements: Avatar(48px), Title, Tagline, Thumbnail, Tags, Metrics

Prompt Usage in Browse page:
**IDEA CARD COMPONENT:**
- Card: 280px width, 20px padding, 12px border radius
- Hover: Subtle shadow (from Design System shadow value)
- Header: Avatar (48px circle), Project name (H4 size), Category badge
- Content: Tagline (one line, ellipsis overflow)
- Media: Thumbnail (16:9 aspect ratio, optional)
- Footer: Tags (pill style), Metrics (upvote count, comment count, bookmark icon)
- Status badge: Color-coded (Green=Original, Orange=Similar, Red=Duplicate)
```

### Comment Thread Pattern
```
Design Guide:
**Comment Thread:**
- Vertical line: 1px gray
- Indent: 24px per level
- Avatar: 32px circle
- Nest max 4-5 levels

Prompt Usage in Idea Detail page:
**COMMENT THREAD:**
- Top-level: Full width, no indent
- Reply level 1: 24px left indent, 1px gray vertical line
- Reply level 2: 48px left indent (24px * 2)
- Reply level 3: 72px left indent (24px * 3)
- Max nesting: 4-5 levels (design guidance)
- Avatar: 32px circle next to each comment
- Comment card: White background, 16px padding, subtle border
- Actions: Upvote count, Reply button (text-only, no border)
```

### Stats Card Pattern
```
Design Guide:
**Stats Card:**
- Icon 32px
- Number: 32px bold
- Label: 14px gray

Prompt Usage in Dashboard:
**STATS CARD GRID (3 cards across):**
Each card:
- Background: White (surface color)
- Border: 1px solid border color
- Border radius: 12px (card radius from Design System)
- Padding: 24px
- Icon: 32px, primary color
- Metric: 32px font size, bold weight, text primary color
- Label: 14px font size, text secondary color
- Hover: Subtle shadow (from Design System)
```

---

## DESIGN PHILOSOPHY INTEGRATION

**From Design Guide's Design Philosophy section, integrate into each page:**

### Product Hunt Inspiration
**Apply to:** Browse Ideas, Idea Detail
```
BRANDING ELEMENTS:
- Upvote button styled like Product Hunt (large, prominent, top positioning)
- Card layout with ranking visual hierarchy
- Metrics prominently displayed (votes, comments)
```

### Reddit Inspiration
**Apply to:** Idea Detail (comments), any page with discussions
```
LAYOUT INSTRUCTIONS for Comments:
- Threaded comment structure (Reddit-style)
- Vertical lines connecting reply levels
- Indent 24px per nesting level
- Avatar and username pattern
- Upvote on comments
```

### LinkedIn Inspiration
**Apply to:** Browse Ideas feed, Dashboard activity feed
```
BRANDING ELEMENTS:
- Professional card design (clean, white background)
- Achievement feel (status badges, metrics)
- Feed layout (vertical scrolling cards)
- Creator info prominently shown (avatar, name)
```

### Stripe Inspiration
**Apply to:** All dashboards (user & admin)
```
LAYOUT INSTRUCTIONS:
- Clean, minimal layout
- Content-first design (remove unnecessary chrome)
- One primary action per page
- Clear visual hierarchy
- Generous whitespace (section padding: 32px from Design System)
```

---

## RESPONSIVE BEHAVIOR

**From Design Guide, add responsive notes:**

```
Design Guide:
"Responsive - Desktop first (tablet/mobile in Phase 2)"

Add to each page KEY FEATURES:
- Desktop-first design (1440px optimal)
- Tablet: [Specify adaptations if mentioned]
- Mobile: Deferred to Phase 2 (mention if critical)
```

---

## STATE VARIATIONS

**From Design Guide tips, add to KEY FEATURES:**

```
Design Guide:
"Loading States - Design for every async action"
"Empty States - Design for zero data scenarios"
"Error States - Clear, helpful error messages"

Add to relevant pages:
- Loading: Skeleton screens for cards, spinner for buttons
- Empty: "No items yet" message with CTA to create
- Error: Inline validation errors, banner for system errors
- Hover: Shadow elevation increase (subtle)
- Focus: Primary color outline (accessibility)
- Disabled: 50% opacity, cursor not-allowed
```

---

## EXAMPLE CONVERSION

### Design Guide Input:
```
**PAGE 8: Submit Idea**
Multi-step progress bar | Sections: Basic Info | Story (rich editor) | SWOT (2x2 grid) | Legal | Media upload | Actions

Component Patterns:
**SWOT Grid:**
- 2x2 grid
- Strengths | Weaknesses
- Opportunities | Threats
```

### Prompt Output:
```markdown
## Page: 08-submit-idea
name: Submit Idea
category: user

### SCREEN OVERVIEW
The Submit Idea page guides users through submitting a new entrepreneurship idea to the Crowd Builder platform. Users complete a multi-step form with sections for basic information, detailed story, SWOT analysis, legal considerations, and media uploads. The form includes validation and saves progress.

Purpose:
- Collect comprehensive idea details from users
- Guide users through structured submission process
- Validate inputs before submission
- Enable media uploads (images and video)

### LAYOUT INSTRUCTIONS

**OVERALL LAYOUT:**
- Centered form: Max-width 800px
- Progress bar fixed at top
- Main content area with step sections
- Action buttons at bottom

**PROGRESS BAR (Fixed top):**
- Height: 60px
- Background: White (surface color)
- Border-bottom: 1px border color
- Content: 5 steps (Basic Info, Story, SWOT, Legal, Media)
- Active step: Primary color
- Completed steps: Success color
- Upcoming steps: Gray
- Click to navigate between completed steps

**STEP 1: BASIC INFO:**
- Section heading: "Basic Information" (H3: 24px)
- Fields (vertical stack, 24px gap):
  - Project Name: Text input, 48px height, max 100 chars
  - Tagline: Text input, 48px height, max 150 chars
  - Category: Dropdown select, 48px height
  - Tags: Multi-select input (max 10 tags)
  - Privacy: Radio buttons (Public/Private)

**STEP 2: STORY:**
- Section heading: "Tell Your Story" (H3: 24px)
- Rich text editor: 
  - Min-height: 400px
  - Toolbar: Bold, Italic, Lists, Links
  - Character counter: "0 / 5000" bottom-right
  - Placeholder: "Describe your idea in detail..."

**STEP 3: SWOT ANALYSIS:**
- Section heading: "SWOT Analysis" (H3: 24px)
- Grid: 2x2 (from Component Pattern)
- Each quadrant:
  - Label: "Strengths" / "Weaknesses" / "Opportunities" / "Threats"
  - Textarea: 200px height, max 1000 chars each
  - Counter: "0 / 1000"
- Grid gap: 16px
- Border: 1px border color between quadrants

**STEP 4: LEGAL CONSIDERATIONS:**
- Section heading: "Legal Ground" (H3: 24px)
- Textarea: 300px height, max 1000 chars
- Placeholder: "Explain any legal considerations, patents, etc."
- Helper text: "This helps us understand potential legal aspects"

**STEP 5: MEDIA UPLOAD:**
- Section heading: "Media (Optional)" (H3: 24px)
- Image uploader:
  - Drag-drop zone: 200px height, dashed border
  - Text: "Drag images here or click to browse"
  - Preview grid: Uploaded images (max 5)
  - Each preview: Thumbnail with delete button
- Video upload:
  - Option 1: Upload button (max 50MB)
  - Option 2: YouTube URL input
  - Preview: Video player or thumbnail

**ACTION BUTTONS (Bottom):**
- Left: "Save Draft" (secondary button)
- Right group:
  - "Back" button (if not first step)
  - "Next" / "Submit" button (primary, full-width on mobile)

### KEY FEATURES
- Auto-save draft every 30 seconds
- Progress bar shows completion status
- Navigate between steps (only to completed ones)
- Real-time character counters on all text fields
- Image upload with preview and delete
- Video upload (file or YouTube URL)
- Validation on each step before proceeding
- Loading state on submit button
- Success modal on submission
- Desktop: Fixed sidebar with progress, mobile: top bar
- Error messages inline below each field
- SWOT grid from Component Patterns (2x2 layout)

### MAIN ACTIONS
| Action | Trigger | Behavior |
|--------|---------|----------|
| Next Step | Click "Next" button | Validate current step, save progress, move to next step |
| Previous Step | Click "Back" button | Save current state, navigate to previous step |
| Save Draft | Click "Save Draft" or auto-save timer | Save form data, show "Draft saved" toast |
| Submit Idea | Click "Submit" on final step | Validate all steps, run similarity check, submit to admin queue |
| Upload Image | Select file or drag-drop | Upload to S3, show preview, add to form data (max 5) |
| Remove Image | Click X on image preview | Remove from preview grid and form data |
| Upload Video | File upload or YouTube URL | Process upload or validate URL, show preview |
| Navigate Steps | Click completed step in progress bar | Save current state, jump to clicked step |

### BRANDING ELEMENTS
- Clean, Stripe-inspired layout (minimal, content-first)
- One primary action per step (Next/Submit button)
- Progress indicator for user confidence
- Generous whitespace (32px section padding from Design System)
- SWOT grid follows Component Pattern specification
- Success color for completed steps in progress bar
- Primary color for active step and CTA buttons
```

---

## VALIDATION CHECKLIST

Before generating, verify Design Guide contains:
- [ ] Project name and page count
- [ ] Design System section (colors, typography, spacing)
- [ ] Design Philosophy (inspiration references)
- [ ] Page-by-Page Design Brief for all pages
- [ ] Component Patterns (reusable components)
- [ ] Critical Design Rules

---

## TIPS FOR GOOD OUTPUT

1. **Extract exact values**: Use Design Guide's px values, hex codes, don't invent
2. **Reference Component Patterns**: Link to defined patterns instead of recreating
3. **Apply Design Philosophy**: Integrate inspiration (Product Hunt, Reddit, etc.) into relevant pages
4. **Use Design System**: Reference typography sizes, spacing values, colors from Design System
5. **Expand abbreviations**: "Split screen 40/60" → detailed layout with measurements
6. **Add states**: Loading, error, empty, hover from Design Tips
7. **Include responsive**: Desktop-first notes, mobile adaptations
8. **Main Actions table**: Critical for defining interactivity
9. **Be specific**: "form" → "email input (48px height), password input with toggle"
10. **Page separator `---`**: Required for prompt parsing

---

## USAGE

```bash
/design-guide-to-prompts /path/to/design-guide.md
```

**Output:** Single markdown file with design prompts for all pages
**Location:** `.claude-project/design/[ProjectName]_DesignPrompts_[YYMMDD].md`

---

## ERROR HANDLING

- **File not found**: Verify Design Guide path
- **Missing Design System**: Cannot generate without colors/typography
- **Missing page count**: Cannot validate completeness
- **Unclear page descriptions**: Add to questions section, generate best effort
