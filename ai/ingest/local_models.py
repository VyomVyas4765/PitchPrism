"""A-04 speech-to-text and A-11 translation through locally installed models only (D-24).

Models load from the ignored `local/hf` cache with `local_files_only`; nothing is downloaded at run
time and no hosted service is called. Candidates, not approved models: licence, peak RAM, latency and
six-language accuracy on the organiser files must be measured before production use.
- Speech: faster-whisper "small" (MIT code and weights). Whisper has no Odia; Odia audio fails
  explicitly with CapabilityUnavailable.
- Translation: Opus-MT (Helsinki-NLP, Apache-2.0, native MarianMT, no remote code) per language,
  pinned below and stored in `local/models/`. Telugu uses the Dravidian model and Odia the Indic-group
  model, so both are expected to be weaker and must be checked. IndicTrans2 (MIT) is preferred when
  installed: it is gated on Hugging Face (accept its terms with your own account) and ships model code,
  so it runs only when INDICTRANS_REVISION pins a reviewed commit.
"""
import os
from pathlib import Path
import re

from ai.providers import CapabilityUnavailable

ROOT = Path(__file__).resolve().parents[2]
HF_HOME = Path(os.getenv("HF_HOME") or ROOT / "local" / "hf")
os.environ.setdefault("HF_HOME", str(HF_HOME))
os.environ.setdefault("HF_HUB_OFFLINE", "1")          # never fetch at run time
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

WHISPER_REPO = "Systran/faster-whisper-small"
WHISPER_LANGUAGES = {"hi", "mr", "te", "bn", "en"}   # Odia ("or") is not a Whisper language
TRANSLATE_REPO = "ai4bharat/indictrans2-indic-en-dist-200M"
TRANSLATE_REVISION = "d66a2122ad6d28184f3dc3797b652bd80ae3f65f"   # reviewed 2026-10-17
# trust_remote_code runs these files; they were read before approval and must match byte for byte.
REVIEWED_CODE = {
    "configuration_indictrans.py": "d7e4ce84efacc18981228f5071b00dba6e3bf165f8ea7bcc8ecdada8942e1a52",
    "modeling_indictrans.py": "3b02ccd83a829d061aa11bb48190962fce6725309ac6a65621595ce45a03d47f",
    "tokenization_indictrans.py": "35396cf65b9fdc21379f8bc12cd658eec32fbe5de87a25fa5f4df190c5ffc4e3",
}
INDICTRANS_FOLDER = ROOT / "local" / "models" / "indictrans2-indic-en-dist-200M"
INDIC_TAGS = {"hi": "hin_Deva", "mr": "mar_Deva", "te": "tel_Telu", "or": "ory_Orya", "bn": "ben_Beng"}
TOKEN = re.compile(r"⟨(NAME|PHONE|EMAIL|ID|ADDRESS)⟩")


def _restore_tokens(text: str) -> str:
    """Put protected redaction tokens back in their canonical upper-case form after translation."""
    return re.sub(r"[\[⟨]\s*(NAME|PHONE|EMAIL|ID|ADDRESS)\s*[\]⟩]", lambda match: f"⟨{match.group(1).upper()}⟩",
                  text, flags=re.IGNORECASE).strip()


def _snapshot(repo: str, revision: str | None = None) -> Path:
    from huggingface_hub import snapshot_download
    try:
        return Path(snapshot_download(repo, revision=revision or None, local_files_only=True))
    except Exception as error:
        raise CapabilityUnavailable(f"Local model {repo} is not installed in {HF_HOME}; no download is attempted.") from error


class WhisperTranscriber:
    """Transcribes one audio chunk (A-03 output) with per-chunk language detection."""
    _model = None

    def _load(self):
        if WhisperTranscriber._model is None:
            from faster_whisper import WhisperModel
            folder = ROOT / "local" / "models" / "faster-whisper-small"   # revision 536b0662742c02347bc0e980a01041f333bce120
            if not (folder / "model.bin").exists():
                raise CapabilityUnavailable("Speech model faster-whisper-small is not installed in local/models; no download is attempted.")
            WhisperTranscriber._model = WhisperModel(str(folder), device="cpu", compute_type="int8",
                                                     cpu_threads=max(1, (os.cpu_count() or 2) // 2))
        return WhisperTranscriber._model

    def transcribe(self, path: Path, language: str | None = None) -> dict:
        if language == "or":
            raise CapabilityUnavailable("No local speech model supports Odia yet; Odia recordings stay pending.")
        if language and language not in WHISPER_LANGUAGES:
            raise CapabilityUnavailable(f"No local speech model for language {language}.")
        model = self._load()
        if language is None:
            _, _, probabilities = model.detect_language(audio=self._audio(path))
            ranked = [(lang, p) for lang, p in probabilities if lang in WHISPER_LANGUAGES]
            language, probability = ranked[0] if ranked else ("und", 0.0)
            # Odia speech often lands on Bengali/Hindi; a low top probability is reported, not trusted.
        else:
            probability = 1.0
        segments, _ = model.transcribe(self._audio(path), language=language if language != "und" else None, beam_size=1,
                                       vad_filter=False, condition_on_previous_text=False)
        items = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip(),
                  "confidence": round(min(1.0, max(0.0, 1 + s.avg_logprob / 2)), 3)} for s in segments if s.text.strip()]
        return {"language": language, "languageProbability": round(float(probability), 3), "segments": items}

    @staticmethod
    def _audio(path: Path):
        # A-03 chunks are 16 kHz mono 16-bit PCM WAV; decoding them directly avoids PyAV version drift.
        import wave
        import numpy
        with wave.open(str(path), "rb") as clip:
            if (clip.getframerate(), clip.getnchannels(), clip.getsampwidth()) != (16000, 1, 2):
                raise ValueError("Speech input must be a 16 kHz mono 16-bit chunk from the audio stage.")
            frames = clip.readframes(clip.getnframes())
        return numpy.frombuffer(frames, dtype=numpy.int16).astype(numpy.float32) / 32768.0


class IndicTranslator:
    """Indic → English per segment; English passes through unchanged."""
    _loaded = None

    def _load(self):
        if IndicTranslator._loaded is None:
            import hashlib
            path = INDICTRANS_FOLDER
            if not (path / "model.safetensors").exists():
                raise CapabilityUnavailable("IndicTrans2 is not installed in local/models; non-English answers stay pending.")
            for name, digest in REVIEWED_CODE.items():
                if not (path / name).exists() or hashlib.sha256((path / name).read_bytes()).hexdigest() != digest:
                    raise CapabilityUnavailable("IndicTrans2 model code differs from the reviewed version; refusing to run it.")
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
            from IndicTransToolkit.processor import IndicProcessor
            tokenizer = AutoTokenizer.from_pretrained(str(path), trust_remote_code=True, local_files_only=True)
            model = AutoModelForSeq2SeqLM.from_pretrained(str(path), trust_remote_code=True, local_files_only=True)
            model.eval()
            IndicTranslator._loaded = (tokenizer, model, IndicProcessor(inference=True))
        return IndicTranslator._loaded

    def translate(self, texts: list[str], language: str) -> list[str]:
        if language == "en" or not texts:
            return list(texts)
        if language not in INDIC_TAGS:
            raise CapabilityUnavailable(f"No local translation for language {language}.")
        import torch
        tokenizer, model, processor = self._load()
        # Keep redaction tokens out of the model's way and restore them afterwards.
        protected = [TOKEN.sub(lambda match: f" [{match.group(1)}] ", text) for text in texts]
        batch = processor.preprocess_batch(protected, src_lang=INDIC_TAGS[language], tgt_lang="eng_Latn")
        inputs = tokenizer(batch, truncation=True, padding="longest", return_tensors="pt", return_attention_mask=True)
        with torch.inference_mode():
            # The reviewed model code predates transformers' Cache objects; cached decoding fails, so it is off.
            outputs = model.generate(**inputs, use_cache=False, min_length=0, max_length=256, num_beams=4, num_return_sequences=1)
        decoded = tokenizer.batch_decode(outputs, skip_special_tokens=True, clean_up_tokenization_spaces=True)
        english = processor.postprocess_batch(decoded, lang="eng_Latn")
        return [_restore_tokens(text) for text in english]


MODELS = ROOT / "local" / "models"
# Exact versions downloaded and checked (Apache-2.0 per each model card).
OPUS_MODELS = {
    "hi": ("opus-mt-hi-en", "a7d96a16729f812578bd55e7366147beda625d86"),
    "mr": ("opus-mt-mr-en", "c0ec0f65f03e82cfacf1cb53f56b96cb65fd2c8f"),
    "bn": ("opus-mt-bn-en", "098d427088fba65d683639e91742c783cc7c1434"),
    "te": ("opus-mt-dra-en", "619712578b75d80f1603cace0e5d35e94c3da538"),
    "or": ("opus-mt-inc-en", "b237db6975a3f7973fb149adc7166bfa30f8f224"),
}


class OpusTranslator:
    """Indic → English with one Marian model per language; loads one model at a time to save RAM."""
    _cache: dict[str, tuple] = {}

    def _load(self, language: str):
        if language not in OPUS_MODELS:
            raise CapabilityUnavailable(f"No local translation for language {language}.")
        if language not in OpusTranslator._cache:
            folder = MODELS / OPUS_MODELS[language][0]
            if not (folder / "config.json").exists():
                raise CapabilityUnavailable(f"Translation model {OPUS_MODELS[language][0]} is not installed in local/models; no download is attempted.")
            from transformers import MarianMTModel, MarianTokenizer
            OpusTranslator._cache.clear()  # 2 GB-class phones are not the target, but the dev host has little free RAM
            OpusTranslator._cache[language] = (MarianTokenizer.from_pretrained(str(folder), local_files_only=True),
                                               MarianMTModel.from_pretrained(str(folder), local_files_only=True).eval())
        return OpusTranslator._cache[language]

    def translate(self, texts: list[str], language: str) -> list[str]:
        if language == "en" or not texts:
            return list(texts)
        import torch
        tokenizer, model = self._load(language)
        protected = [TOKEN.sub(lambda match: f" [{match.group(1)}] ", text) for text in texts]
        results = []
        for start in range(0, len(protected), 8):
            batch = tokenizer(protected[start:start + 8], return_tensors="pt", padding=True, truncation=True, max_length=256)
            with torch.inference_mode():
                output = model.generate(**batch, num_beams=4, max_new_tokens=256)
            results += tokenizer.batch_decode(output, skip_special_tokens=True)
        return [_restore_tokens(text) for text in results]


class NoApprovedTranslator:
    """No translation model has passed review: non-English text stays pending (English passes through)."""

    def translate(self, texts: list[str], language: str) -> list[str]:
        if language == "en" or not texts:
            return list(texts)
        raise CapabilityUnavailable("No approved local translation model; non-English answers stay pending. "
                                    "Install and pin IndicTrans2 (see ai/ingest/README.md).")


def default_translator():
    """IndicTrans2 when installed and pinned after review. Opus-MT failed the 2026-10-17 smoke test
    (Hindi/Marathi meaning lost), so it runs only when TRANSLATION_PROVIDER=opus-mt-eval for evaluation."""
    if (INDICTRANS_FOLDER / "model.safetensors").exists():
        return IndicTranslator()
    if os.getenv("TRANSLATION_PROVIDER") == "opus-mt-eval":
        return OpusTranslator()
    return NoApprovedTranslator()
