---
description: Report a bug — classifies root origin, patches the upstream skill that caused the miss, generates missing story
argument-hint: "<project> [--summary '<text>'] [--page <route>] [--severity P0-P3]"
---

# Report Bug Command

Report a bug found during manual or automated testing. Classifies whether the root cause is a **story-generation** problem or a **test-browser** problem, then **patches the upstream skill/algorithm** that caused the miss so the same class of bug cannot recur. Also generates the missing/corrected story and archives a reusable gap pattern.

```
/report-bug tirebank
/report-bug tirebank --summary "Cart allows negative quantity" --page /cart --severity P1
```

---

## Execution

### Step 1: Parse Arguments

```
project = $1 (required — e.g., "tirebank")
summary = --summary (optional, prompts if missing)
page = --page (optional, prompts if missing)
severity = --severity (default: P2)
```

If no project provided, ask: "Which project?"

### Step 2: Interactive Intake (if fields missing)

```
IF --summary not provided:
  Ask: "Describe the bug you found. What happened, and what should
  have happened instead?"

IF --page not provided:
  Read .claude-project/routes.yaml
  Show route list and ask: "Which page/route did this happen on?"

IF steps_to_reproduce not derivable from summary:
  Ask: "What exact steps reproduce this? (one step per line)"

IF expected/actual not clear from summary:
  Ask: "What did you expect to happen? What actually happened?"

Derive remaining fields:
  app = infer from route (admin_portal routes → frontend-admin-dashboard,
        all others → frontend)
  reporter = "manual"
```

### Step 3: Delegate to Skill (RCA + Story + Pattern)

```
Load skill: .claude/skills/qa/run-feedback-loop/SKILL.md

Pass collected fields:
  - summary
  - page
  - app
  - steps_to_reproduce
  - expected
  - actual
  - severity

Follow skill algorithm Steps 1-5:
  Step 1: Intake → BUG-{NNN}.yaml created
  Step 2: RCA → root cause identified
  Step 2.9: Root Origin → classify as story-generation or test-browser
  Step 3: Generate Story → missing story appended
  Step 4: Extract Gap Pattern → _gap_patterns.yaml updated
  Step 5: Archive → _rca_history.md updated
```

### Step 4: Fix Upstream (MANDATORY)

Based on root_origin, patch the actual skill/algorithm file that caused this class of bug.
Do NOT just document — actually edit the upstream file so the same miss cannot happen again.

```
4.1: RESOLVE TARGET FILE(S)

  Upstream skill map (root_origin → files to patch):

  ┌─────────────────────┬──────────────────────────────────────────────────────┐
  │ root_origin         │ Upstream files to patch                              │
  ├─────────────────────┼──────────────────────────────────────────────────────┤
  │ story-generation    │ .claude/skills/dev/generate-user-stories/SKILL.md        │
  │                     │ .claude/skills/dev/deepen-user-stories/SKILL.md          │
  │                     │ (may also need: routes.yaml, _fixtures.yaml, PRD)    │
  ├─────────────────────┼──────────────────────────────────────────────────────┤
  │ test-browser        │ .claude/skills/qa/test-acceptance/SKILL.md           │
  │                     │ .claude/skills/dev/generate-user-stories/SKILL.md        │
  │                     │   (Step 4 tier templates — assertion quality rules)   │
  │                     │ .claude/skills/dev/deepen-user-stories/SKILL.md          │
  │                     │   (depth tier assertion templates)                    │
  └─────────────────────┴──────────────────────────────────────────────────────┘

4.2: APPLY PATCH BY ROOT CAUSE CATEGORY

  For each root_cause_category, apply the corresponding patch:

  ─── story-generation origin ───

  prd_gap:
    → Cannot auto-fix (PRD is human-authored)
    → Log warning: "PRD must be updated to include {behavior}"
    → Add to .claude-project/bug_reports/BUG-{NNN}.yaml:
        upstream_fix: "manual — PRD update required"

  route_gap:
    → Edit .claude-project/routes.yaml
    → Add the missing route under the correct section (public/auth_required/admin_portal)
    → Record: upstream_fix_file = "routes.yaml"

  component_analysis_gap (story-generation):
    → Read .claude/skills/dev/generate-user-stories/SKILL.md
    → Find Step 2.5 element extraction categories
    → Append the new detection rule from gap_pattern.detection_rule
      as a bullet under the relevant category (Forms, Action Buttons,
      Filter & Search, etc.)
    → Record: upstream_fix_file = "generate-user-stories/SKILL.md"
    → Record: upstream_fix_location = "Step 2.5"

  pattern_gap:
    → Read .claude/skills/dev/generate-user-stories/SKILL.md
    → Find Step 2.1 interaction patterns list
    → Append new pattern definition with trigger phrases and template
    → Record: upstream_fix_file = "generate-user-stories/SKILL.md"
    → Record: upstream_fix_location = "Step 2.1"

  tier_coverage_gap:
    → Read .claude/skills/dev/deepen-user-stories/SKILL.md
    → Find tier definitions section
    → Append new tier (Tier N+1) with condition, tags, and template
    → Record: upstream_fix_file = "deepen-user-stories/SKILL.md"

  test_data_gap:
    → Edit .claude-project/user_stories/_fixtures.yaml
    → Add the required test data under the appropriate section
    → Record: upstream_fix_file = "_fixtures.yaml"

  cross_component_gap:
    → Read .claude/skills/dev/generate-user-stories/SKILL.md
    → Find Step 3c (cross-page flows)
    → Append the new cross-page flow definition
    → Record: upstream_fix_file = "generate-user-stories/SKILL.md"
    → Record: upstream_fix_location = "Step 3c"

  ─── test-browser origin ───

  assertion_gap:
    → Read .claude/skills/dev/generate-user-stories/SKILL.md
    → Find Step 4 tier template for the applicable tier
    → Strengthen assertion rules: add requirement to verify data change,
      not just visibility. Insert concrete assertion pattern.
    → Also read .claude/skills/dev/deepen-user-stories/SKILL.md
    → Find the corresponding depth tier and add assertion quality rule
    → Record: upstream_fix_file = "generate-user-stories/SKILL.md"
    → Record: upstream_fix_location = "Step 4, Tier {N} template"

  selector_mismatch:
    → Read .claude/skills/qa/test-acceptance/SKILL.md
    → Find Step 5b failure classification
    → Add the specific selector pattern to the known-mismatch list
      so future acceptance runs auto-fix this class of selector
    → Record: upstream_fix_file = "acceptance-test/SKILL.md"

  missing_wait:
    → Read .claude/skills/qa/test-acceptance/SKILL.md
    → Find Step 5b "Flaky" classification
    → Add the async pattern (e.g., "after sort change, wait for
      network idle or list re-render") to the known-wait-required list
    → Record: upstream_fix_file = "acceptance-test/SKILL.md"

  workflow_incomplete:
    → Read .claude/skills/dev/generate-user-stories/SKILL.md
    → Find Step 4 tier template for the applicable tier
    → Add prerequisite step requirements to the template
    → Record: upstream_fix_file = "generate-user-stories/SKILL.md"

  flaky_execution:
    → Read .claude/skills/qa/test-acceptance/SKILL.md
    → Find retry/stability section
    → Add the flaky pattern to known-flaky-patterns for auto-retry
    → Record: upstream_fix_file = "acceptance-test/SKILL.md"

  edge_case:
    → No upstream patch possible
    → Log: "Edge case — no systematic upstream fix available"
    → upstream_fix: "none"

4.3: VERIFY PATCH
  Read the patched file to confirm:
    - Edit was applied correctly (no syntax errors)
    - Edit is in the right section
    - Edit doesn't duplicate existing content
  IF patch failed: revert and record upstream_fix: "patch_failed — {reason}"

4.4: FIX APPLICATION CODE (if applicable)
  If the bug is a real code defect (not just a testing gap):
    - Trace the bug to the source code (frontend or backend)
    - Apply the minimal fix
    - Record: code_fix_files = [{files changed}]
```

### Step 5: Report

```
Output:

  Bug Report: BUG-{NNN}
  ========================
  Root Origin: {root_origin}
    → {root_origin_detail_summary}

  IF root_origin == "test-browser":
    Failure Mode: {root_origin_failure_mode}
    Existing Story: "{closest_story_name}" — {why_insufficient}

  Root Cause: {category} at {algorithm_step}
  Explanation: {explanation}

  Upstream Fix Applied:
    → {upstream_fix_file}: {upstream_fix_location}
    → Patch: {one-line description of what was changed}

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

## Examples

### Example 1: story-generation origin (component_analysis_gap)

```
User: /report-bug tirebank

User: On the checkout page, when I leave the phone number empty and
      click submit, there's no validation error.

Claude:
  Bug Report: BUG-004
  ========================
  Root Origin: story-generation
    → No story was generated for phone validation on /checkout.

  Root Cause: component_analysis_gap at Step 2.5
  Explanation: Checkout form has phone field at line 87 but
    Step 2.5 only extracted 3 fields (name, address, payment).

  Upstream Fix Applied:
    → generate-user-stories/SKILL.md: Step 2.5, Forms category
    → Patch: Added rule "Extract ALL form fields including
      conditionally rendered ones, not just visually prominent fields"

  Story Generated: "Checkout validates empty phone number"
    Added to: checkout.yaml
    Tags: [validation, form, bug-report]

  Gap Pattern: GP-004
```

### Example 2: test-browser origin (assertion_gap)

```
User: /report-bug tirebank --summary "Sort dropdown on reviews page
      doesn't change order" --page /reviews --severity P1

Claude:
  Bug Report: BUG-002
  ========================
  Root Origin: test-browser (assertion_gap)
    → Three sort stories exist but only assert visibility,
      not actual data order change.

  Failure Mode: assertion_gap
  Existing Story: "Reviews page sort by rating descending"
    — only checks "at least one review card is visible"

  Root Cause: component_analysis_gap at Step 2.5

  Upstream Fix Applied:
    → generate-user-stories/SKILL.md: Step 4, Tier 4 template
    → Patch: Added assertion quality rule for sort stories:
      "MUST verify data order changed, not just item visibility"

  Code Fix Applied:
    → frontend/app/pages/Reviews.tsx: Aligned sort param values
      (newest/rating_high/rating_low) with backend expectations

  Story Generated: "Reviews sort dropdown changes displayed review order"
    Added to: reviews.yaml
```

### One-liner Mode

```
/report-bug tirebank --summary "Brand logo click goes to /products instead of /products?brand=한국타이어" --page / --severity P1
```

---

## Related

- **Skill**: `.claude/skills/qa/run-feedback-loop/SKILL.md` (core analysis engine)
- **Bug reports**: `.claude-project/bug_reports/` (all output)
- **Gap patterns**: `.claude-project/bug_reports/_gap_patterns.yaml` (accumulated learnings)
- **Upstream targets** (patched by this command):
  - `.claude/skills/dev/generate-user-stories/SKILL.md` (story algorithm — Step 2.1, 2.5, 3c, 4)
  - `.claude/skills/dev/deepen-user-stories/SKILL.md` (depth tiers — assertion quality)
  - `.claude/skills/qa/test-acceptance/SKILL.md` (test execution — failure classification)
  - `.claude-project/routes.yaml` (route manifest)
  - `.claude-project/user_stories/_fixtures.yaml` (test data)
