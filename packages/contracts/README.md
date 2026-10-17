# @pitchprism/contracts

The single source of truth for data shared between the API, the dashboard, the app and the Python worker (D-03, D-28). Owner: Dev 3. Every developer may propose changes; Dev 3 reviews and regenerates.

## What is here

| Path | What it is |
| --- | --- |
| `schemas/session-user.json` | Auth roles, organisation types and the signed-in user |
| `schemas/domain/*.json` | One JSON Schema per domain type. Files with `x-collection` are stored collections; the rest (Segment, QA, FieldValue, Flag) are embedded |
| `schemas/domain/common.json` | Shared value types: ObjectId, DateTime, Language, Stage, CanonicalField, Band, Pathway… |
| `fixtures/synthetic.json` | One contract-valid synthetic document per collection, plus a 17-stage event replay for one job. Build UIs and tests against these |

## Generated outputs (commit them; never edit by hand)

`pnpm contracts:generate` writes:

| Output | Used by |
| --- | --- |
| `src/domain.generated.ts` | TypeScript types (`import type { Submission } from '@pitchprism/contracts'`). IDs and dates are strings, as in JSON |
| `src/schemas.generated.ts` | `domainSchema` (the bundled JSON Schema) and `COLLECTIONS` |
| `backend/src/models/stored.generated.ts` | Storage types for the Mongoose models (`Types.ObjectId`, `Date`) |
| `ai/contracts/generated.py`, `ai/contracts/domain.schema.json` | Python TypedDicts and the bundle; validate with `from ai.contracts import validate` |

The backend builds its Mongoose models from the same bundle (`backend/src/models/schema.ts`), so a field added to a schema exists in the database model, the TypeScript types and the Python types at once.

## Changing a contract

1. Edit or add a file in `schemas/domain/`. Reference shared types as `common.json#/definitions/Name`, other files as `name.json`, and auth enums as `../session-user.json#/definitions/Role`. Give nested objects a `title` so they get a readable type name.
2. Run `pnpm contracts:generate`, then update `fixtures/synthetic.json` so every collection still has a valid example.
3. Run `pnpm test` (backend checks fixtures against the schemas and the models) and `make worker-test` (Python checks the same fixtures).
4. New collection? Add a model with its indexes in `backend/src/models/index.ts` (Dev 3) and tenancy rules in `backend/src/auth/`.
5. Note the change in your duty brief and tell the owners who consume it.

## Rules that the contracts encode

- **No personal data outside `Entrepreneur`.** Names, phones, emails, addresses and social category are stored encrypted on `Entrepreneur` (`*Enc` fields) with keyed `contactHashes` for duplicate matching. Submissions, segments sent to models, stage events, pipeline runs and audit logs carry none.
- **Every claim cites evidence** (D-09): field values, scores, flags and narrative items carry segment IDs (`s_0001`) or computed check IDs (`check:<name>`).
- **`null` score means Not assessed** (D-11), never a low score.
- **Partner access** is decided by `Share` (source of truth) mirrored into `Submission.partnerAccess` by the platform share-sync service only.
- **Stage events and pipeline runs** hold small, non-personal summaries: no prompts or model output (D-24).
