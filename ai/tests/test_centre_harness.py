import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from ai.eval.harness import run_manifest
from ai.tests.test_centre_scoring import sample


class CentreHarnessTests(unittest.TestCase):
    def test_missing_private_extractions_are_not_reported_as_a_pass(self):
        manifest = {"version": 1, "files": [{"id": "synthetic-1", "expect": {"answered": ["offering"]}}]}
        with TemporaryDirectory() as directory:
            report = run_manifest(manifest, Path(directory), lambda _: self.fail("No extraction, no model run"))
        self.assertFalse(report["complete"])
        self.assertEqual(report["missingExtraction"], 1)
        self.assertIsNone(report["fieldStateAccuracy"])

    def test_counts_field_states_and_parity_without_private_content_in_report(self):
        manifest = {"version": 1, "files": [
            {"id": "synthetic-1", "parityGroup": "same-idea", "expect": {"answered": ["offering"]}},
            {"id": "synthetic-2", "parityGroup": "same-idea", "expect": {"answered": ["offering"]}},
        ]}
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for entry in manifest["files"]:
                (root / f"{entry['id']}.json").write_text(json.dumps(sample()))
            report = run_manifest(manifest, root, lambda _: {"potential": 80, "band": "Strong", "flags": []})
        self.assertTrue(report["complete"])
        self.assertEqual(report["fieldStateAccuracy"], 1)
        self.assertEqual(report["parity"]["same-idea"]["gap"], 0)
        self.assertIsNone(report["canonicalValueAccuracy"])
        self.assertNotIn("Synthetic relevant answer", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
