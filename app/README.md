# PitchPrism iPhone app · Dev 1

Flutter app for entrepreneurs and field facilitators. **iOS is the build target for now (D-27); the Android project is kept but not built or tested.** Everyone signs in with email and password: entrepreneurs tap "Create account" (always as an entrepreneur), facilitators use the account their organisation invited them to create. There is no phone number, OTP or SMS sign-in. Sessions use the iOS Keychain through `flutter_secure_storage`.

The login page also has **Explore offline demo** for a device without access to the local API. Install a standalone iPhone demo with `pnpm ios --offline-demo`; no IP address or backend is required. It opens the entrepreneur consent, prefilled synthetic onboarding and home screens without creating an account or token. The demo API adapter stays entirely on the device; sample pitches and sharing switches are simulated, and any demo answers/files are cleared when leaving the tour. It cannot read or submit real account data. Use sample details only.

What the app does: language picker with spoken prompts, consent read aloud, one-time About and Location onboarding (contact, education/work background, optional credit score and location), then Speak (guided questions or free talk) / Type / Upload for business ideas with an offline outbox and resumable uploads, transcript review with playback and corrections, Idea Passport, idea status, and assisted mode for facilitators. See [the Dev 1 brief](../docs/duties/dev-1-entrepreneur-facilitator.md) for what is still pending.

## Spoken prompts on iPhone

Prompts use the iPhone's own voices (`AVSpeechSynthesizer` via `flutter_tts`); no voice model is bundled or downloaded. The app picks an installed voice for the exact language (for example `hi-IN`), preferring enhanced/premium quality, and speaks with the playback audio category so prompts are heard with the silent switch on and after a recording. A language with no installed voice is labelled "not available" with a hint: add voices under Settings → Accessibility → Spoken Content → Voices, then reopen the app. Which Indian languages have voices depends on the iOS version and has to be checked on the device; Hindi and Indian English are usually present, Marathi, Telugu, Odia and Bengali may not be.

Microphone use needs the permission prompt (`NSMicrophoneUsageDescription` is set in both plists).

## iOS development build

On the Mac, install Node 22, pnpm, Flutter with Dart 3.13.1 or newer, Xcode and its command-line tools. From the repository root run `pnpm install --frozen-lockfile`, `pnpm setup:env` and `flutter doctor -v`. Keep `AI_RUNTIME=local` and `AI_HOSTED_APIS_ENABLED=false` in the private root `.env`; select only an installed local model after validation. From `app/`, run `flutter pub get`, `flutter analyze` and `flutter test` before the device build.

### Reopen the app from the iPhone Home Screen

The normal device build is now **Profile**. For an offline tour, run `pnpm ios --offline-demo` from the repository root (add `--device YOUR_IPHONE_ID` when more than one device is connected). This installs a build whose real sign-in is intentionally unavailable; tap **Explore offline demo** on its login page. To use real accounts, install with `pnpm ios --api-url https://YOUR_API_HOST/api/v1`. Either Profile build replaces the Debug build under the same bundle ID. After it installs, stop Flutter, close the app and tap its Home Screen icon to verify relaunch. Real Profile and Release sessions require an API that the phone can reach over HTTPS with a trusted certificate; the local HTTP development server cannot be used in these modes. To install a Release build instead, add `--mode release`. Rebuild after code changes because hot reload is available only in Debug.

### Local debugging

Start `pnpm dev:local` from the repository root. In a second terminal run `pnpm ios --mode debug`: it finds the single paired physical iPhone, uses the Mac's Wi-Fi address for the API and keeps Git downloads on HTTPS for that build. The equivalent command from `app/` is:

```bash
GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 flutter run --debug -d YOUR_IPHONE_ID --dart-define=API_BASE_URL=http://YOUR_MAC_LAN_IP:4000/api/v1
```

On iOS 14+, a Debug build must be launched by Flutter tooling, an IDE with the Flutter plugin, or Xcode. Opening it from the Home Screen after the tool disconnects shows the black message in the screenshot. Use the Profile build above for normal reopen testing.

The temporary Git environment prevents a global HTTPS→SSH rewrite from hanging public Swift-package downloads on networks that block SSH. It does not change global Git configuration. On macOS, `ipconfig getifaddr en0` usually gives the Wi-Fi address. The Xcode project uses automatic development signing; select your own team if building on another machine. The current iOS bundle ID is `in.pitchprism.pitchprismApp`. iOS 15+ is the native dependency baseline.

The phone must already be paired/trusted with Developer Mode enabled. Keep it unlocked during install and allow the app's local-network prompt. Wireless Xcode deployment and API connectivity are separate: the phone must reach the Mac's LAN address on port 4000. If campus Wi-Fi isolates clients, use a permitted shared network. For a phone on a different internet connection, use an explicitly deployed HTTPS API and pass its URL; this setup does not publish the development server publicly.

Local HTTP and Bonjour access are allowed only in the Debug Info plist; Release/Profile use the standard plist without arbitrary HTTP exceptions. Session tokens use iOS Keychain with the configured entitlement. Sign-in is email and password for every role; no Firebase or SMS configuration is needed. Personal (free) Apple ID signing expires after 7 days; reinstall to refresh. A shareable `.ipa` (TestFlight/ad hoc) needs a paid Apple Developer Program membership.

For the first device smoke test, verify language choice, entrepreneur registration/sign-in, processing consent, the one-time onboarding form, sign-out/sign-in persistence, and a typed English pitch through submission and transcript review. The queued evaluation worker currently reads text pitches only and has no approved non-English translation path; audio/PDF/photo evaluation and onboarding-answer use in scoring still need integration. An absent local model must show a pending/failed capability instead of a score. The iPhone must reach the configured API; the Python worker must be running separately for queue processing.

See [Flutter iOS device setup](https://docs.flutter.dev/platform-integration/ios/setup) and [secure storage setup](https://pub.dev/packages/flutter_secure_storage).
