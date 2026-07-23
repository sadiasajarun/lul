# Learnings: intelligent-data-dashboard

This document captures experiential knowledge - patterns discovered, pitfalls encountered, and insights gained during development.

---

## Codebase Patterns

### Established Patterns

| Pattern | Location | Description |
|---------|----------|-------------|
| Dynamic widget rendering | `src/app/App.tsx` (`AIDashboardView`) | LLM returns `DynamicDashboardResponse`; widgets rendered by `type` + `chartType` |
| Streaming CSV RAG | `src/app/utils/ragHelper.ts` | `fetch` + `ReadableStream`, stop at 15 matches/file — keeps memory flat |
| CSV-as-URL imports | `ragHelper.ts` top, `vite.config.ts` | `import url from "...csv?url"` (needs `assetsInclude: ['**/*.csv']`) |
| Provider dispatch with fallback | `src/app/utils/openAIHelper.ts` | `local` mode or empty key → deterministic in-browser analysis |
| figma:asset resolver | `vite.config.ts` | `figma:asset/x.png` → `src/assets/x.png` via custom plugin |

### Anti-Patterns Discovered

| Anti-Pattern | Why It Failed | Better Approach |
|--------------|---------------|-----------------|
| Applying `.claude` fullstack mandates (RR7, `~/` alias, `app/` dir, Redux) here | This is a Figma Make export with `src/`, `@/`, `main.tsx`, no router | Follow PROJECT_KNOWLEDGE.md → Conventions |

---

## Debugging Insights

### Common Issues & Solutions

#### Issue: `'vite' is not recognized` on `npm run dev`
**Symptoms**: dev script fails immediately although `node_modules/` exists
**Root Cause**: stale/incomplete `node_modules` (copied or partially installed)
**Solution**: re-run `npm install`
**Prevention**: reinstall after moving the project between machines/folders

#### Issue: Dev server not on 5173
**Symptoms**: Vite logs "Port 5173 is in use, trying another one..."
**Root Cause**: another Vite instance/app occupies 5173 on this machine
**Solution**: use the URL Vite prints (e.g. http://localhost:5174)

---

## Integration Quirks

### Third-Party Libraries

| Library | Quirk/Issue | Workaround |
|---------|-------------|------------|
| Gemini API | Key travels in the query string | Key is user-supplied, localStorage only — never hardcode |
| Recharts | Widget `data` shape must match `xAxisKey`/`seriesKeys` from the LLM | Validate before render |

### API Behaviors

- LLMs occasionally wrap JSON in markdown fences; response parsing must strip them.

---

## Environment-Specific Knowledge

### Development
- Windows 11, PowerShell 5.1 default shell; project path contains spaces — always quote paths.
- `npm install` reports 2 high-severity vulnerabilities (transitive, dev-time); not yet triaged.

---

## Session Notes

### 2026-07-17: Initial local setup
- Installed deps, verified dev server on port 5174 (5173 occupied), HTTP 200.
- Created `.claude/` (fullstack + operations copies) and this `.claude-project/`.

### 2026-07-17: Learned the design-origin prototype
- This app is the React build of the **OOSC-BD / "Let Us Learn" admin dashboard**, first designed
  as a clickable prototype in the Laravel backend repo at
  `D:\letuslearn\let-us-learn-backend-stage\prototype\`.
- Distilled its design + logic into
  [docs/PROTOTYPE_DESIGN_KNOWLEDGE.md](../docs/PROTOTYPE_DESIGN_KNOWLEDGE.md): A1/A2/A3 scoring
  formulas (with exact weights), the constrained-intent Ask pipeline, the **grounded-narrative
  guardrail** (`validateNarrative` — never emit a number not in the payload), domain band colours,
  bilingual EN/BN, and the decision-surface IA.
- Key reuse rule: keep the prototype's *thinking* (grounding, 4-block answer, scoring semantics,
  band colours), re-express visuals in Tailwind + Recharts (the app's deliberate stack swap from
  Bootstrap 4 + Google Charts).
