# Phase D2: Tech Spec (PRD + Design Intent → PROJECT_*.md)

Dev-track phase that derives the three technical project documents (`PROJECT_KNOWLEDGE.md`, `PROJECT_API.md`, `PROJECT_DATABASE.md`) from the PRD **and** the extracted design intent. This is the Dev-side counterpart to what legacy Phase 2 did inline — but driven by both PRD semantics AND actual UI structure captured from approved design HTML.

Because D2 runs on every `/fullstack-dev` entry and always consumes the current PRD + current intent, **docs never drift** relative to spec+design — they are regenerated fresh.

## Prerequisites

- `D1-init` complete
- `{TARGET_DIR}/.claude-project/docs/PRD.md` exists
- `{TARGET_DIR}/.claude-project/design/design-intent.yaml` exists and valid

## Scope Rules (Dev-track — HARD STOP)

- This phase is part of the `dev` group. Do **not** read PM-track phase files.
- Writes ONLY to `{TARGET_DIR}/.claude-project/docs/PROJECT_*.md`. Do not touch PRD, design/, or anything outside docs/.

## ⚠️ Input Reading Rules

### PRD (A-02 prevention)

```
PRD_FILE="{TARGET_DIR}/.claude-project/docs/PRD.md"
wc -l < "$PRD_FILE"
> 400 lines → chunk Read in 400-line increments
≤ 400 lines → single Read OK
```

### design-intent.yaml

Single Read (YAML is compact).

## Execution

### Step D2.1: Load inputs

1. Read PRD (with A-02 chunk strategy if needed)
2. Read `design-intent.yaml` completely
3. Compute `prd_hash` (normalized SHA256 — same recipe as pm-3-design)
4. Compute `intent_hash` (SHA256 of intent.yaml raw content)

### Step D2.2: Decide whether to regenerate

```bash
DOCS_DIR="{TARGET_DIR}/.claude-project/docs"
CURRENT_PRD_HASH="<computed>"
CURRENT_INTENT_HASH="<computed>"

# Read prior frontmatter hashes from any one of the 3 docs
PRIOR_PRD_HASH=$(grep -E "^prd_hash:" "$DOCS_DIR/PROJECT_KNOWLEDGE.md" 2>/dev/null | head -1 | sed 's/.*"\([a-f0-9]*\)".*/\1/')
PRIOR_INTENT_HASH=$(grep -E "^intent_hash:" "$DOCS_DIR/PROJECT_KNOWLEDGE.md" 2>/dev/null | head -1 | sed 's/.*"\([a-f0-9]*\)".*/\1/')

if [ "$CURRENT_PRD_HASH" = "$PRIOR_PRD_HASH" ] && [ "$CURRENT_INTENT_HASH" = "$PRIOR_INTENT_HASH" ]; then
  echo "tech-spec is up to date (hash match). Skipping regeneration."
  exit 0
fi
```

Otherwise, proceed to Step D2.3.

### Step D2.3: Generate `PROJECT_KNOWLEDGE.md`

Load skill: `.claude/$BACKEND/guides/workflow-convert-prd-to-knowledge.md`

Augment the skill's standard inputs with `design-intent.yaml` data:
- Each screen → a feature area in `PROJECT_KNOWLEDGE.md` (link to its HTML file path)
- `roles_summary` → User Types section
- `screens[].realtime_hints` → "Real-time Features" section

Frontmatter:
```yaml
---
prd_hash: "<sha256>"
intent_hash: "<sha256>"
generated_at: "<ISO8601>"
generator: dev-2-tech-spec
---
```

Write to `.claude-project/docs/PROJECT_KNOWLEDGE.md`.

### Step D2.4: Generate `PROJECT_API.md`

Load skill: `.claude/$BACKEND/guides/workflow-convert-prd-to-knowledge.md` (API section)

**Augment with intent data** (this is the key Dev/Design bridge):

From `design-intent.yaml`, collect unique endpoints across all screens:

```yaml
# For each screen.endpoints_inferred, dedupe by (method, path) tuple.
# Emit flat spec section + cross-reference sections.
```

Frontmatter:
```yaml
---
prd_hash: "<sha256>"
intent_hash: "<sha256>"
generated_at: "<ISO8601>"
generator: dev-2-tech-spec
---
```

Body sections (in order):

#### Section A: Endpoints (flat spec)

One block per unique endpoint. For each:
- **Method and path** (e.g. `GET /api/admin/stats`)
- **Role(s) that call it** — derived from which screens reference it
- **Request schema** — derived from form fields if this endpoint is a form target
- **Response schema** — inferred from PRD or marked TBD
- **Auth requirement** — inferred from role ('admin' requires admin token, 'user' requires user token, etc.)
- **Used in screens** — list of HTML file paths

#### Section B: Screen → Endpoints (cross-reference)

Markdown table:
```markdown
| Screen | Role | Endpoints |
|--------|------|-----------|
| admin/dashboard.html | admin | GET /api/admin/stats, GET /api/admin/recent-events |
| user/profile.html | user | GET /api/user/profile, PATCH /api/user/profile |
```

#### Section C: Endpoint → Screens (reverse, for impact analysis)

Markdown table:
```markdown
| Endpoint | Roles | Referenced by |
|----------|-------|---------------|
| GET /api/admin/stats | admin | admin/dashboard.html |
| PATCH /api/user/profile | user | user/profile.html |
```

#### Section D: Role × Endpoint authz matrix

Markdown matrix (roles as columns, endpoints as rows, ✓/✗ cells):
```markdown
|  | admin | user | vendor |
|--|-------|------|--------|
| GET /api/admin/stats | ✓ | ✗ | ✗ |
| GET /api/user/profile | ✓ | ✓ | ✗ |
```

#### Section E: Real-time endpoints

List endpoints with `realtime_hints` from intent. Mark each with protocol suggestion (WebSocket/SSE/long-poll).

#### Section F: TBD (from intent)

Aggregate all `screens[].tbd` items. Engineers resolve before backend implementation.

Write to `.claude-project/docs/PROJECT_API.md`.

### Step D2.5: Generate `PROJECT_DATABASE.md`

Load skill: `.claude/$BACKEND/guides/workflow-convert-prd-to-knowledge.md` (DB section)

**Augment with intent form data:**
- For each `forms_inferred` across screens:
  - If form represents entity creation/update → derive entity fields from form fields
  - Types from HTML input types (string, number, boolean, date)
  - Required attribute → NOT NULL constraint
  - Pattern → validation rule

Frontmatter:
```yaml
---
prd_hash: "<sha256>"
intent_hash: "<sha256>"
generated_at: "<ISO8601>"
generator: dev-2-tech-spec
---
```

Body (standard schema spec):
- Entities (each with fields, types, constraints, relationships)
- Indexes
- Migrations strategy

Add trailing section:
#### Section: Form-derived fields (from intent)

```markdown
| Form name | Target entity (inferred) | Fields |
|-----------|-------------------------|--------|
| ban-user  | UserBan | user_id (string, required), reason (text) |
```

Engineers adjust mapping where inference is ambiguous.

Write to `.claude-project/docs/PROJECT_DATABASE.md`.

### Step D2.6: Update PIPELINE_STATUS.md

Row key: **`D2-tech-spec`**.

Status=Complete, Score from gate, Output="3 docs regenerated, frontmatter hashes match current PRD + intent".

## Quality Gate

Gate script: `gates/dev-2-tech-spec-gate.sh`

```yaml
gate: docs_exist AND frontmatter_hashes_match AND content_depth_ok
checks:
  - docs_exist:             "All 3 PROJECT_*.md present?"
  - frontmatter_prd_hash:   "Each doc's frontmatter.prd_hash matches current PRD SHA256?"
  - frontmatter_intent_hash: "Each doc's frontmatter.intent_hash matches current intent.yaml SHA256?"
  - knowledge_depth:        "PROJECT_KNOWLEDGE.md >= 50 lines, has Overview/Terminology/Pages sections?"
  - api_endpoints_count:    "PROJECT_API.md has >= 5 HTTP verb mentions?"
  - api_sections_present:   "PROJECT_API.md has Screen→Endpoints + Endpoint→Screens + Role×Endpoint sections?"
  - db_entities_count:      "PROJECT_DATABASE.md has >= 3 entities?"
  - no_placeholders:        "No {PROJECT_NAME}, YYYY-MM-DD, <TODO>, TBD literals (except in TBD section)?"
method: "Grep frontmatter fields, compare to live PRD/intent SHA256, count sections, line count"
```

## Loop Integration

- **Command**: `/fullstack-dev {project} --phase D2-tech-spec --loop`
- **When**: PRD or intent changed (hash mismatch) OR content gaps detected in loop
- **Skill**: `workflow-convert-prd-to-knowledge`

## Re-run Optimization

D2 is cheap to re-run (pure derivation) but skips regeneration when both hashes match (Step D2.2). This means:
- PRD unchanged + intent unchanged → fast no-op
- PRD changed → Tier 2 hard-fail at `/fullstack-dev` entry, user runs `/fullstack-pm --update` first
- Intent changed (engineer edited intent.yaml) → D2 regenerates docs
- Both changed → D2 regenerates (engineer likely re-extracted)

## What This Phase Does NOT Do

- ❌ Touch `design/intent.yaml` → D1 owns
- ❌ Touch `design/html/*` or `DESIGN_STATUS.md` → PM owns
- ❌ Touch `docs/PRD.md` → PM owns
- ❌ Generate user stories → D3
- ❌ Write code → D4+
