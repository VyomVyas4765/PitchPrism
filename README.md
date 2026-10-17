# PitchPrism

**AI idea screening for Tata STRIVE.** Entrepreneurs pitch a business idea by voice, text, form or handwritten PDF in their own language. PitchPrism reads it, translates it, checks it, compares it with other ideas and the local market, and gives assessors a scored, evidence-linked English idea card with a suggested next step.

Built for **Code Odyssey 5.0** (Tata STRIVE problem statement: AI-powered business idea screening and assessment).

## Read these first

| Doc | What it's for |
| --- | --- |
| [PitchPrism.md](PitchPrism.md) | The PRD (v2): every requirement, with IDs (M-, W-, A-) |
| [docs/decision.md](docs/decision.md) | Decisions made, why, and what's still open |
| [docs/flow.md](docs/flow.md) | How a submission moves through the system, and the 30-hour build plan |
| [docs/design.md](docs/design.md) | "The Broadsheet" design direction |
| [docs/duties/](docs/duties/) | One brief per developer |
| [PitchPrism.v1.md](PitchPrism.v1.md) | The original PRD, kept for reference |

## Team

| Role | Brief | Owns |
| --- | --- | --- |
| Dev 1 · AI ingestion (Python) | [dev-1-ai-ingestion.md](docs/duties/dev-1-ai-ingestion.md) | Reading audio, PDFs and handwriting; translation; PII redaction |
| Dev 2 · AI intelligence and eval (Python) | [dev-2-ai-intelligence.md](docs/duties/dev-2-ai-intelligence.md) | Quality checks, scoring, similar ideas, local market, eval harness |
| Dev 3 · API, data and mobile (Node, Flutter) | [dev-3-api-data-mobile.md](docs/duties/dev-3-api-data-mobile.md) | Contracts, database, queue, live events, the mobile app |
| Dev 4 · Web dashboard (Next.js) | [dev-4-web-dashboard.md](docs/duties/dev-4-web-dashboard.md) | Idea card, bulk import, cohort and trade views |

## Repository layout

The planned layout (docs/decision.md D-02). Folders appear as each developer starts their part.

```
apps/web/           Next.js dashboard              Dev 4
apps/mobile/        Flutter app                    Dev 3
services/api/       Node + Express + Mongoose      Dev 3
services/worker/    Python AI worker               Dev 1, Dev 2
packages/contracts/ JSON Schemas + generated types Dev 3 (all review)
data/seed/          Orgs, cohorts, trades, rubric, schemes, question bank
datasets/           Organiser files (not in git) + manifest.json
docs/               Decisions, flow, design, duties
local/              Your private scratch space (not in git)
```

## Getting started

Setup commands will land here at kickoff (H0–H2). Expected:

```bash
docker compose up -d     # MongoDB + Redis
pnpm install && pnpm dev # API + dashboard
make worker              # Python AI worker
```

## Datasets and privacy

The organiser datasets are **not committed**. Some files are scans of real applicants' handwritten plans with their names, phone numbers and emails (see [D-19](docs/decision.md)). Get them from the team drive and extract into `datasets/raw/`; the catalogue of all 55 files and their expected behaviour is committed at [datasets/manifest.json](datasets/manifest.json).

- Keep this repository **private**.
- Never paste personal details from those files into code, prompts, fixtures, issues or screenshots.
- Put anything personal or experimental in `local/`, which git ignores.

## Working agreements

- Branch per task (`dev1/pdf-reader`, `dev4/idea-card`), PR into `main`, one reviewer.
- Reference requirement IDs in commits and PRs (`A-08: detect struck-through spans`).
- Contracts change only through `packages/contracts` (D-03).
- When you finish something, add a line to the "Done" log in your duty file.
