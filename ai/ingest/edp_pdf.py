"""Conservative extraction for two English digital business idea form families.

This is a narrow bridge until Dev 1's validated multi-layout extractor is available.
The original PDF and unredacted spans never leave the local process.
"""
from __future__ import annotations

import io
import re
from typing import Any

import pdfplumber

from ai.ingest.pii import find_pii, redact
from ai.intel.scoring import FIELDS


class UnsupportedEdpPdf(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


# Page, top, bottom, a distinctive printed question fragment. Coordinates belong
# to the organiser's supplied English digital template, not arbitrary PDFs.
ROWS = (
    (0, 216, 259, "where do you intend to setup"),
    (0, 259, 302, "what are the services/products"),
    (0, 302, 341, "who are your targeted customers"),
    (1, 94, 136, "have you done any market research"),
    (1, 136, 179, "what is the raw material"),
    (1, 179, 222, "who will be suppliers"),
    (1, 222, 276, "which are the avenues for raising funds"),
    (1, 276, 319, "is there any competition"),
    (1, 319, 350, "what is the price"),
    (1, 350, 390, "what is the expected revenue"),
)

# The form-fillup family keeps prompts in the left column and answers on the
# right, but answer lengths shift every subsequent row. Detect the printed
# anchors instead of assuming fixed y positions. Non-scored rows still delimit
# neighbouring answer cells; customer age/gender are deliberately excluded.
FILLUP_LABELS = (
    ("business_type", "business type"),
    ("offering", "what products/services will you provide"),
    ("customer_gender", "customer gender"),
    ("customer_age", "customer age range"),
    ("customers", "customer segment"),
    ("market_research", "have you done any market research"),
    ("raw_materials", "what raw materials will you need"),
    ("suppliers", "who will supply these raw materials"),
    ("funding", "which are the avenues for raising funds"),
    ("competition", "is there any competition for your business"),
    ("unit_price", "what is the price per unit"),
    ("monthly_revenue", "how much money do you expect to earn every month"),
    ("location", "where will you start your business"),
    ("market_type", "please select market type"),
    ("existing_business", "do you have an existing business"),
    ("business_hours", "what are your business hours"),
)

ADDRESS_WORDS = re.compile(r"\b(?:street|lane|road|house|plot|flat|pincode|pin code|door no)\b", re.I)


def _header_name(page: Any) -> str:
    header = page.crop((45, 115, 550, 142)).extract_text() or ""
    match = re.search(r"Name of the Applicant:\s*([^\n]+)", header, re.I)
    return match.group(1).strip() if match else ""


def _fillup_name(page: Any) -> str:
    for line in page.extract_text_lines():
        if line["top"] > page.height / 3:
            break
        match = re.fullmatch(r"Name\s+([^\n]+)", line["text"].strip(), re.I)
        if match:
            return match.group(1).strip()
    return ""


def _fillup_rows(pdf: Any) -> list[tuple[str, int, float, float]]:
    rows: list[tuple[str, int, float, float]] = []
    seen: set[str] = set()
    for page_index, page in enumerate(pdf.pages):
        labels: list[tuple[str, float]] = []
        left_edge = page.width * 305 / 595
        for line in page.extract_text_lines():
            if line["x0"] >= left_edge:
                continue
            text = re.sub(r"\s+", " ", line["text"].lower().strip())
            matches = [key for key, prefix in FILLUP_LABELS if text.startswith(prefix)]
            if not matches and not re.match(r"^(?:what|who|where|which|how|have|is there|do you|please)\b", text):
                continue
            key = matches[0] if matches else f"unknown_{page_index}_{round(line['top'])}"
            if key in seen:
                raise UnsupportedEdpPdf("question_mismatch")
            seen.add(key)
            labels.append((key, line["top"]))
        labels.sort(key=lambda item: item[1])
        for index, (key, top) in enumerate(labels):
            if key not in FIELDS and key != "existing_business":
                continue
            bottom = labels[index + 1][1] - 0.5 if index + 1 < len(labels) else min(page.height - 30, top + 90)
            if not 10 <= bottom - top <= 100:
                raise UnsupportedEdpPdf("question_mismatch")
            rows.append((key, page_index, top, bottom))
    if len(set(FIELDS) & seen) < 6:
        raise UnsupportedEdpPdf("question_mismatch")
    return rows


def extract_edp_pdf(pdf_bytes: bytes, *, district: str, applicant_name: str = "",
                    document_id: str = "") -> dict[str, Any]:
    if len(pdf_bytes) > 12 * 1024 * 1024 or not pdf_bytes.startswith(b"%PDF-"):
        raise UnsupportedEdpPdf("invalid_pdf")
    try:
        pdf = pdfplumber.open(io.BytesIO(pdf_bytes))
    except Exception as error:
        raise UnsupportedEdpPdf("invalid_pdf") from error
    with pdf:
        if len(pdf.pages) != 2:
            raise UnsupportedEdpPdf("page_layout")
        first_page = pdf.pages[0]
        fillup = any(line["top"] < first_page.height / 8 and line["text"].strip().lower() == "business idea"
                     for line in first_page.extract_text_lines())
        if fillup:
            if any(not 550 <= page.width <= 700 or not 740 <= page.height <= 960 for page in pdf.pages):
                raise UnsupportedEdpPdf("page_layout")
        elif any(not 590 <= page.width <= 600 or not 835 <= page.height <= 850 for page in pdf.pages):
            raise UnsupportedEdpPdf("page_layout")
        names = [name for name in (applicant_name.strip(), _fillup_name(first_page) if fillup else _header_name(first_page)) if name]
        if not names:
            raise UnsupportedEdpPdf("name_missing")
        known = {"name": names}
        segments: list[dict[str, Any]] = []
        fields: dict[str, Any] = {}
        rows = _fillup_rows(pdf) if fillup else [(FIELDS[index], page_index, top, bottom)
                                                   for index, (page_index, top, bottom, _) in enumerate(ROWS)]
        for index, (key, page_index, top, bottom) in enumerate(rows):
            page = pdf.pages[page_index]
            if not fillup:
                printed = ROWS[index][3]
                question = (page.crop((60, top, 312, bottom)).extract_text() or "").lower()
                question = re.sub(r"\s+", " ", question)
                if printed not in question:
                    raise UnsupportedEdpPdf("question_mismatch")
            answer_box = page.crop((page.width * 308 / 595 if fillup else 313, top,
                                    page.width * 545 / 595 if fillup else 580, bottom))
            raw = (answer_box.extract_text() or "").strip()
            if len(raw) > 1800:
                raise UnsupportedEdpPdf("answer_unreadable")
            # A stated existing business is direct evidence of experience.
            # "No" or an empty box says nothing about other skills/training, so
            # it must not become a weak Readiness score.
            if key == "existing_business":
                if not re.match(r"^yes\b", raw, re.I):
                    continue
                key = "experience"
            if len(raw) < 2:
                fields[key] = {"state": "missing", "evidence": []}
                continue
            chars = answer_box.chars
            if not chars:
                raise UnsupportedEdpPdf("answer_unreadable")
            # The free-text location is an exact address risk. Only the fact that
            # a location was provided may cross the hosted boundary.
            if key == "location":
                redacted = "Applicant provided a planned business location; exact address withheld."
            else:
                safe = re.sub(r"\s+", " ", raw)
                if ADDRESS_WORDS.search(safe):
                    safe = " ".join(part for part in re.split(r"(?<=[.!?])\s+", safe)
                                    if not ADDRESS_WORDS.search(part))
                if len(safe.strip()) < 2:
                    fields[key] = {"state": "unreadable", "evidence": []}
                    continue
                redacted = redact(safe, known).text
            if find_pii(redacted, known):
                raise UnsupportedEdpPdf("redaction_failed")
            seg_id = f"edp-{index + 1:02d}"
            bbox = [round(min(c["x0"] for c in chars), 1), round(min(c["top"] for c in chars), 1),
                    round(max(c["x1"] for c in chars), 1), round(max(c["bottom"] for c in chars), 1)]
            segments.append({"segId": seg_id, "textEn": redacted, "lang": "en",
                             "source": {"type": "pdf", "documentId": document_id or "edp-original",
                                        "page": page_index + 1, "bbox": bbox}})
            fields[key] = {"state": "answered", "evidence": [seg_id]}
    for key in FIELDS:
        fields.setdefault(key, {"state": "not_asked", "evidence": []})
    location_evidence = fields["location"]["evidence"]
    context = {"plannedBusinessLocation": {"district": district.strip() or "Not recorded",
               "state": "Not recorded", "source": "pdf", "evidence": location_evidence}} if location_evidence else {}
    return {"template": "edp-idea-brief", "context": context, "segments": segments, "fields": fields}
