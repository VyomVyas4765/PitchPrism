"""Deterministic, evidence-checked EDP screening. No personal data belongs here."""
from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Callable

from ai.ingest.pii import find_pii
from ai.llm.adapter import LocalJsonAdapter

FIELDS = (
    "location", "offering", "customers", "market_research", "raw_materials",
    "suppliers", "funding", "competition", "unit_price", "monthly_revenue",
)
COMPLETENESS_WEIGHTS = {
    "location": 12, "offering": 15, "customers": 15, "market_research": 10,
    "raw_materials": 4, "suppliers": 4, "funding": 12, "competition": 6,
    "unit_price": 12, "monthly_revenue": 10,
}
DOMAINS = {
    "clarity": (10, ("offering", "customers")),
    "customer_need": (15, ("customers",)),
    "market_potential": (15, ("market_research",)),
    "feasibility": (15, ("location", "raw_materials", "suppliers", "funding")),
    "competition_awareness": (10, ("competition",)),
    "differentiation": (10, ("offering", "competition")),
    "financial_logic": (15, ("funding", "unit_price", "monthly_revenue")),
    "entrepreneur_readiness": (10, ("skills", "experience")),
}
# Pathway thresholds when the rubric does not set them (packages/contracts rubric.json PathwayRules).
PATHWAY_DEFAULTS = {
    "requestInfoBelowCompleteness": 70, "highCompleteness": 70, "fundingMinFeasibility": 4, "fundingMaxLoan": 200000,
    "skillingMaxReadiness": 2, "mentoringWeakAtOrBelow": 2,
    "mentoringWeakDomains": ["market_potential", "competition_awareness", "financial_logic"],
}
BAND_DEFAULTS = {"strong": 70, "promising": 50, "minCoverage": 60}
RUBRIC_VERSION = "edp-draft-v1"
PROMPT_VERSION = "edp-score-v1"


class InvalidEvidence(ValueError):
    pass


def _round(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _segments_for(field: dict[str, Any], valid: set[str]) -> list[str]:
    return [seg for seg in field.get("evidence", []) if seg in valid]


def prepare_input(idea: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], set[str]]:
    """Fail closed if an upstream extractor sends PII or broken citations."""
    if idea.get("template") != "edp-idea-brief":
        raise ValueError("Only the EDP Idea Brief is supported by this scoring entry point.")
    segments = idea.get("segments", [])
    ids = [item.get("segId") for item in segments]
    if not ids or any(not isinstance(value, str) or not value for value in ids) or len(ids) != len(set(ids)):
        raise InvalidEvidence("Segment IDs must be unique and nonempty.")
    for segment in segments:
        for text in (segment.get("textEn", ""), segment.get("textOriginal", "")):
            # Shared A-10 detector: spaced/international numbers, Indic digits, emails and ID numbers.
            if not isinstance(text, str) or find_pii(text):
                raise InvalidEvidence("Segments are not safely redacted for scoring.")
    valid = set(ids)
    active_ids = {segment["segId"] for segment in segments if not segment.get("struck", False)}
    for number in idea.get("financials", {}).values():
        if not isinstance(number, dict) or number.get("segId") not in valid:
            raise InvalidEvidence("Financial value cites an unknown segment.")
    fields = idea.get("fields", {})
    if set(fields) - set(FIELDS) - {"skills", "experience"}:
        raise ValueError("Unknown canonical field.")
    allowed_states = {"answered", "missing", "not_asked", "irrelevant", "unreadable"}
    flags: list[dict[str, Any]] = []
    usable: dict[str, dict[str, Any]] = {}
    for key in FIELDS + ("skills", "experience"):
        field = fields.get(key, {"state": "not_asked", "evidence": []})
        state = field.get("state")
        if state not in allowed_states:
            raise ValueError("Invalid field state.")
        citations = field.get("evidence", [])
        if not isinstance(citations, list) or any(c not in valid for c in citations):
            raise InvalidEvidence("Canonical field cites an unknown segment.")
        if state == "answered" and (not citations or not set(citations) <= active_ids):
            raise InvalidEvidence("Answered fields require source evidence.")
        if state == "answered":
            usable[key] = {"state": state, "evidence": citations}
        elif key in FIELDS:
            flags.append({"key": state, "field": key, "evidence": citations,
                          "severity": "warn" if state in {"irrelevant", "unreadable"} else "info"})
    site = idea.get("context", {}).get("plannedBusinessLocation", {})
    if site.get("source") in {"profile", "confirmed_by_user"}:
        citations = site.get("evidence", [])
        if not citations or not set(citations) <= active_ids:
            raise InvalidEvidence("Confirmed business location needs a cited profile segment.")
        flags = [flag for flag in flags if flag["field"] != "location"]
        if "location" in usable and set(usable["location"]["evidence"]) != set(citations):
            flags.append({"key": "location_source_override", "field": "location", "evidence": citations,
                          "severity": "info"})
        usable["location"] = {"state": "answered", "evidence": citations}
    return usable, {"flags": flags, "segments": segments}, valid


def quality(idea: dict[str, Any]) -> dict[str, Any]:
    usable, meta, _ = prepare_input(idea)
    weights = idea.get("rubric", {}).get("completenessWeights", COMPLETENESS_WEIGHTS)
    if set(weights) != set(FIELDS) or any(not isinstance(v, int) or v < 0 for v in weights.values()) or sum(weights.values()) != 100:
        raise ValueError("Completeness weights must cover ten fields and sum to 100.")
    complete = sum(weights[key] for key in FIELDS if key in usable)
    unavailable = len([key for key in FIELDS if key not in usable])
    return {"completeness": complete, "unassessable": unavailable > 5, "flags": meta["flags"]}


def _score_schema(keys: list[str]) -> dict[str, Any]:
    return {"type": "object", "additionalProperties": False, "required": ["domains"], "properties": {
        "domains": {"type": "array", "minItems": len(keys), "maxItems": len(keys), "items": {
            "type": "object", "additionalProperties": False,
            "required": ["key", "score", "reason", "evidence", "confidence"],
            "properties": {"key": {"type": "string", "enum": keys}, "score": {"type": "integer", "minimum": 1, "maximum": 5},
                           "reason": {"type": "string", "minLength": 1, "maxLength": 500},
                           "evidence": {"type": "array", "minItems": 1, "maxItems": 3, "items": {"type": "string"}},
                           "confidence": {"type": "string", "enum": ["high", "medium", "low"]}},
        }},
    }}


def rubric_settings(idea: dict[str, Any]) -> tuple[dict[str, tuple[int | float, tuple[str, ...]]], dict[str, Any], dict[str, Any]]:
    """Domains (weight, evidence fields), bands and pathway rules from a published rubric (W-02), else the defaults.

    The API passes the job's rubric version as idea["rubric"]; a domain without evidence fields keeps the default
    mapping for its key."""
    rubric = idea.get("rubric", {})
    domains = DOMAINS
    if rubric.get("domains"):
        domains = {d["key"]: (d["weight"], tuple(d.get("evidenceFields") or DOMAINS.get(d["key"], (0, ()))[1])) for d in rubric["domains"]}
        if abs(sum(weight for weight, _ in domains.values()) - 100) > 1e-6:
            raise ValueError("Rubric domain weights must sum to 100.")
    return domains, {**BAND_DEFAULTS, **rubric.get("bands", {})}, {**PATHWAY_DEFAULTS, **rubric.get("pathwayRules", {})}


def evaluate(idea: dict[str, Any], adapter: LocalJsonAdapter | None = None,
             scorer: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None) -> dict[str, Any]:
    usable, meta, valid = prepare_input(idea)
    domain_map, bands, rules = rubric_settings(idea)
    q = quality(idea)
    base = {"rubricVersion": idea.get("rubric", {}).get("version", RUBRIC_VERSION),
            "promptVersion": PROMPT_VERSION, "completeness": q["completeness"], "flags": q["flags"],
            "domains": [], "potential": None, "coverage": 0, "band": "Unassessable" if q["unassessable"] else "Pending",
            "pathway": "Resubmit with help" if q["unassessable"] else "Pending", "quadrant": None,
            "needsAttention": False}
    if q["unassessable"]:
        return base
    score_keys = [key for key, (_, fields) in domain_map.items() if any(field in usable for field in fields)]
    if not score_keys:
        return base
    if scorer is None:
        if adapter is None:
            raise ValueError("A local scoring adapter is required.")
        scorer = lambda prompt, schema: adapter.complete_json(prompt, schema)
    allowed_by_domain = {key: set(sum((_segments_for(usable[field], valid) for field in domain_map[key][1] if field in usable), [])) for key in score_keys}
    # Only cited, redacted source text is included. No name, phone, gender, address, GPS or social category.
    source = {key: [{"segId": seg["segId"], "text": seg["textEn"]} for seg in meta["segments"]
                    if seg["segId"] in allowed_by_domain[key]] for key in score_keys}
    prompt = ("Score the listed EDP domains 1-5 using ONLY this cited evidence. Do not score grammar, language, "
              "handwriting, template or pitch length. Return each listed key exactly once, with a concise reason and "
              "1-3 matching segment IDs. If evidence is weak score low; if absent the domain is omitted. "
              + json.dumps({"domains": score_keys, "evidence": source}, ensure_ascii=False))
    runs = []
    for _ in range(2):
        result = scorer(prompt, _score_schema(score_keys))
        domains = result.get("domains", [])
        if len(domains) != len(score_keys) or {d.get("key") for d in domains} != set(score_keys):
            raise InvalidEvidence("Scorer omitted or duplicated a domain.")
        for item in domains:
            key = item["key"]
            if not isinstance(item.get("score"), int) or not 1 <= item["score"] <= 5:
                raise InvalidEvidence("Invalid domain score.")
            if not item.get("evidence") or len(item["evidence"]) > 3 or not set(item["evidence"]) <= allowed_by_domain[key]:
                raise InvalidEvidence("Domain score has unsupported evidence.")
            if item.get("confidence") not in {"high", "medium", "low"} or not item.get("reason"):
                raise InvalidEvidence("Domain judgement is incomplete.")
        runs.append({item["key"]: item for item in domains})
    domains = []
    for key, (weight, _) in domain_map.items():
        if key not in score_keys:
            domains.append({"key": key, "weight": weight, "score": None, "runs": [], "reason": "Not assessed: no cited evidence", "evidence": [], "confidence": "none"})
            continue
        first, second = runs[0][key], runs[1][key]
        score = _round(Decimal(first["score"] + second["score"]) / 2)
        confidence = "low" if "low" in (first["confidence"], second["confidence"]) or abs(first["score"] - second["score"]) > 1 else first["confidence"]
        domains.append({"key": key, "weight": weight, "score": score, "runs": [first["score"], second["score"]],
                        "reason": first["reason"], "evidence": first["evidence"], "confidence": confidence})
    assessed = [domain for domain in domains if domain["score"] is not None]
    covered_weight = sum(domain["weight"] for domain in assessed)
    potential = _round(Decimal(100) * sum(Decimal(d["weight"] * d["score"]) for d in assessed) / Decimal(5 * covered_weight))
    band = ("Insufficient information" if covered_weight < bands["minCoverage"] else "Strong" if potential >= bands["strong"]
            else "Promising" if potential >= bands["promising"] else "Not yet")
    quadrant = ("high" if potential >= bands["promising"] else "low") + "_potential_" + ("high" if q["completeness"] >= rules["highCompleteness"] else "low") + "_completeness"
    by_key = {domain["key"]: domain["score"] for domain in domains}
    loan = idea.get("financials", {}).get("loan", {}).get("value")
    if covered_weight < bands["minCoverage"] or q["completeness"] < rules["requestInfoBelowCompleteness"]:
        pathway = "Request information"
    elif (band == "Strong" and (by_key.get("feasibility") or 0) >= rules["fundingMinFeasibility"] and isinstance(loan, (int, float))
          and 0 <= loan <= rules["fundingMaxLoan"]):
        pathway = "Funding consideration"
    elif by_key.get("entrepreneur_readiness") is not None and by_key["entrepreneur_readiness"] <= rules["skillingMaxReadiness"]:
        pathway = "Skilling"
    elif band == "Promising" and any(by_key.get(key) is not None and by_key[key] <= rules["mentoringWeakAtOrBelow"] for key in rules["mentoringWeakDomains"]):
        pathway = "Mentoring"
    else:
        pathway = "Deeper evaluation" if band in {"Strong", "Promising"} else "Mentoring"
    base.update({"domains": domains, "potential": potential, "coverage": covered_weight, "band": band,
                 "pathway": pathway, "quadrant": quadrant,
                 "needsAttention": any(d["confidence"] == "low" for d in assessed),
                 "model": adapter.settings.model if adapter else "injected-test-scorer"})
    return base
