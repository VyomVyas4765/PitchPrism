# Decisions

Every decision the team has made, why, and what it costs us. When you want to change one, add a new entry that supersedes it; never edit an old one silently. Requirement IDs (A-, M-, W-, Q-) refer to [PitchPrism.md](../PitchPrism.md).

**Status key:** ✅ Decided · 🟡 Default (holds until someone objects with a reason) · ❓ Open

**Current implementation:** D-23 supersedes the earlier folder names and technical-specialty split; D-24 supersedes hosted AI defaults with the local-only baseline. D-25 reconciles the question register with current evidence. Product requirements/permissions remain in the PRD.

## Index

| ID | Decision | Status | Owner |
| --- | --- | --- | --- |
| D-01 | Expand scope; priorities set build order, not cuts | ✅ | All |
| D-02 | Monorepo with four apps and one contracts package | ✅ | Dev 3 |
| D-03 | Contracts as JSON Schema, generated into TypeScript and Pydantic | ✅ | Dev 3 |
| D-04 | Python AI worker beside the Node API | ✅ | Dev 1, Dev 2 |
| D-05 | BullMQ on Redis between Node and Python | 🟡 | Dev 3 |
| D-06 | MongoDB Atlas for data, vectors and geo | ✅ | Dev 3 |
| D-07 | Sarvam AI for every language job | ✅ | Dev 1 |
| D-08 | LLM behind an adapter, open-weights by default | 🟡 | Dev 2 |
| D-09 | Every value cites a segment, or it is dropped | ✅ | Dev 1, Dev 2 |
| D-10 | Language is detected per answer, not per document | ✅ | Dev 1 |
| D-11 | Missing is not weak; completeness is a separate axis | ✅ | Dev 2 |
| D-12 | Totals, bands, ranks and pathways are computed in code | ✅ | Dev 2 |
| D-13 | PII is redacted before any model or map call | ✅ | Dev 1 |
| D-14 | Duplicates are flagged, never merged automatically | ✅ | Dev 2 |
| D-15 | OpenStreetMap first; Google Places only if a key appears | 🟡 | Dev 2 |
| D-16 | The organiser dataset is our eval ground truth | ✅ | Dev 2 |
| D-17 | Live card over server-sent events | ✅ | Dev 3, Dev 4 |
| D-18 | Editorial design direction: "The Broadsheet" | ✅ | Dev 4 |
| D-19 | Real applicant data stays private and redacted | ✅ | All |
| D-20 | Android only; assessors use web only | 🟡 | Dev 3 |
| D-21 | Staff auth by JWT cookie; entrepreneurs by Firebase OTP | 🟡 | Dev 3 |
| D-22 | Demo runs on cached results with a live path | ✅ | All |
| D-23 | Auth-first foundation; role-based duties and requested folder names | ✅ | All |
| D-24 | Full scope, local-only AI; lean Android; explicit cost/capability evidence | ✅ | All |
| D-25 | Reconcile answered, superseded and still-open PRD questions | ✅ | All |

---

### D-01 · Expand scope; priorities set build order, not cuts ✅

**Context.** We have 30 hours and 4 developers. Every team shares the same five problem statements, so ours has to stand out.
**Decision.** Build everything in the PRD. P0 is built first, then the stretch items in §23. Nothing is cut in advance.
**Consequences.** Each duty file lists its order of work. If an item is going to miss the H24 freeze, its owner says so at the H20 checkpoint so we can re-route help, not drop it quietly.

### D-02 · Monorepo with four apps and one contracts package ✅

```
pitchprism/
├─ apps/
│  ├─ web/          Next.js dashboard            (Dev 4)
│  └─ mobile/       Flutter app                  (Dev 3)
├─ services/
│  ├─ api/          Node + Express + Mongoose    (Dev 3)
│  └─ worker/       Python AI worker             (Dev 1, Dev 2)
│     ├─ ingest/    A-01..A-12                   (Dev 1)
│     ├─ intel/     A-13..A-27                   (Dev 2)
│     └─ eval/      A-30 harness                 (Dev 2)
├─ packages/
│  └─ contracts/    JSON Schemas + generated types (Dev 3 owns, all review)
├─ data/seed/       orgs, cohorts, trades, rubric, schemes, question bank
├─ datasets/        organiser files + manifest.json (read-only)
└─ docs/            this folder
```

**Consequences.** One clone, one README, one `docker compose up` for Mongo and Redis. Dev 1 and Dev 2 share `services/worker` but own separate packages, so they rarely touch the same file.

### D-03 · Contracts as JSON Schema, generated into TypeScript and Pydantic ✅

**Context.** Node writes some collections and Python writes others. Both read the idea card.
**Decision.** `packages/contracts/schemas/*.json` is the single source of truth for: `Submission`, `Segment`, `QA`, `Evaluation`, `Flag`, `Card`, `JobPayload`, `StageEvent`, `ImportBatch`. TypeScript types come from `json-schema-to-typescript`; Pydantic models from `datamodel-code-generator`. Generated files are committed.
**Consequences.** Contract v1 is frozen at H2. After that, a change needs a PR touching the schema plus a note in the team channel; the generator runs in a pre-commit hook.

### D-04 · Python AI worker beside the Node API ✅

**Context.** PDF layout parsing (PyMuPDF), audio chunking (ffmpeg plus Silero VAD), embeddings and clustering are Python-first.
**Decision.** Node keeps auth, scoping, CRUD and SSE. Python does all AI work and writes results straight to MongoDB. Python never serves end users.
**Consequences.** Two runtimes to deploy. The worker reaches Mongo through its own scoped repository layer, with no user-facing queries, so the tenancy plugin in Node stays the only door for users.

### D-05 · BullMQ on Redis between Node and Python 🟡

**Decision.** The API enqueues `pipeline` jobs with BullMQ; the worker consumes with BullMQ's Python package. Stage progress goes back over Redis pub/sub on channel `stage-events`.
**Fallback.** If the Python package misses something by H4 (Q-14), switch to Redis Streams with one consumer group. The `JobPayload` contract does not change.

### D-06 · MongoDB Atlas for data, vectors and geo ✅

**Decision.** One Atlas cluster in an India region. Atlas Vector Search on `ideaEmbeddings`, a 2dsphere index on `submissions.location.geo`, a TTL index on `placesCache`.
**Fallback.** Local dev uses a Mongo container; vector search falls back to in-memory cosine in the worker (fine below about 5,000 ideas).

### D-07 · Sarvam AI for every language job ✅

**Decision.** STT (Saaras v3), translation, transliteration, TTS (Bulbul v3) and Document AI all come from Sarvam. Audio is chunked under 30 s and transcribed in parallel; anything over 10 minutes goes to the Batch API.
**Consequences.** One vendor for Indian languages. We cache every Sarvam response by content hash, so re-runs during development and the demo cost nothing.

### D-08 · LLM behind an adapter, open-weights by default 🟡

**Decision.** `worker/llm/adapter.py` exposes `complete_json(prompt, schema, temperature=0.1)` and `vision_json(images, prompt, schema)`. The default is an open-weights model (PS consideration f); the provider is set in config. The eval harness picks the final models (Q-04).
**Consequences.** Prompts never import a vendor SDK. Every call logs model, tokens, cost and latency (A-29).

### D-09 · Every value cites a segment, or it is dropped ✅

**Decision.** Extraction, quality judgements, scores and narrative must reference segment IDs or computed check IDs. The validator removes anything uncited before saving.
**Why.** This makes "click any score, see the proof" true by construction, and stops the model filling in answers that were never given.

### D-10 · Language is detected per answer, not per document ✅

**Why.** The organiser data has Hindi questions with Telugu answers, Telugu questions with Hindi answers, and answers that switch language mid-sentence.
**Consequences.** `Segment.lang` is required. Language mismatch is shown as information and never scored.

### D-11 · Missing is not weak; completeness is a separate axis ✅

**Decision.** This supersedes v1's "cap missing criteria at 2". A domain with no evidence is `null` (Not assessed). Potential is computed over assessed domains, completeness is its own 0–100 score, and coverage below 60% gives the band "Insufficient information".
**Why.** Assessors need to tell a weak idea from an incomplete form. The screening quadrant depends on it.

### D-12 · Totals, bands, ranks and pathways are computed in code ✅

**Decision.** The LLM scores each domain 1–5 with a reason and evidence, twice. `intel/scoring.py` computes potential, completeness, coverage, band, quadrant, pathway and disagreement. `intel/finance.py` computes the EDP formulas (A-14).
**Why.** Arithmetic must be deterministic, testable and explainable.

### D-13 · PII is redacted before any model or map call ✅

**Decision.** `ingest/pii.py` moves name, phone, email, exact address and social category to the encrypted entrepreneur record and replaces them in segments with tokens (`⟨NAME⟩`, `⟨PHONE⟩`). Their bounding boxes are stored so page images can be blurred per role.
**Consequences.** Each prompt template has a test that fails if a phone or email pattern reaches it.

### D-14 · Duplicates are flagged, never merged automatically ✅

**Why.** The organiser data has one phone number shared by different people with different ideas, and a dummy contact on ten forms.
**Decision.** We create a `similarityLinks` record with a reason; a human links or dismisses it (W-35).

### D-15 · OpenStreetMap first; Google Places only if a key appears 🟡

**Decision.** Overpass for nearby businesses, Nominatim for geocoding, India Post pincode directory and LGD codes for normalisation. Everything is cached for 30 days and the map shows OSM attribution. Google Places plugs into the same `PlacesProvider` interface if Q-18 brings a key.

### D-16 · The organiser dataset is our eval ground truth ✅

**Decision.** `datasets/manifest.json` defines expected behaviour per file. `services/worker/eval` runs all 55 files and writes `eval/reports/<timestamp>.json` plus a Markdown summary. It runs at every checkpoint from H14 onwards and before the demo.
**Consequences.** "It works" means "the eval report says so". Audio entries get ground truth after the first transcription run, checked by a native speaker.

### D-17 · Live card over server-sent events ✅

**Decision.** The worker publishes a `StageEvent` per stage; the API relays it on `GET /events` filtered by the viewer's scope; the dashboard patches the card in place. The mobile app gets push only on status changes.

### D-18 · Editorial design direction: "The Broadsheet" ✅

**Decision.** The dashboard reads like a well-edited newspaper about each entrepreneur's idea: serif headlines, column rules, pull-quotes for evidence, proofreader's marks for data-quality flags, and a spectrum bar that splits each idea into its nine assessment domains, like light through a prism. Full system in [design.md](design.md).
**Why.** Every other team will ship a generic SaaS dashboard. A screening tool is fundamentally about reading carefully, so the design should look like careful reading.

### D-19 · Real applicant data stays private and redacted ✅

**Context.** `datasets/raw/pdfs/hindi/*` are scans of real people's plans with real contact details.
**Decision.** The repository is private. `datasets/raw/` is git-ignored if the repo ever becomes public. These files appear in the demo only with redaction on, and their personal details are never copied into docs, prompts, fixtures or screenshots.

### D-20 · Android only; assessors use web only 🟡

Per Q-06 and Q-07. The Flutter app targets Android 8+ on 2 GB RAM devices.

### D-21 · Staff auth by JWT cookie; entrepreneurs by Firebase OTP 🟡

Per Q-11. Seeded staff accounts per role for the demo, with one-click role switching in dev builds only.

### D-22 · Demo runs on cached results with a live path ✅

**Decision.** All 55 organiser files are pre-processed and cached before the demo. On stage, the bulk import replays at live speed from cache, while Sunita's voice pitch and one fresh upload go through the real pipeline. A recorded backup video exists by H28.

---

## Remaining decisions and confirmations ❓

Current register after D-25. The complete answered/partial/open classification is in [PRD §26](../PitchPrism.md#26-decision-status-and-remaining-questions). A default is not an answer, and local runtime availability is not model validation. Historical references in earlier entries are preserved.

| ID | Remaining question | Needed by | Owner / current status |
| --- | --- | --- | --- |
| Q-01 | Assign Vyom, Rayyan, Arnav and Komal to the four existing role briefs | Before parallel role work | Team; roster/split known, named assignments missing |
| Q-02 | Confirm final demo duration and screening round | Before final rehearsal | Organisers; mentor review is 5 min, final script assumes 8 min |
| Q-03 | Obtain actual EDP rubric and application volumes | Before rubric/scale claims | Organisers / Tata STRIVE; templates and 55 files already supplied |
| Q-04 | Approve local LLM/vision models from licence/RAM/language/format evaluation | Benchmark early; original H14 eval gate | Dev 2 with Dev 1; runtime/budget settled, no model approved |
| Q-05 | Confirm live languages and named Odia/Bengali transcript validators | Before language-quality claims and rehearsal | Dev 1 + Dev 2 / team; Hindi/Telugu/Marathi remain the live default |
| Q-08 | Confirm simultaneous application and centre-assignment policy | Before domain-contract freeze | Team, with organiser input if needed; one active submission/programme is provisional |
| Q-12 | Verify applicable data-protection rules and consent timelines | Before pitch/pilot compliance claims | Team obtains authoritative review; no new legal conclusion recorded |
| Q-13 | Confirm production hosts, actual regions, resources and operating budget | Before deployment/residency claims | Dev 3 / team; local development exists, India production target unverified |
| Q-14 | Validate BullMQ Python handoff or select Redis Streams fallback | H4 | Dev 3 with Devs 1/2; consumer/retry/progress behavior not yet tested |
| Q-15 | Confirm required Tata STRIVE system integrations | Before integration scope is locked | Organisers / Tata STRIVE; link out is only the default |
| Q-16 | Confirm judging criteria and weights | Before final pitch priorities | Organisers; equal weights are provisional |
| Q-19 | Confirm application-platform export/API availability | Before promising automated integration | Organisers; manual/bulk upload baseline |
| Q-20 | Obtain official trade list and cohort definition | Before taxonomy/benchmark claims | Tata STRIVE; local NIC list/cohort definition provisional |
| Q-21 | Obtain permission for public use of organiser files | Before public demo/publication | Organisers; redaction alone does not grant permission |
| Q-22 | Confirm funding-recommendation loan ceiling | H16 / before recommendation claims | Organisers / Tata STRIVE; form arithmetic ₹1 lakh, funding suggestion ₹2 lakh provisional |
| Q-23 | Confirm social-category collection/use policy | Before relying on collection/eligibility policy | Tata STRIVE; optional/encrypted/scheme-or-aggregate-only is provisional |


### D-23 · Auth-first foundation, role-based duties and requested folder names ✅

**Context.** The team requested a basic starter with `app/`, `frontend/`, `backend/` and `ai/`, then chose authentication/authorization as the first milestone before role-specific feature work.

**Decision.** This supersedes D-02's directory names and the technical-specialty staffing split in the original build plan; runtime choices remain Flutter, Next.js, Express/Mongoose and Python. Dev 1 owns entrepreneur/facilitator workflows and shared ingestion/language services; Dev 2 owns centre/cohort workflows and shared intelligence/eval; Dev 3 owns HQ workflows plus auth/contracts/platform; Dev 4 owns all partner subtypes plus the shared dashboard shell/UI. Every role owner implements UI, API, data, integrations and tests for their workflows. PRD roles, permissions, priorities and requirements remain unchanged. Cohort lead is a centre-scoped role; CSR and lender remain funding-organisation modes.

**Foundation.** Password-based staff auth and Firebase phone-token exchange; database-backed expiring/revocable JWT sessions, role/org-type validation, permission guards, scope-aware read access and consent/contact-aware partner projection. Shared auth roles/types come from JSON Schema. Domain schemas and Python model generation remain D-03 follow-up work; the read-only submission model is a starter boundary demonstration, not the frozen domain contract. Real Firebase OTP needs project/device configuration.

**Coordination.** Other agents may work concurrently: check owner briefs, In progress logs, Git changes and existing implementations before adding logic. Reuse shared services and coordinate shared edits with their primary owner. The current duty index and one-owner requirement mapping are authoritative for build ownership; earlier Dev-number references are historical. No product role is removed or merged because one developer owns several related roles.

**Current phase.** Scaffold/auth first, verify access boundaries, then implement each role's assigned PRD workflows. Docker Compose provisions local MongoDB/Redis. No queue consumer, SSE stream or AI stage is claimed by the scaffold. The updated [duty index](duties/README.md) owns future work; [auth.md](auth.md) documents the initial API.


### D-24 · Local-only AI, full scope and lightweight Android ✅

**Context.** The revised architecture requires all original features while spending ₹0 on hosted AI APIs and keeping Android lightweight. This supersedes D-07's hosted Sarvam requirement, D-08's hosted-provider default, and provider-dependent paths in the original architecture. It does not reinstate the technical-specialty developer split: the user-approved four role-based assignments in D-23 remain.

**Decision.** Keep Node auth/organisation/consent APIs and the Python worker. Android captures voice/text/files, stores offline drafts and a durable sync queue, and uses system speech/TTS only after actual per-locale/offline validation. Main LLM/OCR/translation/embedding compute stays on the worker. All six launch languages, handwriting, evidence links, deterministic finance/scoring, duplicate review, nearby context and complete organisation workflows remain required.

**Provider boundary.** Local-only configuration rejects hosted inference, remote endpoints/cloud model selectors, redirects and environment proxy forwarding. No automatic downloads or paid fallback. Missing capability remains pending/failed visibly. The first adapter targets already installed local Ollama weights and validates structured JSON; local STT/OCR/translation/transliteration/embedding/TTS model choices remain unevaluated. Configure the daemon itself with cloud disabled too. Licence, RAM, latency and organiser-language accuracy must be measured before adopting models.

**Evidence and budget.** The observed development machine has an M2, 8 CPU cores and 8 GiB memory. An existing ~2 GB llama3.2 model passed a tiny English JSON smoke test in ~10 seconds, not the 55-file evaluation. File size is not peak RAM. Start with one worker job at a time once a queue exists. The Nothing Phone (3a) is a target test device, not an assumed inference server. Hosted AI API cost is zero by policy; compute/electricity, storage, identity/SMS/WhatsApp and production hosting remain separate costs with no guaranteed free tiers.

**Tracking.** Every requirement has an implementation/local strategy, execution location, dependencies, owner, cost exposure, acceptance and status in [the matrix](implementation-matrix.md). Preserve existing metrics and priorities. No pipeline stage is marked complete just because its interface exists. [Runtime evidence](benchmarks/local-runtime-2026-10-17.json) and [local AI setup](../ai/README.md) record the actual verification limits.


### D-25 · Reconcile the PRD question register with established decisions ✅

**Context.** The original Q-01–Q-23 register mixed chosen baselines, obsolete questions, unanswered external policy questions and technical checks that have not run. It also retained the old technical-specialty staffing description after D-23 and the API-credit question after D-24.

**Decision.** Remove Q-06, Q-07, Q-09, Q-10, Q-11, Q-17 and Q-18 from the open register and keep their answers in PRD §26.1. Android-only and web assessor access, centre ownership, Firebase and the PitchPrism name are established choices. OSM is the current baseline; no Google key is needed to proceed. Funding W-18 remains owned by Dev 4 at P2; existing auth/access foundations do not mean the shortlist or CSR reports are complete. This supersedes the old binary funding/vision-only and Google-key questions for the current baseline without changing requirement priorities.

**Partly answered.** The four developers are Vyom, Rayyan, Arnav and Komal; their assignment to the four role-based briefs remains Q-01. The mentor review is five minutes; final demo/screening format remains Q-02. Real templates and 55 sample files do not answer Q-03's official rubric/volume questions. Q-04 no longer asks for API credits: local-only processing and the ₹0 hosted AI budget are settled, while reasoning/vision selection, licences and required evaluation remain open. Q-13 distinguishes actual local development from unverified production hosts/regions/costs.

**Still open.** Preserve Q-05, Q-08, Q-12, Q-14, Q-15, Q-16 and Q-19–Q-23. Do not convert working defaults into organiser approvals, use a local JSON smoke test to approve multilingual/vision models, or treat Redis availability as a BullMQ compatibility test. Retain Q-04's original H14 first-eval gate and Q-14's H4 checkpoint; benchmark locally early. These are planned checkpoints, not results. No legal review, organiser contact, person-to-role assignment or new runtime implementation occurred in this documentation update.

**Consequences.** PRD §23 now describes the current role split with named assignments explicitly unfilled. PRD §24 separates the confirmed five-minute mentor review from the assumed eight-minute final script. PRD §26 contains seven settled/superseded items and 16 genuinely pending questions, mirrored in the current register above. Original question IDs and earlier decision entries remain intact for traceability.
