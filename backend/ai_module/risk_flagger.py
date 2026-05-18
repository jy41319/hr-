"""
简历风险标记器 - 检测简历中的各类风险
"""
import os
import io
import sys
import json
from typing import Dict, Any, List, Tuple
from datetime import datetime
from pydantic import ValidationError

from .resume_evaluator import ResumeEvaluator
from .token_counter import accumulate_model_tokens, extract_token_usage
from .document_reader import get_document_reader
from . import resume_prompts
from task_control import TaskCancelledError, can_attach_log, ensure_task_active


class RiskFlagger:
    """
    简历风险标记器
    检测5类风险：时间矛盾/夸大表述/关键信息缺失/格式问题/AIGC痕迹
    """

    def __init__(self, profile_config: Dict[str, Any] = None):
        self.ai_evaluator = ResumeEvaluator(profile_config)
        self.llm = self.ai_evaluator.llm
        self.llm_structured = self.ai_evaluator.llm_structured
        self.document_reader = get_document_reader()

    def _get_response_text(self, response: Any) -> str:
        content = getattr(response, "content", response)
        if isinstance(content, str):
            return content.strip()
        return str(content).strip()

    def _extract_json_payload(self, raw_text: str) -> Dict[str, Any]:
        import re
        text = raw_text.strip()
        if not text:
            raise ValueError("模型返回为空")
        fenced_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL | re.IGNORECASE)
        if fenced_match:
            text = fenced_match.group(1).strip()
        elif not text.startswith("{"):
            start = text.find("{")
            end = text.rfind("}")
            if start == -1 or end == -1:
                raise ValueError("未找到JSON")
            text = text[start:end + 1]
        return json.loads(text)

    def flag_risks(self, resume_content: str) -> Tuple[List[Dict[str, Any]], int]:
        """
        对简历内容进行风险标记

        Returns:
            (风险列表, tokens_used)
        """
        prompt = f"""**背景信息：当前时间为{datetime.now().year}年。**

你是一位资深HR风险识别专家。请仔细审查以下简历内容，识别其中的各类风险。

**简历内容:**
---
{resume_content[:80000]}
---

**请识别以下5类风险:**

1. **时间矛盾 (timeline)**:
   - 工作/学历时间重叠
   - 时间顺序混乱
   - 工作年限与年龄不符
   - 学历时间与工作时间矛盾

2. **夸大表述 (exaggeration)**:
   - 明显夸大能力（如"精通10种编程语言"）
   - 虚构业绩数据
   - 过度自我吹嘘
   - 与常理不符的描述

3. **关键信息缺失 (missing_info)**:
   - 缺少联系方式（电话/邮箱）
   - 缺少学历信息
   - 缺少关键工作细节
   - 缺少求职意向

4. **格式问题 (format)**:
   - 错别字/语法错误
   - 标点符号不规范
   - 排版混乱
   - 篇幅过长或过短

5. **AI生成痕迹 (aigc)**:
   - 语言过于模板化
   - 句式结构重复
   - 缺乏个人特色表述
   - 内容笼统缺乏细节

**严重程度:**
- critical: 严重影响简历可信度，如明显造假
- major: 较大问题，如时间重叠、关键信息缺失
- moderate: 中等问题，如夸大表述、格式混乱
- minor: 小问题，如个别错别字

请严格按照JSON格式返回风险列表。如果没有发现某类风险，不要强行标记。
```json
{{
    "flags": [
        {{
            "risk_type": "timeline",
            "severity": "major",
            "detail": "2022-2023年工作和2023-2024年工作时间重叠",
            "location": "工作经历第2段",
            "suggestion": "请候选人解释时间重叠原因"
        }}
    ]
}}
```
"""

        try:
            response = self.llm.invoke(prompt)
            raw_text = self._get_response_text(response)
            input_tokens, output_tokens = extract_token_usage(response, prompt, raw_text)
            tokens = input_tokens + output_tokens
            accumulate_model_tokens(input_tokens, output_tokens)

            try:
                payload = self._extract_json_payload(raw_text)
                validated = resume_prompts.BatchRiskFlagResult.model_validate(payload)
                return [flag.dict() for flag in validated.flags], tokens
            except (json.JSONDecodeError, ValidationError, ValueError) as exc:
                print(f"[WARNING] 风险标记JSON解析失败: {exc}")
                return [], tokens

        except Exception as e:
            print(f"[ERROR] 风险标记失败: {e}")
            return [], 0

    def flag_document(self, doc_path: str, resume_id: int, db_session: Any, cancel_check=None) -> Tuple[List[Dict[str, Any]], int]:
        """
        对简历文档进行风险标记

        Returns:
            (风险列表, tokens_used)
        """
        print(f"\n{'='*60}")
        print(f"开始风险标记: {os.path.basename(doc_path)}")
        print(f"{'='*60}\n")

        if cancel_check: cancel_check()

        print("[步骤 1/2] 读取简历内容...")
        try:
            resume_content = self.document_reader.read(doc_path)
            print(f"✅ 读取完成，共 {len(resume_content)} 字符\n")
        except Exception as e:
            print(f"⚠ 读取失败: {e}\n")
            return [], 0

        if cancel_check: cancel_check()

        print("[步骤 2/2] 开始风险标记...")
        flags, tokens = self.flag_risks(resume_content)

        risk_counts = {}
        for flag in flags:
            rt = flag.get('risk_type', 'unknown')
            risk_counts[rt] = risk_counts.get(rt, 0) + 1

        print(f"\n✅ 风险标记完成:")
        for rt, count in risk_counts.items():
            print(f"   - {rt}: {count} 处")
        print(f"   总计: {len(flags)} 处风险\n")

        if cancel_check: cancel_check()

        print("[保存] 保存风险标记到数据库...")
        from resume_models import RiskFlag
        RiskFlag.query.filter_by(resume_id=resume_id).delete()

        for flag in flags:
            risk_flag = RiskFlag(
                resume_id=resume_id,
                risk_type=flag.get('risk_type', 'unknown'),
                severity=flag.get('severity', 'minor'),
                detail=flag.get('detail', ''),
                location=flag.get('location', ''),
                suggestion=flag.get('suggestion', '')
            )
            db_session.add(risk_flag)

        db_session.commit()
        print(f"✅ 已保存 {len(flags)} 条风险标记\n")

        return flags, tokens


class _TeeStream:
    def __init__(self, *streams):
        self.streams = streams
    def write(self, data):
        for s in self.streams: s.write(data)
    def flush(self):
        for s in self.streams: s.flush()


def run_risk_flagging_in_background(app, db, resume_id: int, task_token: str):
    log_buffer = io.StringIO()
    original_stdout = sys.stdout
    sys.stdout = _TeeStream(original_stdout, log_buffer)

    print(f"\n[后台任务] 开始风险标记，简历 ID: {resume_id}")

    with app.app_context():
        from resume_models import Resume
        from .profile_resolver import resolve_profile_for_resume

        resume = db.session.get(Resume, resume_id)
        if not resume:
            sys.stdout = original_stdout
            return

        try:
            ensure_task_active(db.session, resume, 'risk_flagging', task_token)
            resume.risk_flagging_status = 'processing'
            db.session.commit()

            profile, profile_config = resolve_profile_for_resume(db.session, resume)
            flagger = RiskFlagger(profile_config=profile_config)
            flags, total_tokens = flagger.flag_document(
                resume.resume_url, resume.id, db.session,
                cancel_check=lambda: ensure_task_active(db.session, resume, 'risk_flagging', task_token)
            )

            ensure_task_active(db.session, resume, 'risk_flagging', task_token)
            resume.risk_flagging_status = 'completed'
            resume.risk_flag_count = len(flags)
            resume.tokens_used = (resume.tokens_used or 0) + total_tokens
            resume.risk_flagging_error_message = None
            resume.risk_flagging_task_token = None
            db.session.commit()
            print(f"[后台任务] ✅ 简历 ID: {resume_id} 风险标记完成。")

        except TaskCancelledError as e:
            db.session.rollback()
            print(f"[后台任务] 简历 ID: {resume_id} 已终止: {e}")

        except Exception as e:
            from .document_reader import classify_file_error
            friendly_msg = classify_file_error(e)
            resume.risk_flagging_status = 'failed'
            resume.risk_flagging_error_message = friendly_msg
            resume.risk_flagging_task_token = None
            db.session.commit()
            print(f"[后台任务] [FATAL] 简历 ID: {resume_id} 风险标记失败: {e}")
        finally:
            sys.stdout = original_stdout
            try:
                log_dir = os.path.dirname(resume.resume_url)
                os.makedirs(log_dir, exist_ok=True)
                log_path = os.path.join(log_dir, f"{resume_id}_risk_flagging.log")
                with open(log_path, 'w', encoding='utf-8') as f:
                    f.write(log_buffer.getvalue())
            except Exception:
                pass
            db.session.commit()