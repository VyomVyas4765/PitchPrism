"""Write redacted extraction sidecars for Dev 2's evaluation harness (A-30).

  python -m ai.ingest.sidecars            # every manifest file present under datasets/raw
  python -m ai.ingest.sidecars pdf-en-1   # selected manifest IDs

Output: ignored datasets/extracted/<manifest-id>.json (CentreExtractedInput) and a summary printed as
counts only. Nothing from the organiser files is printed, logged or committed.
"""
import json
from pathlib import Path
import sys
import time

from ai.ingest.run import Pipeline
from ai.providers import CapabilityUnavailable

ROOT = Path(__file__).resolve().parents[2]
KINDS = {"pdf-digital": "pdf", "pdf-scanned": "pdf", "pdf": "pdf", "audio": "audio", "image": "image"}


def main(selected: list[str]) -> int:
    manifest = json.loads((ROOT / "datasets" / "manifest.json").read_text(encoding="utf-8"))
    out = ROOT / "datasets" / "extracted"
    out.mkdir(parents=True, exist_ok=True)
    pipeline_factory = Pipeline
    summary: dict[str, int] = {}
    for item in manifest["files"]:
        if selected and item["id"] not in selected:
            continue
        started = time.monotonic()
        stages: list[str] = []
        path = ROOT / item["path"]
        kind = next((value for key, value in KINDS.items() if str(item.get("format", "")).startswith(key)), None)
        if not path.exists() or kind is None:
            status = "missing_file" if not path.exists() else "unsupported_format"
        else:
            languages = item.get("languages", {}).get("answers") or [None]
            try:
                result = pipeline_factory().run({"documents": [{"documentId": item["id"], "kind": kind, "path": str(path)}],
                                                 "language": languages[0] if len(languages) == 1 else None})
                status = result["status"]
                stages = sorted({entry.get("stage", "?") for entry in result.get("pending", [])})
                if status == "extracted":
                    (out / f"{item['id']}.json").write_text(json.dumps(result["extracted"], ensure_ascii=False, indent=1), encoding="utf-8")
            except CapabilityUnavailable:
                status = "pending_capability"
            except Exception:
                status = "failed"
        summary[status] = summary.get(status, 0) + 1
        # Progress: manifest ID, status and time only (no organiser content).
        print(json.dumps({"id": item["id"], "status": status, "stages": stages, "seconds": round(time.monotonic() - started, 1)}), file=sys.stderr, flush=True)
    print(json.dumps({"sidecars": summary}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
