"""
简历结构提取器 - 从简历文档中提取语义段落
适配简历特有的结构：个人信息、教育经历、工作经历、技能、自我评价等
"""
import json
import os
import re
import statistics
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

try:
    from docx import Document
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False

try:
    import fitz
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False


RESUME_SECTION_RE = re.compile(
    r'^(个人信息|基本信息|自我介绍|求职意向|教育经历|教育背景|学历|'
    r'工作经历|工作经验|职业经历|实践经历|实习经历|项目经历|项目经验|'
    r'技能|专业技能|核心技能|语言能力|'
    r'证书|资格证书|认证|荣誉|获奖|'
    r'自我评价|个人评价|兴趣爱好|'
    r'other\s*info|personal\s*info|education|experience|work\s*experience|skills|certifications|'
    r'self\s*evaluation|hobbies|interests|summary|profile|objective|about\s*me)',
    re.IGNORECASE
)

HEADING_RE = re.compile(
    r'^(\d+[\.\s]|第[一二三四五六七八九十\d]+[章节]|'
    r'[一二三四五六七八九十]+[、.]|'
    r'[▸▶►●◆★▪▫☐☑⊙⊛]|'
    r'[A-Za-z]+\s*:)',
    re.IGNORECASE
)

PAGE_NUMBER_RE = re.compile(r'^(第?\d+页?|[ivxlcdm]+|\d+)$', re.IGNORECASE)


@dataclass
class SourceRef:
    kind: str
    raw_index: int
    page_index: Optional[int] = None
    bbox: Optional[Tuple[float, float, float, float]] = None
    style_name: str = ""
    font_size: Optional[float] = None


@dataclass
class StructuredSection:
    index: int
    text: str
    section_type: str
    source_refs: List[SourceRef] = field(default_factory=list)
    style_name: str = ""
    meta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ResumeStructure:
    sections: List[StructuredSection]
    debug: Dict[str, Any] = field(default_factory=dict)

    @property
    def all_sections(self) -> List[StructuredSection]:
        return self.sections


class ResumeStructureExtractor:
    """从简历文档中提取语义段落，适配简历特有的分区结构"""

    def extract(self, file_path: str) -> ResumeStructure:
        ext = os.path.splitext(file_path)[1].lower()
        if ext == ".docx":
            sections = self._extract_docx(file_path)
        elif ext == ".pdf":
            sections = self._extract_pdf(file_path)
        else:
            raise ValueError(f"Unsupported file format: {ext}")

        debug = {
            "source_file": os.path.basename(file_path),
            "total_sections": len(sections),
            "type_counts": dict(Counter(s.section_type for s in sections)),
        }
        return ResumeStructure(sections=sections, debug=debug)

    def _extract_docx(self, file_path: str) -> List[StructuredSection]:
        if not HAS_DOCX:
            raise ImportError("python-docx is not installed")

        doc = Document(file_path)
        sections: List[StructuredSection] = []

        for raw_index, para in enumerate(doc.paragraphs):
            text = self._normalize_text(para.text)
            if not text:
                continue

            style_name = para.style.name if para.style else ""
            section_type = self._classify_section(text, style_name=style_name)
            sections.append(
                StructuredSection(
                    index=len(sections),
                    text=text,
                    section_type=section_type,
                    source_refs=[SourceRef(kind="docx", raw_index=raw_index, style_name=style_name)],
                    style_name=style_name,
                )
            )

        return sections

    def _extract_pdf(self, file_path: str) -> List[StructuredSection]:
        if not HAS_FITZ:
            raise ImportError("PyMuPDF is not installed")

        doc = fitz.open(file_path)
        try:
            lines = self._extract_pdf_lines(doc)
            if not lines:
                return []

            repeated_headers = self._detect_pdf_headers(lines)
            filtered_lines = [
                line for line in lines
                if not line["is_page_marker"] and line["compact_text"] not in repeated_headers
            ]
            return self._merge_pdf_lines(filtered_lines)
        finally:
            doc.close()

    def _extract_pdf_lines(self, doc: Any) -> List[Dict[str, Any]]:
        lines: List[Dict[str, Any]] = []
        for page_index, page in enumerate(doc):
            page_height = float(page.rect.height)
            page_dict = page.get_text("dict")
            raw_index = 0

            for block in page_dict.get("blocks", []):
                if block.get("type", 0) != 0:
                    continue
                for line_obj in block.get("lines", []):
                    spans = [span for span in line_obj.get("spans", []) if span.get("text", "").strip()]
                    if not spans:
                        continue

                    text = self._normalize_text("".join(span["text"] for span in spans))
                    if not text:
                        continue

                    bbox = tuple(float(v) for v in line_obj["bbox"])
                    font_sizes = [float(span["size"]) for span in spans]
                    font_size = statistics.median(font_sizes) if font_sizes else None
                    compact_text = self._compact_text(text)
                    lines.append({
                        "text": text,
                        "compact_text": compact_text,
                        "page_index": page_index,
                        "raw_index": raw_index,
                        "bbox": bbox,
                        "font_size": font_size,
                        "is_page_marker": self._is_page_marker(compact_text),
                    })
                    raw_index += 1

        return lines

    def _detect_pdf_headers(self, lines: List[Dict[str, Any]]) -> set:
        candidates = Counter()
        for line in lines:
            if len(line["compact_text"]) < 6:
                continue
            bbox = line["bbox"]
            page_height = 842.0
            top_ratio = bbox[1] / page_height if page_height else 0.0
            if top_ratio < 0.12:
                candidates[line["compact_text"]] += 1
        return {text for text, count in candidates.items() if count >= 2}

    def _merge_pdf_lines(self, lines: List[Dict[str, Any]]) -> List[StructuredSection]:
        if not lines:
            return []

        sections: List[StructuredSection] = []
        current_text = ""
        current_type = "body"
        current_refs: List[Dict[str, Any]] = []

        for line in lines:
            line_type = self._classify_section(line["text"], font_size=line.get("font_size"))
            line["section_type"] = line_type

            if line_type in {"section_heading", "personal_info_heading"}:
                if current_text.strip():
                    sections.append(self._build_section(current_text, current_type, current_refs))
                current_text = line["text"]
                current_type = line_type
                current_refs = [line]
                sections.append(self._build_section(current_text, current_type, current_refs))
                current_text = ""
                current_refs = []
                continue

            compact = line["text"].strip()
            if len(compact) < 15 and not any(kw in compact.lower() for kw in ["邮箱", "email", "电话", "phone", "手机", "地址", "address", "年龄", "出生"]):
                if current_text.strip():
                    sections.append(self._build_section(current_text, current_type, current_refs))
                    current_text = ""
                    current_refs = []
                continue

            current_text += "\n" + line["text"] if current_text else line["text"]
            current_refs.append(line)

        if current_text.strip():
            sections.append(self._build_section(current_text, current_type, current_refs))

        for i, s in enumerate(sections):
            s.index = i

        return sections

    def _build_section(self, text, section_type, lines_data) -> StructuredSection:
        source_refs = []
        page_index = lines_data[0].get("page_index", 0) if lines_data else 0
        bbox = lines_data[0].get("bbox") if lines_data else None
        font_size = lines_data[0].get("font_size") if lines_data else None

        for ld in lines_data:
            source_refs.append(SourceRef(
                kind="pdf",
                raw_index=ld.get("raw_index", 0),
                page_index=ld.get("page_index", 0),
                bbox=ld.get("bbox"),
                font_size=ld.get("font_size"),
            ))

        return StructuredSection(
            index=0,
            text=text.strip(),
            section_type=section_type,
            source_refs=source_refs,
            meta={"page_index": page_index, "font_size": font_size},
        )

    def _classify_section(self, text: str, style_name: str = "", font_size: Optional[float] = None) -> str:
        compact = self._compact_text(text)
        lower = compact.lower()
        style_lower = style_name.lower()

        if not compact:
            return "body"
        if self._is_page_marker(compact):
            return "page_marker"

        if RESUME_SECTION_RE.match(compact):
            return "section_heading"

        personal_info_keywords = ["姓名", "联系方式", "电话", "邮箱", "email", "phone",
                                  "手机", "地址", "出生", "年龄", "性别", "婚姻",
                                  " nationality", "籍贯", "政治面貌"]
        if any(kw in lower for kw in personal_info_keywords) and len(compact) < 40:
            return "personal_info_heading"

        if "heading" in style_lower or "标题" in style_lower:
            return "section_heading"
        if font_size is not None and font_size >= 14:
            return "section_heading"

        body_keywords = ["大学", "学院", "学校", "本科", "硕士", "博士", "学历",
                         "公司", "集团", "企业", "有限公司", "股份",
                         "负责", "担任", "参与", "主导", "完成",
                         "精通", "熟练", "掌握", "熟悉", "了解",
                         "证书", "认证", "资格", "荣誉", "获奖"]
        if any(kw in text for kw in body_keywords):
            return "body"

        return "body"

    def _is_page_marker(self, compact: str) -> bool:
        return bool(PAGE_NUMBER_RE.match(compact))

    def _normalize_text(self, text: str) -> str:
        text = text.replace("\u3000", " ")
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\s*\n\s*", " ", text)
        return text.strip()

    def _compact_text(self, text: str) -> str:
        return re.sub(r"\s+", "", text).strip()


_resume_structure_extractor: Optional[ResumeStructureExtractor] = None


def get_resume_structure_extractor() -> ResumeStructureExtractor:
    global _resume_structure_extractor
    if _resume_structure_extractor is None:
        _resume_structure_extractor = ResumeStructureExtractor()
    return _resume_structure_extractor


def save_structure_debug(structure: ResumeStructure, output_path: str) -> Dict[str, Any]:
    payload = {
        "sourceFile": structure.debug.get("source_file"),
        "totalSections": len(structure.sections),
        "typeCounts": structure.debug.get("type_counts", {}),
        "sectionPreview": [
            {"index": s.index, "type": s.section_type, "text": s.text[:120]}
            for s in structure.sections[:10]
        ],
    }
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return payload