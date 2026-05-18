import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../config/api'
import {
  Upload, FileText, Loader2, CheckCircle, XCircle, Clock,
  Play, BrainCircuit, ShieldAlert, AlertTriangle
} from 'lucide-react'
import {
  RadarChart, PolarAngleAxis, PolarRadiusAxis, Radar,
  ResponsiveContainer, Tooltip
} from 'recharts'

const STATUS_MAP = {
  pending: { label: '待评估', icon: Clock, color: 'text-slate-500 bg-slate-100' },
  evaluating: { label: '评估中', icon: Loader2, color: 'text-indigo-600 bg-indigo-50' },
  completed: { label: '已完成', icon: CheckCircle, color: 'text-emerald-600 bg-emerald-50' },
  failed: { label: '失败', icon: XCircle, color: 'text-red-600 bg-red-50' },
}

function GradeBadge({ grade }) {
  if (!grade) return null
  return <span className={`grade-badge grade-${grade}`}>{grade}</span>
}

function DimensionCard({ dim }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-slate-800">{dim.dimension}</span>
        <span className="text-sm font-bold text-indigo-600">{dim.score}</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
        <div className="bg-indigo-500 rounded-full h-2" style={{ width: `${dim.score}%` }} />
      </div>
      <p className="text-sm text-slate-600">{dim.feedback}</p>
    </div>
  )
}

export default function ResumeReviewPage() {
  const [profiles, setProfiles] = useState([])
  const [records, setRecords] = useState([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [file, setFile] = useState(null)
  const [resumeId, setResumeId] = useState(null)
  const [status, setStatus] = useState(null)
  const [evaluation, setEvaluation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [polling, setPolling] = useState(false)
  const fileRef = useRef(null)
  const navigate = useNavigate()

  const loadRecords = async () => {
    try {
      const res = await api.get('/resumes')
      setRecords(res.data?.resumes || [])
    } catch (_) {}
  }

  useEffect(() => {
    api.get('/profiles').then(res => {
      const list = res.data || []
      setProfiles(list)
      const defaultProfile = list.find(p => p.isDefault)
      if (defaultProfile) setSelectedProfile(defaultProfile.id)
    }).catch(() => {})
    loadRecords()
  }, [])

  useEffect(() => {
    if (!resumeId || !polling) return
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/resumes/${resumeId}/status`)
        const s = res.data.status
        setStatus(s)
        if (s === 'completed') {
          setPolling(false)
          const evalRes = await api.get(`/resumes/${resumeId}/evaluation`)
          setEvaluation(evalRes.data?.overall_evaluation ? evalRes.data : null)
          await loadRecords()
        } else if (s === 'failed') {
          setPolling(false)
          setError(res.data.error || '评估失败')
          await loadRecords()
        }
      } catch (err) {
        setPolling(false)
        setError('状态查询失败')
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [resumeId, polling])

  const handleUpload = async () => {
    if (!file || !selectedProfile) {
      setError('请选择文件和审查模板')
      return
    }
    setLoading(true)
    setError('')
    setStatus(null)
    setEvaluation(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('profileId', selectedProfile)
      const res = await api.post('/upload', formData)
      setResumeId(res.data.id)
      setStatus('pending')
      await loadRecords()
    } catch (err) {
      setError(err.response?.data?.error || '上传失败')
    } finally {
      setLoading(false)
    }
  }

  const handleEvaluate = async () => {
    if (!resumeId) return
    setLoading(true)
    setError('')
    try {
      await api.post(`/evaluate/${resumeId}`)
      setStatus('evaluating')
      setPolling(true)
    } catch (err) {
      setError(err.response?.data?.error || '触发评估失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAction = async (action) => {
    if (!resumeId) return
    setLoading(true)
    setError('')
    try {
      await api.post(`/resumes/${resumeId}/${action}`)
    } catch (err) {
      setError(err.response?.data?.error || `触发${action}失败`)
    } finally {
      setLoading(false)
    }
  }

  const evaluationSummary = evaluation?.overall_evaluation
  const dimensionScores = evaluation?.dimension_evaluations || []
  const radarData = dimensionScores.length
    ? dimensionScores.map(d => ({
      dimension: d.dimension,
      score: d.score,
      fullMark: 100,
    }))
    : []

  const statusInfo = STATUS_MAP[status] || STATUS_MAP.pending

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-slate-800 mb-4">单份简历审查</h2>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">审查模板</label>
            <select
              value={selectedProfile}
              onChange={e => setSelectedProfile(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
            >
              <option value="">选择模板...</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.name} {p.isDefault ? '(默认)' : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">简历文件</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 hover:border-indigo-400 cursor-pointer flex items-center gap-2 text-slate-600"
            >
              <Upload className="w-4 h-4" />
              <span>{file ? file.name : '选择 docx/pdf 文件...'}</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".docx,.pdf"
              onChange={e => setFile(e.target.files[0])}
              className="hidden"
            />
          </div>
        </div>

        <div className="flex gap-2">
          {!resumeId && (
            <button
              onClick={handleUpload}
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              上传简历
            </button>
          )}
          {resumeId && status === 'pending' && (
            <button
              onClick={handleEvaluate}
              disabled={loading}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
            >
              <Play className="w-4 h-4" /> 开始评估
            </button>
          )}
        </div>
      </div>

      {resumeId && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="w-5 h-5 text-indigo-500" />
            <span className="font-medium text-slate-800">评估状态</span>
            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${statusInfo.color}`}>
              <statusInfo.icon className={`w-4 h-4 ${status === 'evaluating' ? 'animate-spin' : ''}`} />
              {statusInfo.label}
            </span>
          </div>
          {polling && (
            <>
              <p className="text-sm text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-500" /> 正在评估中，系统每3秒自动刷新进度...
              </p>
              <div className="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full w-2/3 bg-indigo-500 animate-pulse" />
              </div>
            </>
          )}
        </div>
      )}

      {evaluation && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800">综合评分</h3>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-indigo-600">{evaluationSummary?.overall_score}</span>
                <GradeBadge grade={evaluationSummary?.overall_grade} />
              </div>
            </div>

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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {dimensionScores.map(d => <DimensionCard key={d.dimension} dim={d} />)}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-bold text-slate-800 mb-4">深度分析</h3>
            <div className="flex gap-3">
              <button
                onClick={() => navigate(`/report/${resumeId}`)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium flex items-center gap-2"
              >
                <BrainCircuit className="w-4 h-4" /> 详细审查报告
              </button>
              <button
                onClick={() => navigate(`/aigc/${resumeId}`)}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-medium flex items-center gap-2"
              >
                <ShieldAlert className="w-4 h-4" /> AIGC检测
              </button>
              <button
                onClick={() => navigate(`/risk/${resumeId}`)}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4" /> 风险标记
              </button>
            </div>
          </div>
        </>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 mt-6">
        <h3 className="font-bold text-slate-800 mb-4">历史记录</h3>
        <div className="space-y-2">
          {records.length === 0 && <p className="text-sm text-slate-500">暂无记录</p>}
          {records.map((r) => (
            <div key={r.id} className="flex items-center justify-between border border-slate-200 rounded-lg p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{r.candidateName || `简历 #${r.id}`}</p>
                <p className="text-xs text-slate-500">状态：{STATUS_MAP[r.status]?.label || r.status}</p>
              </div>
              <div className="flex gap-2">
                {r.status === 'completed' && (
                  <button
                    onClick={() => navigate(`/report/${r.id}`)}
                    className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-md"
                  >
                    查看报告
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
