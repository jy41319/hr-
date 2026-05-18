import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../config/api'
import {
  Upload, Files, Loader2, CheckCircle, XCircle, Clock, Trash2, Download,
  Eye, Sparkles, ClipboardList, Archive, PanelRightOpen, Users, ShieldAlert,
  Target, ListChecks, StickyNote, Check, AlertCircle, ChevronDown, ChevronUp
} from 'lucide-react'

const STATUS_MAP = {
  pending: { label: '待评估', color: 'bg-slate-100 text-slate-600', icon: Clock },
  evaluating: { label: '评估中', color: 'bg-indigo-50 text-indigo-600', icon: Loader2 },
  completed: { label: '已完成', color: 'bg-emerald-50 text-emerald-600', icon: CheckCircle },
  failed: { label: '失败', color: 'bg-red-50 text-red-600', icon: XCircle },
}

const WORKFLOW_MAP = {
  new: { label: '未处理', color: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  shortlisted: { label: '待面试', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  needs_review: { label: '待复核', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  rejected: { label: '已淘汰', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  archived: { label: '已入库', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
}

const RISK_MAP = {
  low: { label: '低风险', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', rail: 'bg-emerald-500' },
  medium: { label: '中风险', color: 'bg-amber-50 text-amber-700 border-amber-200', rail: 'bg-amber-500' },
  high: { label: '高风险', color: 'bg-red-50 text-red-700 border-red-200', rail: 'bg-red-500' },
}

const RECOMMENDATION_MAP = {
  推荐面试: { color: 'bg-emerald-600 text-white', soft: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  待定: { color: 'bg-slate-700 text-white', soft: 'bg-slate-100 text-slate-700 border-slate-200' },
  建议人工复核: { color: 'bg-amber-500 text-white', soft: 'bg-amber-50 text-amber-700 border-amber-200' },
  建议淘汰: { color: 'bg-red-600 text-white', soft: 'bg-red-50 text-red-700 border-red-200' },
}

const QUEUES = [
  { key: '', label: '全部', description: '完整候选池' },
  { key: 'recommended', label: '推荐面试', description: '优先约面' },
  { key: 'needs_review', label: '待复核', description: '需要人工确认' },
  { key: 'high_risk', label: '高风险', description: '证据链优先' },
  { key: 'missing_info', label: '信息缺失', description: '资料不完整' },
  { key: 'handled', label: '已处理', description: '完成流转' },
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
  const rank = { 推荐面试: 0, 待定: 1, 建议人工复核: 2, 建议淘汰: 3, '-': 8 }
  return [...list].sort((a, b) => {
    const ar = rank[getRecommendation(a)] ?? 9
    const br = rank[getRecommendation(b)] ?? 9
    if (ar !== br) return ar - br
    return (getMatchScore(b) || 0) - (getMatchScore(a) || 0)
  })
}

function isMissingInfo(resume) {
  const concerns = getConcerns(resume).join('')
  const name = resume.candidateName || ''
  return /信息缺失|联系方式|邮箱|电话|学历|年龄/.test(concerns) || /^简历 #/.test(name)
}

function EmptyQueue({ queue }) {
  const copy = {
    recommended: '暂无推荐面试候选人，建议调整 JD、降低初筛阈值，或先查看“待定”队列。',
    needs_review: '当前没有待复核候选人，很清爽。高风险或模型超时会自动进入这里。',
    high_risk: '暂无高风险候选人。风险证据会在报告页里展开。',
    missing_info: '暂无明显信息缺失候选人。联系方式、学历、年龄等缺口会被归到这里。',
    handled: '暂无已处理候选人。把候选人标记为待面试、已淘汰或已入库后会出现在这里。',
  }
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
      <Files className="w-12 h-12 mb-3 text-slate-300" />
      <p className="font-medium text-slate-600">这个队列暂时为空</p>
      <p className="text-sm mt-1 max-w-md">{copy[queue] || '上传简历后，系统会自动按推荐动作和匹配分生成候选人决策队列。'}</p>
    </div>
  )
}

export default function BatchReviewPage() {
  const [resumes, setResumes] = useState([])
  const [profiles, setProfiles] = useState([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [queue, setQueue] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [activeResumeId, setActiveResumeId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedFileCount, setSelectedFileCount] = useState(0)
  const [jobDescription, setJobDescription] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [saveState, setSaveState] = useState({})
  const [noteDraft, setNoteDraft] = useState('')
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
      setUploadOpen(false)
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
    setSaveState({ id: resume.id, status: 'saving' })
    setResumes(list => list.map(r => r.id === resume.id ? { ...r, workflowStatus, hrNote } : r))
    try {
      await api.put(`/resumes/${resume.id}/workflow`, { workflowStatus, hrNote })
      setSaveState({ id: resume.id, status: 'saved' })
      setTimeout(() => setSaveState(current => current.id === resume.id ? {} : current), 1400)
    } catch (err) {
      setResumes(previous)
      setSaveState({ id: resume.id, status: 'error' })
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

  const applyQueue = (list, key) => list.filter(r => {
    const score = getMatchScore(r) || 0
    const risk = getRiskLevel(r)
    const recommendation = getRecommendation(r)
    const handled = ['shortlisted', 'rejected', 'archived'].includes(r.workflowStatus)
    if (key === 'recommended') return recommendation === '推荐面试' || score >= 75
    if (key === 'needs_review') return r.workflowStatus === 'needs_review' || recommendation === '建议人工复核'
    if (key === 'high_risk') return risk === 'high'
    if (key === 'missing_info') return isMissingInfo(r)
    if (key === 'handled') return handled
    return true
  })

  const filteredResumes = sortResumes(applyQueue(resumes, queue))
  const activeResume = filteredResumes.find(r => r.id === activeResumeId) || filteredResumes[0] || null

  useEffect(() => {
    if (!activeResume) {
      setNoteDraft('')
      return
    }
    if (activeResumeId !== activeResume.id) setActiveResumeId(activeResume.id)
    setNoteDraft(activeResume.hrNote || '')
  }, [activeResume?.id, activeResume?.hrNote])

  const completed = resumes.filter(r => r.status === 'completed')
  const recommended = completed.filter(r => getRecommendation(r) === '推荐面试' || (getMatchScore(r) || 0) >= 75).length
  const needsReview = resumes.filter(r => r.workflowStatus === 'needs_review' || getRecommendation(r) === '建议人工复核').length
  const highRisk = resumes.filter(r => getRiskLevel(r) === 'high').length
  const avgMatch = completed.length ? Math.round(completed.reduce((sum, r) => sum + (getMatchScore(r) || 0), 0) / completed.length) : 0

  const queueCounts = Object.fromEntries(QUEUES.map(item => [item.key, applyQueue(resumes, item.key).length]))
  const selectedCount = selectedIds.length

  return (
    <div className="screening-console mx-auto max-w-[1500px]">
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-wide text-cyan-700">AI 招聘初筛工作台</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950 md:text-3xl">今日初筛指挥区</h2>
          <p className="mt-2 text-sm text-slate-500">先看队列，再处理候选人。绿色约面，黄色复核，红色风险，蓝色入库。</p>
        </div>
        <button onClick={() => setUploadOpen(v => !v)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800">
          <Sparkles className="h-4 w-4" /> 新建初筛任务 {uploadOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard icon={Users} label="候选人总数" value={resumes.length} tone="slate" />
        <MetricCard icon={Target} label="推荐面试" value={recommended} tone="emerald" />
        <MetricCard icon={ListChecks} label="待人工复核" value={needsReview} tone="amber" />
        <MetricCard icon={ShieldAlert} label="高风险" value={highRisk} tone="red" />
        <MetricCard icon={ClipboardList} label="平均匹配分" value={avgMatch || '-'} tone="indigo" />
      </div>

      {uploadOpen && (
        <div className="mb-5 rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_auto]">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">审查模板</label>
              <select value={selectedProfile} onChange={e => setSelectedProfile(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">
                <option value="">选择模板...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name} {p.isDefault ? '(默认)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">上传简历</label>
              <div onClick={() => fileRef.current?.click()} className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-slate-600 hover:border-indigo-400 hover:bg-indigo-50/40">
                <Upload className="h-4 w-4" />
                <span>{selectedFileCount > 0 ? `已选择 ${selectedFileCount} 个文件` : '选择多个 docx/pdf 文件'}</span>
              </div>
              <input ref={fileRef} type="file" accept=".docx,.pdf" multiple onChange={(e) => setSelectedFileCount(e.target.files?.length || 0)} className="hidden" />
            </div>
            <div className="flex items-end">
              <button onClick={handleUpload} disabled={uploading} className="w-full rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 lg:w-auto">
                {uploading ? '上传中...' : '上传并自动初筛'}
              </button>
            </div>
          </div>
          <label className="mb-1 mt-4 block text-sm font-semibold text-slate-700">岗位需求/JD</label>
          <textarea value={jobDescription} onChange={e => setJobDescription(e.target.value)} rows={3} placeholder="粘贴岗位职责、必备技能、加分项、薪资范围等。未填写时按通用模板评估。" className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4">
            <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div>
                <h3 className="flex items-center gap-2 font-bold text-slate-900"><ClipboardList className="h-5 w-5 text-indigo-500" /> 候选人决策看板</h3>
                <p className="mt-1 text-xs text-slate-500">默认按建议动作和匹配分排序，点击候选人查看右侧详情。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {QUEUES.map(item => (
                  <button key={item.key} onClick={() => setQueue(item.key)} className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${queue === item.key ? 'bg-slate-950 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {item.label} <span className="ml-1 opacity-70">{queueCounts[item.key] || 0}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading && resumes.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="mr-2 h-6 w-6 animate-spin" /> 加载中...</div>
          ) : filteredResumes.length === 0 ? (
            <EmptyQueue queue={queue} />
          ) : (
            <>
              <div className="hidden overflow-auto lg:block">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
                    <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3"><input type="checkbox" checked={selectedIds.length === filteredResumes.length && filteredResumes.length > 0} onChange={toggleAll} /></th>
                      <th className="px-4 py-3">候选人</th>
                      <th className="px-4 py-3">匹配分</th>
                      <th className="px-4 py-3">建议动作</th>
                      <th className="px-4 py-3">风险</th>
                      <th className="px-4 py-3">亮点 / 短板</th>
                      <th className="px-4 py-3">处理状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResumes.map(r => <CandidateRow key={r.id} resume={r} active={activeResumeId === r.id} selected={selectedIds.includes(r.id)} onSelect={() => toggleSelect(r.id)} onOpen={() => { setActiveResumeId(r.id); setNoteDraft(r.hrNote || '') }} onWorkflow={updateWorkflow} />)}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 p-3 lg:hidden">
                {filteredResumes.map(r => <CandidateCard key={r.id} resume={r} active={activeResumeId === r.id} selected={selectedIds.includes(r.id)} onSelect={() => toggleSelect(r.id)} onOpen={() => { setActiveResumeId(r.id); setNoteDraft(r.hrNote || '') }} />)}
              </div>
            </>
          )}
        </section>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="flex items-center gap-2 font-bold text-slate-900"><PanelRightOpen className="h-5 w-5 text-indigo-500" /> 批量操作</h3>
            <p className="mt-1 text-sm text-slate-500">当前队列 {filteredResumes.length} 人，已选择 {selectedCount} 人。</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={handleExport} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><Download className="mr-1 inline h-4 w-4" />导出</button>
              <button onClick={handleBatchDelete} disabled={selectedCount === 0 || loading} className="rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"><Trash2 className="mr-1 inline h-4 w-4" />删除</button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="flex items-center gap-2 font-bold text-slate-900"><StickyNote className="h-5 w-5 text-indigo-500" /> 候选人详情</h3>
            {activeResume ? (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-950">{activeResume.candidateName || `简历 #${activeResume.id}`}</p>
                      <p className="text-xs text-slate-500">{activeResume.profileName || '默认模板'}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-xs font-bold ${RECOMMENDATION_MAP[getRecommendation(activeResume)]?.soft || 'border-slate-200 bg-slate-100 text-slate-600'}`}>{getRecommendation(activeResume)}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MiniStat label="匹配分" value={getMatchScore(activeResume) ?? '-'} />
                    <MiniStat label="风险" value={RISK_MAP[getRiskLevel(activeResume)]?.label || '中风险'} />
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-emerald-700">亮点</p>
                  {getHighlights(activeResume).slice(0, 3).length ? getHighlights(activeResume).slice(0, 3).map((item, i) => <p key={i} className="mb-1 text-sm text-slate-600">• {item}</p>) : <p className="text-sm text-slate-400">暂无结构化亮点，打开报告查看完整评估。</p>}
                </div>
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-amber-700">短板 / 风险</p>
                  {getConcerns(activeResume).slice(0, 3).length ? getConcerns(activeResume).slice(0, 3).map((item, i) => <p key={i} className="mb-1 text-sm text-slate-600">• {item}</p>) : <p className="text-sm text-slate-400">暂无结构化短板，打开报告查看完整评估。</p>}
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">处理状态</label>
                  <select value={activeResume.workflowStatus || 'new'} onChange={e => updateWorkflow(activeResume, e.target.value, noteDraft)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500">
                    {Object.entries(WORKFLOW_MAP).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">HR备注</label>
                  <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} onBlur={() => updateWorkflow(activeResume, activeResume.workflowStatus || 'new', noteDraft)} rows={4} placeholder="如：业务方觉得项目不错；薪资偏高但可聊" className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
                  <SaveHint state={saveState.id === activeResume.id ? saveState.status : ''} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {activeResume.status === 'completed' && <button onClick={() => navigate(`/report/${activeResume.id}`)} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"><Eye className="mr-1 inline h-4 w-4" />报告</button>}
                  <button onClick={() => updateWorkflow(activeResume, 'archived', noteDraft)} className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Archive className="mr-1 inline h-4 w-4" />入库</button>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-400">选择一个候选人后，这里会显示亮点、风险、备注和快捷动作。</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, tone }) {
  const tones = {
    slate: 'text-slate-900 bg-slate-100',
    emerald: 'text-emerald-700 bg-emerald-100',
    amber: 'text-amber-700 bg-amber-100',
    red: 'text-red-700 bg-red-100',
    indigo: 'text-indigo-700 bg-indigo-100',
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{label}</p>
        <span className={`rounded-xl p-2 ${tones[tone] || tones.slate}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-3 text-3xl font-black text-slate-950">{value}</p>
    </div>
  )
}

function MiniStat({ label, value }) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-bold text-slate-900">{value}</p></div>
}

function SaveHint({ state }) {
  if (!state) return null
  if (state === 'saving') return <p className="mt-1 text-xs text-slate-400">正在保存...</p>
  if (state === 'saved') return <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3 w-3" /> 已保存</p>
  return <p className="mt-1 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3 w-3" /> 保存失败</p>
}

function CandidateRow({ resume, active, selected, onSelect, onOpen, onWorkflow }) {
  const status = STATUS_MAP[resume.status] || STATUS_MAP.pending
  const StatusIcon = status.icon
  const risk = RISK_MAP[getRiskLevel(resume)] || RISK_MAP.medium
  const recommendation = RECOMMENDATION_MAP[getRecommendation(resume)] || RECOMMENDATION_MAP['待定']
  const workflow = WORKFLOW_MAP[resume.workflowStatus || 'new'] || WORKFLOW_MAP.new
  const highlights = getHighlights(resume).slice(0, 1)
  const concerns = getConcerns(resume).slice(0, 1)

  return (
    <tr onClick={onOpen} className={`cursor-pointer border-b border-slate-100 align-top transition hover:bg-slate-50 ${active ? 'bg-indigo-50/60' : ''}`}>
      <td className={`w-2 p-0 ${risk.rail}`}></td>
      <td className="px-4 py-3" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected} onChange={onSelect} /></td>
      <td className="px-4 py-3">
        <p className="font-bold text-slate-900">{resume.candidateName || `简历 #${resume.id}`}</p>
        <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}><StatusIcon className={`h-3 w-3 ${resume.status === 'evaluating' ? 'animate-spin' : ''}`} />{status.label}</span>
      </td>
      <td className="px-4 py-3"><div className="text-2xl font-black text-slate-950">{getMatchScore(resume) ?? '-'}</div>{resume.aiResult && <GradeBadge grade={resume.aiResult} />}</td>
      <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${recommendation.color}`}>{getRecommendation(resume)}</span></td>
      <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${risk.color}`}>{risk.label}</span></td>
      <td className="px-4 py-3 text-slate-600">
        {highlights.map((item, i) => <p key={`h-${i}`} className="line-clamp-1">+ {item}</p>)}
        {concerns.map((item, i) => <p key={`c-${i}`} className="line-clamp-1 text-amber-700">- {item}</p>)}
        {!highlights.length && !concerns.length && <span className="text-slate-400">打开报告查看完整分析</span>}
      </td>
      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
        <select value={resume.workflowStatus || 'new'} onChange={e => onWorkflow(resume, e.target.value)} className={`rounded-lg border-0 px-2 py-1 text-xs font-semibold ${workflow.color}`}>
          {Object.entries(WORKFLOW_MAP).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
        </select>
      </td>
    </tr>
  )
}

function CandidateCard({ resume, active, selected, onSelect, onOpen }) {
  const risk = RISK_MAP[getRiskLevel(resume)] || RISK_MAP.medium
  const recommendation = RECOMMENDATION_MAP[getRecommendation(resume)] || RECOMMENDATION_MAP['待定']
  return (
    <div onClick={onOpen} className={`rounded-2xl border bg-white p-4 shadow-sm ${active ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <input type="checkbox" checked={selected} onChange={onSelect} onClick={e => e.stopPropagation()} />
          <div>
            <p className="font-bold text-slate-900">{resume.candidateName || `简历 #${resume.id}`}</p>
            <p className="text-xs text-slate-500">匹配分 {getMatchScore(resume) ?? '-'}</p>
          </div>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-bold ${recommendation.color}`}>{getRecommendation(resume)}</span>
      </div>
      <div className="mt-3 flex items-center gap-2"><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${risk.color}`}>{risk.label}</span>{resume.aiResult && <GradeBadge grade={resume.aiResult} />}</div>
    </div>
  )
}
