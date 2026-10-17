"""Chat intake (M-05 chat): replies become cited English segments, the review asks until complete, questions speak
the entrepreneur's language. Synthetic text only; fake translator, pipeline and model."""
import unittest
from pathlib import Path

from ai.ingest import chat
from ai.providers import CapabilityUnavailable
from ai.review import ReviewEngine, extracted_input, pending_questions
from ai.review.criteria import CORE
from ai.review.localize import localize
from ai.tests.review_fakes import FACTS, FakeLLM


class FakeTranslator:
    """Marathi → English by a fixed phrase table; English passes through."""
    TABLE = {"मी शिवणकामाचे दुकान सुरू करणार आहे.": "I want to start a tailoring shop that stitches blouses."}

    def __init__(self):
        self.calls = []

    def translate(self, texts, language):
        self.calls.append(language)
        if language == "en":
            return list(texts)
        return [self.TABLE.get(text, "") for text in texts]


class FakePipeline:
    def __init__(self, result):
        self.result, self.jobs = result, []
        self.translator = FakeTranslator()

    def run(self, job):
        self.jobs.append(job)
        return self.result


class TextReplyTests(unittest.TestCase):
    def test_sentences_are_redacted_identified_and_translated_with_originals_kept(self):
        translator = FakeTranslator()
        segments, redacted = chat.text_segments("मी शिवणकामाचे दुकान सुरू करणार आहे. Call 9876543210 for orders.", "mr", "doc1", "r1m", translator)
        self.assertEqual([s["segId"] for s in segments], ["r1m1", "r1m2"])
        self.assertEqual(segments[0]["textEn"], "I want to start a tailoring shop that stitches blouses.")
        self.assertEqual(segments[0]["lang"], "mr")
        self.assertEqual(segments[0]["textOriginal"], "मी शिवणकामाचे दुकान सुरू करणार आहे.")
        self.assertEqual(segments[1], {"segId": "r1m2", "textEn": "Call ⟨PHONE⟩ for orders.", "lang": "en",
                                       "source": {"type": "text", "documentId": "doc1"}})
        self.assertEqual(redacted, 1)

    def test_missing_translation_fails_visibly(self):
        class Unavailable:
            def translate(self, texts, language):
                if language == "en":
                    return list(texts)
                raise CapabilityUnavailable("no local translation")
        with self.assertRaises(CapabilityUnavailable):
            chat.text_segments("मी शिवणकामाचे दुकान सुरू करणार आहे.", "mr", "doc1", "s", Unavailable())


class FileReplyTests(unittest.TestCase):
    def test_form_answers_keep_their_question_and_struck_lines_are_dropped(self):
        pipeline = FakePipeline({"status": "pending", "pending": [{"stage": "location", "reason": "x"}], "redactions": 2, "transcript": [
            {"segId": "s_0001", "textEn": "Blouses and uniforms", "textOriginal": "ब्लाउज", "lang": "mr", "field": "offering",
             "source": {"type": "pdf", "documentId": "tmp", "page": 1, "bbox": [1, 2, 3, 4]}, "struck": False},
            {"segId": "s_0002", "textEn": "Old answer", "lang": "en", "struck": True, "source": {"type": "pdf", "page": 1}},
            {"segId": "s_0003", "textEn": "Nashik", "lang": "en", "field": "location", "source": {"type": "pdf", "page": 1}},
        ]})
        segments, redacted = chat.file_segments(Path("reply.pdf"), "pdf", "mr", "doc7", "r2m", pipeline)
        self.assertEqual(pipeline.jobs[0]["documents"][0]["kind"], "pdf")
        self.assertEqual(redacted, 2)
        self.assertEqual([s["segId"] for s in segments], ["r2m1", "r2m2"])
        self.assertTrue(segments[0]["textEn"].endswith("— Blouses and uniforms"))
        self.assertEqual(segments[0]["source"], {"type": "pdf", "documentId": "doc7", "page": 1, "bbox": [1, 2, 3, 4]})
        self.assertEqual(segments[0]["textOriginal"], "ब्लाउज")
        self.assertIn("Nashik", segments[1]["textEn"])

    def test_untranslatable_or_unreadable_files_fail_visibly(self):
        pending = FakePipeline({"status": "pending", "pending": [{"stage": "translate", "reason": "No local translation for or."}], "transcript": []})
        with self.assertRaises(CapabilityUnavailable):
            chat.file_segments(Path("a.m4a"), "audio", "or", "doc", "s", pending)
        with self.assertRaises(ValueError):
            chat.file_segments(Path("a.pdf"), "pdf", "en", "doc", "s", FakePipeline({"status": "invalid", "reason": "x"}))


class ChatReviewTests(unittest.TestCase):
    def test_one_reply_answers_all_pending_questions_until_the_pitch_is_complete(self):
        engine = ReviewEngine(FakeLLM())
        session = engine.start("I want to start a tailoring shop that stitches blouses and school uniforms.")
        rounds = 0
        while session["status"] == "needs_input":
            rounds += 1
            self.assertLessEqual(rounds, 12)
            reply = " ".join(FACTS[q["field"]] for q in pending_questions(session))
            segments, _ = chat.text_segments(reply, "en", f"reply{rounds}", f"r{session['round']}m", FakeTranslator())
            session = engine.answer_message(session, segments, chat.english_of(segments))
        idea = extracted_input(session)
        self.assertEqual(idea["context"]["plannedBusinessLocation"]["district"], "Nashik")
        self.assertEqual({key for key, entry in idea["fields"].items() if entry["state"] == "answered"} & set(CORE), set(CORE))
        ids = [segment["segId"] for segment in idea["segments"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_i_have_not_decided_is_recorded_as_declined(self):
        engine = ReviewEngine(FakeLLM())
        session = engine.start("I want to start a tailoring shop that stitches blouses and school uniforms.")
        fields = [q["field"] for q in pending_questions(session)]
        segments, _ = chat.text_segments("I have not decided this yet.", "en", "r", "r1m", FakeTranslator())
        session = engine.answer_message(session, segments, chat.english_of(segments))
        self.assertTrue(set(fields) <= set(session["declined"]))

    def test_a_reply_when_nothing_is_pending_is_refused(self):
        engine = ReviewEngine(FakeLLM())
        session = engine.start("\n".join(FACTS.values()))
        self.assertEqual(session["status"], "complete")
        with self.assertRaises(ValueError):
            engine.answer_message(session, [{"segId": "x1", "textEn": "more", "lang": "en", "source": {"type": "text"}}], "more")


class LocalizeTests(unittest.TestCase):
    def questions(self):
        return [{"qId": "f1", "questionEn": "Who will buy from you?"}, {"qId": "f2", "questionEn": "Where will the shop be?"}]

    def test_questions_are_written_in_the_chosen_language(self):
        questions = self.questions()
        localize(questions, "hi", lambda prompt, schema: {"items": [{"qId": "f1", "text": "आपसे कौन खरीदेगा?"},
                                                                    {"qId": "f2", "text": "दुकान कहाँ होगी?"}]})
        self.assertEqual([(q["text"], q["lang"]) for q in questions], [("आपसे कौन खरीदेगा?", "hi"), ("दुकान कहाँ होगी?", "hi")])

    def test_wrong_script_or_model_failure_keeps_english_marked_as_english(self):
        questions = self.questions()
        localize(questions, "te", lambda prompt, schema: {"items": [{"qId": "f1", "text": "Who will buy?"}, {"qId": "f2", "text": "ఎక్కడ?"}]})
        self.assertEqual(questions[0], {"qId": "f1", "questionEn": "Who will buy from you?", "text": "Who will buy from you?", "lang": "en"})
        self.assertEqual(questions[1]["lang"], "te")

        def broken(prompt, schema):
            raise RuntimeError("model down")
        questions = self.questions()
        localize(questions, "mr", broken)
        self.assertTrue(all(q["lang"] == "en" for q in questions))

    def test_english_needs_no_model_and_earlier_wording_is_kept(self):
        questions = self.questions()
        questions[0].update({"text": "पहले", "lang": "hi"})
        localize(questions, "en", lambda prompt, schema: self.fail("no model call for English"))
        self.assertEqual(questions[0]["text"], "पहले")
        self.assertEqual(questions[1]["text"], "Where will the shop be?")


if __name__ == "__main__":
    unittest.main()
