"""EDP arithmetic with written value, expected value, formula and source anchor."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any


def _number(values: dict[str, Any], key: str) -> Decimal | None:
    item = values.get(key)
    if not isinstance(item, dict) or item.get("value") is None:
        return None
    try:
        result = Decimal(str(item["value"]))
        if not result.is_finite() or result < 0:
            return None
        return result
    except (InvalidOperation, ValueError, TypeError):
        return None


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def check_finances(values: dict[str, Any], valid_evidence: set[str]) -> list[dict[str, Any]]:
    """Only compare supplied numbers. Never infer missing inputs as zero."""
    findings: list[dict[str, Any]] = []

    def compare(target: str, expected: Decimal | None, formula: str, inputs: tuple[str, ...]):
        written = _number(values, target)
        if written is None or expected is None:
            return
        evidence = [values[key].get("segId") for key in (*inputs, target) if isinstance(values.get(key), dict)]
        if any(seg not in valid_evidence for seg in evidence):
            raise ValueError("Financial check cites an unknown segment.")
        if abs(written - expected) > Decimal("0.01"):
            findings.append({"key": "financial_mismatch", "field": target, "written": _money(written),
                             "expected": _money(expected), "formula": formula,
                             "evidence": evidence + [f"check:{target}"]})

    investment, own, loan = (_number(values, key) for key in ("investment", "self", "loan"))
    if investment is not None and own is not None and loan is not None:
        compare("investment", own + loan, "investment = self + loan", ("self", "loan"))
    price, volume = (_number(values, key) for key in ("unit_price", "monthly_volume"))
    if price is not None and volume is not None:
        compare("monthly_revenue", price * volume, "monthly_revenue = unit_price × monthly_volume", ("unit_price", "monthly_volume"))

    def formula(target: str, keys: tuple[str, ...], expression: str, fn):
        operands = [_number(values, key) for key in keys]
        if all(value is not None for value in operands):
            compare(target, fn(*operands), expression, keys)

    formula("C", ("A", "B"), "C = A − B", lambda a, b: a - b)
    formula("D", ("C",), "D = C", lambda c: c)
    formula("G", ("E", "F"), "G = E + F", lambda e, f: e + f)
    formula("H", ("G",), "H = G / 30", lambda g: g / 30)
    formula("I", ("E",), "I = E × 6", lambda e: e * 6)
    formula("L", ("J", "K"), "L = J + K", lambda j, k: j + k)
    formula("M", ("L",), "M = L / 30", lambda l: l / 30)
    formula("N", ("D", "I", "J"), "N = min(₹1,00,000 − D − I, J × 5)", lambda d, i, j: min(Decimal(100000) - d - i, j * 5))
    # Annexure totals are compared when the extractor supplies the sum as a cited number.
    formula("A", ("annexure_a_total",), "A = Annexure A total", lambda a: a)
    formula("E_six_months", ("E",), "Six-month fixed cost = E × 6", lambda e: e * 6)
    formula("J_five_months", ("J",), "Five-month fixed cost = J × 5", lambda j: j * 5)
    return findings
