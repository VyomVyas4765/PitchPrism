# Dev 1 · Entrepreneur and Field Facilitator

**PRD roles:** Entrepreneur; field facilitator (assisted mode).

**Mission:** Own every entrepreneur and assisted-intake workflow from its screen through validation, scoped persistence, AI integration and tests.

**Owned modules:** `app/`; entrepreneur/facilitator features in `backend/src/modules/entrepreneur/`; PWA intake in `frontend/features/entrepreneur/`; `ai/ingest/`.

## Check before adding logic

Other AI agents may be working on their assigned roles concurrently. **Before adding logic**, read the duty index and other owners’ In progress notes; inspect `git status` and relevant diffs; search for existing/partial implementations, models, endpoints and contracts. Reuse shared logic, coordinate overlapping/shared edits with their owner, and preserve others’ changes. Record your active task and touched modules below before starting.

## Foundation already available

Mobile session restoration, secure token storage, facilitator password login and Firebase phone exchange are implemented. Real phone sign-in still needs Firebase configuration and device verification.

These are starter capabilities, not completion of the full requirements below. Login secrets belong in the ignored `.env`; all seeded users are synthetic. Never add a role selector that grants access or a fake OTP bypass.

## Order of work

- Build language selection and spoken consent, then profile and Speak / Type / Upload intake.
- Add durable offline recordings, resumable uploads, transcript correction, follow-ups, plan confirmation and status updates.
- Complete feedback, improvement/resubmission, Idea Passport grant/revoke/contact responses, schemes and assisted multi-applicant sync.
- Implement shared ingestion A-01–A-12 once: originals, audio/PDF/OCR, overwrites, Q&A pairing, PII redaction, per-answer translation and evidence-linked extraction. Publish fixtures for Dev 2.
- Coordinate Firebase/auth changes with Dev 3; consume Dev 2's scoring/plan/feedback outputs instead of rebuilding them. Own local provider plumbing and the question bank; hosted Sarvam defaults are superseded by D-24. Review model-adapter interfaces with Dev 2.

PRD priorities and full requirement descriptions remain authoritative. Complete P0 first; do not silently remove lower-priority requirements. See [the duty index](README.md) for shared ownership and cross-role consumers.

## Revised local AI constraints · D-24

Preserve every assigned requirement. Heavy AI remains on the worker; the Android app uses system speech/TTS only after per-device locale/offline checks and does not bundle the main LLM. Use the shared local-only provider policy/registry and adapter; never introduce hosted API fallback, automatic model downloads or a duplicate AI path. Missing capabilities stay pending/failed explicitly. Validate licence, size, peak RAM, latency, six-language/format parity and organiser-data accuracy before adopting a model. AI API spending must be zero; identity, messages, hardware, storage and hosting remain separately costed.

Track implementation, execution, dependency, acceptance and status in [requirements.json](requirements.json), rendered as [the full matrix](../implementation-matrix.md). The current JSON adapter and tiny synthetic test establish plumbing only, not completed AI requirements. Coordinate existing agent work and shared ownership before adding stages. See [local runtime setup](../../ai/README.md).

## Primary requirement checklist

Descriptions and acceptance details: [PRD](../../PitchPrism.md). Each ID has exactly one primary owner in [requirements.json](requirements.json); support dependencies do not change primary ownership.

- [ ] **M-01** · Onboarding · P0
- [ ] **M-02** · Onboarding · P0
- [ ] **M-03** · Onboarding · P0
- [ ] **M-04** · Onboarding · P0
- [ ] **M-05** · Pitching · P0
- [ ] **M-06** · Pitching · P0
- [ ] **M-07** · Pitching · P1
- [ ] **M-08** · Pitching · P0
- [ ] **M-09** · Pitching · P0
- [ ] **M-10** · Pitching · P0
- [ ] **M-11** · Pitching · P0
- [ ] **M-12** · Status · P0
- [ ] **M-13** · Feedback · P0
- [ ] **M-14** · Feedback · P1
- [ ] **M-15** · Idea Passport · P0
- [ ] **M-16** · Notifications · P1
- [ ] **M-17** · Assisted mode · P0
- [ ] **M-18** · Assisted mode · P0
- [ ] **M-19** · App-wide · P0
- [ ] **M-20** · Web intake · P1
- [ ] **M-21** · WhatsApp · P2
- [ ] **M-22** · Resubmission · P1
- [ ] **M-23** · Schemes · P1
- [ ] **A-01** · Ingest · P0
- [ ] **A-02** · Classify · P0
- [ ] **A-03** · Audio · P0
- [ ] **A-04** · Transcribe · P0
- [ ] **A-05** · Digital PDF · P0
- [ ] **A-06** · Quality gate · P0
- [ ] **A-07** · Scans and handwriting · P0
- [ ] **A-08** · Overwrites · P0
- [ ] **A-09** · Structure · P0
- [ ] **A-10** · PII · P0
- [ ] **A-11** · Language · P0
- [ ] **A-12** · Extract · P0

## Acceptance and handoff

Verify entrepreneur-only records, facilitator-only submissions, expired sessions, offline resume, per-applicant separation on shared devices, explicit processing consent, optional partner consent and immediate revocation. Never send PII to model/map services.

A feature is done when UI, API, persistence, permissions, loading/error states, required integrations and relevant tests work together. Publish synthetic fixtures early, document contracts, add a Done entry and notify consuming role owners. No raw organiser PII in code, prompts, fixtures, screenshots or logs.

## In progress



2026-10-17 · Branch `arnav` · Team direction (Arnav): email-only sign-in for every role (phone OTP/Firebase removed; entrepreneurs self-register with email and password, staff by invitation) and an iOS-only build target for now (Android ignored, not deleted); iOS text-to-speech; IndicTrans2 install after the account owner signs in; first organiser-data run. Touches shared auth (`backend/src/app.ts`, `config.ts`, `models.ts`, `auth/firebase.ts` removed, `backend/package.json`), `app/`, docs and a new decision entry.

2026-10-17 · Branch `arnav` · Everything below needs an input this branch cannot supply (team chose "Dev 1 only" for cross-owner pieces):
- **Device validation** (M-01, M-03, M-05–M-08, M-11, M-17–M-19 are `device_pending`): the Android build fails on this campus network (Gradle download times out); iOS needs the Mac. APK size and 2 GB RAM measurements need a build.
- **Approved translation** (A-11, and every non-English pitch): IndicTrans2 is gated on Hugging Face (accept terms with a team account), then review and pin its model code; Opus-MT failed the Hindi/Marathi smoke test.
- **Odia speech** (A-04): no local speech model covers Odia; Odia recordings stay pending.
- **Organiser-data evaluation** (A-02–A-12): the 55 files are not on this host; run `python -m ai.ingest.sidecars` and Dev 2's harness where they are.
- **Dev 2 outputs in the app** (M-09 follow-ups, M-10 plan read-back, M-13 feedback, M-14 improve/resubmit, M-22 what improved, M-23 schemes): need Dev 2's stored outputs exposed to the entrepreneur.
- **Dev 3**: the durable job queue (submitted pitches run through a background bridge meanwhile), `Org.parentOrgId` for implementation-partner facilitators, a web cookie session for phone OTP (M-20 PWA intake).
- **Dev 4**: partner contact requests (M-15 accept/decline).
- **Credentials and costs**: Firebase (M-02 OTP, M-12 push), SMS (M-16), WhatsApp (M-21).
- **Language review**: every non-English string and prompt is an unreviewed draft (Q-05).
- M-04 voice entry for the profile is not built yet.

**Shared edits on `arnav` awaiting owner review:** Dev 3: `ai/requirements.txt` pins (new `ai/requirements-models.txt` for model runtimes); router mount in `backend/src/app.ts`; `PII_ENCRYPTION_KEY` in `backend/src/config.ts`, `.env.example`, `scripts/setup-env.mjs` (existing `.env` files need the key added by hand); status legend in `scripts/generate-matrix.mjs`; additive `audio` source (`chunkId`/`start`/`end`) in `packages/contracts/schemas/centre-extracted-input.json` with regenerated types. Dev 2: prompt PII guard in `ai/llm/adapter.py`; scorer now uses the shared `ai/ingest/pii.find_pii`; CLI writes UTF-8 (Windows fix); runner finds the Windows venv; centre validator accepts audio segments. Rayyan: restored his Release `Info.plist`/`Release.xcconfig` lost in the merge.

## Done

- 2026-10-18 · iPhone screenshot fixes: constrained State/Gender and pitch centre dropdown text to prevent the yellow-black RenderFlex overflow; onboarding mobile entry now accepts only ten digits with an Indian mobile prefix check, including paste/overlength handling. Added a localized keyboard-dismiss bar above the iOS keyboard, drag-to-dismiss and outside-tap dismissal on onboarding and typed pitch fields. Added widget cases for narrow screens, input limit/validation and keyboard focus; the backend rejects a 20-digit mobile number (17 entrepreneur tests pass). Matrix/duties and `git diff --check` pass. Flutter analysis, widget tests and a rebuilt iPhone tap-through remain pending because Flutter/Xcode are unavailable on this Windows host. Screenshot 1 shows the older build with the already removed Business Idea section; reinstall the current app to verify both changes.

- 2026-10-18 · Removed Business Idea and its eleven fields from one-time iOS onboarding after language and consent; About and Location remain, with work background phrased as personal experience in all six draft locales. The owner-scoped API now validates and seals only contact, background and location details; onboarding completion no longer depends on trade, while existing legacy profile completion remains valid. Updated the offline demo, focused widget/API tests, M-04 matrix and endpoint docs. Backend typecheck and all 152 tests pass; matrix and duties checks pass. Flutter analysis/widget and iPhone checks need the Mac. **Dev 3 handoff:** update the shared Entrepreneur schema's `onboarding` description, which still mentions EDP answers; no schema structure was changed here. Business details remain in the later pitch flow.

- 2026-10-18 · Added an **Explore offline demo** entry on the mobile login page and `pnpm ios --offline-demo` to install a standalone Profile build without a backend address. It reuses the entrepreneur consent, synthetic prefilled onboarding, home, pitch, status and Passport screens through an in-memory `ApiClient` with no session token or network forwarding. The demo has its own memory outbox and temporary file directory; leaving deletes that directory. An in-flight real session restore cannot replace the demo. Added widget tests for the full demo path, pitch editor and pending-session case; `git diff --check`, script syntax and duties check pass. Flutter tooling is unavailable on this Windows host, so `flutter analyze`, widget tests and iPhone tap-through remain required on the Mac. This is a demo of the UI only, not a PRD completion claim.

- 2026-10-18 · iPhone Home Screen relaunch: `pnpm ios` now selects Profile by default and requires a reachable HTTPS API, with `--mode release` available; `--mode debug` preserves local HTTP and Flutter hot reload. The script refuses HTTP in Profile/Release, so the standard plist retains its transport policy. README now explains why an installed Debug build shows the iOS 14+ black launch screen when opened outside Flutter/Xcode. `node --check` and `git diff --check` pass; on-device installation/relaunch still needs the Mac and paired iPhone.

- 2026-10-18 · Post-pull integrity/iOS preflight: removed duplicated legacy Mongoose registrations and stale Firebase verifier/dependency; restored the onboarding fields in the shared Entrepreneur contract and separated private pitch readings from the shared Submission transcript model. Scoped onboarding/transcript reads under enforced tenancy and repaired the lockfile. The obsolete `access.test.ts` targeted retired `/orgs`, `/invites` and `/users` routes; current `/hq` and `/team` access coverage is in `hq.test.ts`. Backend: 152 tests and typecheck pass; Python: 112 tests pass against local MongoDB; web typecheck, contract fixture validation, frozen pnpm install, local `db:check`, plist parsing, matrix generation and duties check pass. Created an ignored local `.env` with random secrets and local AI flags. Native iOS analysis/build still needs a Mac with Flutter/Xcode and a paired iPhone. **Dev 3 handoff:** review the shared model/contract/manifest integration, any migration of old `transcripts` pitch rows to `pitchReadings`, the incompatible Dev 1 `PitchDocument` and shared `Document` schemas currently using one `documents` collection, and the conflicting D-34 hosted default versus AGENTS.md's local-only policy. **Dev 2/AI handoff:** queued worker consumes English text pitches only, skips translation, and does not consume sealed onboarding answers or Dev 1's `PitchReading`; non-English now fails visibly at translation. Full onboarding → translated answers → evaluation is not yet connected or validated. The app iOS README lists the smoke path and setup.

- 2026-10-18 · One-time entrepreneur onboarding tap form after language, email sign-in and processing consent. Captures applicant contact, optional gender/credit score, education/work background, location, interested business and all ten scenario questions; six draft locale sets and section audio prompts. Owner-scoped `POST /me/onboarding` seals contact/background/answers and rejects repeats; existing pitch submission and shared contracts untouched. Backend typecheck and 109 tests pass; matrix and duties checks pass. Flutter tooling is unavailable on this Windows host, so widget/iPhone verification and qualified translation review remain pending. `db:check` stopped at missing `JWT_SECRET`, before DNS/port diagnosis. M-04 remains `client_partial` because voice entry and device acceptance are pending. Dev 2 must agree any later scoring use and Dev 3 any shared contract.

- 2026-10-17 · First milestone foundation: Mobile session restoration, secure token storage, facilitator password login and Firebase phone exchange are implemented. Real phone sign-in still needs Firebase configuration and device verification.

- 2026-10-17 · D-24 foundation: local-only settings, task-provider interfaces, installed-model JSON/vision adapter, spending/proxy/redirect guards, capability registry and ten policy/output tests. Synthetic local JSON smoke passed; six-language/OCR/model quality remain unevaluated.

- 2026-10-17 · Onboarding API (server side only; M-01/M-03/M-04/M-15 are `api_partial`, not complete): `GET/PUT /me` (language before consent; name/gender sealed with AES-256-GCM; profile needs processing consent), `POST /consents` and `/consents/:id/revoke` (per purpose, notice version/language/method recorded, idempotent, append-only; revocation closes matching partner shares immediately), `GET /me/passport`, and `sharingAllowed()` for routing owners. 15 Mongo-backed access/behavior tests. Pending: Flutter screens and spoken notice, contact accept/decline (W-17 state), assisted consent evidence, device checks. Contract: [module README](../../backend/src/modules/entrepreneur/README.md).

- 2026-10-17 · Deterministic ingestion helpers (A-02/A-03/A-10 are `worker_partial`, not complete): ffmpeg 16 kHz mono normalisation, `silencedetect` pause baseline packing speech into ≤ 29.5 s chunks with original-time anchors, `too_short`/`near_silent`/`clipped` rejection; content-signature format detection with ffprobe stream checks; phone/email/ID/known-name redaction including Indic digits, and a prompt guard in the shared adapter that blocks unredacted contacts before any runtime call. 18 new worker tests on synthetic audio/text (plus 5 for fixtures and the question bank; 33 worker tests in total). Thresholds are untuned; no organiser-data evaluation yet. See [ingest README](../../ai/ingest/README.md).
- 2026-10-17 · For Dev 2: three synthetic [extracted-input fixtures](../../packages/contracts/fixtures/extracted-input/README.md) in Dev 2's shared `CentreExtractedInput` contract (the earlier separate draft contract was retired to keep one Dev 1 → Dev 2 contract), validated against the schema and Dev 2's scorer. Draft question bank and guided prompt cards in `data/seed/question-bank.json` (non-English prompts unreviewed, Q-05). Read-only own-submission lists for entrepreneurs and facilitators (`GET /me/submissions`, `GET /assisted/submissions`) with isolation tests; 16 entrepreneur-module tests in total. Intake [proposal](dev-1-intake-proposal.md) written for Dev 3; not yet reviewed.
- 2026-10-17 · iOS project merge fix: Rayyan's D-26 iOS setup (Debug-only local HTTP via `Info-Debug.plist`, Release `Info.plist` without exceptions) is the kept design; my duplicate README section and Release plist exception were removed after the merge reintroduced them. `flutter analyze` clean.
- 2026-10-17 · Cross-team fixes after the merge: regenerated the out-of-sync matrix (duplicated rows); Dev 2's scorer CLI failed on Windows for any ₹ or Indic text (stdout code page) and its runner only found the POSIX venv; scorer PII check replaced by the shared stronger detector; one shared extraction contract with audio sources. 46 worker tests pass.
- 2026-10-17 · Mobile onboarding (M-01/M-03 `device_pending`, M-04/M-12/M-15 `client_partial`): language picker first with per-device voice checks and explicit "not available" text; consent read aloud with required processing and optional sharing; profile with server-equivalent validation; home, Idea Passport (grant/revoke on the server) and ideas status list; expired sessions return to sign-in; six-language strings (non-English unreviewed). Fixed a `LoadView` reload bug (setState returning a Future).
- 2026-10-17 · Intake and assisted mode (M-05/M-06 `client_partial`; M-11/M-17/M-18 `device_pending`; A-01 `api_partial`): API for drafts, typed answers, resumable offset-checked uploads with sha256-verified immutable GridFS originals, one-time submit creating a centre-owned Submission (`pipeline: pending_queue`, no fake processing), facilitator applicant registration with sealed names, spoken-consent evidence and checkbox-gated consent. App: Speak/Type/Upload editor, two-minute guided recordings with pause/re-record, durable per-account outbox that resumes uploads after crashes, "Waiting to send" with per-item status, facilitator new-applicant flow. 8 new API tests (101 backend tests in total), 16 Flutter tests, `flutter analyze` clean. Microphone permissions declared for Android and iOS.
- 2026-10-17 · Local reading pipeline (A-02–A-12 `worker_partial`; nothing approved without organiser data): permissive PDF reading by geometry with strike-through and ink detection, Indic text-layer gate with region OCR, Tesseract OCR for scans/photos with per-line confidence and unreadable regions, faster-whisper transcription (Odia explicitly unsupported), per-answer language ID, question pairing with missing vs not-asked, guided/free-talk fields counted only when mentioned, header PII → tokens and blur boxes, cited `CentreExtractedInput` accepted by Dev 2's checks, sidecar writer for A-30. Translation has no approved model (Opus-MT rejected after a smoke test; IndicTrans2 gated). Model smoke evidence in `docs/benchmarks/dev1-local-models-2026-10-17.json`.
- 2026-10-17 · Processing and transcript review (M-07/M-08 `device_pending`): background local processing after submit with explicit states and owner retry, versioned transcripts (version 1 immutable, stale edits 409), owner-only original playback, free-talk mode (5 minutes), transcript screen with per-segment audio clips and tap-to-correct, optional state on the profile, accessibility guideline tests. 10 intake API tests, 59 worker tests, 20 Flutter tests.
