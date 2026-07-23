---
name: gemini-html-generator
description: Generate HTML screens from Design Prompts using Gemini API (Phase 3c primary path)
---

# Gemini HTML Generator

> **Use when**: Gemini API is available. This is the primary HTML generation path (A1) in Phase 3c.
> **Alternative**: Use `prompts-to-html` when Gemini API is unavailable — it uses Claude + analyze-design instead.

Generate high-quality HTML screens from Design Prompts + DESIGN_SYSTEM.md using the Gemini API.
This is the **primary** HTML generation path (A1) in Phase 3c.

---

## Prerequisites

1. **GEMINI_API_KEY** environment variable configured
2. **Design Prompts file** at `.claude-project/design/{PROJECT}_DesignPrompts.md` (from Step 3b)
3. **DESIGN_SYSTEM.md** at `.claude-project/design/DESIGN_SYSTEM.md` (from Step 3a)

---

## Tool

**TypeScript implementation:** `fullstack/_shared/tools/generate_html_screens.ts`

```typescript
import { generateHtmlScreens } from '../_shared/tools/generate_html_screens.js';

const result = await generateHtmlScreens(
  '.claude-project/design/{PROJECT}_DesignPrompts.md',
  '.claude-project/design/DESIGN_SYSTEM.md',
  '.claude-project/generated-screens/{project}/'
);
```

---

## Workflow

### Step 1: Validate Inputs

```
1. Check GEMINI_API_KEY is set in environment
2. Verify Design Prompts file exists
3. Verify DESIGN_SYSTEM.md exists
4. If missing, report error and suggest prerequisites
```

### Step 2: Parse Design Prompts

```
1. Read Design Prompts markdown file
2. Extract YAML frontmatter:
   - project_name -> project identifier
   - total_pages -> expected page count
3. Extract "## Design System" section content
4. Find all "## Page: XX-slug" sections using regex
   For each match:
   - slug from header (e.g., "01-landing")
   - name: line -> display name
   - category: line -> page category (auth, dashboard, public, admin)
   - remaining content -> page prompt
5. Build pages array
```

### Step 3: Build Gemini Context

```
1. Read DESIGN_SYSTEM.md content
2. Build system prompt via buildFullstackSystemPrompt(designSystemMd)
   - Injects DESIGN_SYSTEM.md as the style specification
   - Includes Tailwind-only rules, semantic HTML, responsive design
   - Includes app-type layout patterns (dashboard, auth, public, admin)
3. Create Gemini context cache (system prompt + DESIGN_SYSTEM.md, 30min TTL)
   - Saves 50-70% token processing for pages 2+
```

### Step 4: Generate First Page (Phase A1)

```
1. Select first page from parsed specs
2. Build user prompt with:
   - Project name
   - Page spec (name, slug, category, full prompt)
   - All pages list (for navigation links)
3. Call Gemini API with full system prompt + user prompt
4. Extract HTML from response
5. Save to output directory: {slug}.html
6. Extract shared components using 3-pass strategy:
   - Pass 1: Semantic HTML tags (<header>, <footer>, <nav>, <aside>)
   - Pass 2: ARIA roles (role="banner", role="contentinfo")
   - Pass 3: Class/ID heuristics
7. Extract layout shell ({{MAIN_CONTENT}} placeholder pattern)
```

### Step 5: Generate Remaining Pages (Phase A2)

```
For each remaining page, IN PARALLEL:
1. Build user prompt with:
   - Project name
   - Page spec
   - All pages list
   - Shared components HTML (header, footer, nav from Step 4)
2. Call Gemini API with CACHED context
3. Extract HTML from response
4. Programmatically replace shared components with reference versions
   - Ensures header/footer/nav are IDENTICAL across all pages
   - Only active nav link changes per page
5. Save to output directory: {slug}.html
```

### Step 6: Validate Output

```
1. Verify all expected pages have HTML files
2. Report results:
   - Pages generated successfully
   - Pages that failed (if any)
   - Output directory path
3. Log failures for debugging
```

---

## Output

- HTML files in `.claude-project/generated-screens/{project}/`
- One `.html` file per page from Design Prompts
- Consistent shared components (header, footer, nav) across all pages
- Semantic HTML structure (<header>, <main>, <footer>) for downstream conversion

---

## Design-Flow Patterns Applied

| Pattern | How Applied |
|---------|-------------|
| Style DNA | DESIGN_SYSTEM.md injected as system prompt context |
| Layout Shell | First page establishes shell, remaining pages reuse it |
| Shared Components | 3-pass extraction + programmatic replacement (not LLM trust) |
| Context Caching | Gemini cached context for 50-70% token savings on pages 2+ |
| Semantic HTML | Required for component extraction and Phase 6 HTML-to-React |
| Page Routing | Every link = actual filename, no href="#" |

---

## Error Handling

| Error | Recovery |
|-------|----------|
| GEMINI_API_KEY missing | Report error, suggest configuring env var |
| First page fails | Abort — cannot establish shared components |
| Subsequent page fails | Continue with remaining pages, report partial success |
| Context cache fails | Fall back to uncached API calls (slower but functional) |

---

## Device Frame Wrapper (MANDATORY)

All generated HTML pages must render inside an appropriate device frame based on the target platform.

### Platform Detection

Determine frame type from PRD platform field or page user_type:

| Platform Keywords | Frame Type | Dimensions |
|-------------------|-----------|------------|
| mobile, ios, android, webview, react-native | Mobile Phone Frame | 375x812px |
| tablet, ipad | Tablet Frame | 768x1024px |
| desktop, web, dashboard, admin | Desktop (no frame) | max-width: 1440px centered |

Mixed projects (e.g., consumer=mobile + admin=desktop): detect per page based on user_type.

### Mobile Phone Frame HTML Template

```html
<!DOCTYPE html>
<html lang="...">
<head>
  <!-- CDN links -->
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; background: #111; /* #e5e5e5 for light themes */ }
    .phone-frame {
      width: 375px; height: 812px; margin: 24px auto;
      background: VAR_BG_COLOR; color: VAR_TEXT_COLOR;
      border-radius: 40px; border: 3px solid #2a2a3a;
      overflow: hidden; position: relative;
      box-shadow: 0 0 80px rgba(0,0,0,0.4), 0 20px 60px rgba(0,0,0,0.6);
    }
    .phone-screen { height: 100%; overflow-y: auto; padding-bottom: 80px; scrollbar-width: none; }
    .phone-screen::-webkit-scrollbar { display: none; }
    .bottom-bar { position: absolute; bottom: 0; left: 0; right: 0; z-index: 100; }
    .phone-frame::before { /* Notch */
      content: ''; position: absolute; top: 0; left: 50%; transform: translateX(-50%);
      width: 150px; height: 28px; background: VAR_BG_COLOR;
      border-radius: 0 0 18px 18px; z-index: 200;
    }
  </style>
</head>
<body>
  <div class="phone-frame">
    <div class="phone-screen">
      <!-- Status Bar -->
      <div style="height:48px;padding:14px 20px 0;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:14px;font-weight:600;">9:41</span>
        <div style="display:flex;gap:5px;align-items:center;">
          <iconify-icon icon="mdi:signal-cellular-3" width="14"></iconify-icon>
          <iconify-icon icon="mdi:wifi" width="14"></iconify-icon>
          <iconify-icon icon="mdi:battery" width="18"></iconify-icon>
        </div>
      </div>

      <!-- PAGE CONTENT HERE -->

      <div style="height:80px;"></div>
    </div>
    <div class="bottom-bar"><!-- Bottom navigation --></div>
  </div>
</body>
</html>
```

### Rules
- WARNING: `position:fixed` PROHIBITED inside phone frame -- use `position:absolute`
- WARNING: Notch `::before` background MUST match variation's main background color
- WARNING: Status bar text: light color for dark themes, dark color for light themes
- WARNING: Outer body background: `#111` for dark themes, `#e5e5e5` for light themes
- The `var-nav-bar` (in-page variation navigation) is the ONLY exception allowed to use `position:fixed`

### Desktop Frame
No device frame needed. Use: `body { max-width: 1440px; margin: 0 auto; }`

### In-Page Variation Navigation (MANDATORY)

Every generated HTML file must include a floating nav bar for switching between pages in the same variation:
- Position: fixed, top-right corner
- Semi-transparent dark background with backdrop-blur
- Links to all pages in the same variation (01, 02, 03, 04)
- Current page highlighted
- X button links to showcase-ALL.html

---

## Related

- **Step 3a**: `design:prd-to-design-guide` generates the Design Guide
- **Step 3b**: `design:design-guide-to-prompts` generates Design Prompts (input to this skill)
- **Step 3d**: Design QA validates the generated HTML
- **Phase 6**: HTML-to-React converter consumes the generated HTML
