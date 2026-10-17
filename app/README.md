# PitchPrism iPhone app · Dev 1

Flutter app for entrepreneurs and field facilitators. **iOS is the build target for now (D-27); the Android project is kept but not built or tested.** Everyone signs in with email and password: entrepreneurs tap "Create account" (always as an entrepreneur), facilitators use the account their organisation invited them to create. There is no phone number, OTP or SMS sign-in. Sessions use the iOS Keychain through `flutter_secure_storage`.

What the app does: language picker with spoken prompts, consent read aloud, profile, Speak (guided questions or free talk) / Type / Upload with an offline outbox and resumable uploads, transcript review with playback and corrections, Idea Passport, idea status, and assisted mode for facilitators. See [the Dev 1 brief](../docs/duties/dev-1-entrepreneur-facilitator.md) for what is still pending.

## Spoken prompts on iPhone

Prompts use the iPhone's own voices (`AVSpeechSynthesizer` via `flutter_tts`); no voice model is bundled or downloaded. The app picks an installed voice for the exact language (for example `hi-IN`), preferring enhanced/premium quality, and speaks with the playback audio category so prompts are heard with the silent switch on and after a recording. A language with no installed voice is labelled "not available" with a hint: add voices under Settings → Accessibility → Spoken Content → Voices, then reopen the app. Which Indian languages have voices depends on the iOS version and has to be checked on the device; Hindi and Indian English are usually present, Marathi, Telugu, Odia and Bengali may not be.

Microphone use needs the permission prompt (`NSMicrophoneUsageDescription` is set in both plists).

## iOS development build

Start `pnpm dev:local` from the repository root. In a second terminal run `pnpm ios`: it finds the single paired physical iPhone, uses the Mac's Wi-Fi address for the API and keeps Git downloads on HTTPS for that build. With multiple devices or a deployed API, use `pnpm ios --device YOUR_IPHONE_ID --api-url https://YOUR_API_HOST/api/v1`. The equivalent command from `app/` is:

```bash
GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 flutter run --debug -d YOUR_IPHONE_ID --dart-define=API_BASE_URL=http://YOUR_MAC_LAN_IP:4000/api/v1
```

The temporary Git environment prevents a global HTTPS→SSH rewrite from hanging public Swift-package downloads on networks that block SSH. It does not change global Git configuration. On macOS, `ipconfig getifaddr en0` usually gives the Wi-Fi address. The Xcode project uses automatic development signing; select your own team if building on another machine. The current iOS bundle ID is `in.pitchprism.pitchprismApp`. iOS 15+ is the native dependency baseline.

The phone must already be paired/trusted with Developer Mode enabled. Keep it unlocked during install and allow the app's local-network prompt. Wireless Xcode deployment and API connectivity are separate: the phone must reach the Mac's LAN address on port 4000. If campus Wi-Fi isolates clients, use a permitted shared network. For a phone on a different internet connection, use an explicitly deployed HTTPS API and pass its URL; this setup does not publish the development server publicly.

Local HTTP and Bonjour access are allowed only in the Debug Info plist; Release/Profile use the standard plist without arbitrary HTTP exceptions. Session tokens use iOS Keychain with the configured entitlement. Sign-in is email and password for every role; no Firebase or SMS configuration is needed. Personal (free) Apple ID signing expires after 7 days; reinstall to refresh. A shareable `.ipa` (TestFlight/ad hoc) needs a paid Apple Developer Program membership.

See [Flutter iOS device setup](https://docs.flutter.dev/platform-integration/ios/setup) and [secure storage setup](https://pub.dev/packages/flutter_secure_storage).
