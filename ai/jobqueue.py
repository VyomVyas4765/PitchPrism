"""MongoDB job queue client for the worker (D-29). Mirrors backend/src/platform/jobs.ts; keep the two in step.

The API enqueues jobs. The worker claims one job at a time with an atomic lease, extends the lease while it
works, records every stage transition (the live card follows these over SSE) and finishes the job:

    from ai.jobqueue import Consumer, connect

    def handle(job, run):
        with run.stage("ingest") as stage:
            stage.summary(files=1)
        ...
        run.submission_status("READY")

    Consumer(connect(), handle, worker_id="worker-1").run_forever()

Errors: raise CapabilityUnavailable when a local provider is missing (D-24); the job fails visibly with
capability_unavailable and is never retried silently or scored with a substitute. TimeoutError and
RetryableError are retried with backoff until max attempts. Any other exception fails the attempt as
stage_error; its text is not stored, because it may contain prompts or personal data.
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument
from pymongo.database import Database

from ai.contracts import bundle, validate
from ai.providers import CapabilityUnavailable

LEASE_SECONDS = 60
log = logging.getLogger("ai.jobqueue")
STAGES = tuple(bundle()["definitions"]["Stage"]["enum"])
FINAL_STATUSES = ("READY", "NEEDS_INPUT", "UNASSESSABLE")
# The queue never changes the status of an idea a reviewer has decided: a rescore versions the evaluation only.
DECIDED_STATUSES = ("SHORTLISTED", "NOT_YET", "MORE_INFO", "SHARED")


class RetryableError(RuntimeError):
    """A transient failure (model still loading, local service restarting): retry with backoff."""


class InvalidInput(ValueError):
    """The submission's evidence cannot be processed as it is (for example unredacted text): fail at once, no retry."""


class LeaseLost(RuntimeError):
    """The job is no longer this worker's: its lease expired and another worker claimed it, or it was cancelled."""


def now():
    return datetime.now(timezone.utc)


def backoff_seconds(attempts):
    """Same schedule as the API: 5 s, 20 s, 80 s … capped at 10 minutes."""
    return min(600, 5 * 4 ** max(0, attempts - 1))


def connect(uri=None):
    """Connect to the database named in MONGODB_URI (root .env). Times are returned timezone-aware (UTC)."""
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
    uri = uri or os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017/pitchprism")
    client = MongoClient(uri, tz_aware=True, serverSelectionTimeoutMS=int(os.getenv("MONGODB_TIMEOUT_MS", "10000")))
    return client.get_default_database()


def _json(value):
    """JSON form for contract validation: ObjectIds and datetimes as strings."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, dict):
        return {key: _json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json(item) for item in value]
    return value


class JobQueue:
    def __init__(self, db: Database):
        self.db = db
        self.jobs = db["jobs"]

    def claim(self, worker_id, lease_seconds=LEASE_SECONDS):
        """Claim the oldest due job, or one whose worker crashed (lease expired). Returns None when idle."""
        while True:
            at = now()
            job = self.jobs.find_one_and_update(
                {"$or": [{"status": "queued", "availableAt": {"$lte": at}}, {"status": "leased", "leaseUntil": {"$lt": at}}]},
                {"$set": {"status": "leased", "workerId": worker_id, "leaseUntil": at + timedelta(seconds=lease_seconds), "updatedAt": at},
                 "$inc": {"attempts": 1}},
                sort=[("availableAt", 1), ("createdAt", 1)], return_document=ReturnDocument.AFTER)
            if job is None:
                return None
            if job["attempts"] > job["maxAttempts"]:
                self._finish(job["_id"], worker_id, "failed", {"code": "attempts_exhausted", "message": "The pipeline stopped responding on every attempt."})
                continue
            self._submission(job, "PROCESSING")
            return job

    def heartbeat(self, job_id, worker_id, lease_seconds=LEASE_SECONDS, current_stage=None):
        update = {"leaseUntil": now() + timedelta(seconds=lease_seconds), "updatedAt": now()}
        if current_stage:
            update["currentStage"] = current_stage
        return self.jobs.update_one({"_id": job_id, "workerId": worker_id, "status": "leased"}, {"$set": update}).modified_count == 1

    def complete(self, job_id, worker_id):
        return self._finish(job_id, worker_id, "done") is not None

    def fail(self, job_id, worker_id, code, message, stage=None, retryable=False):
        job = self.jobs.find_one({"_id": job_id, "workerId": worker_id, "status": "leased"})
        if job is None:
            return None
        error = {"code": code[:60], "message": message[:600], **({"stage": stage} if stage else {})}
        if retryable and job["attempts"] < job["maxAttempts"]:
            self.jobs.update_one({"_id": job_id, "workerId": worker_id, "status": "leased"}, {
                "$set": {"status": "queued", "availableAt": now() + timedelta(seconds=backoff_seconds(job["attempts"])), "error": error, "updatedAt": now()},
                "$unset": {"leaseUntil": 1, "workerId": 1}})
            return "requeued"
        self._finish(job_id, worker_id, "failed", error)
        self._submission(job, "FAILED")
        return "failed"

    def record_stage(self, job, stage, status, ms=None, summary=None, error=None, started_at=None, usage=None):
        """Insert a StageEvent (live card) and, when the stage ends, a PipelineRun row (A-29 timing and model use)."""
        if stage not in STAGES:
            raise ValueError(f"Unknown pipeline stage: {stage}")
        at = now()
        ids = {"jobId": job["_id"], "submissionId": job["submissionId"], "ownerOrgId": job["ownerOrgId"]}
        event = {**ids, "stage": stage, "status": status, "at": at}
        if ms is not None:
            event["ms"] = int(ms)
        if summary:
            event["summary"] = summary
        if error:
            event["error"] = error[:600]
        validate("StageEvent", _json(event))
        self.db["stageEvents"].insert_one(event)
        if status != "started":
            run = {**ids, "stage": stage, "status": status, "startedAt": started_at or at - timedelta(milliseconds=ms or 0), "endedAt": at,
                   "hostedCostInr": 0, **({"ms": int(ms)} if ms is not None else {}), **({"error": error[:600]} if error else {}),
                   **{key: value for key, value in (usage or {}).items() if value is not None}}
            validate("PipelineRun", _json(run))
            self.db["pipelineRuns"].insert_one({**run, "createdAt": at, "updatedAt": at})
        return event

    def _finish(self, job_id, worker_id, status, error=None):
        update = {"status": status, "finishedAt": now(), "updatedAt": now(), **({"error": error} if error else {})}
        return self.jobs.find_one_and_update({"_id": job_id, "workerId": worker_id, "status": "leased"},
                                             {"$set": update, "$unset": {"leaseUntil": 1}}, return_document=ReturnDocument.AFTER)

    def _submission(self, job, status):
        self.db["submissions"].update_one({"_id": job["submissionId"], "status": {"$nin": list(DECIDED_STATUSES)}},
                                          {"$set": {"status": status, "updatedAt": now()}})


@dataclass
class _Stage:
    name: str
    data: dict = field(default_factory=dict)
    usage: dict = field(default_factory=dict)
    skipped: bool = False

    def summary(self, **counts):
        """Small, non-personal counts for the live card, for example segments=14, languages=["te"]."""
        self.data.update(counts)

    def model_use(self, provider=None, model=None, llm_calls=None, tokens_in=None, tokens_out=None, compute_seconds=None):
        self.usage.update({"provider": provider, "model": model, "llmCalls": llm_calls, "tokensIn": tokens_in,
                           "tokensOut": tokens_out, "computeSeconds": compute_seconds})

    def skip(self):
        self.skipped = True


class Run:
    """One claimed job. Use run.stage(name) around each stage; it records timing and keeps the lease alive."""

    def __init__(self, queue: JobQueue, job, worker_id, lease_seconds):
        self.queue, self.job, self.worker_id, self.lease_seconds = queue, job, worker_id, lease_seconds
        self.final_status = None

    @property
    def from_stage(self):
        return self.job["fromStage"]

    def should_run(self, stage):
        """True for the job's start stage and every stage after it (a rescore starts at "score")."""
        return STAGES.index(stage) >= STAGES.index(self.from_stage)

    @contextmanager
    def stage(self, name):
        if not self.queue.heartbeat(self.job["_id"], self.worker_id, self.lease_seconds, current_stage=name):
            raise LeaseLost(str(self.job["_id"]))
        state = _Stage(name)
        started = now()
        clock = time.perf_counter()
        self.queue.record_stage(self.job, name, "started")
        try:
            yield state
        except BaseException as error:
            ms = int((time.perf_counter() - clock) * 1000)
            self.queue.record_stage(self.job, name, "failed", ms=ms, error=_safe_message(error), started_at=started, usage=state.usage)
            raise _StageFailed(name) from error
        ms = int((time.perf_counter() - clock) * 1000)
        self.queue.record_stage(self.job, name, "skipped" if state.skipped else "done", ms=ms, summary=state.data or None,
                                started_at=started, usage=state.usage)

    def submission_status(self, status):
        """Set the outcome the reviewer sees: READY, NEEDS_INPUT or UNASSESSABLE."""
        if status not in FINAL_STATUSES:
            raise ValueError(f"Workers may only set {FINAL_STATUSES}")
        self.final_status = status



class _StageFailed(RuntimeError):
    def __init__(self, stage):
        super().__init__(stage)
        self.stage = stage


def _safe_message(error):
    """Staff-safe text: fixed descriptions only, never exception text (it may hold prompts or personal data)."""
    if isinstance(error, CapabilityUnavailable):
        return "A required local capability is not installed."
    if isinstance(error, (TimeoutError, RetryableError)) or getattr(error, "retryable", False):
        return "The model service was busy or did not respond in time."
    if isinstance(error, InvalidInput):
        return "The evidence for this idea cannot be processed as it is; check the extraction and redaction."
    return "The stage stopped with an unexpected error."


class Consumer:
    """Runs one job at a time (D-24: one heavy job on the 8 GiB host)."""

    def __init__(self, db: Database, handler, worker_id, lease_seconds=LEASE_SECONDS, poll_seconds=1.0):
        self.queue, self.handler, self.worker_id = JobQueue(db), handler, worker_id
        self.lease_seconds, self.poll_seconds = lease_seconds, poll_seconds

    def run_once(self):
        """Claim and process one job. Returns the job's outcome, or None when the queue is empty."""
        job = self.queue.claim(self.worker_id, self.lease_seconds)
        if job is None:
            return None
        run = Run(self.queue, job, self.worker_id, self.lease_seconds)
        try:
            self.handler(job, run)
        except LeaseLost:
            log.warning("queue: lease lost for job %s; another worker owns it now", job["_id"])
            return "lease_lost"
        except _StageFailed as failed:
            return self._fail(job, failed.__cause__, failed.stage)
        except Exception as error:  # noqa: BLE001 - every failure must end the attempt visibly
            return self._fail(job, error, job.get("currentStage"))
        if not self.queue.complete(job["_id"], self.worker_id):
            return "lease_lost"
        self.queue._submission(job, run.final_status or "READY")
        return "done"

    def _fail(self, job, error, stage):
        if isinstance(error, CapabilityUnavailable):
            code, retryable = "capability_unavailable", False
        elif isinstance(error, InvalidInput):
            code, retryable = "invalid_input", False
        elif isinstance(error, (TimeoutError, RetryableError)) or getattr(error, "retryable", False):
            code, retryable = "timeout", True
        else:
            code, retryable = "stage_error", True
        log.warning("queue: job %s failed at %s (%s)", job["_id"], stage, code)
        return self.queue.fail(job["_id"], self.worker_id, code, _safe_message(error), stage=stage, retryable=retryable)

    def run_forever(self):
        while True:
            if self.run_once() is None:
                time.sleep(self.poll_seconds)
