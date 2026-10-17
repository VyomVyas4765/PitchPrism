import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
BANK = json.loads((ROOT / "data" / "seed" / "question-bank.json").read_text(encoding="utf-8"))
CONTRACT = json.loads((ROOT / "packages" / "contracts" / "schemas" / "drafts" / "ingest-output.v0.json").read_text(encoding="utf-8"))
CANONICAL = CONTRACT["$defs"]["CanonicalField"]["enum"]
CORE = CANONICAL[:10]
LANGUAGES = CONTRACT["$defs"]["Language"]["enum"][:-1]  # without "und"


class QuestionBankTests(unittest.TestCase):
    def test_fields_match_the_canonical_contract(self):
        self.assertEqual([key for key, field in BANK["fields"].items() if field["core"]], CORE)
        for key, field in BANK["fields"].items():
            self.assertIn(key, CANONICAL)
            self.assertTrue(field["wordings"]["en"], key)

    def test_guided_steps_cover_every_core_field_once_within_two_minutes(self):
        covered = [field for step in BANK["guidedSteps"] for field in step["fields"]]
        self.assertEqual(len(BANK["guidedSteps"]), 5)
        self.assertEqual(len(covered), len(set(covered)))
        self.assertTrue(set(CORE) <= set(covered))
        for step in BANK["guidedSteps"]:
            self.assertLessEqual(step["maxSeconds"], 120)
            self.assertTrue(set(step["fields"]) <= set(BANK["fields"]))

    def test_every_launch_language_has_a_prompt_and_an_explicit_review_state(self):
        self.assertEqual(set(BANK["review"]), set(LANGUAGES))
        for step in BANK["guidedSteps"]:
            self.assertEqual(set(step["prompt"]), set(LANGUAGES), step["key"])
            self.assertTrue(all(text.strip() for text in step["prompt"].values()))


if __name__ == "__main__":
    unittest.main()
