---
name: store-ship
description: Store submission full pipeline orchestrator - runs prep → assets → native → deploy → build → submit → review in sequence
user-invocable: true
argument-hint: "[status|start|resume|from <phase>|checklist|blockers|update]"
---

# Store Ship - Store Release Orchestrator

## Purpose

Manages the entire app store release journey as a single pipeline.
Executes 7 individual skills in the correct order, tracks progress,
and **automatically detects** prerequisites for each phase.

## Usage

```
/store-ship                # Check current progress + guide to next step
/store-ship status         # Full pipeline status dashboard (auto-detected)
/store-ship start          # Start sequentially from Phase 1
/store-ship resume         # Resume from where it was interrupted
/store-ship from native    # Start from a specific Phase (prerequisite validation)
/store-ship checklist      # Generate project-specific integrated checklist
/store-ship blockers       # Analyze client vs developer blockers
/store-ship update         # Version update workflow (reduced pipeline for subsequent releases)
```

---

## Pipeline Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                        /store-ship                              │
│                                                                 │
│  Phase 1         ┌── Phase 2 (assets)  ──┐                      │
│ ┌──────────┐     │   Phase 3 (native)    │     Phase 5          │
│ │  prep    │────>│   Phase 4 (deploy)    │──→ ┌──────────┐      │
│ │ info     │     └──────────────────────┘    │  build   │      │
│ │ gather   │          parallelizable         │ release  │      │
│                                              └──────────┘      │
│                                                   │             │
│                              Phase 6              │             │
│                            ┌──────────┐           │             │
│                            │  submit  │<──────────┘             │
│                            │ store    │                         │
│                            └──────────┘                         │
│                                 │                               │
│                            Phase 7                              │
│                          ┌──────────┐                           │
│                          │  review  │                           │
│                          │ response │                           │
│                          └──────────┘                           │
│                               │                                 │
│                        Release Complete                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Pre-flight

Before executing any phase, run the **Pre-flight: Gitignore Output Directory** from [Store Shared Reference](../_store-shared/reference.md). This ensures `.claude-project/` is in `.gitignore` before any files are created. This only needs to run once at pipeline start, not before each phase.

---

## Auto Status Detection (Key Improvement)

### Per-Phase Completion Detection Rules

Automatically detects actual completion status of each Phase by analyzing **the file system and project state**.
`pipeline-status.json` is synchronized with these detection results.

```
Phase 1 (prep) — Information Gathering:
  ✅ Completion Conditions:
    - .claude-project/store-prep/app-info.md exists
    - .claude-project/store-prep/listing-google-play.md exists
    - .claude-project/store-prep/listing-app-store.md exists
    - .claude-project/store-prep/privacy-policy.md exists
    - .claude-project/store-prep/client-guide.md exists
    - .claude-project/store-prep/tech-checklist.md exists

Phase 2 (assets) — Asset Preparation:
  ✅ Completion Conditions:
    - .claude-project/store-prep/assets/icons/ directory contains icon-playstore.png (512x512) exists
    - .claude-project/store-prep/assets/icons/icon-appstore.png (1024x1024) exists
    - .claude-project/store-prep/assets/screenshots/  contains at least 2 images
  🔄 Partially Complete:
    - Only one of icon OR screenshots is complete
  🔶 Blocker:
    - App icon source not provided → Client blocker

Phase 3 (native) — Capacitor Wrapping:
  ✅ Completion Conditions:
    - frontend/capacitor.config.ts exists
    - frontend/android/ directory exists
    - frontend/package.json contains @capacitor/core dependency exists
  🔄 Partially Complete:
    - Only capacitor.config.ts exists (platform not added)
  Additional Detection:
    - @capacitor/push-notifications installed → Native push complete
    - Biometric auth plugin installed
    - Social login (google-signin|kakao|naver|facebook-login) detected → Sign in with Apple required
    - @capacitor-community/apple-sign-in installed → Apple login complete
    - Tracking SDKs (firebase/analytics|admob|facebook-sdk) detected → ATT required
    - @capacitor-community/app-tracking-transparency installed → ATT complete
    - Account deletion endpoint (deleteAccount|withdrawal|탈퇴) exists → Account deletion complete
  🔶 Blocker (auto-detected compliance risks):
    - Social login exists but no Apple Sign In → **Apple Guideline 4.8 rejection risk**
    - No account deletion endpoint or UI → **Both stores rejection risk**
    - Tracking SDKs exist but no ATT prompt → **Apple rejection risk (iOS 14.5+)**

Phase 4 (deploy) — Production Deployment:
  ✅ Completion Conditions:
    - .claude-project/store-prep/deploy/deploy-checklist.md exists
    - .claude-project/store-prep/deploy/env.production.example exists
  Additional Detection:
    - MODE=PRODUCTION in .env file
    - docker-compose.prod.yml exists
    - nginx.conf exists

Phase 5 (build) — Release Build:
  ✅ Completion Conditions:
    - frontend/android/app/build/outputs/bundle/release/*.aab exists (Android)
    - .claude-project/store-prep/build/ directory contains build guide
  Additional Detection:
    - release-keystore.jks exists
    - .gitignore excludes keystore

Phase 6 (submit) — Store Submission:
  ✅ Completion Conditions:
    - .claude-project/store-prep/submit/ directory contains submission guide
    - .claude-project/store-prep/submit/pre-submit-checklist.md exists
  🔶 Blocker:
    - Google Play Console account not created → Client blocker
    - Apple Developer account not created → Client blocker

Phase 7 (review) — Review Response:
  Status: Only activated after review submission
  Detection: Managed via rejections array in pipeline-status.json
```

### Detection Execution Algorithm

When `/store-ship status` or `/store-ship` is executed:

1. **File System Scan** — Check existence of each Phase's artifacts per detection rules above
2. **package.json Analysis** — Check Capacitor, native plugin installation status
3. **Environment Variable Analysis** — Check production settings in .env files
4. **pipeline-status.json Sync** — Reflect detection results in JSON
5. **Dashboard Output** — Display in format below

---

## Status Dashboard

### `/store-ship status` Output Format

```markdown
# Store Ship - Release Pipeline

**App**: [App Name]
**Target**: Google Play + App Store
**Start Date**: [Date]
**Overall Progress**: ██████░░░░░░ 35%

## Pipeline Status

| # | Phase | Status | Progress | Owner | Next Action |
|---|-------|------|--------|------|----------|
| 1 | prep (info gathering) | ✅ Complete | 6/6 | Developer | - |
| 2 | assets (assets) | 🔶 Blocked | 0/4 | Client | Icon source needed |
| 3 | native (app wrapper) | ⏳ Waiting | 0/4 | Developer | `/store-native init` |
| 4 | deploy (deployment) | ⏳ Waiting | 0/4 | Developer | `/store-deploy check` |
| 5 | build (build) | ⛔ Prerequisites | 0/2 | Developer | native, assets, deploy must complete |
| 6 | submit (submission) | 🔶 Blocked | 0/2 | Client | Console account creation needed |
| 7 | review (review) | ⏳ Waiting | - | Store | After submit completes |

## Dependency Graph

prep ──┬── assets ──┐
       ├── native ──┼── build ── testing ── submit ── review
       └── deploy ──┘
               ↑ Currently here (parallel progress possible)

## Parallelizable Items
Phases that can start right now:
- `/store-native init` — Capacitor initialization
- `/store-deploy check` — Production readiness diagnosis

## Blocker Summary (2 items)
🔶 [Client] App icon source (1024x1024 PNG) not provided
🔶 [Client] Google Play Console / Apple Developer account not created
```

---

## Integrated Checklist Generator (`/store-ship checklist`)

Analyzes the project and automatically generates a **customized integrated checklist**.

### Execution Algorithm

1. **Project Scan**:
   ```
   Glob: frontend/capacitor.config.ts → Capacitor installation status
   Glob: frontend/android/ → Android project status
   Glob: frontend/ios/ → iOS project status
   Grep: @capacitor/push-notifications in frontend/package.json
   Grep: @capacitor/core in frontend/package.json
   Grep: firebase-messaging in frontend/ → Existing web push status
   Glob: .claude-project/store-prep/assets/icons/*.png → Icon preparation status
   Glob: .claude-project/store-prep/assets/screenshots/*.png → Screenshot status
   Grep: MODE=PRODUCTION in .env* → Production mode status
   Glob: **/release-keystore.jks → Keystore existence
   Glob: docker-compose.prod.yml → Production Docker config
   Glob: nginx.conf → Nginx config
   Read: .claude-project/store-prep/pipeline-status.json → Previous state
   ```

2. **Checklist Generation** — Auto-check completed items based on project state:

   ```markdown
   # [App Name] Store Release Checklist
   > Auto-generated: [Date] | Complete: 12/38 (31%)

   ## Developer Tasks

   ### Capacitor Initialization
   - [x] @capacitor/core installed ← (auto-detected: exists in package.json)
   - [x] capacitor.config.ts created ← (auto-detected: file exists)
   - [ ] Add Android platform
   - [ ] Add iOS platform
   - [ ] Run npx cap sync

   ### Native Features
   - [ ] Convert to native push notifications
   - [ ] Biometric authentication (recommended)
   - [ ] StatusBar control
   - [ ] Network detection
   ...

   ## Client Tasks
   - [ ] Create Google Play Console account ($25)
   - [ ] Join Apple Developer Program ($99/year)
   - [ ] Provide app icon source (1024x1024)
   - [ ] Privacy policy hosting URL
   - [ ] Final review of legal documents
   ...
   ```

3. **Output**: Saved to `.claude-project/store-prep/checklist.md`

---

## Blocker Analysis (`/store-ship blockers`)

### Execution Algorithm

1. Collect blockers across all Phases
2. Classify into **client blockers** and **developer blockers**
3. Show affected Phases for each blocker
4. Provide resolution guide

```markdown
# Blocker Analysis

## Client Blockers (must resolve to proceed)

| Blocker | Affected Phase | Priority | Resolution |
|--------|-----------|---------|----------|
| Google Play Console account | submit | 🔴 Required | Pay $25 at play.google.com/console |
| Apple Developer account | submit, build(iOS) | 🔴 Required | Join at developer.apple.com for $99/year |
| App icon source | assets, build | 🔴 Required | 1024x1024 PNG, no transparent background |
| Production domain | deploy | 🔴 Required | Purchase/configure HTTPS domain |
| Privacy policy URL | submit | 🟡 Important | Draft is ready, just need hosting URL |

## Developer Blockers (developer resolves)

| Blocker | Affected Phase | Priority | Status |
|--------|-----------|---------|------|
| Capacitor not installed | native, build | 🔴 Required | Resolve with `/store-native init` |
| Native push not converted | native | 🔴 Required | Resolve with `/store-native push` |
| Production env vars not set | deploy | 🔴 Required | Resolve with `/store-deploy env` |

## Client Communication Message (copy-ready)

> To proceed with [App Name] store release, please prepare the following items:
>
> 1. **Google Play Console** developer account creation (cost: $25)
>    - https://play.google.com/console
> 2. **Apple Developer Program** enrollment (cost: $99/year)
>    - https://developer.apple.com/programs
> 3. **App icon source** image delivery (1024x1024 PNG)
> 4. **Production domain** decision (HTTPS required)
> 5. **Privacy policy** hosting URL decision
>
> Developer-side preparation progress: 35%
> Estimated submission within 5-7 days after client items are completed.
```

---

## Phase Dependencies

```
prep ──→ assets (app info needed)
prep ──→ native (app name, bundle ID needed)
prep ──→ deploy (server info needed)
native ─→ build (Capacitor project needed)
assets ─→ build (icons needed)
deploy ─→ build (production URL needed)
build ──→ testing (release build needed for internal/TestFlight testing)
testing ─→ submit (PM/client must confirm smoke test passes)
prep ──→ submit (listing documents needed)
assets ─→ submit (assets needed)
submit ─→ review (after review submission)
```

### Parallelizable Segments

```
After prep completion, can proceed simultaneously:
├── assets (asset preparation)     — When client provides icon
├── native (app wrapper)           — Can start immediately
└── deploy (server deployment)     — Can start immediately

After above 3 complete:
└── build (release build)

After build completion:
└── testing (Internal Testing / TestFlight — PM smoke test)

After testing confirmed:
└── submit (store submission)
```

---

## State Tracking File

### `.claude-project/store-prep/pipeline-status.json`

```json
{
  "appName": "App Name",
  "startedAt": "2026-03-12",
  "lastUpdated": "2026-03-15",
  "targetStores": ["google-play", "app-store"],
  "overallProgress": 35,
  "phases": {
    "prep": {
      "status": "completed",
      "startedAt": "2026-03-12",
      "completedAt": "2026-03-12",
      "subPhases": {
        "interview": "completed",
        "classify": "completed",
        "docs": "completed",
        "legal": "completed",
        "client": "completed",
        "tech": "completed"
      },
      "blockers": []
    },
    "assets": {
      "status": "pending|in-progress|completed|blocked",
      "subPhases": {
        "icon": "pending",
        "screenshot": "pending",
        "splash": "pending",
        "feature": "pending"
      },
      "blockers": [],
      "autoDetected": {
        "iconOriginal": false,
        "iconPlaystore": false,
        "iconAppstore": false,
        "screenshotCount": 0
      }
    },
    "native": {
      "status": "pending",
      "subPhases": {
        "init": "pending",
        "push": "pending",
        "deeplink": "pending",
        "biometric": "pending",
        "apple-login": "pending",
        "account-deletion": "pending",
        "att": "pending"
      },
      "blockers": [],
      "autoDetected": {
        "capacitorInstalled": false,
        "androidProject": false,
        "iosProject": false,
        "nativePush": false,
        "biometric": false,
        "webPushExists": false,
        "socialLoginDetected": false,
        "appleSignInInstalled": false,
        "trackingSdkDetected": false,
        "attInstalled": false,
        "accountDeletionExists": false
      }
    },
    "deploy": {
      "status": "pending",
      "subPhases": {
        "check": "pending",
        "env": "pending",
        "docker": "pending",
        "ssl": "pending"
      },
      "blockers": [],
      "autoDetected": {
        "productionMode": false,
        "dockerProd": false,
        "nginxConf": false,
        "sslConfigured": false
      }
    },
    "build": {
      "status": "pending",
      "subPhases": {
        "android": "pending",
        "ios": "pending",
        "testing": "pending"
      },
      "blockers": [],
      "autoDetected": {
        "keystoreExists": false,
        "aabExists": false,
        "keystoreInGitignore": false,
        "testingCompleted": false
      }
    },
    "submit": {
      "status": "pending",
      "subPhases": {
        "google": "pending",
        "apple": "pending"
      },
      "blockers": []
    },
    "review": {
      "status": "pending",
      "subPhases": {
        "google": "pending",
        "apple": "pending"
      },
      "rejections": []
    }
  }
}
```

---

## Execution Algorithm

### `/store-ship` or `/store-ship status`

1. **Run auto-detection** — Scan file system + package.json + .env
2. Read `pipeline-status.json` (if absent, initialize + verify prep)
3. Sync auto-detection results with JSON state
4. Calculate overall progress
5. Output dashboard (format above)
6. Guide to next available Phase

### `/store-ship start`

1. Initialize `pipeline-status.json`
2. Execute Phase 1 (`/store-prep`)
3. After Phase 1 completion → Guide to parallelizable Phases

### `/store-ship resume`

1. Run auto-detection
2. Sync with `pipeline-status.json`
3. Find first `pending` or `in-progress` Phase
4. If blockers exist, guide to Phases that can bypass blockers
5. Execute that Phase

### `/store-ship from <phase>`

1. Validate prerequisites (based on auto-detection)
2. If unmet: List required Phases + ask whether to force start
3. If met: Execute the corresponding Phase skill

### `/store-ship checklist`

1. Full project scan (per detection rules above)
2. Auto-check completed items
3. Classify developer/client tasks
4. Save to `.claude-project/store-prep/checklist.md`

### `/store-ship blockers`

1. Collect blockers across all Phases
2. Classify client/developer
3. Generate client communication message

### `/store-ship update`

1. Verify initial release completed
2. Determine update scope (patch/minor/major)
3. Auto-generate "What's New" from git log
4. Version bump (package.json + build.gradle + Info.plist)
5. Execute reduced pipeline: build → testing → submit

---

## Developer vs Client Task Separation

| Phase | Developer | Client |
|-------|--------|-----------|
| prep | Code analysis, document drafts | Confirm app info, review |
| assets | Screenshot capture, resizing | Provide icon source, final approval |
| native | Capacitor setup, code writing | - |
| deploy | Server configuration, deployment | Domain purchase, payment key issuance |
| build | Build generation | iOS certificate (Apple account) |
| submit | Metadata entry on behalf | **Console account creation**, final approval |
| review | Rejection response, code fixes | Resolution Center replies |

---

## Update Workflow (`/store-ship update`)

For subsequent releases after the initial submission. Runs a reduced pipeline — skips prep/assets/native/deploy unless changes are needed.

### Execution Algorithm

1. **Verify initial release exists**:
   - Check `pipeline-status.json` for previous completed submission
   - If no previous release → redirect to `/store-ship start`

2. **Determine update scope** (AskUserQuestion):
   ```
   What type of update is this?

   1. Bug fix (patch: 1.0.0 → 1.0.1)
   2. New feature (minor: 1.0.0 → 1.1.0)
   3. Major update (major: 1.0.0 → 2.0.0)

   Need to update screenshots or listing text? (y/n)
   ```

3. **Auto-generate "What's New" text**:
   ```
   Read: git log --oneline [last-release-tag]..HEAD → extract commit messages
   Summarize into 3-5 bullet points (Korean)
   Present draft to PM for confirmation
   ```

   Draft format:
   ```
   [App Name] v1.1.0 update

   • New feature: [feature description]
   • Improvement: [improvement description]
   • Bug fix: [fix description]
   ```

4. **Version bump**:
   - Update `frontend/package.json` → version
   - Update `android/app/build.gradle` → versionCode (increment by 1), versionName
   - Update `ios/App/App/Info.plist` → CFBundleVersion (increment), CFBundleShortVersionString

5. **Reduced pipeline execution**:
   ```
   Version bump → build → testing → submit
                           ↑
                    (only if screenshots/listing changed)
                           assets update
   ```

6. **Submit update**:
   - Google Play: Production → Create new release → Upload AAB → Add release notes
   - App Store: New version → Upload build → Add "What's New" → Submit for review

### Update Status Tracking
- Tag git with version: `git tag v1.1.0`
- Update `pipeline-status.json` with version history
- Save release notes to `.claude-project/store-prep/build/version-history.md`

---

## After Release Complete

When review passes:
```markdown
# Release Complete!

## Google Play
- Status: ✅ Approved
- Release Date: 2026-XX-XX
- Store URL: https://play.google.com/store/apps/details?id=...

## App Store
- Status: ✅ Approved
- Release Date: 2026-XX-XX
- Store URL: https://apps.apple.com/kr/app/...

## Post-Release Checklist
- [ ] Verify normal app download from store
- [ ] Verify normal operation after installation
- [ ] Set up server monitoring
- [ ] Verify crash reporting (Firebase Crashlytics recommended)
- [ ] Open user feedback channel
- [ ] Plan first update
- [ ] ASO (App Store Optimization) monitoring
```
