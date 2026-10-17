"""A-10 text redaction: personal details are replaced with tokens before any model or map call (D-13).

Patterns run on a copy of the text whose Unicode digits (Devanagari, Bengali, Telugu, Odia, ...)
are mapped one-to-one to ASCII, so offsets in that copy are offsets in the original. Spans carry
the original value so the caller can move it into the encrypted entrepreneur record; never log them.

Limits: names are found only from values already known (profile, form fields). A name written in a
different script from the known value needs transliteration (A-11, pending). Exact addresses need
the structure stage (A-09) to identify address fields; free-text address detection is not attempted.
"""
from dataclasses import dataclass
import re
import unicodedata

from ai.config import PolicyViolation

TOKENS = {"name": "⟨NAME⟩", "phone": "⟨PHONE⟩", "email": "⟨EMAIL⟩", "id_number": "⟨ID⟩", "address": "⟨ADDRESS⟩"}
_SEP = r"[ .-]?"
PATTERNS = [
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")),
    # Aadhaar-style 12 digits (4-4-4) and PAN; checked before phones so 12 digits are not split.
    ("id_number", re.compile(r"(?<![\dA-Za-z])[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?![\dA-Za-z])")),
    ("id_number", re.compile(r"(?<![A-Za-z\d])[A-Z]{5}\d{4}[A-Z](?![A-Za-z\d])")),
    # Indian mobile numbers with optional +91/0091/91/0 prefix and single separators between digits.
    ("phone", re.compile(r"(?<![\d+])(?:(?:\+|00)?91" + _SEP + r"|0)?[6-9](?:" + _SEP + r"\d){9}(?!\d)")),
    # Landlines with an STD code, and other international numbers.
    ("phone", re.compile(r"(?<!\d)0\d{2,4}[ -]?\d{6,8}(?!\d)")),
    ("phone", re.compile(r"(?<![\d+])\+\d{1,3}(?:" + _SEP + r"\d){7,13}(?!\d)")),
]


@dataclass(frozen=True)
class PiiSpan:
    start: int
    end: int
    kind: str
    value: str


@dataclass(frozen=True)
class Redaction:
    text: str
    spans: list[PiiSpan]


def _ascii_digits(text: str) -> str:
    return "".join(str(unicodedata.decimal(char)) if not char.isascii() and unicodedata.decimal(char, None) is not None else char
                   for char in text)


def _known_patterns(known: dict[str, list[str]] | None):
    for kind, values in (known or {}).items():
        terms = set()
        for value in values:
            value = value.strip()
            if not value:
                continue
            terms.add(value)
            if kind == "name":
                # Each part of a name, so "Kumari" alone is caught too; very short parts are skipped.
                terms.update(part for part in re.split(r"\s+", value) if len(part) >= 3)
        for term in sorted(terms, key=len, reverse=True):
            flexible = r"\s+".join(re.escape(_ascii_digits(part)) for part in term.split())
            yield kind, re.compile(r"(?<!\w)" + flexible + r"(?!\w)", re.IGNORECASE)


def find_pii(text: str, known: dict[str, list[str]] | None = None) -> list[PiiSpan]:
    """Non-overlapping spans, longest first where matches overlap."""
    probe = _ascii_digits(text)
    found = []
    for kind, pattern in [*_known_patterns(known), *PATTERNS]:
        found += [(match.start(), match.end(), kind) for match in pattern.finditer(probe)]
    spans, taken = [], []
    for start, end, kind in sorted(found, key=lambda item: (item[0], -(item[1] - item[0]))):
        if any(start < other_end and other_start < end for other_start, other_end in taken):
            continue
        taken.append((start, end))
        spans.append(PiiSpan(start, end, kind, text[start:end]))
    return spans


def redact(text: str, known: dict[str, list[str]] | None = None) -> Redaction:
    spans = find_pii(text, known)
    pieces, cursor = [], 0
    for span in spans:
        pieces += [text[cursor:span.start], TOKENS[span.kind]]
        cursor = span.end
    pieces.append(text[cursor:])
    return Redaction("".join(pieces), spans)


def ensure_redacted(text: str):
    """Last check before inference: a contact or ID pattern in a prompt blocks the call."""
    if find_pii(text):
        raise PolicyViolation("Prompt contains an unredacted phone, email or ID number; redact before inference.")
