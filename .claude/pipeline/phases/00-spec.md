# Phase 0: Specification (Ouroboros Integration)

The spec phase uses `.claude/spec/` to crystallize requirements before building. It conducts a Socratic interview to eliminate ambiguity, then generates a structured seed YAML that anchors all downstream phases.

## Prerequisites

- None (this is the first phase)

## Execution

### Step 0.1: Check for Existing Seed

```
1. Check: Does a seed file exist for this project?
   Path: .claude-project/status/{project}/seed-*.yaml

2. If seed EXISTS:
   a. Read existing seed
   b. Ask: "Requirements changed? Interview again or proceed?"
   c. If proceed: skip to Phase 1
```

### Step 0.2: PRD Provided (--prd flag)

```
3. If NO seed exists AND --prd was provided:
   a. Read the PRD file
      ✅ fullstack.md Step 1.6 already saved the PRD to {TARGET_DIR}/.claude-project/context/PRD_FULL_CONTENT.md
      ✅ Do not read the original PRD file directly — read PRD_FULL_CONTENT.md (guarantees full content)
      ⚠️ Only if PRD_FULL_CONTENT.md does not exist: check wc -l, then chunk-read if over 400 lines
   b. Run PRD gap analysis (see Phase 0a below)
   c. Conduct targeted interview for gaps only
   d. Read .claude/spec/commands/ouroboros/seed.md
   e. Generate seed from PRD + gap-fill answers
   f. Save to .claude-project/status/{project}/seed-{uuid}.yaml
   g. Record seed_id in PIPELINE_STATUS.md
```

### Step 0.3: No Seed, No PRD (Full Interview)

```
4. If NO seed exists AND no --prd:
   a. Read .claude/spec/commands/ouroboros/interview.md
   b. Run full interview (5-8 clarifying questions about the project)
   c. Score ambiguity (0.0 = crystal clear, 1.0 = totally vague)
   d. If ambiguity > 0.2: continue interviewing
   e. If ambiguity <= 0.2: proceed to seed

   f. Read .claude/spec/commands/ouroboros/seed.md
   g. Generate seed YAML with:
      - goal (immutable direction)
      - constraints (boundaries)
      - acceptance_criteria (measurable success)
      - ontology (key terms and relationships)
   h. Save to .claude-project/status/{project}/seed-{uuid}.yaml
   i. Record seed_id in PIPELINE_STATUS.md
```

### Phase 0a: PRD Gap Analysis (when --prd provided)

When a PRD already exists, Phase 0 shifts from full interview to targeted gap-filling:

```
1. Read the PRD file from --prd path
   ✅ Use PRD_FULL_CONTENT.md — full content already saved in fullstack.md Step 1.6
   ⚠️ Only if PRD_FULL_CONTENT.md does not exist: check wc -l, then chunk-read if over 400 lines
2. Analyze against required seed components:

   | Component              | Check in PRD                                       |
   |------------------------|-----------------------------------------------------|
   | goal                   | Is there a clear single-sentence goal?              |
   | constraints            | Are technical/business/design limits stated?         |
   | acceptance_criteria    | Are success criteria specific and measurable?        |
   | ontology_schema        | Are domain entities and their relationships defined? |
   | evaluation_principles  | Are quality metrics with weights defined?            |
   | exit_conditions        | Are done-conditions clear?                           |

3. For each MISSING or VAGUE component:
   - Add to gap list with severity (missing vs vague)

4. Conduct targeted interview:
   - Read .claude/spec/commands/ouroboros/interview.md (PRD-aware mode)
   - Only ask questions about identified gaps
   - Reference what the PRD already says: "Your PRD mentions X but doesn't specify Y"
   - Fewer questions than full interview (only what's needed)
   - Same ambiguity scoring as full interview

5. Generate seed combining:
   - PRD content (for components that were clear)
   - Gap-fill answers (for components that were missing/vague)

6. Save seed to .claude-project/status/{project}/seed-{uuid}.yaml
```

### Skip Spec

If `--skip-spec` is passed, Phase 0 is skipped entirely -- no interview, no gap analysis, no seed generation. Use only when you want to bypass specification completely.

## Quality Gate

```yaml
gate: ambiguity_score <= 0.2
checks:
  - goal_defined: "Is there a clear, measurable goal?"
  - constraints_listed: "Are constraints explicit?"
  - acceptance_criteria: "Are ACs specific and testable?"
  - ontology_stable: "Are key terms defined?"
method: "Read seed YAML, score each field 0-1, average"
```

- ambiguity_score <= 0.2
- All AC fields are specific and measurable
- Ontology terms are defined

## Loop Integration

- **Command**: `fullstack {project} --phase spec --loop`
- **When**: If ambiguity > 0.2 after initial interview
- **Skill**: `.claude/spec/commands/ouroboros/interview.md` + `seed.md`
- **Status file**: `SPEC_STATUS.md`

---

## Phase Completion — Status Update (MANDATORY)

**No gate script exists for this phase.** Status updates must be done manually via the blueprint's `update-pipeline-status` agentic node.

Update `{TARGET_DIR}/.claude-project/status/{project}/PIPELINE_STATUS.md`:
1. Progress Table: Status, Score (from evaluation), Output
2. Execution Log: Append row
3. Config: Update `last_run`, recalculate `pipeline_score`
