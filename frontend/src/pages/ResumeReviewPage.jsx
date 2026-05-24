import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../config/api'
import {
  Upload, Loader2, CheckCircle, XCircle, Clock
} from 'lucide-react'

const STATUS_MAP = {
  pending: { label: '待评估', icon: Clock, color: 'text-slate-500 bg-slate-100' },
  evaluating: { label: '评估中', icon: Loader2, color: 'text-indigo-600 bg-indigo-50' },
  completed: { label: '已完成', icon: CheckCircle, color: 'text-emerald-600 bg-emerald-50' },
  failed: { label: '失败', icon: XCircle, color: 'text-red-600 bg-red-50' },
}

const STAGE_STEPS = [
  { key: 'queued', label: '排队' },
  { key: 'parsing_jd', label: '分析JD需求' },
  { key: 'reading_resume', label: '解析候选人简历' },
  { key: 'matching', label: 'JD匹配评分' },
  { key: 'structuring_result', label: '整理推荐结果' },
  { key: 'completed', label: '完成' },
]

const STAGE_LABELS = {
  queued: '排队中',
  starting: '准备评估',
  reading_resume: '解析候选人简历',
  preparing_criteria: '准备通用筛选标准',
  parsing_jd: '分析JD需求',
  matching: 'JD匹配评分',
  scoring_dimensions: '综合评分',
  structuring_result: '整理推荐结果',
  completed: '评估完成',
  failed: '评估失败',
  timeout: '评估超时',
}

function getRecordProgress(record) {
  if (record.status === 'completed') return 100
  if (record.status === 'failed') return 100
  return Math.max(record.evaluationProgress || 0, record.status === 'evaluating' ? 8 : 0)
}

function EvaluationProgressPanel({ record }) {
  const stageKey = record.evaluationStage || (record.status === 'evaluating' ? 'queued' : record.status)
  const normalizedStage = stageKey === 'preparing_criteria'
    ? 'parsing_jd'
    : stageKey === 'scoring_dimensions'
      ? 'matching'
      : stageKey
  const activeStageIndex = Math.max(0, STAGE_STEPS.findIndex(item => item.key === normalizedStage))
  const progress = getRecordProgress(record)
  const statusInfo = STATUS_MAP[record.status] || STATUS_MAP.pending
  const message = record.evaluationStatusMessage || (
    record.status === 'evaluating'
      ? '系统正在处理这份简历，会自动刷新最新进度。'
      : record.status === 'completed'
        ? '评估完成，可以查看完整报告。'
        : record.status === 'failed'
          ? '评估失败，可点击重新评估。'
          : '等待评估任务开始。'
  )

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-cyan-100 bg-gradient-to-br from-cyan-50/80 to-white p-4 shadow-inner animate-progress-reveal">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <statusInfo.icon className={`h-4 w-4 text-cyan-600 ${record.status === 'evaluating' ? 'animate-spin' : ''}`} />
          <span className="font-bold text-slate-900">{STAGE_LABELS[stageKey] || statusInfo.label}</span>
          <span>{message}</span>
        </div>
        <span className="text-sm font-black text-cyan-700">{progress}%</span>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/90 ring-1 ring-cyan-100">
        <div className="progress-stripe h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 transition-all duration-700" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 md:grid-cols-6">
        {STAGE_STEPS.map((item, index) => {
          const isDone = progress >= 100 || (activeStageIndex >= 0 && index < activeStageIndex)
          const isActive = item.key === normalizedStage || (stageKey === 'starting' && item.key === 'queued')
          return (
            <div key={item.key} className={`rounded-xl px-2 py-2 text-center text-xs font-semibold transition ${isActive ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20' : isDone ? 'bg-emerald-50 text-emerald-700' : 'bg-white/75 text-slate-400'}`}>
              {item.label}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ResumeReviewPage() {
  const [profiles, setProfiles] = useState([])
  const [records, setRecords] = useState([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [jobName, setJobName] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [savedJds, setSavedJds] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedProgressIds, setExpandedProgressIds] = useState([])
  const fileRef = useRef(null)
  const navigate = useNavigate()

  const loadRecords = async () => {
    try {
      const res = await api.get('/resumes?perPage=100')
      setRecords(res.data?.resumes || [])
    } catch (_) {}
  }

  useEffect(() => {
    try {
      setSavedJds(JSON.parse(localStorage.getItem('hr_saved_jds') || '[]'))
    } catch (_) {
      setSavedJds([])
    }
    api.get('/profiles').then(res => {
      const list = res.data || []
      setProfiles(list)
      const defaultProfile = list.find(p => p.isDefault)
      if (defaultProfile) setSelectedProfile(defaultProfile.id)
    }).catch(() => {})
    loadRecords()
  }, [])

  useEffect(() => {
    if (!records.some(record => record.status === 'evaluating')) return
    const interval = setInterval(loadRecords, 3000)
    return () => clearInterval(interval)
  }, [records])

  const saveCurrentJd = () => {
    const jd = jobDescription.trim()
    if (!jd) {
      setError('请先填写JD再保存')
      return
    }
    const name = window.prompt('给这个JD起个名字', jd.slice(0, 18))
    if (!name) return
    const next = [{ id: Date.now(), name, content: jd }, ...savedJds.filter(item => item.content !== jd)].slice(0, 12)
    setSavedJds(next)
    localStorage.setItem('hr_saved_jds', JSON.stringify(next))
  }

  const handleUpload = async () => {
    if (files.length === 0) {
      setError('请先选择简历文件')
      return
    }
    setLoading(true)
    setError('')
    try {
      const formData = new FormData()
      if (selectedProfile) formData.append('profileId', selectedProfile)
      const finalJobName = jobName.trim() || jobDescription.trim().slice(0, 18)
      if (finalJobName) formData.append('jobName', finalJobName)
      formData.append('jobDescription', jobDescription)
      formData.append('autoEvaluate', 'true')
      if (files.length === 1) {
        formData.append('file', files[0])
        const res = await api.post('/upload', formData)
        setExpandedProgressIds([res.data.id])
      } else {
        files.forEach(item => formData.append('files', item))
        const res = await api.post('/batch-upload', formData)
        const created = res.data?.resumes || []
        const createdIds = created.map(item => item.id).filter(Boolean)
        if (createdIds.length > 0) {
          setExpandedProgressIds(createdIds)
        }
        if (res.data?.failed?.length) {
          setError(`${res.data.failed.length} 份文件上传失败，其余文件已进入评估队列。`)
        }
      }
      setFiles([])
      setJobName('')
      if (fileRef.current) fileRef.current.value = ''
      await loadRecords()
    } catch (err) {
      setError(err.response?.data?.error || '上传失败')
    } finally {
      setLoading(false)
    }
  }

  const showRecordProgress = (record) => {
    setExpandedProgressIds(current =>
      current.includes(record.id) ? current.filter(id => id !== record.id) : [...current, record.id]
    )
    setError('')
  }

  const retryRecordEvaluation = async (record) => {
    setLoading(true)
    setError('')
    const optimisticRecord = {
      ...record,
      status: 'evaluating',
      evaluationStage: 'queued',
      evaluationProgress: 5,
      evaluationStatusMessage: '任务已重新提交，正在等待评估资源',
    }
    setRecords(current => current.map(item => item.id === record.id ? optimisticRecord : item))
    setExpandedProgressIds(current => current.includes(record.id) ? current : [...current, record.id])
    try {
      const res = await api.post(`/evaluate/${record.id}`, {})
      if (res.data?.resume) {
        setRecords(current => current.map(item => item.id === record.id ? res.data.resume : item))
      }
      await loadRecords()
    } catch (err) {
      setRecords(current => current.map(item => item.id === record.id ? record : item))
      setError(err.response?.data?.error || '重新评估失败')
    } finally {
      setLoading(false)
    }
  }
  const historicalJds = [
    ...savedJds.map(item => ({ label: `常用JD · ${item.name}`, content: item.content })),
    ...Array.from(new Map(
      records
        .map(record => (record.jobDescription || '').trim())
        .filter(Boolean)
        .map(jd => [jd, { label: `历史JD · ${jd.slice(0, 18)}${jd.length > 18 ? '...' : ''}`, content: jd }])
    ).values())
  ].slice(0, 12)

  const selectedFileLabel = files.length === 0
    ? '选择 1 份或多份 docx/pdf 简历...'
    : files.length === 1
      ? files[0].name
      : `已选择 ${files.length} 份简历`

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4">
        <p className="text-sm font-semibold tracking-wide text-cyan-700">JD 驱动评估</p>
        <h2 className="mt-1 text-xl font-bold text-slate-800">简历初筛</h2>
        <p className="mt-1 text-sm text-slate-500">先粘贴本次岗位 JD，再选择上传 1 份或多份简历；系统会围绕岗位要求输出匹配分、风险点和面试追问。</p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="mb-4 rounded-xl border border-cyan-100 bg-cyan-50/70 p-4">
          <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <label className="block text-sm font-bold text-slate-800">本次岗位 JD / 招聘需求</label>
            <div className="flex flex-wrap gap-2">
              {historicalJds.length > 0 && (
                <select
                  value=""
                  onChange={e => {
                    if (e.target.value) setJobDescription(e.target.value)
                  }}
                  className="rounded-lg border border-cyan-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 outline-none focus:border-cyan-500"
                >
                  <option value="">复用历史/常用 JD...</option>
                  {historicalJds.map(item => <option key={item.label + item.content} value={item.content}>{item.label}</option>)}
                </select>
              )}
              <button type="button" onClick={saveCurrentJd} className="rounded-lg border border-cyan-200 bg-white px-3 py-1.5 text-xs font-bold text-cyan-700 hover:bg-cyan-50">保存为常用JD</button>
            </div>
          </div>
          <input
            value={jobName}
            onChange={e => setJobName(e.target.value)}
            placeholder="JD任务名称，如：AI产品实习生-2027届。不填时自动用 JD 首行生成。"
            className="mb-3 w-full rounded-lg border border-cyan-200 bg-white px-3 py-2 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
          />
          <textarea
            value={jobDescription}
            onChange={e => setJobDescription(e.target.value)}
            rows={5}
            placeholder="粘贴本次岗位职责、硬性要求、加分项、薪资范围、团队背景等。填写后会优先按 JD 匹配度生成候选人建议。"
            className="w-full px-3 py-2 rounded-lg border border-cyan-200 bg-white focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 outline-none resize-none"
          />
          <p className="mt-2 text-xs text-slate-500">推荐填写 JD。未填写时，系统会使用通用初筛标准兜底。</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">简历文件</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 hover:border-indigo-400 cursor-pointer flex items-center gap-2 text-slate-600"
            >
              <Upload className="w-4 h-4" />
              <span>{selectedFileLabel}</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".docx,.pdf"
              multiple
              onChange={e => setFiles(Array.from(e.target.files || []))}
              className="hidden"
            />
            <p className="mt-1 text-xs text-slate-500">可选择 1 份或多份简历，系统会自动创建对应的初筛任务。</p>
          </div>
        </div>

        <div className="mb-4 border-t border-slate-100 pt-4">
          <button type="button" onClick={() => setAdvancedOpen(v => !v)} className="text-sm font-semibold text-slate-600 hover:text-slate-900">
            {advancedOpen ? '收起' : '展开'}高级设置：无 JD 时使用的评估标准
          </button>
          {advancedOpen && (
            <div className="mt-3 max-w-xl">
              <label className="block text-sm font-medium text-slate-700 mb-1">筛选标准兜底</label>
              <select
                value={selectedProfile}
                onChange={e => setSelectedProfile(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
              >
                <option value="">自动使用默认通用标准</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name} {p.isDefault ? '(默认)' : ''}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">有 JD 时，JD 是最高优先级；模板只补充通用评估维度。</p>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleUpload}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {files.length > 1 ? `按JD上传 ${files.length} 份并评估` : '按JD上传并评估'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 mt-6">
        <h3 className="font-bold text-slate-800 mb-4">历史记录</h3>
        <div className="space-y-2">
          {records.length === 0 && <p className="text-sm text-slate-500">暂无记录</p>}
          {records.map((r) => {
            const isExpanded = expandedProgressIds.includes(r.id)
            return (
              <div key={r.id} className={`rounded-2xl border p-3 transition-all duration-300 ${isExpanded ? 'border-cyan-200 bg-cyan-50/30 shadow-sm' : 'border-slate-200 bg-white'}`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{r.candidateName || `简历 #${r.id}`}</p>
                    <p className="text-xs text-slate-500">
                      状态：{STATUS_MAP[r.status]?.label || r.status}
                      {r.status === 'evaluating' && (
                        <span className="ml-2 text-cyan-700">{r.evaluationProgress || 5}% · {STAGE_LABELS[r.evaluationStage] || '评估中'}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {['evaluating', 'pending', 'failed'].includes(r.status) && (
                      <button
                        onClick={() => showRecordProgress(r)}
                        className={`px-3 py-1.5 text-sm rounded-md font-medium transition ${isExpanded ? 'bg-slate-800 text-white hover:bg-slate-950' : 'bg-cyan-600 text-white hover:bg-cyan-700'}`}
                      >
                        {isExpanded ? '收起进度' : '查看进度'}
                      </button>
                    )}
                    {r.status === 'failed' && (
                      <button
                        onClick={() => retryRecordEvaluation(r)}
                        disabled={loading}
                        className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-md disabled:opacity-50"
                      >
                        重新评估
                      </button>
                    )}
                    {r.status === 'completed' && (
                      <>
                        <button
                          onClick={() => showRecordProgress(r)}
                          className={`px-3 py-1.5 text-sm rounded-md font-medium transition ${isExpanded ? 'bg-slate-800 text-white hover:bg-slate-950' : 'bg-cyan-50 text-cyan-700 hover:bg-cyan-100'}`}
                        >
                          {isExpanded ? '收起状态' : '查看状态'}
                        </button>
                        <button
                          onClick={() => navigate(`/report/${r.id}`)}
                          className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-md"
                        >
                          查看报告
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {isExpanded && <EvaluationProgressPanel record={r} />}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
