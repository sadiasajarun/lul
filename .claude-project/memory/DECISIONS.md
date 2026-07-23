# Decision Log: intelligent-data-dashboard

This document tracks key technical and architectural decisions made during development.

## Template

```markdown
## [Date]: [Decision Title]

**Context**: [Why this decision was needed]

**Decision**: [What was decided]

**Rationale**: [Why this choice was made]

**Alternatives Considered**:
- [Alternative 1]: [Why not chosen]

**Consequences**: [What this means going forward]
```

---

## Decisions

## 2026-07-17: Adopt claude-fullstack + claude-operations as `.claude/` toolkit

**Context**: The project needed Claude Code configuration (skills, pipeline,
hooks, templates) for ongoing development.

**Decision**: Copied the `claude-fullstack` repo into `.claude/` and the
`claude-operations` repo into `.claude/operations/` (mirroring the submodule
layout declared in claude-fullstack's `.gitmodules`). Copies, not git submodules,
because this project is not a git repository yet.

**Rationale**: Reuses the company's pipeline blueprints, gates, QA/design skills,
and `.claude-project` templates without restructuring the app.

**Alternatives Considered**:
- Git submodules: not possible until the project is `git init`-ed; can be
  converted later.

**Consequences**: `.claude/` content will not auto-update from upstream. If the
project becomes a git repo, consider replacing the copies with submodules.

## 2026-07-17: `.claude-project/` docs describe reality, not the fullstack template stack

**Context**: The fullstack templates assume NestJS + React Router 7 + Redux with
`app/` dir and `~/` alias. This project is a Figma Make Vite export using `src/`,
`@/` alias, `main.tsx`, no router, no Redux.

**Decision**: Filled `.claude-project/docs/*` with the project's actual
conventions and marked the template mandates as not applicable (see
PROJECT_KNOWLEDGE.md → Conventions).

**Consequences**: Anyone running `.claude` pipeline phases must not "correct"
the app toward RR7/NestJS patterns unless the project is deliberately migrated.

## (pre-existing) Client-side RAG over static CSVs, multi-provider AI

**Context**: Demo needed to run as a pure static site.

**Decision**: Stream CSVs in the browser for retrieval; let the user pick
Gemini / OpenAI / local fallback with keys stored in localStorage.

**Consequences**: API keys live in the browser; a backend proxy is required
before any production hardening.
