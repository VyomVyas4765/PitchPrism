# Ingest-output fixtures (synthetic)

What Dev 2's stages receive after `extract`, in the shape of the draft [ingest-output.v0](../../schemas/drafts/ingest-output.v0.json) contract. Every person, place detail and amount is invented; personal details appear only as redaction tokens.

| File | Covers |
| --- | --- |
| `typed-accurate.en.json` | Typed answers, all ten canonical fields answered and cited |
| `audio-codemixed.hi.json` | Guided voice steps with audio anchors, Hindi–English code-mixing, a redacted phone, a missing supplier answer |
| `pdf-overwritten.mr.json` | Marathi PDF with page boxes, a struck value and its correction, a `[Left Blank]` answer, a not-asked field |

Draft status: field names may change when Dev 3 integrates the contract under D-03. `ai/tests/test_contract_fixtures.py` keeps these files valid.
