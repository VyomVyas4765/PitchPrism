"""Choose the JSON model adapter from the environment (D-34): AI_RUNTIME=groq (default when a Groq key is set) or local."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from ai.config import PolicyViolation, Settings


def _groq_key() -> str:
    key = os.getenv("GROQ_API_KEY", "").strip()
    # Accept a key placed in LLM_MODEL (the first .env layout) so an existing setup keeps working.
    legacy = os.getenv("LLM_MODEL", "").strip()
    return key or (legacy if legacy.startswith("gsk_") else "")


def runtime() -> str:
    load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
    value = os.getenv("AI_RUNTIME", "").strip().lower()
    return value or ("groq" if _groq_key() else "local")


def make_adapter():
    """A model adapter with complete_json(prompt, schema) and settings.model."""
    if runtime() == "groq":
        from ai.llm.groq import GroqJsonAdapter, GroqSettings
        if os.getenv("AI_HOSTED_APIS_ENABLED", "false").lower() not in ("true", "1"):
            raise PolicyViolation("Set AI_HOSTED_APIS_ENABLED=true to use the hosted Groq API (D-34).")
        return GroqJsonAdapter(GroqSettings(
            api_key=_groq_key(), model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip() or "openai/gpt-oss-120b",
            timeout_seconds=int(os.getenv("AI_REQUEST_TIMEOUT_SECONDS", "60")), max_tokens=int(os.getenv("GROQ_MAX_TOKENS", "2048"))))
    from ai.llm.adapter import LocalJsonAdapter
    return LocalJsonAdapter(Settings.from_env())
