# Local AI foundation

The full PRD remains required. The revised architecture keeps recording, offline drafts, consent and sync on a lightweight Android client; heavy speech/OCR/translation/embedding/reasoning work stays on the Python worker. No LLM is bundled in the APK. Four role-based owners remain as assigned in [the duty index](../docs/duties/README.md).

## Run and check

```bash
make worker-setup
make worker
make worker-check
make worker-test
```

Settings load from the ignored root `.env` or explicit process environment. `make worker` reports capability state and exits. `make worker-check` also lists installed local Ollama models; it does not generate, download or start jobs. The queue consumer and full task stages remain pending. [capabilities.json](capabilities.json) explicitly marks unavailable/unevaluated tasks and all six languages (Hindi, Marathi, Telugu, Odia, Bengali, English).

## Spending and data boundaries

- **Centre EDP exception (D-31):** The user requested Groq for ongoing centre scoring. `ai/intel/pdf_cli.py` alone sends locally extracted, redacted EDP answer evidence to Groq after the API checks centre scope and active processing consent. The original PDF, applicant name and exact address stay local. A missing/rejected key or invalid output leaves the card pending. The hosted call incurs usage cost; this exception does not change the local policy for other tasks. See [the scoring plan](../docs/centre-groq-evaluation-plan.md).
- This narrow PDF path needs `pdfplumber` from `ai/requirements.txt`, system `curl` for the Groq HTTPS call, and `ffmpeg` to validate recorded consent audio. The curl configuration carries the key and prompt on stdin, with redirects and proxies disabled.
- `AI_RUNTIME=local`, `AI_HOSTED_APIS_ENABLED=false`: hosted AI configurations are rejected; there is no hosted fallback or provider API key in Android.
- The shared connector accepts HTTP loopback **IP addresses** only (default `http://127.0.0.1:11434`). Environment proxies and redirects are disabled so prompts are not accidentally forwarded outside the worker.
- Select an already installed model via `LOCAL_LLM_MODEL`; no model is downloaded automatically. Cloud selectors/remote metadata are rejected. Start your Ollama daemon with `OLLAMA_NO_CLOUD=1` for server-level cloud disablement too; setting this in the worker alone does not change an already running daemon.
- `AI_MAX_MODEL_BYTES` defaults to 3 GiB. This caps downloaded weight size, not peak memory. The initial scheduler target is one job at a time on the 8 GiB development host; the queue owner must implement that scheduling limit before full jobs run. Actual RAM and latency require benchmarks.
- Missing local providers raise `CapabilityUnavailable`. Future queue handlers must defer or visibly fail the job with that reason, never substitute a fake score or a paid model. A status check does not imply processing has happened.
- Callers must redact PII before generation/vision and validate evidence after generation. `complete_json`/`vision_json` validate JSON Schema, not truth, citations, fairness, language quality or financial arithmetic. Those guards remain the stage owners' duties.
- Logged metrics contain provider/model, duration, token counts and zero hosted API cost, without prompts/model output. Compute, electricity, disks, production hosting and SMS/identity services have separate costs.

## Pitch review (D-33)

`ai/review` turns a plain-text pitch into a complete, cited idea before scoring. It reads the pitch (redacted, numbered lines), extracts the ten EDP topics with the local model, judges each against the question bank's `review.checks`, and asks at most three follow-up questions a round until every topic is answered or the entrepreneur says they have not decided. The worker runs it for text pitches and ends with `NEEDS_INPUT` while questions are open; answers come back through the API and a `followup` job reviews again.

The model is Groq's hosted API by default (D-34): set `AI_RUNTIME=groq`, `AI_HOSTED_APIS_ENABLED=true` and `GROQ_API_KEY` in `.env`. Only redacted text is sent. `AI_RUNTIME=local` uses an installed Ollama model instead.

```bash
python -m ai.review my-pitch.txt --evaluate   # answer the questions in the terminal, then score
python -m ai.eval.review_harness              # 15 synthetic pitches with a simulated entrepreneur
python -m ai.eval.review_harness --fake       # the same without a model (plumbing only)
```

## Job queue (D-29)

`ai/jobqueue.py` is the worker side of the MongoDB queue; `backend/src/platform/jobs.ts` is the API side, and the two implement one protocol. The API enqueues after checking consent and access. The worker connects to `MONGODB_URI`, claims one job at a time with an atomic lease, and wraps each stage in `run.stage(name)`. That records `started` and `done`/`skipped`/`failed` stage events for the live card (streamed over SSE), writes a `pipelineRuns` row with timing and model use (A-29), and extends the lease.

```python
from ai.jobqueue import Consumer, connect

def handle(job, run):                      # job: the claimed Job document; run.from_stage is where to start
    if run.should_run("read"):
        with run.stage("read") as stage:
            stage.summary(segments=14, languages=["te"])     # small, non-personal counts only
            stage.model_use(provider="ollama", model="…", llm_calls=1)
    run.submission_status("READY")         # or NEEDS_INPUT / UNASSESSABLE; reviewers set decisions

Consumer(connect(), handle, worker_id="worker-1").run_forever()
```

- Raise `CapabilityUnavailable` when a local provider is missing: the job fails visibly with `capability_unavailable` and is not retried. Raise `TimeoutError` or `RetryableError` for transient faults: they are retried with backoff (5 s, 20 s, 80 s) up to `maxAttempts`. Any other exception fails the attempt as `stage_error`.
- Exception text is never stored, because it may contain prompts or personal data. Staff see fixed messages.
- A worker that crashes loses its lease after 60 seconds and the job returns to the queue; after `maxAttempts` it fails as `attempts_exhausted`.
- `python -m ai.worker` (`pnpm worker`, `make pipeline`) is the consumer: it runs redaction, quality, follow-ups, scoring, narrative, feedback and routing with the job's published rubric, records the stages it cannot run yet as skipped, and writes the centre case. Dev 1 adds the intake stages (ingest to extract) to `ai/worker.py`.
- `pnpm pipeline:replay` (development only) consumes jobs and replays the fixture's stage timings, marked `replay: true`, for demonstrations without a local model. It never marks an idea assessed unless a stored evaluation already exists.



`ai/providers.py` defines task requests and a local-provider registry for transcription, OCR, translation, transliteration, embeddings, structured generation and speech synthesis. Unregistered tasks fail explicitly. `ai/llm/adapter.py` provides the initial Ollama `complete_json` and `vision_json` interface; vision requires an installed vision-capable model and redacted image crops. No OCR or multilingual capability is inferred from the existence of that method.

The adapter checks installed metadata, requests schema-constrained non-streaming output, rejects truncated/invalid results, and unloads the model after generation. The schema must validate before output can be used. Shared HTTP calls follow the [Ollama generation API](https://docs.ollama.com/api/generate) and [installed-model listing](https://docs.ollama.com/api/tags). Android speech/TTS requires per-device locale/offline checks; [SpeechRecognizer](https://developer.android.com/reference/android/speech/SpeechRecognizer) does not establish six-language support merely by existing.

## Current evidence and remaining work

Observed host: Apple M2, 8 physical CPU cores, 8 GiB total memory; ffmpeg and Ollama installed. An existing `llama3.2:latest` model has 2,019,393,189 bytes of weights. A synthetic English schema/JSON smoke test passed in about 10 seconds with no hosted API call and unloaded weights afterward. This is **not** an organiser-data evaluation or a licence, accuracy, memory, six-language, handwriting or latency-target approval. It is not selected automatically for pipeline tasks.

Dev 1 validates local STT/OCR/translation/transliteration/TTS and the lightweight Android experience; Dev 2 validates embeddings/extraction/scoring/narrative and the 55-file harness; Dev 3 integrates contracts/queue/events/telemetry; Dev 4 integrates partner consumers without duplicating inference. All six launch languages and all required formats must have a demonstrated local path before a task is marked complete.

Use [the full implementation matrix](../docs/implementation-matrix.md) to track each requirement's implementation, execution, dependencies, owner, cost exposure, acceptance and status. Record model licence, size, peak RAM, latency and dataset results before adopting one; the Nothing Phone (3a) remains a target test device, not the default inference server.
