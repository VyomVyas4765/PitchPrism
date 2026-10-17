# Role-based developer duties

The PRD's roles, permissions, priorities and feature scope are unchanged. Four developers own related role groups, each across frontend/mobile, API, persistence, AI integration and tests. Cohort lead is retained as a centre-scoped persona with its own account role; facilitator and partner types retain separate access.

| Developer | Product roles | Brief |
| --- | --- | --- |
| Dev 1 | Entrepreneur; field facilitator | [Entrepreneur and facilitator](dev-1-entrepreneur-facilitator.md) |
| Dev 2 | Centre assessor; cohort lead | [Centre and cohort](dev-2-centre-cohort.md) |
| Dev 3 | HQ programme admin | [HQ and platform](dev-3-hq-platform.md) |
| Dev 4 | Implementation, sector and funding partner reviewers | [Partners](dev-4-partners.md) |

**Named assignment pending (Q-01):** the team is Vyom, Rayyan, Arnav and Komal. None has yet been assigned to a numbered brief in the recorded decisions. Choose the mapping before parallel role work; the Dev 1–4 responsibility groups above remain unchanged.

## Shared implementations and integration owners

| Capability | Primary owner | Consumers / boundary |
| --- | --- | --- |
| Authentication, permission guards, tenancy, contracts, model definitions, manifests/lockfiles, infrastructure | Dev 3 | All role owners use these foundations; coordinate shared edits |
| Mobile shell, document/audio ingestion, translation/TTS, redaction, question bank, LLM provider plumbing | Dev 1 | All roles consume once; Dev 2 reviews model-adapter interfaces |
| Quality/finance/scoring/similarity/location/plan/feedback/routing intelligence and eval | Dev 2 | All role owners integrate outputs; Dev 3 consumes metrics for HQ |
| Web shell, navigation, evidence-viewer/UI primitives | Dev 4 | Role owners implement their own features using shared components |
| Stage event transport / SSE, queue, cost/timing plumbing | Dev 3 | Devs 1 and 2 emit stage/cost events; role owners consume them |

Shared PRD views W-24, W-26, W-29 and W-30 have Dev 2 as primary implementation owner; Dev 3 integrates HQ scope and entry points without duplicating their logic. W-32 has Dev 3 as primary owner; Dev 2 integrates centre cohort administration with the narrower PRD permissions. W-16 is implemented by Dev 4, who reuses Dev 1's intake and Dev 2's review services. The priority remains exactly as in the PRD, including funding W-18 at P2.

## Coordination before logic

**Other AI agents may be working on their roles concurrently. Check before adding any logic.** Read [AGENTS.md](../../AGENTS.md), inspect working-tree changes and In progress sections, and search for existing implementations. Record your active task in your own brief. Coordinate overlaps with the owner before changing shared interfaces or files; preserve other agents' changes. Each developer updates only their own progress log.

Keep feature code in the role's modules. Shared files have a named integration owner, and consumers request/review the small shared change instead of creating competing authentication, models, schemas or pipelines. Use one branch per task and scoped commits; never reset or stage unrelated work.

## Requirement coverage

[requirements.json](requirements.json) assigns one primary owner to every M-, W- and A- requirement. `pnpm duties:check` verifies coverage against the PRD and owner checklist entries. Requirement descriptions remain in the PRD; a starter screen is not a finished requirement. Historic Dev-number references in older decision entries are superseded by D-23.

## First milestone

Available: repository scaffold, staff login/logout, Firebase phone-verification integration, session expiry/revocation, server-side role/org checks, protected workspace entry points, read-only scoped submission access and access tests. Verified: 27 Mongo-backed tests, web/API builds and types, Flutter analysis, Docker Compose configuration, seed idempotence and login/logout through the built dashboard's API proxy. Pending: Firebase project/device validation, Android build (SDK absent on the setup machine), Docker-backed local run (daemon stopped), full business workflows, full domain contracts, queue consumer, SSE and AI stages. The local AI foundation now reports capability state, provides an Ollama JSON/vision adapter and rejects hosted fallback; it does not process queue jobs. Speech/OCR/translation/embedding stages remain unimplemented and all six languages remain unevaluated.


## Revised architecture and cost tracking · D-24

Keep these four role-based assignments while moving all AI providers to a local, zero-hosted-API baseline. Dev 1 owns local ingestion/language/voice capability evaluation; Dev 2 owns intelligence/embedding/model-quality evaluation; Dev 3 owns local runtime/queue/resource/event integration; Dev 4 consumes shared outputs in partner features. Android captures offline and synchronizes durably; heavy inference stays on the worker. System speech/TTS support must be verified per locale/device and cannot replace a missing required feature silently.

The [implementation matrix](../implementation-matrix.md), sourced from [requirements.json](requirements.json), records all 88 requirements with runtime, implementation/local strategy, dependencies, primary owner, cost exposure, acceptance and status. Regenerate with `pnpm matrix:generate` after updates. No model/requirement is approved by the synthetic local JSON smoke test. See [local AI setup](../../ai/README.md), [runtime evidence](../benchmarks/local-runtime-2026-10-17.json) and [MongoDB diagnostics](../mongodb.md).
