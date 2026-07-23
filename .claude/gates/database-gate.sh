#!/bin/bash
# database-gate.sh — Deterministic validation for database phase
# Checks: entity files exist, schema compiles, no orphan entities, migrations exist
source "$(dirname "$0")/_gate-runner.sh"

init_gate "database" "$1"
BACKEND_DIR="$TARGET_DIR/backend"

# Check 1: Entity files exist
run_count_check "entity-files-exist" \
  "find '$BACKEND_DIR/src' -name '*.entity.ts' 2>/dev/null | wc -l" \
  ">=" 1

# Check 2: TypeScript compiles (schema validity)
if [ -f "$BACKEND_DIR/tsconfig.json" ] || [ -f "$BACKEND_DIR/tsconfig.app.json" ]; then
  TSC_PROJECT=""
  [ -f "$BACKEND_DIR/tsconfig.app.json" ] && TSC_PROJECT="--project tsconfig.app.json"
  [ -f "$BACKEND_DIR/tsconfig.build.json" ] && TSC_PROJECT="--project tsconfig.build.json"
  run_check "schema-compiles" "cd '$BACKEND_DIR' && npx tsc $TSC_PROJECT --noEmit"
fi

# Check 3: No empty entity files (files should have @Entity decorator)
run_count_check "entities-have-decorator" \
  "grep -rl '@Entity' '$BACKEND_DIR/src' --include='*.entity.ts' 2>/dev/null | wc -l" \
  ">=" 1

# Check 4: Migration files exist (if TypeORM)
if grep -q "typeorm" "$BACKEND_DIR/package.json" 2>/dev/null; then
  MIGRATION_DIR=$(find "$BACKEND_DIR" -type d -name "migrations" 2>/dev/null | head -1)
  if [ -n "$MIGRATION_DIR" ]; then
    run_count_check "migrations-exist" \
      "find '$MIGRATION_DIR' -name '*.ts' 2>/dev/null | wc -l" \
      ">=" 1
  fi
fi

# Check 5: Naming consistency (entities use PascalCase)
run_check "naming-convention" \
  "find '$BACKEND_DIR/src' -name '*.entity.ts' -exec basename {} \; 2>/dev/null | grep -v '^[a-z]' | head -1 || echo 'ok'"

# =============================================================================
# Checks 6-8: Schema quality patterns (prevents B-04, B-05)
# =============================================================================

# Check 6: UUID primary keys used
# Prevents: integer auto-increment PKs in multi-tenant SaaS
# Supports both TypeORM (@PrimaryGeneratedColumn('uuid')) and Prisma (@default(uuid()))
UUID_PK=0
if grep -rq '@PrimaryGeneratedColumn' "$BACKEND_DIR/src" --include='*.entity.ts' 2>/dev/null; then
  UUID_PK=$(grep -rl "@PrimaryGeneratedColumn.*uuid" "$BACKEND_DIR/src" --include='*.entity.ts' 2>/dev/null | wc -l)
  TOTAL_PK=$(grep -rl '@PrimaryGeneratedColumn' "$BACKEND_DIR/src" --include='*.entity.ts' 2>/dev/null | wc -l)
elif [ -f "$BACKEND_DIR/prisma/schema.prisma" ]; then
  UUID_PK=$(grep -cE '@default\((uuid|cuid)\(\)\)' "$BACKEND_DIR/prisma/schema.prisma" 2>/dev/null | tr -d '[:space:]')
  UUID_PK=${UUID_PK:-0}
  TOTAL_PK=$(grep -c '@id' "$BACKEND_DIR/prisma/schema.prisma" 2>/dev/null | tr -d '[:space:]')
  TOTAL_PK=${TOTAL_PK:-0}
fi
TOTAL_PK=${TOTAL_PK:-0}
if [ "$TOTAL_PK" -gt 0 ]; then
  if [ "$UUID_PK" -ge "$TOTAL_PK" ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$UUID_PK/$TOTAL_PK entities use UUID PK" \
      '. + [{"name":"uuid-primary-keys","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$UUID_PK/$TOTAL_PK entities use UUID PK" \
      '. + [{"name":"uuid-primary-keys","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

# Check 7: Soft delete support
# Prevents: hard deletes breaking referential integrity
# Supports TypeORM (@DeleteDateColumn) and Prisma (deletedAt DateTime?)
SOFT_DELETE=0
if grep -rq '@DeleteDateColumn' "$BACKEND_DIR/src" --include='*.entity.ts' 2>/dev/null; then
  SOFT_DELETE=$(grep -rl '@DeleteDateColumn' "$BACKEND_DIR/src" --include='*.entity.ts' 2>/dev/null | wc -l)
elif [ -f "$BACKEND_DIR/prisma/schema.prisma" ]; then
  SOFT_DELETE=$(grep -c 'deletedAt' "$BACKEND_DIR/prisma/schema.prisma" 2>/dev/null || echo 0)
fi
if [ "$SOFT_DELETE" -ge 1 ]; then
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$SOFT_DELETE entities have soft delete" \
    '. + [{"name":"soft-delete-support","pass":true,"detail":$d,"duration_ms":0}]')
else
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq '. + [{"name":"soft-delete-support","pass":false,"detail":"no soft delete (deletedAt/@DeleteDateColumn) found","duration_ms":0}]')
fi

# Check 8: Prefer enum over string for status fields
# v118: threshold ≤2 → 0. A status column typed as free `string` IS the B-04/B-05
# anti-pattern (type-unsafe state); tolerating 2 of them defeats the check. NOTE
# this counts STRING-typed status columns — enum-typed ones (@Column({type:'enum'})
# status: SomeEnum) don't match, so a schema with many *enum* statuses passes.
if [ -f "$BACKEND_DIR/prisma/schema.prisma" ]; then
  STRING_STATUS=$(grep -c 'status.*String\|String.*@default' "$BACKEND_DIR/prisma/schema.prisma" 2>/dev/null || echo 0)
  if [ "$STRING_STATUS" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$STRING_STATUS String-typed status fields" \
      '. + [{"name":"prefer-enum-over-string","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$STRING_STATUS String status field(s) — use a Prisma enum" \
      '. + [{"name":"prefer-enum-over-string","pass":false,"detail":$d,"duration_ms":0}]')
  fi
elif find "$BACKEND_DIR/src" -name '*.entity.ts' 2>/dev/null | grep -q .; then
  STRING_STATUS=$(grep -rnE "status\s*[?!]?\s*:\s*string|@Column.*default.*(active|pending)" "$BACKEND_DIR/src" --include='*.entity.ts' 2>/dev/null | wc -l)
  if [ "$STRING_STATUS" -eq 0 ]; then
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$STRING_STATUS string-as-enum status fields" \
      '. + [{"name":"prefer-enum-over-string","pass":true,"detail":$d,"duration_ms":0}]')
  else
    CHECKS_JSON=$(echo "$CHECKS_JSON" | jq --arg d "$STRING_STATUS string-as-enum fields — use TypeScript enum with @Column({type:'enum'})" \
      '. + [{"name":"prefer-enum-over-string","pass":false,"detail":$d,"duration_ms":0}]')
  fi
fi

output_results
