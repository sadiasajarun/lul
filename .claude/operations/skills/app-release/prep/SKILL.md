---
name: store-prep
description: Guide for app store submission preparation — interview, document generation, and technical tasks. Collects app information and prepares all deliverables needed for store registration.
user-invocable: true
argument-hint: "[phase]"
---

# Store Prep Skill

First step in the store submission pipeline. Collects app information, generates store listing text, legal documents, client guides, and technical checklists — everything needed before actual store registration begins.

## Pre-flight

Before generating any output, execute the **Pre-flight: Gitignore Output Directory** from [Store Shared Reference](../_store-shared/reference.md). This ensures `.claude-project/` is in `.gitignore` before any files are created.

---

## Phases Overview

| Phase | Name | Output |
|-------|------|--------|
| 0 | Kickoff | `.claude-project/store-prep/kickoff.md` |
| 1 | Interview | `.claude-project/store-prep/app-info.md` |
| 2 | Classify | `.claude-project/store-prep/classification.md` |
| 3 | Docs | `.claude-project/store-prep/listing-google-play.md`, `.claude-project/store-prep/listing-app-store.md` |
| 4 | Legal | `.claude-project/store-prep/privacy-policy.md`, `.claude-project/store-prep/terms-of-service.md` |
| 5 | Client | `.claude-project/store-prep/client-guide.md` |
| 6 | Tech | `.claude-project/store-prep/tech-checklist.md` |

## Usage

```
/store-prep              # Full preparation (all phases sequentially)
/store-prep kickoff      # Phase 0: Team notification & feature scoping
/store-prep interview    # Phase 1: App info collection
/store-prep classify     # Phase 2: Store category classification
/store-prep docs         # Phase 3: Store listing text generation
/store-prep legal        # Phase 4: Legal documents (privacy policy, ToS)
/store-prep client       # Phase 5: Client delivery document
/store-prep tech         # Phase 6: Technical checklist
```

When no argument is provided, run all phases in order (0→6). When a specific phase is given, run only that phase. If a later phase depends on output from an earlier phase that has not been generated yet, run the prerequisite phase first.

## Output Artifacts

All output files are written to the `.claude-project/store-prep/` directory in the project root:

```
.claude-project/store-prep/
├── kickoff.md               # Team notification & feature scoping results
├── app-info.md              # App overview, features, data collection
├── classification.md        # Store category analysis & risk assessment
├── listing-google-play.md   # Google Play listing text template
├── listing-app-store.md     # App Store listing text template
├── privacy-policy.md        # Privacy policy draft
├── terms-of-service.md      # Terms of service draft
├── client-guide.md          # Client action items guide
└── tech-checklist.md        # Technical work checklist with timeline
```

---

## Phase 0: Kickoff (Team Notification & Feature Scoping)

### Goal
Before any technical work begins, ensure the mobile team is notified, native feature scope is confirmed with the PM, and the client's developer account situation is identified early to avoid timeline surprises.

### Step 1: Mobile Team Notification

Present the following checklist to the PM. These are manual actions that the PM must complete — the skill cannot automate them.

```markdown
## Mobile Team Notification Checklist

- [ ] Informed mobile team that a webview app is needed
- [ ] Shared the target deadline / release date
- [ ] Shared the project repository or staging URL
```

### Step 2: Native Feature Scoping

Present the following feature list as a multiple-choice checklist. The PM selects which native features the app requires. This scoping happens **before** code analysis (Phase 1) to set direction early.

```
[Feature Scoping Question for PM]

Which native features does this app need?
Check all that apply:

- [ ] Push Notifications (FCM / APNs)
- [ ] In-App Payment (subscription / one-time)
- [ ] Camera / Photo Library access
- [ ] Biometric Authentication (fingerprint / Face ID)
- [ ] Deep Links / Universal Links
- [ ] File Download / Upload (native)
- [ ] Social Login (Google / Apple / Kakao / etc.)
- [ ] Location Services (GPS)
- [ ] Other: _______________

If unsure about any item, reply "not sure" — it will be verified during code analysis (Phase 1).
```

### Step 3: Client Developer Account Early Check

Identify the client's account situation early because it directly impacts the timeline.

```
[Account Check Question for PM]

1. Client's Apple Developer account status:
   a) Already enrolled (Organization)
   b) Already enrolled (Individual)
   c) Not enrolled yet
   d) Unknown

2. Client's Google Play Console account status:
   a) Already set up + identity verified
   b) Account created but not verified
   c) Not created yet
   d) Unknown

⚠️ Timeline impact:
- Apple Organization enrollment (with D-U-N-S): 2-4 weeks
- Apple Individual enrollment: 1-2 days
- Google Play identity verification: 3-7 business days
- If accounts are not ready, this becomes the critical path blocker.
```

### Output: `.claude-project/store-prep/kickoff.md`
```markdown
# Kickoff

## Mobile Team Notification
- Notified: Yes / No
- Deadline shared: [date]
- Contact person: [name]

## Native Feature Scope (PM confirmed)
- Push Notifications: Yes / No
- In-App Payment: Yes / No (type: ___)
- Camera: Yes / No
- Biometric Auth: Yes / No
- Deep Links: Yes / No
- Social Login: Yes / No (providers: ___)
- Location: Yes / No
- Other: ___

## Client Account Status
- Apple Developer: [status] → estimated ready: [date]
- Google Play Console: [status] → estimated ready: [date]
- Critical path impact: [description]
```

---

## Phase 1: Interview (App Info Collection)

### Goal
Collect all app information needed for store submission by extracting as much as possible from existing project artifacts, minimizing questions to the PM.

### Data Source Priority (highest to lowest)
1. **PRD** — `.claude-project/prd/` files. All projects have detailed PRDs. App descriptions, feature lists, user roles, service scope can be extracted directly.
2. **i18n files** — Translation files reveal user-facing feature names, UI labels, and supported languages.
3. **Code analysis** — Package.json, entities, DTOs, controllers, services reveal technical capabilities.
4. **PM questions** — Last resort. Only ask for market decisions that cannot be inferred from code.

### Auto-Collect from Code
Scan the codebase to automatically detect and document:
- **Tech stack**: Parse `package.json` files for frameworks, libraries, versions
- **Auth method**: JWT, OAuth, social login, biometric, etc.
- **Payment features**: In-app purchases, subscriptions, payment gateway integrations
- **Push notifications**: FCM, APNs, or other push services
- **External API integrations**: Third-party services (Zoom, SMS, email, analytics, etc.)
- **Data collection fields**: Analyze Entity and DTO files to catalog all user data fields collected
- **User roles**: Extract from role enums, guards, decorators
- **File upload capabilities**: Image upload, document upload, media handling
- **Real-time features**: WebSocket, Socket.IO, SSE
- **User-to-user interaction**: Detect features that require another person to function — chat, matching, video/voice calls, multiplayer, collaborative editing, peer-to-peer transfers. Detection signals: chat entities/modules, matching algorithms, WebRTC/peer connection, room/channel models, friend/follow relationships with real-time messaging. If detected, flag as `interactive: true` — this affects test account and demo video requirements in Phase 5.

### Critical Rule
Features NOT found in code must be reported as "not found" and confirmed with the PM. Never assume a feature exists based on common patterns — verify through code.

### PM Questions (Options Format Only)
Only ask the PM for market/business decisions that cannot be determined from code:
- **Target stores**: Google Play / App Store / Both
- **Service countries**: Korea only / International / Specific regions
- **Pricing model**: Free / Freemium / Paid / Subscription
- **Business model**: B2C / B2B / B2B2C
- **Age restrictions**: Any specific age targeting or restrictions
- **Target audience**: Primary user demographic

Present these as multiple-choice options, not open-ended questions.

### Output: `.claude-project/store-prep/app-info.md`
Structure:
```markdown
# App Information

## Basic Info
- App Name:
- Package Name / Bundle ID:
- Version:
- Primary Language:

## Description
(Extracted from PRD)

## Key Features
(Bulleted list from PRD + code analysis)

## User Roles
(From role enums/guards)

## Technical Profile
- Auth:
- Push Notifications:
- Real-time:
- User-to-user Interaction: Yes/No (if Yes, list features: chat, matching, calls, etc.)
- File Upload:
- Payment:
- External APIs:

## Data Collection
(From Entity/DTO analysis — every field that collects user data)

## Market Decisions (PM Input)
- Target Stores:
- Service Countries:
- Pricing Model:
- Business Model:
- Age Restrictions:
```

---

## Phase 2: Classify (Store Category)

### Goal
Determine the appropriate store category and identify any additional requirements or compliance needs based on the app's nature.

### Process
1. Analyze PRD and code to determine app domain (health, education, finance, social, etc.)
2. Map to Google Play and App Store category taxonomies
3. Identify category-specific requirements:
   - **Health/Medical**: Health data handling policies, medical disclaimer requirements
   - **Finance/Payment**: Financial regulations, PCI compliance
   - **Children/Education**: COPPA, age-gating, parental consent
   - **Social/Communication**: Content moderation, reporting mechanisms
4. Flag any elevated risk areas that may trigger extended review

### Output: `.claude-project/store-prep/classification.md`
Structure:
```markdown
# Store Category Classification

## Google Play
- Primary Category:
- Secondary Category (if applicable):

## App Store
- Primary Category:
- Secondary Category (if applicable):

## Category-Specific Requirements
(List any additional compliance, disclaimers, or documentation needed)

## Risk Assessment
(Factors that may trigger extended review or rejection)

## Recommendations
(Steps to mitigate risks before submission)
```

---

## Phase 3: Docs (Store Listing Text)

### Goal
Generate complete store listing text for both Google Play and App Store, ready for PM review and submission.

### Source
All text is auto-generated from PRD + i18n analysis. Present to PM for review after generation.

### Output: `.claude-project/store-prep/listing-google-play.md`
```markdown
# Google Play Store Listing

## App Name
(Max 30 characters)

## Short Description
(Max 80 characters — concise value proposition)

## Full Description
(Max 4000 characters — features, benefits, how it works)

## Category
(From Phase 2 classification)

## Tags
(Up to 5 relevant tags)

## Contact Email

## Privacy Policy URL
```

### Output: `.claude-project/store-prep/listing-app-store.md`
```markdown
# App Store Listing

## App Name
(Max 30 characters)

## Subtitle
(Max 30 characters — supplementary description)

## Description
(Max 4000 characters)

## Keywords
(Max 100 characters — comma-separated, no spaces after commas)

## Promotional Text
(Max 170 characters — can be updated without new app version)

## Category
- Primary:
- Secondary:

## Copyright
(e.g., "2026 Company Name")

## Support URL

## Privacy Policy URL
```

---

## Phase 4: Legal (Legal Document Generation)

### Goal
Generate privacy policy and terms of service drafts based on actual app data collection and functionality.

### Critical Notes
- These are **DRAFTS** — include a prominent notice that legal professional review is recommended before publishing.
- Health/medical apps MUST include a "does not replace professional medical treatment" disclaimer.
- Legal documents should follow the format appropriate for the service country's privacy laws.

### Privacy Policy: `.claude-project/store-prep/privacy-policy.md`
Sections to include:
1. **Service overview** — What the app does, who operates it
2. **Collected data items** — Itemized list with collection method (direct input, automatic, third-party)
3. **Collection purpose** — Why each data item is collected
4. **Retention period** — How long data is stored, deletion policy
5. **Third-party sharing** — Who receives data and why
6. **Data processing delegation** — External services that process data (hosting, analytics, push)
7. **User rights** — Access, correction, deletion, portability
8. **Data destruction** — How data is destroyed after retention period or account deletion
9. **Privacy officer** — Contact information (placeholder for client to fill)
10. **Policy changes** — How users are notified of updates

### Privacy Data Verification Checklist
After generating the privacy policy, present the detected data collection items to the PM:
- Format as a checklist with checkboxes
- Include items detected from Entity/DTO analysis
- Include items from third-party SDKs (Analytics, FCM, Crashlytics, etc.)
- Ask PM to confirm, add missing items, or remove incorrect items
- Update the privacy policy based on PM feedback

### Terms of Service: `.claude-project/store-prep/terms-of-service.md`
Sections to include:
1. **Service definition and purpose** — What the service provides
2. **Account registration** — Requirements, responsibilities
3. **User obligations** — Acceptable use, prohibited actions
4. **Provider obligations** — Service availability, data protection commitments
5. **Disclaimers** — Liability limitations (especially for health/medical: "not a substitute for medical treatment")
6. **Intellectual property** — Content ownership, licenses
7. **Payment and refund** — If applicable, payment terms, refund policy
8. **Service modification/termination** — Right to change or discontinue
9. **Dispute resolution** — Governing law, jurisdiction, arbitration
10. **Effective date** — When terms take effect

---

## Phase 5: Client (Client Delivery Document)

### Reference
Use `claude-operations/resources/docs/references/service-launch-checklist.md` as the master checklist source. This reference contains all launch items with conditional tags (`ALL`, `APP`, `ORG`, `PAID`, `PAY`, `SOCIAL`, `HEALTH`, `TRACK`). Filter applicable items based on the project profile determined in Phase 1 (Interview), then extract the **client-side items** into the output below.

### Goal
Generate a clear guide listing all action items that ONLY the client (app owner/business) can handle — things that require their identity, accounts, or business decisions.

### Output: `.claude-project/store-prep/client-guide.md`
Structure:
```markdown
# Client Action Items Guide

## ⚡ Critical Path Items (Must Complete First)

These items are on the critical path — delays here delay the entire release.

| # | Item | Est. Time | Why Critical |
|---|------|-----------|-------------|
| 1 | Apple Developer Program enrollment | 2-4 weeks (org with D-U-N-S) / 1-2 days (individual) | iOS build signing impossible without it |
| 2 | Google Play Console account + identity verification | 3-7 days | App registration impossible without it |
| 3 | App icon source (1024x1024 PNG) | Depends on designer | Blocks all asset preparation |
| 4 | Privacy Policy URL (HTTPS, accessible) | 1 day (Notion) / 1-2 weeks (custom domain) | Unconditionally required for Google Play submission |
| 5 | Production domain + HTTPS | 1-3 days | Required for app server connection |

## Developer Account Setup

### Google Play Console
- [ ] Create Google Play Developer account ($25 one-time fee) — ⏱️ 30 min
- [ ] Complete identity verification — ⏱️ 3-7 business days
- [ ] Complete phone verification — ⏱️ After identity verification
- [ ] Set up payment profile (for paid apps/IAP) — ⏱️ 15 min

### Apple Developer Program
- [ ] Enroll in Apple Developer Program ($99/year) — ⏱️ 1-2 days (individual)
- [ ] Accept Apple Developer Program License Agreement — ⏱️ 5 min
- [ ] Obtain D-U-N-S number (if enrolling as organization) — ⏱️ 2-4 weeks ⚠️
- [ ] Complete enrollment verification — ⏱️ 1-3 days after D-U-N-S

## Banking & Tax Information
- [ ] Google Play: Add bank account for payouts
- [ ] Google Play: Complete tax profile
- [ ] App Store Connect: Add banking info for payouts
- [ ] App Store Connect: Complete tax forms

## Legal Documents
- [ ] Review and approve Privacy Policy draft — ⏱️ 1-2 days
- [ ] Review and approve Terms of Service draft — ⏱️ 1-2 days
- [ ] Host legal documents at accessible URLs — ⏱️ 1 day (Notion) / 1-2 weeks (domain)
  - ⚠️ **Privacy Policy URL is unconditionally required for Google Play** (since 2024)
  - Notion public page is acceptable as a temporary solution
- [ ] Provide legal entity name for copyright

## App Assets (Review & Approve)
- [ ] App icon source (1024x1024 PNG, no transparency) — ⚠️ Critical path
- [ ] Screenshots (confirm or provide feedback)
- [ ] Feature graphic (Google Play, 1024x500)
- [ ] App preview video (optional)

## Test Account & Demo (auto-included when user-to-user interaction detected)
<!-- Only include this section if app-info.md shows "User-to-user Interaction: Yes" -->
- [ ] Two test accounts with pre-populated data (Account A + Account B)
- [ ] Demo video showing the full interaction flow between both accounts (login → find/match → interact)
  - Keep under 1–2 minutes
  - Host at a publicly accessible URL (unlisted YouTube, cloud storage, etc.)
  - Reference the URL in the App Review Notes field
- [ ] Review notes explaining the two-account test setup (e.g., "Log in with Account A on one device, Account B on another, then start a chat")
> ⚠️ Store reviewers use a single device. Without a demo video, they cannot verify features requiring real-time interaction — this is a common rejection reason for social/chat apps.

## Contact Information
- [ ] Support email address
- [ ] Support URL (website, HTTPS)
- [ ] Marketing URL (optional)

## Business Decisions
- [ ] Confirm pricing / free model
- [ ] Confirm target countries/regions
- [ ] Confirm age rating questionnaire answers
- [ ] Confirm content rights declarations
```

### Client Email Templates (Korean, Copy-Ready)

Generate the following email templates in `client-guide.md`, pre-filled with project-specific details:

#### Template 1: Initial Request (All Items)
```
[앱이름] 스토어 출시를 위해 아래 항목 준비를 요청드립니다.

■ 우선 처리 필요 (출시 일정에 직접 영향)
1. Apple Developer Program 가입 ($99/년) — 조직 가입 시 D-U-N-S 번호 필요 (2-4주 소요)
   → https://developer.apple.com/programs
2. Google Play Console 계정 생성 ($25) + 본인인증 (3-7일 소요)
   → https://play.google.com/console
3. 앱 아이콘 원본 (1024x1024 PNG) 전달
4. 개인정보처리방침 게시 URL (HTTPS 필수)
5. 프로덕션 도메인 확정

■ 출시 전 확인 필요
6. 개인정보처리방침/이용약관 초안 검토 및 승인
7. 고객지원 이메일/전화번호 확정
8. 출시 국가/가격 정책 확인

개발 측 준비 진행률: [X]%
클라이언트 항목 완료 후 약 [X]일 내 제출 가능합니다.
```

#### Template 2: Reminder (Specific Blocker)
```
[앱이름] 출시 관련, 아래 항목이 아직 미완료되어 진행이 지연되고 있습니다:

→ [미완료 항목]

이 항목이 완료되어야 [다음 단계] 진행이 가능합니다.
예상 완료 시점을 공유해 주시면 일정 조율하겠습니다.
```

---

## Phase 6: Tech (Technical Checklist)

### Goal
Generate a comprehensive technical checklist covering all development work needed to prepare the app for store submission.

### Output: `.claude-project/store-prep/tech-checklist.md`
Structure:
```markdown
# Technical Checklist

## Capacitor / Native Setup
- [ ] Initialize Capacitor project
- [ ] Configure `capacitor.config.ts` (appId, appName, server URL)
- [ ] Add iOS platform (`npx cap add ios`)
- [ ] Add Android platform (`npx cap add android`)
- [ ] Configure deep links / universal links
- [ ] Set up splash screen and app icon (native)

## Native Feature Integration
- [ ] Push notifications (FCM / APNs)
- [ ] Camera / photo library access
- [ ] File system access
- [ ] Biometric authentication (if applicable)
- [ ] Status bar / safe area handling

## Build & Signing
### Android
- [ ] Generate upload keystore
- [ ] Configure signing in `build.gradle`
- [ ] Build release AAB (`./gradlew bundleRelease`)
- [ ] Test release build on device

### iOS
- [ ] Create App ID in Apple Developer portal
- [ ] Create provisioning profiles (development + distribution)
- [ ] Configure Xcode signing
- [ ] Build archive and export IPA
- [ ] Test on physical device via TestFlight

## Server / Infrastructure
- [ ] Production server deployment
- [ ] SSL certificate setup
- [ ] Production database setup and migration
- [ ] CDN / asset hosting configuration
- [ ] Environment variables for production
- [ ] API URL configuration for production builds

## Pre-Submission Testing
- [ ] Test on multiple Android devices / OS versions
- [ ] Test on multiple iOS devices / OS versions
- [ ] Verify all features work with production API
- [ ] Performance testing (startup time, responsiveness)
- [ ] Accessibility basics (font scaling, screen reader labels)

## Store Compliance (Mandatory)
- [ ] Account deletion — in-app flow (required by both stores if account creation exists)
- [ ] Sign in with Apple — required if any social login exists (Apple Guideline 4.8)
- [ ] App Tracking Transparency — ATT prompt required if tracking/advertising SDKs present (iOS 14.5+)
- [ ] Privacy Policy URL — hosted at HTTPS, accessible (unconditionally required for Google Play since 2024)
- [ ] targetSdkVersion — meets current Google Play minimum (verify at policy page)

## Store-Specific Requirements
- [ ] Age rating questionnaire preparation
- [ ] Content rights declarations
- [ ] Data safety / App privacy labels
- [ ] Screenshots for all required device sizes
- [ ] App review notes (test credentials, special instructions)

## Estimated Timeline
| Task | Estimated Duration |
|------|--------------------|
| Capacitor setup | X days |
| Native features | X days |
| Build & signing | X days |
| Server deployment | X days |
| Testing | X days |
| **Total** | **X days** |
```

---

## General Guidelines

1. **Always create the `.claude-project/store-prep/` directory** in the project root before writing output files.
2. **Check for existing output files** before overwriting. If a file exists, ask the PM whether to overwrite or skip.
3. **Cross-reference phases** — later phases should reference and build upon earlier phase outputs.
4. **Keep language consistent** — output documents should match the app's primary language (check i18n / PRD).
5. **Be explicit about unknowns** — mark any field that could not be auto-detected with `[TBD - PM input needed]`.
6. **Present summaries after each phase** — after generating output, show the PM a brief summary of what was generated and what needs their review.
