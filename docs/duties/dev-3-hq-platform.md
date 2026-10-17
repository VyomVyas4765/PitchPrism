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

## In progress

None claimed. Earlier claim "Persistent local MongoDB development mode and Redis removal" was delivered under D-26.

## Done

- 2026-10-17 · Invitation-based staff sign-up replacing demo staff accounts (W-01 now `api_ui_partial`; done by Arnav at the team's request): HQ organisation creation with `parentOrgId`/region/languages/funding mode and deactivation; scoped invitations per PRD §4 with sha256-stored one-time tokens (72 h, single use, re-invite revokes the old link), link shown to the inviter; public preview/accept setting the invitee's own name and password; scoped staff list, role changes and disabling (sessions removed); new `manage_org_users` permission; dashboard **People and access** panel and `/accept-invite` page; seed reduced to one bootstrap HQ admin (`SEED_DEMO_STAFF=true` opt-in for local demos). 6 access tests (107 backend tests in total, org-scope mutation caught); verified in a browser against the production web build: HQ sign-in, invite, accept as a facilitator, reuse refused. Pending: password reset, audit log of access changes (W-08), email delivery, programme/rubric/routing parts of W-01's neighbours (W-02, W-04).

- 2026-10-17 · D-25 documentation: moved seven answered/superseded questions out of the open list, retained 16 pending items, recorded the team roster and five-minute mentor review, and aligned PRD ownership with the four role briefs. Checked all 23 question IDs, matching decision register, links, and unchanged 88 requirement rows; no runtime changes.

- 2026-10-17 · Integration verification: 27 Mongo-backed auth/access tests; TypeScript checks; web/API production builds; Flutter analysis; Docker Compose configuration; all 88 requirement owners; seeded login through the built web proxy and logout; seed idempotence. Live Firebase SMS, Android compilation/device checks and Docker service startup require external/local configuration.

- 2026-10-17 · First milestone foundation: Staff authentication, server-side role/organisation checks, expiring revocable sessions, origin checks, login limiting, role workspaces, synthetic auth seed, shared auth schema and access tests are implemented. Invitation/admin CRUD and business pipelines remain pending.

- 2026-10-17 · Database/D-24 integration: shared IPv4/timeout connection helper, credential-safe diagnostics and optional process DNS configuration; 88-requirement implementation/cost/acceptance matrix and local-only architecture docs. Saved Atlas hostname still returns NXDOMAIN; no external connection or firewall fix is claimed.
