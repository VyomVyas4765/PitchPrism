"""Unpack the organiser archives into the paths the manifest names (ignored datasets/raw/).

  python -m ai.ingest.extract_dataset [archive folder]   # default: datasets/datasets

Each file is written only to its manifest `path` (never to a name taken from the archive), and its
size is checked against the manifest. Prints counts only; organiser content is never printed.
"""
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def main(folder: Path) -> int:
    manifest = json.loads((ROOT / "datasets" / "manifest.json").read_text(encoding="utf-8"))
    archives = {path.name: path for path in folder.glob("*.zip")}
    counts = {"extracted": 0, "already_present": 0, "archive_missing": 0, "entry_missing": 0, "size_mismatch": 0}
    open_archives: dict[str, zipfile.ZipFile] = {}
    try:
        for item in manifest["files"]:
            archive_name, _, inner = item["originalPath"].partition("::")
            target = ROOT / item["path"]
            if not target.resolve().is_relative_to((ROOT / "datasets" / "raw").resolve()):
                raise ValueError("Manifest path outside datasets/raw.")
            if target.exists() and target.stat().st_size == item["bytes"]:
                counts["already_present"] += 1
                continue
            if archive_name not in archives:
                counts["archive_missing"] += 1
                continue
            archive = open_archives.setdefault(archive_name, zipfile.ZipFile(archives[archive_name]))
            try:
                data = archive.read(inner)
            except KeyError:
                counts["entry_missing"] += 1
                continue
            if len(data) != item["bytes"]:
                counts["size_mismatch"] += 1
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            counts["extracted"] += 1
    finally:
        for archive in open_archives.values():
            archive.close()
    print(json.dumps(counts))
    return 0 if counts["archive_missing"] == counts["entry_missing"] == counts["size_mismatch"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "datasets" / "datasets"))
