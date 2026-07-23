# 디자인 HTML 납품 가이드 (디자인팀 전달용)

> HTML 프로토타입 → React 자동 변환 파이프라인이 **그대로** 소비하는 파일 형식입니다.
> 아래 구조/마커를 지키면 변환 품질(특히 공유 컴포넌트 일관성)이 보장됩니다.
> v164 신규: **공유 크롬(상단바·하단 탭바·사이드바) 마커 규칙** 추가.
> v165 신규: **대원칙(단일 소스) + 페이지 배경 + 컴포넌트 클래스 + 아이콘** 규칙 추가.

---

## 0. 대원칙 — "한 번 정의, 어디서나 참조" (Single Source of Truth)

이 가이드의 모든 규칙은 **하나의 원칙**에서 나옵니다:

> **같은 값을 두 페이지에서 반복하지 마세요. 반복되는 것은 전부 한 곳을 참조합니다.**

| 반복되는 것 | 한 곳(단일 소스) |
|---|---|
| 색 / 간격 / 폰트 | **토큰** `var(--c-*/--t-*/--space-*)` (theme.css) |
| 버튼 / 뱃지 / 카드 모양 | **클래스** `.btn` `.badge` `.card` (components.css) |
| 상단바 / 하단바 / 사이드바 | **공유 크롬** `data-shell` (shells/) |
| 페이지 배경(캔버스) | **`body`** (한 번) |
| 아이콘 | **Lucide 이름** `data-lucide` |

**왜 중요한가:** 변환기는 페이지를 **한 장씩 따로** React로 만듭니다. 옆 페이지를 기억하지 못하므로, 디자인이 "이건 공유다"를 선언하지 않으면 페이지마다 값이 **어긋납니다(드리프트)**. 실제 사례: 배경이 3가지 값으로 갈라지고(채팅만 회색), 버튼이 81개 페이지에 232번 인라인으로 다시 그려지고, 아이콘이 199개 인라인 `<svg>`로 제각각 됨.

> 페이지는 **"그 페이지만의 고유 내용"만** 그리세요. 공유되는 것은 칠하지 말고 **참조**하세요.

---

## 1. 전체 파일 구조

```
<project>-deliverable/
├── PRD/
│   └── <Project>_PRD.md                  # PRD 정본 (1개)
└── design/
    ├── manifest.json                     # ⭐ 라우트 ↔ 컴포넌트 매핑 + 전역 스타일 선언
    ├── styles/                           # ⭐ 디자인 시스템 CSS (시각적 단일 진실)
    │   ├── theme.css                     #   토큰: --c-* 색상, --t-* 타이포, --space-* 간격
    │   └── components.css                #   공용 컴포넌트 CSS (.btn-kakao 등)
    ├── shells/                           # ⭐ v164 신규 — 앱별 공유 크롬 1장씩 (아래 4번)
    │   ├── student.shell.html            #   StudentLayout 크롬 (상단바 + 하단 탭바)
    │   ├── instructor.shell.html         #   InstructorLayout 크롬
    │   └── admin.shell.html              #   AdminLayout 크롬 (사이드바)
    ├── html/
    │   ├── <app>/                        # 1 파일 = 1 라우트 (앱 = student/instructor/admin …)
    │   │   ├── A-1-login.html
    │   │   ├── B-1-home.html
    │   │   └── …
    │   ├── states/                       # 상태 시트 (로딩/빈/에러) — 라우트 아님
    │   │   └── B-1-home.states.html
    │   └── index.html                    # 갤러리 — 라우트 아님
    └── README.md
```

**핵심 규칙**
- `html/<app>/` 안의 **1개 파일 = 1개 라우트**. (앱 = 별도 프론트엔드. 예: `frontend`=수강생, `frontend-admin-dashboard`=관리자)
- 상태 시트는 `html/states/<page>.states.html` + `<body data-component="dev-states">` — 라우트 카운트에서 제외됨.
- 모든 라우트 HTML은 `design/styles/theme.css`, `components.css`를 **상대경로로 링크**(미리보기용). 파이프라인은 manifest의 `globalStyles`로 실제 위치를 읽음.

---

## 2. `manifest.json` 형식

```json
{
  "globalStyles": ["styles/theme.css", "styles/components.css"],
  "screens": [
    {
      "file": "frontend/B-1-home.html",
      "route": "/",                       // ⭐ 실제 라우트 경로 (앱이 등록할 경로와 동일하게)
      "app": "frontend",                  // ⭐ 어느 프론트엔드(앱)에 속하는지
      "layout": "StudentLayout",          // ⭐ 어느 공유 레이아웃(크롬)을 쓰는지
      "component": "HomePage",
      "guard": "auth:student",            // guest | auth:student | auth:instructor | auth:admin
      "primaryApi": "GET /api/instructors/nearby"
    }
  ]
}
```

- `route`는 **앱이 실제로 등록할 경로와 정확히 일치**해야 합니다. (예: 홈을 `/`로 쓰면 manifest도 `/`. `/home`처럼 안 맞으면 404 → 변환 검증 실패)
- `app` + `layout`이 "이 화면이 어느 공유 크롬을 쓰는지"의 **단일 진실**입니다.

---

## 3. 라우트 HTML 1장 형식

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="../../styles/theme.css">       <!-- 상대경로 (미리보기용) -->
  <link rel="stylesheet" href="../../styles/components.css">
  <script src="https://unpkg.com/lucide@latest"></script>     <!-- 아이콘 (6번) — 미리보기에서 진짜 Lucide SVG로 렌더 -->
</head>
<body data-app="student" data-layout="StudentLayout">

  <!-- ▼▼▼ 공유 크롬 — 4번 규칙 참고. 모든 페이지에서 byte 단위로 동일해야 함 ▼▼▼ -->
  <header data-shell="topbar"> … 상단바 (로고/위치/알림) … </header>

  <!-- ▼ 이 페이지만의 고유 내용 (변환 대상은 이 영역뿐) ▼ -->
  <main data-shell="content">
      … 페이지 고유 UI …
  </main>

  <!-- ▼ 공유 하단 탭바 — 홈/검색/채팅/MY ▼ -->
  <nav data-shell="bottomnav" data-component="nav" aria-label="주요 메뉴"> … </nav>
  <!-- ▲▲▲ 공유 크롬 끝 ▲▲▲ -->

  <script>lucide.createIcons();</script>   <!-- 아이콘 렌더 (6번) — </body> 직전 1회 -->
</body>
</html>
```

---

## 4. ⭐ 공유 컴포넌트 규칙 (navbar / 하단 탭바 / 사이드바) — v164 핵심

**문제:** 변환기는 페이지를 **한 장씩 따로** React로 만듭니다. 옆 페이지를 기억하지 못해서, 공유 크롬을 페이지마다 **다르게/중복** 그리는 일이 생깁니다. (실제로 한 런에서 28개 페이지가 자기만의 하단바를 그림 → 탭바가 두 개 겹치거나 페이지마다 달라짐)

**해결: 공유 크롬은 "선언"만 하고, 파이프라인이 자동으로 "하나로" 강제합니다.** 디자인팀이 할 일:

### 4-1. 공유 크롬을 마커로 감싸기
| 영역 | 마커 |
|---|---|
| 상단 앱바 | `data-shell="topbar"` |
| 하단 탭바 | `data-shell="bottomnav"` (기존 `data-component="nav"` 병기 가능) |
| 사이드바(관리자) | `data-shell="sidebar"` |
| 페이지 고유 내용 | `data-shell="content"` |

### 4-2. 공유 크롬은 모든 페이지에서 **완전히 동일**하게
- 같은 `data-app` + `data-layout`을 쓰는 모든 페이지의 `data-shell="topbar"`/`"bottomnav"` 블록은 **byte 단위로 동일**해야 합니다. (복붙 — 마진 하나도 다르면 안 됨)
- **현재 탭 강조(active)는 정적으로 칠하지 마세요.** 활성 탭은 프레임워크가 URL로 계산합니다. 굳이 표시하려면 활성 링크에 `aria-current="page"`만 다세요.

### 4-3. `shells/` 폴더에 앱별 크롬 1장씩 (권장, 단일 진실)
- `design/shells/student.shell.html` = StudentLayout의 크롬 한 벌. 구조:
  ```html
  <body data-layout="StudentLayout">
    <header data-shell="topbar"> … </header>
    <!-- @CONTENT -->                      <!-- 페이지 내용이 들어갈 슬롯 -->
    <nav data-shell="bottomnav"> … </nav>
  </body>
  ```
- 이 1장이 그 앱의 **공유 크롬 원본**입니다. 라우트 HTML들의 크롬은 이것과 동일하게 유지하세요.

### 4-4. 파이프라인이 자동으로 하는 일 (디자인팀은 안 해도 됨)
- 공유 크롬을 **딱 하나의** Layout 컴포넌트로 추출 → 모든 페이지가 그 안에서 렌더.
- 페이지에 새어든 크롬 복사본은 **자동 제거** (strip doctor).
- 페이지에 크롬이 남아있으면 **게이트 FAIL** (`shared-nav-single-source`).

> 즉, **디자인팀은 "이게 공유 크롬이다"라고 마커로 표시 + 모든 페이지에서 동일하게 유지**만 하면 됩니다.
> 하나로 합치는 건 파이프라인이 강제합니다.

### 페이지에 들어가도 되는 nav (공유 크롬 아님)
- 페이지 내부 탭(`data-testid="...-tabs"`), 브레드크럼, 페이지네이션, 단일 "뒤로" 링크 → OK.
- 앱 전역 상단바/하단 탭바/사이드바 → ❌ (공유 크롬, Layout 소유)

---

## 5. 디자인 시스템 CSS

- `design/styles/theme.css` — 토큰만: `--c-*`(색), `--t-*`(타이포), `--space-*`(간격).
- `design/styles/components.css` — 공용 컴포넌트 클래스(.btn-kakao 등).
- 라우트 HTML은 토큰/클래스를 **참조만** 하고, 값을 하드코딩하지 마세요. (예: `background: var(--c-surface)` O, `background:#fff` 지양)
- manifest의 `globalStyles`에 두 파일을 선언하면 파이프라인이 React 앱에 자동 반영합니다.

---

## 6. ⭐ 아이콘 — Lucide 전용 (v165 신규)

**문제:** 변환기는 HTML의 인라인 `<svg>`를 그대로 복붙합니다. 같은 아이콘이 페이지마다 다르게(크기·획 두께·path) 들어가고, React 앱에 설치된 `lucide-react`는 거의 안 쓰입니다. (실제 한 런: 인라인 `<svg>` 228개 vs lucide-react 10파일)

**해결: 디자인·앱 양쪽이 같은 아이콘 라이브러리(Lucide)를 씁니다.** Lucide는 HTML용(바닐라)과 React용(`lucide-react`)이 **이름이 100% 동일**해서, 변환이 단순 1:1 이름 매핑이 됩니다.

### 6-1. HTML에서 아이콘 작성법
```html
<!-- <head>에 1회 (3번 템플릿에 이미 포함) -->
<script src="https://unpkg.com/lucide@latest"></script>

<!-- 본문 어디서나 — 직접 <svg> 그리지 말고 이름만 -->
<i data-lucide="home"></i>
<i data-lucide="search"></i>
<i data-lucide="chevron-down" class="w-5 h-5"></i>

<!-- </body> 직전 1회 (3번 템플릿에 이미 포함) -->
<script>lucide.createIcons();</script>
```
- `lucide.createIcons()`가 모든 `data-lucide="이름"`을 **진짜 Lucide SVG로** 치환 → 미리보기에서 React 앱과 **똑같은 아이콘**이 보입니다.
- 이름은 **lucide.dev/icons의 정식 kebab 이름**을 그대로 (예: `chevron-down`, `map-pin`, `message-circle`). 이 이름이 그대로 `lucide-react`의 `<ChevronDown/>`로 매핑됩니다.

### 6-2. 금지
- ❌ 손으로 그린/붙여넣은 인라인 `<svg><path d="…"/></svg>` — 파이프라인이 어떤 아이콘인지 식별 못 해서 그대로 남고(불일치), 게이트 FAIL.
- ❌ 이모지를 아이콘으로 사용 (🔍 🏠 🔔 …).
- ❌ 다른 아이콘 라이브러리 혼용 (FontAwesome, Heroicons 등) — Lucide 한 곳만.

### 6-3. 접근성 + 크기
- 의미 없는 장식 아이콘: `aria-hidden="true"`. 의미 있는(단독 클릭) 아이콘: `aria-label="검색"`.
- 크기는 클래스로 일관되게: 인라인 `w-4 h-4`(16px)/`w-5 h-5`(20px), 단독 `w-6 h-6`(24px). 같은 맥락에선 같은 크기.

### 6-4. 파이프라인이 자동으로 하는 일 (디자인팀은 안 해도 됨)
- `data-lucide="home"` → `import { Home } from 'lucide-react'` + `<Home/>` 로 **결정적으로** 변환 (kebab→Pascal).
- 페이지에 인라인 `<svg>` 아이콘이 남아 있으면 **게이트 FAIL** (`no-inline-svg-icons`).

> 즉, **디자인팀은 "아이콘은 Lucide 이름으로만"** 지키면 됩니다. 나머지는 파이프라인이 강제합니다.

---

## 7. ⭐ 페이지 배경 — `body`가 소유 (v165 신규)

**문제:** 페이지마다 프레임 배경을 따로 칠하면(103개 페이지가 각자 지정) 값이 어긋납니다. 실제로 채팅/마이/프로필 페이지는 `--c-surface-soft`(#eef1f6), 나머지는 `--c-canvas`(#f4f7fb)로 갈라져 화면이 들쭉날쭉했고, 일부는 토큰 대신 `#eef1f6`를 하드코딩했습니다.

**규칙:**
- 페이지 배경(캔버스)은 **`body`가 한 번만** 소유합니다. design CSS(`theme.css` 또는 `components.css`)에:
  ```css
  @layer base { body { background: var(--c-canvas); } }
  ```
- **라우트 HTML의 루트 프레임에 배경을 칠하지 마세요.** 페이지는 `body` 배경을 상속합니다.
- 캔버스 토큰은 **하나만** 사용 (`--c-canvas` 권장). "채팅만 회색" 같은 드리프트 금지.
- 배경을 토큰이 아닌 hex(`#eef1f6`)로 쓰지 마세요 — 항상 `var(--c-*)`.
- 정말 다른 배경이 필요한 특수 페이지(풀블리드 온보딩 등)만 **명시적 예외**로 표시.

> 파이프라인이 자동으로: `body` 배경을 앱에 주입 + 페이지에 새어든 프레임 배경 제거 + hex→토큰 복원 + 단일값 게이트.

---

## 8. ⭐ 컴포넌트 — `components.css` 클래스가 단일 소스 (v165 신규)

**문제:** 버튼/뱃지/카드를 페이지마다 인라인으로 다시 그리면(81개 페이지에 **232개 인라인 버튼**, 23개 인라인 뱃지) 모양·색·패딩이 어긋납니다.

**규칙:**
- 반복되는 UI(버튼·뱃지·카드·입력·칩…)는 **`components.css`에 클래스로 한 번 정의**하고
  (`.btn` `.btn-primary` `.btn-kakao` `.badge` `.badge-warning` `.card` `.input`…),
  모든 페이지에서 **그 클래스만** 사용하세요.
- 같은 버튼을 페이지마다 `style`/유틸리티 조합으로 새로 칠하지 마세요 — 색/패딩/반경은 **클래스(=토큰)** 에서 옵니다.
- **같은 역할 = 같은 클래스 이름.** (변환기가 이 클래스를 공유 React 컴포넌트로 매핑합니다. 클래스가 제각각이면 매핑이 깨짐.)
- 버튼은 반드시 `<button>` (또는 링크면 `<a>`) — 클릭되는 `<div>` 금지.

> 파이프라인이 자동으로: 반복되는 인라인 마크업을 공유 컴포넌트로 모으고, 공유 컴포넌트 미사용 시 게이트로 압박.

---

## 9. 납품 전 체크리스트

- [ ] `html/<app>/` 1파일=1라우트, manifest `route`와 앱 등록 경로 일치
- [ ] manifest.json에 모든 화면의 `file/route/app/layout/component/guard` 기입
- [ ] **공유 크롬(상단바/하단탭바/사이드바)에 `data-shell` 마커**
- [ ] **공유 크롬이 같은 레이아웃의 모든 페이지에서 byte 단위 동일**
- [ ] 페이지 고유 내용은 `data-shell="content"`로 감쌈
- [ ] active 탭을 정적으로 칠하지 않음 (aria-current만)
- [ ] 상태 시트는 `html/states/`, `<body data-component="dev-states">`
- [ ] **색/간격/타이포는 항상 `var(--c-*/--t-*/--space-*)` 토큰** — raw hex(`#eef1f6`)/px 하드코딩 금지
- [ ] **페이지 배경은 `body`가 소유** — 라우트 HTML 루트에 배경 지정 금지, 캔버스 토큰 1개
- [ ] **버튼/뱃지/카드는 `components.css` 클래스 사용** — 페이지에서 인라인 재정의 금지, 같은 역할=같은 클래스
- [ ] **모든 아이콘은 Lucide** (`<i data-lucide="이름">`) — 손으로 그린 `<svg>`/이모지/타 라이브러리 금지
- [ ] 아이콘 이름은 lucide.dev/icons의 정식 kebab 이름 (예: `map-pin`, `chevron-down`)
- [ ] `<head>`에 Lucide 스크립트 + `</body>` 직전 `lucide.createIcons()` 1회
- [ ] 모든 inter-page 링크는 실제 라우트 경로 (href="#" 금지)
- [ ] 375px / 390px 모바일 기준 레이아웃 (SpoMatch는 모바일 우선)
