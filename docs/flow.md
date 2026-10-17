# Flow

How a submission moves through PitchPrism, who owns each step, and what the four of us hand to each other during the 30 hours. Read this with [decision.md](decision.md); contracts named here live in `packages/contracts`.

**Current ownership (D-23):** Dev 1 = entrepreneur/facilitator + ingestion/language · Dev 2 = centre/cohort + intelligence/eval · Dev 3 = HQ + auth/contracts/platform · Dev 4 = partner types + shared web shell/UI. Every developer owns UI, API, data and integration for their roles. See [the duty index](duties/README.md).

**Local AI update (D-24):** every AI task uses a validated local provider; no hosted inference or automatic fallback. Mobile records offline and queues uploads; heavy compute stays on the worker. Missing capabilities remain pending/failed explicitly. See [local AI setup](../ai/README.md) and [the implementation matrix](implementation-matrix.md).

**Runtime update (D-26):** Redis/BullMQ/Redis Streams are removed. MongoDB jobs with atomic leases and durable stage events are the planned queue replacement; no queue consumer is claimed. `pnpm dev:local` provides a persistent database plus seeded API/dashboard now. iOS development builds are included alongside the primary Android target; Firebase configuration remains pending.

**Phase:** the scaffold/auth foundation is implemented first. Business flow below is the target architecture, not a claim that the queue, AI pipeline, SSE or review features already exist. Older 30-hour scheduling/Dev-number handoff references below are historical; the new role duty briefs and D-23 supersede their staffing assignments.

---

## Part 1 · Product flow

### 1.1 The whole system, one picture

```mermaid
flowchart LR
    subgraph IN["Ways in"]
        M["Mobile pitch<br/>(Dev 1)"]
        B["Bulk import<br/>(Dev 2 · shared platform Dev 3)"]
        F["Facilitator queue<br/>(Dev 1)"]
    end
    API["Node API<br/>(Dev 3)"]
    Q[["MongoDB jobs · planned"]]
    subgraph W["Python worker"]
        R["Read · structure · redact · translate · extract<br/>(Dev 1)"]
        I["Check · compare · locate · score · narrate · rank<br/>(Dev 2)"]
    end
    DB[("MongoDB")]
    WEB["Dashboard<br/>(Role owners · shared shell Dev 4)"]
    M --> API
    B --> API
    F --> API
    API -->|"JobPayload"| Q --> R --> I
    R --> DB
    I --> DB
    I -->|"StageEvent"| API
    API -->|"SSE"| WEB
    API -->|"push"| M
    WEB -->|"decision, feedback, routing"| API
```

### 1.2 Submission lifecycle

One status field, one owner per transition. The dashboard lanes (W-09) are views over these states plus flags.

```mermaid
stateDiagram-v2
    [*] --> DRAFT: created (app or import)
    DRAFT --> QUEUED: process requested
    QUEUED --> PROCESSING: worker picks job
    PROCESSING --> NEEDS_INPUT: follow-ups sent (app channel)
    NEEDS_INPUT --> QUEUED: answers uploaded
    PROCESSING --> UNASSESSABLE: most answers missing or off-topic
    PROCESSING --> READY: card complete
    PROCESSING --> FAILED: unrecoverable error
    FAILED --> QUEUED: retry
    UNASSESSABLE --> QUEUED: resubmitted with help
    READY --> IN_REVIEW: assessor opens card
    IN_REVIEW --> SHORTLISTED: decision
    IN_REVIEW --> NOT_YET: decision
    IN_REVIEW --> NEEDS_INPUT: More info
    SHORTLISTED --> SHARED: consented route sent
    NOT_YET --> QUEUED: resubmission
```

| Transition | Who sets it |
| --- | --- |
| → DRAFT, → QUEUED | API (Dev 3) |
| → PROCESSING, → NEEDS_INPUT, → UNASSESSABLE, → READY, → FAILED | Worker (Dev 1 sets PROCESSING; Dev 2 sets the outcome) |
| → IN_REVIEW, → SHORTLISTED, → NOT_YET, → SHARED | API on dashboard actions (Dev 3, triggered from Dev 4's UI) |

### 1.3 Pipeline stages and hand-off

The worker runs stages in order. After each one it saves results and emits a `StageEvent`, so the card fills in live (A-28). **The hand-off between Dev 1 and Dev 2 is the `extract` stage:** when it finishes, `submission.qa`, `submission.fields` and the transcript segments are final, and Dev 2's stages read only from them.

| # | Stage key | Owner | Reads | Writes | Card section it unlocks |
| --- | --- | --- | --- | --- | --- |
| 1 | `ingest` | Dev 1 | uploaded files | `documents` | Header: format chips |
| 2 | `classify` | Dev 1 | documents | `submission.templateId`, page scripts | Header: template |
| 3 | `read` | Dev 1 | documents | raw segments (STT, text layer, OCR) | Original viewer |
| 4 | `structure` | Dev 1 | raw segments | `submission.qa` (paired, canonical field, overwrite history) | Q&A list |
| 5 | `redact` | Dev 1 | qa, segments | entrepreneur PII, redacted segments, blur boxes | — |
| 6 | `translate` | Dev 1 | segments | `textEn`, `lang`, `translit` | Side-by-side text |
| 7 | `extract` | Dev 1 | translated qa | `submission.fields`, summary, problem addressed | Summary and fields |
| 8 | `quality` | Dev 2 | fields, qa | flags, completeness, financial checks, duplicates | Data-quality panel |
| 9 | `followup` | Dev 2 | flags | follow-up questions or request for information | Missing info box |
| 10 | `normalise` | Dev 2 | fields | tradeKey, sector, location with geo and precision | Trade and map pin |
| 11 | `similar` | Dev 2 | fields, trade, geo | embedding, similarity links | Similar ideas |
| 12 | `local` | Dev 2 | geo, trade, profile | places, statistics, schemes | Local market |
| 13 | `score` | Dev 2 | fields, flags, local | `evaluation` (domains, potential, completeness, band, quadrant, pathway) | Spectrum bar, scores |
| 14 | `narrative` | Dev 2 | evaluation | strengths, gaps, risks, to-validate, interview questions, plan | Narrative |
| 15 | `rank` | Dev 2 | evaluations | `rankSnapshots` | Trade and cohort rank |
| 16 | `feedback` | Dev 2 | evaluation | English feedback draft | Feedback editor |
| 17 | `route` | Dev 2 | trade, district, consents | route suggestions | Routing panel |

If `quality` marks a submission Unassessable, stages 10–17 are skipped except `followup`, which drafts the request in the applicant's language.

### 1.4 Contracts in one place

These are summaries; the JSON Schemas in `packages/contracts/schemas/` are authoritative (D-03).

```jsonc
// JobPayload — API → worker (MongoDB "jobs" collection, claimed with an atomic lease; D-26)
{ "jobId": "uuid", "submissionId": "ObjectId", "fromStage": "ingest", "reason": "new|followup|rescore|retry", "rubricVersionId": "ObjectId", "requestedBy": "userId|entrepreneurId" }

// StageEvent — worker → MongoDB capped "stageEvents" collection → API → SSE event "stage" (planned; D-26, D-29)
{ "submissionId": "ObjectId", "ownerOrgId": "ObjectId", "stage": "translate", "status": "started|done|skipped|failed", "at": "ISO", "ms": 812, "summary": { "segments": 24, "languages": ["te", "en"] } }

// Segment — the unit every claim points to
{ "segId": "s_0007", "source": { "type": "audio|pdf|text", "documentId": "…", "page": 2, "bbox": [x0, y0, x1, y1], "start": 41.2, "end": 63.9 }, "text": "…", "lang": "te", "textEn": "…", "translit": "…", "struck": false, "supersededBy": null, "confidence": 0.93 }

// QA — one question-answer pair after structuring
{ "qId": "q4", "question": "…", "questionLang": "hi", "answerSegIds": ["s_0007"], "canonicalField": "market_research", "state": "answered|missing|not_asked|irrelevant", "overwrites": [{ "from": "Rs 20,000", "to": "Rs 60,000 per month", "segId": "s_0019" }] }

// Flag — every data-quality finding
{ "key": "implausible", "severity": "info|warn|block", "message": "Monthly revenue is 105× the investment", "evidence": ["s_0031", "check:revenue_vs_investment"] }

// Domain score inside an Evaluation
{ "key": "market_potential", "score": 4, "reason": "…", "evidence": ["s_0007", "s_0008"], "confidence": "high", "runs": [4, 4] }
```

SSE event names on `GET /events`: `stage`, `submission.status`, `import.progress`, `queue.changed`. The dashboard needs nothing else to stay live.

### 1.5 Flow: bulk import (the opening of the demo)

```mermaid
sequenceDiagram
    actor A as Assessor
    participant WEB as Centre dashboard (Dev 2)
    participant API as API (Dev 3)
    participant S3 as Storage
    participant WK as Worker (Dev 1 → Dev 2)
    A->>WEB: Drop ZIP, choose cohort
    WEB->>API: POST /imports (cohortId)
    API-->>WEB: importId + signed upload URL
    WEB->>S3: upload ZIP
    WEB->>API: POST /imports/:id/start
    API->>API: unzip, one document per file, group by applicant hints
    loop each submission
        API->>WK: enqueue JobPayload
        WK-->>API: StageEvent ×17
        API-->>WEB: SSE stage / import.progress
    end
    WEB-->>A: queue rows fill in, lanes sort themselves
```

### 1.6 Flow: voice pitch with a follow-up (Sunita)

```mermaid
sequenceDiagram
    actor E as Entrepreneur
    participant APP as App (Dev 1)
    participant API as API (Dev 3)
    participant WK as Worker
    E->>APP: Pick Marathi, consent by voice, answer prompt cards
    APP->>API: POST /submissions, upload audio per card (resumable)
    APP->>API: POST /submissions/:id/process
    API->>WK: JobPayload(reason=new)
    WK-->>API: transcript ready (stage read/translate)
    API-->>APP: push "check your words"
    E->>APP: Edits a word, confirms
    WK-->>API: followup stage: 1 question about price
    API-->>APP: push + question audio (Bulbul)
    E->>APP: Answers by voice
    APP->>API: POST /followups/:qid/answer
    API->>WK: JobPayload(reason=followup, fromStage=read)
    WK-->>API: READY + plan
    API-->>APP: plan audio for read-back
    E->>APP: Confirm
```

### 1.7 Flow: decision, feedback and routing

```mermaid
sequenceDiagram
    actor M as Assessor
    participant WEB as Centre dashboard (Dev 2)
    participant API as API (Dev 3)
    participant WK as Worker (Dev 2)
    actor P as Sector partner
    actor E as Entrepreneur
    M->>WEB: Shortlist, edit feedback
    WEB->>API: POST /decision, PUT /feedback
    API->>WK: translate + voice feedback
    WK-->>API: feedbackLocal + audioUrl
    API-->>E: push: feedback in Telugu
    M->>WEB: Send to suggested agri partner
    WEB->>API: POST /shares (consent checked)
    P->>API: POST /shares/:id/interest
    API-->>E: contact request
    E->>API: accept
    API-->>P: name and phone now visible
```

---

## Part 2 · Build flow (30 hours)

### 2.1 Milestones

Everyone stops for 10 minutes at each checkpoint: show what runs, name what is blocked, re-route help. No slides.

| Hour | Milestone | Proof it's done |
| --- | --- | --- |
| H0–H2 | **Kickoff.** Repo, contracts v1, seed data, persistent local MongoDB or Mongo-only Docker, demo script agreed | `pnpm dev` and `make worker` both start; schemas generate types |
| H2 | ✅ **M1 · Contracts frozen** | `packages/contracts` tagged v1 |
| H8 | ✅ **M2 · Walking skeleton** | Upload one English Idea Brief PDF in the dashboard → worker reads, extracts, scores with a stub → card renders with live stage events |
| H14 | ✅ **M3 · Every format reads** | All three sets go through: digital PDF, handwritten scan, audio. First eval run published. Mobile records and uploads a pitch |
| H20 | ✅ **M4 · Intelligence on** | Similar ideas, local market, ranks, trade and cohort views, follow-up loop, routing work end to end |
| H24 | 🧊 **M5 · Feature freeze** | Full eval run on 55 files; only fixes after this |
| H24–H26 | **Fix week** (two hours) | Worst eval failures fixed; cache warmed for all demo files |
| H26–H30 | **Rehearse** | Demo run three times on a real low-end phone; backup video recorded by H28; deck final |

Take rest in staggered two-hour shifts after M3 so that someone from each half (Python, JS) is always awake.

### 2.2 Who unblocks whom

```mermaid
flowchart LR
    D3a["Dev 3: contracts + seed (H2)"] --> D1a["Dev 1: worker reads Mongo"]
    D3a --> D4a["Dev 4: typed API client"]
    D3b["Dev 3: upload + queue + SSE (H6)"] --> D4b["Dev 4: live card"]
    D3b --> D1b["Dev 1: real jobs"]
    D1c["Dev 1: extract stage done (H8 stub · H14 real)"] --> D2a["Dev 2: quality, score, narrative"]
    D2b["Dev 2: Card JSON complete (H14)"] --> D4c["Dev 4: card v2 sections"]
    D2c["Dev 2: analytics endpoints data (H18)"] --> D4d["Dev 4: trade, cohort, cross-cohort views"]
    D1d["Dev 1: TTS + translation helpers (H12)"] --> D3c["Dev 3: follow-ups and feedback audio in app"]
```

**Rule for being blocked:** never wait. Build against fixtures. Every owner publishes a fixture for what they produce before the real thing works:

| Fixture | Owner | Ready by | Path |
| --- | --- | --- | --- |
| 3 complete `Card` JSONs (Ramesh Goud, Suresh Reddy overwritten, Mohan Lal unassessable) | Dev 2 | H3 | `packages/contracts/fixtures/cards/` |
| `StageEvent` replay stream for one submission | Dev 1 | H4 | `packages/contracts/fixtures/events/` |
| Seed DB dump (orgs, users, cohorts, trades, rubric) | Dev 3 | H2 | `data/seed/` |
| Analytics responses (trade, cohort, compare, clusters) | Dev 2 | H10 | `packages/contracts/fixtures/analytics/` |

### 2.3 Definition of done (for any task)

1. It works on an organiser file named in the manifest, not only a toy input.
2. Types come from `packages/contracts`; nothing re-declares a contract by hand.
3. It emits its `StageEvent` (worker) or handles loading, empty and error states (UI).
4. No personal data in logs, prompts, fixtures or screenshots.
5. One line added to the owner's duty file under "Done", with the requirement ID.
