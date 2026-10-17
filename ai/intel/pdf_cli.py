"""Private PDF-to-centre-assessment worker bridge (stdin JSON, stdout JSON)."""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

from ai.ingest.edp_pdf import UnsupportedEdpPdf, extract_edp_pdf
from ai.intel.groq import GroqEdpAdapter
from ai.intel.scoring import evaluate, quality
from ai.intel.finance import check_finances
from ai.intel.narrative import feedback_draft, followups, summary_plan
from ai.llm.adapter import ModelOutputError
from ai.providers import CapabilityUnavailable


def assess_pdf(pdf_bytes: bytes, *, district: str, applicant_name: str, document_id: str):
    idea = extract_edp_pdf(pdf_bytes, district=district, applicant_name=applicant_name,
                           document_id=document_id)
    schema = json.loads((Path(__file__).resolve().parents[2] / "packages/contracts/schemas/centre-extracted-input.json").read_text())
    Draft202012Validator(schema).validate(idea)
    checks = check_finances(idea.get("financials", {}), {segment["segId"] for segment in idea["segments"]})
    try:
        adapter = GroqEdpAdapter()
        result = evaluate(idea, adapter)
        financial_evidence = list(dict.fromkeys(
            idea["fields"]["unit_price"]["evidence"] + idea["fields"]["monthly_revenue"]["evidence"]))
        if financial_evidence:
            field = "monthly_revenue" if idea["fields"]["monthly_revenue"]["evidence"] else "unit_price"
            result["flags"].append({"key": "financial_numbers_unverified", "field": field,
                                    "evidence": financial_evidence, "severity": "warn"})
        assessment = {"status": "assessed", "evaluation": {**result, "financialChecks": checks,
                      "followUps": followups(idea), "planDraft": summary_plan(idea),
                      "feedbackDraft": feedback_draft(result)}, "metrics": adapter.last_metrics}
    except (CapabilityUnavailable, ModelOutputError):
        assessment = {"status": "pending_model", "quality": quality(idea), "financialChecks": checks,
                      "followUps": followups(idea), "planDraft": summary_plan(idea),
                      "reason": "Groq scorer unavailable or output invalid.",
                      "metrics": adapter.last_metrics if "adapter" in locals() else None}
    return {"input": idea, "assessment": assessment}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        raw = sys.stdin.buffer.read(18 * 1024 * 1024 + 1)
        if len(raw) > 18 * 1024 * 1024:
            raise ValueError("payload_too_large")
        payload = json.loads(raw)
        if set(payload) != {"pdfBase64", "district", "applicantName", "documentId"}:
            raise ValueError("invalid_payload")
        result = assess_pdf(base64.b64decode(payload["pdfBase64"], validate=True),
                            district=payload["district"], applicant_name=payload["applicantName"],
                            document_id=payload["documentId"])
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except UnsupportedEdpPdf as error:
        print(json.dumps({"status": "unsupported_pdf", "code": error.code}), file=sys.stderr)
        return 2
    except (ValueError, TypeError, KeyError):
        print(json.dumps({"status": "invalid_evidence"}), file=sys.stderr)
        return 2
    except Exception:
        print(json.dumps({"status": "worker_unavailable"}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
