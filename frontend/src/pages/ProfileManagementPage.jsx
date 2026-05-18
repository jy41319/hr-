import { useState, useEffect } from 'react'
import api from '../config/api'
import {
  Loader2, BrainCircuit, Plus, Edit3, Trash2, Copy, Star,
  CheckCircle, XCircle, Save
} from 'lucide-react'

const DEFAULT_DIMENSIONS = [
  '专业技能', '项目经验', '学历背景', '工作稳定性', '沟通表达',
  '自我评价', '格式规范', '逻辑一致性', '创新思维', '行业认知',
]

function ProfileForm({ profile, onSave, onCancel }) {
  const [name, setName] = useState(profile?.name || '')
  const [positionType, setPositionType] = useState(profile?.position_type || '')
  const [dimensions, setDimensions] = useState(
    profile?.evaluation_criteria?.dimensions || DEFAULT_DIMENSIONS.slice(0, 6)
  )
  const [dimensionInput, setDimensionInput] = useState('')
  const [saving, setSaving] = useState(false)

  const handleAddDimension = () => {
    if (dimensionInput.trim() && !dimensions.includes(dimensionInput.trim())) {
      setDimensions(prev => [...prev, dimensionInput.trim()])
      setDimensionInput('')
    }
  }

  const handleRemoveDimension = (dim) => {
    setDimensions(prev => prev.filter(d => d !== dim))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        position_type: positionType.trim(),
        evaluation_criteria: { dimensions },
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6">
      <h3 className="font-bold text-slate-800 mb-4">{profile ? '编辑模板' : '新建模板'}</h3>

      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">模板名称</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="如：Java开发岗审查模板"
          className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">岗位类型</label>
        <input
          value={positionType}
          onChange={e => setPositionType(e.target.value)}
          placeholder="如：技术岗、管理岗、销售岗"
          className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-700 mb-1">评估维度</label>
        <div className="flex gap-2 mb-2">
          {dimensions.map(d => (
            <span key={d} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-sm">
              {d}
              <button type="button" onClick={() => handleRemoveDimension(d)} className="text-indigo-400 hover:text-red-500">
                <XCircle className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={dimensionInput}
            onChange={e => setDimensionInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddDimension()}
            placeholder="添加评估维度..."
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 outline-none text-sm"
          />
          <button
            type="button"
            onClick={handleAddDimension}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> 添加
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim()}
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

export default function ProfileManagementPage() {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingProfile, setEditingProfile] = useState(null)

  useEffect(() => {
    loadProfiles()
  }, [])

  const loadProfiles = async () => {
    setLoading(true)
    try {
      const res = await api.get('/profiles')
      setProfiles(res.data.items || res.data || [])
    } catch (err) {
      setError('加载模板列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (data) => {
    try {
      await api.post('/profiles', data)
      setShowForm(false)
      await loadProfiles()
    } catch (err) {
      setError(err.response?.data?.error || '创建模板失败')
    }
  }

  const handleUpdate = async (data) => {
    try {
      await api.put(`/profiles/${editingProfile.id}`, data)
      setEditingProfile(null)
      await loadProfiles()
    } catch (err) {
      setError(err.response?.data?.error || '更新模板失败')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('确定删除此模板？')) return
    try {
      await api.delete(`/profiles/${id}`)
      await loadProfiles()
    } catch (err) {
      setError(err.response?.data?.error || '删除模板失败')
    }
  }

  const handleDuplicate = async (id) => {
    try {
      await api.post(`/profiles/${id}/duplicate`)
      await loadProfiles()
    } catch (err) {
      setError(err.response?.data?.error || '复制模板失败')
    }
  }

  const handleSetDefault = async (id) => {
    try {
      await api.put(`/profiles/${id}/default`)
      await loadProfiles()
    } catch (err) {
      setError(err.response?.data?.error || '设置默认模板失败')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin mr-3" /> 加载模板...
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-800">岗位模板管理</h2>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> 新建模板
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>
      )}

      {(showForm || editingProfile) && (
        <ProfileForm
          profile={showForm ? null : editingProfile}
          onSave={showForm ? handleCreate : handleUpdate}
          onCancel={() => { setShowForm(false); setEditingProfile(null) }}
        />
      )}

      <div className="space-y-4">
        {profiles.map(p => (
          <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <BrainCircuit className="w-5 h-5 text-indigo-500" />
                <div>
                  <span className="font-bold text-slate-800">{p.name}</span>
                  {p.is_default && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">
                      <Star className="w-3 h-3 mr-1" /> 默认
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                {!p.is_default && (
                  <button
                    onClick={() => handleSetDefault(p.id)}
                    className="p-1.5 rounded-lg hover:bg-cyan-50 text-cyan-600"
                    title="设为默认"
                  >
                    <Star className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setEditingProfile(p)}
                  className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-600"
                  title="编辑"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDuplicate(p.id)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
                  title="复制"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-red-600"
                  title="删除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="text-sm text-slate-600 mb-2">
              岗位类型: <span className="font-medium text-slate-800">{p.position_type || '通用'}</span>
            </div>
            <div className="flex gap-1 flex-wrap">
              {(p.evaluation_criteria?.dimensions || []).map(d => (
                <span key={d} className="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs">
                  {d}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}