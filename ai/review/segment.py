"""Split a plain-text pitch (or a follow-up answer) into numbered, redacted sentence segments.

Personal details are replaced with tokens such as ⟨PHONE⟩ before anything else, so no model ever sees them (D-13).
Offsets refer to the redacted text. Names are caught only when known values are passed in (see ai/ingest/pii).
"""
from __future__ import annotations

import re

from ai.ingest.pii import redact

MAX_CHARS = 20_000
MAX_SEGMENT = 400
_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[\"'(⟨A-Z0-9])")
# Abbreviations that end with a full stop but do not end a sentence ("Rs. 500", "approx. 20").
_ABBREVIATION = re.compile(r"(?:\b(?:rs|mr|mrs|ms|dr|no|nos|approx|etc|vs|e\.g|i\.e|st|kg|km|ltr)\.)$", re.IGNORECASE)


class PitchTooLong(ValueError):
    pass


def _sentences(paragraph: str):
    pieces, start = [], 0
    for match in _BOUNDARY.finditer(paragraph):
        candidate = paragraph[start:match.start()]
        if _ABBREVIATION.search(candidate.rstrip()):
            continue
        pieces.append((start, match.start()))
        start = match.end()
    pieces.append((start, len(paragraph)))
    for begin, end in pieces:
        # Very long sentences are split at a comma or semicolon so each citation stays specific.
        while end - begin > MAX_SEGMENT:
            cut = max(paragraph.rfind(", ", begin, begin + MAX_SEGMENT), paragraph.rfind("; ", begin, begin + MAX_SEGMENT))
            cut = cut + 1 if cut > begin else begin + MAX_SEGMENT
            yield begin, cut
            begin = cut
        yield begin, end


def segment(text: str, document_id: str, prefix: str = "s", known: dict[str, list[str]] | None = None) -> tuple[list[dict], int]:
    """Return (segments, number of redacted spans). Segment IDs are f"{prefix}{n}", numbered from 1."""
    if len(text) > MAX_CHARS:
        raise PitchTooLong(f"Pitch text is longer than {MAX_CHARS} characters.")
    redacted = redact(text.replace("\r\n", "\n"), known)
    clean = redacted.text
    segments = []
    for paragraph in re.finditer(r"[^\n]+", clean):
        for begin, end in _sentences(paragraph.group()):
            raw = paragraph.group()[begin:end]
            body = raw.strip()
            if not re.search(r"[A-Za-z0-9]", body):
                continue
            offset = paragraph.start() + begin + (len(raw) - len(raw.lstrip()))
            segments.append({"segId": f"{prefix}{len(segments) + 1}", "textEn": body, "lang": "en",
                             "source": {"type": "text", "documentId": document_id, "start": offset, "end": offset + len(body)}})
    return segments, len(redacted.spans)
