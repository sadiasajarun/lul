---
name: prompts-to-html
description: Generate production-quality HTML screens from design prompts using UI UX Pro Max design intelligence
---

# Prompts to HTML

> **Use when**: Gemini API is unavailable. This is the fallback HTML generation path (A2) in Phase 3c.
> **Alternative**: Use `generate-html-gemini` when Gemini API is available — it's the primary path.

Generate production-quality HTML pages directly from design prompt files, powered by **UI UX Pro Max** design intelligence (50+ styles, 97 color palettes, 57 font pairings, 99 UX guidelines).

No external tools required — Claude generates all HTML using the structured design knowledge database.

---

## Prerequisites

1. **Python 3** installed (for UI UX Pro Max search scripts)
2. **Design Prompts File** — standard format from step 3b (`design-guide-to-prompts`)
3. **UI UX Pro Max** skill at `.claude/skills/design/analyze-design/`

---

## Standard Prompts File Format

Standard format that `design-guide-to-prompts` generates and this skill parses:

```markdown
---
project_name: "Project Name"
total_pages: 11
design_system:
  style: "dark"
  primary_bg: "zinc-950"
  accent: "violet-500/indigo-600"
  effects: "glassmorphism"
  font: "Inter"
  icons: "lucide"
---

# [Project Name] Design Prompts

## Design System

[Common design spec - automatically prefixed to all page prompts]

Dark mode SaaS design with zinc-950 background...

---

## Page: 01-landing
name: Landing Page
category: marketing

Create a landing page for "[Project Name]"...

---

## Page: 02-login
name: Login
category: auth

Create a login page...

---
```

### Parsing Rules

| Element | Parsing Method | Usage |
|---------|----------------|-------|
| `project_name` | YAML frontmatter | Project identifier |
| `design_system` | YAML frontmatter | Style metadata for UI UX Pro search |
| `## Design System` | Section content | Common prompt prefix for all pages |
| `## Page: [filename]` | Regex match | HTML filename |
| `name:` | First line parse | Page display name |
| `category:` | Second line parse | Page category |
| `---` | Delimiter | Page separator |

---

## Usage

```bash
/prompts-to-html <prompts-file>
/prompts-to-html <prompts-file> --output ./my-screens
/prompts-to-html <prompts-file> --project "Custom Project Name"
```

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `<prompts-file>` | Design prompts MD file path | (required) |
| `--output <dir>` | HTML save directory | `./.claude-project/generated-screens/{project_name}/` |
| `--project <name>` | Override project name | frontmatter.project_name |

---

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Parse & Setup                                      │
│  - Parse prompts file (frontmatter + pages)                  │
│  - Extract project_name, design_system, page list            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: UI UX Pro Max — Generate Design System             │
│  - Run --design-system search with project keywords          │
│  - Get: style, colors, typography, effects, anti-patterns    │
│  - Persist as design-system/MASTER.md                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: UI UX Pro Max — Stack Guidelines                   │
│  - Run --stack html-tailwind for implementation rules        │
│  - Merge with design system for complete generation context  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 4: Generate HTML Pages                                │
│  - For each page in parsed_pages:                            │
│    - Combine: design_system_prefix + page_prompt             │
│    - Apply UI UX Pro rules (accessibility, interaction, etc) │
│    - Generate complete HTML with Tailwind CSS                 │
│    - Extract layout shell from page 1, reuse for all pages   │
│    - Save to output_dir/{filename}.html                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 5: Cross-Page Consistency & Routing                   │
│  - Verify shared components identical across pages           │
│  - Wire inter-page links with actual filenames               │
│  - Run pre-delivery checklist                                │
└─────────────────────────────────────────────────────────────┘
```

---

## Execution Steps

### Step 1: Parse Prompts File

```
1. Read $ARGUMENTS prompts file path
2. Extract YAML frontmatter:
   - project_name → Project identifier
   - design_system → Style metadata (style, colors, effects, font, icons)

3. Set output_dir:
   - If --output flag provided → use that
   - Else → ./.claude-project/generated-screens/{project_name}/
   - Create directory if not exists

4. Extract "## Design System" section content → design_system_prefix

5. Find all "## Page: [filename]" sections using regex:
   Pattern: /^## Page: (.+)$/gm
   For each match:
   - filename → page.filename (e.g., "01-landing")
   - name: line → page.display_name
   - category: line → page.category
   - remaining content → page.prompt

6. Build pages array:
   [
     { filename: "01-landing", display_name: "Landing Page", category: "marketing", prompt: "..." },
     { filename: "02-login", display_name: "Login", category: "auth", prompt: "..." },
     ...
   ]
```

### Step 2: Generate Design System via UI UX Pro Max

Extract keywords from the design_system frontmatter and project context, then run the search:

```bash
# Generate comprehensive design system with reasoning
python3 .claude/skills/design/analyze-design/scripts/search.py \
  "<industry> <product_type> <style_keywords>" \
  --design-system \
  --persist \
  -p "{project_name}"
```

Example for a barbershop booking app:
```bash
python3 .claude/skills/design/analyze-design/scripts/search.py \
  "barbershop booking service professional dark" \
  --design-system \
  --persist \
  -p "EliteCuts"
```

This produces:
- Recommended **style** (e.g., glassmorphism, minimalism)
- **Color palette** with hex values and Tailwind mappings
- **Font pairing** (heading + body from Google Fonts)
- **Effects** (shadows, borders, gradients)
- **Anti-patterns** to avoid

Save output to `{output_dir}/../design/design-system/MASTER.md`

### Step 3: Get Stack Guidelines

```bash
# Get html-tailwind implementation best practices
python3 .claude/skills/design/analyze-design/scripts/search.py \
  "layout responsive form card" \
  --stack html-tailwind
```

Also get supplemental domain searches as needed:

```bash
# UX guidelines for interactions
python3 .claude/skills/design/analyze-design/scripts/search.py \
  "animation accessibility loading" \
  --domain ux

# Landing page structure (if landing page exists)
python3 .claude/skills/design/analyze-design/scripts/search.py \
  "hero social-proof pricing" \
  --domain landing
```

### Step 4: Generate HTML Pages

For each page in the pages array, generate a complete HTML file.

**Page 1 — Establish Layout Shell:**

```
1. Read MASTER.md design system
2. Combine: design_system_prefix + page.prompt + UI UX Pro rules
3. Generate complete HTML with:
   - <!DOCTYPE html> with proper meta tags (viewport, charset, description)
   - Google Fonts link for the chosen font pairing
   - Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
   - Tailwind config script with custom colors from design system
   - Lucide Icons via CDN (or chosen icon set)
   - Semantic HTML structure: <header>, <nav>, <main>, <footer>
   - Responsive design: mobile-first with sm:, md:, lg: breakpoints
   - All UI UX Pro accessibility rules applied
4. Extract the layout shell (navbar + footer + page wrapper) as LAYOUT_SHELL
5. Save to {output_dir}/01-landing.html
```

**Pages 2+N — Reuse Layout Shell:**

```
1. Start from LAYOUT_SHELL (identical navbar, footer, wrapper)
2. Replace <main> content based on page.prompt
3. Update inter-page links to use actual filenames
4. Apply page-specific UI UX Pro guidelines:
   - Forms: touch targets, labels, error feedback
   - Tables/Lists: pagination, sorting indicators
   - Dashboards: chart recommendations, data layout
   - Auth pages: password visibility, loading buttons
5. Save to {output_dir}/{filename}.html
```

**HTML Generation Rules (from UI UX Pro Max):**

| Category | Rule | Implementation |
|----------|------|----------------|
| Accessibility | Color contrast >= 4.5:1 | Use dark text on light bg, light text on dark bg |
| Accessibility | Focus states | `focus:ring-2 focus:ring-{accent}` on all interactive elements |
| Accessibility | Alt text | Descriptive alt on all `<img>` tags |
| Interaction | Touch targets >= 44px | `min-h-[44px] min-w-[44px]` on buttons/links |
| Interaction | Cursor pointer | `cursor-pointer` on all clickable elements |
| Interaction | Hover feedback | `hover:bg-{color}` or `hover:shadow-lg` transitions |
| Animation | Duration 150-300ms | `transition-all duration-200` |
| Animation | Transform only | Use `transform` and `opacity`, not `width`/`height` |
| Layout | Floating navbar | `top-4 left-4 right-4` spacing (not edge-to-edge) |
| Layout | Content padding | Account for fixed navbar height with `pt-{n}` |
| Icons | No emojis | Use Lucide/Heroicons SVG icons only |
| Icons | Consistent sizing | `w-5 h-5` or `w-6 h-6` consistently |
| Typography | Line height 1.5-1.75 | `leading-relaxed` for body text |
| Typography | Max line length | `max-w-prose` or `max-w-3xl` for text blocks |

### Step 5: Cross-Page Consistency & Routing

After all pages are generated:

```
1. VERIFY SHARED COMPONENTS:
   - Extract <nav> from each page → must be byte-identical
   - Extract <footer> from each page → must be byte-identical
   - If mismatch: copy from page 1 to all others

2. WIRE INTER-PAGE LINKS:
   - Find all <a href="#"> → replace with actual filenames
   - Find all <a href=""> → replace with actual filenames
   - Navigation links must point to correct .html files
   - Active page indicator: add active class to current nav item

3. PRE-DELIVERY CHECKLIST (from UI UX Pro Max):
   Visual Quality:
   - [ ] No emojis used as icons (use SVG instead)
   - [ ] All icons from consistent icon set (Lucide/Heroicons)
   - [ ] Hover states don't cause layout shift

   Interaction:
   - [ ] All clickable elements have cursor-pointer
   - [ ] Hover states provide clear visual feedback
   - [ ] Transitions are smooth (150-300ms)
   - [ ] Focus states visible for keyboard navigation

   Light/Dark Mode:
   - [ ] Text has sufficient contrast (4.5:1 minimum)
   - [ ] Glass/transparent elements visible
   - [ ] Borders visible in chosen mode

   Layout:
   - [ ] Floating elements have proper spacing from edges
   - [ ] No content hidden behind fixed navbars
   - [ ] Responsive at 375px, 768px, 1024px, 1440px
   - [ ] No horizontal scroll on mobile

   Accessibility:
   - [ ] All images have alt text
   - [ ] Form inputs have labels
   - [ ] Color is not the only indicator
   - [ ] prefers-reduced-motion respected

4. FIX any checklist failures before completing
```

### Step 6: Report Results

```
Output:
- Project: {project_name}
- Design System: {style} + {color_palette} + {font_pairing}
- Pages generated: {pages.length}
- Output directory: {output_dir}
- Files:
  - {output_dir}/01-landing.html
  - {output_dir}/02-login.html
  - ...
- Consistency: navbar ✓, footer ✓, routing ✓
- Checklist: {passed}/{total} checks passed
```

---

## UI UX Pro Max Search Reference

### Design System Search (Step 2)

```bash
python3 .claude/skills/design/analyze-design/scripts/search.py "<query>" --design-system [-p "Name"] [--persist]
```

### Domain Searches (Step 3)

| Need | Command |
|------|---------|
| Style options | `--domain style "glassmorphism dark"` |
| Color palettes | `--domain color "barbershop service"` |
| Typography | `--domain typography "professional modern"` |
| Landing structure | `--domain landing "hero social-proof"` |
| UX guidelines | `--domain ux "animation accessibility"` |
| Chart types | `--domain chart "dashboard analytics"` |

### Stack Guidelines (Step 3)

```bash
python3 .claude/skills/design/analyze-design/scripts/search.py "<query>" --stack html-tailwind
```

---

## HTML Template Structure

Every generated page must follow this structure:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="{page_description}">
  <title>{page_name} | {project_name}</title>

  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family={heading_font}:wght@400;500;600;700&family={body_font}:wght@300;400;500;600&display=swap" rel="stylesheet">

  <!-- Tailwind CSS -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: '{primary_hex}',
            secondary: '{secondary_hex}',
            accent: '{accent_hex}',
            // ... from design system
          },
          fontFamily: {
            heading: ['{heading_font}', 'sans-serif'],
            body: ['{body_font}', 'sans-serif'],
          }
        }
      }
    }
  </script>

  <!-- Icons (Lucide) -->
  <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>

  <style>
    /* Reduced motion support */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body class="font-body {bg_class} {text_class}">

  <!-- NAVIGATION (shared across all pages) -->
  <header class="fixed top-4 left-4 right-4 z-50">
    <nav class="...">
      <!-- Navbar content - IDENTICAL across all pages -->
    </nav>
  </header>

  <!-- MAIN CONTENT (unique per page) -->
  <main class="pt-24">
    <!-- Page-specific content -->
  </main>

  <!-- FOOTER (shared across all pages) -->
  <footer class="...">
    <!-- Footer content - IDENTICAL across all pages -->
  </footer>

  <!-- Initialize Lucide Icons -->
  <script>lucide.createIcons();</script>
</body>
</html>
```

---

## Error Handling

### Missing Design System Data
```
If UI UX Pro search returns no results:
  1. Use design_system from prompts frontmatter as fallback
  2. Apply sensible defaults from Common Rules section
  3. Log warning: "Using fallback design system"
```

### Page Generation Failure
```
If a page cannot be generated:
  1. Log the failed page filename and reason
  2. Continue with next page
  3. Report failures at end
  4. Retry failed pages individually
```

---

## Example Session

```
User: /prompts-to-html .claude-project/design/barbershop-prompts.md

Claude:
1. Parsing prompts file...
   - Project: EliteCuts
   - Style: dark glassmorphism
   - Pages: 8 found

2. Running UI UX Pro Max design system...
   $ python3 .claude/skills/design/analyze-design/scripts/search.py \
       "barbershop booking service professional dark" --design-system -p "EliteCuts"
   - Style: Glassmorphism Dark
   - Colors: zinc-950 bg, amber-500 accent, slate-300 text
   - Fonts: Outfit (heading) + Inter (body)
   - Effects: backdrop-blur, subtle gradients

3. Getting stack guidelines...
   $ python3 .claude/skills/design/analyze-design/scripts/search.py \
       "layout responsive form" --stack html-tailwind
   - 12 implementation rules loaded

4. Generating HTML pages:
   - [1/8] 01-landing.html... layout shell established
   - [2/8] 02-login.html... auth layout applied
   - [3/8] 03-register.html... form guidelines applied
   - [4/8] 04-services.html... card grid layout
   - [5/8] 05-booking.html... multi-step form
   - [6/8] 06-profile.html... settings layout
   - [7/8] 07-admin-dashboard.html... dashboard charts
   - [8/8] 08-admin-appointments.html... data table

5. Cross-page consistency check:
   - Navbar: identical across 8 pages ✓
   - Footer: identical across 8 pages ✓
   - Routing: all links wired ✓
   - Checklist: 16/16 passed ✓

Done! Generated 8 pages:
- .claude-project/generated-screens/EliteCuts/01-landing.html
- .claude-project/generated-screens/EliteCuts/02-login.html
...
```

---

## Related Skills

- `.claude/skills/design/prd-to-design-guide/SKILL.md` — Step 3a: PRD to design guide
- `.claude/skills/design/design-guide-to-prompts/SKILL.md` — Step 3b: Design guide to prompts
- `.claude/skills/design/analyze-design/SKILL.md` — Design intelligence database
- `.claude/skills/design/set-html-routing/SKILL.md` — Post-generation routing setup
- `.claude/skills/design/html-to-git/SKILL.md` — Deploy HTML to GitHub Pages
