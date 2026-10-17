import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from jsonschema import Draft202012Validator

from ai.ingest.pii import ensure_redacted
from ai.ingest.run import Pipeline
from ai.intel.scoring import prepare_input
from ai.providers import CapabilityUnavailable
from ai.tests.pdf_fixtures import idea_brief_pdf

SCHEMA = json.loads((Path(__file__).resolve().parents[2] / "packages/contracts/schemas/centre-extracted-input.json").read_text(encoding="utf-8"))
FFMPEG = shutil.which(os.getenv("FFMPEG_BINARY", "ffmpeg"))


class EchoTranslator:
    """Stand-in model: marks text as translated so the test can see each segment went through."""
    def __init__(self):
        self.calls = []

    def translate(self, texts, language):
        self.calls.append((language, list(texts)))
        return list(texts) if language == "en" else [f"EN({text})" for text in texts]


class FakeTranscriber:
    def __init__(self, text="I will sell papad. I buy flour from the wholesale market."):
        self.text = text

    def transcribe(self, path, language=None):
        if language == "or":
            raise CapabilityUnavailable("No local speech model supports Odia yet; Odia recordings stay pending.")
        return {"language": language or "hi", "languageProbability": 0.9,
                "segments": [{"start": 0.0, "end": 2.0, "text": self.text, "confidence": 0.8}]}


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_pdf_becomes_cited_redacted_contract_input_the_scorer_accepts(self):
        path = self.dir / "brief.pdf"
        path.write_bytes(idea_brief_pdf())
        result = Pipeline(FakeTranscriber(), EchoTranslator()).run({"documents": [{"documentId": "doc1", "kind": "pdf", "path": str(path)}], "language": "en"})
        self.assertEqual(result["status"], "extracted", result)
        extracted = result["extracted"]
        Draft202012Validator(SCHEMA).validate(extracted)
        prepare_input(extracted)  # Dev 2's fail-closed checks
        fields = extracted["fields"]
        self.assertEqual(fields["location"]["state"], "answered")
        self.assertEqual(fields["suppliers"], {"state": "missing", "evidence": []})        # [Left Blank]
        self.assertEqual(fields["raw_materials"], {"state": "not_asked", "evidence": []})  # never asked
        self.assertEqual(fields["market_research"]["state"], "not_asked")
        # The struck Rs 20,000 is history; only the blue correction is evidence.
        segments = {s["segId"]: s for s in extracted["segments"]}
        revenue = [segments[seg]["textOriginal"] for seg in fields["monthly_revenue"]["evidence"]]
        self.assertEqual(revenue, ["Rs 12,000 per month"])
        struck = [s for s in extracted["segments"] if s.get("struck")]
        self.assertEqual([s["textOriginal"] for s in struck], ["Rs 20,000"])
        self.assertEqual(segments[struck[0]["supersededBy"]]["textOriginal"], "Rs 12,000 per month")
        self.assertEqual(extracted["context"]["plannedBusinessLocation"],
                         {"district": "Nashik", "state": "Maharashtra", "source": "pdf", "evidence": fields["location"]["evidence"], "village": "Sinnar", "pincode": "422103"})
        # The phone in the header is never in any segment; the off-topic question is kept as extra Q&A.
        for segment in extracted["segments"]:
            ensure_redacted(segment["textOriginal"])
            self.assertIn("page", segment["source"])
        self.assertEqual(result["redactions"], 1)   # the phone number; name and address are replaced as header values
        self.assertEqual(sorted(box["kind"] for box in result["blurBoxes"]), ["address", "name", "phone"])
        self.assertTrue(all(box["page"] == 1 and len(box["bbox"]) == 4 for box in result["blurBoxes"]))
        self.assertNotIn("Kamala", json.dumps(result, ensure_ascii=False))
        self.assertNotIn("Synthetic Lane", json.dumps(result, ensure_ascii=False))
        self.assertEqual([qa["question"] for qa in result["extraQa"]], ["7. What is your favourite cricket team?"])

    def test_typed_steps_translate_per_segment_and_only_count_mentioned_fields(self):
        translator = EchoTranslator()
        result = Pipeline(FakeTranscriber(), translator).run({
            "typedAnswers": {"sell": "पापड़ और अचार। आटा थोक बाज़ार से", "where": "सिन्नर, नाशिक", "money": "मेरे पास पाँच हज़ार हैं"},
            "language": "hi", "profile": {"district": "Nashik", "state": "Maharashtra"}})
        self.assertEqual(result["status"], "extracted", result)
        fields = result["extracted"]["fields"]
        self.assertEqual(fields["offering"]["state"], "answered")
        # Secondary fields in the "sell" step need a mention in the English text; the echo translation has none.
        self.assertEqual(fields["suppliers"]["state"], "missing")
        self.assertEqual(fields["customers"]["state"], "missing")      # its step was not answered
        self.assertEqual(result["extracted"]["context"]["plannedBusinessLocation"]["source"], "profile")
        self.assertTrue(all(language == "hi" for language, _ in translator.calls))
        self.assertTrue(all(s["textEn"].startswith("EN(") for s in result["extracted"]["segments"]))

    def test_missing_translation_or_location_is_pending_not_guessed(self):
        class NoTranslator:
            def translate(self, texts, language):
                raise CapabilityUnavailable("No local translation model is installed.")
        result = Pipeline(FakeTranscriber(), NoTranslator()).run({"typedAnswers": {"sell": "పచ్చళ్ళు"}, "language": "te"})
        self.assertEqual(result["status"], "pending")
        self.assertEqual({item["stage"] for item in result["pending"]}, {"translate", "location"})
        self.assertNotIn("extracted", result)

    @unittest.skipUnless(FFMPEG, "ffmpeg is not installed")
    def test_guided_audio_keeps_original_time_anchors_and_odia_stays_pending(self):
        clip = self.dir / "sell.wav"
        subprocess.run([FFMPEG, "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=4",
                        "-ac", "1", "-y", str(clip)], check=True)
        result = Pipeline(FakeTranscriber(), EchoTranslator()).run({
            "documents": [{"documentId": "rec1", "kind": "audio", "path": str(clip), "promptStep": "sell"}],
            "language": "hi", "profile": {"district": "Nashik", "state": "Maharashtra"}})
        self.assertEqual(result["status"], "extracted", result)
        segment = result["extracted"]["segments"][0]
        self.assertEqual(segment["source"]["type"], "audio")
        self.assertEqual((segment["source"]["chunkId"], segment["source"]["start"]), ("c_0001", 0.0))
        self.assertEqual(result["extracted"]["fields"]["offering"]["state"], "answered")
        odia = Pipeline(FakeTranscriber(), EchoTranslator())
        with self.assertRaises(CapabilityUnavailable):
            odia.run({"documents": [{"documentId": "rec2", "kind": "audio", "path": str(clip), "promptStep": "sell"}], "language": "or"})

    def test_declared_kind_must_match_the_content(self):
        fake = self.dir / "fake.pdf"
        fake.write_bytes(b"not a pdf at all")
        result = Pipeline(FakeTranscriber(), EchoTranslator()).run({"documents": [{"documentId": "d", "kind": "pdf", "path": str(fake)}]})
        self.assertEqual(result["status"], "invalid")


if __name__ == "__main__":
    unittest.main()
