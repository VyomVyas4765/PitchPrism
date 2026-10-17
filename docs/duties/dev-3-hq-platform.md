# Dev 3 · HQ Admin and Shared Platform

**PRD roles:** HQ programme admin.

**Mission:** Own HQ workflows across UI/API/data, plus the shared platform that all role owners integrate with. Other developers implement their own feature endpoints; this role is not a bottleneck for every API change.

**Owned modules:** `frontend/features/hq/`; `backend/src/modules/hq/`; shared `backend/src/auth/`, models and configuration; `packages/contracts/`; root infrastructure.

## Check before adding logic

Other AI agents may be working on their assigned roles concurrently. **Before adding logic**, read the duty index and other owners’ In progress notes; inspect `git status` and relevant diffs; search for existing/partial implementations, models, endpoints and contracts. Reuse shared logic, coordinate overlapping/shared edits with their owner, and preserve others’ changes. Record your active task and touched modules below before starting.

## Foundation already available

Staff authentication, server-side role/organisation checks, expiring revocable sessions, origin checks, login limiting, role workspaces, synthetic auth seed, shared auth schema and access tests are implemented. Invitation/admin CRUD and business pipelines remain pending.

These are starter capabilities, not completion of the full requirements below. Login secrets belong in the ignored `.env`; all seeded users are synthetic. Never add a role selector that grants access or a fake OTP bypass.

## Order of work

- Complete organisation/user invitations and scoped administration, programmes, versioned rubrics, trade administration and routing-rule configuration.
- Add HQ pipeline, funnel, second review, fairness, audit log, idea map and model-quality reporting; consume shared analysis/metrics from Dev 2.
- Own shared auth and tenancy changes, encrypted profile-storage foundation, database indexes, contracts and generation, queue producer/worker handoff, SSE transport and observability.
- Agree full domain contracts before expanding the read-only submission prototype. Supply auth/session/query-scope integration points to every role owner.
- Own root manifests/lockfiles, Docker/configuration, seed loader and deployment wiring. Coordinate scoped feature mounting; preserve the PRD's separate roles and partner permissions.

PRD priorities and full requirement descriptions remain authoritative. Complete P0 first; do not silently remove lower-priority requirements. See [the duty index](README.md) for shared ownership and cross-role consumers.

## Revised local AI constraints · D-24

Preserve every assigned requirement. Heavy AI remains on the worker; the Android app uses system speech/TTS only after per-device locale/offline checks and does not bundle the main LLM. Use the shared local-only provider policy/registry and adapter; never introduce hosted API fallback, automatic model downloads or a duplicate AI path. Missing capabilities stay pending/failed explicitly. Validate licence, size, peak RAM, latency, six-language/format parity and organiser-data accuracy before adopting a model. AI API spending must be zero; identity, messages, hardware, storage and hosting remain separately costed.

Track implementation, execution, dependency, acceptance and status in [requirements.json](requirements.json), rendered as [the full matrix](../implementation-matrix.md). The current JSON adapter and tiny synthetic test establish plumbing only, not completed AI requirements. Coordinate existing agent work and shared ownership before adding stages. See [local runtime setup](../../ai/README.md).

## Primary requirement checklist

Descriptions and acceptance details: [PRD](../../PitchPrism.md). Each ID has exactly one primary owner in [requirements.json](requirements.json); support dependencies do not change primary ownership.

- [x] **W-01** · HQ · P0
- [x] **W-02** · HQ · P0 (form), P1 (visual builder)
- [x] **W-03** · HQ · P0
- [x] **W-04** · HQ · P0
- [x] **W-05** · HQ · P0
- [x] **W-06** · HQ · P1
- [x] **W-07** · HQ · P1
- [x] **W-08** · HQ · P1
- [x] **W-27** · HQ · P1 · lexical similarity until A-19 embeddings exist
- [x] **W-32** · HQ, Centre · P0
- [x] **W-33** · HQ · P1
- [x] **A-28** · Live card · P0 · intake stages join the worker when Dev 1 adds them
- [x] **A-29** · Cost and timing · P1

## Acceptance and handoff

Verify every access-control boundary, role changes/disabled accounts on the next request, revoked sessions, safe cookie settings, request origins and untrusted payloads. Ensure HQ aggregate views do not leak sensitive fields into partners or model requests. Add role tests whenever a protected endpoint is mounted.

A feature is done when UI, API, persistence, permissions, loading/error states, required integrations and relevant tests work together. Publish synthetic fixtures early, document contracts, add a Done entry and notify consuming role owners. No raw organiser PII in code, prompts, fixtures, screenshots or logs.

## Plan (agreed 2026-10-17 · Vyom)

Platform first: Devs 1, 2 and 4 are blocked on phases 1–3. Queue and events follow D-26; invitations follow D-27.

1. **Domain contracts and data layer** (unblocks everyone). JSON Schemas for Org (parent, state, districts, languages, sectors), Invitation, Programme, Cohort, Trade, Rubric (versioned), RoutingRule, Submission (PRD §19), Document, Segment, QA, Evaluation, Flag, Decision, Share, Outcome, JobPayload, StageEvent, PipelineRun, AuditLog. Generate TypeScript and Pydantic (D-03). Split Mongoose models per collection with PRD §19 indexes. Publish synthetic fixtures. Migrate the read-only starter submission endpoint. Get contract sign-off from Devs 1, 2 and 4 before freezing.
2. **Security foundations.** Mongoose tenancy plugin fed from request-scoped context, throwing on unscoped tenant queries, with a logged system escape for the worker. PRD permission-matrix actions replacing the coarse list. AES-GCM field encryption for entrepreneur name/phone/email plus a keyed contact hash for duplicate matching. Append-only audit middleware. `modules/{entrepreneur,centre,hq,partners}/router.ts` mounting so owners add routes without editing `app.ts`. Role access tests for each.
3. **Jobs and live events (A-28, A-29 plumbing; Q-14).** `jobs` collection with idempotent enqueue, atomic lease, lease expiry, retry and terminal failure. Capped `stageEvents` followed by a tailable cursor, `GET /api/v1/events` SSE scoped by organisation with `Last-Event-ID` replay. `pipelineRuns` for timing and model use. Remove Redis from Compose, `.env.example` and README. Replayable event fixture for Dev 2's live card. Agree the Python consumer contract with Dev 1.
4. **HQ admin, P0.** W-01 organisation hierarchy and one-time invite links with scoped role grants; W-02 programmes and versioned rubric form (Dev 2 owns rubric content); W-32 cohorts and trade list (centre-scoped for centres); W-04 routing rules. Screens in `frontend/features/hq/` on Dev 4's shell, Broadsheet style.
5. **HQ reporting.** P0: W-03 cross-organisation pipeline with filters, W-05 funnel by centre and cohort (synthetic data until real submissions flow). P1: W-08 audit log viewer, A-29 cost and timing view, W-06 second-review sampling, W-07 fairness monitor, W-27 idea map and W-33 model-quality page over Dev 2's metrics, W-02 visual builder.

Throughout: organisation/programme/cohort seed loader, Docker and `.env` handling, requirement-matrix updates, Done entries.

Not Dev 3 (integrate, don't duplicate): intake and AI stages (Dev 1); scoring, similarity and analytics maths, centre review screens (Dev 2); partner views and the shared web shell (Dev 4).

## In progress

Nothing active. Not verifiable on the development machine: Docker Compose (Docker not installed), the Android build (needs Flutter 3.47; 3.41 installed), Firebase phone sign-in (needs project credentials), and organiser-data runs (no extracted dataset or local model here). Contract sign-off by Devs 1, 2 and 4 is a conversation, not code.

## Done

- 2026-10-17 · Merged Rayyan's push to `vyom` (also on main) and unified it on the contract-based platform. Kept his dashboard shell (sidebar sections, `/dashboard/[role]/[section]`), now driving every role's panels and the HQ desk one section at a time; his richer HQ overview counts; audit entries for submission views, scores and decisions (through the audit log); and queueing processing when a pitch is submitted (through the consent-checked queue). Removed the duplicate old-model Programme, Rubric, RoutingRule, Cohort, Trade, AuditEvent, EvaluationRun, StageEvent, Job, ReviewSample and ClusterPoint models, his admin router, Node worker and HQ panels, and the extra Submission fields (including `gender`, which stays sealed in the entrepreneur profile).

- 2026-10-17 · Scope completion. Tenancy now enforces in every module (`TENANCY_MODE=enforce` by default; centre, entrepreneur, assisted intake, consent and partner queries declare scopes). W-02 visual rubric builder; published rubric versions drive scoring weights, bands and pathway rules in `ai/intel/scoring.py`, and the default rubric matches it. W-33 records each harness report as an `evalRun` with history. Staff password reset links and self-service password change. A-28: `python -m ai.worker` (`pnpm worker`) runs redaction, quality, follow-ups, scoring, narrative, feedback and routing as real timed stages and the centre card fills in live; the queue never changes a decided idea's status. W-27 idea map (lexical, deterministic) with named clusters and saturation alerts. Verified: 145 backend tests and 69 worker tests (5 skipped); live checks through the web proxy (invite, reports, idea map, reset and account pages, rescore through the real worker failing visibly at scoring with no local model).

- 2026-10-17 · Merged main into `vyom` and unified W-01: one invitation system on the `invitations` contract with audit, tenancy and HQ configuration. Ported from Arnav's build: links carry the token in the URL fragment (`/accept-invite#token`) and preview by POST, so it never reaches request logs; re-inviting an address withdraws its earlier link; disabling ends sessions at once; invitations default to the inviter's organisation; implementation partners must report to an active centre, every other organisation to HQ, and parents are fixed after creation. Removed the duplicate `Invite` model, `manage_org_users` permission (now `invite_users`), access router and panel. Dev 1's `clientApplicantId` moved into the Entrepreneur contract. Verified: 138 backend tests including Dev 1's intake suite and Arnav's scenarios ported into `hq.test.ts`.

- 2026-10-17 · Phase 5 HQ reporting (W-03, W-05, W-06, W-07, W-08, W-33, A-29): `/api/v1/hq/reports/*` for the cross-organisation pipeline (filters by centre, cohort, status, trade, band, language, channel; cursor pages; prefers `evaluations` and falls back to Dev 2's `centrecases`), funnel by centre or cohort with outcomes counted once per idea, pipeline health (queue, expired leases, stage p50/p95 and failure rate, model calls, time to card, hosted cost ₹0), fairness by language, channel and district (groups under five are shown, not compared; gap above 5 flagged), a weekly-stable second-review sample with HQ verdicts in the new `reviewSamples` contract, the audit log viewer, and the harness report from `ai/eval/harness.py`. HQ desk tabs with a live SSE stage feed. Verified: 8 report tests in enforce mode and live endpoint checks through the Next proxy. W-07 and W-33 fill in once evaluations and harness runs exist; W-27 waits for A-19.

- 2026-10-17 · Phase 3 jobs and live events (A-28 platform, A-29 plumbing, Q-14): one queue protocol in `backend/src/platform/jobs.ts` and `ai/jobqueue.py` (idempotent enqueue that absorbs repeats only while a job is unfinished, atomic lease claim, heartbeat, retry with 5/20/80 s backoff, `capability_unavailable` failing at once, `attempts_exhausted` after crashes, stage events plus `pipelineRuns`). Consent-checked `POST /submissions/:id/process`, pipeline history, job cancel, and `GET /events` SSE following the capped collection with a tailable cursor, scope filtering and `Last-Event-ID` resume. `pnpm pipeline:replay` (dev only) replays fixture timings marked `replay: true`. Verified: 8 Node and 7 Python queue tests; live trigger → replay → SSE through the Next proxy (fixed: the proxy's gzip buffered the stream until close; SSE now sends `no-transform`).

- 2026-10-17 · Phase 4 HQ admin (W-01, W-02 form, W-04, W-32): `/api/v1/hq` organisations, programmes, versioned rubrics, cohorts (centre-scoped), trades and routing rules; `/api/v1/team` staff and one-time invitations for every staff role in its own organisation; public `/api/v1/invitations/accept` and the `/invite/[token]` sign-up page. HQ desk, team panel for centre and partner staff, cohort panel for centres, and Dev 4's `PartnerWorkspace` now rendered for partner roles. Verified: 10 HQ tests in enforce mode, 20 live checks through the proxy (invite → accept → sign in, single use, cross-centre denial, deactivated centre signs staff out).

- 2026-10-17 · Phase 2 security foundations: tenancy plugin on 14 tenant collections (`warn` by default, `enforce` in Dev 3 tests; `asSystem()` for authorised cross-module helpers), PRD permission matrix in contracts, append-only `recordAudit`, refinement messages returned to clients, Mongoose validation errors as 400. Teammates' routes still compose scopes by spread; migration notes in `backend/src/modules/README.md`.

- 2026-10-17 · Phase 1 end-to-end verification on a live local stack (MongoDB 8.2 standalone, API, dashboard, worker): seed and new `pnpm fixtures:load` both idempotent; stored ObjectIds/Dates, capped `stageEvents`, indexes and encrypted applicant fields confirmed in MongoDB; 29 HTTP checks across seven roles (scope, partner projection, lender rules, origin checks, cookies, logout/revocation) pass twice in a row; dashboard sign-in, session and scoped reads through the Next proxy verified. Fixed: the login limiter counted successful sign-ins and locked out a shared IP after ten logins; it now counts failures only (new test). Not verified here: Docker Compose, Firebase OTP, Android build.

- 2026-10-17 · Phase 1 contracts v1 (D-28): 22 collection schemas plus embedded types in `packages/contracts/schemas/domain/`; generator emits TypeScript types, backend storage types and `ai/contracts` (TypedDicts + `validate()`); Mongoose models built from the bundle with PRD §19 indexes and a capped `stageEvents` collection; `Entrepreneur` with field-bound AES-256-GCM personal data, keyed contact hashes and placeholder detection (`backend/src/crypto.ts`, new `DATA_ENCRYPTION_KEY`, `setup:env` appends missing secrets); `partnerAccess` scope; `scoped()` composition fixing a spread that could override scope; synthetic fixtures for every collection plus a 17-stage event replay. Verified: 48 backend tests (including fixtures against schemas and models, crypto), 13 Python tests, typecheck and build. Contract sign-off was subsequently confirmed by the user; the read-only prototype is still separate from workflow writes.

- 2026-10-17 · Invitation-based staff sign-up replacing demo staff accounts (done by Arnav at the team's request; unified into the contract-based W-01 in the entry above, which kept its fragment links, re-invite revocation, ending sessions on disable, hub-and-spoke parents and bootstrap seed): HQ organisation creation with `parentOrgId`/region/languages/funding mode and deactivation; scoped invitations per PRD §4 with sha256-stored one-time tokens (72 h, single use, re-invite revokes the old link), link shown to the inviter; public preview/accept setting the invitee's own name and password; scoped staff list, role changes and disabling (sessions removed); new `manage_org_users` permission; dashboard **People and access** panel and `/accept-invite` page; seed reduced to one bootstrap HQ admin (`SEED_DEMO_STAFF=true` opt-in for local demos). 6 access tests (107 backend tests in total, org-scope mutation caught); verified in a browser against the production web build: HQ sign-in, invite, accept as a facilitator, reuse refused. Pending: password reset, audit log of access changes (W-08), email delivery, programme/rubric/routing parts of W-01's neighbours (W-02, W-04).


- 2026-10-17 · D-25 documentation: moved seven answered/superseded questions out of the open list, retained 16 pending items, recorded the team roster and five-minute mentor review, and aligned PRD ownership with the four role briefs. Checked all 23 question IDs, matching decision register, links, and unchanged 88 requirement rows; no runtime changes.

- 2026-10-17 · Integration verification: 27 Mongo-backed auth/access tests; TypeScript checks; web/API production builds; Flutter analysis; Docker Compose configuration; all 88 requirement owners; seeded login through the built web proxy and logout; seed idempotence. Live Firebase SMS, Android compilation/device checks and Docker service startup require external/local configuration.

- 2026-10-17 · First milestone foundation: Staff authentication, server-side role/organisation checks, expiring revocable sessions, origin checks, login limiting, role workspaces, synthetic auth seed, shared auth schema and access tests are implemented. Invitation/admin CRUD and business pipelines remain pending.

- 2026-10-17 · Database/D-24 integration: shared IPv4/timeout connection helper, credential-safe diagnostics and optional process DNS configuration; 88-requirement implementation/cost/acceptance matrix and local-only architecture docs. Saved Atlas hostname still returns NXDOMAIN; no external connection or firewall fix is claimed.
