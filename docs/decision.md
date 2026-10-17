# Decisions

Every decision the team has made, why, and what it costs us. When you want to change one, add a new entry that supersedes it; never edit an old one silently. Requirement IDs (A-, M-, W-, Q-) refer to [PitchPrism.md](../PitchPrism.md).

**Status key:** ✅ Decided · 🟡 Default (holds until someone objects with a reason) · ❓ Open

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

## Open decisions ❓

| ID | Question | Needed by | Who decides |
| --- | --- | --- | --- |
| Q-04 | Which LLM and vision model | H14 (after first eval run) | Dev 2 with the eval report |
| Q-14 | BullMQ Python package or Redis Streams | H4 | Dev 3 |
| Q-18 | Google Places key | H12 | Team lead |
| Q-21 | Can organiser files appear in a public demo? | Before the pitch | Ask organisers |
| Q-22 | Loan ceiling for the funding pathway (₹1 lakh vs ₹2 lakh) | H16 | Team lead |
