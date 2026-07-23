# Phase 2: PRD (Generate + Convert + User Stories)

Phase 2 has three sub-steps: generate the PRD if it doesn't exist, convert it to structured project documentation, and generate user story YAML files for acceptance testing. The PRD serves as the single source of truth for all downstream phases -- design, database, backend, and frontend all derive from it.

## Prerequisites

- Phase 1 (init) complete

## ⚠️ MANDATORY: PRD File Reading Rules (A-02 prevention)

**You must follow these rules before reading the PRD file.**

```
After confirming PRD_FILE path:

1. Check line count with Bash: wc -l < "$PRD_FILE"

2. 400 lines or fewer → single Read is allowed

3. Over 400 lines → chunk reading required (single Read strictly prohibited):
   Read offset=1,   limit=400  → take notes
   Read offset=401, limit=400  → take notes
   Read offset=801, limit=400  → take notes
   ... (repeat until END OF FILE)
   Consolidate after full completion

❌ Prohibited: "The PRD file is very large. I'll identify key content and proceed" → single Read
❌ Prohibited: Attempting Read without checking line count
✅ Required: wc -l first → decide strategy based on result → read entirely
```

---

## Execution

### Step 2a: Generate PRD

```
1. Check: Does a PRD file already exist?
   Look for: .claude-project/prd/*.md, or PRD path in PIPELINE_STATUS.md

2. If NO PRD exists:
   a. MANDATORY: Read the skill file: .claude/skills/dev/generate-prd/SKILL.md
      - You MUST read this file before generating anything
      - Do NOT generate a PRD from your own knowledge — use the skill's templates
   b. MANDATORY: Read ALL resource templates referenced in the skill:
      - .claude/skills/dev/generate-prd/resources/prd-template.md (full assembled template — use as output structure)
      - .claude/skills/dev/generate-prd/resources/project-overview.md
      - .claude/skills/dev/generate-prd/resources/terminology.md
      - .claude/skills/dev/generate-prd/resources/modules.md
      - .claude/skills/dev/generate-prd/resources/user-app-architecture.md
      - .claude/skills/dev/generate-prd/resources/admin-dashboard-architecture.md
      - .claude/skills/dev/generate-prd/resources/tech-stack.md
      - .claude/skills/dev/generate-prd/resources/open-questions.md
   c. Use seed (from Phase 0) as input context:
      - seed.goal -> Project Overview
      - seed.ontology -> Terminology
      - seed.constraints -> Tech Stack decisions
      - seed.acceptance_criteria -> Feature lists
   d. Follow the skill's workflow EXACTLY:
      - Ask user 4 clarifying questions (as specified in SKILL.md)
      - Use prd-template.md as the output structure
      - Fill each section using corresponding resource template guidelines
   e. Output: .claude-project/prd/{PROJECT_NAME}_PRD.md
3. If PRD already exists:
   a. ⚠️ Apply the "PRD File Reading Rules" above — wc -l first, chunk-read if over 400 lines
   b. Validate it has required sections (Overview, Terminology, Modules, Pages, Tech Stack)
   c. If sections missing: supplement from seed or ask user
   d. Proceed to Step 2b
```

### Step 2b: Convert PRD to Project Docs

```
0. ⚠️ MANDATORY: Check PRD file size and decide reading strategy (A-02 prevention)

   PRD_FILE="path/to/prd.md"

   # Check line count
   LINE_COUNT=$(wc -l < "$PRD_FILE")

   If LINE_COUNT > 400:
     - Single Read attempt strictly prohibited
     - Chunk-based reading required:
       Chunk 1: offset=1,   limit=400
       Chunk 2: offset=401, limit=400
       Chunk 3: offset=801, limit=400
       ... (repeat as needed)
     - Take notes on key content after each chunk → consolidate after full read

   If LINE_COUNT <= 400:
     - Single Read is allowed

   ❌ Saying "The PRD file is very large" then just proceeding is prohibited
   ✅ Check size → execute chunk strategy immediately

1. Load skill: .claude/$BACKEND/guides/workflow-convert-prd-to-knowledge.md
2. Input: PRD file from Step 2a (read using the chunk strategy above)
3. Output: PROJECT_KNOWLEDGE.md, PROJECT_API.md, PROJECT_DATABASE.md
4. Validate all output docs are complete
```

### Step 2c: Generate User Story YAML Files

```
1. Check: Do user story files already exist?
   Look for: .claude-project/user_stories/*.yaml

2. Load skill: .claude/skills/dev/generate-user-stories/SKILL.md

3. Input:
   a. PRD file from Step 2a: .claude-project/prd/{PROJECT_NAME}_PRD.md
   b. Route manifest: .claude-project/routes.yaml
   c. Seed ACs: .claude-project/status/{project}/seed-*.yaml (optional)
   d. PROJECT_KNOWLEDGE.md from Step 2b

4. Output: .claude-project/user_stories/{page-slug}.yaml
   One file per page (or parent-child route pair), plus cross-cutting files:
   - Frontend pages: home.yaml, login.yaml, products.yaml, cart.yaml, admin-dashboard.yaml, etc.
   - Admin portal pages: portal-login.yaml, portal-dashboard.yaml, portal-members.yaml, etc.
   - Cross-cutting: cross-page-flows.yaml, auth-guards.yaml

5. Validate:
   a. Every route in routes.yaml has at least 1 story
   b. Every seed acceptance_criterion covered by at least 1 story
   c. Total story count >= number of routes
   d. Frontend URLs use http://localhost:5173, portal URLs use http://localhost:5177
```

### Skip Generate (PRD already provided)

If the user provides `--prd <path>`, skip Step 2a and use the provided file directly for Steps 2b and 2c. The PRD path is resolved relative to the current working directory (not TARGET_DIR).

## Quality Gate

```yaml
gate: prd_exists AND all_sections_present AND feature_coverage >= 90% AND user_stories_exist
checks:
  - prd_exists: "PRD file exists with all sections (Overview, Terminology, Modules, Pages, Tech Stack)?"
  - sections_complete: "Overview, Terminology, User Types, Pages, Features all present in KNOWLEDGE.md?"
  - features_mapped: "Every feature has corresponding AC?"
  - no_ambiguity: "No vague terms like 'should', 'might', 'optionally'?"
  - seed_aligned: "PRD features match seed acceptance criteria (if seed exists)?"
  - user_stories_exist: "YAML user story files generated in .claude-project/user_stories/?"
  - route_coverage: "Every route in routes.yaml covered by at least 1 story?"
  - ac_coverage: "Every seed acceptance_criterion covered by at least 1 story?"
method: "Check PRD file, parse PROJECT_KNOWLEDGE.md sections, count feature coverage, compare to seed ACs, validate user story coverage"
```

## Loop Integration

- **Command**: `fullstack {project} --phase prd --loop`
- **When**: If sections are missing from PRD or KNOWLEDGE.md
- **Skill**: `.claude/skills/dev/generate-prd/SKILL.md` (generate) + `.claude/$BACKEND/guides/workflow-convert-prd-to-knowledge.md` (convert) + `.claude/skills/dev/generate-user-stories/SKILL.md` (stories)

---

## Phase Completion — Status Update (MANDATORY)

**No gate script exists for this phase.** Status updates must be done manually via the blueprint's `update-pipeline-status` agentic node.

Update `{TARGET_DIR}/.claude-project/status/{project}/PIPELINE_STATUS.md`:
1. Progress Table: Status, Score (from evaluation), Output
2. Execution Log: Append row
3. Config: Update `last_run`, recalculate `pipeline_score`
