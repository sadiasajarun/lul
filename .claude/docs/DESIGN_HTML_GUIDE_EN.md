# Design HTML Delivery Guide (for the design team)

> This is the exact file format the **HTML prototype → React auto-conversion pipeline** consumes.
> Follow the structure/markers below and conversion quality — especially shared-component
> consistency — is guaranteed.
> v164: shared-chrome (top bar / bottom tab bar / sidebar) marker rules.
> v165: the Single-Source principle + page-background + component-class + icon rules.

---

## 0. The one principle — "Define once, reference everywhere" (Single Source of Truth)

Every rule in this guide comes from **one principle**:

> **Never repeat a value across pages. Anything that repeats references one place.**

| If it repeats… | …it lives in one place (single source) |
|---|---|
| color / spacing / font | a **token** `var(--c-*/--t-*/--space-*)` (theme.css) |
| button / badge / card look | a **class** `.btn` `.badge` `.card` (components.css) |
| top bar / bottom bar / sidebar | **shared chrome** `data-shell` (shells/) |
| page background (canvas) | **`body`** (once) |
| icon | a **Lucide name** `data-lucide` |

**Why it matters:** the converter builds each page **in isolation** — it cannot see the page next
door. So if the design doesn't *declare* "this is shared," each page re-decides the value and they
**drift**. Real cases from the last delivery: the page background split into 3 values (chat pages
turned grey), buttons were re-drawn inline **232 times across 81 pages**, and icons became **199
separate inline `<svg>`s**.

> A page draws **only its own unique content.** Everything shared is **referenced, not repainted.**

---

## 1. Overall file structure

```
<project>-deliverable/
├── PRD/
│   └── <Project>_PRD.md                  # the PRD (one file)
└── design/
    ├── manifest.json                     # ⭐ route ↔ component map + global-style declaration
    ├── styles/                           # ⭐ design-system CSS (single visual source of truth)
    │   ├── theme.css                     #   tokens: --c-* colors, --t-* type, --space-* spacing
    │   └── components.css                #   shared component classes (.btn, .badge, .card, …)
    ├── shells/                           # ⭐ one shared-chrome file per app (see §4)
    │   ├── student.shell.html            #   StudentLayout chrome (top bar + bottom tab bar)
    │   ├── instructor.shell.html
    │   └── admin.shell.html              #   AdminLayout chrome (sidebar)
    ├── html/
    │   ├── <app>/                        # 1 file = 1 route (app = student/instructor/admin …)
    │   │   ├── A-1-login.html
    │   │   ├── B-1-home.html
    │   │   └── …
    │   ├── states/                       # state sheets (loading/empty/error) — NOT routes
    │   │   └── B-1-home.states.html
    │   └── index.html                    # gallery — NOT a route
    └── README.md
```

**Core rules**
- **1 file = 1 route** inside `html/<app>/`. (An *app* = a separate frontend, e.g. `frontend` = student, `frontend-admin-dashboard` = admin.)
- State sheets are `html/states/<page>.states.html` with `<body data-component="dev-states">` — they are **excluded** from the route count.
- Every route HTML **links** `design/styles/theme.css` + `components.css` by relative path (for preview). The pipeline reads the real location from the manifest's `globalStyles`.

---

## 2. `manifest.json` format

```json
{
  "globalStyles": ["styles/theme.css", "styles/components.css"],
  "screens": [
    {
      "file": "frontend/B-1-home.html",
      "route": "/",                       // ⭐ the real route path (same as the app will register)
      "app": "frontend",                  // ⭐ which frontend (app) it belongs to
      "layout": "StudentLayout",          // ⭐ which shared layout (chrome) it uses
      "component": "HomePage",
      "guard": "auth:student",            // guest | auth:student | auth:instructor | auth:admin
      "primaryApi": "GET /api/instructors/nearby"
    }
  ]
}
```

- `route` **must exactly match** the path the app registers. (Home as `/` → manifest `/`. A mismatch like `/home` → 404 → conversion check fails.)
- `app` + `layout` are the **single source of truth** for "which shared chrome this screen uses."

---

## 3. Route HTML shape (one file)

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="../../styles/theme.css">       <!-- relative path (preview) -->
  <link rel="stylesheet" href="../../styles/components.css">
  <script src="https://unpkg.com/lucide@latest"></script>     <!-- icons (§6): renders real Lucide SVG in preview -->
</head>
<body data-app="student" data-layout="StudentLayout">

  <!-- ▼▼▼ shared chrome — see §4. Must be byte-identical on every page ▼▼▼ -->
  <header data-shell="topbar"> … top bar (logo / location / bell) … </header>

  <!-- ▼ this page's unique content (the ONLY conversion target) ▼ -->
  <main data-shell="content">
      … page-specific UI …
  </main>

  <!-- ▼ shared bottom tab bar — Home / Search / Chat / MY ▼ -->
  <nav data-shell="bottomnav" data-component="nav" aria-label="primary"> … </nav>
  <!-- ▲▲▲ end shared chrome ▲▲▲ -->

  <script>lucide.createIcons();</script>   <!-- render icons (§6) — once, before </body> -->
</body>
</html>
```

---

## 4. ⭐ Shared chrome (navbar / bottom tab bar / sidebar) — core of v164

**The problem:** the converter makes each page into React **one at a time**. It doesn't remember the
neighboring page, so shared chrome gets drawn **differently / duplicated** per page. (One real run:
28 pages each drew their own bottom bar → doubled or inconsistent tab bars.)

**The fix: you only *declare* the shared chrome; the pipeline forces it into ONE.** What the design
team does:

### 4-1. Wrap shared chrome in markers
| Region | Marker |
|---|---|
| top app bar | `data-shell="topbar"` |
| bottom tab bar | `data-shell="bottomnav"` (may also keep `data-component="nav"`) |
| sidebar (admin) | `data-shell="sidebar"` |
| page-unique content | `data-shell="content"` |

### 4-2. Shared chrome must be **identical on every page**
- For all pages sharing the same `data-app` + `data-layout`, the `data-shell="topbar"`/`"bottomnav"` blocks must be **byte-identical** (copy-paste — not even a margin may differ).
- **Don't statically paint the active tab.** The framework computes the active tab from the URL. If you must indicate it, put only `aria-current="page"` on the active link.

### 4-3. One chrome file per app in `shells/` (recommended single source)
- `design/shells/student.shell.html` = one copy of StudentLayout's chrome. Shape:
  ```html
  <body data-layout="StudentLayout">
    <header data-shell="topbar"> … </header>
    <!-- @CONTENT -->                      <!-- slot where page content goes -->
    <nav data-shell="bottomnav"> … </nav>
  </body>
  ```
- This single file is that app's **chrome master.** Keep every route's chrome identical to it.

### 4-4. What the pipeline does automatically (design team doesn't)
- Extracts the shared chrome into **exactly one** Layout component → every page renders inside it.
- **Auto-removes** any chrome copy that leaked into a page (strip doctor).
- **Gate FAIL** if chrome remains in a page (`shared-nav-single-source`).

> So the design team only **marks "this is shared chrome" + keeps it identical.** Merging into one is the pipeline's job.

### nav that MAY stay in a page (not shared chrome)
- In-page tabs (`data-testid="...-tabs"`), breadcrumbs, pagination, a single "back" link → OK.
- App-wide top bar / bottom tab bar / sidebar → ❌ (shared chrome, owned by the Layout).

---

## 5. Design-system CSS

- `design/styles/theme.css` — tokens only: `--c-*` (color), `--t-*` (type), `--space-*` (spacing).
- `design/styles/components.css` — shared component classes (`.btn`, `.badge`, `.card`, `.btn-kakao`, …).
- Route HTML **references** tokens/classes — never hardcode the value. (`background: var(--c-surface)` ✅, `background:#fff` ✗)
- Declare both files in the manifest's `globalStyles`; the pipeline reflects them into the React app automatically.

---

## 6. ⭐ Icons — Lucide only (v165)

**The problem:** the converter copies inline `<svg>` verbatim. The same icon ends up drawn differently
(size, stroke, path) per page, and the app's installed `lucide-react` goes unused. (One run: 199 inline
`<svg>` vs 5 lucide files.)

**The fix: both design and app use the same icon library (Lucide).** Lucide ships a vanilla (HTML) build
and a React build (`lucide-react`) with **100% identical names**, so conversion is a trivial 1:1 name map.

### 6-1. How to author icons in HTML
```html
<!-- once in <head> (already in the §3 template) -->
<script src="https://unpkg.com/lucide@latest"></script>

<!-- anywhere in the body — name only, never a hand-drawn <svg> -->
<i data-lucide="home"></i>
<i data-lucide="search"></i>
<i data-lucide="chevron-down" class="w-5 h-5"></i>

<!-- once before </body> (already in the §3 template) -->
<script>lucide.createIcons();</script>
```
- `lucide.createIcons()` replaces every `data-lucide="name"` with the **real Lucide SVG** → preview shows the **same icon** the React app renders.
- Use the **canonical kebab name from lucide.dev/icons** (e.g. `chevron-down`, `map-pin`, `message-circle`). That name maps directly to `lucide-react`'s `<ChevronDown/>`.

### 6-2. Forbidden
- ❌ Hand-drawn / pasted inline `<svg><path d="…"/></svg>` — the pipeline can't identify it, so it stays inline (inconsistent) and **FAILs the gate**.
- ❌ Emoji as icons (🔍 🏠 🔔 …).
- ❌ Mixing other icon libraries (FontAwesome, Heroicons, …) — Lucide only.

### 6-3. Accessibility + size
- Decorative icon: `aria-hidden="true"`. Meaningful (standalone clickable) icon: `aria-label="Search"`.
- Size via class, consistently: inline `w-4 h-4` (16px) / `w-5 h-5` (20px), standalone `w-6 h-6` (24px). Same context → same size.

### 6-4. What the pipeline does automatically
- `data-lucide="home"` → `import { Home } from 'lucide-react'` + `<Home/>` (deterministic kebab→Pascal).
- **Gate FAIL** (`no-inline-svg-icons`) if any inline `<svg>` icon remains in a page.

---

## 7. ⭐ Page background — owned by `body` (v165)

**The problem:** if every page paints its own frame background (103 pages each set one), the values
drift. Chat/MY/profile pages used `--c-surface-soft` (#eef1f6) while the rest used `--c-canvas`
(#f4f7fb), and some hardcoded `#eef1f6` instead of the token — so screens looked inconsistent.

**The rules:**
- The page background (canvas) is owned **once by `body`.** In the design CSS (`theme.css` or `components.css`):
  ```css
  @layer base { body { background: var(--c-canvas); } }
  ```
- **Do NOT paint a frame background on the route HTML root.** Pages inherit `body`'s background.
- Use **one** canvas token (`--c-canvas` recommended). No "only chat is grey" drift.
- Never use a hex (`#eef1f6`) for background — always `var(--c-*)`.
- Only a genuinely special page (full-bleed onboarding, etc.) may override, marked as an **explicit exception**.

> Pipeline does automatically: inject the `body` background into the app + strip leaked per-page frame backgrounds + restore hex→token + single-value gate.

---

## 8. ⭐ Components — `components.css` classes are the single source (v165)

**The problem:** re-drawing buttons/badges/cards inline on each page (**232 inline buttons across 81
pages**, 23 inline badges) makes their shape/color/padding drift.

**The rules:**
- Define repeated UI (button, badge, card, input, chip…) **once as a class** in `components.css`
  (`.btn`, `.btn-primary`, `.btn-kakao`, `.badge`, `.badge-warning`, `.card`, `.input`…), and use
  **only those classes** on every page.
- Don't re-style the same button per page with ad-hoc `style`/utilities — color/padding/radius come from the **class (= tokens).**
- **Same role = same class name.** (The converter maps the class to one shared React component; mismatched classes break the mapping.)
- A button is a `<button>` (or `<a>` if it's a link) — never a clickable `<div>`.

> Pipeline does automatically: collect repeated inline markup into shared components + gate when shared components aren't used.

---

## 9. ⭐ Same screen for multiple roles = ONE component (v165)

**The problem:** screens that exist per-role — chat list, profile, dashboard — are delivered as
**separate HTML files per role** (e.g. `E-1-chat-list.html` for student, `K-1-instructor-chat-list.html`
for instructor). Because the converter builds each file independently, the *same* screen becomes two
unrelated implementations that drift — one ended up hardcoding `bg-[#eef1f6]` while the other kept
`bg-[var(--c-surface-soft)]`; two profile pages came out 344 vs 138 lines.

**The rules:**
- Treat a screen/block that appears for **multiple roles** as **ONE component**, designed once. Role
  differences (extra action, different field) are small explicit variations, not a separate redraw.
- In **every** role's proto, wrap the shared block with a **`data-component="<name>"`** marker —
  the content equivalent of `data-shell`. Use the **same name** on every role:
  ```html
  <!-- student E-1-chat-list.html AND instructor K-1-instructor-chat-list.html -->
  <ul data-component="chat-list">
    <li data-component="chat-list-item"> … same markup + same classes in both … </li>
  </ul>
  ```
- The shared block must use **identical classes + structure** across roles (they already share tokens — keep it that way; don't let one role hardcode values).
- If a role genuinely needs an extra element, add it *around* the shared block, not by re-drawing it.

> Pipeline does automatically: a `data-component="X"` block that appears in multiple pages is extracted into **one** shared React component used by all roles, and a gate flags near-duplicate pages that don't share a component.

---

## 10. Pre-delivery checklist

- [ ] `html/<app>/` 1 file = 1 route; manifest `route` matches the app's registered path
- [ ] manifest.json fills `file/route/app/layout/component/guard` for every screen
- [ ] **Shared chrome (top/bottom/sidebar) wrapped in `data-shell` markers**
- [ ] **Shared chrome byte-identical across all pages of a layout**
- [ ] Page-unique content wrapped in `data-shell="content"`
- [ ] Active tab not statically painted (only `aria-current`)
- [ ] State sheets in `html/states/`, `<body data-component="dev-states">`
- [ ] **Color/spacing/type always `var(--c-*/--t-*/--space-*)` tokens** — no raw hex (`#eef1f6`) / px
- [ ] **Page background owned by `body`** — no background on the route HTML root; one canvas token
- [ ] **Buttons/badges/cards use `components.css` classes** — no inline re-styling; same role = same class
- [ ] **Same screen across roles = one component** — wrap shared blocks in `data-component="<name>"` (same name in every role), identical classes/structure
- [ ] **All icons are Lucide** (`<i data-lucide="name">`) — no hand-drawn `<svg>`/emoji/other library
- [ ] Icon names are canonical kebab from lucide.dev/icons (e.g. `map-pin`, `chevron-down`)
- [ ] Lucide script in `<head>` + `lucide.createIcons()` once before `</body>`
- [ ] Every inter-page link uses a real route path (no `href="#"`)
- [ ] Mobile-first layout at 375px / 390px (SpoMatch is mobile-first)
