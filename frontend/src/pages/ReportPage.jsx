import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import api from '../config/api'
import {
  Loader2, FileText, Download, AlertTriangle, Info, CheckCircle,
  XCircle, Briefcase, MessageSquare, ShieldAlert, Target, ClipboardCheck, ThumbsUp, Save, ChevronDown
} from 'lucide-react'
import {
  RadarChart, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, Tooltip
} from 'recharts'

function GradeBadge({ grade }) {
  if (!grade) return null
  return <span className={`grade-badge grade-${grade}`}>{grade}</span>
}

function gradeFromScore(score) {
  const value = Number(score || 0)
  if (value >= 90) return 'A'
  if (value >= 80) return 'B'
  if (value >= 70) return 'C'
  if (value >= 60) return 'D'
  return 'E'
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

function statusLabel(status) {
  return {
    met: '已满足',
    partial: '部分满足',
    missing: '缺失',
    unknown: '待确认',
  }[status] || '待确认'
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

function compactText(value, max = 44) {
  const text = String(value || '')
    .replace(/\*\*/g, '')
    .replace(/[【】]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[•\-、\d.一二三四五六七八九十]+[、.)：:]\s*/, '')
    .replace(/^该简历在.*?方面/, '该项')
    .replace(/具体分析如下[:：]?/g, '')
    .replace(/问题严重/g, '需重点修正')
    .trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function splitBriefClauses(value) {
  return String(value || '')
    .split(/[。；;\n，,]/)
    .map(item => compactText(item))
    .filter(Boolean)
    .filter(item => !/暂无|待人工复核|AI未能生成|结论|具体分析|^\d+$/.test(item))
    .filter(item => item.length >= 6)
}

function cleanDetailText(value) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function buildDimensionPoints(dimension) {
  const evidenceQuotes = ensureArray(dimension.evidence_quotes || dimension.evidenceQuotes || dimension.evidence)
    .map(item => {
      if (typeof item === 'string') {
        return { summary: '简历原文证据', detail: item }
      }
      if (!item || typeof item !== 'object') return null
      const quote = item.evidence || item.quote || item.original_text
      if (!quote) return null
      return {
        summary: compactText(item.summary || item.point || item.claim || '简历原文证据', 56),
        detail: `简历原文：${cleanDetailText(quote)}`,
      }
    })
    .filter(Boolean)
  if (evidenceQuotes.length) return evidenceQuotes.slice(0, 3)

  const strengthPoints = splitBriefClauses(dimension.strengths).map(summary => ({
    summary,
    detail: '这条总结暂未关联到具体简历原文。新评估会优先自动补齐原文证据。',
  }))
  const weaknessPoints = splitBriefClauses(dimension.weaknesses).map(summary => ({
    summary,
    detail: '这条总结暂未关联到具体简历原文。新评估会优先自动补齐原文证据。',
  }))
  const bulletLines = String(dimension.feedback || '')
    .split('\n')
    .filter(line => /^\s*[-•]/.test(line))
    .flatMap(line => splitBriefClauses(line).map(summary => ({
      summary,
      detail: '这条总结暂未关联到具体简历原文。新评估会优先自动补齐原文证据。',
    })))

  const seen = new Set()
  return [...strengthPoints, ...weaknessPoints, ...bulletLines]
    .filter(item => {
      if (seen.has(item.summary)) return false
      seen.add(item.summary)
      return true
    })
    .slice(0, 3)
}

function displayValue(value) {
  const text = String(value || '').trim()
  return text || '待确认'
}

function mergeNonEmptyInfo(...sources) {
  return sources.reduce((acc, source) => {
    if (!source || typeof source !== 'object') return acc
    Object.entries(source).forEach(([key, value]) => {
      const text = String(value || '').trim()
      if (text) acc[key] = text
    })
    return acc
  }, {})
}

export default function ReportPage() {
  const { id } = useParams()
  const [resume, setResume] = useState(null)
  const [evaluation, setEvaluation] = useState(null)
  const [detailedReviews, setDetailedReviews] = useState([])
  const [activeView, setActiveView] = useState('decision')
  const [note, setNote] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [workflowStatus, setWorkflowStatus] = useState('new')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [noteStatus, setNoteStatus] = useState('')
  const [jdExpanded, setJdExpanded] = useState(false)
  const [rulerExpanded, setRulerExpanded] = useState(false)
  const [recommendationFeedback, setRecommendationFeedback] = useState('')
  const [businessFeedback, setBusinessFeedback] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailFeedback, setDetailFeedback] = useState('')
  const [savedDetailFeedback, setSavedDetailFeedback] = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState('')
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
      setSavedNote(resumeRes.data.hrNote || '')
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
      link.download = matched?.[1] || `CVizr_interview_brief_${id}.docx`
      link.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.response?.data?.error || '下载报告失败')
    }
  }

  const saveWorkflow = async (nextStatus = workflowStatus, nextNote = note) => {
    setSaving(true)
    setNoteStatus('saving')
    try {
      const res = await api.put(`/resumes/${id}/workflow`, { workflowStatus: nextStatus, hrNote: nextNote })
      setResume(res.data)
      setWorkflowStatus(res.data.workflowStatus || nextStatus)
      setNote(res.data.hrNote || nextNote)
      setSavedNote(res.data.hrNote || nextNote)
      setNoteStatus('saved')
      setTimeout(() => setNoteStatus(''), 1600)
    } catch (err) {
      setNoteStatus('error')
      setError(err.response?.data?.error || '保存处理状态失败')
    } finally {
      setSaving(false)
    }
  }

  const sendFeedback = async ({ group, label, value, detail = '' }) => {
    const nextRecommendationFeedback = group === 'recommendation' ? value : recommendationFeedback
    const nextBusinessFeedback = group === 'business' ? value : businessFeedback
    setFeedbackStatus('saving')
    try {
      await api.post('/feedback', {
        content: JSON.stringify({
          type: 'candidate_decision_feedback',
          resumeId: Number(id),
          candidateName: resume?.candidateName,
          group,
          label,
          value,
          detail,
          recommendationFeedback: nextRecommendationFeedback,
          businessFeedback: nextBusinessFeedback,
          recommendation: evaluation?.recommendation,
          matchScore: evaluation?.match_score,
          source: 'report_page',
        }, null, 2),
      })
      if (group === 'recommendation') setRecommendationFeedback(value)
      if (group === 'business') setBusinessFeedback(value)
      if (group === 'detail') setSavedDetailFeedback(detail)
      setFeedbackStatus('saved')
      setTimeout(() => setFeedbackStatus(''), 1800)
    } catch (err) {
      setFeedbackStatus('error')
      setError(err.response?.data?.error || '反馈保存失败')
    }
  }

  const toggleChoiceFeedback = ({ group, label, value }) => {
    const currentValue = group === 'recommendation' ? recommendationFeedback : businessFeedback
    const nextValue = currentValue === value ? '' : value
    sendFeedback({
      group,
      label: currentValue === value ? `取消${label}` : label,
      value: nextValue,
    })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400"><Loader2 className="w-8 h-8 animate-spin mr-3" /> 加载报告...</div>
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg">{error}</div>
      </div>
    )
  }

  const overall = evaluation?.overall_evaluation || {}
  const dimensions = normalizeDimensions(evaluation?.dimension_evaluations)
  const fallbackHighlights = dimensions.map(d => d.strengths).filter(Boolean).slice(0, 3)
  const fallbackConcerns = dimensions.map(d => d.weaknesses).filter(Boolean).slice(0, 3)
  const highlights = ensureArray(evaluation?.highlights).length ? ensureArray(evaluation?.highlights) : fallbackHighlights
  const concerns = ensureArray(evaluation?.concerns).length ? ensureArray(evaluation?.concerns) : fallbackConcerns
  const questions = ensureArray(evaluation?.interview_questions)
  const evidence = ensureArray(evaluation?.evidence_snippets)
  const jdCriteria = evaluation?.jd_criteria || resume?.jdCriteria || {}
  const requirementMatches = ensureArray(evaluation?.requirement_matches || resume?.requirementMatches)
  const recommendationReason = evaluation?.recommendation_reason || resume?.recommendationReason || ''
  const candidateProfileSummary = evaluation?.candidate_profile_summary || resume?.candidateProfileSummary || ''
  const candidateBasicInfo = mergeNonEmptyInfo(resume?.candidateBasicInfo, evaluation?.candidate_basic_info)
  const keyGaps = ensureArray(evaluation?.key_gaps || resume?.keyGaps)
  const matchScore = evaluation?.match_score ?? resume?.matchScore ?? overall.overall_score
  const matchGrade = evaluation?.match_grade || resume?.matchGrade || (matchScore !== undefined && matchScore !== null ? gradeFromScore(matchScore) : '')
  const riskLevel = evaluation?.risk_level || resume?.riskLevel || inferRiskLevel(matchScore)
  const recommendation = evaluation?.recommendation || resume?.recommendation || inferRecommendation(matchScore, riskLevel)
  const risk = RISK_MAP[riskLevel] || RISK_MAP.medium
  const radarData = dimensions.map(d => ({ dimension: d.dimension, score: d.score, fullMark: 100 }))
  const basicInfoItems = [
    ['年龄', candidateBasicInfo.age],
    ['性别', candidateBasicInfo.gender],
    ['最高学历', candidateBasicInfo.education],
    ['毕业院校', candidateBasicInfo.school],
    ['专业', candidateBasicInfo.major],
    ['毕业年份', candidateBasicInfo.graduation_year],
    ['城市', candidateBasicInfo.city],
    ['工作年限', candidateBasicInfo.work_years],
    ['期望薪资', candidateBasicInfo.expected_salary],
    ['电话', resume?.candidatePhone],
    ['邮箱', resume?.candidateEmail],
  ]
  const noteDirty = note !== savedNote
  const detailFeedbackDirty = detailFeedback.trim() !== savedDetailFeedback.trim()

  return (
    <div className="max-w-6xl mx-auto motion-panel">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div>
            <p className="text-sm font-medium text-cyan-600">AI 招聘初筛报告</p>
          <h2 className="text-2xl font-bold text-slate-900">{resume?.candidateName || `简历 #${id}`}</h2>
        </div>
        <button onClick={handleDownload} className="btn-primary px-4 py-2 font-medium flex items-center gap-2"><Download className="w-4 h-4" /> 导出Word面试摘要</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="glass-card p-4"><p className="text-sm text-slate-500">综合评分</p><div className="flex items-center gap-2"><span className="text-3xl font-bold text-indigo-600">{overall.overall_score ?? '-'}</span><GradeBadge grade={overall.overall_grade} /></div></div>
        <div className="glass-card p-4"><p className="text-sm text-slate-500">当前JD匹配分</p><div className="flex items-center gap-2"><p className="text-3xl font-bold text-cyan-600">{matchScore ?? '-'}</p><GradeBadge grade={matchGrade} /></div></div>
        <div className="glass-card p-4"><p className="text-sm text-slate-500">建议动作</p><p className="text-xl font-bold text-slate-900">{recommendation}</p></div>
        <div className={`rounded-xl border p-4 ${risk.color}`}><p className="text-sm opacity-80">风险等级</p><p className="text-xl font-bold">{risk.label}</p></div>
      </div>

      <div className="glass-card p-5 mb-6">
        <div className="mb-4 flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="font-bold text-slate-900">候选人基本信息</h3>
            <p className="mt-1 text-xs text-slate-500">仅展示简历可识别信息；年龄、性别等只作为 HR 人工辅助查看，不参与自动淘汰。</p>
          </div>
          {candidateProfileSummary && <p className="max-w-xl text-sm text-slate-600">{candidateProfileSummary}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {basicInfoItems.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-white/70 bg-white/60 px-3 py-3">
              <p className="text-xs font-semibold text-slate-400">{label}</p>
              <p className="mt-1 truncate text-sm font-bold text-slate-800" title={displayValue(value)}>{displayValue(value)}</p>
            </div>
          ))}
        </div>
      </div>

      {resume?.jobDescription && (
        <div className="glass-card p-5 mb-6">
          <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <h3 className="font-bold text-slate-800 flex items-center gap-2"><Briefcase className="w-5 h-5 text-indigo-500" /> 本次岗位 JD：主要筛选标准</h3>
            <button
              onClick={() => setJdExpanded(value => !value)}
              className="chip-button self-start px-3 py-1.5 text-xs font-bold text-slate-700 md:self-auto"
            >
              {jdExpanded ? '收起JD' : '展开完整JD'}
              <ChevronDown className={`ml-1 inline h-3.5 w-3.5 transition-transform ${jdExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
          <div className={`rounded-2xl border border-white/70 bg-white/55 p-4 transition-all ${jdExpanded ? 'max-h-[680px] overflow-auto' : 'max-h-28 overflow-hidden'}`}>
            <p className="text-sm leading-7 text-slate-700 whitespace-pre-wrap">{resume.jobDescription}</p>
          </div>
          {!jdExpanded && <div className="-mt-8 h-8 rounded-b-2xl bg-gradient-to-t from-white/90 to-transparent pointer-events-none" />}
          <p className="mt-3 text-xs text-slate-500">本报告的匹配分、推荐动作、亮点短板和面试问题优先围绕这份 JD 生成。</p>
        </div>
      )}

      {(jdCriteria.must_have_requirements?.length || jdCriteria.core_responsibilities?.length) && (
        <div className="glass-card p-6 mb-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="font-bold text-slate-900 flex items-center gap-2"><Target className="w-5 h-5 text-cyan-500" /> 本次岗位筛选尺子</h3>
              <p className="mt-1 text-xs text-slate-500">系统从 JD 中提炼出的初筛依据，默认收起，展开后可查看完整标准。</p>
            </div>
            <button
              onClick={() => setRulerExpanded(value => !value)}
              className="chip-button self-start px-3 py-1.5 text-xs font-bold text-slate-700 md:self-auto"
            >
              {rulerExpanded ? '收起筛选尺子' : '展开筛选尺子'}
              <ChevronDown className={`ml-1 inline h-3.5 w-3.5 transition-transform ${rulerExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {rulerExpanded && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <RulerColumn title="硬性要求" items={jdCriteria.must_have_requirements} tone="cyan" />
              <RulerColumn title="核心职责" items={jdCriteria.core_responsibilities} tone="indigo" />
              <RulerColumn title="加分项" items={jdCriteria.nice_to_have} tone="emerald" />
              <RulerColumn title="风险关注" items={jdCriteria.risk_watchpoints} tone="amber" />
              <RulerColumn title="面试重点" items={jdCriteria.interview_focus} tone="slate" />
            </div>
          )}
        </div>
      )}

      <div className="glass-card p-2 mb-6 inline-flex gap-2">
        <button onClick={() => setActiveView('decision')} className={`chip-button px-4 py-2 text-sm font-medium ${activeView === 'decision' ? 'is-active' : ''}`}>HR决策视图</button>
        <button onClick={() => setActiveView('interview')} className={`chip-button px-4 py-2 text-sm font-medium ${activeView === 'interview' ? 'is-active' : ''}`}>面试官摘要</button>
      </div>

      {activeView === 'decision' ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="lg:col-span-2 glass-card p-6">
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><Target className="w-5 h-5 text-indigo-500" /> HR决策摘要：按当前JD判断</h3>
              {recommendationReason && <p className="text-sm text-slate-700 p-3 bg-slate-950 text-white rounded-2xl mb-4">{recommendationReason}</p>}
              {overall.overall_feedback && <p className="text-sm text-slate-600 p-3 bg-slate-50 rounded-lg mb-4">{overall.overall_feedback}</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><h4 className="font-semibold text-emerald-700 mb-2">核心亮点</h4>{highlights.map((item, i) => <p key={i} className="text-sm text-slate-600 mb-1">• {item}</p>)}</div>
                <div><h4 className="font-semibold text-amber-700 mb-2">主要短板</h4>{concerns.map((item, i) => <p key={i} className="text-sm text-slate-600 mb-1">• {item}</p>)}</div>
              </div>
              {keyGaps.length > 0 && <div className="mt-4 rounded-2xl bg-amber-50 border border-amber-100 p-4"><h4 className="font-semibold text-amber-800 mb-2">关键缺口</h4>{keyGaps.map((item, i) => <p key={i} className="text-sm text-slate-700 mb-1">• {item}</p>)}</div>}
            </div>
            <div className="glass-card p-6">
              <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-indigo-500" /> HR处理闭环</h3>
              <label className="block text-sm font-medium text-slate-700 mb-1">处理状态</label>
              <select value={workflowStatus} onChange={e => { setWorkflowStatus(e.target.value); saveWorkflow(e.target.value, note) }} className="w-full px-3 py-2 rounded-lg border border-slate-300 mb-3">
                {Object.entries(WORKFLOW_MAP).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <label className="block text-sm font-medium text-slate-700 mb-1">HR备注</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={5} placeholder="如：业务方觉得项目不错；薪资偏高但可聊" className="w-full px-3 py-2 rounded-lg border border-slate-300 resize-none" />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className={`text-xs ${noteStatus === 'saved' ? 'text-emerald-600' : noteStatus === 'error' ? 'text-red-600' : 'text-slate-400'}`}>
                  {noteStatus === 'saving' ? '保存中...' : noteStatus === 'saved' ? '备注已保存' : noteStatus === 'error' ? '保存失败，请重试' : noteDirty ? '备注有未保存修改' : ' '}
                </p>
                {noteDirty && (
                  <button
                    onClick={() => saveWorkflow(workflowStatus, note)}
                    disabled={saving}
                    className="btn-primary px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5" /> 保存修改
                  </button>
                )}
              </div>
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-700"><ThumbsUp className="w-4 h-4" /> HR反馈</p>
                <p className="mb-2 text-xs font-semibold text-slate-500">AI推荐是否准确</p>
                <div className="grid grid-cols-2 gap-2">
                  <FeedbackButton active={recommendationFeedback === 'accurate'} label="推荐准确" onClick={() => toggleChoiceFeedback({ group: 'recommendation', label: '推荐准确', value: 'accurate' })} />
                  <FeedbackButton active={recommendationFeedback === 'inaccurate'} label="推荐不准" onClick={() => toggleChoiceFeedback({ group: 'recommendation', label: '推荐不准', value: 'inaccurate' })} />
                </div>
                <p className="mb-2 mt-3 text-xs font-semibold text-slate-500">业务面试结果</p>
                <div className="grid grid-cols-2 gap-2">
                  <FeedbackButton active={businessFeedback === 'passed'} label="业务通过" onClick={() => toggleChoiceFeedback({ group: 'business', label: '业务通过', value: 'passed' })} />
                  <FeedbackButton active={businessFeedback === 'rejected'} label="业务拒绝" onClick={() => toggleChoiceFeedback({ group: 'business', label: '业务拒绝', value: 'rejected' })} />
                </div>
                <button onClick={() => setDetailOpen(value => !value)} className="mt-3 text-xs font-bold text-cyan-700 hover:text-cyan-900">{detailOpen ? '收起详细反馈' : '填写详细反馈'}</button>
                {detailOpen && (
                  <div className="mt-3 rounded-2xl border border-cyan-100 bg-cyan-50/50 p-3">
                    <textarea
                      value={detailFeedback}
                      onChange={e => setDetailFeedback(e.target.value)}
                      rows={4}
                      placeholder="可以写：哪里判断准确、哪里不准、业务方为什么通过/拒绝..."
                      className="w-full resize-none rounded-xl border border-cyan-100 bg-white/80 px-3 py-2 text-sm"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="text-xs text-slate-400">
                        {detailFeedbackDirty ? '详细反馈有未保存修改' : savedDetailFeedback ? '详细反馈已保存' : ' '}
                      </p>
                      {detailFeedbackDirty && (
                        <button
                          onClick={() => sendFeedback({ group: 'detail', label: '详细反馈', value: 'detail', detail: detailFeedback })}
                          disabled={!detailFeedback.trim() || feedbackStatus === 'saving'}
                          className="btn-primary px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                        >
                          保存详细反馈
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {feedbackStatus === 'saving' && <p className="mt-2 text-xs text-slate-400">反馈保存中...</p>}
                {feedbackStatus === 'saved' && <p className="mt-2 text-xs text-emerald-600">反馈已保存</p>}
                {feedbackStatus === 'error' && <p className="mt-2 text-xs text-red-600">反馈保存失败</p>}
              </div>
            </div>
          </div>

          {requirementMatches.length > 0 && (
            <div className="glass-card p-6 mb-6">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-cyan-500" /> JD 匹配证据</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {requirementMatches.map((item, i) => <div key={i} className="rounded-2xl border border-white/70 bg-white/65 p-4"><div className="flex items-center justify-between gap-2"><p className="font-semibold text-slate-800">{item.requirement}</p><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${item.status === 'met' ? 'bg-emerald-100 text-emerald-700' : item.status === 'partial' ? 'bg-amber-100 text-amber-700' : item.status === 'missing' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{statusLabel(item.status)}</span></div>{item.evidence && <p className="mt-2 text-xs text-slate-500">证据：{item.evidence}</p>}{item.gap && <p className="mt-2 text-sm text-slate-700">缺口：{item.gap}</p>}</div>)}
              </div>
            </div>
          )}

          {evidence.length > 0 && (
            <div className="glass-card p-6 mb-6">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-red-500" /> 需人工复核：风险证据链</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {evidence.map((item, i) => <div key={i} className="border border-amber-200 bg-amber-50 rounded-lg p-4"><p className="text-sm font-semibold text-amber-800 mb-1">{item.risk_label || RISK_LABELS[item.risk_type] || '风险证据'}</p><p className="text-xs text-slate-500 mb-2">原文：{item.evidence || '未提供原文'}</p><p className="text-sm text-slate-700">{item.finding}</p></div>)}
              </div>
            </div>
          )}

          <div className="glass-card p-6 mb-6">
            <h3 className="font-bold text-slate-800 mb-4">维度评分</h3>
            {radarData.length > 0 && <ResponsiveContainer width="100%" height={280}><RadarChart data={radarData}><PolarAngleAxis dataKey="dimension" tick={{ fill: '#475569', fontSize: 12 }} /><PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} /><Radar name="评分" dataKey="score" stroke="#4f46e5" fill="#818cf8" fillOpacity={0.4} strokeWidth={2} /><Tooltip /></RadarChart></ResponsiveContainer>}
          </div>

          {dimensions.length > 0 && <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">{dimensions.map(d => <CompactDimensionCard key={d.dimension} dimension={d} />)}</div>}
        </>
      ) : (
        <div className="glass-card p-6 mb-6">
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

      {detailedReviews.length > 0 && <div className="glass-card p-6 mb-6"><h3 className="font-bold text-slate-800 mb-4">段落批注</h3><div className="space-y-3">{detailedReviews.map((r, i) => { const sev = SEVERITY_MAP[r.severity] || SEVERITY_MAP.moderate; const SevIcon = sev.icon; return <div key={i} className={`rounded-lg border p-4 ${sev.color}`}><div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><SevIcon className="w-4 h-4" /><span className="font-medium">{r.section || r.paragraph_title || `段落 ${i + 1}`}</span></div><span className="text-xs font-medium px-2 py-0.5 rounded-full border">{sev.label}</span></div>{r.original_text && <p className="text-xs text-slate-500 mb-1 bg-white/50 rounded px-2 py-1">原文: {r.original_text}</p>}<p className="text-sm">{r.feedback || r.comment || r.annotation}</p></div>})}</div></div>}
    </div>
  )
}

function RulerColumn({ title, items = [], tone }) {
  const toneMap = {
    cyan: 'text-cyan-700 bg-cyan-50',
    indigo: 'text-indigo-700 bg-indigo-50',
    emerald: 'text-emerald-700 bg-emerald-50',
    amber: 'text-amber-700 bg-amber-50',
    slate: 'text-slate-700 bg-slate-50',
  }
  return (
    <div className="rounded-2xl border border-white/70 bg-white/55 p-4">
      <h4 className={`mb-3 inline-flex rounded-full px-2 py-1 text-xs font-bold ${toneMap[tone] || toneMap.slate}`}>{title}</h4>
      <div className="space-y-2">
        {ensureArray(items).slice(0, 5).map((item, i) => <p key={i} className="text-sm text-slate-700">• {item}</p>)}
        {!ensureArray(items).length && <p className="text-sm text-slate-400">暂无</p>}
      </div>
    </div>
  )
}

function FeedbackButton({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-3 py-2 text-xs font-black transition-all ${
        active
          ? 'scale-[1.02] border border-cyan-300 bg-cyan-600 text-white shadow-lg shadow-cyan-500/20'
          : 'border border-slate-200 bg-white/70 text-slate-600 hover:-translate-y-0.5 hover:border-cyan-200 hover:text-cyan-700'
      }`}
    >
      {active ? `已选：${label}` : label}
    </button>
  )
}

function CompactDimensionCard({ dimension }) {
  const [expandedIndex, setExpandedIndex] = useState(null)
  const points = buildDimensionPoints(dimension)
  const fallback = [{
    summary: `${dimension.dimension}得分 ${dimension.score ?? '-'}，建议结合JD继续复核。`,
    detail: '这条总结暂未关联到具体简历原文。新评估会优先自动补齐原文证据。',
  }]
  const displayPoints = points.length ? points : fallback

  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="font-bold text-slate-900">{dimension.dimension}</span>
        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-sm font-black text-indigo-700">{dimension.score ?? '-'}</span>
      </div>
      <div className="mb-3 h-2 w-full rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-indigo-500" style={{ width: `${Math.max(0, Math.min(100, dimension.score || 0))}%` }} />
      </div>
      <div className="space-y-1.5">
        {displayPoints.map((item, index) => (
          <div key={index} className="rounded-xl transition-colors hover:bg-white/55">
            <button
              onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
              className="grid w-full grid-cols-[1.8rem_1fr_1.5rem] items-start py-1 text-left text-sm leading-6 text-slate-700"
            >
              <span className="font-black text-slate-400">{index + 1}、</span>
              <span>{item.summary}</span>
              <ChevronDown className={`mt-1 h-4 w-4 text-slate-400 transition-transform ${expandedIndex === index ? 'rotate-180 text-cyan-600' : ''}`} />
            </button>
            {expandedIndex === index && (
              <div className="ml-7 mr-2 mb-2 rounded-xl border border-cyan-100 bg-cyan-50/60 px-3 py-2">
                <p className="whitespace-pre-wrap text-xs leading-6 text-slate-600">{item.detail || '这条总结暂未关联到具体简历原文。'}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
