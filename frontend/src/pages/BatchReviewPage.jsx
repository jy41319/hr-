import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../config/api'
import {
  Upload, Files, Loader2, CheckCircle, XCircle, Clock,
  Play, Trash2, Download, Filter, Eye, AlertCircle
} from 'lucide-react'

const STATUS_MAP = {
  pending: { label: '待评估', color: 'bg-slate-100 text-slate-600' },
  evaluating: { label: '评估中', color: 'bg-indigo-50 text-indigo-600' },
  completed: { label: '已完成', color: 'bg-emerald-50 text-emerald-600' },
  failed: { label: '失败', color: 'bg-red-50 text-red-600' },
}

function GradeBadge({ grade }) {
  if (!grade) return null
  return <span className={`grade-badge grade-${grade}`}>{grade}</span>
}

export default function BatchReviewPage() {
  const [resumes, setResumes] = useState([])
  const [profiles, setProfiles] = useState([])
  const [selectedProfile, setSelectedProfile] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedFileCount, setSelectedFileCount] = useState(0)
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

  const loadResumes = async () => {
    setLoading(true)
    try {
      const res = await api.get('/resumes')
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

  const handleBatchEvaluate = async () => {
    if (selectedIds.length === 0) return
    setLoading(true)
    setError('')
    try {
      // Backend does not provide a batch-evaluate endpoint; evaluate selected resumes one by one.
      await Promise.all(selectedIds.map(id => api.post(`/evaluate/${id}`)))
      await loadResumes()
    } catch (err) {
      setError(err.response?.data?.error || '批量评估失败')
    } finally {
      setLoading(false)
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
      link.download = 'resume_scores.xlsx'
      link.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError('导出失败')
    }
  }

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const toggleAll = () => {
    const filtered = getFilteredResumes()
    if (selectedIds.length === filtered.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filtered.map(r => r.id))
    }
  }

  const getFilteredResumes = () => {
    if (!filterStatus) return resumes
    return resumes.filter(r => (r.evaluation_status || r.status) === filterStatus)
  }

  const filteredResumes = getFilteredResumes()

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-800 mb-4">批量简历审查</h2>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">审查模板</label>
            <select
              value={selectedProfile}
              onChange={e => setSelectedProfile(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
            >
              <option value="">选择模板...</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.name} {p.isDefault ? '(默认)' : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">上传文件</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 hover:border-indigo-400 cursor-pointer flex items-center gap-2 text-slate-600"
            >
              <Upload className="w-4 h-4" />
              <span>{selectedFileCount > 0 ? `已选择 ${selectedFileCount} 个文件` : '选择多个 docx/pdf 文件'}</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".docx,.pdf"
              multiple
              onChange={(e) => setSelectedFileCount(e.target.files?.length || 0)}
              className="hidden"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              批量上传
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-slate-800">简历列表</h3>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm focus:border-indigo-500 outline-none"
            >
              <option value="">全部状态</option>
              {Object.entries(STATUS_MAP).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleBatchEvaluate}
              disabled={selectedIds.length === 0 || loading}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1"
            >
              <Play className="w-4 h-4" /> 批量评估
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={selectedIds.length === 0 || loading}
              className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1"
            >
              <Trash2 className="w-4 h-4" /> 批量删除
            </button>
            <button
              onClick={handleExport}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium flex items-center gap-1"
            >
              <Download className="w-4 h-4" /> 导出评分
            </button>
          </div>
        </div>

        {loading && resumes.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> 加载中...
          </div>
        ) : filteredResumes.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Files className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p>暂无简历数据</p>
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-2 px-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === filteredResumes.length && filteredResumes.length > 0}
                      onChange={toggleAll}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
                    />
                  </th>
                  <th className="py-2 px-3 text-left font-medium text-slate-600">文件名</th>
                  <th className="py-2 px-3 text-left font-medium text-slate-600">模板</th>
                  <th className="py-2 px-3 text-left font-medium text-slate-600">状态</th>
                  <th className="py-2 px-3 text-left font-medium text-slate-600">评分</th>
                  <th className="py-2 px-3 text-left font-medium text-slate-600">等级</th>
                  <th className="py-2 px-3 text-left font-medium text-slate-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredResumes.map(r => {
                  const st = r.evaluation_status || r.status || 'pending'
                  const stInfo = STATUS_MAP[st] || STATUS_MAP.pending
                  return (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
                        />
                      </td>
                      <td className="py-2 px-3 text-slate-800 font-medium">{r.filename || r.file_name}</td>
                      <td className="py-2 px-3 text-slate-600">{r.profile_name || '-'}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${stInfo.color}`}>
                          {stInfo.label}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-bold text-indigo-600">{r.overall_score ?? '-'}</td>
                      <td className="py-2 px-3">{r.grade ? <GradeBadge grade={r.grade} /> : '-'}</td>
                      <td className="py-2 px-3">
                        {st === 'completed' && (
                          <button
                            onClick={() => navigate(`/report/${r.id}`)}
                            className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                          >
                            <Eye className="w-4 h-4" /> 查看
                          </button>
                        )}
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
