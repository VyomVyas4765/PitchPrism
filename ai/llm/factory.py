"""The JSON model adapter (D-34): Groq's hosted API only. No local Ollama model is used, even as a fallback.

A missing key or AI_HOSTED_APIS_ENABLED other than true fails the stage visibly (PolicyViolation); nothing falls back
to another model and no score is invented.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from ai.config import PolicyViolation


def _groq_key() -> str:
    load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
    key = os.getenv("GROQ_API_KEY", "").strip()
    # Accept a key placed in LLM_MODEL (the first .env layout) so an existing setup keeps working.
    legacy = os.getenv("LLM_MODEL", "").strip()
    return key or (legacy if legacy.startswith("gsk_") else "")


def runtime() -> str:
    return "groq"


def make_adapter():
    """A model adapter with complete_json(prompt, schema) and settings.model."""
    from ai.llm.groq import GroqJsonAdapter, GroqSettings
    load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)
    if os.getenv("AI_HOSTED_APIS_ENABLED", "false").lower() not in ("true", "1"):
        raise PolicyViolation("Set AI_HOSTED_APIS_ENABLED=true to use the hosted Groq API (D-34).")
    return GroqJsonAdapter(GroqSettings(
        api_key=_groq_key(), model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip() or "openai/gpt-oss-120b",
        timeout_seconds=int(os.getenv("AI_REQUEST_TIMEOUT_SECONDS", "60")), max_tokens=int(os.getenv("GROQ_MAX_TOKENS", "2048"))))
