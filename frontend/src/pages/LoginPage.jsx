import { useState } from 'react'
import api from '../config/api'
import { Send, ShieldAlert, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.post('/login', { username, password })
      window.location.href = '/'
    } catch (err) {
      setError(err.response?.data?.error || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-cyan-500 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-6">
          <ShieldAlert className="w-10 h-10 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">CVizr</h1>
            <p className="text-sm text-slate-500">CV 可视化初筛 · JD 驱动决策</p>
          </div>
        </div>

        <p className="text-slate-600 mb-6">
          为 HR 把 CV、岗位 JD 与风险证据清晰可视化：批量排序候选人、解释匹配依据，
          从2小时的繁琐审阅压缩到5分钟，让招聘效率起飞！
        </p>

        {error && <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <input
              type="text"
              placeholder="用户名"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
            />
          </div>
          <div className="mb-6">
            <input
              type="password"
              placeholder="密码"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            登录
          </button>
        </form>

        <p className="text-xs text-slate-400 mt-4 text-center">默认账号: admin / admin123</p>
      </div>
    </div>
  )
}
