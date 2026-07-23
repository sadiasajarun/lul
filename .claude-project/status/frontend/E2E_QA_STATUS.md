# E2E QA Status: intelligent-data-dashboard (Frontend)

## Overview

Tracks end-to-end test coverage. **No test infrastructure exists yet** —
no Playwright config, no test directory.

**Last Updated:** 2026-07-17

---

## Test Coverage Matrix

| View / Flow | Test Scenario Name | Status | Lasted at |
|-------------|-------------------|--------|-----------|
| App load | Dashboard renders with default view | Not Started | - |
| AI query (local mode) | Prompt → widgets render without API key | Not Started | - |
| AI query (mocked provider) | Malformed LLM JSON handled gracefully | Not Started | - |
| Settings modal | Provider + key persist to localStorage | Not Started | - |
| View switching | Each of the 12 views renders | Not Started | - |
| Comparison | Two schools comparable side by side | Not Started | - |

---

## Status Legend

| Status | Meaning |
|--------|---------|
| Not Started | Test not yet implemented |
| In Progress | Test currently being developed |
| Complete | Test implemented and passing |
| Skipped | Test exists but skipped |
| Blocked | Cannot implement due to dependency |

---

## Test Infrastructure (planned)

Suggested: Playwright + TypeScript. `.claude/skills/qa/run-playwright/SKILL.md`
and `.claude/agents/playwright-qa-agent.md` are available in the toolkit.
