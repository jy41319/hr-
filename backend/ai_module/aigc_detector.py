"""
AIGC 检测器 - 检测简历中的 AI 生成内容
"""
import json
import os
import io
import sys
from typing import List, Dict, Any, Tuple
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from docx import Document

try:
    import fitz
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False

from .resume_evaluator import ResumeEvaluator
from .token_counter import TokenAccumulator, accumulate_model_tokens, extract_token_usage
from .resume_structure import get_resume_structure_extractor, save_structure_debug
from . import resume_prompts
from task_control import TaskCancelledError, can_attach_log, ensure_task_active
    reason: str = Field(description="判断理由")
    suspicious_features: List[str] = Field(description="可疑特征列表")


class AigcDetector:
    """
    AIGC 检测器
    检测简历中的 AI 生成内容（2-4个段落为一组）
    """

    def __init__(self, profile_config: Dict[str, Any] = None):
        """初始化检测器"""
        self.ai_evaluator = ResumeEvaluator(profile_config)
        self.llm = self.ai_evaluator.llm
        self.llm_structured = self.ai_evaluator.llm_structured
        self.position_type = self.ai_evaluator.position_type
        self.structure_extractor = get_resume_structure_extractor()

    def detect_segments_batch(
        self,
        segments: List[Tuple[int, str, int, int]]
    ) -> Tuple[List[Dict[str, Any]], int]:
        """
        批量检测多个段落组

        Args:
            segments: 段落组列表，每个元素为 (段落组索引, 段落组文本, 起始段落索引, 结束段落索引)

        Returns:
            (检测结果列表, tokens_used)
        """
        if not segments:
            return [], 0

        # 构建批量检测的 prompt
        segments_text = ""
        for i, (idx, text, start, end) in enumerate(segments):
            segments_text += f"\n**段落组 {i} (索引 {idx}, 段落 {start}-{end}):**\n{text}\n"

        prompt = f"""**背景信息：当前时间为{datetime.now().year}年。请在检测中以此为时间参照。**

你是一位专业的 AIGC 检测专家。请分析以下 {len(segments)} 个段落组是否由 AI 生成。

**重要：检测范围仅限简历正文部分。** 请忽略以下非正文内容，不要对其进行 AIGC 检测判断：
- 标题（Title）
- 摘要（Abstract）
- 关键词（Keywords）
- 目录（Table of Contents）
- 致谢（Acknowledgments）
- 参考文献（References / Bibliography）
- 附录（Appendix）
如果提供的段落组中包含上述非正文内容，请将其 aigc_probability 设为 0，confidence 设为 low，并在 reason 中说明"该段落属于非正文部分（如标题/摘要/致谢/参考文献等），不纳入 AIGC 检测范围"。

{segments_text}

**检测标准（重要）**：

1. **句式结构分析**：
   - ✅ AI特征：过于规范、重复的模板化句式
   - ✅ AI特征：每段开头都是"首先...其次...最后..."等固定模式
   - ❌ 人类特征：句式灵活多变，有长短句交替

2. **内容深度分析**：
   - ✅ AI特征：缺乏具体数据、案例和细节
   - ✅ AI特征：大量笼统表述和套话
   - ❌ 人类特征：有具体的数据引用、案例分析

3. **逻辑连贯性**：
   - ✅ AI特征：逻辑跳跃，段落间衔接生硬
   - ✅ AI特征：内容重复，换个说法重复同一观点
   - ❌ 人类特征：逻辑严密，论证充分

4. **专业术语使用**：
   - ✅ AI特征：堆砌术语但缺乏深入解释
   - ✅ AI特征：术语使用不够准确或过于泛化
   - ❌ 人类特征：术语使用准确且有深度解释

5. **数据和引用**：
   - ✅ AI特征：缺少具体数据来源
   - ✅ AI特征：数据引用格式不规范或过于笼统
   - ❌ 人类特征：有明确的数据来源和引用

6. **个人见解和创新**：
   - ✅ AI特征：缺乏独特观点和批判性思考
   - ✅ AI特征：全是综述性内容，无个人分析
   - ❌ 人类特征：有独立思考和创新性观点

**重要提示**：
- 不要因为内容"写得好"就判断为 AI
- 不要因为有语法错误就排除 AI 可能
- 综合多个维度判断，单一特征不足以下结论
- 置信度判断：
  * high: 多个维度都有明显 AI 特征
  * medium: 部分维度有 AI 特征
  * low: 仅少数维度有轻微 AI 特征

**输出格式**：
- 必须为每个段落组返回一个检测结果
- segment_index 必须对应输入的段落组索引
- aigc_probability: 0-100 的数值
- confidence: low/medium/high
- reason: 详细的判断依据（至少50字）
- suspicious_features: 具体的可疑特征列表

请严格按照 JSON 格式输出检测结果，确保返回 {len(segments)} 个段落组的检测。
"""

        try:
            structured_llm = self.llm_structured.with_structured_output(resume_prompts.BatchAigcResult, include_raw=True)
            raw_resp = structured_llm.invoke(prompt)
            result = raw_resp['parsed']
            result_list = result.results

            # 从 API 响应提取真实 token 用量，兜底 tiktoken 估算
            output_text_est = str([r.dict() for r in result_list])
            input_tokens, output_tokens = extract_token_usage(raw_resp.get('raw'), prompt, output_text_est)
            tokens = input_tokens + output_tokens
            accumulate_model_tokens(input_tokens, output_tokens)

            # 单段落组时直接使用第一个结果（避免 LLM 返回的 segment_index 与实际 idx 不匹配）
            if len(segments) == 1 and len(result_list) >= 1:
                detection = result_list[0].dict()
                detection['segment_index'] = segments[0][0]  # 强制使用正确的 idx
                return [detection], tokens

            # 批量时：创建索引映射
            result_dict = {r.segment_index: r for r in result_list}

            # 确保每个段落组都有检测结果
            final_results = []
            for i, (idx, text, start, end) in enumerate(segments):
                if idx in result_dict:
                    detection = result_dict[idx].dict()
                else:
                    # 如果 AI 没有返回该段落组的检测，使用默认值
                    detection = {
                        'segment_index': idx,
                        'aigc_probability': 0.0,
                        'confidence': 'low',
                        'reason': '检测未完成，建议人工复核',
                        'suspicious_features': []
                    }

                # 确保 reason 不为空
                if not detection.get('reason') or detection['reason'].strip() == '':
                    detection['reason'] = '该段落组表述正常，未发现明显AI生成特征'

                # 确保 suspicious_features 是列表
                if not isinstance(detection.get('suspicious_features'), list):
                    detection['suspicious_features'] = []

                final_results.append(detection)

            return final_results, tokens

        except Exception as e:
            print(f"[ERROR] 批量段落组检测失败: {e}")
            import traceback
            traceback.print_exc()
            # 返回默认值
            return [{
                'segment_index': idx,
                'aigc_probability': 0.0,
                'confidence': 'low',
                'reason': f'检测过程出错: {str(e)}',
                'suspicious_features': []
            } for idx, _, _, _ in segments], 0

    # 非正文段落的关键词模式（用于在提取阶段过滤）
    _NON_BODY_PATTERNS = [
        # 标题 / 封面信息
        '本科毕业论文', '本科毕业设计', '硕士学位论文', '博士学位论文',
        '学位论文', '毕业论文', '毕业设计',
        '学号', '学院', '指导教师', '指导老师', '专业名称', '提交日期',
        '答辩日期', '学位授予',
        # 摘要 / 关键词
        '摘要', 'abstract', '关键词', 'keywords', 'key words',
        # 目录
        '目录', 'table of contents', 'contents',
        # 致谢 / 声明
        '致谢', '致  谢', '鸣谢', 'acknowledgment', 'acknowledgement',
        '诚信声明', '原创性声明', '学术诚信', '学术声明', '独创性声明',
        '学位论文使用授权', '使用授权声明', '版权声明',
        # 参考文献
        '参考文献', 'references', 'bibliography',
        # 附录
        '附录', 'appendix', 'appendices',
    ]

    # 目录摘要条目的典型模式：
    # "第X章：标题。本章首先/主要/基于..." 或 "第X章 标题 本章..."
    _TOC_ENTRY_RE = None  # 延迟编译

    def _is_non_body_paragraph(self, text: str) -> bool:
        """判断段落是否为非正文内容（标题、致谢、声明、目录摘要等）"""
        import re
        text_lower = text.lower().strip()
        # 短段落且匹配关键词 → 视为标题/节标记
        if len(text) < 40:
            for pattern in self._NON_BODY_PATTERNS:
                if pattern in text_lower:
                    return True
        # 目录摘要条目：以"第X章"开头，同段内包含"本章"概述性描述
        if AigcDetector._TOC_ENTRY_RE is None:
            AigcDetector._TOC_ENTRY_RE = re.compile(
                r'^第[一二三四五六七八九十\d]+章[：:\s].{2,20}[。.].{0,10}本章'
            )
        if self._TOC_ENTRY_RE.match(text):
            return True
        return False

    def extract_paragraphs(self, doc_path: str, structure=None) -> List[str]:
        """
        从简历文档中提取正文段落
        """
        structure = structure or self.structure_extractor.extract(doc_path)
        paragraphs = []
        for section in structure.all_sections:
            if section.section_type in {'page_marker'}:
                continue
            if len(section.text.strip()) < 20:
                continue
            paragraphs.append(section.text)

        print(
            "[AIGC检测] 提取段落: "
            f"总共 {len(structure.all_sections)} 段, "
            f"最终 {len(paragraphs)} 段"
        )

        return paragraphs

    def extract_paragraphs_from_pdf(self, doc_path: str) -> List[str]:
        """
        从 PDF 文档中提取正文段落，过滤非正文内容

        Args:
            doc_path: PDF 文档路径

        Returns:
            正文段落列表
        """
        if not HAS_FITZ:
            raise ImportError("PyMuPDF (fitz) 未安装，无法处理 PDF 文件")

        import re
        doc = fitz.open(doc_path)
        all_paragraphs = []

        for page in doc:
            page_text = page.get_text("text", sort=True)
            raw_lines = page_text.split('\n')
            current_lines = []

            def _flush():
                if not current_lines:
                    return
                text = ''.join(current_lines).strip()
                if len(text) < 10:
                    return
                all_paragraphs.append(text)

            for line in raw_lines:
                stripped = line.strip()
                if not stripped:
                    _flush()
                    current_lines = []
                    continue
                is_indent = (
                    line.startswith('\u3000') or
                    line.startswith('    ') or
                    line.startswith('\t')
                )
                if is_indent and current_lines:
                    _flush()
                    current_lines = []
                current_lines.append(stripped)

            _flush()
            current_lines = []

        doc.close()

        if not all_paragraphs:
            return []

        # Apply body-start and body-end detection (same logic as docx version)
        body_start_re = re.compile(r'^(第[一二三四五六七八九十1-9]章|1[\.\s])')
        body_start_re2 = re.compile(r'^(一[、.\s]|引言|绪论|前言|导论|introduction)', re.IGNORECASE)

        body_start = 0
        for i, text in enumerate(all_paragraphs):
            if body_start_re.match(text) or body_start_re2.match(text):
                body_start = i
                break

        # Find body end
        end_keywords = ['致谢', '致  谢', '鸣谢', '参考文献', 'references',
                        'bibliography', '附录', 'appendix',
                        '诚信声明', '原创性声明']
        body_end = len(all_paragraphs)
        for i in range(len(all_paragraphs) - 1, body_start, -1):
            text_lower = all_paragraphs[i].lower().strip()
            if len(all_paragraphs[i]) < 40:
                for kw in end_keywords:
                    if kw in text_lower:
                        body_end = i
                        break

        # Filter within body range
        paragraphs = []
        for text in all_paragraphs[body_start:body_end]:
            if self._is_non_body_paragraph(text):
                continue
            paragraphs.append(text)

        print(f"[AIGC检测] PDF提取: 总共 {len(all_paragraphs)} 段, 正文范围 [{body_start}:{body_end}], 最终 {len(paragraphs)} 段")
        for idx, p in enumerate(paragraphs[:3]):
            print(f"  段落[{idx}]: {p[:80]}{'...' if len(p) > 80 else ''}")

        return paragraphs

    def group_paragraphs(self, paragraphs: List[str], group_size_range=(2, 4)) -> List[Tuple[int, str, int, int]]:
        """
        将段落分组（2-4个段落一组）

        Args:
            paragraphs: 段落列表
            group_size_range: 分组大小范围 (最小, 最大)

        Returns:
            段落组列表，每个元素为 (段落组索引, 段落组文本, 起始段落索引, 结束段落索引)
        """
        min_size, max_size = group_size_range
        groups = []
        segment_index = 0
        i = 0

        while i < len(paragraphs):
            # 动态确定本组的大小（2-4个段落）
            remaining = len(paragraphs) - i
            if remaining <= max_size:
                group_size = remaining
            else:
                # 优先选择3个段落，如果剩余不够就选2个
                group_size = min(3, remaining)

            # 提取段落组
            start_idx = i
            end_idx = i + group_size
            group_paragraphs = paragraphs[start_idx:end_idx]
            group_text = "\n\n".join(group_paragraphs)

            groups.append((segment_index, group_text, start_idx, end_idx - 1))
            segment_index += 1
            i = end_idx

        return groups

    def detect_document(
        self,
        doc_path: str,
        paper_id: int,
        db_session: Any,
        cancel_check=None,
    ) -> Tuple[List[Dict[str, Any]], float, int, int]:
        """
        检测整个文档

        Args:
            doc_path: 文档路径
            paper_id: 论文 ID
            db_session: 数据库会话

        Returns:
            (检测结果列表, 整体分数, 高风险段落组数量, tokens_used)
        """
        print(f"\n{'='*60}")
        print(f"开始 AIGC 检测: {os.path.basename(doc_path)}")
        print(f"{'='*60}\n")

        if cancel_check:
            cancel_check()

        # 1. 提取段落
        print("[步骤 1/4] 提取文档段落...")
        structure = self.structure_extractor.extract(doc_path)
        debug_dir = os.path.join(os.path.dirname(doc_path), 'debug')
        debug_path = os.path.join(debug_dir, f'paper_{paper_id}_structure_debug.json')
        save_structure_debug(structure, debug_path)
        paragraphs = self.extract_paragraphs(doc_path, structure=structure)
        print(f"✅ 共提取 {len(paragraphs)} 个有效段落\n")

        if cancel_check:
            cancel_check()

        # 将有效正文段落数写入 debug JSON，便于前端显示格式警告
        if os.path.exists(debug_path):
            try:
                with open(debug_path, 'r', encoding='utf-8') as f:
                    debug_data = json.load(f)
                debug_data['filteredBodyCount'] = len(paragraphs)
                if len(paragraphs) < 10:
                    debug_data['formatWarning'] = f'正文段落仅 {len(paragraphs)} 段，论文格式可能存在问题，请检查文档结构（目录可能被误识别为正文）'
                with open(debug_path, 'w', encoding='utf-8') as f:
                    json.dump(debug_data, f, ensure_ascii=False, indent=2)
            except Exception:
                pass

        # 2. 分组（2-4个段落一组）
        print("[步骤 2/4] 分组段落（2-4个一组）...")
        segments = self.group_paragraphs(paragraphs)
        print(f"✅ 共分成 {len(segments)} 个段落组\n")

        if cancel_check:
            cancel_check()

        # 3. 多线程批量检测
        print("[步骤 3/4] 开始多线程批量检测...")
        detections = []

        # Token 累加器（线程安全）
        token_acc = TokenAccumulator()

        # 定义批次处理函数
        def process_segment(segment_info):
            idx, text, start, end = segment_info
            try:
                # 单个段落组检测
                result, seg_tokens = self.detect_segments_batch([segment_info])
                token_acc.add(seg_tokens)
                return (idx, result[0] if result else None, None)
            except Exception as e:
                return (idx, None, str(e))

        # 使用线程池并行处理
        # 从系统设置读取线程数
        try:
            from models import SystemSettings
            _s = SystemSettings.query.filter_by(key='aigc_detect_threads').first()
            _max_threads = max(1, int(_s.value)) if _s else 30
        except Exception:
            _max_threads = 30
        print(f"   使用 {_max_threads} 个线程并行处理...")

        completed_count = 0
        results_dict = {}
        executor = ThreadPoolExecutor(max_workers=_max_threads)
        try:
            # 提交所有任务
            future_to_segment = {executor.submit(process_segment, seg): seg for seg in segments}

            # 收集结果
            for future in as_completed(future_to_segment):
                if cancel_check:
                    cancel_check()
                idx, result, error = future.result()
                if result:
                    results_dict[idx] = result

                completed_count += 1
                if error:
                    print(f"\n   ✗ 段落组 {idx + 1}/{len(segments)} 失败: {error}")
                else:
                    prob = result.get('aigc_probability', 0) if result else 0
                    print(f"\n   ✓ 段落组 {idx + 1}/{len(segments)} - AIGC概率: {prob:.1f}%")

                # 显示进度
                progress = (completed_count / len(segments)) * 100
                print(f"   进度: {completed_count}/{len(segments)} ({progress:.1f}%)", end='\r')
        except TaskCancelledError:
            executor.shutdown(wait=False, cancel_futures=True)
            raise
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

        # 按顺序合并结果
        for idx, text, start, end in segments:
            if idx in results_dict:
                detection_data = {
                    'segment_index': idx,
                    'segment_start_para': start,
                    'segment_end_para': end,
                    'segment_text': text,
                    **results_dict[idx]
                }
                detections.append(detection_data)

        print(f"\n   所有段落组检测完成！\n")

        if cancel_check:
            cancel_check()

        # 4. 保存结果到数据库（先清理旧记录，防止重复）
        print("[步骤 4/4] 保存检测结果到数据库...")
        from resume_models import AigcDetection, AigcThreshold
        AigcDetection.query.filter_by(paper_id=paper_id).delete()

        # 获取阈值设置
        threshold_config = db_session.query(AigcThreshold).first()
        if not threshold_config:
            # 如果没有设置，使用默认值（提高阈值）
            high_risk_threshold = 80.0
        else:
            high_risk_threshold = threshold_config.high_risk_threshold

        # 保存检测结果
        high_risk_count = 0
        total_probability = 0.0

        for detection in detections:
            aigc_detection = AigcDetection(
                paper_id=paper_id,
                segment_index=detection['segment_index'],
                segment_start_para=detection['segment_start_para'],
                segment_end_para=detection['segment_end_para'],
                segment_text=detection['segment_text'],
                aigc_probability=detection['aigc_probability'],
                confidence=detection['confidence'],
                reason=detection['reason'],
                suspicious_features=detection.get('suspicious_features', [])
            )
            db_session.add(aigc_detection)

            # 统计
            total_probability += detection['aigc_probability']
            if detection['aigc_probability'] >= high_risk_threshold:
                high_risk_count += 1

        if cancel_check:
            cancel_check()
        db_session.commit()
        print(f"✅ 已保存 {len(detections)} 条检测结果到数据库\n")

        # 计算整体分数
        overall_score = total_probability / len(detections) if detections else 0.0

        print(f"{'='*60}")
        print(f"AIGC 检测完成！Token: {token_acc.total}")
        print(f"整体分数: {overall_score:.2f}/100")
        print(f"高风险段落组: {high_risk_count} 个")
        print(f"{'='*60}\n")

        return detections, overall_score, high_risk_count, token_acc.total


class _TeeStream:
    """同时写入多个流的包装器"""
    def __init__(self, *streams):
        self.streams = streams
    def write(self, data):
        for s in self.streams:
            s.write(data)
    def flush(self):
        for s in self.streams:
            s.flush()


def run_aigc_detection_in_background(app, db, paper_id: int, task_token: str):
    """
    在后台线程中运行 AIGC 检测
    """
    # 设置日志捕获
    log_buffer = io.StringIO()
    original_stdout = sys.stdout
    sys.stdout = _TeeStream(original_stdout, log_buffer)

    print(f"\n[后台任务] 开始 AIGC检测，简历 ID: {resume_id}")

    with app.app_context():
        from resume_models import Resume
        from .profile_resolver import resolve_profile_for_resume

        resume = db.session.get(Resume, resume_id)
        if not resume:
            print(f"[后台任务] [ERROR] 简历 ID: {resume_id} 不存在。")
            sys.stdout = original_stdout
            return

        try:
            ensure_task_active(db.session, resume, 'aigc_detection', task_token)
            resume.aigc_detection_status = 'processing'
            db.session.commit()

            profile, profile_config = resolve_profile_for_resume(db.session, resume)
            print(f"[后台任务] 使用模板: {profile.name} ({profile.position_type})")

            detector = AigcDetector(profile_config=profile_config)
detections, overall_score, high_risk_count, total_tokens = detector.detect_document(
                resume.resume_url,
                resume.id,
                db.session,
                cancel_check=lambda: ensure_task_active(db.session, resume, 'aigc_detection', task_token)
            )

            ensure_task_active(db.session, resume, 'aigc_detection', task_token)
            resume.aigc_detection_status = 'completed'
            resume.aigc_overall_score = overall_score
            resume.aigc_high_risk_count = high_risk_count
            resume.tokens_used = (resume.tokens_used or 0) + total_tokens
            resume.aigc_detection_date = datetime.utcnow()
            resume.aigc_detection_error_message = None
            resume.aigc_detection_task_token = None

            db.session.commit()
            print(f"[后台任务] ✅ 简历 ID: {resume_id} AIGC检测成功完成。")

        except TaskCancelledError as e:
            db.session.rollback()
            print(f"[后台任务] 简历 ID: {resume_id} AIGC检测已终止: {e}")

        except Exception as e:
            from .document_reader import classify_file_error
            friendly_msg = classify_file_error(e)
            resume.aigc_detection_status = 'failed'
            resume.aigc_detection_error_message = friendly_msg
            resume.aigc_detection_task_token = None
            db.session.commit()
            print(f"[后台任务] [FATAL] 简历 ID: {resume_id} AIGC检测失败: {e}")
            import traceback
            print(traceback.format_exc())
        finally:
            # 保存日志文件
            sys.stdout = original_stdout
            try:
                log_dir = os.path.dirname(resume.resume_url)
                os.makedirs(log_dir, exist_ok=True)
                log_path = os.path.join(log_dir, f"{resume_id}_aigc_detection.log")
                with open(log_path, 'w', encoding='utf-8') as f:
                    f.write(log_buffer.getvalue())
                if can_attach_log(db.session, resume, 'aigc_detection', task_token):
                    resume.aigc_log_url = log_path
            except Exception:
                pass
            db.session.commit()
