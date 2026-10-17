# Dev 4 · Implementation, Sector and Funding Partners

**PRD roles:** Implementation partner reviewer; sector partner reviewer; funding partner reviewer. These remain separate PRD permissions.

**Mission:** Own each partner subtype end to end, including UI, API, data projection, consent enforcement, integrations and tests. Do not collapse partner subtypes into one broad access role.

**Owned modules:** `frontend/features/partners/`; `backend/src/modules/partners/`; shared web shell, navigation and UI components.

## Check before adding logic

Other AI agents may be working on their assigned roles concurrently. **Before adding logic**, read the duty index and other owners’ In progress notes; inspect `git status` and relevant diffs; search for existing/partial implementations, models, endpoints and contracts. Reuse shared logic, coordinate overlapping/shared edits with their owner, and preserve others’ changes. Record your active task and touched modules below before starting.

## Foundation already available

Separate partner accounts/workspaces and consent-scoped reads are implemented. Sector/lender PII is hidden before contact acceptance; revoked shares disappear on the next read. CSR is denied individual submissions. Full partner workflows remain pending.

These are starter capabilities, not completion of the full requirements below. Login secrets belong in the ignored `.env`; all seeded users are synthetic. Never add a role selector that grants access or a fake OTP bypass.

## Order of work

- Build implementation-partner own-submission intake, first-level review, forwarding to the linked centre and own-org analytics.
- Build sector partner consented opportunities, mentoring notes, interest and entrepreneur contact requests.
- Build funding partner consented loan-ready shortlists and aggregate-only CSR reporting at the PRD's existing priority. Preserve lender/CSR modes.
- Own shared dashboard shell/navigation, reusable evidence viewer primitives and UI components. Coordinate viewer data/annotations with Dev 2; never duplicate scoring, ingestion or session logic.
- Consume Dev 1's consent/contact responses, Dev 2's recommendations and Dev 3's user/org/auth services. Re-read active consent and accepted-contact status for every protected read.

PRD priorities and full requirement descriptions remain authoritative. Complete P0 first; do not silently remove lower-priority requirements. See [the duty index](README.md) for shared ownership and cross-role consumers.

## Revised local AI constraints · D-24

Preserve every assigned requirement. Heavy AI remains on the worker; the Android app uses system speech/TTS only after per-device locale/offline checks and does not bundle the main LLM. Use the shared local-only provider policy/registry and adapter; never introduce hosted API fallback, automatic model downloads or a duplicate AI path. Missing capabilities stay pending/failed explicitly. Validate licence, size, peak RAM, latency, six-language/format parity and organiser-data accuracy before adopting a model. AI API spending must be zero; identity, messages, hardware, storage and hosting remain separately costed.

Track implementation, execution, dependency, acceptance and status in [requirements.json](requirements.json), rendered as [the full matrix](../implementation-matrix.md). The current JSON adapter and tiny synthetic test establish plumbing only, not completed AI requirements. Coordinate existing agent work and shared ownership before adding stages. See [local runtime setup](../../ai/README.md).

## Primary requirement checklist

Descriptions and acceptance details: [PRD](../../PitchPrism.md). Each ID has exactly one primary owner in [requirements.json](requirements.json); support dependencies do not change primary ownership.

- [ ] **W-16** · Implementation partner · P0
- [ ] **W-17** · Sector partner · P0 (one partner type in demo)
- [ ] **W-18** · Funding partner · P2

## Acceptance and handoff

Verify implementation-partner own-org scope, sector consent, lender shortlist plus funding readiness, CSR aggregate-only access, contact acceptance before PII and immediate consent revocation. Never send private fields/page images and attempt to hide them with CSS.

A feature is done when UI, API, persistence, permissions, loading/error states, required integrations and relevant tests work together. Publish synthetic fixtures early, document contracts, add a Done entry and notify consuming role owners. No raw organiser PII in code, prompts, fixtures, screenshots or logs.

## In progress

None claimed. The isolated read slice below is ready for review; full W-16/W-17/W-18 workflows remain pending the documented integration dependencies.

## Done

- 2026-10-17 · Isolated partner read slice (not full requirement completion): implementation own-source queue/status totals, sector active-share opportunities and P2 lender shortlist, server-derived workspace/funding mode and explicit CSR report placeholder. Added scoped read router, partner UI with loading/error/empty/filter/pagination/detail states and 34 new integration tests. All 71 backend tests, contracts/backend/web builds, backend/web typechecks, matrix generation, duty coverage and diff checks passed. The synthetic preview bundle compiled; visual browser QA remains pending because no browser is connected. Live db:check stops at missing JWT_SECRET before connecting; no DNS/port diagnosis is claimed. Shared mounts, dashboard, models, auth, contracts, manifests and other owners' files remain untouched. See [the handoff](../../backend/src/modules/partners/HANDOFF.md) for provisional interfaces, exact integration snippets and every unavailable workflow/dependency. W-16/W-17/W-18 remain unchecked and tracked as `feature_partial_unmounted` (read UI/API prepared, production integration and full workflows pending).

- 2026-10-17 · First milestone foundation: Separate partner accounts/workspaces and consent-scoped reads are implemented. Sector/lender PII is hidden before contact acceptance; revoked shares disappear on the next read. CSR is denied individual submissions. Full partner workflows remain pending.
