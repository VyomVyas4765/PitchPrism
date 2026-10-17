# Dev 1 · AI Ingestion

**Mission.** Make PitchPrism able to *read* anything an applicant sends — a Telugu voice note, a garbled Marathi PDF, a struck-through English form, an 11-page handwritten Hindi plan — and hand Dev 2 clean, translated, cited, PII-free question-and-answer pairs.

If PitchPrism mis-reads, nothing downstream can be right. You are the foundation.

| | |
| --- | --- |
| **Stack** | Python 3.11 · PyMuPDF · ffmpeg · Silero VAD · httpx · pydantic · sentence-transformers (question bank only) |
| **Code** | `services/worker/ingest/` · shared `services/worker/llm/` adapter with Dev 2 |
| **Requirements** | A-01 to A-12 · supports M-08, M-09, M-10, M-13 (TTS and translation helpers) |
| **Pipeline stages** | `ingest` → `classify` → `read` → `structure` → `redact` → `translate` → `extract` ([flow.md §1.3](../flow.md#13-pipeline-stages-and-hand-off)) |
| **You hand off to** | Dev 2 at the end of `extract`; Dev 3 for TTS and translation helpers used by the app |
| **You depend on** | Dev 3 for contracts, seed and the queue (H2–H6) |

---

## What "done" looks like

For every one of the 55 files in [datasets/manifest.json](../../datasets/manifest.json):

- every answer becomes a `Segment` with an anchor (audio time, or page + bbox) and a language;
- every question is mapped to a canonical field, or kept as additional Q&A, or recorded as `not_asked`;
- struck values are kept as history and the correction is the answer;
- no name, phone or email reaches a prompt;
- `submission.fields` is filled with citations, and nothing is invented.

---

## Order of work

### H0–H2 · Kickoff (with everyone)
- [ ] Agree `Segment`, `QA`, `JobPayload`, `StageEvent` schemas with Dev 3
- [ ] Write `data/seed/question_bank.json`: the 10 canonical questions with every wording found in the organiser files (English, Hindi, Marathi, Telugu), plus extended fields from the Business Plan (Appendix B of the PRD)
- [ ] `services/worker` skeleton: config, Mongo client, Sarvam client with a disk cache keyed by content hash (D-07)

### H2–H8 · Walking skeleton (target: M2)
- [ ] **A-01** `ingest`: fetch originals from storage, sha256, create `documents`
- [ ] **A-02** `classify`: format, page count, text-layer present?, script per page, template fingerprint (`edp-idea-brief`, `edp-business-plan`, `platform-form-*`, `edp-form-mr`, `unknown`)
- [ ] **A-05** digital PDF reader with PyMuPDF `get_text("dict")` and `get_drawings()`: spans with bbox, colour, font; rebuild table rows from geometry, not stream order
- [ ] **A-09 v0** pairing for the English Idea Brief only
- [ ] **A-11 v0** translation pass-through for English
- [ ] **A-12 v0** extraction into `fields` with citations
- [ ] Publish the `StageEvent` replay fixture (H4) so Dev 4 can build the live card early
- [ ] 🎯 `pdf-en-1` produces a full `QA` list end to end

### H8–H14 · Every format reads (target: M3)
- [ ] **A-03** audio: ffmpeg to 16 kHz mono; Silero VAD; split at pauses into < 30 s chunks with start times; near-silence and clipping check
- [ ] **A-04** Sarvam STT in parallel per chunk (respect rate limits with a semaphore); language per chunk
- [ ] **A-06** Indic text-layer quality gate (see "Known traps"); failing spans re-read by OCR from a 300 dpi render of just that region
- [ ] **A-07** scans: render 300 dpi, blur score (variance of Laplacian), deskew; Sarvam Document AI; low-confidence regions to the vision fallback via `llm/adapter.vision_json`; resolve ditto marks (`"`, `॥`, `,,`) by copying the cell above
- [ ] **A-08** overwrites: a drawn line crossing a span's middle third = struck; grey vs blue ink as a second signal; on scans, ask the vision model to report struck or scribbled words explicitly
- [ ] **A-09** schema-agnostic pairing for every template; map questions with the embedding question bank, confirmed by the LLM; blank markers (`[Left Blank]`, `[Not Answered]`, `[उत्तर नहीं दिया गया]`) become `missing`; absent questions become `not_asked`
- [ ] **A-10** PII: capture name, phone, email, address, social category from profiles and pages → encrypted entrepreneur record; replace with tokens; store blur boxes
- [ ] **A-11** per-answer language ID; translate segment by segment keeping `segId`; transliteration on demand
- [ ] **A-12** extraction for all canonical and extended fields, plus "problem addressed" and a one-line summary
- [ ] TTS and translation helpers exposed for Dev 3 (`/internal/tts`, `/internal/translate` on the worker's FastAPI) by H12

### H14–H20 · Hardening (target: M4)
- [ ] Follow-up answers re-enter at `read` with `reason=followup` and merge into the existing QA
- [ ] Mixed bundles: a PDF and an audio from the same applicant become one submission; fields keep the source of each value
- [ ] Batch API fallback for audio over 10 minutes
- [ ] Profile parsing for the platform forms (investment / self / loan, market type, category, education)

### H20–H24 · Eval-driven fixes
- [ ] Read the eval report (Dev 2 runs it) and fix the worst reading failures first: handwriting, Telugu text layers, overwrites
- [ ] Freeze at H24

### H24–H30 · Demo
- [ ] Warm the cache for all 55 files and Sunita's demo prompts
- [ ] Be ready to explain on stage: "This page had no text; we read the handwriting and show you where."

---

## Organiser files to test against

| What you're proving | Files |
| --- | --- |
| Clean digital extraction | `pdf-en-1`, `form-en-1` |
| Indic text-layer corruption → OCR | `pdf-mr-1`, `pdf-te-1`, `form-hi-1`, `form-te-1` |
| Overwrites (vector) | `pdf-en-5`, `pdf-mr-5`, `pdf-te-5` — expected final values are in the manifest |
| Handwriting, blur, ditto marks | `pdf-hi-1` to `pdf-hi-4` (⚠ real PII — D-19) |
| Code-mixed answers | `pdf-en-4`, `pdf-mr-4`, `pdf-te-4` |
| Question ≠ answer language | `form-hi-5`, `form-te-5`, `form-mr-5`, `form-en-5` |
| Missing, not-asked, custom questions | `form-mr-2`, `form-en-3`, `form-te-4`, `form-mr-6`, `form-te-6` |
| Audio of every language | `aud-*` (13 files, all > 30 s) |

## Known traps (found while reading the data)

- **Chromium/Word Indic PDFs drop pre-base vowel signs** (`बज़नेस` for `बिज़नेस`, `తెలంణ` for `తెలంగాణ`). Signals for the quality gate: consonant + vowel-sign ratio far off normal, dangling virama, words not in a small frequency list for that script. ReportLab PDFs (the English platform forms) extract cleanly.
- **Overwritten PDFs draw corrections late in the content stream** — four answers in `pdf-en-5` arrive after page-2 content. Always sort by geometry.
- **Strike lines are grey `RG` strokes; struck text is grey (0.267); corrections are blue (0.102, 0.165, 0.424).** Don't hard-code the colours; use them as one signal.
- **Handwritten plans** mix Devanagari and Latin in one field, use ditto marks and braces across rows, and some printed headers are tofu boxes (unreadable even in print). Return "could not read" with the crop rather than guessing.
- **Zip paths had trailing spaces** — already normalised in `datasets/raw/`.
- **`form-te-6` is a case-study paper, not an applicant form** — it has a `[your name]` placeholder and no profile.

## If you fall behind, ask for help in this order
1. Vision fallback for handwriting (Dev 2 can take prompt-tuning).
2. Transliteration (nice to have).
3. Batch API path (no demo file needs it).

## Demo moments you own
Step 1 (the problem), step 3 (click a score → highlighted region on the page and the moment in the audio), step 5 (struck value replaced, history shown).

## Done
<!-- One line per finished item: date-time · requirement ID · note -->
