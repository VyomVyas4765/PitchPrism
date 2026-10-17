"""Provider contracts. Unavailable tasks stay explicitly unavailable, never silently paid."""
from dataclasses import dataclass
from enum import Enum
from typing import Any, Protocol


class Task(str, Enum):
    TRANSCRIBE = "transcribe"
    OCR = "ocr"
    TRANSLATE = "translate"
    TRANSLITERATE = "transliterate"
    EMBED = "embed"
    GENERATE_JSON = "generate_json"
    SYNTHESIZE = "synthesize"


@dataclass(frozen=True)
class TaskRequest:
    task: Task
    payload: dict[str, Any]
    language: str
    submission_id: str


class CapabilityUnavailable(RuntimeError):
    """The queue owner may defer/retry after local capability is provisioned."""


class LocalProvider(Protocol):
    task: Task

    def execute(self, request: TaskRequest) -> dict[str, Any]: ...


class ProviderRegistry:
    def __init__(self):
        self._providers: dict[Task, LocalProvider] = {}

    def register(self, provider: LocalProvider):
        if provider.task in self._providers:
            raise ValueError("A provider is already registered for this task.")
        self._providers[provider.task] = provider

    def execute(self, request: TaskRequest):
        provider = self._providers.get(request.task)
        if provider is None:
            raise CapabilityUnavailable(f"Local capability is not configured: {request.task.value}. Keep the job pending/failed with this reason; no hosted fallback.")
        return provider.execute(request)
