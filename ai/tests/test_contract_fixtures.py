import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator

from ai.ingest.pii import ensure_redacted
from ai.intel.scoring import prepare_input

CONTRACTS = Path(__file__).resolve().parents[2] / "packages" / "contracts"
SCHEMA = json.loads((CONTRACTS / "schemas" / "centre-extracted-input.json").read_text(encoding="utf-8"))
FIXTURES = sorted((CONTRACTS / "fixtures" / "extracted-input").glob("*.json"))


class ExtractedInputFixtureTests(unittest.TestCase):
    """Dev 1's published extraction fixtures must satisfy the one shared Dev 1 → Dev 2 contract."""

    def test_fixtures_cover_text_audio_and_pdf_sources(self):
        kinds = {segment["source"]["type"] for path in FIXTURES
                 for segment in json.loads(path.read_text(encoding="utf-8"))["segments"]}
        self.assertTrue({"text", "audio", "pdf"} <= kinds)

    def test_each_fixture_is_valid_redacted_and_accepted_by_the_scorer(self):
        validator = Draft202012Validator(SCHEMA)
        for path in FIXTURES:
            with self.subTest(fixture=path.name):
                data = json.loads(path.read_text(encoding="utf-8"))
                validator.validate(data)
                prepare_input(data)  # Dev 2's fail-closed citation and redaction checks
                segments = {segment["segId"]: segment for segment in data["segments"]}
                for segment in segments.values():
                    ensure_redacted(segment["textEn"])
                    ensure_redacted(segment.get("textOriginal", ""))
                    if segment.get("struck"):
                        self.assertIn(segment["supersededBy"], segments)
                    if segment["source"]["type"] == "audio":
                        self.assertLess(segment["source"]["start"], segment["source"]["end"])
                for field in data["fields"].values():
                    if field["state"] in ("missing", "not_asked"):
                        self.assertEqual(field["evidence"], [], "missing answers are never filled in")
                    for seg_id in field["evidence"]:
                        self.assertFalse(segments[seg_id].get("struck"), "struck values are history, never evidence")


if __name__ == "__main__":
    unittest.main()
