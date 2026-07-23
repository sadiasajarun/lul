---
name: store-native
description: Capacitor-based native app wrapper creation - WebView setup, native feature integration (push, deep links, biometric auth, apple login, account deletion, ATT)
user-invocable: true
argument-hint: "[init|push|deeplink|biometric|apple-login|account-deletion|all]"
---

# Store Native - Native App Wrapper Creation

## Purpose

Wraps an existing web app as an Android/iOS native app using Capacitor.
Adds native features to increase the App Store review approval rate for WebView apps.

## Usage

```
/store-native                  # Full setup (starting from init, in order)
/store-native init             # Capacitor initialization + Android/iOS project creation
/store-native push             # Push notification native integration
/store-native deeplink         # Deep link configuration
/store-native biometric        # Biometric authentication addition
/store-native apple-login      # Sign in with Apple (required if social login exists)
/store-native account-deletion # Account deletion feature (required by both stores)
/store-native all              # Set up all native features
```

## Pre-flight

Before generating any output, execute the **Pre-flight: Gitignore Output Directory** from [Store Shared Reference](../_store-shared/reference.md). This ensures `.claude-project/` is in `.gitignore` before any files are created.

## Prerequisites

- `/store-prep` completed (app information collected)
- Frontend project is in a buildable state
- Node.js 18+ installed

---

## Phase 0: Automatic Project Detection

### Execution Algorithm (automatically performed before all subcommands)

1. **Frontend framework detection**:
   ```
   Read: frontend/package.json → analyze dependencies
   - react / react-dom → React
   - vue → Vue
   - @angular/core → Angular
   - next → Next.js
   - nuxt → Nuxt
   ```

2. **Build tool detection**:
   ```
   Glob: frontend/vite.config.* → Vite
   Glob: frontend/webpack.config.* → Webpack
   Read: frontend/package.json → analyze scripts.build
   ```

3. **Build output directory detection**:
   ```
   Vite: vite.config.ts → build.outDir (default: dist/)
   React Router/Remix: build/client/
   CRA: build/
   Next.js: out/ (static export)
   Angular: dist/[project-name]/
   ```

4. **Existing Capacitor installation check**:
   ```
   Glob: frontend/capacitor.config.* → already installed
   Grep: @capacitor/core in frontend/package.json
   Glob: frontend/android/ → Android project exists
   Glob: frontend/ios/ → iOS project exists
   ```

5. **Existing native feature detection**:
   ```
   Grep: firebase-messaging in frontend/package.json → web push
   Glob: frontend/public/firebase-messaging-sw.js → Firebase SW
   Grep: @capacitor/push-notifications in frontend/package.json → native push
   Grep: biometric|fingerprint in frontend/package.json → biometric auth
   ```

6. **Social login detection** (for Sign in with Apple requirement):
   ```
   Grep: google-signin|@react-oauth|passport-google|GoogleLogin in frontend/ → Google login
   Grep: kakao|KakaoLogin in frontend/ → Kakao login
   Grep: naver|NaverLogin in frontend/ → Naver login
   Grep: facebook-login|FacebookLogin in frontend/ → Facebook login
   If ANY social login detected → Sign in with Apple is MANDATORY (Apple Guideline 4.8)
   ```

7. **Tracking/advertising SDK detection** (for App Tracking Transparency):
   ```
   Grep: firebase/analytics|@react-native-firebase/analytics in frontend/package.json → Firebase Analytics
   Grep: admob|@admob in frontend/package.json → AdMob
   Grep: facebook-sdk|react-native-fbsdk in frontend/package.json → Facebook SDK
   Grep: adjust|react-native-adjust in frontend/package.json → Adjust
   Grep: appsflyer in frontend/package.json → AppsFlyer
   If ANY tracking SDK detected → ATT prompt is MANDATORY (iOS 14.5+)
   ```

8. **Account deletion detection**:
   ```
   Grep: deleteAccount|removeAccount|withdrawal|탈퇴|deactivate in backend/ → existing endpoint
   Grep: deleteAccount|withdrawal|탈퇴|deactivate in frontend/ → existing UI
   If NOT found → account deletion implementation is MANDATORY (both stores)
   ```

9. **Load app information**:
   ```
   Read: .claude-project/store-prep/app-info.md → app name, bundle ID, etc.
   If not found → collect via AskUserQuestion
   ```

### Detection Results Report

```markdown
# Project Analysis Results

| Item | Detection Result |
|------|-----------------|
| Framework | React 19 + React Router 7 |
| Build Tool | Vite 5.4 |
| Build Output | build/client/ |
| Capacitor | ❌ Not installed |
| Existing Push | Firebase Web Push (firebase-messaging-sw.js) |
| Biometric Auth | ❌ None |
| Social Login | ✅ Google Login detected → **Sign in with Apple required** |
| Tracking SDKs | ✅ Firebase Analytics detected → **ATT prompt required** |
| Account Deletion | ❌ None → **Implementation required** |
| App Name | HEALTH DURUMI |
| Bundle ID | com.healthdurumi.app (suggested) |

→ Starting from `init`.
⚠️ Mandatory features detected: Sign in with Apple, ATT prompt, Account deletion
```

---

## Phase 1: Capacitor Initialization (`/store-native init`)

### Execution Algorithm

1. **Use Phase 0 detection results**

2. **Install Capacitor**:
   ```bash
   cd frontend
   npm install @capacitor/core @capacitor/cli
   ```

3. **Determine bundle ID**:
   - Reference app name/company info from `.claude-project/store-prep/app-info.md`
   - Bundle ID convention: `com.companyname.appname` (lowercase, alphanumeric)
   - Confirm with user (AskUserQuestion)

4. **Generate capacitor.config.ts**:

   Automatically detect and apply the build output directory:
   ```typescript
   import type { CapacitorConfig } from '@capacitor/core';

   const config: CapacitorConfig = {
     appId: '[bundle-ID]',
     appName: '[app-name]',
     webDir: '[detected build output directory]',
     server: {
       // Remote URL mode (WebView app)
       url: 'https://[production-URL]',
       cleartext: false,
     },
     plugins: {
       SplashScreen: {
         launchShowDuration: 2000,
         backgroundColor: '#FFFFFF',
       },
       StatusBar: {
         style: 'LIGHT',
       },
       Keyboard: {
         resize: 'body',
         resizeOnFullScreen: true,
       },
     },
   };

   export default config;
   ```

5. **Add platforms**:
   ```bash
   npx cap add android
   npx cap add ios
   ```

6. **Update .gitignore** — exclude Capacitor build artifacts:
   ```
   # Capacitor
   android/app/build/
   ios/App/Pods/
   ```

7. **Verify configuration**:
   ```bash
   npx cap sync
   ```
   - On error, attempt automatic diagnosis and resolution

### WebView Mode Decision

Confirm via AskUserQuestion:
- **Local build mode**: Build the web app and bundle it inside the app (offline capable, app redeployment required for updates)
- **Remote URL mode**: Load server URL in WebView (always up-to-date, server required, no app redeployment needed) **(recommended)**

---

## Phase 2: Push Notifications (`/store-native push`)

### Automatic Detection and Migration of Existing Implementation

1. **Analyze existing push implementation**:
   ```
   Grep: firebase-messaging in frontend/ → find Firebase web push files
   Grep: getToken|onMessage|messaging in frontend/ → locate Firebase messaging code
   Grep: FCM|fcm|deviceToken in backend/ → locate backend token handling
   Read: detected files → understand current implementation approach
   ```

2. **Determine migration strategy**:
   - If existing Firebase web push is present:
     - Keep existing Firebase for web
     - Use Capacitor Push for native
     - Handle with **platform detection branching**
   - If no push exists:
     - Add only Capacitor Push

3. **Install Capacitor Push Notifications**:
   ```bash
   npm install @capacitor/push-notifications
   npx cap sync
   ```

4. **Generate platform-branching service**:

   Analyze existing push code and auto-generate a wrapper service:

   ```typescript
   // frontend/app/services/nativePushService.ts
   import { Capacitor } from '@capacitor/core';
   import { PushNotifications } from '@capacitor/push-notifications';

   export class NativePushService {
     static isNative = Capacitor.isNativePlatform();

     static async initialize() {
       if (this.isNative) {
         return this.initNativePush();
       } else {
         return this.initWebPush();
       }
     }

     private static async initNativePush() {
       const permission = await PushNotifications.requestPermissions();
       if (permission.receive === 'granted') {
         await PushNotifications.register();
       }

       PushNotifications.addListener('registration', (token) => {
         // Send native token to backend
         // Reuse existing FCM token storage API
         this.sendTokenToBackend(token.value, 'native');
       });

       PushNotifications.addListener('pushNotificationReceived', (notification) => {
         // Notification received while app is in foreground
         console.log('Push received:', notification);
       });

       PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
         // Notification tapped → navigate to corresponding screen
         this.handleNotificationAction(action);
       });
     }

     private static async initWebPush() {
       // Move existing Firebase web push code here or import it
       // [Auto-extracted and inserted from existing code]
     }

     private static async sendTokenToBackend(token: string, platform: string) {
       // Reuse existing token storage API endpoint
       // [Auto-detected endpoint inserted from existing code]
     }

     private static handleNotificationAction(action: any) {
       // Extract route from notification data → navigate
       const route = action.notification.data?.route;
       if (route) {
         window.location.href = route;
       }
     }
   }
   ```

5. **Modify existing code**:
   - Find existing Firebase initialization code and replace with NativePushService
   - Check if backend token storage API supports platform distinction
   - Add `platform` field to backend if needed

6. **Android setup**:
   - `google-services.json` → `android/app/google-services.json`
   - Push permissions automatically added to AndroidManifest.xml (by Capacitor)

7. **iOS setup**:
   - APNs key required (generate from client's Apple Developer account)
   - Push registration in `ios/App/App/AppDelegate.swift` (handled automatically by Capacitor)

### Important: Key to Passing Store Review
- Apple rejects WebView-only apps under Guideline 4.2
- Native push is the most effective native feature for passing review

---

## Phase 3: Deep Links (`/store-native deeplink`)

### Execution Algorithm

1. **Install @capacitor/app**:
   ```bash
   npm install @capacitor/app
   ```

2. **Analyze frontend routes**:
   ```
   Grep: Route|path in frontend/app/routes* → extract route list
   ```

3. **Configure Android App Links**:
   - Generate `assetlinks.json`
   - Add intent-filter to AndroidManifest.xml

4. **Configure iOS Universal Links**:
   - Generate `apple-app-site-association`
   - Add Associated Domains capability

5. **Generate route handler**:
   ```typescript
   import { App } from '@capacitor/app';

   App.addListener('appUrlOpen', (event) => {
     const url = new URL(event.url);
     const path = url.pathname;
     // React Router navigation
     navigate(path);
   });
   ```

---

## Phase 4: Biometric Authentication (`/store-native biometric`)

### Execution Algorithm

1. **Analyze existing authentication flow**:
   ```
   Grep: login|auth|token in frontend/app/ → locate auth code
   Read: auth-related files → understand current login/token storage approach
   ```

2. **Install biometric auth plugin**:
   ```bash
   npm install @aparajita/capacitor-biometric-auth
   npm install @capacitor/preferences  # for secure token storage
   ```

3. **Generate biometric auth service**:
   ```typescript
   // frontend/app/services/biometricService.ts
   import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
   import { Preferences } from '@capacitor/preferences';
   import { Capacitor } from '@capacitor/core';

   export class BiometricService {
     static async isAvailable(): Promise<boolean> {
       if (!Capacitor.isNativePlatform()) return false;
       try {
         const result = await BiometricAuth.checkBiometry();
         return result.isAvailable;
       } catch {
         return false;
       }
     }

     static async authenticate(): Promise<boolean> {
       try {
         await BiometricAuth.authenticate({
           reason: 'Use biometric authentication to log in',
           cancelTitle: 'Cancel',
         });
         return true;
       } catch {
         return false;
       }
     }

     static async saveCredentials(token: string) {
       await Preferences.set({ key: 'auth_token', value: token });
     }

     static async getCredentials(): Promise<string | null> {
       const { value } = await Preferences.get({ key: 'auth_token' });
       return value;
     }

     static async clearCredentials() {
       await Preferences.remove({ key: 'auth_token' });
     }
   }
   ```

4. **Modify login flow**:
   - On first successful login → suggest biometric enrollment (AskUserQuestion pattern)
   - On subsequent app launches → auto-login via biometric auth
   - On biometric failure/cancel → fallback to existing ID/PW login

### Important: Improving Review Approval Rate
- Biometric auth is a native feature highly valued by Apple
- Particularly effective for emphasizing security in health/medical apps

---

## Phase 5: Sign in with Apple (`/store-native apple-login`)

> **MANDATORY** if any third-party social login exists (Google, Kakao, Naver, Facebook).
> Apple Guideline 4.8: Apps that use third-party login must also offer Sign in with Apple.

### Execution Algorithm

1. **Verify social login presence** (from Phase 0 detection):
   - If no social login found → skip this phase (inform user it's not required)
   - If social login found → proceed

2. **Install Sign in with Apple plugin**:
   ```bash
   npm install @capacitor-community/apple-sign-in
   npx cap sync
   ```

3. **Generate Apple Sign In service**:
   ```typescript
   // frontend/app/services/appleLoginService.ts
   import { SignInWithApple, SignInWithAppleOptions, SignInWithAppleResponse } from '@capacitor-community/apple-sign-in';
   import { Capacitor } from '@capacitor/core';

   export class AppleLoginService {
     static isAvailable(): boolean {
       return Capacitor.getPlatform() === 'ios';
     }

     static async signIn(): Promise<{ identityToken: string; user: string } | null> {
       try {
         const options: SignInWithAppleOptions = {
           clientId: '[bundle-ID]',  // Same as capacitor.config.ts appId
           redirectURI: '',
           scopes: 'email name',
         };
         const result: SignInWithAppleResponse = await SignInWithApple.authorize(options);
         return {
           identityToken: result.response.identityToken,
           user: result.response.user,
         };
       } catch {
         return null;
       }
     }
   }
   ```

4. **Backend Apple ID token verification**:
   - Add endpoint to verify Apple `identityToken` (JWT)
   - Decode JWT → extract `sub` (Apple user ID), `email`
   - Apple public keys: `https://appleid.apple.com/auth/keys`
   - Match or create user account based on Apple user ID
   - Return app auth token (same as other login flows)

5. **Modify login UI**:
   - Add "Sign in with Apple" button on login page
   - Use Apple's official button style (black/white, rounded rectangle)
   - Position alongside existing social login buttons
   - On iOS: show Apple button; on Android/web: hide (Apple login is iOS-only)

6. **iOS project configuration**:
   - Add "Sign in with Apple" capability in Xcode (Signing & Capabilities)
   - This must also be enabled in Apple Developer Portal → App ID → Capabilities

### Important Notes
- Apple only provides user email on FIRST login — store it immediately
- User may choose to hide email (Apple relay address) — support this
- `identityToken` expires quickly — verify on backend immediately after receiving

---

## Phase 6: Account Deletion (`/store-native account-deletion`)

> **MANDATORY** for both Apple App Store (since June 2022) and Google Play (since December 2023).
> Apps that allow account creation MUST provide in-app account deletion.

### Execution Algorithm

1. **Check existing implementation** (from Phase 0 detection):
   - If delete endpoint and UI found → verify completeness and skip
   - If missing → implement

2. **Backend: Account deletion endpoint**:
   - Analyze existing user Entity/service to understand user data structure
   - Generate soft-delete or hard-delete endpoint:

   ```typescript
   // Soft delete (recommended — allows recovery period)
   @Delete('account')
   @UseGuards(AuthGuard)
   async deleteAccount(@CurrentUser() user: User) {
     // 1. Mark account as deleted (soft delete)
     await this.userService.softDelete(user.id);
     // 2. Invalidate all sessions/tokens
     await this.authService.revokeAllTokens(user.id);
     // 3. Schedule permanent deletion after grace period (30 days recommended)
     await this.schedulerService.scheduleAccountPurge(user.id, 30);
     return { message: 'Account scheduled for deletion' };
   }
   ```

3. **Determine deletion scope** — analyze related entities:
   ```
   Grep: @ManyToOne|@OneToMany|@ManyToMany.*User in backend/ → find related entities
   For each related entity → determine: cascade delete, anonymize, or retain
   ```
   - **Cascade delete**: Personal content (messages, uploads, preferences)
   - **Anonymize**: Shared content (comments on others' posts, team data)
   - **Retain with anonymization**: Business-critical records (transactions, audit logs)

4. **Frontend: Account deletion UI**:
   ```
   - Location: Settings or Profile page
   - Flow: Button → Confirmation modal (explain consequences) → Password/biometric re-auth → API call → Logout
   - Must include: clear explanation of what data is deleted, grace period info, confirmation step
   ```

5. **Google Play specific**: Specify data deletion method in Data Safety section
   - Option A: In-app deletion (implemented above)
   - Option B: Email request (acceptable but less preferred)
   - Option C: Both (recommended)

6. **Apple specific**: Account deletion must be discoverable within the app
   - Do NOT bury it in a web link — must be native in-app flow
   - Apple may reject if deletion requires contacting support via email only

### Verification
- Create test account → navigate to deletion → confirm flow works end-to-end
- Verify token invalidation after deletion
- Verify data cleanup (cascade/anonymize) on related entities

---

## Phase 7: App Tracking Transparency (`/store-native att`)

> **MANDATORY** on iOS 14.5+ if any tracking/advertising SDKs are present.
> Without ATT prompt, Apple will reject the app.

### Execution Algorithm

1. **Verify tracking SDK presence** (from Phase 0 detection):
   - If no tracking SDKs found → skip this phase
   - If tracking SDKs found → proceed

2. **Add ATT to Info.plist**:
   ```xml
   <!-- ios/App/App/Info.plist -->
   <key>NSUserTrackingUsageDescription</key>
   <string>We use this to provide personalized content and improve our services.</string>
   ```
   - Customize the description to match the actual tracking purpose
   - This string is shown to the user in the ATT dialog

3. **Implement ATT prompt**:
   ```typescript
   // frontend/app/services/trackingService.ts
   import { Capacitor } from '@capacitor/core';

   export class TrackingService {
     static async requestPermission(): Promise<boolean> {
       if (Capacitor.getPlatform() !== 'ios') return true;

       try {
         // Use Capacitor plugin or native bridge
         const { AppTrackingTransparency } = await import(
           '@capacitor-community/app-tracking-transparency'
         );
         const status = await AppTrackingTransparency.requestPermission();
         return status.status === 'authorized';
       } catch {
         return false;
       }
     }

     static async getStatus(): Promise<string> {
       if (Capacitor.getPlatform() !== 'ios') return 'authorized';

       try {
         const { AppTrackingTransparency } = await import(
           '@capacitor-community/app-tracking-transparency'
         );
         const status = await AppTrackingTransparency.getStatus();
         return status.status;
       } catch {
         return 'notDetermined';
       }
     }
   }
   ```

4. **Install plugin**:
   ```bash
   npm install @capacitor-community/app-tracking-transparency
   npx cap sync
   ```

5. **Integration point**:
   - Call `TrackingService.requestPermission()` on app launch (after splash, before analytics init)
   - If denied → disable tracking SDKs (do not send analytics/advertising data)
   - If authorized → proceed with normal SDK initialization
   - Do NOT block app usage on denial — tracking must be optional

6. **Configure `ITSAppUsesNonExemptEncryption`** if not already set:
   ```xml
   <!-- ios/App/App/Info.plist -->
   <key>ITSAppUsesNonExemptEncryption</key>
   <false/>
   ```

### Important Notes
- ATT prompt can only be shown ONCE per install — make it count
- Show the prompt at a meaningful moment (not immediately on cold start)
- Pre-prompt screen explaining why tracking helps is recommended (but optional)

---

## Phase 8: Additional Native Features (Optional)

| Feature | Package | Effect | Recommendation |
|---------|---------|--------|----------------|
| Status bar control | @capacitor/status-bar | Enhanced native feel | ⭐⭐⭐ |
| Network detection | @capacitor/network | Offline handling | ⭐⭐⭐ |
| Keyboard control | @capacitor/keyboard | Improved input UX | ⭐⭐⭐ |
| App update detection | @capawesome/capacitor-app-update | Forced updates | ⭐⭐ |
| Screen orientation lock | @capacitor/screen-orientation | UX improvement | ⭐⭐ |
| In-app browser | @capacitor/browser | External link handling | ⭐⭐ |
| Haptic feedback | @capacitor/haptics | Interaction quality | ⭐ |

---

## Deliverables

```
frontend/
├── capacitor.config.ts          # Capacitor configuration
├── android/                     # Android native project
│   ├── app/src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── res/                 # Icons, splash screen
│   │   └── java/...
│   └── build.gradle
├── ios/                         # iOS native project
│   ├── App/
│   │   ├── App/
│   │   │   ├── Info.plist
│   │   │   └── AppDelegate.swift
│   │   └── App.xcodeproj
│   └── Podfile
└── app/
    └── services/
        ├── nativePushService.ts  # Native push (platform branching)
        ├── biometricService.ts   # Biometric authentication
        ├── deeplinkService.ts    # Deep link handler
        ├── appleLoginService.ts  # Sign in with Apple (if social login exists)
        └── trackingService.ts    # ATT prompt (if tracking SDKs exist)
```

### Verification Methods
1. `npx cap sync` → completes without errors
2. Open `android/` project in Android Studio → run on emulator
3. Open `ios/` project in Xcode → run on simulator (Mac required)
4. Native push: test notification reception while app is in background
5. Biometric auth: simulate fingerprint/Face ID on emulator
6. Sign in with Apple: test on iOS device/simulator (requires Apple Developer account)
7. Account deletion: create test account → delete → verify data cleanup and token invalidation
8. ATT: verify prompt appears on iOS before analytics initialization
