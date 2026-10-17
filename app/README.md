# Mobile starter · Dev 1

Flutter Android and iOS development entry point for entrepreneur phone sign-in and facilitator password sign-in. API sessions use `flutter_secure_storage`. Actual pitching, offline intake, language selection and processing/sharing consent workflows remain in the duty brief. When Firebase settings are absent, the app opens facilitator password sign-in; entrepreneur OTP is unavailable until configured. No fake OTP or auth bypass is added.

```bash
cd app
flutter pub get
flutter run
```

Default API: `http://10.0.2.2:4000/api/v1` for the Android emulator. For a physical device, pass `--dart-define=API_BASE_URL=http://YOUR_LAN_IP:4000/api/v1`. Use HTTPS for release environments; cleartext traffic is enabled only in the debug manifest. Release signing is a deployment duty; the generated Android project still uses a debug signing configuration.

## Firebase phone setup

Register Android package `in.pitchprism.pitchprism_app`, register the signing SHA-1/SHA-256 fingerprints, and enable Firebase's Phone provider. In the repository root create ignored `local/mobile-config.json` with your Firebase Android settings:

```json
{
  "FIREBASE_PROJECT_ID": "your-project-id",
  "FIREBASE_API_KEY": "your-android-api-key",
  "FIREBASE_APP_ID": "your-android-app-id",
  "FIREBASE_MESSAGING_SENDER_ID": "your-sender-id"
}
```

From `app/`, run `flutter run --dart-define-from-file=../local/mobile-config.json`. The app initializes Firebase explicitly from those options. The backend needs the same project ID and Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS` points to a private service-account file). No SMS can be sent until the project is configured. Use Firebase's configured test phone numbers for development; there is no hard-coded OTP or authentication bypass.

See [Firebase Flutter phone authentication](https://firebase.google.com/docs/auth/flutter/phone-auth) and [backend token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens). Device/SMS validation requires the team's Firebase configuration and is not covered by backend adapter tests.


## iOS development build

Start `pnpm dev:local` from the repository root. In a second terminal run `pnpm ios`: it finds the single paired physical iPhone, uses the Mac's Wi-Fi address for the API and keeps Git downloads on HTTPS for that build. With multiple devices or a deployed API, use `pnpm ios --device YOUR_IPHONE_ID --api-url https://YOUR_API_HOST/api/v1`. The equivalent command from `app/` is:

```bash
GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 flutter run --debug -d YOUR_IPHONE_ID --dart-define=API_BASE_URL=http://YOUR_MAC_LAN_IP:4000/api/v1
```

The temporary Git environment prevents a global HTTPS→SSH rewrite from hanging public Swift-package downloads on networks that block SSH. It does not change global Git configuration. On macOS, `ipconfig getifaddr en0` usually gives the Wi-Fi address. The Xcode project uses automatic development signing; select your own team if building on another machine. The current iOS bundle ID is `in.pitchprism.pitchprismApp`. iOS 15+ is the native dependency baseline; Android 8+/2 GB remains the main product performance target.

The phone must already be paired/trusted with Developer Mode enabled. Keep it unlocked during install and allow the app's local-network prompt. Wireless Xcode deployment and API connectivity are separate: the phone must reach the Mac's LAN address on port 4000. If campus Wi-Fi isolates clients, use a permitted shared network. For a phone on a different internet connection, use an explicitly deployed HTTPS API and pass its URL; this setup does not publish the development server publicly.

Local HTTP and Bonjour access are allowed only in the Debug Info plist; Release/Profile use the standard plist without arbitrary HTTP exceptions. Session tokens use iOS Keychain with the configured entitlement. Firebase remains lazy/unconfigured until you add the matching iOS Firebase project/options, APNs/reCAPTCHA configuration and backend service credentials. Staff/facilitator password login works independently.

See [Flutter iOS device setup](https://docs.flutter.dev/platform-integration/ios/setup) and [secure storage setup](https://pub.dev/packages/flutter_secure_storage).
