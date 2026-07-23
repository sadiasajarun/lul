# Phase 4: Database (Schema Design)

Phase 4 designs the database schema from the PRD entities, creates TypeORM/Prisma entities, generates migrations, and validates the schema compiles cleanly. This phase runs in parallel with Phase 3 (design) since both depend only on Phase 2 (prd).

## Prerequisites

- Phase 2 (prd) complete

## CRITICAL: Architecture Setup (MANDATORY)

Before creating ANY entities, set up the core framework layer:

```
1. Read .claude/$BACKEND/guides/architecture-overview.md for full architecture reference
2. Create src/core/base/ with base classes:
   - base.entity.ts — UUID primary key, timestamps, soft delete
   - base.repository.ts — CRUD data access operations
   - base.service.ts — Business logic methods
   - base.controller.ts — HTTP endpoints with Swagger
3. Create src/core/decorators/ — @Public(), @Roles(), @CurrentUser()
4. Create src/core/guards/ — JwtAuthGuard, RolesGuard
5. Create src/core/filters/ — HttpExceptionFilter
6. Create src/core/interceptors/ — TransformInterceptor, LoggingInterceptor
```

ALL entities MUST extend BaseEntity. ALL future services/controllers/repositories MUST extend their base classes.

## Execution

### Step 4.1: Design Schema from PRD

```
1. Load skill: .claude/$BACKEND/guides/workflow-design-database.md
2. Read PRD entity definitions from:
   - PROJECT_KNOWLEDGE.md (entity list, relationships)
   - PROJECT_DATABASE.md (detailed schema specs)
3. For each entity:
   a. Create TypeORM entity file with:
      - UUID primary key
      - Soft delete support (deletedAt timestamp)
      - Proper column types and decorators
      - Relationship decorators (OneToMany, ManyToOne, ManyToMany)
   b. Define indexes for lookup fields
   c. Apply naming conventions:
      - camelCase for DTOs and TypeScript properties
      - snake_case for database columns
```

### Step 4.2: Create TypeORM Entities

```
1. Write entity files to: backend/src/modules/{module}/entities/{entity}.entity.ts
2. Each entity extends BaseEntity or uses EntitySchema
3. Include:
   - @PrimaryGeneratedColumn('uuid')
   - @CreateDateColumn(), @UpdateDateColumn()
   - @DeleteDateColumn() for soft deletes
   - Proper relationship decorators with cascade options
   - Column validation decorators where applicable
```

### Step 4.3: Generate Migrations

```
1. Generate TypeORM migration from entity definitions
2. Verify migration applies cleanly:
   - Run migration up (apply)
   - Run migration down (rollback)
   - Both should succeed without errors
3. Write migration files to: backend/src/database/migrations/
```

### Step 4.4: Validate Schema

```
1. Run TypeScript compilation: cd backend && npx tsc --noEmit
2. Verify no orphaned entities (all entities participate in at least one relationship)
3. Verify naming consistency across all entity files
4. Verify indexes exist on frequently-queried fields
```

## Quality Gate

```yaml
gate: schema_compiles AND no_orphans
checks:
  - schema_compiles: "TypeORM/Prisma schema has no errors?"
  - no_orphans: "All entities used in at least one relationship?"
  - naming_consistent: "camelCase DTOs, snake_case columns?"
  - indexes_present: "Lookup fields have indexes?"
  - migrations_run: "Migrations apply cleanly?"
method: "Run build, check entity files, verify migration"
```

## Loop Integration

- **Command**: `fullstack {project} --phase database --loop`
- **When**: If schema issues are found (compile errors, orphaned entities, missing indexes)
- **Skill**: `.claude/$BACKEND/guides/workflow-design-database.md`
- **Status file**: `DB_QA_STATUS.md`
- **Completion promise**: `DATABASE_QA_COMPLETE`

### Database QA Checks

```yaml
database-qa:
  stack: $BACKEND
  checks:
    - schema_compiles (run build)
    - no_orphaned_entities (all entities in relationships)
    - naming_conventions (camelCase DTOs, snake_case DB)
    - indexes_present (lookup fields indexed)
    - migrations_clean (apply and rollback without errors)
  per_item: each entity file
  completion_promise: "DATABASE_QA_COMPLETE"
```

---

## Phase Completion — Status Update

**Status updates are handled AUTOMATICALLY by the gate script (`_gate-runner.sh`).**

When the blueprint's `gate` deterministic node runs `bash gates/database-gate.sh`, the gate-runner:
- Updates Progress Table (Status, Score, Output, Gate Run At)
- Updates Gate Results section with check details
- Writes gate proof file to `.gate-proofs/database.proof`
- Appends to Execution Log
- Updates `last_run` and `pipeline_score` in Config

The blueprint's `verify-gate-proof` node confirms the gate ran. **No manual status updates needed.**
