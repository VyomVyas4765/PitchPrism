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

**Records.** `entrepreneurs._id` equals the entrepreneur's user ID for phone sign-in, matching the shared submission scope. Assisted applicants (M-17) will get their own ID. Name and gender are sealed with AES-256-GCM using `PII_ENCRYPTION_KEY`, bound to the record ID, never selected by default, and never logged. Without the key, profile writes fail with 503 and nothing is stored. District, pincode and trade are coarse fields for the pipeline. `consents` are append-only: revoking stamps `revokedAt`/`revokedByUserId`; granting again adds a record. Each record stores the notice version and language shown.

**For other roles.** Import `sharingAllowed(entrepreneurId, partnerType)` from `modules/entrepreneur/index.js` before suggesting, creating or sending a partner share (W-13, W-17, A-27). It requires active processing and sharing consent for that partner type.

**Pending.** Contact accept/decline (needs the share contact-request state from W-17), assisted applicants with recorded consent evidence (needs private document storage), phone in the vault for post-acceptance partner contact, data deletion, and moving language/consent enums into `packages/contracts` (D-03, Dev 3).
