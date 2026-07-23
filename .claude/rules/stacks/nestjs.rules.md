# NestJS Stack Rules

## Architecture (MANDATORY)

- **MUST follow** the architecture defined in `.claude/$BACKEND/guides/architecture-overview.md` — this is the single source of truth for backend structure
- **MUST Read** `.claude/$BACKEND/guides/nestjs-backend-guide.md` — general NestJS reference, navigation guide linking all detailed guides
- **MUST Read** `.claude/$BACKEND/guides/best-practices.md` before writing any backend code — coding standards, critical rules
- Four-layer pattern: Controller -> Service -> Repository -> Entity
- ALL layers MUST extend Base Classes from `src/core/base/`
- Reference `.claude/$BACKEND/skills/api-development/SKILL.md` when creating new modules

## Directory Structure (MANDATORY)

```
src/
├── core/                          # Framework-level code (ALL features use)
│   ├── base/                      # Base classes (MUST EXTEND)
│   │   ├── base.entity.ts        # UUID, timestamps, soft delete
│   │   ├── base.repository.ts    # CRUD data access operations
│   │   ├── base.service.ts       # Business logic methods
│   │   └── base.controller.ts    # HTTP endpoints with Swagger
│   ├── decorators/                # Custom decorators
│   │   ├── current-user.decorator.ts
│   │   ├── public.decorator.ts
│   │   └── roles.decorator.ts
│   ├── filters/                   # Exception filters
│   │   └── http-exception.filter.ts
│   ├── guards/                    # Global guards
│   │   ├── jwt-auth.guard.ts
│   │   └── roles.guard.ts
│   ├── interceptors/              # Global interceptors
│   │   ├── transform.interceptor.ts
│   │   └── logging.interceptor.ts
│   └── pipes/                     # Global pipes
│       └── validation.pipe.ts
├── modules/                       # Feature modules (one per domain)
│   └── {feature}/
│       ├── {feature}.entity.ts
│       ├── {feature}.repository.ts
│       ├── {feature}.service.ts
│       ├── {feature}.controller.ts
│       ├── {feature}.module.ts
│       └── dtos/
│           ├── create-{feature}.dto.ts
│           ├── update-{feature}.dto.ts
│           └── {feature}-response.dto.ts
├── infrastructure/                # External services
│   ├── mail/
│   ├── s3/
│   ├── token/
│   └── logging/
├── database/
│   └── migrations/
└── main.ts
```

## Module Structure (MANDATORY)

- Each feature in its own module: `backend/src/modules/{feature}/`
- Module MUST have 5 files: entity, repository, service, controller, module
- DTOs in `dtos/` subfolder (plural: `dtos/`, NOT `dto/`)
- Use barrel exports (index.ts) for each module
- Register all modules in AppModule

## Base Classes (MANDATORY)

- Entity MUST extend `BaseEntity` from `src/core/base/base.entity.ts` — provides id (UUID), createdAt, updatedAt, deletedAt
- Repository MUST extend `BaseRepository<Entity>` from `src/core/base/base.repository.ts` — provides findById, findAll, create, update, softDelete
- Service MUST extend `BaseService<Entity>` from `src/core/base/base.service.ts` — provides findByIdOrFail, findAll, create, update, remove
- Controller MUST extend `BaseController<Entity, CreateDto, UpdateDto>` from `src/core/base/base.controller.ts` — provides full CRUD endpoints with Swagger

## Core Directory (MANDATORY)

- **MUST Read** `.claude/$BACKEND/guides/middleware-guide.md` before writing middleware — guards, interceptors, pipes, exception filters
- `core/decorators/` — Custom decorators: @Public(), @Roles(), @CurrentUser()
- `core/guards/` — Global guards: JwtAuthGuard, RolesGuard
- `core/filters/` — Exception filters: HttpExceptionFilter
- `core/interceptors/` — TransformInterceptor (wrap responses), LoggingInterceptor
- `core/pipes/` — ValidationPipe configuration
- Guards/decorators MUST NOT live inside feature modules — they belong in `core/`

## Coding Patterns (MANDATORY)

### Controller Pattern

- **MUST Read** `.claude/$BACKEND/guides/routing-and-controllers.md` before writing controllers
- **MUST Read** `.claude/$BACKEND/guides/update-swagger.md` before documenting APIs — Swagger decorators, DTO documentation
- Controllers ONLY: define routes, extract request data, delegate to service, return responses
- Controllers NEVER: contain business logic, access database, handle complex validations
- Use `@ApiSwagger()` decorator for Swagger documentation
- Use `ParseUUIDPipe` for all `:id` route params
- Override base CRUD methods only when custom behavior is needed

### Service Pattern

- **MUST Read** `.claude/$BACKEND/guides/services-and-repositories.md` before writing services
- Services contain business logic: validation, orchestration, rules enforcement
- Services NEVER: know about HTTP (Request/Response), access TypeORM directly (use repository)
- Pass repository AND entity name to `super(repository, 'EntityName')`
- Use `this.repository` for all data access — NEVER inject TypeORM `Repository<T>` directly in service
- Override `defaultRelations` property for eager-loaded relations
- Use NestJS exceptions: `ConflictException`, `NotFoundException`, `ForbiddenException`, `BadRequestException`

### Repository Pattern

- Repositories handle ALL TypeORM operations: queries, creates, updates, deletes
- Inject TypeORM `Repository<T>` with `@InjectRepository(Entity)` and pass to `super(repository)`
- Add custom query methods for domain-specific needs (e.g., `findByEmail`, `findActive`)
- Use `this.repository.find()`, `this.repository.createQueryBuilder()` for custom queries
- NEVER put business logic in repositories

### Entity Pattern

- **MUST Read** `.claude/$BACKEND/guides/database-patterns.md` before writing entities
- Entities define database schema ONLY: columns, relationships, constraints
- Use TypeORM decorators: `@Entity`, `@Column`, `@ManyToOne`, `@OneToMany`, `@JoinColumn`, `@Index`
- Relations: always specify `{ onDelete: 'CASCADE' }` or appropriate cascade
- Separate foreign key column: `@Column({ name: 'user_id' }) userId: string`
- NEVER put business logic or validation logic in entities (use DTOs)

### DTO Pattern

- **MUST Read** `.claude/$BACKEND/guides/validation-patterns.md` before writing DTOs
- DTOs validate ALL user input with `class-validator` decorators
- Create DTO: all required fields with validation (`@IsString()`, `@IsEmail()`, `@IsNotEmpty()`)
- Update DTO: extend `PartialType(CreateDto)` for optional fields
- Response DTO: explicit shape for API responses (exclude sensitive fields like password)
- Use `@ApiProperty()` for Swagger documentation on every DTO field

### Module Pattern

- Each module: `imports` (TypeOrmModule.forFeature), `controllers`, `providers` (service + repository), `exports` (service)
- Register ALL modules in `AppModule`

## Authentication & Authorization

- **MUST Read** `.claude/$BACKEND/guides/authentication-cookies.md` before implementing auth
- **MUST Read** `.claude/$BACKEND/guides/setup-role-base-access.md` before implementing RBAC — roles, guards, JWT integration
- JWT httpOnly cookies — NEVER localStorage (XSS vulnerable)
- Cookie config: `httpOnly: true, secure: true, sameSite: 'strict'`
- JwtStrategy extracts token from cookie first, Bearer header as fallback
- Guards: JwtAuthGuard, RolesGuard — defined in `core/guards/`
- Decorators: @Public(), @Roles(RoleEnum.admin), @CurrentUser() — defined in `core/decorators/`
- All routes protected by default — mark public with @Public()
- SetTokenInterceptor: sets cookies on login/refresh responses

## WebSocket Gateways

- **MUST Read** `.claude/$BACKEND/guides/websocket-gateway.md` before implementing real-time features — WebSocket gateway, Socket.io, event handling, room management
- Gateways sit in `src/modules/{feature}/` alongside controllers — they do NOT extend base classes
- Gateway MUST authenticate via httpOnly cookie extraction in `handleConnection()`
- Gateway MUST be registered as a provider in the feature module
- Use `@SubscribeMessage()` for incoming events, `server.to(room).emit()` for outgoing
- Install: `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `cookie`

## Error Handling

- **MUST Read** `.claude/$BACKEND/guides/async-and-errors.md` before writing async code — async/await patterns, error handling
- Use NestJS built-in exception filters
- HttpException subclasses: NotFoundException, BadRequestException, ConflictException, ForbiddenException
- Validation pipe globally enabled with class-validator
- Always return consistent error response format via TransformInterceptor
- All responses wrapped in `ResponsePayloadDto`: `{ success, statusCode, message, data, timestamp, path }`

## Database

- TypeORM with PostgreSQL
- UUID primary keys via BaseEntity (@PrimaryGeneratedColumn('uuid'))
- Soft delete support via BaseEntity (@DeleteDateColumn())
- BaseEntity provides: id, createdAt, updatedAt, deletedAt
- Repository pattern — NEVER query directly in services, use repository layer
- No raw SQL queries — use TypeORM QueryBuilder or repository methods

## Configuration

- **MUST Read** `.claude/$BACKEND/guides/configuration.md` before managing config — UnifiedConfig pattern for env/secrets

## Monitoring

- **MUST Read** `.claude/$BACKEND/guides/sentry-and-monitoring.md` before adding monitoring — Sentry v8 error tracking, performance

## Testing

- **MUST Read** `.claude/$BACKEND/guides/testing-guide.md` before writing tests — Jest patterns, mocking, best practices

## Workflows

- **MUST Read** `.claude/$BACKEND/guides/workflow-convert-prd-to-knowledge.md` before converting PRD — structured PROJECT_KNOWLEDGE.md generation
- **MUST Read** `.claude/$BACKEND/guides/workflow-design-database.md` before designing database — TypeORM + PostgreSQL schema design
- **MUST Read** `.claude/$BACKEND/guides/workflow-generate-api-docs.md` before generating API docs — Markdown docs from controllers/DTOs
- **MUST Read** `.claude/$BACKEND/guides/workflow-generate-e2e-tests.md` before generating e2e tests — test generation for controllers
- **MUST Read** `.claude/$BACKEND/guides/workflow-implement-redis-caching.md` before adding caching — Redis with @Cacheable/@CacheInvalidate

## Naming Conventions

- Entity classes: PascalCase (`UserEntity` or `User`)
- Entity files: kebab-case (`user.entity.ts`)
- Repository files: kebab-case (`user.repository.ts`)
- Service files: kebab-case (`user.service.ts`)
- Controller files: kebab-case (`user.controller.ts`)
- Module files: kebab-case (`user.module.ts`)
- DTO folder: `dtos/` (plural)
- Database columns: snake_case (via @Column({ name: 'column_name' }))
- DTOs: PascalCase (`CreateUserDto`)
- Relations: camelCase property names
