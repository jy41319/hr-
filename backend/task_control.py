"""
任务控制模块 - 异步任务取消与状态管理
"""
import threading


class TaskCancelledError(Exception):
    pass


def can_attach_log(db_session, resume_obj, task_type, task_token):
    if not task_token:
        return False
    try:
        token_field = _task_token_field(task_type)
        current_token = getattr(resume_obj, token_field, None)
        return current_token == task_token
    except Exception:
        return False


def ensure_task_active(db_session, resume_obj, task_type, task_token):
    if not task_token:
        return
    token_field = _task_token_field(task_type)
    current_token = getattr(resume_obj, token_field, None)
    if current_token != task_token:
        raise TaskCancelledError(f"任务已取消: {task_type}")
    db_session.refresh(resume_obj)


def _task_token_field(task_type):
    mapping = {
        'evaluation': 'evaluation_task_token',
        'detailed_review': 'detailed_review_task_token',
        'aigc_detection': 'aigc_detection_task_token',
        'risk_flagging': 'risk_flagging_task_token',
    }
    return mapping.get(task_type, 'evaluation_task_token')