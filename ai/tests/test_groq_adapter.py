"""The Groq adapter (D-34): schema-checked JSON, redaction before sending, retries on rate limits. No network: HTTP is faked."""
import io
import json
import os
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from ai.config import PolicyViolation
from ai.llm import factory
from ai.llm.adapter import ModelOutputError
from ai.llm.groq import GroqJsonAdapter, GroqSettings, RateLimited
from ai.providers import CapabilityUnavailable

KEY = "gsk_" + "x" * 40
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["answer"], "properties": {"answer": {"type": "string"}}}


def reply(content, finish="stop"):
    return {"choices": [{"message": {"content": content}, "finish_reason": finish}], "usage": {"prompt_tokens": 10, "completion_tokens": 5}}


def http_error(code, retry_after=None):
    headers = {"retry-after": retry_after} if retry_after else {}
    return HTTPError("https://api.groq.com", code, "error", headers, io.BytesIO(b"{}"))


class GroqAdapterTests(unittest.TestCase):
    def setUp(self):
        self.adapter = GroqJsonAdapter(GroqSettings(api_key=KEY))

    def test_returns_schema_valid_json_and_sends_the_schema(self):
        with patch.object(self.adapter, "_post", return_value=reply('{"answer": "yes"}')) as post:
            self.assertEqual(self.adapter.complete_json("Is tea popular?", SCHEMA), {"answer": "yes"})
        body = post.call_args.args[0]
        self.assertEqual(body["model"], "openai/gpt-oss-120b")
        self.assertEqual(body["response_format"]["json_schema"]["schema"], SCHEMA)
        self.assertEqual(body["reasoning_effort"], "low")
        self.assertEqual(self.adapter.last_metrics["provider"], "groq")

    def test_refuses_unredacted_prompts_before_any_request(self):
        with patch.object(self.adapter, "_post") as post:
            with self.assertRaises(PolicyViolation):
                self.adapter.complete_json("Call me on 9876543210", SCHEMA)
        post.assert_not_called()

    def test_bad_or_truncated_output_is_a_model_error(self):
        for response in (reply('{"other": 1}'), reply("not json"), reply('{"answer": "x"}', finish="length")):
            with patch.object(self.adapter, "_post", return_value=response):
                with self.assertRaises(ModelOutputError):
                    self.adapter.complete_json("Question", SCHEMA)

    def test_rate_limits_are_retried_then_reported_as_retryable(self):
        with patch.object(self.adapter._http, "open", side_effect=[http_error(429, "0"), _Response(reply('{"answer": "ok"}'))]), \
                patch("ai.llm.groq.time.sleep") as sleep:
            self.assertEqual(self.adapter.complete_json("Question", SCHEMA), {"answer": "ok"})
        sleep.assert_called_once_with(2.0)  # never a zero-second retry: at least a short backoff
        # Groq's minute budget refills slowly on the free tier, so it is retried six times before the job gives up.
        with patch.object(self.adapter._http, "open", side_effect=[http_error(429)] * 6), patch("ai.llm.groq.time.sleep"):
            with self.assertRaises(RateLimited) as caught:
                self.adapter.complete_json("Question", SCHEMA)
        self.assertTrue(caught.exception.retryable)

    def test_a_rejected_key_is_unavailable_and_never_echoed(self):
        with patch.object(self.adapter._http, "open", side_effect=http_error(401)):
            with self.assertRaises(CapabilityUnavailable) as caught:
                self.adapter.complete_json("Question", SCHEMA)
        self.assertNotIn(KEY, str(caught.exception))
        self.assertNotIn(KEY, repr(self.adapter.settings))

    def test_settings_reject_a_missing_key(self):
        with self.assertRaises(PolicyViolation):
            GroqSettings(api_key="")


class _Response(io.BytesIO):
    def __init__(self, payload):
        super().__init__(json.dumps(payload).encode())

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FactoryTests(unittest.TestCase):
    def env(self, **values):
        clean = {key: "" for key in ("AI_RUNTIME", "GROQ_API_KEY", "LLM_MODEL", "AI_HOSTED_APIS_ENABLED", "GROQ_MODEL")}
        return patch.dict(os.environ, {**clean, **values})

    def test_groq_is_chosen_from_the_environment(self):
        with self.env(AI_RUNTIME="groq", GROQ_API_KEY=KEY, AI_HOSTED_APIS_ENABLED="true", GROQ_MODEL="openai/gpt-oss-20b"), \
                patch("ai.llm.factory.load_dotenv"):
            adapter = factory.make_adapter()
        self.assertIsInstance(adapter, GroqJsonAdapter)
        self.assertEqual(adapter.settings.model, "openai/gpt-oss-20b")

    def test_a_key_left_in_llm_model_still_works(self):
        with self.env(LLM_MODEL=KEY, AI_HOSTED_APIS_ENABLED="true"), patch("ai.llm.factory.load_dotenv"):
            self.assertEqual(factory.runtime(), "groq")
            self.assertIsInstance(factory.make_adapter(), GroqJsonAdapter)

    def test_hosted_calls_need_explicit_permission(self):
        with self.env(AI_RUNTIME="groq", GROQ_API_KEY=KEY, AI_HOSTED_APIS_ENABLED="false"), patch("ai.llm.factory.load_dotenv"):
            with self.assertRaises(PolicyViolation):
                factory.make_adapter()


if __name__ == "__main__":
    unittest.main()
