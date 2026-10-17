"""The review harness runs every synthetic case to an end and reports its metrics (fake model; numbers are plumbing only)."""
import json
import unittest

from ai.eval.review_harness import CASES, run_case, summarise
from ai.review.criteria import CORE
from ai.tests.review_fakes import FakeLLM


class ReviewHarnessTests(unittest.TestCase):
    def test_cases_are_well_formed_and_synthetic(self):
        cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
        self.assertGreaterEqual(len(cases), 15)
        self.assertEqual(len({case["id"] for case in cases}), len(cases))
        for case in cases:
            self.assertTrue(set(case["gaps"]) <= set(CORE), case["id"])
            # Every expected gap has a fact (or an explicit null meaning "not decided") for the simulated entrepreneur.
            self.assertTrue(set(case["gaps"]) <= set(case["facts"]), case["id"])

    def test_every_case_reaches_an_end_with_rule_abiding_questions(self):
        cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
        results = [run_case(case, FakeLLM(), "fake") for case in cases]
        self.assertTrue(all(item["status"] == "complete" for item in results))
        summary = summarise(results)
        self.assertEqual((summary["badQuestions"], summary["failedCalls"], summary["completed"]), (0, 0, len(cases)))
        self.assertEqual(next(item for item in results if item["id"] == "complete-tailoring")["rounds"], 0)
        # The entrepreneur who has not checked demand or competitors ends with those topics declined, not invented.
        self.assertTrue({"competition", "market_research"} <= set(next(item for item in results if item["id"] == "doesnt-know")["declined"]))


if __name__ == "__main__":
    unittest.main()
