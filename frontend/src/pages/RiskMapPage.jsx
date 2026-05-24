import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import api from '../config/api'
import {
  Loader2, AlertTriangle, Clock, FileText, EyeOff, AlignLeft,
  BrainCircuit, ShieldAlert, CheckCircle, XCircle, Info
} from 'lucide-react'

const CATEGORIES = [
  { key: 'timeline', label: '时间线风险', icon: Clock, description: '工作时间线断裂、时间冲突等' },
  { key: 'exaggeration', label: '夸大表述', icon: AlertTriangle, description: '过度夸大能力、业绩等' },
  { key: 'missing_info', label: '关键信息缺失', icon: EyeOff, description: '缺少必要信息如学历、联系方式等' },
  { key: 'format', label: '格式问题', icon: AlignLeft, description: '排版混乱、错别字、不一致格式等' },
  { key: 'aigc', label: 'AIGC嫌疑', icon: BrainCircuit, description: 'AI生成内容特征检测' },
]

const SEVERITY_BADGE = {
  critical: { label: '严重', cls: 'risk-critical border px-2 py-0.5 rounded-full text-xs font-medium' },
  major: { label: '重要', cls: 'risk-major border px-2 py-0.5 rounded-full text-xs font-medium' },
  moderate: { label: '中等', cls: 'risk-moderate border px-2 py-0.5 rounded-full text-xs font-medium' },
  minor: { label: '轻微', cls: 'risk-minor border px-2 py-0.5 rounded-full text-xs font-medium' },
}

function CategoryCard({ category, flags }) {
  const items = flags.filter(f => f.category === category.key)
  const count = items.length
  const severities = items.map(f => f.severity || 'moderate')
  const maxSeverity = severities.includes('critical') ? 'critical' :
    severities.includes('major') ? 'major' :
    severities.includes('moderate') ? 'moderate' : 'minor'

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          count > 0 ? 'bg-orange-50' : 'bg-emerald-50'
        }`}>
          <category.icon className={`w-5 h-5 ${count > 0 ? 'text-orange-500' : 'text-emerald-500'}`} />
        </div>
        <div>
          <h4 className="font-bold text-slate-800">{category.label}</h4>
          <p className="text-xs text-slate-500">{category.description}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-lg font-bold text-slate-800">{count}</span>
          {count > 0 && (
            <span className={SEVERITY_BADGE[maxSeverity]?.cls || ''}>
              {SEVERITY_BADGE[maxSeverity]?.label || '中等'}
            </span>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div className="space-y-2 mt-3">
          {items.map((f, i) => {
            const sevBadge = SEVERITY_BADGE[f.severity || 'moderate']
            return (
              <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-slate-50">
                <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-slate-800">{f.title || f.flag}</span>
                    <span className={sevBadge?.cls || ''}>{sevBadge?.label || '中等'}</span>
                  </div>
                  {f.description && <p className="text-xs text-slate-600 mt-0.5">{f.description}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {count === 0 && (
        <div className="flex items-center gap-2 mt-3 text-emerald-600 text-sm">
          <CheckCircle className="w-4 h-4" /> 无风险标记
        </div>
      )}
    </div>
  )
}

export default function RiskMapPage() {
  const { id } = useParams()
  const [resume, setResume] = useState(null)
  const [riskFlags, setRiskFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadData()
  }, [id])

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [resumeRes, riskRes] = await Promise.all([
        api.get(`/resumes/${id}`),
        api.get(`/resumes/${id}/risk-flags`),
      ])
      setResume(resumeRes.data)
      setRiskFlags(riskRes.data.items || riskRes.data || [])
    } catch (err) {
      setError(err.response?.data?.error || '加载风险数据失败')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin mr-3" /> 加载风险地图...
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg">{error}</div>
      </div>
    )
  }

  const totalFlags = riskFlags.length
  const criticalCount = riskFlags.filter(f => f.severity === 'critical').length
  const majorCount = riskFlags.filter(f => f.severity === 'major').length
  const overallRisk = criticalCount > 0 ? '高风险' : majorCount > 0 ? '中风险' : totalFlags > 0 ? '低风险' : '无风险'
  const overallColor = criticalCount > 0 ? 'text-red-700 bg-red-50' :
    majorCount > 0 ? 'text-orange-700 bg-orange-50' :
    totalFlags > 0 ? 'text-yellow-700 bg-yellow-50' : 'text-emerald-700 bg-emerald-50'

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex flex-col gap-3">
        <h2 className="text-xl font-bold text-slate-800">风险地图</h2>
      </div>

      {resume && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-500" />
            <span className="font-medium text-slate-800">{resume.filename || resume.file_name}</span>
          </div>
        </div>
      )}

      <div className={`rounded-xl border border-slate-200 p-6 mb-6 ${overallColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-8 h-8" />
            <div>
              <h3 className="font-bold">风险总览</h3>
              <p className="text-sm">
                共 {totalFlags} 个风险标记，其中 {criticalCount} 个严重、{majorCount} 个重要
              </p>
            </div>
          </div>
          <span className="text-2xl font-bold">{overallRisk}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CATEGORIES.map(cat => (
          <CategoryCard key={cat.key} category={cat} flags={riskFlags} />
        ))}
      </div>
    </div>
  )
}
