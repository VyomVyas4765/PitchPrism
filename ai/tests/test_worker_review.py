"""The worker runs the pitch review (D-33) on a text pitch: questions, answers through the inbox, then scoring. Synthetic data only."""
import os
import unittest

from bson import ObjectId

from ai.tests.review_fakes import FACTS, FakeLLM
from ai.tests.test_centre_scoring import scorer
from ai.tests.test_review import GAPPY_PITCH

try:
    from gridfs import GridFSBucket
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


class ReviewAdapter:
    """One local model for both jobs: review prompts go to the fake reviewer, scoring prompts to Dev 2's test scorer."""
    class settings:
        model = "synthetic-local"

    def __init__(self):
        self.review = FakeLLM()

    def complete_json(self, prompt, schema):
        return scorer(prompt, schema) if "domains" in schema["properties"] else self.review(prompt, schema)


@unittest.skipIf(DB is None, "local MongoDB (or pymongo) unavailable")
class WorkerReviewTests(unittest.TestCase):
    def setUp(self):
        DB.client.drop_database(DB.name)
        DB.create_collection("stageEvents", capped=True, size=1024 * 1024)
        self.bucket = GridFSBucket(DB, bucket_name="originals")
        self.org, self.submission, self.user = ObjectId(), ObjectId(), ObjectId()
        DB["submissions"].insert_one({"_id": self.submission, "ownerOrgId": self.org, "entrepreneurId": self.user, "status": "QUEUED",
                                      "inputVersion": 1})
        pitch = DB["pitches"].insert_one({"submissionId": self.submission, "status": "SUBMITTED"}).inserted_id
        storage = self.bucket.upload_from_stream("pitch.txt", GAPPY_PITCH.encode())
        DB["documents"].insert_one({"pitchId": pitch, "purpose": "pitch", "state": "complete", "kind": "text",
                                    "declaredMime": "text/plain", "storageId": storage})

    @classmethod
    def tearDownClass(cls):
        DB.client.drop_database(DB.name)

    def enqueue(self, reason="new", from_stage="ingest"):
        DB["jobs"].insert_one({"submissionId": self.submission, "ownerOrgId": self.org, "fromStage": from_stage, "reason": reason,
                               "idempotencyKey": str(ObjectId()), "status": "queued", "attempts": 0, "maxAttempts": 3,
                               "availableAt": now(), "createdAt": now()})

    def run_job(self):
        adapter = ReviewAdapter()
        return Consumer(DB, handler_for(DB, lambda: adapter), "worker").run_once()

    def answer(self, reply):
        """What the API does: store each answer as a private original, add it to the inbox, queue a follow-up job."""
        session = DB["reviewSessions"].find_one({"submissionId": self.submission})
        pending = [q for q in session["questions"] if q["status"] == "pending"]
        inbox = [{"qId": q["qId"], "storageId": self.bucket.upload_from_stream(q["qId"], reply(q["field"]).encode()),
                  "receivedAt": now(), "byUserId": self.user} for q in pending]
        DB["reviewSessions"].update_one({"_id": session["_id"]}, {"$push": {"inbox": {"$each": inbox}}})
        self.enqueue("followup", "extract")
        return [q["field"] for q in pending]

    def test_text_pitch_is_reviewed_questioned_completed_and_scored(self):
        self.enqueue()
        self.assertEqual(self.run_job(), "done")
        submission = DB["submissions"].find_one()
        self.assertEqual(submission["status"], "NEEDS_INPUT")
        self.assertEqual([(f["qId"], f["field"], f["status"]) for f in submission["followUps"]],
                         [("f1", "customers", "pending"), ("f2", "location", "pending"), ("f3", "funding", "pending")])
        stages = [(e["stage"], e["status"]) for e in DB["stageEvents"].find({"status": {"$ne": "started"}}).sort("_id", 1)]
        self.assertEqual(stages, [("ingest", "done"), ("classify", "skipped"), ("read", "skipped"), ("structure", "done"), ("redact", "done"),
                                  ("translate", "skipped"), ("extract", "done"), ("quality", "done"), ("followup", "done")])
        self.assertIsNone(DB["centrecases"].find_one())
        rounds = 0
        while DB["submissions"].find_one()["status"] == "NEEDS_INPUT":
            rounds += 1
            self.assertLessEqual(rounds, 6)
            self.answer(lambda field: FACTS[field])
            self.assertEqual(self.run_job(), "done")
        submission = DB["submissions"].find_one()
        self.assertEqual(submission["status"], "READY")
        self.assertTrue(all(f["status"] == "answered" for f in submission["followUps"]))
        session = DB["reviewSessions"].find_one()
        self.assertEqual((session["status"], session["inbox"]), ("complete", []))
        case = DB["centrecases"].find_one()
        self.assertEqual((case["state"], case["evaluation"]["completeness"], case["evaluation"]["band"]), ("READY", 100, "Strong"))
        self.assertEqual(case["input"]["context"]["plannedBusinessLocation"]["district"], "Nashik")

    def test_a_followup_job_without_a_waiting_review_fails_visibly(self):
        self.enqueue("followup", "extract")
        self.assertEqual(self.run_job(), "failed")
        self.assertEqual(DB["jobs"].find_one()["error"]["code"], "invalid_input")

    def test_a_pitch_without_text_fails_visibly_at_ingest(self):
        DB["documents"].update_many({}, {"$set": {"kind": "audio"}})
        self.enqueue()
        self.assertEqual(self.run_job(), "failed")
        job = DB["jobs"].find_one()
        self.assertEqual((job["error"]["code"], job["error"]["stage"]), ("capability_unavailable", "ingest"))

    def test_non_english_pitch_stops_at_translation_until_provider_is_available(self):
        DB["pitches"].update_one({}, {"$set": {"language": "hi"}})
        self.enqueue()
        self.assertEqual(self.run_job(), "failed")
        job = DB["jobs"].find_one()
        self.assertEqual((job["error"]["code"], job["error"]["stage"]), ("capability_unavailable", "translate"))
        self.assertIsNone(DB["centrecases"].find_one())


if __name__ == "__main__":
    unittest.main()
