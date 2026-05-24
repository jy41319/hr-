"""
岗位模板解析器 - 自动检测简历对应的岗位类型并匹配评审模板
"""
import os
from typing import Dict, Any, Optional, Tuple, List
from pydantic import BaseModel, Field
from langchain_openai import ChatOpenAI
from datetime import datetime

from .token_counter import count_tokens, accumulate_model_tokens, extract_token_usage
from .document_reader import get_document_reader
from .llm_config import kimi_thinking_extra_body, normalize_temperature


class PositionClassification(BaseModel):
    position_type: str = Field(description="检测到的岗位类型，必须是给定列表中的一个，或'unknown'")
    confidence: float = Field(description="置信度，0到1之间")


def _get_llm() -> Optional[ChatOpenAI]:
    try:
        from resume_models import LLMModel
        active_model = LLMModel.query.filter_by(is_active=True).first()
    except Exception:
        active_model = None

    if active_model:
        enable_thinking = bool(getattr(active_model, 'enable_thinking', False))
        model_kwargs = {}
        extra_body = kimi_thinking_extra_body(active_model.model_name, enable_thinking)
        if extra_body:
            model_kwargs["extra_body"] = extra_body
        return ChatOpenAI(
            model_name=active_model.model_name,
            openai_api_key=active_model.api_key,
            openai_api_base=active_model.api_base,
            temperature=normalize_temperature(active_model.model_name, 0.1, enable_thinking),
            model_kwargs=model_kwargs,
        )

    api_key = os.getenv("OPENAI_API_KEY")
    api_base = os.getenv("OPENAI_API_BASE")
    model_name = os.getenv("OPENAI_MODEL_NAME")
    if not all([api_key, api_base, model_name]):
        return None

    enable_thinking = os.getenv("OPENAI_ENABLE_THINKING", "false").lower() == "true"
    model_kwargs = {}
    extra_body = kimi_thinking_extra_body(model_name, enable_thinking)
    if extra_body:
        model_kwargs["extra_body"] = extra_body
    return ChatOpenAI(
        model_name=model_name,
        openai_api_key=api_key,
        openai_api_base=api_base,
        temperature=normalize_temperature(model_name, 0.1, enable_thinking),
        model_kwargs=model_kwargs,
    )


def detect_position_type(resume_excerpt: str, available_positions: List[str]) -> Optional[str]:
    if not resume_excerpt or not available_positions:
        return None

    llm = _get_llm()
    if not llm:
        return None

    positions_str = "、".join(available_positions)

    prompt = f"""**背景信息：当前时间为{datetime.now().year}年。**

你是一位HR岗位分类专家。请根据以下简历开头内容，判断该候选人最可能属于哪个岗位类型。

**可选岗位类型列表：**
{positions_str}

**简历开头内容：**
---
{resume_excerpt[:2000]}
---

请从上述列表中选择最匹配的岗位类型。如果无法确定，设为"unknown"。"""

    try:
        structured_llm = llm.with_structured_output(PositionClassification, include_raw=True)
        raw_resp = structured_llm.invoke(prompt)
        result = raw_resp['parsed']

        input_tokens, output_tokens = extract_token_usage(raw_resp.get('raw'), prompt, str(result.dict()))
        accumulate_model_tokens(input_tokens, output_tokens)

        detected = result.position_type.strip()
        if detected != "unknown" and detected in available_positions:
            print(f"[岗位检测] 结果: {detected} (置信度: {result.confidence:.2f})")
            return detected
        else:
            print(f"[岗位检测] 未能匹配 (LLM返回: {detected})")
            return None
    except Exception as e:
        print(f"[岗位检测] [WARNING] 检测失败: {e}")
        return None


def _build_profile_config(profile) -> Dict[str, Any]:
    return {
        'evaluation_criteria': profile.evaluation_criteria,
        'dimension_prompt_template': profile.dimension_prompt_template,
        'overall_prompt_template': profile.overall_prompt_template,
        'position_type': profile.position_type,
    }


def _try_auto_detect(db_session, resume) -> Optional[str]:
    from resume_models import ReviewProfile
    try:
        active_profiles = ReviewProfile.query.filter_by(is_active=True).all()
        if not active_profiles:
            return None

        available_positions = list(set(p.position_type for p in active_profiles))
        if len(available_positions) <= 1:
            return None

        reader = get_document_reader()
        resume_text = reader.read(resume.resume_url)
        excerpt = resume_text[:2000] if resume_text else None
        if not excerpt:
            return None

        return detect_position_type(excerpt, available_positions)
    except Exception as e:
        print(f"[模板解析] [WARNING] 自动检测出错: {e}")
        return None


def resolve_profile_for_resume(db_session, resume) -> Tuple[Any, Dict[str, Any]]:
    """
    为简历解析最合适的评审模板
    优先级：1.resume.profile_id → 2.自动检测 → 3.默认模板 → 4.报错
    """
    from resume_models import ReviewProfile

    if resume.profile_id:
        profile = db_session.get(ReviewProfile, resume.profile_id)
        if profile:
            print(f"[模板解析] 使用指定模板: {profile.name} ({profile.position_type})")
            return profile, _build_profile_config(profile)

    detected_position = _try_auto_detect(db_session, resume)
    if detected_position:
        profile = ReviewProfile.query.filter_by(
            position_type=detected_position, is_active=True,
        ).order_by(ReviewProfile.is_default.desc()).first()
        if profile:
            resume.profile_id = profile.id
            db_session.commit()
            print(f"[模板解析] 自动匹配模板: {profile.name} ({profile.position_type})")
            return profile, _build_profile_config(profile)

    profile = ReviewProfile.query.filter_by(is_default=True).first()
    if profile:
        print(f"[模板解析] 使用默认模板: {profile.name} ({profile.position_type})")
        return profile, _build_profile_config(profile)

    raise ValueError("未找到可用的评审模板。请先创建并设置一个默认模板。")
