"""A-03: normalise audio to 16 kHz mono and split it at pauses into chunks under 30 seconds.

Pauses come from ffmpeg's energy-based ``silencedetect`` filter: deterministic and model-free.
It is a baseline, not the validated VAD the PRD names (Silero); thresholds below are untuned
defaults until the organiser audio is evaluated (A-30). Chunk start/end times are offsets in the
original recording, so every later segment keeps its audio anchor.
"""
from dataclasses import asdict, dataclass, field
import os
from pathlib import Path
import re
import shutil
import subprocess
import wave

from ai.providers import CapabilityUnavailable

SAMPLE_RATE = 16000
MAX_CHUNK_SECONDS = 29.5          # Strictly under the 30 s sync-STT limit the pipeline is designed around.
SILENCE_NOISE_DB = -35            # Untuned: below this level counts as a pause.
SILENCE_MIN_SECONDS = 0.35
MIN_DURATION_SECONDS = 1.0
NEAR_SILENT_MEAN_DB = -50.0
MIN_SPEECH_RATIO = 0.1
MAX_CLIPPED_RATIO = 0.001
FFMPEG_TIMEOUT_SECONDS = 300


class AudioRejected(ValueError):
    """The recording cannot be used; ``reason`` maps to a re-record prompt in the app."""

    def __init__(self, reason: str, report: "AudioReport"):
        super().__init__(reason)
        self.reason = reason
        self.report = report


@dataclass(frozen=True)
class AudioChunk:
    chunk_id: str
    start: float
    end: float
    path: str


@dataclass
class AudioReport:
    duration: float
    mean_volume_db: float | None
    max_volume_db: float | None
    clipped_ratio: float
    speech_ratio: float
    pauses: list[tuple[float, float]]
    forced_cuts: int = 0
    chunks: list[AudioChunk] = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


def _ffmpeg() -> str:
    binary = shutil.which(os.getenv("FFMPEG_BINARY", "ffmpeg"))
    if not binary:
        raise CapabilityUnavailable("ffmpeg is not installed on the worker; audio stays pending. No hosted fallback.")
    return binary


def _run(arguments: list[str]) -> str:
    # List arguments (no shell) and file-only protocols, so a crafted file cannot make ffmpeg fetch URLs.
    result = subprocess.run([_ffmpeg(), "-nostdin", "-hide_banner", "-protocol_whitelist", "file", *arguments],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=FFMPEG_TIMEOUT_SECONDS)
    if result.returncode != 0:
        # ffmpeg stderr can echo file paths; report a fixed message instead.
        raise ValueError("ffmpeg could not read this recording.")
    return result.stderr


def normalise(source: Path, target: Path) -> Path:
    """Decode any supported container to 16-bit PCM WAV, 16 kHz, mono. The original is never modified."""
    _run(["-loglevel", "error", "-i", str(source), "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
          "-sample_fmt", "s16", "-f", "wav", "-y", str(target)])
    return target


def _last_float(pattern: str, text: str) -> float | None:
    values = re.findall(pattern, text)
    return float(values[-1]) if values else None


def measure(wav_path: Path) -> tuple[float, AudioReport]:
    with wave.open(str(wav_path), "rb") as audio:
        duration = audio.getnframes() / audio.getframerate()
    log = _run(["-i", str(wav_path), "-af",
                f"silencedetect=noise={SILENCE_NOISE_DB}dB:d={SILENCE_MIN_SECONDS},volumedetect", "-f", "null", "-"])
    pauses, start = [], None
    for kind, value in re.findall(r"silence_(start|end): (-?[\d.]+)", log):
        if kind == "start":
            start = max(0.0, float(value))
        elif start is not None:
            pauses.append((start, min(duration, float(value))))
            start = None
    if start is not None:
        pauses.append((start, duration))
    samples = _last_float(r"n_samples: (\d+)", log) or 0
    clipped = _last_float(r"histogram_0db: (\d+)", log) or 0
    silent = sum(end - begin for begin, end in pauses)
    report = AudioReport(
        duration=round(duration, 3),
        mean_volume_db=_last_float(r"mean_volume: (-?[\d.]+|-inf) dB", log.replace("-inf", "-999")),
        max_volume_db=_last_float(r"max_volume: (-?[\d.]+|-inf) dB", log.replace("-inf", "-999")),
        clipped_ratio=clipped / samples if samples else 0.0,
        speech_ratio=max(0.0, 1 - silent / duration) if duration else 0.0,
        pauses=[(round(begin, 3), round(end, 3)) for begin, end in pauses],
    )
    return duration, report


def speech_regions(duration: float, pauses: list[tuple[float, float]]):
    regions, cursor = [], 0.0
    for begin, end in sorted(pauses):
        if begin > cursor:
            regions.append((cursor, begin))
        cursor = max(cursor, end)
    if cursor < duration:
        regions.append((cursor, duration))
    return [(begin, end) for begin, end in regions if end - begin > 0.05]


def plan_chunks(duration: float, pauses: list[tuple[float, float]], max_seconds: float = MAX_CHUNK_SECONDS, pad: float = 0.2):
    """Pack speech regions into chunks of at most ``max_seconds``, cutting inside pauses.

    Each region is padded so word edges survive; pure silence is never sent for transcription.
    A region longer than the limit is hard-cut (``forced``). Returns (start, end, forced) in original time.
    """
    spans: list[tuple[float, float, bool]] = []
    for begin, end in speech_regions(duration, pauses):
        start = max(0.0, begin - pad, spans[-1][1] if spans else 0.0)
        finish = min(duration, end + pad)
        if spans and finish - spans[-1][0] <= max_seconds:
            spans[-1] = (spans[-1][0], finish, spans[-1][2])
            continue
        while finish - start > max_seconds:
            spans.append((start, start + max_seconds, True))
            start += max_seconds
        spans.append((start, finish, False))
    return [(round(start, 3), round(end, 3), forced) for start, end, forced in spans]


def _write_slice(source: Path, target: Path, start: float, end: float):
    with wave.open(str(source), "rb") as audio:
        rate = audio.getframerate()
        audio.setpos(int(start * rate))
        frames = audio.readframes(int(end * rate) - int(start * rate))
        params = audio.getparams()
    with wave.open(str(target), "wb") as out:
        out.setparams(params)
        out.writeframes(frames)


def prepare(source: Path, work_dir: Path) -> AudioReport:
    """Normalise, check quality, and write chunk WAVs into ``work_dir``. Raises ``AudioRejected`` for unusable audio."""
    work_dir.mkdir(parents=True, exist_ok=True)
    wav_path = normalise(source, work_dir / "normalised.wav")
    duration, report = measure(wav_path)
    if duration < MIN_DURATION_SECONDS:
        raise AudioRejected("too_short", report)
    if (report.mean_volume_db is not None and report.mean_volume_db < NEAR_SILENT_MEAN_DB) or report.speech_ratio < MIN_SPEECH_RATIO:
        raise AudioRejected("near_silent", report)
    if report.clipped_ratio > MAX_CLIPPED_RATIO:
        raise AudioRejected("clipped", report)
    for index, (start, end, forced) in enumerate(plan_chunks(duration, report.pauses), start=1):
        chunk_path = work_dir / f"chunk_{index:04d}.wav"
        _write_slice(wav_path, chunk_path, start, end)
        report.chunks.append(AudioChunk(f"c_{index:04d}", start, end, str(chunk_path)))
        report.forced_cuts += forced
    return report
