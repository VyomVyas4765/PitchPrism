# Intake contract proposal · Dev 1 → Dev 3

**Status:** proposal, 2026-10-17. No submission writes land until Dev 3 agrees the contract (AGENTS.md). Dev 2 reviews the shared `documents`/A-01 parts (bulk import, W-19); Dev 4 reviews the reuse in W-16. Nothing here changes the PRD; it fills the gaps between PRD §19–20, flow §1.2–1.4 and the read-only starter model.

**Unblocks:** M-05/M-06/M-07 intake, M-08 transcript edits, M-11 offline resume, M-17/M-18 assisted mode, A-01 originals and the first job.

## Records

Extend the starter `Submission` rather than replacing it:

| Field | Proposal | Why |
| --- | --- | --- |
| `channel` | `app_self` · `app_assisted` · `web_pwa` · `import` · `whatsapp` | Same pipeline for every channel (PRD §6) |
| `mode` | `guided` · `free_talk` · `typed` · `upload` | M-05–M-07 |
| `clientDraftId` | UUID generated on the device; unique with `createdByUserId` | An offline draft retried after a crash creates one submission, not two (M-11) |
| `status` | The flow §1.2 lifecycle (`DRAFT` … `SHARED`) | Starter enum has three values |
| `language` | Launch-language code | Pitch language; answers are still detected per segment (D-10) |
| `title` | Optional until `extract` writes a summary | Starter makes it required |
| `cohortId`, `programmeId` | Nullable until assignment (Q-08) | Self-signup has no cohort yet |

New `documents` collection (PRD §19): `submissionId`, `kind`, `declaredMime`, `detected` (A-02 result), `sha256`, `bytes`, `storageKey`, `state` (`receiving` · `complete` · `rejected`), `receivedBytes`, `clientFileId` (unique per submission), `promptStep` (guided card), `purpose` (`pitch` · `consent_evidence` · `followup_answer`), timestamps. Immutable once `complete`.

## Resumable upload (retry-safe, no presigned bucket required)

1. `POST /submissions` `{clientDraftId, channel, mode, language}` → 201, or 200 with the existing draft.
2. `POST /submissions/:id/documents` `{clientFileId, kind, bytes, sha256, promptStep?, purpose}` → `{documentId, receivedBytes}`; idempotent on `clientFileId`.
3. `PUT /documents/:id/content` with a raw chunk (≤ 1 MiB) and `Upload-Offset`. The server appends only when the offset equals `receivedBytes`; otherwise 409 with the current value.
4. The final chunk is verified against `sha256` and `bytes` → `complete` (immutable) or `rejected` (client restarts that file).
5. `GET /documents/:id` returns `receivedBytes` so the app resumes after a restart.
6. `POST /submissions/:id/process` → requires active processing consent (`hasProcessingConsent` from the entrepreneur module) and at least one complete document; `DRAFT`/`NEEDS_INPUT` → `QUEUED` plus `JobPayload {reason:"new"}`. Idempotent.

Opus at ~16 kbps keeps a 10-minute pitch near 1.2 MB, so 1 MiB chunks suit weak connections. JSON routes keep the 16 KB limit; only the content route takes raw bodies.

## Assisted mode

- `POST /assisted/applicants` (`submit_assisted`) `{clientApplicantId, language, profile}` creates an `entrepreneurs` record with `createdVia:"assisted"`, `facilitatorId` and `homeOrgId`; idempotent on `clientApplicantId` per facilitator.
- The spoken-consent recording uploads as a document with `purpose:"consent_evidence"`; `POST /assisted/applicants/:id/consents` then records consent with `method:"assisted_recorded"`, the checkbox confirmation and `evidenceDocumentId` (required).
- Facilitator submissions: `createdByUserId` = facilitator, `entrepreneurId` = applicant, `sourceOrgId` = facilitator's org, `ownerOrgId` = that centre (or the implementation partner's parent centre). `GET /assisted/submissions` uses the existing `createdByUserId` scope.
- Shared devices: the app keeps a separate queue per `clientApplicantId`; the API never lets one facilitator read another's applicants.

## Transcript edits (M-08)

`transcripts` stay versioned (PRD §19). `PUT /submissions/:id/transcript` `{baseVersion, edits:[{segId, text}]}` creates a new version with `editedBy`; a stale `baseVersion` gets 409. Original segments stay addressable.

## Decisions needed from Dev 3

1. **Owning centre for self-signup** (Q-08): district → centre mapping, or a chosen cohort? Until then, may an app `DRAFT` exist with `ownerOrgId: null`?
2. **Storage:** recommend MongoDB GridFS (`originals` bucket) behind a small storage interface: private, no new infrastructure, local and Atlas alike. Chunks stage in a collection and are finalized into GridFS on hash verification.
3. **Queue transport** after the Redis removal in progress: a Mongo-backed jobs collection? `JobPayload` stays as in flow §1.4.
4. **Status transitions:** confirm the flow §1.2 owner table and the expanded enum.
5. **`Org.parentOrgId`** so implementation-partner facilitators resolve their centre.
6. **Limits:** proposed audio ≤ 10 min, PDF ≤ 25 MB, image ≤ 10 MB, 20 documents per submission.
