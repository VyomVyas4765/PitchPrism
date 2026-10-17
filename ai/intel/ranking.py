"""Version-isolated comparison math. Callers must pass only authorised centre/cohort rows."""
from typing import Any


def rank_snapshot(rows: list[dict[str, Any]], rubric_version: str, scope_key: str, scope_id: str) -> dict[str, Any]:
    if scope_key not in {"cohortId", "tradeKey"}:
        raise ValueError("Unsupported rank scope.")
    members = [row for row in rows if row.get("rubricVersion") == rubric_version and row.get(scope_key) == scope_id
               and isinstance(row.get("potential"), int) and 0 <= row["potential"] <= 100]
    members.sort(key=lambda row: (-row["potential"], row["submissionId"]))
    entries = []
    last_score = None
    rank = 0
    for position, row in enumerate(members, 1):
        if row["potential"] != last_score:
            rank = position
            last_score = row["potential"]
        entries.append({"submissionId": row["submissionId"], "rank": rank, "of": len(members),
                        "percentile": round(100 * (len(members) - rank) / (len(members) - 1)) if len(members) > 1 else 100,
                        "potential": row["potential"]})
    return {"rubricVersion": rubric_version, "scope": scope_key, "scopeId": scope_id, "entries": entries}
