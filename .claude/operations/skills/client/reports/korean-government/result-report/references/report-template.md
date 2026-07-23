# Project Result Report — Korean Output Template

This template defines the exact output structure for the Korean government-submission project result report (프로젝트 결과보고서).

**Language**: Korean (합쇼체: ~합니다, ~입니다)
**Tone**: Formal, official government document style
**Hallucination rule**: Only include facts verified from code. Mark unverified items with `[⚠️ 확인 필요]`.

---

## Document Header

```markdown
# 프로젝트 결과보고서

**{ProjectName}**
```

---

## Section 1: 사업 개요

```markdown
## 1. 사업 개요

### 1.1 프로젝트 정보

| 항목 | 내용 |
|------|------|
| 프로젝트명 | {project_name} |
| 개발 목적 | {development_purpose} |
| 개발 범위 | {development_scope — e.g., Backend API 서버, Mobile Application, Admin Dashboard} |

### 1.2 개발 목표

- {goal_1}
- {goal_2}
- {goal_3}
- ...
```

**Data sources**:
- `project_name`: package.json `name` field, README title, or repo directory name
- `development_purpose`: README description or package.json `description`
- `development_scope`: Detected deliverables from repo-metadata.md
- `goals`: Extracted from README features/objectives section. If not in README, derive from major modules detected in code. Mark with `[⚠️ 확인 필요]` if inferred.

---

## Section 2: 시스템 개요

```markdown
## 2. 시스템 개요

### 2.1 서비스 소개

{service_description — 1-2 paragraph description of the service, what it does, key technologies used}

### 2.2 주요 특징

| 특징 | 설명 |
|------|------|
| {feature_name_1} | {feature_description_1} |
| {feature_name_2} | {feature_description_2} |
| ... | ... |
```

**Data sources**:
- `service_description`: Synthesized from README + detected features in code-analysis.md
- `features`: Key technical features detected from code (e.g., real-time communication, spatial search, payment integration)

**Rules**:
- Only list features that are actually implemented in the code
- Each feature must have a corresponding code evidence (module, package, or config)

---

## Section 3: 개발 결과물

One subsection per deliverable (backend, mobile, dashboard, etc.)

```markdown
## 3. 개발 결과물

### 3.{N} {Deliverable Name}

| 항목 | 내용 |
|------|------|
| 저장소 | {repository_url} |
| 운영 URL | {production_url OR [⚠️ 확인 필요]} |
| 프레임워크 | {framework} {version} |
| 언어 | {language} {version} |
| 런타임 | {runtime — if applicable} |
| 상태관리 | {state_management — frontend/mobile only} |
| 지원 플랫폼 | {platforms — mobile only} |
| 스타일 | {styling — frontend only} |

**주요 개발 내용:**

- {development_item_1}
- {development_item_2}
- ...
```

**Data sources**:
- `repository_url`: Git remote URL from `git remote -v`, or input path
- `production_url`: From README, .env.example, docker-compose, or CI config. `[⚠️ 확인 필요]` if not found.
- `framework/language/version`: From package.json, pubspec.yaml, requirements.txt, go.mod, etc.
- `development_items`: Major features derived from code-analysis.md (controllers, modules, routes)

**Rules**:
- Table fields vary by deliverable type (backend shows runtime, mobile shows platforms, frontend shows styling)
- Only include rows that have verified data
- Versions must be exact (from config files), never approximate

---

## Section 4: 기술 스택

One subsection per deliverable.

```markdown
## 4. 기술 스택

### 4.{N} {Deliverable Name}

| 분류 | 기술 |
|------|------|
| Core Framework | {framework} {version} |
| Language | {language} {version} |
| Database | {database} |
| ORM | {orm} |
| Cache | {cache} |
| Message Queue | {mq} |
| Real-time | {realtime} |
| Authentication | {auth} |
| Payment | {payment} |
| Push Notification | {push} |
| SMS | {sms} |
| File Storage | {storage} |
| Validation | {validation} |
| Networking | {networking — mobile} |
| Local Storage | {local_storage — mobile} |
| Map | {map — mobile} |
| State Management | {state — frontend/mobile} |
| Styling | {styling — frontend} |
| HTTP Client | {http — frontend} |
| Form | {form — frontend} |
| Build Tool | {build — frontend} |

### 4.{M} Infrastructure

| 분류 | 기술 |
|------|------|
| Cloud | {cloud_provider} |
| Region | {region} |
| Container | {container} |
| Process Manager | {process_manager} |
| CI/CD | {cicd} |
```

**Data sources**:
- All from tech-analysis.md, which extracts from package.json dependencies, pubspec.yaml, docker-compose.yml, CI configs
- Only include rows where the technology is actually used (detected in dependencies)
- Versions from package.json / lock files

**Rules**:
- Only list categories that have actual dependencies detected
- Infrastructure section only if Docker/CI/cloud config files exist
- Cloud/Region info from config files only. `[⚠️ 확인 필요]` if not in code.

---

## Section 5: 시스템 아키텍처

```markdown
## 5. 시스템 아키텍처

### 5.1 인프라 구성도

{ASCII art infrastructure diagram — generated from detected components}

### 5.2 데이터베이스 구조

| 테이블명 | 설명 |
|----------|------|
| {table_1} | {description_1} |
| {table_2} | {description_2} |
| ... | ... |

{Optional: spatial indexing, special indexes if detected}
```

**Data sources**:
- Infrastructure diagram: Built from docker-compose services, detected databases, caches, queues
- DB tables: From entity files, model files, migration files, or schema files (code-analysis.md)

**Rules**:
- ASCII diagram only includes components verified in config/code
- DB table descriptions from entity/model file annotations or column analysis
- If no entity/model files found, mark entire section `[⚠️ 확인 필요]`

---

## Section 6: 주요 기능 상세

Dynamic subsections based on detected features.

```markdown
## 6. 주요 기능 상세

### 6.{N} {Feature Name}

{Feature-specific content — varies by feature type}
```

### Feature type templates:

#### WebSocket / Real-time
```markdown
### 6.{N} 실시간 {기능명} (WebSocket)

**연결 정보:**
- Namespace: {namespace}
- Connection URL: {ws_url OR [⚠️ 확인 필요]}

**Client → Server Events:**

| Event | Payload | 설명 |
|-------|---------|------|
| {event_name} | {payload_shape} | {description} |

**Server → Client Events:**

| Event | Payload | 설명 |
|-------|---------|------|
| {event_name} | {payload_shape} | {description} |
```

#### Payment Integration
```markdown
### 6.{N} 결제 시스템

{payment_provider} 연동:
- {payment_method_1}
- {payment_method_2}
- ...

**결제 플로우:**
1. {step_1}
2. {step_2}
3. ...
```

#### Authentication
```markdown
### 6.{N} 인증 시스템

| 방식 | 설명 |
|------|------|
| {auth_method_1} | {description_1} |
| {auth_method_2} | {description_2} |

- {additional_auth_detail_1}
- {additional_auth_detail_2}
```

#### Notification System
```markdown
### 6.{N} 알림 시스템

- {notification_type_1}
- {notification_type_2}
- ...
```

#### Location-based Features
```markdown
### 6.{N} 위치 기반 검색

- {location_feature_1}
- {location_feature_2}
- ...
```

#### Generic Feature
```markdown
### 6.{N} {기능명}

- {detail_1}
- {detail_2}
- ...
```

**Data sources**: All from code-analysis.md
**Rules**:
- Only include features actually detected in code
- WebSocket events from gateway/socket handler files
- Payment details from payment module/service files
- Auth methods from auth module/strategy files

---

## Section 7: API 명세 요약

```markdown
## 7. API 명세 요약

### 7.1 API 엔드포인트 현황

| 카테고리 | 엔드포인트 수 | 주요 기능 |
|----------|--------------|----------|
| {category_1} | {count_1} | {functions_1} |
| {category_2} | {count_2} | {functions_2} |
| ... | ... | ... |

### 7.2 API 문서

- {api_doc_type}: {api_doc_url OR [⚠️ 확인 필요]}
```

**Data sources**:
- Endpoint counts from code-analysis.md (actual controller/route counting)
- Categories from controller/router file groupings
- API doc URL from Swagger config, OpenAPI setup, or README

**Rules**:
- Endpoint counts MUST match actual code counting (no estimation)
- Categories derived from controller/module names

---

## Section 8: 보안 및 성능

```markdown
## 8. 보안 및 성능

### 8.1 보안 조치

| 항목 | 구현 내용 |
|------|----------|
| {security_item_1} | {implementation_1} |
| {security_item_2} | {implementation_2} |
| ... | ... |

### 8.2 성능 최적화

| 항목 | 구현 내용 |
|------|----------|
| {perf_item_1} | {implementation_1} |
| {perf_item_2} | {implementation_2} |
| ... | ... |
```

**Data sources**: code-analysis.md
**Detection patterns**:
- Security: JWT, bcrypt, helmet, CORS config, rate limiting, SSL/TLS, env vars
- Performance: Redis cache, database indexing, connection pooling, message queues, CDN, compression

**Rules**:
- Only list measures actually detected in code/config
- Include specific package names and config values where available

---

## Section 9: 배포 환경

```markdown
## 9. 배포 환경

### 9.1 Production 환경

| 항목 | 내용 |
|------|------|
| API Server | {api_url OR [⚠️ 확인 필요]} |
| Dashboard | {dashboard_url OR [⚠️ 확인 필요]} |
| Cloud | {cloud_provider OR [⚠️ 확인 필요]} |
| Database | {db_service OR [⚠️ 확인 필요]} |
| File Storage | {file_storage OR [⚠️ 확인 필요]} |
| Container | {container_tech} |

### 9.2 서비스 구성

| 서비스 | 엔드포인트 |
|--------|-----------|
| {service_1} | {endpoint_1 OR [⚠️ 확인 필요]} |
| ... | ... |

### 9.3 외부 연동 서비스

| 서비스 | 용도 |
|--------|------|
| {service_1} | {purpose_1} |
| ... | ... |

### 9.4 배포 프로세스

{ASCII art CI/CD flow diagram — generated from detected CI config}
```

**Data sources**: tech-analysis.md
**Rules**:
- Production URLs/endpoints almost always need `[⚠️ 확인 필요]` unless found in config
- External services from package.json dependencies + config files
- CI/CD flow from .github/workflows, Jenkinsfile, etc.
- Container info from Dockerfile, docker-compose.yml

---

## Appendix: 산출물 목록

```markdown
## 부록: 산출물 목록

| 구분 | 산출물 | 비고 |
|------|--------|------|
| 소스코드 | {deliverable_1} Repository | {repo_url_1} |
| 소스코드 | {deliverable_2} Repository | {repo_url_2} |
| 운영 | Production {type} | {prod_url OR [⚠️ 확인 필요]} |
| ... | ... | ... |
```

**Rules**:
- List all repos and production URLs
- Group by 소스코드 and 운영
