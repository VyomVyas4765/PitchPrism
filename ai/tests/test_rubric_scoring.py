"""A published rubric (W-02) drives the calculator: weights, bands and pathway rules (synthetic evidence only)."""
import json
import unittest

from ai.intel.scoring import DOMAINS, evaluate, rubric_settings
from ai.tests.test_centre_scoring import sample, scorer


def scored(scores):
    """A scorer that gives each domain a chosen score."""
    def run(prompt, schema):
        payload = json.loads(prompt[prompt.index('{'):])
        return {"domains": [{"key": key, "score": scores.get(key, 4), "reason": "Cited synthetic evidence",
                             "evidence": [payload["evidence"][key][0]["segId"]], "confidence": "high"} for key in payload["domains"]]}
    return run


def published(**changes):
    domains = [{"key": key, "label": key, "weight": weight, "lowDescriptor": "low", "highDescriptor": "high", "evidenceFields": list(fields)}
               for key, (weight, fields) in DOMAINS.items()]
    return {"version": "synthetic-v2", "domains": domains, **changes}


class RubricScoringTests(unittest.TestCase):
    def test_without_a_rubric_the_defaults_apply(self):
        domains, bands, rules = rubric_settings(sample())
        self.assertIs(domains, DOMAINS)
        self.assertEqual((bands["strong"], rules["fundingMaxLoan"]), (70, 200000))

    def test_bands_come_from_the_rubric(self):
        idea = sample()
        idea["rubric"] = published(bands={"strong": 85, "promising": 50, "minCoverage": 60})
        result = evaluate(idea, scorer=scorer)
        self.assertEqual((result["potential"], result["band"], result["rubricVersion"]), (80, "Promising", "synthetic-v2"))

    def test_weights_come_from_the_rubric(self):
        idea = sample()
        rubric = published()
        for domain in rubric["domains"]:
            domain["weight"] = 30 if domain["key"] == "financial_logic" else 10
        idea["rubric"] = rubric
        result = evaluate(idea, scorer=scored({"financial_logic": 1}))
        # 100 * (70*4 + 30*1) / (5*100) = 62, against 71 with the default weights.
        self.assertEqual(result["potential"], 62)
        self.assertEqual({d["key"]: d["weight"] for d in result["domains"]}["financial_logic"], 30)

    def test_pathway_rules_come_from_the_rubric(self):
        idea = sample()
        idea["financials"] = {"loan": {"value": 150000, "segId": "s_6"}}
        idea["rubric"] = published(pathwayRules={"fundingMaxLoan": 100000})
        self.assertNotEqual(evaluate(idea, scorer=scored({"feasibility": 5}))["pathway"], "Funding consideration")
        idea["rubric"] = published(pathwayRules={"fundingMaxLoan": 200000})
        self.assertEqual(evaluate(idea, scorer=scored({"feasibility": 5}))["pathway"], "Funding consideration")

    def test_a_rubric_whose_weights_do_not_total_100_is_refused(self):
        idea = sample()
        rubric = published()
        rubric["domains"][0]["weight"] += 5
        idea["rubric"] = rubric
        with self.assertRaises(ValueError):
            evaluate(idea, scorer=scorer)


if __name__ == "__main__":
    unittest.main()
