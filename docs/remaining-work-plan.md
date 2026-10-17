# PitchPrism Remaining Work Plan

## Purpose

This document is the implementation plan for the work that remains before
PitchPrism can be considered end-to-end and production-ready.

The project already has foundations for authentication, sessions, role and
organisation checks, dashboard navigation, partial mobile intake, partial
centre review, partner read projections, HQ administration, local AI policy,
MongoDB persistence, and automated tests. Those foundations do not mean that
the corresponding product requirements are complete.

A requirement is complete only when its frontend, API, persistence,
authorization, loading/error states, required integrations, tests, and
acceptance validation are all present.

Authoritative references:

- [Implementation matrix](./implementation-matrix.md)
- [Requirement definitions](./duties/requirements.json)
- [Duty index](./duties/README.md)
- [Dev 1 brief](./duties/dev-1-entrepreneur-facilitator.md)
- [Dev 2 brief](./duties/dev-2-centre-cohort.md)
- [Dev 3 brief](./duties/dev-3-hq-platform.md)
- [Dev 4 brief](./duties/dev-4-partners.md)
- [Local AI setup](../ai/README.md)
- [Mobile setup](../app/README.md)
- [MongoDB setup](./mongodb.md)

## Current status

The implementation matrix contains 88 requirements. The current status
categories are incomplete:

- `planned`
- `partial`
- `foundation_partial`
- `adapter_partial`
- `api_partial`
- `worker_partial`
- `client_partial`
- `device_pending`
- `api_ui_partial`
- `feature_partial_unmounted`

The matrix is intentionally conservative. A synthetic fixture, UI screen,
API endpoint, or local model smoke test must not be promoted to complete
without the required acceptance evidence.

---

## 1. External configuration and environment

### 1.1 Firebase Authentication

Firebase is required for entrepreneur phone-number authentication and mobile
push notifications.

#### Firebase project setup

- [ ] Create or select the Firebase project.
- [ ] Enable Phone Authentication.
- [ ] Register Android package `in.pitchprism.pitchprism_app`.
- [ ] Register iOS bundle ID `in.pitchprism.pitchprismApp`.
- [ ] Add Android SHA-1 and SHA-256 fingerprints.
- [ ] Configure Firebase test phone numbers.
- [ ] Configure iOS APNs and reCAPTCHA support.
- [ ] Download the platform configuration values.
- [ ] Configure Firebase Admin credentials for the backend.
- [ ] Configure the backend Firebase project ID.
- [ ] Test phone sign-in on a physical Android device.
- [ ] Test phone sign-in on a physical iOS device.
- [ ] Test invalid and expired OTPs.
- [ ] Test backend token verification and session exchange.
- [ ] Test session revocation after Firebase sign-out.

Create the ignored mobile configuration file:

```text
local/mobile-config.json
```

Example:

```json
{
  "FIREBASE_PROJECT_ID": "your-project-id",
  "FIREBASE_API_KEY": "your-mobile-api-key",
  "FIREBASE_APP_ID": "your-mobile-app-id",
  "FIREBASE_MESSAGING_SENDER_ID": "your-sender-id"
}
```

The backend requires private service-account configuration, for example:

```text
GOOGLE_APPLICATION_CREDENTIALS=/private/path/to/service-account.json
FIREBASE_PROJECT_ID=your-project-id
```

Credentials must remain outside Git, fixtures, logs, screenshots, and
documentation.

### 1.2 MongoDB

Local development uses:

```bash
pnpm dev:local
```

This starts persistent loopback MongoDB, the API, the frontend, and the
synthetic seed. The local database is stored under `local/mongodb/`.

Production or Atlas validation:

- [ ] Current Atlas hostname resolves.
- [ ] Atlas cluster is active.
- [ ] Network access allows only the intended deployment address.
- [ ] Database user exists.
- [ ] Password is URL encoded.
- [ ] TLS connection succeeds.
- [ ] Authenticated ping succeeds.
- [ ] Required indexes are present.
- [ ] Backups are enabled.
- [ ] Restore procedure is tested.
- [ ] Production connection pool and timeout settings are reviewed.

Run:

```bash
pnpm db:check
```

Do not disable TLS or silently replace the private Atlas URI with another
database.

### 1.3 Local AI runtime

The approved architecture is local-only:

```text
AI_RUNTIME=local
AI_HOSTED_APIS_ENABLED=false
```

Required capability work:

- [ ] Select and evaluate a local speech-to-text model.
- [ ] Select and evaluate a local OCR model.
- [ ] Select and evaluate a local translation model.
- [ ] Select and evaluate a local transliteration model.
- [ ] Select and evaluate a local embedding model.
- [ ] Select and evaluate a local structured-generation model.
- [ ] Select and evaluate a local TTS path.
- [ ] Record licence and redistribution constraints.
- [ ] Measure model size.
- [ ] Measure peak RAM.
- [ ] Measure latency.
- [ ] Evaluate Hindi, Marathi, Telugu, Odia, Bengali, and English.
- [ ] Evaluate code mixing.
- [ ] Evaluate organiser documents.
- [ ] Evaluate scans and handwriting.
- [ ] Validate redaction before inference.

Useful checks:

```bash
make worker-setup
make worker-check
make worker-test
```

The existing local JSON/Ollama smoke test proves adapter plumbing only. It
does not approve a model for production scoring or multilingual processing.

### 1.4 Messaging

Messaging providers are separate from hosted AI and require their own
configuration and cost tracking.

- [ ] Configure Firebase Cloud Messaging.
- [ ] Choose and configure an SMS fallback provider.
- [ ] Choose and configure WhatsApp, if required.
- [ ] Define delivery status and retry contracts.
- [ ] Detect push failure.
- [ ] Trigger SMS fallback.
- [ ] Implement opt-out and consent behavior.
- [ ] Add notification audit events.
- [ ] Track provider costs.

### 1.5 Private file storage

The product requires private storage for original and derived evidence:

- PDFs
- Audio recordings
- Images
- Handwritten forms
- Rendered pages
- Evidence crops
- Extracted sidecars
- Generated reports

Remaining work:

- [ ] Select local and production storage backends.
- [ ] Define private bucket/container policy.
- [ ] Store immutable originals.
- [ ] Store content hashes.
- [ ] Prevent overwrites during retries.
- [ ] Add permission-checked or signed access.
- [ ] Add retention and deletion policies.
- [ ] Add backup and restore procedures.
- [ ] Ensure partners and models never receive unauthorized originals.

---

## 2. Mobile application

### 2.1 Onboarding and authentication

- [ ] Validate all six language choices on physical devices.
- [ ] Validate per-language spoken prompts.
- [ ] Report unavailable device voices explicitly.
- [ ] Complete spoken consent playback.
- [ ] Persist processing consent separately from partner-sharing consent.
- [ ] Support consent withdrawal.
- [ ] Complete Firebase phone OTP.
- [ ] Complete voice profile entry.
- [ ] Encrypt sensitive profile fields.
- [ ] Verify that PII is not sent to models or map services.

### 2.2 Intake

- [ ] Complete Speak mode.
- [ ] Complete Type mode.
- [ ] Complete PDF upload.
- [ ] Complete photo upload.
- [ ] Complete handwritten-plan upload.
- [ ] Add free-talk mode up to five minutes.
- [ ] Enforce pause, resume, and re-record behavior.
- [ ] Add audio playback.
- [ ] Add upload progress.
- [ ] Add resumable uploads.
- [ ] Add offline retry.
- [ ] Preserve source timestamps.
- [ ] Separate multiple applicants on shared devices.
- [ ] Verify facilitator-only submission scope.

### 2.3 Transcript, follow-up, and feedback

- [ ] Display transcript in the selected script.
- [ ] Allow tap-to-edit.
- [ ] Preserve immutable original segments.
- [ ] Jump from transcript to audio.
- [ ] Generate three to five follow-up questions.
- [ ] Collect applicant answers.
- [ ] Re-run only the affected processing stages.
- [ ] Show feedback in the applicant language.
- [ ] Provide feedback audio.
- [ ] Show strengths, gaps, and one next step.
- [ ] Provide improvement checklist.
- [ ] Provide relevant skilling resources.
- [ ] Support resubmission without overwriting the original.

### 2.4 Status and sharing

- [ ] Show Submitted, Under review, and Decision states.
- [ ] Refresh status safely after reconnect.
- [ ] Deliver push notifications.
- [ ] Deliver SMS fallback when push fails.
- [ ] Show Idea Passport access.
- [ ] Grant and revoke sharing by partner type.
- [ ] Receive contact requests.
- [ ] Accept or decline contact requests.
- [ ] Hide contact details until acceptance.
- [ ] Remove access immediately after revocation.

### 2.5 Device validation

- [ ] Android 8 or newer.
- [ ] Two-gigabyte Android device.
- [ ] Physical Android device.
- [ ] Offline restart and recovery.
- [ ] Poor-network upload and retry.
- [ ] Physical iPhone.
- [ ] iOS local-network connectivity.
- [ ] iOS Firebase setup.
- [ ] Release build and signing.
- [ ] Install size measurement.
- [ ] Memory and battery measurement.

---

## 3. AI ingestion and processing

### 3.1 Original ingestion

- [ ] Store every original privately.
- [ ] Calculate and persist SHA-256 hashes.
- [ ] Create immutable document records.
- [ ] Prevent overwrite on retry.
- [ ] Create the submission and job together safely.
- [ ] Emit intake stage events.
- [ ] Record upload and validation failures.
- [ ] Implement retention and deletion.

### 3.2 Format and template classification

- [ ] Detect audio.
- [ ] Detect digital PDF.
- [ ] Detect scanned PDF.
- [ ] Detect image.
- [ ] Detect text.
- [ ] Detect script per page.
- [ ] Detect EDP Idea Brief.
- [ ] Detect EDP Business Plan.
- [ ] Detect platform exports.
- [ ] Return explicit `unknown` for unsupported formats.

### 3.3 Audio

- [ ] Convert to 16 kHz mono.
- [ ] Detect silence.
- [ ] Split into chunks below 30 seconds.
- [ ] Preserve start and end timestamps.
- [ ] Detect near-silent recordings.
- [ ] Detect clipped recordings.
- [ ] Request a re-record when necessary.
- [ ] Persist chunk metadata.
- [ ] Emit per-stage telemetry.

### 3.4 Speech recognition

- [ ] Evaluate all six launch languages.
- [ ] Detect language per chunk.
- [ ] Support code mixing.
- [ ] Produce timestamped segments.
- [ ] Preserve confidence.
- [ ] Evaluate organiser audio.
- [ ] Measure CPU, RAM, latency, and licence.

### 3.5 PDF, OCR, and handwriting

- [ ] Extract text spans.
- [ ] Extract bounding boxes, font, and colour.
- [ ] Extract drawn lines and table rules.
- [ ] Reconstruct tables from layout.
- [ ] Pair questions and answers independent of stream order.
- [ ] Detect Indic text corruption.
- [ ] Render low-confidence pages.
- [ ] OCR scanned pages.
- [ ] OCR handwritten pages.
- [ ] Preserve page and region anchors.
- [ ] Preserve confidence.
- [ ] Select a permissively licensed PDF library.

### 3.6 Overwrites and structured extraction

- [ ] Detect struck-out values.
- [ ] Detect overwritten values.
- [ ] Preserve original and final values.
- [ ] Link both values to source regions.
- [ ] Pair changed/custom forms.
- [ ] Map answers to canonical fields.
- [ ] Distinguish missing, not asked, irrelevant, unreadable, and unknown.
- [ ] Preserve citations for every extracted field.
- [ ] Reject uncited claims.
- [ ] Measure extraction accuracy on approved ground truth.

### 3.7 PII and language

- [ ] Encrypt private names, phones, and emails.
- [ ] Create keyed contact hashes.
- [ ] Redact before inference.
- [ ] Redact before maps and open-data calls.
- [ ] Prevent PII in logs, prompts, fixtures, and exports.
- [ ] Detect per-answer language.
- [ ] Translate and transliterate while preserving originals.
- [ ] Evaluate code mixing and six-language parity.
- [ ] Validate local TTS for every required language.

---

## 4. Centre assessor and cohort workflows

### 4.1 Review queue

- [ ] Ready lane.
- [ ] Needs-attention lane.
- [ ] Unassessable lane.
- [ ] Possible-duplicate lane.
- [ ] Sort by score, completeness, date, and language.
- [ ] Show quality flags.
- [ ] Add pagination.
- [ ] Add loading, empty, and error states.
- [ ] Add endpoint-specific access tests.

### 4.2 Evidence viewer

- [ ] Render original PDF pages.
- [ ] Highlight evidence regions.
- [ ] Show struck-out values.
- [ ] Add audio waveform and segment seeking.
- [ ] Highlight typed-text evidence.
- [ ] Blur PII by role.
- [ ] Restrict original-file access.
- [ ] Add evidence annotations.
- [ ] Preserve source anchors.

### 4.3 Decisions and feedback

- [ ] Complete shortlist, not-yet, and more-information decisions.
- [ ] Require override reasons where applicable.
- [ ] Persist review history.
- [ ] Save editable feedback.
- [ ] Translate feedback.
- [ ] Deliver feedback.
- [ ] Add mentoring notes and assignment.
- [ ] Track outcomes.
- [ ] Add audit events.

### 4.4 Cohort tools

- [ ] Bulk file and ZIP import.
- [ ] Per-file progress.
- [ ] Detected language and format display.
- [ ] Import error reporting.
- [ ] Cohort assignment during import.
- [ ] Cohort/trade administration.
- [ ] Cohort and trade comparisons.
- [ ] Side-by-side comparison of two or three ideas.
- [ ] Interview kits.
- [ ] Assessment and cohort exports.
- [ ] Human duplicate review.
- [ ] Resubmission linking.
- [ ] Different-person and dismiss actions.

### 4.5 Intelligence

- [ ] Completeness and relevance checks.
- [ ] Financial consistency checks.
- [ ] Duplicate detection and human review.
- [ ] Follow-up generation.
- [ ] Trade normalization.
- [ ] Location normalization.
- [ ] Nearby businesses.
- [ ] Scheme and district context.
- [ ] Double-run scoring.
- [ ] Disagreement flags.
- [ ] Cited narratives.
- [ ] EDP plans.
- [ ] Ranking and route suggestions.

---

## 5. HQ administration and reporting

### 5.1 Organisation and access administration

- [ ] Organisation hierarchy.
- [ ] Parent and child organisation relationships.
- [ ] One-time invitations.
- [ ] Invitation expiry.
- [ ] Scoped role grants.
- [ ] Disable and reactivate users.
- [ ] Organisation administration.
- [ ] Immediate effect of role changes.
- [ ] Cross-organisation access tests.

### 5.2 Programme and rubric administration

- [ ] Programme creation and versioning.
- [ ] Rubric domain forms.
- [ ] Weights.
- [ ] Score descriptors.
- [ ] Band thresholds.
- [ ] Pathway rules.
- [ ] Rubric validation.
- [ ] Publish active rubric versions.
- [ ] Rubric history.
- [ ] Connect active rubric to real scoring jobs.
- [ ] Visual rubric builder.

### 5.3 HQ pipeline

- [ ] Dedicated pipeline page.
- [ ] Centre filter.
- [ ] Cohort filter.
- [ ] Language filter.
- [ ] Trade filter.
- [ ] Sector filter.
- [ ] District filter.
- [ ] Status filter.
- [ ] Band filter.
- [ ] Pathway filter.
- [ ] Sorting and pagination.
- [ ] Cross-organisation projection tests.
- [ ] Export workflow and audit event.

### 5.4 Routing

- [ ] Dedicated routing page.
- [ ] Create, edit, disable, and version rules.
- [ ] Define rule precedence.
- [ ] Detect conflicting rules.
- [ ] Check partner readiness.
- [ ] Check consent and revocation.
- [ ] Remove stale assignments.
- [ ] Prevent duplicate assignments.
- [ ] Show routing history.
- [ ] Audit routing actions.

### 5.5 Reporting, fairness, audit, and evaluation

- [ ] Submitted/reviewed/shortlisted/enrolled/funded funnel.
- [ ] Centre and cohort aggregates.
- [ ] Date filtering.
- [ ] Export support.
- [ ] Cost and timing reporting.
- [ ] Random second-review sampling.
- [ ] Human score overrides.
- [ ] Override reasons and history.
- [ ] Score distributions by language, format, gender, and district.
- [ ] Explicit group-gap calculations.
- [ ] Five-point fairness alerts.
- [ ] Minimum sample-size rules.
- [ ] Fairness history and export.
- [ ] Append-only audit viewer.
- [ ] Audit filters and export.
- [ ] Audit every sensitive view, score, route, and export.
- [ ] Organiser evaluation-harness ingestion.
- [ ] Accuracy, parity, latency, and cost history.
- [ ] Dedicated model-quality page.

---

## 6. Partner workflows

### 6.1 Implementation partner

- [ ] Own-source intake.
- [ ] First-level review.
- [ ] Forwarding to linked centre.
- [ ] Linked-centre relationship.
- [ ] Own-organisation analytics.
- [ ] Production route mounting.
- [ ] Full persistence and transition tests.

### 6.2 Sector partner

- [ ] Sector eligibility matching.
- [ ] Consent-filtered opportunities.
- [ ] Express interest.
- [ ] Contact-request creation.
- [ ] Contact deduplication.
- [ ] Entrepreneur acceptance and decline.
- [ ] Mentoring notes.
- [ ] Mentoring visibility.
- [ ] Revocation handling on every protected read.
- [ ] Partner audit events.

### 6.3 Funding partner and CSR

- [ ] Funding-readiness evidence.
- [ ] Loan-ready shortlist.
- [ ] Funding status workflow.
- [ ] Aggregate CSR report.
- [ ] CSR privacy enforcement.
- [ ] No individual CSR submissions.
- [ ] Funding audit events.
- [ ] Production route mounting.

---

## 7. Queue, live events, and observability

### 7.1 MongoDB jobs

- [ ] Idempotent enqueue.
- [ ] Atomic claim.
- [ ] Lease expiry.
- [ ] Lease renewal.
- [ ] Retry limits and backoff.
- [ ] Terminal failure.
- [ ] Duplicate-job prevention.
- [ ] Job cancellation.
- [ ] Worker shutdown handling.
- [ ] Worker health reporting.
- [ ] Failed-job inspection.
- [ ] Resource and concurrency limits.
- [ ] Real ingestion and intelligence handlers.

### 7.2 Stage events and SSE

- [ ] Persist stage events durably.
- [ ] Scope reads by organisation and permission.
- [ ] Preserve event ordering.
- [ ] Implement durable cursors.
- [ ] Support `Last-Event-ID`.
- [ ] Replay missed events after reconnect.
- [ ] Suppress duplicate events.
- [ ] Add client reconnect behavior.
- [ ] Clean up disconnected connections.
- [ ] Handle backpressure.
- [ ] Test reconnect and replay.

### 7.3 Telemetry

- [ ] Queue wait duration.
- [ ] Per-stage duration.
- [ ] Model name and version.
- [ ] Input and output sizes.
- [ ] CPU and memory.
- [ ] Retry count.
- [ ] Failure code.
- [ ] Pipeline run records.
- [ ] Cost tracking.
- [ ] HQ telemetry view.

---

## 8. Security, privacy, and tenancy

- [ ] Request-scoped tenancy enforcement.
- [ ] Fail-closed unscoped queries.
- [ ] Explicit worker/system escape.
- [ ] Complete fine-grained permission matrix.
- [ ] Disabled-user denial.
- [ ] Immediate role-change enforcement.
- [ ] Session revocation checks.
- [ ] Secure cookie verification.
- [ ] Origin and CSRF verification.
- [ ] Login-rate-limit tuning.
- [ ] Secure file streaming.
- [ ] AES-GCM key deployment.
- [ ] Key rotation plan.
- [ ] Append-only audit middleware.
- [ ] Partner projection tests.
- [ ] PII log and prompt scans.
- [ ] PII fixture and screenshot scans.
- [ ] Map payload privacy review.
- [ ] Security review before release.

---

## 9. Contracts and generated code

Complete and generate shared contracts for:

- [ ] Organisation.
- [ ] Invitation.
- [ ] Programme.
- [ ] Cohort.
- [ ] Trade.
- [ ] Rubric.
- [ ] Routing rule.
- [ ] Submission.
- [ ] Document.
- [ ] Segment.
- [ ] Question and answer.
- [ ] Evaluation.
- [ ] Flag.
- [ ] Decision.
- [ ] Share.
- [ ] Outcome.
- [ ] Job payload.
- [ ] Stage event.
- [ ] Pipeline run.
- [ ] Audit event.

After contract changes:

```bash
pnpm contracts:generate
pnpm typecheck
```

Generated files must not be hand-edited.

---

## 10. Testing and acceptance

### Backend

- [ ] Authentication, session expiry, and revocation.
- [ ] Organisation isolation.
- [ ] Role and permission matrix.
- [ ] Invitations and organisation hierarchy.
- [ ] Programmes and rubrics.
- [ ] Cohorts and trades.
- [ ] Pipeline filters.
- [ ] Routing lifecycle.
- [ ] Fairness calculations and alerts.
- [ ] Audit append-only behavior.
- [ ] Evaluation ingestion.
- [ ] Job lease, retry, and expiry behavior.
- [ ] SSE replay and reconnect.
- [ ] Contact requests and consent revocation.
- [ ] Funding and CSR privacy.
- [ ] Export authorization.

### Frontend

- [ ] Dashboard routing.
- [ ] Sidebar and mobile drawer.
- [ ] Each HQ page independently.
- [ ] Centre queue and evidence viewer.
- [ ] Partner workflows.
- [ ] Pipeline filters.
- [ ] Forms and validation.
- [ ] Loading states.
- [ ] Empty states.
- [ ] Error states.
- [ ] Role-specific navigation.

### Mobile

- [ ] Language picker and TTS.
- [ ] Firebase OTP.
- [ ] Consent.
- [ ] Profile.
- [ ] Speak, Type, and Upload.
- [ ] Recording and playback.
- [ ] Offline queue.
- [ ] Restart recovery.
- [ ] Shared-device separation.
- [ ] Feedback and resubmission.
- [ ] Partner consent.

### AI evaluation

- [ ] Generate redacted sidecars.
- [ ] Create approved private ground truth.
- [ ] Evaluate all organiser files.
- [ ] Evaluate all six languages.
- [ ] Evaluate audio, PDFs, scans, and handwriting.
- [ ] Evaluate Indic text quality.
- [ ] Evaluate translation and transliteration.
- [ ] Evaluate extraction citations.
- [ ] Evaluate scoring parity.
- [ ] Record licence, size, RAM, and latency.

---

## 11. Operational and deployment checklist

### Local verification

```bash
pnpm install
pnpm setup:env
pnpm dev:local
```

Before handoff:

```bash
pnpm contracts:generate
pnpm typecheck
pnpm test
pnpm build
pnpm duties:check
pnpm matrix:generate
```

### Production backend

- [ ] Production MongoDB.
- [ ] Secret management.
- [ ] Firebase Admin credentials.
- [ ] Private file storage.
- [ ] Worker deployment.
- [ ] Queue monitoring.
- [ ] HTTPS.
- [ ] Secure cookies.
- [ ] Origin configuration.
- [ ] Health checks.
- [ ] Backups.
- [ ] Restore test.
- [ ] Error reporting.
- [ ] Log redaction.

### Production frontend

- [ ] Production API URL.
- [ ] Cookie/session verification.
- [ ] HTTPS.
- [ ] Route protection.
- [ ] Error reporting.
- [ ] Responsive QA.
- [ ] Accessibility review.

### Mobile release

- [ ] Android release signing.
- [ ] iOS development and release signing.
- [ ] Production Firebase configuration.
- [ ] APNs configuration.
- [ ] Store metadata.
- [ ] Privacy policy.
- [ ] Permission declarations.
- [ ] Crash reporting.
- [ ] Device compatibility testing.

---

## 12. Recommended implementation phases

### Phase 1: Contracts, tenancy, and security

Complete shared schemas, generated types, request-scoped tenancy,
permissions, encryption, private storage, and audit middleware.

### Phase 2: Jobs, events, and telemetry

Complete MongoDB leases, retries, worker lifecycle, stage events, SSE replay,
pipeline runs, and per-stage telemetry.

### Phase 3: Mobile intake and ingestion

Complete mobile capture, private uploads, audio normalization, PDF extraction,
OCR, PII redaction, and structured extraction.

### Phase 4: Organiser-data evaluation

Create redacted sidecars, approved ground truth, local model benchmarks, and
quality reports for all required formats and languages.

### Phase 5: Centre workflow

Complete bulk import, review queue, evidence viewer, idea card, quality panel,
decisions, feedback, resubmission, cohorts, trades, and exports.

### Phase 6: Intelligence

Complete quality checks, financial checks, duplicate detection, location,
schemes, similarity, scoring, narratives, plans, rankings, and routing.

### Phase 7: Partner workflow

Complete implementation-partner, sector-partner, contact-request, mentoring,
funding, and CSR workflows.

### Phase 8: HQ workflow

Complete invitations, organisation administration, programmes, rubrics,
pipeline, routing, fairness, audit, evaluations, and reporting.

### Phase 9: Device and production validation

Validate Android and iOS devices, Firebase, MongoDB production, private
storage, worker deployment, messaging, monitoring, security, and release
procedures.

---

## 13. Definition of done

A requirement may be marked complete only when:

- [ ] Frontend workflow exists.
- [ ] Backend endpoint exists.
- [ ] Persistence exists.
- [ ] Permission checks exist.
- [ ] Organisation scoping exists.
- [ ] Consent behavior exists where applicable.
- [ ] Loading state exists.
- [ ] Empty state exists.
- [ ] Error state exists.
- [ ] Audit event exists where applicable.
- [ ] Automated tests exist.
- [ ] Device or organiser-data validation exists where required.
- [ ] Documentation is updated.
- [ ] Requirement status is updated.
- [ ] `pnpm duties:check` passes.
- [ ] `pnpm matrix:generate` has been run.
- [ ] No sensitive data is present in source, fixtures, logs, prompts, or
  screenshots.

---

## 14. Target end state

PitchPrism is ready for release when:

1. Entrepreneurs can authenticate with Firebase.
2. Entrepreneurs and facilitators can create online and offline intakes.
3. Audio, PDF, image, handwritten, and typed inputs are stored safely.
4. Validated local processing handles supported formats and languages.
5. Every extracted field has source evidence.
6. PII is encrypted or redacted appropriately.
7. Centre assessors can review evidence and make decisions.
8. Applicants receive feedback and can resubmit.
9. Partners receive only consented and permitted data.
10. HQ administrators can manage organisations, cohorts, trades, rubrics,
    routing, audits, and reports.
11. Queue processing is durable and observable.
12. SSE reconnects safely without losing stage events.
13. Organiser-data evaluation proves quality and parity.
14. Android and iOS builds work on real devices.
15. Production MongoDB, storage, messaging, secrets, backups, and monitoring
    are configured.
16. Access-control and privacy tests pass for every protected workflow.
