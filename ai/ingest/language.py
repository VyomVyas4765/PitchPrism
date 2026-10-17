"""A-06 Indic text-layer quality gate and A-11 per-answer language identification (text).

Language ID is rule-based and deterministic: script blocks decide Telugu, Odia, Bengali and English;
Devanagari is split into Hindi or Marathi by common function words. It is a baseline to be checked
against the organiser files (A-30); audio language comes from the speech model instead.
"""
from dataclasses import dataclass
import re
import unicodedata

SCRIPTS = {"devanagari": (0x0900, 0x097F), "bengali": (0x0980, 0x09FF), "odia": (0x0B00, 0x0B7F), "telugu": (0x0C00, 0x0C7F)}
SCRIPT_LANG = {"bengali": "bn", "odia": "or", "telugu": "te"}
# Frequent words that differ between Marathi and Hindi (Devanagari).
MARATHI = {"आहे", "आहेत", "आणि", "मी", "माझा", "माझी", "माझे", "करणार", "नाही", "आम्ही", "तुम्ही", "आहोत", "होते", "मध्ये", "साठी", "किंवा", "व्यवसायाची", "गावात", "दरमहा", "आपले"}
HINDI = {"है", "हैं", "और", "मैं", "मेरा", "मेरी", "मेरे", "करूँगा", "करूंगी", "नहीं", "हम", "आप", "में", "के", "लिए", "या", "गाँव", "हर", "महीने", "का", "की"}
# Pre-base dependent vowels that Chromium/Word text layers drop (PRD §11).
PRE_BASE = {"devanagari": {"ि"}, "bengali": {"ি", "ে", "ৈ"}, "odia": {"େ", "ୈ"}}
QUALITY_THRESHOLD = 0.8


def script_of(char: str) -> str | None:
    code = ord(char)
    for name, (low, high) in SCRIPTS.items():
        if low <= code <= high:
            return name
    if char.isascii() and char.isalpha():
        return "latin"
    return None


def script_counts(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for char in text:
        script = script_of(char)
        if script and (unicodedata.category(char).startswith("L") or unicodedata.category(char).startswith("M")):
            counts[script] = counts.get(script, 0) + 1
    return counts


def _devanagari_language(text: str) -> str:
    words = set(re.findall(r"[ऀ-ॿ]+", text))
    marathi, hindi = len(words & MARATHI), len(words & HINDI)
    return "mr" if marathi > hindi else "hi"


@dataclass(frozen=True)
class LanguageGuess:
    lang: str                 # dominant: hi | mr | te | or | bn | en | und
    langs: tuple[str, ...]    # every language with a meaningful share, for code-mixed answers


def identify(text: str) -> LanguageGuess:
    counts = script_counts(text)
    total = sum(counts.values())
    if total < 2:
        return LanguageGuess("und", ())
    present = []
    for script, count in sorted(counts.items(), key=lambda item: -item[1]):
        if count / total < 0.15:
            continue
        present.append("en" if script == "latin" else _devanagari_language(text) if script == "devanagari" else SCRIPT_LANG[script])
    return LanguageGuess(present[0], tuple(dict.fromkeys(present)))


@dataclass(frozen=True)
class Quality:
    score: float
    reasons: tuple[str, ...]

    @property
    def needs_reread(self) -> bool:
        return self.score < QUALITY_THRESHOLD


def text_layer_quality(text: str) -> Quality:
    """A-06: score an Indic text-layer span for corruption; 1.0 is clean."""
    reasons: list[str] = []
    if any(char == "�" or 0xE000 <= ord(char) <= 0xF8FF for char in text):
        return Quality(0.0, ("replacement_or_private_use_characters",))
    counts = script_counts(text)
    indic = {script: count for script, count in counts.items() if script != "latin"}
    if not indic:
        return Quality(1.0, ())
    anomalies = 0
    words = re.findall(r"\S+", text)
    for word in words:
        first = next((char for char in word if script_of(char) not in (None, "latin")), None)
        if first is not None and word.index(first) == 0 and unicodedata.category(first) in ("Mn", "Mc"):
            anomalies += 1  # a vowel sign or virama cannot start a word
    for previous, current in zip(text, text[1:]):
        if (unicodedata.category(previous) in ("Mn", "Mc") and unicodedata.category(current) in ("Mn", "Mc")
                and unicodedata.name(previous, "").find("VOWEL SIGN") >= 0 and unicodedata.name(current, "").find("VOWEL SIGN") >= 0):
            anomalies += 1  # two vowel signs in a row
    if anomalies:
        reasons.append("misplaced_vowel_signs")
    score = max(0.0, 1.0 - anomalies / max(len(words), 1))
    for script, count in indic.items():
        signs = PRE_BASE.get(script)
        # Natural text this long almost always has a pre-base vowel; their total absence is the known
        # Chromium/Word export fault. A false alarm only costs one OCR re-read of the span.
        if signs and count >= 100 and not any(char in signs for char in text):
            score = min(score, 0.5)
            reasons.append(f"missing_pre_base_vowels_{script}")
    return Quality(round(score, 3), tuple(reasons))
