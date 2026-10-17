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

- [ ] **W-01** · HQ · P0
- [ ] **W-02** · HQ · P0 (form), P1 (visual builder)
- [ ] **W-03** · HQ · P0
- [ ] **W-04** · HQ · P0
- [ ] **W-05** · HQ · P0
- [ ] **W-06** · HQ · P1
- [ ] **W-07** · HQ · P1
- [ ] **W-08** · HQ · P1
- [ ] **W-27** · HQ · P1
- [ ] **W-32** · HQ, Centre · P0
- [ ] **W-33** · HQ · P1
- [ ] **A-28** · Live card · P0
- [ ] **A-29** · Cost and timing · P1

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

2026-10-17 · Phase 2, security foundations (tenancy plugin, permission matrix, audit middleware, role router mounting) · touches `backend/src/auth/`, `backend/src/models/`, `backend/src/app.ts`, `packages/contracts/src/index.ts` · contracts v1 awaiting review by Devs 1, 2 and 4.

## Done

- 2026-10-17 · Phase 1 end-to-end verification on a live local stack (MongoDB 8.2 standalone, API, dashboard, worker): seed and new `pnpm fixtures:load` both idempotent; stored ObjectIds/Dates, capped `stageEvents`, indexes and encrypted applicant fields confirmed in MongoDB; 29 HTTP checks across seven roles (scope, partner projection, lender rules, origin checks, cookies, logout/revocation) pass twice in a row; dashboard sign-in, session and scoped reads through the Next proxy verified. Fixed: the login limiter counted successful sign-ins and locked out a shared IP after ten logins; it now counts failures only (new test). Not verified here: Docker Compose, Firebase OTP, Android build.

- 2026-10-17 · Phase 1 contracts v1 (D-28): 22 collection schemas plus embedded types in `packages/contracts/schemas/domain/`; generator emits TypeScript types, backend storage types and `ai/contracts` (TypedDicts + `validate()`); Mongoose models built from the bundle with PRD §19 indexes and a capped `stageEvents` collection; `Entrepreneur` with field-bound AES-256-GCM personal data, keyed contact hashes and placeholder detection (`backend/src/crypto.ts`, new `DATA_ENCRYPTION_KEY`, `setup:env` appends missing secrets); `partnerAccess` scope; `scoped()` composition fixing a spread that could override scope; synthetic fixtures for every collection plus a 17-stage event replay. Verified: 48 backend tests (including fixtures against schemas and models, crypto), 13 Python tests, typecheck and build. Contracts await review; no workflow writes added.

- 2026-10-17 · D-25 documentation: moved seven answered/superseded questions out of the open list, retained 16 pending items, recorded the team roster and five-minute mentor review, and aligned PRD ownership with the four role briefs. Checked all 23 question IDs, matching decision register, links, and unchanged 88 requirement rows; no runtime changes.

- 2026-10-17 · Integration verification: 27 Mongo-backed auth/access tests; TypeScript checks; web/API production builds; Flutter analysis; Docker Compose configuration; all 88 requirement owners; seeded login through the built web proxy and logout; seed idempotence. Live Firebase SMS, Android compilation/device checks and Docker service startup require external/local configuration.

- 2026-10-17 · First milestone foundation: Staff authentication, server-side role/organisation checks, expiring revocable sessions, origin checks, login limiting, role workspaces, synthetic auth seed, shared auth schema and access tests are implemented. Invitation/admin CRUD and business pipelines remain pending.

- 2026-10-17 · Database/D-24 integration: shared IPv4/timeout connection helper, credential-safe diagnostics and optional process DNS configuration; 88-requirement implementation/cost/acceptance matrix and local-only architecture docs. Saved Atlas hostname still returns NXDOMAIN; no external connection or firewall fix is claimed.
