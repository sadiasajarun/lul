# Project Result Report — Agent Prompt Specifications

This file defines agent configurations and prompts for the generate-project-report command.

---

## Hallucination Prevention Rules (All Agents)

Every agent MUST follow these rules strictly:

1. **ONLY state facts verified from actual code/config files** — no assumptions, generalizations, or inferences
2. **Tag every finding with its source file path** — e.g., `[source: package.json]`, `[source: src/auth/auth.module.ts]`
3. **Mark unverifiable items with `[⚠️ 확인 필요]`** — production URLs, server specs, cloud details not in config
4. **Extract exact versions** from config files — never write "latest" or approximate versions
5. **Count endpoints by actually counting route decorators/definitions** — never estimate
6. **Never fabricate package names, versions, or features** that don't exist in the scanned files
7. **If a section has no data, write "해당 없음" (N/A)** — do not fill with generic content

---

## Framework Detection Table

Before analysis, detect the project's framework stack by checking these signals:

| Framework | Detection Signal | File Patterns for Analysis |
|-----------|-----------------|---------------------------|
| NestJS | `@nestjs/core` in package.json | `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.gateway.ts`, `*.entity.ts` |
| Express | `express` in package.json (without `@nestjs`) | `routes/*.js`, `*.router.js`, `controllers/*.js` |
| Fastify | `fastify` in package.json | `routes/*.js`, `*.route.js` |
| FastAPI | `fastapi` in requirements.txt | `routers/*.py`, `main.py`, `models/*.py` |
| Django | `django` in requirements.txt | `views.py`, `urls.py`, `models.py`, `serializers.py` |
| Flask | `flask` in requirements.txt | `app.py`, `routes/*.py` |
| Spring Boot | `spring-boot` in pom.xml/build.gradle | `*Controller.java`, `*Service.java`, `*Entity.java`, `*Repository.java` |
| Laravel | `laravel/framework` in composer.json | `*Controller.php`, `routes/*.php`, `app/Models/*.php` |
| Go (Gin) | `gin-gonic/gin` in go.mod | `*.go`, `handlers/*.go`, `routes/*.go` |
| Go (Echo) | `labstack/echo` in go.mod | `*.go`, `handlers/*.go` |
| Ruby on Rails | `rails` in Gemfile | `app/controllers/*.rb`, `app/models/*.rb`, `config/routes.rb` |
| React | `react` in package.json | `src/**/*.tsx`, `src/**/*.jsx`, `src/routes.*`, `src/App.*` |
| Vue | `vue` in package.json | `src/**/*.vue`, `src/router/*` |
| Angular | `@angular/core` in package.json | `src/**/*.component.ts`, `src/**/*.module.ts` |
| Svelte | `svelte` in package.json | `src/**/*.svelte` |
| Next.js | `next` in package.json | `pages/**/*`, `app/**/*` |
| Nuxt | `nuxt` in package.json | `pages/**/*.vue` |
| Flutter | `flutter` in pubspec.yaml | `lib/**/*.dart` |
| React Native | `react-native` in package.json | `src/**/*.tsx`, `App.tsx` |
| **Fallback** | None detected | Scan all source files for route/model/controller naming patterns |

---

## Agent 1: repo-scanner

**Model**: sonnet
**Role**: Scan repository structure, detect frameworks, extract project metadata

### Input
- Repository root path(s) — one or more local directories

### Scan Targets
Read these files (if they exist):
- `README.md`, `README.rst`, `README`
- `package.json`, `package-lock.json`
- `pubspec.yaml`, `pubspec.lock`
- `requirements.txt`, `Pipfile`, `pyproject.toml`
- `go.mod`, `go.sum`
- `pom.xml`, `build.gradle`, `build.gradle.kts`
- `composer.json`
- `Cargo.toml`
- `Gemfile`
- `Dockerfile`, `docker-compose.yml`, `docker-compose.yaml`
- `.github/workflows/*.yml`, `.github/workflows/*.yaml`
- `Jenkinsfile`, `.gitlab-ci.yml`
- `.env.example`, `.env.sample`, `.env.template`
- `Makefile`
- `tsconfig.json`
- `nest-cli.json`

### Output Format: `intermediate/repo-metadata.md`

```markdown
# Repository Metadata

## Project Identity
- **Name**: {from package.json name / pubspec.yaml name / README title / directory name}
- **Description**: {from package.json description / README first paragraph — QUOTE only, do not paraphrase}
- **README Summary**: {direct quote of key sections from README}

## Detected Deliverables

### Deliverable 1: {type — Backend/Mobile/Dashboard/Frontend/etc.}
- **Path**: {relative path within repo or repo URL}
- **Framework**: {detected framework} {version from config} [source: {config file}]
- **Language**: {language} {version if specified} [source: {config file}]
- **Runtime**: {runtime if applicable} [source: {config file}]
- **Package Manager**: {npm/yarn/pnpm/pip/etc.}
- **Git Remote**: {from git remote -v}

### Deliverable 2: ...

## Infrastructure Files Detected
- [ ] Dockerfile: {yes/no, path if yes}
- [ ] docker-compose: {yes/no, path if yes}
- [ ] CI/CD: {type, path — e.g., GitHub Actions, .github/workflows/deploy.yml}
- [ ] .env template: {yes/no, path if yes}

## URLs Found in Config
- {url_1} [source: {file}]
- {url_2} [source: {file}]
- (If no URLs found: "운영 URL 정보 없음 — [⚠️ 확인 필요]")
```

### Rules
- README content is QUOTED, not interpreted or expanded
- Framework/language detection uses the Framework Detection Table above
- Only report URLs found literally in config files
- If monorepo: detect each sub-project as separate deliverable

---

## Agent 2: tech-analyzer

**Model**: sonnet
**Role**: Analyze technology stack, infrastructure, deployment configuration, external integrations

### Input
- `intermediate/repo-metadata.md`
- Direct access to repository files

### Scan Targets
For each deliverable detected in repo-metadata.md:

**Dependencies** (extract with exact versions):
- `package.json` → `dependencies` + `devDependencies`
- `pubspec.yaml` → `dependencies` + `dev_dependencies`
- `requirements.txt` / `Pipfile` / `pyproject.toml`
- `go.mod` → `require` block
- `pom.xml` → `<dependencies>`
- `composer.json` → `require`
- `Gemfile`

**Infrastructure**:
- `docker-compose.yml` → services, ports, volumes, environment
- `Dockerfile` → base image, exposed ports
- `.github/workflows/*.yml` → build steps, deploy steps
- `.env.example` → environment variable names (NOT values)
- `Makefile` → available commands

**Dependency Classification** — Classify each dependency into categories:

| Category | Detection Keywords/Packages |
|----------|---------------------------|
| Core Framework | nestjs, express, fastapi, django, spring-boot, laravel, gin, rails, react, vue, angular, flutter |
| Database | pg, mysql2, mongodb, typeorm, prisma, sequelize, mongoose, knex, django ORM |
| Cache | redis, ioredis, memcached, node-cache |
| Message Queue | amqplib, bull, rabbitmq, kafka, celery |
| Real-time | socket.io, ws, websocket, channels |
| Authentication | passport, jwt, bcrypt, oauth, jose, next-auth |
| Payment | toss, stripe, paypal, iamport, bootpay |
| Push Notification | firebase-admin, fcm, apns, onesignal |
| SMS | solapi, twilio, nexmo, coolsms |
| File Storage | aws-sdk/s3, multer, cloudinary, minio |
| Validation | class-validator, zod, joi, yup, cerberus |
| Map | naver-map, google-maps, kakao-map, mapbox, leaflet |
| Styling | tailwindcss, styled-components, emotion, sass, bootstrap |
| HTTP Client | axios, got, node-fetch, dio, retrofit, requests |
| State Management | redux, zustand, recoil, mobx, bloc, riverpod, vuex, pinia |
| Form | react-hook-form, formik, vee-validate |
| Build Tool | vite, webpack, esbuild, turbo, rollup |
| Testing | jest, vitest, mocha, pytest, junit |
| Logging | winston, pino, morgan, bunyan |
| Container | docker, docker-compose |
| Process Manager | pm2, nodemon, supervisor |
| CI/CD | github-actions, jenkins, gitlab-ci |

### Output Format: `intermediate/tech-analysis.md`

```markdown
# Technology Analysis

## Deliverable: {name}

### Dependencies (with versions)

| Category | Package | Version | Source |
|----------|---------|---------|--------|
| Core Framework | {package} | {version} | {config file} |
| Database | {package} | {version} | {config file} |
| ... | ... | ... | ... |

### Tech Stack Summary Table (for report Section 4)

| 분류 | 기술 |
|------|------|
| Core Framework | {framework} {version} |
| Language | {language} {version} |
| ... | ... |

(Only include categories with actual dependencies)

## Infrastructure

### Docker Configuration
- Base Image: {from Dockerfile}
- Services: {from docker-compose.yml — list each service, its image, ports}
- Volumes: {mapped volumes}

### CI/CD Pipeline
- Platform: {GitHub Actions / Jenkins / GitLab CI / etc.}
- Workflow File: {path}
- Steps:
  1. {step_1}
  2. {step_2}
  ...

### Environment Variables (from .env.example — names only, NOT values)
- {VAR_NAME_1}: {inferred purpose from name}
- {VAR_NAME_2}: {inferred purpose from name}

## External Integrations

| Service | Package | Purpose | Source |
|---------|---------|---------|--------|
| {service} | {package_name} | {purpose} | {config file} |

## Deployment Info

### Production URLs (from config files only)
- {url} [source: {file}]
- (Or: [⚠️ 확인 필요] if not found)

### Cloud/Region Info
- {info} [source: {file}]
- (Or: [⚠️ 확인 필요] if not found)
```

### Rules
- Every dependency version must come from the actual config file
- Classify dependencies using the table above
- Do NOT infer cloud provider or region without config evidence
- .env values are NEVER included — only variable names

---

## Agent 3: code-analyzer

**Model**: opus
**Role**: Deep code analysis — API endpoints, database schema, features, security, performance

### Input
- `intermediate/repo-metadata.md`
- Direct access to repository source code files

### Analysis Tasks

#### Task 1: API Endpoint Counting
Using detected framework patterns:

**NestJS**: Count `@Get()`, `@Post()`, `@Put()`, `@Patch()`, `@Delete()` decorators in `*.controller.ts`
**Express**: Count `router.get()`, `router.post()`, etc. in route files
**FastAPI**: Count `@app.get()`, `@router.get()`, etc. in router files
**Django**: Count URL patterns in `urls.py`
**Spring Boot**: Count `@GetMapping`, `@PostMapping`, etc.
**Laravel**: Count `Route::get()`, etc. in `routes/*.php`
**Flutter/React/Vue**: N/A for frontend — skip endpoint counting

Group endpoints by controller/router file name → category.

#### Task 2: Database Schema Extraction
**TypeORM**: Read `@Entity()` classes, extract `@Column()` definitions and table names
**Prisma**: Read `prisma/schema.prisma`, extract models
**Sequelize**: Read model definitions
**Django**: Read `models.py`, extract `class Model(models.Model)` definitions
**SQLAlchemy**: Read model files
**Migration files**: Read migration files for table/column info
**Raw SQL**: Search for `CREATE TABLE` statements

Extract: table name + brief description (from class name / comments / column names)

#### Task 3: Feature Detection
Scan for these feature patterns:

| Feature | Detection Method |
|---------|-----------------|
| WebSocket/Real-time | Gateway files (`*.gateway.ts`), Socket.IO setup, `@WebSocketGateway`, `@SubscribeMessage` |
| Payment | Payment module/service, Toss/Stripe/iamport imports, webhook handlers |
| Authentication | Auth module, Passport strategies, JWT config, social login handlers |
| Notification | FCM/Firebase admin, push notification service, notification module |
| SMS | Solapi/Twilio imports, SMS service files |
| File Upload | Multer config, S3 upload service, file controller |
| Location/Map | PostGIS queries, geospatial functions, map-related services |
| Search | Elasticsearch, full-text search, search service |
| Cron/Scheduler | `@Cron()` decorators, cron job files, task scheduler |
| Chat | Chat module, message gateway, conversation service |
| Reservation/Booking | Booking module/service, reservation controller |
| Reward/Points | Reward module, point service |

For each detected feature, extract:
- Feature type
- Key files involved
- Technical details (events, methods, flow)
- Source file paths

#### Task 4: Security Measures Detection

| Measure | Detection |
|---------|-----------|
| JWT Authentication | `@nestjs/jwt`, `jsonwebtoken`, passport-jwt strategy |
| Password Hashing | `bcrypt`, `argon2` imports + salt rounds config |
| Rate Limiting | `@nestjs/throttler`, `express-rate-limit`, rate limit config |
| CORS | CORS configuration in main/app file |
| Helmet | `helmet` import/usage |
| Input Validation | `class-validator` decorators, `zod` schemas, validation pipes |
| SQL Injection Prevention | Parameterized queries, ORM usage |
| SSL/TLS | SSL config in database connection, HTTPS setup |
| Environment Variables | `.env` usage, `ConfigService`, `process.env` |
| API Key Management | API key guards, key validation |

#### Task 5: Performance Optimization Detection

| Optimization | Detection |
|-------------|-----------|
| Caching | Redis client setup, cache interceptors, `@CacheKey`, `@CacheTTL` |
| Database Indexing | `@Index()` decorators, `CREATE INDEX` in migrations, GIST/GIN indexes |
| Connection Pooling | Pool config in DB connection options |
| Message Queue | RabbitMQ/Bull/Kafka consumer/producer setup |
| Compression | `compression` middleware, gzip config |
| Lazy Loading | Dynamic imports, lazy module loading |
| Pagination | Pagination DTOs, `skip`/`take`/`limit`/`offset` in queries |

### Output Format: `intermediate/code-analysis.md`

```markdown
# Code Analysis

## API Endpoints

### Summary

| Category | Count | Key Functions | Source Files |
|----------|-------|---------------|-------------|
| {category} | {count} | {functions} | {file paths} |

### Total Endpoints: {total_count}

### Detailed Endpoint List

#### {Category 1} ({count} endpoints)
- `{METHOD} {path}` — {description} [source: {file}:{line}]
- ...

## Database Schema

### Tables

| Table Name | Description | Entity File |
|------------|-------------|-------------|
| {table} | {description} | {file path} |

### Special Indexes
- {index_description} [source: {file}]

## Features Detected

### {Feature 1}: {Feature Name}

**Type**: {WebSocket/Payment/Auth/Notification/etc.}
**Files**: {list of relevant files}

{Feature-specific details — see feature templates in report-template.md}

[source: {file paths}]

### {Feature 2}: ...

## Security Measures

| Measure | Implementation | Source |
|---------|---------------|--------|
| {measure} | {details} | {file path} |

## Performance Optimizations

| Optimization | Implementation | Source |
|-------------|---------------|--------|
| {optimization} | {details} | {file path} |

## API Documentation
- Swagger URL: {if detected from swagger setup} OR "미감지"
- OpenAPI spec: {if openapi.json/yaml found} OR "미감지"
```

### Rules
- Every endpoint must be actually counted from code decorators/definitions
- Every table must come from actual entity/model/migration files
- Every security/performance measure must have a source file reference
- Do NOT list measures that are merely imported but not configured
- "~로 추정됨" expressions are FORBIDDEN

---

## Agent 4: report-writer

**Model**: opus
**Role**: Write the complete Korean project result report from intermediate analysis files

### Input
- `intermediate/repo-metadata.md`
- `intermediate/tech-analysis.md`
- `intermediate/code-analysis.md`
- `commands/references/generate-project-report/report-template.md`

### Instructions

1. Follow `report-template.md` section structure EXACTLY
2. Write in Korean with formal government document style (합쇼체: ~합니다, ~입니다)
3. **NEVER create content not present in intermediate files** — if data is missing, use `[⚠️ 확인 필요]`
4. Preserve all `[⚠️ 확인 필요]` markers from intermediate files
5. Generate ASCII art infrastructure diagram (Section 5.1) based ONLY on components in tech-analysis.md
6. Generate ASCII art CI/CD flow diagram (Section 9.4) based ONLY on CI config in tech-analysis.md
7. Translate technical terms appropriately for Korean government documents:
   - Use standard Korean IT terminology
   - Keep technology names in English (NestJS, TypeScript, PostgreSQL, etc.)
   - Use Korean for descriptions and explanations
8. Tables must use exact column headers from the template
9. Only include sections/subsections that have data — skip empty sections with a note

### Writing Style Guide

**DO**:
- "RESTful API 설계 및 구현을 완료하였습니다" (formal)
- "JWT 기반 인증 시스템을 적용하였습니다" (specific, factual)
- "Redis 캐싱을 통한 성능 최적화를 구현하였습니다" (verified from code)

**DO NOT**:
- "최신 기술을 활용하여..." (vague, promotional)
- "효율적인 시스템을 구축..." (subjective without evidence)
- "약 50개의 API..." (approximate — must be exact count)

### Output
- `drafts/report-draft.md` — complete Korean report
