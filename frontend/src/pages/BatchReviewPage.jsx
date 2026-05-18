import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../config/api'
import {
  Upload, Files, Loader2, CheckCircle, XCircle, Clock, Trash2, Download,
  Eye, AlertTriangle, Sparkles, ClipboardList, MessageSquare, Archive
} from 'lucide-react'

const STATUS_MAP = {
  pending: { label: '待评估', color: 'bg-slate-100 text-slate-600', icon: Clock },
  evaluating: { label: '评估中', color: 'bg-indigo-50 text-indigo-600', icon: Loader2 },
  completed: { label: '已完成', color: 'bg-emerald-50 text-emerald-600', icon: CheckCircle },
  failed: { label: '失败', color: 'bg-red-50 text-red-600', icon: XCircle },
}

const WORKFLOW_MAP = {
  new: { label: '未处理', color: 'bg-slate-100 text-slate-700' },
  shortlisted: { label: '待面试', color: 'bg-emerald-100 text-emerald-700' },
  needs_review: { label: '待复核', color: 'bg-amber-100 text-amber-700' },
  rejected: { label: '已淘汰', color: 'bg-red-100 text-red-700' },
  archived: { label: '已入库', color: 'bg-blue-100 text-blue-700' },
}

const RISK_MAP = {
  low: { label: '低风险', color: 'bg-emerald-100 text-emerald-700' },
  medium: { label: '中风险', color: 'bg-amber-100 text-amber-700' },
  high: { label: '高风险', color: 'bg-red-100 text-red-700' },
}

const FILTERS = [
  { key: '', label: '全部候选人' },
  { key: 'high_score', label: '高分候选人' },
  { key: 'high_risk', label: '高风险候选人' },
  { key: 'missing_info', label: '信息不完整' },
  { key: 'needs_review', label: '待人工复核' },
]

function GradeBadge({ grade }) {
  if (!grade) return null
  return <span className={`grade-badge grade-${grade}`}>{grade}</span>
}

function getOverallScore(resume) {
  return resume.overallScore ?? resume.evaluationResult?.overall_evaluation?.overall_score ?? null
}

function getMatchScore(resume) {
  return resume.matchScore ?? resume.evaluationResult?.match_score ?? getOverallScore(resume)
}

function getRecommendation(resume) {
  return resume.recommendation || resume.evaluationResult?.recommendation || '-'
}

function getRiskLevel(resume) {
  return resume.riskLevel || resume.evaluationResult?.risk_level || 'medium'
}

function getHighlights(resume) {
  return resume.highlights || resume.evaluationResult?.highlights || []
}

function getConcerns(resume) {
  return resume.concerns || resume.evaluationResult?.concerns || []
}

function sortResumes(list) {
  const rank = { 推荐面试: 0, 待定: 1, 建议人工复核: 2, 建议淘汰: 3 }
  return [...list].sort((a, b) => {
    const ar = rank[getRecommendation(a)] ?? 9
    const br = rank[getRecommendation(b)] ?? 9
    if (ar !== br) return ar - br
    return (getMatchScore(b) || 0) - (getMatchScore(a) || 0)
  })
}

export default function BatchReviewPage() {
  const [resumes, setResumes] = useState([])
  const [profiles, setProfiles] = useState([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [filter, setFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedFileCount, setSelectedFileCount] = useState(0)
  const [jobDescription, setJobDescription] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    loadResumes()
    api.get('/profiles').then(res => {
      const profileList = Array.isArray(res.data) ? res.data : []
      setProfiles(profileList)
      const defaultP = profileList.find(p => p.isDefault)
      if (defaultP) setSelectedProfile(defaultP.id)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!resumes.some(r => r.status === 'evaluating')) return
    const timer = setInterval(loadResumes, 3500)
    return () => clearInterval(timer)
  }, [resumes])

  const loadResumes = async () => {
    setLoading(true)
    try {
      const res = await api.get('/resumes?perPage=100')
      const resumeList = Array.isArray(res.data?.resumes) ? res.data.resumes : []
      setResumes(resumeList)
    } catch (err) {
      setError('加载简历列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async () => {
    if (!selectedProfile) {
      setError('请先选择审查模板')
      return
    }
    const files = fileRef.current?.files
    if (!files || files.length === 0) return
    setUploading(true)
    setError('')
    try {
      const formData = new FormData()
      for (const f of files) formData.append('files', f)
      formData.append('profileId', selectedProfile)
      formData.append('jobDescription', jobDescription)
      formData.append('autoEvaluate', 'true')
      await api.post('/batch-upload', formData)
      fileRef.current.value = ''
      setSelectedFileCount(0)
      await loadResumes()
    } catch (err) {
      setError(err.response?.data?.error || '批量上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return
    if (!window.confirm(`确定删除 ${selectedIds.length} 份简历？`)) return
    setLoading(true)
    setError('')
    try {
      await api.post('/resumes/batch-delete', { ids: selectedIds })
      setSelectedIds([])
      await loadResumes()
    } catch (err) {
      setError(err.response?.data?.error || '批量删除失败')
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      const res = await api.post('/resumes/export-scores', { ids: selectedIds }, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href = url
      link.download = 'candidate_screening_board.xlsx'
      link.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError('导出失败')
    }
  }

  const updateWorkflow = async (resume, workflowStatus, hrNote = resume.hrNote || '') => {
    const previous = resumes
    setResumes(list => list.map(r => r.id === resume.id ? { ...r, workflowStatus, hrNote } : r))
    try {
      await api.put(`/resumes/${resume.id}/workflow`, { workflowStatus, hrNote })
    } catch (err) {
      setResumes(previous)
      setError(err.response?.data?.error || '更新处理状态失败')
    }
  }

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleAll = () => {
    const ids = filteredResumes.map(r => r.id)
    if (selectedIds.length === ids.length) setSelectedIds([])
    else setSelectedIds(ids)
  }

  const filteredResumes = sortResumes(resumes.filter(r => {
    const score = getMatchScore(r) || 0
    const risk = getRiskLevel(r)
    const concerns = getConcerns(r).join('')
    if (filter === 'high_score') return score >= 75
    if (filter === 'high_risk') return risk === 'high'
    if (filter === 'missing_info') return /信息缺失|联系方式|邮箱|电话|学历|年龄/.test(concerns)
    if (filter === 'needs_review') return r.workflowStatus === 'needs_review' || getRecommendation(r) === '建议人工复核'
    return true
  }))

  const completed = resumes.filter(r => r.status === 'completed')
  const recommended = completed.filter(r => getRecommendation(r) === '推荐面试').length
  const needsReview = resumes.filter(r => r.workflowStatus === 'needs_review' || getRiskLevel(r) === 'high').length
  const avgMatch = completed.length ? Math.round(completed.reduce((sum, r) => sum + (getMatchScore(r) || 0), 0) / completed.length) : 0

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <p className="text-sm font-medium text-cyan-600 mb-1">AI 招聘初筛工作台</p>
        <h2 className="text-2xl font-bold text-slate-900">5分钟完成批量筛选、风险识别和面试建议</h2>
      </div>

      {error && <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-sm text-slate-500">候选人总数</p><p className="text-2xl font-bold text-slate-900">{resumes.length}</p></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-sm text-slate-500">推荐面试</p><p className="text-2xl font-bold text-emerald-600">{recommended}</p></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-sm text-slate-500">待人工复核</p><p className="text-2xl font-bold text-amber-600">{needsReview}</p></div>
        <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-sm text-slate-500">平均匹配分</p><p className="text-2xl font-bold text-indigo-600">{avgMatch || '-'}</p></div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">审查模板</label>
            <select value={selectedProfile} onChange={e => setSelectedProfile(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none">
              <option value="">选择模板...</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name} {p.isDefault ? '(默认)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">上传简历</label>
            <div onClick={() => fileRef.current?.click()} className="w-full px-3 py-2 rounded-lg border border-slate-300 hover:border-indigo-400 cursor-pointer flex items-center gap-2 text-slate-600">
              <Upload className="w-4 h-4" />
              <span>{selectedFileCount > 0 ? `已选择 ${selectedFileCount} 个文件` : '选择多个 docx/pdf 文件'}</span>
            </div>
            <input ref={fileRef} type="file" accept=".docx,.pdf" multiple onChange={(e) => setSelectedFileCount(e.target.files?.length || 0)} className="hidden" />
          </div>
          <div className="flex items-end">
            <button onClick={handleUpload} disabled={uploading} className="w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              上传并自动初筛
            </button>
          </div>
        </div>
        <label className="block text-sm font-medium text-slate-700 mb-1">岗位需求/JD（推荐粘贴，评分会按JD匹配度排序）</label>
        <textarea value={jobDescription} onChange={e => setJobDescription(e.target.value)} rows={4} placeholder="粘贴岗位职责、必备技能、加分项、薪资范围等。未填写时按通用模板评估。" className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none resize-none" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="font-bold text-slate-800 flex items-center gap-2"><ClipboardList className="w-5 h-5 text-indigo-500" /> 候选人排行榜</h3>
            {FILTERS.map(item => (
              <button key={item.key} onClick={() => setFilter(item.key)} className={`px-3 py-1.5 rounded-full text-sm font-medium ${filter === item.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{item.label}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={handleBatchDelete} disabled={selectedIds.length === 0 || loading} className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1"><Trash2 className="w-4 h-4" /> 删除</button>
            <button onClick={handleExport} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"><Download className="w-4 h-4" /> 导出Excel</button>
          </div>
        </div>

        {loading && resumes.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-slate-400"><Loader2 className="w-6 h-6 animate-spin mr-2" /> 加载中...</div>
        ) : filteredResumes.length === 0 ? (
          <div className="text-center py-12 text-slate-400"><Files className="w-12 h-12 mx-auto mb-3 text-slate-300" /><p>暂无候选人数据</p></div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm min-w-[1180px]">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="py-3 px-3 text-left"><input type="checkbox" checked={selectedIds.length === filteredResumes.length && filteredResumes.length > 0} onChange={toggleAll} /></th>
                  <th className="py-3 px-3 text-left font-medium text-slate-600">候选人</th>
                  <th className="py-3 px-3 text-left font-medium text-slate-600">目标岗位</th>
                  <th className="py-3 px-3 text-left font-medium text-slate-600">匹配分</th>
                  <th className="py-3 px-3 text-left font-medium text-slate-600">风险等级</th>
                  <th className="py-3 px-3 text-left font-medium text-slate-600">核心亮点</th>
                  <th className="py-3 px-3 text-left font-medium text-slate-600">主要短板</th>
                  <th className="py-3 px-3 text-left font-medium text-slate-600">建议动作</th>
                  <th className="py-3 px-3 text-left font-medium text-slate-600">处理状态</th>
                  <th className="py-3 px-3 text-left font-medium text-slate-600">HR备注</th>
                  <th className="py-3 px-3 text-left font-medium text-slate-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredResumes.map(r => {
                  const stInfo = STATUS_MAP[r.status] || STATUS_MAP.pending
                  const StIcon = stInfo.icon
                  const riskInfo = RISK_MAP[getRiskLevel(r)] || RISK_MAP.medium
                  const workflowInfo = WORKFLOW_MAP[r.workflowStatus || 'new'] || WORKFLOW_MAP.new
                  return (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                      <td className="py-3 px-3"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                      <td className="py-3 px-3 min-w-[160px]"><p className="font-semibold text-slate-800">{r.candidateName || `简历 #${r.id}`}</p><span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs ${stInfo.color}`}><StIcon className={`w-3 h-3 ${r.status === 'evaluating' ? 'animate-spin' : ''}`} />{stInfo.label}</span></td>
                      <td className="py-3 px-3 text-slate-600 min-w-[130px]">{r.profileName || '默认模板'}</td>
                      <td className="py-3 px-3"><div className="text-xl font-bold text-indigo-600">{getMatchScore(r) ?? '-'}</div>{r.aiResult && <GradeBadge grade={r.aiResult} />}</td>
                      <td className="py-3 px-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${riskInfo.color}`}>{riskInfo.label}</span></td>
                      <td className="py-3 px-3 text-slate-600 max-w-[210px]">{getHighlights(r).slice(0, 2).map((x, i) => <p key={i}>• {x}</p>)}</td>
                      <td className="py-3 px-3 text-slate-600 max-w-[230px]">{getConcerns(r).slice(0, 2).map((x, i) => <p key={i}>• {x}</p>)}</td>
                      <td className="py-3 px-3"><span className="font-semibold text-slate-800">{getRecommendation(r)}</span></td>
                      <td className="py-3 px-3">
                        <select value={r.workflowStatus || 'new'} onChange={e => updateWorkflow(r, e.target.value)} className={`px-2 py-1 rounded-lg text-xs font-medium border-0 ${workflowInfo.color}`}>
                          {Object.entries(WORKFLOW_MAP).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
                        </select>
                      </td>
                      <td className="py-3 px-3 min-w-[180px]"><input value={r.hrNote || ''} onChange={e => setResumes(list => list.map(item => item.id === r.id ? { ...item, hrNote: e.target.value } : item))} onBlur={e => updateWorkflow(r, r.workflowStatus || 'new', e.target.value)} placeholder="如：薪资偏高但可聊" className="w-full px-2 py-1 rounded border border-slate-200 text-xs" /></td>
                      <td className="py-3 px-3">
                        <div className="flex gap-2">
                          {r.status === 'completed' && <button onClick={() => navigate(`/report/${r.id}`)} className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1"><Eye className="w-4 h-4" />报告</button>}
                          <button onClick={() => updateWorkflow(r, 'archived')} className="text-blue-600 hover:text-blue-800 flex items-center gap-1"><Archive className="w-4 h-4" />入库</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
