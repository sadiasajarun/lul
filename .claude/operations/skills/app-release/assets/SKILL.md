---
name: store-assets
description: Guide and auto-resizing for app assets (icons, screenshots, splash, Feature Graphic) needed for store submission
user-invocable: true
argument-hint: "[icon|screenshot|splash|all]"
---

# Store Assets - App Asset Preparation

## Purpose

Prepares all visual assets required for Google Play and App Store submission.
Based on source images, generates assets conforming to each store's specifications and checks for missing items.
Generates scripts for **Playwright-based screenshot capture (one-time)** + **browser-based asset designer (frame/caption/background real-time editing + save)** + **Sharp-based icon auto-resizing**.

## Usage

```
/store-assets              # Full asset status check and guide
/store-assets icon         # App icon generation/resizing (includes Sharp script)
/store-assets screenshot   # Automated screenshot capture + device frame compositing
/store-assets splash       # Splash screen generation
/store-assets all          # Process all assets at once
```

## Pre-flight

Before generating any output, execute the **Pre-flight: Gitignore Output Directory** from [Store Shared Reference](../_store-shared/reference.md). This ensures `.claude-project/` is in `.gitignore` before any files are created.

## Prerequisites

- `/store-prep` must be completed and `.claude-project/store-prep/app-info.md` must exist
- If it does not exist, gather basic information by asking questions

---

## Phase 1: Asset Status Check

### Execution Algorithm

1. Search for existing asset files in the project:
   ```
   Glob: **/icon*.{png,jpg,svg}
   Glob: **/logo*.{png,jpg,svg}
   Glob: **/splash*.{png,jpg,svg}
   Glob: **/screenshot*.{png,jpg}
   Glob: **/feature*.{png,jpg}
   Glob: .claude-project/store-prep/assets/**
   Glob: frontend/public/**/*.{png,jpg,svg,ico}
   ```

2. Determine usability of discovered assets (size, format)

3. Output status report:
   ```markdown
   # Asset Status

   | Asset | Status | Found File | Notes |
   |------|------|----------|------|
   | App Icon (Original) | ✅/❌ | logo.png | Size: 193KB |
   | Android Icon (512x512) | ❌ | - | Needs generation |
   | iOS Icon (1024x1024) | ❌ | - | Needs generation |
   | Screenshots | ❌ | - | Needs capture |
   | Feature Graphic | ❌ | - | Needs creation |
   | Splash Screen | ❌ | - | Needs generation |
   ```

---

## Phase 2: App Icon (`/store-assets icon`)

### Required Size List

**Android (Google Play)**
| Purpose | Size | Filename |
|------|------|--------|
| Play Store Listing | 512 x 512 px | icon-playstore.png |
| Adaptive Icon (Foreground) | 432 x 432 px | ic_launcher_foreground.png |
| Legacy Icon | 48, 72, 96, 144, 192 px | Per mipmap-* folder |

**iOS (App Store)**
| Purpose | Size | Filename |
|------|------|--------|
| App Store Listing | 1024 x 1024 px | icon-appstore.png |
| iPhone | 60x60 @2x, @3x | AppIcon set |
| iPad | 76x76 @1x, @2x | AppIcon set |
| Spotlight | 40x40 @2x, @3x | AppIcon set |
| Settings | 29x29 @2x, @3x | AppIcon set |

### Auto-Resizing Script (Sharp)

If a source icon exists, a Sharp-based resizing script is **automatically generated and executed**:

```javascript
// .claude-project/store-prep/assets/icons/resize-icons.js
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE = path.resolve(__dirname, 'icon-original.png');

const SIZES = {
  'icon-playstore.png': { width: 512, height: 512 },
  'icon-appstore.png': { width: 1024, height: 1024 },
  'android/mipmap-mdpi/ic_launcher.png': { width: 48, height: 48 },
  'android/mipmap-hdpi/ic_launcher.png': { width: 72, height: 72 },
  'android/mipmap-xhdpi/ic_launcher.png': { width: 96, height: 96 },
  'android/mipmap-xxhdpi/ic_launcher.png': { width: 144, height: 144 },
  'android/mipmap-xxxhdpi/ic_launcher.png': { width: 192, height: 192 },
  'android/mipmap-mdpi/ic_launcher_foreground.png': { width: 108, height: 108 },
  'android/mipmap-hdpi/ic_launcher_foreground.png': { width: 162, height: 162 },
  'android/mipmap-xhdpi/ic_launcher_foreground.png': { width: 216, height: 216 },
  'android/mipmap-xxhdpi/ic_launcher_foreground.png': { width: 324, height: 324 },
  'android/mipmap-xxxhdpi/ic_launcher_foreground.png': { width: 432, height: 432 },
  'ios/AppIcon-20@2x.png': { width: 40, height: 40 },
  'ios/AppIcon-20@3x.png': { width: 60, height: 60 },
  'ios/AppIcon-29@2x.png': { width: 58, height: 58 },
  'ios/AppIcon-29@3x.png': { width: 87, height: 87 },
  'ios/AppIcon-40@2x.png': { width: 80, height: 80 },
  'ios/AppIcon-40@3x.png': { width: 120, height: 120 },
  'ios/AppIcon-60@2x.png': { width: 120, height: 120 },
  'ios/AppIcon-60@3x.png': { width: 180, height: 180 },
  'ios/AppIcon-76.png': { width: 76, height: 76 },
  'ios/AppIcon-76@2x.png': { width: 152, height: 152 },
  'ios/AppIcon-83.5@2x.png': { width: 167, height: 167 },
  'ios/AppIcon-1024.png': { width: 1024, height: 1024 },
};

async function resize() {
  if (!fs.existsSync(SOURCE)) {
    console.error('Original icon not found:', SOURCE);
    process.exit(1);
  }
  for (const [filename, size] of Object.entries(SIZES)) {
    const outPath = path.resolve(__dirname, filename);
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await sharp(SOURCE).resize(size.width, size.height, { fit: 'cover' }).png().toFile(outPath);
    console.log(`✅ ${filename} (${size.width}x${size.height})`);
  }
  console.log('\nAll icons generated!');
}
resize().catch(console.error);
```

### Execution Algorithm

1. Search for original icon file:
   ```
   Glob: **/icon*.{png,svg} — images 1024px or larger
   Glob: **/logo*.{png,svg}
   ```
2. If original exists:
   - Create `.claude-project/store-prep/assets/icons/` directory
   - Copy original as `icon-original.png`
   - Check Sharp installation (`npm list sharp` or `npm install sharp`)
   - Generate `resize-icons.js`
   - Execute script: `node .claude-project/store-prep/assets/icons/resize-icons.js`
3. If no original:
   - Provide icon design guidelines
   - Generate external design commission spec document
   - Register as client blocker

### Icon Checklist
- [ ] Minimum 1024x1024px PNG
- [ ] No transparent background (App Store requirement)
- [ ] Minimize text (not visible at small sizes)
- [ ] No rounded corners applied (OS applies automatically)
- [ ] Design intuitively conveys the app's purpose

---

## Phase 3: Screenshots (`/store-assets screenshot`)

### Screenshot Design Level Assessment

Before starting screenshot generation, assess the required design level. First-time submitters often overestimate the design effort needed.

**Decision Flow (ask PM via AskUserQuestion):**

```
Q: How important is screenshot design for this app?

Context: Most successful apps use simple screenshots.
Examples of top apps with minimal screenshot design:
- ChatGPT (500M+ downloads): Plain app screens with short captions
- 간단 (popular Korean self-management app): Very simple, minimal design

Unless this is a social/communication app where visual identity drives downloads,
simple device-frame screenshots with captions are sufficient.

Options:
a) Simple (recommended for most apps) — Device frame + caption + gradient background
   → Proceed with the standard designer pipeline below
b) Design matters — I want polished, branded screenshots
c) Not sure
```

**If PM selects (b) or insists design matters:**

1. Share this reference: "ChatGPT has 500M+ downloads with very simple store screenshots. The app experience itself matters far more than screenshot polish."
2. If PM still wants enhanced design (e.g., social app, content platform):
   - Analyze the app's key pages and generate a **designer brief**:
     ```markdown
     ## Screenshot Designer Brief

     ### App: [App Name]
     ### Key Screens (ordered by importance)
     | # | Screen | What to Highlight | Suggested Caption |
     |---|--------|-------------------|-------------------|
     | 1 | ... | ... | ... |

     ### Design Direction
     - Brand colors: [extracted from app CSS/theme]
     - Tone: [professional/playful/minimal based on app category]
     - Reference style: [suggest closest match from known apps]

     ### Deliverables
     - [N] screenshots at 1242×2688 (App Store 6.5")
     - [N] screenshots at 1080×1920 (Google Play)
     - [N] screenshots at 2048×2732 (iPad 13", if applicable)
     ```
   - Save brief to `.claude-project/store-prep/assets/screenshots/designer-brief.md`
   - Tell PM to forward this brief to their designer
   - Register as **client blocker** — screenshot pipeline resumes when designer delivers assets

**If PM selects (a) or (c):**
Proceed with the standard automated pipeline below (device frame + caption + gradient background). This level matches what most top-tier apps use.

### Required Sizes

**Google Play**
| Device | Minimum Size | Recommended | Minimum Count |
|------|----------|------|----------|
| Phone | Between 320~3840px | 1080 x 1920 | 2 |
| 7-inch Tablet | - | 1200 x 1920 | Optional |
| 10-inch Tablet | - | 1600 x 2560 | Optional |

**App Store**
| Device | Size | Minimum Count |
|------|------|----------|
| 6.5-inch (iPhone 11 Pro Max) | 1242 x 2688 | 3 |
| 13-inch iPad | 2064 x 2752 / 2048 x 2732 | If iPad supported (max 10) |

### Screenshot Generation Pipeline

Screenshot generation follows a **"Capture once → Browser designer → Save"** workflow:

1. **capture-screenshots.ts** — One-time raw screenshot capture with Playwright
2. **build-designer.ts** — Convert captured images to base64 and embed in HTML designer
3. **designer.html** — Edit frame/caption/background in real-time in browser and export via save button

**Core principle:** Screenshots are captured only once; frame/background/caption can be modified infinitely in the HTML designer. Design changes possible without re-capture.

#### Pre-Check Items (Must confirm via AskUserQuestion)

**Required questions:**
1. Login credentials to use for screenshots (username / password) — Recommend demo accounts from CLAUDE.md, but **always confirm with the user which account has real data**
2. Confirm screen composition for capture (analyze routes, propose, and get approval)

**Device frames are not asked in advance** — Can be switched in real-time in the designer HTML.

#### Execution Algorithm

1. **Project analysis**:
   ```
   Grep: Route|path in frontend/app/routes* → Extract main routes
   Read: .claude-project/store-prep/app-info.md → Check key features
   Grep: login|auth in frontend/ → Identify auth method
   Read: CLAUDE.md → Check demo account info
   ```

2. **Determine screens to capture** (confirm via AskUserQuestion):
   ```markdown
   ## Recommended Screenshot Composition (5~8 screens)

   | Order | Screen | Highlight | Route |
   |------|------|-----------|--------|
   | 1 | Main Home | Core features at a glance | / |
   | 2 | Key Feature A | ... | /feature-a |
   | 3 | Key Feature B | ... | /feature-b |
   | ... | ... | ... | ... |
   ```

3. **Generate capture script** (`capture-screenshots.ts`):

   **Important:** Capture is done with **one representative viewport only**. The designer renders for other store sizes.

   Must include the following core patterns:

   ```typescript
   import { chromium, type Page, type BrowserContext } from '@playwright/test';
   // ⚠️ Must import from '@playwright/test' (not 'playwright')

   // ===== Representative viewport (capture once at largest resolution) =====
   const VIEWPORT = { width: 430, height: 932, scaleFactor: 3 }; // → 1290x2796

   // ===== Required: API-based login (more stable than form input) =====
   async function login(context: BrowserContext, page: Page) {
     const apiRes = await context.request.post('http://localhost:3000/api/auth/login', {
       data: { username: CREDENTIALS.username, password: CREDENTIALS.password, rememberMe: true },
     });
     if (!apiRes.ok()) throw new Error('Login failed');
     await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
     await page.waitForTimeout(3000);
     if (page.url().includes('login')) { /* ... manual login fallback ... */ }
   }

   // ===== Required: Remove dev tool UI / floating widgets =====
   // Remove TanStack Query Devtools (.tsqd-*), Playwright badges, ChannelTalk, etc.
   async function removeFloatingElements(page: Page) {
     await page.evaluate(() => {
       // 1) Directly remove known dev tool selectors
       document.querySelectorAll('[class*="tsqd"], [class*="ReactQueryDevtools"]').forEach(el => {
         (el as HTMLElement).style.display = 'none';
       });
       // 2) Bulk remove bottom-right floating elements
       document.querySelectorAll('*').forEach(el => {
         const style = window.getComputedStyle(el);
         if (style.position === 'fixed' || style.position === 'absolute') {
           const rect = el.getBoundingClientRect();
           if (rect.right > window.innerWidth * 0.75 && rect.bottom > window.innerHeight * 0.85) {
             if (rect.width < window.innerWidth * 0.5) {
               (el as HTMLElement).style.display = 'none';
             }
           }
         }
       });
       // 3) External widgets (ChannelTalk, Intercom, etc.)
       document.querySelectorAll('iframe, [id*="channel"], [id*="widget"], [class*="widget"]').forEach(el => {
         (el as HTMLElement).style.display = 'none';
       });
     });
   }

   // ===== Output: Save to .claude-project/store-prep/assets/screenshots/raw/ folder =====
   // Filename: 01-home.png, 02-exercise.png, ... (sequence-screenname.png)
   ```

4. **Generate build script** (`build-designer.ts`):
   Converts captured originals to base64 and generates a self-contained HTML designer.

   ```typescript
   import * as fs from 'fs';
   import * as path from 'path';

   const RAW_DIR = '.claude-project/store-prep/assets/screenshots/raw';
   const OUTPUT = '.claude-project/store-prep/assets/screenshots/designer.html';

   // 1. Convert all PNGs in raw/ folder to base64
   const screenshots = fs.readdirSync(RAW_DIR)
     .filter(f => f.endsWith('.png'))
     .sort()
     .map(f => ({
       name: f.replace('.png', ''),
       base64: fs.readFileSync(path.join(RAW_DIR, f)).toString('base64'),
     }));

   // 2. Insert into HTML template
   const html = generateDesignerHTML(screenshots, captions);

   // 3. Save file + auto-open in browser
   fs.writeFileSync(OUTPUT, html);
   // Windows: exec('start designer.html')
   // macOS: exec('open designer.html')
   ```

5. **Asset Designer HTML** (`designer.html`):
   **This file is the core.** Self-contained HTML requiring no external server (works with file:// protocol).

   **Designer UI Structure:**
   ```
   ┌───────────────────────────────────────────────────────────┐
   │  [Control Panel]                                          │
   │  Store: [Google Play ▼] [App Store 6.5" ▼] [iPad 13" ▼]   │
   │  Device: [iPhone 15 ▼] [Galaxy A17 ▼]                      │
   │  Background: [Color1 ■] [Color2 ■] [Gradient Direction ▼]  │
   │  [Save All] [Save All as ZIP]                              │
   ├───────────────────────────────────────────────────────────┤
   │                                                           │
   │  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
   │  │ Edit Cap  │  │ Edit Cap  │  │ Edit Cap  │                │
   │  │ [Text]   │  │ [Text]   │  │ [Text]   │                │
   │  │┌────────┐│  │┌────────┐│  │┌────────┐│                │
   │  ││ Frame  ││  ││ Frame  ││  ││ Frame  ││                │
   │  ││ + Cap  ││  ││ + Cap  ││  ││ + Cap  ││                │
   │  │└────────┘│  │└────────┘│  │└────────┘│                │
   │  │ [Save]   │  │ [Save]   │  │ [Save]   │                │
   │  └──────────┘  └──────────┘  └──────────┘                │
   │                                                           │
   └───────────────────────────────────────────────────────────┘
   ```

   **Required Features in HTML:**

   **A. Device Frames (Inline SVG)**
   Device frames are defined as `<svg>` elements within the HTML. Each frame SVG follows this structure:

   | Device | Characteristics |
   |------|------|
   | iPhone 15 | Dynamic Island (pill shape), side buttons (power/volume/mute), home indicator, aluminum texture |
   | Galaxy A17 | Infinity-V waterdrop notch, side buttons (power/volume), gesture bar, chin, plastic texture |

   Frame SVGs are defined within `<defs>` and referenced with `<use>` in each slide.

   **B. Status Bar (Inline SVG)**
   - iOS: Time (left), Dynamic Island (center), Signal+WiFi+Battery (right)
   - Android: Time (left), notification icons (center), Signal+WiFi+Battery (right)
   - Status bar automatically switches when device is changed

   **C. Slide Composition**
   Each screenshot is composed as one "slide":
   ```
   ┌─────────────────────┐
   │    Caption Text      │  ← 18% (bold, max 2 lines, contenteditable)
   │                     │
   │  ┌───────────────┐  │
   │  │  Device Frame  │  │  ← 78% (SVG frame + screenshot + status bar)
   │  │  + Screenshot  │  │
   │  │               │  │
   │  └───────────────┘  │
   │                     │  ← 4% bottom margin
   └─────────────────────┘
   Background: CSS linear-gradient (default: #E8F0FE → #F8FAFF → #FFFFFF)
   ```

   **D. Save Function (Canvas API)**
   ```javascript
   async function exportSlide(slideIndex, storeType) {
     // Exact resolution per store
     const SIZES = {
       'google-play':    { w: 1080, h: 1920 },
       'app-store-6.5':  { w: 1242, h: 2688 },
       'ipad-13':        { w: 2048, h: 2732 },
     };
     const { w, h } = SIZES[storeType];
     const canvas = document.createElement('canvas');
     canvas.width = w;
     canvas.height = h;
     const ctx = canvas.getContext('2d');

     // 1. Background gradient
     const grad = ctx.createLinearGradient(0, 0, 0, h);
     grad.addColorStop(0, bgColor1);
     grad.addColorStop(0.6, bgColor2);
     grad.addColorStop(1, bgColor3);
     ctx.fillStyle = grad;
     ctx.fillRect(0, 0, w, h);

     // 2. Caption text
     ctx.fillStyle = '#1a1a1a';
     ctx.font = `bold ${Math.round(h * 0.035)}px 'Malgun Gothic', sans-serif`;
     ctx.textAlign = 'center';
     // Render caption with line breaks in top 18% area

     // 3. Convert device frame SVG → Image then drawImage
     // 4. Draw screenshot image → drawImage in frame's screen area (rounded clip)
     // 5. Convert status bar SVG → Image then drawImage

     // Download
     canvas.toBlob(blob => {
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = `${storeType}-${String(slideIndex+1).padStart(2,'0')}-${screenName}.png`;
       a.click();
       URL.revokeObjectURL(url);
     }, 'image/png');
   }

   // Save all: all slides × selected store types
   async function exportAll() {
     for (let i = 0; i < slides.length; i++) {
       for (const storeType of selectedStoreTypes) {
         await exportSlide(i, storeType);
         await new Promise(r => setTimeout(r, 500)); // Browser download interval
       }
     }
   }
   ```

   **E. Additional Convenience Features**
   - Caption text: Direct editing via `contenteditable` (click to modify)
   - Background color: Change gradient start/end colors with color picker
   - Device switching: All slide frames update instantly when dropdown changes
   - Preview size: CSS `transform: scale()` applied to fit screen (saves at original resolution)
   - Screenshot replacement: Drop a different image on individual slides to replace

6. **Auto-clean existing images on re-capture**:
   Delete existing raw folder before capture and recreate:
   ```bash
   rm -rf .claude-project/store-prep/assets/screenshots/raw
   ```

7. **Execution commands**:
   ```bash
   # 1. Verify Playwright installation
   cd frontend && npx playwright install chromium

   # 2. Verify frontend + backend servers are running

   # 3. Capture raw screenshots (one-time)
   NODE_PATH="./frontend/node_modules" npx tsx .claude-project/store-prep/assets/screenshots/capture-screenshots.ts

   # 4. Build designer HTML + open in browser
   npx tsx .claude-project/store-prep/assets/screenshots/build-designer.ts
   # → designer.html automatically opens in browser
   # → Adjust frame/caption/background then export via save button

   # 5. (Optional) To modify design only — reopen designer without re-capture
   start .claude-project/store-prep/assets/screenshots/designer.html
   ```

### Screenshot Checklist
- [ ] Confirm dev tool UI is not included in captures (TanStack Query Devtools `.tsqd-*`, Playwright badges, ChannelTalk, etc. — `removeFloatingElements()` must be called)
- [ ] Capture with an account that has real data (avoid empty screens)
- [ ] Verify each caption accurately describes the corresponding feature in the designer
- [ ] Verify device frames match the store (Android → Galaxy, iOS → iPhone)
- [ ] Verify saved PNG resolution matches store requirements
- [ ] Verify designer HTML works correctly with file:// protocol

---

## Phase 4: Splash Screen (`/store-assets splash`)

### Execution Algorithm

1. Provide splash generation guide based on app icon/logo
2. Capacitor splash screen setup:
   - `.claude-project/store-prep/assets/splash/splash.png` (2732 x 2732 px, centered logo)
   - `.claude-project/store-prep/assets/splash/splash-dark.png` (if dark mode supported)
3. Generate Capacitor configuration code:
   ```typescript
   // capacitor.config.ts
   SplashScreen: {
     launchShowDuration: 2000,
     backgroundColor: "#FFFFFF",
     showSpinner: false,
   }
   ```

4. **Sharp splash generation script**:
   ```javascript
   // .claude-project/store-prep/assets/splash/generate-splash.js
   const sharp = require('sharp');
   const ICON = '.claude-project/store-prep/assets/icons/icon-original.png';
   const SIZE = 2732;
   const ICON_SIZE = 512;

   async function generateSplash(bg = '#FFFFFF', output = 'splash.png') {
     const canvas = sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: bg } });
     const icon = await sharp(ICON).resize(ICON_SIZE, ICON_SIZE).toBuffer();
     await canvas
       .composite([{ input: icon, top: Math.floor((SIZE - ICON_SIZE) / 2), left: Math.floor((SIZE - ICON_SIZE) / 2) }])
       .png().toFile(output);
     console.log(`✅ ${output} (${SIZE}x${SIZE})`);
   }
   generateSplash('#FFFFFF', 'splash.png');
   generateSplash('#1a1a1a', 'splash-dark.png');
   ```

---

## Phase 5: Feature Graphic (`/store-assets feature`)

### Google Play Only
- Size: 1024 x 500 px
- Banner image that conveys the app's core value
- Displayed at the top of the store listing

### Guide
- Recommended: combination of app name + core message + screenshots
- Text should be 80% or less of the image
- Include logo/icon but not too small

---

## Full Output Structure

```
.claude-project/store-prep/assets/
├── icons/
│   ├── icon-original.png         # Original (1024x1024+)
│   ├── icon-playstore.png        # 512x512
│   ├── icon-appstore.png         # 1024x1024
│   ├── android/                  # Android mipmap set
│   ├── ios/                      # iOS AppIcon set
│   └── resize-icons.js           # Sharp resizing script
├── screenshots/
│   ├── capture-screenshots.ts    # Playwright auto-capture script (one-time)
│   ├── build-designer.ts         # Captured images → HTML designer build script
│   ├── designer.html             # Browser-based asset designer (auto-generated)
│   └── raw/                      # Playwright raw captures (01-home.png, ...)
├── splash/
│   ├── splash.png                # 2732x2732
│   ├── splash-dark.png           # Dark mode
│   └── generate-splash.js        # Sharp splash generation script
└── feature-graphic/
    └── feature-graphic.png       # 1024x500 (Google Play)
```

**Framed final assets are not saved as project files** — they are exported directly via browser download from the designer HTML.
