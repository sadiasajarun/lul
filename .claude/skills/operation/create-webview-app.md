---
description: "Clone web-view-app-boilerplate into mobile/ folder and configure it as a WebView app for this project."
argument-hint: ""
---

# Create WebView App

Clone the Flutter WebView boilerplate into a `mobile/` folder at the root of the current project and configure it.

**Boilerplate repo**: https://github.com/potentialInc/web-view-app-boilerplate.git
**Setup guide**: `/Users/dongsub/Desktop/web-view-app-setup-guide.md` (read this for full reference on Firebase, RevenueCat, permissions, JS bridge)

Arguments: $ARGUMENTS

## Instructions

### Phase 1: Gather Information

Use AskUserQuestion to collect information in two rounds.

#### Round 1 — Basic Info
Ask the user for the following:

1. **Website URL** (`BASE_URL`) — the page loaded on app open, e.g. `https://yourwebsite.com`
2. **Home URL** (`BASE_URL_HOME`) — the home page that triggers exit dialog on back press, e.g. `https://yourwebsite.com/home`
3. **Package name** (reverse domain) — e.g. `com.potentialai.myapp` (used for both Android `applicationId` and iOS `CFBundleIdentifier`)
4. **App display name** — human-readable name shown on the device, e.g. `My App`
5. **App name** (snake_case for pubspec.yaml `name` field) — e.g. `my_app` (default: derive from display name)

#### Round 2 — Optional Integrations (multiSelect)
Ask with AskUserQuestion (multiSelect: true): "Which optional integrations do you need?"

| Option | Description | What it configures |
|--------|-------------|--------------------|
| **Push Notifications (Firebase FCM)** | Send push notifications via Firebase Cloud Messaging | Keep Firebase deps in pubspec.yaml, keep `FCMService`, keep `Firebase.initializeApp()` in main.dart. Remind user to place `google-services.json` + `GoogleService-Info.plist` and run `flutterfire configure` |
| **In-App Purchases (RevenueCat)** | Subscription/IAP management via RevenueCat | Keep RevenueCat deps, keep `_configureSDK()` in main.dart, add `APPLE_API_KEY`, `GOOGLE_API_KEY`, `ENTITLEMENT_ID` to `.env`. Remind user to fill in keys from RevenueCat dashboard |
| **Camera & Photo Access** | Allow website to use camera and photo library | Add `NSCameraUsageDescription` + `NSPhotoLibraryUsageDescription` to Info.plist. Add `android.permission.CAMERA` + `android.permission.READ_EXTERNAL_STORAGE` to AndroidManifest.xml |
| **Microphone Access** | Allow website to use microphone | Add `NSMicrophoneUsageDescription` to Info.plist. Add `android.permission.RECORD_AUDIO` to AndroidManifest.xml |

If the user selects **none**: 
- Comment out or remove `Firebase.initializeApp()` and `_configureSDK()` from main.dart
- Remove `firebase_core`, `firebase_messaging`, `purchases_flutter` from pubspec.yaml
- Skip Firebase/RevenueCat items in the summary checklist

For each **selected** integration, apply the configuration during Phase 2 and include relevant setup reminders in the Phase 3 summary.

### Phase 2: Clone & Configure

#### Step 1 — Clone into mobile/
```bash
cd <project-root>
git clone https://github.com/potentialInc/web-view-app-boilerplate.git mobile
cd mobile
rm -rf .git
```

Do NOT run `git init` inside `mobile/` — it will be part of the parent project's git repo.

#### Step 2 — Update pubspec.yaml
Change the `name:` field to the app name (snake_case).

#### Step 3 — Create .env
```bash
cp env_example.txt .env
```
Then edit `.env` to set:
- `BASE_URL=<website-url>`
- `BASE_URL_HOME=<home-url>`
- Leave RevenueCat keys blank unless provided.

#### Step 4 — Update Android package name
Edit `android/app/build.gradle` → `applicationId` to the package name.

#### Step 5 — Update iOS bundle identifier & display name
Edit `ios/Runner/Info.plist`:
- `CFBundleIdentifier` → package name
- `CFBundleDisplayName` → app display name
- `CFBundleName` → app display name

#### Step 6 — Update Android display name
Edit `android/app/src/main/AndroidManifest.xml` → `android:label` to the app display name.

#### Step 7 — Install dependencies
```bash
cd <project-root>/mobile
flutter pub get
```

### Phase 3: Summary

After completing all steps, print a summary. Only include checklist items for integrations the user selected:

```
--- WebView App Created ---
Directory:    <project-root>/mobile/
App Name:     <app-name>
Package:      <package-name>
Display Name: <display-name>
Base URL:     <base-url>
Home URL:     <home-url>
Integrations: <comma-separated list of selected integrations, or "None">

Remaining setup (do manually):
- [ ] Add app icon to mobile/assets/icons/logo.png and run: flutter pub run flutter_launcher_icons
```

Conditionally include based on selected integrations:
- **If Firebase FCM selected**:
  - `- [ ] Set up Firebase project and place google-services.json (android/app/) + GoogleService-Info.plist (ios/Runner/)`
  - `- [ ] Run: flutterfire configure`
  - `- [ ] Upload APNs Auth Key (.p8) in Firebase Console for iOS push notifications`
- **If RevenueCat selected**:
  - `- [ ] Add RevenueCat API keys to mobile/.env (APPLE_API_KEY, GOOGLE_API_KEY, ENTITLEMENT_ID)`

Always include:
```
- [ ] Test with: cd mobile && flutter run
```

Refer to the setup guide at `/Users/dongsub/Desktop/web-view-app-setup-guide.md` for detailed instructions on Firebase, RevenueCat, permissions, and JS bridge setup.
