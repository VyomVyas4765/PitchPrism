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

- `AI_RUNTIME=local`, `AI_HOSTED_APIS_ENABLED=false`: hosted AI configurations are rejected; there is no hosted fallback or provider API key in Android.
- The shared connector accepts HTTP loopback **IP addresses** only (default `http://127.0.0.1:11434`). Environment proxies and redirects are disabled so prompts are not accidentally forwarded outside the worker.
- Select an already installed model via `LOCAL_LLM_MODEL`; no model is downloaded automatically. Cloud selectors/remote metadata are rejected. Start your Ollama daemon with `OLLAMA_NO_CLOUD=1` for server-level cloud disablement too; setting this in the worker alone does not change an already running daemon.
- `AI_MAX_MODEL_BYTES` defaults to 3 GiB. This caps downloaded weight size, not peak memory. The initial scheduler target is one job at a time on the 8 GiB development host; the queue owner must implement that scheduling limit before full jobs run. Actual RAM and latency require benchmarks.
- Missing local providers raise `CapabilityUnavailable`. Future queue handlers must defer or visibly fail the job with that reason, never substitute a fake score or a paid model. A status check does not imply processing has happened.
- Callers must redact PII before generation/vision and validate evidence after generation. `complete_json`/`vision_json` validate JSON Schema, not truth, citations, fairness, language quality or financial arithmetic. Those guards remain the stage owners' duties.
- Logged metrics contain provider/model, duration, token counts and zero hosted API cost, without prompts/model output. Compute, electricity, disks, production hosting and SMS/identity services have separate costs.

## Provider interfaces

`ai/providers.py` defines task requests and a local-provider registry for transcription, OCR, translation, transliteration, embeddings, structured generation and speech synthesis. Unregistered tasks fail explicitly. `ai/llm/adapter.py` provides the initial Ollama `complete_json` and `vision_json` interface; vision requires an installed vision-capable model and redacted image crops. No OCR or multilingual capability is inferred from the existence of that method.

The adapter checks installed metadata, requests schema-constrained non-streaming output, rejects truncated/invalid results, and unloads the model after generation. The schema must validate before output can be used. Shared HTTP calls follow the [Ollama generation API](https://docs.ollama.com/api/generate) and [installed-model listing](https://docs.ollama.com/api/tags). Android speech/TTS requires per-device locale/offline checks; [SpeechRecognizer](https://developer.android.com/reference/android/speech/SpeechRecognizer) does not establish six-language support merely by existing.

## Current evidence and remaining work

Observed host: Apple M2, 8 physical CPU cores, 8 GiB total memory; ffmpeg and Ollama installed. An existing `llama3.2:latest` model has 2,019,393,189 bytes of weights. A synthetic English schema/JSON smoke test passed in about 10 seconds with no hosted API call and unloaded weights afterward. This is **not** an organiser-data evaluation or a licence, accuracy, memory, six-language, handwriting or latency-target approval. It is not selected automatically for pipeline tasks.

Dev 1 validates local STT/OCR/translation/transliteration/TTS and the lightweight Android experience; Dev 2 validates embeddings/extraction/scoring/narrative and the 55-file harness; Dev 3 integrates contracts/queue/events/telemetry; Dev 4 integrates partner consumers without duplicating inference. All six launch languages and all required formats must have a demonstrated local path before a task is marked complete.

Use [the full implementation matrix](../docs/implementation-matrix.md) to track each requirement's implementation, execution, dependencies, owner, cost exposure, acceptance and status. Record model licence, size, peak RAM, latency and dataset results before adopting one; the Nothing Phone (3a) remains a target test device, not the default inference server.
