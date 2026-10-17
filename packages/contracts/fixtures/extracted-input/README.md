# Extracted-input fixtures (synthetic)

Dev 1 → Dev 2 hand-off examples in the shared [CentreExtractedInput](../../schemas/centre-extracted-input.json) contract (D-03). Every person, place detail and amount is invented; personal details appear only as redaction tokens.

| File | Covers | Dev 2 scorer result with no approved model |
| --- | --- | --- |
| `typed-accurate.en.json` | Typed answers, all ten canonical fields answered and cited | `pending_model`, completeness 100 |
| `audio-codemixed.hi.json` | Guided voice steps with audio anchors (`chunkId`, `start`, `end`), Hindi–English code-mixing, a redacted phone token, unanswered fields marked `missing` | `pending_model`, completeness 76 |
| `pdf-overwritten.mr.json` | Marathi PDF with page boxes, a struck value superseded by its correction, `[Left Blank]`, a not-asked field | deterministic `Unassessable` |

`ai/tests/test_contract_fixtures.py` validates each file against the schema and Dev 2's `prepare_input` checks.
