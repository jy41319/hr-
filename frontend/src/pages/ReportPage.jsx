import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import api from '../config/api'
import {
  Loader2, FileText, Download, AlertTriangle, Info, CheckCircle,
  XCircle, ChevronDown
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

function normalizeDimensions(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).map(([key, item]) => ({
    dimension: item?.dimension || DIMENSION_LABELS[key] || key,
    ...item,
  }))
}

export default function ReportPage() {
  const { id } = useParams()
  const [resume, setResume] = useState(null)
  const [evaluation, setEvaluation] = useState(null)
  const [detailedReviews, setDetailedReviews] = useState([])
  const [loading, setLoading] = useState(true)
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
      link.download = matched?.[1] || `resume_report_${id}.txt`
      link.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.response?.data?.error || '下载报告失败')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin mr-3" /> 加载报告...
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg">{error}</div>
    )
  }

  const overall = evaluation?.overall_evaluation || {}
  const dimensions = normalizeDimensions(evaluation?.dimension_evaluations)
  const radarData = dimensions.map(d => ({
    dimension: d.dimension,
    score: d.score,
    fullMark: 100,
  }))

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-800">审查报告</h2>
        <button
          onClick={handleDownload}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium flex items-center gap-2"
        >
          <Download className="w-4 h-4" /> 下载批注文档
        </button>
      </div>

      {resume && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-5 h-5 text-indigo-500" />
            <span className="font-bold text-slate-800">{resume.candidateName || `简历 #${resume.id}`}</span>
          </div>
          <p className="text-sm text-slate-500">{resume.profileName || '默认模板'}</p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">综合评分</h3>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold text-indigo-600">{overall?.overall_score ?? '-'}</span>
            <GradeBadge grade={overall?.overall_grade} />
          </div>
        </div>

        {overall?.overall_feedback && (
          <p className="text-sm text-slate-600 mb-4 p-3 bg-slate-50 rounded-lg">{overall.overall_feedback}</p>
        )}

        {radarData.length > 0 && (
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarAngleAxis dataKey="dimension" tick={{ fill: '#475569', fontSize: 12 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <Radar name="评分" dataKey="score" stroke="#4f46e5" fill="#818cf8" fillOpacity={0.4} strokeWidth={2} />
              <Tooltip />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </div>

      {dimensions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {dimensions.map(d => (
            <div key={d.dimension} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-slate-800">{d.dimension}</span>
                <span className="text-sm font-bold text-indigo-600">{d.score}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
                <div className="bg-indigo-500 rounded-full h-2" style={{ width: `${d.score}%` }} />
              </div>
              <p className="text-sm text-slate-600">{d.feedback}</p>
            </div>
          ))}
        </div>
      )}

      {detailedReviews.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h3 className="font-bold text-slate-800 mb-4">段落批注</h3>
          <div className="space-y-3">
            {detailedReviews.map((r, i) => {
              const sev = SEVERITY_MAP[r.severity] || SEVERITY_MAP.moderate
              const SevIcon = sev.icon
              return (
                <div key={i} className={`rounded-lg border p-4 ${sev.color}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <SevIcon className="w-4 h-4" />
                      <span className="font-medium">{r.section || r.paragraph_title || `段落 ${i + 1}`}</span>
                    </div>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full border">{sev.label}</span>
                  </div>
                  {r.original_text && (
                    <p className="text-xs text-slate-500 mb-1 bg-white/50 rounded px-2 py-1">原文: {r.original_text}</p>
                  )}
                  <p className="text-sm">{r.feedback || r.comment || r.annotation}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
