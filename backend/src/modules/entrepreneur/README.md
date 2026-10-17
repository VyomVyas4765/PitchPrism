# Entrepreneur module · Dev 1

Entrepreneur onboarding, consent and Idea Passport APIs (M-01 server side, M-03, M-04, M-15 consent part) and the facilitator's own-submission list. All routes are under `/api/v1`, need an entrepreneur session (`submit_own`) unless marked, and act only on the caller's own records. Request bodies are strict: role, organisation, subject or status fields sent by a client are rejected.

| Method/path | Behavior |
| --- | --- |
| `GET /me` | Language, profile, `profileComplete`, active consents and the current `noticeVersion` |
| `PUT /me` | Partial update: `language`, `name`, `district`, `pincode` (6 digits), `trade`, `gender` (`female`/`male`/`other`/`prefer_not_to_say`, `null` clears). Language can be saved before consent; any profile field needs active processing consent (403) |
| `POST /consents` | `{purpose:"processing"}` or `{purpose:"partner_sharing", scope:"sector_partner"|"funding_partner"}`, plus `noticeVersion`, `language`, `method` (`app_tap`/`app_voice`). Sharing needs processing first (409). Repeating an active grant returns it (200) |
| `POST /consents/:id/revoke` | Revokes and returns state; safe to retry. Revoking processing withdraws all sharing. Matching partner shares are deactivated before the response, so partners lose access on their next request |
| `GET /me/passport` | Per idea: who can see it (`owning_centre`, `collected_by`, `consented_share` with `shareId`, `partnerType`, `contactAccepted`) |
| `GET /me/submissions` | The caller's own ideas with status (M-12 basis; no status history exists yet) |
| `GET /assisted/submissions` | Facilitator only (`submit_assisted`): submissions that facilitator created, with applicant name/phone (M-18) |

## Intake and assisted mode

Entrepreneurs act on their own pitches; facilitators only on pitches and applicants they created. IDs from the device (`clientDraftId`, `clientFileId`, `clientApplicantId`, 8–64 of `[A-Za-z0-9_-]`) make every create call idempotent, so an offline retry never duplicates.

| Method/path | Behavior |
| --- | --- |
| `GET /pitch-prompts` | Guided prompt cards from `data/seed/question-bank.json` (non-English text unreviewed) |
| `GET /centres` | Active centres an entrepreneur can apply to (Q-08: no district mapping is assumed) |
| `POST /pitches` | `{clientDraftId, mode: guided/free_talk/typed/upload, language, centreId?}`; facilitators pass `entrepreneurId` of an applicant they registered and get their own centre |
| `GET /pitches`, `GET /pitches/:id` | Own drafts with document upload state |
| `PUT /pitches/:id/answers` | Typed answers per guided step while `DRAFT` |
| `POST /pitches/:id/documents` | `{clientFileId, kind, bytes, sha256, mime, promptStep?}`; kind-specific size and MIME limits; at most 20 files |
| `PUT /documents/:id/content` | Raw `application/octet-stream` chunk (≤ 1 MiB) at `Upload-Offset`; a wrong offset gets 409 with the server's `receivedBytes`. The final chunk is checked against size and sha256: `complete` (immutable GridFS original) or `rejected` |
| `GET /documents/:id` | Resume point after an app restart |
| `POST /pitches/:id/submit` | Needs processing consent, a centre, finished uploads and some content. Typed answers become an immutable text original. Creates one `Submission` (owner = centre, source = facilitator's org) and marks `pipeline: pending_queue`; no queue consumer exists yet, so nothing claims processing happened |
| `POST /pitches/:id/process` | Retry reading after `pending_capability`, `failed`, or `processing` stuck for 30 minutes (owner) |
| `GET /pitches/:id/transcript` | Latest transcript version with pipeline state (`pending_queue`, `processing`, `transcribed`, `pending_capability`, `failed`) |
| `PUT /pitches/:id/transcript` | `{baseVersion, edits:[{segId, text}]}` saves corrections as a new version; version 1 stays as read; a stale base gets 409 |
| `GET /documents/:id/original` | The owner's own original for playback (private, not cached) |
| `POST /assisted/applicants`, `GET /assisted/applicants` | Facilitator registers applicants (name/gender sealed) and lists only their own |
| `POST /assisted/applicants/:id/evidence` | Registers the spoken-consent recording; uploaded through the content route |
| `POST /assisted/applicants/:id/consents` | Records consent with `method: assisted_recorded`; needs a complete evidence recording and `checkboxConfirmed: true` |

After submit, `processing.ts` runs the local Python pipeline (`ai.ingest.run`) in the background on this host and stores its result as transcript version 1, including the `CentreExtractedInput` for Dev 2 and page blur boxes. This is an integration bridge until the shared job queue exists: a run interrupted by a restart stays `processing` and its owner can retry it after 30 minutes.

Facilitators from an implementation partner cannot submit yet: their linked centre needs `Org.parentOrgId` (shared model, Dev 3).

**Records.** `entrepreneurs._id` equals the entrepreneur's user ID for phone sign-in, matching the shared submission scope. Assisted applicants (M-17) will get their own ID. Name and gender are sealed with AES-256-GCM using `PII_ENCRYPTION_KEY`, bound to the record ID, never selected by default, and never logged. Without the key, profile writes fail with 503 and nothing is stored. District, pincode and trade are coarse fields for the pipeline. `consents` are append-only: revoking stamps `revokedAt`/`revokedByUserId`; granting again adds a record. Each record stores the notice version and language shown.

**For other roles.** Import `sharingAllowed(entrepreneurId, partnerType)` from `modules/entrepreneur/index.js` before suggesting, creating or sending a partner share (W-13, W-17, A-27). It requires active processing and sharing consent for that partner type.

**Pending.** Contact accept/decline (needs the share contact-request state from W-17), assisted applicants with recorded consent evidence (needs private document storage), phone in the vault for post-acceptance partner contact, data deletion, and moving language/consent enums into `packages/contracts` (D-03, Dev 3).
