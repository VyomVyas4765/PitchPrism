# PitchPrism

<div align="center">

### Evidence-led idea screening for Tata STRIVE

Entrepreneurs describe a business idea in their own words. PitchPrism turns that idea into a protected, evidence-linked review card so a centre evaluator can compare opportunities, make a human decision, and guide the entrepreneur to the next step.

<p>
  <a href="#demo-flow">Demo flow</a> ·
  <a href="#run-it-locally">Run locally</a> ·
  <a href="#evaluator-workspace">Evaluator workspace</a> ·
  <a href="#safety-by-design">Safety</a>
</p>

</div>

> Built for Code Odyssey 5.0. This repository contains the evaluator comparison experience, guarded PDF screening preview, centre decision workflow, and iPhone entrepreneur app foundation.

## Why PitchPrism

Business ideas arrive as PDFs, notes, voice, or short answers in a local language. A centre team needs a consistent way to understand them without turning an AI score into an automatic decision.

PitchPrism separates those responsibilities:

- the entrepreneur owns their story and consent;
- the pipeline extracts and redacts evidence;
- AI explains a provisional assessment from cited evidence;
- the evaluator makes the final decision;
- the entrepreneur receives a clear outcome and next step.

## Demo flow

```text
Entrepreneur pitch / two-page idea brief
                    ↓
        Extraction and PII redaction
                    ↓
       Evidence-linked AI assessment
                    ↓
       Centre comparison dashboard
                    ↓
       Human accept / reject decision
                    ↓
  Review, interview, mentoring or funding pathway
```

## Run it locally

### Start the evaluator demo

```bash
pnpm install
pnpm setup:env
pnpm dev:local
```

Open [http://localhost:3000](http://localhost:3000). Seed the isolated evaluator workspace in another terminal:

```bash
pnpm --filter @pitchprism/backend exec tsx src/modules/centre/seed-demo.ts --local
```

Sign in as `evaluator.demo@pitchprism.test` with the existing `SEED_PASSWORD` from the ignored root `.env`, then open `/dashboard/centre_assessor`.

The demo workspace contains synthetic ideas, cohorts, trades, original PDFs, and illustrative fixture assessments. It contains no real applicant consent or organiser data.

## Evaluator workspace

The centre assessor sees the portfolio in one view and can drill into any idea.

### Compare ideas

- Search and filter by cohort, trade, language, review lane, and rubric version.
- Compare two to four ideas side by side.
- View potential distribution, screening quadrant, cohort trends, trade benchmarks, and heatmaps.
- See completeness, evidence coverage, quality flags, suggested pathway, and current human outcome.

### Review an idea

Each idea opens a full review drawer with:

- overall potential score;
- eight scored business domains plus computed completeness;
- domain reasoning and source citations;
- original PDF viewer;
- financial checks and follow-up questions;
- summary plan draft;
- evaluator review and decision controls.

### Decide and respond

The evaluator can:

- **Accept and move forward** — shortlist the idea for the next process;
- **Request more information** — keep the application open for follow-up;
- **Reject application** — record a written explanation for the entrepreneur.

The dashboard refreshes the outcome immediately. The entrepreneur’s Ideas screen receives the human response and a compact AI screening summary. A selected idea can proceed to a centre interview, mentoring, funding-readiness review, or an approved partner referral. Selection is never presented as an automatic loan or investment approval.

### Batch demo mode

Use **Batch upload & evaluate** to upload several supported PDFs at once. The browser evaluates them sequentially and shows per-file progress, failures, pause/resume, retry, and comparison.

Current preview limits are 30 PDFs, 12 MB per PDF, and 120 MB per batch. Preview results are browser-session data and disappear on reload; saved production assessments use the consent-gated workflow.

## How scoring works

The provisional rubric scores these eight domains from 1–5:

| Domain | What it looks for |
| --- | --- |
| Clarity | Offering, customer, and delivery idea |
| Customer need | Who buys, why, and the stated problem |
| Market potential | Evidence of local demand and research |
| Feasibility | Resources, premises, suppliers, and funding plan |
| Competition | Specific alternatives and awareness of them |
| Differentiation | Why customers would choose this idea |
| Revenue logic | Prices, costs, volume, and funding reasoning |
| Readiness | Skills, experience, training, or action already taken |

Completeness is calculated separately. Potential is a weighted average of domains with valid evidence. Missing evidence is shown as **Not assessed**, not silently treated as zero.

## Safety by design

The evaluator pipeline is guarded at every boundary:

- personal identifiers are redacted before inference;
- applicant text is treated as untrusted evidence, never as instructions;
- every score must cite real extracted segments;
- strict structured output validation rejects malformed model responses;
- unsupported citations, duplicate domains, invalid scores, and personal data in reasons fail closed;
- missing evidence does not produce an invented score;
- the model runs twice and disagreement is surfaced for human review;
- AI suggests evidence and pathways, but a human owns the final decision;
- failed extraction or model capability is shown as pending/unassessable rather than fabricated.

The current centre PDF preview supports the known English digital two-page idea brief families. Scans, arbitrary layouts, and multilingual extraction remain separate integration work.

## Repository map

```text
app/                    Flutter entrepreneur and facilitator app
frontend/               Next.js staff dashboards and evaluator workspace
backend/                Express API, sessions, tenancy, centre workflows
ai/                     Extraction, redaction, scoring, review, and worker code
packages/contracts/     Shared JSON schemas and generated TypeScript/Python types
data/seed/              Synthetic seed data and question bank
docs/                   Product decisions, flows, duties, and implementation matrix
```

Main evaluator surfaces:

- `frontend/features/centre/CentreWorkspace.tsx`
- `frontend/features/centre/ComparisonDashboard.tsx`
- `frontend/features/centre/BatchWorkspace.tsx`
- `backend/src/modules/centre/`
- `ai/intel/scoring.py`

## Requirements

- Node 22 and pnpm 10.17.1
- Python 3.11+ for the AI worker foundation
- Flutter 3.47+ and Dart 3.13+ for the mobile app
- Xcode and Apple signing for a physical iPhone
- MongoDB, started automatically by `pnpm dev:local`

The local launcher uses a persistent MongoDB under ignored `local/mongodb/`. It does not replace or print the private Atlas URI in `.env`.

## Useful commands

```bash
pnpm dev:local              # local MongoDB, seed, API, and Next dashboard
pnpm build                  # contracts, backend, and frontend production build
pnpm typecheck              # TypeScript checks
pnpm test                   # backend tests
pnpm duties:check           # requirement and ownership checks
pnpm matrix:generate        # regenerate implementation matrix
pnpm contracts:generate     # regenerate shared contract outputs after schema changes
```

For iPhone development, keep the API running and use:

```bash
pnpm ios
```

See [app/README.md](app/README.md) for device setup and [docs/centre-evaluation.md](docs/centre-evaluation.md) for evaluator pipeline and supported input details.

## Privacy and collaboration

Keep the repository and organiser data private. Real applicant files stay in ignored paths and must never be copied into fixtures, prompts, screenshots, logs, or documentation. Authentication, organisation scope, consent, and permission checks are enforced by the backend.

Read [AGENTS.md](AGENTS.md), [the PRD](PitchPrism.md), and [the implementation matrix](docs/implementation-matrix.md) before changing shared contracts, models, or route mounts.
