# Dev 4 partner module integration

This branch deliberately leaves `backend/src/app.ts`, `backend/src/models.ts`, auth, contracts, manifests, configuration and the production dashboard untouched. The user requested separate integration with Devs 1–3 later. W-16 and W-17 are P0; W-18 remains P2. None is complete end to end.

## Available now

- `partnerRouter()` in `router.ts` provides read-only partner workspace metadata and scoped, paginated lists against the existing prototype submission collection.
- `PartnerWorkspace` in `frontend/features/partners/partner-workspace.tsx` provides implementation, sector, lender and CSR-specific views, status totals, filters, cursor navigation, detail loading, empty/error/retry states and explicit unavailable-workflow notices. Funding mode comes from the session's organisation on the server.
- Detail reads reuse the existing `/api/v1/submissions/:id` endpoint. No competing auth, consent, contact-acceptance or projection service is introduced. Lists project only `id`, `title` and `status`, even after contact acceptance; detail PII remains controlled by the existing endpoint.
- `backend/tests/partners.test.ts` mounts the module only in an integration test harness using the real shared session middleware, database connection helper and synthetic data. It exercises each new route, partner subtype separation, tenant boundaries, revocation, funding readiness, pagination and malicious filters.
- No AI inference, downloads, hosted provider or assessment fixtures are added. Missing assessment/routing capabilities remain pending.

## Small merge changes to agree with Dev 3

After the shared session middleware and before the 404/error handlers in `backend/src/app.ts`:

```ts
import { partnerRouter } from './modules/partners/router.js';
// ...after app.use('/api/v1', sessions.middleware)
app.use('/api/v1/partners', partnerRouter());
```

The router must remain behind the shared session middleware. It does not parse bearer tokens, choose organisations from requests, create sessions, or modify domain data. Keep the shared origin protection and `no-store` policy.

After `/auth/me` and `/workspaces/:role` have succeeded in the web dashboard, render the component for the three existing partner roles only:

```tsx
import { PartnerWorkspace } from '../../../features/partners/partner-workspace';
// ...inside the authenticated dashboard
{['implementation_partner', 'sector_partner', 'funding_partner'].includes(user.role)
  && <PartnerWorkspace />}
```

This import/render is intentionally not applied yet. Other roles keep their own feature entry points. Frontend role checks provide navigation only; backend guards enforce access. No preview or fixture route is shipped in the production app.

## Temporary interfaces and replacement map

These are provisional module-local **read views**, not frozen Submission/Consent/Review schemas. Dev 3 owns their adoption into JSON Schema/generated contracts under D-03. The frontend's local interfaces and the `workspaces` constant are the exact replacement points when those contracts arrive. There is no temporary persistence, local-storage fallback, fake successful action or write to the prototype model.

| Method / path under `/api/v1/partners` | Current behaviour | Integration/replacement |
| --- | --- | --- |
| GET `/workspace` | Derives kind/list path and unavailable workflows from the current authenticated role and funding mode | Move read-view schema to generated contracts with Dev 3. Funding mode absent/unknown fails with 403; CSR returns no individual list path. |
| GET `/implementation/submissions` | Uses shared `submissionScope` (`sourceOrgId`), including records owned by a linked centre | Replace prototype read fields through the agreed intake/review contract; keep source-org scope. |
| GET `/sector/opportunities` | Requires an active sector share for the current org on every read | Dev 1 supplies authoritative consent lifecycle; Dev 2/3 supply sector eligibility/routing. The prototype has no sector field: this slice relies on existing scoped shares, and does not claim sector matching is implemented. |
| GET `/funding/shortlist` | Requires lender mode, active funding share, SHORTLISTED and fundingReady together | Consume Dev 2's funding readiness evidence once its contract is agreed. The prototype boolean is not an assessment. CSR is denied this route. |

`GET /workspace` returns `{ kind, listPath, pending }`. `kind` is `implementation`, `sector`, `lender` or `csr`. CSR has `listPath: null` and `pending: ['csr_impact_report']`. An unavailable report is not represented as zero impact.

Each list accepts only `status` (`DRAFT`, `READY`, `SHORTLISTED`), `after` (24-hex submission ID) and `limit` (1–50, default 20). Unknown fields, role/org/consent selectors, operators and repeated parameters fail with 400. A filter intersects the server scope; it cannot override the lender's mandatory status. IDs sort descending; `nextCursor` is exclusive. Responses:

```json
{
  "items": [{ "id": "100000000000000000000001", "title": "Synthetic sewing idea", "status": "READY" }],
  "nextCursor": null,
  "summary": { "total": 1, "draft": 0, "ready": 1, "shortlisted": 0 }
}
```

Totals cover the full **accessible** scope, independently of the status/cursor filter. They are status counts only, not cohort ratings or impact analytics. Counts and rows use independent live queries and may change during concurrent updates; no snapshot consistency is promised. The UI replaces a page on each read instead of retaining older pages after a possible consent change. Refresh clears previous details and rechecks workspace mode/access. These are request-time reads, not SSE/push revocation.

The existing title projection is the prototype's permitted summary field. Final domain integration must supply the approved partner-safe summary and evidence projection, rather than expose arbitrary original document text/images. No document images, scores, internal IDs, shares or applicant fields are fetched by the new list queries.

## Unavailable workflows: explicit placeholders, not fake endpoints

The UI lists these under “Coming next”. No mutation button, permissive handler or fake 200 response is present. Route names below are discussion candidates only and are **not registered**; method/path/payload and event semantics need agreement first.

| Requirement / candidate workflow | Dependency owner and agreement needed | Dev 4 follow-through |
| --- | --- | --- |
| W-16 intake/import entry | Dev 1 intake/import service; Dev 3 parent-centre relationship, submission write schema and org guards. PRD bulk intake must preserve centre ownership/source-org attribution and must not impersonate a facilitator. | Partner intake UI/API integration and source-org access tests. |
| W-16 first-level review (`POST /implementation/submissions/:id/reviews`, proposed) | Dev 2 review/recommendation/evidence service; Dev 3 review/audit/version contract. Agree draft/submit states, revision/concurrency and who can edit. | Partner-specific first-level review UX and guarded persistence through the shared service. Do not invent final decision/scoring authority. |
| W-16 forwarding (`POST /implementation/submissions/:id/forward`, proposed) | Dev 3 authoritative linked-centre relation and transition/audit/idempotency contract; Dev 2 centre-queue consumer. The current Org model has no parent centre. | Resolve destination on the server, validate review readiness, forward once and show the centre's acknowledgement. Never trust a client destination or rewrite centre ownership. |
| W-16 fuller own-org analytics/ratings | Dev 2 approved cohort/trade/analytics projections with source-org scope | Consume shared metrics; current totals do not stand in for ratings. |
| W-17 Express interest/contact (`POST /sector/opportunities/:id/contact-requests`, proposed) | Dev 1 authoritative consent/contact request and entrepreneur response service; Dev 3 generated schema/audit/notification transport. Agree request deduplication, pending/accepted/declined/revoked states and safe messages. | Partner request UI/API integration; scope and consent checked on every read/write; PII only after entrepreneur acceptance. Never set contactAccepted from a partner payload. |
| W-17 mentoring notes (`POST /sector/opportunities/:id/mentoring-notes`, proposed) | Dev 2 note model/visibility, Dev 1 entrepreneur-facing sharing, Dev 3 persistence/audit schema | Scoped partner note UI/API integration, preserving consent and visibility boundaries. |
| W-18 CSR aggregate report (`GET /funding/impact`, proposed) | Dev 2 approved impact metrics; Dev 3 programme/org scope, aggregation schema and privacy policy including small groups | Aggregate-only UI/API with no individual rows, names, phones, IDs or drill-down. No global or fabricated report is supplied now. |

## Acceptance remaining after integration

Validation of this slice: all 71 backend tests pass (34 new partner tests plus 37 existing tests), as do contracts/backend/frontend package builds, backend/frontend typechecks, matrix generation, duty coverage and `git diff --check`. The local toolchain exposes pnpm through `corepack pnpm`; the root build script's nested plain `pnpm` invocation is unavailable on this machine, so its three package build commands were run directly without changing manifests or PATH settings.

An ignored synthetic preview harness remains in `local/partner-preview/` (`server.mjs`, `entry.tsx`, navigation shim and generated JS/CSS). It bundles the real component against synthetic API responses and replaces `next/navigation` only inside that local preview. Its bundle compiled successfully; the preview server was stopped. No browser is connected to this session, so visual/mobile/interaction QA is pending. These files are not shipped, imported by production code or evidence of live workflow completion.

The shared credential-safe `db:check` script was attempted; it stops at missing `JWT_SECRET` before connecting. No private `.env` was created or changed. Live database reachability is unverified; neither a DNS fault nor a blocked port is established. Passing Mongo-backed tests use synthetic records in a disposable in-memory server through `backend/src/database.ts`.

Run the existing auth suite plus partner tests after mounting; run web typecheck/build and browser checks through the actual same-origin proxy. Verify accepted contact/PII using Dev 1's real response flow, revocation using the authoritative consent store, sector eligibility, linked-centre delivery, review persistence/concurrency, and final CSR metric privacy. The standalone harness does not prove production mounting or completion of any full PRD workflow.

Do not mark W-16/W-17/W-18 complete until their respective UI, API, persistence, integration and acceptance checks work together. All new fixtures must stay synthetic.
