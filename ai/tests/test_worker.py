"""The pipeline worker runs real stages from the queue (A-28) on a throwaway local database with synthetic data."""
import os
import unittest

from bson import ObjectId

from ai.providers import CapabilityUnavailable
from ai.tests.test_centre_scoring import sample, scorer

try:
    from pymongo import MongoClient
    from pymongo.errors import PyMongoError
    from ai.jobqueue import Consumer, now
    from ai.worker import handler_for
except ImportError:  # pragma: no cover - pymongo not installed
    MongoClient = None

TEST_URI = os.getenv("PITCHPRISM_WORKER_TEST_MONGODB_URI", "mongodb://127.0.0.1:27017/pitchprism_worker_test")


def _database():
    if MongoClient is None:
        return None
    try:
        client = MongoClient(TEST_URI, tz_aware=True, serverSelectionTimeoutMS=1500)
        client.admin.command("ping")
        return client.get_default_database()
    except PyMongoError:
        return None


DB = _database()


class FakeAdapter:
    """Stands in for the local model: answers through the synthetic scorer used by Dev 2's tests."""
    class settings:
        model = "synthetic-scorer"

    def complete_json(self, prompt, schema):
        return scorer(prompt, schema)


def unavailable():
    raise CapabilityUnavailable("no local model installed")


@unittest.skipIf(DB is None, "local MongoDB (or pymongo) unavailable")
class WorkerTests(unittest.TestCase):
    def setUp(self):
        DB.client.drop_database(DB.name)
        DB.create_collection("stageEvents", capped=True, size=1024 * 1024)
        self.org, self.submission = ObjectId(), ObjectId()
        DB["submissions"].insert_one({"_id": self.submission, "ownerOrgId": self.org, "entrepreneurId": ObjectId(), "status": "QUEUED"})

    @classmethod
    def tearDownClass(cls):
        DB.client.drop_database(DB.name)

    def case(self, idea=None, **extra):
        DB["centrecases"].insert_one({"submissionId": self.submission, "ownerOrgId": self.org, "input": idea or sample(), "state": "READY", **extra})

    def enqueue(self, from_stage="ingest", **extra):
        DB["jobs"].insert_one({"submissionId": self.submission, "ownerOrgId": self.org, "fromStage": from_stage, "reason": "new",
                               "idempotencyKey": str(ObjectId()), "status": "queued", "attempts": 0, "maxAttempts": 3,
                               "availableAt": now(), "createdAt": now(), **extra})

    def run_job(self, adapter=FakeAdapter):
        return Consumer(DB, handler_for(DB, adapter), "worker").run_once()

    def stages(self):
        return [(event["stage"], event["status"]) for event in DB["stageEvents"].find({"status": {"$ne": "started"}}).sort("_id", 1)]

    def test_runs_every_stage_for_real_and_skips_what_is_not_built(self):
        self.case()
        self.enqueue()
        self.assertEqual(self.run_job(), "done")
        self.assertEqual(self.stages(), [
            ("ingest", "skipped"), ("classify", "skipped"), ("read", "skipped"), ("structure", "skipped"), ("translate", "skipped"),
            ("extract", "skipped"), ("redact", "done"), ("quality", "done"), ("followup", "done"), ("normalise", "skipped"),
            ("similar", "skipped"), ("local", "skipped"), ("score", "done"), ("narrative", "done"), ("rank", "skipped"),
            ("feedback", "done"), ("route", "done")])
        case = DB["centrecases"].find_one()
        self.assertEqual((case["state"], case["evaluation"]["potential"], case["evaluation"]["band"]), ("READY", 80, "Strong"))
        self.assertEqual(DB["submissions"].find_one()["status"], "READY")
        score = DB["pipelineRuns"].find_one({"stage": "score"})
        self.assertEqual((score["model"], score["llmCalls"], score["hostedCostInr"]), ("synthetic-scorer", 2, 0))

    def test_the_published_rubric_version_drives_the_score(self):
        rubric = DB["rubrics"].insert_one({"rubricKey": "synthetic", "version": 2, "name": "Synthetic", "status": "published",
            "bands": {"strong": 85, "promising": 50, "minCoverage": 60},
            "domains": [{"key": key, "weight": weight, "label": key, "lowDescriptor": "low", "highDescriptor": "high"}
                        for key, weight in (("clarity", 10), ("customer_need", 15), ("market_potential", 15), ("feasibility", 15),
                                            ("competition_awareness", 10), ("differentiation", 10), ("financial_logic", 15), ("entrepreneur_readiness", 10))]})
        self.assertTrue(rubric.inserted_id)
        self.case()
        self.enqueue(from_stage="score", rubricKey="synthetic", rubricVersion=2)
        self.assertEqual(self.run_job(), "done")
        evaluation = DB["centrecases"].find_one()["evaluation"]
        self.assertEqual((evaluation["rubricVersion"], evaluation["potential"], evaluation["band"]), ("synthetic-v2", 80, "Promising"))
        self.assertEqual(self.stages()[0], ("score", "done"))  # a rescore starts at scoring

    def test_without_extracted_evidence_the_job_fails_visibly(self):
        self.enqueue()
        self.assertEqual(self.run_job(), "failed")
        job = DB["jobs"].find_one()
        self.assertEqual((job["error"]["code"], job["error"]["stage"]), ("capability_unavailable", "ingest"))
        self.assertEqual(DB["submissions"].find_one()["status"], "FAILED")

    def test_unredacted_evidence_is_refused(self):
        idea = sample()
        idea["segments"][1]["textEn"] = "Call me on 9876543210"
        self.case(idea)
        self.enqueue()
        self.assertEqual(self.run_job(), "failed")
        job = DB["jobs"].find_one()
        self.assertEqual((job["error"]["code"], job["error"]["stage"]), ("invalid_input", "redact"))
        self.assertNotIn("9876543210", str(job) + str(list(DB["stageEvents"].find())))

    def test_missing_model_keeps_quality_and_fails_the_score_stage(self):
        self.case()
        self.enqueue()
        self.assertEqual(self.run_job(adapter=unavailable), "failed")
        case = DB["centrecases"].find_one()
        self.assertEqual((case["state"], case["evaluation"], case["quality"]["completeness"]), ("PENDING_MODEL", None, 100))
        job = DB["jobs"].find_one()
        self.assertEqual((job["error"]["code"], job["error"]["stage"]), ("capability_unavailable", "score"))

    def test_a_rescore_of_a_decided_idea_archives_the_old_evaluation_and_keeps_the_decision(self):
        DB["submissions"].update_one({"_id": self.submission}, {"$set": {"status": "SHORTLISTED"}})
        self.case(evaluation={"potential": 60, "band": "Promising"}, decision={"decision": "shortlist"})
        self.enqueue(from_stage="score")
        self.assertEqual(self.run_job(), "done")
        case = DB["centrecases"].find_one()
        self.assertEqual((case["evaluation"]["potential"], case["evaluationHistory"][0]["evaluation"]["potential"]), (80, 60))
        self.assertEqual(case["decision"], {"decision": "shortlist"})
        self.assertEqual(DB["submissions"].find_one()["status"], "SHORTLISTED")


if __name__ == "__main__":
    unittest.main()
