# PitchPrism collaboration rules

Other AI agents may be working on their assigned roles concurrently. Before adding any logic:

1. Read `docs/duties/README.md`, your role brief, and the relevant PRD requirements.
2. Check `git status --short` and relevant diffs; read each affected owner's **In progress** notes.
3. Search with `rg` for existing endpoints, components, models, permissions, contracts, and partially implemented logic. Reuse existing implementations.
4. Record your task, touched modules, and dependencies in your own brief before implementation. Check the same areas again before finalizing your changes.
5. Coordinate overlapping work and shared-interface changes with their listed owner. If ownership is unclear, document a handoff instead of silently duplicating functionality.

Own complete workflows for your assigned PRD roles across UI, API, persistence, AI integration, and tests. Role ownership does not grant permission to replace shared authentication, duplicate AI services, or overwrite another agent's work.

- Dev 1: entrepreneur and facilitator; mobile; shared ingestion/language services.
- Dev 2: centre assessor and cohort lead; shared intelligence and evaluation services.
- Dev 3: HQ admin; shared auth/tenancy/contracts/database/queue/configuration.
- Dev 4: implementation, sector, funding partners; shared web shell/UI primitives.

Shared files (`backend/src/app.ts`, `backend/src/models.ts`, dependency manifests/lockfiles, configuration, contracts) have Dev 3 as integration owner; shared web layout has Dev 4. Put new role logic in its own feature/module and agree the small mount/import change with the integration owner. Never run broad resets, revert unrelated changes, or stage other agents' files. Do not spawn agents unless the user explicitly requests delegation.

Security boundaries are enforced by the backend. Load the current user/org from the session, use permission guards and scoped resource queries, and use explicit partner projections. Never trust role/org/consent values sent by a client. A hidden UI control is not authorization. Extend access tests with each new endpoint. Real organiser data stays private, ignored, and out of fixtures/logs/prompts.

`packages/contracts/schemas/session-user.json` owns auth role/type definitions and `packages/contracts/schemas/domain/` owns every domain type (D-03, D-28; see `packages/contracts/README.md`). Run `pnpm contracts:generate` after schema changes; commit generated outputs. Never hand-edit generated files. Use the contract types, the models in `backend/src/models.ts` and `fixtures/synthetic.json`; never define a competing model, schema or Python type. Combine access scope with route filters through `scoped()` in `backend/src/auth/authorization.ts`, never by object spread. Contracts v1 is published for review: request changes from Dev 3 rather than working around a contract.

Before handoff: run checks appropriate to your changes, add a Done entry, clear your In progress entry, and report pending external configuration accurately. Do not mark a PRD requirement complete just because a starter screen or fixture exists.

The current AI architecture is local-only (D-24), superseding hosted-provider defaults in older docs. All task providers must use `ai/config.py` policy and the shared local adapter/registry; never add API keys, a cloud model selector, paid fallback, automatic downloads, or proxy/redirect forwarding. Missing capability is explicitly pending/failed, not a fabricated assessment. Redact before inference and validate evidence afterward. Check/update `docs/duties/requirements.json` implementation/cost/acceptance/status fields, then run `pnpm matrix:generate` and `pnpm duties:check`. A local model smoke test does not prove six-language, handwriting, licence, memory or organiser-dataset quality.

Database code uses `backend/src/database.ts`; do not add alternate driver settings or disable TLS to fix a network error. Run `pnpm db:check` and distinguish missing DNS from blocked ports. Keep real URIs in ignored root `.env`; never print raw driver errors or commit credentials in `.env.example`.

Current runtime change (D-26): Redis/BullMQ/Redis Streams are removed; do not reintroduce them. The planned queue uses MongoDB leases and durable stage events, still to be implemented/validated. Use explicit `pnpm dev:local` for persistent development MongoDB; never silently replace the private Atlas URI. iOS development builds are now authorised alongside the primary Android target. Keep local HTTP exceptions in Debug only. D-27: sign-in is email and password only (no phone/OTP/SMS); the app is built for iOS only for now.
