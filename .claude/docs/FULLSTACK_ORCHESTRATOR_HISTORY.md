# Fullstack Orchestrator: Architecture Evolution & Lessons Learned

This document archives the iterative design process of the `/fullstack` command, capturing failed approaches, lessons learned, and successful decisions. It serves as institutional memory for future architectural decisions.

---

## Purpose

The `/fullstack` command orchestrates the full development lifecycle:

```
PRD → Database → Backend → Frontend → API Integration → E2E Tests → QA → Deployment
```

This document explains **why** the current architecture exists by showing **what we tried and learned**.

---

## Architecture Evolution Summary

| Version | Approach | Status | Key Lesson |
|---------|----------|--------|------------|
| v1 | Custom orchestrator | REJECTED | Don't reinvent the wheel |
| v2 | Ralph per phase | REJECTED | Don't claim impossible parallelism |
| v3 | "Ralph All The Way Down" | REJECTED | Match tool to granularity |
| v4 | Skill Chain (duplicate skills) | PARTIAL | Check existing skills first |
| **v5** | **Reference Architecture** | **CURRENT** | Respect 3-tier architecture |

---

## Version 1: Custom Orchestrator (REJECTED)

**Date**: 2025-01-08

### What We Tried

- Built custom state management system
- Created complex phase dependency graph
- Wrote manual status tracking code

### Why It Failed

| Problem | Impact |
|---------|--------|
| Too much custom code | High maintenance burden |
| Reinventing existing functionality | Wasted effort |
| High token cost | Inefficient orchestration |
| Hard to debug | Poor developer experience |

### Lesson Learned

> **Don't build custom infrastructure when existing tools can be leveraged.**

The status file pattern from Ralph already solved state tracking. Building our own was unnecessary.

---

## Version 2: Ralph Per Phase (REJECTED)

**Date**: 2025-01-08

### What We Tried

- Claimed "parallel execution" of phases
- Made each phase a separate Ralph workflow
- Built complex inter-phase communication

### Why It Failed

| Problem | Impact |
|---------|--------|
| **Parallelism is impossible** | Claude is single-threaded |
| Ralph overhead for simple tasks | Unnecessary complexity |
| 9 phases that must run sequentially | Wrong tool for the job |

### Lesson Learned

> **Don't claim parallelism when the underlying system is sequential. Be honest about constraints.**

We wasted time designing a parallel system that fundamentally couldn't exist.

---

## Version 3: "Ralph All The Way Down" (REJECTED)

**Date**: 2025-01-09

### What We Tried

- Model entire pipeline as a Ralph workflow
- Treat phases as "items" to process
- Use nested Ralph for complex phases (frontend with 48 screens)
- Chain phases via completion promises

### Architecture Diagram

```
/ralph fullstack-pipeline project
    │
    └── PIPELINE_STATUS.md (phases as items)
        │
        ├── init (item)
        ├── prd (item)
        ├── database (item)
        ├── backend (item) → nested Ralph
        ├── frontend (item) → /ralph design-qa (48 screens)
        └── ...
```

### Why It Failed

| Problem | Impact |
|---------|--------|
| Over-engineered | 5 layers of abstraction |
| High overhead | ~500 tokens per phase |
| Hard to debug | Nested loop internals invisible |
| Plugin required everywhere | Unnecessary dependency |

### What Was Good (Kept)

- Status file as state machine concept ✅
- `--incremental` flag for resume ✅
- Category-based filtering ✅

### Lesson Learned

> **Ralph excels at item-level iteration (48 screens, 29 tests), but is overkill for 9 sequential phases. Use the right tool for the right granularity.**

Ralph is perfect for many items, but 9 phases don't need autonomous loops.

---

## Version 4: Skill Chain (PARTIALLY SUCCESSFUL)

**Date**: 2025-01-10

### What We Tried

- Direct skill invocation (no plugin)
- Single PIPELINE_STATUS.md for tracking
- One skill file per phase
- 2 layers instead of 5
- ~60% token savings

### What Was Good

| Success | Benefit |
|---------|---------|
| Simple architecture | Easy to debug |
| No plugin dependency | Fewer moving parts |
| Status file resume | Edit file to retry |
| Created core files | `fullstack.md`, `PIPELINE_STATUS.template.md` |

### What Failed - CRITICAL

**Violated the 3-tier architecture by creating duplicate skills:**

| Created (WRONG) | Already Existed (CORRECT) |
|-----------------|---------------------------|
| `base/skills/fullstack/database-designer.md` | `nestjs/skills/design-database.md` |
| `base/skills/fullstack/prd-processor.md` | `nestjs/skills/prd-to-knowledge.md` |
| `base/skills/fullstack/frontend-builder.md` | `react/skills/figma-to-react.md` |
| `base/skills/fullstack/qa-runner.md` | `react/skills/design-qa.md` |
| `base/skills/fullstack/e2e-generator.md` | `nestjs/` + `react/` versions |
| `base/skills/fullstack/api-integrator.md` | `react/guides/api-integration.md` |

### Lesson Learned

> **Before creating new skills, ALWAYS check if equivalent skills exist in tech-stack tiers. The 3-tier architecture exists for a reason - respect it.**

---

## Version 5: Reference Architecture (CURRENT)

**Date**: 2025-01-10

### Key Insight

> The `/fullstack` command should be a **thin orchestrator** that REFERENCES comprehensive skills from their correct tier locations, not duplicate them.

### Architecture

```
/fullstack (orchestrator in base/)
    │
    ├── Reads phase → Gets skill path from tier mapping
    │
    ├── Phase: database → Reference: nestjs/skills/design-database.md
    ├── Phase: frontend → Reference: react/skills/figma-to-react.md
    ├── Phase: integrate → Reference: react/guides/api-integration.md
    ├── Phase: qa       → Reference: react/skills/design-qa.md + /ralph
    │
    └── Only creates truly unique skills:
        ├── project-init.md (generic init - no equivalent)
        └── deployment.md (generic deployment - no equivalent)
```

### Final File Structure

```
Base tier (unique to /fullstack):
├── .claude/base/commands/fullstack.md           # Orchestrator
├── .claude/base/templates/PIPELINE_STATUS.template.md
└── .claude/base/skills/fullstack/
    ├── project-init.md                          # Unique
    └── deployment.md                            # Unique

Referenced from existing tiers:
├── .claude/nestjs/skills/
│   ├── prd-to-knowledge.md                      # prd phase
│   ├── design-database.md                       # database phase
│   └── e2e-test-generator.md                    # test phase (backend)
└── .claude/react/
    ├── skills/
    │   ├── figma-to-react.md                    # frontend phase
    │   ├── design-qa.md                         # qa phase
    │   └── e2e-test-generator.md                # test phase (frontend)
    └── guides/
        └── api-integration.md                   # integrate phase
```

### Benefits

| Aspect | v4 (Duplicate) | v5 (Reference) |
|--------|----------------|----------------|
| Files to maintain | 10 | 4 |
| Consistency | Could drift | Single source of truth |
| Skill quality | Thin wrappers | Full implementations |
| 3-tier compliance | ❌ Violated | ✅ Respected |
| Upgrade path | Manual sync | Automatic |

---

## Lessons Learned Summary

| # | Lesson | Context |
|---|--------|---------|
| 1 | Don't reinvent the wheel | v1 built custom orchestration when simpler approaches existed |
| 2 | Be honest about constraints | v2 claimed parallelism that was impossible |
| 3 | Match tool to granularity | v3 used Ralph for 9 phases (overkill), Ralph is for many items |
| 4 | Check existing skills first | v4 duplicated skills that already existed |
| 5 | Respect tier architecture | base/ = generic, nestjs/ = backend, react/ = frontend |
| 6 | Orchestrator ≠ Implementation | Commands orchestrate, skills implement |

---

## Decision Log

| Date | Decision | Rationale | Outcome |
|------|----------|-----------|---------|
| 2025-01-08 | Use status files for state | Ralph pattern proven, human-readable | ✅ Success |
| 2025-01-08 | Sequential execution | Phases have dependencies, parallel impossible | ✅ Success |
| 2025-01-09 | Ralph for item-level work only | Overkill for phases, perfect for 48 screens | ✅ Success |
| 2025-01-10 | Create skills in base/fullstack/ | Seemed logical at the time | ❌ Violated 3-tier |
| 2025-01-10 | Reference existing skills | Single source of truth | ✅ Success |

---

## When to Use Each Approach

### Use Skill Chain (phases)

- 9 sequential phases with dependencies
- Single Claude invocation per phase
- Status file for tracking/resume

### Use Ralph (items)

- 48 screens to implement
- 29 E2E tests to generate
- Many items needing iterative processing

### Use Existing Skills

- Always check nestjs/skills/ and react/skills/ first
- Only create new skills if truly unique
- Respect the 3-tier architecture

---

## Current Phase-to-Skill Mapping

| Phase | Skill | Tier | Path |
|-------|-------|------|------|
| init | project-init.md | base | `base/skills/fullstack/` |
| prd | prd-to-knowledge.md | nestjs | `nestjs/skills/` |
| database | design-database.md | nestjs | `nestjs/skills/` |
| backend | (composite) | nestjs | Multiple nestjs skills |
| frontend | figma-to-react.md | react | `react/skills/` |
| integrate | api-integration.md | react | `react/guides/` |
| test | e2e-test-generator.md | stack | `{stack}/skills/` |
| qa | design-qa.md | react | `react/skills/` + Ralph |
| ship | deployment.md | base | `base/skills/fullstack/` |

---

## Related Documentation

- [fullstack.md](../commands/fullstack.md) - Command reference
- [PIPELINE_STATUS.template.md](../templates/PIPELINE_STATUS.template.md) - Status file template
- [base/README.md](../README.md) - 3-tier architecture overview
- [ralph.md](../commands/ralph.md) - Ralph workflow reference

---

## Contributing

When modifying the fullstack orchestrator:

1. **Read this document first** - Understand why current decisions were made
2. **Check existing skills** - Never duplicate nestjs/ or react/ tier skills
3. **Update this document** - Record new decisions and lessons learned
4. **Test with real project** - Verify phase transitions work correctly
