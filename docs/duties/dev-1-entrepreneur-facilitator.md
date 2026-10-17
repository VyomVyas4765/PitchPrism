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

2026-10-17 · Branch `arnav` · Waiting on external inputs before the next P0 slices:
- Flutter onboarding screens (M-01/M-03/M-04 client, M-19): the Flutter SDK is not installed on this dev machine yet.
- Intake, offline queue, assisted applicants, A-01: Dev 3 agreement on [the intake proposal](dev-1-intake-proposal.md) (owning centre, storage, queue after Redis removal, status enum, `parentOrgId`).
- A-05/A-06/A-08 PDF layout: team decision on the PDF library licence (PyMuPDF AGPL-3.0 vs permissive pdfplumber/pypdfium2) and Dev 3 approval for `ai/requirements.txt`.
- A-04/A-07/A-11/A-12: no local STT/OCR/translation model selected or evaluated; organiser files are not on this machine.

**Awaiting review (shared edits on `arnav`):** Dev 3: router mount in `backend/src/app.ts`; `PII_ENCRYPTION_KEY` in `backend/src/config.ts`, `.env.example`, `scripts/setup-env.mjs` (existing `.env` files need the key added by hand); `api_partial`/`worker_partial` legend in `scripts/generate-matrix.mjs`; drafts in `packages/contracts/schemas/drafts/` and `packages/contracts/fixtures/ingest/` (generator untouched). Dev 2: prompt PII guard in `ai/llm/adapter.py`; draft ingest-output contract and fixtures. Revocation deactivates existing `Submission.shares` entries using starter fields only (no contract change).

## Done

- 2026-10-17 · First milestone foundation: Mobile session restoration, secure token storage, facilitator password login and Firebase phone exchange are implemented. Real phone sign-in still needs Firebase configuration and device verification.

- 2026-10-17 · D-24 foundation: local-only settings, task-provider interfaces, installed-model JSON/vision adapter, spending/proxy/redirect guards, capability registry and ten policy/output tests. Synthetic local JSON smoke passed; six-language/OCR/model quality remain unevaluated.

- 2026-10-17 · Onboarding API (server side only; M-01/M-03/M-04/M-15 are `api_partial`, not complete): `GET/PUT /me` (language before consent; name/gender sealed with AES-256-GCM; profile needs processing consent), `POST /consents` and `/consents/:id/revoke` (per purpose, notice version/language/method recorded, idempotent, append-only; revocation closes matching partner shares immediately), `GET /me/passport`, and `sharingAllowed()` for routing owners. 15 Mongo-backed access/behavior tests. Pending: Flutter screens and spoken notice, contact accept/decline (W-17 state), assisted consent evidence, device checks. Contract: [module README](../../backend/src/modules/entrepreneur/README.md).

- 2026-10-17 · Deterministic ingestion helpers (A-02/A-03/A-10 are `worker_partial`, not complete): ffmpeg 16 kHz mono normalisation, `silencedetect` pause baseline packing speech into ≤ 29.5 s chunks with original-time anchors, `too_short`/`near_silent`/`clipped` rejection; content-signature format detection with ffprobe stream checks; phone/email/ID/known-name redaction including Indic digits, and a prompt guard in the shared adapter that blocks unredacted contacts before any runtime call. 18 new worker tests on synthetic audio/text (plus 5 for fixtures and the question bank; 33 worker tests in total). Thresholds are untuned; no organiser-data evaluation yet. See [ingest README](../../ai/ingest/README.md).
- 2026-10-17 · For Dev 2: draft [ingest-output.v0](../../packages/contracts/schemas/drafts/ingest-output.v0.json) (Segment, QA, cited fields) and three synthetic [fixtures](../../packages/contracts/fixtures/ingest/README.md) checked against the evidence rules. Draft question bank and guided prompt cards in `data/seed/question-bank.json` (non-English prompts unreviewed, Q-05). Read-only own-submission lists for entrepreneurs and facilitators (`GET /me/submissions`, `GET /assisted/submissions`) with isolation tests; 16 entrepreneur-module tests in total. Intake [proposal](dev-1-intake-proposal.md) written for Dev 3; not yet reviewed.
