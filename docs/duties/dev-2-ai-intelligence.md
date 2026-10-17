# Dev 2 · AI Intelligence and Eval

**Mission.** Turn what Dev 1 read into *judgement*: what's missing or wrong, how good the idea is and why, who else is proposing the same thing, what already exists on that street, and what should happen next — then prove it works on the organisers' own files.

You own the brain and the scoreboard.

| | |
| --- | --- |
| **Stack** | Python 3.11 · pydantic · sentence-transformers (BGE-M3 class) · scikit-learn (HDBSCAN) · umap-learn · rapidfuzz · httpx (Overpass, Nominatim) |
| **Code** | `services/worker/intel/` · `services/worker/eval/` · shared `services/worker/llm/` with Dev 1 |
| **Requirements** | A-13 to A-30 · data behind W-10, W-21 to W-28, W-30, W-31, W-33 |
| **Pipeline stages** | `quality` → `followup` → `normalise` → `similar` → `local` → `score` → `narrative` → `rank` → `feedback` → `route` |
| **You receive from** | Dev 1: final `qa`, `fields`, segments after `extract` |
| **You hand to** | Dev 4 via the `Card` JSON and analytics payloads; Dev 3 for analytics endpoints |

---

## What "done" looks like

- The eval report on all 55 files meets the targets in PRD §17, and it is on the model-quality page.
- Every card has: flags with evidence, domain scores with quotes, potential + completeness + coverage, band, quadrant, pathway, strengths, gaps, risks, to-validate, interview questions, similar ideas, local market, trade and cohort rank.
- No number on a card was produced by the LLM. All arithmetic is in code (D-12).

---

## Order of work

### H0–H2 · Kickoff (with everyone)
- [ ] Agree `Evaluation`, `Flag`, `Card` schemas with Dev 3 and Dev 4
- [ ] Seed `data/seed/rubric.v1.json` from PRD §13 (8 domains + completeness, weights, descriptors, band thresholds, pathway rules)
- [ ] Seed `data/seed/trades.json`: ~25 trades covering every organiser idea (tailoring, beauty parlour, mobile repair, dairy, poultry, tea stall, tiffin, café, fast food, bags, vermicompost / agri inputs, seed retail, plant nursery, fruit processing, solar installation, water plant, designer clothing, digital services, organic delivery…), each with NIC-2008 code, sector, OSM tags, multilingual synonyms
- [ ] Seed `data/seed/schemes.json` (PMEGP, PM Mudra, PM Vishwakarma, PMFME, Stand-Up India, NRLM SHG credit, a Maharashtra and a Telangana scheme) with source URL and last-verified date — verify each link

### H2–H8 · Fixtures and a stub brain (target: M2)
- [ ] 🎯 **H3:** three hand-written `Card` fixtures (Ramesh Goud, Suresh Reddy overwritten, Mohan Lal unassessable) in `packages/contracts/fixtures/cards/` — Dev 4 builds the whole card against these
- [ ] `intel/scoring.py`: potential, completeness, coverage, band, quadrant, pathway from domain scores (pure functions, unit-tested)
- [ ] `score` stage v0 with one LLM run → real card in Mongo for `pdf-en-1`
- [ ] `eval/run.py` skeleton: load manifest, run pipeline per file, compare, write JSON + Markdown report

### H8–H14 · The judgement layer (target: M3)
- [ ] **A-13** quality checks (PRD §12): missing vs `not_asked`, per-answer relevance (LLM, cited), Unassessable rule (> 50% core fields missing or irrelevant), consistency, plausibility (revenue vs investment, revenue vs price × volume), placeholder contacts (`9000000080`, `@demo.com`, `example.com`)
- [ ] **A-14** `intel/finance.py`: EDP formulas A–N and cash-book totals (PRD Appendix B.2); simple-form checks (investment = self + loan). Unit tests from `pdf-hi-2`'s known errors in the manifest
- [ ] **A-22** two scoring runs, disagreement > 1 → needs attention; never-scored list in the prompt
- [ ] **A-23** narrative block, everything cited
- [ ] **A-16** follow-up questions (app) and request-for-information draft (imports)
- [ ] **A-26** feedback draft
- [ ] First full eval run published at M3 — **this picks the LLM (Q-04)**

### H14–H20 · Context and comparison (target: M4)
- [ ] **A-15** duplicates: salted contact hash + similarity; `similarityLinks` with reasons; never merge
- [ ] **A-17** trade normalisation; **A-18** location parsing → pincode directory + LGD → Nominatim with precision
- [ ] **A-19** idea fingerprint embedding; kNN in Atlas Vector Search (in-memory fallback); thresholds tuned on manifest groups
- [ ] **A-20** Overpass at 1 / 3 / 10 km using trade OSM tags; `placesCache` 30-day TTL; reconcile with the applicant's competition answer
- [ ] **A-21** scheme matching (trade, district, gender, social category, loan size)
- [ ] **A-25** rank snapshots per trade and cohort
- [ ] **A-27** route suggestions from routing rules + consent
- [ ] 🎯 **H18:** analytics payload fixtures for trade, cohort, compare, clusters (Dev 3 serves them, Dev 4 draws them)

### H20–H24 · Stretch and eval
- [ ] **A-19 clusters:** HDBSCAN per cohort/district, LLM-named, saturation alerts, collaboration suggestions; UMAP 2D coordinates for the idea map (W-27)
- [ ] **A-24** full EDP plan structure for read-back; **A-29** cost and timing per stage
- [ ] Interview kit questions (W-31); copilot retrieval over scoped data (W-30, with Dev 3)
- [ ] Full eval run at H24; publish to `evalRuns` for the model-quality page (W-33)

### H24–H30 · Demo
- [ ] Parity numbers ready for the closing slide: tailoring (EN / MR / TE + audio), vermicompost (HI / TE), seed retail (HI / TE)
- [ ] Pre-warm `placesCache` for every demo location

---

## Eval targets you report against (PRD §17)

| Metric | Target | Manifest groups to use |
| --- | --- | --- |
| Canonical field accuracy | ≥ 90% | `scenario: accurate` |
| Missing / not-asked detection | ≥ 95% recall, ≥ 90% precision | `expect.missing`, `expect.notAsked` |
| Irrelevant detection | Every fully irrelevant file → Unassessable | `expect.state: unassessable` |
| Overwrite resolution | ≥ 90% | `expect.finalValues` |
| Financial checks | All seeded errors found | `pdf-hi-2.expect.financialErrors` |
| Duplicates | All flagged, zero merges; C2 / C3 not treated as duplicates | `duplicateGroup`, `contactGroup` |
| Parity | ≤ 5 points | `parityGroup` |

## Rules you must not break
- Uncited output is dropped (D-09).
- Missing ≠ weak: no evidence → `null`, never a low score (D-11).
- Social category and gender only for scheme matching and aggregates; never in a scoring prompt.
- Only coarse location + trade go to Overpass / Nominatim; respect their usage policies (cache, rate-limit, attribution).
- The LLM phrases local context; it never invents a business, count or scheme.

## If you fall behind, ask for help in this order
1. Clusters and idea map (Dev 4 can do UMAP rendering from raw vectors).
2. Copilot (W-30).
3. Full EDP plan structure (summary plan is enough for M-10).

## Demo moments you own
Step 4 (similar ideas + parity + map vs claim), step 5 (unassessable, financial checker), step 6 (pathway), step 7 (trade / cohort / clusters), step 10 (eval results).

## Done
<!-- One line per finished item: date-time · requirement ID · note -->
