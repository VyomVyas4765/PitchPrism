"""What a complete pitch must cover. One source: the question bank (data/seed/question-bank.json) and the scorer's fields."""
from __future__ import annotations

import json
from pathlib import Path

from ai.intel.scoring import FIELDS as CORE

_BANK = json.loads((Path(__file__).resolve().parents[2] / "data" / "seed" / "question-bank.json").read_text(encoding="utf-8"))

# Extra fields the scorer reads for entrepreneur readiness; extracted when present, never required.
EXTRA = ("skills", "experience")
DESCRIBE = {key: _BANK["fields"][key]["wordings"]["en"][0] for key in CORE}
DESCRIBE.update({"skills": "What skills or training does the entrepreneur have for this business?",
                 "experience": "What work experience does the entrepreneur have in this trade?"})
CHECKS = {key: _BANK["fields"][key]["review"]["checks"] for key in CORE}
FALLBACK_QUESTION = {key: _BANK["fields"][key]["review"]["followUp"] for key in CORE}

# The printed Business Idea Brief: questions are asked in its order, a field's first question in its wording, so the
# conversation fills the same form the evaluator reads (M-05 chat). Follow-ups for unclear answers are model-written.
FORM_QUESTION = {key: _BANK["fields"][key]["form"]["question"] for key in CORE}
PRIORITY = tuple(sorted(CORE, key=lambda key: _BANK["fields"][key]["form"]["number"]))
# Small, focused extraction calls keep prompts short enough for a 3B local model.
GROUPS = {
    "offer": ("offering", "customers", "location", "market_research"),
    "operations": ("raw_materials", "suppliers", "competition", "skills", "experience"),
    "money": ("funding", "unit_price", "monthly_revenue"),
}
GROUP_OF = {field: group for group, fields in GROUPS.items() for field in fields}
# Amounts the money group extracts; keys match ai/intel/finance.check_finances.
NUMBERS = {
    "investment": "total money needed to start the business",
    "self": "the entrepreneur's own money put in",
    "loan": "loan amount asked for",
    "unit_price": "price of one unit of the main product or service",
    "monthly_volume": "number of units or jobs sold per month",
    "monthly_revenue": "expected sales per month",
}
MAX_ASKS_PER_FIELD = 3
QUESTIONS_PER_ROUND = 3
