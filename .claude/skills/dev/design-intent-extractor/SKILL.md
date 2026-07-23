---
skill_name: design-intent-extractor
applies_to_local_project_only: false
auto_trigger_regex: [design intent, extract design, html intent, design to spec, intent extraction]
tags: [design, html, parsing, spec, pm-dev-handoff]
related_skills: [generate-prd, workflow-convert-prd-to-knowledge]
---

# Design Intent Extractor

Parse approved design HTML files to produce `design-intent.yaml` — a machine-readable interpretation of the visual design. Used by `D1-init` in `/fullstack-dev` to bridge PM (HTML mockups) and Dev (tech spec). Output is editable so engineers can correct heuristic misses before `D2-tech-spec` runs.

---

## When to Use

- Running `/fullstack-dev` and design HTML exists but `design-intent.yaml` is missing or stale
- Design HTML bundle hash changed since last extraction → re-extract
- Engineer wants to manually regenerate intent after editing HTML

## Inputs

- HTML tree: `{TARGET_DIR}/.claude-project/design/html/**/*.html` (role folders OR flat)
- PRD (optional context): `{TARGET_DIR}/.claude-project/docs/PRD.md` or `.claude-project/prd/*.md`
- DESIGN_STATUS.md (optional): for declared roles list

## Output

Single file: `{TARGET_DIR}/.claude-project/design/design-intent.yaml`

---

## Extraction Heuristics

### 1. Screen Inventory
- One entry in `screens:` per HTML file
- `file:` = relative path from TARGET_DIR
- `role:` = first path segment under `design/html/` (e.g. `admin` from `design/html/admin/dashboard.html`). If HTML is flat at `design/html/*.html`, role = `app`.

### 2. Endpoint Inference
Scan HTML for URLs that look like API calls:

- `<a href="/api/...">`, `<form action="/api/...">`, `<button data-api="...">`
- JS literals inside `<script>` blocks: `fetch('/api/...')`, `axios.get('/api/...')`, `axios({ url: '/api/...' })`
- Meta tags: `<meta name="api-endpoint" content="...">`

For each discovered URL:
- Determine method: form's `method` attr (default POST), `<a>`/`<button>` default GET, explicit `axios.post|put|patch|delete` maps to verb
- Record as `{ method, path }` pair
- Deduplicate per screen

### 3. Form Inference
For every `<form>` element in a screen:
- `name:` = `<form id>`, `<form name>`, or derived from surrounding `<h1>/<h2>`
- `fields:` = one entry per `<input>`, `<select>`, `<textarea>`:
  - `name:` from `name` attribute
  - `type:` from `type` attribute (`text`, `email`, `password`, `number`, `file`, `date`, etc.)
  - `required:` from `required` attribute
  - `pattern:` from `pattern` attribute (preserve regex)
  - `options:` (for `<select>`) list of `<option value>` values

### 4. Realtime Hints
Flag screens likely needing WebSocket/SSE:
- `data-sse="..."`, `data-ws="..."`, `data-realtime="..."` attributes
- `new EventSource(...)`, `new WebSocket(...)` in script
- Surface as `realtime_hints:` = list of channel names (from attr value or URL)

### 5. Role Resolution
Priority order:
1. PRD `user_type: [...]` list if present
2. Folder names under `design/html/` (deduped)
3. Fallback: single role `app`

Record in top-level `roles_summary:` with counts (screens, endpoints, forms, realtime).

### 6. TBD Collection
Any parsing ambiguity goes into `screens[].tbd:` as raw strings:
- Href pattern matches API prefix but path has template literals (e.g. `${id}`)
- Form without name or fields
- JS with dynamic URLs (variable interpolation)
- Comments hinting at API (e.g. `<!-- TODO: wire to /api/x -->`)

Engineers edit these post-hoc and re-run D2.

---

## Output Format

```yaml
# Auto-extracted by design-intent-extractor skill.
# Editable — engineers may correct TBD items and add missing intents before D2-tech-spec.

generated_at: "2026-04-17T03:22:10Z"
source:
  prd_hash: "<sha256>"
  html_bundle_hash: "<sha256>"              # sha256 of (sorted file paths + contents)
  html_files:
    - { path: "design/html/admin/dashboard.html", hash: "<sha>" }
    - { path: "design/html/admin/users.html", hash: "<sha>" }
    - { path: "design/html/user/profile.html", hash: "<sha>" }

screens:
  - file: "design/html/admin/dashboard.html"
    role: "admin"
    endpoints_inferred:
      - { method: "GET", path: "/api/admin/stats" }
      - { method: "GET", path: "/api/admin/recent-events" }
    forms_inferred: []
    realtime_hints: ["recent-events"]
    tbd: []

  - file: "design/html/admin/users.html"
    role: "admin"
    endpoints_inferred:
      - { method: "GET",  path: "/api/admin/users" }
      - { method: "POST", path: "/api/admin/users/:id/ban" }
    forms_inferred:
      - name: "ban-user"
        fields:
          - { name: "user_id", type: "string", required: true, pattern: null, options: null }
          - { name: "reason",  type: "text",   required: false, pattern: null, options: null }
    realtime_hints: []
    tbd:
      - "onclick='unbanUser(${userId})' — path template variable, verify endpoint"

roles_summary:
  admin: { screens: 4, endpoints: 12, forms: 3, realtime: 2 }
  user:  { screens: 3, endpoints: 7,  forms: 2, realtime: 0 }
```

---

## Execution

```bash
# 1. Compute source hashes
PRD_FILE="{TARGET_DIR}/.claude-project/docs/PRD.md"
[ -f "$PRD_FILE" ] || PRD_FILE=$(ls {TARGET_DIR}/.claude-project/prd/*.md 2>/dev/null | head -1)
PRD_HASH=$(sha256sum "$PRD_FILE" 2>/dev/null | awk '{print $1}')

HTML_ROOT="{TARGET_DIR}/.claude-project/design/html"
HTML_FILES=$(find "$HTML_ROOT" -name '*.html' -type f | sort)
BUNDLE_HASH=$(echo "$HTML_FILES" | xargs -I {} sh -c 'echo "{}"; cat "{}"' | sha256sum | awk '{print $1}')

# 2. Parse each HTML file (agentic step — LLM applies heuristics above)
# 3. Aggregate into design-intent.yaml
# 4. Write output

mkdir -p "{TARGET_DIR}/.claude-project/design"
# ... produce yaml ...
```

The agentic step reads each HTML file and emits structured data. Small projects fit into one LLM call. For >20 screens, chunk by role folder.

---

## Validation

Before returning, verify output:

1. `generated_at` ISO8601
2. `source.prd_hash` non-empty (or null if no PRD)
3. `source.html_bundle_hash` non-empty
4. Every HTML file in `html_root` appears in `screens[].file`
5. Each screen has `role` (never null)
6. `roles_summary` totals match per-screen counts

If any check fails, abort and report — do not write partial intent.

---

## Re-run Detection

If `design-intent.yaml` already exists:

1. Read existing `source.html_bundle_hash`
2. Compute current bundle hash
3. If equal → no re-run needed. Skip and report "intent up to date."
4. If different → regenerate (preserving `tbd:` annotations manually made by engineers is NOT attempted — engineers re-edit after regeneration).

---

## Failure Modes

- **No HTML files found**: Abort with "No HTML in .claude-project/design/html/. Run `/fullstack-pm <project>` or drop HTML manually."
- **HTML parses but no endpoints/forms found**: Still succeed, write intent with empty arrays. Engineers add manually.
- **Role folder ambiguity** (e.g. flat + some role subfolders mixed): Treat role subfolders as roles, flat files as `role: app`. Warn in stdout.
