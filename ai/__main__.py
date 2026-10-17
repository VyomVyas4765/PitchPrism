"""Inspect local capabilities; never imply that unimplemented pipeline stages ran."""
import argparse
import json
from pathlib import Path
import sys

from ai.config import PolicyViolation, Settings
from ai.providers import CapabilityUnavailable
from ai.llm.adapter import LocalJsonAdapter, ModelOutputError


def main():
    parser = argparse.ArgumentParser(description="PitchPrism local AI foundation")
    parser.add_argument("--check-runtime", action="store_true", help="Inspect installed local models without downloading or generating")
    arguments = parser.parse_args()
    try:
        settings = Settings.from_env()
        capabilities = json.loads(Path(__file__).with_name("capabilities.json").read_text())
        report = {"service": "ai", "status": "foundation_only", "runtime": "local", "hosted_apis_enabled": False,
                  "queue_consumer": "not_implemented", "capabilities": capabilities}
        if arguments.check_runtime:
            models = LocalJsonAdapter(settings).installed_models()
            report["installed_models"] = [{"name": model.get("name"), "bytes": model.get("size"),
                                            "remote": bool(model.get("remote_host") or model.get("remote_model"))} for model in models]
            report["selected_model"] = settings.model or None
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (PolicyViolation, CapabilityUnavailable, ModelOutputError, ValueError):
        print(json.dumps({"status": "not_ready", "message": "Local AI policy/runtime check failed. No hosted fallback or download was attempted. Check ai/README.md."}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
