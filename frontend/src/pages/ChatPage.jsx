import { useState, useRef, useEffect } from 'react'
import api from '../config/api'
import { Send, Loader2, Bot, UserCircle } from 'lucide-react'

export default function ChatPage() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEnd = useRef(null)

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setLoading(true)

    try {
      const res = await api.post('/chat', { message: userMsg })
      setMessages(prev => [...prev, { role: 'ai', content: res.data.response }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', content: '抱歉，回答出现问题：' + (err.response?.data?.error || err.message) }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-xl font-bold text-slate-800 mb-4">AI问答助手</h2>

      <div className="flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-4 mb-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-400 py-20">
            <Bot className="w-12 h-12 mx-auto mb-3 text-indigo-300" />
            <p>向AI助手提问简历审查相关问题</p>
            <p className="text-sm mt-1">如：简历中常见的风险有哪些？如何识别夸大表述？</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 mb-4 ${msg.role === 'user' ? '' : ''}`}>
            {msg.role === 'ai' ? (
              <Bot className="w-6 h-6 text-indigo-500 mt-1" />
            ) : (
              <UserCircle className="w-6 h-6 text-slate-400 mt-1" />
            )}
            <div className={`rounded-lg px-4 py-2 max-w-[80%] ${
              msg.role === 'user' ? 'bg-indigo-50 text-indigo-900' : 'bg-slate-50 text-slate-800'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3 mb-4">
            <Bot className="w-6 h-6 text-indigo-500 mt-1" />
            <div className="bg-slate-50 rounded-lg px-4 py-2 text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> 思考中...
            </div>
          </div>
        )}
        <div ref={messagesEnd} />
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="输入你的问题..."
          className="flex-1 px-4 py-3 rounded-lg border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
        />
        <button
          onClick={handleSend}
          disabled={loading}
          className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2"
        >
          <Send className="w-5 h-5" /> 发送
        </button>
      </div>
    </div>
  )
}