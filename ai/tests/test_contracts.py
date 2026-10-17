"""The worker's generated contracts accept the shared synthetic fixtures and reject drift (D-03)."""
import json
import unittest
from pathlib import Path

from ai.contracts import COLLECTIONS, errors, validate

FIXTURES = Path(__file__).resolve().parents[2] / "packages" / "contracts" / "fixtures" / "synthetic.json"
ENTITY_FOR = {collection: entity for entity, collection in COLLECTIONS.items()}


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))

    def test_every_fixture_matches_its_contract(self):
        for collection, docs in self.fixtures.items():
            if collection.startswith("_"):
                continue
            entity = ENTITY_FOR[collection]
            for doc in docs:
                body = {key: value for key, value in doc.items() if key != "_id"}
                self.assertEqual(errors(entity, body), [], f"{collection} {doc.get('_id', '')}")

    def test_stage_event_rejects_unknown_fields_and_stages(self):
        event = dict(self.fixtures["stageEvents"][0])
        validate("StageEvent", event)
        with self.assertRaises(ValueError):
            validate("StageEvent", {**event, "prompt": "must never be stored"})
        with self.assertRaises(ValueError):
            validate("StageEvent", {**event, "stage": "bogus"})

    def test_error_messages_name_paths_not_values(self):
        problems = errors("Job", {**{k: v for k, v in self.fixtures["jobs"][0].items() if k != "_id"}, "ownerOrgId": "private-value"})
        self.assertTrue(problems)
        self.assertNotIn("private-value", " ".join(problems))


if __name__ == "__main__":
    unittest.main()
