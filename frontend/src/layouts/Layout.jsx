import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import api from '../config/api'
import {
  MessageSquare, FileSearch, Files, ShieldAlert, Settings,
  BrainCircuit, Cpu, LogOut, UserCircle, Sparkles, Database, Info, X, ArrowLeft
} from 'lucide-react'

const navItems = [
  { path: '/', label: 'AI问答', icon: MessageSquare },
  { path: '/review', label: '简历初筛', icon: FileSearch },
  { path: '/batch', label: '候选人决策', icon: Files },
  { path: '/talent-pool', label: '人才储备库', icon: Database },
  { path: '/profiles', label: '筛选标准', icon: BrainCircuit },
  { path: '/models', label: '模型管理', icon: Cpu },
  { path: '/settings', label: '系统设置', icon: Settings },
]

export default function Layout() {
  const [user, setUser] = useState(null)
  const [collapsed, setCollapsed] = useState(false)
  const [riskTipsOpen, setRiskTipsOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/current-user').then(res => setUser(res.data)).catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', collapsed ? '4rem' : '15rem')
    return () => document.documentElement.style.removeProperty('--sidebar-width')
  }, [collapsed])

  const handleLogout = async () => {
    await api.post('/logout')
    window.location.href = '/login'
  }

  const detailMatch = location.pathname.match(/^\/(report|aigc|risk)\/(\d+)/)
  const backFallback = detailMatch?.[1] === 'report' ? '/batch' : `/report/${detailMatch?.[2] || ''}`
  const handleBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate(backFallback)
  }

  return (
    <div className="app-shell flex h-screen">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-16' : 'w-60'} glass-sidebar text-white flex flex-col transition-all duration-300`}>
        <div className="flex items-center gap-2 p-4 border-b border-white/10">
          <span className="rounded-2xl bg-cyan-400/15 p-2 ring-1 ring-cyan-300/25"><Sparkles className="w-5 h-5 text-cyan-200" /></span>
          {!collapsed && <div><span className="text-lg font-black tracking-tight">CVizr</span><p className="text-xs text-slate-300">AI 初筛工作台</p></div>}
        </div>

        <nav className="flex-1 py-2">
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `nav-glass-link flex items-center gap-3 px-4 py-2.5 mx-2 rounded-2xl transition-all duration-300 ${
                  isActive ? 'is-active text-white' : 'text-slate-300 hover:text-white'
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10">
          <button onClick={() => setCollapsed(!collapsed)} className="btn-sidebar text-sm">
            {collapsed ? '→ 展开' : '← 收起'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="glass-header h-14 flex items-center justify-between px-6">
          <span className="text-sm font-medium text-slate-600">CVizr · JD 驱动候选人决策</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setRiskTipsOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-cyan-100 bg-white/70 px-3 py-1.5 text-xs font-bold text-cyan-700 shadow-sm hover:-translate-y-0.5 hover:bg-cyan-50"
            >
              <Info className="h-3.5 w-3.5" />
              风险度说明
            </button>
            {user && (
              <div className="flex items-center gap-2">
                <UserCircle className="w-5 h-5 text-slate-400" />
                <span className="text-sm text-slate-600">{user.realName || user.username}</span>
                <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 ml-2 transition">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </header>

        <RiskTipsModal open={riskTipsOpen} onClose={() => setRiskTipsOpen(false)} />

        {/* Page content */}
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>

        {detailMatch && (
          <button
            type="button"
            onClick={handleBack}
            className="floating-back-button fixed z-40 inline-flex items-center gap-3 rounded-full border border-white/80 bg-white/90 px-5 py-3 text-base font-black text-slate-950 shadow-xl shadow-slate-900/12 backdrop-blur-xl transition hover:-translate-y-1 hover:bg-white hover:shadow-2xl focus:outline-none focus:ring-2 focus:ring-cyan-300 md:text-lg"
          >
            <ArrowLeft className="h-5 w-5" />
            返回上一页
          </button>
        )}
      </main>
    </div>
  )
}

function RiskTipsModal({ open, onClose }) {
  return (
    <div className={`fixed inset-0 z-[90] transition ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      <button
        type="button"
        aria-label="关闭风险度说明"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/25 backdrop-blur-[2px] transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
      />
      <section className={`absolute right-6 top-16 w-[min(460px,calc(100vw-32px))] rounded-[1.5rem] border border-white/70 bg-white/95 p-5 shadow-2xl transition-all duration-300 ${open ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-wide text-cyan-700">HR 使用说明</p>
            <h3 className="mt-1 text-lg font-black text-slate-950">风险度是怎么分的？</h3>
          </div>
          <button onClick={onClose} className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900" aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 text-sm leading-6 text-slate-600">
          <RiskTipItem tone="emerald" title="低风险" text="简历信息较完整，时间线和学历/证书没有明显矛盾，关键经历有证据支撑。HR 可以正常进入匹配度和综合实力判断。" />
          <RiskTipItem tone="amber" title="中风险" text="存在需要确认的信息，例如部分 JD 硬性条件未体现、项目成果证据不足、薪资/城市/到岗时间需要沟通。" />
          <RiskTipItem tone="red" title="高风险" text="出现明显疑点，例如时间线冲突、学历/证书疑点、严重信息缺失、关键硬性要求缺失且无证据。系统只建议人工复核，不自动淘汰。" />
        </div>

        <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
          <p className="font-bold text-slate-700">判定来源</p>
          <p className="mt-1">优先使用 AI 对风险证据的结构化判断；如果旧数据没有风险等级，系统才按综合评分兜底：低于60为高风险，60-74为中风险，75以上为低风险。</p>
        </div>
      </section>
    </div>
  )
}

function RiskTipItem({ tone, title, text }) {
  const tones = {
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
  }
  return (
    <div className="rounded-2xl border border-slate-100 bg-white/80 p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-black ${tones[tone]}`}>{title}</span>
      </div>
      <p>{text}</p>
    </div>
  )
}
