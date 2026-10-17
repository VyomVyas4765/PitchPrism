"""A-09 question/answer pairing and canonical-field mapping, plus A-12's cited extraction.

Pairing works on visual lines from any reader (PDF text layer, OCR, typed or spoken steps).
Questions are found by numbering, a question mark, or a close match to the question bank; each is
mapped to a canonical field by fuzzy matching against the bank's wordings. Unmatched questions stay
as extra Q&A (canonical field null). Embedding/LLM confirmation is not used yet (no evaluated model).
"""
from dataclasses import dataclass, field
from difflib import SequenceMatcher
import json
from pathlib import Path
import re

BANK = json.loads((Path(__file__).resolve().parents[2] / "data" / "seed" / "question-bank.json").read_text(encoding="utf-8"))
CORE_FIELDS = tuple(key for key, value in BANK["fields"].items() if value["core"])
BLANK_MARKERS = ("[left blank]", "[not answered]", "left blank", "not answered", "n/a", "na", "-", "--", "nil")
QUESTION_START = re.compile(r"^\s*(?:q(?:uestion)?\.?\s*)?(\d{1,2})\s*[.)\-:]\s*(.+)$", re.IGNORECASE)
MATCH_THRESHOLD = 0.55


@dataclass
class Line:
    """One visual line with its evidence anchor."""
    text: str
    source: dict                 # {type, documentId, page?, bbox?, start?, end?, chunkId?}
    struck: bool = False
    confidence: float | None = None
    lang: str | None = None
    unreadable: bool = False
    question: bool = False       # set by layout readers that know the cell is a question


@dataclass
class Pair:
    question: str | None
    question_line: Line | None
    answer: list[Line] = field(default_factory=list)
    canonical: str | None = None
    mapping_confidence: float | None = None
    blank_marker: str | None = None


def _normalise(text: str) -> str:
    return re.sub(r"[^\w\s]", " ", text.lower()).split("(")[0].strip()


# Field-specific terms in English question wordings (non-English questions are translated first).
# Longer, more specific terms carry more weight, so "price of your main product" is unit_price, not offering.
QUESTION_TERMS = {
    "location": ("where do you intend", "set up your business", "setup your business", "location of", "where will you"),
    "offering": ("products or services", "services/products", "products/services", "what will you sell", "what are the services", "what products"),
    "customers": ("target customer", "targeted customer", "your customers", "who will buy"),
    "market_research": ("market research", "research in your", "survey"),
    "raw_materials": ("raw material",),
    "suppliers": ("supplier",),
    "funding": ("raising funds", "raise funds", "avenues for raising", "funding", "sources of fund", "loan"),
    "competition": ("competition", "competitor"),
    "unit_price": ("price of your main", "price per unit", "unit price", "price of the"),
    "monthly_revenue": ("revenue", "earn every month", "income per month", "in a month", "monthly income", "expect to earn"),
}


def map_question(text: str) -> tuple[str | None, float]:
    """Best canonical field for a question wording: specific terms first, fuzzy wording match second."""
    clean = " ".join(_normalise(QUESTION_START.sub(r"\2", text)).split())
    lowered = QUESTION_START.sub(r"\2", text).lower()
    term_scores = {key: sum(len(term) for term in terms if term in lowered) for key, terms in QUESTION_TERMS.items()}
    best_term = max(term_scores, key=term_scores.get)
    best, score = None, 0.0
    for key, entry in BANK["fields"].items():
        for language_wordings in entry["wordings"].values():
            for wording in language_wordings:
                target = " ".join(_normalise(wording).split())
                ratio = SequenceMatcher(None, clean, target).ratio()
                words_a, words_b = set(clean.split()), set(target.split())
                jaccard = len(words_a & words_b) / max(len(words_a | words_b), 1)
                value = max(ratio, (ratio + jaccard) / 2 + 0.1 * (jaccard > 0.5))
                if value > score:
                    best, score = key, value
    if term_scores[best_term] > 0 and not (score >= 0.9 and best != best_term):
        return best_term, round(max(0.85, score if best == best_term else 0.85), 3)
    return (best, round(score, 3)) if score >= MATCH_THRESHOLD else (None, round(score, 3))


def _is_question(line: Line) -> bool:
    if line.question:
        return True
    if line.source.get("role") == "answer":
        return False  # a response cell is never a question, even if it ends with "?"
    text = line.text.strip()
    if QUESTION_START.match(text) or text.endswith("?"):
        return True
    return map_question(text)[1] >= 0.8


def pair_lines(lines: list[Line]) -> tuple[list[Pair], list[Line]]:
    """Returns (pairs, preamble lines before the first question, e.g. name/phone headers)."""
    pairs: list[Pair] = []
    preamble: list[Line] = []
    for line in lines:
        if not line.text.strip():
            continue
        if _is_question(line):
            canonical, confidence = map_question(line.text)
            pairs.append(Pair(question=line.text.strip(), question_line=line, canonical=canonical, mapping_confidence=confidence))
        elif pairs:
            pairs[-1].answer.append(line)
        else:
            preamble.append(line)
    resolve_duplicates(pairs)
    for pair in pairs:
        live = [line for line in pair.answer if not line.struck]
        if not live or all(line.text.strip().lower() in BLANK_MARKERS for line in live):
            pair.blank_marker = live[0].text.strip() if live else None
    return pairs, preamble


def resolve_duplicates(pairs: list[Pair]) -> None:
    """A field can only be answered once: keep the best-matching question for each canonical field."""
    seen: dict[str, Pair] = {}
    for pair in pairs:
        if pair.canonical is None:
            continue
        other = seen.get(pair.canonical)
        if other is None or (pair.mapping_confidence or 0) > (other.mapping_confidence or 0):
            if other is not None:
                other.canonical = None
            seen[pair.canonical] = pair
        else:
            pair.canonical = None


@dataclass
class StepPair(Pair):
    """A guided step's answer offered to one of the step's fields. Only the step's primary field is
    answered by default; the others need an explicit mention (checked after translation)."""
    primary: bool = True


# English cue words (checked on the translated answer) for fields that share a guided step.
FIELD_CUES = {
    "offering": ("sell", "make", "shop", "service", "repair", "products", "business", "unit", "stall", "centre"),
    "customers": ("customer", "buyer", "people", "women", "students", "farmers", "families", "shops", "schools", "villagers"),
    "location": ("village", "district", "taluka", "town", "city", "market", "near", "block", "mandal"),
    "raw_materials": ("raw material", "material", "ingredient", "stock", "fabric", "cloth", "seed"),
    "suppliers": ("supplier", "supply", "wholesale", "buy from", "dealer", "market yard", "mandi"),
    "market_research": ("survey", "asked", "talked", "spoke", "research", "people said", "found out", "visited"),
    "competition": ("competit", "other shop", "rival", "nobody else", "no one else", "similar shop", "already sell"),
    "problem_addressed": ("problem", "difficult", "travel", "wait", "no shop", "far"),
    "pricing_strategy": ("cheaper", "lower price", "price than", "discount"),
    "unit_price": ("₹", "rs", "rupee", "per kg", "per piece", "per packet", "each", "price"),
    "monthly_revenue": ("month", "monthly", "per month", "earn", "income", "profit"),
    "investment_required": ("need", "invest", "cost", "capital", "lakh", "thousand"),
    "self_investment": ("my own", "savings", "i have", "myself"),
    "expected_loan": ("loan", "borrow", "bank", "shg", "mudra"),
    "funding": ("loan", "savings", "invest", "bank", "shg", "family", "own money", "fund"),
    "differentiation": ("better", "different", "unique", "only one", "special"),
    "business_name": ("name of", "called", "named"),
    "support_network": ("help", "support", "family", "husband", "wife", "group", "shg"),
    "existing_business": ("experience", "years", "already", "sold", "made", "trained", "training", "skill"),
}


def step_pairs(steps: dict[str, list[Line]], prompts: dict[str, str]) -> list[StepPair]:
    """Guided voice/typed steps: each step's prompt covers several canonical fields (question bank)."""
    pairs = []
    for step in BANK["guidedSteps"]:
        answer = steps.get(step["key"], [])
        for index, key in enumerate(step["fields"]):
            pairs.append(StepPair(question=prompts.get(step["key"]), question_line=None, answer=list(answer), canonical=key,
                                  mapping_confidence=1.0, blank_marker=None if answer else "", primary=index == 0))
    return pairs


def mentions(field: str, text_en: str) -> bool:
    lowered = f" {text_en.lower()} "
    return any(cue in lowered for cue in FIELD_CUES.get(field, ()))


def free_talk_pairs(lines: list[Line]) -> list[StepPair]:
    """M-07: one recording with no questions. Every field is offered the whole transcript but counts as
    answered only when the translated text mentions it (checked like a non-primary guided field)."""
    return [StepPair(question=None, question_line=None, answer=list(lines), canonical=key, mapping_confidence=None,
                     blank_marker=None if lines else "", primary=False) for key in CORE_FIELDS]
