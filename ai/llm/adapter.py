"""Schema-validated JSON generation using an already installed local Ollama model."""
import json
import logging
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from jsonschema import Draft202012Validator, ValidationError

from ai.config import PolicyViolation, Settings
from ai.providers import CapabilityUnavailable

logger = logging.getLogger(__name__)


class ModelOutputError(ValueError):
    pass


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise PolicyViolation("AI redirects are disabled; prompts must stay on the local worker.")


class LocalJsonAdapter:
    def __init__(self, settings: Settings):
        self.settings = settings
        # Never forward prompts via HTTP(S)_PROXY or follow local-to-cloud redirects.
        self._http = build_opener(ProxyHandler({}), NoRedirects())
        self.last_metrics: dict = {}

    def _request(self, path, body=None):
        request = Request(
            self.settings.base_url.rstrip("/") + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with self._http.open(request, timeout=self.settings.timeout_seconds) as response:
                # Bound malformed runtime responses; do not print raw errors/model output.
                content = response.read(4 * 1024**2 + 1)
                if len(content) > 4 * 1024**2:
                    raise ModelOutputError("Local runtime response exceeded the size limit.")
                result = json.loads(content)
                if not isinstance(result, dict):
                    raise ModelOutputError("Local runtime returned an invalid response.")
                return result
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            raise CapabilityUnavailable("Local AI runtime/model is unavailable. No download or hosted fallback was attempted.") from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ModelOutputError("Local runtime returned invalid JSON.") from error

    def installed_models(self):
        models = self._request("/api/tags").get("models", [])
        if not isinstance(models, list) or not all(isinstance(model, dict) and isinstance(model.get("name"), str) for model in models):
            raise ModelOutputError("Local model list is invalid.")
        return models

    def _check_model(self):
        if not self.settings.model:
            raise CapabilityUnavailable("Select an installed local model with LOCAL_LLM_MODEL; no default download is permitted.")
        metadata = next((model for model in self.installed_models() if model.get("name") == self.settings.model), None)
        if metadata is None:
            raise CapabilityUnavailable("Selected model is not installed locally. No download or hosted fallback was attempted.")
        if metadata.get("remote_host") or metadata.get("remote_model") or any(marker in str(metadata.get("name", "")).lower() for marker in (":cloud", "-cloud")):
            raise PolicyViolation("Cloud-backed Ollama models are disabled.")
        size = metadata.get("size", 0)
        if not isinstance(size, int) or size <= 0 or size > self.settings.max_model_bytes:
            raise CapabilityUnavailable("Local model is missing weights or exceeds the configured file-size budget. Peak RAM still requires benchmarking.")

    def complete_json(self, prompt: str, schema: dict, temperature=0.1):
        return self._generate(prompt, schema, temperature)

    def vision_json(self, images: list[str], prompt: str, schema: dict):
        # Callers must use a vision-capable model and supply redacted base64 image crops.
        return self._generate(prompt, schema, 0.1, images=images)

    def _generate(self, prompt, schema, temperature, images=None):
        Draft202012Validator.check_schema(schema)
        if not 0 <= temperature <= 1:
            raise ValueError("Temperature must be between zero and one.")
        self._check_model()
        body = {"model": self.settings.model, "prompt": prompt, "format": schema, "stream": False,
                "keep_alive": 0, "options": {"temperature": temperature, "num_ctx": 2048, "num_predict": 512}}
        if images is not None:
            body["images"] = images
        started = time.monotonic()
        response = self._request("/api/generate", body)
        if response.get("done") is not True or response.get("done_reason") == "length":
            raise ModelOutputError("Local model did not finish its structured response.")
        try:
            result = json.loads(response["response"])
            if not isinstance(result, dict):
                raise ModelOutputError("Expected a structured object.")
            Draft202012Validator(schema).validate(result)
        except (KeyError, TypeError, json.JSONDecodeError, ValidationError) as error:
            raise ModelOutputError("Local output failed JSON/schema validation; no result may be saved as assessed.") from error
        self.last_metrics = {"provider": "ollama-local", "model": self.settings.model,
                             "duration_ms": round((time.monotonic() - started) * 1000),
                             "input_tokens": response.get("prompt_eval_count"), "output_tokens": response.get("eval_count"),
                             "api_cost_inr": 0}
        logger.info("local_ai_call %s", json.dumps(self.last_metrics))
        return result
