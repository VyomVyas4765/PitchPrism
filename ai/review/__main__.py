"""Try the pitch review in a terminal with the local model: python -m ai.review pitch.txt [--evaluate] [--save session.json]

Type an answer to each question; press Enter on an empty line to say you have not decided yet.
"""
import argparse
import json
from pathlib import Path
import sys

from ai.config import PolicyViolation, Settings
from ai.llm.adapter import LocalJsonAdapter, ModelOutputError
from ai.providers import CapabilityUnavailable
from ai.review import ReviewEngine, extracted_input, pending_questions


def main():
    parser = argparse.ArgumentParser(description="Interactive pitch review with the local model")
    parser.add_argument("pitch", type=Path, help="Plain-text pitch file")
    parser.add_argument("--evaluate", action="store_true", help="Score the pitch with ai/intel once the review is complete")
    parser.add_argument("--save", type=Path, help="Write the final review session JSON here (keep it out of git)")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        adapter = LocalJsonAdapter(Settings.from_env())
        engine = ReviewEngine(adapter.complete_json, model=adapter.settings.model)
        session = engine.start(args.pitch.read_text(encoding="utf-8"), document_id=args.pitch.name)
        while session["status"] == "needs_input":
            print(f"\nRound {session['round']}: a few questions about your idea")
            answers = []
            for question in pending_questions(session):
                reply = input(f"\n{question['questionEn']}\n> ").strip()
                answers.append({"qId": question["qId"], "text": reply or "I have not decided this yet."})
            session = engine.answer(session, answers)
        print("\nReview complete.")
        for key, verdict in session["verdicts"].items():
            print(f"  {key:16} {verdict['verdict']:10} {verdict['reason']}")
        calls = session["calls"]
        print(f"Model calls: {len(calls)}, total {sum(call['ms'] for call in calls) / 1000:.1f} s")
        if args.evaluate:
            from ai.intel.scoring import evaluate
            result = evaluate(extracted_input(session), adapter)
            print(f"\nPotential {result['potential']} · completeness {result['completeness']} · {result['band']} · {result['pathway']}")
        if args.save:
            args.save.write_text(json.dumps(session, indent=2, ensure_ascii=False), encoding="utf-8")
        return 0
    except (CapabilityUnavailable, PolicyViolation, ModelOutputError) as error:
        print(f"Local model problem: {error}. Start Ollama (ollama serve) and set LOCAL_LLM_MODEL to an installed model.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
