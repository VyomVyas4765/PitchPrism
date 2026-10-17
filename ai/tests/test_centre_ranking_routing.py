import unittest

from ai.intel.ranking import rank_snapshot
from ai.intel.routing import suggest_partners


class RankingRoutingTests(unittest.TestCase):
    def test_rank_does_not_mix_rubrics_or_scopes(self):
        rows = [
            {"submissionId": "a", "rubricVersion": "v1", "cohortId": "c1", "potential": 80},
            {"submissionId": "b", "rubricVersion": "v1", "cohortId": "c1", "potential": 80},
            {"submissionId": "c", "rubricVersion": "v1", "cohortId": "c1", "potential": 40},
            {"submissionId": "d", "rubricVersion": "v2", "cohortId": "c1", "potential": 100},
            {"submissionId": "e", "rubricVersion": "v1", "cohortId": "c2", "potential": 100},
        ]
        entries = rank_snapshot(rows, "v1", "cohortId", "c1")["entries"]
        self.assertEqual([entry["rank"] for entry in entries], [1, 1, 3])
        self.assertEqual([entry["submissionId"] for entry in entries], ["a", "b", "c"])

    def test_routing_requires_live_consent_and_funding_readiness(self):
        idea = {"tradeKey": "tailoring", "sector": "apparel", "district": "Pune", "decision": "shortlist", "fundingReady": True}
        rules = [{"active": True, "partnerType": "sector_partner", "partnerOrgId": "s", "trades": ["tailoring"], "districts": ["Pune"]},
                 {"active": True, "partnerType": "funding_partner", "partnerOrgId": "f", "sectors": ["apparel"]}]
        consent = [{"partnerType": "sector_partner", "active": True}, {"partnerType": "funding_partner", "active": False}]
        self.assertEqual([item["partnerOrgId"] for item in suggest_partners(idea, rules, consent)], ["s"])
        consent[0]["active"] = False
        self.assertEqual(suggest_partners(idea, rules, consent), [])
        consent[1]["active"] = True
        idea["fundingReady"] = False
        self.assertEqual(suggest_partners(idea, rules, consent), [])
        consent[0].update({"active": True, "orgId": "another-sector-org"})
        self.assertEqual(suggest_partners(idea, rules, consent), [])


if __name__ == "__main__":
    unittest.main()
