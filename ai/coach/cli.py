"""JSON-in/JSON-out helper the API calls for the entrepreneur's "My ideas" dashboard (one task per run).

    {"task": "translate", "language": "mr", "texts": ["..."]}         -> {"texts": [...], "langs": [...]}
    {"task": "improve", "language": "mr", "idea": {...}}              -> {"summary": "...", "suggestions": [...], "lang": "mr"}

Only redacted English text from the reviewed plan is sent to the model (the adapter refuses prompts with personal
data). A translation that fails the script check keeps the English text and says so (lang "en"), as the chat does.
"""
from __future__ import annotations

import json
import sys

from ai.coach.translate import translate_texts
from ai.coach.improve import improve
from ai.llm.factory import make_adapter


def main() -> int:
    request = json.load(sys.stdin)
    adapter = make_adapter()
    language = request.get("language", "en")
    if request.get("task") == "translate":
        texts, langs = translate_texts(list(request.get("texts", [])), language, adapter.complete_json)
        result = {"texts": texts, "langs": langs}
    elif request.get("task") == "improve":
        result = improve(request["idea"], language, adapter.complete_json)
    else:
        raise SystemExit("unknown task")
    json.dump(result, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
