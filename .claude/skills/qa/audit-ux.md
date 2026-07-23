---
name: ux-audit
description: "Run autonomous UX heuristic scan on a project. Standalone command that invokes the ux-scanner skill outside of the pipeline."
---

# /ux-audit

Standalone command to run the UX heuristic scanner on a project.

## Usage

```
/ux-audit <project-path> [options]
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--route <path>` | Scan only this route (e.g., `/admin/users`) | All routes |
| `--category <id>` | Run only this category (e.g., `text-quality`, `dead-ui`) | All categories |
| `--severity-min <P0-P3>` | Report only issues at this severity or higher | P3 (all) |

## Examples

```bash
# Full scan — all routes, all categories
/ux-audit /path/to/my-project

# Single route
/ux-audit /path/to/my-project --route /admin/users

# Only text quality checks
/ux-audit /path/to/my-project --category text-quality

# Only critical issues
/ux-audit /path/to/my-project --severity-min P0
```

## Prerequisites

1. Frontend and backend servers must be running
2. `.claude-project/routes.yaml` must exist
3. Database should be seeded with test data

## What It Does

1. Loads the UX scanner skill: `.claude/skills/qa/scan-ux/SKILL.md`
2. Reads route manifest and heuristic checklist
3. Spawns parallel ux-scanner-agents (one per route)
4. Each agent runs 10-category browser + source checks
5. Generates issue files: `.claude-project/ux_issues/UX-{NNN}.md`
6. Generates summary: `.claude-project/status/{project}/UX_QA_SUMMARY.md`

## Output

After completion:
- Individual issues in `.claude-project/ux_issues/`
- Summary report in `.claude-project/status/{project}/UX_QA_SUMMARY.md`
- Screenshots in `.claude-project/qa/ux-scanner/`

## Categories

| ID | Name | Checks |
|----|------|--------|
| `fake-data` | Hardcoded / Mock Data | FD-01 ~ FD-05 |
| `dead-ui` | Dead / Stub UI Elements | DU-01 ~ DU-06 |
| `text-quality` | Text Quality, i18n & Copy | TQ-01 ~ TQ-11 |
| `accessibility` | Accessibility (WCAG 2.2) | A11Y-01 ~ A11Y-08 |
| `session-auth` | Session / Auth Race Conditions | SA-01 ~ SA-04 |
| `security` | Security Surface | SEC-01 ~ SEC-05 |
| `data-consistency` | Data Integrity | DC-01 ~ DC-04 |
| `missing-features` | Missing / Stub Features | MF-01 ~ MF-04 |
| `ui-polish` | UI Polish & Feedback | UP-01 ~ UP-06 |
| `real-time` | Real-time / WebSocket | RT-01 ~ RT-03 |

## Difference from Pipeline Execution

When run standalone (`/ux-audit`):
- Does NOT feed results to bug-feedback-loop or learn-bugs
- Does NOT affect gate scoring
- Summary is still generated for review

When run in pipeline (Phase 9e):
- Results feed into bug-feedback-loop (P0/P1 → RCA → missing stories)
- Results feed into learn-bugs --global (all → pattern library)
- ux_scanner_health score contributes to gate (0.15 weight)
