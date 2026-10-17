"""AI pitch review (D-33): read a plain-text pitch, find gaps, ask follow-up questions until it is complete, then hand it to scoring.

    from ai.review import ReviewEngine, extracted_input
    engine = ReviewEngine(make_adapter().complete_json)   # ai.llm.factory
    session = engine.start(pitch_text)
    while session["status"] == "needs_input":
        session = engine.answer(session, [{"qId": q["qId"], "text": reply(q["questionEn"])} for q in pending_questions(session)])
    idea = extracted_input(session)   # ai.intel.scoring.evaluate(idea, adapter)
"""
from ai.review.session import ReviewEngine, extracted_input, pending_questions, summary

__all__ = ["ReviewEngine", "extracted_input", "pending_questions", "summary"]
