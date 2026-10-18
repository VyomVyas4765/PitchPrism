import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from ai.config import PolicyViolation
from ai.ingest.edp_pdf import FILLUP_LABELS, ROWS, UnsupportedEdpPdf, extract_edp_pdf
from ai.intel.groq import GroqEdpAdapter
from ai.intel.narrative import followups
from ai.intel.scoring import FIELDS, _score_schema, evaluate, quality
from ai.llm.adapter import ModelOutputError


class _Crop:
    def __init__(self, text):
        self._text = text
        self.chars = [{"x0": 316, "top": 220, "x1": 380, "bottom": 231}]

    def extract_text(self):
        return self._text


class _Page:
    width, height = 595, 842

    def __init__(self, index, bad_question=False, address_answer=False):
        self.index = index
        self.bad_question = bad_question
        self.address_answer = address_answer

    def extract_text_lines(self):
        return [{"top": 52, "x0": 240, "text": "EDP Idea Brief"}]

    def crop(self, box):
        x0, top, *_ = box
        if top == 45:
            return _Crop('EDP Idea Brief')
        if top == 115:
            return _Crop('Name of the Applicant: Nila Das')
        row = next(i for i, spec in enumerate(ROWS) if spec[0] == self.index and spec[1] == top)
        if x0 == 60:
            return _Crop('unrelated question' if self.bad_question and row == 4 else ROWS[row][3])
        if self.address_answer and row == 1:
            return _Crop('Meet buyers at House 12, East Road.')
        return _Crop('Nila Das offers useful services. Contact 9876543210.' if row == 1
                     else f'Synthetic answer {row + 1} with a practical detail.')


class _Pdf:
    def __init__(self, bad_question=False, address_answer=False):
        self.pages = [_Page(0, address_answer=address_answer), _Page(1, bad_question)]

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass


class _FillupPage:
    width, height = 595, 842

    tops = ((274, 366, 406, 424, 443, 472, 511, 540, 580),
            (54, 104, 123, 162, 191, 210, 230))

    def __init__(self, index, bad_question=False, shift=0, missing_answer=False, address_answer=False,
                 omit_keys=(), existing_business_answer='No'):
        self.index = index
        self.bad_question = bad_question
        self.shift = shift
        self.missing_answer = missing_answer
        self.address_answer = address_answer
        self.omit_keys = omit_keys
        self.existing_business_answer = existing_business_answer

    def extract_text_lines(self):
        lines = []
        if self.index == 0:
            lines += [{"top": 52, "x0": 240, "text": "Business Idea"},
                      {"top": 110, "x0": 68, "text": "Name Nila Das"}]
        labels = FILLUP_LABELS[:9] if self.index == 0 else FILLUP_LABELS[9:]
        for (key, prefix), top in zip(labels, self.tops[self.index]):
            if key in self.omit_keys:
                continue
            text = FILLUP_LABELS[1][1] if self.bad_question and key == 'raw_materials' else prefix
            lines.append({"top": top + self.shift, "x0": 68, "text": text})
        return lines

    def crop(self, box):
        x0, top, *_ = box
        labels = FILLUP_LABELS[:9] if self.index == 0 else FILLUP_LABELS[9:]
        row = next(i for i, row_top in enumerate(self.tops[self.index]) if row_top + self.shift == top)
        key = labels[row][0]
        if self.missing_answer and key == 'monthly_revenue':
            return _Crop('')
        if self.address_answer and key == 'competition':
            return _Crop('Synthetic local alternative. Meet buyers at House 12, East Road.')
        if key == 'existing_business':
            return _Crop(self.existing_business_answer)
        return _Crop('Nila Das offers useful services. Contact 9876543210.' if key == 'offering'
                     else f'Synthetic answer for {key} with a practical detail.')


class _FillupPdf:
    def __init__(self, **options):
        self.pages = [_FillupPage(0, **options), _FillupPage(1, **options)]

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass


class ExtractorTests(unittest.TestCase):
    @patch('ai.ingest.edp_pdf.pdfplumber.open', return_value=_Pdf())
    def test_maps_ten_answers_with_citations_and_redacts(self, _open):
        idea = extract_edp_pdf(b'%PDF-synthetic', district='Pune', applicant_name='Nila Das')
        self.assertEqual(list(idea['fields']), list(FIELDS))
        self.assertEqual(quality(idea)['completeness'], 100)
        self.assertEqual([s['source']['page'] for s in idea['segments']], [1] * 3 + [2] * 7)
        self.assertTrue(all(len(s['source']['bbox']) == 4 for s in idea['segments']))
        self.assertNotIn('9876543210', json.dumps(idea))
        self.assertNotIn('Nila Das', json.dumps(idea))
        self.assertIn('exact address withheld', idea['segments'][0]['textEn'])

    @patch('ai.ingest.edp_pdf.pdfplumber.open', return_value=_Pdf(bad_question=True))
    def test_rejects_wrong_question_layout(self, _open):
        with self.assertRaises(UnsupportedEdpPdf) as failure:
            extract_edp_pdf(b'%PDF-synthetic', district='Pune', applicant_name='Nila Das')
        self.assertEqual(failure.exception.code, 'question_mismatch')

    @patch('ai.ingest.edp_pdf.pdfplumber.open', return_value=_Pdf(address_answer=True))
    def test_withholds_free_text_exact_address(self, _open):
        idea = extract_edp_pdf(b'%PDF-synthetic', district='Pune', applicant_name='Nila Das')
        self.assertEqual(idea['fields']['offering'], {'state': 'unreadable', 'evidence': []})
        self.assertNotIn('House 12', json.dumps(idea))
        self.assertNotIn('East Road', json.dumps(idea))

    @patch('ai.ingest.edp_pdf.pdfplumber.open', return_value=_FillupPdf())
    def test_maps_reordered_fillup_form_and_redacts(self, _open):
        idea = extract_edp_pdf(b'%PDF-synthetic', district='Pune', document_id='synthetic')
        self.assertEqual(set(idea['fields']), set(FIELDS))
        self.assertEqual(quality(idea)['completeness'], 100)
        self.assertEqual(idea['context']['plannedBusinessLocation']['evidence'], ['edp-10'])
        self.assertEqual(idea['segments'][0]['source']['page'], 1)
        self.assertEqual(idea['segments'][-1]['source']['page'], 2)
        self.assertNotIn('Nila Das', json.dumps(idea))
        self.assertNotIn('9876543210', json.dumps(idea))
        self.assertNotIn('experience', idea['fields'])
        self.assertEqual(followups(idea)[0]['field'], 'experience')

    @patch('ai.ingest.edp_pdf.pdfplumber.open', return_value=_FillupPdf(existing_business_answer='Yes, I already run a synthetic tailoring service.'))
    def test_existing_business_supplies_cited_readiness_experience(self, _open):
        idea = extract_edp_pdf(b'%PDF-synthetic', district='Pune')
        citation = idea['fields']['experience']['evidence'][0]
        source = next(segment for segment in idea['segments'] if segment['segId'] == citation)
        self.assertEqual(source['source']['page'], 2)
        self.assertIn('already run', source['textEn'])
        self.assertNotIn('experience', [question['field'] for question in followups(idea)])
        def cited_scorer(prompt, _schema):
            payload = json.loads(prompt[prompt.index('{'):])
            return {'domains': [{'key': key, 'score': 3, 'reason': 'Specific synthetic claim',
                                 'evidence': [payload['evidence'][key][0]['segId']], 'confidence': 'medium'}
                                for key in payload['domains']]}
        readiness = next(domain for domain in evaluate(idea, scorer=cited_scorer)['domains']
                         if domain['key'] == 'entrepreneur_readiness')
        self.assertEqual(readiness['score'], 3)
        self.assertEqual(readiness['evidence'], [citation])

    @patch('ai.ingest.edp_pdf.pdfplumber.open', return_value=_FillupPdf(shift=-11, missing_answer=True, address_answer=True))
    def test_shifted_rows_keep_citations_and_mark_missing_without_address_leak(self, _open):
        idea = extract_edp_pdf(b'%PDF-synthetic', district='Pune')
        self.assertEqual(idea['fields']['monthly_revenue'], {'state': 'missing', 'evidence': []})
        self.assertEqual(quality(idea)['completeness'], 90)
        self.assertEqual(idea['fields']['competition']['evidence'], ['edp-07'])
        self.assertNotIn('House 12', json.dumps(idea))
        self.assertNotIn('East Road', json.dumps(idea))

    @patch('ai.ingest.edp_pdf.pdfplumber.open', return_value=_FillupPdf(omit_keys=('offering', 'market_research')))
    def test_omitted_questions_are_not_asked(self, _open):
        idea = extract_edp_pdf(b'%PDF-synthetic', district='Pune')
        self.assertEqual(idea['fields']['offering'], {'state': 'not_asked', 'evidence': []})
        self.assertEqual(idea['fields']['market_research'], {'state': 'not_asked', 'evidence': []})
        self.assertEqual(quality(idea)['completeness'], 75)
        self.assertEqual(len(idea['segments']), 8)

    @patch('ai.ingest.edp_pdf.pdfplumber.open', return_value=_FillupPdf(bad_question=True))
    def test_rejects_misaligned_fillup_question(self, _open):
        with self.assertRaises(UnsupportedEdpPdf) as failure:
            extract_edp_pdf(b'%PDF-synthetic', district='Pune')
        self.assertEqual(failure.exception.code, 'question_mismatch')


class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class _Http:
    def __init__(self, content):
        self.content = content
        self.calls = 0
        self.payload = None

    def __call__(self, payload):
        self.calls += 1
        self.payload = payload
        return json.dumps(self.content).encode()


class GroqAdapterTests(unittest.TestCase):
    def test_strict_schema_and_local_output_validation(self):
        answer = {'domains': [{'key': 'clarity', 'score': 3, 'reason': 'Specific synthetic service and customer',
                               'evidence': ['s1'], 'confidence': 'medium'}]}
        http = _Http({'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(answer)}}],
                      'usage': {'prompt_tokens': 12, 'completion_tokens': 15}})
        adapter = GroqEdpAdapter(key='gsk_' + 'x' * 30, model='openai/gpt-oss-120b')
        adapter._post = http
        result = adapter.complete_json('Synthetic answer s1 describes a service.', _score_schema(['clarity']))
        self.assertEqual(result, answer)
        self.assertFalse(http.payload['store'])
        self.assertEqual(http.payload['tool_choice'], 'none')
        self.assertTrue(http.payload['response_format']['json_schema']['strict'])
        domains_schema = http.payload['response_format']['json_schema']['schema']['properties']['domains']
        self.assertNotIn('minItems', domains_schema)
        self.assertEqual(domains_schema['items']['properties']['evidence']['maxItems'], 6)  # the model may over-cite; evaluate() keeps the first three
        self.assertEqual(adapter.last_metrics['inputTokens'], 12)
        self.assertEqual(adapter.last_metrics['calls'], 1)

        http.content['choices'][0]['message']['content'] = json.dumps({**answer, 'domains': []})
        with self.assertRaises(ModelOutputError):
            adapter.complete_json('Synthetic answer s1.', _score_schema(['clarity']))

    def test_blocks_unredacted_contact_before_network(self):
        adapter = GroqEdpAdapter(key='gsk_' + 'x' * 30)
        http = _Http({})
        adapter._post = http
        with self.assertRaises(PolicyViolation):
            adapter.complete_json('Call 9876543210 for details.', _score_schema(['clarity']))
        self.assertEqual(http.calls, 0)

    @patch('ai.intel.groq.time.sleep')
    @patch('ai.intel.groq.subprocess.run')
    def test_rate_limit_retry_keeps_key_and_prompt_out_of_argv(self, run, sleep):
        run.side_effect = [
            SimpleNamespace(stdout='{"error":{"message":"Try again in 1s"}}\n429', returncode=0),
            SimpleNamespace(stdout='{"choices":[]}\n200', returncode=0),
        ]
        adapter = GroqEdpAdapter(key='gsk_' + 'x' * 30)
        self.assertEqual(json.loads(adapter._post({'syntheticPrompt': 'synthetic private answer'}))['choices'], [])
        self.assertEqual(run.call_count, 2)
        self.assertEqual(sleep.call_count, 1)
        args = run.call_args.args[0]
        self.assertNotIn(adapter._key, ' '.join(args))
        self.assertNotIn('synthetic private answer', ' '.join(args))


if __name__ == '__main__':
    unittest.main()
