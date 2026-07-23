---
name: prd-to-design-prompts
description: Convert PRD to structured design prompts for AI design tools
---

# UI Design Prompt Format

> **Fast path** — converts PRD directly to design prompts, skipping the Design Guide step.
> Use this when you need speed. Use `prd-to-design-guide` → `design-guide-to-prompts` when you need richer design exploration or multiple design variants.

This template generates structured design prompts compatible with `/prompts-to-html` command. The prompts work with any AI design tool (Aura.build, v0.dev, Bolt, Lovable, etc.).

---

## TEMPLATE VARIABLES

Replace these placeholders with your project-specific values:

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `[PROJECT_NAME]` | Your application name | MediCare+, FinanceHub, ShopEase |
| `[TYPE]` | Application type | Web Application, Mobile App, Desktop-first |
| `[STYLE]` | Design style | Modern SaaS, Minimal, Corporate |
| `[INDUSTRY]` | App category/industry | Healthcare, Fintech, E-commerce |
| `[PRIMARY_COLOR]` | Main brand color (hex) | #0077B6, #6366F1, #10B981 |
| `[SECONDARY_COLOR]` | Supporting brand color (hex) | #00B4D8, #8B5CF6, #34D399 |
| `[SUCCESS_COLOR]` | Success state color (hex) | #10B981, #22C55E |
| `[WARNING_COLOR]` | Warning state color (hex) | #F59E0B, #EAB308 |
| `[ERROR_COLOR]` | Error state color (hex) | #EF4444, #DC2626 |
| `[BACKGROUND_COLOR]` | App background color (hex) | #FFFFFF, #F8FAFC, #F3F4F6 |
| `[SURFACE_COLOR]` | Card/surface color (hex) | #FFFFFF, #F9FAFB |
| `[TEXT_PRIMARY]` | Primary text color (hex) | #1E293B, #111827, #0F172A |
| `[TEXT_SECONDARY]` | Secondary text color (hex) | #64748B, #6B7280, #475569 |
| `[BORDER_COLOR]` | Border color (hex) | #E5E7EB, #D1D5DB |
| `[FONT_FAMILY]` | Primary font family | Inter, SF Pro Display, Poppins |
| `[FONT_MONO]` | Monospace font family | JetBrains Mono, Fira Code |
| `[BORDER_RADIUS_CARD]` | Card corner radius | 8px, 12px, 16px |
| `[BORDER_RADIUS_BUTTON]` | Button corner radius | 6px, 8px |
| `[BORDER_RADIUS_INPUT]` | Input corner radius | 4px, 6px |
| `[SHADOW]` | Default box shadow | 0 1px 3px rgba(0,0,0,0.1) |
| `[TRANSITION]` | Default transition timing | 200ms ease, 300ms ease-in-out |
| `[ICONS]` | Icon library | Lucide Icons, Heroicons, Feather |

---

## OUTPUT FORMAT

The generated file should follow this exact structure:

```markdown
---
project_name: "[PROJECT_NAME]"
total_pages: [TOTAL_PAGE_COUNT]
design_system:
  type: "[TYPE]"
  style: "[STYLE]"
  industry: "[INDUSTRY]"
  primary_color: "[PRIMARY_COLOR]"
  secondary_color: "[SECONDARY_COLOR]"
  font: "[FONT_FAMILY]"
  icons: "[ICONS]"
---

# [PROJECT_NAME] - Design Prompts

## Design System

[PROJECT_NAME] - [TYPE] for [INDUSTRY].
Style: [STYLE] with [PRIMARY_COLOR] primary and [SECONDARY_COLOR] secondary colors.

**Colors:**
- Primary: [PRIMARY_COLOR]
- Secondary: [SECONDARY_COLOR]
- Success: [SUCCESS_COLOR]
- Warning: [WARNING_COLOR]
- Error: [ERROR_COLOR]
- Background: [BACKGROUND_COLOR]
- Surface: [SURFACE_COLOR]
- Text Primary: [TEXT_PRIMARY]
- Text Secondary: [TEXT_SECONDARY]
- Border: [BORDER_COLOR]

**Typography:**
- Font Family: [FONT_FAMILY]
- Monospace: [FONT_MONO]

**Styling:**
- Card Radius: [BORDER_RADIUS_CARD]
- Button Radius: [BORDER_RADIUS_BUTTON]
- Input Radius: [BORDER_RADIUS_INPUT]
- Shadow: [SHADOW]
- Transition: [TRANSITION]
- Icons: [ICONS]

---

## Page: 01-[page-slug]
name: [Page Display Name]
category: [auth|user|admin|public]

### SCREEN OVERVIEW
[Brief description of the screen's purpose and context. 2-4 sentences explaining what this screen does, its role in the application flow, and key objectives.]

Purpose:
- [Primary purpose]
- [Secondary purpose]
- [Additional goals]

### LAYOUT INSTRUCTIONS

**[SECTION NAME] ([specifications]):**
- [Element]: [Description, measurements, styling]
- [Element]: [Description, measurements, styling]
- [Sub-element details]

**[SECTION NAME]:**
- [Layout specifications]
- [Component details]
- [Positioning and spacing]

**[SECTION NAME]:**
- [Form fields / Content areas / Interactive elements]
- [Styling details]
- [States and variations]

### KEY FEATURES
- [Feature 1 with brief description]
- [Feature 2 with brief description]
- [Feature 3 with brief description]
- [Animation/interaction details]
- [Responsive behavior]
- [State management]

### MAIN ACTIONS
| Action | Trigger | Behavior |
|--------|---------|----------|
| [Action Name] | [User interaction or system event] | [Expected outcome/navigation/state change] |
| [Action Name] | [User interaction or system event] | [Expected outcome/navigation/state change] |
| [Action Name] | [User interaction or system event] | [Expected outcome/navigation/state change] |

### BRANDING ELEMENTS
- [Brand-specific styling notes]
- [Color usage guidelines for this page]
- [Consistency notes]

---

## Page: 02-[page-slug]
name: [Page Display Name]
category: [auth|user|admin|public]

[... repeat for each page ...]

---
```

---

## PAGE NAMING CONVENTIONS

| Category | Slug Format | Examples |
|----------|-------------|----------|
| Auth | `01-login`, `02-signup`, `03-forgot-password` | Login, Sign Up, Forgot Password |
| User | `05-dashboard`, `06-browse`, `07-detail` | Dashboard, Browse, Detail View |
| Admin | `14-admin-dashboard`, `15-admin-queue` | Admin Home, Pending Queue |
| Public | `01-landing`, `02-about` | Landing Page, About Us |

---

## CATEGORY VALUES

| Category | Description |
|----------|-------------|
| `public` | Pages accessible without login (landing, about, etc.) |
| `auth` | Authentication pages (login, signup, password reset) |
| `user` | Logged-in user pages (dashboard, profile, etc.) |
| `admin` | Admin dashboard pages |

---

## PARSING RULES (for /prompts-to-html)

The command parses the generated file as follows:

| Element | Parsing Method | Required |
|---------|----------------|----------|
| `project_name` | YAML frontmatter | ✓ |
| `total_pages` | YAML frontmatter | ✓ |
| `## Design System` | Section content → common prompt prefix | ✓ |
| `## Page: [filename]` | Regex `/^## Page: (.+)$/gm` | ✓ |
| `name:` | First line after page header | ✓ |
| `category:` | Second line after page header | Optional |
| `---` | Page separator | ✓ |

---

## EXAMPLE OUTPUT

```markdown
---
project_name: "Crowd Builder"
total_pages: 20
design_system:
  type: "Web Application (Desktop-first, Responsive)"
  style: "Modern SaaS, Professional, Clean"
  industry: "Investment/Startup Platform"
  primary_color: "#6366F1"
  secondary_color: "#8B5CF6"
  font: "Inter"
  icons: "Lucide Icons"
---

# Crowd Builder - Design Prompts

## Design System

Crowd Builder - Web Application (Desktop-first, Responsive) for Investment/Startup Platform.
Style: Modern SaaS, Professional, Clean with #6366F1 (Indigo) primary and #8B5CF6 (Violet) secondary colors.

**Colors:**
- Primary: #6366F1 (Indigo)
- Secondary: #8B5CF6 (Violet)
- Success: #10B981 (Emerald)
- Warning: #F59E0B (Amber)
- Error: #EF4444 (Red)
- Background: #F9FAFB (Light Gray)
- Surface: #FFFFFF (White)
- Text Primary: #111827 (Gray 900)
- Text Secondary: #6B7280 (Gray 500)
- Border: #E5E7EB (Gray 200)

**Typography:**
- Font Family: Inter
- Monospace: JetBrains Mono

**Styling:**
- Card Radius: 8px
- Button Radius: 6px
- Input Radius: 4px
- Shadow: 0 1px 3px rgba(0,0,0,0.1)
- Transition: 200ms ease
- Icons: Lucide Icons (outlined style)

---

## Page: 01-login
name: Login Page
category: auth

### SCREEN OVERVIEW
Create a login page for "Crowd Builder" - a crowd-owned startup investment platform. The login page allows returning users to authenticate via email/password or social OAuth providers (Google, Apple). Design should be clean, trustworthy, and quick to complete.

Purpose:
- Authenticate returning users
- Provide multiple login methods
- Quick access to password recovery
- Easy navigation to signup for new users

### LAYOUT INSTRUCTIONS

**OVERALL LAYOUT:**
- Split screen: 50% form (right), 50% branding panel (left)
- Form panel: White background
- Branding panel: Indigo gradient with illustration

**BRANDING PANEL (Left 50%):**
- Background: Linear gradient (indigo-600 to violet-600)
- Content (centered): Logo (white, 48px), Headline: "Welcome Back" (white, 32px), Subtext: "Turn ideas into reality with community power"
- Abstract illustration: People collaborating on ideas
- Pattern overlay: Subtle dot grid at 10% opacity

**FORM PANEL (Right 50%):**
- Content centered vertically, max-width 400px
- Top: "Sign In" (28px, bold)
- Subtitle: "Enter your credentials to continue" (14px, gray)

**FORM FIELDS (24px vertical gap):**
- Email Input: Label "Email Address", 48px height, mail icon, placeholder "you@example.com"
- Password Input: Label "Password", 48px height, lock icon, eye toggle
- Options Row: Checkbox "Remember me" (left), "Forgot Password?" link (right)
- Submit Button: "Sign In" (full-width, 48px, indigo)

**DIVIDER:** "Or continue with" with horizontal lines

**SOCIAL LOGIN ROW:**
- Google button (white bg, border)
- Apple button (black bg)

**FOOTER LINK:** "Don't have an account? Sign Up"

### KEY FEATURES
- Real-time email validation
- Password visibility toggle
- Remember me persists session
- Social OAuth redirects (Google, Apple)
- Error states: Red border, error message below field
- Loading states on buttons
- Mobile: Branding panel hidden, form full-width

### MAIN ACTIONS
| Action | Trigger | Behavior |
|--------|---------|----------|
| Submit Login | Click "Sign In" button | Validate fields, send auth request, show loading state |
| Login Success | Valid credentials | Store auth token, redirect to User Dashboard |
| Login Failed | Invalid credentials | Show error message below form, highlight invalid fields |
| Toggle Password Visibility | Click eye icon | Show/hide password text |
| Remember Me | Check/uncheck checkbox | Persist session token beyond browser close |
| Forgot Password | Click "Forgot Password?" link | Route to Forgot Password Page |
| Google OAuth | Click Google button | Redirect to Google OAuth flow, return with token |
| Apple OAuth | Click Apple button | Redirect to Apple OAuth flow, return with token |
| Navigate to Sign Up | Click "Sign Up" link | Route to Sign Up Page |

### BRANDING ELEMENTS
- Indigo gradient on branding panel
- Consistent input styling with brand colors
- Trust indicator: Lock icon near form
- Professional, minimal design
- Focus states use brand primary color

---

## Page: 02-signup
name: Sign Up Page
category: auth

[... continue with remaining pages ...]
```

---

## TIPS FOR GOOD OUTPUT

1. **Use consistent slug naming**: `01-login`, `02-signup`, not `01-Login-Page`
2. **Include all design system values**: Colors, typography, spacing in the Design System section
3. **Be specific in layouts**: Include pixel values, percentages, spacing
4. **Add Main Actions table**: Helps define interactivity
5. **Separate pages with `---`**: Critical for parsing
6. **Match total_pages count**: Ensure frontmatter matches actual page count
