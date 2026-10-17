"""Private organiser-data evaluation. Reports missing evidence instead of invented metrics."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import time
from typing import Any, Callable

from ai.config import Settings
from ai.intel.scoring import evaluate
from ai.llm.adapter import LocalJsonAdapter


def run_manifest(manifest: dict[str, Any], extracted_dir: Path,
                 assessor: Callable[[dict[str, Any]], dict[str, Any]]) -> dict[str, Any]:
    totals: Counter[str] = Counter()
    results = []
    groups: dict[str, list[int]] = defaultdict(list)
    for entry in manifest["files"]:
        file_id = entry["id"]
        path = extracted_dir / f"{file_id}.json"
        if not path.is_file():
            totals["missing_extraction"] += 1
            results.append({"id": file_id, "status": "missing_extraction"})
            continue
        started = time.monotonic()
        try:
            idea = json.loads(path.read_text())
            assessment = assessor(idea)
            expected = entry.get("expect", {})
            fields = idea.get("fields", {})
            checks = []
            for state_key, state in (("answered", "answered"), ("missing", "missing"), ("notAsked", "not_asked"), ("irrelevant", "irrelevant")):
                for key in expected.get(state_key, []):
                    observed = fields.get(key, {}).get("state", "not_asked")
                    checks.append({"field": key, "expected": state, "observed": observed, "correct": observed == state})
                    totals["field_state_checks"] += 1
                    totals["field_state_correct"] += observed == state
            expected_flags = set(expected.get("flags", []))
            observed_flags = {flag["key"] for flag in assessment.get("flags", [])}
            for key in expected_flags:
                totals["expected_flags"] += 1
                totals["found_flags"] += key in observed_flags
            potential = assessment.get("potential")
            group = entry.get("parityGroup")
            if group and isinstance(potential, int):
                groups[group].append(potential)
            totals["assessed"] += 1
            results.append({"id": file_id, "status": "assessed", "fieldChecks": checks,
                            "potential": potential, "band": assessment.get("band"),
                            "expectedFlags": sorted(expected_flags), "observedFlags": sorted(observed_flags),
                            "durationMs": round((time.monotonic() - started) * 1000)})
        except Exception:
            # Never echo the source file, person, prompt, transcript, or raw model error.
            totals["failed"] += 1
            results.append({"id": file_id, "status": "failed", "reason": "Extraction or assessment failed validation."})
    parity = {key: {"count": len(scores), "gap": max(scores) - min(scores), "pass": max(scores) - min(scores) <= 5}
              for key, scores in groups.items() if len(scores) >= 2}
    return {"runAt": datetime.now(timezone.utc).isoformat(), "manifestVersion": manifest.get("version"),
            "total": len(manifest["files"]), "assessed": totals["assessed"], "missingExtraction": totals["missing_extraction"],
            "failed": totals["failed"],
            "fieldStateAccuracy": round(totals["field_state_correct"] / totals["field_state_checks"], 4) if totals["field_state_checks"] else None,
            "canonicalValueAccuracy": None,  # Manifest records expected behaviour, not verified field-value ground truth.
            "flagRecall": round(totals["found_flags"] / totals["expected_flags"], 4) if totals["expected_flags"] else None,
            "parity": parity, "files": results,
            "complete": totals["missing_extraction"] == 0 and totals["failed"] == 0 and totals["assessed"] == len(manifest["files"])}


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate private organiser extractions with local scoring")
    parser.add_argument("--manifest", type=Path, default=Path("datasets/manifest.json"))
    parser.add_argument("--extracted", type=Path, default=Path("datasets/extracted"))
    parser.add_argument("--report", type=Path, default=Path("datasets/reports/centre-evaluation.json"))
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    # Do not even initialise the model until at least one private extraction is present.
    adapter = None
    def assessor(idea):
        nonlocal adapter
        if adapter is None:
            adapter = LocalJsonAdapter(Settings.from_env())
        return evaluate(idea, adapter)
    report = run_manifest(manifest, args.extracted, assessor)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(json.dumps({key: report[key] for key in ("total", "assessed", "missingExtraction", "failed", "complete")}, indent=2))
    return 0 if report["complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
