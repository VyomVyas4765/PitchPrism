# Role modules

Future role routers/services belong in `entrepreneur/` (Dev 1), `centre/` (Dev 2), `hq/` (Dev 3), or `partners/` (Dev 4). Their owner implements the full workflow, including validation, scoped persistence and access tests. Dev 3 owns the shared auth layer and the router mounts in `src/app.ts`; coordinate that small shared edit rather than duplicating guards.

The current read-only submission endpoint is an access-control foundation, not the complete PRD submission contract. Do not add writes until the contract owner and consuming role owners agree its schema.

## Mounting a router

Dev 3 mounts every router in `src/app.ts`. Give each one its own prefix (`/api/v1/centre`, `/api/v1/partners`, `/api/v1/hq`, `/api/v1/team`). Never mount at `/api/v1` with a router-level `router.use(requirePermission(...))`: that guard would also run for every router mounted after it. Public routes (sign-in, invitation accept) go before `sessions.middleware`, with `authLimiter`.

| Prefix | Owner | Notes |
|---|---|---|
| `/api/v1/invitations/accept` | Dev 3 | Public. `GET /:token` preview, `POST /` creates the account and signs it in |
| `/api/v1/password-reset` | Dev 3 | Public. `POST /preview`, `POST /` for one-time reset links |
| `/api/v1/account` | Dev 3 | `POST /password` for signed-in staff |
| `/api/v1/team` | Dev 3 | `invite_users`: staff list, role and access changes, invitations (own organisation; HQ any) |
| `/api/v1/hq` | Dev 3 | Organisations, programmes, versioned rubrics, cohorts (centre-scoped), trades, routing rules |
| `/api/v1/hq/reports` | Dev 3 | HQ only: pipeline, funnel, pipeline health, fairness, second-review sampling, audit log, model quality, idea map |
| `/api/v1` (pipeline) | Dev 3 | Route-level guards: `POST /submissions/:id/process`, `GET /submissions/:id/pipeline`, `POST /jobs/:id/cancel`, `GET /events` (SSE; `submissionId`, `Last-Event-ID`) |
| `/api/v1/centre` | Dev 2 | |
| `/api/v1/partners` | Dev 4 | |
| `/api/v1` (last) | Dev 1 | Entrepreneur and facilitator routes |

## Tenant queries (PRD section 19)

Tenant collections (submissions, entrepreneurs, consents, documents, evaluations, jobs and the others marked `tenant: true` in `src/models/index.ts`) check every query made inside a request:

```ts
Submission.find(filter).setOptions({ tenant: submissionScope(req.auth!) }); // scope added with $and
Entrepreneur.findById(id).setOptions({ tenant: 'system' });                  // deliberate, after an access check
```

`TENANCY_MODE` is `enforce` by default (D-31): an unscoped query on a tenant collection inside a request throws, so a forgotten scope fails a test instead of leaking data. `warn` logs each call site once and `off` disables the check; use them only to debug. Never build a scope by object spread (`{ _id, ...submissionScope(auth) }`): use the `tenant` option or `scoped(scope, filter)`. For an upsert, put the scoped key only in the `tenant` option (filter `{}`), because MongoDB cannot seed an insert from a path matched twice. Saving a loaded document (`doc.save()`) and `Model.create` are not queries and are not checked: load the document through a scoped query first.
