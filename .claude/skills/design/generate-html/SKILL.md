---
name: generate-html
description: Generate HTML screens from Design Prompts — wraps both Gemini (primary) and Claude (fallback) paths
---

# Generate HTML

> **Router skill**: Delegates to `generate-html-gemini` (primary, A1) or `prompts-to-html` (fallback, A2) based on GEMINI_API_KEY availability.

This skill is referenced by the design blueprint for Steps 3e-3g (full HTML generation after variation selection).

---

## Prerequisites

1. **Design Prompts file** at `.claude-project/design/{PROJECT}_DesignPrompts.md` (from Step 3b)
2. **DESIGN_SYSTEM.md** at `.claude-project/design/DESIGN_SYSTEM.md` (from Step 3a)
3. **DESIGN_STATUS.md** with `approved: true` and `selected_variation` (from Step 3d)

---

## Path Selection

| Condition | Path | Skill |
|-----------|------|-------|
| `GEMINI_API_KEY` is set | Primary (A1) | `generate-html-gemini/SKILL.md` |
| `GEMINI_API_KEY` is not set | Fallback (A2) | `prompts-to-html/SKILL.md` |

---

## Workflow

1. Check `GEMINI_API_KEY` environment variable
2. Read `DESIGN_STATUS.md` to determine selected variation
3. Delegate to appropriate generation skill
4. Validate output meets all MANDATORY requirements (device frames, navigation, etc.)

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

## Related Skills

- `.claude/skills/design/generate-html-gemini/SKILL.md` -- Primary path (Gemini API)
- `.claude/skills/design/prompts-to-html/SKILL.md` -- Fallback path (Claude)
- `.claude/skills/design/prd-to-design-guide/SKILL.md` -- Step 3a: PRD to design guide
- `.claude/skills/design/design-guide-to-prompts/SKILL.md` -- Step 3b: Design guide to prompts
