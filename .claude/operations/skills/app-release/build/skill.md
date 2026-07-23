---
name: store-build
description: App signing (Keystore/certificate) creation, release build, AAB/IPA generation guide
user-invocable: true
argument-hint: "[android|ios|all]"
---

# Store Build - App Signing & Release Build

## Purpose

Generates release builds for store submission.
Creates AAB (App Bundle) for Android and IPA files for iOS, ready to upload to their respective stores.

## Usage

```
/store-build              # Check build readiness
/store-build android      # Android signing + AAB build
/store-build ios          # iOS signing + IPA build
/store-build all          # Both platforms
```

## Pre-flight

Before generating any output, execute the **Pre-flight: Gitignore Output Directory** from [Store Shared Reference](../_store-shared/reference.md). This ensures `.claude-project/` is in `.gitignore` before any files are created.

## Prerequisites

- `/store-native init` completed (Capacitor + platforms added)
- `/store-assets icon` completed (icons prepared)
- `/store-deploy` completed (production server URL finalized)

---

## Phase 1: Android Build (`/store-build android`)

### Step 1: Set App Version

Modify `android/app/build.gradle`:
```groovy
android {
    defaultConfig {
        versionCode 1          // Increment with each upload (integer)
        versionName "1.0.0"    // Version displayed to users
        minSdkVersion 22       // Android 5.1+
        targetSdkVersion 35    // Must meet current Google Play minimum
        compileSdkVersion 35   // Must be >= targetSdkVersion
    }
}
```

⚠️ **targetSdkVersion Auto-Check**:
- Google Play updates the minimum requirement annually (typically August)
- Before building, verify current requirement at Google Play developer policy
- Auto-detect: `Grep: targetSdkVersion in android/app/build.gradle` → flag if below current minimum
- `compileSdkVersion` must be >= `targetSdkVersion` — check alignment
- As of 2025: targetSdkVersion 35 (Android 15) is required for new apps

### Step 2: Generate Release Keystore

```bash
keytool -genkeypair \
  -v \
  -storetype PKCS12 \
  -keystore release-keystore.jks \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias release-key \
  -storepass [password] \
  -keypass [password] \
  -dname "CN=[AppName], OU=[Department], O=[CompanyName], L=[City], ST=[State], C=KR"
```

⚠️ **Keystore Management Cautions**:
- **Never lose** the keystore file or password
- If lost, app updates become impossible — must re-register as a new app
- Do not commit to Git (add to .gitignore)
- Back up in a secure location (Google Play App Signing recommended)

### Step 3: Signing Configuration

Add signing configuration to `android/app/build.gradle`:
```groovy
android {
    signingConfigs {
        release {
            storeFile file('../release-keystore.jks')
            storePassword System.getenv('KEYSTORE_PASSWORD')
            keyAlias 'release-key'
            keyPassword System.getenv('KEY_PASSWORD')
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

### Step 3.5: ProGuard/R8 Rules for Capacitor

When `minifyEnabled true` is set, R8/ProGuard strips unused classes. Capacitor plugins use reflection and will crash in release builds without keep rules.

1. **Auto-detect installed Capacitor plugins**:
   ```
   Grep: @capacitor/ in frontend/package.json → list all Capacitor plugins
   Grep: @capacitor-community/ in frontend/package.json → list community plugins
   ```

2. **Generate `android/app/proguard-rules.pro`**:
   ```proguard
   # Capacitor Core — always required
   -keep class com.getcapacitor.** { *; }
   -dontwarn com.getcapacitor.**

   # Capacitor Plugin classes — keep all registered plugins
   -keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
   -keep class * extends com.getcapacitor.Plugin { *; }

   # WebView — required for Capacitor
   -keepclassmembers class * {
       @android.webkit.JavascriptInterface <methods>;
   }

   # [Add plugin-specific rules below based on detected plugins]
   # Example: Push Notifications
   # -keep class com.google.firebase.** { *; }
   # -dontwarn com.google.firebase.**
   ```

3. **Verify**: Build release AAB → install on device → test core user flows (login, main features, push)
   - If crash in release but not debug → missing ProGuard keep rule

### Step 4: AAB Build

```bash
cd frontend
npx cap sync android
cd android
./gradlew bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

### Build Verification
- [ ] Confirm AAB file is generated
- [ ] Extract APK with `bundletool` and test installation
- [ ] Verify production server connection
- [ ] Verify app icon displays correctly

---

## Phase 2: iOS Build (`/store-build ios`)

### Prerequisites
- **Mac required** (Xcode runs only on macOS)
- Apple Developer account (client's account)
- Latest version of Xcode

### Step 1: Set App Information

Modify `ios/App/App/Info.plist`:
- Bundle Identifier: `com.companyname.appname`
- Bundle Version (CFBundleVersion): `1`
- Bundle Short Version (CFBundleShortVersionString): `1.0.0`
- Display Name: `AppName`

### Step 2: Signing Configuration (Xcode)

1. Open `ios/App/App.xcworkspace` in Xcode
2. Signing & Capabilities:
   - Team: Select client's Apple Developer account
   - Verify Bundle Identifier
   - Check "Automatically manage signing"
3. Add Push Notifications capability (if using push notifications)

### Step 3: Archive & Upload

1. Xcode → Product → Archive
2. After Archive completes → Distribute App
3. App Store Connect → Upload
4. Verify build in App Store Connect

### Build Verification
- [ ] Archive successful
- [ ] Build appears in App Store Connect
- [ ] Testable via TestFlight

---

## Phase 3: Pre-Submission Testing Gate

> **Do NOT proceed to `/store-submit` until this phase is complete.**
> Internal testing catches issues that would cause store rejection or poor first impressions.

### Android: Google Play Internal Testing

1. Go to Google Play Console → Testing → Internal testing
2. Create new release → upload AAB
3. Add testers (PM, client, QA team email addresses)
4. Testers install via opt-in link
5. **PM Smoke Test Checklist**:
   - [ ] App installs and launches without crash
   - [ ] Login with test account works
   - [ ] Core features function (navigate all main screens)
   - [ ] Push notification received (send test notification)
   - [ ] App icon and splash screen display correctly
   - [ ] Production server data loads properly
   - [ ] Account deletion flow works (if implemented)
   - [ ] Deep links open correct screens (if implemented)

### iOS: TestFlight

1. Xcode Archive → Upload to App Store Connect
2. Wait for build processing (5-30 minutes)
3. App Store Connect → TestFlight → Internal Testing → Add testers
4. Testers install via TestFlight app
5. **Same PM Smoke Test Checklist as above**

### Completion Criteria
- All checklist items pass on both platforms
- No crash reports in testing console
- PM/client confirms app is ready for public submission

---

## Phase 4: Version Management Strategy

### Recommended Versioning Rules
```
Major.Minor.Patch (e.g., 1.0.0)
├── Major: Large feature changes / full UI overhaul
├── Minor: New feature additions
└── Patch: Bug fixes
```

### Version Synchronization
- Keep Android `versionName` and iOS `CFBundleShortVersionString` identical
- Also synchronize with `version` in `frontend/package.json`

---

## Deliverables

```
.claude-project/store-prep/build/
├── build-guide-android.md    # Detailed Android build guide
├── build-guide-ios.md        # Detailed iOS build guide
├── keystore-info.md          # Keystore information (excluding passwords)
└── version-history.md        # Version history management
```

```
frontend/
├── android/
│   ├── release-keystore.jks  # ⚠️ Add to .gitignore
│   └── app/build/outputs/bundle/release/app-release.aab
└── ios/
    └── (Xcode Archive)
```
