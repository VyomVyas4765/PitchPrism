import unittest
from unittest.mock import patch

from ai.config import PolicyViolation, Settings
from ai.ingest.pii import ensure_redacted, find_pii, redact
from ai.llm.adapter import LocalJsonAdapter

SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}


class RedactionTests(unittest.TestCase):
    # Every value below is synthetic.
    def test_contacts_and_ids_in_common_formats_are_tokenised(self):
        cases = {
            "Call 98765 43210 today": "Call ⟨PHONE⟩ today",
            "Mobile: +91-9876543210.": "Mobile: ⟨PHONE⟩.",
            "फोन 09876543210 पर": "फोन ⟨PHONE⟩ पर",
            "Office 0542-2345678": "Office ⟨PHONE⟩",
            "Write to synthetic.user@example.test now": "Write to ⟨EMAIL⟩ now",
            "Aadhaar 2345 6789 0123": "Aadhaar ⟨ID⟩",
            "PAN ABCDE1234F": "PAN ⟨ID⟩",
            "Placeholder 9000000080 and student80@demo.com": "Placeholder ⟨PHONE⟩ and ⟨EMAIL⟩",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(redact(text).text, expected)

    def test_indic_digits_are_detected_and_offsets_point_at_the_original(self):
        for text in ("मेरा नंबर ९८७६५४३२१० है", "నంబర్ ౯౮౭౬౫౪౩౨౧౦", "নম্বর ৯৮৭৬৫৪৩২১০", "ନମ୍ବର ୯୮୭୬୫୪୩୨୧୦"):
            with self.subTest(text=text):
                result = redact(text)
                self.assertIn("⟨PHONE⟩", result.text)
                span = result.spans[0]
                self.assertEqual(text[span.start:span.end], span.value)
                self.assertFalse(any(char.isdigit() for char in result.text))

    def test_business_numbers_and_coarse_location_are_kept(self):
        for text in ("Investment ₹1,00,000; loan 50000", "Revenue Rs 60,000 per month", "PIN 422001, Nashik",
                     "Price 120 per kg, 300 kg a month", "Years 2024-2026", "Daily sales target 2,500"):
            with self.subTest(text=text):
                self.assertEqual(redact(text).text, text)

    def test_known_names_are_redacted_in_full_and_by_part(self):
        known = {"name": ["Synthetic Kumari Devi"]}
        result = redact("I am synthetic kumari devi. Kumari runs the unit; ask KUMARI.", known)
        self.assertEqual(result.text, "I am ⟨NAME⟩. ⟨NAME⟩ runs the unit; ask ⟨NAME⟩.")
        self.assertEqual([span.kind for span in result.spans], ["name"] * 3)
        # Short parts would hit ordinary words, so they are not matched alone.
        self.assertEqual(redact("An idea", {"name": ["An Synthetic"]}).text, "An idea")

    def test_overlapping_matches_are_redacted_once(self):
        result = redact("+91 98765 43210", {"phone": ["98765 43210"]})
        self.assertEqual(result.text, "⟨PHONE⟩")
        self.assertEqual(len(result.spans), 1)

    def test_guard_blocks_unredacted_prompts_and_accepts_tokens(self):
        with self.assertRaises(PolicyViolation):
            ensure_redacted("Applicant phone 9876543210 wants a loan")
        ensure_redacted(redact("Applicant phone 9876543210 wants a loan").text)
        self.assertEqual(find_pii("Monthly revenue 60000"), [])


class AdapterGuardTests(unittest.TestCase):
    def test_adapter_refuses_pii_before_any_runtime_request(self):
        adapter = LocalJsonAdapter(Settings(model="synthetic-local:latest"))
        with patch.object(adapter, "_request") as call:
            for prompt in ("Contact synthetic.user@example.test", "Phone ९८७६५४३२१०"):
                with self.subTest(prompt=prompt), self.assertRaises(PolicyViolation):
                    adapter.complete_json(prompt, SCHEMA)
            call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
