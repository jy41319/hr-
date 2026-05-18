import { NavLink, Outlet } from 'react-router-dom'
import { useState, useEffect } from 'react'
import api from '../config/api'
import {
  MessageSquare, FileSearch, Files, ShieldAlert, Settings,
  BrainCircuit, Cpu, LogOut, UserCircle
} from 'lucide-react'

const navItems = [
  { path: '/', label: 'AI问答', icon: MessageSquare },
  { path: '/review', label: '单份审查', icon: FileSearch },
  { path: '/batch', label: '批量审查', icon: Files },
  { path: '/profiles', label: '岗位模板', icon: BrainCircuit },
  { path: '/models', label: '模型管理', icon: Cpu },
  { path: '/settings', label: '系统设置', icon: Settings },
]

export default function Layout() {
  const [user, setUser] = useState(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    api.get('/current-user').then(res => setUser(res.data)).catch(() => {})
  }, [])

  const handleLogout = async () => {
    await api.post('/logout')
    window.location.href = '/login'
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-16' : 'w-56'} bg-slate-900 text-white flex flex-col transition-all duration-200`}>
        <div className="flex items-center gap-2 p-4 border-b border-slate-700">
          <ShieldAlert className="w-6 h-6 text-cyan-400" />
          {!collapsed && <span className="text-lg font-bold">审稿机器人</span>}
        </div>

        <nav className="flex-1 py-2">
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg transition-colors ${
                  isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <button onClick={() => setCollapsed(!collapsed)} className="text-slate-400 hover:text-white text-sm">
            {collapsed ? '→ 展开' : '← 收起'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-6">
          <span className="text-sm text-slate-500">HR提效 · 智能文档审查</span>
          <div className="flex items-center gap-4">
            {user && (
              <div className="flex items-center gap-2">
                <UserCircle className="w-5 h-5 text-slate-400" />
                <span className="text-sm text-slate-600">{user.realName || user.username}</span>
                <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 ml-2">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  )
}