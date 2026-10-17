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

2026-10-17 · Branch `arnav` · Remaining Dev 1 work, each blocked on an input outside this branch:
- Device validation of the new screens (M-01, M-03, M-11, M-17, M-18 are `device_pending`): Android APK build blocked on this campus network (Gradle wrapper download times out); iOS build needs the Mac. System-TTS voice availability per locale is only exercised through a fake in tests.
- M-04 voice entry, M-06 audio playback, M-07 free-talk screen, M-08–M-10, M-13, M-14, M-22, M-23: need a validated local STT/translation/TTS path (none selected) and Dev 2's follow-up, plan and feedback outputs delivered to the app.
- M-12 push, M-16 SMS, M-21 WhatsApp: Firebase messaging / costed messaging configuration.
- M-15 contact accept/decline: the share contact-request state is Dev 4's W-17 workflow (not mounted yet).
- Implementation-partner facilitators cannot submit: needs `Org.parentOrgId` (shared model, Dev 3). Pipeline processing after submit waits for the D-26 MongoDB job queue (Dev 3); pitches record `pipeline: pending_queue`.
- A-04–A-09, A-11, A-12: no local STT/OCR/translation model selected or evaluated; PDF-library licence decision (PyMuPDF AGPL-3.0 vs permissive pdfplumber/pypdfium2).
- All non-English app text and prompts are unreviewed drafts (Q-05).

**Shared edits on `arnav` awaiting owner review:** Dev 3: router mount in `backend/src/app.ts`; `PII_ENCRYPTION_KEY` in `backend/src/config.ts`, `.env.example`, `scripts/setup-env.mjs` (existing `.env` files need the key added by hand); status legend in `scripts/generate-matrix.mjs`; additive `audio` source (`chunkId`/`start`/`end`) in `packages/contracts/schemas/centre-extracted-input.json` with regenerated types. Dev 2: prompt PII guard in `ai/llm/adapter.py`; scorer now uses the shared `ai/ingest/pii.find_pii`; CLI writes UTF-8 (Windows fix); runner finds the Windows venv; centre validator accepts audio segments. Rayyan: restored his Release `Info.plist`/`Release.xcconfig` lost in the merge.

## Done

- 2026-10-17 · First milestone foundation: Mobile session restoration, secure token storage, facilitator password login and Firebase phone exchange are implemented. Real phone sign-in still needs Firebase configuration and device verification.

- 2026-10-17 · D-24 foundation: local-only settings, task-provider interfaces, installed-model JSON/vision adapter, spending/proxy/redirect guards, capability registry and ten policy/output tests. Synthetic local JSON smoke passed; six-language/OCR/model quality remain unevaluated.

- 2026-10-17 · Onboarding API (server side only; M-01/M-03/M-04/M-15 are `api_partial`, not complete): `GET/PUT /me` (language before consent; name/gender sealed with AES-256-GCM; profile needs processing consent), `POST /consents` and `/consents/:id/revoke` (per purpose, notice version/language/method recorded, idempotent, append-only; revocation closes matching partner shares immediately), `GET /me/passport`, and `sharingAllowed()` for routing owners. 15 Mongo-backed access/behavior tests. Pending: Flutter screens and spoken notice, contact accept/decline (W-17 state), assisted consent evidence, device checks. Contract: [module README](../../backend/src/modules/entrepreneur/README.md).

- 2026-10-17 · Deterministic ingestion helpers (A-02/A-03/A-10 are `worker_partial`, not complete): ffmpeg 16 kHz mono normalisation, `silencedetect` pause baseline packing speech into ≤ 29.5 s chunks with original-time anchors, `too_short`/`near_silent`/`clipped` rejection; content-signature format detection with ffprobe stream checks; phone/email/ID/known-name redaction including Indic digits, and a prompt guard in the shared adapter that blocks unredacted contacts before any runtime call. 18 new worker tests on synthetic audio/text (plus 5 for fixtures and the question bank; 33 worker tests in total). Thresholds are untuned; no organiser-data evaluation yet. See [ingest README](../../ai/ingest/README.md).
- 2026-10-17 · For Dev 2: three synthetic [extracted-input fixtures](../../packages/contracts/fixtures/extracted-input/README.md) in Dev 2's shared `CentreExtractedInput` contract (the earlier separate draft contract was retired to keep one Dev 1 → Dev 2 contract), validated against the schema and Dev 2's scorer. Draft question bank and guided prompt cards in `data/seed/question-bank.json` (non-English prompts unreviewed, Q-05). Read-only own-submission lists for entrepreneurs and facilitators (`GET /me/submissions`, `GET /assisted/submissions`) with isolation tests; 16 entrepreneur-module tests in total. Intake [proposal](dev-1-intake-proposal.md) written for Dev 3; not yet reviewed.
- 2026-10-17 · iOS project merge fix: Rayyan's D-26 iOS setup (Debug-only local HTTP via `Info-Debug.plist`, Release `Info.plist` without exceptions) is the kept design; my duplicate README section and Release plist exception were removed after the merge reintroduced them. `flutter analyze` clean.
- 2026-10-17 · Cross-team fixes after the merge: regenerated the out-of-sync matrix (duplicated rows); Dev 2's scorer CLI failed on Windows for any ₹ or Indic text (stdout code page) and its runner only found the POSIX venv; scorer PII check replaced by the shared stronger detector; one shared extraction contract with audio sources. 46 worker tests pass.
- 2026-10-17 · Mobile onboarding (M-01/M-03 `device_pending`, M-04/M-12/M-15 `client_partial`): language picker first with per-device voice checks and explicit "not available" text; consent read aloud with required processing and optional sharing; profile with server-equivalent validation; home, Idea Passport (grant/revoke on the server) and ideas status list; expired sessions return to sign-in; six-language strings (non-English unreviewed). Fixed a `LoadView` reload bug (setState returning a Future).
- 2026-10-17 · Intake and assisted mode (M-05/M-06 `client_partial`; M-11/M-17/M-18 `device_pending`; A-01 `api_partial`): API for drafts, typed answers, resumable offset-checked uploads with sha256-verified immutable GridFS originals, one-time submit creating a centre-owned Submission (`pipeline: pending_queue`, no fake processing), facilitator applicant registration with sealed names, spoken-consent evidence and checkbox-gated consent. App: Speak/Type/Upload editor, two-minute guided recordings with pause/re-record, durable per-account outbox that resumes uploads after crashes, "Waiting to send" with per-item status, facilitator new-applicant flow. 8 new API tests (101 backend tests in total), 16 Flutter tests, `flutter analyze` clean. Microphone permissions declared for Android and iOS.
