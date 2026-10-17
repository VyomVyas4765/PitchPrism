# PitchPrism

AI idea screening for Tata STRIVE, built for Code Odyssey 5.0. Entrepreneurs pitch in their own language; assessors review evidence-linked idea cards. The full product is defined in [PitchPrism.md](PitchPrism.md).

## First milestone: authentication and access

The repository now has a Flutter mobile app (Android + iOS development), Next.js dashboard, Express API, shared auth contracts and a Python worker scaffold. Staff can sign in/out and open protected role workspaces. Entrepreneurs exchange a verified Firebase phone token for an API session. Role, organisation and consent checks run on the server.

Domain contracts v1 are published in [packages/contracts](packages/contracts/README.md): JSON Schemas for all 22 collections, generated TypeScript and Python types, contract-built Mongoose models and synthetic fixtures.

The centre assessment slice now accepts redacted, extracted EDP Idea Brief evidence, runs deterministic checks and local-only scoring, and serves a scoped review card, queue, decisions and feedback draft. App PDF extraction, the durable queue, original-file viewer and the rest of the centre workflow remain integration work; see [centre evaluation](docs/centre-evaluation.md). The starter submission endpoint remains read-only for applicant data; no applicant submissions are seeded. Real OTP needs Firebase project configuration. See [local AI setup](ai/README.md) and the [88-requirement implementation matrix](docs/implementation-matrix.md).

## Quick start

Requirements: Node 22 (see `.nvmrc`) and pnpm 10.17.1. The local development launcher starts a real persistent MongoDB without Docker. Flutter 3.47+/Dart 3.13+ for mobile; Xcode/signing for a physical iPhone; Python 3.11+ for the worker foundation. Docker Compose is an alternative MongoDB runner.

```bash
git config core.hooksPath .githooks   # once per clone: enables the repo's commit hooks
pnpm install
pnpm setup:env          # Creates ignored .env with random secrets; preserves an existing file
pnpm dev:local          # Persistent local MongoDB + synthetic staff seed + API/dashboard
pnpm fixtures:load      # Optional: contract fixtures (a submission, evaluation, events...) with fixture.* staff logins
```

Open http://localhost:3000. The API is at http://localhost:4000/api/v1. `pnpm dev:local` overrides the database URI for its child processes only; the private Atlas URI in `.env` is preserved. Local files live in ignored `local/mongodb/` and survive restarts. Ctrl+C stops the launcher without deleting data. Redis is removed. For a separately managed/Atlas database, use `pnpm seed` and `pnpm dev` after configuring a resolvable URI. Sign in as the bootstrap HQ admin (`SEED_ADMIN_EMAIL`, default `hq_admin@pitchprism.test`) with the `SEED_PASSWORD` value from your local `.env`. Re-running the seed preserves existing credentials/roles and never resets accounts. If `.env` already exists, compare it with `.env.example` and supply missing values yourself.

**Staff join by invitation only** (W-01): there is no public staff sign-up and no role chooser. Under **People and access** on the dashboard, HQ creates organisations (centres and sector/funding partners report to HQ; implementation partners to a centre) and invites anyone; centre staff invite assessors, cohort leads and facilitators to their own centre; partners invite their own organisation's users. The inviter copies the one-time link (it expires after 72 hours) and sends it themselves; the invitee opens it, sees the role and organisation, and sets their own name and password. Admins can change roles within their scope and disable accounts, which takes effect on the next request. For a local demo only, `SEED_DEMO_STAFF=true` also seeds one synthetic account per staff role (`<role>@pitchprism.test`). See [authentication](docs/auth.md).

Entrepreneurs are created only after verified Firebase phone sign-in; see [mobile setup](app/README.md). Cohort lead has the centre's permissions. Funding CSR mode is aggregate-only; the starter individual-record API denies it.

```bash
# Mobile: Android emulator uses 10.0.2.2 to reach the API.
cd app
flutter pub get
flutter run
```

From the repository root, `make worker-setup && make worker` runs the Python capability report. `make worker-check` inspects the local runtime and installed models; `make worker-test` checks local-only policies and structured output. No model is selected/downloaded automatically, and no queue consumer or full AI stages are claimed. The optional Docker MongoDB service persists in its named local volume. Local containers bind to loopback and are development services.

## MongoDB on restricted networks

Put the current Atlas driver URI in the ignored **root `.env`**, then run `pnpm db:check`. The API does not read credentials from `.env.example`. Use `pnpm dev:local` to work now if the Atlas hostname/college network is unavailable; the local database is independent from Atlas. The diagnostic distinguishes missing DNS records, network reachability, TLS and authentication without printing your URI. API startup and seed share IPv4/timeouts and an optional process-only DNS override; TLS remains verified and databases are never switched automatically. See [MongoDB troubleshooting](docs/mongodb.md) for Atlas/network and explicit local-development options.

## Repository layout and ownership

```text
app/                   Flutter Android/iOS entrepreneur / facilitator entry point       Dev 1
frontend/              Next.js role features                                Role owners; shell Dev 4
backend/               Express role modules                                 Role owners; auth/platform Dev 3
ai/ingest/             Reading, redaction, language and extraction            Dev 1
ai/intel/              Quality, finance, scoring and context                  Dev 2
ai/eval/               Organiser-dataset evaluation                           Dev 2
ai/llm/                Shared provider adapter                                Dev 1; Dev 2 reviews
packages/contracts/    Auth schema, generated TS types and permission keys    Dev 3
data/seed/            Synthetic seed notes and future seed data              Assigned owners
datasets/              Private raw files (ignored) and existing catalogue
docs/                 Decisions, flows, design, role duties
```

See [role duties](docs/duties/README.md) for the four assignments and all 88 PRD requirement owners. Each owner delivers their complete role workflows across UI, API, data, AI integration and tests. Shared services are implemented once and reused.

## Checks and production build

```bash
pnpm typecheck
pnpm test               # Access tests use a temporary real MongoDB; no Docker/Firebase credentials
pnpm duties:check
pnpm matrix:generate    # After updating implementation/cost/acceptance records
pnpm contracts:generate # After changing shared schemas; commit generated source
pnpm build
# In app/: flutter analyze
# From root: make worker-test && make worker-check
```

`pnpm build` produces the contracts, API and web build. Start the API with `pnpm --filter @pitchprism/backend start`, and the dashboard with `pnpm --filter @pitchprism/frontend start`. Configure `NODE_ENV=production`, a random `JWT_SECRET`, HTTPS `WEB_ORIGIN`, and the real database. Set `API_PROXY_TARGET` in `frontend/.env.local` (see its example) when the API is not at the default address. Configure the actual proxy chain explicitly before deployment; the API does not blindly trust forwarded client IPs.

Auth roles come from `packages/contracts/schemas/session-user.json` and domain types from `packages/contracts/schemas/domain/` (plus Dev 2's `centre-extracted-input.json`); `pnpm contracts:generate` writes the TypeScript types, the backend storage types and the worker's `ai/contracts` module, all committed. The Python AI worker does not handle authentication.

## Read these first

- [PRD](PitchPrism.md): product roles, permissions and all requirement details.
- [Decisions](docs/decision.md): D-23 records the current layout and developer split.
- [Flow](docs/flow.md): submission lifecycle, stage handoffs and integration flow.
- [Design](docs/design.md): the Broadsheet dashboard / Radio mobile direction.
- [Authentication](docs/auth.md): routes, session and access rules, configuration and limitations.
- [Agent instructions](AGENTS.md): check other agents' work before adding logic.

## Working agreements and privacy

Other AI agents may be working concurrently. Before logic changes, inspect Git status/diffs, search for existing code, and read owner progress notes. Record tasks in your own duty brief. Coordinate shared-interface changes with their owner. Use scoped branches/commits and preserve others' edits.

Keep this repository private. Organiser data contains real applicants' personal details and stays in ignored `datasets/raw/`; put private scratch work in ignored `local/`. Never copy personal details into code, fixtures, prompts, logs, screenshots or issues. The catalogue is at `datasets/manifest.json`; raw files come from the team drive. The original PRD remains at [PitchPrism.v1.md](PitchPrism.v1.md).
