import io
import os
import json
import re
import sys
import time
import hashlib
import threading
import random
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError
from typing import Dict, Any, Optional, Type
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from openai import OpenAI
from pydantic import ValidationError
from datetime import datetime

from .document_reader import get_document_reader
from .llm_config import kimi_thinking_extra_body, normalize_temperature
from .resume_structure import get_resume_structure_extractor, save_structure_debug
from .token_counter import count_tokens, accumulate_model_tokens, extract_token_usage
from . import resume_prompts
from task_control import TaskCancelledError, can_attach_log, ensure_task_active

dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_path)

_JD_CRITERIA_CACHE: Dict[str, Dict[str, Any]] = {}
_JD_CRITERIA_LOCK = threading.RLock()


def _fallback_jd_criteria(job_description: str = "") -> Dict[str, Any]:
    """Create a deterministic screening ruler when no JD or model parsing is available."""
    text = (job_description or "").strip()
    if not text:
        return {
            "must_have_requirements": ["基本信息完整", "工作经历时间线清晰", "核心经历与目标岗位相关"],
            "core_responsibilities": ["理解岗位职责并能用过往经历佐证", "具备稳定的职业路径和可验证成果"],
            "nice_to_have": ["有量化业绩", "有与岗位高度相关的项目经验"],
            "risk_watchpoints": ["关键信息缺失", "经历时间线不连续", "项目成果缺少证据"],
            "interview_focus": ["请候选人说明与岗位最相关的项目贡献", "请候选人补充关键成果的数据依据"],
        }

    lines = [line.strip(" -•\t") for line in re.split(r"[\n；;。]+", text) if line.strip()]
    keyword_lines = [line for line in lines if re.search(r"要求|必须|熟悉|具备|负责|优先|加分|经验|能力", line)]
    selected = (keyword_lines or lines)[:12]
    must = [line for line in selected if re.search(r"必须|要求|本科|以上|年|熟悉|具备|掌握", line)][:5]
    core = [line for line in selected if re.search(r"负责|职责|推进|搭建|管理|完成|协作", line)][:5]
    nice = [line for line in selected if re.search(r"优先|加分|更佳|熟悉.*优先", line)][:4]
    return {
        "must_have_requirements": must or selected[:4],
        "core_responsibilities": core or selected[:4],
        "nice_to_have": nice or ["有同类岗位成功案例", "成果可量化且可复盘"],
        "risk_watchpoints": ["硬性要求未体现", "项目成果缺少数据", "经历与JD核心职责不一致", "薪资或稳定性需确认"],
        "interview_focus": ["围绕JD硬性要求逐项追问证据", "确认候选人在关键项目中的个人贡献", "核验成果指标和业务影响"],
    }


class ResumeEvaluator:
    """
    简历多维度AI评审器
    支持根据不同岗位的评审模板（ReviewProfile）进行简历评估
    """

    def __init__(self, profile_config: Optional[Dict[str, Any]] = None):
        try:
            from resume_models import LLMModel
            active_model = LLMModel.query.filter_by(is_active=True).first()
        except Exception:
            active_model = None

        self.enable_thinking = False
        if active_model:
            self.api_key = active_model.api_key
            self.api_base = active_model.api_base
            self.model_name = active_model.model_name
            self.enable_thinking = bool(getattr(active_model, 'enable_thinking', False))
        else:
            self.api_key = os.getenv("OPENAI_API_KEY")
            self.api_base = os.getenv("OPENAI_API_BASE")
            self.model_name = os.getenv("OPENAI_MODEL_NAME")

        if not all([self.api_key, self.api_base, self.model_name]):
            raise ValueError("未找到可用的LLM模型配置")

        self.request_timeout = int(os.getenv("LLM_REQUEST_TIMEOUT", "120"))
        self.response_max_tokens = int(os.getenv("LLM_RESPONSE_MAX_TOKENS", "2200"))

        llm_kwargs = {}
        extra_body = kimi_thinking_extra_body(self.model_name, self.enable_thinking)
        if extra_body:
            llm_kwargs['model_kwargs'] = {"extra_body": extra_body}

        self.llm = ChatOpenAI(
            model_name=self.model_name,
            openai_api_key=self.api_key,
            openai_api_base=self.api_base,
            temperature=normalize_temperature(self.model_name, 0.5, self.enable_thinking),
            timeout=self.request_timeout,
            max_tokens=self.response_max_tokens,
            **llm_kwargs,
        )

        if self.enable_thinking:
            self.llm_structured = ChatOpenAI(
                model_name=self.model_name,
                openai_api_key=self.api_key,
                openai_api_base=self.api_base,
                temperature=normalize_temperature(self.model_name, 0.5, self.enable_thinking),
                timeout=self.request_timeout,
                max_tokens=self.response_max_tokens,
            )
        else:
            self.llm_structured = self.llm

        self.document_reader = get_document_reader()
        self.structure_extractor = get_resume_structure_extractor()

        if profile_config:
            self.criteria_data = {"evaluation_criteria": profile_config['evaluation_criteria']}
            self.dimension_prompt_template_str = profile_config['dimension_prompt_template']
            self.overall_prompt_template_str = profile_config['overall_prompt_template']
            self.position_type = profile_config.get('position_type', '通用岗位')
        else:
            criteria_path = os.path.join(os.path.dirname(__file__), 'config', 'general_resume_criteria.json')
            with open(criteria_path, 'r', encoding='utf-8') as f:
                self.criteria_data = json.load(f)
            dim_template = resume_prompts.get_dimension_prompt_template()
            overall_template = resume_prompts.get_overall_prompt_template()
            self.dimension_prompt_template_str = dim_template.messages[0].prompt.template
            self.overall_prompt_template_str = overall_template.messages[0].prompt.template
            self.position_type = '通用岗位'

    def _get_letter_grade(self, score: float) -> str:
        if 90 <= score <= 100: return "A"
        if 80 <= score < 90: return "B"
        if 70 <= score < 80: return "C"
        if 60 <= score < 70: return "D"
        return "E"

    def _get_response_text(self, response: Any) -> str:
        content = getattr(response, "content", response)
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    text = item.get("text") or item.get("content") or ""
                    if text: parts.append(str(text))
                else:
                    text = getattr(item, "text", None) or getattr(item, "content", None)
                    if text: parts.append(str(text))
            return "\n".join(parts).strip()
        return str(content).strip()

    def _extract_json_payload(self, raw_text: str) -> Dict[str, Any]:
        text = raw_text.strip()
        if not text:
            raise ValueError("模型返回为空")
        fenced_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL | re.IGNORECASE)
        if fenced_match:
            text = fenced_match.group(1).strip()
        elif not text.startswith("{"):
            start = text.find("{")
            end = text.rfind("}")
            if start == -1 or end == -1 or end <= start:
                raise ValueError("未找到 JSON 对象")
            text = text[start:end + 1]
        return json.loads(text)

    def _normalize_result_payload(self, schema_cls: Type, payload: Dict[str, Any]) -> Dict[str, Any]:
        normalized = dict(payload)
        for field in ("feedback", "strengths", "weaknesses", "overall_feedback"):
            value = normalized.get(field)
            if isinstance(value, str):
                normalized[field] = value.strip()
        if "score" in normalized:
            score = normalized.get("score")
            if isinstance(score, str) and score.strip():
                normalized["score"] = int(float(score))
        if "overall_score" in normalized:
            overall_score = normalized.get("overall_score")
            if isinstance(overall_score, str) and overall_score.strip():
                normalized["overall_score"] = float(overall_score)
        if schema_cls is resume_prompts.OverallEvaluation:
            recommendations = normalized.get("recommendations")
            if isinstance(recommendations, str):
                items = [
                    item.strip(" -0123456789.、)")
                    for item in re.split(r"[\n;；]+", recommendations)
                    if item.strip()
                ]
                normalized["recommendations"] = items
        return normalized

    def _validate_payload(self, schema_cls: Type, payload: Dict[str, Any]) -> Dict[str, Any]:
        normalized = self._normalize_result_payload(schema_cls, payload)
        validated = schema_cls.model_validate(normalized)
        return validated.model_dump()

    def _invoke_json_with_retry(
        self, prompt_text: str, schema_cls: Type, label: str, max_attempts: int = 2,
    ) -> tuple:
        total_tokens = 0
        retry_instructions = [
            "\n\n**输出要求:**\n- 只返回一个JSON对象\n- 不要返回Markdown代码块\n- 所有字段必须填写完整\n",
            "\n\n上一次输出未通过校验。请只返回合法JSON对象，所有字段完整、非空、类型正确。\n",
        ]
        last_error = None

        for attempt in range(max_attempts):
            full_prompt = prompt_text + retry_instructions[min(attempt, len(retry_instructions) - 1)]
            response = self._invoke_llm_text(full_prompt)
            raw_text = response["text"]
            input_tokens = response["input_tokens"]
            output_tokens = response["output_tokens"]
            tokens = input_tokens + output_tokens
            total_tokens += tokens
            accumulate_model_tokens(input_tokens, output_tokens)

            try:
                payload = self._extract_json_payload(raw_text)
                validated = self._validate_payload(schema_cls, payload)
                return validated, total_tokens
            except (json.JSONDecodeError, ValidationError, ValueError, TypeError) as exc:
                last_error = exc
                print(f"    [WARNING] {label} 第 {attempt + 1} 次解析失败: {exc}")

        raise ValueError(f"{label} 在 {max_attempts} 次尝试后仍未返回有效JSON: {last_error}")

    def _invoke_llm_text(self, prompt_text: str, max_tokens: Optional[int] = None, model_name: Optional[str] = None) -> Dict[str, Any]:
        completion_limit = max_tokens or self.response_max_tokens
        request_model = model_name or self.model_name
        if (request_model or "").lower().startswith("kimi-"):
            client = OpenAI(
                api_key=self.api_key,
                base_url=self.api_base,
                timeout=self.request_timeout,
                max_retries=1,
            )
            extra_body = kimi_thinking_extra_body(request_model, self.enable_thinking)
            max_attempts = int(os.getenv("KIMI_API_MAX_RETRIES", "2"))
            completion = None
            for attempt in range(max_attempts + 1):
                try:
                    request_kwargs = {
                        "model": request_model,
                        "messages": [{"role": "user", "content": prompt_text}],
                        "temperature": normalize_temperature(request_model, 0.5, self.enable_thinking),
                        "max_tokens": completion_limit,
                    }
                    if extra_body:
                        request_kwargs["extra_body"] = extra_body
                    completion = client.chat.completions.create(
                        **request_kwargs,
                    )
                    break
                except Exception as exc:
                    status_code = getattr(exc, "status_code", None)
                    retryable = status_code in {408, 409, 429, 500, 502, 503, 504} or status_code is None
                    if attempt >= max_attempts or not retryable:
                        raise
                    sleep_seconds = min(12, (2 ** attempt) + random.uniform(0.2, 1.2))
                    print(f"   [WARNING] Kimi请求失败(status={status_code})，{sleep_seconds:.1f}s后重试: {exc}")
                    time.sleep(sleep_seconds)
            text = completion.choices[0].message.content or ""
            usage = completion.usage
            return {
                "text": text.strip(),
                "input_tokens": getattr(usage, "prompt_tokens", 0) or 0,
                "output_tokens": getattr(usage, "completion_tokens", 0) or 0,
            }

        response = self.llm.invoke(prompt_text)
        raw_text = self._get_response_text(response)
        input_tokens, output_tokens = extract_token_usage(response, prompt_text, raw_text)
        return {
            "text": raw_text,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

    def _normalize_list(self, value, fallback=None):
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str) and value.strip():
            return [item.strip(" -0123456789.、)") for item in re.split(r"[\n;；]+", value) if item.strip()]
        return fallback or []

    def _normalize_evidence(self, value):
        if not isinstance(value, list):
            return []
        normalized = []
        allowed_types = {'timeline', 'missing_info', 'credential', 'exaggeration', 'aigc', 'salary'}
        for item in value[:8]:
            if isinstance(item, str):
                normalized.append({
                    "risk_type": "exaggeration",
                    "risk_label": "夸大表述",
                    "evidence": item[:240],
                    "finding": "需人工复核",
                })
                continue
            if not isinstance(item, dict):
                continue
            risk_type = item.get("risk_type") or item.get("type") or "exaggeration"
            if risk_type not in allowed_types:
                risk_type = "exaggeration"
            normalized.append({
                "risk_type": risk_type,
                "risk_label": item.get("risk_label") or item.get("label") or {
                    "timeline": "时间线矛盾",
                    "missing_info": "信息缺失",
                    "credential": "证书/学历疑点",
                    "exaggeration": "夸大表述",
                    "aigc": "AI痕迹",
                    "salary": "薪资预期不合理",
                }.get(risk_type, "风险证据"),
                "evidence": str(item.get("evidence") or item.get("quote") or "")[:240],
                "finding": str(item.get("finding") or item.get("detail") or item.get("reason") or "")[:240],
            })
        return normalized

    def _normalize_jd_criteria(self, value, job_description: str = ""):
        fallback = _fallback_jd_criteria(job_description)
        if not isinstance(value, dict):
            return fallback
        return {
            "must_have_requirements": self._normalize_list(value.get("must_have_requirements"), fallback["must_have_requirements"])[:8],
            "core_responsibilities": self._normalize_list(value.get("core_responsibilities"), fallback["core_responsibilities"])[:8],
            "nice_to_have": self._normalize_list(value.get("nice_to_have"), fallback["nice_to_have"])[:6],
            "risk_watchpoints": self._normalize_list(value.get("risk_watchpoints"), fallback["risk_watchpoints"])[:6],
            "interview_focus": self._normalize_list(value.get("interview_focus"), fallback["interview_focus"])[:6],
        }

    def _normalize_requirement_matches(self, value):
        if not isinstance(value, list):
            return []
        normalized = []
        for item in value[:8]:
            if isinstance(item, str):
                normalized.append({
                    "requirement": item[:80],
                    "status": "unknown",
                    "evidence": "",
                    "gap": "需面试确认",
                })
                continue
            if not isinstance(item, dict):
                continue
            status = item.get("status") or "unknown"
            if status not in {"met", "partial", "missing", "unknown"}:
                status = "unknown"
            normalized.append({
                "requirement": str(item.get("requirement") or item.get("name") or "")[:100],
                "status": status,
                "evidence": str(item.get("evidence") or item.get("quote") or "")[:180],
                "gap": str(item.get("gap") or item.get("concern") or "")[:160],
            })
        return [item for item in normalized if item["requirement"]]

    def _normalize_score_breakdown(self, value):
        fallback = {"jd_match": 0, "resume_quality": 0, "risk_control": 0, "evidence_confidence": 0}
        if not isinstance(value, dict):
            return fallback
        normalized = {}
        for key in fallback:
            try:
                normalized[key] = max(0, min(100, int(round(float(value.get(key, 0))))))
            except (TypeError, ValueError):
                normalized[key] = 0
        return normalized

    def _normalize_candidate_basic_info(self, value):
        if not isinstance(value, dict):
            return {}
        fields = [
            "age",
            "gender",
            "education",
            "school",
            "major",
            "graduation_year",
            "city",
            "work_years",
            "expected_salary",
        ]
        normalized = {}
        for field in fields:
            text = str(value.get(field) or "").strip()
            normalized[field] = text[:80] if text else ""
        return normalized

    def _normalize_dimension_evidence(self, value):
        if not isinstance(value, list):
            return []
        normalized = []
        for item in value[:4]:
            if isinstance(item, str):
                text = item.strip()
                if text:
                    normalized.append({"summary": "简历原文证据", "evidence": text[:260]})
                continue
            if not isinstance(item, dict):
                continue
            evidence = str(item.get("evidence") or item.get("quote") or item.get("original_text") or "").strip()
            if not evidence:
                continue
            normalized.append({
                "summary": str(item.get("summary") or item.get("point") or item.get("claim") or "简历原文证据").strip()[:80],
                "evidence": evidence[:260],
            })
        return normalized

    def _fallback_dimension_evidence(self, resume_content: str, dimension_key: str, dimension_payload: Optional[Dict[str, Any]] = None):
        lines = [
            line.strip(" -•\t")
            for line in re.split(r"[\n\r]+", resume_content or "")
            if len(line.strip()) >= 6
        ]
        lines = [
            line for line in lines
            if "模拟测试数据" not in line and "以下姓名、经历、联系方式均为虚构" not in line
        ]
        keyword_map = {
            "basic_info": r"姓名|性别|年龄|城市|手机|电话|邮箱|院校|学历|专业|毕业|薪资",
            "format": r"基本信息|个人摘要|核心技能|工作|实习|项目|教育|经历|补充说明",
            "work_logic": r"工作|实习|经历|负责|项目|20\d{2}|至今|公司|团队|部门",
            "skill_match": r"技能|能力|工具|Python|SQL|Java|前端|后端|AI|AIGC|Prompt|RAG|产品|运营|设计|数据|剪辑|小红书",
            "risk_assessment": r"风险|待确认|补充说明|毕业时间|期望薪资|未体现|不符|缺少|疑似|模拟风险",
            "overall_impression": r"个人摘要|核心技能|工作|实习|项目|负责|成果|获得|排名|优化|提升",
        }
        pattern = keyword_map.get(dimension_key, keyword_map["overall_impression"])
        matched = [line for line in lines if re.search(pattern, line, re.IGNORECASE)]
        selected = (matched or lines)[:3]

        payload = dimension_payload or {}
        summary_source = payload.get("strengths") or payload.get("weaknesses") or payload.get("feedback") or "维度判断"
        summary = re.split(r"[。；;\n]", str(summary_source).strip())[0][:80] or "维度判断"
        return [
            {
                "summary": summary,
                "evidence": line[:260],
            }
            for line in selected
        ]

    def _normalize_decision_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        overall = payload.get("overall_evaluation") or {}
        match_score = payload.get("match_score", overall.get("overall_score", 0))
        try:
            match_score = max(0, min(100, int(round(float(match_score)))))
        except (TypeError, ValueError):
            match_score = 0

        recommendation = payload.get("recommendation") or ""
        if recommendation not in {"推荐面试", "待定", "建议淘汰", "建议人工复核"}:
            risk_level = payload.get("risk_level") or ""
            score = overall.get("overall_score") or match_score
            if risk_level == "high":
                recommendation = "建议人工复核"
            elif score >= 75:
                recommendation = "推荐面试"
            elif score >= 60:
                recommendation = "待定"
            else:
                recommendation = "建议淘汰"

        risk_level = payload.get("risk_level") or "medium"
        if risk_level not in {"low", "medium", "high"}:
            risk_level = "medium"

        payload["match_score"] = match_score
        payload["match_grade"] = self._get_letter_grade(match_score)
        payload["recommendation"] = recommendation
        payload["risk_level"] = risk_level
        payload["highlights"] = self._normalize_list(payload.get("highlights"), ["暂无明确亮点"])
        payload["concerns"] = self._normalize_list(payload.get("concerns"), ["暂无明确短板"])
        payload["interview_questions"] = self._normalize_list(payload.get("interview_questions"), ["请候选人补充说明简历中的关键经历"],)[:5]
        payload["evidence_snippets"] = self._normalize_evidence(payload.get("evidence_snippets"))
        payload["requirement_matches"] = self._normalize_requirement_matches(payload.get("requirement_matches"))
        payload["score_breakdown"] = self._normalize_score_breakdown(payload.get("score_breakdown"))
        payload["recommendation_reason"] = str(payload.get("recommendation_reason") or "建议结合JD匹配度、风险证据和面试追问做最终判断。")[:240]
        payload["key_gaps"] = self._normalize_list(payload.get("key_gaps"), [])[:5]
        payload["candidate_profile_summary"] = str(payload.get("candidate_profile_summary") or "")[:240]
        payload["candidate_basic_info"] = self._normalize_candidate_basic_info(payload.get("candidate_basic_info"))
        payload["knockout_reasons"] = self._normalize_list(payload.get("knockout_reasons"), [])[:5]
        templates = payload.get("communication_templates") if isinstance(payload.get("communication_templates"), dict) else {}
        payload["communication_templates"] = {
            "interview_invite": str(templates.get("interview_invite") or "您好，我们看到了您的简历，想进一步沟通岗位匹配情况，请问近期方便安排一次面试吗？")[:300],
            "request_more_info": str(templates.get("request_more_info") or "您好，为了更准确评估岗位匹配度，麻烦补充相关项目经历、可到岗时间或作品链接。")[:300],
            "rejection": str(templates.get("rejection") or "您好，感谢投递。综合当前岗位要求，本次暂不进入下一轮，后续有合适机会我们会再联系。")[:300],
        }
        return payload

    def parse_jd_criteria(self, job_description: str = "") -> Dict[str, Any]:
        jd = (job_description or "").strip()
        if not jd:
            return _fallback_jd_criteria("")

        cache_key = hashlib.sha256(jd.encode("utf-8")).hexdigest()
        with _JD_CRITERIA_LOCK:
            if cache_key in _JD_CRITERIA_CACHE:
                return _JD_CRITERIA_CACHE[cache_key]

            prompt_text = f"""你是一位资深招聘负责人。请把下面这份JD拆成可执行的初筛尺子，帮助HR批量筛简历。

JD:
---
{jd[:6000]}
---

只输出JSON对象，不要输出Markdown。JSON结构如下:
{{
  "must_have_requirements": ["硬性要求，4-8条"],
  "core_responsibilities": ["核心职责，3-6条"],
  "nice_to_have": ["加分项，2-5条"],
  "risk_watchpoints": ["筛选时要警惕的风险，3-6条"],
  "interview_focus": ["面试重点追问方向，3-6条"]
}}

要求:
- 硬性要求只能包含JD明确表达的必要条件，不要擅自拔高。
- 加分项不能当成淘汰条件。
- 每条不超过35字，语言要像HR筛选清单。
"""
            try:
                jd_model = os.getenv("KIMI_JD_MODEL_NAME", "kimi-k2-turbo-preview")
                response = self._invoke_llm_text(
                    prompt_text,
                    max_tokens=int(os.getenv("KIMI_JD_PARSE_MAX_TOKENS", "1000")),
                    model_name=jd_model,
                )
                accumulate_model_tokens(response["input_tokens"], response["output_tokens"])
                payload = self._extract_json_payload(response["text"])
                criteria = self._normalize_jd_criteria(payload, jd)
            except Exception as exc:
                print(f"   [WARNING] JD筛选尺子解析失败，已使用规则兜底: {exc}")
                criteria = _fallback_jd_criteria(jd)

            _JD_CRITERIA_CACHE[cache_key] = criteria
            return criteria

    def _evaluate_resume_single_pass(self, resume_content: str, job_description: str = "", jd_criteria: Optional[Dict[str, Any]] = None) -> tuple:
        criteria = self.criteria_data["evaluation_criteria"]
        compact_criteria = {
            key: {
                "weight": value.get("weight"),
                "description": value.get("description"),
                "aspects": value.get("aspects", []),
            }
            for key, value in criteria.items()
        }
        jd_block = job_description.strip() or "未提供JD。请按岗位模板和通用中小企业初筛标准评估。"
        screening_ruler = self._normalize_jd_criteria(jd_criteria, job_description)
        prompt_text = f"""你是一位资深HR简历审查专家。请基于当前日期 {datetime.now().strftime('%Y-%m-%d')} 审查这份求职简历。
产品目标：帮助中小企业HR在5分钟内完成批量初筛、风险识别、候选人排序和面试建议。

本次岗位JD/招聘需求（最高优先级）:
---
{jd_block[:6000]}
---

本次岗位筛选尺子JSON（请作为主要评分依据）:
{json.dumps(screening_ruler, ensure_ascii=False)}

通用评审维度JSON（仅作为补充框架；有JD时不得覆盖JD要求）:
{json.dumps(compact_criteria, ensure_ascii=False)}

简历全文:
---
{resume_content[:12000]}
---

只输出一个JSON对象，不要输出Markdown代码块或解释。JSON结构必须完全如下:
{{
  "match_score": 0,
  "match_grade": "A/B/C/D/E",
  "recommendation": "推荐面试/待定/建议淘汰/建议人工复核",
  "risk_level": "low/medium/high",
  "highlights": ["3个候选人亮点，每条不超过35字"],
  "concerns": ["3个主要短板或风险，每条不超过35字"],
  "recommendation_reason": "为什么给出该建议动作，80字以内",
  "candidate_profile_summary": "候选人画像摘要，80字以内",
  "candidate_basic_info": {{
    "age": "年龄，如简历未写则空字符串",
    "gender": "性别，如简历未写则空字符串",
    "education": "最高学历，如本科/硕士",
    "school": "毕业院校",
    "major": "专业",
    "graduation_year": "毕业年份/届别",
    "city": "所在城市或期望城市",
    "work_years": "工作年限/实习年限",
    "expected_salary": "期望薪资，如简历未写则空字符串"
  }},
  "key_gaps": ["候选人与JD的关键缺口，最多5条"],
  "knockout_reasons": ["如建议淘汰或复核，列出硬性不符/高风险原因，最多5条"],
  "score_breakdown": {{"jd_match": 0, "resume_quality": 0, "risk_control": 0, "evidence_confidence": 0}},
  "requirement_matches": [
    {{"requirement": "硬性要求", "status": "met/partial/missing/unknown", "evidence": "简历原文证据", "gap": "缺口或待确认点"}}
  ],
  "interview_questions": ["5个建议面试追问"],
  "communication_templates": {{
    "interview_invite": "约面邀请话术",
    "request_more_info": "补充材料请求话术",
    "rejection": "婉拒话术"
  }},
  "evidence_snippets": [
    {{"risk_type": "timeline/missing_info/credential/exaggeration/aigc/salary", "risk_label": "时间线矛盾/信息缺失/证书或学历疑点/夸大表述/AI痕迹/薪资预期不合理", "evidence": "简历原文短句", "finding": "基于原文的判断"}}
  ],
  "dimension_evaluations": {{
    "basic_info": {{"score": 0, "feedback": "...", "strengths": "...", "weaknesses": "...", "evidence_quotes": [{{"summary": "支持上面判断的总结语句", "evidence": "简历原文短句"}}]}},
    "format": {{"score": 0, "feedback": "...", "strengths": "...", "weaknesses": "...", "evidence_quotes": [{{"summary": "支持上面判断的总结语句", "evidence": "简历原文短句"}}]}},
    "work_logic": {{"score": 0, "feedback": "...", "strengths": "...", "weaknesses": "...", "evidence_quotes": [{{"summary": "支持上面判断的总结语句", "evidence": "简历原文短句"}}]}},
    "skill_match": {{"score": 0, "feedback": "...", "strengths": "...", "weaknesses": "...", "evidence_quotes": [{{"summary": "支持上面判断的总结语句", "evidence": "简历原文短句"}}]}},
    "risk_assessment": {{"score": 0, "feedback": "...", "strengths": "...", "weaknesses": "...", "evidence_quotes": [{{"summary": "支持上面判断的总结语句", "evidence": "简历原文短句"}}]}},
    "overall_impression": {{"score": 0, "feedback": "...", "strengths": "...", "weaknesses": "...", "evidence_quotes": [{{"summary": "支持上面判断的总结语句", "evidence": "简历原文短句"}}]}}
  }},
  "overall_evaluation": {{
    "overall_score": 0,
    "overall_grade": "A/B/C/D/E",
    "overall_feedback": "150字以内总评",
    "recommendations": ["建议1", "建议2", "建议3"]
  }}
}}

重要规则:
- 筛选优先级：本次岗位JD > 简历原文证据 > 通用评审维度/岗位模板。
- 如果提供了JD，必须先提炼JD中的硬性要求、核心职责、加分项和风险点，再判断候选人与这些要求的匹配程度。
- match_score 是“候选人与当前JD需求的接近程度”，越高表示越贴近JD；不要把简历写作质量、排版美观度当成主因。
- match_grade 必须由 match_score 决定：A=90-100，B=80-89，C=70-79，D=60-69，E=0-59。
- overall_evaluation.overall_score 是候选人综合实力分，综合考虑JD匹配、经历含金量、技能深度、风险可控、表达质量和成长潜力。
- overall_evaluation.overall_grade 必须由 overall_score 决定，用于HR按“综合实力”视角排序。
- 有JD时，match_score必须主要体现JD匹配度，而不是通用简历质量分；highlights、concerns、interview_questions也必须围绕JD展开。
- requirement_matches 必须覆盖筛选尺子中的硬性要求；缺少原文证据时 status 用 missing 或 unknown。
- score_breakdown 中 jd_match 是岗位匹配，resume_quality 是简历质量，risk_control 是风险可控程度，evidence_confidence 是证据充分度。
- recommendation_reason 必须能回答业务方“为什么推荐/为什么复核”。
- communication_templates 必须简洁礼貌，便于HR复制给候选人。
- candidate_basic_info 只能填写简历原文可推断的信息；年龄、性别等未写就留空，不要猜。
- 不得因为性别、年龄等敏感项自动淘汰候选人；这些仅作为HR人工辅助查看信息。
- 无JD时，才按岗位模板和通用中小企业初筛标准评估。
- 如果风险等级为high，不要直接给“建议淘汰”，优先给“建议人工复核”。
- 每个evidence_snippets必须引用简历原文短句，不能只有结论。
- 每个dimension_evaluations.*.evidence_quotes 必须引用简历原文，用来支撑该维度的 strengths/weaknesses/feedback，不要写模型解释。
- 不要因为候选人未覆盖JD中的“加分项”就直接淘汰；硬性要求缺失、关键经验不符或高风险证据才影响推荐动作。
"""
        response = self._invoke_llm_text(
            prompt_text,
            max_tokens=int(os.getenv("KIMI_SINGLE_PASS_MAX_TOKENS", "3200")),
        )
        raw_text = response["text"]
        input_tokens = response["input_tokens"]
        output_tokens = response["output_tokens"]
        accumulate_model_tokens(input_tokens, output_tokens)

        payload = self._extract_json_payload(raw_text)
        payload = self._normalize_decision_payload(payload)
        dimension_evals = {}
        raw_dimensions = payload.get("dimension_evaluations") or {}
        for key, info in criteria.items():
            raw_dimension = raw_dimensions.get(key) or {}
            dimension_evals[key] = self._validate_payload(
                resume_prompts.DimensionEvaluation,
                raw_dimension,
            )
            dimension_evidence = self._normalize_dimension_evidence(raw_dimension.get("evidence_quotes"))
            if not dimension_evidence:
                dimension_evidence = self._fallback_dimension_evidence(resume_content, key, raw_dimension)
            dimension_evals[key]["evidence_quotes"] = dimension_evidence

        overall_eval = self._validate_payload(
            resume_prompts.OverallEvaluation,
            payload.get("overall_evaluation") or {},
        )
        rounded_score = round(overall_eval["overall_score"])
        overall_eval["overall_score"] = rounded_score
        overall_eval["overall_grade"] = self._get_letter_grade(rounded_score)

        return {
            "match_score": payload["match_score"],
            "match_grade": payload["match_grade"],
            "recommendation": payload["recommendation"],
            "risk_level": payload["risk_level"],
            "highlights": payload["highlights"][:3],
            "concerns": payload["concerns"][:3],
            "jd_criteria": screening_ruler,
            "requirement_matches": payload["requirement_matches"],
            "score_breakdown": payload["score_breakdown"],
            "recommendation_reason": payload["recommendation_reason"],
            "candidate_profile_summary": payload["candidate_profile_summary"],
            "candidate_basic_info": payload["candidate_basic_info"],
            "key_gaps": payload["key_gaps"],
            "interview_questions": payload["interview_questions"][:5],
            "evidence_snippets": payload["evidence_snippets"],
            "dimension_evaluations": dimension_evals,
            "overall_evaluation": overall_eval,
        }, input_tokens + output_tokens

    def _evaluate_single_dimension(self, resume_content: str, criterion_key: str, criterion_info: Dict) -> tuple:
        prompt_template_str = self.dimension_prompt_template_str.replace('{discipline}', self.position_type)
        prompt_template_str = prompt_template_str.replace('论文', '简历').replace('学术论文', '求职简历')

        year_context = f"**背景信息：当前时间为{datetime.now().year}年。**\n\n"
        if f'{datetime.now().year}年' not in prompt_template_str:
            prompt_template_str = year_context + prompt_template_str

        prompt_template_str = prompt_template_str.replace('{criterion}', criterion_info["description"])
        prompt_template_str = prompt_template_str.replace('{aspects_str}', ", ".join(criterion_info["aspects"]))
        prompt_template_str = prompt_template_str.replace('{resume_content}', resume_content[:100000])

        prompt_template = ChatPromptTemplate.from_template(prompt_template_str)

        try:
            invoke_input = {
                "criterion": criterion_info["description"],
                "aspects_str": ", ".join(criterion_info["aspects"]),
                "resume_content": resume_content[:100000]
            }
            prompt_text = prompt_template.format_prompt(**invoke_input).to_string()
            result_dict, tokens = self._invoke_json_with_retry(
                prompt_text, resume_prompts.DimensionEvaluation, f"维度 '{criterion_key}'"
            )

            if not result_dict.get("feedback") or result_dict.get("score") is None:
                return {
                    "score": 50,
                    "feedback": f"该维度({criterion_info['description']})审查出现异常",
                    "strengths": "暂无法评估",
                    "weaknesses": "暂无法评估"
                }, tokens
            return result_dict, tokens
        except Exception as e:
            print(f"    [ERROR] 维度 '{criterion_key}' 审查失败: {e}")
            return {
                "score": 50,
                "feedback": f"该维度({criterion_info['description']})审查出现异常",
                "strengths": "暂无法评估",
                "weaknesses": "暂无法评估"
            }, 0

    def _generate_overall_evaluation(self, dimension_evaluations: Dict) -> tuple:
        prompt_template_str = self.overall_prompt_template_str.replace('{discipline}', self.position_type)
        prompt_template_str = prompt_template_str.replace('论文', '简历').replace('学术论文', '求职简历')
        prompt_template_str = prompt_template_str.replace('金融学', self.position_type)

        year_context = f"**背景信息：当前时间为{datetime.now().year}年。**\n\n"
        if f'{datetime.now().year}年' not in prompt_template_str:
            prompt_template_str = year_context + prompt_template_str

        prompt_template = ChatPromptTemplate.from_template(prompt_template_str)

        evaluations_summary = ""
        for key, value in dimension_evaluations.items():
            desc = self.criteria_data["evaluation_criteria"].get(key, {}).get("description", key)
            score = value.get('score', 0)
            evaluations_summary += f"- {desc}: {score}分\n"

        weaknesses_summary = ""
        sorted_dimensions = sorted(dimension_evaluations.items(), key=lambda x: x[1].get('score', 0))
        for key, value in sorted_dimensions:
            desc = self.criteria_data["evaluation_criteria"].get(key, {}).get("description", key)
            weaknesses = value.get('weaknesses', '').strip()
            if weaknesses and weaknesses != "暂无法评估":
                weaknesses_summary += f"- **{desc}**: {weaknesses}\n"
        if not weaknesses_summary.strip():
            weaknesses_summary = "各维度暂无明确的核心不足标注。"

        weights = {key: val["weight"] for key, val in self.criteria_data["evaluation_criteria"].items()}

        try:
            invoke_input = {
                "evaluations_summary": evaluations_summary,
                "weaknesses_summary": weaknesses_summary,
                "weights_str": json.dumps(weights, ensure_ascii=False)
            }
            prompt_text = prompt_template.format_prompt(**invoke_input).to_string()
            result_dict, tokens = self._invoke_json_with_retry(
                prompt_text, resume_prompts.OverallEvaluation, "总体评价"
            )

            if not result_dict.get("overall_feedback") or result_dict.get("overall_score") is None:
                total_score = sum(dimension_evaluations[key]['score'] * info['weight']
                                  for key, info in self.criteria_data["evaluation_criteria"].items())
                rounded_score = round(total_score)
                return {
                    "overall_score": rounded_score,
                    "overall_grade": self._get_letter_grade(rounded_score),
                    "overall_feedback": "根据各维度评估，简历主要存在以下问题：" + "；".join([
                        f"{self.criteria_data['evaluation_criteria'].get(k, {}).get('description', k)}方面{v.get('weaknesses', '有待改进')}"
                        for k, v in sorted_dimensions[:3]
                        if v.get('weaknesses') and v.get('weaknesses') not in ['暂无法评估', '']
                    ]),
                    "recommendations": ["请重点关注各维度中标注的不足之处"]
                }, tokens

            rounded_score = round(result_dict['overall_score'])
            result_dict['overall_score'] = rounded_score
            result_dict['overall_grade'] = self._get_letter_grade(rounded_score)
            return result_dict, tokens
        except Exception as e:
            print(f"    [ERROR] 生成综合评价失败: {e}")
            total_score = sum(dimension_evaluations[key]['score'] * info['weight']
                              for key, info in self.criteria_data["evaluation_criteria"].items())
            rounded_score = round(total_score)
            return {
                "overall_score": rounded_score,
                "overall_grade": self._get_letter_grade(rounded_score),
                "overall_feedback": "AI未能生成总体评价",
                "recommendations": ["请重点关注各维度中标注的不足之处"]
            }, 0

    def evaluate_resume(self, resume_path: str, job_description: str = "", cancel_check=None, progress_callback=None) -> Dict[str, Any]:
        print("\n" + "="*50)
        print(f"== 开始审查简历: {os.path.basename(resume_path)}")
        print(f"== 使用岗位模板: {self.position_type}")
        print("="*50)
        start_time = time.time()

        if cancel_check: cancel_check()

        if progress_callback:
            if job_description:
                progress_callback('parsing_jd', 18, '正在分析JD需求，生成本次岗位筛选尺子')
            else:
                progress_callback('preparing_criteria', 18, '未填写JD，正在准备通用初筛标准')
        jd_criteria = self.parse_jd_criteria(job_description)
        if job_description:
            print("\n[步骤 1/4] 已生成本次岗位筛选尺子。")

        if cancel_check: cancel_check()

        if progress_callback:
            progress_callback('reading_resume', 34, '正在读取并解析候选人简历')
        print("\n[步骤 2/4] 读取并解析简历...")
        try:
            structure = self.structure_extractor.extract(resume_path)
            body_texts = [
                s.text for s in structure.all_sections
                if s.section_type in {'body', 'personal_info_heading', 'section_heading'}
                and len(s.text.strip()) >= 10
            ]
            resume_content = "\n\n".join(body_texts)
            plain_content = self.document_reader.read(resume_path)
            if len(plain_content.strip()) > len(resume_content.strip()) * 1.05:
                resume_content = plain_content
                print("   ...结构化内容缺失较多，已切换为全文提取结果。")
            print(f"   ...完成。提取 {len(body_texts)} 段，共 {len(resume_content)} 字符。")
        except Exception as e:
            print(f"   ⚠ 结构化提取失败({e})，回退到简单提取...")
            resume_content = self.document_reader.read(resume_path)
            print(f"   ...完成。简单提取文本 {len(resume_content)} 字符。")

        if cancel_check: cancel_check()

        if (self.model_name or "").lower().startswith("kimi-"):
            print("\n[步骤 3/4] Kimi 使用单次紧凑评审...")
            try:
                if progress_callback:
                    progress_callback('matching', 56, '正在进行JD匹配评分和候选人初筛评估')
                result_json, total_tokens = self._evaluate_resume_single_pass(resume_content, job_description, jd_criteria)
                overall_eval = result_json["overall_evaluation"]
                if progress_callback:
                    progress_callback('structuring_result', 88, '正在整理推荐结果、风险证据和面试问题')
                print(f"   ...完成。(总分: {overall_eval['overall_score']})")
                end_time = time.time()
                print(f"\n== AI审查完成，耗时: {end_time - start_time:.2f}s，Token: {total_tokens}")
                return result_json, total_tokens
            except Exception as exc:
                print(f"   [WARNING] Kimi 单次评审失败，回退到分维度审查: {exc}")
                if cancel_check: cancel_check()

        print("\n[步骤 3/4] 开始分维度审查（并行）...")
        if progress_callback:
            progress_callback('scoring_dimensions', 56, '正在按JD和通用维度评估候选人质量')
        dimension_evals = {}
        total_tokens = 0
        criteria = self.criteria_data["evaluation_criteria"]

        def _eval_dim(key, info):
            try:
                result, tokens = self._evaluate_single_dimension(resume_content, key, info)
            except Exception as exc:
                print(f"   [WARNING] {info['description']} 审查失败，已使用兜底结果: {exc}")
                result = {
                    "dimension": info["description"],
                    "score": 50,
                    "feedback": f"该维度暂未完成自动审查，请人工复核。原因: {exc}",
                    "strengths": "待人工复核",
                    "weaknesses": "自动审查未完成",
                }
                tokens = 0
            result["evidence_quotes"] = self._fallback_dimension_evidence(resume_content, key, result)
            return key, result, tokens

        max_workers = min(len(criteria), int(os.getenv("EVALUATION_MAX_WORKERS", "1")))
        dimension_timeout = int(os.getenv("EVALUATION_DIMENSIONS_TIMEOUT", "420"))
        executor = ThreadPoolExecutor(max_workers=max_workers)
        try:
            futures = {executor.submit(_eval_dim, k, v): k for k, v in criteria.items()}
            for future in as_completed(futures, timeout=dimension_timeout):
                if cancel_check: cancel_check()
                key, result, tokens = future.result()
                dimension_evals[key] = result
                total_tokens += tokens
                print(f"   ✓ {criteria[key]['description']} (得分: {result['score']})")
                if progress_callback:
                    done = len(dimension_evals)
                    progress_callback('scoring_dimensions', min(78, 56 + int(done / max(1, len(criteria)) * 22)), f'正在评估维度 {done}/{len(criteria)}')
        except TimeoutError:
            print(f"   [WARNING] 分维度审查超过 {dimension_timeout}s，未完成维度已标记为人工复核。")
            for future, key in futures.items():
                if key in dimension_evals:
                    continue
                info = criteria[key]
                if not future.done():
                    future.cancel()
                dimension_evals[key] = {
                    "dimension": info["description"],
                    "score": 50,
                    "feedback": f"{info['description']}审查超时，请人工复核。",
                    "strengths": "待人工复核",
                    "weaknesses": "自动审查超时",
                }
                dimension_evals[key]["evidence_quotes"] = self._fallback_dimension_evidence(resume_content, key, dimension_evals[key])
        except TaskCancelledError:
            executor.shutdown(wait=False, cancel_futures=True)
            raise
        finally:
            executor.shutdown(wait=False)

        print("\n[步骤 4/4] 生成综合评价...")
        if progress_callback:
            progress_callback('structuring_result', 86, '正在整理推荐结果和推荐动作')
        if cancel_check: cancel_check()
        overall_eval, overall_tokens = self._generate_overall_evaluation(dimension_evals)
        total_tokens += overall_tokens
        print(f"   ...完成。(总分: {overall_eval['overall_score']})")

        end_time = time.time()
        print(f"\n== AI审查完成，耗时: {end_time - start_time:.2f}s，Token: {total_tokens}")

        decision_payload = self._normalize_decision_payload({
            "match_score": overall_eval.get("overall_score", 0),
            "risk_level": "high" if any(v.get("score", 100) < 55 for v in dimension_evals.values()) else "medium",
            "highlights": [v.get("strengths", "") for v in dimension_evals.values() if v.get("strengths")][:3],
            "concerns": [v.get("weaknesses", "") for v in dimension_evals.values() if v.get("weaknesses")][:3],
            "jd_criteria": jd_criteria,
            "requirement_matches": [],
            "score_breakdown": {
                "jd_match": overall_eval.get("overall_score", 0),
                "resume_quality": overall_eval.get("overall_score", 0),
                "risk_control": 60,
                "evidence_confidence": 60,
            },
            "recommendation_reason": "已按通用维度完成初筛；建议结合JD要求在面试中补充确认。",
            "key_gaps": [],
            "interview_questions": ["请候选人解释简历中最核心项目的个人贡献", "请候选人补充与岗位JD最匹配的案例"],
            "evidence_snippets": [],
            "overall_evaluation": overall_eval,
        })

        return {
            **decision_payload,
            "dimension_evaluations": dimension_evals,
            "overall_evaluation": overall_eval
        }, total_tokens


class _TeeStream:
    def __init__(self, *streams):
        self.streams = streams
    def write(self, data):
        for stream in self.streams:
            stream.write(data)
    def flush(self):
        for stream in self.streams:
            stream.flush()


def run_evaluation_in_background(app, db, resume_id: int, task_token: str):
    log_buffer = io.StringIO()
    original_stdout = sys.stdout
    sys.stdout = _TeeStream(original_stdout, log_buffer)

    print(f"\n[后台任务] 线程启动，准备审查简历 ID: {resume_id}")
    with app.app_context():
        from resume_models import Resume
        from .profile_resolver import resolve_profile_for_resume

        resume = db.session.get(Resume, resume_id)
        if not resume:
            print(f"[后台任务] [ERROR] 简历 ID: {resume_id} 不存在。")
            sys.stdout = original_stdout
            return

        try:
            ensure_task_active(db.session, resume, 'evaluation', task_token)

            def update_progress(stage: str, progress: int, message: str):
                ensure_task_active(db.session, resume, 'evaluation', task_token)
                resume.evaluation_stage = stage
                resume.evaluation_progress = max(0, min(99, int(progress)))
                resume.evaluation_status_message = message[:300]
                db.session.commit()

            update_progress('starting', 10, '评估任务已开始，正在准备岗位需求分析')
            profile, profile_config = resolve_profile_for_resume(db.session, resume)
            print(f"[后台任务] 使用模板: {profile.name} ({profile.position_type})")

            evaluator = ResumeEvaluator(profile_config=profile_config)
            result_json, total_tokens = evaluator.evaluate_resume(
                resume.resume_url,
                job_description=resume.job_description or "",
                cancel_check=lambda: ensure_task_active(db.session, resume, 'evaluation', task_token),
                progress_callback=update_progress,
            )

            ensure_task_active(db.session, resume, 'evaluation', task_token)

            resume.status = 'completed'
            resume.evaluation_stage = 'completed'
            resume.evaluation_progress = 100
            resume.evaluation_status_message = '评估完成，已生成候选人推荐和面试建议'
            resume.ai_result = result_json.get("match_grade") or result_json.get("overall_evaluation", {}).get("overall_grade", "N/A")
            resume.evaluation_result = result_json
            resume.evaluation_time = datetime.utcnow()
            resume.tokens_used = (resume.tokens_used or 0) + total_tokens
            resume.evaluation_error_message = None
            resume.evaluation_task_token = None
            if result_json.get("recommendation") == "推荐面试":
                resume.workflow_status = "shortlisted"
            elif result_json.get("recommendation") == "建议人工复核" or result_json.get("risk_level") == "high":
                resume.workflow_status = "needs_review"
            elif result_json.get("recommendation") == "建议淘汰":
                resume.workflow_status = "rejected"
            else:
                resume.workflow_status = resume.workflow_status or "new"

            db.session.commit()
            print(f"[后台任务] ✅ 简历 ID: {resume_id} 审查成功。")

        except TaskCancelledError as e:
            db.session.rollback()
            print(f"[后台任务] 简历 ID: {resume_id} 已终止: {e}")

        except Exception as e:
            from .document_reader import classify_file_error
            friendly_msg = classify_file_error(e)
            resume.status = 'failed'
            resume.evaluation_stage = 'failed'
            resume.evaluation_progress = 100
            resume.evaluation_status_message = friendly_msg
            resume.workflow_status = 'needs_review'
            resume.evaluation_error_message = friendly_msg
            resume.evaluation_task_token = None
            db.session.commit()
            print(f"[后台任务] [FATAL] 简历 ID: {resume_id} 审查失败: {e}")
            import traceback
            traceback.print_exc()
        finally:
            sys.stdout = original_stdout
            try:
                log_dir = os.path.dirname(resume.resume_url)
                os.makedirs(log_dir, exist_ok=True)
                log_path = os.path.join(log_dir, f"{resume_id}_review.log")
                with open(log_path, 'w', encoding='utf-8') as f:
                    f.write(log_buffer.getvalue())
                if can_attach_log(db.session, resume, 'evaluation', task_token):
                    resume.review_log_url = log_path
            except Exception:
                pass
            db.session.commit()
