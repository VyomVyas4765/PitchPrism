# Ingestion · Dev 1

Reading, redaction, language and extraction (A-01–A-12), run locally with no hosted service (D-24). A stage without an installed, approved local capability returns `pending` with its reason; nothing is guessed or translated by a model that failed its checks.

`python -m ai.ingest.run < job.json` turns a pitch or an imported file into the shared [CentreExtractedInput](../../packages/contracts/schemas/centre-extracted-input.json) that Dev 2's scorer reads, plus the transcript the app shows for correction (M-08). The API runs it in the background after a pitch is submitted (`backend/src/modules/entrepreneur/processing.ts`) until the shared job queue exists.

| Module | Requirement | What it does | Limits |
| --- | --- | --- | --- |
| `classify.py` | A-02 | Format from content signatures (ffprobe for media), `fingerprint()` for known templates | Fingerprints written from the manifest, not yet checked on the organiser files |
| `audio.py` | A-03 | 16 kHz mono WAV, pause-based chunks ≤ 29.5 s with original-time anchors, too-short/near-silent/clipped rejection | Untuned thresholds; energy pauses, not a VAD model |
| `local_models.py` | A-04, A-11 | faster-whisper `small` transcription with per-chunk language; Opus-MT / IndicTrans2 translation per segment | See model status below |
| `pdf.py` | A-05, A-08 | Text-layer words grouped by geometry into spans with page, box, font, ink; drawn lines through a word mark it struck | Digital PDFs only; scans go to OCR |
| `language.py` | A-06, A-11 | Script and per-answer language (Hindi vs Marathi by function words); text-layer corruption gate | Rule-based; to be scored on the organiser files |
| `ocr.py` | A-07 | 300 dpi render, blur score, Tesseract per-line confidence and boxes, unreadable lines kept as regions, ditto resolution | Handwriting quality unknown; no vision-model fallback installed |
| `structure.py` | A-09 | Question/answer pairing by numbering, question marks or the question bank; fuzzy canonical mapping; missing vs not asked; guided steps and free talk count secondary fields only when mentioned | No embedding/LLM confirmation yet |
| `pii.py` | A-10 | Phones, emails, IDs and known names → tokens; Indic digits; prompt guard in the shared adapter | — |
| `run.py` | A-06–A-12 | Whole pipeline; header labels (name, address, phone, email in six languages) become known values and page blur boxes; struck values linked to corrections; fields cite non-struck segments; location from the answer or the profile | `template` is `edp-idea-brief` because Dev 2's scorer accepts only that; the detected template is reported separately |
| `sidecars.py` | A-30 support | Writes redacted `datasets/extracted/<manifest-id>.json` for Dev 2's harness | The organiser files must be present locally |

## Local model setup (once per worker host)

```bash
python -m venv ai/.venv && ai/.venv/Scripts/python -m pip install -r ai/requirements.txt   # (bin/python on macOS/Linux)
ai/.venv/Scripts/python -m pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu
ai/.venv/Scripts/python -m pip install -r ai/requirements-models.txt
```

- **Speech:** `snapshot_download("Systran/faster-whisper-small", revision="536b0662742c02347bc0e980a01041f333bce120", local_dir="local/models/faster-whisper-small")`.
- **OCR:** install Tesseract 5 (Windows: `winget install UB-Mannheim.TesseractOCR`; macOS: `brew install tesseract`) and put `hin`, `mar`, `tel`, `ori`, `ben`, `eng` from `tessdata_best` in `local/tessdata` (or set `TESSDATA_PREFIX`; `TESSERACT_CMD` overrides the binary path).
- **Translation:** IndicTrans2 Indic→English distilled 200M (MIT) in `local/models/indictrans2-indic-en-dist-200M`, revision `d66a2122ad6d28184f3dc3797b652bd80ae3f65f`. It is gated on Hugging Face: accept its terms on that exact repository with your account and sign in with `ai/.venv/Scripts/hf.exe auth login` (never paste the token into chat or files), then download it into that folder. Its `trust_remote_code` files were reviewed; their SHA-256 hashes are pinned in `local_models.REVIEWED_CODE` and loading refuses if they differ. Generation runs with `use_cache=False` because the reviewed code predates transformers' cache objects.
- **Translation, evaluation only:** Opus-MT `hi/mr/bn/dra/inc-en` in `local/models/` (revisions in `local_models.py`); enable with `TRANSLATION_PROVIDER=opus-mt-eval`. It failed the Hindi and Marathi smoke test and must not feed scoring.
- **Organiser files:** put the three archives in `datasets/datasets/` and run `python -m ai.ingest.extract_dataset`; files land in ignored `datasets/raw/` at their manifest paths with sizes checked.

Model files live in ignored `local/models` and `local/tessdata`. Downloads use plain folders because Windows blocks the Hugging Face cache's symlinks without Developer Mode.

## Evidence and what is still open

[Smoke results](../../docs/benchmarks/dev1-local-models-2026-10-17.json): Whisper read a synthetic English clip correctly at ~0.2× real time on CPU; Opus-MT lost meaning in Hindi and Marathi while IndicTrans2 translated all five Indic test sentences correctly; Tesseract read clean English exactly and returned noise as unreadable. **Nothing here is an organiser-data evaluation.** Still required: run `python -m ai.ingest.sidecars` and Dev 2's harness on the 55 files (not on this host), Odia speech (no local model), an approved translator, handwriting accuracy, peak RAM under load, and native-speaker review of every language.

## Tests

`ai/.venv/Scripts/python -m unittest discover -s ai/tests`. Audio, OCR and PDF tests use synthetic tones, images and hand-built PDFs; model-dependent tests use stand-ins so they run without downloads. If ffmpeg is installed but not on Python's PATH (for example a WinGet install seen only by Git Bash), set `FFMPEG_BINARY`.
