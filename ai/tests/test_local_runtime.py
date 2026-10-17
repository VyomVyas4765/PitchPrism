import json
import os
import unittest
from unittest.mock import patch
from urllib.error import URLError

from ai.config import PolicyViolation, Settings
from ai.llm.adapter import LocalJsonAdapter, ModelOutputError, NoRedirects
from ai.providers import CapabilityUnavailable, ProviderRegistry, Task, TaskRequest

SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}
LOCAL = {"models": [{"name": "synthetic-local:latest", "size": 1000}]}


class LocalRuntimeTests(unittest.TestCase):
    def adapter(self):
        return LocalJsonAdapter(Settings(model="synthetic-local:latest"))

    def test_only_loopback_is_allowed(self):
        for address in ("https://api.example.test", "http://localhost:11434", "http://10.0.0.1:11434",
                        "http://127.0.0.1:11434/path", "http://user:secret@127.0.0.1:11434", "http://127.0.0.1:11434?target=remote"):
            with self.subTest(address=address), self.assertRaises(PolicyViolation):
                Settings(base_url=address)
        Settings(base_url="http://127.0.0.1:11434")
        Settings(base_url="http://[::1]:11434")

    @patch("ai.config.load_dotenv")
    def test_hosted_config_is_rejected(self, _dotenv):
        with patch.dict(os.environ, {"AI_HOSTED_APIS_ENABLED": "true"}, clear=True):
            with self.assertRaises(PolicyViolation):
                Settings.from_env()
        with patch.dict(os.environ, {"AI_RUNTIME": "hosted"}, clear=True):
            with self.assertRaises(PolicyViolation):
                Settings.from_env()

    def test_cloud_model_selectors_and_redirects_are_rejected(self):
        for model in ("example:cloud", "example-cloud", "https://provider/model"):
            with self.assertRaises(PolicyViolation):
                Settings(model=model)
        with self.assertRaises(PolicyViolation):
            NoRedirects().redirect_request(None, None, 302, "redirect", {}, "https://remote.example")

    def test_proxy_environment_is_not_used(self):
        with patch.dict(os.environ, {"HTTP_PROXY": "http://remote.example:3128"}):
            adapter = self.adapter()
        self.assertFalse(any(getattr(handler, "proxies", {}) for handler in adapter._http.handlers))

    def test_missing_or_oversized_models_do_not_trigger_generation(self):
        for response in ({"models": []}, {"models": [{"name": "synthetic-local:latest", "size": 4 * 1024**3}]}):
            adapter = self.adapter()
            with patch.object(adapter, "_request", return_value=response) as call:
                with self.assertRaises(CapabilityUnavailable):
                    adapter.complete_json("synthetic", SCHEMA)
                self.assertEqual(call.call_count, 1)
        adapter = LocalJsonAdapter(Settings())
        with patch.object(adapter, "_request") as call:
            with self.assertRaises(CapabilityUnavailable):
                adapter.complete_json("synthetic", SCHEMA)
            call.assert_not_called()

    def test_cloud_backed_metadata_is_rejected(self):
        adapter = self.adapter()
        with patch.object(adapter, "_request", return_value={"models": [{"name": "synthetic-local:latest", "size": 1000, "remote_host": "https://cloud.example"}]}):
            with self.assertRaises(PolicyViolation):
                adapter.complete_json("synthetic", SCHEMA)

    def test_schema_validated_local_response_and_metrics(self):
        adapter = self.adapter()
        response = {"response": '{"ok":true}', "done": True, "eval_count": 4, "prompt_eval_count": 8}
        with patch.object(adapter, "_request", side_effect=[LOCAL, response]) as call:
            self.assertEqual(adapter.complete_json("synthetic", SCHEMA), {"ok": True})
            body = call.call_args_list[1].args[1]
            self.assertEqual(body["format"], SCHEMA)
            self.assertFalse(body["stream"])
            self.assertEqual(body["keep_alive"], 0)
        self.assertEqual(adapter.last_metrics["api_cost_inr"], 0)
        self.assertNotIn("prompt", adapter.last_metrics)

    def test_bad_or_truncated_outputs_are_not_assessments(self):
        for response in ({"response": '{"ok":"wrong"}', "done": True}, {"response": 'not json', "done": True},
                         {"response": '{}', "done": False}, {"response": '{"ok":true}', "done": True, "done_reason": "length"}):
            adapter = self.adapter()
            with patch.object(adapter, "_request", side_effect=[LOCAL, response]):
                with self.assertRaises(ModelOutputError):
                    adapter.complete_json("synthetic", SCHEMA)

    def test_unavailable_runtime_does_not_fall_back(self):
        adapter = self.adapter()
        with patch.object(adapter._http, "open", side_effect=URLError("unreachable")) as call:
            with self.assertRaises(CapabilityUnavailable):
                adapter.installed_models()
            self.assertEqual(call.call_count, 1)

    def test_every_missing_task_has_an_explicit_unavailable_result(self):
        registry = ProviderRegistry()
        for task in Task:
            with self.subTest(task=task), self.assertRaises(CapabilityUnavailable):
                registry.execute(TaskRequest(task=task, payload={}, language="en", submission_id="synthetic"))


if __name__ == "__main__":
    unittest.main()
