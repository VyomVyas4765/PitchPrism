"""Pipeline worker (A-28): consumes the MongoDB job queue and runs each available stage for real.

    python -m ai.worker            # run until stopped (pnpm worker)
    python -m ai.worker --once     # process at most one job

Stage by stage (docs/flow.md section 1.3):
- ingest .. extract (except redact) belong to Dev 1's intake pipeline. When the idea's evidence has already been
  extracted (stored on its centre case), they are recorded as skipped. Otherwise the job fails visibly with
  capability_unavailable: nothing is guessed from missing evidence.
- redact runs the shared PII detector over every segment; unredacted text fails the job as invalid_input.
- quality, followup, score, narrative, feedback and route run Dev 2's functions (ai.intel), with the job's
  published rubric version (W-02) driving weights, bands and pathway rules.
- normalise, similar, local and rank have no local implementation yet (A-15, A-19, A-20, A-21) and are recorded
  as skipped, never faked.
A missing local model fails the score stage visibly; the deterministic quality and follow-ups are still stored,
like the synchronous centre route does. Results go to the centre case in the same shape the centre card reads.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
import socket
import tempfile

from gridfs import GridFSBucket

from ai.config import PolicyViolation
from ai.contracts import bundle
from ai.ingest import chat
from ai.ingest.pii import find_pii
from ai.intel.finance import check_finances
from ai.intel.narrative import feedback_draft, followups, summary_plan
from ai.intel.routing import suggest_partners
from ai.intel.scoring import FIELDS, InvalidEvidence, evaluate, prepare_input, quality
from ai.jobqueue import Consumer, InvalidInput, connect, now
from ai.llm.adapter import ModelOutputError
from ai.llm.factory import make_adapter as default_adapter
from ai.providers import CapabilityUnavailable
from ai.review import ReviewEngine, extracted_input, pending_questions, summary as review_summary
from ai.review.localize import localize
from ai.review.segment import PitchTooLong, segment

log = logging.getLogger("ai.worker")
INTAKE_STAGES = ("ingest", "classify", "read", "structure", "translate", "extract")
NOT_AVAILABLE = {"normalise": "A-15", "similar": "A-19", "local": "A-20", "rank": "A-21"}
STAGES = tuple(bundle()["definitions"]["Stage"]["enum"])


def rubric_payload(db, job):
    """The job's rubric version as ai.intel.scoring expects it in idea["rubric"]; None keeps the calculator defaults."""
    if not job.get("rubricKey") or not job.get("rubricVersion"):
        return None
    rubric = db["rubrics"].find_one({"rubricKey": job["rubricKey"], "version": job["rubricVersion"]})
    if not rubric:
        return None
    payload = {"version": f"{rubric['rubricKey']}-v{rubric['version']}", "bands": rubric["bands"],
               "domains": [{key: domain[key] for key in ("key", "weight", "evidenceFields") if key in domain} for domain in rubric["domains"]]}
    if rubric.get("pathwayRules"):
        payload["pathwayRules"] = rubric["pathwayRules"]
    weights = rubric.get("completenessWeights")
    # The calculator takes whole-number weights over the ten EDP fields; anything else keeps its default.
    if weights and set(weights) == set(FIELDS) and all(isinstance(v, int) for v in weights.values()) and sum(weights.values()) == 100:
        payload["completenessWeights"] = weights
    return payload


def state_of(result):
    """Same mapping as the centre route (backend/src/modules/centre/router.ts)."""
    if result["status"] == "pending_model":
        return "PENDING_MODEL"
    if result["evaluation"].get("band") == "Unassessable":
        return "UNASSESSABLE"
    return "NEEDS_ATTENTION" if result["evaluation"].get("needsAttention") else "READY"


def store(db, job, case, result):
    """Write the outcome to the centre case, archiving the previous evaluation, as the centre route does."""
    evaluation = result.get("evaluation")
    update = {"$set": {"ownerOrgId": job["ownerOrgId"], "evaluation": evaluation, "quality": result.get("quality"),
                       "financialChecks": result.get("financialChecks", []), "followUps": result.get("followUps", []),
                       "planDraft": result.get("planDraft"), "state": state_of(result), "reason": result.get("reason"),
                       "updatedAt": now()}}
    if case.get("evaluation"):
        update["$push"] = {"evaluationHistory": {"evaluation": case["evaluation"], "archivedAt": now().isoformat()}}
    db["centrecases"].update_one({"_id": case["_id"]}, update)


def routing_view(db, job, case, idea):
    """Adapt stored rules and consents to ai.intel.routing (rules suggest; sharing still needs a reviewer)."""
    rules = [{"partnerOrgId": str(rule["partnerOrgId"]), "partnerType": rule["partnerType"], "active": rule.get("active") is True,
              "trades": rule.get("tradeKeys") or [], "sectors": rule.get("sectors") or [], "districts": rule.get("districts") or []}
             for rule in db["routingRules"].find({"active": True})]
    submission = db["submissions"].find_one({"_id": job["submissionId"]}, {"entrepreneurId": 1, "tradeKey": 1, "sector": 1, "fundingReady": 1}) or {}
    consents = [{"active": True, "partnerType": consent["scope"]} for consent in
                db["consents"].find({"entrepreneurId": submission.get("entrepreneurId"), "purpose": "partner_sharing", "status": "active"})]
    view = {"tradeKey": submission.get("tradeKey"), "sector": submission.get("sector"), "fundingReady": submission.get("fundingReady"),
            "district": idea.get("context", {}).get("plannedBusinessLocation", {}).get("district"),
            "decision": (case.get("decision") or {}).get("decision")}
    return view, rules, consents


def read_original(db, storage_id) -> bytes:
    """A private original from the intake store (GridFS bucket "originals", backend/src/modules/entrepreneur/storage.ts)."""
    return GridFSBucket(db, bucket_name="originals").open_download_stream(storage_id).read()


def pitch_text(db, job):
    """The submission's text pitch: an uploaded .txt or the typed answers. None when it has no text (audio, PDF, photo)."""
    pitch = db["pitches"].find_one({"submissionId": job["submissionId"]}, {"_id": 1, "language": 1})
    if not pitch:
        return None, None, None
    parts, document_id = [], None
    for document in db["documents"].find({"pitchId": pitch["_id"], "purpose": "pitch", "state": "complete", "kind": "text"}).sort("_id", 1):
        content = read_original(db, document["storageId"]).decode("utf-8", errors="replace")
        if document.get("declaredMime") == "application/json":
            try:  # typed answers saved by the intake route: {"language", "answers": [{"step", "text"}]}
                content = "\n".join(answer.get("text", "") for answer in json.loads(content).get("answers", []))
            except (ValueError, AttributeError):
                continue
        parts.append(content.strip())
        document_id = document_id or str(document["_id"])
    text = "\n".join(part for part in parts if part)
    return (text or None), document_id, pitch.get("language", "en")


def save_review(db, job, session, processed):
    """Store the review session (inbox entries just merged are removed) and mirror its questions on the submission."""
    fields = {key: value for key, value in session.items() if key not in ("_id", "inbox", "createdAt") and value is not None}
    fields.update({"submissionId": job["submissionId"], "ownerOrgId": job["ownerOrgId"], "updatedAt": now()})
    update = {"$set": fields, "$setOnInsert": {"createdAt": now()}}
    if processed:
        update["$pull"] = {"inbox": {"qId": {"$in": processed}}}
    else:
        update["$setOnInsert"]["inbox"] = []
    db["reviewSessions"].update_one({"submissionId": job["submissionId"]}, update, upsert=True)
    db["submissions"].update_one({"_id": job["submissionId"]}, {"$set": {"updatedAt": now(), "followUps": [
        {"qId": q["qId"], "field": q["field"], "questionEn": q["questionEn"], "status": q["status"]} for q in session["questions"]]}})


class Readers:
    """Dev 1's local reading models, loaded only when a reply needs them (tests pass fakes)."""

    def __init__(self, pipeline_factory=None):
        self._factory, self._pipeline = pipeline_factory, None

    def pipeline(self):
        if self._pipeline is None:
            if self._factory:
                self._pipeline = self._factory()
            else:
                from ai.ingest.run import Pipeline
                self._pipeline = Pipeline()
        return self._pipeline

    def translator(self):
        return self.pipeline().translator


def needs_reading(db, pitch) -> bool:
    """Chat pitches, voice notes, PDFs, photos and non-English text go through Dev 1's reading pipeline."""
    if pitch.get("mode") == "chat" or pitch.get("language", "en") != "en":
        return True
    return db["documents"].count_documents({"pitchId": pitch["_id"], "purpose": "pitch", "state": "complete",
                                            "kind": {"$in": ["audio", "pdf", "image"]}}) > 0


def reply_segments(db, storage_id, kind, declared_mime, language, document_id, prefix, readers):
    """One original (a chat reply or an intake file) as numbered, redacted English segments."""
    data = read_original(db, storage_id)
    if kind in chat.SUFFIX:
        with tempfile.TemporaryDirectory(prefix="pitchprism-reply-") as folder:
            path = Path(folder) / f"reply{chat.SUFFIX[kind]}"
            path.write_bytes(data)
            return chat.file_segments(path, kind, language, document_id, prefix, readers.pipeline())
    text = data.decode("utf-8", errors="replace")
    if declared_mime == "application/json":
        try:  # typed answers saved by the intake route: {"language", "answers": [{"step", "text"}]}
            text = "\n".join(answer.get("text", "") for answer in json.loads(text).get("answers", []))
        except (ValueError, AttributeError):
            text = ""
    return chat.text_segments(text, language, document_id, prefix, readers.translator())


def read_pitch(db, job, run, pitch, readers):
    """Stages ingest .. translate for a pitch that needs reading. Returns (segments, redacted spans)."""
    language = pitch.get("language", "en")
    with run.stage("ingest") as current:
        documents = list(db["documents"].find({"pitchId": pitch["_id"], "purpose": "pitch", "state": "complete"}).sort("_id", 1))
        if not documents:
            raise InvalidInput("the pitch has no content")
        current.summary(documents=len(documents), formats=sorted({document["kind"] for document in documents}))
    with run.stage("classify") as current:
        current.summary(formats=sorted({document["kind"] for document in documents}))
    segments, redacted = [], 0
    with run.stage("read") as current:
        for index, document in enumerate(documents, start=1):
            found, spans = reply_segments(db, document["storageId"], document["kind"], document.get("declaredMime"), language,
                                          str(document["_id"]), f"d{index}s", readers)
            segments += found
            redacted += spans
        if not segments:
            raise InvalidInput("the pitch has no readable text")
        for number, segment in enumerate(segments, start=1):
            segment["segId"] = f"s{number}"
        current.summary(segments=len(segments))
    with run.stage("structure") as current:
        current.summary(segments=len(segments))
    with run.stage("redact") as current:
        if any(find_pii(segment["textEn"]) for segment in segments):
            raise InvalidInput("unredacted personal data in evidence")
        current.summary(redacted=redacted)
    with run.stage("translate") as current:
        current.summary(languages=sorted({segment["lang"] for segment in segments}))
    return segments, redacted


def review_pitch(db, job, run, make_adapter, readers=None):
    """D-33: read the text pitch, judge each topic, ask follow-ups. Returns the extracted input when complete, else None."""
    session = db["reviewSessions"].find_one({"submissionId": job["submissionId"]})
    pitch = db["pitches"].find_one({"submissionId": job["submissionId"]}, {"_id": 1, "language": 1, "mode": 1}) or {}
    language = pitch.get("language", "en")
    readers = readers or Readers()
    processed = []
    adapter = None
    if job["reason"] == "followup":
        if not session or session["status"] != "needs_input":
            with run.stage(job["fromStage"]):
                raise InvalidInput("no review is waiting for answers")
        inbox = session.get("inbox", [])
        processed = [item["qId"] for item in inbox]
        answers = segments = None
        if pitch.get("mode") == "chat" and len({str(item["storageId"]) for item in inbox}) == 1:
            # One chat reply answers every pending question together (text, a voice note or a file).
            storage_id = inbox[0]["storageId"]
            document = db["documents"].find_one({"storageId": storage_id}, {"kind": 1, "declaredMime": 1}) or {}
            with run.stage("read") as current:
                segments, _ = reply_segments(db, storage_id, document.get("kind", "text"), document.get("declaredMime"),
                                             language, str(document.get("_id", storage_id)), f"r{session['round']}m", readers)
                if not segments:
                    raise InvalidInput("the reply has no readable text")
                if any(find_pii(segment["textEn"]) for segment in segments):
                    raise InvalidInput("unredacted personal data in evidence")
                current.summary(segments=len(segments), format=document.get("kind", "text"))
        else:
            answers = [{"qId": item["qId"], "text": read_original(db, item["storageId"]).decode("utf-8", errors="replace"),
                        "documentId": str(item["storageId"])} for item in inbox]
        with run.stage("extract") as current:
            adapter = make_adapter()
            try:
                engine = ReviewEngine(adapter.complete_json, model=getattr(adapter.settings, "model", None))
                session = (engine.answer(session, answers) if answers is not None
                           else engine.answer_message(session, segments, chat.english_of(segments)))
            except PitchTooLong as error:
                raise InvalidInput("answer too long") from error
            except ValueError as error:
                if isinstance(error, ModelOutputError):
                    raise
                raise InvalidInput("answers did not match the pending questions") from error
            calls = [call for call in session["calls"] if call["round"] == session["round"]]
            current.model_use(provider=getattr(adapter, "provider", "ollama"), model=session.get("model"), llm_calls=len(calls))
            current.summary(answers=len(answers) if answers is not None else len(processed), round=session["round"])
    elif pitch and needs_reading(db, pitch):
        segments, redacted = read_pitch(db, job, run, pitch, readers)
        with run.stage("extract") as current:
            adapter = make_adapter()
            session = ReviewEngine(adapter.complete_json, model=getattr(adapter.settings, "model", None)).start_segments(segments, redacted)
            current.model_use(provider=getattr(adapter, "provider", "ollama"), model=session.get("model"), llm_calls=len(session["calls"]))
            current.summary(round=1)
    else:
        with run.stage("ingest") as current:
            text, document_id, language = pitch_text(db, job)
            if text is None:
                raise CapabilityUnavailable("only text pitches can be read so far; audio, PDF and photo intake are not available")
            current.summary(characters=len(text), format="text")
        for stage in ("classify", "read"):
            with run.stage(stage) as current:
                current.skip()
                current.summary(reason="plain_text")
        with run.stage("structure") as current:
            try:
                segments, redacted = segment(text, document_id or "pitch")
            except PitchTooLong as error:
                raise InvalidInput("pitch too long") from error
            if not segments:
                raise InvalidInput("the pitch has no readable text")
            current.summary(segments=len(segments))
        with run.stage("redact") as current:
            if any(find_pii(item["textEn"]) for item in segments):
                raise InvalidInput("unredacted personal data in evidence")
            current.summary(redacted=redacted)
        with run.stage("translate") as current:
            if language != "en":
                raise CapabilityUnavailable("translation is not configured for this pitch language")
            current.skip()
            current.summary(language="en")
        with run.stage("extract") as current:
            adapter = make_adapter()
            session = ReviewEngine(adapter.complete_json, model=getattr(adapter.settings, "model", None)).start_segments(segments, redacted)
            current.model_use(provider=getattr(adapter, "provider", "ollama"), model=session.get("model"), llm_calls=len(session["calls"]))
            current.summary(round=1)
    with run.stage("quality") as current:
        current.summary(**{key: value for key, value in review_summary(session).items() if key != "questions"})
    with run.stage("followup") as current:
        if pending_questions(session) and adapter is not None:
            # The chat speaks the entrepreneur's language; the English wording stays as the reviewed one.
            localize(pending_questions(session), language, adapter.complete_json)
        current.summary(questions=len(pending_questions(session)), status=session["status"])
    save_review(db, job, session, processed)
    if session["status"] != "complete":
        return None
    idea = extracted_input(session)
    db["centrecases"].update_one({"submissionId": job["submissionId"]}, {
        "$set": {"input": idea, "ownerOrgId": job["ownerOrgId"], "updatedAt": now()},
        "$setOnInsert": {"state": "PENDING_MODEL", "evaluation": None, "evaluationHistory": [], "financialChecks": [], "followUps": [],
                         "createdAt": now()}}, upsert=True)
    return idea


def handler_for(db, adapter_factory=None, pipeline_factory=None):
    def make_adapter():
        return (adapter_factory or default_adapter)()

    def handle(job, run):
        case = db["centrecases"].find_one({"submissionId": job["submissionId"]})
        idea = (case or {}).get("input")
        reviewed = idea is None or job["reason"] == "followup"
        if reviewed:
            # No extracted evidence yet: review the text pitch (D-33). Questions pending means the job ends here.
            idea = review_pitch(db, job, run, make_adapter, Readers(pipeline_factory))
            if idea is None:
                run.submission_status("NEEDS_INPUT")
                return
            pitch = db["pitches"].find_one({"submissionId": job["submissionId"]}, {"mode": 1}) or {}
            if pitch.get("mode") == "chat":
                # The plan is built. The person sends it to the evaluator with a button, which queues a job
                # from the quality stage; nothing is scored before that.
                run.submission_status("DRAFT")
                return
            case = db["centrecases"].find_one({"submissionId": job["submissionId"]})
        for stage in INTAKE_STAGES if not reviewed else ():
            if run.should_run(stage):
                with run.stage(stage) as current:
                    current.skip()
                    current.summary(reason="evidence_already_extracted")
        if run.should_run("redact") and not reviewed:
            with run.stage("redact") as current:
                texts = [text for segment in idea.get("segments", []) for text in (segment.get("textEn", ""), segment.get("textOriginal", ""))]
                if any(find_pii(text) for text in texts if isinstance(text, str)):
                    raise InvalidInput("unredacted personal data in evidence")
                current.summary(segments=len(idea.get("segments", [])))
        rubric = rubric_payload(db, job)
        if rubric:
            idea = {**idea, "rubric": rubric}
        try:
            _, _, valid_ids = prepare_input(idea)
            q = quality(idea)
        except (InvalidEvidence, ValueError) as error:
            raise InvalidInput("evidence failed validation") from error
        checks = check_finances(idea.get("financials", {}), valid_ids)
        if run.should_run("quality") and not reviewed:
            with run.stage("quality") as current:
                current.summary(completeness=q["completeness"], flags=len(q["flags"]), unassessable=q["unassessable"], financialChecks=len(checks))
        questions = followups(idea)
        if run.should_run("followup") and not reviewed:
            with run.stage("followup") as current:
                current.summary(questions=len(questions))
        for stage, requirement in NOT_AVAILABLE.items():
            if run.should_run(stage) and STAGES.index(stage) < STAGES.index("score"):
                with run.stage(stage) as current:
                    current.skip()
                    current.summary(available=False, requirement=requirement)
        plan = summary_plan(idea)
        with run.stage("score") as current:
            try:
                adapter = make_adapter()
                result = evaluate(idea, adapter)
                current.model_use(provider=getattr(adapter, "provider", "ollama"), model=getattr(getattr(adapter, "settings", None), "model", None), llm_calls=2)
                current.summary(potential=result["potential"], band=result["band"], coverage=result["coverage"], rubric=result["rubricVersion"])
            except (CapabilityUnavailable, ModelOutputError, PolicyViolation) as error:
                # Keep the useful deterministic results, as the centre route does, then fail the stage visibly.
                store(db, job, case, {"status": "pending_model", "quality": q, "financialChecks": checks, "followUps": questions,
                                      "planDraft": plan, "reason": "Local scoring model unavailable or output invalid."})
                raise CapabilityUnavailable("local scoring model unavailable") from error
            except InvalidEvidence as error:
                raise InvalidInput("evidence failed validation") from error
        with run.stage("narrative") as current:
            current.summary(sections=len(plan["sections"]))
        if run.should_run("rank"):
            with run.stage("rank") as current:
                current.skip()
                current.summary(available=False, requirement=NOT_AVAILABLE["rank"])
        with run.stage("feedback") as current:
            draft = feedback_draft(result)
            current.summary(drafted=True)
        with run.stage("route") as current:
            view, rules, consents = routing_view(db, job, case, idea)
            suggestions = suggest_partners(view, rules, consents)
            current.summary(suggestions=len(suggestions))
        evaluation = {**result, "financialChecks": checks, "followUps": questions, "planDraft": plan, "feedbackDraft": draft,
                      "routingSuggestions": suggestions}
        outcome = {"status": "assessed", "evaluation": evaluation, "financialChecks": checks, "followUps": questions, "planDraft": plan}
        store(db, job, case, outcome)
        state = state_of(outcome)
        run.submission_status("UNASSESSABLE" if state == "UNASSESSABLE" else "READY")

    return handle


def main():
    parser = argparse.ArgumentParser(description="PitchPrism pipeline worker (local only)")
    parser.add_argument("--once", action="store_true", help="Process at most one job, then exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    db = connect()
    consumer = Consumer(db, handler_for(db), worker_id=f"worker-{socket.gethostname()}-{os.getpid()}")
    if args.once:
        print(consumer.run_once() or "idle")
        return 0
    log.info("worker ready; waiting for jobs")
    consumer.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
