"""The pitch review loop: read the pitch, judge each topic, ask follow-ups until every topic is resolved.

A session is a plain JSON-able dict (stored as a reviewSession by the worker). Statuses:
  needs_input  questions are waiting for the entrepreneur
  complete     every core topic is answered well enough or plainly declined, so the pitch can be evaluated

"Until complete" always ends: a topic is asked at most three times (the last time with "or tell us if you have not
decided"); after that, or when the entrepreneur says they do not know, it is recorded as declined: shown to
assessors and treated as missing evidence by scoring (D-11), never invented.
"""
from __future__ import annotations

import time
from typing import Callable

from ai.llm.adapter import ModelOutputError
from ai.review import ask, extract, judge
from ai.review.criteria import CORE, EXTRA, GROUP_OF, GROUPS, MAX_ASKS_PER_FIELD
from ai.review.segment import segment

PROMPT_VERSIONS = {"extract": extract.PROMPT_VERSION, "judge": judge.PROMPT_VERSION, "ask": ask.PROMPT_VERSION}
LLM = Callable[[str, dict], dict]  # (prompt, JSON schema) -> object, e.g. LocalJsonAdapter.complete_json


class ReviewEngine:
    def __init__(self, llm: LLM, model: str | None = None, clock: Callable[[], float] = time.monotonic):
        self.llm, self.model, self.clock = llm, model, clock

    # ---- model calls: timed, retried once on malformed output; an unavailable model propagates (fails visibly)
    def _caller(self, session: dict):
        def call(step: str, prompt: str, schema: dict) -> dict:
            for attempt in (1, 2):
                started = self.clock()
                try:
                    result = self.llm(prompt, schema)
                    session["calls"].append({"step": step, "ms": round((self.clock() - started) * 1000), "ok": True, "round": session["round"]})
                    return result
                except ModelOutputError:
                    session["calls"].append({"step": step, "ms": round((self.clock() - started) * 1000), "ok": False, "round": session["round"]})
                    if attempt == 2:
                        raise
            raise AssertionError("unreachable")
        return call

    def start(self, text: str, document_id: str = "pitch", known: dict[str, list[str]] | None = None) -> dict:
        segments, redacted = segment(text, document_id, "s", known)
        if not segments:
            raise ValueError("The pitch has no readable text.")
        session = {"version": 1, "status": "reviewing", "round": 0, "segments": segments, "redactedSpans": redacted,
                   "fields": {}, "numbers": {}, "location": None, "businessType": None, "verdicts": {}, "attempts": {},
                   "declined": {}, "questions": [], "promptVersions": PROMPT_VERSIONS, "model": self.model, "calls": []}
        return self._review(session, set(GROUPS), recheck=set(CORE))

    def answer(self, session: dict, answers: list[dict], known: dict[str, list[str]] | None = None) -> dict:
        """Merge answers ({qId, text, documentId?}) to pending questions, then review again."""
        if session["status"] != "needs_input":
            raise ValueError("This review is not waiting for answers.")
        pending = {question["qId"]: question for question in session["questions"] if question["status"] == "pending"}
        touched: set[str] = set()
        for index, item in enumerate(answers, start=1):
            question = pending.get(item.get("qId"))
            text = (item.get("text") or "").strip()
            if question is None or not text:
                continue
            field = question["field"]
            new_segments, _ = segment(text, item.get("documentId") or question["qId"], f"r{session['round']}a{index}s", known)
            question.update({"status": "answered", "answerSegIds": [seg["segId"] for seg in new_segments],
                             "answerText": " ".join(seg["textEn"] for seg in new_segments)})
            session["segments"] += new_segments
            if judge.is_declined(text):
                session["declined"][field] = "The entrepreneur has not decided this yet."
            else:
                touched.add(field)
        if not touched and not any(question["status"] == "answered" for question in pending.values()):
            raise ValueError("No pending question was answered.")
        # Questions left unanswered stay counted; ask again next round.
        for question in pending.values():
            if question["status"] == "pending":
                question["status"] = "skipped"
        return self._review(session, {GROUP_OF[field] for field in touched}, recheck=touched)

    # ---- one review pass
    def _review(self, session: dict, groups: set[str], recheck: set[str]) -> dict:
        session["round"] += 1
        call = self._caller(session)
        for group in sorted(groups):
            result = extract.extract(group, session["segments"], call)
            for key, entry in result["fields"].items():
                previous = session["fields"].get(key)
                # A model that loses an earlier answer on re-reading must not erase it.
                if entry["state"] != "answered" and previous and previous["state"] == "answered":
                    continue
                session["fields"][key] = entry
            session["numbers"].update(result["numbers"])
            if result["location"]:
                session["location"] = result["location"]
            if result["businessType"]:
                session["businessType"] = result["businessType"]
        session["verdicts"] = judge.judge(session["fields"], session["numbers"], session["location"], session["segments"],
                                          session["declined"], call, recheck, session["verdicts"])
        self._ask(session, call)
        return session

    def _ask(self, session: dict, call) -> None:
        verdicts, attempts = session["verdicts"], session["attempts"]
        # Topics asked the maximum number of times are settled as declined (shown to assessors, scored as missing).
        for key in CORE:
            if verdicts[key]["verdict"] not in judge.RESOLVED and attempts.get(key, 0) >= MAX_ASKS_PER_FIELD:
                session["declined"][key] = f"Still unclear after {MAX_ASKS_PER_FIELD} questions."
                verdicts[key] = {"verdict": "declined", "reason": session["declined"][key]}
        keys = ask.choose(verdicts, attempts, pending=set())
        if not keys:
            session["status"] = "complete"
            return
        texts = ask.questions(keys, verdicts, session["fields"], attempts, call)
        for position, key in enumerate(keys, start=1):
            attempts[key] = attempts.get(key, 0) + 1
            session["questions"].append({"qId": f"q{session['round']}-{position}-{key}", "field": key, "round": session["round"],
                                         "questionEn": texts[key], "reason": verdicts[key]["reason"], "status": "pending"})
        session["status"] = "needs_input"


def pending_questions(session: dict) -> list[dict]:
    return [question for question in session["questions"] if question["status"] == "pending"]


def extracted_input(session: dict) -> dict:
    """The completed review as a CentreExtractedInput for ai/intel/scoring (packages/contracts centre-extracted-input.json)."""
    if session["status"] != "complete":
        raise ValueError("The review is not complete yet.")
    fields = {}
    for key in (*CORE, *EXTRA):
        entry = session["fields"].get(key)
        if entry is None:
            continue
        # "I don't know" counts as missing evidence; an answer still unclear after three asks is scored as written.
        explicitly_declined = key in session["declined"] and not session["declined"][key].startswith("Still unclear")
        if explicitly_declined or entry["state"] == "missing":
            fields[key] = {"state": "missing", "evidence": []}
        else:
            fields[key] = {"state": entry["state"], "evidence": entry["evidence"]}
    location = session["location"] or {}
    place = {"district": location.get("district") or "Not stated", "state": location.get("state") or "Not stated"}
    if location.get("village"):
        place["village"] = location["village"]
    result = {"template": "edp-idea-brief", "context": {"plannedBusinessLocation": place},
              "segments": [{key: segment[key] for key in ("segId", "textEn", "lang", "source")} for segment in session["segments"]],
              "fields": fields}
    if session["businessType"]:
        result["context"]["businessType"] = session["businessType"]
    if session["numbers"]:
        result["financials"] = {key: {"value": item["value"], "segId": item["segId"]} for key, item in session["numbers"].items()}
    return result


def summary(session: dict) -> dict:
    """Small, non-personal counts for stage events and the card."""
    verdicts = session["verdicts"]
    return {"round": session["round"], "segments": len(session["segments"]),
            "sufficient": sum(1 for item in verdicts.values() if item["verdict"] == "sufficient"),
            "declined": sum(1 for item in verdicts.values() if item["verdict"] == "declined"),
            "open": sum(1 for item in verdicts.values() if item["verdict"] not in judge.RESOLVED),
            "questions": len(pending_questions(session))}
