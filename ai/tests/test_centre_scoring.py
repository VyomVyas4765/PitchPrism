import unittest

from ai.intel.finance import check_finances
from ai.intel.scoring import DOMAINS, FIELDS, InvalidEvidence, evaluate, quality


def sample():
    keys = list(FIELDS) + ["skills"]
    return {"template": "edp-idea-brief", "context": {"businessType": "tailoring", "plannedBusinessLocation": {"district": "Pune", "state": "Maharashtra", "source": "confirmed_by_user", "evidence": ["s_0"]}},
            "segments": [{"segId": f"s_{i}", "textEn": f"Synthetic relevant answer {key}", "lang": "en",
                          "source": {"type": "pdf", "documentId": "synthetic", "page": 1 if i < 6 else 2}}
                         for i, key in enumerate(keys)],
            "fields": {key: {"state": "answered", "evidence": [f"s_{i}"]} for i, key in enumerate(keys)}}


def scorer(prompt, schema):
    import json
    payload = json.loads(prompt[prompt.index('{'):])
    return {"domains": [{"key": key, "score": 4, "reason": "Cited synthetic evidence", "evidence": [payload["evidence"][key][0]["segId"]], "confidence": "high"}
                        for key in payload["domains"]]}


class CentreScoringTests(unittest.TestCase):
    def test_full_evidence_scores_eighty_and_retains_citations(self):
        idea = sample()
        result = evaluate(idea, scorer=scorer)
        self.assertEqual(result["potential"], 80)
        self.assertEqual(result["completeness"], 100)
        self.assertEqual(result["coverage"], 100)
        self.assertEqual(result["band"], "Strong")
        self.assertEqual(result["quadrant"], "high_potential_high_completeness")
        self.assertTrue(all(d["evidence"] for d in result["domains"]))
        self.assertEqual(len(result["domains"]), len(DOMAINS))

    def test_missing_is_not_scored_as_weak(self):
        idea = sample()
        idea["fields"]["market_research"] = {"state": "missing", "evidence": []}
        idea["fields"]["competition"] = {"state": "not_asked", "evidence": []}
        result = evaluate(idea, scorer=scorer)
        self.assertEqual(result["potential"], 80)
        self.assertEqual(result["completeness"], 84)
        self.assertIsNone(next(d for d in result["domains"] if d["key"] == "market_potential")["score"])
        self.assertIn("missing", [f["key"] for f in result["flags"]])
        self.assertIn("not_asked", [f["key"] for f in result["flags"]])

    def test_unassessable_skips_model(self):
        idea = sample()
        for key in list(FIELDS)[:7]:
            idea["fields"][key] = {"state": "irrelevant", "evidence": []}
        result = evaluate(idea, scorer=lambda *_: self.fail("model must not run"))
        self.assertIsNone(result["potential"])
        self.assertEqual(result["band"], "Unassessable")

    def test_score_disagreement_needs_attention(self):
        idea = sample()
        calls = 0
        def divergent(prompt, schema):
            nonlocal calls
            calls += 1
            result = scorer(prompt, schema)
            if calls == 2:
                result["domains"][0]["score"] = 1
            return result
        result = evaluate(idea, scorer=divergent)
        self.assertTrue(result["needsAttention"])
        self.assertEqual(result["domains"][0]["runs"], [4, 1])

    def test_funding_is_only_a_suggestion_with_cited_loan_and_feasibility(self):
        idea = sample()
        idea["financials"] = {"loan": {"value": 150000, "segId": "s_6"}}
        self.assertEqual(evaluate(idea, scorer=scorer)["pathway"], "Funding consideration")
        idea["financials"]["loan"]["value"] = 250000
        self.assertEqual(evaluate(idea, scorer=scorer)["pathway"], "Deeper evaluation")

    def test_bad_citation_and_pii_fail_closed(self):
        idea = sample()
        idea["fields"]["offering"]["evidence"] = ["unknown"]
        with self.assertRaises(InvalidEvidence):
            evaluate(idea, scorer=scorer)
        idea = sample()
        idea["segments"][0]["textEn"] = "Contact 9876543210"
        with self.assertRaises(InvalidEvidence):
            quality(idea)

    def test_struck_value_cannot_support_a_current_score(self):
        idea = sample()
        idea["segments"][0]["struck"] = True
        idea["segments"][0]["supersededBy"] = "s_1"
        with self.assertRaises(InvalidEvidence):
            evaluate(idea, scorer=scorer)

    def test_confirmed_business_site_replaces_pdf_location_with_cited_profile_value(self):
        idea = sample()
        idea["fields"]["location"] = {"state": "missing", "evidence": []}
        idea["context"]["plannedBusinessLocation"]["evidence"] = ["s_10"]
        result = evaluate(idea, scorer=scorer)
        self.assertEqual(result["completeness"], 100)
        self.assertNotIn("missing", [f["key"] for f in result["flags"] if f["field"] == "location"])
        idea["context"]["plannedBusinessLocation"]["evidence"] = ["unknown"]
        with self.assertRaises(InvalidEvidence):
            evaluate(idea, scorer=scorer)
        idea = sample()
        def invented(prompt, schema):
            result = scorer(prompt, schema)
            result["domains"][0]["evidence"] = ["invented"]
            return result
        with self.assertRaises(InvalidEvidence):
            evaluate(idea, scorer=invented)
        idea = sample()
        idea["financials"] = {"investment": {"value": 100, "segId": "invented"}}
        with self.assertRaises(InvalidEvidence):
            quality(idea)

    def test_finance_uses_only_supplied_cited_numbers(self):
        values = {"investment": {"value": 100, "segId": "s_1"}, "self": {"value": 30, "segId": "s_2"},
                  "loan": {"value": 60, "segId": "s_3"}, "A": {"value": 100, "segId": "s_4"},
                  "B": {"value": 30, "segId": "s_5"}, "C": {"value": 90, "segId": "s_6"}}
        findings = check_finances(values, {f"s_{i}" for i in range(1, 7)})
        self.assertEqual({f["field"] for f in findings}, {"investment", "C"})
        self.assertEqual(next(f for f in findings if f["field"] == "C")["expected"], "70.00")
        self.assertEqual(check_finances({"investment": values["investment"]}, {"s_1"}), [])


if __name__ == "__main__":
    unittest.main()
