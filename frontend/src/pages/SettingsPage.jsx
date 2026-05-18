import { useState, useEffect } from 'react'
import api from '../config/api'
import {
  Loader2, Settings, Save, MessageSquare, ShieldAlert,
  Plus, Trash2, Edit3, XCircle, CheckCircle
} from 'lucide-react'

function SettingEditor({ settings, onSave }) {
  const [items, setItems] = useState(settings)
  const [newKey, setNewKey] = useState('')
  const [newVal, setNewVal] = useState('')
  const [saving, setSaving] = useState(false)

  const updateItem = (index, field, value) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item))
  }

  const addItem = () => {
    if (!newKey.trim()) return
    setItems(prev => [...prev, { key: newKey.trim(), value: newVal }])
    setNewKey('')
    setNewVal('')
  }

  const removeItem = (index) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(items)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="space-y-2 mb-4">
        {items.map((item, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              value={item.key}
              onChange={e => updateItem(i, 'key', e.target.value)}
              className="w-1/3 px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 outline-none text-sm"
            />
            <input
              value={item.value ?? item.val ?? ''}
              onChange={e => updateItem(i, 'value', e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 outline-none text-sm"
            />
            <button
              onClick={() => removeItem(i)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder="配置键"
          className="w-1/3 px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 outline-none text-sm"
        />
        <input
          value={newVal}
          onChange={e => setNewVal(e.target.value)}
          placeholder="配置值"
          className="flex-1 px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 outline-none text-sm"
        />
        <button
          onClick={addItem}
          className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        保存配置
      </button>
    </div>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState([])
  const [feedbacks, setFeedbacks] = useState([])
  const [aigcThreshold, setAigcThreshold] = useState({ high: 0.7, medium: 0.4 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      const [settingsRes, feedbacksRes, thresholdRes] = await Promise.all([
        api.get('/settings'),
        api.get('/feedbacks'),
        api.get('/settings/aigc-threshold'),
      ])
      setSettings(
        Object.entries(settingsRes.data || {}).map(([key, value]) => ({ key, value }))
      )
      setFeedbacks(feedbacksRes.data.items || feedbacksRes.data || [])
      const t = thresholdRes.data
      if (t) setAigcThreshold({ high: t.high ?? 0.7, medium: t.medium ?? 0.4 })
    } catch (err) {
      setError('加载配置失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSettings = async (items) => {
    try {
      const data = {}
      items.forEach(item => { data[item.key] = item.value })
      await api.put('/settings', data)
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || '保存配置失败')
    }
  }

  const handleSaveThreshold = async () => {
    setSaving(true)
    try {
      await api.put('/settings/aigc-threshold', aigcThreshold)
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || '保存阈值失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin mr-3" /> 加载配置...
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-slate-800 mb-6">系统设置</h2>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-5 h-5 text-indigo-500" />
          <h3 className="font-bold text-slate-800">系统配置</h3>
        </div>
        <SettingEditor settings={settings} onSave={handleSaveSettings} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert className="w-5 h-5 text-cyan-600" />
          <h3 className="font-bold text-slate-800">AIGC阈值配置</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">高风险阈值</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={aigcThreshold.high}
              onChange={e => setAigcThreshold(prev => ({ ...prev, high: parseFloat(e.target.value) || 0 }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
            />
            <p className="text-xs text-slate-500 mt-1">高于此值判定为高风险（默认 0.7）</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">中风险阈值</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={aigcThreshold.medium}
              onChange={e => setAigcThreshold(prev => ({ ...prev, medium: parseFloat(e.target.value) || 0 }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
            />
            <p className="text-xs text-slate-500 mt-1">高于此值判定为中风险（默认 0.4）</p>
          </div>
        </div>

        <button
          onClick={handleSaveThreshold}
          disabled={saving}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存阈值
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="w-5 h-5 text-indigo-500" />
          <h3 className="font-bold text-slate-800">反馈列表</h3>
          <span className="text-sm text-slate-500 ml-2">{feedbacks.length} 条反馈</span>
        </div>

        {feedbacks.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p>暂无反馈</p>
          </div>
        ) : (
          <div className="space-y-2">
            {feedbacks.map((f, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-slate-800">{f.username || f.user || '用户'}</span>
                    <span className="text-xs text-slate-500">{f.created_at || f.timestamp || ''}</span>
                    {f.type && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                        {f.type}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600">{f.content || f.message || f.feedback}</p>
                </div>
                <CheckCircle className={`w-4 h-4 mt-1 ${f.resolved ? 'text-emerald-500' : 'text-slate-300'}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}