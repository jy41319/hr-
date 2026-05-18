import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import api from '../config/api'
import { Loader2, ShieldAlert, FileText, AlertTriangle, CheckCircle } from 'lucide-react'

function RiskLevelBadge({ level }) {
  const map = {
    high: { label: '高风险', color: 'bg-red-100 text-red-800 border border-red-300' },
    medium: { label: '中风险', color: 'bg-yellow-100 text-yellow-800 border border-yellow-300' },
    low: { label: '低风险', color: 'bg-emerald-100 text-emerald-800 border border-emerald-300' },
    none: { label: '无风险', color: 'bg-slate-100 text-slate-600 border border-slate-300' },
  }
  const info = map[level] || map.none
  return <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${info.color}`}>{info.label}</span>
}

function ProbabilityBar({ probability, label }) {
  const pct = Math.round(probability * 100)
  let barColor = 'bg-emerald-500'
  let textColor = 'text-emerald-700'
  if (pct >= 70) { barColor = 'bg-red-500'; textColor = 'text-red-700' }
  else if (pct >= 40) { barColor = 'bg-yellow-500'; textColor = 'text-yellow-700' }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className={`text-sm font-bold ${textColor}`}>{pct}%</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2">
        <div className={`${barColor} rounded-full h-2 transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function AigcDetectionPage() {
  const { id } = useParams()
  const [resume, setResume] = useState(null)
  const [detections, setDetections] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadData()
  }, [id])

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [resumeRes, aigcRes] = await Promise.all([
        api.get(`/resumes/${id}`),
        api.get(`/resumes/${id}/aigc`),
      ])
      setResume(resumeRes.data)
      setDetections(aigcRes.data)
    } catch (err) {
      setError(err.response?.data?.error || '加载AIGC检测结果失败')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin mr-3" /> 加载AIGC检测报告...
      </div>
    )
  }

  if (error) {
    return <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg">{error}</div>
  }

  const overallScore = detections?.overall_aigc_score ?? detections?.aigc_score ?? 0
  const riskLevel = detections?.risk_level ?? (
    overallScore >= 0.7 ? 'high' : overallScore >= 0.4 ? 'medium' : overallScore > 0 ? 'low' : 'none'
  )
  const detectionList = detections?.detections ?? detections?.items ?? []
  const suspiciousFeatures = detections?.suspicious_features ?? detections?.features ?? []

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-slate-800 mb-6">AIGC检测报告</h2>

      {resume && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-500" />
            <span className="font-medium text-slate-800">{resume.filename || resume.file_name}</span>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-8 h-8 text-cyan-600" />
            <h3 className="font-bold text-slate-800">AIGC综合评分</h3>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-3xl font-bold text-cyan-600">{Math.round(overallScore * 100)}%</span>
            <RiskLevelBadge level={riskLevel} />
          </div>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-4">
          <div
            className={`rounded-full h-4 transition-all ${
              overallScore >= 0.7 ? 'bg-red-500' : overallScore >= 0.4 ? 'bg-yellow-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.round(overallScore * 100)}%` }}
          />
        </div>
        <p className="text-sm text-slate-500 mt-2">
          {overallScore >= 0.7 ? '该简历有较高概率包含AI生成内容，建议重点关注。' :
           overallScore >= 0.4 ? '该简历可能包含部分AI生成内容，建议结合其他维度综合判断。' :
           '该简历AIGC风险较低，内容可信度较高。'}
        </p>
      </div>

      {detectionList.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h3 className="font-bold text-slate-800 mb-4">段落检测结果</h3>
          <div className="space-y-2">
            {detectionList.map((d, i) => (
              <ProbabilityBar
                key={i}
                probability={d.probability ?? d.aigc_probability ?? d.score ?? 0}
                label={d.section || d.paragraph_title || d.text_preview?.slice(0, 60) || `段落 ${i + 1}`}
              />
            ))}
          </div>
        </div>
      )}

      {suspiciousFeatures.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <h3 className="font-bold text-slate-800 mb-4">可疑特征</h3>
          <div className="space-y-2">
            {suspiciousFeatures.map((f, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50">
                <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5" />
                <div>
                  <span className="font-medium text-slate-800">{f.feature || f.name}</span>
                  {f.description && <p className="text-sm text-slate-600 mt-1">{f.description}</p>}
                  {f.evidence && <p className="text-xs text-slate-500 mt-1">证据: {f.evidence}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}