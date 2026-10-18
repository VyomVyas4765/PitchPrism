"""Chat replies (M-05 chat intake): one reply → numbered, redacted English segments for the pitch review (D-33).

A reply is typed text, a voice note or a file (a filled PDF form or a photo of one). Files and voice notes go
through the same reading pipeline as every other upload (`run.Pipeline`: geometry/OCR, Whisper, IndicTrans2);
typed text is split into sentences, redacted, language-identified and translated per sentence. Everything here
runs locally. A missing local model raises CapabilityUnavailable, so the reply fails visibly instead of being
guessed. Segment IDs are given by the caller's prefix so every round's citations stay unique.
"""
from __future__ import annotations

import re
from pathlib import Path

from ai.ingest.language import identify
from ai.ingest.pii import redact
from ai.ingest.structure import BANK
from ai.providers import CapabilityUnavailable

MAX_SEGMENT = 400
SOURCE_KEYS = ("type", "documentId", "page", "bbox", "chunkId", "start", "end")
SOURCE_TYPES = ("pdf", "text", "profile", "audio")
SUFFIX = {"pdf": ".pdf", "audio": ".m4a", "image": ".jpg"}
_SENTENCE = re.compile(r"(?<=[.!?।॥])\s+")


def _topic(field: str | None) -> str | None:
    wordings = BANK["fields"].get(field or "", {}).get("wordings", {}).get("en")
    return wordings[0] if wordings else None


def _source(source: dict | None, document_id: str) -> dict:
    """Keep only the contract's source keys (packages/contracts centre-extracted-input.json)."""
    clean = {key: value for key, value in (source or {}).items() if key in SOURCE_KEYS and value is not None}
    if clean.get("type") not in SOURCE_TYPES:
        clean["type"] = "pdf" if "page" in clean else "text"
    clean["documentId"] = document_id
    return clean


def _pieces(text: str) -> list[str]:
    pieces = []
    for line in text.splitlines():
        for sentence in _SENTENCE.split(line):
            sentence = sentence.strip()
            while len(sentence) > MAX_SEGMENT:
                cut = sentence.rfind(" ", 0, MAX_SEGMENT)
                cut = cut if cut > 0 else MAX_SEGMENT
                pieces.append(sentence[:cut].strip())
                sentence = sentence[cut:].strip()
            if sentence:
                pieces.append(sentence)
    return pieces


def text_segments(text: str, language: str, document_id: str, prefix: str, translator,
                  known: dict[str, list[str]] | None = None) -> tuple[list[dict], int]:
    """(segments, redacted spans) for a typed reply. Each sentence keeps its own language and original text."""
    redaction = redact(text.replace("\r\n", "\n"), known)
    rows = []
    for piece in _pieces(redaction.text):
        guess = identify(piece).lang
        rows.append({"text": piece, "lang": language if guess == "und" else guess})
    by_language: dict[str, list[dict]] = {}
    for row in rows:
        by_language.setdefault(row["lang"], []).append(row)
    for lang, group in by_language.items():
        for row, english in zip(group, translator.translate([row["text"] for row in group], lang)):
            row["english"] = english
    segments = []
    for row in rows:
        if not (row.get("english") or "").strip():
            continue
        segment = {"segId": f"{prefix}{len(segments) + 1}", "textEn": row["english"].strip(), "lang": row["lang"],
                   "source": {"type": "text", "documentId": document_id}}
        if row["lang"] != "en":
            segment["textOriginal"] = row["text"]
        segments.append(segment)
    return segments, len(redaction.spans)


def file_segments(path: Path, kind: str, language: str, document_id: str, prefix: str, pipeline,
                  known: dict[str, list[str]] | None = None) -> tuple[list[dict], int]:
    """(segments, redacted spans) for a voice note, PDF or photo, read by the shared pipeline.

    Answers keep the form question they belong to ("What products… — tailoring of blouses"), so the review
    reads a lone "Nashik" as the business location rather than a stray word."""
    result = pipeline.run({"documents": [{"documentId": document_id, "kind": kind, "path": str(path)}],
                           "language": language, "known": known or {}})
    if result["status"] == "invalid":
        raise ValueError("The file is not the kind it claims to be.")
    blocking = [item for item in result.get("pending", []) if item.get("stage") != "location"]
    if blocking:
        raise CapabilityUnavailable(blocking[0].get("reason") or "A local reading model is unavailable.")
    segments = []
    for item in result.get("transcript", []):
        if item.get("struck") or item.get("supersededBy") or item.get("unreadable"):
            continue
        english = (item.get("textEn") or "").strip()
        if not english:
            continue
        topic = _topic(item.get("field"))
        segment = {"segId": f"{prefix}{len(segments) + 1}", "textEn": f"{topic} — {english}" if topic else english,
                   "lang": item.get("lang") or language, "source": _source(item.get("source"), document_id)}
        if segment["lang"] != "en" and item.get("textOriginal"):
            segment["textOriginal"] = item["textOriginal"]
        segments.append(segment)
    return segments, result.get("redactions", 0)


def english_of(segments: list[dict]) -> str:
    return " ".join(segment["textEn"] for segment in segments)
