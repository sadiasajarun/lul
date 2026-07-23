# Phase P3: Design (PM track — role-folder HTML + PRD snapshot)

PM-track variant of Phase 3. Same multi-stage flow as legacy `03-design.md` (Design Guide → 3 variations → client confirmation → full HTML generation), with two key differences:

1. **Role-based HTML output:** Final HTML pages are written to `design/html/<role>/*.html` instead of flat `design/html/*.html`.
2. **Extended DESIGN_STATUS snapshot:** Records `prd_hash_at_generation`, `prd_version`, `roles`, `html_bundle_hash`, `generated_at`, `phase_complete: true` to support `/fullstack-dev` Tier 2 consistency verification.

All other sub-steps (3a research+guide, 3b prompts, 3c variations, 3d client pause, 3f QA, 3g upload) are identical — reuse the skill/logic from `03-design.md`.

## Prerequisites

- `P2-prd` (PM track) complete → `{TARGET_DIR}/.claude-project/docs/PRD.md` exists

## Scope Rules (PM-track — HARD STOP)

- This phase is part of the `pm` group. Do **not** read, invoke, or depend on Dev-track phase files (`01-init.md`, `dev-*.md`, or any D-series).
- Do **not** trigger Phase 3.5/4/5/6 or any downstream work — PM track ends after P3g.
- Do **not** write anything outside `{TARGET_DIR}/.claude-project/design/` and `{TARGET_DIR}/.claude-project/status/`.

## Execution

### Step P3.0: Ensure output directories

```bash
mkdir -p "{TARGET_DIR}/.claude-project/design/variations"
mkdir -p "{TARGET_DIR}/.claude-project/design/html"
mkdir -p "{TARGET_DIR}/.claude-project/status/{project}"
```

### Step P3a–P3c: Same as legacy 3a–3c

Execute identically to `03-design.md` Steps 3a (Domain research + DesignGuide + DESIGN_SYSTEM × 3), 3b (design-guide-to-prompts), 3c (representative HTML × 3 variations + showcase-ALL.html).

All outputs go to their existing paths:
- `.claude-project/design/{PROJECT}_DomainResearch.md`
- `.claude-project/design/{PROJECT}_DesignGuide.md`
- `.claude-project/design/DESIGN_SYSTEM_{A,B,C}.md`
- `.claude-project/design/{PROJECT}_VariationPrompts.md`
- `.claude-project/design/variations/A-*.html`, `B-*.html`, `C-*.html`, `showcase-ALL.html`

### Step P3d: Client Confirmation (identical to legacy 3d)

⏸ PAUSE with `AskUserQuestion`. Options A/B/C/Mix. User picks, then:
1. Copy selected `DESIGN_SYSTEM_{X}.md` → `.claude-project/design/DESIGN_SYSTEM.md`
2. Update `DESIGN_STATUS.md` with partial snapshot:
   ```yaml
   selected_variation: {A|B|C|Mix}
   approved: true
   approved_at: {ISO8601}
   ```
3. **Do NOT proceed to P3e until `approved: true` is persisted.**

### Step P3e: Full HTML Generation — **Role-Folder Output** (differs from legacy)

Same logic as legacy 3e (load confirmed DESIGN_SYSTEM, extract CSS patterns, generate prompts for all PRD pages, produce HTML), **but output path differs**:

#### Role Extraction (priority order)

```
1. PRD user_type field:
   If .claude-project/docs/PRD.md (or prd/*.md) declares "user_type: [admin, customer, ...]"
     → use that list verbatim (ordered as declared)

2. routes.yaml role annotation:
   If .claude-project/routes.yaml exists and routes have `role:` annotation
     → collect unique role values

3. PRD page-level roles:
   Some PRDs list pages under per-user-type sections (e.g. "## User App", "## Admin Dashboard")
     → infer role from page's section header (user-app → user, admin-dashboard → admin)

4. Fallback: single role `app`
   No role signal → write all HTML to design/html/app/*.html
```

#### Output Path Assignment

For each generated page, map to a role:
- If role inferred from PRD/routes for that page → use it
- Else if only one role exists globally → use it for all pages
- Else → `app` (unclassified pages)

Write file:
```
{TARGET_DIR}/.claude-project/design/html/<role>/<page>.page.html
```

Examples:
```
design/html/admin/dashboard.page.html
design/html/admin/users.page.html
design/html/admin/settings.page.html
design/html/user/home.page.html
design/html/user/profile.page.html
design/html/vendor/orders.page.html
```

#### HTML Cross-Link Updates

When HTML files reference each other (navbar links, footer links), update `href` attributes to use role-prefixed paths:

```html
<!-- Before (legacy flat output): -->
<a href="dashboard.page.html">Dashboard</a>

<!-- After (role-folder output): -->
<a href="../admin/dashboard.page.html">Dashboard</a>
```

Cross-role links: include role prefix in relative path.

#### Invariants

- `design/html/<role>/` directory is created per detected role (`mkdir -p` before write)
- Each role folder contains ≥ 1 HTML file (empty role folders not allowed)
- Shared shell (navbar/footer) preserved, only link paths updated

### Step P3f: Design QA — **Role-aware** (extends legacy 3f)

Legacy QA checks remain:
1. Routing validation (all `href` resolve; now resolve across role folders)
2. Shared component consistency (navbar/footer identical across all pages including cross-role)
3. Design system compliance (colors/fonts/spacing match DESIGN_SYSTEM.md)
4. Page completeness (routes.yaml coverage)

**Added checks (role-aware):**

5. **Role-folder presence:** Every detected role has ≥ 1 HTML file in `design/html/<role>/`
6. **Role match:** The set of role folders = set of roles recorded in `DESIGN_STATUS.roles` (written in P3g)
7. **Cross-role navigation:** If any page references another role's page, href must include role prefix

Output: `.claude-project/status/{project}/DESIGN_QA_STATUS.md` (legacy path preserved).

### Step P3g: Snapshot + Upload + Phase Complete (extends legacy 3g)

#### Compute snapshot values

```bash
# PRD hash (normalized: strip trailing whitespace, LF endings)
PRD_FILE="{TARGET_DIR}/.claude-project/docs/PRD.md"
PRD_HASH=$(sed -e 's/[[:space:]]*$//' "$PRD_FILE" | tr -d '\r' | sha256sum | awk '{print $1}')

# PRD version (from Step P2.3 snapshot history)
PRD_VERSION=$(ls "{TARGET_DIR}/.claude-project/prd/history"/PRD_v*.hash 2>/dev/null | sed 's/.*PRD_v\([0-9]*\)\.hash/\1/' | sort -n | tail -1)
[ -z "$PRD_VERSION" ] && PRD_VERSION="1"

# Roles list (from detected roles during P3e)
# ROLES is set during P3e — array of detected role folder names (sorted)

# HTML bundle hash (stable across runs: sorted file paths + contents)
HTML_ROOT="{TARGET_DIR}/.claude-project/design/html"
BUNDLE_HASH=$(find "$HTML_ROOT" -name '*.html' -type f | sort | xargs -I {} sh -c 'echo "{}"; cat "{}"' | sha256sum | awk '{print $1}')

GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
```

#### Append snapshot to DESIGN_STATUS.md

Extend the existing `DESIGN_STATUS.md` (which already has `selected_variation`, `approved`, `approved_at` from P3d) with:

```yaml
# PM-track snapshot (added by P3g — used by /fullstack-dev Tier 2 verification)
phase_complete: true
roles: [admin, user, vendor]            # actual detected roles
prd_hash_at_generation: "<sha256>"
prd_version: "v{N}"
html_bundle_hash: "<sha256>"
generated_at: "<ISO8601>"
```

**Field semantics:**
- `phase_complete: true` — P3 fully finished (all sub-steps done)
- `roles` — exact folder names under `design/html/` (sorted)
- `prd_hash_at_generation` — current PRD SHA256 at P3g execution time
- `prd_version` — latest `v{N}` from `prd/history/`
- `html_bundle_hash` — deterministic hash of all HTML in `design/html/**`
- `generated_at` — ISO8601 timestamp

### Step P3.4: Update PIPELINE_STATUS.md

Row key: **`P3-design`** (not `3-design`).

Status=Complete, Score from evaluation, Output=`.claude-project/design/html/<role>/` summary.

## Quality Gate

```yaml
gate: design_approved AND all_html_in_role_folders AND snapshot_recorded AND routing_valid
checks:
  - design_approved:        "DESIGN_STATUS.md approved:true?"
  - phase_complete:         "DESIGN_STATUS.md phase_complete:true?"
  - role_folders_present:   "design/html/<role>/*.html for every role in STATUS.roles?"
  - min_html_per_role:      "Each role folder has ≥ 1 HTML?"
  - snapshot_recorded:      "prd_hash_at_generation, prd_version, html_bundle_hash, roles, generated_at all present?"
  - routing_valid:          "All cross-role hrefs resolve (no broken links)?"
  - shared_consistency:     "Navbar/footer identical across all role folders?"
  - route_coverage:         "Every route in routes.yaml has HTML in a role folder?"
method: "Parse DESIGN_STATUS.md YAML, glob role folders, verify hrefs resolve, diff shared components, compare to routes.yaml"
```

## Gate script

`gates/pm-3-design-gate.sh` (new, role-aware) — see separate file.

## Loop Integration

- **Command**: `/fullstack-pm {project} --phase P3-design --loop`
- **When**: Design QA score < threshold, or role folder coverage incomplete
- **Skill**: `.claude/skills/design/generate-html-gemini/SKILL.md`

## What This Phase Does NOT Do

- ❌ Generate `design-intent.yaml` → D1-init owns extraction
- ❌ Write `docs/PROJECT_*.md` → D2-tech-spec
- ❌ Run user-stories generation → D3-user-stories
- ❌ Run tests or scaffolding → Dev track

## Integration with /fullstack-dev

After this phase completes, `/fullstack-dev <project>` becomes runnable:
- Tier 1: PRD + HTML + `approved: true` all present ✓
- Tier 2: `prd_hash_at_generation` matches current PRD ✓
- Tier 3: role folders present ✓
