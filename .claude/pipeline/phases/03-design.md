# Phase 3: Design (3-Variation Preview + Client Confirmation + Full HTML Generation)

Phase 3 creates the complete visual design as HTML pages before any build phases begin. It follows a multi-stage pipeline: Design Guide × 3 variations → Representative page preview → Client confirmation → Full HTML generation. The client confirmation at step 3d is a **mandatory PAUSE** — no downstream phases (database, backend, frontend, user-stories) proceed until the client selects a design variation.

## Prerequisites

- Phase 2 (prd) complete

## Execution

### Multi-Path Selection (AskUserQuestion)

```
Question: "How should the design be created?"
Options:
  A. "Full AI generation" -- PRD -> 3 variations -> client picks -> full HTML (via Gemini API)
  B. "External designer" -- PRD -> design guide -> send to designer -> import when ready
  C. "Existing HTML" -- I already have HTML prototypes, just validate them
```

### Path A: Full AI Generation (default)

Runs all sub-phases (3a → 3b → 3c → 3d ⏸ → 3e → 3f → 3g).

### Path B: External Designer

1. Run sub-phase 3a (generate 1 Design Guide — no variations needed)
2. Hand Design Guide to external designer
3. Set status to `Blocked: Awaiting external designs`, PAUSE
4. When user provides designs (Figma or HTML):
   - If Figma URL: run `/figma-extract-screens` to extract screen names, export HTML
   - If HTML files: proceed directly
5. Run sub-phase 3f (Design QA)
6. Mark `approved: true` in DESIGN_STATUS.md

### Path C: Existing HTML

1. Ask user for HTML file path(s)
2. Skip sub-phases 3a–3e
3. Extract design system from provided HTML (reverse Style DNA extraction)
4. Run sub-phase 3f (Design QA)
5. Mark `approved: true` in DESIGN_STATUS.md

---

### Step 3a: Design Guide + DESIGN_SYSTEM × 3 Variations

```
1. Read PRD to identify:
   ✅ If .claude-project/context/PRD_chunk_*.md exists → read in order (orchestrator may have already injected them)
   ⚠️ If no chunks exist: wc -l first → chunk-read with offset/limit if over 400 lines
   ❌ Single Read attempt prohibited (if PRD is large, only partial content is read → incomplete design guide)

   Extract:
   - Industry (SaaS, fintech, e-commerce, healthcare, etc.)
   - Platform type (web desktop-first, mobile-first, cross-platform)
   - Target audience and tone (professional, playful, minimal, bold)
   - Design references mentioned in PRD (e.g., "Notion style", "Figma Teams style")
   - Competitor/similar products mentioned

1.5. **Domain & Reference Research (MANDATORY)**

   Conduct actual research based on industry/domain and references extracted from the PRD.
   Through this step, automatically identify standard UI patterns and required sections for the domain.

   a. **Domain Competitor Research:**
      - Research top 3-5 products in the PRD industry via WebSearch
      - Example: "design feedback SaaS" → Figma, InVision, Marvel, Zeplin, Abstract
      - Identify landing page, dashboard, and core feature screen structure for each product

   b. **Derive Standard Patterns Per Page Type:**
      - Landing: list of sections commonly shared by top products in the domain
        (Example: SaaS → Hero, Social Proof, Features, How it Works, Pricing, Testimonials, CTA, Footer)
      - Dashboard: common UI elements (Example: Search, Notifications, KPIs, Activity Feed, Data Tables)
      - Detail/Editor: common UI elements (Example: Toolbar, Filters, Canvas/Content, Side Panel, Status Bar)

   c. **Deep Dive into PRD-Specified References:**
      - If PRD says "Notion style Org Switcher" → research Notion's actual Org Switcher UI pattern
      - If PRD says "Figma Teams style" → research Figma Teams' actual UI pattern
      - Reflect research results in the corresponding component briefs of the Design Guide

   d. **Research Output:**
      - Save to `.claude-project/design/{PROJECT}_DomainResearch.md`:
        - Competitor list + UI characteristics of each
        - Standard sections/elements discovered per page type
        - Actual UI pattern analysis per PRD reference
      - This file is injected as context during Design Guide and HTML generation

   ⚠️ These research results must be reflected in the per-page briefs of the Design Guide.
   ⚠️ Instead of hardcoding "a Footer is needed," discover from research that "all top products in this domain have a Footer" and include it naturally.

2. If user provides a template HTML (--template <path>):
   a. Extract Style DNA from template:
      - Color palette (backgrounds, text, accents, borders, gradients)
      - Typography (font families, sizes, weights, line heights)
      - Spacing (padding, margins, gap, max-widths, border-radius)
      - Component patterns (buttons, cards, inputs, navbars)
      - Visual effects (shadows, gradients, backdrop-blur, animations)
      - Dark/light mode
   b. Use extracted Style DNA as the design system foundation (applied to all 3 variations)

3. Auto-select 3 Design Archetypes from the Variation Archetype Library.

   ⚠️ CRITICAL: The 3 variations must have **mutually different Themes**.
   ⚠️ PRD design tokens (colors, fonts) are used only as **functional requirements**.
   ⚠️ Visual expression (backgrounds, shadows, borders, typography weight) is **determined by the archetype**.
   ⚠️ PRD primary color is **interpreted differently** in each archetype.
      (Example: same #6366F1 but → A: neon glow gradient, B: pastel tint + secondary color, C: sparse single accent)

   ### Variation Archetype Library (select 3 out of 6)

   | Archetype | Theme | Background | Accent Strategy | Shadows | Corners | Reference |
   |-----------|-------|------------|-----------------|---------|---------|-----------|
   | **Dark Vibrant** | Dark | #0B0F1A navy | Gradient (primary→purple→blue) + neon status | Glow (0 0 20px rgba) | rounded-xl (12-16px) | Linear, Vercel, Raycast |
   | **Warm Playful** | Warm Light | #FFFBF5 cream | Multi-color (coral, teal, amber, lavender) + primary | Warm soft (rgba 0.04) | rounded-2xl (16px), pill | Notion, Loom, Pitch |
   | **Editorial Minimal** | Pure White | #FFFFFF | Single accent only, 95% grayscale | None (0.5px hairline only) | rounded-md max (6px) | Apple, Stripe, Arc |
   | **Glass Futuristic** | Dark gradient | #0F0F23 → #1A1A3E | Iridescent (pink→cyan→purple) | Glass (backdrop-blur-24px) | rounded-3xl (24px) | Cosmos, Framer, Warp |
   | **Nature Organic** | Warm neutral | #F5F0EB warm stone | Earth tones (sage, terracotta, ochre) | Layered soft (multiple stacked) | rounded-lg (8-12px) | Aesop, Wildflower, Patagonia |
   | **Neo Brutalist** | High contrast | #FFFFFF or #000000 | Saturated blocks (yellow, blue, red) | Hard (4px offset solid black) | 0 (sharp corners) | Bloomberg, Gumroad, StackOverflow |

   ### Auto-selection Rules
   1. Analyze PRD industry/tone and select the 3 most suitable
   2. The 3 must have **mutually different Themes** (e.g., Dark + Warm Light + Pure White)
   3. Duplicate Theme families prohibited (Dark Vibrant + Glass Futuristic are both Dark, so not allowed)
   4. If PRD has a specific design reference, include the closest archetype as one of the 3

   ### DESIGN_SYSTEM Differentiation Verification Checklist (must differ on 5 or more out of 7 to pass)
   ```
   □ Are background colors different? (dark vs light vs white vs cream vs gradient)
   □ Are shadow styles different? (glow vs soft vs none vs hard vs glass)
   □ Are border treatments different? (rgba transparent vs warm vs hairline vs solid)
   □ Are corner radii different? (3xl vs 2xl vs xl vs md vs 0)
   □ Are typography weights different? (700 bold vs 600 semibold vs 300 light)
   □ Are status color expressions different? (neon glow vs pastel pill vs dot-only vs solid block)
   □ Are sidebars different? (pure dark vs warm dark vs light vs gradient)
   ```
   → If checklist does not pass, swap archetypes and regenerate

   ### Color Palette Generation (Domain-Based) — MANDATORY

   The Archetype Library defines **structural rules** (shadow style, corner radius, layout patterns, background theme).
   However, the **actual color palette** for each variation MUST be generated fresh based on domain research results,
   NOT copied from the library's example HEX values.

   Process:
   1. Extract competitor primary/secondary colors from DomainResearch.md
   2. Identify domain color tendencies (e.g., F&B → warm tones, Fintech → blue/green, Healthcare → green/white)
   3. For each selected archetype, generate a new color palette by applying domain colors through the archetype's rules:
      - Dark archetype → domain color as neon/glow accent on dark background
      - Warm archetype → domain color as warm-tinted primary on cream background
      - Minimal archetype → domain color as single sparse accent on white
      - Glass archetype → domain color as iridescent gradient on dark gradient background
      - Nature archetype → domain color as earth-tone variant on stone background
      - Brutalist archetype → domain color as saturated block on high-contrast background

   ❌ DO NOT copy fixed HEX values from the Archetype Library table above
   ✅ Use the library only for structural rules (shadow type, corner size, border treatment)
   ✅ Generate unique color palettes per project based on competitor analysis

4. Load skill: design:prd-to-design-guide
   Generate 1 shared Design Guide from PRD containing:
   - Design Philosophy (inspiration references, design pillars)
   - Page-by-Page Design Brief (layout and component descriptions)
   - Component Patterns (reusable component specifications)
   - Critical Design Rules

5. Generate 3 DESIGN_SYSTEM variants based on selected archetypes:
   - DESIGN_SYSTEM_A.md: Archetype A — complete visual system for this archetype
   - DESIGN_SYSTEM_B.md: Archetype B — complete visual system for this archetype
   - DESIGN_SYSTEM_C.md: Archetype C — complete visual system for this archetype

   Shared across all 3: page structure, component patterns, functional requirements (from PRD)
   Different per variation: **background color theme, shadow style, border treatment, corner radius, typography weight, status color expression, sidebar theme**

   ⚠️ PRD Token Reinterpretation Principles:
   - PRD primary color → used differently in each archetype (gradient vs solid + secondary color vs sparse accent)
   - PRD background → **replaced** by archetype background (PRD background is fallback only)
   - PRD font → retained, but heading weight/size is determined by archetype
   - PRD icons → retained (Lucide, etc.)
   - PRD layouts → structure retained, only visual style from archetype applied

6. Output:
   - .claude-project/design/{PROJECT}_DesignGuide.md (shared Design Guide)
   - .claude-project/design/DESIGN_SYSTEM_A.md
   - .claude-project/design/DESIGN_SYSTEM_B.md
   - .claude-project/design/DESIGN_SYSTEM_C.md
```

### Step 3b: Representative Page Design Prompts (4 pages × 3 styles)

```
1. Auto-select 4 representative pages from PRD:

   Selection criteria (4 pages that best reveal style differences):
   | Priority | Page Type | Platform | Why |
   |----------|-----------|----------|-----|
   | 1 | Landing/Home | auto-detect | Brand tone, hero treatment, first impression |
   | 2 | List/Category | auto-detect | Layout density, data presentation, grid/list patterns |
   | 3 | Detail/Form | auto-detect | Component styling, interaction patterns |
   | 4 | Admin Dashboard | always desktop | Admin UI, data tables, charts, stat cards |

   Platform auto-detection from PRD:
   - PRD platform contains "mobile", "ios", "android", "webview", "react-native" → mobile (375px phone frame)
   - PRD platform contains "desktop", "web app" → desktop (1440px full-width)
   - Mixed projects (e.g., consumer mobile + admin desktop) → per-page detection based on user_type

   If PRD lacks a page type, fallback candidates: Login, Profile, Product List, Settings

2. Load skill: design:design-guide-to-prompts
   Input: .claude-project/design/{PROJECT}_DesignGuide.md
   Mode: --representative-only (4 pages only, not full set)

3. Generate 12 design prompts (4 pages × 3 DESIGN_SYSTEM variants):
   For each of [A, B, C]:
     For each of [representative page 1, 2, 3, 4]:
       - Combine shared Design Guide page brief + DESIGN_SYSTEM_{A|B|C}.md
       - Generate structured prompt with:
         - Screen overview
         - Layout instructions (from Design Guide)
         - Style DNA (from variation's DESIGN_SYSTEM)
         - Key features and interactions

4. Output: .claude-project/design/{PROJECT}_VariationPrompts.md
   Format: YAML frontmatter + ## Variation A / ## Variation B / ## Variation C sections
```

### Step 3c: Representative HTML Generation (4 pages × 3 variations = 12 HTML files)

```
1. Load skill: .claude/skills/design/generate-html-gemini/SKILL.md
   Mode: --variation-preview

2. Generate 12 HTML files (4 representative pages × 3 styles):

   For each variation [A, B, C]:
     - Prepend DESIGN_SYSTEM_{variation}.md as Style DNA context
     - Generate page 1 (landing) FULLY with layout shell
     - Generate pages 2-4 using same shell + main content only

3. Apply standard design-flow patterns to each set:
   - Semantic HTML required (<header>, <nav>, <main>, <footer>)
   - Page routing: links use actual filenames (href="A-02-dashboard.html")
   - Shared component consistency within each variation set

4. Output directory: .claude-project/design/variations/
   File naming:
   - A-01-{page1}.html, A-02-{page2}.html, A-03-{page3}.html, A-04-admin-dashboard.html
   - B-01-{page1}.html, B-02-{page2}.html, B-03-{page3}.html, B-04-admin-dashboard.html
   - C-01-{page1}.html, C-02-{page2}.html, C-03-{page3}.html, C-04-admin-dashboard.html
```

### Device Frame Wrapper — MANDATORY

All generated HTML pages MUST render inside an appropriate device frame when opened in a desktop browser.
The platform is determined from the PRD's platform field.

#### Mobile Phone Frame (for mobile/webview/react-native pages):
```css
html, body { height: 100%; background: #111; /* or #e5e5e5 for light themes */ }
.phone-frame {
  width: 375px; height: 812px; margin: 24px auto;
  border-radius: 40px; border: 3px solid #2a2a3a;
  overflow: hidden; position: relative;
  box-shadow: 0 0 80px rgba(0,0,0,0.4), 0 20px 60px rgba(0,0,0,0.6);
}
.phone-frame::before { /* Notch */
  content: ''; position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 150px; height: 28px; background: /* variation bg color */;
  border-radius: 0 0 18px 18px; z-index: 200;
}
.phone-screen { height: 100%; overflow-y: auto; padding-bottom: 80px; scrollbar-width: none; }
.bottom-bar { position: absolute; bottom: 0; left: 0; right: 0; z-index: 100; }
```
- Status bar: 9:41 time, signal/wifi/battery icons (Iconify)
- Notch background color MUST match variation's main background
- Status bar text: light for dark themes, dark for light themes
- ⚠️ position:fixed PROHIBITED inside phone frame — use position:absolute
- ⚠️ Outer body background: #111 for dark themes, #e5e5e5 for light themes

#### Desktop Frame (for web app/dashboard pages):
```css
body { max-width: 1440px; margin: 0 auto; }
```
No device frame — full-width centered layout.

#### Tablet Frame (for tablet pages, if applicable):
```css
.tablet-frame { width: 768px; height: 1024px; margin: 24px auto; border-radius: 24px; /* similar to phone */ }
```

### Content Image Matching — MANDATORY

Images used in representative HTML MUST match the project domain and specific products/content.

#### Rules:
- ❌ Random stock photos that don't match the product
- ❌ Emoji gradient placeholder divs
- ✅ Domain-appropriate images from Unsplash (verified 200 OK via curl before use)
- ✅ Product-specific: if the product is "Gochujang 500g", use a red pepper paste photo, not random food
- ✅ Before HTML generation, run WebSearch for "{domain} {product type} unsplash" to find appropriate photo IDs
- ✅ Verify each URL returns 200 OK: `curl -s -o /dev/null -w "%{http_code}" "URL" --max-time 5`
- ✅ Add onerror fallback: `<img onerror="this.style.opacity='0.5'">`

### In-Page Variation Navigation — MANDATORY

Every generated HTML file (mobile AND desktop) MUST include a floating navigation bar
enabling users to switch between pages within the same variation.

```html
<div class="var-nav-bar" style="position:fixed;top:12px;right:12px;z-index:9999;
  display:flex;gap:4px;background:rgba(0,0,0,0.85);backdrop-filter:blur(12px);
  padding:6px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);
  font-family:Inter,-apple-system,sans-serif;">
  <span style="...">{VARIATION_LETTER}</span>
  <a href="{VAR}-01-{page1}.html" style="...">Page 1</a>
  <a href="{VAR}-02-{page2}.html" style="...">Page 2</a>
  <a href="{VAR}-03-{page3}.html" style="...">Page 3</a>
  <a href="{VAR}-04-admin-dashboard.html" style="...">Admin</a>
  <a href="showcase-ALL.html" style="...">✕</a>
</div>
```
- Current page highlighted (white text + subtle background)
- ✕ button returns to showcase-ALL.html
- This nav bar is the ONLY element allowed to use position:fixed

### Step 3c.5: Generate Showcase Pages (Automatic, Deterministic) — MANDATORY

After representative HTML files are generated, automatically create a showcase page for client comparison.
This step is deterministic (template-based, no LLM needed) and runs automatically after 3c.

#### Output: `showcase-ALL.html` (single file)

#### Showcase Structure:

**Header:**
- Project name + "Design Showcase" title
- Subtitle: "Select one design system from N variations"
- Instruction badge: "Compare all pages of each variation, then choose one unified style"

**Variation Sections (repeated for each variation):**

Each variation is rendered as a distinct card/section with strong visual differentiation:

1. **Section Header:**
   - Variation letter badge (gradient background using variation's color + color2)
   - Variation name (displayed in variation's primary color)
   - Description text
   - Mood tags (bordered + tinted with variation's color)
   - Section border/glow uses variation's unique color (CSS custom properties)
   - Subtle blur glow effect on right side of header using variation color

2. **Page Preview Grid:**
   - User pages (mobile or desktop depending on platform): horizontal row
     - Mobile: iframe scale(0.42), height ~380px, phone frame visible in preview
     - Desktop: iframe at appropriate scale, full-width
   - Admin Dashboard page: ALWAYS full-width row (grid-column: 1 / -1)
     - iframe scale ~0.92, height ~480px, desktop layout
   - Each cell has "Open in new tab →" link below

3. **Visual Differentiation Requirements (MANDATORY):**
   - Each section MUST use CSS custom properties for its unique colors:
     --accent-gradient, --header-bg, --accent-shadow, --tag-border, --tag-color, --tag-bg
   - Gradient border around each section (opacity increases on hover)
   - Variation letter badge has box-shadow matching variation color
   - Header has subtle background glow in variation's color

**Technical Requirements:**
- All iframes use loading="lazy"
- Responsive: 2-column below 1200px, 1-column below 700px
- ❌ DO NOT expose generation method (Claude/Gemini/etc.) — client-facing page
- Variation data (names, colors, descriptions, tags) read from DESIGN_STATUS.md

**DESIGN_STATUS.md Variation Data Format:**
```yaml
variations:
  - id: A
    name: "Variation Name"
    desc: "One-line description of the visual approach"
    color: "#PRIMARY_HEX"
    color2: "#SECONDARY_HEX"
    bg: "#BACKGROUND_HEX"
    headerBg: "#DARK_HEADER_BG"
    tags: ["tag1", "tag2", "tag3", "tag4"]
  - id: B
    ...
```

### Step 3d: Client Confirmation ⏸ PAUSE (MANDATORY)

```
1. Share all 12 HTML files with the client via chatbot file attachment:

   Send 3 sets of files (4 pages each):
   Style A ({variation_a_name}):
   - A-01-{page1}.html
   - A-02-{page2}.html
   - A-03-{page3}.html
   - A-04-admin-dashboard.html

   Style B ({variation_b_name}):
   - B-01-{page1}.html
   - B-02-{page2}.html
   - B-03-{page3}.html
   - B-04-admin-dashboard.html

   Style C ({variation_c_name}):
   - C-01-{page1}.html
   - C-02-{page2}.html
   - C-03-{page3}.html
   - C-04-admin-dashboard.html

2. Send explanation message:
   "We've prepared 3 design styles × 4 pages:

    Style A [{variation_a_name}] — {variation_a_description}
    Style B [{variation_b_name}] — {variation_b_description}
    Style C [{variation_c_name}] — {variation_c_description}

    Compare all 4 pages (landing, list, detail, admin dashboard) for each style.
    Which style would you like to proceed with?"

3. AskUserQuestion:
   Options:
     A. "Style A ({variation_a_name})"
     B. "Style B ({variation_b_name})"
     C. "Style C ({variation_c_name})"
     D. "Mix — e.g., A's colors + C's layout" (free-text follow-up)

4. ⏸ PAUSE — must wait for user response using AskUserQuestion tool
   ❌ Strictly prohibited: proceeding without AskUserQuestion
   ❌ Strictly prohibited: moving to Step 3e before user response
   ❌ Strictly prohibited: bypassing this step with --skip-review flag

5. On response:
   - If A/B/C selected: use that variation's DESIGN_SYSTEM as the confirmed style
   - If "Mix" selected: ask follow-up, merge requested elements into new DESIGN_SYSTEM_FINAL.md
   - Copy selected DESIGN_SYSTEM_{X}.md → DESIGN_SYSTEM.md (canonical)
   - Update DESIGN_STATUS.md:
     selected_variation: {A|B|C|Mix}
     approved: true
     approved_at: {DATE}
```

### Step 3e: Full Page HTML Generation (selected style)

```
1. Load skill: .claude/skills/design/generate-html-gemini/SKILL.md
   Mode: full generation (standard)

2. Load confirmed DESIGN_SYSTEM.md (from step 3d)

2a. ⚠️ MANDATORY CSS PATTERN EXTRACTION — A-09 prevention
   Read the approved variation HTML files (e.g. C-01-landing.html) and extract the EXACT <style> block.
   This extracted CSS is the source-of-truth for visual patterns:
   - ::before / ::after rules (gradient lines, overlays)
   - Exact px values (34px text, 1px gradient borders, etc.)
   - Pseudo-element patterns used for visual effects
   - Color values as-used (not just tokens from DESIGN_SYSTEM.md)

   ❌ DO NOT: Reinterpret these patterns with Tailwind utilities
   ✅ DO: Copy-paste CSS patterns directly from variation HTML into full page generation
   DESIGN_SYSTEM.md = color tokens only. Variation HTML <style> = implementation patterns.

   📌 NOTE: This CSS extraction is for Phase 3 HTML prototype generation.
   When converting to React in Phase 6 (frontend), this HTML's CSS is converted to Tailwind classes — not direct copy-paste.

3. Load skill: design:design-guide-to-prompts
   Input: .claude-project/design/{PROJECT}_DesignGuide.md
   Mode: full (all pages, not just representative)
   Generate complete prompts for ALL PRD pages using confirmed DESIGN_SYSTEM.md

4. Output: .claude-project/design/{PROJECT}_DesignPrompts.md (full set)

5. Generate all HTML pages using standard design-flow patterns:

   a. Style DNA prefix: Prepend DESIGN_SYSTEM.md to every generation

   b. Atomic Design enforcement:
      - Generate atoms first (buttons, inputs, badges)
      - Then molecules (form groups, card layouts)
      - Then organisms (navbar, footer, sidebar)
      - Then full pages
      - File naming with tier suffixes: navbar.organism.html, dashboard.page.html

   c. Layout Shell Pattern:
      - Generate page 1 (landing/home) FULLY
      - Extract layout shell: header/nav + footer + sidebar -> {{MAIN_CONTENT}} placeholder
      - For subsequent pages: generate only <main> content, assemble with shell
      - Saves 50-70% tokens

   d. Shared Component Consistency:
      - Extract navbar/footer from page 1 using 3-pass strategy:
        Pass 1: Semantic HTML tags (<header>, <footer>, <nav>, <aside>)
        Pass 2: ARIA roles (role="banner", role="contentinfo")
        Pass 3: Class/ID heuristics (class="footer", id="sidebar")
      - Programmatically replace in ALL subsequent pages (don't trust LLM consistency)
      - Only dynamic part: active navigation link per page

   e. Page Routing enforcement:
      - Every link uses actual filename: href="dashboard.page.html"
      - No href="#" or javascript:void(0)
      - Cross-check: every href target must correspond to a generated file

   f. Semantic HTML required:
      - Use <header>, <nav>, <main>, <aside>, <footer> (not <div class="header">)
      - Enables automatic shared component extraction

6. Generation sub-paths:
   A1. Gemini HTML generation (PRIMARY): Use Gemini API with Design Prompts + DESIGN_SYSTEM.md
       Requires: GEMINI_API_KEY configured
       Skill: .claude/skills/design/generate-html-gemini/SKILL.md
       Tool: fullstack/_shared/tools/generate_html_screens.ts
       Flow: Parse prompts → Context cache → Generate first page → Extract shared components
             → Generate remaining pages in parallel → Replace shared components
   A2. AI design tool generation: Run /prompts-to-html via Playwright MCP
       Supports: Aura, v0, Bolt, Lovable. Falls back to A1 (Gemini) if tool unavailable

7. Output: .claude-project/generated-screens/{project}/ or .claude-project/design/html/
```

### Step 3f: Design QA

```
1. Load skill: .claude/skills/design-qa-validator.md

2. Routing validation:
   - If live URL available (GitHub Pages): use Playwright MCP to click every link
   - If no live URL: static analysis of all href attributes
   - Score: working_links / total_links

3. Shared component consistency:
   - Extract navbar HTML from every page
   - Diff each against the canonical version (from page 1)
   - Same for footer and sidebar
   - Score: 100% = all identical, any drift = flag

4. Design system compliance:
   - Spot-check colors in HTML match DESIGN_SYSTEM.md
   - Verify font families match
   - Verify spacing patterns are consistent
   - Score: matching_values / sampled_values

5. Page completeness — based on routes.yaml (self-pass prohibited):
   - Read .claude-project/routes.yaml → extract ALL `- path:` entries → ROUTE_COUNT
   - Count HTML files in output directory → HTML_COUNT
   - Score: HTML_COUNT / ROUTE_COUNT
   - IF HTML_COUNT < ROUTE_COUNT:
     - List missing routes (routes.yaml paths not covered by any HTML file)
     - QA FAIL → return to Step 3e and generate missing pages
     - DO NOT mark design_qa_passed: true until all routes have HTML
   ⚠️ Prohibited: comparing design prompts list vs HTML (self-pass via self-generated list)
   ✅ Required: compare routes.yaml route count vs HTML file count

6. Output: DESIGN_QA_STATUS.md (per-page tracking)
```

### Step 3g: Final Confirmation (optional)

```
When running via chat bot pipeline:
1. Upload all generated HTML files to client as file attachments
2. Send: "All {N} page HTMLs are complete. Please review."
3. Options:
   A. "Looks good, proceed with development!" → Continue to Phase 3.5 (user-stories) + Phase 6 (frontend)
   B. "I have revisions" → Note feedback, re-run 3e with adjustments

When running via /fullstack command (developer mode):
- This step is optional — developer can review HTML directly
- Use --skip-review to skip entirely
```

### Design Phase Status File

Path: `.claude-project/status/{project}/DESIGN_STATUS.md`

```yaml
project: {PROJECT_NAME}
design_path: A  # A=AI gen, B=external, C=existing HTML
template_html: null  # Path to Style DNA template if provided

# Variation tracking
variations_generated: 3
representative_pages: [landing, list, detail, admin-dashboard]
variation_a:
  name: "Bold Classic"
  differentiator: { visual: Bold, layout: Classic, hero: Product, animation: Subtle-Micro }
  design_system: "DESIGN_SYSTEM_A.md"
variation_b:
  name: "Soft Spacious"
  differentiator: { visual: Soft, layout: Spacious, hero: Typography-First, animation: None }
  design_system: "DESIGN_SYSTEM_B.md"
variation_c:
  name: "Minimal Bento"
  differentiator: { visual: Minimal, layout: Bento, hero: Split, animation: Subtle-Micro }
  design_system: "DESIGN_SYSTEM_C.md"

# Confirmation
selected_variation: null    # A, B, C, or "Mix:A-color+C-layout"
approved: false
approved_at: null

# Post-confirmation
full_html_generated: false
design_qa_passed: false
```

## Quality Gate

```yaml
gate: design_approved AND all_html_generated AND routing_score >= 95% AND shared_consistency == 100%
checks:
  - design_approved: "Client selected a variation and approved: true in DESIGN_STATUS.md?"
  - design_system_exists: "DESIGN_SYSTEM.md (confirmed) has colors, typography, spacing, components?"
  - prompts_match_prd: "Every PRD page has a design prompt?"
  - html_generated: "Every design prompt has corresponding HTML file?"
  - routing_valid: "Inter-page navigation works (no broken links)?"
  - shared_consistency: "Navbar/footer identical across all pages?"
  - design_compliance: "HTML follows design system specs?"
method: "Check DESIGN_STATUS.md approved flag, count HTML files vs PRD pages, static link analysis, diff shared components, spot-check CSS"
scoring:
  design_approved: 10%
  page_coverage: 25%
  routing_validity: 25%
  shared_consistency: 20%
  design_compliance: 20%
```

## Design-Flow Patterns Adopted

| Pattern | What It Does | Applied Where |
|---------|-------------|---------------|
| 3-variation preview | Generate 3 style variations for client choice before full build | Sub-phases 3a–3d |
| Mandatory client confirmation | PAUSE pipeline until client selects variation | Sub-phase 3d |
| Three-stage pipeline | Design Guide → Prompts → Generation | Sub-phases 3a → 3b/3e → 3c/3e |
| Design Guide checkpoint | Human-readable design plan for review before generation | Sub-phase 3a (shared by Path A and B) |
| Style DNA extraction | Extract colors, typography, spacing from template or Design Guide | Sub-phase 3a/3e |
| Atomic Design | atom → molecule → organism → page hierarchy | Sub-phase 3e |
| Shared component consistency | Programmatic extraction + replacement (not LLM trust) | Sub-phase 3e + 3f |
| Layout Shell Pattern | Generate page 1 fully, extract shell, stream main only | Sub-phase 3e |
| Page routing enforcement | Every link = actual filename, no href="#" | Sub-phase 3e + 3f |
| Design Differentiator | Visual personality + layout + creative constraint (3 combos) | Sub-phase 3a |
| Context caching | Cache system prompt + Style DNA for 50-70% token savings | Sub-phase 3c/3e |
| Chatbot file attachment | Share HTML via chat file upload (not GitHub Pages) | Sub-phase 3d/3g |

## Loop Integration

- **Command**: `fullstack {project} --phase design --loop`
- **When**: If pages are missing or QA fails
- **Skill**: `.claude/skills/design-orchestrator.md`
- **Sub-skills**: design-guide, design-prompts, html-gen, design-qa
- **Status file**: `DESIGN_STATUS.md`
- **Completion promise**: `DESIGN_GEN_COMPLETE`
- **Note**: Loop only re-runs 3e–3f (full HTML + QA). Steps 3a–3d (variations + confirmation) run once.

### Design QA HTML Checks

```yaml
design-qa-html:
  stack: base
  trigger: "Phase 3f (design QA) -- validates HTML design itself"
  skill: .claude/skills/design-qa-validator.md
  checks:
    - page_coverage: "Every design prompt has HTML?"
    - routing_score: "Navigation links work >= 95%?"
    - component_consistency: "Shared components identical across pages?"
    - design_system_compliance: "Visual specs match DESIGN_SYSTEM.md?"
  per_item: each HTML page file
  completion_promise: "DESIGN_QA_HTML_COMPLETE"
  notes: |
    This validates the HTML design itself (Phase 3).
    design-qa (existing) validates React vs HTML fidelity (Phase 6/9).
```

---

## Phase Completion — Status Update

**Status updates are handled AUTOMATICALLY by the gate script (`_gate-runner.sh`).**

When the blueprint's `gate` deterministic node runs `bash gates/design-gate.sh`, the gate-runner:
- Updates Progress Table (Status, Score, Output, Gate Run At)
- Updates Gate Results section with check details
- Writes gate proof file to `.gate-proofs/design.proof`
- Appends to Execution Log
- Updates `last_run` and `pipeline_score` in Config

The blueprint's `verify-gate-proof` node confirms the gate ran. **No manual status updates needed.**
