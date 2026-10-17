"""Worker side of the MongoDB queue protocol (D-29), on a throwaway local database with synthetic IDs."""
import os
import time
import unittest
from datetime import timedelta

from bson import ObjectId

from ai.providers import CapabilityUnavailable

try:
    from pymongo import MongoClient
    from pymongo.errors import PyMongoError
    from ai.jobqueue import Consumer, InvalidInput, JobQueue, RetryableError, Run, backoff_seconds, now
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


@unittest.skipIf(DB is None, "local MongoDB (or pymongo) unavailable")
class JobQueueTests(unittest.TestCase):
    def setUp(self):
        DB.client.drop_database(DB.name)
        DB.create_collection("stageEvents", capped=True, size=1024 * 1024)
        self.queue = JobQueue(DB)
        self.submission = ObjectId()
        DB["submissions"].insert_one({"_id": self.submission, "status": "QUEUED"})

    @classmethod
    def tearDownClass(cls):
        DB.client.drop_database(DB.name)

    def enqueue(self, max_attempts=3, from_stage="ingest"):
        """Shape written by the API's enqueueJob."""
        job = {"_id": ObjectId(), "submissionId": self.submission, "ownerOrgId": ObjectId(), "fromStage": from_stage, "reason": "new",
               "idempotencyKey": f"{self.submission}:{from_stage}:new:1", "status": "queued", "attempts": 0, "maxAttempts": max_attempts,
               "availableAt": now(), "createdAt": now(), "updatedAt": now()}
        DB["jobs"].insert_one(job)
        return job

    def status(self):
        return DB["submissions"].find_one({"_id": self.submission})["status"]

    def test_claim_heartbeat_complete(self):
        self.enqueue()
        job = self.queue.claim("worker-a")
        self.assertEqual(job["attempts"], 1)
        self.assertIsNone(self.queue.claim("worker-b"))
        self.assertEqual(self.status(), "PROCESSING")
        self.assertTrue(self.queue.heartbeat(job["_id"], "worker-a", current_stage="read"))
        self.assertFalse(self.queue.heartbeat(job["_id"], "worker-b"))
        self.assertTrue(self.queue.complete(job["_id"], "worker-a"))
        self.assertEqual(DB["jobs"].find_one({"_id": job["_id"]})["status"], "done")

    def test_expired_lease_is_reclaimed_then_exhausted(self):
        self.enqueue(max_attempts=2)
        first = self.queue.claim("crashed", lease_seconds=0)
        time.sleep(0.01)
        second = self.queue.claim("rescuer", lease_seconds=0)
        self.assertEqual(second["_id"], first["_id"])
        time.sleep(0.01)
        self.assertIsNone(self.queue.claim("third", lease_seconds=0))
        self.assertEqual(DB["jobs"].find_one({"_id": first["_id"]})["error"]["code"], "attempts_exhausted")

    def test_retryable_failure_backs_off(self):
        self.enqueue()
        job = self.queue.claim("worker")
        self.assertEqual(self.queue.fail(job["_id"], "worker", "timeout", "slow", stage="read", retryable=True), "requeued")
        stored = DB["jobs"].find_one({"_id": job["_id"]})
        self.assertEqual(stored["status"], "queued")
        self.assertGreater(stored["availableAt"], now() + timedelta(seconds=backoff_seconds(1) - 1))
        self.assertIsNone(self.queue.claim("worker"))

    def test_consumer_records_stages_and_final_status(self):
        self.enqueue(from_stage="score")

        def handler(job, run):
            self.assertFalse(run.should_run("read"))
            with run.stage("score") as stage:
                stage.summary(domains=9)
                stage.model_use(provider="ollama", model="synthetic", llm_calls=2)
            with run.stage("narrative") as stage:
                stage.skip()
            run.submission_status("NEEDS_INPUT")

        self.assertEqual(Consumer(DB, handler, "worker").run_once(), "done")
        events = [(event["stage"], event["status"]) for event in DB["stageEvents"].find().sort("_id", 1)]
        self.assertEqual(events, [("score", "started"), ("score", "done"), ("narrative", "started"), ("narrative", "skipped")])
        run = DB["pipelineRuns"].find_one({"stage": "score"})
        self.assertEqual((run["llmCalls"], run["hostedCostInr"], run["model"]), (2, 0, "synthetic"))
        self.assertEqual(self.status(), "NEEDS_INPUT")
        self.assertIsNone(Consumer(DB, handler, "worker").run_once())

    def test_missing_capability_fails_visibly_without_retry_or_leaking_text(self):
        self.enqueue()

        def handler(job, run):
            with run.stage("read"):
                raise CapabilityUnavailable("ocr for or: secret prompt text")

        self.assertEqual(Consumer(DB, handler, "worker").run_once(), "failed")
        job = DB["jobs"].find_one()
        self.assertEqual((job["status"], job["error"]["code"], job["error"]["stage"]), ("failed", "capability_unavailable", "read"))
        self.assertNotIn("secret", str(job) + str(list(DB["stageEvents"].find())))
        self.assertEqual(self.status(), "FAILED")

    def test_decided_ideas_keep_their_status(self):
        DB["submissions"].update_one({"_id": self.submission}, {"$set": {"status": "SHORTLISTED"}})
        self.enqueue(from_stage="score")
        self.assertEqual(Consumer(DB, lambda job, run: run.submission_status("READY"), "worker").run_once(), "done")
        self.assertEqual(self.status(), "SHORTLISTED")

    def test_invalid_input_fails_without_retry(self):
        self.enqueue()

        def handler(job, run):
            with run.stage("redact"):
                raise InvalidInput("unredacted phone number in segment s_1")

        self.assertEqual(Consumer(DB, handler, "worker").run_once(), "failed")
        job = DB["jobs"].find_one()
        self.assertEqual((job["error"]["code"], job["error"]["stage"]), ("invalid_input", "redact"))
        self.assertNotIn("s_1", str(job))

    def test_transient_error_is_retried(self):
        self.enqueue()

        def handler(job, run):
            with run.stage("translate"):
                raise RetryableError("model loading")

        self.assertEqual(Consumer(DB, handler, "worker").run_once(), "requeued")
        self.assertEqual(DB["jobs"].find_one()["error"]["code"], "timeout")

    def test_unknown_stage_and_status_are_rejected(self):
        job = self.enqueue()
        with self.assertRaises(ValueError):
            self.queue.record_stage(job, "teleport", "started")
        with self.assertRaises(ValueError):  # decisions belong to reviewers, not the worker
            Run(self.queue, job, "w", 60).submission_status("SHORTLISTED")


if __name__ == "__main__":
    unittest.main()
