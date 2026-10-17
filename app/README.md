# Mobile starter · Dev 1

Flutter Android entry point for entrepreneur phone sign-in and facilitator password sign-in. API sessions use `flutter_secure_storage`. Actual pitching, offline intake, language selection and processing/sharing consent workflows remain in the duty brief.

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
