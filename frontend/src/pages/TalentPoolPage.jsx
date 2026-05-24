import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../config/api'
import {
  Archive, Briefcase, CalendarClock, Database, Eye, Loader2, RefreshCcw,
  Search, ShieldAlert, Star, Target, UserCheck, X
} from 'lucide-react'

const RISK_MAP = {
  low: { label: '低风险', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  medium: { label: '中风险', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  high: { label: '高风险', color: 'bg-red-50 text-red-700 border-red-200' },
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

function getMatchScore(resume) {
  return resume.matchScore ?? resume.evaluationResult?.match_score ?? getOverallScore(resume)
}

function getMatchGrade(resume) {
  return resume.matchGrade || resume.evaluationResult?.match_grade || (getMatchScore(resume) !== null ? gradeFromScore(getMatchScore(resume)) : '')
}

function getOverallGrade(resume) {
  return resume.grade || resume.evaluationResult?.overall_evaluation?.overall_grade || (getOverallScore(resume) !== null ? gradeFromScore(getOverallScore(resume)) : '')
}

function getHighlights(resume) {
  return resume.highlights || resume.evaluationResult?.highlights || []
}

function getConcerns(resume) {
  return resume.concerns || resume.evaluationResult?.concerns || []
}

function getRiskLevel(resume) {
  return resume.riskLevel || resume.evaluationResult?.risk_level || 'medium'
}

function getSearchText(resume) {
  return [
    resume.candidateName,
    resume.profileName,
    resume.jobDescription,
    resume.hrNote,
    getHighlights(resume).join(' '),
    getConcerns(resume).join(' '),
    (resume.keyGaps || []).join(' '),
  ].filter(Boolean).join(' ')
}

function inferEducation(text) {
  if (/博士|PhD|doctor/i.test(text)) return 'phd'
  if (/硕士|研究生|Master/i.test(text)) return 'master'
  if (/本科|学士|Bachelor/i.test(text)) return 'bachelor'
  if (/专科|高职|大专/.test(text)) return 'college'
  return ''
}

function inferSchoolTier(text) {
  if (/清华|北大|复旦|上交|上海交通|浙大|南京大学|中科大|人大|985|C9|双一流A/.test(text)) return 'top'
  if (/211|双一流|重点大学|一流学科/.test(text)) return 'strong'
  if (/本科|大学|学院/.test(text)) return 'undergrad'
  if (/专科|高职|大专/.test(text)) return 'college'
  return ''
}

function inferCity(text) {
  const cities = ['北京', '上海', '杭州', '深圳', '广州', '成都', '南京', '苏州', '武汉', '西安']
  return cities.find(city => text.includes(city)) || ''
}

function formatDate(value) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch (_) {
    return '-'
  }
}

function ScorePill({ label, score, grade, tone }) {
  const toneClass = tone === 'cyan' ? 'text-cyan-700 bg-cyan-50' : 'text-indigo-700 bg-indigo-50'
  return (
    <div className={`rounded-2xl px-3 py-2 ${toneClass}`}>
      <p className="text-xs font-bold opacity-80">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-xl font-black">
        {score ?? '-'}
        {grade && <span className={`grade-badge grade-${grade}`}>{grade}</span>}
      </p>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, tone }) {
  const tones = {
    cyan: 'bg-cyan-100 text-cyan-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    indigo: 'bg-indigo-100 text-indigo-700',
  }
  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-500">{label}</p>
        <span className={`rounded-xl p-2 ${tones[tone] || tones.cyan}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-3 text-3xl font-black text-slate-950">{value}</p>
    </div>
  )
}

export default function TalentPoolPage() {
  const [resumes, setResumes] = useState([])
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState(null)
  const [activeJdResume, setActiveJdResume] = useState(null)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({
    keyword: '',
    jdKeyword: '',
    risk: '',
    minScore: '',
    scoreType: 'match',
    education: '',
    schoolTier: '',
    city: '',
  })
  const navigate = useNavigate()

  const loadResumes = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/resumes?perPage=500')
      const list = Array.isArray(res.data?.resumes) ? res.data.resumes : []
      setResumes(list)
    } catch (err) {
      setError(err.response?.data?.error || '加载人才储备库失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadResumes()
  }, [])

  const archived = useMemo(() => resumes.filter(item => item.workflowStatus === 'archived'), [resumes])

  const filtered = useMemo(() => archived.filter(resume => {
    const text = getSearchText(resume)
    const keyword = filters.keyword.trim()
    const jdKeyword = filters.jdKeyword.trim()
    const selectedScore = filters.scoreType === 'overall' ? getOverallScore(resume) : getMatchScore(resume)
    if (keyword && !text.toLowerCase().includes(keyword.toLowerCase())) return false
    if (jdKeyword && !String(resume.jobDescription || resume.profileName || '').toLowerCase().includes(jdKeyword.toLowerCase())) return false
    if (filters.risk && getRiskLevel(resume) !== filters.risk) return false
    if (filters.minScore && Number(selectedScore || 0) < Number(filters.minScore)) return false
    if (filters.education && inferEducation(text) !== filters.education) return false
    if (filters.schoolTier && inferSchoolTier(text) !== filters.schoolTier) return false
    if (filters.city && inferCity(text) !== filters.city) return false
    return true
  }), [archived, filters])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const scoreA = filters.scoreType === 'overall' ? getOverallScore(a) : getMatchScore(a)
    const scoreB = filters.scoreType === 'overall' ? getOverallScore(b) : getMatchScore(b)
    return Number(scoreB || 0) - Number(scoreA || 0)
  }), [filtered, filters.scoreType])

  const highValueCount = archived.filter(item => (getMatchScore(item) || 0) >= 75 || (getOverallScore(item) || 0) >= 80).length
  const needsReconnectCount = archived.filter(item => getRiskLevel(item) !== 'high' && (getOverallScore(item) || 0) >= 70).length
  const recentCount = archived.filter(item => {
    if (!item.uploadTime) return false
    const diff = Date.now() - new Date(item.uploadTime).getTime()
    return diff <= 7 * 24 * 60 * 60 * 1000
  }).length

  const updateWorkflow = async (resume, workflowStatus) => {
    setSavingId(resume.id)
    setError('')
    const previous = resumes
    setResumes(list => list.map(item => item.id === resume.id ? { ...item, workflowStatus } : item))
    try {
      await api.put(`/resumes/${resume.id}/workflow`, {
        workflowStatus,
        hrNote: resume.hrNote || '',
      })
    } catch (err) {
      setResumes(previous)
      setError(err.response?.data?.error || '更新候选人状态失败')
    } finally {
      setSavingId(null)
    }
  }

  const clearFilters = () => setFilters({
    keyword: '',
    jdKeyword: '',
    risk: '',
    minScore: '',
    scoreType: 'match',
    education: '',
    schoolTier: '',
    city: '',
  })

  return (
    <div className="mx-auto max-w-[1500px] motion-panel">
      <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-wide text-cyan-700">候选人长期沉淀</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950 md:text-3xl">人才储备库</h2>
          <p className="mt-2 text-sm text-slate-500">这里沉淀“暂不推进但值得保留”的候选人，方便 HR 后续复联、换岗匹配和长期跟进。</p>
        </div>
        <button onClick={loadResumes} disabled={loading} className="btn-primary px-4 py-2.5 text-sm font-bold disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          刷新储备库
        </button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Database} label="储备人才总数" value={archived.length} tone="cyan" />
        <MetricCard icon={Star} label="高分人才" value={highValueCount} tone="emerald" />
        <MetricCard icon={CalendarClock} label="建议复联" value={needsReconnectCount} tone="amber" />
        <MetricCard icon={Archive} label="近期入库" value={recentCount} tone="indigo" />
      </div>

      <section className="glass-card mb-5 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 text-cyan-600" />
          <h3 className="font-bold text-slate-900">筛选储备人才</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-8">
          <FilterInput label="关键词" value={filters.keyword} onChange={value => setFilters(prev => ({ ...prev, keyword: value }))} placeholder="姓名/亮点/备注" />
          <FilterInput label="岗位/JD" value={filters.jdKeyword} onChange={value => setFilters(prev => ({ ...prev, jdKeyword: value }))} placeholder="产品/运营/AI" />
          <FilterSelect label="排序分数" value={filters.scoreType} onChange={value => setFilters(prev => ({ ...prev, scoreType: value }))} options={[['match', 'JD匹配分'], ['overall', '综合评分']]} />
          <FilterSelect label="最低分" value={filters.minScore} onChange={value => setFilters(prev => ({ ...prev, minScore: value }))} options={[['', '不限'], ['60', '60+'], ['70', '70+'], ['80', '80+'], ['90', '90+']]} />
          <FilterSelect label="风险等级" value={filters.risk} onChange={value => setFilters(prev => ({ ...prev, risk: value }))} options={[['', '不限'], ['low', '低风险'], ['medium', '中风险'], ['high', '高风险']]} />
          <FilterSelect label="学历" value={filters.education} onChange={value => setFilters(prev => ({ ...prev, education: value }))} options={[['', '不限'], ['phd', '博士'], ['master', '硕士'], ['bachelor', '本科'], ['college', '专科']]} />
          <FilterSelect label="院校档次" value={filters.schoolTier} onChange={value => setFilters(prev => ({ ...prev, schoolTier: value }))} options={[['', '不限'], ['top', '985/C9/顶尖'], ['strong', '211/双一流'], ['undergrad', '普通本科'], ['college', '专科/高职']]} />
          <div className="flex flex-col justify-end gap-2">
            <FilterInput label="城市" value={filters.city} onChange={value => setFilters(prev => ({ ...prev, city: value }))} placeholder="如 上海" />
            <button onClick={clearFilters} className="btn-ghost px-3 py-2 text-sm font-bold">清空筛选</button>
          </div>
        </div>
      </section>

      <section className="glass-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div>
            <h3 className="font-bold text-slate-900">储备人才列表</h3>
            <p className="mt-1 text-xs text-slate-500">当前显示 {sorted.length} 人。入库不代表淘汰，而是保留后续机会。</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="mr-2 h-6 w-6 animate-spin" /> 加载中...</div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-18 text-center text-slate-400">
            <Archive className="mb-3 h-12 w-12 text-slate-300" />
            <p className="font-bold text-slate-700">还没有入库人才</p>
            <p className="mt-2 max-w-lg text-sm">你可以在候选人决策页点击“入库”，把值得长期关注的人才沉淀到这里。</p>
            <button onClick={() => navigate('/batch')} className="btn-primary mt-4 px-4 py-2 text-sm font-bold">去候选人决策页</button>
          </div>
        ) : (
          <>
            <div className="hidden overflow-auto xl:block">
              <table className="w-full min-w-[1120px] table-fixed text-sm">
                <colgroup>
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[14%]" />
                  <col />
                  <col className="w-[18%]" />
                </colgroup>
                <thead className="sticky top-0 bg-slate-50/95 backdrop-blur">
                  <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">候选人</th>
                    <th className="px-4 py-3">最近评估岗位/JD</th>
                    <th className="px-4 py-3">双分数</th>
                    <th className="px-4 py-3">长期判断</th>
                    <th className="px-4 py-3 text-center">快捷操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(resume => (
                    <TalentRow key={resume.id} resume={resume} saving={savingId === resume.id} onOpenJd={() => setActiveJdResume(resume)} onWorkflow={updateWorkflow} onReport={() => navigate(`/report/${resume.id}`)} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 p-3 xl:hidden">
              {sorted.map(resume => (
                <TalentCard key={resume.id} resume={resume} saving={savingId === resume.id} onOpenJd={() => setActiveJdResume(resume)} onWorkflow={updateWorkflow} onReport={() => navigate(`/report/${resume.id}`)} />
              ))}
            </div>
          </>
        )}
      </section>

      <JdModal resume={activeJdResume} onClose={() => setActiveJdResume(null)} />
    </div>
  )
}

function FilterInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-slate-600">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-xl border border-cyan-100 bg-white/80 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-bold text-slate-600">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-xl border border-cyan-100 bg-white/80 px-3 py-2 text-sm outline-none focus:border-cyan-500">
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </div>
  )
}

function TalentRow({ resume, saving, onOpenJd, onWorkflow, onReport }) {
  const risk = RISK_MAP[getRiskLevel(resume)] || RISK_MAP.medium
  const highlights = getHighlights(resume).slice(0, 2)
  const concerns = getConcerns(resume).slice(0, 1)
  return (
    <tr className="border-b border-slate-100 align-top transition hover:bg-slate-50/80">
      <td className="px-4 py-4">
        <p className="font-black text-slate-950">{resume.candidateName || `简历 #${resume.id}`}</p>
        <p className="mt-1 text-xs text-slate-500">入库参考时间：{formatDate(resume.evaluationTime || resume.uploadTime)}</p>
        <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${risk.color}`}>{risk.label}</span>
      </td>
      <td className="px-4 py-4">
        <button
          type="button"
          onClick={onOpenJd}
          className="block w-full rounded-2xl bg-white/60 px-3 py-2 text-left text-sm leading-6 text-slate-600 ring-1 ring-white/70 hover:-translate-y-0.5 hover:bg-cyan-50/70 hover:text-cyan-800"
        >
          <span className="line-clamp-3">{resume.jobDescription || resume.profileName || '暂无岗位信息'}</span>
          <span className="mt-1 block text-xs font-bold text-cyan-700">点击查看完整JD</span>
        </button>
      </td>
      <td className="px-4 py-4">
        <div className="grid gap-2">
          <ScorePill label="JD匹配" score={getMatchScore(resume)} grade={getMatchGrade(resume)} tone="cyan" />
          <ScorePill label="综合评分" score={getOverallScore(resume)} grade={getOverallGrade(resume)} tone="indigo" />
        </div>
      </td>
      <td className="px-4 py-4">
        {highlights.length ? highlights.map((item, i) => <p key={i} className="line-clamp-1 text-sm text-slate-700">+ {item}</p>) : <p className="text-sm text-slate-400">暂无结构化亮点</p>}
        {concerns.map((item, i) => <p key={i} className="line-clamp-1 text-sm text-amber-700">- {item}</p>)}
        <p className="mt-2 rounded-xl bg-white/75 px-3 py-2 text-xs leading-5 text-slate-500">{resume.hrNote || '暂无HR备注，可在报告页或候选人决策页补充长期判断。'}</p>
      </td>
      <td className="px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onReport} className="btn-primary px-3 py-2 text-xs font-bold"><Eye className="h-3.5 w-3.5" />报告</button>
          <button disabled={saving} onClick={() => onWorkflow(resume, 'new')} className="btn-ghost px-3 py-2 text-xs font-bold disabled:opacity-50">移出</button>
          <button disabled={saving} onClick={() => onWorkflow(resume, 'shortlisted')} className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"><UserCheck className="h-3.5 w-3.5" />待面试</button>
          <button disabled={saving} onClick={() => onWorkflow(resume, 'needs_review')} className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"><ShieldAlert className="h-3.5 w-3.5" />待复核</button>
        </div>
      </td>
    </tr>
  )
}

function TalentCard({ resume, saving, onOpenJd, onWorkflow, onReport }) {
  const risk = RISK_MAP[getRiskLevel(resume)] || RISK_MAP.medium
  return (
    <article className="rounded-3xl border border-white/70 bg-white/80 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black text-slate-950">{resume.candidateName || `简历 #${resume.id}`}</p>
          <p className="mt-1 text-xs text-slate-500">{formatDate(resume.evaluationTime || resume.uploadTime)} 入库参考</p>
        </div>
        <span className={`rounded-full border px-2 py-1 text-xs font-bold ${risk.color}`}>{risk.label}</span>
      </div>
      <button
        type="button"
        onClick={onOpenJd}
        className="mt-3 block w-full rounded-2xl bg-white/65 px-3 py-2 text-left text-sm text-slate-600 ring-1 ring-white/70 hover:bg-cyan-50/70 hover:text-cyan-800"
      >
        <Briefcase className="mr-1 inline h-4 w-4 text-cyan-500" />
        <span className="line-clamp-2">{resume.jobDescription || resume.profileName || '暂无岗位信息'}</span>
        <span className="mt-1 block text-xs font-bold text-cyan-700">点击查看完整JD</span>
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ScorePill label="JD匹配" score={getMatchScore(resume)} grade={getMatchGrade(resume)} tone="cyan" />
        <ScorePill label="综合评分" score={getOverallScore(resume)} grade={getOverallGrade(resume)} tone="indigo" />
      </div>
      <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">{resume.hrNote || '暂无HR备注，可后续补充长期判断。'}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={onReport} className="btn-primary px-3 py-2 text-xs font-bold"><Eye className="h-3.5 w-3.5" />查看报告</button>
        <button disabled={saving} onClick={() => onWorkflow(resume, 'new')} className="btn-ghost px-3 py-2 text-xs font-bold disabled:opacity-50">移出储备库</button>
        <button disabled={saving} onClick={() => onWorkflow(resume, 'shortlisted')} className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-50">标记待面试</button>
        <button disabled={saving} onClick={() => onWorkflow(resume, 'needs_review')} className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 disabled:opacity-50">转待复核</button>
      </div>
    </article>
  )
}

function JdModal({ resume, onClose }) {
  const open = Boolean(resume)
  const jdText = resume?.jobDescription || resume?.profileName || '暂无岗位信息'
  return (
    <div className={`fixed inset-0 z-[70] transition ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <button
        type="button"
        aria-label="关闭完整JD"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/35 backdrop-blur-[3px] transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      <section className={`absolute left-1/2 top-1/2 w-[min(760px,calc(100vw-32px))] max-h-[82vh] -translate-x-1/2 overflow-hidden rounded-[2rem] border border-white/70 bg-white/95 shadow-2xl transition-all duration-300 ${open ? '-translate-y-1/2 scale-100 opacity-100' : '-translate-y-[45%] scale-95 opacity-0'}`}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-bold tracking-wide text-cyan-700">最近评估岗位 / JD</p>
            <h3 className="mt-1 text-lg font-black text-slate-950">{resume?.candidateName || '候选人'} 的完整JD</h3>
          </div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(82vh-88px)] overflow-auto p-5">
          <p className="whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-7 text-slate-700">{jdText}</p>
        </div>
      </section>
    </div>
  )
}
