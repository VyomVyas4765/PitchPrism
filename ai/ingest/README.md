# Ingestion · Dev 1

Reading, redaction, language and extraction stages (A-01–A-12). Everything here runs locally with no model download or hosted call. A stage that lacks a validated local capability raises `CapabilityUnavailable` and stays pending; it never substitutes a guess.

| Module | Requirement | What runs now | Still pending |
| --- | --- | --- | --- |
| `audio.py` | A-03 | ffmpeg decode to 16 kHz mono 16-bit WAV; ffmpeg `silencedetect` pauses; speech packed into chunks ≤ 29.5 s with original-time anchors; rejects `too_short`, `near_silent`, `clipped` | Thresholds are untuned defaults; Silero-class VAD comparison and organiser-audio evaluation (A-30) |
| `classify.py` | A-02 (part) | Content signatures for PDF, PNG/JPEG/WebP/HEIF, ZIP, UTF-8 text; ffprobe confirms an audio stream in MP4/3GP/Ogg/WAV/Matroska/MP3 | Digital vs scanned per page, script per page, template fingerprints |
| `pii.py` | A-10 (text part) | Phones (Indian mobile, landline, international), emails, Aadhaar-style and PAN IDs, and known values (profile name parts) become `⟨PHONE⟩`/`⟨EMAIL⟩`/`⟨ID⟩`/`⟨NAME⟩`; Indic digits handled; spans keep the original value for the vault | Cross-script names (needs transliteration), address fields (needs A-09), page-image blur boxes |

`ai/llm/adapter.py` calls `ensure_redacted` on every prompt, so a phone, email or ID pattern blocks generation before any request reaches the runtime (D-13). Images sent to `vision_json` must already be redacted crops; that cannot be checked here.

**Not started (need decisions or capabilities):** A-01 storage/hashing (with Dev 3's upload/storage contract), A-04 transcription (no local STT evaluated for six languages), A-05/A-06/A-08 PDF layout, quality gate and strike-through (PDF library licence: PyMuPDF is AGPL-3.0; pdfplumber/pypdfium2 are permissive; team decision), A-07 OCR/handwriting (no local OCR evaluated), A-09 pairing and question bank, A-11 translation, A-12 extraction (needs a selected, evaluated local model).

**Hand-off contract.** Draft [ingest-output.v0](../../packages/contracts/schemas/drafts/ingest-output.v0.json) with synthetic [fixtures](../../packages/contracts/fixtures/ingest/) for Dev 2. `ai/tests/test_contract_fixtures.py` checks the schema and the evidence rules: every field cites existing, non-struck segments; missing or not-asked answers are never filled; text is redacted.

## Tests

```bash
make worker-setup && make worker-test
```

On Windows, create the venv with `python -m venv ai/.venv` and run `ai/.venv/Scripts/python -m unittest discover -s ai/tests`. Audio tests synthesize tones and silences with ffmpeg and skip when it is absent. If ffmpeg is installed but not on the PATH that Python sees (for example a WinGet install visible only to Git Bash), set `FFMPEG_BINARY` to its full path; `ffprobe` is looked up beside it.
