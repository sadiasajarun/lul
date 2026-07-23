---
name: reference_appstore_age_ratings
description: App Store Connect Age Ratings 질문지 전체 항목 및 일반적인 앱 유형별 응답 가이드 (모든 프로젝트 공통, 실제 검증 완료)
type: reference
---

# App Store Connect - Age Ratings 질문지 가이드

> 모든 프로젝트의 스토어 제출 시 참고용 (2026-03 실제 제출 기준 검증 완료)

## Step 1: Features

### In-App Controls

| 항목 | 설명 | 판단 기준 |
|------|------|----------|
| **Parental Controls** | 부모가 자녀의 콘텐츠 접근을 제한하는 기능 | 아동용 앱이 아니면 **NO** |
| **Age Assurance** | 나이 확인 메커니즘 | 연령 제한 콘텐츠 없으면 **NO** |

### Capabilities

| 항목 | 설명 | 판단 기준 |
|------|------|----------|
| **Unrestricted Web Access** | 앱 내에서 자유롭게 웹 브라우징 가능 여부 | 내부 콘텐츠만 표시하면 **NO** |
| **User-Generated Content** | 사용자가 만든 콘텐츠가 다른 사용자에게 배포 | 채팅, 게시판, 사진 공유 등 있으면 **YES** |
| **Messaging and Chat** | 앱 내 사용자 간 직접 소통 기능 | 채팅/메시지 기능 있으면 **YES** |
| **Advertising** | 앱 내 광고 표시 여부 | 광고 없으면 **NO** |

## Step 2: Mature Themes

| 항목 | 설명 | 판단 기준 |
|------|------|----------|
| **Profanity or Crude Humor** | 욕설, 저속한 유머 | 대부분 **NONE** |
| **Horror/Fear Themes** | 공포, 불안, 두려움 유발 콘텐츠 | 대부분 **NONE** |
| **Alcohol, Tobacco, or Drug Use** | 주류, 담배, 약물 사용 묘사/참조 | 복약 기록 수준은 **NONE** (묘사/권장 아님) |

## Step 3: Medical or Wellness

| 항목 | 형식 | 판단 기준 |
|------|------|----------|
| **Medical or Treatment Information** | NONE/INFREQUENT/FREQUENT | 건강 관리 안내만 → **INFREQUENT**, 직접 진단/치료 → **FREQUENT** |
| **Health or Wellness Topics** | NO/YES | 건강/운동/웰니스 콘텐츠 제공 → **YES** |

## Step 4: Sexuality or Nudity

| 항목 | 설명 | 일반 앱 |
|------|------|---------|
| **Mature or Suggestive Themes** | 성적 암시 | **NONE** |
| **Sexual Content or Nudity** | 성적 콘텐츠, 노출 | **NONE** |
| **Graphic Sexual Content and Nudity** | 노골적 성적 콘텐츠 | **NONE** |

## Step 5: Violence

| 항목 | 설명 | 일반 앱 |
|------|------|---------|
| **Cartoon or Fantasy Violence** | 만화/판타지 폭력 | **NONE** |
| **Realistic Violence** | 사실적 폭력 | **NONE** |
| **Prolonged Graphic or Sadistic Realistic Violence** | 지속적/잔혹한 폭력 | **NONE** |
| **Guns or Other Weapons** | 총기/무기 묘사 | **NONE** |

## Step 6: Chance-Based Activities

| 항목 | 형식 | 일반 앱 |
|------|------|---------|
| **Simulated Gambling** | NONE/INFREQUENT/FREQUENT | **NONE** |
| **Contests** | NONE/INFREQUENT/FREQUENT | **NONE** |
| **Gambling** | NO/YES | **NO** |
| **Loot Boxes** | NO/YES | **NO** |

## Step 7: Additional Information

- **Calculated Rating**: 입력 기반 자동 산정
- **Age Categories and Override**: 특별한 사유 없으면 **Not Applicable**
- **Age Suitability URL**: 선택사항, 보통 **비워두기**

### 산정 결과 참고
- 채팅/UGC 없는 앱: **4+**
- 채팅/UGC 있는 앱: **12+** 또는 **13+**
- 건강/의료 + 채팅 앱: **13+**

---

## 앱 유형별 빠른 참조

### 일반 비즈니스/유틸리티 앱 (채팅 없음)
- 모든 항목 NONE/NO → **4+**

### 채팅/소셜 기능 포함 앱
- User-Generated Content: YES
- Messaging and Chat: YES
- 나머지 NONE/NO → **12+** 이상

### 건강/의료 앱
- 위 채팅 포함 앱과 동일 + Medical or Treatment Info: INFREQUENT + Health Topics: YES
- 약물 관련: 복약 기록 수준은 NONE (묘사/권장 아님)

### 게임
- Violence, Gambling 등 게임 내용에 따라 개별 판단 필요
