"""A deterministic stand-in for the local model in pitch-review tests (synthetic text only).

It answers the review's three prompt kinds by their JSON schema: extraction by keywords, judging by vague words,
and questions from a template. It also proves every prompt it receives is redacted.
"""
import re

from ai.ingest.pii import find_pii

KEYWORDS = {
    "offering": ["stitch", "start a", "sell"], "customers": ["customers", "families"], "location": ["district"],
    "market_research": ["asked", "visited the market", "survey"], "raw_materials": ["need cloth", "materials", "machines"],
    "suppliers": ["buy cloth", "wholesale", "supplier"], "competition": ["other tailors", "competitor"],
    "funding": ["to start", "loan", "savings"], "unit_price": ["charge", "price"], "monthly_revenue": ["monthly sales", "per month"],
    "skills": ["learnt", "training"], "experience": ["worked", "years in"],
}
AMOUNTS = {
    "investment": r"need Rs\.? ?([\d,]+) to start", "self": r"Rs\.? ?([\d,]+) from my savings", "loan": r"loan of Rs\.? ?([\d,]+)",
    "unit_price": r"charge Rs\.? ?([\d,]+)", "monthly_volume": r"stitch (\d+) \w+ a month", "monthly_revenue": r"monthly sales of Rs\.? ?([\d,]+)",
}
VAGUE = re.compile(r"\b(some|maybe|many|few|somewhere)\b", re.IGNORECASE)

COMPLETE_PITCH = """I want to start a tailoring shop that stitches blouses, school uniforms and kurtis.
My customers are women and schools in Sinnar town, about 400 families and 3 schools nearby.
The shop will be in Sinnar town, Nashik district, Maharashtra.
I asked 30 women in my area and visited the market; most said they wait two weeks for a tailor.
I need cloth, thread, buttons and two sewing machines.
I will buy cloth and thread from wholesale shops in Nashik city.
There are two other tailors nearby but they are always busy and do not make school uniforms.
I need Rs. 60000 to start: Rs 20000 from my savings and a loan of Rs 40000.
I will charge Rs 250 for a blouse.
I expect to stitch 120 blouses a month, so monthly sales of Rs 30000.
I learnt tailoring at a training centre and worked 3 years in a boutique."""

# What a fully prepared entrepreneur would answer for each topic.
FACTS = {
    "customers": "My customers are women and schools in Sinnar town, about 400 families and 3 schools nearby.",
    "location": "The shop will be in Sinnar town, Nashik district, Maharashtra.",
    "market_research": "I asked 30 women in my area and visited the market; most wait two weeks for a tailor.",
    "raw_materials": "I need cloth, thread, buttons and two sewing machines.",
    "suppliers": "I will buy cloth and thread from wholesale shops in Nashik city.",
    "competition": "There are two other tailors nearby but they do not make school uniforms.",
    "funding": "I need Rs 60000 to start: Rs 20000 from my savings and a loan of Rs 40000.",
    "unit_price": "I will charge Rs 250 for a blouse.",
    "monthly_revenue": "I expect to stitch 120 blouses a month, so monthly sales of Rs 30000.",
    "offering": "I want to start a tailoring shop that stitches blouses and school uniforms.",
}


class FakeLLM:
    def __init__(self, fail: dict[str, int] | None = None):
        self.prompts: list[str] = []
        self.fail = dict(fail or {})  # step kind -> number of malformed responses to give first

    def __call__(self, prompt, schema):
        assert not find_pii(prompt), "a prompt reached the model unredacted"
        self.prompts.append(prompt)
        kind = next(key for key in ("fields", "verdicts", "questions") if key in schema["properties"])
        if self.fail.get(kind, 0) > 0:
            self.fail[kind] -= 1
            from ai.llm.adapter import ModelOutputError
            raise ModelOutputError("synthetic malformed output")
        return {"fields": self.extract, "verdicts": self.judge, "questions": self.ask}[kind](prompt, schema)

    @staticmethod
    def _lines(prompt):
        body = prompt[prompt.index("<<<PITCH") + 8:prompt.index("PITCH>>>")]
        return [(match.group(1), match.group(2)) for match in re.finditer(r"^\[(\S+)\] (.*)$", body, re.M)]

    def extract(self, prompt, schema):
        lines = self._lines(prompt)
        keys = schema["properties"]["fields"]["items"]["properties"]["key"]["enum"]
        fields = []
        for key in keys:
            hits = [seg for seg, text in lines if any(word in text.lower() for word in KEYWORDS[key])]
            value = next((text for seg, text in lines if seg in hits), "")
            fields.append({"key": key, "state": "answered" if hits else "missing", "evidence": hits[:4], "value": value[:200]})
        result = {"fields": fields}
        if "location" in schema["properties"]:
            place = {"village": "", "district": "", "state": "", "line": ""}
            for seg, text in lines:
                match = re.search(r"([A-Z]\w+) district, ([A-Z]\w+)", text)
                if match:
                    town = re.search(r"in ([A-Z]\w+) town", text)
                    place = {"village": town.group(1) if town else "", "district": match.group(1), "state": match.group(2), "line": seg}
            result["location"] = place
            result["businessType"] = "tailoring shop"
        if "numbers" in schema["properties"]:
            numbers = []
            for key, pattern in AMOUNTS.items():
                for seg, text in lines:
                    match = re.search(pattern, text)
                    if match:
                        numbers.append({"key": key, "value": float(match.group(1).replace(",", "")), "line": seg})
                        break
            result["numbers"] = numbers
        return result

    def judge(self, prompt, schema):
        keys = schema["properties"]["verdicts"]["items"]["properties"]["key"]["enum"]
        said = dict(re.findall(r"^- (\w+) \(.*?\n  Must: .*?\n  The pitch says: <<<(.*?)>>>", prompt, re.M | re.S))
        return {"verdicts": [{"key": key, "verdict": "vague" if VAGUE.search(said.get(key, "")) else "sufficient",
                              "missing": "Be more specific." if VAGUE.search(said.get(key, "")) else ""} for key in keys]}

    def ask(self, prompt, schema):
        keys = schema["properties"]["questions"]["items"]["properties"]["key"]["enum"]
        return {"questions": [{"key": key, "question": f"Could you tell us more about your {key.replace('_', ' ')}?"} for key in keys]}
