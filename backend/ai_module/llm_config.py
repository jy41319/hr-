"""Provider-specific LLM compatibility helpers."""

from typing import Optional


def is_kimi_k26_model(model_name: str) -> bool:
    normalized = (model_name or "").lower()
    return normalized.startswith("kimi-k2.6") or normalized.startswith("kimi-k2.5")


def normalize_temperature(model_name: str, default: float, thinking_enabled: Optional[bool] = None) -> float:
    """Provider-specific temperature compatibility.

    Kimi K2.6/K2.5 only accept fixed temperatures:
    - thinking mode: 1.0
    - non-thinking mode: 0.6

    Kimi K2 preview models use 0.6 in the official examples. Keep this
    centralized so chat, JD parsing, and resume evaluation do not drift.
    """
    normalized = (model_name or "").lower()
    if is_kimi_k26_model(normalized):
        return 1 if thinking_enabled is not False else 0.6
    if normalized.startswith("kimi-k2"):
        return 0.6
    return default


def kimi_thinking_extra_body(model_name: str, thinking_enabled: bool) -> dict:
    if not is_kimi_k26_model(model_name):
        return {}
    return {"thinking": {"type": "enabled" if thinking_enabled else "disabled"}}
