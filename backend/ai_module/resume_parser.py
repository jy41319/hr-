"""
简历结构化信息提取器 - 从简历中提取姓名、学历、工作经历等结构化字段
"""
import os
import json
import re
from typing import Dict, Any, Optional
from datetime import datetime

from .resume_evaluator import ResumeEvaluator
from .token_counter import accumulate_model_tokens, extract_token_usage
from .document_reader import get_document_reader
from . import resume_prompts


class ResumeParser:
    """从简历中提取结构化信息"""

    def __init__(self, profile_config: Dict[str, Any] = None):
        self.ai_evaluator = ResumeEvaluator(profile_config)
        self.llm_structured = self.ai_evaluator.llm_structured
        self.document_reader = get_document_reader()

    def parse_resume(self, resume_path: str) -> Dict[str, Any]:
        """
        提取简历结构化信息

        Returns:
            结构化信息字典
        """
        resume_content = self.document_reader.read(resume_path)

        prompt = f"""**背景信息：当前时间为{datetime.now().year}年。**

你是一位简历信息提取专家。请从以下简历内容中提取结构化信息。

**简历内容:**
---
{resume_content[:50000]}
---

**提取要求:**
1. 尽可能准确地提取所有字段
2. 如果某个字段无法从简历中找到，留空字符串或空列表
3. 教育经历和工作经历要包含完整的时间信息
4. 技能列表要包含所有提到的技能

请严格按照JSON格式返回提取结果。
"""

        try:
            structured_llm = self.llm_structured.with_structured_output(resume_prompts.ResumeStructuredInfo, include_raw=True)
            raw_resp = structured_llm.invoke(prompt)
            result = raw_resp['parsed']

            input_tokens, output_tokens = extract_token_usage(raw_resp.get('raw'), prompt, str(result.dict()))
            accumulate_model_tokens(input_tokens, output_tokens)

            return result.dict()
        except Exception as e:
            print(f"[ERROR] 简历结构化提取失败: {e}")
            return {
                "name": "",
                "age": "",
                "email": "",
                "phone": "",
                "education_list": [],
                "work_list": [],
                "skills": [],
                "certifications": [],
                "self_evaluation": "",
            }