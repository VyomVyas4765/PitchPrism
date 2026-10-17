from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw, ImageFont

from ai.ingest.language import identify, text_layer_quality
from ai.ingest.ocr import OcrLine, available_languages, ocr_image, resolve_dittos
from ai.ingest.pdf import lines_of, read_pdf
from ai.tests.pdf_fixtures import build_pdf, idea_brief_pdf


class PdfReadingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "brief.pdf"
        self.path.write_bytes(idea_brief_pdf())

    def tearDown(self):
        self.temp.cleanup()

    def test_spans_keep_page_box_and_reading_order(self):
        pages = read_pdf(self.path)
        self.assertEqual([page.number for page in pages], [1, 2])
        self.assertTrue(all(page.digital for page in pages))
        texts = [" ".join(span.text for span in line) for line in lines_of(pages[0])]
        self.assertEqual(texts[0], "Business Idea Brief")
        self.assertEqual(texts[3], "Address: House 12, Synthetic Lane, Sinnar")
        self.assertEqual(texts[5], "Sinnar, Nashik, Maharashtra 422103")
        first = pages[0].spans[0]
        self.assertAlmostEqual(first.bbox[0], 72, delta=1)
        self.assertLess(first.bbox[1], 60)  # top-left origin: near the top of an 842 pt page

    def test_struck_grey_value_and_blue_correction_are_told_apart(self):
        spans = read_pdf(self.path)[0].spans
        struck = [span for span in spans if span.struck]
        self.assertEqual([span.text for span in struck], ["Rs 20,000"])
        self.assertEqual(struck[0].ink, "grey")
        correction = next(span for span in spans if span.text == "Rs 12,000 per month")
        self.assertEqual((correction.ink, correction.struck), ("blue", False))
        # A table rule below text is not a strike-through.
        self.assertFalse(any(span.struck for span in read_pdf(self.path)[1].spans))

    def test_pages_without_a_text_layer_are_scanned(self):
        empty = Path(self.temp.name) / "scan.pdf"
        empty.write_bytes(build_pdf([[("line", 10, 10, 100, 10, 1)]]))
        page = read_pdf(empty)[0]
        self.assertEqual((page.digital, page.spans), (False, []))


class LanguageTests(unittest.TestCase):
    def test_answer_language_by_script_and_function_words(self):
        self.assertEqual(identify("मी पापड आणि लोणचे बनवणार आहे").lang, "mr")
        self.assertEqual(identify("मैं पापड़ और अचार बनाऊँगी, यह मेरा काम है").lang, "hi")
        self.assertEqual(identify("నేను దుకాణం పెడతాను").lang, "te")
        self.assertEqual(identify("ମୁଁ ଦୋକାନ କରିବି").lang, "or")
        self.assertEqual(identify("আমি দোকান করব").lang, "bn")
        self.assertEqual(identify("Mobile phone repair").lang, "en")
        mixed = identify("मेरे customers गाँव की दुकानें और self help group की महिलाएँ होंगी")
        self.assertEqual((mixed.lang, set(mixed.langs)), ("hi", {"hi", "en"}))
        self.assertEqual(identify("1234 ..").lang, "und")

    def test_quality_gate_flags_corrupted_indic_text_layers(self):
        self.assertFalse(text_layer_quality("मैं अपना व्यवसाय शुरू करूँगी").needs_reread)
        self.assertFalse(text_layer_quality("Plain English answer").needs_reread)
        self.assertTrue(text_layer_quality("ि बजनेस ा शुरू").needs_reread)          # vowel signs starting words
        self.assertTrue(text_layer_quality("व्यवसाय � शुरू").needs_reread)      # replacement character
        long_without_i = "बजनेस शुरू करने के लए मुझे पैसे चाहए और दुकान चाहए " * 3   # pre-base ि dropped throughout
        result = text_layer_quality(long_without_i)
        self.assertTrue(result.needs_reread)
        self.assertIn("missing_pre_base_vowels_devanagari", result.reasons)


@unittest.skipUnless("en" in available_languages(), "Tesseract English data not installed")
class OcrTests(unittest.TestCase):
    def test_lines_have_confidence_and_pdf_point_boxes(self):
        image = Image.new("L", (1200, 400), 255)
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype("arial.ttf", 48)
        draw.text((60, 60), "Monthly revenue 12000", fill=0, font=font)
        draw.text((60, 200), "Tailoring unit in Nashik", fill=0, font=font)
        page = ocr_image(image, ["en"], dpi=300)
        texts = [line.text for line in page.lines]
        self.assertEqual(texts, ["Monthly revenue 12000", "Tailoring unit in Nashik"])
        self.assertTrue(all(line.confidence > 80 and not line.unreadable for line in page.lines))
        self.assertAlmostEqual(page.lines[0].bbox[0], 60 * 72 / 300, delta=4)
        self.assertFalse(page.blurred)

    def test_noise_is_unreadable_not_guessed(self):
        import random
        random.seed(7)
        image = Image.new("L", (800, 200), 255)
        draw = ImageDraw.Draw(image)
        for _ in range(4000):
            x, y = random.randrange(800), random.randrange(200)
            draw.point((x, y), fill=0)
        page = ocr_image(image, ["en"], dpi=300)
        self.assertTrue(all(line.unreadable for line in page.lines))

    def test_ditto_marks_repeat_the_value_above(self):
        lines = [OcrLine("Thread", 90, (100, 10, 160, 20), False), OcrLine('"', 85, (110, 30, 120, 40), False)]
        resolve_dittos(lines)
        self.assertEqual((lines[1].text, lines[1].ditto_of), ("Thread", 0))


if __name__ == "__main__":
    unittest.main()
