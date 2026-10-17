"""The Dev 1 ingestion pipeline: documents → segments → Q&A → redaction → language → translation →
CentreExtractedInput (the shared Dev 1 → Dev 2 contract).

Usage (JSON on stdin, JSON on stdout; never prints input text to logs):
  python -m ai.ingest.run < job.json
job = {"documents": [{"documentId", "kind": "pdf|image|audio|text", "path", "promptStep"?}],
       "typedAnswers": {"sell": "..."}?, "language": "mr"?, "known": {"name": ["..."]}?,
       "profile": {"district", "state", "pincode"?}?}
A stage without a local capability makes the result `pending` with the reason; nothing is guessed.
"""
from dataclasses import asdict
import json
from pathlib import Path
import re
import sys
import tempfile

from ai.ingest import audio, classify, pdf
from ai.ingest.language import identify, script_counts, text_layer_quality
from ai.ingest.ocr import TESS_LANG, ocr_image, render_pdf_page
from ai.ingest.pii import redact
from ai.ingest.structure import BANK, CORE_FIELDS, Line, StepPair, free_talk_pairs, map_question, mentions, pair_lines, resolve_duplicates, step_pairs
from ai.providers import CapabilityUnavailable

STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
          "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland",
          "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
          "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh", "Puducherry", "Chandigarh"]
# Header labels on the organiser forms (English and the five Indian languages) → kind of personal detail.
HEADER_KINDS = {"name": "name", "full name": "name", "applicant name": "name", "नाम": "name", "नाव": "name", "పేరు": "name", "নাম": "name", "ନାମ": "name",
                "address": "address", "पता": "address", "पत्ता": "address", "చిరునామా": "address", "ঠিকানা": "address", "ଠିକଣା": "address",
                "mobile": "phone", "phone": "phone", "mobile no": "phone", "मोबाइल": "phone", "मोबाईल": "phone", "ఫోన్": "phone", "মোবাইল": "phone", "ମୋବାଇଲ": "phone",
                "email": "email", "e-mail": "email", "ईमेल": "email"}
HEADER_LABEL = re.compile(r"^\s*(" + "|".join(sorted(map(re.escape, HEADER_KINDS), key=len, reverse=True)) + r")\.?\s*[:：\-]\s*(.*)$", re.IGNORECASE)
LABELS = r"\b(village|vill\.?|block|mandal|taluka|tehsil|district|dist\.?|town|city)\b"


def _label(part: str) -> tuple[str | None, str]:
    """('district', 'Ranga Reddy') from 'District Ranga Reddy'; (None, part) when unlabelled."""
    match = re.match(r"\s*(village|vill\.?|block|mandal|taluka|tehsil|district|dist\.?)\s*[:\-]?\s*(.+)", part, re.IGNORECASE)
    if not match:
        return None, part
    kind = match.group(1).lower().rstrip(".")
    kind = {"vill": "village", "dist": "district", "mandal": "block", "taluka": "block", "tehsil": "block"}.get(kind, kind)
    return kind, match.group(2).strip()


OSD_SCRIPTS = {"Devanagari": ["hi", "mr"], "Telugu": ["te"], "Bengali": ["bn"], "Oriya": ["or"], "Latin": ["en"]}


class Pipeline:
    def __init__(self, transcriber=None, translator=None):
        # Real local models by default; tests pass fakes.
        if transcriber is None or translator is None:
            from ai.ingest.local_models import WhisperTranscriber, default_translator
        self.transcriber = transcriber or WhisperTranscriber()
        self.translator = translator or default_translator()
        self.issues: list[dict] = []

    # ---- reading ---------------------------------------------------------------------------------
    def _pdf_lines(self, document: dict) -> list[Line]:
        path = Path(document["path"])
        lines: list[Line] = []
        for page in pdf.read_pdf(path):
            if not page.digital:
                lines += self._ocr_lines(render_pdf_page(path, page.number), document, page.number)
                continue
            self._reread_corrupt_spans(path, page)
            lines += _page_lines(page, document["documentId"])
        return lines

    def _reread_corrupt_spans(self, path: Path, page) -> None:
        """A-06: spans whose Indic text layer is corrupt take the OCR words inside their box.
        The page is OCR'd once, with languages chosen from the text layer's script."""
        bad = [span for span in page.spans if text_layer_quality(span.text).needs_reread]
        if not bad:
            return
        counts: dict[str, int] = {}
        for span in bad:
            for script, count in script_counts(span.text).items():
                counts[script] = counts.get(script, 0) + count
        languages = sorted({lang for script in counts for lang in SCRIPT_LANGUAGES.get(script, [])} | {"en"})
        result = ocr_image(render_pdf_page(path, page.number), languages, page.number)
        for span in bad:
            x0, top, x1, bottom = span.bbox
            inside = [word for word in result.words or []
                      if x0 - 2 <= (word.bbox[0] + word.bbox[2]) / 2 <= x1 + 2 and top - 2 <= (word.bbox[1] + word.bbox[3]) / 2 <= bottom + 2]
            if inside:
                span.text = " ".join(word.text for word in inside)
                span.ocr_confidence = round(min(word.confidence for word in inside) / 100, 3)
        self.issues.append({"key": "text_layer_reread", "page": page.number, "spans": len(bad)})

    def _ocr_lines(self, image, document: dict, page: int, offset=None) -> list[Line]:
        languages = self._script_languages(image)
        result = ocr_image(image, languages, page)
        if result.blurred:
            self.issues.append({"key": "blurred_page", "page": page, "blur": result.blur})
        lines = []
        for line in result.lines:
            bbox = line.bbox if offset is None else (offset[0] + line.bbox[0], offset[1] + line.bbox[1], offset[0] + line.bbox[2], offset[1] + line.bbox[3])
            lines.append(Line(text=line.text, source={"type": "pdf" if document["kind"] == "pdf" else "image", "documentId": document["documentId"],
                                                      "page": page, "bbox": [round(v, 1) for v in bbox]},
                              confidence=round(line.confidence / 100, 3), unreadable=line.unreadable))
        return lines

    @staticmethod
    def _script_languages(image) -> list[str]:
        try:
            from ai.ingest.ocr import _tesseract
            osd = _tesseract().image_to_osd(image, config="--psm 0")
            script = re.search(r"Script: (\w+)", osd)
            if script and script.group(1) in OSD_SCRIPTS:
                return OSD_SCRIPTS[script.group(1)] + (["en"] if script.group(1) != "Latin" else [])
        except Exception:
            pass
        return list(TESS_LANG)

    def _remap_translated_questions(self, pairs) -> None:
        """A-09: questions printed in Indian languages are matched to fields through their English
        translation (question text is form wording, not applicant data)."""
        pending: dict[str, list] = {}
        for pair in pairs:
            if pair.question and (pair.canonical is None or (pair.mapping_confidence or 0) < 0.8):
                lang = identify(pair.question).lang
                if lang not in ("en", "und"):
                    pending.setdefault(lang, []).append(pair)
        for lang, group in pending.items():
            try:
                english = self.translator.translate([pair.question for pair in group], lang)
            except CapabilityUnavailable:
                continue
            for pair, text in zip(group, english):
                canonical, confidence = map_question(text)
                if canonical and confidence > (pair.mapping_confidence or 0):
                    pair.canonical, pair.mapping_confidence = canonical, confidence
        if pending:
            resolve_duplicates(pairs)

    def _audio_lines(self, document: dict, language: str | None) -> list[Line]:
        with tempfile.TemporaryDirectory() as work:
            report = audio.prepare(Path(document["path"]), Path(work))
            lines = []
            for chunk in report.chunks:
                result = self.transcriber.transcribe(Path(chunk.path), language)
                for segment in result["segments"]:
                    lines.append(Line(text=segment["text"], source={"type": "audio", "documentId": document["documentId"], "chunkId": chunk.chunk_id,
                                                                     "start": round(chunk.start + segment["start"], 2), "end": round(chunk.start + segment["end"], 2)},
                                      confidence=segment["confidence"], lang=result["language"]))
            return lines

    # ---- pipeline ----------------------------------------------------------------------------------
    def run(self, job: dict) -> dict:
        language = job.get("language")
        steps: dict[str, list[Line]] = {}
        form_lines: list[Line] = []
        for document in job.get("documents", []):
            kind = document["kind"]
            detected = classify.detect_format(Path(document["path"]))
            if detected["kind"] not in (kind, "text" if kind == "text" else kind):
                return {"status": "invalid", "reason": f"Document {document['documentId']} content is {detected['kind']}, not {kind}."}
            if kind == "pdf":
                form_lines += self._pdf_lines(document)
            elif kind == "image":
                from PIL import Image
                form_lines += self._ocr_lines(Image.open(document["path"]), document, 1)
            elif kind == "audio":
                lines = self._audio_lines(document, language)
                if document.get("promptStep"):
                    steps.setdefault(document["promptStep"], []).extend(lines)
                else:
                    form_lines += lines  # free talk: no prompts; pairing finds nothing, fields come from cues
            elif kind == "text":
                data = json.loads(Path(document["path"]).read_text(encoding="utf-8"))
                for answer in data.get("answers", []):
                    steps.setdefault(answer["step"], []).append(Line(text=answer["text"], source={"type": "text", "documentId": document["documentId"]}))
        for step, text in (job.get("typedAnswers") or {}).items():
            steps.setdefault(step, []).append(Line(text=text, source={"type": "text", "documentId": "typed"}))

        prompts = {step["key"]: step["prompt"].get(language or "en", step["prompt"]["en"]) for step in BANK["guidedSteps"]}
        pairs, preamble = pair_lines(form_lines) if form_lines else ([], [])
        self._remap_translated_questions(pairs)
        if form_lines and not pairs:
            # No questions anywhere (free talk, or a page of prose): fields come only from explicit mentions.
            pairs, preamble = free_talk_pairs(preamble), []
        pairs += step_pairs(steps, prompts) if steps else []

        # A-10: personal details found in headers (phone/email/name) are redacted everywhere before any model.
        known = {key: list(values) for key, values in (job.get("known") or {}).items()}
        blur_boxes: list[dict] = []
        for line in preamble:
            label = HEADER_LABEL.match(line.text)
            if not label:
                continue
            kind, value = HEADER_KINDS[label.group(1).lower()], label.group(2).strip()
            if kind == "name" and value:
                known.setdefault("name", []).append(value)       # redacted wherever it appears later
            if kind in ("name", "address") and value:
                line.text = f"{label.group(1)}: ⟨{kind.upper()}⟩"
            if line.source.get("bbox"):
                blur_boxes.append({"page": line.source.get("page"), "bbox": line.source["bbox"], "kind": kind})
        vault: list[dict] = []
        segments: list[dict] = []
        seg_of: dict[int, str] = {}
        counter = 0
        answer_lines = [line for pair in pairs for line in pair.answer]
        for line in preamble + answer_lines:
            if id(line) in seg_of:
                continue
            redaction = redact(line.text, known)
            vault += [{"kind": span.kind} for span in redaction.spans]  # values go to the encrypted record via the API, not here
            line.text = redaction.text
            guess = identify(line.text)
            line.lang = line.lang or guess.lang
            if line in preamble:
                continue
            counter += 1
            seg_of[id(line)] = f"s_{counter:04d}"
            segments.append({"segId": seg_of[id(line)], "textOriginal": line.text, "lang": line.lang, "langs": guess.langs,
                             "source": line.source, "struck": line.struck, "confidence": line.confidence, "unreadable": line.unreadable})

        # A-11: per-segment translation, grouped by language; segment IDs survive.
        pending = []
        by_language: dict[str, list[dict]] = {}
        for segment in segments:
            by_language.setdefault(segment["lang"] if segment["lang"] != "und" else "en", []).append(segment)
        for lang, group in by_language.items():
            try:
                english = self.translator.translate([segment["textOriginal"] for segment in group], lang)
            except CapabilityUnavailable as error:
                pending.append({"stage": "translate", "language": lang, "reason": str(error)})
                english = [None] * len(group)
            for segment, text in zip(group, english):
                segment["textEn"] = text

        # Overwrites (A-08): a struck line is superseded by the next unstruck line of the same answer.
        for pair in pairs:
            for index, line in enumerate(pair.answer):
                if line.struck:
                    successor = next((other for other in pair.answer[index + 1:] if not other.struck), None)
                    if successor is not None:
                        next(s for s in segments if s["segId"] == seg_of[id(line)])["supersededBy"] = seg_of[id(successor)]

        # A-12: canonical fields cite non-struck answer segments; missing stays missing, never invented.
        fields: dict[str, dict] = {}
        extra_qa = []
        for pair in pairs:
            evidence = [seg_of[id(line)] for line in pair.answer if not line.struck and id(line) in seg_of]
            if pair.canonical is None:
                extra_qa.append({"question": pair.question, "evidence": evidence})
                continue
            if pair.canonical not in CORE_FIELDS:
                continue
            if isinstance(pair, StepPair) and not pair.primary:
                english = " ".join(s.get("textEn") or "" for s in segments if s["segId"] in evidence)
                if not evidence or not mentions(pair.canonical, english):
                    fields.setdefault(pair.canonical, {"state": "missing", "evidence": []})
                    continue
            lines = [line for line in pair.answer if not line.struck]
            if pair.blank_marker is not None or not evidence:
                state = "missing"
                evidence = []
            elif all(line.unreadable for line in lines):
                state = "unreadable"
            else:
                state = "answered"
            current = fields.get(pair.canonical)
            if current is None or (current["state"] != "answered" and state == "answered"):
                fields[pair.canonical] = {"state": state, "evidence": evidence}
        for key in CORE_FIELDS:
            fields.setdefault(key, {"state": "not_asked", "evidence": []})

        location = self._location(fields.get("location"), segments, job.get("profile") or {})
        if location is None:
            pending.append({"stage": "location", "reason": "No district and state could be read; ask the applicant or use the profile."})
        transcript = [{key: value for key, value in segment.items() if value is not None} for segment in segments]
        if pending:
            return {"status": "pending", "pending": pending, "transcript": transcript, "issues": self.issues, "redactions": len(vault)}
        extracted = {
            "template": "edp-idea-brief",
            "context": {"plannedBusinessLocation": location},
            "segments": [{key: value for key, value in {
                "segId": s["segId"], "textEn": s["textEn"], "textOriginal": s["textOriginal"], "lang": s["lang"],
                "confidence": s["confidence"], "struck": s["struck"] or None, "supersededBy": s.get("supersededBy"),
                "source": {k: v for k, v in s["source"].items() if k in ("type", "documentId", "page", "bbox", "chunkId", "start", "end")},
            }.items() if value is not None} for s in segments],
            "fields": fields,
        }
        template = classify.fingerprint(" ".join(line.text for line in form_lines[:40])) if form_lines else ("guided" if steps else "unknown")
        return {"status": "extracted", "extracted": extracted, "templateDetected": template, "transcript": transcript, "extraQa": extra_qa,
                "blurBoxes": blur_boxes,
                "issues": self.issues, "redactions": len(vault)}

    @staticmethod
    def _location(location_field, segments, profile) -> dict | None:
        """District and state from the location answer (English text when translated), else the profile."""
        texts = []
        if location_field and location_field["state"] == "answered":
            texts = [s.get("textEn") or s["textOriginal"] for s in segments if s["segId"] in location_field["evidence"]]
        text = " ".join(texts)
        lowered = text.lower()
        state = next((name for name in sorted(STATES, key=len, reverse=True) if name.lower() in lowered), None)
        if state:
            before = text[:lowered.index(state.lower())]
            parts = [part.strip(" .-") for part in re.split(r"[,;\n]", before) if part.strip(" .-")]
            labelled = {key: value for part in parts
                        for key, value in [_label(part)] if key}
            district = labelled.get("district") or (re.sub(LABELS, "", parts[-1], flags=re.IGNORECASE).strip(" .-") if parts else "")
            pin = re.search(r"\b[1-9]\d{2}\s?\d{3}\b", text)
            if district:
                result = {"district": district[:120], "state": state, "source": "pdf", "evidence": location_field["evidence"][:3]}
                village = labelled.get("village") or (re.sub(LABELS, "", parts[0], flags=re.IGNORECASE).strip(" .-") if len(parts) > 1 else "")
                if village and village != district:
                    result["village"] = village[:120]
                if pin:
                    result["pincode"] = pin.group(0).replace(" ", "")
                return result
        if profile.get("district") and profile.get("state"):
            result = {"district": profile["district"], "state": profile["state"], "source": "profile"}
            if profile.get("pincode"):
                result["pincode"] = profile["pincode"]
            return result
        return None

SCRIPT_LANGUAGES = {"devanagari": ["hi", "mr"], "telugu": ["te"], "bengali": ["bn"], "odia": ["or"], "latin": ["en"]}


def _page_lines(page, document_id: str) -> list[Line]:
    """Lines for one digital page. Spans in a ruled table become one question line per question cell and
    answer lines per response cell (struck and unstruck runs kept apart); other spans become rows."""
    def source(spans):
        return {"type": "pdf", "documentId": document_id, "page": page.number,
                "bbox": [round(min(s.bbox[0] for s in spans), 1), round(min(s.bbox[1] for s in spans), 1),
                         round(max(s.bbox[2] for s in spans), 1), round(max(s.bbox[3] for s in spans), 1)]}

    def confidence(spans):
        return min(s.ocr_confidence if s.ocr_confidence is not None else 1.0 for s in spans)

    outside = [span for span in page.spans if span.cell is None]
    lines: list[Line] = []
    for row in pdf.lines_of(pdf.Page(page.number, page.width, page.height, page.text_chars, True, outside)):
        # A struck value and its correction on one row stay separate lines (A-08 history).
        run: list = []
        for span in row + [None]:
            if run and (span is None or span.struck != run[-1].struck):
                lines.append(Line(text=" ".join(s.text for s in run), source=source(run), struck=run[-1].struck, confidence=confidence(run)))
                run = []
            if span is not None:
                run.append(span)
    cells: dict[tuple, list] = {}
    for span in page.spans:
        if span.cell is not None:
            cells.setdefault(span.cell, []).append(span)
    rows: dict[tuple, dict[int, list]] = {}
    for (table, row, column), spans in cells.items():
        rows.setdefault((table, row), {})[column] = spans
    for key in sorted(rows):
        columns = rows[key]
        if len(columns) < 2:
            continue
        ordered = [columns[c] for c in sorted(columns)]
        answer_spans, question_spans = ordered[-1], ordered[-2]
        number = " ".join(s.text for s in ordered[0]) if len(ordered) >= 3 else ""
        question = " ".join(s.text for s in question_spans)
        if "question" in question.lower() and "response" in " ".join(s.text for s in answer_spans).lower():
            continue  # header row
        label = f"{number.strip()}. {question}" if number.strip().rstrip(".").isdigit() else question
        lines.append(Line(text=label, source=source(question_spans), question=True))
        run: list = []
        for span in answer_spans + [None]:
            if run and (span is None or span.struck != run[-1].struck):
                lines.append(Line(text=" ".join(s.text for s in run), source={**source(run), "role": "answer"},
                                  struck=run[-1].struck, confidence=confidence(run)))
                run = []
            if span is not None:
                run.append(span)
    return lines


def _merge_rows(lines: list[Line]) -> list[Line]:
    """Join spans that sit on the same visual row with the same strike state into one line."""
    merged: list[Line] = []
    for line in lines:
        last = merged[-1] if merged else None
        if (last and last.source.get("page") == line.source.get("page") and last.struck == line.struck
                and abs(last.source["bbox"][1] - line.source["bbox"][1]) < 3):
            last.text = f"{last.text} {line.text}"
            box = last.source["bbox"]
            last.source["bbox"] = [box[0], min(box[1], line.source["bbox"][1]), line.source["bbox"][2], max(box[3], line.source["bbox"][3])]
            last.confidence = min(last.confidence or 1, line.confidence or 1)
        else:
            merged.append(line)
    return merged


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        job = json.loads(sys.stdin.buffer.read(1024 * 1024))
        result = Pipeline().run(job)
    except CapabilityUnavailable as error:
        result = {"status": "pending", "pending": [{"stage": "capability", "reason": str(error)}]}
    except (ValueError, KeyError, OSError):
        # Fixed message: never echo document text, paths or model output.
        result = {"status": "failed", "reason": "The documents could not be read."}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["status"] in ("extracted", "pending") else 2


if __name__ == "__main__":
    raise SystemExit(main())
