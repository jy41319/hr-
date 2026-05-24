# CVizr

CV + viz + er：面向 HR 的 AI 招聘初筛工作台。

瞬间识别简历中的错别字、格式问题、逻辑漏洞，自动标记风险点，检测AI生成痕迹。从2小时的繁琐审阅压缩到5分钟，让招聘效率起飞！

## 系统架构

```
hr-resume-bot/
├── backend/                 # 后端服务 (Flask)
│   ├── ai_module/           # AI审查模块
│   │   ├── resume_evaluator.py      # 多维度简历评审器
│   │   ├── resume_detail_reviewer.py # 逐段批注器
│   │   ├── risk_flagger.py          # 风险标记器
│   │   ├── resume_parser.py         # 结构化信息提取器
│   │   ├── aigc_detector.py         # AIGC检测器
│   │   ├── profile_resolver.py      # 岗位模板匹配
│   │   ├── resume_prompts.py        # Prompt与Pydantic模型
│   │   ├── resume_structure.py      # 简历结构提取器
│   │   ├── document_reader.py       # 文档解析器
│   │   ├── token_counter.py         # Token计数
│   │   └── config/
│   │       └── general_resume_criteria.json
│   ├── resume_models.py             # 数据库模型
│   ├── app.py                       # Flask主应用
│   ├── task_control.py              # 异步任务控制
│   └── requirements.txt
├── frontend/                # 前端页面 (React + Vite + Tailwind CSS)
│   ├── src/pages/           # 页面组件
│   ├── src/layouts/         # 布局组件
│   ├── src/config/          # API配置
│   └── package.json
├── .env.example
└── README.md
```

## 功能特点

- **AI问答**: 与HR审查助手对话，咨询简历审查建议
- **单份审查**: 上传简历→6维度AI评审→雷达图+等级+批注
- **批量审查**: 多简历批量上传、评审、排名、导出评分表
- **AIGC检测**: 检测简历中的AI生成痕迹，段落级概率检测
- **风险标记**: 5类风险自动标记（时间矛盾/夸大表述/信息缺失/格式问题/AIGC痕迹）
- **逐段批注**: Word/PDF逐段批注+高亮，输出带批注文档
- **岗位模板**: 不同岗位的评审维度和权重配置
- **模型管理**: 支持配置多个LLM模型，灵活切换

## 评审维度

| 维度 | 权重 | 考察点 |
|------|------|--------|
| 基本信息完整性 | 15% | 姓名/联系方式/学历/求职意向 |
| 格式规范性 | 10% | 排版/错别字/标点/篇幅 |
| 工作经历逻辑性 | 30% | 时间线/职位晋升/业绩描述 |
| 技能匹配度 | 20% | 核心技能/证书/项目佐证 |
| 风险评估 | 15% | 时间矛盾/夸大/缺失/AIGC |
| 综合印象 | 10% | 职业成熟度/自我评价/亮点 |

## 安装部署

### 环境要求
- Python 3.12+
- Node.js 18+ & npm
- 支持的浏览器（Chrome, Firefox, Safari等）

### 安装步骤

1. **配置环境变量**
   在项目根目录创建 `.env` 文件（参考 `.env.example`）：
   ```env
   # AI 模型配置
   OPENAI_API_KEY="sk-your-kimi-api-key"
   OPENAI_API_BASE="https://api.moonshot.cn/v1"
   OPENAI_MODEL_NAME="kimi-k2.6"
   
   # Flask
   SECRET_KEY=your-secret-key
   
   # 数据库（默认sqlite，生产可切换postgresql）
   DATABASE_TYPE=sqlite
   ```

2. **安装后端依赖**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

3. **安装前端依赖**
   ```bash
   cd frontend
   npm install
   ```

### 开发环境

```bash
# 终端1：启动后端
cd backend
python app.py

# 终端2：启动前端
cd frontend
npm run dev
```

访问 `http://localhost:5173`

### 生产环境构建

```bash
cd frontend
npm run build
```

构建产物输出到 `frontend/dist/`，可使用 Nginx 部署。

## 默认账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | admin | admin123 |

## 技术栈

- **后端**: Flask + LangChain + Pydantic + SQLAlchemy + python-docx + PyMuPDF + reportlab
- **前端**: React 19 + Vite + Tailwind CSS + Recharts + lucide-react
- **AI引擎**: OpenAI兼容接口（通义千问等）
- **数据库**: SQLite (dev) / PostgreSQL (prod)

## 许可证

本项目仅供学习和研究使用。
