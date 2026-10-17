"""Measure Dev 1's reading on the organiser files: data loss and translation accuracy.

  python -m ai.ingest.evaluate_reading                 # all digital PDFs in the manifest
  python -m ai.ingest.evaluate_reading pdf-mr-1 ...    # selected manifest IDs

Data loss: the manifest's expected answered / missing / not-asked fields against what was extracted,
and how much of each answer cell's text reached a segment. Translation: each Marathi/Telugu answer's
English is compared with the same field on the matching English form (same scenario and persona) by
chrF (character n-gram F-score, 0–100). The English forms are the organiser's own versions, not literal
translations, so chrF understates real quality; read the side-by-side report to judge.

Prints aggregate numbers only. Per-file results and the side-by-side texts go to the ignored
datasets/reports/ folder because they contain organiser content.
"""
from collections import Counter
import json
from pathlib import Path
import sys
import time

from ai.ingest import pdf as pdf_reader
from ai.ingest.run import Pipeline

ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / "datasets" / "reports" / "reading"


def chrf(hypothesis: str, reference: str, max_n: int = 6, beta: float = 2.0) -> float:
    """chrF (Popović 2015): average character n-gram precision/recall, F-beta, 0–100."""
    def grams(text: str, n: int) -> Counter:
        text = " ".join(text.lower().split())
        return Counter(text[i:i + n] for i in range(len(text) - n + 1))
    precisions, recalls = [], []
    for n in range(1, max_n + 1):
        hyp, ref = grams(hypothesis, n), grams(reference, n)
        overlap = sum((hyp & ref).values())
        if sum(hyp.values()):
            precisions.append(overlap / sum(hyp.values()))
        if sum(ref.values()):
            recalls.append(overlap / sum(ref.values()))
    if not precisions or not recalls:
        return 0.0
    p, r = sum(precisions) / len(precisions), sum(recalls) / len(recalls)
    return 0.0 if p + r == 0 else round(100 * (1 + beta ** 2) * p * r / (beta ** 2 * p + r), 1)


def answer_cell_chars(path: Path) -> int:
    """Characters in response cells of the form's tables (what a perfect reader would capture)."""
    total = 0
    for page in pdf_reader.read_pdf(path):
        columns = {}
        for span in page.spans:
            if span.cell:
                columns.setdefault(span.cell[:2], {}).setdefault(span.cell[2], []).append(span)
        for row in columns.values():
            if len(row) >= 2:
                last = row[max(row)]
                text = " ".join(s.text for s in last)
                if "response" not in text.lower():
                    total += len(text.replace(" ", ""))
    return total


def field_texts(result: dict, key: str) -> dict[str, str]:
    extracted = result.get("extracted") or {}
    segments = {s["segId"]: s for s in result.get("transcript", [])}
    texts = {}
    for field, value in (extracted.get("fields") or {}).items():
        if value["state"] == "answered":
            texts[field] = " ".join((segments[seg].get(key) or "") for seg in value["evidence"] if seg in segments)
    return texts


def main(selected: list[str]) -> int:
    manifest = json.loads((ROOT / "datasets" / "manifest.json").read_text(encoding="utf-8"))
    files = [f for f in manifest["files"] if (f["id"] in selected if selected else f["format"] == "pdf-digital")]
    REPORTS.mkdir(parents=True, exist_ok=True)
    pipeline = Pipeline()
    results, rows = {}, []
    for item in files:
        path = ROOT / item["path"]
        if not path.exists():
            continue
        started = time.monotonic()
        pipeline.issues = []
        result = pipeline.run({"documents": [{"documentId": item["id"], "kind": "pdf", "path": str(path)}], "language": None})
        seconds = round(time.monotonic() - started, 1)
        results[item["id"]] = result
        (REPORTS / f"{item['id']}.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
        fields = (result.get("extracted") or {}).get("fields") or {}
        state = {key: value["state"] for key, value in fields.items()}
        expect = item["expect"]
        expected_answered = set(expect.get("answered", [])) | set(expect.get("irrelevant", []))
        captured = sum(len((s.get("textOriginal") or "").replace(" ", "")) for s in result.get("transcript", []))
        cell_chars = answer_cell_chars(path)
        rows.append({
            "id": item["id"], "scenario": item["scenario"], "status": result["status"], "seconds": seconds,
            "answered_expected": len(expected_answered), "answered_found": sum(state.get(f) == "answered" for f in expected_answered),
            "missing_expected": len(expect.get("missing", [])), "missing_found": sum(state.get(f) in ("missing", "not_asked") for f in expect.get("missing", [])),
            "not_asked_expected": len(expect.get("notAsked", [])), "not_asked_found": sum(state.get(f) == "not_asked" for f in expect.get("notAsked", [])),
            "text_capture": round(min(1.0, captured / cell_chars), 3) if cell_chars else None,
            "rereads": sum(issue.get("spans", 0) for issue in result.get("issues", []) if issue.get("key") == "text_layer_reread"),
            "pending": [p.get("stage") for p in result.get("pending", [])],
        })

    # Translation: Marathi/Telugu answers against the matching English form (same scenario number).
    by_id = {f["id"]: f for f in files}
    translation, side_by_side = [], []
    for file_id, result in results.items():
        item = by_id[file_id]
        language = item["languages"]["answers"][0] if item["languages"]["answers"] else "und"
        if language == "en" or not file_id.startswith("pdf-"):
            continue
        reference_id = "pdf-en-" + file_id.rsplit("-", 1)[1]
        if reference_id not in results:
            continue
        ours, theirs = field_texts(result, "textEn"), field_texts(results[reference_id], "textOriginal")
        originals = field_texts(result, "textOriginal")
        for field in sorted(set(ours) & set(theirs)):
            score = chrf(ours[field], theirs[field])
            translation.append({"id": file_id, "language": language, "field": field, "chrF": score})
            side_by_side.append(f"### {file_id} · {field} · chrF {score}\n\n- **Original:** {originals.get(field, '')}\n"
                                f"- **Our English:** {ours[field]}\n- **English form ({reference_id}):** {theirs[field]}\n")
    (REPORTS / "translation-side-by-side.md").write_text(
        "# Translation side by side (organiser data — private)\n\n" + "\n".join(side_by_side), encoding="utf-8")
    (REPORTS / "summary.json").write_text(json.dumps({"files": rows, "translation": translation}, indent=1), encoding="utf-8")

    def ratio(found: str, expected: str) -> str:
        a, b = sum(r[found] for r in rows), sum(r[expected] for r in rows)
        return f"{a}/{b} ({100 * a / b:.0f}%)" if b else "n/a"
    by_language: dict[str, list[float]] = {}
    for entry in translation:
        by_language.setdefault(entry["language"], []).append(entry["chrF"])
    captures = [r["text_capture"] for r in rows if r["text_capture"] is not None]
    print(json.dumps({
        "files": len(rows), "statuses": dict(Counter(r["status"] for r in rows)),
        "answered_fields_found": ratio("answered_found", "answered_expected"),
        "missing_fields_detected": ratio("missing_found", "missing_expected"),
        "not_asked_detected": ratio("not_asked_found", "not_asked_expected"),
        "answer_text_captured_median": sorted(captures)[len(captures) // 2] if captures else None,
        "answer_text_captured_min": min(captures) if captures else None,
        "spans_reread_by_ocr": sum(r["rereads"] for r in rows),
        "translation_chrF_mean": {lang: round(sum(v) / len(v), 1) for lang, v in by_language.items()},
        "translation_pairs": len(translation),
        "seconds_total": round(sum(r["seconds"] for r in rows)),
    }, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
