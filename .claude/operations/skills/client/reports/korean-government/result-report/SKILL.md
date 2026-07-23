---
name: generate-project-report
description: "Generate a Korean Project Result Report (프로젝트 결과보고서) for government submission by analyzing a codebase"
argument-hint: "Repo path(s) or GitHub URL(s), comma-separated (e.g., /path/to/repo OR https://github.com/org/repo1, https://github.com/org/repo2)"
---

# Generate Project Result Report — 프로젝트 결과보고서

Generate a formal Korean project result report for government submission (정부기관 제출용) by analyzing one or more code repositories. The report follows a standardized 10-section format.

## Core Principles

1. **Hallucination Zero**: Only state facts verified from actual code and config files
2. **Source Tracking**: Every finding tagged with source file path in intermediate artifacts
3. **Government Formal Style**: Korean 합쇼체 (합니다/입니다), official document tone
4. **Unverified Marking**: Items not provable from code marked `[⚠️ 확인 필요]`
5. **Exact Versions**: Versions extracted from config files, never approximated
6. **Actual Counting**: API endpoints, DB tables counted from real code — no estimation
7. **Framework Agnostic**: Auto-detect frameworks, never assume a specific stack

## Agent Configuration

| Agent | Model | Role |
|-------|-------|------|
| **repo-scanner** | sonnet | Scan repo structure, detect frameworks, extract metadata |
| **tech-analyzer** | sonnet | Analyze tech stack, infra, deployment, external integrations |
| **code-analyzer** | opus | Deep code analysis: APIs, DB, features, security, performance |
| **report-writer** | opus | Write complete Korean report from analysis artifacts |

## Reference Files

All references located under `skills/client/reports/korean-government/result-report/references/`:
- `report-template.md` — Korean report output template (10 sections, exact table structures)
- `analysis-prompts.md` — Agent prompt specs, framework detection table, scan patterns

---

## Phase 1: Input & Repo Setup

### 1.1 Parse Input

Read repository paths from `$ARGUMENTS`.

**Supported input formats:**
- Single local path: `/path/to/repo`
- Single GitHub URL: `https://github.com/org/repo`
- Multiple repos (comma-separated): `/path/to/backend, /path/to/frontend`
- Multiple GitHub URLs: `https://github.com/org/backend, https://github.com/org/mobile`
- Mixed: `/path/to/backend, https://github.com/org/frontend`

**Validation checklist:**
1. At least one path/URL provided?
2. Each local path exists and is a directory?
3. Each GitHub URL is accessible?

**On failure:**
```
Error: [specific error message]
Usage: /generate-project-report /path/to/repo
       /generate-project-report https://github.com/org/repo
       /generate-project-report /path/to/backend, /path/to/mobile, /path/to/dashboard
```

### 1.2 Clone Remote Repos (if GitHub URLs)

For each GitHub URL in input:
```bash
git clone {url} /tmp/project-report-{timestamp}/{repo-name}
```

On clone failure:
```
Error: 리포지토리를 클론할 수 없습니다: {url}
접근 권한과 URL을 확인해주세요.
```

### 1.3 Project Name Detection

Derive project name (priority order):
1. `package.json` `name` field (first/primary repo)
2. README title (first `# ` heading)
3. Repository directory name

Sanitize for folder name: spaces → underscores, remove special characters (keep Korean characters).

### 1.4 Output Folder Setup

```bash
mkdir -p .claude-project/reports/{ProjectName}/intermediate
mkdir -p .claude-project/reports/{ProjectName}/drafts
```

### 1.5 Repo Scanner Agent

Launch **repo-scanner** (sonnet) for all input repositories.

**Agent prompt must include:**
- All repo paths to scan
- Full framework detection table from `analysis-prompts.md`
- Hallucination prevention rules
- Output format specification for `repo-metadata.md`

**Agent scans:**
- README.md / README
- package.json, pubspec.yaml, requirements.txt, go.mod, pom.xml, composer.json, Gemfile, Cargo.toml
- Dockerfile, docker-compose.yml
- .github/workflows/*.yml, Jenkinsfile, .gitlab-ci.yml
- .env.example, .env.sample
- tsconfig.json, nest-cli.json
- `git remote -v` for repo URLs

**Output:** `.claude-project/reports/{ProjectName}/intermediate/repo-metadata.md`

---

## Phase 2: Deep Analysis (Parallel)

Launch **tech-analyzer** and **code-analyzer** simultaneously.

```
┌──────────────────────────────────────────────┐
│  Parallel Execution                          │
│                                              │
│  tech-analyzer (sonnet)  → tech-analysis.md  │
│  code-analyzer (opus)    → code-analysis.md  │
│                                              │
└──────────────────────────────────────────────┘
```

### 2.1 Tech Analyzer

Launch **tech-analyzer** (sonnet).

**Agent prompt must include:**
- Content of `intermediate/repo-metadata.md` (inline)
- Dependency classification table from `analysis-prompts.md`
- Paths to all repo directories
- Hallucination prevention rules

**Agent analyzes:**
- All dependency files (package.json, pubspec.yaml, etc.) — extract package names + exact versions
- Docker configuration (Dockerfile, docker-compose.yml) — services, ports, images
- CI/CD workflows — build/deploy steps
- .env.example — variable names only (NEVER values)
- Infrastructure evidence from config files

**Output:** `.claude-project/reports/{ProjectName}/intermediate/tech-analysis.md`

### 2.2 Code Analyzer

Launch **code-analyzer** (opus).

**Agent prompt must include:**
- Content of `intermediate/repo-metadata.md` (inline)
- Full analysis task specs from `analysis-prompts.md` (endpoint counting, DB extraction, feature detection, security, performance)
- Detected framework(s) and corresponding file patterns
- Paths to all repo directories
- Hallucination prevention rules

**Agent analyzes:**
1. **API Endpoints**: Count actual route decorators/definitions per controller, group by category
2. **Database Schema**: Extract table names from entity/model/migration/schema files
3. **Feature Detection**: WebSocket, payment, auth, notifications, SMS, file upload, location, search, cron, chat, booking, rewards
4. **Security Measures**: JWT, bcrypt, rate limiting, CORS, helmet, validation, env vars
5. **Performance**: Caching, indexing, connection pooling, message queues, compression

**Output:** `.claude-project/reports/{ProjectName}/intermediate/code-analysis.md`

---

## Phase 3: Report Writing

### 3.1 Write Report

Launch **report-writer** (opus).

**Agent prompt must include:**
- Content of ALL three intermediate files (inline):
  - `intermediate/repo-metadata.md`
  - `intermediate/tech-analysis.md`
  - `intermediate/code-analysis.md`
- Full `report-template.md` content (inline)
- Writing instructions:
  - Follow template section structure EXACTLY
  - Korean 합쇼체 formal style
  - NEVER create content not in intermediate files
  - Preserve all `[⚠️ 확인 필요]` markers
  - Generate ASCII art diagrams from verified components only
  - Use exact table column headers from template
  - Skip sections with no data (note: "해당 사항 없음")

**Output:** `.claude-project/reports/{ProjectName}/drafts/report-draft.md`

---

## Phase 4: Review & Deliver

### 4.1 Unverified Items Collection

After report-writer completes, scan the draft for all `[⚠️ 확인 필요]` markers.

Collect into a list:
```markdown
## 확인이 필요한 항목

다음 항목들은 코드에서 확인할 수 없어 마커 처리되었습니다.
실제 값을 알려주시면 반영하겠습니다.

| # | 항목 | 위치 (섹션) | 현재 값 |
|---|------|-----------|--------|
| 1 | 운영 API URL | 9.1 Production 환경 | [⚠️ 확인 필요] |
| 2 | Cloud Region | 4.4 Infrastructure | [⚠️ 확인 필요] |
| ... | ... | ... | ... |
```

### 4.2 Present to User

Use AskUserQuestion to present the report summary and unverified items:

```
프로젝트 결과보고서 초안이 완성되었습니다.

### 보고서 요약
- 프로젝트: {ProjectName}
- 결과물: {N}개 ({deliverable names})
- API 엔드포인트: {total_count}개
- DB 테이블: {table_count}개
- 주요 기능: {feature list}

### 확인 필요 항목: {count}개
{unverified items list}

위 항목들의 실제 값을 알려주시거나, 초안 확인 후 수정 요청을 해주세요.
수정 없이 최종 저장하려면 "저장"이라고 답해주세요.
```

### 4.3 Apply User Feedback

- If user provides values for `[⚠️ 확인 필요]` items → replace markers with actual values
- If user requests changes → apply edits to draft
- If user says "저장" or equivalent → proceed to final save

### 4.4 Save Final File

Filename: `{ProjectName}_결과보고서_{YYMMDD}.md`
- Sanitize: spaces → underscores, remove special characters (keep Korean)
- Date: current date in YYMMDD format
- Location: `.claude-project/reports/{ProjectName}/`

Remove all remaining `[⚠️ 확인 필요]` markers only if user has confirmed or provided values. If any remain unconfirmed, warn user before saving.

### 4.5 Result Report

```markdown
## 프로젝트 결과보고서 생성 완료

### 출력 파일
- 파일: `.claude-project/reports/{ProjectName}/{filename}.md`

### 보고서 구성
- 1. 사업 개요 ✅
- 2. 시스템 개요 ✅
- 3. 개발 결과물 ({N}개) ✅
- 4. 기술 스택 ✅
- 5. 시스템 아키텍처 ✅
- 6. 주요 기능 상세 ({M}개 기능) ✅
- 7. API 명세 요약 ({K}개 엔드포인트) ✅
- 8. 보안 및 성능 ✅
- 9. 배포 환경 ✅
- 부록: 산출물 목록 ✅

### 확인 필요 항목
- 해결: {N}개
- 미해결: {M}개

### 출력 구조
.claude-project/reports/{ProjectName}/
├── intermediate/              ← 분석 중간 산출물
├── drafts/                    ← 초안
└── {filename}.md              ← 최종 결과보고서
```

---

## Error Handling

| Situation | Response |
|-----------|----------|
| No argument provided | Error message + usage examples |
| GitHub URL clone failure | Error: "리포지토리를 클론할 수 없습니다. URL과 접근 권한을 확인해주세요." |
| Local path not found | Error: "경로를 찾을 수 없습니다: [path]" |
| No package/config files found | Warning, proceed with generic file scan fallback |
| No README found | Warning, ask user for project name and description via AskUserQuestion |
| Agent timeout/failure | Retry once. On second failure, mark section "분석 실패 — 수동 작성 필요" and continue |
| Empty repository | Error: "리포지토리에 소스 코드가 없습니다." |
| Framework not detected | Use fallback generic patterns (per CLAUDE.md requirement) |
| All endpoints return 0 | Warning + ask user if repo is correct |

---

## Multi-Repo Handling

When multiple repos are provided:
1. Phase 1 scans all repos, creates unified `repo-metadata.md` with separate deliverable sections
2. Phase 2 analyzers receive all repo paths, produce unified analysis files
3. Phase 3 writer creates single report with per-deliverable subsections (3.1, 3.2, ..., 4.1, 4.2, ...)
4. Each deliverable clearly labeled in all sections

---

## Reference File List

| File | Purpose |
|------|---------|
| `skills/client/reports/korean-government/result-report/references/report-template.md` | Korean report output template (10 sections) |
| `skills/client/reports/korean-government/result-report/references/analysis-prompts.md` | Agent prompt specs, framework detection, scan patterns |
