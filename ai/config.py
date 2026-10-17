"""Local-only AI settings, shared by every future task provider."""
from dataclasses import dataclass
import ipaddress
import logging
import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv


class PolicyViolation(ValueError):
    """Configuration would violate the local/zero-hosted-API policy."""

    def __init__(self, message):
        # Messages are fixed policy descriptions, never endpoint credentials/prompts.
        logging.getLogger("ai.policy").warning("local_ai_policy_block: %s", message)
        super().__init__(message)


@dataclass(frozen=True)
class Settings:
    base_url: str = "http://127.0.0.1:11434"
    model: str = ""
    max_model_bytes: int = 3 * 1024**3
    timeout_seconds: int = 60

    def __post_init__(self):
        parsed = urlsplit(self.base_url)
        try:
            local = ipaddress.ip_address(parsed.hostname or "").is_loopback
            _ = parsed.port
        except ValueError:
            local = False
        if (not local or parsed.scheme != "http" or parsed.username or parsed.password
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            raise PolicyViolation("AI endpoint must be an HTTP loopback IP with no credentials/path/query.")
        if not 1 <= self.timeout_seconds <= 300 or self.max_model_bytes <= 0:
            raise PolicyViolation("Invalid local AI resource limits.")
        if any(marker in self.model.lower() for marker in (":cloud", "-cloud", "/", "https:", "http:")):
            raise PolicyViolation("Cloud/remote model selectors are disabled.")

    @classmethod
    def from_env(cls):
        load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
        if os.getenv("AI_RUNTIME", "local") != "local":
            raise PolicyViolation("AI_RUNTIME must be local. Hosted inference has no fallback.")
        if os.getenv("AI_HOSTED_APIS_ENABLED", "false").lower() not in ("false", "0", ""):
            raise PolicyViolation("Hosted AI API usage is disabled for this project.")
        return cls(
            base_url=os.getenv("LOCAL_AI_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
            model=os.getenv("LOCAL_LLM_MODEL", ""),
            max_model_bytes=int(os.getenv("AI_MAX_MODEL_BYTES", str(3 * 1024**3))),
            timeout_seconds=int(os.getenv("AI_REQUEST_TIMEOUT_SECONDS", "60")),
        )
