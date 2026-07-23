# SPEC schema — input to deterministic generators

The pipeline's deterministic generators read two structured YAML files emitted
by LLM agents from the canonical PRD/PROJECT_API.md/PROJECT_DATABASE.md docs:

- `MODULE_PLAN.yaml` — **backend** spec. One per project. Lists CRUD modules,
  non-CRUD modules, plus optional `auth`, `workflows`, `uploads` sections.
- `PAGES_PLAN_<frontend>.yaml` — **frontend** spec. One per frontend dir
  (worker, admin-dashboard, company-dashboard). Lists CRUD page-sets, plus
  optional `auth_pages`, `workflow_pages`, `upload_pages`, `dashboards`.

The example files (`.claude/nestjs/templates/modules/_crud/MODULE_PLAN.example.yaml`,
`.claude/react/templates/modules/_crud/PAGES_PLAN.example.yaml`) are the
authoritative shape reference. The LLM emit prompts (`emit-module-plan`,
`emit-pages-plan`) cite them.

## Top-level sections (MODULE_PLAN.yaml)

| Section | Required | Generator | Status |
|---|---|---|---|
| `modules: []` | ✅ | `scaffold-crud-modules` | shipped (v62) |
| `non_crud_modules: []` | optional | LLM-implement (manual) | shipped |
| `auth: {}` | optional | `scaffold-auth-module` | template shipped (v65), wiring pending |
| `workflows: []` | optional | `scaffold-workflow-module` | planned v66 |
| `uploads: []` | optional | `scaffold-upload-module` | planned v66 |

## Top-level sections (PAGES_PLAN_<frontend>.yaml)

| Section | Required | Generator | Status |
|---|---|---|---|
| `modules: []` | ✅ | `scaffold-crud-pages` | shipped (v62) |
| `auth_pages: {}` | optional | `scaffold-auth-pages` | planned v66 |
| `workflow_pages: []` | optional | `scaffold-workflow-pages` | planned v66 |
| `upload_pages: []` | optional | `scaffold-upload-pages` | planned v66 |
| `dashboards: []` | optional | `scaffold-dashboard-pages` | planned v66 |

## Design principles

1. **Templates generate framework code. LLMs emit business logic + the SPEC.**
   The LLM's job shrinks to: extract a structured SPEC from PRD → write a
   small number of genuinely custom modules (state-machine action handlers,
   custom validations, ad-hoc reports).

2. **Each section is independently optional.** Projects without auth (rare)
   omit the `auth:` block. Projects without workflows omit `workflows:`.
   Generators no-op cleanly on missing sections.

3. **Cross-section consistency.** PAGES_PLAN field shapes MUST be a subset of
   MODULE_PLAN fields (emit-pages-plan prompt enforces this). Workflow
   transitions reference workflow states. Auth `user_entity` must exist as a
   MODULE_PLAN entry.

4. **One spec file per concern.** MODULE_PLAN is per-project, PAGES_PLAN is
   per-frontend. Avoids a single monolithic SPEC.yaml getting overloaded.

5. **Templates and emit-prompts evolve together.** When we add a new section
   (e.g. `dashboards:`), we ship the template + generator + a corresponding
   "EXTRACTION RULES" addition in the emit-prompt.

## Section schemas

### `auth:` (MODULE_PLAN.yaml)

```yaml
auth:
  user_entity: User                    # PascalCase class name
  user_entity_module: user             # kebab-case module dir
  identifier_field: email              # what users log in with
  password_field: passwordHash         # column name on User entity
  roles: [user, manager, admin]        # values for RoleEnum
  access_ttl: '1h'                     # JWT access token TTL
  refresh_ttl: '7d'                    # JWT refresh token TTL
  signup_fields:                       # fields accepted by POST /auth/signup
    - name: email
      type: string
      validators: [IsEmail, IsNotEmpty]
      swagger: { description: "Login email", example: "u@example.com" }
    - name: name
      type: string
      validators: [IsString, IsNotEmpty, MaxLength:100]
    - name: role
      type: enum
      enumName: RoleEnum
      enumImport: '../../common/enums/role.enum'
      validators: [IsEnum:RoleEnum]
```

Generator output: `src/modules/auth/{controller,service,module}.ts +
dtos/{login,signup,auth-response}.dto.ts`. Endpoints: POST `/auth/signup`,
POST `/auth/login`, POST `/auth/refresh`, POST `/auth/logout`, GET
`/auth/me`. httpOnly cookies, bcrypt password storage, refresh token rotation.

### `workflows:` (MODULE_PLAN.yaml) — planned v66

```yaml
workflows:
  - name: application-lifecycle
    entity: Application                 # the entity whose state column holds the workflow
    state_field: currentState
    initial: received
    states: [received, reviewing, approved, rejected, supplement_requested, cancelled]
    transitions:
      - { from: received, to: reviewing,            action: startReview,  guard: 'role.admin' }
      - { from: reviewing, to: approved,            action: approve,      guard: 'role.admin' }
      - { from: reviewing, to: rejected,            action: reject,       guard: 'role.admin' }
      - { from: reviewing, to: supplement_requested, action: requestMore, guard: 'role.admin' }
      - { from: '*',       to: cancelled,           action: cancel,       guard: 'role.admin OR role.applicant' }
```

Generator output: `src/modules/<entity>/<entity>.workflow.ts` (state machine
class), DTOs per action, `<entity>.controller.ts` actions wired
(POST `/applications/:id/<action>`). Guards reference `RoleEnum` or
custom predicates.

### `uploads:` (MODULE_PLAN.yaml) — planned v66

```yaml
uploads:
  - name: document
    entity: Document                    # entity that owns the file metadata
    storage: s3                         # s3 | local
    max_size_mb: 10
    allowed_mime: [image/png, image/jpeg, application/pdf]
    fields:                             # additional columns on the Document entity
      - { name: title, type: string, validators: [IsString, IsNotEmpty] }
      - { name: category, type: string, validators: [IsOptional, IsString] }
```

Generator output: `src/modules/<name>/{controller,service,module}.ts` with
POST upload (FileInterceptor), GET list, GET :id/download, DELETE :id.
Storage adapter selected by `storage:` value (S3FileStorageService /
LocalFileStorageService — both from `infrastructure/file-storage/`).

### `auth_pages:` (PAGES_PLAN_<frontend>.yaml) — planned v66

```yaml
auth_pages:
  login: true                          # /login page
  signup: true                         # /signup page (use false if signup disabled)
  forgot_password: true                # /forgot-password + /reset-password
  verify_email: false                  # /verify-email
```

Generator output: pages under `app/pages/auth/`, routes registered, redux
slice updated, wired to backend `/auth/*` endpoints from the SPEC's `auth:`
section.

### `workflow_pages:` (PAGES_PLAN_<frontend>.yaml) — planned v66

```yaml
workflow_pages:
  - workflow: application-lifecycle     # references MODULE_PLAN.workflows[].name
    list_columns: [id, applicant, currentState, updatedAt]
    transition_buttons: [startReview, approve, reject, cancel]
    role_required: admin
```

Generator output: List page showing entities grouped by state, per-entity
detail page with transition buttons (only buttons whose `from:` matches the
current state are enabled), redux slice handles transition mutations.

### `upload_pages:` (PAGES_PLAN_<frontend>.yaml) — planned v66

```yaml
upload_pages:
  - upload: document                    # references MODULE_PLAN.uploads[].name
    list: true                          # list of uploaded files
    upload_form: true                   # POST upload form
    role_required: user
```

### `dashboards:` (PAGES_PLAN_<frontend>.yaml) — planned v66

```yaml
dashboards:
  - name: admin-overview
    route: /admin                       # the dashboard's route
    role_required: admin
    cards:
      - title: "Today's Applications"
        query: 'count:applications,where:createdAt>=today()'
      - title: "Pending Reviews"
        query: 'count:applications,where:currentState=reviewing'
      - title: "Active Workers"
        query: 'count:users,where:role=user AND active=true'
    charts:
      - title: "Applications over Time (30d)"
        type: line                      # line | bar | pie
        query: 'count:applications,group:day,window:30d'
```

Generator output: A `<name>.page.tsx` with `<KpiCard>` and `<Chart>`
components fed by `useDashboardQuery(spec)` hook. Backend gets a generic
`/dashboard/query` endpoint that interprets the query DSL.

## Migration path (incremental)

Each section ships independently:
1. **v62-v65 (done)**: `modules:` + `non_crud_modules:`
2. **v66**: wire `auth:` (generator already shipped in v65)
3. **v67**: ship `workflows:` + `uploads:`
4. **v68**: ship `dashboards:`

After v68, the LLM's actual code-writing surface for FSP shrinks from "12
modules + 28 pages" to "extract SPEC.yaml + ~3 custom flows". That's ~10× less
LLM tokens per run, and equivalent reductions in variance.

## Verification

Each generator MUST:
- No-op cleanly when the corresponding section is missing/empty
- Be idempotent (re-running on the same SPEC produces the same output)
- Preserve LLM customizations (don't overwrite a file the LLM modified)
- Smoke-test in CI against `*.example.yaml`

The emit-prompts MUST cite the example as the authoritative shape reference,
and explicitly warn the LLM about cross-section consistency requirements.
