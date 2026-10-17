"""Evaluate the pitch review (D-33) on synthetic text pitches with a simulated entrepreneur.

    python -m ai.eval.review_harness                     # the configured local model (LOCAL_LLM_MODEL)
    python -m ai.eval.review_harness --fake              # plumbing check without a model
    python -m ai.eval.review_harness --case very-short   # one case

For each case the first reading's open topics are compared with the expected gaps (recall, precision); the loop
then runs to completion, answering from the case's facts (null facts are declined). Reported per case and overall:
gap recall and precision, rule-breaking questions, questions about topics that were already sufficient, rounds,
completeness of the final pitch, declined topics, and model calls with their time.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import statistics
import sys
import time

from ai.intel.scoring import quality
from ai.review import ReviewEngine, extracted_input, pending_questions
from ai.review.ask import acceptable
from ai.review.criteria import CORE

CASES = Path(__file__).with_name("review_set") / "cases.json"
NOT_DECIDED = "I have not decided this yet."


def run_case(case: dict, llm, model: str | None, max_rounds: int = 12) -> dict:
    engine = ReviewEngine(llm, model=model)
    started = time.monotonic()
    session = engine.start(case["pitch"], document_id=case["id"])
    first_open = {key for key, verdict in session["verdicts"].items() if verdict["verdict"] != "sufficient"}
    expected = set(case["gaps"])
    sufficient_before: set[str] = set(CORE) - first_open
    redundant = 0
    rounds = 0
    while session["status"] == "needs_input" and rounds < max_rounds:
        rounds += 1
        answers = []
        for question in pending_questions(session):
            # Asking again about a topic the pitch already covered is a wasted question.
            redundant += question["field"] in sufficient_before
            fact = case["facts"].get(question["field"], "")
            answers.append({"qId": question["qId"], "text": fact if fact else NOT_DECIDED})
        session = engine.answer(session, answers)
    questions = session["questions"]
    result = {
        "id": case["id"], "scenario": case["scenario"], "status": session["status"], "rounds": rounds,
        "expectedGaps": sorted(expected), "foundGaps": sorted(first_open),
        "recall": round(len(first_open & expected) / len(expected), 3) if expected else None,
        "precision": round(len(first_open & expected) / len(first_open), 3) if first_open else None,
        "questions": len(questions), "badQuestions": sum(1 for q in questions if not acceptable(q["questionEn"].split(" If you have")[0])),
        "redundantQuestions": redundant, "declined": sorted(session["declined"]),
        "calls": len(session["calls"]), "failedCalls": sum(1 for call in session["calls"] if not call["ok"]),
        "modelSeconds": round(sum(call["ms"] for call in session["calls"]) / 1000, 1), "wallSeconds": round(time.monotonic() - started, 1),
    }
    if session["status"] == "complete":
        result["completeness"] = quality(extracted_input(session))["completeness"]
    return result


def summarise(results: list[dict]) -> dict:
    recalls = [item["recall"] for item in results if item["recall"] is not None]
    precisions = [item["precision"] for item in results if item["precision"] is not None]
    complete = [item for item in results if item["status"] == "complete"]
    # Pitches that should pass straight away: any question on them is a false alarm.
    clean = [item for item in results if not item["expectedGaps"]]
    return {
        "cases": len(results), "completed": len(complete),
        "gapRecall": round(statistics.mean(recalls), 3) if recalls else None,
        "gapPrecision": round(statistics.mean(precisions), 3) if precisions else None,
        "cleanPassedFirstTime": sum(1 for item in clean if item["rounds"] == 0), "cleanCases": len(clean),
        "badQuestions": sum(item["badQuestions"] for item in results),
        "redundantQuestions": sum(item["redundantQuestions"] for item in results),
        "medianRounds": statistics.median(item["rounds"] for item in results) if results else None,
        "meanCompleteness": round(statistics.mean(item["completeness"] for item in complete), 1) if complete else None,
        "calls": sum(item["calls"] for item in results), "failedCalls": sum(item["failedCalls"] for item in results),
        "modelSecondsPerCase": round(statistics.mean(item["modelSeconds"] for item in results), 1) if results else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate the pitch review on synthetic text pitches")
    parser.add_argument("--fake", action="store_true", help="Use the deterministic test model instead of the local model")
    parser.add_argument("--case", action="append", help="Run only these case ids")
    parser.add_argument("--report", type=Path, default=Path("datasets/reports/review-evaluation.json"))
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    if args.case:
        cases = [case for case in cases if case["id"] in args.case]
    if args.fake:
        from ai.tests.review_fakes import FakeLLM
        llm, model = FakeLLM(), "fake"
    else:
        from ai.config import Settings
        from ai.llm.adapter import LocalJsonAdapter
        adapter = LocalJsonAdapter(Settings.from_env())
        llm, model = adapter.complete_json, adapter.settings.model
    results = []
    for case in cases:
        try:
            results.append(run_case(case, llm, model))
        except Exception as error:  # noqa: BLE001 - one broken case must not hide the others
            results.append({"id": case["id"], "scenario": case["scenario"], "status": "error", "error": type(error).__name__,
                            "rounds": 0, "expectedGaps": case["gaps"], "recall": None, "precision": None, "questions": 0,
                            "badQuestions": 0, "redundantQuestions": 0, "calls": 0, "failedCalls": 0, "modelSeconds": 0})
        item = results[-1]
        print(f"{item['id']:30} {item['status']:9} rounds {item['rounds']}  recall {item['recall']}  precision {item['precision']}"
              f"  questions {item['questions']}  {item.get('modelSeconds', 0)} s")
    report = {"model": model, "summary": summarise(results), "cases": results}
    print(json.dumps(report["summary"], indent=2))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
