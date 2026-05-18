"""
HR智能审稿机器人 - Flask主应用
"""
import os
import uuid
import threading
from datetime import datetime
from dotenv import load_dotenv
from flask import Flask, request, jsonify, session, send_file, send_from_directory
from flask_session import Session
from werkzeug.utils import secure_filename

from resume_models import db, User, Resume, ReviewProfile, ResumeReview, AigcDetection, RiskFlag, LLMModel, SystemSettings, Feedback

dotenv_path = os.path.join(os.path.dirname(__file__), '.env')
load_dotenv(dotenv_path=dotenv_path)

STORAGE_PATH = os.getenv('STORAGE_PATH', os.path.join(os.path.dirname(__file__), '..', 'storage'))
UPLOAD_FOLDER = os.getenv('UPLOAD_FOLDER', 'uploads')

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['SESSION_TYPE'] = 'filesystem'
app.config['SESSION_FILE_DIR'] = os.path.join(STORAGE_PATH, 'flask_session')
app.config['SESSION_PERMANENT'] = False

database_type = os.getenv('DATABASE_TYPE', 'sqlite').lower()
if database_type == 'postgresql':
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('POSTGRES_URI', 'postgresql://localhost/hr_resume_bot')
else:
    db_path = os.path.join(STORAGE_PATH, 'hr_resume_bot.db')
    app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_FILE_SIZE', 52428800))

os.makedirs(os.path.join(STORAGE_PATH, 'flask_session'), exist_ok=True)
os.makedirs(os.path.join(STORAGE_PATH, UPLOAD_FOLDER), exist_ok=True)

db.init_app(app)
Session(app)


def _init_default_data():
    if not User.query.filter_by(username='admin').first():
        admin = User(username='admin', password='admin123', role='admin', real_name='管理员')
        db.session.add(admin)

    if not ReviewProfile.query.filter_by(is_default=True).first():
        from ai_module.resume_prompts import get_dimension_prompt_template, get_overall_prompt_template
        dim_template = get_dimension_prompt_template()
        overall_template = get_overall_prompt_template()

        import json
        criteria_path = os.path.join(os.path.dirname(__file__), 'ai_module', 'config', 'general_resume_criteria.json')
        with open(criteria_path, 'r', encoding='utf-8') as f:
            criteria = json.load(f)

        default_profile = ReviewProfile(
            name='通用简历评审模板',
            position_type='通用岗位',
            description='适用于所有岗位的通用简历评审模板',
            evaluation_criteria=criteria['evaluation_criteria'],
            dimension_prompt_template=dim_template.messages[0].prompt.template,
            overall_prompt_template=overall_template.messages[0].prompt.template,
            creator_id=1,
            is_active=True,
            is_default=True,
        )
        db.session.add(default_profile)

    db.session.commit()


with app.app_context():
    db.create_all()
    _init_default_data()


def _get_current_user():
    user_id = session.get('user_id')
    if not user_id:
        return None
    return db.session.get(User, user_id)


def _require_login():
    user = _get_current_user()
    if not user:
        return jsonify({'error': '请先登录'}), 401
    return None


def _require_admin():
    user = _get_current_user()
    if not user or user.role != 'admin':
        return jsonify({'error': '需要管理员权限'}), 403
    return None


def _build_upload_filename(original_filename, fallback_prefix='resume'):
    ext = os.path.splitext(original_filename or '')[1].lower()
    base = os.path.splitext(original_filename or '')[0]
    safe_base = secure_filename(base) or fallback_prefix
    return f"{uuid.uuid4().hex[:8]}_{safe_base}{ext}"


def _validate_uploaded_document(filepath):
    from ai_module.document_reader import get_document_reader
    validation = get_document_reader().validate_file(filepath)
    if not validation.get('valid'):
        try:
            os.remove(filepath)
        except OSError:
            pass
        return validation.get('message') or '文件无法解析，请检查文件格式'
    return None


@app.route('/api/login', methods=['POST'])
def login():
    data = request.json or {}
    username = data.get('username', '')
    password = data.get('password', '')

    user = User.query.filter_by(username=username, is_active=True).first()
    if not user or user.password != password:
        return jsonify({'error': '用户名或密码错误'}), 400

    session['user_id'] = user.id
    user.last_login = datetime.utcnow()
    db.session.commit()
    return jsonify(user.to_dict())


@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': '已登出'})


@app.route('/api/current-user', methods=['GET'])
def current_user():
    user = _get_current_user()
    if not user:
        return jsonify(None)
    return jsonify(user.to_dict())


@app.route('/api/profile', methods=['PUT'])
def update_profile():
    err = _require_login()
    if err: return err
    user = _get_current_user()
    data = request.json or {}
    user.real_name = data.get('realName', user.real_name)
    user.department = data.get('department', user.department)
    db.session.commit()
    return jsonify(user.to_dict())


@app.route('/api/resumes', methods=['GET'])
def get_resumes():
    err = _require_login()
    if err: return err
    user = _get_current_user()

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('perPage', 20, type=int)
    status = request.args.get('status', '')

    query = Resume.query
    if user.role != 'admin':
        query = query.filter_by(user_id=user.id)
    if status:
        query = query.filter_by(status=status)

    query = query.order_by(Resume.upload_time.desc())
    total = query.count()
    resumes = query.offset((page - 1) * per_page).limit(per_page).all()

    return jsonify({
        'resumes': [r.to_dict_light() for r in resumes],
        'total': total,
        'page': page,
        'perPage': per_page,
    })


@app.route('/api/resumes/<int:id>', methods=['GET'])
def get_resume(id):
    err = _require_login()
    if err: return err
    resume = db.session.get(Resume, id)
    if not resume:
        return jsonify({'error': '简历不存在'}), 404
    return jsonify(resume.to_dict())


@app.route('/api/resumes/<int:id>/status', methods=['GET'])
def get_resume_status(id):
    err = _require_login()
    if err: return err
    resume = db.session.get(Resume, id)
    if not resume:
        return jsonify({'error': '简历不存在'}), 404
    return jsonify({
        'id': resume.id,
        'status': resume.status,
        'error': resume.evaluation_error_message,
        'updatedAt': resume.evaluation_time.isoformat() if resume.evaluation_time else None,
    })


@app.route('/api/resumes/<int:id>/evaluation', methods=['GET'])
def get_resume_evaluation(id):
    err = _require_login()
    if err: return err
    resume = db.session.get(Resume, id)
    if not resume:
        return jsonify({'error': '简历不存在'}), 404
    if not resume.evaluation_result:
        return jsonify({'error': '暂无评估结果'}), 404
    return jsonify(resume.evaluation_result)


@app.route('/api/resumes/<int:id>/download-report', methods=['GET'])
@app.route('/api/resumes/<int:id>/download-annotated', methods=['GET'])
def download_report(id):
    err = _require_login()
    if err: return err
    resume = db.session.get(Resume, id)
    if not resume:
        return jsonify({'error': '简历不存在'}), 404

    # Prefer downloading the annotated document when available.
    annotated = resume.annotated_document_url
    if annotated and os.path.exists(annotated):
        return send_file(annotated, as_attachment=True, download_name=os.path.basename(annotated))

    # Fallback: generate a human-readable report text file from evaluation result.
    if not resume.evaluation_result:
        return jsonify({'error': '暂无可下载报告'}), 404

    overall = (resume.evaluation_result or {}).get('overall_evaluation', {})
    dims = (resume.evaluation_result or {}).get('dimension_evaluations', [])
    dimension_labels = {
        'basic_info': '基本信息完整性',
        'format': '格式规范性',
        'work_logic': '工作经历逻辑性',
        'skill_match': '技能匹配度',
        'risk_assessment': '风险评估',
        'overall_impression': '综合印象',
    }
    if isinstance(dims, dict):
        dims = [
            {
                **value,
                'dimension': value.get('dimension') or dimension_labels.get(key, key),
            }
            for key, value in dims.items()
            if isinstance(value, dict)
        ]
    lines = [
        "HR简历评审报告",
        f"候选人: {resume.candidate_name or '未命名'}",
        f"简历ID: {resume.id}",
        f"评审时间: {resume.evaluation_time.isoformat() if resume.evaluation_time else ''}",
        "",
        f"总分: {overall.get('overall_score', '')}",
        f"等级: {overall.get('overall_grade', '')}",
        f"综合反馈: {overall.get('overall_feedback', '')}",
        "",
        "维度评分:",
    ]
    for d in dims:
        lines.append(f"- {d.get('dimension', '')}: {d.get('score', '')} | {d.get('feedback', '')}")

    report_dir = os.path.join(STORAGE_PATH, 'exports')
    os.makedirs(report_dir, exist_ok=True)
    filename = f"resume_report_{resume.id}_{datetime.now().strftime('%Y%m%d%H%M%S')}.txt"
    filepath = os.path.join(report_dir, filename)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write("\n".join(lines))
    return send_file(filepath, as_attachment=True, download_name=filename)


@app.route('/api/upload', methods=['POST'])
def upload_resume():
    err = _require_login()
    if err: return err
    user = _get_current_user()

    if 'file' not in request.files:
        return jsonify({'error': '请上传文件'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '请选择文件'}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ['.docx', '.pdf']:
        return jsonify({'error': '仅支持 .docx 和 .pdf 文件'}), 400

    filename = _build_upload_filename(file.filename)

    upload_dir = os.path.join(STORAGE_PATH, UPLOAD_FOLDER)
    os.makedirs(upload_dir, exist_ok=True)
    filepath = os.path.join(upload_dir, filename)
    file.save(filepath)

    validation_error = _validate_uploaded_document(filepath)
    if validation_error:
        return jsonify({'error': validation_error}), 400

    candidate_name = request.form.get('candidateName', '').strip() or os.path.splitext(file.filename)[0]
    profile_id = request.form.get('profileId', None, type=int)

    resume = Resume(
        user_id=user.id,
        candidate_name=candidate_name,
        resume_url=filepath,
        profile_id=profile_id,
    )
    db.session.add(resume)
    db.session.commit()

    return jsonify(resume.to_dict())


@app.route('/api/batch-upload', methods=['POST'])
def batch_upload():
    err = _require_login()
    if err: return err
    user = _get_current_user()

    files = request.files.getlist('files')
    if not files:
        return jsonify({'error': '请上传文件'}), 400

    profile_id = request.form.get('profileId', None, type=int)
    upload_dir = os.path.join(STORAGE_PATH, UPLOAD_FOLDER)
    os.makedirs(upload_dir, exist_ok=True)

    results = []
    for file in files:
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ['.docx', '.pdf']:
            continue

        filename = _build_upload_filename(file.filename)
        filepath = os.path.join(upload_dir, filename)
        file.save(filepath)

        validation_error = _validate_uploaded_document(filepath)
        if validation_error:
            results.append({
                'filename': file.filename,
                'status': 'failed',
                'error': validation_error,
            })
            continue

        resume = Resume(
            user_id=user.id,
            candidate_name=os.path.splitext(file.filename)[0],
            resume_url=filepath,
            profile_id=profile_id,
        )
        db.session.add(resume)
        results.append(resume)

    db.session.commit()
    return jsonify({
        'resumes': [r.to_dict_light() for r in results if isinstance(r, Resume)],
        'failed': [r for r in results if isinstance(r, dict)],
        'count': len([r for r in results if isinstance(r, Resume)]),
    })


@app.route('/api/evaluate/<int:id>', methods=['POST'])
def evaluate_resume(id):
    err = _require_login()
    if err: return err

    resume = db.session.get(Resume, id)
    if not resume:
        return jsonify({'error': '简历不存在'}), 404
    if resume.status in ['evaluating', 'completed']:
        return jsonify({'error': f'简历状态为 {resume.status}，无法重复评审'}), 400

    task_token = uuid.uuid4().hex
    resume.status = 'evaluating'
    resume.evaluation_task_token = task_token
    db.session.commit()

    from ai_module.resume_evaluator import run_evaluation_in_background
    thread = threading.Thread(
        target=run_evaluation_in_background,
        args=(app, db, id, task_token),
        daemon=True,
    )
    thread.start()

    return jsonify({'status': 'evaluating', 'taskToken': task_token})


@app.route('/api/resumes/<int:id>/detailed-review', methods=['POST'])
def trigger_detailed_review(id):
    err = _require_login()
    if err: return err

    resume = db.session.get(Resume, id)
    if not resume:
        return jsonify({'error': '简历不存在'}), 404

    task_token = uuid.uuid4().hex
    resume.detailed_review_status = 'processing'
    resume.detailed_review_task_token = task_token
    db.session.commit()

    from ai_module.resume_detail_reviewer import run_detailed_review_in_background
    thread = threading.Thread(
        target=run_detailed_review_in_background,
        args=(app, db, id, task_token),
        daemon=True,
    )
    thread.start()

    return jsonify({'status': 'processing', 'taskToken': task_token})


@app.route('/api/resumes/<int:id>/aigc-detection', methods=['POST'])
def trigger_aigc_detection(id):
    err = _require_login()
    if err: return err

    resume = db.session.get(Resume, id)
    if not resume:
        return jsonify({'error': '简历不存在'}), 404

    task_token = uuid.uuid4().hex
    resume.aigc_detection_status = 'processing'
    resume.aigc_detection_task_token = task_token
    db.session.commit()

    from ai_module.aigc_detector import run_aigc_detection_in_background
    thread = threading.Thread(
        target=run_aigc_detection_in_background,
        args=(app, db, id, task_token),
        daemon=True,
    )
    thread.start()

    return jsonify({'status': 'processing', 'taskToken': task_token})


@app.route('/api/resumes/<int:id>/risk-flagging', methods=['POST'])
def trigger_risk_flagging(id):
    err = _require_login()
    if err: return err

    resume = db.session.get(Resume, id)
    if not resume:
        return jsonify({'error': '简历不存在'}), 404

    task_token = uuid.uuid4().hex
    resume.risk_flagging_status = 'processing'
    resume.risk_flagging_task_token = task_token
    db.session.commit()

    from ai_module.risk_flagger import run_risk_flagging_in_background
    thread = threading.Thread(
        target=run_risk_flagging_in_background,
        args=(app, db, id, task_token),
        daemon=True,
    )
    thread.start()

    return jsonify({'status': 'processing', 'taskToken': task_token})


@app.route('/api/resumes/<int:id>/reset-evaluation', methods=['POST'])
def reset_evaluation(id):
    err = _require_admin()
    if err: return err

    resume = db.session.get(Resume, id)
    if not resume:
        return jsonify({'error': '简历不存在'}), 404

    resume.status = 'pending'
    resume.evaluation_result = None
    resume.ai_result = None
    resume.evaluation_error_message = None
    resume.evaluation_task_token = None
    db.session.commit()

    return jsonify({'message': '已重置评审状态'})


@app.route('/api/resumes/<int:id>/risk-flags', methods=['GET'])
def get_risk_flags(id):
    err = _require_login()
    if err: return err

    flags = RiskFlag.query.filter_by(resume_id=id).all()
    return jsonify([f.to_dict() for f in flags])


@app.route('/api/resumes/<int:id>/detailed-reviews', methods=['GET'])
def get_detailed_reviews(id):
    err = _require_login()
    if err: return err

    reviews = ResumeReview.query.filter_by(resume_id=id).all()
    return jsonify([r.to_dict() for r in reviews])


@app.route('/api/resumes/<int:id>/aigc-detections', methods=['GET'])
def get_aigc_detections(id):
    err = _require_login()
    if err: return err

    detections = AigcDetection.query.filter_by(resume_id=id).all()
    return jsonify([d.to_dict() for d in detections])


@app.route('/api/chat', methods=['POST'])
def chat():
    err = _require_login()
    if err: return err
    data = request.json or {}
    message = data.get('message', '')

    if not message:
        return jsonify({'error': '请输入消息'}), 400

    try:
        from ai_module.resume_evaluator import ResumeEvaluator
        evaluator = ResumeEvaluator()
        response = evaluator.llm.invoke(
            f"你是一位HR简历审查助手。请回答以下问题：\n\n{message}"
        )
        content = getattr(response, "content", str(response))
        return jsonify({'response': content})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/profiles', methods=['GET', 'POST'])
def manage_profiles():
    if request.method == 'GET':
        profiles = ReviewProfile.query.filter_by(is_active=True).all()
        return jsonify([p.to_dict() for p in profiles])

    err = _require_admin()
    if err: return err
    data = request.json or {}

    profile = ReviewProfile(
        name=data['name'],
        position_type=data.get('positionType', '通用岗位'),
        description=data.get('description', ''),
        evaluation_criteria=data['evaluationCriteria'],
        dimension_prompt_template=data['dimensionPromptTemplate'],
        overall_prompt_template=data['overallPromptTemplate'],
        creator_id=_get_current_user().id,
    )
    db.session.add(profile)
    db.session.commit()
    return jsonify(profile.to_dict())


@app.route('/api/profiles/<int:id>', methods=['GET', 'PUT', 'DELETE'])
def profile_detail(id):
    profile = db.session.get(ReviewProfile, id)
    if not profile:
        return jsonify({'error': '模板不存在'}), 404

    if request.method == 'GET':
        return jsonify(profile.to_dict())

    err = _require_admin()
    if err: return err

    if request.method == 'PUT':
        data = request.json or {}
        profile.name = data.get('name', profile.name)
        profile.position_type = data.get('positionType', profile.position_type)
        profile.description = data.get('description', profile.description)
        profile.evaluation_criteria = data.get('evaluationCriteria', profile.evaluation_criteria)
        profile.dimension_prompt_template = data.get('dimensionPromptTemplate', profile.dimension_prompt_template)
        profile.overall_prompt_template = data.get('overallPromptTemplate', profile.overall_prompt_template)
        db.session.commit()
        return jsonify(profile.to_dict())

    if request.method == 'DELETE':
        profile.is_active = False
        db.session.commit()
        return jsonify({'message': '已删除'})


@app.route('/api/profiles/<int:id>/duplicate', methods=['POST'])
def duplicate_profile(id):
    err = _require_admin()
    if err: return err
    profile = db.session.get(ReviewProfile, id)
    if not profile:
        return jsonify({'error': '模板不存在'}), 404

    new_profile = ReviewProfile(
        name=f"{profile.name} (副本)",
        position_type=profile.position_type,
        description=profile.description,
        evaluation_criteria=profile.evaluation_criteria,
        dimension_prompt_template=profile.dimension_prompt_template,
        overall_prompt_template=profile.overall_prompt_template,
        creator_id=_get_current_user().id,
    )
    db.session.add(new_profile)
    db.session.commit()
    return jsonify(new_profile.to_dict())


@app.route('/api/llm-models', methods=['GET', 'POST'])
def manage_llm_models():
    if request.method == 'GET':
        models = LLMModel.query.all()
        return jsonify([m.to_dict() for m in models])

    err = _require_admin()
    if err: return err
    data = request.json or {}

    model = LLMModel(
        name=data['name'],
        provider=data.get('provider', ''),
        model_name=data['modelName'],
        api_base=data['apiBase'],
        api_key=data['apiKey'],
        enable_thinking=data.get('enableThinking', False),
    )
    db.session.add(model)
    db.session.commit()
    return jsonify(model.to_dict())


@app.route('/api/llm-models/<int:id>', methods=['PUT', 'DELETE'])
def llm_model_detail(id):
    err = _require_admin()
    if err: return err
    model = db.session.get(LLMModel, id)
    if not model:
        return jsonify({'error': '模型不存在'}), 404

    if request.method == 'PUT':
        data = request.json or {}
        model.name = data.get('name', model.name)
        model.provider = data.get('provider', model.provider)
        model.model_name = data.get('modelName', model.model_name)
        model.api_base = data.get('apiBase', model.api_base)
        if data.get('apiKey'):
            model.api_key = data['apiKey']
        model.enable_thinking = data.get('enableThinking', model.enable_thinking)
        db.session.commit()
        return jsonify(model.to_dict())

    db.session.delete(model)
    db.session.commit()
    return jsonify({'message': '已删除'})


@app.route('/api/llm-models/<int:id>/activate', methods=['POST'])
def activate_llm_model(id):
    err = _require_admin()
    if err: return err

    LLMModel.query.update({'is_active': False})
    model = db.session.get(LLMModel, id)
    if not model:
        return jsonify({'error': '模型不存在'}), 404
    model.is_active = True
    db.session.commit()
    return jsonify(model.to_dict())


@app.route('/api/resumes/batch-delete', methods=['POST'])
def batch_delete_resumes():
    err = _require_admin()
    if err: return err
    ids = request.json or {}
    id_list = ids.get('ids', [])
    for resume_id in id_list:
        resume = db.session.get(Resume, resume_id)
        if resume:
            db.session.delete(resume)
    db.session.commit()
    return jsonify({'message': f'已删除 {len(id_list)} 条记录'})


@app.route('/api/resumes/export-scores', methods=['POST'])
def export_scores():
    err = _require_login()
    if err: return err

    ids = (request.json or {}).get('ids', [])
    resumes = Resume.query.filter(Resume.id.in_(ids)).all() if ids else Resume.query.filter_by(status='completed').all()

    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "简历评审评分表"
    headers = ['序号', '候选人', '评审模板', '总分', '等级', '评审时间', '风险数']
    ws.append(headers)

    for i, r in enumerate(resumes, 1):
        result = r.evaluation_result or {}
        overall = result.get('overall_evaluation', {})
        ws.append([
            i, r.candidate_name or '',
            r.profile.name if r.profile else '',
            overall.get('overall_score', ''),
            overall.get('overall_grade', ''),
            r.evaluation_time.isoformat() if r.evaluation_time else '',
            r.risk_flag_count or 0,
        ])

    output_dir = os.path.join(STORAGE_PATH, 'exports')
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f'scores_{datetime.now().strftime("%Y%m%d%H%M%S")}.xlsx')
    wb.save(output_path)

    return send_file(output_path, as_attachment=True, download_name=os.path.basename(output_path))


@app.route('/api/system-settings', methods=['GET', 'PUT'])
def system_settings():
    if request.method == 'GET':
        settings = SystemSettings.query.all()
        return jsonify([s.to_dict() for s in settings])

    err = _require_admin()
    if err: return err
    data = request.json or {}
    for key, value in data.items():
        setting = SystemSettings.query.filter_by(key=key).first()
        if setting:
            setting.value = str(value)
        else:
            setting = SystemSettings(key=key, value=str(value))
            db.session.add(setting)
    db.session.commit()
    return jsonify({'message': '已更新'})


@app.route('/api/feedback', methods=['POST', 'GET'])
def feedback():
    if request.method == 'GET':
        err = _require_admin()
        if err: return err
        feedbacks = Feedback.query.order_by(Feedback.created_at.desc()).all()
        return jsonify([f.to_dict() for f in feedbacks])

    err = _require_login()
    if err: return err
    data = request.json or {}
    fb = Feedback(user_id=_get_current_user().id, content=data.get('content', ''))
    db.session.add(fb)
    db.session.commit()
    return jsonify(fb.to_dict())


@app.route('/api/feedback/<int:id>/read', methods=['PUT'])
def mark_feedback_read(id):
    err = _require_admin()
    if err: return err
    fb = db.session.get(Feedback, id)
    if fb:
        fb.status = 'read'
        db.session.commit()
    return jsonify({'message': '已标记'})


@app.route('/api/aigc-threshold', methods=['GET', 'PUT'])
def aigc_threshold():
    from resume_models import AigcThreshold
    if request.method == 'GET':
        threshold = AigcThreshold.query.first()
        if not threshold:
            threshold = AigcThreshold()
            db.session.add(threshold)
            db.session.commit()
        return jsonify(threshold.to_dict())

    err = _require_admin()
    if err: return err
    data = request.json or {}
    threshold = AigcThreshold.query.first()
    if not threshold:
        threshold = AigcThreshold()
        db.session.add(threshold)
    threshold.high_risk_threshold = float(data.get('highRiskThreshold', 80))
    threshold.medium_risk_threshold = float(data.get('mediumRiskThreshold', 60))
    threshold.overall_alert_threshold = float(data.get('overallAlertThreshold', 70))
    db.session.commit()
    return jsonify(threshold.to_dict())


@app.after_request
def after_request(response):
    origin = request.headers.get('Origin', '')
    if origin:
        response.headers.add('Access-Control-Allow-Origin', origin)
        response.headers.add('Access-Control-Allow-Credentials', 'true')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    return response


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5001))
    app.run(host='0.0.0.0', port=port, debug=True)
