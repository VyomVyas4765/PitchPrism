import json
from pathlib import Path
import unittest

from jsonschema import Draft202012Validator

from ai.ingest.pii import ensure_redacted

CONTRACTS = Path(__file__).resolve().parents[2] / "packages" / "contracts"
SCHEMA = json.loads((CONTRACTS / "schemas" / "drafts" / "ingest-output.v0.json").read_text(encoding="utf-8"))
FIXTURES = sorted((CONTRACTS / "fixtures" / "ingest").glob("*.json"))


class IngestFixtureTests(unittest.TestCase):
    """The published Dev 2 fixtures must obey the draft contract and the evidence rules it cannot express."""

    def test_fixtures_exist(self):
        self.assertGreaterEqual(len(FIXTURES), 3)
        Draft202012Validator.check_schema(SCHEMA)

    def test_each_fixture_is_valid_cited_and_redacted(self):
        validator = Draft202012Validator(SCHEMA)
        for path in FIXTURES:
            with self.subTest(fixture=path.name):
                data = json.loads(path.read_text(encoding="utf-8"))
                validator.validate(data)
                segments = {segment["segId"]: segment for segment in data["segments"]}
                self.assertEqual(len(segments), len(data["segments"]), "segIds must be unique")
                for segment in segments.values():
                    ensure_redacted(segment["text"])
                    ensure_redacted(segment["textEn"] or "")
                    source = segment["source"]
                    if source["type"] == "text" and "⟨" not in segment["text"]:
                        self.assertEqual(source["charEnd"] - source["charStart"], len(segment["text"]))
                    if source["type"] == "audio":
                        self.assertLess(source["start"], source["end"])
                    if segment["struck"]:
                        self.assertIn(segment["supersededBy"], segments)
                cited = [*data["fields"].values(), *(item for item in (data["summary"], data["problemAddressed"]) if item)]
                for value in cited:
                    ensure_redacted(value["value"])
                    for seg_id in value["segIds"]:
                        self.assertIn(seg_id, segments)
                        self.assertFalse(segments[seg_id]["struck"], "struck values are history, never evidence")
                for qa in data["qa"]:
                    for seg_id in qa["answerSegIds"]:
                        self.assertIn(seg_id, segments)
                    if qa["state"] == "answered":
                        self.assertTrue(qa["answerSegIds"])
                    if qa["state"] in ("missing", "not_asked"):
                        self.assertEqual(qa["answerSegIds"], [])
                        self.assertNotIn(qa["canonicalField"], data["fields"], "missing answers are never filled in")
                    if qa["state"] == "not_asked":
                        self.assertIsNone(qa["question"])
                    for overwrite in qa["overwrites"]:
                        self.assertTrue(segments[overwrite["fromSegId"]]["struck"])
                        self.assertEqual(segments[overwrite["fromSegId"]]["supersededBy"], overwrite["toSegId"])
                        self.assertIn(overwrite["toSegId"], qa["answerSegIds"])


if __name__ == "__main__":
    unittest.main()
