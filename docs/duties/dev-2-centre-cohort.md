# Dev 2 · Centre Assessor and Cohort Lead

**PRD roles:** Centre assessor; cohort lead (same centre scope).

**Mission:** Own the complete centre review and cohort workflow: screens, queries, decisions, persistence, AI-backed analysis, live progress and tests.

**Owned modules:** `frontend/features/centre/`; `backend/src/modules/centre/`; `ai/intel/`; `ai/eval/`.

## Check before adding logic

Other AI agents may be working on their assigned roles concurrently. **Before adding logic**, read the duty index and other owners’ In progress notes; inspect `git status` and relevant diffs; search for existing/partial implementations, models, endpoints and contracts. Reuse shared logic, coordinate overlapping/shared edits with their owner, and preserve others’ changes. Record your active task and touched modules below before starting.

## Foundation already available

Centre/cohort accounts, protected workspaces, scoped read-only submission access and cross-centre denial are implemented. Full intake/review/decision workflows remain pending.

These are starter capabilities, not completion of the full requirements below. Login secrets belong in the ignored `.env`; all seeded users are synthetic. Never add a role selector that grants access or a fake OTP bypass.

## Order of work

- Build bulk import, review queue, consolidated idea card, evidence viewer, data-quality panel and streaming stage results.
- Implement decisions with override reasons, feedback editing, consent-filtered route suggestions, mentoring and outcomes.
- Add trade/cohort comparisons, quadrant, duplicate review, assessment/cohort exports, copilot and interview kits.
- Implement shared intelligence A-13–A-27 and evaluation A-30 once; publish typed fixtures/results for Devs 1, 3 and 4. Compute arithmetic in code, retain evidence and rubric versions, and distinguish incomplete from weak ideas.
- Own evaluation/rubric/trade/scheme data and model-quality metrics. Dev 3 owns the reporting screen and common event/queue plumbing; Dev 1 owns ingestion/language providers. Dev 4 owns the reusable web shell/viewer primitives.

PRD priorities and full requirement descriptions remain authoritative. Complete P0 first; do not silently remove lower-priority requirements. See [the duty index](README.md) for shared ownership and cross-role consumers.

## Revised local AI constraints · D-24

Preserve every assigned requirement. Heavy AI remains on the worker; the Android app uses system speech/TTS only after per-device locale/offline checks and does not bundle the main LLM. Use the shared local-only provider policy/registry and adapter; never introduce hosted API fallback, automatic model downloads or a duplicate AI path. Missing capabilities stay pending/failed explicitly. Validate licence, size, peak RAM, latency, six-language/format parity and organiser-data accuracy before adopting a model. AI API spending must be zero; identity, messages, hardware, storage and hosting remain separately costed.

Track implementation, execution, dependency, acceptance and status in [requirements.json](requirements.json), rendered as [the full matrix](../implementation-matrix.md). The current JSON adapter and tiny synthetic test establish plumbing only, not completed AI requirements. Coordinate existing agent work and shared ownership before adding stages. See [local runtime setup](../../ai/README.md).

## Primary requirement checklist

Descriptions and acceptance details: [PRD](../../PitchPrism.md). Each ID has exactly one primary owner in [requirements.json](requirements.json); support dependencies do not change primary ownership.

- [ ] **W-09** · Centre · P0
- [ ] **W-10** · Centre · P0
- [ ] **W-11** · Centre · P0
- [ ] **W-12** · Centre · P0
- [ ] **W-13** · Centre · P0
- [ ] **W-14** · Centre · P1
- [ ] **W-15** · Centre · P1
- [ ] **W-19** · Centre · P0
- [ ] **W-20** · Centre · P0
- [ ] **W-21** · Centre · P0
- [ ] **W-22** · Centre · P0
- [ ] **W-23** · Centre · P0
- [ ] **W-24** · Centre, HQ · P0
- [ ] **W-25** · Centre · P0
- [ ] **W-26** · Centre, HQ · P0
- [ ] **W-28** · Centre · P0
- [ ] **W-29** · Centre, HQ · P1
- [ ] **W-30** · Centre, HQ · P1
- [ ] **W-31** · Centre · P1
- [ ] **W-34** · Centre · P1
- [ ] **W-35** · Centre · P1
- [ ] **A-13** · Quality checks · P0
- [ ] **A-14** · Financial checks · P0
- [ ] **A-15** · Duplicates · P0
- [ ] **A-16** · Follow up · P0
- [ ] **A-17** · Trade · P0
- [ ] **A-18** · Location · P0
- [ ] **A-19** · Similar ideas · P0 (neighbours), P1 (clusters)
- [ ] **A-20** · Nearby businesses · P0
- [ ] **A-21** · Context · P0 (schemes), P1 (statistics)
- [ ] **A-22** · Score · P0
- [ ] **A-23** · Narrative · P0
- [ ] **A-24** · Plan · P0 (summary plan), P1 (full EDP structure)
- [ ] **A-25** · Rank · P0
- [ ] **A-26** · Feedback · P0
- [ ] **A-27** · Route · P0
- [ ] **A-30** · Evaluation · P0

## Acceptance and handoff

Verify sibling-centre isolation, original-to-score citations, missing versus not-asked, deterministic finance/scoring, consent-filtered routing, double-run score disagreements and evaluation/parity results. Compare the organiser manifest locally without copying its personal data into fixtures.

A feature is done when UI, API, persistence, permissions, loading/error states, required integrations and relevant tests work together. Publish synthetic fixtures early, document contracts, add a Done entry and notify consuming role owners. No raw organiser PII in code, prompts, fixtures, screenshots or logs.

## In progress

Remaining full-duty work: Dev 1 PDF extraction/app upload and original viewer endpoint; Dev 3 durable queue, published rubrics, cohort/trade models and events; Dev 4 shared viewer. Dev 2 must still connect imports, similarity, open-data location/schemes, analytics/ranks, routing, exports, copilot and P1 workflows. The 55 private files are now ignored locally, but no redacted extraction sidecars exist; A-30 is incomplete. See [centre integration](../centre-evaluation.md).

## Done

- 2026-10-18 · Added **Demo & saved portfolio** / **Batch upload & evaluate** modes. Batch supports multi-select/drop (30 PDFs, 12 MB each/120 MB total), sequential guarded preview evaluation, per-file failure isolation, pause-after-current/resume, retries, original/evidence review and dynamic side-by-side charts/ranks. Switching modes retains the browser batch; reload clears it, with an explicit unsaved label. Production preview and persistent consent boundaries are unchanged. Moved existing portfolio arithmetic into a shared pure helper to avoid separate browser/server rankings. Live test exposed Groq `json_validate_failed` on citation maxItems: fixed wire evidence as three nullable citation slots, validated before mapping back to the unchanged 1–3 public citation array; malformed and duplicate slots fail validation. Browser checks passed for pause/resume, failure/retry, isolation from demo, original/evidence and dynamic comparison; two actual synthetic PDF uploads were scored and compared live. Saved ZIP/durable batch intake and broader ingestion remain pending; W-19 stays partial.

- 2026-10-18 · Delivered the multi-entrepreneur evaluator comparison workspace: centre-scoped portfolio table with cohort/trade/language/lane/search/rubric filters; full-population score distribution and quadrant; trade domain medians/interquartile ranges; cohort ranks/distributions/pathway summaries and trade × cohort heatmap; 2–4 idea comparison with original quotes and evidence drill-down. Missing/low-coverage scores are excluded from ranks, small samples disclose rank denominators and withhold percentiles, and human decisions retain rank snapshots. Intake accepts validated centre cohort/active trade metadata. Repaired chunk-specific scoring prompts and added explicit domain/1–5 evidence criteria (`edp-score-v2`). Added generated CentrePortfolio contract; fixed the generator's Python nullable-forward-reference union handling. An explicit local seed supplies 18 labeled illustrative cases in an isolated centre with synthetic originals; no real consent is seeded, and HQ reports exclude the demo. Verified: root build/typecheck; 50 targeted backend tests; full backend suite 170 pass with the same four pre-existing SSE failures; 125 Python tests run successfully (3 skipped); live proxy sign-in/portfolio/originals; desktop/mobile browser comparison, filters, pagination and evidence review with no page errors. Private Atlas db:check still returns DNS missing; running UI/API use explicit local MongoDB. Similarity/local-market integrations, broader language/OCR acceptance, exports, investment norms, HQ benchmark fallback and worker-materialized ranks remain pending. Requirement statuses remain partial. Dev 3 handoff: generated read contract, generator union fix and synthetic-report exclusion; Dev 4 shell unchanged; Dev 1 ingestion unchanged.

- 2026-10-18 · Resolved the ambiguous Readiness dash in the evaluator: scored cards now say "Not assessed" when no validated readiness evidence exists, explain why and include a training/experience/completed-action follow-up. The English Business Idea parser maps only an explicit affirmative existing-business answer to a cited `experience` segment; "No" or absence leaves readiness unscored, preserving PRD §13. All six local English form-fillups still have no readiness evidence under this rule. Synthetic tests prove an affirmative answer produces a cited score and a negative answer does not. Verified 61 Python tests, targeted end-to-end synthetic readiness test, frontend typecheck/build, matrix/duty checks and diff check. Dev 1 extractor and Dev 2 rescore handoff recorded; capturing a later applicant answer remains pending.

- 2026-10-18 · User-requested dynamic score evidence presentation: each domain now displays its current PDF's redacted cited answers and page number next to the score and model reason, with links to inspect the answer or open the original at that page. Reuses existing validated segment IDs and source boxes; no scoring or shared-interface change. Two different private English Business Idea PDFs produced distinct redacted cited answers and source boxes, with all field citations resolving. Verified 59 Python tests, frontend typecheck/build, 88-requirement matrix/duty checks and diff check. Exact box highlighting and general OCR remain pending the shared viewer and Dev 1.

- 2026-10-17 · Partial Dev 2 evaluation slice: shared extracted-input schema; evidence-checked two-run local scoring; deterministic completeness/finance/pathway; follow-up and summary-plan drafts; centre-scoped queue/card, decisions and feedback draft; ranking/routing pure functions; private-data eval harness. Verified 43 backend tests, 23 Python tests, types/build and 88-owner matrix. No unverified local model or missing PDF pipeline is marked complete.

- 2026-10-17 · First milestone foundation: Centre/cohort accounts, protected workspaces, scoped read-only submission access and cross-centre denial are implemented. Full intake/review/decision workflows remain pending.
