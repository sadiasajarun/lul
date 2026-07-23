# Design Phase Rules

## Design System Generation
- Generate DESIGN_SYSTEM.md using the shared BM25 design intelligence tool:
  ```bash
  python3 agents/_shared/tools/design_system/scripts/search.py "<niche keywords>" --design-system -p "ProjectName"
  ```
- Each niche produces unique tokens (colors, fonts, style) — never copy from another niche
- Supplementary searches for domain-specific UX and chart guidance:
  ```bash
  python3 agents/_shared/tools/design_system/scripts/search.py "booking calendar form" --domain ux
  python3 agents/_shared/tools/design_system/scripts/search.py "revenue analytics" --domain chart
  ```

## Process
- Always read DESIGN_SYSTEM.md before generating any HTML
- Follow atomic design hierarchy: atoms → molecules → organisms → pages
- Extract layout shell from page 1, reuse for all subsequent pages
- Every inter-page link must use actual filenames, never href="#"

## Quality
- Shared components (navbar, footer) must be programmatically identical across pages
- All HTML must use semantic elements (<header>, <nav>, <main>, <footer>)
- Colors, fonts, spacing must match DESIGN_SYSTEM.md exactly
- Style DNA prefix must be prepended to every generation prompt

## Anti-Patterns (Pre-Delivery Checklist)
- No emojis as icons — use SVG or Lucide Icons only
- All clickable elements must have `cursor-pointer`
- Hover states use color/opacity changes only — never scale or layout shift
- Text contrast ratio must be >= 4.5:1 (WCAG AA)
- No horizontal scroll on mobile (375px minimum)
- All form inputs must have associated labels
- Consistent icon sizing within context (w-5 h-5 inline, w-6 h-6 standalone)
- Responsive at all breakpoints: 375px / 768px / 1024px / 1440px

## Scope Guard
- ONLY create files under: .claude-project/generated-screens/ OR .claude-project/design/
- ONLY modify: .claude-project/design/DESIGN_SYSTEM.md, DESIGN_STATUS.md
- Do NOT write React/JSX code — this phase produces HTML only
- Do NOT create backend files or modify database entities
- Do NOT install npm packages
