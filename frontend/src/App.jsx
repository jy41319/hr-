import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import api from './config/api'
import Layout from './layouts/Layout'
import LoginPage from './pages/LoginPage'
import ChatPage from './pages/ChatPage'
import ResumeReviewPage from './pages/ResumeReviewPage'
import BatchReviewPage from './pages/BatchReviewPage'
import TalentPoolPage from './pages/TalentPoolPage'
import ReportPage from './pages/ReportPage'
import AigcDetectionPage from './pages/AigcDetectionPage'
import RiskMapPage from './pages/RiskMapPage'
import ProfileManagementPage from './pages/ProfileManagementPage'
import ModelManagementPage from './pages/ModelManagementPage'
import SettingsPage from './pages/SettingsPage'

function ProtectedRoute({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/current-user').then(res => {
      setUser(res.data)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-500">加载中...</div>
  if (!user) return <Navigate to="/login" replace />

  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<ChatPage />} />
          <Route path="review" element={<ResumeReviewPage />} />
          <Route path="batch" element={<BatchReviewPage />} />
          <Route path="talent-pool" element={<TalentPoolPage />} />
          <Route path="report/:id" element={<ReportPage />} />
          <Route path="aigc/:id" element={<AigcDetectionPage />} />
          <Route path="risk/:id" element={<RiskMapPage />} />
          <Route path="profiles" element={<ProfileManagementPage />} />
          <Route path="models" element={<ModelManagementPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
