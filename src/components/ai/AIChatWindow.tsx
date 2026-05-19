import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, useSettingsStore } from '@/store'
import { aiService, kbService, statsService } from '@/services/fileService'
import {
  XMarkIcon, PaperAirplaneIcon, UserIcon, SparklesIcon,
  ArrowDownTrayIcon, BookOpenIcon, GlobeAltIcon,
  MagnifyingGlassIcon, ClipboardIcon, ArrowRightIcon,
  PlusIcon, ArrowPathIcon, ListBulletIcon,
} from '@heroicons/react/24/outline'
import { DEFAULT_AI_SETTINGS } from '@/types/settings'
import { logError } from '@/utils/logger'
import { parseAiErrorMessage } from '@/utils/textUtils'
import { getStyleInjection } from '@/utils/styleInjector'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  insertion?: { keyword: string; position: 'before' | 'after'; content: string; mode?: 'insert' | 'rewrite' }
  sources?: { kb: { fileName: string; score: number }[]; web: { title: string; url: string }[] }
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
}

const WELCOME_MSG: Message = {
  id: 'welcome', role: 'assistant',
  content: '你好！我是AI写作助手。\n\n🔍 我可以检索知识库和网络搜索\n📍 在章节创作中，我可以建议内容插入位置\n💡 点击回复下方的按钮应用内容到编辑器',
}

function makeConversation(id: string, title: string): Conversation {
  return { id, title, messages: [{ ...WELCOME_MSG, id: `welcome_${id}` }], createdAt: Date.now() }
}

function parseInsertionSuggestion(text: string): {
  plainText: string
  insertion: Message['insertion']
} {
  // Rewrite pattern: 【改写参考】...【改写内容】...
  const rewriteMatch = text.match(/【改写参考】\s*\n原文:\s*(.+?)\n\n【改写内容】\s*\n([\s\S]*?)$/)
  if (rewriteMatch) {
    const keyword = rewriteMatch[1].trim()
    const content = rewriteMatch[2].trim()
    const plainText = text.replace(/【改写参考】[\s\S]*?【改写内容】\s*\n?/, '').trim()
    return { plainText, insertion: { keyword, position: 'after', content, mode: 'rewrite' } }
  }

  // Insert pattern: 【插入参考】...【生成内容】...
  const match = text.match(/【插入参考】\s*\n原文关键词:\s*(.+?)\n建议位置:\s*(.+?)\n\n【生成内容】\s*\n([\s\S]*?)$/)
  if (!match) return { plainText: text, insertion: undefined }

  const keyword = match[1].trim()
  const posRaw = match[2].trim()
  const content = match[3].trim()
  const position = posRaw.includes('前') ? 'before' as const : 'after' as const

  const plainText = text.replace(/【插入参考】[\s\S]*?【生成内容】\s*\n?/, '').trim()

  return { plainText, insertion: { keyword, position, content, mode: 'insert' } }
}

export default function AIChatWindow() {
  const isOpen = useStore(s => s.isAIChatOpen)
  const setAIChatOpen = useStore(s => s.setAIChatOpen)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)
  const activeProjectId = useStore(s => s.activeProjectId)
  const activePage = useStore(s => s.activePage)
  const setInsertionAction = useStore(s => s.setInsertionAction)
  const setReplaceAction = useStore(s => s.setReplaceAction)

  const worldbuildingContent = useStore(s => s.worldbuildingContent)
  const characters = useStore(s => s.characters)
  const outlineContent = useStore(s => s.outlineContent)
  const detailedChapters = useStore(s => s.detailedChapters)
  const currentChapterId = useStore(s => s.currentChapterId)
  const writingChapters = useStore(s => s.writingChapters)

  const setWorldbuildingContent = useStore(s => s.setWorldbuildingContent)
  const setOutlineContent = useStore(s => s.setOutlineContent)
  const updateDetailedChapter = useStore(s => s.updateDetailedChapter)
  const setWritingChapter = useStore(s => s.setWritingChapter)

  const currentChapter = currentChapterId ? writingChapters[currentChapterId] : null
  const currentDetailedChapter = currentChapterId ? detailedChapters.find(c => c.id === currentChapterId) : null

  const activeConfig = configs.find(c => c.id === activeConfigId)

  // Search toggles
  const aiSettings = useSettingsStore(s => ({ ...DEFAULT_AI_SETTINGS, ...s.aiSettings }))
  const [kbEnabled, setKbEnabled] = useState(true)
  const [webSearchEnabled, setWebSearchEnabled] = useState(aiSettings.webSearchDefault)

  const [showAtRef, setShowAtRef] = useState(false)
  const [atRefFilter, setAtRefFilter] = useState('')
  const [atRefFiles, setAtRefFiles] = useState<{ id: string; name: string }[]>([])
  const [selectedRefs, setSelectedRefs] = useState<{ id: string; name: string }[]>([])

  // KB file selector
  const [showKBFileList, setShowKBFileList] = useState(false)
  const [kbFiles, setKbFiles] = useState<{ id: string; originalName: string }[]>([])
  const currentSelections = aiSettings.kbFileSelections || {}
  const selectedFileIds: string[] = currentSelections[activePage] || []

  const loadKBFileList = async () => {
    try {
      const meta = await kbService.list() as { files: { id: string; originalName: string; projects: string[] }[] }
      setKbFiles(meta.files.filter(f => f.projects.includes(activeProjectId || '')))
    } catch (e) { logError('加载知识库文件列表失败', e); setKbFiles([]) }
  }

  const toggleKBFile = (fileId: string) => {
    const cur = currentSelections[activePage] || []
    const next = cur.includes(fileId) ? cur.filter(id => id !== fileId) : [...cur, fileId]
    useSettingsStore.getState().setAISettings({ kbFileSelections: { ...currentSelections, [activePage]: next } })
  }

  const selectAllKBFiles = () => {
    useSettingsStore.getState().setAISettings({ kbFileSelections: { ...currentSelections, [activePage]: [] } })
  }

  // Window position + size
  const [winSize, setWinSize] = useState({ width: 460, height: 600 })
  const [winPos, setWinPos] = useState({ right: 28, bottom: 96 })
  const resizeRef = useRef({ startX: 0, startY: 0, startW: 0, startH: 0, startR: 0, startB: 0, corner: '' })
  const dragRef = useRef({ startX: 0, startY: 0, startR: 0, startB: 0 })
  const cleanupDragRef = useRef<(() => void) | null>(null)
  const budgetWarnedRef = useRef(false)

  // Cleanup drag/resize listeners on unmount
  useEffect(() => {
    return () => { cleanupDragRef.current?.() }
  }, [])

  const handleResizeStart = (corner: string) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: winSize.width, startH: winSize.height, startR: winPos.right, startB: winPos.bottom, corner }
    const handleMove = (ev: MouseEvent) => {
      const { startX, startY, startW, startH, startR, startB, corner } = resizeRef.current
      const dx = ev.clientX - startX; const dy = ev.clientY - startY
      let w = startW, h = startH, r = startR, b = startB
      if (corner.includes('right')) { w = Math.max(380, Math.min(800, startW + dx)) }
      if (corner.includes('left')) { w = Math.max(380, Math.min(800, startW - dx)); r = startR + dx }
      if (corner.includes('bottom')) { h = Math.max(400, Math.min(window.innerHeight - 100, startH + dy)) }
      if (corner.includes('top')) { h = Math.max(400, Math.min(window.innerHeight - 100, startH - dy)); b = startB + dy }
      setWinSize({ width: w, height: h })
      setWinPos({ right: Math.max(0, r), bottom: Math.max(0, b) })
    }
    const handleUp = () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); cleanupDragRef.current = null }
    cleanupDragRef.current?.()
    cleanupDragRef.current = handleUp
    window.addEventListener('mousemove', handleMove); window.addEventListener('mouseup', handleUp)
  }

  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea')) return
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startY: e.clientY, startR: winPos.right, startB: winPos.bottom }
    const handleMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragRef.current.startX; const dy = ev.clientY - dragRef.current.startY
      setWinPos({ right: Math.max(0, dragRef.current.startR - dx), bottom: Math.max(0, dragRef.current.startB - dy) })
    }
    const handleUp = () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); cleanupDragRef.current = null }
    cleanupDragRef.current?.()
    cleanupDragRef.current = handleUp
    window.addEventListener('mousemove', handleMove); window.addEventListener('mouseup', handleUp)
  }

  const [conversations, setConversations] = useState<Conversation[]>(() => [makeConversation('default', '新对话')])
  const [activeConversationId, setActiveConversationId] = useState('default')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showConvList, setShowConvList] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const activeConversation = conversations.find(c => c.id === activeConversationId) || conversations[0]
  const messages = activeConversation.messages

  const setMessages = (updater: Message[] | ((prev: Message[]) => Message[])) => {
    setConversations(prev => prev.map(c =>
      c.id === activeConversationId
        ? { ...c, messages: typeof updater === 'function' ? updater(c.messages) : updater, title: c.title === '新对话' && typeof updater === 'function' ? getConvTitle(c.messages) : c.title }
        : c
    ))
  }

  function getConvTitle(msgs: Message[]): string {
    const firstUser = msgs.find(m => m.role === 'user')
    if (!firstUser) return '新对话'
    return firstUser.content.slice(0, 30) + (firstUser.content.length > 30 ? '...' : '')
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const contextPriority = aiSettings.contextPriority

  // Inject custom AI role if matching
  const customRole = (aiSettings.customRoles || []).find(r => r.id === aiSettings.defaultRole)

  const buildContextPrefix = (kbContext: string, webContext: string): string => {
    const parts: string[] = []
    if (customRole?.prompt) {
      parts.push(`[AI角色: ${customRole.name}]\n${customRole.prompt}`)
    }

    if (activePage === 'chapter' && currentChapter) {
      parts.push(`[当前章节标题: ${currentDetailedChapter?.title || '未命名'}]`)
      if (currentDetailedChapter?.description) parts.push(`[本章细纲:\n${currentDetailedChapter.description.slice(0, 5000)}]`)
      if (currentChapter.content) parts.push(`[当前章节正文:\n${currentChapter.content.slice(0, 20000)}]`)
      parts.push(`
如果用户要求生成新内容，请用以下格式：
【插入参考】
原文关键词: <引述原文中要插入位置的上下文句子>
建议位置: 该段之后

【生成内容】
<你的创作内容>

如果用户要求改写润色某段文字，请用以下格式（原文将被标红，改写将被标蓝插入其后，由使用者手动替换）：
【改写参考】
原文: <需要改写的原文句子（尽量完整引用）>

【改写内容】
<改写后的文字>`)
    }

    if (activePage === 'outline' && outlineContent) {
      parts.push(`[当前大纲/基础设定:\n${outlineContent.slice(0, 10000)}]`)
      parts.push('用户正在编辑基础设定。你可以分析大纲结构、剧情逻辑、节奏把控，提出修改建议。如果用户要求改写某段，直接输出改写后的内容。')
    }

    if (activePage === 'worldbuilding' && worldbuildingContent) {
      parts.push(`[当前世界观设定:\n${worldbuildingContent.slice(0, 10000)}]`)
      parts.push('用户正在编辑世界观设定。你可以分析世界观逻辑一致性、设定漏洞，提出扩展建议。如果用户要求改写，直接输出内容。')
    }

    if (activePage === 'detailed-outline' && detailedChapters.length > 0) {
      const cs = detailedChapters.map(c => `${c.title}: ${c.description?.slice(0, 500) || ''}`).join('\n---\n')
      parts.push(`[当前细纲(${detailedChapters.length}章):\n${cs}]`)
    }

    const priorityInstruction = contextPriority === 'kb-first'
      ? '\n优先参考以上知识库信息进行回答，知识库内容具有最高参考权重。'
      : contextPriority === 'model-first'
        ? '\n以上知识库信息仅供参考，请以你的模型知识为主要依据进行回答。'
        : ''

    if (kbContext) parts.push(kbContext + priorityInstruction)
    if (webContext) parts.push(webContext)
    return parts.join('\n\n')
  }

  const handleSend = async () => {
    if (!input.trim() || !activeConfigId || loading) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      // KB search
      let kbContext = ''
      const kbSources: { fileName: string; score: number }[] = []
      if (kbEnabled && activeProjectId && activeConfig) {
        try {
          const selIds = currentSelections[activePage]
          const fileIds = (selIds && selIds.length > 0) ? selIds : undefined
          const results = await kbService.search(
            userMsg.content, activeProjectId, activeConfig.id, 3, fileIds,
          ) as { content: string; fileName: string; score: number }[]
          if (results.length > 0) {
            kbContext = '\n\n[知识库参考]\n'
            for (const r of results) {
              kbContext += `【来源: ${r.fileName}】\n${r.content}\n\n`
              kbSources.push({ fileName: r.fileName, score: r.score })
            }
          }
        } catch (e) { logError('知识库搜索失败', e) }
      }

      // Web search
      let webContext = ''
      const webSources: { title: string; url: string }[] = []
      if (webSearchEnabled) {
        try {
          const results = await kbService.webSearch(userMsg.content, 5, aiSettings.safeSearch, aiSettings.prioritySites) as { title: string; snippet: string; url: string }[]
          if (results.length > 0) {
            webContext = '\n\n[网络搜索结果]\n'
            results.forEach((r, i) => {
              webContext += `${i + 1}. 【${r.title}】\n${r.snippet}\nURL: ${r.url}\n\n`
              webSources.push({ title: r.title, url: r.url })
            })
          }
        } catch (e) { logError('网络搜索失败', e) }
      }

      // @ referenced files content
      let refContext = ''
      for (const ref of selectedRefs) {
        try {
          const result = await kbService.read(ref.id) as { content: string }
          if (result.content) refContext += `\n\n[引用文件: ${ref.name}]\n${result.content.slice(0, 30000)}`
        } catch (e) { logError('读取引用文件失败', e) }
      }
      setSelectedRefs([])

      const contextPrefix = buildContextPrefix(kbContext, webContext) + refContext

      // Inject style if assigned to active project
      const assignments = useSettingsStore.getState().aiSettings.styleAssignments || {}
      const styleInjection = await getStyleInjection(activeProjectId || '', assignments)
      const stylePrefix = styleInjection ? styleInjection + '\n\n---\n\n' : ''

      // Build history: all previous messages (filter out welcome), then current user message with context prepended
      const historyMessages = messages
        .filter(m => !m.id.startsWith('welcome'))
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      const apiMessages = [
        ...historyMessages,
        { role: 'user' as const, content: stylePrefix + contextPrefix + '\n\n[用户输入]\n' + userMsg.content },
      ]

      const reply = await aiService.chat(apiMessages, activeConfigId, activeProjectId || undefined)

      // Parse insertion suggestion
      const { plainText, insertion } = parseInsertionSuggestion(reply)

      const assistantMsg: Message = {
        id: Date.now().toString() + '_r', role: 'assistant',
        content: plainText || reply,
        insertion,
        sources: { kb: kbSources, web: webSources },
      }
      setMessages(prev => [...prev, assistantMsg])

      // Budget warning check (delayed so logTokenUsage completes on backend)
      const storedAiSettings = useSettingsStore.getState().aiSettings
      if (storedAiSettings.budgetWarning && storedAiSettings.monthlyBudget > 0 && !budgetWarnedRef.current) {
        const budget = storedAiSettings.monthlyBudget
        setTimeout(async () => {
          try {
            const monthCost = await statsService.getMonthCost()
            if (monthCost > budget) {
              budgetWarnedRef.current = true
              setMessages(prev => [...prev, {
                id: Date.now().toString() + '_bw', role: 'assistant',
                content: `⚠️ **月度预算预警**\n\n本月 API 费用已达 **$${monthCost.toFixed(2)}**，超出设定的预算上限 **$${budget.toFixed(2)}**。请关注费用使用情况。`,
              }])
            }
          } catch { /* non-critical */ }
        }, 800)
      }
    } catch (err) {
      const errMsg = parseAiErrorMessage(err)

      setMessages(prev => [...prev, {
        id: Date.now().toString() + '_e', role: 'assistant',
        content: errMsg,
      }])
    }
    setLoading(false)
  }

  // @ reference handling
  const handleInputChange = async (value: string) => {
    setInput(value)
    // Detect @trigger
    const atMatch = value.match(/@(\S*)$/)
    if (atMatch && atMatch.index !== undefined) {
      const filter = atMatch[1]
      setAtRefFilter(filter)
      setShowAtRef(true)
      // Load KB files
      try {
        const meta = await kbService.list() as { files: { id: string; originalName: string }[] }
        const all = meta.files.map(f => ({ id: f.id, name: f.originalName }))
        setAtRefFiles(filter ? all.filter(f => f.name.includes(filter)) : all)
      } catch (e) { logError('加载 @ 引用文件列表失败', e); setAtRefFiles([]) }
    } else {
      setShowAtRef(false)
    }
  }

  const handleSelectRef = (file: { id: string; name: string }) => {
    if (!selectedRefs.find(r => r.id === file.id)) {
      setSelectedRefs(prev => [...prev, file])
    }
    // Remove @trigger from input
    const atIdx = input.lastIndexOf('@')
    if (atIdx !== -1) {
      setInput(input.slice(0, atIdx).trimEnd())
    }
    setShowAtRef(false)
  }

  const handleRemoveRef = (fileId: string) => {
    setSelectedRefs(prev => prev.filter(r => r.id !== fileId))
  }

  // Conversation management
  const handleNewConversation = () => {
    const id = Date.now().toString()
    setConversations(prev => [...prev, makeConversation(id, '新对话')])
    setActiveConversationId(id)
    setShowConvList(false)
  }

  const handleClearConversation = () => {
    setMessages([{ ...WELCOME_MSG, id: `welcome_${activeConversationId}` }])
  }

  const handleDeleteConversation = (convId: string) => {
    setConversations(prev => {
      const remaining = prev.filter(c => c.id !== convId)
      if (remaining.length === 0) {
        const fallback = makeConversation('default', '新对话')
        setActiveConversationId('default')
        return [fallback]
      }
      if (convId === activeConversationId) {
        setActiveConversationId(remaining[0].id)
      }
      return remaining
    })
  }

  const handleLocate = (keyword: string) => {
    // Signal chapter editor to scroll to and highlight keyword
    setInsertionAction({ keyword, content: keyword, position: 'after' })
  }

  const handleInsert = (insertion: NonNullable<Message['insertion']>) => {
    setInsertionAction({ keyword: insertion.keyword, content: insertion.content, position: insertion.position })
  }

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
  }

  const handleApplyToEditor = (content: string) => {
    switch (activePage) {
      case 'outline':
        setOutlineContent(outlineContent ? outlineContent + '\n\n' + content : content); break
      case 'worldbuilding':
        setWorldbuildingContent(worldbuildingContent ? worldbuildingContent + '\n\n' + content : content); break
      case 'detailed-outline':
        if (currentChapterId) {
          const f = detailedChapters.find(c => c.id === currentChapterId)
          if (f) updateDetailedChapter(f.id, { ...f, description: f.description ? f.description + '\n\n' + content : content })
        }; break
      case 'chapter':
        if (currentChapterId) {
          setReplaceAction({ chapterId: currentChapterId, content })
        }; break
    }
  }

  const canApply = ['worldbuilding', 'outline', 'detailed-outline', 'chapter'].includes(activePage)

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          style={{
            position: 'fixed', bottom: winPos.bottom, right: winPos.right, width: winSize.width, height: winSize.height,
            borderRadius: 24, background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.6)', boxShadow: '0 16px 64px rgba(0,0,0,0.12)',
            display: 'flex', flexDirection: 'column', zIndex: 49, overflow: 'hidden',
          }}
        >
          {/* Header (draggable) */}
          <div
            onMouseDown={handleDragStart}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', borderBottom: '1px solid rgba(0,0,0,0.06)', cursor: 'grab' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SparklesIcon style={{ width: 20, height: 20, color: '#7c3aed' }} />
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#2d2520' }}>AI写作助手</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={() => setAIChatOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9b8e84', display: 'flex' }}>
                <XMarkIcon style={{ width: 18, height: 18 }} />
              </button>
            </div>
          </div>

          {/* Conversation management */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(0,0,0,0.01)' }}>
            {/* Conversation selector */}
            <div style={{ flex: 1, position: 'relative' }}>
              <button onClick={() => setShowConvList(!showConvList)} style={{
                width: '100%', textAlign: 'left', padding: '4px 10px', borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.08)', background: '#fff',
                fontSize: 11, color: '#2d2520', cursor: 'pointer',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {activeConversation.title} <span style={{ color: '#9b8e84', fontSize: 9 }}>({messages.length}条)</span>
              </button>
              {showConvList && (
                <div
                  className="custom-scrollbar"
                  onClick={() => setShowConvList(false)}
                  style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                    marginTop: 2, maxHeight: 180, overflowY: 'auto',
                    background: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                  }}
                >
                  {conversations.map(conv => (
                    <div key={conv.id} onClick={(e) => { e.stopPropagation(); setActiveConversationId(conv.id) }} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                      cursor: 'pointer', fontSize: 11, color: conv.id === activeConversationId ? '#7c3aed' : '#2d2520',
                      background: conv.id === activeConversationId ? 'rgba(124,58,237,0.04)' : 'transparent',
                      borderBottom: '1px solid rgba(0,0,0,0.03)',
                    }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.title}</span>
                      <span style={{ fontSize: 9, color: '#9b8e84', flexShrink: 0 }}>{conv.messages.length}条</span>
                      {conversations.length > 1 && (
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteConversation(conv.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 0, display: 'flex' }} title="删除对话"
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#dc2626' }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#d4ccc4' }}
                        >
                          <XMarkIcon style={{ width: 12, height: 12 }} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={handleNewConversation} title="新建对话" style={{ ...convBtn, background: 'rgba(124,58,237,0.06)', color: '#7c3aed' }}>
              <PlusIcon style={{ width: 13, height: 13 }} />
            </button>
            <button onClick={handleClearConversation} title="清空当前对话" style={{ ...convBtn, color: '#9b8e84' }}>
              <ArrowPathIcon style={{ width: 13, height: 13 }} />
            </button>
          </div>

          {/* Source toggles */}
          <div style={{ display: 'flex', gap: 6, padding: '8px 18px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(0,0,0,0.01)', flexWrap: 'wrap', alignItems: 'center' }}>
            <ToggleButton icon={<BookOpenIcon style={{ width: 12, height: 12 }} />} label="知识库" active={kbEnabled} onClick={() => setKbEnabled(!kbEnabled)} />
            {kbEnabled && (
              <div style={{ position: 'relative' }}>
                <button onClick={() => { loadKBFileList(); setShowKBFileList(!showKBFileList) }} title="选择知识库文件" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 8,
                  border: selectedFileIds.length > 0 ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.06)',
                  background: selectedFileIds.length > 0 ? 'rgba(124,58,237,0.04)' : '#fff',
                  color: selectedFileIds.length > 0 ? '#7c3aed' : '#9b8e84', fontSize: 11, fontWeight: selectedFileIds.length > 0 ? 600 : 400,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <ListBulletIcon style={{ width: 11, height: 11 }} />
                  文件 {selectedFileIds.length > 0 ? `(${selectedFileIds.length})` : ''}
                </button>
                {showKBFileList && (
                  <div className="custom-scrollbar" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 4, minWidth: 220, maxHeight: 260, overflowY: 'auto', background: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', padding: 4 }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      <button onClick={selectAllKBFiles} style={{ flex: 1, padding: '3px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', background: 'transparent', fontWeight: selectedFileIds.length === 0 ? 600 : 400, color: selectedFileIds.length === 0 ? '#7c3aed' : '#6b5e54' }}>全部</button>
                      <button onClick={() => useSettingsStore.getState().setAISettings({ kbFileSelections: { ...currentSelections, [activePage]: ['__none__'] } })} style={{ flex: 1, padding: '3px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', background: 'transparent', fontWeight: selectedFileIds.length === 1 && selectedFileIds[0] === '__none__' ? 600 : 400, color: selectedFileIds.length === 1 && selectedFileIds[0] === '__none__' ? '#7c3aed' : '#6b5e54' }}>不使用</button>
                    </div>
                    {kbFiles.length > 0 ? kbFiles.map(f => (
                      <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', cursor: 'pointer', borderRadius: 6, fontSize: 11, color: '#2d2520' }}>
                        <input type="checkbox" checked={selectedFileIds.includes(f.id) || selectedFileIds.length === 0} onChange={() => toggleKBFile(f.id)} style={{ width: 13, height: 13, accentColor: '#7c3aed' }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.originalName}</span>
                      </label>
                    )) : <div style={{ fontSize: 11, color: '#9b8e84', textAlign: 'center', padding: 8 }}>暂无知识库文件</div>}
                  </div>
                )}
              </div>
            )}
            <ToggleButton icon={<GlobeAltIcon style={{ width: 12, height: 12 }} />} label="联网搜索" active={webSearchEnabled} onClick={() => setWebSearchEnabled(!webSearchEnabled)} />
            {kbEnabled && (
              <span style={{ fontSize: 10, color: '#ca8a04', marginLeft: 4 }} title="知识库内容可能触发AI内容安全策略，如遇拦截请关闭此开关">
                含敏感内容时建议关闭
              </span>
            )}
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
            {messages.map(msg => (
              <div key={msg.id}>
                {/* Regular message bubble */}
                <div style={{ display: 'flex', gap: 8, marginBottom: msg.role === 'assistant' ? 4 : 14, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: msg.role === 'user' ? 'rgba(124,58,237,0.1)' : 'rgba(139,92,246,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {msg.role === 'user' ? <UserIcon style={{ width: 14, height: 14, color: '#7c3aed' }} /> : <SparklesIcon style={{ width: 14, height: 14, color: '#8b5cf6' }} />}
                  </div>
                  <div style={{ maxWidth: '82%', padding: '10px 14px', borderRadius: 16, background: msg.role === 'user' ? 'rgba(124,58,237,0.08)' : 'rgba(0,0,0,0.03)', fontSize: 13, lineHeight: 1.6, color: '#2d2520', whiteSpace: 'pre-wrap' }}>
                    {msg.content}
                  </div>
                </div>

                {/* Insertion card */}
                {msg.insertion && (
                  <div style={{ marginLeft: 36, marginBottom: 14, padding: 12, borderRadius: 16, border: '1px solid rgba(124,58,237,0.15)', background: 'rgba(124,58,237,0.03)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MagnifyingGlassIcon style={{ width: 13, height: 13 }} /> AI 建议在此处插入
                    </div>
                    <div style={{ fontSize: 11, color: '#6b5e54', marginBottom: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.02)' }}>
                      定位: ...{msg.insertion.keyword.slice(0, 60)}... {msg.insertion.position === 'after' ? '之后' : '之前'}
                    </div>
                    <div style={{ padding: '10px 12px', borderRadius: 10, background: '#fff', border: '1px solid rgba(0,0,0,0.05)', fontSize: 12, lineHeight: 1.8, color: '#2d2520', marginBottom: 8, maxHeight: 200, overflow: 'auto' }} className="custom-scrollbar">
                      {msg.insertion.content}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleLocate(msg.insertion!.keyword)} style={actionBtnStyle('#7c3aed')}>
                        <MagnifyingGlassIcon style={{ width: 12, height: 12 }} /> 在原文中定位
                      </button>
                      <button onClick={() => handleInsert(msg.insertion!)} style={actionBtnStyle('#16a34a')}>
                        <ArrowRightIcon style={{ width: 12, height: 12 }} /> 插入到此处
                      </button>
                      <button onClick={() => handleCopy(msg.insertion!.content)} style={actionBtnStyle('#6b5e54')}>
                        <ClipboardIcon style={{ width: 12, height: 12 }} /> 复制
                      </button>
                    </div>
                  </div>
                )}

                {/* Apply button (no insertion, plain text) */}
                {msg.role === 'assistant' && msg.id !== 'welcome' && !msg.insertion && canApply && msg.content.length > 10 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14, paddingLeft: 36 }}>
                    <button onClick={() => handleApplyToEditor(msg.content)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 8, border: '1px solid rgba(124,58,237,0.2)', background: 'rgba(124,58,237,0.04)', color: '#7c3aed', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      <ArrowDownTrayIcon style={{ width: 12, height: 12 }} /> 应用到编辑器
                    </button>
                  </div>
                )}

                {/* Sources */}
                {msg.sources && (msg.sources.kb.length > 0 || msg.sources.web.length > 0) && (
                  <div style={{ marginLeft: 36, marginBottom: 14, padding: '8px 12px', borderRadius: 10, background: 'rgba(0,0,0,0.02)', fontSize: 10, color: '#9b8e84' }}>
                    {msg.sources.kb.length > 0 && (
                      <div style={{ marginBottom: 4 }}>
                        📚 知识库: {msg.sources.kb.map(s => `${s.fileName} (${Math.round((s as { score: number }).score * 100)}%)`).join(', ')}
                      </div>
                    )}
                    {msg.sources.web.length > 0 && (
                      <div>
                        🌐 网络来源:{' '}
                        {msg.sources.web.map((s, i) => (
                          <span key={i}>{i + 1}. {s.title.slice(0, 30)}{i < msg.sources!.web.length - 1 ? ' | ' : ''}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && <div style={{ textAlign: 'center', color: '#9b8e84', fontSize: 12, padding: 8 }}>AI思考中...</div>}
          </div>

          {/* Input */}
          <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(0,0,0,0.06)', position: 'relative' }}>
            {/* Ref tags */}
            {selectedRefs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {selectedRefs.map(ref => (
                  <span key={ref.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 8px', borderRadius: 6, fontSize: 11,
                    background: 'rgba(124,58,237,0.08)', color: '#7c3aed', fontWeight: 600,
                  }}>
                    @{ref.name}
                    <button onClick={() => handleRemoveRef(ref.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#7c3aed', display: 'flex', opacity: 0.6 }}>
                      <XMarkIcon style={{ width: 12, height: 12 }} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
              <textarea value={input} onChange={e => handleInputChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder={activeConfigId ? '输入消息...' : '请先在设置中配置模型'}
              disabled={!activeConfigId} rows={2}
              style={{ flex: 1, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, outline: 'none', resize: 'none', padding: '8px 12px', fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit', color: '#2d2520', background: 'rgba(0,0,0,0.02)' }}
            />
            <button onClick={handleSend} disabled={!input.trim() || !activeConfigId || loading}
              style={{ width: 38, height: 38, borderRadius: 12, border: 'none', background: input.trim() && activeConfigId ? '#7c3aed' : '#e5e0da', color: '#fff', cursor: input.trim() && activeConfigId ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-end' }}>
              <PaperAirplaneIcon style={{ width: 17, height: 17 }} />
            </button>
          </div>
            {/* @ file selector popup */}
            {showAtRef && (
              <div className="custom-scrollbar" style={{
                position: "absolute", bottom: "100%", left: 0, right: 56,
                maxHeight: 200, overflowY: "auto", background: "#fff", borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.1)", boxShadow: "0 8px 32px rgba(0,0,0,0.1)",
                marginBottom: 4, zIndex: 10,
              }}>
                {atRefFiles.length > 0 ? atRefFiles.map(f => (
                  <button key={f.id} onClick={() => handleSelectRef(f)} style={{
                    width: "100%", textAlign: "left", padding: "8px 12px", border: "none",
                    background: "transparent", cursor: "pointer", fontSize: 12, color: "#2d2520",
                    borderBottom: "1px solid rgba(0,0,0,0.04)",
                  }}>
                    @{f.name}
                  </button>
                )) : (
                  <div style={{ padding: "12px", textAlign: "center", color: "#9b8e84", fontSize: 12 }}>
                    {atRefFilter ? "无匹配文件" : "输入文件名筛选"}
                  </div>
                )}
              </div>
            )}
          </div>
          {!activeConfigId && (
            <div style={{ position: 'absolute', bottom: 70, left: 16, right: 16, padding: '8px 12px', borderRadius: 10, background: 'rgba(254,226,226,0.9)', color: '#dc2626', fontSize: 11, textAlign: 'center' }}>
              请先在系统设置中配置AI模型
            </div>
          )}
          {/* 4-corner resize handles */}
          {(['top-left','top-right','bottom-left','bottom-right'] as const).map(corner => (
            <div key={corner} onMouseDown={handleResizeStart(corner)} style={{
              position: 'absolute',
              top: corner.includes('top') ? 0 : undefined,
              bottom: corner.includes('bottom') ? 0 : undefined,
              left: corner.includes('left') ? 0 : undefined,
              right: corner.includes('right') ? 0 : undefined,
              width: 16, height: 16,
              cursor: corner === 'top-left' || corner === 'bottom-right' ? 'nwse-resize' : 'nesw-resize',
              opacity: 0.3, display: 'flex', alignItems: corner.includes('bottom') ? 'flex-end' : 'flex-start',
              justifyContent: corner.includes('right') ? 'flex-end' : 'flex-start',
              flexDirection: corner.includes('bottom') ? 'row' : 'row-reverse',
              transform: corner.includes('left') ? 'scaleX(-1)' : 'none',
            }}>
              <svg width="12" height="12" viewBox="0 0 14 14"><path d="M0 14L14 0V3L3 14H0Z" fill="#9b8e84"/><path d="M0 14L14 0H11L0 11V14Z" fill="#9b8e84"/></svg>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ToggleButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8,
      border: active ? '1px solid rgba(124,58,237,0.25)' : '1px solid rgba(0,0,0,0.06)',
      background: active ? 'rgba(124,58,237,0.06)' : 'transparent',
      color: active ? '#7c3aed' : '#9b8e84', fontSize: 11, fontWeight: active ? 600 : 400,
      cursor: 'pointer', transition: 'all 0.1s ease',
    }}>
      {icon} {label} {active ? 'ON' : 'OFF'}
    </button>
  )
}

function actionBtnStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
    borderRadius: 8, border: `1px solid ${color}20`, background: `${color}08`,
    color, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.1s ease',
  }
}

const convBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)',
  background: '#fff', cursor: 'pointer', fontSize: 11, flexShrink: 0,
}


