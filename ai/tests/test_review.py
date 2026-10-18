"""Pitch review loop (D-33) with a deterministic fake model: gaps, questions, answers, completion and hand-off to scoring."""
import unittest

from ai.intel.scoring import evaluate, prepare_input
from ai.llm.adapter import ModelOutputError
from ai.review import ReviewEngine, extracted_input, pending_questions
from ai.review import ask, extract, judge
from ai.review.criteria import CORE, MAX_ASKS_PER_FIELD, QUESTIONS_PER_ROUND
from ai.review.segment import PitchTooLong, segment
from ai.tests.review_fakes import COMPLETE_PITCH, FACTS, FakeLLM
from ai.tests.test_centre_scoring import scorer

GAPPY_PITCH = "I want to start a tailoring shop that stitches blouses and school uniforms. I will charge Rs 250 for a blouse."


def answer_all(engine, session, reply, max_rounds=12):
    """Answer every pending question with reply(field) until the review completes; returns (session, rounds)."""
    rounds = 0
    while session["status"] == "needs_input":
        rounds += 1
        assert rounds <= max_rounds, "the review loop did not end"
        session = engine.answer(session, [{"qId": q["qId"], "text": reply(q["field"])} for q in pending_questions(session)])
    return session, rounds


class SegmentTests(unittest.TestCase):
    def test_splits_sentences_keeps_abbreviations_and_redacts(self):
        segments, redacted = segment("I will charge Rs. 250 per blouse. Call me on 9876543210!\nSecond line here.", "doc")
        self.assertEqual([s["textEn"] for s in segments], ["I will charge Rs. 250 per blouse.", "Call me on ⟨PHONE⟩!", "Second line here."])
        self.assertEqual(redacted, 1)
        self.assertEqual([s["segId"] for s in segments], ["s1", "s2", "s3"])
        self.assertEqual(segments[0]["source"], {"type": "text", "documentId": "doc", "start": 0, "end": 33})

    def test_rejects_oversized_pitches(self):
        with self.assertRaises(PitchTooLong):
            segment("word " * 5000, "doc")


class ExtractValidationTests(unittest.TestCase):
    def test_uncited_answers_invented_places_and_numbers_without_digits_are_dropped(self):
        segments, _ = segment("We sell tea. The stall is in Pune district, Maharashtra. We need some money.", "doc")
        raw = {"fields": [{"key": "offering", "state": "answered", "evidence": ["s9"], "value": "tea"},
                          {"key": "customers", "state": "answered", "evidence": ["s1"], "value": "people"}],
               "location": {"village": "", "district": "Nashik", "state": "Maharashtra", "line": "s2"}, "businessType": "tea stall"}
        result = extract.validate("offer", raw, segments)
        self.assertEqual(result["fields"]["offering"]["state"], "missing")  # cited a line that does not exist
        self.assertEqual(result["fields"]["customers"]["evidence"], ["s1"])
        self.assertEqual(result["fields"]["location"]["state"], "missing")  # topic omitted by the model
        self.assertEqual(result["location"], {"state": "Maharashtra", "segId": "s2"})  # "Nashik" is not in s2
        money = extract.validate("money", {"fields": [], "numbers": [{"key": "investment", "value": 50000, "line": "s3"},
                                                                       {"key": "loan", "value": 1, "line": "s99"}]}, segments)
        self.assertEqual(money["numbers"], {})


class JudgeTests(unittest.TestCase):
    def setUp(self):
        self.segments, _ = segment("I sell tea and snacks at the bus stand. I need Rs 50000 to start, with Rs 10000 savings and a loan of Rs 30000.", "doc")

    def test_rules_find_missing_topics_missing_amounts_and_sums_that_disagree(self):
        fields = {key: {"state": "missing", "evidence": [], "value": ""} for key in CORE}
        fields["offering"] = {"state": "answered", "evidence": ["s1"], "value": "tea"}
        fields["funding"] = {"state": "answered", "evidence": ["s2"], "value": "50000"}
        numbers = {"investment": {"value": 50000, "segId": "s2"}, "self": {"value": 10000, "segId": "s2"}, "loan": {"value": 30000, "segId": "s2"}}
        gaps = judge.rule_gaps(fields, numbers, None, self.segments)
        self.assertEqual(gaps["customers"]["verdict"], "missing")
        self.assertEqual(gaps["funding"]["verdict"], "contradictory")
        self.assertIn("40000", gaps["funding"]["reason"])
        self.assertNotIn("offering", gaps)

    def test_declined_answers_are_recognised(self):
        for text in ("I don't know yet", "Not decided", "I have not checked this", "no idea"):
            self.assertTrue(judge.is_declined(text), text)
        self.assertFalse(judge.is_declined("I asked 30 women and they said they would buy"))


class QuestionRuleTests(unittest.TestCase):
    def test_personal_leading_and_double_questions_are_refused(self):
        self.assertTrue(ask.acceptable("Who will buy your blouses, and roughly how many customers do you expect?"))
        for bad in ("What is your phone number?", "What is your caste?", "Don't you think schools will buy?",
                    "Who buys? Where are they?", "Tell me about customers."):
            self.assertFalse(ask.acceptable(bad), bad)

    def test_every_fallback_question_follows_the_rules(self):
        from ai.review.criteria import FALLBACK_QUESTION
        for field, question in FALLBACK_QUESTION.items():
            self.assertTrue(ask.acceptable(question), field)

    def test_fallback_wording_and_the_last_chance_note(self):
        bad_model = lambda step, prompt, schema: {"questions": [{"key": "customers", "question": "What is your phone number?"}]}
        verdicts = {"customers": {"verdict": "missing", "reason": "The pitch does not say."}}
        text = ask.questions(["customers"], verdicts, {}, {"customers": MAX_ASKS_PER_FIELD - 1}, bad_model)["customers"]
        self.assertTrue(text.startswith("Who will buy from you"))
        self.assertTrue(text.endswith(ask.LAST_CHANCE))


class ReviewLoopTests(unittest.TestCase):
    def test_a_complete_pitch_passes_without_questions_and_scores(self):
        llm = FakeLLM()
        session = ReviewEngine(llm).start(COMPLETE_PITCH)
        self.assertEqual(session["status"], "complete")
        self.assertEqual(pending_questions(session), [])
        self.assertTrue(all(v["verdict"] == "sufficient" for v in session["verdicts"].values()))
        idea = extracted_input(session)
        prepare_input(idea)
        result = evaluate(idea, scorer=scorer)
        self.assertEqual((result["completeness"], result["band"]), (100, "Strong"))
        self.assertEqual(len(llm.prompts), 4)  # three extraction calls and one judge call; no questions needed

    def test_a_gappy_pitch_is_questioned_in_priority_order_until_complete(self):
        engine = ReviewEngine(FakeLLM())
        session = engine.start(GAPPY_PITCH)
        self.assertEqual(session["status"], "needs_input")
        first = pending_questions(session)
        # The printed form's order (Q1 location, Q3 customers, Q4 market research); the model writes every question.
        self.assertEqual([q["field"] for q in first], ["location", "customers", "market_research"])
        self.assertTrue(all(q["questionEn"].startswith("Could you tell us more") for q in first))
        self.assertLessEqual(len(first), QUESTIONS_PER_ROUND)
        session, rounds = answer_all(engine, session, lambda field: FACTS[field])
        self.assertEqual(session["status"], "complete")
        self.assertEqual(rounds, 3)
        self.assertTrue(all(v["verdict"] == "sufficient" for v in session["verdicts"].values()))
        idea = extracted_input(session)
        self.assertEqual(idea["context"]["plannedBusinessLocation"]["district"], "Nashik")
        self.assertEqual(idea["financials"]["loan"]["value"], 40000)
        self.assertEqual(evaluate(idea, scorer=scorer)["completeness"], 100)

    def test_dont_know_is_recorded_as_declined_and_scored_as_missing(self):
        engine = ReviewEngine(FakeLLM())
        session = engine.start(GAPPY_PITCH)
        session, _ = answer_all(engine, session, lambda field: "I don't know yet" if field == "market_research" else FACTS[field])
        self.assertEqual(session["status"], "complete")
        self.assertEqual(session["verdicts"]["market_research"]["verdict"], "declined")
        idea = extracted_input(session)
        self.assertEqual(idea["fields"]["market_research"], {"state": "missing", "evidence": []})
        self.assertEqual(evaluate(idea, scorer=scorer)["completeness"], 90)

    def test_a_topic_still_vague_after_three_asks_is_settled_so_the_loop_ends(self):
        engine = ReviewEngine(FakeLLM())
        session = engine.start(GAPPY_PITCH)
        session, rounds = answer_all(engine, session,
                                     lambda field: "Some customers in many places will buy from me." if field == "customers" else FACTS[field])
        self.assertEqual(session["status"], "complete")
        asked = [q for q in session["questions"] if q["field"] == "customers"]
        self.assertEqual(len(asked), MAX_ASKS_PER_FIELD)
        self.assertTrue(asked[-1]["questionEn"].endswith(ask.LAST_CHANCE))
        self.assertEqual(session["verdicts"]["customers"]["verdict"], "declined")
        # An unclear answer is still scored as written, not discarded.
        self.assertEqual(extracted_input(session)["fields"]["customers"]["state"], "answered")

    def test_redacts_before_any_model_call_and_keeps_tokens_in_segments(self):
        llm = FakeLLM()
        session = ReviewEngine(llm).start(COMPLETE_PITCH + "\nCall me on +91 98765 43210 or write to someone@example.com.")
        self.assertEqual(session["redactedSpans"], 2)
        self.assertIn("⟨PHONE⟩", session["segments"][-1]["textEn"])

    def test_one_malformed_reply_is_retried_and_two_fail_loudly(self):
        session = ReviewEngine(FakeLLM(fail={"fields": 1})).start(COMPLETE_PITCH)
        self.assertEqual(session["status"], "complete")
        self.assertEqual(sum(1 for call in session["calls"] if not call["ok"]), 1)
        with self.assertRaises(ModelOutputError):
            ReviewEngine(FakeLLM(fail={"fields": 2})).start(COMPLETE_PITCH)

    def test_answers_must_match_pending_questions(self):
        engine = ReviewEngine(FakeLLM())
        session = engine.start(GAPPY_PITCH)
        with self.assertRaises(ValueError):
            engine.answer(session, [{"qId": "nope", "text": "hello"}])
        complete = engine.start(COMPLETE_PITCH)
        with self.assertRaises(ValueError):
            engine.answer(complete, [{"qId": "q1-1-customers", "text": "x"}])


if __name__ == "__main__":
    unittest.main()
