# Phase D1: Init (Dev track — Scaffolding + Design Intent Extraction)

Dev-track variant of Phase 1. Does everything legacy `01-init.md` does (project scaffolding, `.claude-rules` generation, `CLAUDE.md` generation, `.claude-project/` structure, `memory/` + `customization/` scaffolds), **plus** extracts `design/design-intent.yaml` from approved HTML — the bridge artifact between PM design and Dev tech spec.

## Prerequisites

- `/fullstack-dev` entry Tier 1/2/3 passed (PRD + approved design HTML exist)
- `{TARGET_DIR}/.claude-project/docs/PRD.md` readable (or legacy `.claude-project/prd/*.md`)
- `{TARGET_DIR}/.claude-project/design/html/**/*.html` contains ≥ 1 file

## Scope Rules (Dev-track — HARD STOP)

- This phase is part of the `dev` group. Do **not** read, invoke, or depend on PM-track phase files (`00-spec.md`, `pm-*.md`).
- Do **not** overwrite `spec/PRD.md`, `design/html/`, `DESIGN_STATUS.md` — those are PM-owned source-of-truth artifacts.

## Execution

This phase has TWO parts:

- **Step D1.A** — Legacy scaffolding (delegates to `01-init.md` logic)
- **Step D1.B** — Design intent extraction (NEW, PM/Dev bridge)

### Step D1.A: Legacy Scaffolding

Execute all sub-steps from `01-init.md`:
- **D1.A.1** Resolve Target Project Directory (`--path` handling)
- **D1.A.2** Bootstrap `.claude/` submodule if TARGET_DIR lacks it
- **D1.A.3** Generate directory-scoped `.claude-rules` files (root, backend, frontend) from stack templates
- **D1.A.4** Create `PIPELINE_STATUS.md` (if absent) from `templates/PIPELINE_STATUS.template.md`
- **D1.A.5** Resolve and validate tech stack (`$BACKEND`, `$FRONTEND`)
- **D1.A.6** Generate `CLAUDE.md` from `templates/claude.template.md` — since PRD exists by the time Dev runs, populate roles/colors/domain directly from PRD (not "TODO" placeholders)
- **D1.A.7** Create directory structure:
  ```
  .claude-project/{docs,memory,status,agents,hooks,skills,customization}/
  backend/src/core/base/, backend/src/modules/
  frontend/app/{components,pages,services,redux,types,...}/
  ```
- **D1.A.8** Copy memory templates to `.claude-project/memory/{DECISIONS,LEARNINGS,PREFERENCES}.md`

Note: `.claude-project/docs/` already contains `PRD.md` from PM. Do **not** overwrite.

### Step D1.B: Design Intent Extraction (NEW)

Produce `design-intent.yaml` by parsing approved HTML. This file is the input for `D2-tech-spec`.

#### D1.B.1 Check if extraction is needed

```bash
INTENT_FILE="{TARGET_DIR}/.claude-project/design/design-intent.yaml"
HTML_ROOT="{TARGET_DIR}/.claude-project/design/html"

# Compute current HTML bundle hash
CURRENT_BUNDLE_HASH=$(find "$HTML_ROOT" -name '*.html' -type f | sort | xargs -I {} sh -c 'echo "{}"; cat "{}"' | sha256sum | awk '{print $1}')

# Read previous bundle hash (if intent already exists)
PREV_BUNDLE_HASH=""
if [ -f "$INTENT_FILE" ]; then
  PREV_BUNDLE_HASH=$(grep -E "^\s*html_bundle_hash:" "$INTENT_FILE" | head -1 | sed 's/.*html_bundle_hash:\s*"\{0,1\}\([a-f0-9]*\)"\{0,1\}.*/\1/')
fi

if [ -n "$INTENT_FILE" ] && [ "$CURRENT_BUNDLE_HASH" = "$PREV_BUNDLE_HASH" ] && [ -n "$PREV_BUNDLE_HASH" ]; then
  echo "design-intent.yaml is up to date (bundle hash match). Skipping re-extraction."
  exit 0
fi
```

If bundle hash differs OR intent doesn't exist → proceed to D1.B.2.

#### D1.B.2 Extract intent

Load skill: `.claude/skills/dev/design-intent-extractor/SKILL.md`

Inputs:
- `HTML_ROOT` — all HTML under `design/html/`
- `PRD_FILE` — active PRD (for role hints via `user_type`)
- `DESIGN_STATUS_FILE` — for declared `roles:` list (cross-check)

Output:
- `{TARGET_DIR}/.claude-project/design/design-intent.yaml`

The skill applies heuristics (see `SKILL.md`):
- Endpoint extraction from `<a href>`, `<form action>`, JS literals, `data-api`
- Form extraction from `<input>`, `<select>`, `<textarea>`
- Realtime hints from `data-sse`, `data-ws`, `EventSource`/`WebSocket`
- Role from folder (`design/html/<role>/...`), fallback `app`

The output YAML includes:
- `source.prd_hash`, `source.html_bundle_hash`, `source.html_files[]`
- `screens[]` (one per HTML file, with `endpoints_inferred`, `forms_inferred`, `realtime_hints`, `tbd`)
- `roles_summary` (counts per role)

#### D1.B.3 Validate intent output

```bash
# Must exist and be valid YAML
[ -f "$INTENT_FILE" ] || exit 1
python3 -c "import yaml; yaml.safe_load(open('$INTENT_FILE'))" 2>/dev/null || exit 1

# Must have at least one screen
SCREEN_COUNT=$(grep -cE "^\s*- file:" "$INTENT_FILE")
[ "$SCREEN_COUNT" -ge 1 ] || exit 1

# Bundle hash must match current
INTENT_HASH=$(grep -E "^\s*html_bundle_hash:" "$INTENT_FILE" | head -1 | sed 's/.*"\([a-f0-9]*\)".*/\1/')
[ "$INTENT_HASH" = "$CURRENT_BUNDLE_HASH" ] || exit 1
```

If any check fails → fail the phase with clear error.

### Step D1.C: Update PIPELINE_STATUS.md

Row key: **`D1-init`** (not `1-init`).

Write:
- Status: Complete
- Output summary: "scaffold + CLAUDE.md + design-intent.yaml ({SCREEN_COUNT} screens)"
- Score: gate score

## Quality Gate

Gate script: `gates/dev-1-init-gate.sh`

```yaml
gate: scaffolding_complete AND intent_valid
checks:
  - claude_md_exists:       "{TARGET_DIR}/CLAUDE.md exists?"
  - claude_rules_root:      "{TARGET_DIR}/.claude-rules exists?"
  - claude_rules_backend:   "{TARGET_DIR}/backend/.claude-rules exists (if backend/)?"
  - claude_rules_frontend:  "{TARGET_DIR}/frontend/.claude-rules exists (if frontend/)?"
  - dirs_scaffolded:        "backend/src/, frontend/app/, .claude-project/{docs,memory,status}/ all exist?"
  - memory_templates:       "{TARGET_DIR}/.claude-project/memory/{DECISIONS,LEARNINGS,PREFERENCES}.md all exist?"
  - pipeline_status:        "{TARGET_DIR}/.claude-project/status/{project}/PIPELINE_STATUS.md exists?"
  - intent_exists:          "{TARGET_DIR}/.claude-project/design/design-intent.yaml exists?"
  - intent_valid_yaml:      "intent.yaml parses as YAML?"
  - intent_has_screens:     "intent.yaml screens[] non-empty?"
  - intent_hash_match:      "intent.source.html_bundle_hash matches current bundle hash?"
method: "Shell existence + Python YAML parse + sha256sum comparison"
```

## Loop Integration

- **Command**: `/fullstack-dev {project} --phase D1-init --loop` (rare — init is typically one-shot)
- **When**: HTML bundle hash changed (PM edited design after Dev started) → re-extract intent
- **Skill**: `.claude/skills/dev/design-intent-extractor/SKILL.md`

## Editable Intent

`design-intent.yaml` is designed to be edited by engineers after extraction:
- Review `screens[].tbd` items and resolve manually
- Correct mis-inferred endpoints/forms
- Add missing intents not detectable by heuristics

After editing, re-run D2:
```bash
/fullstack-dev {project} --phase D2-tech-spec --resume
```

D1 will not re-extract unless HTML bundle hash changes (manual edits to `design-intent.yaml` are preserved until HTML itself changes).

## Cascade Behavior

If D1 re-extracts intent (bundle hash changed):
- Engineer-edited `tbd:` items are **not** preserved (fresh extraction)
- D2, D3, D4-D7 all should cascade (docs regenerate → downstream affected)
- Recommended: engineer reviews new intent before running D2

## What This Phase Does NOT Do

- ❌ Write `PROJECT_KNOWLEDGE.md`, `PROJECT_API.md`, `PROJECT_DATABASE.md` → D2 owns these
- ❌ Generate user stories → D3
- ❌ Touch `design/html/*`, `DESIGN_STATUS.md`, `docs/PRD.md` → PM-owned
