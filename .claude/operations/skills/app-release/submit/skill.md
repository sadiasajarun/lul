---
name: store-submit
description: Complete process guide for uploading apps to store consoles, entering metadata, and submitting for review
user-invocable: true
argument-hint: "[google|apple|all]"
---

# Store Submit - Store Submission

## Purpose

Upload built apps to Google Play Console and App Store Connect,
enter prepared documents/assets, and submit for review.

## Usage

```
/store-submit              # Final pre-submission readiness check
/store-submit google       # Google Play submission process
/store-submit apple        # App Store submission process
/store-submit all          # Submit to both stores
```

## Pre-flight

Before generating any output, execute the **Pre-flight: Gitignore Output Directory** from [Store Shared Reference](../_store-shared/reference.md). This ensures `.claude-project/` is in `.gitignore` before any files are created.

## Prerequisites

- `/store-prep` completed → listing documents prepared
- `/store-assets` completed → assets prepared
- `/store-build` completed → release build ready
- `/store-deploy` completed → production server running
- Developer console account created (client side)

## Data Source Priority

Information needed for submission is automatically extracted in the following order. Asking the PM directly is a **last resort**:

1. **PRD** (`.claude-project/prd/`) — App name, feature descriptions, user roles, data collection fields, tech stack
2. **i18n files** (`frontend/app/i18n/locales/`) — UI text, feature names, menu structure
3. **Code analysis** — Entity/DTO fields, SDKs, routes, permission structure
4. **store-prep deliverables** — Already generated listings, legal documents, classification results

**Only present market decisions as options to the PM:**
- Service countries (when not specified in PRD)
- Pricing model (free/paid/subscription)
- Release strategy (immediate/manual/scheduled)

```
[Market Decision Question Format for PM]

Based on PRD and code analysis, please confirm the following:

1. Service countries: Korea only (single Korean i18n detected from PRD)
   → Is this correct? Adding other countries?

2. Pricing: Free app (no in-app purchase/subscription code detected)
   → Is this correct?

3. Release: Immediate release upon review approval
   → Is this correct? Need to target a specific date?

If no changes, just reply "Confirmed".
```

---

## Phase 0: Final Pre-Submission Check

### Checklist

```markdown
# Final Pre-Submission Check

## Required Deliverables
- [ ] .claude-project/store-prep/listing-google-play.md (listing text)
- [ ] .claude-project/store-prep/listing-app-store.md (listing text)
- [ ] .claude-project/store-prep/privacy-policy.md (privacy policy)
- [ ] .claude-project/store-prep/terms-of-service.md (terms of service)
- [ ] Privacy Policy URL (web-accessible, HTTPS) — ⚠️ **Unconditionally required** for Google Play (2024+, regardless of data collection)
- [ ] App icon (512x512, 1024x1024)
- [ ] Screenshots (per store specifications)
- [ ] Feature Graphic (1024x500, Google Play)
- [ ] AAB file (Android)
- [ ] Xcode Archive (iOS)

## Store Compliance Requirements
- [ ] **Account deletion** — In-app deletion flow implemented (required by both stores if account creation exists)
- [ ] **Sign in with Apple** — Implemented if any social login exists (Apple Guideline 4.8)
- [ ] **App Tracking Transparency** — ATT prompt implemented if tracking/advertising SDKs present (iOS 14.5+)
- [ ] **targetSdkVersion** — Meets current Google Play minimum requirement (verify at Google Play policy page)

## Required Accounts
- [ ] Google Play Console login accessible
- [ ] App Store Connect login accessible
- [ ] Google Play developer account identity verification completed
- [ ] Apple Developer license agreement accepted

## Required Information
- [ ] Test account for review (ID/password)
- [ ] Customer support email
- [ ] Customer support phone number
- [ ] Support URL (HTTPS, must be actually accessible)
```

---

## Phase 1: Google Play Submission (`/store-submit google`)

### Prerequisite: Developer Account Setup Verification

Items that must be completed in Google Play Console before app registration:
1. **Identity verification** — ID upload (only account owner can do this, takes several days)
2. **Contact phone number verification** — Proceed after identity verification is complete

⚠️ App registration is impossible if this step is not completed.

### Step-by-Step Guide

#### 1-1. Create App
1. Go to [Google Play Console](https://play.google.com/console)
2. Click "Create app"
3. Input fields (copy from `.claude-project/store-prep/listing-google-play.md`):
   - App name
   - Default language: Korean
   - App or game: App
   - Free or paid
   - Developer program policy agreement

#### 1-2. Store Listing
1. Main store listing:
   - App name (30 characters)
   - Short description (80 characters)
   - Full description (4000 characters)
   - App icon (512x512)
   - Feature Graphic (1024x500)
   - Screenshots (phone: 2-8 images)
2. Contact information:
   - Email (required)
   - Phone number (required)
   - Website (optional)

#### 1-3. Content Rating
1. "Content rating" → Start questionnaire
2. Key responses for health/medical apps:
   - Violence: None
   - Sexual content: None
   - Drugs: None (be careful if medical information is included)
   - User-generated content: Check if applicable
   - Personal information: Collected → Fill in details

#### 1-4. Data Safety Section ⚠️ Important
1. Complete "Data safety"
2. **Auto-generate a draft from code analysis and present to PM:**
   - Detect collected fields from Entity/DTO
   - Detect auto-collected items from SDKs like FCM/Analytics
   - Present detection results to PM for confirmation in the following format

   ```
   [Draft Format to Present to PM]

   Here is the Google Play Data Safety draft. Please review:

   | Data Type | Collected | Shared | Required | Purpose | Detection Basis |
   |-----------|-----------|--------|----------|---------|----------------|
   | Name | Yes | No | Yes | App functionality | User.fullName field |
   | Email | ? | No | | Account management | No email detected in User entity — do you collect this? |
   | Health info | Yes | No | Yes | Core functionality | DailySurvey (pain/sleep/steps) |
   | Photos/Videos | ? | No | | | Profile image upload detected — is this required? |
   | App activity | Yes | No | Yes | Analytics | ExerciseLog (exercise records) |
   | Device ID | Yes | No | Yes | Push notifications | FCM deviceToken field |

   Items marked with ? need confirmation.
   Let me know if there are items to add or remove.
   If no changes, just reply "Confirmed".
   ```

   **Purpose description examples** (reference when entering in Google Play Console):
   | Purpose Category | Description Example |
   |-----------------|-------------------|
   | App functionality | Used for user identification and personalized content delivery |
   | Analytics | Usage pattern analysis for service improvement |
   | Account management | Used for login and account recovery |
   | Push notifications | Sending notifications for exercise reminders, coach messages, etc. |
   | Core functionality | Essential for providing the app's main services |

3. Specify data deletion request method (required since December 2023):
   - In-app deletion feature (recommended — implemented via `/store-native account-deletion`)
   - Email request method (acceptable but less preferred)
   - Both in-app + email (best option)
   - ⚠️ If account deletion is not implemented, Google Play will reject the app

#### 1-5. App Release
1. "Production" → "Create new release"
2. Upload AAB file
3. Release name: `1.0.0`
4. Write release notes (Korean) — generate and present the following draft based on app analysis:

   **Draft generation rules:**
   - Summarize 3-5 core features from `.claude-project/store-prep/app-info.md`
   - First release: "launch" tone, updates: "improvement/addition" tone
   - Under 200 characters, concise bullet format

   ```
   # First Release Draft Example (auto-generated after app analysis):
   Health Durumi has launched!

   • Personalized exercise prescription video guides
   • Daily health status tracking (pain, sleep, steps)
   • Real-time chat consultation with your assigned coach
   • Video meeting scheduling and management
   ```

5. Click "Start review"

---

## Phase 2: App Store Submission (`/store-submit apple`)

### Prerequisite: Apple Developer Verification

- Check if Apple Developer Program License Agreement has been accepted
- If not accepted, app submission is impossible → Request acceptance from client (Account Holder)

### Step-by-Step Guide

#### 2-1. Create App
1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. "My Apps" → "+" → "New App"
3. Input:
   - Platform: iOS
   - Name: App name
   - Primary Language: Korean
   - Bundle ID: Must match the one set in Xcode
   - SKU: Unique identifier

---

#### 2-2. App Information Page (General → App Information)

| Section | Field | Guide |
|---------|-------|-------|
| **Localizable Information** | Name | App name (30 characters or less) |
| | Subtitle | Subtitle (30 characters or less) |
| **General Information** | Bundle ID | Must match Xcode |
| | SKU | Unique identifier |
| | Primary Language | Korean |
| | Category | Refer to `.claude-project/store-prep/listing-app-store.md` |
| | Secondary (optional) | ⚠️ Avoid Medical — review criteria become stricter |
| **Content Rights** | Third-party content | Refer to guide below |
| **License Agreement** | | Apple's Standard License Agreement (default) |

##### Content Rights Selection Guide

| App Characteristics | Selection |
|-------------------|-----------|
| Has user-uploaded content (chat images, videos, etc.) | **Yes** (necessary rights obtained) |
| All content is self-produced | **No** |

---

#### 2-3. Age Ratings (Bottom of App Information Page)

Click "Set Up Age Ratings" → 7-step questionnaire

**Auto-generate draft:** Analyze code based on the criteria below and present a pre-filled response draft to the PM.
- Chat/messaging module existence → UGC, Messaging determination
- Photo upload feature → UGC determination
- Health/medical related entities/services → Medical determination
- Advertising SDK existence → Advertising determination
- Payments/in-app purchases → Gambling/Loot Box determination

```
[Draft Format to Present to PM]

Age Ratings pre-filled responses generated based on app analysis. Please review:

Step 1 — Features:
  Parental Controls: NO (no child-specific features)
  Age Assurance: NO
  Unrestricted Web Access: NO (self-contained content only)
  User-Generated Content: YES ← chat module detected
  Messaging and Chat: YES ← chat module detected
  Advertising: NO (no advertising SDK detected)

Step 2 — Mature Themes: All NONE
Step 3 — Medical: (based on app analysis results)
Step 4 — Sexuality: All NONE
Step 5 — Violence: All NONE
Step 6 — Chance-Based: All NONE/NO

Let me know if any items need modification.
If no changes, just reply "Confirmed".
```

##### Detailed Criteria

**Step 1: Features**

In-App Controls:

| Item | Description | Criteria |
|------|-------------|----------|
| Parental Controls | Parental content restriction features | **NO** if not a children's app |
| Age Assurance | Age verification mechanism | **NO** if no age restrictions |

Capabilities:

| Item | Description | Criteria |
|------|-------------|----------|
| Unrestricted Web Access | Free web browsing | Internal content only → **NO** |
| User-Generated Content | User-created content | Chat/photos/forums → **YES** |
| Messaging and Chat | User-to-user messaging | Chat feature → **YES** |
| Advertising | In-app ads | No ads → **NO** |

**Step 2: Mature Themes**

| Item | General Apps | Criteria |
|------|-------------|----------|
| Profanity or Crude Humor | **NONE** | Whether profanity/crude humor is included |
| Horror/Fear Themes | **NONE** | Whether horror/anxiety content exists |
| Alcohol, Tobacco, or Drug Use | **NONE** | Medication logging level is NONE (not depiction/recommendation) |

**Step 3: Medical or Wellness**

| Item | Criteria |
|------|----------|
| Medical or Treatment Information | Health management guidance only → **INFREQUENT**, direct diagnosis/treatment → **FREQUENT** |
| Health or Wellness Topics | Health/exercise/wellness content → **YES** |

**Step 4: Sexuality or Nudity** — General apps: All **NONE**

**Step 5: Violence** — General apps: All **NONE**

**Step 6: Chance-Based Activities** — General apps: All **NONE/NO**

**Step 7: Additional Information**

- **Calculated Rating**: Auto-calculated (chat/UGC → 13+, otherwise 4+)
- **Age Categories and Override**: **Not Applicable** unless special reason
- **Age Suitability URL**: Usually **leave blank**

→ Click **Save**

---

#### 2-4. App Encryption Documentation (App Information Page)

| App Characteristics | Response |
|-------------------|----------|
| HTTPS only (standard encryption) | Set `ITSAppUsesNonExemptEncryption = NO` in Info.plist |
| Uses proprietary encryption algorithms | Separate documentation upload required |

Can be ignored before build upload.

---

#### 2-5. App Store Regulations & Permits (App Information Page)

| Item | Guide |
|------|-------|
| **Digital Services Act** | Set Up → Trader Status: **No, not a trader** for individual free apps |
| **Vietnam Game License** | Ignore if not a game |

---

#### 2-6. Pricing and Availability (Left Menu)

| Item | Details |
|------|---------|
| **Base Country** | Change to match release country (Korea → South Korea KRW) |
| **Price** | Not set = Free |
| **App Availability** | Set Up → Select only release countries |
| **Apple Silicon Mac** | **Uncheck** for WebView apps (won't work properly on Mac) |
| **Apple Vision Pro** | **Uncheck** for WebView apps |
| **App Distribution** | Public (default) |

---

#### 2-7. App Privacy (Left Menu → Trust & Safety)

##### Privacy Policy URL Setup

1. Click **Edit** → Enter Privacy Policy URL
2. HTTPS URL required, must be actually accessible
3. If no domain, **Notion public page** can be used (can be changed later)

##### Privacy Label Setup

1. Click **Get Started**
2. "Do you or your third-party partners collect data?" → **Yes**
3. Select collected data types:

| Category | Items to Select | Applicable Condition |
|----------|----------------|---------------------|
| **Contact Info** | Name, Phone Number, Email | Collected during registration |
| **Health & Fitness** | Health, Fitness | Health surveys, exercise records |
| **User Content** | Photos or Videos, Other User Content | Chat images, chat messages |
| **Identifiers** | Device ID | FCM token (push notifications) |
| **Usage Data** | — | Do not select if no separate analytics tool |
| **Diagnostics** | — | Do not select if no crash logging |

4. Set Up for each data type:

The same 3 questions appear for each item:

| Question | Typical Answer | Description |
|----------|---------------|-------------|
| **Usage** (purpose) | Check **App Functionality** | Used for app core features |
| **Linked to user?** | **Yes** | Linked to user account |
| **Used for tracking?** | **No** | Not for advertising tracking purposes |

5. After completing Set Up for all items → Click **Publish**

##### App Tracking Transparency (ATT) Declaration

If tracking/advertising SDKs are present (detected in Phase 0 of `/store-native`):
- Ensure `NSUserTrackingUsageDescription` is set in Info.plist
- ATT prompt must appear before analytics/tracking SDK initialization
- In Privacy Labels above, mark relevant items as "Used for tracking?: **Yes**" if they are used for advertising tracking
- If NO tracking SDKs exist → no action needed

---

#### 2-8. iOS App Version Page (Left Menu → 1.0 Prepare for Submission)

##### Screenshots & Previews

- Upload screenshots based on iPhone 6.5" Display (minimum 3, maximum 10)
- iPad screenshots only if iPad is supported

##### App Description (copy from `.claude-project/store-prep/listing-app-store.md`)

| Field | Character Limit | Required |
|-------|----------------|----------|
| Promotional Text | 170 characters | Optional (can be edited without review) |
| Description | 4000 characters | Required |
| Keywords | 100 characters (comma-separated) | Required |
| Support URL | — | Required (HTTPS, must be actually accessible) |
| Marketing URL | — | Optional |
| Version | — | Required |
| Copyright | — | Required |

⚠️ **Support URL note**: Entering a non-working domain causes errors. If no domain, the Privacy Policy URL (Notion) can be used instead.

##### Build

- Archive in Xcode → Upload to App Store Connect, then select

##### App Review Information

| Field | Description |
|-------|-------------|
| Sign-in required | Check if app requires login |
| Test account | ID/password for reviewers to use |
| Contact Information | Contact person during review |
| Notes | App usage instructions (Korean is acceptable) |

##### App Store Version Release

| Option | Description |
|--------|-------------|
| Manually release | Manual release after approval |
| **Automatically release** | Auto-release immediately upon approval (recommended) |
| Automatically, no earlier than | Auto-release after a specific date |

---

#### 2-9. Submit for Review
1. Verify no warnings (⚠️) in any section
2. Verify a build is selected
3. Click **Add for Review**

---

## Phase 3: Review Waiting & Monitoring

### Expected Review Duration
| Store | Normal | Expedited |
|-------|--------|-----------|
| Google Play | 3-7 days (first submission) | Not available |
| App Store | 24-48 hours | Available (reason required) |

### Monitoring Items
- Set up review status change notifications
- "In Review", "Additional Information Needed", "Approved", "Rejected"

---

## Notes & Tips

### Category Selection Caution
- **Avoid Medical category** — Additional regulatory checks for medical device applicability, higher rejection probability
- **Health & Fitness** is the safe choice for health-related apps
- Secondary Category can be left blank

### URL Related
- Both Privacy Policy URL and Support URL must be **HTTPS + actually accessible**
- If no domain, can substitute with **Notion public page** (permanent URL, automatic HTTPS)
- Can be changed later after securing a domain (editable even after review)

### When Hosting Legal Documents on Notion
- It is appropriate to create on a Notion account **under the app operator's name**
- In urgent cases, can upload to developer's Notion and change later
- Must enable "Share" → "Publish to web"

### Items the Client Must Handle Personally
- Accept Apple Developer License Agreement (only Account Holder can do this)
- Google Play identity verification + phone number verification (only account owner can do this)
- Legal document review/finalization
- Customer support phone number confirmation

---

## Deliverables

```
.claude-project/store-prep/submit/
├── pre-submit-checklist.md      # Final pre-submission checklist
├── google-play-guide.md         # Google Play submission detailed guide
├── app-store-guide.md           # App Store submission detailed guide
├── test-accounts.md             # Test account info for review
└── data-safety-responses.md     # Data safety/privacy label responses
```