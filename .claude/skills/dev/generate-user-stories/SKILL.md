---
skill_name: generate-user-stories
applies_to_local_project_only: false
auto_trigger_regex: [user stories, user story, acceptance stories, generate stories, qa stories, yaml stories]
tags: [qa, user-stories, acceptance, testing, playwright, multi-agent]
related_skills: [generate-prd, deepen-user-stories, bug-feedback-loop, learn-bugs]
description: Multi-agent tiki-taka user story generation. 5 specialist writers + synthesizer + QA produce comprehensive YAML stories covering tiers 1-14 for acceptance testing.
allowed-tools: Agent, Read, Write, Edit, Glob, Grep, Bash(mkdir *)
---

# Generate User Stories v2 — Tiki-Taka Multi-Agent

Multi-agent workflow: 5 parallel writers → cross-review → enhance → synthesize → QA

## Key Principles
1. **Specialist writers**: Each agent covers specific tiers, preventing overlap
2. **Cross-review**: Agents review each other's work from their expert perspective
3. **Normalized intermediates**: Agents receive structured data, not raw PRD
4. **Machine QA**: 7 rules, no subjective judgment
5. **3-layer learning**: Global bug patterns + agent-specific learnings + gap patterns

## Agent Configuration

| Agent | Model | Role | Tiers |
|-------|-------|------|-------|
| happy-path-writer | sonnet | Normal flow stories (smoke, CRUD, form submit, navigation) | 1, 2, 5, 8 |
| validation-writer | sonnet | Validation + error state stories | 3, 7, 11 |
| edge-case-writer | sonnet | Boundary, auth violation, state-dependent | 4, 6, 9, 10, 12 |
| accessibility-writer | sonnet | Keyboard, accessibility, responsive | 13 |
| bug-pattern-writer | sonnet | Known bug pattern prevention stories | 14 |
| story-synthesizer | opus | Integration, dedup, cross-reference, consistency audit | — |
| story-qa | sonnet | Machine verification (format, coverage, duplicates, workflow validity) | — |
| story-support | sonnet | Fix QA FAIL items (max 3 rounds) | — |

## Workflow (8 Phases)

### Phase 1: Input Validation + Intermediate Artifact Generation

```
1. Validate prerequisites:
   - PRD file exists: .claude-project/prd/*.md
   - Routes manifest exists: .claude-project/routes.yaml
   - Page components exist: $FRONTEND/src/pages/**/*.tsx (WARN if missing — fallback to HTML prototypes)

2. Create output directories:
   mkdir -p .claude-project/user_stories/{project}/intermediate
   mkdir -p .claude-project/user_stories/{project}/drafts
   mkdir -p .claude-project/user_stories/{project}/reviews

3. Generate 6 intermediate artifacts in .claude-project/user_stories/{project}/intermediate/:

   a) route-inventory.md
      - Full route list from routes.yaml
      - Auth classification per route
      - Mapped page component file paths

   b) ui-element-map.md
      - For each route: forms, buttons, inputs, filters, modals, tabs
      - Extracted from $FRONTEND/src/pages/**/*.tsx (preferred)
      - If TSX not available: extract from .claude-project/design/variations/**/*.html
      - Data hooks (useQuery/useMutation) with error handling

   c) feature-story-map.md
      - PRD feature → required story type mapping
      - Each PRD feature bullet gets at least 1 story target
      - Maps which tier(s) each feature needs

   d) bug-patterns-filtered.md
      - Read skills/qa/learn-bugs/references/bug-patterns-global.yaml
      - Read .claude-project/knowledge/bug-patterns.yaml (optional)
      - Merge (project overrides global)
      - Filter: frequency >= 3 only
      - Match categories to routes using code_signals

   e) fixtures-summary.md
      - Read .claude-project/user_stories/_fixtures.yaml
      - Summarize available test data: users, products, etc.
      - Read seeders if fixtures missing

   f) prd-failure-cases.md
      - Read PRD_chunk_*.md (already in context) and extract ALL failure scenarios from the PRD
      - Use the EXACT section headers below (required for deepen-user-stories Phase 0.3 tier mapping):

        ## Permission / Auth Failures
        - Role restrictions, access denied, 401/403, login-required scenarios
        - Module-specific: SSO failures, RBAC privilege escalation attempts

        ## Validation / Input Failures
        - Field constraints, format errors, missing required fields, 400 responses
        - Module-specific: email format, password rules, date ranges, phone number format

        ## Duplicate / Conflict Failures
        - Unique violations, already exists, 409 responses
        - Module-specific: duplicate registration, re-creation after soft-delete

        ## Limit / Boundary Conditions
        - max/min limits, file sizes, count restrictions — MUST include specific values from PRD
          (e.g., "max 10MB", "max 10 items", "account locked after 5 failures", "within 100 characters")
        - Module-specific: billing plan limits, upload size/type restrictions, rate-limit 429/quota

        ## Empty / Not Found States
        - No data, 404, no search results, empty lists

        ## Error Response Definitions
        - 500 server errors, network failures, timeout
        - Module-specific: payment failures, realtime connection drops

      - Output: .claude-project/context/prd-failure-cases.md
      - Purpose: injected into edge-case-writer and validation-writer to ensure PRD failure scenarios are covered

4. Load agent learnings:
   For each agent, read:
   skills/dev/generate-user-stories/references/agent-learnings/{agent}.yaml
   Append learnings to agent prompt context
```

### Phase 2: Round 1 — 5 Agents Draft in Parallel

```
Launch 5 agents in parallel, each with:
- Common: route-inventory.md + fixtures-summary.md
- Agent-specific context (see Context Distribution below)
- Agent-specific learnings from agent-learnings/{agent}.yaml
- Prompt from references/prompt-templates.md
- Story schema from references/story-schema.yaml

Output: drafts/{agent}-stories.yaml

Each agent MUST:
- Only generate stories for their assigned tiers
- Use canonical workflow verbs
- Use real data from fixtures
- Set auth field correctly per route classification
- Never include login steps in workflows
```

### Phase 3: Round 2 — Scoped Cross-Review (Parallel)

```
Each agent reviews OTHER agents' stories from their expert perspective:

happy-path-writer:
  Reviews all stories for missing normal-flow prerequisites
  "This edge case story assumes user is on cart page, but no happy-path story navigates there"

validation-writer:
  Reviews all stories for missing validation checks
  "This CRUD story submits a form but doesn't test empty field submission"

edge-case-writer:
  Reviews all stories for missing boundary/edge cases
  "This pagination story doesn't test beyond-last-page"

bug-pattern-writer:
  Reviews all stories against known bug patterns
  "No story covers session expiry on this auth-required route"

Output: reviews/{agent}-review.md
Format: list of {target_agent, story_name, gap_description, suggested_addition}
```

### Phase 4: Round 3 — Feedback Enhancement (Parallel)

```
Each agent that received feedback:
1. Read their review file: reviews/{agent}-review.md (reviews targeting them)
2. Add/modify stories to address valid feedback
3. Write enhanced draft: drafts/{agent}-stories-enhanced.yaml

Only agents with feedback run. Others skip this phase.
```

### Phase 5: Synthesis — story-synthesizer (opus)

```
Read all enhanced drafts (or original drafts if no enhancement):
  drafts/happy-path-writer-stories[-enhanced].yaml
  drafts/validation-writer-stories[-enhanced].yaml
  drafts/edge-case-writer-stories[-enhanced].yaml
  drafts/accessibility-writer-stories[-enhanced].yaml
  drafts/bug-pattern-writer-stories[-enhanced].yaml

Integrate into per-route YAML files:
1. Group stories by route/page
2. Dedup: merge stories with >80% workflow similarity
3. Standardize workflow verbs to canonical set
4. Cross-reference: ensure story names are unique
5. Verify feature-story-map coverage: every PRD feature has ≥1 story
6. Generate _fixtures.yaml if not exists

Output: .claude-project/user_stories/{page}.yaml (one file per page/route group)
```

### Phase 6: QA — story-qa (Machine Verification)

```
Read all generated story files + route-inventory.md

Run 7 rules (see references/validation-rules.md):
1. Route coverage: every route in routes.yaml has ≥1 story
2. Dedup check: no duplicate story names
3. YAML format: required fields present (name, tags, url, workflow)
4. Workflow verbs: only canonical verbs used
5. Tier balance: each route has applicable tiers covered (≥1 story per applicable tier)
6. PRD traceability: every PRD feature-map entry has matching story
7. Fixture reference: stories reference test data that exists in _fixtures.yaml

Output: qa-report.md with PASS/FAIL per rule + specific failures

IF any FAIL:
  → story-support agent fixes (max 3 rounds)
  → Re-run QA after each fix round
  → After 3 rounds: accept remaining failures with warnings
```

### Phase 7: Coverage Report

```
Generate .claude-project/status/{project}/STORY_COVERAGE.md:
- Total stories count
- Per-route tier coverage matrix (T1-T14)
- Gap score and depth score
- Agent contribution summary
```

### Phase 8: Delivery

```
Report:
## User Story Generation Complete (v2)

### Output
- Story files: .claude-project/user_stories/*.yaml
- Total stories: {N} across {M} routes
- Tier coverage: T1-T14

### Agent Contributions
| Agent | Stories | Tiers |
|-------|---------|-------|
| happy-path-writer | {N} | 1,2,5,8 |
| validation-writer | {N} | 3,7,11 |
| edge-case-writer | {N} | 4,6,9,10,12 |
| accessibility-writer | {N} | 13 |
| bug-pattern-writer | {N} | 14 |

### QA Results
- Rules passed: {N}/7
- Warnings: {list}

### Next Steps
1. Run `deepen-user-stories` for post-code depth enrichment (Phase 9b)
2. Stories consumed by playwright-qa-agent in Phase 9 (test-browser)
```

## Context Distribution

```
All agents common:     route-inventory.md + fixtures-summary.md
happy-path-writer:    + feature-story-map.md + ui-element-map.md
validation-writer:    + ui-element-map.md (form/input focus) + prd-failure-cases.md (validation/boundary sections)
edge-case-writer:     + ui-element-map.md (boundary/state focus) + prd-failure-cases.md (ALL sections)
accessibility-writer: + ui-element-map.md (keyboard/a11y focus)
bug-pattern-writer:   + bug-patterns-filtered.md + ui-element-map.md
story-synthesizer:    + all drafts + feature-story-map.md
story-qa:             + route-inventory.md + integrated stories
```

**prd-failure-cases.md injection rules:**
- `edge-case-writer`: receives ALL sections (auth, validation, boundary, empty_state, conflict)
  → generates Tier 4/6/9/10/12 stories for each failure scenario not already in happy-path drafts
- `validation-writer`: receives validation + boundary sections only
  → generates Tier 3/7/11 stories for each validation/boundary failure not already covered

## Output Format

Same YAML format as v1:
```yaml
stories:
  - name: "Human-readable story name"
    url: "http://localhost:5173/{route}"
    auth: none|user|admin
    tags: [smoke, interaction, validation, ...]
    workflow: |
      Navigate to /{route}
      Verify [element] is visible
      [steps...]
```

## Workflow Language

Use ONLY canonical verbs from references/prompt-templates.md.

**Actions:**
- Navigate to {path}
- Fill {field} with "{value}"
- Click {element}
- Wait for {condition}
- Scroll to {element}
- Press Enter in {field}
- Press Tab to focus {field}
- Select "{value}" from {dropdown}
- Scroll {element} left/right

**Assertions:**
- Verify {element} is visible
- Verify text "{text}" appears
- Verify URL is {path}
- Verify {element} is not visible
- Verify console has no errors
- Verify {element} has value "{value}"
- Verify {element} is disabled / is enabled
- Verify URL contains "{substring}"
- Count {elements} and verify between {min} and {max}
- Verify network request to "{url}" succeeded

**Forbidden:**
- Login steps in workflow (use auth field)
- Synonyms for canonical verbs
- Conditional if/else logic

## Tier Taxonomy (1-14)

| Tier | Name | Tags | Writer |
|------|------|------|--------|
| 1 | Smoke | [smoke] | happy-path |
| 2 | Form Submission | [interaction, form] | happy-path |
| 3 | Form Validation | [validation, form] | validation |
| 4 | Search & Filter | [interaction, filter] | edge-case |
| 5 | CRUD Operations | [interaction, crud] | happy-path |
| 6 | Pagination | [interaction, pagination] | edge-case |
| 7 | Empty & Error States | [validation, state] | validation |
| 8 | Cross-Page Flows | [navigation, flow] | happy-path |
| 9 | Boundary Conditions | [negative, boundary] | edge-case |
| 10 | Auth Role Boundary | [negative, auth] | edge-case |
| 11 | Network/API Errors | [negative, network] | validation |
| 12 | State-Dependent | [state, dependent] | edge-case |
| 13 | Keyboard Interaction | [accessibility, keyboard] | accessibility |
| 14 | Known Bug Patterns | [proactive, bug-pattern] | bug-pattern |

## Error Handling

| Error | Action |
|-------|--------|
| No PRD file | FAIL — run /generate-prd first |
| No routes.yaml | FAIL — run project-init first |
| No page components | WARN — generate stories from PRD only (limited depth) |
| Agent timeout | Use partial results, log warning |
| QA fails after 3 rounds | Accept with warnings, report remaining failures |

## Related

- **v1 (deprecated)**: skills/dev/generate-user-stories/SKILL.md
- **Depth enrichment**: skills/dev/deepen-user-stories/SKILL.md (post-code, Phase 9b)
- **Bug patterns**: skills/qa/learn-bugs/references/bug-patterns-global.yaml
- **Feedback loop**: skills/qa/run-feedback-loop/SKILL.md
- **Consumer**: Phase 9 test-browser via playwright-qa-agent
- **Pipeline**: pipeline/phases/03.5-user-stories.md
