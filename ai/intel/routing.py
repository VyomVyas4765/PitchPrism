"""Consent-first routing suggestions. Source of truth remains Dev 1's live consent service."""
from typing import Any


def suggest_partners(idea: dict[str, Any], rules: list[dict[str, Any]], consents: list[dict[str, Any]]) -> list[dict[str, str]]:
    active = [item for item in consents if item.get("active") is True and item.get("partnerType") in {"sector_partner", "funding_partner"}]
    suggestions = []
    seen = set()
    for rule in rules:
        kind = rule.get("partnerType")
        org_id = rule.get("partnerOrgId")
        if not org_id or org_id in seen or rule.get("active") is not True:
            continue
        if not any(item["partnerType"] == kind and (not item.get("orgId") or item["orgId"] == org_id) for item in active):
            continue
        if rule.get("trades") and idea.get("tradeKey") not in rule["trades"]:
            continue
        if rule.get("sectors") and idea.get("sector") not in rule["sectors"]:
            continue
        if rule.get("districts") and idea.get("district") not in rule["districts"]:
            continue
        if kind == "funding_partner" and (idea.get("decision") != "shortlist" or idea.get("fundingReady") is not True):
            continue
        seen.add(org_id)
        suggestions.append({"partnerOrgId": str(org_id), "partnerType": kind,
                            "reason": "Matches the business trade/sector and planned district; entrepreneur permits this partner type."})
    return suggestions
