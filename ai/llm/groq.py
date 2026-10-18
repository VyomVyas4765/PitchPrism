"""Schema-validated JSON generation with Groq's hosted API (D-34), a drop-in for LocalJsonAdapter.

Same contract as the local adapter: complete_json(prompt, schema) returns an object that has passed the JSON
Schema, or raises. Prompts are checked for phone numbers, emails and ID numbers before anything leaves the
machine (D-13), so only redacted pitch text reaches the provider. The API key never appears in logs or errors.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import re
import logging
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from jsonschema import Draft202012Validator, ValidationError

from ai.config import PolicyViolation
from ai.ingest.pii import ensure_redacted
from ai.llm.adapter import ModelOutputError
from ai.providers import CapabilityUnavailable

logger = logging.getLogger(__name__)
API_URL = "https://api.groq.com/openai/v1/chat/completions"
SYSTEM = "You are a careful assistant for a business-idea screening tool. Reply with one JSON object that matches the given schema, and nothing else."


class RateLimited(RuntimeError):
    """Groq asked us to slow down (HTTP 429) or was briefly unavailable: retry later, not a broken result."""
    retryable = True  # the job queue requeues with backoff (ai/jobqueue.py)


def _seconds(value: str | None) -> float | None:
    """Groq's reset headers look like "22.89s", "1m3.2s" or "450ms"; retry-after is plain seconds."""
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        pass
    total, number = 0.0, ""
    for part in re.findall(r"([\d.]+)(ms|h|m|s)", value):
        number, unit = part
        total += float(number) * {"ms": 0.001, "s": 1, "m": 60, "h": 3600}[unit]
    return total if number else None


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise PolicyViolation("Redirects are disabled for AI calls.")


@dataclass(frozen=True)
class GroqSettings:
    api_key: str
    model: str = "openai/gpt-oss-120b"
    timeout_seconds: int = 60
    max_tokens: int = 2048
    reasoning_effort: str = "low"

    def __post_init__(self):
        if not self.api_key.startswith("gsk_") or len(self.api_key) < 20:
            raise PolicyViolation("GROQ_API_KEY is missing or not a Groq key.")
        if not 1 <= self.timeout_seconds <= 300 or not 64 <= self.max_tokens <= 32768:
            raise PolicyViolation("Invalid Groq request limits.")

    def __repr__(self):  # never print the key
        return f"GroqSettings(model={self.model!r})"


class GroqJsonAdapter:
    provider = "groq"

    def __init__(self, settings: GroqSettings):
        self.settings = settings
        self._http = build_opener(ProxyHandler(), _NoRedirects())
        self.last_metrics: dict = {}
        # Groq's per-minute token budget (free tier: 8,000 tokens a minute for gpt-oss-120b), from its response headers.
        self._remaining_tokens: float | None = None
        self._tokens_reset_at = 0.0

    def complete_json(self, prompt: str, schema: dict, temperature=0.1) -> dict:
        Draft202012Validator.check_schema(schema)
        ensure_redacted(prompt)  # D-13: nothing personal leaves the machine
        body = {
            "model": self.settings.model, "temperature": temperature, "max_completion_tokens": self.settings.max_tokens,
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
            "response_format": {"type": "json_schema", "json_schema": {"name": "result", "schema": schema}},
        }
        if self.settings.model.startswith("openai/gpt-oss"):
            body["reasoning_effort"] = self.settings.reasoning_effort
        started = time.monotonic()
        # One extra try when the model's JSON misses the schema (an extra evidence ID, say): that is ordinary
        # sampling variance, not a missing capability. Rate limits get their own, separate retries.
        # Rough size of this call against the minute budget: prompt characters / 3, plus part of the output allowance.
        needed = len(prompt) / 3 + min(self.settings.max_tokens, 1500)
        for output_try in range(2):
            for attempt in range(6):
                self._wait_for_budget(needed)
                try:
                    response = self._post(body)
                    break
                except RateLimited as error:
                    if attempt == 5:
                        raise
                    # Wait as long as Groq asks (its token budget refills within a minute), not a fixed short pause.
                    time.sleep(min(65.0, max(getattr(error, "wait", 0.0), 2.0 * (attempt + 1))))
            try:
                choice = response["choices"][0]
                if choice.get("finish_reason") == "length":
                    raise ModelOutputError("The model ran out of output tokens.")
                result = json.loads(choice["message"]["content"])
                if not isinstance(result, dict):
                    raise ModelOutputError("Expected a JSON object.")
                Draft202012Validator(schema).validate(result)
                break
            except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValidationError) as error:
                if output_try == 0:
                    logger.warning("groq_output_retry %s", type(error).__name__)
                    continue
                raise ModelOutputError("Groq output failed JSON/schema validation.") from error
        usage = response.get("usage") or {}
        self.last_metrics = {"provider": "groq", "model": self.settings.model, "duration_ms": round((time.monotonic() - started) * 1000),
                             "input_tokens": usage.get("prompt_tokens"), "output_tokens": usage.get("completion_tokens")}
        logger.info("groq_call %s", json.dumps(self.last_metrics))
        return result

    def _wait_for_budget(self, needed: float) -> None:
        """Pause before a call that would not fit in what is left of this minute's token budget."""
        if self._remaining_tokens is None or self._remaining_tokens >= needed:
            return
        pause = self._tokens_reset_at - time.monotonic()
        if pause > 0:
            logger.info("groq_budget_wait %.1fs", min(pause, 65.0))
            time.sleep(min(pause, 65.0))
        self._remaining_tokens = None

    def _note_limits(self, headers) -> None:
        remaining, reset = headers.get("x-ratelimit-remaining-tokens"), _seconds(headers.get("x-ratelimit-reset-tokens"))
        try:
            self._remaining_tokens = float(remaining) if remaining is not None else None
        except ValueError:
            self._remaining_tokens = None
        self._tokens_reset_at = time.monotonic() + (reset or 0.0)

    def _post(self, body: dict) -> dict:
        request = Request(API_URL, data=json.dumps(body).encode(), method="POST",
                          headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.settings.api_key}",
                                   "User-Agent": "pitchprism-worker"})
        try:
            with self._http.open(request, timeout=self.settings.timeout_seconds) as response:
                content = response.read(4 * 1024**2 + 1)
                self._note_limits(getattr(response, "headers", None) or {})
        except HTTPError as error:
            if error.code in (429, 500, 502, 503, 504):
                limited = RateLimited(f"Groq is busy (HTTP {error.code}); try again shortly.")
                headers = error.headers or {}
                waits = [_seconds(headers.get("retry-after")), _seconds(headers.get("x-ratelimit-reset-tokens")),
                         _seconds(headers.get("x-ratelimit-reset-requests")) if error.code == 429 and headers.get("x-ratelimit-remaining-requests") == "0" else None]
                limited.wait = max([value for value in waits if value is not None] or [2.0])
                raise limited from None
            if error.code in (401, 403):
                raise CapabilityUnavailable("Groq rejected the API key; check GROQ_API_KEY.") from None
            if error.code == 400:
                # A request Groq could not satisfy, for example output that did not fit the schema.
                raise ModelOutputError("Groq could not produce a valid structured answer.") from None
            raise CapabilityUnavailable(f"Groq request failed (HTTP {error.code}).") from None
        except (URLError, TimeoutError, OSError) as error:
            raise RateLimited("Groq could not be reached; try again shortly.") from error
        if len(content) > 4 * 1024**2:
            raise ModelOutputError("Groq response exceeded the size limit.")
        try:
            result = json.loads(content)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ModelOutputError("Groq returned invalid JSON.") from error
        if not isinstance(result, dict):
            raise ModelOutputError("Groq returned an invalid response.")
        return result
