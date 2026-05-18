import { useState, useEffect } from 'react'
import api from '../config/api'
import {
  Loader2, Cpu, Plus, Trash2, Power, PowerOff, EyeOff,
  Key, Globe, Save, BrainCircuit, Pencil, Copy, Check
} from 'lucide-react'

function ModelForm({ mode, initialData, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: '',
    provider: '',
    modelName: '',
    apiBase: '',
    apiKey: '',
    enableThinking: false,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!initialData) return
    setForm({
      name: initialData.name || '',
      provider: initialData.provider || '',
      modelName: initialData.modelName || '',
      apiBase: initialData.apiBase || '',
      apiKey: '',
      enableThinking: !!initialData.enableThinking,
    })
  }, [initialData])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.modelName.trim()) return
    setSaving(true)
    try {
      await onSave(form)
    } finally {
      setSaving(false)
    }
  }

  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }))
  const title = mode === 'edit' ? '编辑模型' : '添加模型'
  const keyHint = mode === 'edit' ? '留空则保持原 Key 不变' : 'sk-...'

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <h3 className="font-bold text-slate-800 mb-4">{title}</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">模型名称</label>
          <input
            value={form.name}
            onChange={e => update('name', e.target.value)}
            placeholder="如：DeepSeek V4 Pro (Bailian)"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">供应商</label>
          <input
            value={form.provider}
            onChange={e => update('provider', e.target.value)}
            placeholder="如：dashscope"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">模型标识</label>
          <input
            value={form.modelName}
            onChange={e => update('modelName', e.target.value)}
            placeholder="如：deepseek-v4-pro"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">API地址</label>
          <input
            value={form.apiBase}
            onChange={e => update('apiBase', e.target.value)}
            placeholder="如：https://dashscope.aliyuncs.com/compatible-mode/v1"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
          <input
            type="password"
            value={form.apiKey}
            onChange={e => update('apiKey', e.target.value)}
            placeholder={keyHint}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.enableThinking}
              onChange={e => update('enableThinking', e.target.checked)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
            />
            <span className="text-sm font-medium text-slate-700">启用思考模式</span>
          </label>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !form.name.trim() || !form.modelName.trim()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 font-medium"
        >
          取消
        </button>
      </div>
    </form>
  )
}

export default function ModelManagementPage() {
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingModel, setEditingModel] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  useEffect(() => {
    loadModels()
  }, [])

  const loadModels = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/llm-models')
      const list = Array.isArray(res.data?.items) ? res.data.items : (Array.isArray(res.data) ? res.data : [])
      setModels(list)
    } catch (err) {
      setError('加载模型列表失败')
    } finally {
      setLoading(false)
    }
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingModel(null)
  }

  const handleAdd = async (data) => {
    try {
      await api.post('/llm-models', data)
      setSuccess('模型添加成功')
      closeForm()
      await loadModels()
    } catch (err) {
      setError(err.response?.data?.error || '添加模型失败')
    }
  }

  const handleEdit = async (data) => {
    if (!editingModel) return
    try {
      await api.put(`/llm-models/${editingModel.id}`, data)
      setSuccess('模型更新成功')
      closeForm()
      await loadModels()
    } catch (err) {
      setError(err.response?.data?.error || '更新模型失败')
    }
  }

  const handleActivate = async (id) => {
    try {
      await api.post(`/llm-models/${id}/activate`)
      setSuccess('模型已激活')
      await loadModels()
    } catch (err) {
      setError(err.response?.data?.error || '激活模型失败')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('确定删除此模型？')) return
    try {
      await api.delete(`/llm-models/${id}`)
      setSuccess('模型已删除')
      await loadModels()
    } catch (err) {
      setError(err.response?.data?.error || '删除模型失败')
    }
  }

  const handleCopyConfig = async (m) => {
    const text = [
      `name=${m.name || ''}`,
      `provider=${m.provider || ''}`,
      `modelName=${m.modelName || ''}`,
      `apiBase=${m.apiBase || ''}`,
      `enableThinking=${m.enableThinking ? 'true' : 'false'}`,
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(m.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch (_) {
      setError('复制失败，请检查浏览器权限')
    }
  }

  const maskKey = (key) => {
    if (!key) return '-'
    if (key.length <= 8) return '****'
    return key.slice(0, 4) + '****' + key.slice(-4)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin mr-3" /> 加载模型...
      </div>
    )
  }

  const totalUsage = models.reduce((sum, m) => sum + (m.totalInputTokens || 0) + (m.totalOutputTokens || 0), 0)

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-800">LLM模型管理</h2>
        <button
          onClick={() => {
            setSuccess('')
            setError('')
            setEditingModel(null)
            setShowForm(true)
          }}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> 添加模型
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg mb-4 text-sm">{success}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-indigo-500" />
            <span className="text-sm text-slate-600">总Token用量</span>
          </div>
          <span className="text-lg font-bold text-indigo-600">{totalUsage.toLocaleString()}</span>
        </div>
      </div>

      {showForm && (
        <ModelForm
          mode={editingModel ? 'edit' : 'create'}
          initialData={editingModel}
          onSave={editingModel ? handleEdit : handleAdd}
          onCancel={closeForm}
        />
      )}

      <div className="space-y-4">
        {models.map(m => (
          <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  m.isActive ? 'bg-emerald-50' : 'bg-slate-50'
                }`}>
                  <Cpu className={`w-5 h-5 ${m.isActive ? 'text-emerald-500' : 'text-slate-400'}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800">{m.name}</span>
                    {m.isActive && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <Power className="w-3 h-3 mr-1" /> 已激活
                      </span>
                    )}
                    {m.enableThinking && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">
                        思考模式
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{m.provider || '-'} / {m.modelName || '-'}</p>
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    setSuccess('')
                    setError('')
                    setEditingModel(m)
                    setShowForm(true)
                  }}
                  className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-600"
                  title="编辑"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                {!m.isActive && (
                  <button
                    onClick={() => handleActivate(m.id)}
                    className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600"
                    title="激活"
                  >
                    <Power className="w-4 h-4" />
                  </button>
                )}
                {m.isActive && (
                  <button className="p-1.5 rounded-lg text-slate-300" title="已激活">
                    <PowerOff className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => handleDelete(m.id)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-red-600"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-1 text-slate-600">
                <Globe className="w-3 h-3" />
                <span>{m.apiBase || '-'}</span>
              </div>
              <div className="flex items-center gap-1 text-slate-600">
                <Key className="w-3 h-3" />
                <span>{maskKey(m.apiKey)}</span>
                <EyeOff className="w-3 h-3 text-slate-400" />
              </div>
              <div className="text-slate-600">
                输入Token: <span className="font-medium text-indigo-600">{(m.totalInputTokens || 0).toLocaleString()}</span>
              </div>
              <div className="text-slate-600">
                输出Token: <span className="font-medium text-indigo-600">{(m.totalOutputTokens || 0).toLocaleString()}</span>
              </div>
            </div>
            <div className="mt-3">
              <button
                onClick={() => handleCopyConfig(m)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1"
              >
                {copiedId === m.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedId === m.id ? '已复制' : '复制配置（不含Key）'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
