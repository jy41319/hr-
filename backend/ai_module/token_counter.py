"""
Token 计数工具 - 使用 tiktoken 估算 LLM token 消耗
"""
import tiktoken
import threading

_enc = tiktoken.get_encoding("cl100k_base")


def count_tokens(text: str) -> int:
    """计算文本的 token 数量"""
    if not text:
        return 0
    return len(_enc.encode(text))


def extract_token_usage(response, fallback_input: str = '', fallback_output: str = '') -> tuple:
    """从 LLM 响应中提取 token 用量。
    优先使用 API 返回的真实值（usage_metadata），兜底使用 tiktoken 估算。
    返回 (input_tokens, output_tokens)。
    """
    usage = getattr(response, 'usage_metadata', None)
    if usage:
        # LangChain 标准化的 usage_metadata（可能是 dict 或 UsageMetadata 对象）
        if isinstance(usage, dict):
            input_t = usage.get('input_tokens', 0)
            output_t = usage.get('output_tokens', 0)
        else:
            input_t = getattr(usage, 'input_tokens', 0) or 0
            output_t = getattr(usage, 'output_tokens', 0) or 0
        if input_t > 0 or output_t > 0:
            return int(input_t), int(output_t)
    # 兜底：tiktoken 估算
    return count_tokens(fallback_input), count_tokens(fallback_output)


def accumulate_model_tokens(input_tokens: int, output_tokens: int):
    """将 token 消耗累加到当前激活的 LLM 模型"""
    try:
        from models import LLMModel, db
        active_model = LLMModel.query.filter_by(is_active=True).first()
        if active_model:
            active_model.total_input_tokens = (active_model.total_input_tokens or 0) + input_tokens
            active_model.total_output_tokens = (active_model.total_output_tokens or 0) + output_tokens
            db.session.commit()
    except Exception:
        pass


class TokenAccumulator:
    """线程安全的 token 累加器，用于多线程场景"""

    def __init__(self):
        self._total = 0
        self._lock = threading.Lock()

    def add(self, n: int):
        with self._lock:
            self._total += n

    @property
    def total(self) -> int:
        return self._total
