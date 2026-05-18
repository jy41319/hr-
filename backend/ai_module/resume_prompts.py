from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from typing import List
from langchain_core.prompts import ChatPromptTemplate


def _year_context():
    return f"**背景信息：当前时间为{datetime.now().year}年。请在审查中以此为时间参照。**\n\n"


class DimensionEvaluation(BaseModel):
    score: int = Field(ge=0, le=100, description="对该维度的评分，0到100的整数")
    feedback: str = Field(min_length=5, description="对该维度的详细文字评价")
    strengths: str = Field(min_length=2, description="该维度的核心优点")
    weaknesses: str = Field(min_length=2, description="该维度的核心缺点")

    @field_validator("feedback", "strengths", "weaknesses")
    @classmethod
    def validate_non_empty_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("字段不能为空")
        return value


class OverallEvaluation(BaseModel):
    overall_score: float = Field(ge=0, le=100, description="简历最终总分，0到100")
    overall_grade: str = Field(min_length=1, description="最终等级：A/B/C/D/E")
    overall_feedback: str = Field(min_length=10, description="全面概括的总体评语")
    recommendations: List[str] = Field(min_length=1, description="核心改进建议列表")

    @field_validator("overall_grade", "overall_feedback")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("字段不能为空")
        return value

    @field_validator("recommendations")
    @classmethod
    def validate_recommendations(cls, value: List[str]) -> List[str]:
        cleaned = [item.strip() for item in value if isinstance(item, str) and item.strip()]
        if not cleaned:
            raise ValueError("recommendations 不能为空")
        return cleaned


class SectionReview(BaseModel):
    section_index: int = Field(description="段落索引（0-based）")
    has_issues: bool = Field(description="是否存在问题")
    issue_type: str = Field(description="问题类型：时间矛盾/夸大表述/格式问题/关键信息缺失/语法错误/逻辑问题/表述问题/无问题")
    severity: str = Field(description="严重程度：minor/moderate/major/critical/none")
    comment: str = Field(description="具体批注内容")
    suggestion: str = Field(description="改进建议")


class BatchSectionReview(BaseModel):
    reviews: List[SectionReview] = Field(description="每个段落的批注结果列表")


class AigcSegmentResult(BaseModel):
    segment_index: int = Field(description="段落组索引")
    aigc_probability: float = Field(description="AI生成概率(0-100)")
    confidence: str = Field(description="置信度：low/medium/high")
    reason: str = Field(description="判断理由")
    suspicious_features: List[str] = Field(description="可疑特征列表")


class BatchAigcResult(BaseModel):
    results: List[AigcSegmentResult] = Field(description="检测结果列表")


class RiskFlagResult(BaseModel):
    risk_type: str = Field(description="风险类型：timeline/exaggeration/missing_info/format/aigc")
    severity: str = Field(description="严重程度：minor/moderate/major/critical")
    detail: str = Field(description="具体风险描述")
    location: str = Field(description="风险所在位置（段落/字段）")
    suggestion: str = Field(description="建议处理方式")


class BatchRiskFlagResult(BaseModel):
    flags: List[RiskFlagResult] = Field(description="风险标记列表")


class ResumeStructuredInfo(BaseModel):
    name: str = Field(description="候选人姓名")
    age: str = Field(default="", description="年龄或出生年月")
    email: str = Field(default="", description="邮箱")
    phone: str = Field(default="", description="电话")
    education_list: List[str] = Field(default_factory=list, description="学历列表，如'2018-2022 本科 计算机科学 北京大学'")
    work_list: List[str] = Field(default_factory=list, description="工作经历列表，如'2022-2024 前端开发工程师 字节跳动'")
    skills: List[str] = Field(default_factory=list, description="技能列表")
    certifications: List[str] = Field(default_factory=list, description="证书/认证列表")
    self_evaluation: str = Field(default="", description="自我评价/求职意向摘要")


def get_dimension_prompt_template():
    template = _year_context() + """你是一位资深HR简历审查专家。你的任务是严谨、客观地审查一份简历。

请专注于 **{criterion}** 这个维度进行评价。
此维度的核心考察点包括：**{aspects_str}**。

**简历内容:**
---
{resume_content}
---

**重要提示（审查前请仔细阅读）：**
- 你审查的是一份求职简历，不是学术论文
- 关注简历中与求职相关的所有信息
- 注意时间线的一致性和逻辑性
- 注意是否存在夸大、虚构或AI生成的痕迹

**任务要求:**
1. **评分**: 在0-100范围内，为该简历在 **{criterion}** 维度上打分。
2. **评价**: 给出详细、具体、有建设性的文字评价。
3. **总结**: 分别用一句话精准总结该维度的核心优点和缺点。

请严格按照JSON格式输出评价。
**输出示例:**
```json
{{
    "score": 85,
    "feedback": "此处是详细的文字评价...",
    "strengths": "此处是总结的优点...",
    "weaknesses": "此处是总结的缺点..."
}}
```
"""
    return ChatPromptTemplate.from_template(template)


def get_overall_prompt_template():
    template = _year_context() + """你是一位资深HR总监，你的任务是基于各维度审查结果，撰写一份客观、精准的简历总体评语。

**各维度评价摘要:**
---
{evaluations_summary}
---

**各维度核心不足:**
---
{weaknesses_summary}
---

**任务要求:**
1. **计算总分**: 参考各维度分数和权重，计算最终总分。权重: {weights_str}
2. **给出等级**: A(优秀90+)/B(良好80+)/C(中等70+)/D(及格60+)/E(不及格<60)
3. **撰写总体评语**:
   - 重点指出简历存在的核心问题
   - 评语客观、专业、有针对性
   - 长度控制在150-250字
4. **提出改进建议**: 3-5条最重要的改进建议，每条要具体、可操作

请严格按照JSON格式输出综合评价。
**输出示例:**
```json
{{
    "overall_score": 73,
    "overall_grade": "C",
    "overall_feedback": "该简历在工作经历描述和时间线一致性方面存在明显问题...",
    "recommendations": ["补充具体的工作成果数据", "修正时间线重叠问题", "增加联系方式信息"]
}}
```
"""
    return ChatPromptTemplate.from_template(template)