import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import api from '../config/api'
import {
  Upload, Files, Loader2, CheckCircle, XCircle, Clock, Trash2, Download,
  Eye, Sparkles, ClipboardList, Archive, PanelRightOpen, Users, ShieldAlert,
  Target, ListChecks, StickyNote, Check, AlertCircle, ChevronDown, ChevronUp, X,
  ThumbsUp, Save
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

function gradeFromScore(score) {
  const value = Number(score || 0)
  if (value >= 90) return 'A'
  if (value >= 80) return 'B'
  if (value >= 70) return 'C'
  if (value >= 60) return 'D'
  return 'E'
}

function getOverallScore(resume) {
  return resume.overallScore ?? resume.evaluationResult?.overall_evaluation?.overall_score ?? null
}

function getOverallGrade(resume) {
  return resume.grade || resume.evaluationResult?.overall_evaluation?.overall_grade || (getOverallScore(resume) !== null ? gradeFromScore(getOverallScore(resume)) : '')
}

function getMatchScore(resume) {
  return resume.matchScore ?? resume.evaluationResult?.match_score ?? getOverallScore(resume)
}

function getMatchGrade(resume) {
  return resume.matchGrade || resume.evaluationResult?.match_grade || (getMatchScore(resume) !== null ? gradeFromScore(getMatchScore(resume)) : '')
}

function getRankingScore(resume, rankingMode = 'jd') {
  return rankingMode === 'overall' ? getOverallScore(resume) : getMatchScore(resume)
}

function getRankingGrade(resume, rankingMode = 'jd') {
  return rankingMode === 'overall' ? getOverallGrade(resume) : getMatchGrade(resume)
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

function getJdCriteria(resume) {
  return resume.jdCriteria || resume.evaluationResult?.jd_criteria || {}
}

function getRequirementMatches(resume) {
  return resume.requirementMatches || resume.evaluationResult?.requirement_matches || []
}

function getScoreBreakdown(resume) {
  return resume.scoreBreakdown || resume.evaluationResult?.score_breakdown || {}
}

function getRecommendationReason(resume) {
  return resume.recommendationReason || resume.evaluationResult?.recommendation_reason || ''
}

function getKeyGaps(resume) {
  return resume.keyGaps || resume.evaluationResult?.key_gaps || []
}

function getInterviewQuestions(resume) {
  return resume.evaluationResult?.interview_questions || []
}

function getCandidateProfileSummary(resume) {
  return resume.candidateProfileSummary || resume.evaluationResult?.candidate_profile_summary || ''
}

function getCommunicationTemplates(resume) {
  const templates = resume.communicationTemplates || resume.evaluationResult?.communication_templates || {}
  const name = resume.candidateName && !/^简历 #/.test(resume.candidateName) ? resume.candidateName : '候选人'
  return {
    interview_invite: templates.interview_invite || `${name}您好，我们看到了您的简历，想进一步沟通岗位匹配情况，请问近期方便安排一次面试吗？`,
    request_more_info: templates.request_more_info || `${name}您好，为了更准确评估岗位匹配度，麻烦补充相关项目经历、可到岗时间或作品链接。`,
    rejection: templates.rejection || `${name}您好，感谢投递。综合当前岗位要求，本次暂不进入下一轮，后续有合适机会我们会再联系。`,
  }
}

function clipText(text, limit = 24) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned.length > limit ? `${cleaned.slice(0, limit).trim()}...` : cleaned
}

function simpleHash(text) {
  let hash = 0
  const normalized = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function getJobKey(resume) {
  if (resume?.jobKey) return resume.jobKey
  if (resume?.jobDescription) return `jd_${simpleHash(resume.jobDescription)}`
  if (resume?.profileId) return `profile_${resume.profileId}`
  return 'no_jd'
}

function getJobName(resume) {
  if (resume?.jobName) return resume.jobName
  const firstLine = String(resume?.jobDescription || '').split('\n').find(line => line.trim())
  if (firstLine) return clipText(firstLine, 18)
  return resume?.profileName || '通用初筛任务'
}

function getJobSummary(resume) {
  if (resume?.jobSummary) return resume.jobSummary
  const firstLine = String(resume?.jobDescription || '').split('\n').find(line => line.trim())
  if (firstLine) return clipText(firstLine, 60)
  return resume?.profileName || '未填写JD，使用通用初筛标准'
}

function deriveJobNameFromDescription(description) {
  const firstLine = String(description || '').split('\n').find(line => line.trim())
  return firstLine ? clipText(firstLine, 18) : ''
}

function getSearchBlob(resume) {
  return [
    resume.candidateName,
    resume.candidateEmail,
    resume.candidatePhone,
    getJobName(resume),
    resume.jobDescription,
    JSON.stringify(resume.structuredInfo || {}),
    JSON.stringify(resume.evaluationResult || {}),
    getHighlights(resume).join(' '),
    getConcerns(resume).join(' '),
  ].filter(Boolean).join(' ')
}

function inferGender(resume) {
  const text = getSearchBlob(resume)
  if (/(性别|gender)[：:\s]*男|男生|先生/.test(text)) return 'male'
  if (/(性别|gender)[：:\s]*女|女生|女士/.test(text)) return 'female'
  return ''
}

function inferSchoolTier(resume) {
  const text = getSearchBlob(resume)
  if (/清华|北大|复旦|上交|上海交通|浙大|南京大学|中科大|人大|985|C9|双一流A/.test(text)) return 'top'
  if (/211|双一流|重点大学|一流学科/.test(text)) return 'strong'
  if (/本科|大学|学院/.test(text)) return 'undergrad'
  if (/专科|高职|大专/.test(text)) return 'college'
  return ''
}

function inferEducation(resume) {
  const text = getSearchBlob(resume)
  if (/博士|PhD|doctor/i.test(text)) return 'phd'
  if (/硕士|研究生|Master/i.test(text)) return 'master'
  if (/本科|学士|Bachelor/i.test(text)) return 'bachelor'
  if (/专科|高职|大专/.test(text)) return 'college'
  return ''
}

function inferMajorText(resume) {
  const text = getSearchBlob(resume)
  const match = text.match(/(?:专业|major)[：:\s]*([^，,。;；\n]{2,24})/i)
  return match ? match[1] : ''
}

function inferGradYear(resume) {
  const text = getSearchBlob(resume)
  const match = text.match(/(?:毕业|毕业时间|届|预计毕业)[^0-9]*(20\d{2})/) || text.match(/(20\d{2})届/)
  return match ? match[1] : ''
}

function inferCity(resume) {
  const text = getSearchBlob(resume)
  const cities = ['北京', '上海', '杭州', '深圳', '广州', '成都', '南京', '苏州', '武汉', '西安']
  return cities.find(city => text.includes(city)) || ''
}

function inferSalary(resume) {
  const text = getSearchBlob(resume)
  const match = text.match(/(\d{1,3})\s*[kK][\-~至到]\s*(\d{1,3})\s*[kK]/) || text.match(/(\d{4,6})\s*[\-~至到]\s*(\d{4,6})/)
  if (!match) return null
  const value = Number(match[2])
  return value > 500 ? Math.round(value / 1000) : value
}

function getUnmetRequirements(resume) {
  return getRequirementMatches(resume).filter(item => ['missing', 'partial', 'unknown'].includes(item.status))
}

function getFilterHitReasons(resume, filters = {}) {
  const reasons = []
  const gender = inferGender(resume)
  const schoolTier = inferSchoolTier(resume)
  const education = inferEducation(resume)
  const major = inferMajorText(resume)
  const gradYear = inferGradYear(resume)
  const city = inferCity(resume)
  const salary = inferSalary(resume)
  const unmet = getUnmetRequirements(resume)
  if (filters.gender && gender === filters.gender) reasons.push(`性别匹配：${gender === 'male' ? '男' : '女'}`)
  if (filters.schoolTier && schoolTier === filters.schoolTier) reasons.push('院校档次匹配')
  if (filters.education && education === filters.education) reasons.push('学历匹配')
  if (filters.major && major.includes(filters.major)) reasons.push(`专业命中：${major}`)
  if (filters.gradYear && gradYear === filters.gradYear) reasons.push(`毕业年份：${gradYear}`)
  if (filters.city && city === filters.city) reasons.push(`城市命中：${city}`)
  if (filters.salary && salary !== null) reasons.push(`薪资预期约${salary}K`)
  if (filters.unmetOnly && unmet.length) reasons.push(`硬性条件未满足：${unmet[0].requirement}`)
  return reasons.slice(0, 3)
}

function countRequirementStatus(resume) {
  const matches = getRequirementMatches(resume)
  const met = matches.filter(item => item.status === 'met').length
  return { met, total: matches.length }
}

function sortResumes(list, rankingMode = 'jd') {
  const rank = { 推荐面试: 0, 待定: 1, 建议人工复核: 2, 建议淘汰: 3, '-': 8 }
  return [...list].sort((a, b) => {
    const aScore = getRankingScore(a, rankingMode)
    const bScore = getRankingScore(b, rankingMode)
    const aHasScore = aScore !== null && aScore !== undefined
    const bHasScore = bScore !== null && bScore !== undefined
    if (aHasScore !== bHasScore) return aHasScore ? -1 : 1
    const scoreDiff = (bScore || 0) - (aScore || 0)
    if (scoreDiff !== 0) return scoreDiff
    const ar = rank[getRecommendation(a)] ?? 9
    const br = rank[getRecommendation(b)] ?? 9
    if (ar !== br) return ar - br
    return (b.id || 0) - (a.id || 0)
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
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isCompareOpen, setIsCompareOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedFileCount, setSelectedFileCount] = useState(0)
  const [jobName, setJobName] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [activeJobKey, setActiveJobKey] = useState(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [rankingMode, setRankingMode] = useState('jd')
  const [filters, setFilters] = useState({ gender: '', schoolTier: '', education: '', major: '', gradYear: '', city: '', salary: '', unmetOnly: false })
  const [saveState, setSaveState] = useState({})
  const [noteDraft, setNoteDraft] = useState('')
  const [feedbackState, setFeedbackState] = useState({})
  const [feedbackSelections, setFeedbackSelections] = useState({})
  const [detailFeedbackOpen, setDetailFeedbackOpen] = useState({})
  const [detailFeedbackDrafts, setDetailFeedbackDrafts] = useState({})
  const [savedDetailFeedbacks, setSavedDetailFeedbacks] = useState({})
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
      setActiveJobKey(current => {
        if (current === '') return current
        if (current && resumeList.some(item => getJobKey(item) === current)) return current
        return resumeList.length ? getJobKey(resumeList[0]) : ''
      })
    } catch (err) {
      setError('加载简历列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async () => {
    const files = fileRef.current?.files
    if (!files || files.length === 0) return
    setUploading(true)
    setError('')
    try {
      const formData = new FormData()
      for (const f of files) formData.append('files', f)
      if (selectedProfile) formData.append('profileId', selectedProfile)
      const finalJobName = jobName.trim() || deriveJobNameFromDescription(jobDescription)
      if (finalJobName) formData.append('jobName', finalJobName)
      formData.append('jobDescription', jobDescription)
      formData.append('autoEvaluate', 'true')
      const uploadRes = await api.post('/batch-upload', formData)
      const created = Array.isArray(uploadRes.data?.resumes) ? uploadRes.data.resumes : []
      if (created[0]) setActiveJobKey(getJobKey(created[0]))
      fileRef.current.value = ''
      setSelectedFileCount(0)
      setJobName('')
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
      const visibleIds = filteredResumes.map(r => r.id)
      const ids = selectedIds.length ? selectedIds.filter(id => visibleIds.includes(id)) : visibleIds
      if (ids.length === 0) {
        setError('当前JD任务下没有可导出的候选人')
        return
      }
      const res = await api.post('/resumes/export-scores', { ids }, { responseType: 'blob' })
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

  const sendFeedback = async (resume, payload) => {
    if (!resume) return
    const normalized = typeof payload === 'string'
      ? { group: 'legacy', label: payload, value: payload, detail: '' }
      : { detail: '', ...payload }
    const nextRecommendationFeedback = normalized.group === 'recommendation'
      ? normalized.value
      : feedbackSelections[resume.id]?.recommendation
    const nextBusinessFeedback = normalized.group === 'business'
      ? normalized.value
      : feedbackSelections[resume.id]?.business
    setFeedbackState({ id: resume.id, status: 'saving' })
    try {
      await api.post('/feedback', {
        content: JSON.stringify({
          type: 'candidate_decision_feedback',
          resumeId: resume.id,
          candidateName: resume.candidateName,
          group: normalized.group,
          label: normalized.label,
          value: normalized.value,
          detail: normalized.detail,
          recommendationFeedback: nextRecommendationFeedback,
          businessFeedback: nextBusinessFeedback,
          recommendation: getRecommendation(resume),
          matchScore: getMatchScore(resume),
          source: 'batch_sidebar',
        }, null, 2),
      })
      if (normalized.group === 'recommendation') {
        setFeedbackSelections(prev => ({
          ...prev,
          [resume.id]: { ...(prev[resume.id] || {}), recommendation: normalized.value },
        }))
      }
      if (normalized.group === 'business') {
        setFeedbackSelections(prev => ({
          ...prev,
          [resume.id]: { ...(prev[resume.id] || {}), business: normalized.value },
        }))
      }
      if (normalized.group === 'detail') {
        setSavedDetailFeedbacks(prev => ({ ...prev, [resume.id]: normalized.detail }))
      }
      setFeedbackState({ id: resume.id, status: 'saved' })
      setTimeout(() => setFeedbackState(current => current.id === resume.id ? {} : current), 1400)
    } catch (err) {
      setFeedbackState({ id: resume.id, status: 'error' })
      setError(err.response?.data?.error || '反馈保存失败')
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
    const allSelected = ids.length > 0 && ids.every(id => selectedIds.includes(id))
    if (allSelected) setSelectedIds([])
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

  const applyBasicFilters = (list) => list.filter(r => {
    const gender = inferGender(r)
    const schoolTier = inferSchoolTier(r)
    const education = inferEducation(r)
    const major = inferMajorText(r)
    const gradYear = inferGradYear(r)
    const city = inferCity(r)
    const salary = inferSalary(r)
    if (filters.gender && gender !== filters.gender) return false
    if (filters.schoolTier && schoolTier !== filters.schoolTier) return false
    if (filters.education && education !== filters.education) return false
    if (filters.major && !major.includes(filters.major)) return false
    if (filters.gradYear && gradYear !== filters.gradYear) return false
    if (filters.city && city !== filters.city) return false
    if (filters.salary === 'under15' && !(salary !== null && salary < 15)) return false
    if (filters.salary === '15to25' && !(salary !== null && salary >= 15 && salary <= 25)) return false
    if (filters.salary === 'over25' && !(salary !== null && salary > 25)) return false
    if (filters.unmetOnly && getUnmetRequirements(r).length === 0) return false
    return true
  })

  const jobGroups = useMemo(() => {
    const groups = new Map()
    resumes.forEach(resume => {
      const key = getJobKey(resume)
      const existing = groups.get(key) || {
        key,
        name: getJobName(resume),
        summary: getJobSummary(resume),
        description: resume.jobDescription || '',
        resumes: [],
        latestTime: resume.uploadTime || '',
      }
      existing.resumes.push(resume)
      if ((resume.uploadTime || '') > (existing.latestTime || '')) existing.latestTime = resume.uploadTime
      if (!existing.description && resume.jobDescription) existing.description = resume.jobDescription
      groups.set(key, existing)
    })
    return Array.from(groups.values()).map(group => {
      const completedItems = group.resumes.filter(r => r.status === 'completed')
      const recommendedItems = group.resumes.filter(r => getRecommendation(r) === '推荐面试' || (getMatchScore(r) || 0) >= 75)
      const reviewItems = group.resumes.filter(r => r.workflowStatus === 'needs_review' || getRecommendation(r) === '建议人工复核')
      const avg = completedItems.length
        ? Math.round(completedItems.reduce((sum, r) => sum + (getMatchScore(r) || 0), 0) / completedItems.length)
        : 0
      return { ...group, total: group.resumes.length, recommended: recommendedItems.length, needsReview: reviewItems.length, avgMatch: avg }
    }).sort((a, b) => String(b.latestTime || '').localeCompare(String(a.latestTime || '')))
  }, [resumes])

  const currentJobGroup = activeJobKey ? jobGroups.find(group => group.key === activeJobKey) : null
  const jobScopedResumes = activeJobKey ? resumes.filter(r => getJobKey(r) === activeJobKey) : resumes
  const filteredResumes = sortResumes(applyBasicFilters(applyQueue(jobScopedResumes, queue)), rankingMode)
  const activeResume = filteredResumes.find(r => r.id === activeResumeId) || null

  useEffect(() => {
    if (!activeResume) setNoteDraft('')
  }, [activeResume])

  useEffect(() => {
    setSelectedIds([])
    setActiveResumeId(null)
    setIsDetailOpen(false)
  }, [activeJobKey])

  const openCandidateDetail = (resume) => {
    setActiveResumeId(resume.id)
    setNoteDraft(resume.hrNote || '')
    setIsDetailOpen(true)
  }

  const closeCandidateDetail = () => {
    setIsDetailOpen(false)
    setActiveResumeId(null)
    setNoteDraft('')
  }

  const openCompare = () => {
    if (selectedIds.length < 2 || selectedIds.length > 3) return
    setIsCompareOpen(true)
  }

  const completed = jobScopedResumes.filter(r => r.status === 'completed')
  const recommended = completed.filter(r => getRecommendation(r) === '推荐面试' || (getMatchScore(r) || 0) >= 75).length
  const needsReview = jobScopedResumes.filter(r => r.workflowStatus === 'needs_review' || getRecommendation(r) === '建议人工复核').length
  const highRisk = jobScopedResumes.filter(r => getRiskLevel(r) === 'high').length
  const avgMatch = completed.length ? Math.round(completed.reduce((sum, r) => sum + (getMatchScore(r) || 0), 0) / completed.length) : 0
  const avgOverall = completed.length ? Math.round(completed.reduce((sum, r) => sum + (getOverallScore(r) || 0), 0) / completed.length) : 0
  const activeScoreLabel = rankingMode === 'overall' ? '综合平均分' : 'JD平均匹配分'
  const activeScoreValue = rankingMode === 'overall' ? avgOverall : avgMatch

  const queueCounts = Object.fromEntries(QUEUES.map(item => [item.key, applyQueue(jobScopedResumes, item.key).length]))
  const selectedCount = selectedIds.length
  const hasBasicFilters = Boolean(filters.gender || filters.schoolTier || filters.education || filters.major || filters.gradYear || filters.city || filters.salary || filters.unmetOnly)
  const selectedCompareResumes = sortResumes(jobScopedResumes.filter(r => selectedIds.includes(r.id)), rankingMode).slice(0, 3)
  return (
    <div className="screening-console mx-auto max-w-[1500px] motion-panel">
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-wide text-cyan-700">AI 招聘初筛工作台</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950 md:text-3xl">JD 初筛指挥区</h2>
          <p className="mt-2 text-sm text-slate-500">先粘贴本次岗位 JD，再上传简历。系统会按当前岗位要求排序候选人，模板仅作为无 JD 时的兜底标准。</p>
        </div>
        <button onClick={() => setUploadOpen(v => !v)} className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4" /> 新建 JD 初筛任务 {uploadOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard icon={Users} label="候选人总数" value={jobScopedResumes.length} tone="slate" />
        <MetricCard icon={Target} label="推荐面试" value={recommended} tone="emerald" />
        <MetricCard icon={ListChecks} label="待人工复核" value={needsReview} tone="amber" />
        <MetricCard icon={ShieldAlert} label="高风险" value={highRisk} tone="red" />
        <MetricCard icon={ClipboardList} label={activeScoreLabel} value={activeScoreValue || '-'} tone="indigo" />
      </div>

      <JobTaskSwitcher
        groups={jobGroups}
        activeJobKey={activeJobKey}
        onChange={setActiveJobKey}
      />

      {uploadOpen && (
        <div className="glass-card mb-5 p-5">
          <div className="mb-4 rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4">
            <label className="mb-1 block text-sm font-bold text-slate-800">JD任务名称</label>
            <input
              value={jobName}
              onChange={e => setJobName(e.target.value)}
              placeholder="如：AI产品实习生-2027届。不填时会自动用 JD 首行生成。"
              className="mb-3 w-full rounded-xl border border-cyan-200 bg-white px-3 py-2 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
            />
            <label className="mb-1 block text-sm font-bold text-slate-800">本次岗位 JD / 招聘需求</label>
            <textarea value={jobDescription} onChange={e => setJobDescription(e.target.value)} rows={4} placeholder="粘贴本次岗位的职责、硬性要求、加分项、薪资范围、团队背景等。系统会优先按这份 JD 生成匹配分、候选人排名和面试追问。" className="w-full resize-none rounded-xl border border-cyan-200 bg-white px-3 py-2 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" />
            <p className="mt-2 text-xs text-slate-500">推荐填写 JD。未填写时，系统会使用下方高级设置中的通用标准兜底评估。</p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">上传简历</label>
              <div onClick={() => fileRef.current?.click()} className="glass-control flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-slate-600 hover:border-cyan-400">
                <Upload className="h-4 w-4" />
                <span>{selectedFileCount > 0 ? `已选择 ${selectedFileCount} 个文件` : '选择 1 份或多份 docx/pdf 简历'}</span>
              </div>
              <input ref={fileRef} type="file" accept=".docx,.pdf" multiple onChange={(e) => setSelectedFileCount(e.target.files?.length || 0)} className="hidden" />
            </div>
            <div className="flex items-end">
              <button onClick={handleUpload} disabled={uploading} className="btn-primary w-full px-5 py-2.5 text-sm font-semibold disabled:opacity-50 lg:w-auto">
                {uploading ? '上传中...' : '按JD上传并自动初筛'}
              </button>
            </div>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <button type="button" onClick={() => setAdvancedOpen(v => !v)} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
              高级设置：无 JD 时使用的评估标准 {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {advancedOpen && (
              <div className="mt-3 max-w-xl">
                <label className="mb-1 block text-sm font-semibold text-slate-700">筛选标准兜底</label>
                <select value={selectedProfile} onChange={e => setSelectedProfile(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">
                  <option value="">自动使用默认通用标准</option>
                  {profiles.map(p => <option key={p.id} value={p.id}>{p.name} {p.isDefault ? '(默认)' : ''}</option>)}
                </select>
                <p className="mt-2 text-xs text-slate-500">有 JD 时，JD 是最高优先级；这里仅用于补充通用维度或无 JD 场景。</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5">
        <section className="glass-card overflow-hidden">
          <div className="border-b border-slate-200 p-4">
            <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
              <div>
                <h3 className="flex items-center gap-2 font-bold text-slate-900"><ClipboardList className="h-5 w-5 text-indigo-500" /> 候选人决策看板</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {currentJobGroup ? `当前JD任务：${currentJobGroup.name}。` : '当前查看全部 JD 任务。'}
                  两套分数同时生成，可切换按 JD 匹配度或综合实力实时排序。
                </p>
              </div>
              <div className="flex w-full flex-col gap-3 2xl:w-auto 2xl:items-end">
                <div className="flex flex-wrap items-center gap-2 2xl:justify-end">
                  <span className="text-xs font-bold text-slate-500">排序口径</span>
                  <select value={rankingMode} onChange={e => setRankingMode(e.target.value)} className="rounded-xl border border-cyan-100 bg-white/80 px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-cyan-400">
                    <option value="jd">按 JD 匹配度排序</option>
                    <option value="overall">按综合评分排序</option>
                  </select>
                </div>
                <div className="flex flex-wrap gap-2 2xl:justify-end">
                  {QUEUES.map(item => (
                    <button key={item.key} onClick={() => setQueue(item.key)} className={`chip-button px-3 py-1.5 text-sm font-semibold ${queue === item.key ? 'is-active' : ''}`}>
                      {item.label} <span className="ml-1 opacity-70">{queueCounts[item.key] || 0}</span>
                    </button>
                  ))}
                  <button onClick={() => setFilterOpen(v => !v)} className={`chip-button px-3 py-1.5 text-sm font-semibold ${hasBasicFilters ? 'is-active' : ''}`}>
                    基础筛选 {filterOpen ? <ChevronUp className="ml-1 inline h-4 w-4" /> : <ChevronDown className="ml-1 inline h-4 w-4" />}
                  </button>
                </div>
                <div className="flex flex-col gap-3 rounded-2xl border border-white/70 bg-white/65 p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between 2xl:min-w-[520px]">
                  <div className="flex items-center gap-2">
                    <PanelRightOpen className="h-5 w-5 text-indigo-500" />
                    <div>
                      <p className="text-sm font-bold text-slate-900">批量操作</p>
                      <p className="text-xs text-slate-500">当前队列 {filteredResumes.length} 人，已选择 {selectedCount} 人。</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:min-w-[330px]">
                    <button onClick={handleExport} className="btn-success px-3 py-2 text-sm font-semibold"><Download className="mr-1 inline h-4 w-4" />导出</button>
                    <button onClick={openCompare} disabled={selectedCount < 2 || selectedCount > 3} className="btn-ghost px-3 py-2 text-sm font-semibold disabled:opacity-40"><Users className="mr-1 inline h-4 w-4" />对比</button>
                    <button onClick={handleBatchDelete} disabled={selectedCount === 0 || loading} className="btn-danger px-3 py-2 text-sm font-semibold disabled:opacity-40"><Trash2 className="mr-1 inline h-4 w-4" />删除</button>
                  </div>
                </div>
              </div>
            </div>
            {filterOpen && (
              <div className="mt-4 grid gap-3 rounded-2xl border border-cyan-100 bg-cyan-50/50 p-3 md:grid-cols-4 xl:grid-cols-8">
                <FilterSelect label="性别" value={filters.gender} onChange={value => setFilters(prev => ({ ...prev, gender: value }))} options={[['', '不限'], ['male', '男'], ['female', '女']]} />
                <FilterSelect label="院校档次" value={filters.schoolTier} onChange={value => setFilters(prev => ({ ...prev, schoolTier: value }))} options={[['', '不限'], ['top', '985/C9/顶尖'], ['strong', '211/双一流'], ['undergrad', '普通本科'], ['college', '专科/高职']]} />
                <FilterSelect label="学历" value={filters.education} onChange={value => setFilters(prev => ({ ...prev, education: value }))} options={[['', '不限'], ['phd', '博士'], ['master', '硕士'], ['bachelor', '本科'], ['college', '专科']]} />
                <FilterText label="专业关键词" value={filters.major} onChange={value => setFilters(prev => ({ ...prev, major: value }))} placeholder="如 AI/计算机" />
                <FilterText label="毕业年份" value={filters.gradYear} onChange={value => setFilters(prev => ({ ...prev, gradYear: value }))} placeholder="如 2027" />
                <FilterText label="城市" value={filters.city} onChange={value => setFilters(prev => ({ ...prev, city: value }))} placeholder="如 上海" />
                <FilterSelect label="薪资预期" value={filters.salary} onChange={value => setFilters(prev => ({ ...prev, salary: value }))} options={[['', '不限'], ['under15', '15K以下'], ['15to25', '15-25K'], ['over25', '25K以上']]} />
                <div className="flex flex-col justify-end gap-2">
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
                    <input type="checkbox" checked={filters.unmetOnly} onChange={e => setFilters(prev => ({ ...prev, unmetOnly: e.target.checked }))} />
                    只看硬性未满足
                  </label>
                  <button onClick={() => setFilters({ gender: '', schoolTier: '', education: '', major: '', gradYear: '', city: '', salary: '', unmetOnly: false })} disabled={!hasBasicFilters} className="btn-ghost px-3 py-2 text-sm font-semibold disabled:opacity-40">清空</button>
                </div>
              </div>
            )}
          </div>

          {loading && resumes.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="mr-2 h-6 w-6 animate-spin" /> 加载中...</div>
          ) : filteredResumes.length === 0 ? (
            <EmptyQueue queue={queue} />
          ) : (
            <>
              <div className="hidden overflow-auto lg:block">
                <table className="w-full min-w-[920px] table-fixed text-sm">
                  <colgroup>
                    <col className="w-12" />
                    <col className="w-[24%]" />
                    <col className="w-[12%]" />
                    <col className="w-[15%]" />
                    <col />
                    <col className="w-[15%]" />
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
                    <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3 text-center"><input type="checkbox" checked={filteredResumes.length > 0 && filteredResumes.every(r => selectedIds.includes(r.id))} onChange={toggleAll} /></th>
                      <th className="px-4 py-3">候选人</th>
                      <th className="px-4 py-3 text-center">当前排序分</th>
                      <th className="px-4 py-3">建议动作</th>
                      <th className="px-4 py-3">亮点 / 短板</th>
                      <th className="px-4 py-3 text-center">处理状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResumes.map(r => <CandidateRow key={r.id} resume={r} rankingMode={rankingMode} active={activeResumeId === r.id} selected={selectedIds.includes(r.id)} filterReasons={hasBasicFilters ? getFilterHitReasons(r, filters) : []} onSelect={() => toggleSelect(r.id)} onOpen={() => openCandidateDetail(r)} onWorkflow={updateWorkflow} />)}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 p-3 lg:hidden">
                {filteredResumes.map(r => <CandidateCard key={r.id} resume={r} rankingMode={rankingMode} active={activeResumeId === r.id} selected={selectedIds.includes(r.id)} filterReasons={hasBasicFilters ? getFilterHitReasons(r, filters) : []} onSelect={() => toggleSelect(r.id)} onOpen={() => openCandidateDetail(r)} />)}
              </div>
            </>
          )}
        </section>
      </div>

      <CandidateDetailModal
        resume={activeResume}
        open={isDetailOpen && Boolean(activeResume)}
        noteDraft={noteDraft}
        setNoteDraft={setNoteDraft}
        saveState={saveState}
        feedbackState={feedbackState}
        feedbackSelections={feedbackSelections}
        detailFeedbackOpen={detailFeedbackOpen}
        detailFeedbackDrafts={detailFeedbackDrafts}
        savedDetailFeedbacks={savedDetailFeedbacks}
        setDetailFeedbackOpen={setDetailFeedbackOpen}
        setDetailFeedbackDrafts={setDetailFeedbackDrafts}
        onClose={closeCandidateDetail}
        onWorkflow={updateWorkflow}
        onFeedback={sendFeedback}
        onReport={(resume) => navigate(`/report/${resume.id}`)}
      />

      <CandidateCompareModal
        open={isCompareOpen}
        candidates={selectedCompareResumes}
        onClose={() => setIsCompareOpen(false)}
        onReport={(resume) => navigate(`/report/${resume.id}`)}
        onWorkflow={updateWorkflow}
      />
    </div>
  )
}

function CandidateDetailModal({
  resume,
  open,
  noteDraft,
  setNoteDraft,
  saveState,
  feedbackState,
  feedbackSelections,
  detailFeedbackOpen,
  detailFeedbackDrafts,
  savedDetailFeedbacks,
  setDetailFeedbackOpen,
  setDetailFeedbackDrafts,
  onClose,
  onWorkflow,
  onFeedback,
  onReport,
}) {
  const [jdOpen, setJdOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined

    const originalBodyOverflow = document.body.style.overflow
    const originalHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalBodyOverflow
      document.documentElement.style.overflow = originalHtmlOverflow
    }
  }, [open])

  useEffect(() => {
    setJdOpen(false)
  }, [resume?.id, open])

  const activeJdCriteria = getJdCriteria(resume || {})
  const activeRequirementCount = resume ? countRequirementStatus(resume) : { met: 0, total: 0 }
  const communicationTemplates = resume ? getCommunicationTemplates(resume) : {}
  const feedback = resume ? (feedbackSelections[resume.id] || {}) : {}
  const isDetailFeedbackOpen = resume ? Boolean(detailFeedbackOpen[resume.id]) : false
  const detailFeedback = resume ? (detailFeedbackDrafts[resume.id] || '') : ''
  const savedDetailFeedback = resume ? (savedDetailFeedbacks[resume.id] || '') : ''
  const detailFeedbackDirty = detailFeedback.trim() !== savedDetailFeedback.trim()
  const archived = resume?.workflowStatus === 'archived'
  const toggleChoiceFeedback = ({ group, label, value }) => {
    const currentValue = group === 'recommendation' ? feedback.recommendation : feedback.business
    const nextValue = currentValue === value ? '' : value
    onFeedback(resume, {
      group,
      label: currentValue === value ? `取消${label}` : label,
      value: nextValue,
    })
  }

  const modal = (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-3 transition md:p-6 ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <button
        type="button"
        aria-label="关闭候选人详情"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/25 backdrop-blur-[3px] transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      <section
        onWheel={e => e.stopPropagation()}
        onTouchMove={e => e.stopPropagation()}
        className={`candidate-detail-modal relative flex h-[min(88vh,calc(100vh-24px))] w-full max-w-[860px] flex-col overflow-hidden overscroll-contain rounded-[2rem] border border-white/75 bg-white/95 shadow-2xl transition-all duration-300 md:h-[88vh] ${open ? 'visible translate-y-0 scale-100 opacity-100' : 'invisible translate-y-3 scale-[0.97] opacity-0'}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/70 bg-white/80 px-4 py-4 backdrop-blur md:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-cyan-700">候选人决策浮层</p>
            <h3 className="mt-1 flex items-center gap-2 text-xl font-black text-slate-950">
              <StickyNote className="h-5 w-5 text-indigo-500" />
              {resume?.candidateName || (resume ? `简历 #${resume.id}` : '候选人详情')}
            </h3>
            {resume && <p className="mt-1 text-xs text-slate-500">所属JD：{getJobName(resume)} · {resume.jobDescription ? '按JD任务评估' : (resume.profileName || '通用标准兜底')}</p>}
          </div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900" aria-label="收起详情">
            <X className="h-4 w-4" />
          </button>
        </div>

        {resume ? (
          <>
          <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 md:p-6">
            <div className="rounded-[1.75rem] border border-slate-900/10 bg-slate-950 p-4 text-white shadow-xl shadow-slate-900/10 md:p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-cyan-200">快速决策</p>
                  <p className="mt-2 text-lg font-black leading-7 md:text-xl">{getRecommendationReason(resume) || '建议结合分数、风险证据和面试追问做最终判断。'}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black ${RECOMMENDATION_MAP[getRecommendation(resume)]?.soft || 'border-white/20 bg-white/10 text-white'}`}>{getRecommendation(resume)}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <MiniStat label="JD匹配分" value={<ScoreWithGrade score={getMatchScore(resume)} grade={getMatchGrade(resume)} />} />
                <MiniStat label="综合评分" value={<ScoreWithGrade score={getOverallScore(resume)} grade={getOverallGrade(resume)} />} />
                <MiniStat label="硬性匹配" value={activeRequirementCount.total ? `${activeRequirementCount.met}/${activeRequirementCount.total}` : '-'} />
              </div>
              {getCandidateProfileSummary(resume) && (
                <p className="mt-4 rounded-2xl bg-white/10 px-3 py-2 text-sm leading-6 text-slate-100">
                  {getCandidateProfileSummary(resume)}
                </p>
              )}
            </div>

            {resume.jobDescription && (
              <div className="rounded-3xl border border-cyan-100 bg-cyan-50/60 p-4">
                <button
                  type="button"
                  onClick={() => setJdOpen(v => !v)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span>
                    <span className="block text-xs font-black uppercase tracking-wide text-cyan-700">所属 JD 任务</span>
                    <span className="mt-1 block font-bold text-slate-900">{getJobName(resume)}</span>
                    <span className="mt-1 block text-xs text-slate-500">{getJobSummary(resume)}</span>
                  </span>
                  {jdOpen ? <ChevronUp className="h-4 w-4 shrink-0 text-cyan-700" /> : <ChevronDown className="h-4 w-4 shrink-0 text-cyan-700" />}
                </button>
                {jdOpen && (
                  <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-2xl bg-white/80 p-3 text-xs leading-6 text-slate-600">
                    {resume.jobDescription}
                  </pre>
                )}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-emerald-100 bg-emerald-50/60 p-4">
                <p className="mb-3 text-xs font-black uppercase tracking-wide text-emerald-700">核心亮点</p>
                {getHighlights(resume).slice(0, 3).length ? getHighlights(resume).slice(0, 3).map((item, i) => <p key={i} className="mb-2 text-sm leading-6 text-slate-700">{i + 1}. {item}</p>) : <p className="text-sm text-slate-400">暂无结构化亮点，打开报告查看完整评估。</p>}
              </div>
              <div className="rounded-3xl border border-amber-100 bg-amber-50/60 p-4">
                <p className="mb-3 text-xs font-black uppercase tracking-wide text-amber-700">短板 / 风险</p>
                {getConcerns(resume).slice(0, 3).length ? getConcerns(resume).slice(0, 3).map((item, i) => <p key={i} className="mb-2 text-sm leading-6 text-slate-700">{i + 1}. {item}</p>) : <p className="text-sm text-slate-400">暂无结构化短板，打开报告查看完整评估。</p>}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <div className="rounded-3xl border border-slate-200 bg-white/70 p-4">
                <label className="mb-1 block text-sm font-semibold text-slate-700">处理状态</label>
                <select value={resume.workflowStatus || 'new'} onChange={e => onWorkflow(resume, e.target.value, noteDraft)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500">
                  {Object.entries(WORKFLOW_MAP).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
                </select>
                <SaveHint state={saveState.id === resume.id ? saveState.status : ''} />
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white/70 p-4">
                <label className="mb-1 block text-sm font-semibold text-slate-700">HR备注</label>
                <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} onBlur={() => onWorkflow(resume, resume.workflowStatus || 'new', noteDraft)} rows={3} placeholder="如：业务方觉得项目不错；薪资偏高但可聊" className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500" />
              </div>
            </div>

            {(activeJdCriteria.must_have_requirements?.length || activeJdCriteria.core_responsibilities?.length) && (
              <div className="rounded-3xl bg-white/55 p-4 ring-1 ring-white/70">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-cyan-700">本次岗位筛选尺子</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {activeJdCriteria.must_have_requirements?.slice(0, 4).map((item, i) => <p key={`must-${i}`} className="text-sm text-slate-700">• {item}</p>)}
                  {activeJdCriteria.core_responsibilities?.slice(0, 2).map((item, i) => <p key={`core-${i}`} className="text-sm text-slate-500">职责：{item}</p>)}
                </div>
              </div>
            )}

            {(getRecommendationReason(resume) || getRequirementMatches(resume).length || getKeyGaps(resume).length) && (
              <div className="rounded-3xl bg-slate-950 p-4 text-white shadow-sm">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-cyan-200">得分解释</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {getRequirementMatches(resume).slice(0, 4).map((item, i) => (
                    <div key={i} className="rounded-xl bg-white/10 p-3 text-xs">
                      <p className="font-semibold text-white">招聘需求：{item.requirement}</p>
                      <p className="mt-1 text-slate-300">{item.status === 'met' ? '已满足' : item.status === 'partial' ? '部分满足' : item.status === 'missing' ? '缺失' : '待确认'}{item.gap ? `：${item.gap}` : ''}</p>
                    </div>
                  ))}
                </div>
                {getKeyGaps(resume).slice(0, 3).map((item, i) => <p key={`gap-${i}`} className="mt-2 text-xs text-amber-200">缺口：{item}</p>)}
              </div>
            )}

            <div className="rounded-3xl border border-slate-200 bg-white/70 p-4">
              <p className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-700"><ThumbsUp className="h-4 w-4" /> HR反馈闭环</p>
              <p className="mb-2 text-xs font-semibold text-slate-500">AI推荐是否准确</p>
              <div className="grid grid-cols-2 gap-2">
                <FeedbackButton active={feedback.recommendation === 'accurate'} label="推荐准确" onClick={() => toggleChoiceFeedback({ group: 'recommendation', label: '推荐准确', value: 'accurate' })} />
                <FeedbackButton active={feedback.recommendation === 'inaccurate'} label="推荐不准" onClick={() => toggleChoiceFeedback({ group: 'recommendation', label: '推荐不准', value: 'inaccurate' })} />
              </div>
              <p className="mb-2 mt-3 text-xs font-semibold text-slate-500">业务面试结果</p>
              <div className="grid grid-cols-2 gap-2">
                <FeedbackButton active={feedback.business === 'passed'} label="业务通过" onClick={() => toggleChoiceFeedback({ group: 'business', label: '业务通过', value: 'passed' })} />
                <FeedbackButton active={feedback.business === 'rejected'} label="业务拒绝" onClick={() => toggleChoiceFeedback({ group: 'business', label: '业务拒绝', value: 'rejected' })} />
              </div>
              <button
                type="button"
                onClick={() => setDetailFeedbackOpen(prev => ({ ...prev, [resume.id]: !prev[resume.id] }))}
                className="mt-3 text-xs font-bold text-cyan-700 hover:text-cyan-900"
              >
                {isDetailFeedbackOpen ? '收起详细反馈' : '填写详细反馈'}
              </button>
              {isDetailFeedbackOpen && (
                <div className="mt-3 rounded-2xl border border-cyan-100 bg-cyan-50/50 p-3">
                  <textarea
                    value={detailFeedback}
                    onChange={e => setDetailFeedbackDrafts(prev => ({ ...prev, [resume.id]: e.target.value }))}
                    rows={4}
                    placeholder="可以写：哪里判断准确、哪里不准、业务方为什么通过/拒绝..."
                    className="w-full resize-none rounded-xl border border-cyan-100 bg-white/80 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                  />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">
                      {detailFeedbackDirty ? '详细反馈有未保存修改' : savedDetailFeedback ? '详细反馈已保存' : ' '}
                    </p>
                    {detailFeedbackDirty && (
                      <button
                        type="button"
                        onClick={() => onFeedback(resume, { group: 'detail', label: '详细反馈', value: 'detail', detail: detailFeedback })}
                        disabled={!detailFeedback.trim() || feedbackState.status === 'saving'}
                        className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                      >
                        <Save className="h-3.5 w-3.5" /> 保存详细反馈
                      </button>
                    )}
                  </div>
                </div>
              )}
              {feedbackState.id === resume.id && feedbackState.status === 'saving' && <p className="mt-2 text-xs text-slate-400">反馈保存中...</p>}
              {feedbackState.id === resume.id && feedbackState.status === 'saved' && <p className="mt-2 text-xs text-emerald-600">反馈已保存</p>}
              {feedbackState.id === resume.id && feedbackState.status === 'error' && <p className="mt-2 text-xs text-red-600">反馈保存失败</p>}
            </div>

            {getInterviewQuestions(resume).length > 0 && (
              <div className="rounded-3xl border border-indigo-100 bg-indigo-50/50 p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-indigo-700">建议追问</p>
                {getInterviewQuestions(resume).slice(0, 3).map((item, i) => <p key={i} className="mb-1 text-sm text-slate-600">{i + 1}. {item}</p>)}
              </div>
            )}

            {(communicationTemplates.interview_invite || communicationTemplates.request_more_info || communicationTemplates.rejection) && (
              <div className="rounded-3xl border border-cyan-100 bg-cyan-50/60 p-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-cyan-700">候选人沟通话术</p>
                <TemplateCopy label="约面邀请" text={communicationTemplates.interview_invite} />
                <TemplateCopy label="补充材料" text={communicationTemplates.request_more_info} />
                <TemplateCopy label="婉拒模板" text={communicationTemplates.rejection} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-white/70 bg-white/85 p-4 backdrop-blur md:px-6">
            {resume.status === 'completed' ? <button onClick={() => onReport(resume)} className="btn-primary px-3 py-2.5 text-sm font-semibold"><Eye className="mr-1 inline h-4 w-4" />查看完整报告</button> : <button disabled className="btn-ghost px-3 py-2.5 text-sm font-semibold opacity-50"><Eye className="mr-1 inline h-4 w-4" />等待报告</button>}
            <ArchiveButton archived={archived} onClick={() => onWorkflow(resume, archived ? 'new' : 'archived', noteDraft)} />
          </div>
          </>
        ) : null}
      </section>
    </div>
  )

  return createPortal(modal, document.body)
}

function FeedbackButton({ active, label, onClick }) {
  return (
    <button
      type="button"
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

function ArchiveButton({ archived, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={archived ? '再次点击可自动出库' : '加入人才储备库'}
      className={`px-3 py-2 text-sm font-semibold ${
        archived
          ? 'rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-lg shadow-emerald-500/10 hover:bg-emerald-100'
          : 'btn-ghost'
      }`}
    >
      <Archive className="mr-1 inline h-4 w-4" />
      {archived ? '简历已入库～' : '入库'}
    </button>
  )
}

function CandidateCompareModal({ open, candidates, onClose, onReport, onWorkflow }) {
  return (
    <div className={`fixed inset-0 z-[60] transition ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <button
        type="button"
        aria-label="关闭候选人对比"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/35 backdrop-blur-[3px] transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      <section className={`absolute inset-x-3 bottom-3 top-3 overflow-hidden rounded-[2rem] border border-white/70 bg-white/95 shadow-2xl transition-all duration-300 md:inset-x-8 md:bottom-6 md:top-6 ${open ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-6 opacity-0'}`}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-black text-slate-950"><Users className="h-5 w-5 text-indigo-500" /> 候选人同步对比</h3>
            <p className="mt-1 text-xs text-slate-500">支持 2-3 位候选人并排对比，便于 HR 和业务方快速做取舍。</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900" aria-label="关闭对比">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="h-[calc(100%-73px)] overflow-auto p-4 md:p-5">
          {candidates.length >= 2 ? (
            <div className={`grid gap-4 ${candidates.length === 2 ? 'xl:grid-cols-2' : 'xl:grid-cols-3'} md:grid-cols-2`}>
              {candidates.map(candidate => <CompareCandidateColumn key={candidate.id} candidate={candidate} onReport={onReport} onWorkflow={onWorkflow} />)}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
              <Users className="mb-3 h-10 w-10" />
              <p className="font-semibold text-slate-600">请先勾选 2-3 位候选人</p>
              <p className="mt-1 text-sm">在候选人决策看板左侧勾选后，再点击“对比”。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function CompareCandidateColumn({ candidate, onReport, onWorkflow }) {
  const recommendation = RECOMMENDATION_MAP[getRecommendation(candidate)] || RECOMMENDATION_MAP['待定']
  const requirementCount = countRequirementStatus(candidate)
  const gaps = getKeyGaps(candidate)
  const questions = getInterviewQuestions(candidate)
  const archived = candidate.workflowStatus === 'archived'

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-black text-slate-950">{candidate.candidateName || `简历 #${candidate.id}`}</p>
          <p className="mt-1 text-xs text-slate-500">所属JD：{getJobName(candidate)}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-bold ${recommendation.soft}`}>{getRecommendation(candidate)}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniStat label="JD匹配" value={<ScoreWithGrade score={getMatchScore(candidate)} grade={getMatchGrade(candidate)} />} />
        <MiniStat label="综合评分" value={<ScoreWithGrade score={getOverallScore(candidate)} grade={getOverallGrade(candidate)} />} />
        <MiniStat label="硬性匹配" value={requirementCount.total ? `${requirementCount.met}/${requirementCount.total}` : '-'} />
      </div>

      {getCandidateProfileSummary(candidate) && (
        <p className="mt-4 rounded-2xl bg-cyan-50 px-3 py-2 text-sm leading-6 text-slate-700">{getCandidateProfileSummary(candidate)}</p>
      )}

      {getRecommendationReason(candidate) && (
        <div className="mt-4 rounded-2xl bg-slate-950 p-3 text-sm leading-6 text-white">
          {getRecommendationReason(candidate)}
        </div>
      )}

      <CompareSection title="核心亮点" tone="emerald" items={getHighlights(candidate).slice(0, 4)} empty="暂无结构化亮点" />
      <CompareSection title="主要短板" tone="amber" items={getConcerns(candidate).slice(0, 4)} empty="暂无结构化短板" />
      <CompareSection title="关键缺口" tone="red" items={gaps.slice(0, 4)} empty="暂无关键缺口" />
      <CompareSection title="建议追问" tone="indigo" items={questions.slice(0, 3)} empty="暂无建议追问" numbered />

      {candidate.status === 'completed' && (
        <button onClick={() => onReport(candidate)} className="btn-primary mt-4 w-full px-3 py-2 text-sm font-semibold">
          <Eye className="mr-1 inline h-4 w-4" /> 查看完整报告
        </button>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={() => onWorkflow(candidate, 'shortlisted', candidate.hrNote || '')} className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100">推进面试</button>
        <button onClick={() => onWorkflow(candidate, 'needs_review', candidate.hrNote || '')} className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-100">待复核</button>
        <button onClick={() => onWorkflow(candidate, 'rejected', candidate.hrNote || '')} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100">淘汰</button>
        <button
          onClick={() => onWorkflow(candidate, archived ? 'new' : 'archived', candidate.hrNote || '')}
          title={archived ? '再次点击可自动出库' : '加入人才储备库'}
          className={`rounded-xl px-3 py-2 text-xs font-bold transition ${archived ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
        >
          {archived ? '简历已入库～' : '入库'}
        </button>
      </div>
    </article>
  )
}

function TemplateCopy({ label, text }) {
  if (!text) return null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch (_) {}
  }
  return (
    <div className="mb-2 rounded-xl bg-white/75 p-2 text-sm text-slate-700">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-slate-500">{label}</span>
        <button type="button" onClick={copy} className="text-xs font-bold text-cyan-700 hover:text-cyan-900">复制</button>
      </div>
      <p className="line-clamp-3 leading-6">{text}</p>
    </div>
  )
}

function CompareSection({ title, items, empty, tone, numbered = false }) {
  const toneMap = {
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
    indigo: 'text-indigo-700',
  }
  return (
    <div className="mt-4">
      <p className={`mb-2 text-xs font-black uppercase tracking-wide ${toneMap[tone] || 'text-slate-700'}`}>{title}</p>
      {items.length ? items.map((item, i) => (
        <p key={i} className="mb-1 text-sm leading-6 text-slate-600">{numbered ? `${i + 1}. ` : '• '}{item}</p>
      )) : <p className="text-sm text-slate-400">{empty}</p>}
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

function JobTaskSwitcher({ groups, activeJobKey, onChange }) {
  const totals = groups.reduce((acc, group) => ({
    total: acc.total + group.total,
    recommended: acc.recommended + group.recommended,
    needsReview: acc.needsReview + group.needsReview,
    scoreSum: acc.scoreSum + (group.avgMatch || 0) * group.total,
  }), { total: 0, recommended: 0, needsReview: 0, scoreSum: 0 })
  const allAvg = totals.total ? Math.round(totals.scoreSum / totals.total) : 0

  return (
    <section className="glass-card mb-5 p-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-black text-slate-900"><Files className="h-4 w-4 text-cyan-600" /> JD任务</h3>
          <p className="mt-1 text-xs text-slate-500">按岗位/JD切换候选池，避免多个岗位的简历混在一起。</p>
        </div>
        <p className="text-xs text-slate-400">默认进入最近一次上传的 JD 任务</p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => onChange('')}
          className={`min-w-[170px] rounded-2xl border px-4 py-3 text-left transition ${activeJobKey === '' ? 'border-cyan-300 bg-cyan-50 shadow-lg shadow-cyan-500/10' : 'border-white/70 bg-white/65 hover:border-cyan-200'}`}
        >
          <p className="font-black text-slate-900">全部JD</p>
          <p className="mt-1 text-xs text-slate-500">{totals.total} 人 · 推荐 {totals.recommended} · 复核 {totals.needsReview}</p>
          <p className="mt-2 text-xs font-bold text-cyan-700">平均匹配分 {allAvg || '-'}</p>
        </button>
        {groups.map(group => (
          <button
            key={group.key}
            type="button"
            onClick={() => onChange(group.key)}
            title={group.summary}
            className={`min-w-[230px] rounded-2xl border px-4 py-3 text-left transition ${activeJobKey === group.key ? 'border-indigo-300 bg-indigo-50 shadow-lg shadow-indigo-500/10' : 'border-white/70 bg-white/65 hover:border-indigo-200'}`}
          >
            <p className="line-clamp-1 font-black text-slate-900">{group.name}</p>
            <p className="mt-1 line-clamp-1 text-xs text-slate-500">{group.summary}</p>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px] font-bold text-slate-500">
              <span><b className="block text-sm text-slate-900">{group.total}</b>候选</span>
              <span><b className="block text-sm text-emerald-600">{group.recommended}</b>推荐</span>
              <span><b className="block text-sm text-amber-600">{group.needsReview}</b>复核</span>
              <span><b className="block text-sm text-cyan-700">{group.avgMatch || '-'}</b>均分</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

function JobBadge({ resume }) {
  return (
    <span
      title={resume.jobDescription || getJobSummary(resume)}
      className="mt-1 inline-flex max-w-full items-center rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-bold text-cyan-700"
    >
      <span className="truncate">JD：{getJobName(resume)}</span>
    </span>
  )
}

function MiniStat({ label, value }) {
  return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-bold text-slate-900">{value}</p></div>
}

function ScoreWithGrade({ score, grade }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{score ?? '-'}</span>
      {grade && <GradeBadge grade={grade} />}
    </span>
  )
}

function SaveHint({ state }) {
  if (!state) return null
  if (state === 'saving') return <p className="mt-1 text-xs text-slate-400">正在保存...</p>
  if (state === 'saved') return <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3 w-3" /> 已保存</p>
  return <p className="mt-1 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3 w-3" /> 保存失败</p>
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-slate-600">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-xl border border-cyan-100 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500">
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </div>
  )
}

function FilterText({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-slate-600">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-cyan-100 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500" />
    </div>
  )
}

function CandidateRow({ resume, rankingMode, active, selected, filterReasons = [], onSelect, onOpen, onWorkflow }) {
  const status = STATUS_MAP[resume.status] || STATUS_MAP.pending
  const StatusIcon = status.icon
  const recommendation = RECOMMENDATION_MAP[getRecommendation(resume)] || RECOMMENDATION_MAP['待定']
  const workflow = WORKFLOW_MAP[resume.workflowStatus || 'new'] || WORKFLOW_MAP.new
  const highlights = getHighlights(resume).slice(0, 1)
  const concerns = getConcerns(resume).slice(0, 1)
  const activeScore = getRankingScore(resume, rankingMode)
  const activeGrade = getRankingGrade(resume, rankingMode)
  const secondaryLabel = rankingMode === 'overall' ? 'JD' : '综合'
  const secondaryScore = rankingMode === 'overall' ? getMatchScore(resume) : getOverallScore(resume)
  const secondaryGrade = rankingMode === 'overall' ? getMatchGrade(resume) : getOverallGrade(resume)

  return (
    <tr onClick={onOpen} className={`cursor-pointer border-b border-slate-100 align-middle transition hover:bg-slate-50 ${active ? 'bg-indigo-50/60 ring-1 ring-inset ring-indigo-100' : ''}`}>
      <td className="px-4 py-4 text-center" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected} onChange={onSelect} /></td>
      <td className="px-4 py-4">
        <p className="font-bold text-slate-900">{resume.candidateName || `简历 #${resume.id}`}</p>
        <JobBadge resume={resume} />
        <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}><StatusIcon className={`h-3 w-3 ${resume.status === 'evaluating' ? 'animate-spin' : ''}`} />{status.label}</span>
      </td>
      <td className="px-4 py-4 text-center">
        <div className="text-2xl font-black tabular-nums text-slate-950">{activeScore ?? '-'}</div>
        {activeGrade && <div className="mt-1"><GradeBadge grade={activeGrade} /></div>}
        <div className="mt-1 text-xs text-slate-400">
          {secondaryLabel} {secondaryScore ?? '-'} {secondaryGrade ? `(${secondaryGrade})` : ''}
        </div>
      </td>
      <td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${recommendation.color}`}>{getRecommendation(resume)}</span></td>
      <td className="px-4 py-4 text-slate-600">
        {highlights.map((item, i) => <p key={`h-${i}`} className="line-clamp-1">+ {item}</p>)}
        {concerns.map((item, i) => <p key={`c-${i}`} className="line-clamp-1 text-amber-700">- {item}</p>)}
        {!highlights.length && !concerns.length && <span className="text-slate-400">打开报告查看完整分析</span>}
        {filterReasons.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{filterReasons.map(reason => <span key={reason} className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-700">{reason}</span>)}</div>}
      </td>
      <td className="px-4 py-4 text-center" onClick={e => e.stopPropagation()}>
        <select value={resume.workflowStatus || 'new'} onChange={e => onWorkflow(resume, e.target.value)} className={`rounded-lg border-0 px-2 py-1 text-xs font-semibold ${workflow.color}`}>
          {Object.entries(WORKFLOW_MAP).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
        </select>
      </td>
    </tr>
  )
}

function CandidateCard({ resume, rankingMode, active, selected, filterReasons = [], onSelect, onOpen }) {
  const recommendation = RECOMMENDATION_MAP[getRecommendation(resume)] || RECOMMENDATION_MAP['待定']
  const activeScore = getRankingScore(resume, rankingMode)
  const activeGrade = getRankingGrade(resume, rankingMode)
  const secondaryLabel = rankingMode === 'overall' ? 'JD匹配' : '综合'
  const secondaryScore = rankingMode === 'overall' ? getMatchScore(resume) : getOverallScore(resume)
  return (
    <div onClick={onOpen} className={`rounded-2xl border bg-white p-4 shadow-sm ${active ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <input type="checkbox" checked={selected} onChange={onSelect} onClick={e => e.stopPropagation()} />
          <div>
            <p className="font-bold text-slate-900">{resume.candidateName || `简历 #${resume.id}`}</p>
            <p className="text-xs text-slate-500">当前排序分 {activeScore ?? '-'}，{secondaryLabel} {secondaryScore ?? '-'}</p>
            <JobBadge resume={resume} />
          </div>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-bold ${recommendation.color}`}>{getRecommendation(resume)}</span>
      </div>
      <div className="mt-3 flex items-center gap-2">{activeGrade && <GradeBadge grade={activeGrade} />}</div>
      {filterReasons.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{filterReasons.map(reason => <span key={reason} className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-700">{reason}</span>)}</div>}
    </div>
  )
}
