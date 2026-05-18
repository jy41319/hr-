import io
import os
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError
from typing import Dict, Any, Optional, Type
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from openai import OpenAI
from pydantic import ValidationError
from datetime import datetime

from .document_reader import get_document_reader
from .llm_config import normalize_temperature
from .resume_structure import get_resume_structure_extractor, save_structure_debug
from .token_counter import count_tokens, accumulate_model_tokens, extract_token_usage
from . import resume_prompts
from task_control import TaskCancelledError, can_attach_log, ensure_task_active

dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_path)


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
        # Kimi K2.6 may spend part of the completion budget on reasoning tokens
        # before emitting the final JSON, so the default must leave enough room.
        self.response_max_tokens = int(os.getenv("LLM_RESPONSE_MAX_TOKENS", "2400"))

        llm_kwargs = {}
        if self.enable_thinking:
            llm_kwargs['model_kwargs'] = {"extra_body": {"enable_thinking": True}}

        self.llm = ChatOpenAI(
            model_name=self.model_name,
            openai_api_key=self.api_key,
            openai_api_base=self.api_base,
            temperature=normalize_temperature(self.model_name, 0.5),
            timeout=self.request_timeout,
            max_tokens=self.response_max_tokens,
            **llm_kwargs,
        )

        if self.enable_thinking:
            self.llm_structured = ChatOpenAI(
                model_name=self.model_name,
                openai_api_key=self.api_key,
                openai_api_base=self.api_base,
                temperature=normalize_temperature(self.model_name, 0.5),
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

    def _invoke_llm_text(self, prompt_text: str, max_tokens: Optional[int] = None) -> Dict[str, Any]:
        completion_limit = max_tokens or self.response_max_tokens
        if (self.model_name or "").lower().startswith("kimi-"):
            client = OpenAI(
                api_key=self.api_key,
                base_url=self.api_base,
                timeout=self.request_timeout,
                max_retries=1,
            )
            completion = client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": prompt_text}],
                temperature=normalize_temperature(self.model_name, 0.5),
                max_tokens=completion_limit,
            )
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
        payload["recommendation"] = recommendation
        payload["risk_level"] = risk_level
        payload["highlights"] = self._normalize_list(payload.get("highlights"), ["暂无明确亮点"])
        payload["concerns"] = self._normalize_list(payload.get("concerns"), ["暂无明确短板"])
        payload["interview_questions"] = self._normalize_list(payload.get("interview_questions"), ["请候选人补充说明简历中的关键经历"],)[:5]
        payload["evidence_snippets"] = self._normalize_evidence(payload.get("evidence_snippets"))
        return payload

    def _evaluate_resume_single_pass(self, resume_content: str, job_description: str = "") -> tuple:
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
        prompt_text = f"""你是一位资深HR简历审查专家。请基于当前日期 {datetime.now().strftime('%Y-%m-%d')} 审查这份求职简历。
产品目标：帮助中小企业HR在5分钟内完成批量初筛、风险识别、候选人排序和面试建议。

岗位JD/需求:
---
{jd_block[:6000]}
---

评审维度JSON:
{json.dumps(compact_criteria, ensure_ascii=False)}

简历全文:
---
{resume_content[:12000]}
---

只输出一个JSON对象，不要输出Markdown代码块或解释。JSON结构必须完全如下:
{{
  "match_score": 0,
  "recommendation": "推荐面试/待定/建议淘汰/建议人工复核",
  "risk_level": "low/medium/high",
  "highlights": ["3个候选人亮点，每条不超过35字"],
  "concerns": ["3个主要短板或风险，每条不超过35字"],
  "interview_questions": ["5个建议面试追问"],
  "evidence_snippets": [
    {{"risk_type": "timeline/missing_info/credential/exaggeration/aigc/salary", "risk_label": "时间线矛盾/信息缺失/证书或学历疑点/夸大表述/AI痕迹/薪资预期不合理", "evidence": "简历原文短句", "finding": "基于原文的判断"}}
  ],
  "dimension_evaluations": {{
    "basic_info": {{"score": 0, "feedback": "...", "strengths": "...", "weaknesses": "..."}},
    "format": {{"score": 0, "feedback": "...", "strengths": "...", "weaknesses": "..."}},
    "work_logic": {{"score": 0, "feedback": "...", "strengths": "...", "weaknesses": "..."}},
    "skill_match": {{"score": 0, "feedback": "...", "strengths": "...", "weaknesses": "..."}},
    "risk_assessment": {{"score": 0, "feedback": "...", "strengths": "...", "weaknesses": "..."}},
    "overall_impression": {{"score": 0, "feedback": "...", "strengths": "...", "weaknesses": "..."}}
  }},
  "overall_evaluation": {{
    "overall_score": 0,
    "overall_grade": "A/B/C/D/E",
    "overall_feedback": "150字以内总评",
    "recommendations": ["建议1", "建议2", "建议3"]
  }}
}}

重要规则:
- 如果风险等级为high，不要直接给“建议淘汰”，优先给“建议人工复核”。
- 每个evidence_snippets必须引用简历原文短句，不能只有结论。
- 如果提供了JD，match_score必须体现JD匹配度，而不是通用简历质量分。
"""
        response = self._invoke_llm_text(
            prompt_text,
            max_tokens=int(os.getenv("KIMI_SINGLE_PASS_MAX_TOKENS", "5000")),
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

        overall_eval = self._validate_payload(
            resume_prompts.OverallEvaluation,
            payload.get("overall_evaluation") or {},
        )
        rounded_score = round(overall_eval["overall_score"])
        overall_eval["overall_score"] = rounded_score
        overall_eval["overall_grade"] = self._get_letter_grade(rounded_score)

        return {
            "match_score": payload["match_score"],
            "recommendation": payload["recommendation"],
            "risk_level": payload["risk_level"],
            "highlights": payload["highlights"][:3],
            "concerns": payload["concerns"][:3],
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

    def evaluate_resume(self, resume_path: str, job_description: str = "", cancel_check=None) -> Dict[str, Any]:
        print("\n" + "="*50)
        print(f"== 开始审查简历: {os.path.basename(resume_path)}")
        print(f"== 使用岗位模板: {self.position_type}")
        print("="*50)
        start_time = time.time()

        if cancel_check: cancel_check()

        print("\n[步骤 1/4] 读取并解析简历...")
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
            print("\n[步骤 2/4] Kimi K2.6 使用单次紧凑评审...")
            try:
                result_json, total_tokens = self._evaluate_resume_single_pass(resume_content, job_description)
                overall_eval = result_json["overall_evaluation"]
                print(f"   ...完成。(总分: {overall_eval['overall_score']})")
                end_time = time.time()
                print(f"\n== AI审查完成，耗时: {end_time - start_time:.2f}s，Token: {total_tokens}")
                return result_json, total_tokens
            except Exception as exc:
                print(f"   [WARNING] Kimi 单次评审失败，回退到分维度审查: {exc}")
                if cancel_check: cancel_check()

        print("\n[步骤 2/4] 开始分维度审查（并行）...")
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
        except TaskCancelledError:
            executor.shutdown(wait=False, cancel_futures=True)
            raise
        finally:
            executor.shutdown(wait=False)

        print("\n[步骤 3/4] 生成综合评价...")
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

            profile, profile_config = resolve_profile_for_resume(db.session, resume)
            print(f"[后台任务] 使用模板: {profile.name} ({profile.position_type})")

            evaluator = ResumeEvaluator(profile_config=profile_config)
            result_json, total_tokens = evaluator.evaluate_resume(
                resume.resume_url,
                job_description=resume.job_description or "",
                cancel_check=lambda: ensure_task_active(db.session, resume, 'evaluation', task_token)
            )

            ensure_task_active(db.session, resume, 'evaluation', task_token)

            resume.status = 'completed'
            resume.ai_result = result_json.get("overall_evaluation", {}).get("overall_grade", "N/A")
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
