---
name: generate-prd
description: "Generate a complete PRD (Feature + Technical) from client input. Default runs both phases sequentially. Use --feature for Phase A only (features, flows, pages), --tech for Phase B only (schema, permissions, system design from existing Feature PRD), --interview for live client interview."
argument-hint: "[--feature | --tech | --full] [--interview] <input-file-path>"
---

# Generate PRD — Feature (Phase A) + Technical (Phase B)

> **Architecture Note**: This skill runs the full PRD pipeline. Phase A produces feature/flow/page sections (0-4 + 2.5 + 8); Phase B adds technical sections (5-7) and merges into one stable file.
> Default invocation runs both phases sequentially. Use `--feature` to stop after Phase A, or `--tech` to run Phase B only against an existing Feature PRD.
>
> **Terminology**: "Phase A/B" = pipeline-level split (Feature vs Technical sections). "Phase 1-4" = internal stages of Phase A. "Phase B1-B4" = internal stages of Phase B.

Generate a complete PRD from client input using a unified pipeline with 9 agents (5 Phase A + 4 Phase B).
- **Phase A** (Sections 0-4 + 2.5 + 8): features, flows, pages, notifications.
- **Phase B** (Sections 5-7): tech stack, data model, permission matrix.
- **Default mode (`--full`)** runs Phase A → Phase B and writes a single stable `{App}_PRD.md`.

---

## PM Quick Reference

> **PM이 읽어야 할 부분은 여기까지입니다.** 아래 상세 섹션은 Claude agent 실행 로직입니다.

### Workflow Overview

**Invocation Modes:**

| Command | Behavior |
|---------|----------|
| `/generate-prd <answers.md>` (default = `--full`) | Phase A → auto-chain Phase B → stable `{App}_PRD.md` |
| `/generate-prd --feature <answers.md>` | Phase A only → stable `{App}_PRD.md` (Sections 0-4 + 2.5 + 8) |
| `/generate-prd --tech <feature-prd.md>` | Phase B only → merge Sections 5-7 into existing `{App}_PRD.md` |
| `/generate-prd --interview` | Live interview → Phase A → auto-chain Phase B (combine with `--feature` to stop after A) |
| `/generate-prd --interview --tech` | ❌ Invalid — interview applies to Phase A only |

**Option A — File Mode (기존 방식, 기본 `--full`):**
```
Pre-intake Form (클라이언트 작성, 5분)
  → PM이 답변 검토 + 킥오프 미팅 준비
  → PRD Interview (킥오프 미팅, 1-2시간)
  → PM이 답변 하나의 파일로 정리
  → /generate-prd [파일경로] 실행
  → Phase 1~4 (PM 확인 요청 3번) → Phase B1~B4 자동 진행
  → 최종 Complete PRD + Client Checklist 출력
```

**Option B — Interactive Mode (클라이언트 미팅용, 권장):**
```
Pre-intake Form (클라이언트 작성, 5분)
  → PM이 답변 검토
  → /generate-prd --interview 실행
  → PM이 브라우저(interview-live.html)를 클라이언트에게 화면공유
  → 질문마다 선택지 제공 + 진행률 표시 (Q3/~24, 12%)
  → PM은 터미널에서 답변 입력 (클라이언트는 브라우저만 봄)
  → 인터뷰 완료 시 답변 자동 정리
  → Phase 1~4 (PM 확인 요청 3번) → Phase B1~B4 자동 진행
  → 최종 Complete PRD + Client Checklist 출력
```

**Option C — Tech-only Mode (`--tech`):**
```
이미 PM 확정 끝난 Feature PRD가 있을 때
  → /generate-prd --tech [feature-prd-경로] 실행
  → Pre-check: [💡 Recommended:] 미해결 항목 있으면 ABORT
  → Phase B1~B4 자동 진행 (PM 확인 없음, 개발팀이 검토)
  → 동일 파일에 Sections 5-7 병합 (overwrite)
```

### PM Decision Points (총 3회 — Phase A 전용)

> Decision points fire only during Phase A (`--feature` and `--full`). Phase B (`--tech`) runs without PM gates — technical TBDs are reviewed by the development team.

| When | What | How Long |
|------|------|----------|
| **Phase 1 — Critical Review** | 🔴 아키텍처/범위에 영향 주는 항목만 결정 (예: 인증 방식, 실시간 필요 여부) | 5-10분 |
| **Phase 2.5 — Draft Review** | 모듈 구조 + 화면 목록이 맞는지 확인. 빠진 화면이나 모듈 피드백 | 10-15분 |
| **Phase 4 — Final Review** | 🟡 Standard 항목 일괄 승인 + 🟢 Optional 항목 개별 확인. Bundle 커버리지 검토 | 10-20분 |

### Marker Legend

| Marker | Source | Meaning | PM Action |
|--------|--------|---------|-----------|
| `[💡 Recommended: X]` | TBD system | Unclear item, needs PM decision | Must decide (Phase 1 or 4) |
| `[📌 Adopted]` | PM confirmation | PM confirmed the recommendation | None (already decided) |
| `[📌 Adopted: {version}]` | PM modification | PM confirmed with a different value | None (already decided) |
| `[권장]` | Bundle system | Standard companion feature, auto-included by default | Can exclude in Phase 4 Bundle Review |

### Client Deliverables

| File | Purpose | When to Send |
|------|---------|-------------|
| `templates/pre-intake-en.md` or `kr.md` | Pre-intake form | 첫 미팅 전 |
| `client-checklist.md` | 클라이언트 준비물 체크리스트 | PRD 완성 후 |

### Output

| File | Description |
|------|-------------|
| `{AppName}_PRD.md` | 최종 PRD (stable filename — overwrites on re-run; Phase B는 같은 파일에 Sections 5-7 병합) |
| `client-checklist.md` | 클라이언트 준비물 체크리스트 (SOP 링크 포함) |

### Next Steps After PRD

1. client-checklist.md를 클라이언트에게 전달
2. Open Questions 섹션의 질문을 클라이언트에게 확인
3. `--feature`로 멈췄다면 PM 확정 후 `/generate-prd --tech [PRD-경로]`로 Technical 섹션 추가 (`--full` 모드는 자동 실행됨)
4. 클라이언트 답변 받으면 `/update-prd`로 반영

---

## Core Principles

1. **Feature First**: Get feature alignment before generating technical specs
2. **PM Decides All**: Every unclear item gets `[💡 Recommended: X]` — PM confirms all before finalizing
3. **8 Items Per Route**: Every route has all 8 mandatory items — use "N/A" when not applicable
4. **Machine Verification**: QA uses only counting/existence rules — no subjective judgment
5. **Real Scenarios**: Every module includes concrete success/failure scenarios
6. **Adaptive Complexity**: Conditional features detected, flagged for Phase B
7. **Source Tracking**: Confirmed items marked `[📌 Adopted]` for traceability

## Agent Configuration

**Phase A agents (Feature):**

| Agent | Model | Role |
|-------|-------|------|
| **parser** | sonnet | Parse input → 3 intermediate artifacts + TBD items with recommendations |
| **feature-writer** | opus | Write Section 0-4 + 2.5 (Overview + Terminology + Modules + Notifications + User App + Admin) |
| **checklist** | sonnet | Generate client preparation checklist (separate file) + attach SOP links from Notion |
| **qa-feature** | sonnet | Validate against 16 feature-scoped rules + 1 INFO report |

**Phase B agents (Technical):**

| Agent | Model | Role |
|-------|-------|------|
| **tech-parser** | sonnet | Extract entities, permissions, integrations from Feature PRD |
| **config-allocator** | sonnet | Allocate unique ports, prefixes, cookie names, DB name |
| **tech-writer** | opus | Write Sections 5-7 using extracted inventories |
| **qa-tech** | sonnet | Validate against 7 technical rules + 2 cross-phase rules |

**Shared:**

| Agent | Model | Role |
|-------|-------|------|
| **support** | sonnet | Fix QA FAIL items + apply PM review feedback (max 3 rounds, used by both phases) |

## Reference Files

All references located under `skills/client/prd/generate-prd/references/`:

**Phase A (Feature):**
- `prd-template.md` — Section 0-4 + 2.5 + 8 output structure
- `prompt-templates.md` — Agent specs + write-mode prompts
- `depth-guide.md` — Mandatory density requirements
- `admin-standards.md` — Admin standard feature matrix
- `feature-bundle-map.md` — 12 feature bundles with trigger keywords
- `bug-pattern-schema.md` — Bug pattern classification
- `validation-checklist.md` — 16 feature-scoped QA rules + 1 INFO report (FB1)

**Phase B (Technical):**
- `prd-template-tech.md` — Section 5-7 output structure
- `prompt-templates-tech.md` — Agent specs + write-mode prompts
- `depth-guide-tech.md` — Mandatory density requirements
- `validation-tech.md` — 7 technical QA rules + 2 cross-phase rules

---

## Interactive Interview Mode

> When invoked with `--interview`, the skill runs an interactive interview with the client via AskUserQuestion,
> renders each question in an HTML presenter for screen-sharing, and auto-compiles answers for Phase 1 parsing.

### Invocation Modes

| Mode | Command | Use Case |
|------|---------|----------|
| File input | `/generate-prd [file-path]` | PM already has compiled answers |
| Interactive | `/generate-prd --interview` | Live interview with HTML presenter |

### Progress Indicator

Every question displays a progress indicator so the client/PM knows how much is left.

**Calculation logic:**
```
# base_total = always-fire questions (trigger: always)
pre_intake_always = 8                            # P1-P3, P5-P9 (if no pre-intake file provided)
interview_always = 24                            # includes F1a, F2a-F2c which have trigger:always
base_total = interview_always                    # 24 if pre-intake already done
              + pre_intake_always if needed       # 32 if pre-intake included
active_conditionals = count of triggered conditional follow-ups  # 0 at start, grows
estimated_total = base_total + active_conditionals
buffer = ceil(estimated_total * 1.15)            # 15% headroom
percent = floor(answered / buffer * 100)

Display rules:
- Format: "Q{current}/~{buffer} ({percent}%)"
- Never display > 95% until truly the final question
- When new follow-ups activate, buffer adjusts — but 15% headroom prevents erratic jumps
- Final question: show "마지막 질문" instead of percentage
- After all questions: "✅ 인터뷰 완료"
- Pre-intake and interview are shown as one continuous flow (no separate progress bars)
```

**Display example (with pre-intake):**
```
Q1/~35 (3%)   → Q9/~35 (26%)  → Q20/~37 (54%)  → Q33/~37 (89%)  → 마지막 질문
  Pre-intake ──────┘  Interview starts ──┘            ↑ follow-ups adjusted
```

**Display example (pre-intake already provided):**
```
Q1/~24 (4%)   → Q5/~24 (21%)  → Q12/~26 (46%)  → Q22/~26 (85%)  → 마지막 질문
```

### Interview Flow (Authoritative Execution Sequence)

> This is the single source of truth for interactive mode execution.
> Phase 1.1 routes here; after completion, control returns to Phase 1.2.

**Step 1 — Initialize + Pre-intake Check:**

First, initialize both data structures:
```
interview_context = {}    # populated from pre-intake (file or P1-P9)
interview_state = {
  answers: {},
  answered_count: 0,
  skipped_ids: [],
  question_queue: [],     # populated after pre-intake context is available
  active_conditionals: 0
}
```

Then ask PM via AskUserQuestion:
```
Pre-intake(사전 질문지) 답변이 있나요?
1. 파일로 있음 (경로 입력)
2. 아직 없음 — 지금 Pre-intake부터 시작
```

- **Option 1 (파일 있음)**: Read file → extract `app_name`, `platform`, `user_types`, `reference_app`, `current_tools`, `launch_date` → store in `interview_context` → build `question_queue` with interview questions only [B1, B2, U1, U2, U3, D1, ...O1] → skip to Step 3
- **Option 2 (없음)**: Build `question_queue` with pre-intake + interview questions [P1, P2, ...P9, B1, B2, ...O1] → proceed to Step 2

**Queue construction rule:** Insert all questions in document order. Conditional follow-ups are included in position (after their parent) but will be **evaluated and skipped** at runtime if trigger is false. This means the queue is static — no dynamic insertion needed.

**Step 2 — Pre-intake Interview (P1-P9):**
Run Pre-intake questions from the question tree below. These are asked BEFORE folder setup because P1 provides the app name.

Execution:
1. Take next question from `question_queue`
2. Evaluate trigger → if false, add to `skipped_ids`, take next
3. Ask P1 (앱 이름) — **mandatory, always first, trigger: always**
4. Continue P2-P9 + conditionals (P4, P6a, P6b)
5. After P9: populate `interview_context` from pre-intake answers

**Step 3 — Folder Setup + HTML:**
Now that `app_name` is known (from pre-intake file or P1):
1. Derive folder name: spaces → underscores, remove special characters
2. Create folders:
   ```bash
   mkdir -p .claude-project/prd/{ProjectName}/intermediate
   mkdir -p .claude-project/prd/{ProjectName}/drafts
   ```
3. Copy `skills/client/prd/generate-prd/templates/interview-presenter.html` (relative to skill directory) → `.claude-project/prd/{ProjectName}/interview-live.html`
4. Display to PM:
   ```
   ✅ 프로젝트 폴더 생성: .claude-project/prd/{ProjectName}/

   브라우저에서 아래 파일을 열고 클라이언트에게 화면을 공유하세요:
   .claude-project/prd/{ProjectName}/interview-live.html

   답변은 이 터미널에서 입력합니다. 클라이언트는 브라우저 화면만 봅니다.
   준비되면 Enter를 눌러주세요.
   ```

**Step 4 — PRD Interview (B1-O1):**
Run interview questions from the question tree.

Per question (take next from `question_queue`):
1. **Trigger check**: Evaluate trigger condition against `interview_state.answers` (see Trigger Evaluation below)
2. **Skip if false**: If trigger is not met, add to `skipped_ids`, do NOT increment `answered_count`, take next question
3. **Generate presets**: Apply Dynamic Preset Rules (see below) using `interview_context`
4. **Calculate progress**: Increment `answered_count`, recalculate `buffer` and `percent` (see Progress Indicator above)
5. **Update HTML**: Replace all placeholders in `interview-live.html` (see HTML Content Generation below for exact placeholder → HTML mapping per question type)
6. **Ask PM**: Use AskUserQuestion with the question text + preset options
7. **Record**: Save answer to `interview_state.answers[question_id]`. If answer is a preset letter (A/B/C), store the letter. If custom text (D), store the full text.
8. **Update HTML footer**: Add this Q&A to `{{PREVIOUS_ANSWERS}}`
9. **Conditional tracking**: If this answer triggers a conditional follow-up (already in queue), increment `active_conditionals` for progress buffer adjustment

**Step 5 — Compile & Return:**
1. Compile all answers (pre-intake + interview) into `intermediate/client-answers.md`:
   ```markdown
   # Client Answers — {AppName}
   # Generated: {date}
   # Mode: Interactive Interview

   === Pre-intake ===
   1. 앱/서비스 이름: {P1 answer}
   2. 앱 설명: {P2 answer}
   ...

   === Business ===
   1. Business Model: {B1 answer}
   2. Success metrics: {B2 answer}
   ...

   === Features ===
   10. Main Features: {F1 answer}
   ...
   ```
2. Update HTML to show "✅ 인터뷰 완료" completion screen
3. Return control to Phase 1.2 (Existing PRD Check) with the compiled file path

### Pre-intake Questions (Interactive Mode)

> Only asked when PM selects "아직 없음" in step 2. These provide the foundational context
> that shapes preset options for all subsequent interview questions.

```yaml
- id: P1
  category: Pre-intake
  question: "앱/서비스 이름은 무엇인가요?"
  type: free_text
  trigger: always

- id: P2
  category: Pre-intake
  question: "이 앱이 하는 일을 1-2문장으로 설명해주세요."
  type: free_text
  trigger: always

- id: P3
  category: Pre-intake
  question: "출시 플랫폼은 어디인가요?"
  type: tiered
  trigger: always
  presets:
    A: "웹만"
    B: "(권장) 모바일 앱 (iOS + Android)"
    C: "전부 (웹 + iOS + Android)"

- id: P4
  category: Pre-intake
  question: "스토어 등록을 원하시나요?"
  type: tiered
  trigger: "P3.answer != A"
  presets:
    A: "구글플레이만"
    B: "(권장) 앱스토어 + 구글플레이 둘 다"
    C: "아직 미정"

- id: P5
  category: Pre-intake
  question: "주요 사용자는 누구인가요?"
  type: free_text
  trigger: always
  hint: "예: 환자와 의사, 구매자와 판매자, 학생과 선생님"

- id: P6
  category: Pre-intake
  question: "현재 수동으로 하고 있는 업무를 앱으로 만드는 건가요?"
  type: yes_no_detail
  trigger: always
  presets:
    A: "예 — 기존 도구를 앱으로 대체"
    B: "아니오 — 완전히 새로운 서비스"
  follow_ups: [P6a, P6b]

- id: P6a
  category: Pre-intake
  question: "현재 어떤 도구를 사용 중이고, 규모는 어느 정도인가요?"
  type: free_text
  trigger: "P6.answer == A"
  hint: "예: 엑셀+카카오톡+줌, 사용자 약 200명, 월 500건 처리"

- id: P6b
  category: Pre-intake
  question: "첫 6개월 내 예상 최소 사용자 수는?"
  type: tiered
  trigger: "P6.answer == B"
  presets:
    A: "100명 미만"
    B: "100~1,000명"
    C: "1,000명 이상"

- id: P7
  category: Pre-intake
  question: "참고하고 싶은 앱이 있나요?"
  type: free_text
  trigger: always
  hint: "앱 이름 + 참고 포인트 (UI? 기능? 사용자 흐름?)"

- id: P8
  category: Pre-intake
  question: "희망 출시일은 언제인가요?"
  type: tiered
  trigger: always
  presets:
    A: "1-2개월 내"
    B: "3-4개월 내"
    C: "6개월 이상 / 미정"

- id: P9
  category: Pre-intake
  question: "기타 참고사항이 있나요?"
  type: free_text
  trigger: always
  hint: "법적 요구사항, 특수 환경, 예산 제약 등"
```

**Pre-intake → Interview Context Flow:**
Pre-intake answers are used to:
- P1 (앱 이름) → project folder name + all headers
- P2 (앱 설명) → Option B preset generation context
- P3 (플랫폼) → platform-specific questions filtering
- P5 (사용자) → U1 pre-fill, relationship question triggers
- P6 (기존 도구) → business model context, data migration needs
- P7 (참고 앱) → D1 pre-fill
- P8 (출시일) → MVP scope recommendations

### State Management

The agent maintains two data structures throughout the interview:

**`interview_context`** — Extracted from pre-intake (file or P1-P9 answers):
```
interview_context = {
  app_name: string,        # from P1 or pre-intake file
  app_description: string, # from P2
  platform: string,        # from P3 ("web" | "mobile" | "all")
  user_types: string[],    # from P5 (parsed into array)
  is_replacement: boolean, # from P6
  current_tools: string,   # from P6a (if replacement)
  reference_app: string,   # from P7
  launch_date: string,     # from P8
}
```
This context is used to generate dynamic presets for interview questions.

**`interview_state`** — Tracks all answers and progress:
```
interview_state = {
  answers: { [question_id]: string },  # e.g., { "P1": "삼성서울병원", "F3": "A" }
  answered_count: number,              # total questions answered
  skipped_ids: string[],               # questions skipped due to trigger=false
  question_queue: string[],            # remaining question IDs to ask
  active_followups: number,            # count of follow-ups added to queue
}
```

**Initialization:**
Done in Interview Flow Step 1. See that section for details.

**Queue construction:**
All questions (base + conditional) are inserted in document order at initialization.
Conditional follow-ups sit in position right after their parent question.

Example queue (pre-intake included):
`[P1, P2, P3, P4, P5, P6, P6a, P6b, P7, P8, P9, B1, B1a, B2, U1, U2, U3, D1, ..., O1]`

**Queue execution:**
- Take next question from front of queue
- Evaluate trigger → if `false`: add to `skipped_ids`, do NOT count, take next
- Evaluate trigger → if `true`: ask question, record answer, increment `answered_count`
- No dynamic insertion needed — all questions are pre-inserted, triggers control skip/ask

### Trigger Evaluation

Each question's `trigger` field determines whether to ask it. Evaluate as follows:

| Trigger | Meaning | Evaluation |
|---------|---------|------------|
| `always` | Always ask | → `true` |
| `"B1.answer != A"` | Ask if B1 was NOT answered with option A | → check `interview_state.answers["B1"] != "A"` |
| `"F3.answer == A"` | Ask if F3 was answered with option A (예) | → check `interview_state.answers["F3"] == "A"` |
| `"P3.answer != A"` | Ask if platform is not web-only | → check `interview_state.answers["P3"] != "A"` |
| `"P6.answer == A"` | Ask if replacing existing system | → check `interview_state.answers["P6"] == "A"` |
| `"P6.answer == B"` | Ask if new service | → check `interview_state.answers["P6"] == "B"` |
| `"len(U1.user_types) >= 2"` | Ask if 2+ user types | → parse U1 answer, count distinct user types ≥ 2 |

**Answer matching:** When client picks a preset (A/B/C), store the letter. When client provides custom input (D), store the full text. Trigger conditions compare against the letter for preset answers.

### Dynamic Preset Rules

Question presets tagged `(프로젝트 권장)` (Option B) are adjusted based on `interview_context`. The YAML tree contains **generic defaults** — the agent must override Option B at runtime using these rules:

**Rule 1 — App Type Adaptation:**
| `interview_context` Signal | Preset Adjustment |
|---------------------------|-------------------|
| `is_replacement == true` | B1 presets: add "(비수익) 내부 업무용" as default context |
| `platform == "mobile"` | Skip web-specific options; add mobile-specific (push, camera) |
| `platform == "web"` | Skip mobile-specific options (push, native features) |

**Rule 2 — User Type Injection:**
When `interview_context.user_types` is known, inject user type names into question text and presets:
- F1 question: replace generic "사용자 유형별" with actual types (e.g., "환자, 코치, 관리자별")
- F2a (signup fields): medical app → add "환자번호", e-commerce → add "배송지"
- F3a (chat type): if 3 user types → preset B includes "1:1:1 그룹 채팅" option

**Rule 3 — Context-Aware Defaults (keyword matching in `interview_context`):**

> **When evaluated:** At Step 4 substep 3 (Generate presets), BEFORE showing each question.
> The agent scans `interview_context.app_description` (P2) and `interview_context.current_tools` (P6a) for keywords.

| Pre-intake Answer | Applied To | Adjustment |
|-------------------|-----------|------------|
| P2 mentions "병원/의료/환자" | F2a presets | Option B adds "환자번호, 진료과" |
| P2 mentions "쇼핑/판매/결제" | T1 checklist | Pre-check "결제 (PG사)" |
| P2 mentions "예약/스케줄" | F5a checklist | Pre-check "일정 리마인더" |
| P6a mentions "엑셀" | DA2 presets | Default to "예 (권장)" |
| P6a mentions "카카오톡" | F3 presets | Default to "예 (권장: 기존 카톡 대체)" |

**Rule 4 — Fallback:**
If no context signal matches, use the YAML tree's preset as-is (generic best practice).

### HTML Content Generation

On each question, read `templates/interview-presenter.html` and replace placeholders to write `interview-live.html`.

**Placeholder replacement table:**

| Placeholder | Source | Example |
|-------------|--------|---------|
| `{{PROGRESS_PERCENT}}` | `floor(answered_count / buffer * 100)` | `33` |
| `{{PROGRESS_DISPLAY}}` | See Progress Indicator logic | `Q8/~24 (33%)` |
| `{{CATEGORY}}` | Current question's `category` field | `Features` |
| `{{CONTENT}}` | Generated from question type (see below) | HTML block |
| `{{PREV_ANSWERS_TOGGLE}}` | `"✅ 이전 답변 ({N}개)              [펼치기]"` | — |
| `{{PREVIOUS_ANSWERS}}` | HTML list of all previous Q&A | HTML block |

**`{{CONTENT}}` generation by question type:**

**`tiered`:**
```html
<div class="question-number">Q{answered_count + 1}</div>
<div class="question-text">{question text}</div>
<div class="question-hint">{hint if exists, otherwise empty}</div>
<div class="options">
  <div class="option-card">
    <div class="option-label"><span class="option-tag tag-minimal">최소한</span>A. {preset_a}</div>
  </div>
  <div class="option-card recommended">
    <div class="option-label"><span class="option-tag tag-recommended">프로젝트 권장</span>B. {preset_b after dynamic adjustment}</div>
  </div>
  <div class="option-card">
    <div class="option-label"><span class="option-tag tag-extended">확장</span>C. {preset_c}</div>
  </div>
  <div class="option-card">
    <div class="option-label"><span class="option-tag tag-custom">직접 입력</span>D. 직접 입력</div>
  </div>
</div>
```

**`free_text`:**
```html
<div class="question-number">Q{answered_count + 1}</div>
<div class="question-text">{question text}</div>
<div class="question-hint">{hint if exists}</div>
<div class="free-text-indicator">
  <p>자유롭게 답변해주세요</p>
</div>
```

**`yes_no_detail`:**
```html
<div class="question-number">Q{answered_count + 1}</div>
<div class="question-text">{question text}</div>
<div class="options">
  <div class="option-card recommended">
    <div class="option-label"><span class="option-tag tag-recommended">권장</span>A. {preset_a}</div>
  </div>
  <div class="option-card">
    <div class="option-label">B. {preset_b}</div>
  </div>
  <div class="option-card">
    <div class="option-label">C. {preset_c if exists, otherwise "추후 결정"}</div>
  </div>
</div>
```

**`checklist`:**
```html
<div class="question-number">Q{answered_count + 1}</div>
<div class="question-text">{question text}</div>
<div class="question-hint">{hint if exists}</div>
<div class="checklist">
  {for each item in preset_items:}
  <div class="checklist-item">{item}</div>
  {end for}
</div>
```

**`complete` (final screen):**
```html
<div class="complete-screen">
  <div class="complete-icon">✅</div>
  <div class="complete-title">인터뷰 완료</div>
  <div class="complete-subtitle">모든 질문이 완료되었습니다.<br>답변을 바탕으로 PRD를 생성합니다.</div>
</div>
```

**`{{PREVIOUS_ANSWERS}}` item format:**
```html
<div class="prev-answer">
  <div class="prev-answer-q">Q{N}. {question text, truncated to 30 chars}...</div>
  <div class="prev-answer-a">{answer text, truncated to 50 chars}</div>
</div>
```

### HTML Presenter Layout Reference

Each question triggers a full rewrite of `interview-live.html`. The browser auto-refreshes every 2 seconds via `<meta http-equiv="refresh" content="2">`.

```
┌─────────────────────────────────────────┐
│  Progress Bar: ████████░░░░  Q8/~24 33% │
│  Category: Features                      │
├─────────────────────────────────────────┤
│                                         │
│  채팅 기능이 필요한가요?                   │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ A. 예 (권장: 사용자 간 소통 필요)  │    │
│  ├─────────────────────────────────┤    │
│  │ B. 아니오                        │    │
│  ├─────────────────────────────────┤    │
│  │ C. 추후 결정                     │    │
│  └─────────────────────────────────┘    │
│                                         │
├─────────────────────────────────────────┤
│  ✅ 이전 답변 (7개)              [펼치기] │
└─────────────────────────────────────────┘
```

---

## Phase 0: Argument Parsing & Mode Dispatch

> **Always runs first.** Parses `$ARGUMENTS` for mode flags and routes to the correct phase.

### 0.1 Flag Parsing

Tokenise `$ARGUMENTS` into:
- **Mode flags** (mutually exclusive): `--feature`, `--tech`, `--full`
- **Modifier flag**: `--interview`
- **Positional arg**: file path (interpretation depends on mode)

Defaults:
- No mode flag → `--full`
- No file path AND no `--interview` → ask via AskUserQuestion

### 0.2 Validation

Reject invalid combinations BEFORE any folder/agent work:

| Combination | Action |
|-------------|--------|
| `--tech` + `--interview` | ERROR: "Interview mode applies to Feature phase only. Run `/generate-prd --interview` (which finishes with Phase B by default), or `/generate-prd --interview --feature` to stop after the interview." |
| Two of `--feature` / `--tech` / `--full` | ERROR: "Choose only one mode flag." |
| `--tech` + no file path | ERROR: "Phase B requires the path to an existing Feature PRD. Usage: `/generate-prd --tech .claude-project/prd/{App}/{App}_PRD.md`" |
| `--feature` / `--full` + no file path AND no `--interview` | Ask via AskUserQuestion: file mode (path) or interview mode |

### 0.3 Dispatch

| Mode | Routing |
|------|---------|
| `--feature` | Phase 1.1 → Phase 1-4 → STOP after 4.5 result report (skip Phase B chain) |
| `--full` (default) | Phase 1.1 → Phase 1-4 → auto-continue to Phase B1-B4 → final result |
| `--tech` | Skip Phase 1-4 entirely → Phase B1.1 with file path as Feature PRD input (apply pre-check) |
| `--interview` (with `--feature` or `--full`) | Jump to "Interactive Interview Mode" section first; on completion, continue per mode flag |

After dispatch decisions are recorded, continue to Phase 1.1 (or Phase B1.1 for `--tech`).

---

## Phase 1: Parse

### 1.1 Intake & Validation

> Phase 0 has already validated flags and resolved input mode. This step focuses on the input file itself.

**Inputs from Phase 0:**
- `mode` ∈ {`--feature`, `--full`}
- `interview_mode` (boolean — true when `--interview` was supplied)
- `client_answers_path` (file path; may be `null` when `interview_mode=true` and no pre-intake file was provided)

**Routing:**
```
interview_mode=true             → Jump to "Interactive Interview Mode" section
                                  (returns compiled client-answers.md, then continue to 1.2)
client_answers_path is provided → File mode: validate file → continue to 1.2
```

**File mode validation:**
1. File exists and readable?
2. File not empty?
3. If valid → continue to 1.2

**On failure:**
```
Error: [specific error message]
Usage: /generate-prd /path/to/client-answers.md
       /generate-prd --interview
       /generate-prd --feature /path/to/client-answers.md
       /generate-prd --tech /path/to/{App}_PRD.md
```

> **Note:** Interactive mode handles its own folder setup, pre-intake, interview, and answer compilation.
> It returns control to Phase 1.2 with `intermediate/client-answers.md` ready for parsing.

### 1.2 Existing PRD Check

**Input:**
- **File mode:** app name extracted from the client answer file
- **Interactive mode:** app name from `interview_context.app_name`, compiled answers at `.claude-project/prd/{ProjectName}/intermediate/client-answers.md`

**Steps:**
1. Search `.claude-project/prd/` for existing PRD matching the app name
2. If found, ask user via AskUserQuestion:
   ```
   Existing PRD found: [filename]
   1. Reference existing PRD and generate new (use as context)
   2. Generate completely fresh
   ```
3. If referencing: Pass existing PRD path to Phase 2 agents as additional context
4. Pass the client answer file path (from `$ARGUMENTS` or `intermediate/client-answers.md`) to Phase 1.4 Parser

### 1.3 Project Folder Setup

> **Interactive mode:** Skip this step — folders already created in Interview Flow Step 3.

**File mode only:**
Derive folder name from app name:
- Spaces → underscores, remove special characters
- Example: "TireBank Mall" → `TireBank_Mall`

```bash
mkdir -p .claude-project/prd/{ProjectName}/intermediate
mkdir -p .claude-project/prd/{ProjectName}/drafts
```

### 1.4 Parser Agent → 3 Intermediate Artifacts

Launch **parser** (sonnet) to read the client answer file and produce 3 structured files in `.claude-project/prd/{ProjectName}/intermediate/`:

#### parsed-input.md
Organize raw input by section:
- Basic Info (app name, type, deadline, user types, relationships)
- Design Reference (reference apps, differentiators, colors, fonts)
- Features (per-user-type features, module flows, auth, communication)
- **User Data Fields** (signup fields, profile fields, terms agreement)
- **Notification triggers** (events, channels, user settings)
- Data (collected data, exportable data)
- Technical (3rd party, domain terms)
- Other (additional info)

#### screen-inventory.md
Complete screen inventory:
```markdown
## User App Routes (Total: N)
| # | Route | Page Name | User Type | Access Group | Notes |
|---|-------|-----------|-----------|-------------|-------|

## Admin Routes (Total: M)
| # | Route | Page Name | Managed Entity | Default Sort | Notes |
|---|-------|-----------|----------------|-------------|-------|
```

#### tbd-items.md
Every unclear item with a recommended value, priority level, and status tracking:
```markdown
# TBD Items — {ProjectName}

**Status Legend:**
- 💡 Recommended — Awaiting PM decision
- 📌 Adopted — PM confirmed (accept/modify)
- ❌ Rejected — Moved to Open Questions

**Priority Legend:**
- 🔴 Critical — Architecture/scope impact, must decide before Phase 2
- 🟡 Standard — Industry best practice, batch approval possible
- 🟢 Optional — Nice-to-have, can defer to Phase 4

---

## 🔴 Critical Items

- **{ID}. {Item name}**
  - [💡 Recommended: {best-practice value}]
  - Rationale: {why this is recommended}
  - Priority: 🔴 Critical — {why this affects architecture/scope}
  - Status: Pending

## 🟡 Standard Items

- **{ID}. {Item name}**
  - [💡 Recommended: {best-practice value}]
  - Rationale: {why this is recommended}
  - Priority: 🟡 Standard
  - Status: Pending

## 🟢 Optional Items

- **{ID}. {Item name}**
  - [💡 Recommended: {best-practice value}]
  - Rationale: {why this is recommended}
  - Priority: 🟢 Optional
  - Status: Pending
```

### 1.5 Adaptive Complexity Detection

Parser detects and flags in `parsed-input.md` header:
```markdown
## Adaptive Complexity Flags
| Flag | Detected | Source |
|------|----------|--------|
| SaaS / Multi-tenancy | Yes/No | [source] |
| File Upload / Image Processing | Yes/No | [source] |
| Real-time / WebSocket | Yes/No | [source] |
| Billing / Subscription | Yes/No | [source] |
| Chat / Messaging | Yes/No | [source] |
```

These flags are read by Phase B (auto-runs in `--full` mode, or manually via `--tech`) to activate conditional sections (Auth Flow, File Pipeline, Real-time, Billing, Multi-tenancy).

### 1.5.1 Feature Bundle Detection

Parser scans extracted features against `feature-bundle-map.md` trigger keywords and produces a "Detected Feature Bundles" table in `parsed-input.md`:

```markdown
## Detected Feature Bundles
| Bundle | Detected | Trigger Source | Required Items | Recommended Items | Conditional Triggers |
|--------|----------|----------------|----------------|-------------------|---------------------|
| Auth/Registration | Yes | "회원가입, 소셜로그인" | 9 | 6 | Social Login: Yes, Phone Auth: No |
| Chat/Messaging | No | — | — | — | — |
```

**Bundle Detection Rules:**
1. Match trigger keywords from `feature-bundle-map.md` against client input
2. Evaluate Conditional items per bundle (trigger condition → Yes/No)
3. Required items implying a missing page → add to `screen-inventory.md` with `[Bundle-derived]` note
4. Recommended items without client input → add to `tbd-items.md`
5. MVP Out-of-Scope features → mark bundle as **Deferred** (listed but not expanded)
6. Notification bundle implicitly activates when any event-producing bundle is active
7. Dashboard/Analytics bundle implicitly activates when admin users exist + any data bundle active
8. If bundle count exceeds complexity threshold → output `⚠️ Bundle Density Warning`

### 1.6 PM First Review — Critical TBD Items (Mandatory)

> **This step is mandatory.** All 🔴 Critical items must be decided before proceeding to Phase 2.
> If no 🔴 Critical items exist, skip to Phase 2 automatically.

After parser completes, present **🔴 Critical items only** to PM via AskUserQuestion:

```markdown
## Critical Items — PM Decision Required (Phase 1)

These items affect architecture and scope. Deciding now saves rework in later phases.

| # | Item | Recommendation | Rationale | Decision |
|---|------|---------------|-----------|----------|
| 1 | [Critical item] | [Recommended value] | [Why] | Accept / Reject / Modify |
```

**Rules:**
- Only present 🔴 Critical items (architecture/scope impact)
- 🟡 Standard and 🟢 Optional items stay Pending for Phase 4
- Update `tbd-items.md` Status field based on PM decisions:
  - Accept → `Status: Confirmed`
  - Modify → `Status: Confirmed` + update recommended value to PM's version
  - Reject → `Status: Rejected`

---

## Phase 2: Write

Launch **feature-writer** and **checklist** in parallel.

```
┌──────────────────────────────────────────────┐
│  Parallel Execution                          │
│                                              │
│  feature-writer (opus)  → Section 0-4 + 2.5 │
│  checklist (sonnet)     → client-checklist   │
│                                              │
└──────────────────────────────────────────────┘
```

### Agent Input Distribution

```
Both agents receive:       parsed-input.md + screen-inventory.md + tbd-items.md

feature-writer also gets:  depth-guide.md
                           prd-template.md
                           admin-standards.md
                           feature-bundle-map.md
                           bug-patterns-filtered.md (if exists)

checklist also gets:       prd-template.md (Section 9)
                           Notion SOP DB access (via API — DB ID: 15ab6d88d2cf8042a9effff908507e5f)
```

**Notion SOP Integration**: The checklist agent queries the Notion SOP database at runtime. Needs `NOTION_API_KEY` environment variable. If unavailable, generates checklist without SOP links and adds note: `SOP 링크: Notion API 미연결 — 수동으로 추가 필요`.

### Feature-Writer Sections

- **Section 0**: Project Overview + User Data Fields (Signup/Profile/System separation)
- **Section 1**: Terminology
- **Section 2**: System Modules + Real Scenarios
- **Section 2.5**: Notification Specification (triggers, channels, settings)
- **Section 3**: User Application (8 mandatory items per route, N/A when not applicable)
- **Section 4**: Admin Dashboard + Default Sort Order

### TBD Status Handling Rules

feature-writer reads `tbd-items.md` Status field and writes accordingly:
- `Status: Confirmed` → write as `[📌 Adopted]` (PM already decided in Phase 1)
- `Status: Confirmed` + modified value → write as `[📌 Adopted: {PM's version}]`
- `Status: Rejected` → move to Section 8 (Open Questions)
- `Status: Pending` → write as `[💡 Recommended: X]` with rationale (PM confirms in Phase 4)

This ensures Phase 1 PM decisions flow into the draft without re-asking.

### TBD Generation Rules (for items not in tbd-items.md)

- Items not specified in input → write `[💡 Recommended: X]` with rationale
- Example: `Login method: Email + Password, Social Login (Google, Apple) [💡 Recommended: B2C app standard]`
- Remaining `[💡 Recommended]` items confirmed by PM in Phase 4 (Deliver)

### Additional Questions — Mandatory Recommendation Rule

**Every question in Section 8 (Additional Questions) MUST include a Recommendation column** with the dev-side proposed default value and a one-line rationale. This is non-negotiable.

**Why**: Open-ended questions burden the client and slow decisions. A question with a proposed default lets the client approve-as-is (fast path) or override with context. The PM/dev side has domain knowledge to propose sensible defaults for most items — not using it is a missed opportunity.

**Classification** — when writing each question, classify the item first:

| Type | Definition | Recommendation behavior |
|:--|:--|:--|
| **Structural** | Schema, architecture, UX patterns, standard policy values (password rules, max list sizes, pagination limits, permission defaults, industry-standard UX). | **Must propose** a concrete default with rationale (industry standard / benchmark app / technical constraint). |
| **Policy-with-default** | Business policy where industry defaults exist (e.g., free shipping threshold — propose structure + example value). | **Must propose** structure confirmation + one example value as the default. |
| **Client-only** | Pure client content or decisions with no reasonable industry default (specific product names, internal business rules, pricing values, partner selections requiring client contracts). | Write `— (client-only decision)` in Recommendation column with a one-line explanation of why no default was proposed. |

**Rule of thumb**: If you can Google "best practice for X in {industry}" and find a common answer, it's Structural or Policy-with-default — propose it. If the answer is unique to this client's business, it's Client-only.

**Anti-pattern to avoid**: Writing "TBD — 클라이언트 확인" for items like password rules, max address count, category depth, admin permission defaults. These all have industry-standard defaults — propose them and let the client override if needed.

**Output format** (table columns):
- Required table: `# | Question | Recommendation | Rationale | Blocks`
- Recommended table: `# | Question | Recommendation | Rationale | Affects`

### Bug Pattern Integration

If `.claude-project/knowledge/bug-patterns.md` or `references/bug-patterns-global.md` exists:
- Parser reads the bug patterns file and filters patterns by matching `bug-pattern-schema.md` categories against the project's detected features and user types
- Output: `bug-patterns-filtered.md` in intermediate/ containing only relevant patterns
- Feature-writer inserts `⚠️ Known Risk` tables per route with relevant patterns from the filtered file
- If no bug patterns file exists, generation proceeds without bug prevention sections (warning printed)

### Output Files

- `.claude-project/prd/{ProjectName}/drafts/feature-prd-draft.md`
- `.claude-project/prd/{ProjectName}/intermediate/client-checklist.md`

### 2.5 PM Draft Review

After feature-writer completes, present draft summary to PM via AskUserQuestion:

```markdown
## Draft Review — Module Structure & Screen List

### System Modules ({N} total)
| # | Module | Features | Scenarios |
|---|--------|----------|-----------|

### User App Routes ({N} total)
| # | Route | Key Features |
|---|-------|-------------|

### Admin Pages ({N} total)
| # | Page | Managed Entity |
|---|------|----------------|

**Questions:**
1. Are any modules missing or incorrectly scoped?
2. Are any screens missing from the route list?
3. Any other feedback on the draft structure?
```

**Rules:**
- Present high-level structure only (not full draft)
- PM feedback saved to `.claude-project/prd/{ProjectName}/intermediate/pm-review-notes.md`
- If PM has no feedback → skip, proceed to Phase 3
- If PM has feedback → support agent applies fixes alongside QA fixes in Phase 3

**pm-review-notes.md format:**
```markdown
# PM Review Notes — {ProjectName}

## Missing Modules
- [module name]: [what's missing]

## Missing Screens
- [screen name]: [user type, purpose]

## Scope Changes
- [item]: [add / remove / modify] — [reason]

## Other Feedback
- [free-form notes]
```

---

## Phase 3: QA + Fix (Max 3 Rounds)

### 3.1 Integrate

Finalize the Feature PRD draft:
1. Cross-reference terminology (Section 1 terms ↔ body text)
2. Unify terminology (same concept, different wording → standardize)
3. Add Open Questions section (Section 8)
4. Add Feature Change Log
5. **Consistency audit**:
   - Numeric consistency: extract number+unit patterns → flag conflicts
   - Client requirement tracking: all requirements from parsed-input.md present
   - Notification coverage: modules with events have notification triggers
6. Generate `[💡 Recommended]` summary table for Phase 4

Save: `.claude-project/prd/{ProjectName}/drafts/feature-prd-integrated.md`

### 3.2 QA Validation

Launch **qa-feature** (sonnet) to validate against 16 PASS/FAIL rules + 1 INFO report (FB1).

Rules: 1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 15, N1, N2, N3, B1, B2 (PASS/FAIL) + FB1 (INFO only).

> Detailed rules: see `references/validation-checklist.md`

| # | Rule | FAIL Condition |
|---|------|---------------|
| 1 | Route Count Match | screen-inventory route missing from PRD |
| 2 | Mandatory 8 Items | Route missing any of 8 required items (N/A counts as present) |
| 3 | Admin 1:1 Mapping | CRUD entity without admin page |
| 4 | Admin Standard + Sort | Admin page missing standard features or Default Sort |
| 5 | Terminology Cross-Ref | Term only in glossary or only in body |
| 6 | All-Decided | Unresolved `[💡 Recommended:]` in body (pre-PM confirmation: soft pass) |
| 7 | Route Coverage | Page Map ↔ Feature List mismatch |
| 8 | Numeric Consistency | Same concept, different values |
| 12 | Client Requirement Tracking | Requirement missing from PRD and Open Questions |
| 13 | Real Scenario Existence | Module without success+failure scenarios |
| 15 | Client Checklist Completeness | Required subsection missing |
| N1 | Notification Coverage | Module with events but no notification trigger |
| N2 | User Data Fields | Missing signup/profile/system field groups |
| N3 | Sort Order — All Lists | List page missing default sort (Section 3 + 4) |
| B1 | Business Context | Missing business model, goals, or success metrics in Section 0 |
| B2 | Feature-Goal Linkage | MVP feature without goal linkage or goal without supporting feature |
| FB1 | Bundle Coverage Report | INFO only — does not affect PASS/FAIL. Reports detected bundles' coverage |

**Note on Rule 6**: During QA (before PM confirmation), `[💡 Recommended:]` markers are expected and do NOT cause FAIL. They only cause FAIL in the final validation after PM confirmation in Phase 4.

### 3.3 FAIL Handling + PM Feedback

1. QA FAIL or PM review notes exist → **support** (sonnet) fixes FAIL items + applies PM feedback from `pm-review-notes.md`
2. After fix → **qa-feature** re-validates
3. **Max 3 rounds**
4. After 3 rounds still FAIL:
   ```
   ## QA Validation Failed — Manual Intervention Required

   ### Repeatedly Failing Items
   - Rule {N}: {name} — {reason}

   ### Attempted Fixes
   1. {attempt 1}
   2. {attempt 2}
   3. {attempt 3}

   ### Recommended Action
   {what needs manual fixing}
   ```

---

## Phase 4: Deliver

### 4.1 Remaining Recommended Items — PM Confirmation

After QA PASS, present **remaining** `[💡 Recommended]` items to PM.
(🔴 Critical items were already decided in Phase 1.6 — only 🟡 Standard and 🟢 Optional remain.)

```markdown
## Remaining Recommended Items — PM Decision Required

🔴 Critical items were already confirmed in Phase 1. Below are Standard and Optional items.

### 🟡 Standard Items (batch approval available)
Industry best practices. You can "Accept All" or review individually.

| # | Item | Recommendation | Rationale | Decision |
|---|------|---------------|-----------|----------|
| 1 | Password rules | 8+ chars, alphanumeric + special | OWASP guidelines | Accept / Reject / Modify |

[Accept All Standard Items] / [Review Individually]

### 🟢 Optional Items
Nice-to-have features. Can be deferred to post-MVP.

| # | Item | Recommendation | Rationale | Decision |
|---|------|---------------|-----------|----------|
| 1 | Dark mode | System preference detection | UX trend | Accept / Reject / Defer |
```

Use AskUserQuestion for confirmation:
- **Accept** → `[💡 Recommended]` → `[📌 Adopted]`
- **Modify** → Apply PM's version + `[📌 Adopted: {PM's version}]`
- **Reject** → Move to Open Questions (Section 8)
- **Accept All Standard** → Batch approve all 🟡 items

After PM confirms all items, run **Rule 6 (All-Decided)** final validation to ensure zero unresolved markers remain.

### 4.1.5 Bundle Coverage Review

After TBD confirmation, present bundle coverage summary to PM:

```markdown
## Bundle Coverage Review

Active Bundles: {list with item counts}
Total items auto-included: {N} (Required: {R}, Recommended: {Rec})
Items for your review: {M} Recommended items across {K} bundles

[Accept All Defaults] / [Review per Bundle]
```

If PM chooses **Review per Bundle**, present each active bundle:
```markdown
### Auth/Registration (9 Required auto-included, 6 Recommended)
Recommended items included by default:
  ☑ Email verification flow
  ☑ Profile View/Edit Page
  ☑ Auto-Login (Remember Me)
  ☑ Login failure handling
  ☑ Duplicate account check
  ☑ Other User Profile Page

To exclude any item, uncheck it.
```

**Rules:**
- Required items are NOT shown for review — they are auto-included (PM can only exclude with written justification)
- Recommended items are shown per-bundle for quick review
- Most PMs will "Accept All Defaults" — the detailed review is opt-in
- Excluded items are noted in Feature Change Log with source: "Bundle Review Phase 4"
- Deferred bundles are listed for awareness but require no action

### 4.2 UX Analysis (Optional)

Ask user via AskUserQuestion:
```
Feature PRD generation complete. Include UX flow analysis?

Analysis covers:
- Navigation flow issues
- User journey optimization
- Information architecture improvements
- Common UX problem patterns

[Yes] / [No]
```

- Yes → Append UX analysis to PRD end
- No → Skip

### 4.3 Save Final File

Filename: `[AppName]_PRD.md` (stable — overwrites on re-run; Phase B (when chained or run later) merges Sections 5-7 into this same file)
- Sanitize: spaces → underscores, remove special characters
- Location: `.claude-project/prd/{ProjectName}/`
- Before writing, delete any legacy dated files matching `{AppName}_FeaturePRD_*.md` or `{AppName}_PRD_*.md` in the same folder to avoid confusion with prior outputs.

### 4.4 Cleanup

Intermediate artifacts preserved by default (for debugging/audit).
If user requests cleanup:
```bash
rm -rf .claude-project/prd/{ProjectName}/intermediate/
rm -rf .claude-project/prd/{ProjectName}/drafts/
```

### 4.5 Result Report

```markdown
## Feature PRD Generation Complete

### Output
- File: `.claude-project/prd/{ProjectName}/[filename].md`
- Mode: [New / Reference Update]

### Summary
- Section 0: Project Overview + User Data Fields ✅
- Section 1: Terminology ✅
- Section 2: System Modules ({N} modules, {N} Real Scenarios) ✅
- Section 2.5: Notification Specification ({N} triggers, {N} channels) ✅
- Section 3: User Application ({N} routes, 8 items each) ✅
- Section 4: Admin Dashboard ({M} pages, all with Default Sort) ✅
- Section 8: Open Questions ({Q} items) ✅
- QA Validation: PASS ({N} rounds, 16 rules + FB1 INFO)
- Client Checklist: {N} subsections ({M} items)
- PM Decisions: {N} adopted [📌] (Phase 1: {A} critical, Phase 4: {B} standard/optional), {M} moved to questions
- Additional Questions: {N} items
- UX Suggestions: {N} items (or "Skipped")
- Bug prevention: {N} routes (or "No bug-patterns found")
- Feature Bundles: {N} active, {M} deferred — Required: {R} items, Recommended: {Rec} items ({excluded} excluded by PM)
- Detected features for Phase B: {list}

### Output Structure
.claude-project/prd/{ProjectName}/
├── intermediate/
│   ├── parsed-input.md
│   ├── screen-inventory.md
│   ├── tbd-items.md           ← With Status + Priority fields
│   ├── pm-review-notes.md     ← PM feedback from Phase 2.5 (if any)
│   └── client-checklist.md    ← Client deliverable
├── drafts/
└── {AppName}_PRD.md           ← Feature PRD (stable; Phase B merges Sections 5-7 into this file)

### Next Steps
1. Review the Additional Questions section
2. Send questions to client for clarification
3. **Deliver `client-checklist.md` to client for preparation**
4. **(`--feature` mode)** After PM resolves remaining `[💡 Recommended:]` items, run `/generate-prd --tech .claude-project/prd/{ProjectName}/{AppName}_PRD.md` to add Technical sections (Schema, Permissions, System Design). Skipped automatically when running default `--full` mode.
5. Update PRD with client responses using `/update-prd [answer-file]`
```

### 4.6 Phase B Continuation (mode-dependent)

After 4.5 completes:

- **`--feature` mode**: STOP here. Result report above is the final output.
- **`--full` mode (default)**: Continue to Phase B1 immediately. Use `.claude-project/prd/{ProjectName}/{AppName}_PRD.md` (the file just written) as Phase B input. Skip B1.1's pre-check ABORT path — when chained from Phase A, all `[💡 Recommended:]` markers were already resolved in Phase 4.1.

---

## Phase B: Technical PRD (Sections 5-7)

> **Entry points:**
> - `--full` (default) chains here automatically from Phase 4.6 with the just-written `{App}_PRD.md`.
> - `--tech <feature-prd-path>` enters here directly via Phase 0 dispatch (with full pre-check enforcement).
>
> **Core principles:**
> 1. **Feature PRD as Source of Truth**: All entities, permissions, and integrations are derived from Phase A
> 2. **Full Recommendation**: Technical decisions use `[💡 Recommended]` — developer team reviews (not PM)
> 3. **Strict Density**: Every entity needs full column-level schema, every permission cell must be filled
> 4. **Config Uniqueness**: Port, Redis prefix, cookie names, DB name must not collide with other projects
> 5. **Cross-Phase Consistency**: Section 5-7 must exactly match Feature PRD Section 3/4 entities
> 6. **Machine Verification**: QA uses only counting/existence rules

### Phase B1: Extract

#### B1.1 Input Validation

Read Feature PRD path from Phase 0 dispatch (or, in `--full` mode, the just-written file path from Phase 4.3).
If no path provided in `--tech` mode, auto-detect the most recent `*_PRD.md` in `.claude-project/prd/`.

**Pre-check — ABORT if Feature PRD is incomplete:**

Skip this check when chained from Phase A in `--full` mode (Phase 4.1 already resolved all markers).
For `--tech` mode (standalone invocation):

1. Scan for unresolved `[💡 Recommended:]` markers
2. If found → ABORT:
   ```
   Error: Feature PRD contains {N} unresolved [💡 Recommended:] items.
   PM must confirm all items before Technical PRD can be generated.

   Unresolved items:
   - [item 1]
   - [item 2]

   Run /generate-prd --feature <answers-file> to complete the Feature phase first
   (or /generate-prd <answers-file> for the full pipeline).
   ```

#### B1.2 Project Folder Setup

Use existing project folder from Phase A:
```bash
mkdir -p .claude-project/prd/{ProjectName}/intermediate
mkdir -p .claude-project/prd/{ProjectName}/drafts
```

#### B1.3 Launch Parallel Agents

Launch **tech-parser** and **config-allocator** simultaneously.

```
┌──────────────────────────────────────────────┐
│  Parallel Execution (Phase B1)               │
│                                              │
│  tech-parser (sonnet)      → 3 inventories   │
│  config-allocator (sonnet) → project-config  │
│                                              │
└──────────────────────────────────────────────┘
```

#### B1.4 Tech-Parser → 3 Inventory Files

Launch **tech-parser** (sonnet) to extract from Feature PRD:

##### entity-inventory.md
```markdown
# Entity Inventory — {ProjectName}

## Entities (Total: N)
| # | Entity | Source Routes | CRUD Operations | Estimated Columns |
|---|--------|-------------|-----------------|-------------------|

## Relationships
| Entity A | Relationship | Entity B | Source |
|----------|-------------|----------|--------|

## Status Enums (from Section 1)
| Enum | Values | Used By |
|------|--------|---------|
```

##### permission-inventory.md
```markdown
# Permission Inventory — {ProjectName}

## Actions × Roles
| Resource | Action | Source | Roles with Access | Ownership |
|----------|--------|--------|-------------------|-----------|
```

##### integration-inventory.md
```markdown
# Integration Inventory — {ProjectName}

## 3rd Party Services (from Section 2)
| Service | Purpose | Env Variables Needed |
|---------|---------|---------------------|

## Notification Channels (from Section 2.5)
| Channel | Provider | Env Variables |
|---------|---------|--------------|

## Detected Features → Conditional Sections
| Feature | Detected | Conditional Section |
|---------|----------|-------------------|
```

#### B1.5 Config Allocator

Launch **config-allocator** (sonnet):

1. Read `claude-operations/docs/project-registry.md`
2. Allocate next available values:
   - `backend_port`: Next unused in range 3000-3099
   - `frontend_ports`: Next two unused in range 5173-5299
   - `redis_prefix`: `{projectslug}:` (lowercase, no hyphens)
   - `cookie_names`: `{ProjectName}Token`, `{ProjectName}RefreshToken`, `{ProjectName}AdminToken`
   - `db_name`: `{project_slug}_db`
3. Write `project-config.md` to intermediate/
4. Append new entry to `project-registry.md`

---

### Phase B2: Write

Launch **tech-writer** (opus).

**Input:**
- Feature PRD (full document)
- `entity-inventory.md`
- `permission-inventory.md`
- `integration-inventory.md`
- `project-config.md`

**Reference (under `skills/client/prd/generate-prd/references/`):**
- `depth-guide-tech.md`
- `prd-template-tech.md`

#### Tech-Writer Sections

- **Section 5**: Tech Stack & System Design
  - Technologies table
  - Third-Party Integrations
  - Key Architectural Decisions
  - Environment Variables (using `project-config.md` values)
  - Conditional subsections (Auth Flow, File Pipeline, Real-time, Billing, Multi-tenancy)
- **Section 6**: Data Model — Full Schema
  - Entity Relationships
  - Full Schema per entity (minimum 5 columns, PK, FK, constraints)
  - Status Enums (matching Feature PRD Section 1)
  - Index Hints
  - Soft Delete policy
- **Section 7**: Permission Matrix
  - Action × Role Matrix (no empty cells)
  - Ownership Rules
  - Role Hierarchy

#### TBD Handling

- All technical decisions: fill with `[💡 Recommended]` best-practice defaults
- Developer team reviews (not PM confirmation gate)

#### Output File

- `.claude-project/prd/{ProjectName}/drafts/section-5-7.md`

---

### Phase B3: QA + Fix (Max 3 Rounds)

#### B3.1 QA Validation

Launch **qa-tech** (sonnet) to validate against 7 rules.

> Detailed rules: see `references/validation-tech.md`

| # | Rule | FAIL Condition |
|---|------|---------------|
| 9 | Tech Stack Completeness | Technologies < 5 layers, or 3rd party missing |
| 10 | Entity Coverage | CRUD entity from Feature PRD missing from Section 6 |
| 11 | Permission Completeness | Action without Permission Matrix entry, or empty cells |
| 14 | Full Schema Completeness | Entity without schema, < 5 columns, missing PK/FK |
| 16 | Config Uniqueness | Port/prefix/cookie/DB collision with existing project |
| C1 | Cross-Phase Consistency | Entity mismatch between Feature PRD and Section 5-7 |
| C2 | FK Integrity | FK references non-existent entity or column |

#### B3.2 FAIL Handling

Same as Phase A: **support** fixes → **qa-tech** re-validates → max 3 rounds → manual intervention if still failing.

---

### Phase B4: Merge + Deliver

#### B4.1 Merge into Complete PRD

1. Read Feature PRD (`{AppName}_PRD.md`)
2. Insert Sections 5-7 after Section 4
3. Update Section 8 (Open Questions) with any technical questions
4. Verify section numbering and cross-references

#### B4.2 Save Final File

- Complete PRD: `[AppName]_PRD.md` in `.claude-project/prd/{ProjectName}/` (stable filename — same path as Phase 4.3 output; B4.2 overwrites with the merged complete version. Version/date is tracked in the PRD's own header + Feature Change Log, not in the filename.)
- Before writing, delete any legacy `[AppName]_PRD_*.md` or `[AppName]_FeaturePRD_*.md` files (with date suffix) in `.claude-project/prd/{ProjectName}/` to avoid confusion with prior outputs from older skill versions.

#### B4.3 Result Report

```markdown
## Complete PRD Generation Complete (Phase A + B)

### Output
- Complete PRD: `.claude-project/prd/{ProjectName}/[AppName]_PRD.md` (stable, overwrites on re-run)

### Summary
- Section 0-4 + 2.5 + 8: Feature PRD (from Phase A) ✅
- Section 5: Tech Stack & System Design ✅
  - Technologies: {N} layers
  - Third-Party: {M} services
  - Conditional sections: {list}
- Section 6: Data Model — Full Schema ✅
  - Entities: {K} tables
  - Relationships: {R} defined
  - Index hints: {I} recommended
- Section 7: Permission Matrix ✅
  - Matrix: {R} roles × {A} resources
  - Ownership rules: {O} defined
- QA Validation: PASS (Phase A {Na} rounds + Phase B {Nb} rounds)
- Config allocated: port {PORT}, DB {DB_NAME}

### Output Structure
.claude-project/prd/{ProjectName}/
├── intermediate/
│   ├── parsed-input.md / screen-inventory.md / tbd-items.md      ← Phase A artifacts
│   ├── pm-review-notes.md / client-checklist.md                  ← Phase A artifacts
│   ├── entity-inventory.md / permission-inventory.md             ← Phase B artifacts
│   ├── integration-inventory.md / project-config.md              ← Phase B artifacts
├── drafts/
└── {AppName}_PRD.md                    ← Complete merged PRD (stable filename)

### Next Steps
1. Review the complete PRD with the development team
2. Begin development setup using Section 5 tech stack
3. Create database schema from Section 6
4. Implement permission guards from Section 7
```

---

## Error Handling

| Situation | Response |
|-----------|----------|
| Agent timeout/failure | Retry once. On second failure, mark "⚠️ Generation failed", continue with rest |
| QA 3-round FAIL | Present FAIL items + manual intervention request to user |
| Input file unparseable | Error message + supported format guide, then stop |
| Bug patterns not found | Normal — generate without bug prevention sections (print warning) |
| Existing PRD name mismatch | Confirm via AskUserQuestion before proceeding |
| Token limit exceeded | Assemble sections sequentially, run consistency audit separately |
| **Phase B**: Feature PRD has unresolved `[💡 Recommended:]` (`--tech` mode only) | ABORT with list of unresolved items + suggest `--feature`/`--full` |
| **Phase B**: Feature PRD not found | Error message with expected path format |
| **Phase B**: Config registry not found | Warn and generate without config allocation |

---

## Client Question Templates

> **Principle**: Only ask what the client can answer. Technical decisions are handled by PM + bundle auto-detection.
> **Two-phase approach**: Pre-intake (sent before first meeting) → PRD Interview (conducted at kickoff).
> **Language**: Templates are bilingual (EN / KR). PM sends the version matching the client's language.

---

### Phase A: Pre-intake Form (sent to client before first meeting)

> Quick form (5 min). Sent via email, KakaoTalk, Notion form, or Google Form.
> Purpose: assess project feasibility, estimate scope, prepare for kickoff meeting.
> 9 questions — covers app name, platform, store, users, current scale, reference app, deadline.

**Templates (PM copies and sends to client):**

| Language | File |
|----------|------|
| English | `templates/pre-intake-en.md` |
| Korean | `templates/pre-intake-kr.md` |

---

### Phase B: PRD Interview (conducted at kickoff meeting)

> PM conducts this interview with pre-intake answers as context.
> Two modes: **File mode** (PM compiles answers manually) or **Interactive mode** (`--interview` flag, see Interactive Interview Mode section).
> In interactive mode, questions are asked one-by-one with preset options and progress tracking.

#### Adaptive Question Tree

Each question has: `id`, `category`, `type`, `trigger`, `preset_options`, and optional `follow_ups`.

**Question Types:**
- `free_text` — Open input, no presets (app name, unique descriptions)
- `tiered` — A/B/C tier presets + custom input (most questions)
- `yes_no_detail` — Yes(recommended)/No + follow-up if Yes
- `checklist` — Pre-populated list + add more

**Preset Option Tiers:**
- `A. (최소한)` — Minimum viable, simplest
- `B. (프로젝트 권장)` — Recommended based on project context (dynamically adjusted)
- `C. (확장)` — Comprehensive, includes nice-to-haves
- `D. 직접 입력` — Client provides custom answer

**Preset Generation Rules:**
1. Option B is dynamically adjusted based on app type + user types from earlier answers
2. Yes/No questions: `A. 예 (권장: {reason}) / B. 아니오 / C. 추후 결정`
3. Presets are shown in Korean for client readability
4. When client picks a tier, they can still modify individual items within it

---

#### Question Tree Definition

```yaml
# === Business ===

- id: B1
  category: Business
  question: "이 앱/서비스의 수익 모델은 무엇인가요?"
  type: tiered
  trigger: always
  presets:
    A: "(비수익) 내부 업무용 / 비영리 목적"
    B: "(직접 수익) 유료 구독 / 인앱 결제 / 일회성 구매"
    C: "(복합) 프리미엄(무료+유료) + 광고 + 제휴"
  follow_ups: [B1a]

- id: B1a
  category: Business
  question: "수익 모델에 대해 좀 더 구체적으로 설명해주세요."
  type: free_text
  trigger: "B1.answer != A"

- id: B2
  category: Business
  question: "출시 후 6개월 이내 성공 지표는 무엇인가요?"
  type: tiered
  trigger: always
  presets:
    A: "(사용자 수) MAU / DAU 목표 수치"
    B: "(참여도) 가입자 수 + 핵심 기능 사용률 + 리텐션"
    C: "(비즈니스) 매출 목표 + 전환율 + NPS 점수"

# === Users ===

- id: U1
  category: Users
  question: "앱을 사용하는 사용자 유형은 모두 몇 종류인가요? (Pre-intake 답변 기반 확장)"
  type: free_text
  trigger: always
  hint: "예: 환자, 의사, 관리자 / 구매자, 판매자, 관리자"
  follow_ups: [U3]

- id: U2
  category: Users
  question: "각 사용자 유형별로 무엇을 할 수 있나요? (역할과 권한)"
  type: free_text
  trigger: always
  hint: "예: 환자는 운동 수행+설문 응답, 코치는 줌 미팅 관리, 관리자는 전체 관리"

- id: U3
  category: Users
  question: "사용자 유형 간 관계는 어떻게 되나요?"
  type: tiered
  trigger: "len(U1.user_types) >= 2"
  presets:
    A: "(독립) 사용자 유형 간 직접적 관계 없음"
    B: "(1:N 매칭) 한 유형이 다른 유형 여러 명과 연결 (예: 코치 1명 → 환자 N명)"
    C: "(복합) 다대다 관계 + 그룹/팀 단위 연결"

# === Design ===

- id: D1
  category: Design
  question: "레퍼런스 앱이 있나요? 어떤 부분을 참고하고 싶으세요? (Pre-intake 답변 기반 확장)"
  type: free_text
  trigger: always
  hint: "앱 이름 + 참고 포인트 (UI/기능/플로우)"

- id: D2
  category: Design
  question: "기존 서비스 대비 이 앱만의 차별점은 무엇인가요?"
  type: free_text
  trigger: always

- id: D3
  category: Design
  question: "선호하는 메인 컬러가 있나요?"
  type: tiered
  trigger: always
  presets:
    A: "(없음) 레퍼런스 앱 또는 업계 표준 따름"
    B: "(브랜드) 기존 브랜드 컬러 사용 — 색상 코드 알려주세요"
    C: "(커스텀) 원하는 컬러 + 무드보드/이미지 제공"

- id: D4
  category: Design
  question: "선호하는 폰트가 있나요?"
  type: tiered
  trigger: always
  presets:
    A: "(기본) 시스템 기본 폰트 (가장 안정적)"
    B: "(권장) Pretendard (한글+영문, 무료, 앱에 많이 사용)"
    C: "(커스텀) 특정 폰트 지정 — 폰트명을 알려주세요"

# === Features ===

- id: F1
  category: Features
  question: "사용자 유형별 주요 기능과 MVP 우선순위를 알려주세요."
  type: free_text
  trigger: always
  hint: "각 기능에 (필수) 또는 (선택) 표시. 예: 환자 — 운동 수행(필수), 설문 응답(필수), 채팅(필수)"
  follow_ups: [F1a]

- id: F1a
  category: Features
  question: "핵심 기능의 주요 흐름을 설명해주세요. (누가 → 무엇을 → 어떤 결과)"
  type: free_text
  trigger: always
  hint: "예: 관리자가 환자에게 운동 묶음 처방 → 환자 앱에 처방 목록 표시 → 환자가 순차적으로 운동 수행"

- id: F2
  category: Features
  question: "로그인 방식은 어떻게 할까요?"
  type: tiered
  trigger: always
  presets:
    A: "(최소한) 아이디 + 비밀번호"
    B: "(프로젝트 권장) 아이디 + 비밀번호 + 소셜로그인 (Google, Apple)"
    C: "(확장) 아이디 + 비밀번호 + 소셜로그인 + 휴대폰 인증"
  follow_ups: [F2a, F2b, F2c]

- id: F2a
  category: Features
  question: "회원가입 시 수집할 정보는 무엇인가요?"
  type: tiered
  trigger: always
  presets:
    A: "(최소한) 아이디, 비밀번호"
    B: "(프로젝트 권장) 아이디, 비밀번호, 실명, 생년월일, 휴대폰 번호"
    C: "(확장) 아이디, 비밀번호, 실명, 생년월일, 휴대폰 번호, 성별, 주소"
  note: "Option B is dynamically adjusted — e.g., medical app adds patient ID, e-commerce adds shipping address"

- id: F2b
  category: Features
  question: "가입 후 추가로 입력받을 프로필 정보가 있나요?"
  type: tiered
  trigger: always
  presets:
    A: "(없음) 가입 시 수집한 정보로 충분"
    B: "(프로젝트 권장) 프로필 사진, 자기소개"
    C: "(확장) 프로필 사진, 자기소개, 관심사/태그, SNS 연동"

- id: F2c
  category: Features
  question: "이용약관 동의 항목은 어떻게 구성할까요?"
  type: tiered
  trigger: always
  presets:
    A: "(최소한) 이용약관 + 개인정보처리방침 (각각 체크박스)"
    B: "(프로젝트 권장) 이용약관 + 개인정보처리방침 + 마케팅 수신 동의 (선택)"
    C: "(확장) 이용약관 + 개인정보처리방침 + 마케팅 + 위치정보 + 제3자 제공 동의"

- id: F3
  category: Features
  question: "채팅 기능이 필요한가요?"
  type: yes_no_detail
  trigger: always
  presets:
    A: "예 (권장: 사용자 간 소통이 필요한 앱)"
    B: "아니오"
    C: "추후 결정"
  follow_ups: [F3a, F3b]

- id: F3a
  category: Features
  question: "채팅 유형은 어떤 것이 필요한가요?"
  type: tiered
  trigger: "F3.answer == A"
  presets:
    A: "(최소한) 1:1 텍스트 채팅"
    B: "(프로젝트 권장) 1:1 + 그룹 채팅, 텍스트 + 이미지 첨부"
    C: "(확장) 1:1 + 그룹 + 파일 첨부 + 읽음 확인 + 채팅 검색"

- id: F3b
  category: Features
  question: "채팅방은 어떻게 생성되나요?"
  type: tiered
  trigger: "F3.answer == A"
  presets:
    A: "(자동) 특정 조건 충족 시 자동 생성 (예: 매칭 시)"
    B: "(수동) 사용자가 직접 채팅 시작"
    C: "(혼합) 자동 생성 + 사용자가 추가 채팅 시작 가능"

- id: F4
  category: Features
  question: "영상통화/화상미팅 기능이 필요한가요?"
  type: yes_no_detail
  trigger: always
  presets:
    A: "예"
    B: "아니오"
    C: "추후 결정"
  follow_ups: [F4a]

- id: F4a
  category: Features
  question: "영상통화 연동 방식은 어떻게 할까요?"
  type: tiered
  trigger: "F4.answer == A"
  presets:
    A: "(외부 링크) 줌/구글미트 링크를 앱에 붙여넣기"
    B: "(API 연동) 앱에서 줌/구글미트 미팅 자동 생성"
    C: "(내장) 앱 내 자체 영상통화 기능 (WebRTC)"

- id: F5
  category: Features
  question: "푸시 알림이 필요한가요?"
  type: yes_no_detail
  trigger: always
  presets:
    A: "예 (권장: 사용자 참여율 향상에 필수)"
    B: "아니오"
    C: "추후 결정"
  follow_ups: [F5a, F5b]

- id: F5a
  category: Features
  question: "어떤 이벤트 발생 시 알림을 보낼까요?"
  type: checklist
  trigger: "F5.answer == A"
  preset_items:
    - "새 메시지 수신"
    - "새 콘텐츠/처방/예약 등록"
    - "일정 리마인더"
    - "콘텐츠/처방/예약 변경"
    - "관리자 공지사항"
    - "미완료 작업 리마인더 (매일 특정 시간)"
  hint: "목록에서 선택 후 추가 항목이 있으면 알려주세요"

- id: F5b
  category: Features
  question: "알림 채널은 어떤 것을 사용할까요?"
  type: tiered
  trigger: "F5.answer == A"
  presets:
    A: "(최소한) 앱 푸시 알림만"
    B: "(프로젝트 권장) 앱 푸시 + 인앱 알림 목록"
    C: "(확장) 앱 푸시 + 인앱 + 이메일 + SMS"

- id: F6
  category: Features
  question: "주요 화면별 검색/필터 기능이 필요한가요?"
  type: tiered
  trigger: always
  presets:
    A: "(최소한) 텍스트 검색만"
    B: "(프로젝트 권장) 텍스트 검색 + 카테고리/상태 필터"
    C: "(확장) 텍스트 검색 + 다중 필터 + 정렬 옵션 + 저장된 필터"

- id: F7
  category: Features
  question: "콘텐츠는 누가 생성하고 관리하나요?"
  type: tiered
  trigger: always
  presets:
    A: "(관리자 전용) 관리자만 콘텐츠 등록/수정/삭제"
    B: "(혼합) 관리자가 주로 관리 + 일부 사용자 콘텐츠 (후기, 댓글 등)"
    C: "(사용자 주도) 사용자가 콘텐츠 생성 + 관리자가 검수/승인"

# === Data ===

- id: DA1
  category: Data
  question: "앱에서 수집/관리하는 주요 데이터는 무엇인가요?"
  type: free_text
  trigger: always
  hint: "예: 운동 기록, 설문 응답, 예약 내역, 주문 내역, 게시글 등"

- id: DA2
  category: Data
  question: "데이터 내보내기(CSV/Excel 다운로드)가 필요한가요?"
  type: yes_no_detail
  trigger: always
  presets:
    A: "예 (권장: 관리자가 데이터를 활용해야 하는 경우)"
    B: "아니오"
    C: "추후 결정"
  follow_ups: [DA2a]

- id: DA2a
  category: Data
  question: "어떤 데이터를 내보내야 하나요?"
  type: free_text
  trigger: "DA2.answer == A"
  hint: "예: 사용자 목록, 운동 기록, 설문 결과, 매출 데이터"

# === Technical ===

- id: T1
  category: Technical
  question: "외부 서비스 연동이 필요한 것이 있나요?"
  type: checklist
  trigger: always
  preset_items:
    - "결제 (PG사: 토스페이먼츠, 아임포트 등)"
    - "SMS/문자 인증 (NHN, 알리고 등)"
    - "지도/위치 (카카오맵, 구글맵)"
    - "소셜 로그인 (Google, Apple, 카카오)"
    - "클라우드 저장소 (이미지/파일 업로드)"
    - "영상통화 (Zoom, Google Meet)"
    - "분석/통계 (Google Analytics, Mixpanel)"
  hint: "목록에서 선택 후 추가 항목이 있으면 알려주세요"

- id: T2
  category: Technical
  question: "이 앱에서 사용하는 전문 용어가 있나요? (도메인 용어)"
  type: free_text
  trigger: always
  hint: "예: 처방, 세트, 렙, 코칭, 매칭 등 — 일반인이 모를 수 있는 용어"

- id: T3
  category: Technical
  question: "앱 서비스 언어와 개발 QA 언어는 어떻게 할까요? (App languages & developer QA language)"
  type: tiered
  trigger: always
  presets:
    A: "(단일) 한국어만 (앱 전체 한국어)"
    B: "(권장) 한국어 서비스 + 영어 QA (개발/오류 메시지는 영어로 관리)"
    C: "(다국어) 한국어 + 영어 + 기타 언어 완전 지원"
  hint: "i18n 아키텍처에 영향 — 초기 스캐폴딩, API 에러 메시지 형태, 프론트엔드 문자열 관리 방식 결정"

# === Other ===

- id: O1
  category: Other
  question: "추가로 알려주고 싶은 중요한 정보가 있나요?"
  type: free_text
  trigger: always
  hint: "기존 시스템에서 겪는 문제점, 법적 요구사항, 특수 요구사항 등"
```

**Interview question counts:**
- Always-fire (interview): 25 (B1, B2, U1, U2, D1-D4, F1, F1a, F2, F2a-F2c, F3-F7, DA1, DA2, T1, T2, T3, O1)
- Conditional (interview): 8 (B1a, U3, F3a, F3b, F4a, F5a, F5b, DA2a)
- Interview max: 33 questions

**With pre-intake:**
- Always-fire (pre-intake): 8 (P1-P3, P5-P9)
- Conditional (pre-intake): 3 (P4, P6a, P6b)
- Full session max: 44 questions

**Typical session: 29-37 questions (depending on pre-intake status and client answers)**

### Parser Input

**File mode**: PM compiles Pre-intake + PRD Interview answers into a single file and passes to `/generate-prd [file-path]`.
Parser agent extracts from both sections — pre-intake answers inform Section 0 (Overview, Platform, MVP Scope),
interview answers inform Sections 1-4 + 2.5.

**Interactive mode**: Interview answers are auto-compiled into `intermediate/client-answers.md` and fed to parser automatically. See Interactive Interview Mode section.

**Compiled input file format** (any text format works — parser handles extraction):
Recommended: Copy-paste pre-intake answers first, then interview answers below.
Markdown headers (`===`, `###`) help parser accuracy but are not required.
Minimum required: plain text with question numbers matching the interview template.

---

### PM Assessment Items (NOT asked to client)

> These are decided by the PM based on client answers + app type.
> Bundle auto-detection covers most of these. PM confirms via TBD review in Phase 1.6 and Phase 4.

| Item | Decision Basis | Detected By |
|------|---------------|-------------|
| Offline usage needed | App type + use context | Bundle: Offline |
| Multi-language (i18n) | Target market + user base | Interview Q: T3 (always asked) |
| Analytics event tracking | Business goals + success metrics | Bundle: Analytics |
| Data retention / deletion policy | Industry + legal requirements | PM judgment |
| Data change history (audit log) | Industry regulation (medical, finance) | Bundle: Audit |
| Bulk operations | Admin page entity count | Bundle: Admin |
| Expected concurrent users | User count + app type | PM estimate from Pre-intake Q6 |
| Rate limiting strategy | App type + public API exposure | Bundle: API Security |

---

## Reference File List

**Phase A (Feature):**

| File | Purpose |
|------|---------|
| `references/prd-template.md` | Section 0-4 + 2.5 + 8 output structure |
| `references/prompt-templates.md` | Agent specs + write-mode prompts |
| `references/depth-guide.md` | Mandatory density requirements (feature-scoped) |
| `references/admin-standards.md` | Admin standard feature matrix |
| `references/validation-checklist.md` | 16 feature-scoped QA rules |
| `references/feature-bundle-map.md` | Conditional feature bundles with tier system (12 bundles) |
| `references/bug-pattern-schema.md` | Bug pattern classification format |

**Phase B (Technical):**

| File | Purpose |
|------|---------|
| `references/prd-template-tech.md` | Section 5-7 output structure |
| `references/prompt-templates-tech.md` | Agent specs + write-mode prompts |
| `references/depth-guide-tech.md` | Mandatory density requirements (technical-scoped) |
| `references/validation-tech.md` | 7 technical QA rules + 2 cross-phase rules |

**Templates:**

| File | Purpose |
|------|---------|
| `templates/pre-intake-en.md` | Pre-intake form for English-speaking clients (PM deliverable) |
| `templates/pre-intake-kr.md` | Pre-intake form for Korean-speaking clients (PM deliverable) |
| `templates/interview-presenter.html` | HTML presenter for interactive interview mode (auto-refresh, progress bar, preset options) |
