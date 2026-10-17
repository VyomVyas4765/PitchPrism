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

- 2026-10-17 · Partial Dev 2 evaluation slice: shared extracted-input schema; evidence-checked two-run local scoring; deterministic completeness/finance/pathway; follow-up and summary-plan drafts; centre-scoped queue/card, decisions and feedback draft; ranking/routing pure functions; private-data eval harness. Verified 43 backend tests, 23 Python tests, types/build and 88-owner matrix. No unverified local model or missing PDF pipeline is marked complete.

- 2026-10-17 · First milestone foundation: Centre/cohort accounts, protected workspaces, scoped read-only submission access and cross-centre denial are implemented. Full intake/review/decision workflows remain pending.
