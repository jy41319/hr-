import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import api from '../config/api'
import {
  Loader2, FileText, Download, AlertTriangle, Info, CheckCircle,
  XCircle, Briefcase, MessageSquare, ShieldAlert, Target, ClipboardCheck
} from 'lucide-react'
import {
  RadarChart, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, Tooltip
} from 'recharts'

function GradeBadge({ grade }) {
  if (!grade) return null
  return <span className={`grade-badge grade-${grade}`}>{grade}</span>
}

const SEVERITY_MAP = {
  critical: { label: '严重', color: 'bg-red-100 text-red-800 border-red-300', icon: XCircle },
  major: { label: '重要', color: 'bg-orange-100 text-orange-800 border-orange-300', icon: AlertTriangle },
  moderate: { label: '中等', color: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: Info },
  minor: { label: '轻微', color: 'bg-cyan-100 text-cyan-800 border-cyan-300', icon: CheckCircle },
}

const DIMENSION_LABELS = {
  basic_info: '基本信息完整性',
  format: '格式规范性',
  work_logic: '工作经历逻辑性',
  skill_match: '技能匹配度',
  risk_assessment: '风险评估',
  overall_impression: '综合印象',
}

const RISK_LABELS = {
  timeline: '时间线矛盾',
  missing_info: '信息缺失',
  credential: '证书/学历疑点',
  exaggeration: '夸大表述',
  aigc: 'AI痕迹',
  salary: '薪资预期不合理',
}

const RISK_MAP = {
  low: { label: '低风险', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  medium: { label: '中风险', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  high: { label: '高风险', color: 'bg-red-100 text-red-700 border-red-200' },
}

const WORKFLOW_MAP = {
  new: '未处理',
  shortlisted: '待面试',
  needs_review: '待复核',
  rejected: '已淘汰',
  archived: '已入库',
}

function normalizeDimensions(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).map(([key, item]) => ({
    dimension: item?.dimension || DIMENSION_LABELS[key] || key,
    ...item,
  }))
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function inferRiskLevel(score) {
  if ((score || 0) < 60) return 'high'
  if ((score || 0) < 75) return 'medium'
  return 'low'
}

function inferRecommendation(score, riskLevel) {
  if (riskLevel === 'high') return '建议人工复核'
  if ((score || 0) >= 75) return '推荐面试'
  if ((score || 0) >= 60) return '待定'
  return '建议淘汰'
}

export default function ReportPage() {
  const { id } = useParams()
  const [resume, setResume] = useState(null)
  const [evaluation, setEvaluation] = useState(null)
  const [detailedReviews, setDetailedReviews] = useState([])
  const [activeView, setActiveView] = useState('decision')
  const [note, setNote] = useState('')
  const [workflowStatus, setWorkflowStatus] = useState('new')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadData()
  }, [id])

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [resumeRes, evalRes, detailRes] = await Promise.all([
        api.get(`/resumes/${id}`),
        api.get(`/resumes/${id}/evaluation`),
        api.get(`/resumes/${id}/detailed-reviews`),
      ])
      setResume(resumeRes.data)
      setEvaluation(evalRes.data)
      setDetailedReviews(detailRes.data.items || detailRes.data || [])
      setNote(resumeRes.data.hrNote || '')
      setWorkflowStatus(resumeRes.data.workflowStatus || 'new')
    } catch (err) {
      setError(err.response?.data?.error || '加载报告失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    try {
      const res = await api.get(`/resumes/${id}/download-report`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href = url
      const disposition = res.headers?.['content-disposition'] || ''
      const matched = disposition.match(/filename="?([^"]+)"?/)
      link.download = matched?.[1] || `interview_brief_${id}.txt`
      link.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.response?.data?.error || '下载报告失败')
    }
  }

  const saveWorkflow = async (nextStatus = workflowStatus, nextNote = note) => {
    setSaving(true)
    try {
      const res = await api.put(`/resumes/${id}/workflow`, { workflowStatus: nextStatus, hrNote: nextNote })
      setResume(res.data)
      setWorkflowStatus(res.data.workflowStatus || nextStatus)
      setNote(res.data.hrNote || nextNote)
    } catch (err) {
      setError(err.response?.data?.error || '保存处理状态失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400"><Loader2 className="w-8 h-8 animate-spin mr-3" /> 加载报告...</div>
  }

  if (error) return <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg">{error}</div>

  const overall = evaluation?.overall_evaluation || {}
  const dimensions = normalizeDimensions(evaluation?.dimension_evaluations)
  const fallbackHighlights = dimensions.map(d => d.strengths).filter(Boolean).slice(0, 3)
  const fallbackConcerns = dimensions.map(d => d.weaknesses).filter(Boolean).slice(0, 3)
  const highlights = ensureArray(evaluation?.highlights).length ? ensureArray(evaluation?.highlights) : fallbackHighlights
  const concerns = ensureArray(evaluation?.concerns).length ? ensureArray(evaluation?.concerns) : fallbackConcerns
  const questions = ensureArray(evaluation?.interview_questions)
  const evidence = ensureArray(evaluation?.evidence_snippets)
  const matchScore = evaluation?.match_score ?? resume?.matchScore ?? overall.overall_score
  const riskLevel = evaluation?.risk_level || resume?.riskLevel || inferRiskLevel(matchScore)
  const recommendation = evaluation?.recommendation || resume?.recommendation || inferRecommendation(matchScore, riskLevel)
  const risk = RISK_MAP[riskLevel] || RISK_MAP.medium
  const radarData = dimensions.map(d => ({ dimension: d.dimension, score: d.score, fullMark: 100 }))

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-sm font-medium text-cyan-600">AI 招聘初筛报告</p>
          <h2 className="text-2xl font-bold text-slate-900">{resume?.candidateName || `简历 #${id}`}</h2>
        </div>
        <button onClick={handleDownload} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium flex items-center gap-2"><Download className="w-4 h-4" /> 导出面试摘要</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-sm text-slate-500">综合评分</p><div className="flex items-center gap-2"><span className="text-3xl font-bold text-indigo-600">{overall.overall_score ?? '-'}</span><GradeBadge grade={overall.overall_grade} /></div></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-sm text-slate-500">JD匹配分</p><p className="text-3xl font-bold text-cyan-600">{matchScore ?? '-'}</p></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-sm text-slate-500">建议动作</p><p className="text-xl font-bold text-slate-900">{recommendation}</p></div>
        <div className={`rounded-xl border p-4 ${risk.color}`}><p className="text-sm opacity-80">风险等级</p><p className="text-xl font-bold">{risk.label}</p></div>
      </div>

      {resume?.jobDescription && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><Briefcase className="w-5 h-5 text-indigo-500" /> 岗位JD</h3>
          <p className="text-sm text-slate-600 whitespace-pre-wrap line-clamp-5">{resume.jobDescription}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-2 mb-6 inline-flex gap-2">
        <button onClick={() => setActiveView('decision')} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeView === 'decision' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>HR决策视图</button>
        <button onClick={() => setActiveView('interview')} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeView === 'interview' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>面试官摘要</button>
      </div>

      {activeView === 'decision' ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><Target className="w-5 h-5 text-indigo-500" /> HR决策摘要</h3>
              {overall.overall_feedback && <p className="text-sm text-slate-600 p-3 bg-slate-50 rounded-lg mb-4">{overall.overall_feedback}</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><h4 className="font-semibold text-emerald-700 mb-2">核心亮点</h4>{highlights.map((item, i) => <p key={i} className="text-sm text-slate-600 mb-1">• {item}</p>)}</div>
                <div><h4 className="font-semibold text-amber-700 mb-2">主要短板</h4>{concerns.map((item, i) => <p key={i} className="text-sm text-slate-600 mb-1">• {item}</p>)}</div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-indigo-500" /> HR处理闭环</h3>
              <label className="block text-sm font-medium text-slate-700 mb-1">处理状态</label>
              <select value={workflowStatus} onChange={e => { setWorkflowStatus(e.target.value); saveWorkflow(e.target.value, note) }} className="w-full px-3 py-2 rounded-lg border border-slate-300 mb-3">
                {Object.entries(WORKFLOW_MAP).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <label className="block text-sm font-medium text-slate-700 mb-1">HR备注</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} onBlur={() => saveWorkflow(workflowStatus, note)} rows={5} placeholder="如：业务方觉得项目不错；薪资偏高但可聊" className="w-full px-3 py-2 rounded-lg border border-slate-300 resize-none" />
              {saving && <p className="text-xs text-slate-400 mt-2">保存中...</p>}
            </div>
          </div>

          {evidence.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-red-500" /> 需人工复核：风险证据链</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {evidence.map((item, i) => <div key={i} className="border border-amber-200 bg-amber-50 rounded-lg p-4"><p className="text-sm font-semibold text-amber-800 mb-1">{item.risk_label || RISK_LABELS[item.risk_type] || '风险证据'}</p><p className="text-xs text-slate-500 mb-2">原文：{item.evidence || '未提供原文'}</p><p className="text-sm text-slate-700">{item.finding}</p></div>)}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <h3 className="font-bold text-slate-800 mb-4">维度评分</h3>
            {radarData.length > 0 && <ResponsiveContainer width="100%" height={280}><RadarChart data={radarData}><PolarAngleAxis dataKey="dimension" tick={{ fill: '#475569', fontSize: 12 }} /><PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} /><Radar name="评分" dataKey="score" stroke="#4f46e5" fill="#818cf8" fillOpacity={0.4} strokeWidth={2} /><Tooltip /></RadarChart></ResponsiveContainer>}
          </div>

          {dimensions.length > 0 && <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">{dimensions.map(d => <div key={d.dimension} className="bg-white rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between mb-2"><span className="font-medium text-slate-800">{d.dimension}</span><span className="text-sm font-bold text-indigo-600">{d.score}</span></div><div className="w-full bg-slate-100 rounded-full h-2 mb-2"><div className="bg-indigo-500 rounded-full h-2" style={{ width: `${d.score}%` }} /></div><p className="text-sm text-slate-600">{d.feedback}</p></div>)}</div>}
        </>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><MessageSquare className="w-5 h-5 text-indigo-500" /> 面试官一屏摘要</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-4"><h4 className="font-semibold text-emerald-800 mb-2">3个亮点</h4>{highlights.slice(0, 3).map((x, i) => <p key={i} className="text-sm text-slate-700 mb-1">{i + 1}. {x}</p>)}</div>
            <div className="rounded-lg bg-amber-50 border border-amber-100 p-4"><h4 className="font-semibold text-amber-800 mb-2">3个风险</h4>{concerns.slice(0, 3).map((x, i) => <p key={i} className="text-sm text-slate-700 mb-1">{i + 1}. {x}</p>)}</div>
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-4"><h4 className="font-semibold text-indigo-800 mb-2">薪资/经验疑点</h4><p className="text-sm text-slate-700">{evidence.find(x => ['salary', 'exaggeration', 'credential'].includes(x.risk_type))?.finding || concerns[0] || '暂无明显疑点，建议面试中补充验证。'}</p></div>
          </div>
          <h4 className="font-semibold text-slate-800 mb-3">5个建议面试问题</h4>
          <div className="space-y-2">{questions.slice(0, 5).map((q, i) => <div key={i} className="flex gap-3 p-3 rounded-lg border border-slate-200"><span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">{i + 1}</span><p className="text-sm text-slate-700">{q}</p></div>)}</div>
        </div>
      )}

      {detailedReviews.length > 0 && <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6"><h3 className="font-bold text-slate-800 mb-4">段落批注</h3><div className="space-y-3">{detailedReviews.map((r, i) => { const sev = SEVERITY_MAP[r.severity] || SEVERITY_MAP.moderate; const SevIcon = sev.icon; return <div key={i} className={`rounded-lg border p-4 ${sev.color}`}><div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><SevIcon className="w-4 h-4" /><span className="font-medium">{r.section || r.paragraph_title || `段落 ${i + 1}`}</span></div><span className="text-xs font-medium px-2 py-0.5 rounded-full border">{sev.label}</span></div>{r.original_text && <p className="text-xs text-slate-500 mb-1 bg-white/50 rounded px-2 py-1">原文: {r.original_text}</p>}<p className="text-sm">{r.feedback || r.comment || r.annotation}</p></div>})}</div></div>}
    </div>
  )
}
