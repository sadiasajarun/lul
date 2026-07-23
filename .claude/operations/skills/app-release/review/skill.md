---
name: store-review
description: Store review result handling - rejection reason analysis, fix guide, resubmission
user-invocable: true
argument-hint: "[google|apple] [rejection-reason]"
---

# Store Review - Review Response & Rejection Handling

## Purpose

When an app is rejected during store review, this skill analyzes the rejection reason and provides a fix plan.
Common rejection reasons and solutions are maintained as a database for quick response.

## Usage

```
/store-review                              # General rejection reasons and prevention tips
/store-review apple "Guideline 4.2"        # Handle specific Apple guideline violation
/store-review google "policy violation"    # Handle specific Google policy violation
/store-review apple                        # Apple review rejection analysis (will ask for reason)
```

## Pre-flight

Before generating any output, execute the **Pre-flight: Gitignore Output Directory** from [Store Shared Reference](../_store-shared/reference.md). This ensures `.claude-project/` is in `.gitignore` before any files are created.

## Prerequisites

- Submission completed (`/store-submit`)
- Rejection email/notification content available

---

## Execution Algorithm

### Step 1: Collect Rejection Information

Confirm via AskUserQuestion:
- Which store rejected the app? (Google Play / App Store)
- Please paste the rejection email/message content
- Is there a guideline number? (e.g., 4.2, 5.1.1)

### Step 2: Analyze Reason and Provide Solution

Analyze the rejection message and provide the applicable guideline and specific solution.

### Step 3: Code Fix

Directly perform necessary code fixes or provide a fix guide.

### Step 4: Resubmission Preparation

After fixes are complete, provide a checklist for resubmission and help draft the Resolution Center notes.

---

## Common Rejection Reasons Database

### Apple App Store - Frequently Occurring Rejections

#### 1. Guideline 4.2 - Minimum Functionality
**Symptom**: "Your app is a repackaged website" / App with only WebView
**Cause**: Wrapping a website as an app without native features
**Solution**:
- Implement push notifications (`/store-native push`)
- Add biometric authentication (`/store-native biometric`)
- Add offline support
- Use native navigation
- **Explicitly list native features in review notes**

**Resubmission note example**:
```
Our app provides the following native features:
1. Native push notifications (APNs) for exercise prescription alerts
2. Face ID/Touch ID biometric authentication login
3. Native status bar and navigation integration
4. Network status detection and offline guidance

This app is not a simple website wrapper, but provides
specialized features for patient-coach exercise
prescription management.
```

#### 2. Guideline 5.1.1 - Data Collection and Storage
**Symptom**: Privacy data collection violation
**Cause**: Missing/insufficient privacy policy, lack of purpose specification
**Solution**:
- Verify privacy policy URL and accessibility
- Specify data collection purposes within the app
- Add consent flow (on first launch)

#### 3. Guideline 2.1 - App Completeness
**Symptom**: "Your app crashed" / Incomplete functionality
**Cause**: Crashes, blank screens, broken links
**Solution**:
- Verify server status (prevent server downtime during review)
- Confirm test account works properly
- Confirm all screens load correctly

#### 4. Guideline 3.1.1 - In-App Purchase
**Symptom**: Selling digital content via external payment
**Cause**: Using external payment (e.g., Toss) instead of Apple In-App Purchase
**Solution**:
- Digital content/services: In-App Purchase required
- Physical goods/services: External payment allowed
- **Exercise video prescriptions = professional service → external payment may be possible (needs confirmation)**

#### 5. Guideline 4.8 - Sign in with Apple
**Symptom**: Missing Sign in with Apple when offering social login
**Cause**: Google login exists but Apple login is missing
**Solution**:
- Implement Sign in with Apple
- Or remove social login entirely (may not apply if using only ID/name)

---

### Google Play - Frequently Occurring Rejections

#### 1. Webview Policy - Limited Functionality
**Symptom**: "This app appears to be a webview of a website"
**Cause**: WebView app without native features
**Solution**: Same as Apple 4.2 (add native features)

#### 2. Data Safety - Incomplete Declaration
**Symptom**: Incomplete data safety section
**Cause**: Mismatch between actual collected data and declared data
**Solution**:
- Re-analyze actual data collected in code
- Rewrite data safety section
- Include data collected by SDKs like Firebase Analytics, Crashlytics

#### 3. Target API Level
**Symptom**: "Your app targets API level XX"
**Cause**: targetSdkVersion below current requirement
**Solution**:
- Update `targetSdkVersion` in `android/app/build.gradle`
- Current requirement: API 34+ (Android 14)

#### 4. User Data - Account Deletion
**Symptom**: Missing account deletion feature
**Cause**: Account deletion has been required since 2023
**Solution**:
- Implement in-app account deletion feature
- Or specify deletion request method (email)

---

## Resubmission Strategy

### Auto-generate Review Response Draft

When a rejection message is received, **auto-generate a response draft and present it to the PM** using the following procedure:

1. **Extract guideline number** from the rejection message (e.g., 4.2, 5.1.1)
2. Match against the "Frequently Occurring Rejections" patterns above
3. Detect fix details from code changes (git diff)
4. Generate draft using the template below → request PM confirmation

**Response draft template:**

```
[Draft format to present to PM]

Here is the resubmission response draft. Please review and let me know if anything needs to be changed:

---
Thank you for your feedback regarding [app name].

We have addressed the issues cited in your review:

[Repeat per guideline]
**Guideline [number] — [title]:**
We have [specific fix details]. Specifically:
- [Change 1]
- [Change 2]

[Common closing]
We have thoroughly tested these changes and believe our app now
fully complies with the App Store Review Guidelines.
Please let us know if you have any additional questions.
---

Let me know if anything needs to be changed.
If everything looks good, please reply "confirmed".
```

**For compound rejections (multiple guideline violations at once):**
- Separate each guideline into its own section
- Include specific fix details + evidence (screenshot paths) for each
- If any item was not fixed, specify the reason

### Review Notes Writing Principles
1. **Quote the exact rejection reason** and specify fixes for each
2. **Attach screenshots**: Capture the fixed screens
3. **Be specific**: Not "we fixed it" but "We implemented Push Notifications to deliver exercise reminders natively"
4. **Maintain a polite and professional tone**
5. **Write in English** (English is recommended for Apple Resolution Center)

### Resubmission Timing
- Can submit immediately after fixes are complete
- Apple: Respond via Resolution Center
- Google: Fix the app and resubmit with a new build

---

## Output Artifacts

```
.claude-project/store-prep/review/
├── rejection-analysis.md       # Rejection reason analysis
├── fix-plan.md                 # Fix plan
├── resolution-response.md      # Review response draft
└── resubmit-checklist.md       # Pre-resubmission checklist
```
