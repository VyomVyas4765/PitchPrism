"""Grounded English drafts; language delivery is owned by the ingestion/mobile pipeline."""
from typing import Any

from ai.intel.scoring import FIELDS

QUESTIONS = {
    "offering": "What products or services will you provide?",
    "customers": "Who are your target customers?",
    "location": "Where will you set up the business?",
    "market_research": "What have you learned about demand in that market?",
    "raw_materials": "What materials will you need?",
    "suppliers": "Who can supply those materials?",
    "funding": "How will you pay for the setup costs?",
    "competition": "Which similar businesses already serve those customers?",
    "unit_price": "What will you charge per unit?",
    "monthly_revenue": "What monthly sales do you expect, and how did you estimate them?",
}
SECTIONS = {
    "What the business offers": ("offering",),
    "Who it serves": ("customers",),
    "Planned business site": ("location",),
    "Market and competition": ("market_research", "competition"),
    "Operations and suppliers": ("raw_materials", "suppliers"),
    "Funding and sales assumptions": ("funding", "unit_price", "monthly_revenue"),
}


def _effective_fields(idea: dict[str, Any]) -> dict[str, Any]:
    fields = dict(idea.get("fields", {}))
    site = idea.get("context", {}).get("plannedBusinessLocation", {})
    if site.get("source") in {"profile", "confirmed_by_user"} and site.get("evidence"):
        fields["location"] = {"state": "answered", "evidence": site["evidence"]}
    return fields


def followups(idea: dict[str, Any]) -> list[dict[str, Any]]:
    fields = _effective_fields(idea)
    missing = [key for key in FIELDS if fields.get(key, {}).get("state") != "answered"]
    # High-impact omissions first; each question remains tied to one canonical field.
    priority = {key: i for i, key in enumerate(("offering", "customers", "location", "funding", "unit_price", "monthly_revenue", "market_research", "competition", "suppliers", "raw_materials"))}
    questions = []
    if not any(fields.get(key, {}).get("state") == "answered" for key in ("skills", "experience")):
        questions.append({"field": "experience", "questionEn":
                          "What relevant training or work experience do you have, and what have you already tested, sold, saved, or started for this idea?",
                          "reason": "readiness_not_assessed"})
    questions.extend({"field": key, "questionEn": QUESTIONS[key], "reason": fields.get(key, {}).get("state", "not_asked")}
                     for key in sorted(missing, key=lambda item: priority[item]))
    return questions[:5]


def summary_plan(idea: dict[str, Any]) -> dict[str, Any]:
    by_id = {segment["segId"]: segment["textEn"] for segment in idea["segments"]}
    fields = _effective_fields(idea)
    sections = []
    for title, keys in SECTIONS.items():
        citations = [seg for key in keys if fields.get(key, {}).get("state") == "answered"
                     for seg in fields[key]["evidence"] if seg in by_id]
        sections.append({"heading": title, "textEn": " ".join(by_id[seg] for seg in citations) if citations else "To confirm with the entrepreneur.",
                         "evidence": citations})
    return {"status": "draft_for_confirmation", "language": "en", "sections": sections,
            "missingFields": [key for key in FIELDS if fields.get(key, {}).get("state") != "answered"]}


def feedback_draft(result: dict[str, Any]) -> dict[str, Any]:
    if result.get("potential") is None:
        return {"status": "draft", "textEn": "We need more information before assessing this idea. Please answer the follow-up questions.",
                "evidence": []}
    domains = [domain for domain in result["domains"] if domain["score"] is not None]
    best = max(domains, key=lambda item: item["score"])
    gap = min(domains, key=lambda item: item["score"])
    return {"status": "draft", "textEn": f"A strength is {best['key'].replace('_', ' ')}. A point to validate is {gap['key'].replace('_', ' ')}. Suggested next step: {result['pathway']}.",
            "evidence": list(dict.fromkeys(best["evidence"] + gap["evidence"]))}
