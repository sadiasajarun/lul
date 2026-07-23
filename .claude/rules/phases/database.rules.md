# Database Phase Rules

## Architecture (MANDATORY)
- **MUST follow** the architecture defined in `.claude/$BACKEND/guides/architecture-overview.md`
- Follow TypeORM entity pattern — ALL entities MUST extend `BaseEntity` from `src/core/base/base.entity.ts`
- BaseEntity provides: id (UUID), createdAt, updatedAt, deletedAt — do NOT redefine these fields
- UUID primary keys for all entities ✅ gate: `uuid-primary-keys`
- Soft deletes with `deletedAt` timestamp column (via BaseEntity) ✅ gate: `soft-delete-support`
- Use class-validator decorators on entity fields

## Core Base Classes Setup (MANDATORY)
- Before creating ANY entities, `src/core/base/` MUST exist with:
  - `base.entity.ts` — UUID primary key, timestamps, soft delete
  - `base.repository.ts` — CRUD data access operations
  - `base.service.ts` — Business logic methods
  - `base.controller.ts` — HTTP endpoints with Swagger
- Also set up `src/core/decorators/`, `src/core/guards/`, `src/core/filters/`, `src/core/interceptors/`
- These are framework-level and shared across ALL feature modules

## Naming
- Entity classes: PascalCase (e.g., `User` or `UserEntity`)
- Entity files: kebab-case (e.g., `user.entity.ts`)
- Database columns: snake_case (via @Column({ name: 'column_name' }))
- DTOs: PascalCase (e.g., `CreateUserDto`)
- Relations: camelCase property names
- Enum files: kebab-case + .enum (e.g., `user-role.enum.ts`)

## Directory Structure
- Entities go in: `backend/src/modules/{feature}/` (NOT nested inside `entities/` subfolder)
  - File pattern: `{feature}.entity.ts` (e.g., `user.entity.ts`)
- Shared enums go in: `backend/src/common/enums/` or `backend/src/shared/enums/`
- Base classes go in: `backend/src/core/base/`
- Migrations go in: `backend/src/database/migrations/`

## Quality
- Every entity must participate in at least one relationship (no orphans)
- Lookup fields must have indexes (@Index decorator)
- Migrations must apply and rollback cleanly
- Enum values must be defined as TypeScript enums, not string literals ✅ gate: `prefer-enum-over-string` (WARN)

## Scope Guard
- ONLY create entity files under: backend/src/modules/*/
- ONLY create base classes under: backend/src/core/
- ONLY create migration files under: backend/src/database/migrations/
- Do NOT create controllers, services, repositories, or DTOs (that's Phase 5)
- Do NOT modify frontend files
- Do NOT create test files
