"""Local assessment handoff for the API until the shared durable worker is mounted."""
import json
from pathlib import Path
import sys

from jsonschema import Draft202012Validator

from ai.config import PolicyViolation
from ai.intel.finance import check_finances
from ai.intel.scoring import InvalidEvidence, evaluate, prepare_input, quality
from ai.intel.narrative import feedback_draft, followups, summary_plan
from ai.llm.adapter import ModelOutputError
from ai.llm.factory import make_adapter
from ai.llm.groq import RateLimited
from ai.providers import CapabilityUnavailable


def main():
    # The API decodes this pipe as UTF-8; Windows would otherwise default to a legacy code page and
    # fail on ₹ or Indic text, which surfaced as a misleading "invalid input".
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("input_too_large")
        idea = json.loads(raw)
        schema_path = Path(__file__).resolve().parents[2] / "packages/contracts/schemas/centre-extracted-input.json"
        Draft202012Validator(json.loads(schema_path.read_text(encoding="utf-8"))).validate(idea)
        _, _, valid_ids = prepare_input(idea)
        checks = check_finances(idea.get("financials", {}), valid_ids)
        try:
            result = evaluate(idea, make_adapter())
            print(json.dumps({"status": "assessed", "evaluation": {**result, "financialChecks": checks,
                            "followUps": followups(idea), "planDraft": summary_plan(idea),
                            "feedbackDraft": feedback_draft(result)}}, ensure_ascii=False))
        except (CapabilityUnavailable, ModelOutputError, PolicyViolation, RateLimited):
            # The quality and deterministic arithmetic remain useful, but no potential score is fabricated.
            print(json.dumps({"status": "pending_model", "quality": quality(idea), "financialChecks": checks,
                              "followUps": followups(idea), "planDraft": summary_plan(idea),
                              "reason": "Local scoring model unavailable or output invalid."}, ensure_ascii=False))
        return 0
    except (ValueError, InvalidEvidence, KeyError, TypeError, json.JSONDecodeError):
        print(json.dumps({"status": "invalid_input", "reason": "Extracted evidence is invalid or not safely redacted."}), file=sys.stderr)
        return 2
    except Exception:
        # Includes schema validation failure; never print input, prompt or upstream exceptions.
        print(json.dumps({"status": "invalid_input", "reason": "Assessment input failed validation."}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
