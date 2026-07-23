---
skill_name: bug-feedback-loop
applies_to_local_project_only: false
auto_trigger_regex: [report bug, bug report, missed story, missing story, story gap, manual testing bug]
tags: [qa, user-stories, feedback, rca, self-improving]
related_skills: [generate-user-stories, deepen-user-stories, acceptance-test, learn-bugs]
description: Root cause analysis for bugs not covered by user stories. Generates missing stories, archives analysis, and accumulates gap patterns that improve future story generation.
---

# Bug Feedback Loop

Closed-loop self-improvement system for user story generation. When a manually-found bug has no user story coverage, this skill performs root cause analysis against the `generate-user-stories` multi-agent system, generates the missing story, archives a reusable gap pattern, and updates per-agent learnings so the responsible agent improves in future runs.

```
Report → RCA → Generate Story → Extract Pattern → Agent Learning → Archive
                                      ↓                    ↓
                        _gap_patterns.yaml    agent-learnings/{agent}.yaml
                              ↓                    ↓
             generate-user-stories reads on next run
```

---

## When to Use

- After manual testing reveals a bug that no user story covers
- After acceptance tests find a failure tracing to a completely missing scenario
- When reviewing QA reports and finding untested behaviors
- Via `/report-bug` command (primary entry point)

---

## Prerequisites

1. User story files exist: `.claude-project/user_stories/*.yaml`
2. PRD exists: `.claude-project/prd/*.md`
3. Routes manifest exists: `.claude-project/routes.yaml`

---

## Inputs

| Input | Path | Purpose |
|-------|------|---------|
| Bug Description | User-provided (via command args or interactive) | What happened |
| PRD | `.claude-project/prd/*.md` | Check if behavior is specified |
| Routes | `.claude-project/routes.yaml` | Check if route exists |
| Page Components | `frontend/app/pages/**/*.tsx` or `frontend-admin-dashboard/src/pages/**/*.tsx` | Check if element exists in code |
| Existing Stories | `.claude-project/user_stories/*.yaml` | Find closest existing coverage |
| Fixtures | `.claude-project/user_stories/_fixtures.yaml` | Check if test data supports scenario |
| Gap Patterns | `.claude-project/bug_reports/_gap_patterns.yaml` | Avoid duplicate pattern extraction |
| Seed | `.claude-project/status/{project}/seed-*.yaml` | Check acceptance criteria |

---

## Outputs

| Output | Path | Purpose |
|--------|------|---------|
| Bug Report | `.claude-project/bug_reports/BUG-{NNN}.yaml` | Structured report with RCA + reward attribution |
| Missing Story | Appended to `.claude-project/user_stories/{file}.yaml` | The story that should have existed |
| Gap Pattern | Appended to `.claude-project/bug_reports/_gap_patterns.yaml` | Reusable learning for future runs |
| RCA History | Appended to `.claude-project/bug_reports/_rca_history.md` | Chronological analysis archive |

---

## Root Cause Categories

| Category | Meaning | Actionable By |
|----------|---------|---------------|
| `prd_gap` | PRD doesn't mention this behavior | PRD update (manual) |
| `route_gap` | Route not in routes.yaml | routes.yaml update (manual) |
| `component_analysis_gap` | Element in .tsx but Phase 1 intermediate generation missed it | Extend Phase 1 extraction + agent learnings |
| `pattern_gap` | Interaction type not recognized by assigned writer agent | Add to agent learnings + prompt templates |
| `tier_coverage_gap` | Scenario doesn't fit any of 14 tiers | Propose new tier (15+) |
| `test_data_gap` | _fixtures.yaml lacks data to trigger scenario | Update fixtures |
| `edge_case` | Genuine edge case, no systematic detection possible | Informational only |
| `cross_component_gap` | Bug spans multiple components not tested together | Add to cross-page flows |

---

## Reward Attribution

Each bug report includes RL reward attribution fields used by the infinite loop engine for learning. These fields are populated during RCA (Step 2) and recorded in the bug report YAML.

### Additional Bug Report Fields

```yaml
# RL Reward Attribution (added to BUG-{NNN}.yaml)
reward_attribution:
  detection_phase: string      # Phase where bug was actually found (e.g., "test-browser")
  origin_phase: string         # Phase where bug was introduced (via RCA, e.g., "backend")
  should_have_caught_phase: string  # Earliest phase that should have caught this (e.g., "backend")
  escaped: false               # true if found in production (post-ship)
  shift_left_multiplier: float # From reward.yaml: multiplier for detection_phase
  severity_weight: int         # From reward.yaml: severity_weights[severity]
  reward_impact: float         # shift_left_multiplier × severity_weight
  late_bug_penalty: float      # If detection_phase > should_have_caught_phase: penalty amount
```

### How to Populate

During Step 2 (RCA):
1. `detection_phase` = the phase currently running when bug was found (from PIPELINE_STATUS.md current phase)
2. `origin_phase` = determined by RCA root cause analysis (where the bug-introducing code was written)
3. `should_have_caught_phase` = the earliest phase with testing coverage for this bug type:
   - `prd_gap` → should_have_caught = "prd"
   - `route_gap` → should_have_caught = "prd"
   - `component_analysis_gap` → should_have_caught = "frontend"
   - `pattern_gap` → should_have_caught = "backend" or "frontend" (depends on bug location)
   - `tier_coverage_gap` → should_have_caught = "user_stories"
   - `test_data_gap` → should_have_caught = "test_api" or "test_browser"
   - `cross_component_gap` → should_have_caught = "integrate"
4. `shift_left_multiplier` = read from `.claude/pipeline/loop/reward.yaml` → phase_reward.shift_left_multiplier[detection_phase]
5. `severity_weight` = read from `.claude/pipeline/loop/reward.yaml` → generation_reward.severity_weights[severity]
6. `reward_impact` = shift_left_multiplier × severity_weight
7. `late_bug_penalty` = if detection_phase comes after should_have_caught_phase in pipeline order:
   penalty = |severity_weight| × reward.yaml.phase_reward.late_bug_penalty_multiplier
   Else: 0

### Production Escape Detection

If a bug is reported with `escaped: true` (found in production after Phase 10 ship):
1. Set `shift_left_multiplier = -50.0` (catastrophic, from reward.yaml)
2. Set `reward_impact = -50.0 × severity_weight` (e.g., P0 escape = -500)
3. After completing normal RCA steps, also:
   a. Append escape event to `.claude-project/policy-memory.yaml`
   b. Append prevention strategy to `.claude/pipeline/loop/policy-memory-global.yaml` → production_escapes[]
   c. Log: "PRODUCTION ESCAPE: {summary} — reward impact: {reward_impact}"

---

## Algorithm

### Step 1: Intake

```
1. Parse user-provided bug description.
   Required fields:
     - summary: What happened (one sentence)
     - page: Which route (e.g., "/cart", "/products/{id}")
     - app: Which app (frontend | frontend-admin-dashboard)
     - steps_to_reproduce: Numbered steps to reproduce
     - expected: What should have happened
     - actual: What actually happened
     - severity: P0 (crash) | P1 (wrong behavior) | P2 (cosmetic) | P3 (minor)

   If any required field is missing or ambiguous, use AskUserQuestion to clarify.
   For the page field, show the list of routes from routes.yaml for selection.

2. Generate bug ID:
     Read existing .claude-project/bug_reports/BUG-*.yaml via Glob
     Next ID = max(existing IDs) + 1, zero-padded to 3 digits
     If no existing reports: ID = BUG-001

3. Create bug_reports directory if it doesn't exist:
     mkdir -p .claude-project/bug_reports/

4. Write initial bug report file:
     Path: .claude-project/bug_reports/BUG-{NNN}.yaml
     Status: open
     RCA fields: null (filled in Step 2)
     Generated story fields: null (filled in Step 3)
     Gap pattern fields: null (filled in Step 4)
```

### Step 2: Root Cause Analysis

Trace through the `generate-user-stories` multi-agent system to find exactly where the scenario should have been caught.

**Agent → Tier Responsibility Map** (used to identify which agent missed):

| Agent | Responsible Tiers |
|-------|-------------------|
| happy-path-writer | 1 (Smoke), 2 (Form Submit), 5 (CRUD), 8 (Cross-Page) |
| validation-writer | 3 (Form Validation), 7 (Empty/Error States), 11 (Network Errors) |
| edge-case-writer | 4 (Search/Filter), 6 (Pagination), 9 (Boundary), 10 (Auth), 12 (State) |
| accessibility-writer | 13 (Keyboard) |
| bug-pattern-writer | 14 (Known Bug Patterns) |
| story-synthesizer | Dedup/integration errors |
| story-qa | QA rule gaps |

```
2.1: CHECK PRD COVERAGE
     Read .claude-project/prd/*.md
     Search for mentions of the reported behavior, element, or interaction.
     Use keyword search: extract key nouns/verbs from bug summary and
     steps_to_reproduce, search PRD for each.

     IF behavior found in PRD:
       Record: rca.evidence.prd_mentions = "{relevant PRD excerpt}"
       Note: "PRD covers this — generation algorithm should have caught it"
     ELSE:
       Record: rca.evidence.prd_mentions = "not mentioned"
       Record: rca.root_cause_category = "prd_gap"
       Record: rca.explanation = "PRD does not describe this behavior.
         generate-user-stories cannot create stories for undocumented features."
     CONTINUE to 2.2 (always check all sources for complete evidence)

2.2: CHECK ROUTE COVERAGE
     Read .claude-project/routes.yaml
     Find the route matching the bug's page path.

     IF route exists:
       Record: rca.evidence.route_exists = true
     ELSE:
       Record: rca.evidence.route_exists = false
       IF rca.root_cause_category is null:
         Record: rca.root_cause_category = "route_gap"
         Record: rca.algorithm_step_missed = "Step 2"
         Record: rca.explanation = "Route {path} is not in routes.yaml.
           generate-user-stories Step 2 cannot extract features for
           unlisted routes."
     CONTINUE to 2.3

2.3: CHECK COMPONENT ANALYSIS (maps to generate-user-stories Phase 1 ui-element-map)
     Resolve page component .tsx file for this route.
     For frontend: frontend/app/pages/**/*.tsx
     For admin portal: frontend-admin-dashboard/src/pages/**/*.tsx

     Read the component source and search for the specific element or
     interaction described in the bug report.

     IF element found in component:
       Record: rca.evidence.component_has_element =
         "{element} found at {file}:{line}"

       Check if element fits the Phase 1 ui-element-map extraction categories:
         Forms, Action Buttons, Filter & Search, List & Table,
         Modal & Dialog, API Hooks, Navigation

       IF element fits a category but was likely missed in extraction:
         IF rca.root_cause_category is null:
           Record: rca.root_cause_category = "component_analysis_gap"
           Record: rca.algorithm_step_missed = "Phase 1 (ui-element-map)"
           Record: rca.explanation = "Element exists in {file}:{line}
             but Phase 1 ui-element-map extraction likely missed it because
             {reason — e.g., it's in a conditional branch, a child component,
             a dynamically rendered element, or uses an uncommon pattern}."
     ELSE:
       Record: rca.evidence.component_has_element = "not found in page component"
     CONTINUE to 2.4

2.4: CHECK AGENT COVERAGE (maps to generate-user-stories Phase 2 agents)
     Determine which agent should have generated a story for this bug:
       - Use Agent → Tier Responsibility Map (above)
       - Match bug scenario to applicable tier
       - Identify the responsible agent

     Record: rca.agent_missed = "{agent-name}" (e.g., "validation-writer")
     Record: rca.agent_tier_responsible = {tier_number}

     IF the agent received correct context (ui-element-map, feature-story-map)
     but still didn't generate the story:
       IF rca.root_cause_category is null:
         Record: rca.root_cause_category = "pattern_gap"
         Record: rca.algorithm_step_missed = "Phase 2 ({agent_missed})"
         Record: rca.explanation = "{agent_missed} had the necessary context
           but did not generate a story for {element/interaction}.
           Agent prompt template needs a new rule for this scenario."

     IF the agent didn't receive the right context (element missing from intermediates):
       IF rca.root_cause_category is null:
         Record: rca.root_cause_category = "component_analysis_gap"
         Record: rca.algorithm_step_missed = "Phase 1 (intermediate generation)"
         Record: rca.explanation = "Phase 1 intermediate artifacts did not
           capture {element} from {file}:{line}, so {agent_missed} never
           received context to generate this story."
     CONTINUE to 2.5

2.5: CHECK TIER COVERAGE (maps to generate-user-stories tier taxonomy)
     Determine which tier(s) should cover this bug scenario:

     Tier mapping:
       Page load → Tier 1 (smoke)
       Form submission → Tier 2
       Validation error → Tier 3
       Search/filter → Tier 4
       CRUD action → Tier 5
       Pagination → Tier 6
       Empty/error state → Tier 7
       Multi-page flow → Tier 8
       Boundary condition → Tier 9
       Wrong role access → Tier 10
       API error handling → Tier 11
       State-dependent → Tier 12
       Keyboard interaction → Tier 13
       Known bug pattern → Tier 14
       None of the above → tier_coverage_gap

     Record: rca.evidence.tier_applicable = {tier_number or "none"}

     IF bug doesn't fit any tier:
       IF rca.root_cause_category is null:
         Record: rca.root_cause_category = "tier_coverage_gap"
         Record: rca.algorithm_step_missed = "Step 4 (tier taxonomy)"
         Record: rca.explanation = "This scenario type ({description})
           does not map to any of the 14 defined tiers. A new tier
           is needed: Tier {N}: {proposed_tier_name}."
     CONTINUE to 2.6

2.6: CHECK EXISTING STORIES
     Read the user story file for this route (.claude-project/user_stories/{slug}.yaml)
     Find stories closest to covering this bug.

     For each story in the file:
       Score relevance: does it test the same element? Same interaction type?
       Same page area? Similar workflow?

     Record: rca.evidence.existing_stories = [
       { name: "{story_name}", why_insufficient: "{explanation}" }
     ]

     IF a story exists that SHOULD cover this but has wrong assertions:
       Record: rca.fix_classification = "story_wrong"
     ELSE:
       Record: rca.fix_classification = "story_missing"
     CONTINUE to 2.7

2.7: CHECK TEST DATA
     Read .claude-project/user_stories/_fixtures.yaml
     Determine if reproducing the bug requires specific test data.

     IF scenario requires data not in fixtures:
       IF rca.root_cause_category is null:
         Record: rca.root_cause_category = "test_data_gap"
         Record: rca.algorithm_step_missed = "Step 0 (fixtures)"
         Record: rca.explanation = "Reproducing this bug requires
           {data_description} which is not in _fixtures.yaml."
     CONTINUE to 2.8

2.8: FINALIZE ROOT CAUSE
     IF rca.root_cause_category is still null:
       IF bug spans multiple pages or components:
         Record: rca.root_cause_category = "cross_component_gap"
         Record: rca.algorithm_step_missed = "Step 3c (cross-page flows)"
         Record: rca.explanation = "Bug involves interaction between
           {page_A} and {page_B} that is not covered by cross-page-flows.yaml."
       ELSE:
         Record: rca.root_cause_category = "edge_case"
         Record: rca.algorithm_step_missed = "N/A"
         Record: rca.explanation = "This is a genuine edge case that
           no systematic detection in the current algorithm would catch.
           {specific_reason}."

     Update bug report status: open → analyzed
     Write updated BUG-{NNN}.yaml

2.9: CLASSIFY ROOT ORIGIN
     Determine whether the bug was missed due to story generation or test execution.

     root_origin has two possible values:
       - "story-generation": No user story was generated to cover this scenario.
         The generate-user-stories algorithm missed it entirely.
       - "test-browser": A user story exists (or closely covers this scenario)
         but the test-browser phase failed to catch the bug during Playwright execution.

     Classification logic:

     IF rca.fix_classification == "story_missing":
       Check existing_stories evidence from Step 2.6:
         IF no story covers the same page + element + interaction:
           root_origin = "story-generation"
           root_origin_detail = "No story was generated for this scenario.
             The generate-user-stories algorithm did not produce coverage
             for {element/interaction} on {page}."
         ELSE IF a story covers the same page but different element/interaction:
           root_origin = "story-generation"
           root_origin_detail = "Stories exist for {page} but none target
             {element/interaction}. The algorithm generated stories for
             nearby features but missed this specific scenario."

     ELSE IF rca.fix_classification == "story_wrong":
       root_origin = "test-browser"
       Analyze WHY the existing story failed to catch the bug:

       Check for these test-browser failure modes:
         a) selector_mismatch: Story workflow references an element that
            doesn't match the actual DOM selector (wrong text, wrong role,
            wrong test-id)
         b) missing_wait: Story workflow doesn't wait for async state
            (API response, animation, re-render) before asserting
         c) assertion_gap: Story checks the wrong property or is missing
            a critical assertion (e.g., checks visibility but not content)
         d) workflow_incomplete: Story steps don't reach the buggy state
            (missing prerequisite steps, wrong data setup, skipped interaction)
         e) flaky_execution: Test passes sometimes due to timing issues,
            race conditions, or viewport differences

       Record: root_origin_detail = "Story '{story_name}' exists but
         test-browser missed this because: {failure_mode_explanation}"
       Record: root_origin_failure_mode = "{a|b|c|d|e}"

     Record root_origin and root_origin_detail in BUG-{NNN}.yaml
```

### Step 3: Generate Missing Story

```
3.1: Determine target file
     Match bug's route to the file naming convention from generate-user-stories Step 3b:
       /             → home.yaml
       /login        → login.yaml
       /products     → products.yaml
       /cart         → cart.yaml
       /admin/*      → admin-{slug}.yaml
       portal routes → portal-{slug}.yaml
       Multi-page    → cross-page-flows.yaml

     Record: generated_story.file = {filename}

3.2: Convert bug steps to canonical workflow
     Transform the user's steps_to_reproduce into canonical workflow verbs:

     Input verbs → Canonical verbs:
       "Go to", "Open", "Visit" → "Navigate to {path}"
       "Type", "Enter text", "Input" → "Fill {field} with \"{value}\""
       "Click", "Press", "Tap" → "Click {element}"
       "Wait", "Loading" → "Wait for {condition}"
       "Scroll" → "Scroll to {element}"
       "See", "Check", "Should show" → "Verify {element} is visible"
       "Text says", "Shows text" → "Verify text \"{text}\" appears"
       "URL should be" → "Verify URL is {path}"
       "Not visible", "Disappears" → "Verify {element} is not visible"

     Determine auth level from route classification in routes.yaml:
       public → auth: none
       auth_required → auth: user
       admin_required → auth: admin

     Determine tags from rca.evidence.tier_applicable:
       Use the tag pattern for that tier (e.g., Tier 3 → [validation, form])
       Add: bug-report

     Determine URL base:
       frontend → http://localhost:5173
       frontend-admin-dashboard → http://localhost:5177

     Use real data from _fixtures.yaml where applicable (product names,
     user credentials, shop names, etc.)

     Build story name: Descriptive present tense (e.g.,
       "Cart quantity decrease button prevents going below 1")

     Record: generated_story.story = {complete YAML story block}

3.3: Append story to target file
     Read the target .yaml file.
     Append with BUG FIX marker:

     # === BUG FIX: BUG-{NNN} ({root_cause_category}) ===
     # reported: {date}, RCA: {algorithm_step_missed}
     # description: {summary}

       - name: "{story_name}"
         url: "{base_url}{route}"
         auth: {auth}
         tags: [{tags}]
         workflow: |
           {workflow steps}

     Update bug report status: analyzed → story_generated

     ──── STORY-FIRST GATE ────────────────────────────────────
     VERIFY: The story YAML has been written to disk.
     Read the target file and confirm the BUG FIX marker exists.
     Step 4.5.4 (Code Fix) MUST NOT begin until this gate passes.
     This ensures: Bug → Story recorded → THEN code fix.
     ──────────────────────────────────────────────────────────
```

### Step 4: Extract Gap Pattern

```
4.1: Check for duplicate patterns
     Read .claude-project/bug_reports/_gap_patterns.yaml (if exists)
     Compare this bug's root_cause_category + description against existing patterns.

     Similarity check: same category AND description matches > 70% keywords.

     IF similar pattern already exists:
       Increment occurrence_count
       Add BUG-{NNN} to instances list
       Update last_updated timestamp
       SKIP creating new pattern → go to Step 5

4.2: Create gap pattern entry
     Generate pattern ID: GP-{NNN} (next sequential after existing)

     Build detection_rule based on root_cause_category:

     For prd_gap:
       detection_rule: "Structural gap — PRD must be updated to include
         {behavior_description}. No automated detection possible until PRD
         is amended."

     For route_gap:
       detection_rule: "Add route {path} ({name}) to .claude-project/routes.yaml
         under {section} section."

     For component_analysis_gap:
       detection_rule: "In Step 2.5, extend {category} extraction to also
         detect {code_pattern}. Look for: {specific_code_signatures}.
         When found, catalog as: {element_type} with properties: {props}."

     For pattern_gap:
       detection_rule: "Add pattern '{pattern_name}' to Step 2.1:
         Trigger phrases: [{trigger_phrases}]
         Story template:
           {workflow_template_using_canonical_verbs}"

     For tier_coverage_gap:
       detection_rule: "Propose Tier {N}: {tier_name}
         Applicable when: {condition}
         Tags: [{tags}]
         Template:
           {story_template}"

     For test_data_gap:
       detection_rule: "Add to _fixtures.yaml under {section}:
         {data_structure_needed}"

     For cross_component_gap:
       detection_rule: "Add cross-page flow to Step 3c:
         {page_A} → {page_B}: {interaction_description}
         Generate Tier 8 story for this flow."

     For edge_case:
       detection_rule: "Manual review recommended. Consider adding to
         Tier {closest_tier} examples if this scenario recurs.
         Scenario: {description}."

     Build complete pattern entry:
       id: GP-{NNN}
       category: {root_cause_category}
       description: "{concise description of the gap}"
       detection_rule: "{from above}"
       applicable_tiers: [{tier_numbers}]
       first_reported: "{date}"
       instances: [BUG-{NNN}]
       occurrence_count: 1

4.3: Write gap pattern
     IF _gap_patterns.yaml doesn't exist:
       Create with header:
         version: 1
         last_updated: "{date}"
         total_patterns: 1
         patterns: [{new_pattern}]
         category_distribution: {counts by category}

     ELSE:
       Read existing file
       Append new pattern to patterns list
       Increment total_patterns
       Update last_updated
       Update category_distribution counts

4.4: Check promotion threshold
     IF any pattern has occurrence_count >= 3:
       Add to pattern: promoted: true, promoted_date: "{date}"
       Log: "Pattern {GP-NNN} has {count} occurrences — PROMOTE to
         core algorithm. Detection rule should be permanently added to
         generate-user-stories/references/prompt-templates.md {agent_section}."
```

### Step 4.5: Fix Upstream (MANDATORY)

Patch the actual skill/algorithm file that caused this class of bug so it cannot recur.
This is NOT optional — every bug report MUST attempt an upstream fix.

```
4.5.1: RESOLVE TARGET FILE

  Map root_origin + root_cause_category to the file(s) that need patching.
  v2 uses a 3-target priority system:
    1. agent-learnings/{agent}.yaml → Always add LRN item (L2 learning)
    2. prompt-templates.md → Add rule to agent section (when promoted)
    3. validation-rules.md → Add QA rule (when qa_gap)

  ┌───────────────────────────┬─────────────────────────────────────────────────┐
  │ Root Cause Category       │ Upstream Files → Sections to Patch              │
  ├───────────────────────────┼─────────────────────────────────────────────────┤
  │ prd_gap                   │ MANUAL — log warning, cannot auto-fix           │
  │ route_gap                 │ .claude-project/routes.yaml → add route         │
  │ component_analysis_gap    │ 1. agent-learnings/{agent}.yaml → add LRN item  │
  │   (story-generation)      │ 2. generate-user-stories/references/         │
  │                           │    prompt-templates.md → extend agent section   │
  │ component_analysis_gap    │ 1. agent-learnings/{agent}.yaml → add LRN item  │
  │   (test-browser)          │ 2. deepen-user-stories/SKILL.md → depth tiers   │
  │ pattern_gap               │ 1. agent-learnings/{agent}.yaml → add LRN item  │
  │                           │ 2. generate-user-stories/references/         │
  │                           │    prompt-templates.md → add pattern to agent   │
  │ tier_coverage_gap         │ deepen-user-stories/SKILL.md → tier defs        │
  │                           │   (add new depth tier)                          │
  │ test_data_gap             │ _fixtures.yaml → add test data                  │
  │ cross_component_gap       │ 1. agent-learnings/happy-path.yaml → add LRN    │
  │                           │ 2. prompt-templates.md → cross-page flow rules  │
  │ edge_case                 │ No patch — log "no systematic fix"              │
  └───────────────────────────┴─────────────────────────────────────────────────┘

  For test-browser origin, ALSO patch based on failure_mode:

  ┌───────────────────────────┬─────────────────────────────────────────────────┐
  │ Failure Mode              │ Additional Upstream File → Section              │
  ├───────────────────────────┼─────────────────────────────────────────────────┤
  │ assertion_gap             │ generate-user-stories/references/            │
  │                           │   prompt-templates.md → agent assertion rules   │
  │ selector_mismatch         │ acceptance-test/SKILL.md → Step 5b              │
  │                           │   (add to known-mismatch patterns)              │
  │ missing_wait              │ acceptance-test/SKILL.md → Step 5b              │
  │                           │   (add to known-wait-required patterns)         │
  │ workflow_incomplete        │ agent-learnings/{agent}.yaml → add LRN item   │
  │                           │   (add prerequisite step requirements)          │
  │ flaky_execution           │ acceptance-test/SKILL.md → retry section        │
  │                           │   (add to known-flaky patterns)                 │
  └───────────────────────────┴─────────────────────────────────────────────────┘

4.5.2: APPLY PATCH (3-target priority system)

  **Target 1: Agent Learning (ALWAYS — L2 learning)**
  Read: generate-user-stories/references/agent-learnings/{agent_missed}.yaml
  Append new learning entry:

    - id: LRN-{NNN}
      source: BUG-{NNN}
      missed: "{what the agent should have caught}"
      rule: "{new rule for future generations}"
      date: "{YYYY-MM-DD}"

  Update total_learnings count.

  **Target 2: Prompt Template (when promoted or high-impact)**
  IF occurrence_count >= 3 (pattern promoted) OR severity == P0:
    Read: generate-user-stories/references/prompt-templates.md
    Find the agent's DRAFT mode section.
    Append rule with traceability marker:

    # [BUG-{NNN}] {one-line description}
    {the actual rule addition}

  Examples:
    - For validation-writer:
      # [BUG-002] Sort stories must verify data order changed
      For sort/filter controls, assertions MUST compare item content
      before and after the interaction — visibility-only is insufficient.

    - For happy-path-writer:
      # [BUG-004] Extract ALL form fields including conditional ones
      When generating CRUD stories, include conditional form fields
      ({condition && <input>}) not just top-level fields.

    - For edge-case-writer:
      # [BUG-007] New pattern: Infinite Scroll
      When page has IntersectionObserver or loadMore pattern:
      Template: Scroll to bottom → Wait for new items → Verify count increased

  **Target 3: QA Rule (when story-qa missed the gap)**
  IF rca.agent_missed includes "story-qa":
    Read: generate-user-stories/references/validation-rules.md
    Add supplementary check to the relevant rule.

4.5.3: VERIFY PATCH

  Read the patched file to confirm:
    - Edit was applied in the correct section
    - No syntax or formatting errors introduced
    - No duplicate of an existing rule

  IF patch failed or is not applicable:
    Record: upstream_fix = "skipped — {reason}"
  ELSE:
    Record: upstream_fix = "{file}:{section} — {description}"
    Record: upstream_fix_file = "{file_path}"

4.5.4: FIX APPLICATION CODE (if applicable)

  If the bug is a real code defect (not just a testing/story gap):
    - Trace the bug to the source code file (frontend or backend)
    - Apply the minimal fix needed
    - Record: code_fix_files = [{files changed with descriptions}]
  ELSE:
    Record: code_fix_files = null

4.5.5: VERIFY CODE FIX

  IF code_fix_files is not null (code fix was applied):
    1. Run the story created in Step 3 via playwright-qa-agent
       (the specific BUG FIX story, not all stories)
    2. IF story PASS:
       → Record: fix_verified = true
       → Record: fix_verification_method = "story {story_name} passed"
    3. IF story FAIL:
       → Re-read the failure output
       → Attempt 2nd fix (adjust code based on failure)
       → Re-run the story
       → IF still FAIL after 2 attempts:
         → Record: fix_verified = false
         → Record: needs_manual = true
         → Do NOT block — continue to next bug
         → Log: "BUG-{NNN} fix could not be verified. Needs manual review."

  IF code_fix_files is null:
    → Record: fix_verified = "n/a"
```

### Step 5: Archive

```
5.1: Write RCA History entry
     IF _rca_history.md doesn't exist:
       Create with header:
         # RCA History — Bug Feedback Loop
         # Chronological archive of root cause analyses

     Append:

     ---

     ## BUG-{NNN}: {summary}

     **Reported**: {date} | **Severity**: {severity} | **Status**: {status}
     **Page**: {page} ({app})

     **Root Origin**: `{root_origin}` — {root_origin_detail_summary}
     **Root Cause**: `{root_cause_category}` at `{algorithm_step_missed}`

     **Analysis**: {explanation}

     **Evidence**:
     - PRD: {prd_mentions or "not mentioned"}
     - Route: {route_exists}
     - Component: {component_has_element or "not found"}
     - Closest stories: {list of story names with why_insufficient}
     - Applicable tier: {tier_applicable}

     **Fix**: Story "{story_name}" added to `{file}`
     **Pattern**: `{pattern_id}` — {detection_rule_summary}
     **Upstream Fix**: `{upstream_fix_file}` — {upstream_fix_description}
     IF code_fix_files:
       **Code Fix**: {code_fix_files} — {description}
     **Fix Verified**: {fix_verified} ({fix_verification_method or "n/a"})

5.2: Final bug report update
     Set status: story_generated
     Write complete BUG-{NNN}.yaml with all filled fields
     Include upstream_fix, code_fix_files, fix_verified, and needs_manual fields

5.3: Output summary to user
     Display:
       Bug Report: BUG-{NNN}
       ========================
       Root Origin: {root_origin} ({root_origin_detail_summary})
       Root Cause: {category} at {algorithm_step}
       Explanation: {explanation}

       IF root_origin == "test-browser":
         Failure Mode: {root_origin_failure_mode}
         Existing Story: "{closest_story_name}" — {why_insufficient}

       Upstream Fix Applied:
         → {upstream_fix_file}: {section}
         → Patch: {one-line description}

       IF code_fix_files:
         Code Fix Applied:
           → {code_fix_files}: {description}

       Story Generated: "{story_name}"
         Added to: {file}
         Tags: {tags}

       Gap Pattern: {pattern_id}
         Detection Rule: {detection_rule_summary}

       Files Updated:
         - .claude-project/bug_reports/BUG-{NNN}.yaml
         - .claude-project/user_stories/{file}
         - .claude-project/bug_reports/_gap_patterns.yaml
         - .claude-project/bug_reports/_rca_history.md
         - {upstream_fix_file} (UPSTREAM PATCHED)
         IF code_fix_files:
           - {code_fix_files} (CODE FIXED)
```

---

## Bug Report YAML Schema

```yaml
id: BUG-001
reported: "2026-03-04T14:30:00+09:00"
reporter: manual       # manual | acceptance-test
status: open           # open | analyzed | story_generated | closed

# --- User-Provided ---
summary: "Short description of the bug"
page: "/cart"
app: frontend          # frontend | frontend-admin-dashboard
steps_to_reproduce: |
  1. Step one
  2. Step two
expected: "What should happen"
actual: "What actually happens"
severity: P1           # P0 | P1 | P2 | P3

# --- RCA (filled by Step 2) ---
rca:
  root_cause_category: null
  algorithm_step_missed: null
  agent_missed: null            # Which v2 agent should have caught this (e.g., "validation-writer")
  agent_tier_responsible: null   # Which tier the agent was responsible for
  explanation: null
  evidence:
    prd_mentions: null
    route_exists: null
    component_has_element: null
    existing_stories: []
    tier_applicable: null
  fix_classification: null     # story_missing | story_wrong

# --- Root Origin (filled by Step 2.9) ---
root_origin: null              # story-generation | test-browser
root_origin_detail: null       # Explanation of why this origin was chosen
root_origin_failure_mode: null # Only for test-browser: selector_mismatch | missing_wait | assertion_gap | workflow_incomplete | flaky_execution

# --- Upstream Fix (filled by Step 4.5) ---
upstream_fix: null             # "{file}:{section} — {description}" or "manual" or "skipped"
upstream_fix_file: null        # Path to patched skill file
code_fix_files: []             # Application code files fixed (if any)

# --- Fix Verification (filled by Step 4.5.5) ---
fix_verified: null             # true | false | "n/a"
needs_manual: false            # true if fix could not be verified after 2 attempts
fix_verification_method: null  # "story {story_name} passed" or null

# --- Agent Learning (filled by Step 4.5) ---
agent_learning:
  learning_file: null          # e.g., "agent-learnings/validation.yaml"
  learning_id: null            # e.g., "LRN-001"

# --- Generated Story (filled by Step 3) ---
generated_story:
  file: null
  story: null

# --- Gap Pattern (filled by Step 4) ---
gap_pattern:
  pattern_id: null
  category: null
  description: null
  detection_rule: null
  applicable_tiers: []
```

---

## Gap Patterns YAML Schema

```yaml
version: 1
last_updated: "2026-03-04"
total_patterns: 0

patterns:
  - id: GP-001
    category: component_analysis_gap
    description: "Concise description of what was missed"
    detection_rule: |
      Prescriptive rule telling generate-user-stories HOW to detect
      this in future runs. Must reference specific algorithm steps
      and provide actionable detection logic.
    applicable_tiers: [2, 5]
    first_reported: "2026-03-04"
    instances: [BUG-001]
    occurrence_count: 1
    root_origins: [story-generation]  # tracks which origins triggered this pattern
    promoted: false            # true when occurrence_count >= 3

category_distribution:
  prd_gap: 0
  route_gap: 0
  component_analysis_gap: 0
  tier_coverage_gap: 0
  pattern_gap: 0
  test_data_gap: 0
  edge_case: 0
  cross_component_gap: 0
```

---

## Iteration Behavior

### First Bug Report
- Creates `.claude-project/bug_reports/` directory
- Creates `BUG-001.yaml`, `_gap_patterns.yaml`, `_rca_history.md`
- Appends story with `# === BUG FIX` marker to the target user story file

### Subsequent Bug Reports
- Increments bug ID (BUG-002, BUG-003, ...)
- Checks for duplicate gap patterns before creating new ones
- Accumulates in all three output files (append-only)
- Monitors occurrence_count for promotion signals

### After Pipeline Re-run
- `generate-user-stories` Phase 1 reads `_gap_patterns.yaml` into intermediates
- Each agent reads `agent-learnings/{agent}.yaml` for L2 learnings
- `bug-pattern-writer` also reads `_gap_patterns.yaml` as additional context
- Promoted rules in `prompt-templates.md` are automatically applied
- Stories generated from patterns are tagged `[feedback-loop]`
- Previously bug-fix stories may be superseded by pattern-generated ones
  (both kept — no deletion of existing stories)

---

## Error Handling

| Error | Action |
|-------|--------|
| No user story files exist | WARN — run generate-user-stories first, but allow RCA to proceed |
| PRD not found | Skip PRD check in RCA, note "PRD unavailable" in evidence |
| Page component not found | Skip component analysis, note "component not found" |
| Routes.yaml not found | Skip route check, note "routes.yaml unavailable" |
| Bug already reported (duplicate summary + page) | WARN — show existing BUG-{NNN}, ask user if this is a new occurrence or duplicate |
| Gap pattern file corrupted | Recreate from scratch using existing BUG-*.yaml reports |

---

## Related

- **Story generator (v2)**: `.claude/skills/dev/generate-user-stories/SKILL.md` (reads `_gap_patterns.yaml` + `agent-learnings/`)
- **Story generator (v1, deprecated)**: `.claude/skills/dev/generate-user-stories/SKILL.md`
- **Story deepener**: `.claude/skills/dev/deepen-user-stories/SKILL.md` (reads `_gap_patterns.yaml` in Phase 0.5)
- **Agent learnings**: `.claude/skills/dev/generate-user-stories/references/agent-learnings/` (per-agent L2 learnings)
- **Prompt templates**: `.claude/skills/dev/generate-user-stories/references/prompt-templates.md` (promoted rules)
- **Validation rules**: `.claude/skills/dev/generate-user-stories/references/validation-rules.md` (QA gap rules)
- **Acceptance test**: `.claude/skills/qa/test-acceptance/SKILL.md` (can recommend `/report-bug` for coverage gaps)
- **Command**: `.claude/skills/qa/report-bug.md` (user-facing entry point)
- **Bug reports**: `.claude-project/bug_reports/` (all output files)
