"""Provider-specific LLM compatibility helpers."""


def normalize_temperature(model_name: str, default: float) -> float:
    """Kimi K2.6 only accepts temperature=1 on Moonshot's OpenAI-compatible API."""
    if (model_name or "").lower() == "kimi-k2.6":
        return 1
    return default
