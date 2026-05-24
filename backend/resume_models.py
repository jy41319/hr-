"""
数据库模型定义 - CVizr
"""
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import hashlib
import re

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = 'user'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), default='hr')
    real_name = db.Column(db.String(80), nullable=True)
    department = db.Column(db.String(100), nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, nullable=True)

    resumes = db.relationship('Resume', foreign_keys='Resume.user_id', backref='uploader', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'role': self.role,
            'realName': self.real_name,
            'department': self.department,
            'isActive': self.is_active,
            'createdAt': self.created_at.isoformat() if self.created_at else None,
            'lastLogin': self.last_login.isoformat() if self.last_login else None,
        }


class ReviewProfile(db.Model):
    """岗位评审模板 - 对应不同岗位的评审维度和权重"""
    __tablename__ = 'review_profile'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    position_type = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)

    evaluation_criteria = db.Column(db.JSON, nullable=False)
    dimension_prompt_template = db.Column(db.Text, nullable=False)
    overall_prompt_template = db.Column(db.Text, nullable=False)

    creator_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    is_active = db.Column(db.Boolean, default=True)
    is_default = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    resumes = db.relationship('Resume', backref='profile', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'positionType': self.position_type,
            'description': self.description,
            'evaluationCriteria': self.evaluation_criteria,
            'dimensionPromptTemplate': self.dimension_prompt_template,
            'overallPromptTemplate': self.overall_prompt_template,
            'creatorId': self.creator_id,
            'isActive': self.is_active,
            'isDefault': self.is_default,
            'createdAt': self.created_at.isoformat() if self.created_at else None,
            'updatedAt': self.updated_at.isoformat() if self.updated_at else None,
        }


class Resume(db.Model):
    """简历模型"""
    __tablename__ = 'resume'
    __table_args__ = (
        db.Index('idx_resume_user_upload', 'user_id', 'upload_time'),
        db.Index('idx_resume_status', 'status'),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    profile_id = db.Column(db.Integer, db.ForeignKey('review_profile.id'), nullable=True)

    candidate_name = db.Column(db.String(80), nullable=True)
    candidate_email = db.Column(db.String(120), nullable=True)
    candidate_phone = db.Column(db.String(30), nullable=True)

    resume_url = db.Column(db.String(300), nullable=False)

    status = db.Column(db.String(50), default='pending')
    evaluation_stage = db.Column(db.String(50), nullable=True)
    evaluation_progress = db.Column(db.Integer, default=0)
    evaluation_status_message = db.Column(db.String(300), nullable=True)
    workflow_status = db.Column(db.String(50), default='new')
    hr_note = db.Column(db.Text, nullable=True)
    job_name = db.Column(db.String(120), nullable=True)
    job_description = db.Column(db.Text, nullable=True)
    ai_result = db.Column(db.String(10), nullable=True)
    evaluation_result = db.Column(db.JSON, nullable=True)

    detailed_review_status = db.Column(db.String(50), nullable=True)
    annotated_document_url = db.Column(db.String(300), nullable=True)

    aigc_detection_status = db.Column(db.String(50), nullable=True)
    aigc_overall_score = db.Column(db.Float, nullable=True)
    aigc_high_risk_count = db.Column(db.Integer, nullable=True)
    aigc_detection_date = db.Column(db.DateTime, nullable=True)

    risk_flagging_status = db.Column(db.String(50), nullable=True)
    risk_flag_count = db.Column(db.Integer, nullable=True)

    structured_info = db.Column(db.JSON, nullable=True)

    upload_time = db.Column(db.DateTime, default=datetime.utcnow)
    evaluation_time = db.Column(db.DateTime, nullable=True)

    tokens_used = db.Column(db.Integer, default=0)

    review_log_url = db.Column(db.String(300), nullable=True)
    evaluation_task_token = db.Column(db.String(64), nullable=True)
    detailed_review_task_token = db.Column(db.String(64), nullable=True)
    aigc_detection_task_token = db.Column(db.String(64), nullable=True)
    risk_flagging_task_token = db.Column(db.String(64), nullable=True)
    evaluation_error_message = db.Column(db.Text, nullable=True)
    detailed_review_error_message = db.Column(db.Text, nullable=True)
    aigc_detection_error_message = db.Column(db.Text, nullable=True)
    risk_flagging_error_message = db.Column(db.Text, nullable=True)

    detailed_reviews = db.relationship('ResumeReview', backref='resume', lazy=True, cascade='all, delete-orphan')
    aigc_detections = db.relationship('AigcDetection', backref='resume', lazy=True, cascade='all, delete-orphan')
    risk_flags = db.relationship('RiskFlag', backref='resume', lazy=True, cascade='all, delete-orphan')

    def _decision_summary(self):
        result = self.evaluation_result or {}
        overall = result.get('overall_evaluation', {})
        overall_score = overall.get('overall_score')
        match_score = result.get('match_score') if result.get('match_score') is not None else overall_score
        match_grade = result.get('match_grade') or self._grade_from_score(match_score)
        risk_level = result.get('risk_level')
        if not risk_level:
            risk_level = 'high' if (overall_score or 0) < 60 else 'medium' if (overall_score or 0) < 75 else 'low'
        recommendation = result.get('recommendation')
        if not recommendation:
            if risk_level == 'high':
                recommendation = '建议人工复核'
            elif (match_score or 0) >= 75:
                recommendation = '推荐面试'
            elif (match_score or 0) >= 60:
                recommendation = '待定'
            else:
                recommendation = '建议淘汰'
        return {
            'overallScore': overall_score,
            'matchScore': match_score,
            'matchGrade': match_grade,
            'recommendation': recommendation if self.evaluation_result else None,
            'riskLevel': risk_level if self.evaluation_result else None,
            'highlights': result.get('highlights', []),
            'concerns': result.get('concerns', []),
            'recommendationReason': result.get('recommendation_reason'),
            'candidateProfileSummary': result.get('candidate_profile_summary'),
            'candidateBasicInfo': result.get('candidate_basic_info', {}),
            'keyGaps': result.get('key_gaps', []),
            'requirementMatches': result.get('requirement_matches', []),
            'scoreBreakdown': result.get('score_breakdown', {}),
            'jdCriteria': result.get('jd_criteria', {}),
        }

    @staticmethod
    def _grade_from_score(score):
        try:
            value = float(score or 0)
        except (TypeError, ValueError):
            value = 0
        if value >= 90:
            return 'A'
        if value >= 80:
            return 'B'
        if value >= 70:
            return 'C'
        if value >= 60:
            return 'D'
        return 'E'

    @staticmethod
    def _normalize_job_description(text):
        return re.sub(r'\s+', ' ', (text or '').strip()).lower()

    @staticmethod
    def _clip_text(text, limit=24):
        cleaned = re.sub(r'\s+', ' ', (text or '').strip())
        if len(cleaned) <= limit:
            return cleaned
        return cleaned[:limit].rstrip() + '...'

    def _job_key(self):
        normalized = self._normalize_job_description(self.job_description)
        if normalized:
            digest = hashlib.sha256(normalized.encode('utf-8')).hexdigest()[:12]
            return f'jd_{digest}'
        if self.profile_id:
            return f'profile_{self.profile_id}'
        return 'no_jd'

    def _job_display_name(self):
        if self.job_name:
            return self._clip_text(self.job_name, 32)
        first_line = next((line.strip() for line in (self.job_description or '').splitlines() if line.strip()), '')
        if first_line:
            return self._clip_text(first_line, 18)
        if self.profile:
            return self.profile.name
        return '通用初筛任务'

    def _job_summary(self):
        first_line = next((line.strip() for line in (self.job_description or '').splitlines() if line.strip()), '')
        if first_line:
            return self._clip_text(first_line, 60)
        return self.profile.name if self.profile else '未填写JD，使用通用初筛标准'

    def to_dict(self):
        decision = self._decision_summary()
        return {
            'id': self.id,
            'candidateName': self.candidate_name,
            'candidateEmail': self.candidate_email,
            'candidatePhone': self.candidate_phone,
            'status': self.status,
            'evaluationStage': self.evaluation_stage,
            'evaluationProgress': self.evaluation_progress or 0,
            'evaluationStatusMessage': self.evaluation_status_message or '',
            'workflowStatus': self.workflow_status or 'new',
            'hrNote': self.hr_note or '',
            'jobName': self._job_display_name(),
            'jobKey': self._job_key(),
            'jobSummary': self._job_summary(),
            'jobDescription': self.job_description or '',
            'aiResult': self.ai_result,
            'evaluationResult': self.evaluation_result,
            **decision,
            'profileId': self.profile_id,
            'profileName': self.profile.name if self.profile else None,
            'uploaderId': self.user_id,
            'uploader': self.uploader.username if self.uploader else None,
            'uploadTime': self.upload_time.isoformat() if self.upload_time else None,
            'evaluationTime': self.evaluation_time.isoformat() if self.evaluation_time else None,
            'detailedReviewStatus': self.detailed_review_status,
            'annotatedDocumentUrl': self.annotated_document_url,
            'aigcDetectionStatus': self.aigc_detection_status,
            'aigcOverallScore': self.aigc_overall_score,
            'aigcHighRiskCount': self.aigc_high_risk_count,
            'riskFlaggingStatus': self.risk_flagging_status,
            'riskFlagCount': self.risk_flag_count,
            'structuredInfo': self.structured_info,
            'tokensUsed': self.tokens_used or 0,
            'errorMessage': self.evaluation_error_message,
        }

    def to_dict_light(self):
        decision = self._decision_summary()
        return {
            'id': self.id,
            'candidateName': self.candidate_name,
            'status': self.status,
            'evaluationStage': self.evaluation_stage,
            'evaluationProgress': self.evaluation_progress or 0,
            'evaluationStatusMessage': self.evaluation_status_message or '',
            'workflowStatus': self.workflow_status or 'new',
            'hrNote': self.hr_note or '',
            'jobName': self._job_display_name(),
            'jobKey': self._job_key(),
            'jobSummary': self._job_summary(),
            'jobDescription': self.job_description or '',
            'aiResult': self.ai_result,
            **decision,
            'profileId': self.profile_id,
            'profileName': self.profile.name if self.profile else None,
            'uploadTime': self.upload_time.isoformat() if self.upload_time else None,
            'detailedReviewStatus': self.detailed_review_status,
            'aigcDetectionStatus': self.aigc_detection_status,
            'aigcOverallScore': self.aigc_overall_score,
            'riskFlaggingStatus': self.risk_flagging_status,
            'riskFlagCount': self.risk_flag_count,
            'tokensUsed': self.tokens_used or 0,
            'errorMessage': self.evaluation_error_message,
        }


class ResumeReview(db.Model):
    """简历逐段批注"""
    __tablename__ = 'resume_review'

    id = db.Column(db.Integer, primary_key=True)
    resume_id = db.Column(db.Integer, db.ForeignKey('resume.id'), nullable=False)

    section_index = db.Column(db.Integer, nullable=False)
    section_type = db.Column(db.String(50), nullable=True)
    section_text = db.Column(db.Text, nullable=False)

    comment = db.Column(db.Text, nullable=False)
    issue_type = db.Column(db.String(100), nullable=True)
    severity = db.Column(db.String(20), nullable=True)
    suggestion = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'resumeId': self.resume_id,
            'sectionIndex': self.section_index,
            'sectionType': self.section_type,
            'sectionText': self.section_text,
            'comment': self.comment,
            'issueType': self.issue_type,
            'severity': self.severity,
            'suggestion': self.suggestion,
        }


class AigcDetection(db.Model):
    """AIGC检测结果"""
    __tablename__ = 'aigc_detection'

    id = db.Column(db.Integer, primary_key=True)
    resume_id = db.Column(db.Integer, db.ForeignKey('resume.id'), nullable=False)

    segment_index = db.Column(db.Integer, nullable=False)
    segment_start_para = db.Column(db.Integer, nullable=False)
    segment_end_para = db.Column(db.Integer, nullable=False)
    segment_text = db.Column(db.Text, nullable=False)

    aigc_probability = db.Column(db.Float, nullable=False)
    confidence = db.Column(db.String(20), nullable=False)
    reason = db.Column(db.Text, nullable=False)
    suspicious_features = db.Column(db.JSON, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'resumeId': self.resume_id,
            'segmentIndex': self.segment_index,
            'segmentStartPara': self.segment_start_para,
            'segmentEndPara': self.segment_end_para,
            'segmentText': self.segment_text,
            'aigcProbability': self.aigc_probability,
            'confidence': self.confidence,
            'reason': self.reason,
            'suspiciousFeatures': self.suspicious_features,
        }


class RiskFlag(db.Model):
    """风险标记"""
    __tablename__ = 'risk_flag'

    id = db.Column(db.Integer, primary_key=True)
    resume_id = db.Column(db.Integer, db.ForeignKey('resume.id'), nullable=False)

    risk_type = db.Column(db.String(50), nullable=False)
    severity = db.Column(db.String(20), nullable=False)
    detail = db.Column(db.Text, nullable=False)
    location = db.Column(db.String(200), nullable=True)
    suggestion = db.Column(db.Text, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'resumeId': self.resume_id,
            'riskType': self.risk_type,
            'severity': self.severity,
            'detail': self.detail,
            'location': self.location,
            'suggestion': self.suggestion,
        }


class LLMModel(db.Model):
    """LLM模型配置"""
    __tablename__ = 'llm_model'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    provider = db.Column(db.String(100), nullable=False)
    model_name = db.Column(db.String(100), nullable=False)
    api_base = db.Column(db.String(500), nullable=False)
    api_key = db.Column(db.String(500), nullable=False)
    enable_thinking = db.Column(db.Boolean, default=False)
    is_active = db.Column(db.Boolean, default=False)
    total_input_tokens = db.Column(db.BigInteger, default=0)
    total_output_tokens = db.Column(db.BigInteger, default=0)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def mask_api_key(self):
        key = self.api_key or ''
        if len(key) <= 10: return '***'
        return key[:6] + '***' + key[-4:]

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'provider': self.provider,
            'modelName': self.model_name,
            'apiBase': self.api_base,
            'apiKey': self.mask_api_key(),
            'enableThinking': self.enable_thinking or False,
            'isActive': self.is_active,
            'totalInputTokens': self.total_input_tokens or 0,
            'totalOutputTokens': self.total_output_tokens or 0,
        }


class SystemSettings(db.Model):
    """系统设置"""
    __tablename__ = 'system_settings'

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.String(500), nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {'key': self.key, 'value': self.value}


class AigcThreshold(db.Model):
    """AIGC检测阈值设置"""
    __tablename__ = 'aigc_threshold'

    id = db.Column(db.Integer, primary_key=True)
    high_risk_threshold = db.Column(db.Float, default=80.0)
    medium_risk_threshold = db.Column(db.Float, default=60.0)
    overall_alert_threshold = db.Column(db.Float, default=70.0)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'highRiskThreshold': self.high_risk_threshold,
            'mediumRiskThreshold': self.medium_risk_threshold,
            'overallAlertThreshold': self.overall_alert_threshold,
            'updatedAt': self.updated_at.isoformat() if self.updated_at else None,
        }


class Feedback(db.Model):
    """用户反馈"""
    __tablename__ = 'feedback'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    content = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(20), default='unread')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref='feedbacks', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'userId': self.user_id,
            'username': self.user.username if self.user else None,
            'content': self.content,
            'status': self.status,
            'createdAt': self.created_at.isoformat() if self.created_at else None,
        }
