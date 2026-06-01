import React, { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, useSettingsStore } from '@/store'
import { aiService, kbService, fileService, styleTemplateService, templateService, settingsService } from '@/services/fileService'
import {
  XMarkIcon, PaperAirplaneIcon, SparklesIcon,
  ArrowDownTrayIcon, BookOpenIcon, GlobeAltIcon,
  MagnifyingGlassIcon, ClipboardIcon, ArrowRightIcon,
  PlusIcon, ArrowPathIcon, ListBulletIcon,
  ExclamationTriangleIcon, DocumentTextIcon, PhotoIcon,
  TrashIcon, Square2StackIcon,
} from '@heroicons/react/24/outline'
import { DEFAULT_AI_SETTINGS } from '@/types/settings'
import { logError } from '@/utils/logger'
import { parseAiErrorMessage } from '@/utils/textUtils'
import { debugApiError } from '@/services/debugLogService'
import { ContextUsageBar } from '@/components/ai/ContextUsageBar'
import { WELCOME_MSG, STORAGE_KEY, LAST_ACTIVE_KEY, WINDOW_KEY } from '@/components/ai/chatConstants'
import type { Message, Conversation } from '@/components/ai/chatConstants'
import ImageLightbox from '@/components/common/ImageLightbox'

import { makeConversation } from "./utils";
import { useWindowDrag } from "./hooks/useWindowDrag";
import { V4AgentChatBridge } from '@/agent/V4AgentChatBridge'
import { ContextCompressor } from '@/agent/context/ContextCompressor'
import { useAgentStore } from '@/agent/store/AgentStore'
import { AgentStatusBar } from './components/AgentStatusBar'
import { DiagnosticPanel } from './components/DiagnosticPanel'
import { DangerousToolModal, type DangerousTool } from './components/DangerousToolModal'
import { StreamingMessage } from './components/StreamingMessage'
import { VirtualMessageList } from './components/VirtualMessageList'

// ── Module-level utilities (M12: moved out of render to avoid re-creation) ──

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const timeStr = d.toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' })
  if (d.toDateString() === now.toDateString()) return timeStr
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${timeStr}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${timeStr}`
}

function actionBtnStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
    borderRadius: 8, border: `1px solid ${color}20`, background: `${color}08`,
    color, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.1s ease',
  }
}

const ToggleButton = React.memo(function ToggleButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8,
      border: active ? '1px solid rgba(124,58,237,0.25)' : '1px solid rgba(0,0,0,0.06)',
      background: active ? 'rgba(124,58,237,0.06)' : 'transparent',
      color: active ? '#7c3aed' : '#9b8e84', fontSize: 11, fontWeight: active ? 600 : 400,
      cursor: 'pointer', transition: 'all 0.1s ease',
    }}>
      {icon} {label}
    </button>
  )
})

// ── Component ──

export default function AIChatWindow() {
  const isOpen = useStore(s => s.isAIChatOpen)

  // Check API connection when chat window opens
  useEffect(() => { if (isOpen) checkApiConnection() }, [isOpen])
  const setAIChatOpen = useStore(s => s.setAIChatOpen)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)
  const activeProjectId = useStore(s => s.activeProjectId)
  const activePage = useStore(s => s.activePage)
  const setInsertionAction = useStore(s => s.setInsertionAction)
  const setReplaceAction = useStore(s => s.setReplaceAction)
  const setFileEditNotify = useStore(s => s.setFileEditNotify)
  const openPopup = useStore(s => s.openPopup)

  const worldbuildingContent = useStore(s => s.worldbuildingContent)
  const outlineContent = useStore(s => s.outlineContent)
  const detailedChapters = useStore(s => s.detailedChapters)
  const currentChapterId = useStore(s => s.currentChapterId)

  const setWorldbuildingContent = useStore(s => s.setWorldbuildingContent)
  const setOutlineContent = useStore(s => s.setOutlineContent)
  const updateDetailedChapter = useStore(s => s.updateDetailedChapter)

  const activeConfig = configs.find(c => c.id === activeConfigId)

  // Agent runtime state
  const agentStreamingText = useAgentStore(s => s.run.streamingText)
  const agentIsStreaming = useAgentStore(s => s.run.isStreaming)
  const agentHookFeedback = useAgentStore(s => s.run.hookFeedback)

  // Search toggles
  const prompts = useSettingsStore(s => s.prompts)
  const updatePromptStore = useSettingsStore(s => s.updatePrompt)
  const aiSettings = useSettingsStore(s => ({ ...DEFAULT_AI_SETTINGS, ...s.aiSettings }))
  const [kbEnabled, setKbEnabled] = useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = useState(aiSettings.webSearchDefault)
  const [toolInvokeEnabled, setToolInvokeEnabled] = useState(true)
  const [showToolHint, setShowToolHint] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const lastApiCheck = useRef(0)

  // Pre-flight API connectivity check (cached for 30 seconds)
  const checkApiConnection = async (): Promise<boolean> => {
    if (!activeConfigId) return false
    const now = Date.now()
    if (now - lastApiCheck.current < 30000) return apiError === null  // use cached result
    lastApiCheck.current = now
    try {
      await aiService.listModels(activeConfigId)
      setApiError(null)
      return true
    } catch {
      debugApiError(activeConversationId, 'NETWORK', 'API 连接失败')
      setApiError('[NETWORK] API 连接失败 — 请检查网络或模型配置后重试')
      return false
    }
  }

  const [showAtRef, setShowAtRef] = useState(false)
  const [atRefFilter, setAtRefFilter] = useState('')
  const [atRefFiles, setAtRefFiles] = useState<{ id: string; name: string }[]>([])
  const [selectedRefs, setSelectedRefs] = useState<{ id: string; name: string }[]>([])

  // KB file selector
  const [showKBFileList, setShowKBFileList] = useState(false)
  const [kbFiles, setKbFiles] = useState<{ id: string; originalName: string }[]>([])
  const [kbLoadError, setKbLoadError] = useState(false)  // M3: distinguish error from empty
  const currentSelections = aiSettings.kbFileSelections || {}
  const selectedFileIds: string[] = currentSelections[activePage] || []

  const loadKBFileList = async () => {
    try {
      setKbLoadError(false)
      const meta = await kbService.list() as { files: { id: string; originalName: string; projects: string[] }[] }
      if (Array.isArray(meta?.files)) {
        setKbFiles(meta.files.filter(f => f.projects?.includes(activeProjectId || '')))
      } else { setKbFiles([]) }
    } catch (e) { logError('加载知识库文件列表失败', e); setKbLoadError(true); setKbFiles([]) }
  }

  // Action mode now works without a project (global notes, templates, KB)

  const toggleKBFile = (fileId: string) => {
    const cur = currentSelections[activePage] || []
    const next = cur.includes(fileId) ? cur.filter(id => id !== fileId) : [...cur, fileId]
    useSettingsStore.getState().setAISettings({ kbFileSelections: { ...currentSelections, [activePage]: next } })
  }

  const selectAllKBFiles = () => {
    useSettingsStore.getState().setAISettings({ kbFileSelections: { ...currentSelections, [activePage]: [] } })
  }

  // Window position + size
  
  // Cleanup drag/resize listeners on unmount

  // V2-4: Read cumulative tokens from AgentStore (single source of truth)
  // Local state for token tracking — incremented per message, reset on conversation switch
  const [cumulativeTokens, setCumulativeTokens] = useState(0)
  const [tokenBreakdown, setTokenBreakdown] = useState<{ label: string; chars: number }[]>([])

  const { winSize, setWinSize, winPos, setWinPos, handleResizeStart, handleDragStart, winStyle } = useWindowDrag(WINDOW_KEY);

  const [conversations, setConversations] = useState<Conversation[]>(() => {
    // Synchronous init: try localStorage as bootstrap fallback while IndexedDB loads async
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) { const p = JSON.parse(s) as Conversation[]; if (Array.isArray(p) && p.length > 0) return p } } catch { /* */ }
    return [makeConversation('default', '新对话')]
  })
  const [convsLoaded, setConvsLoaded] = useState(false)
  const [activeConversationId, setActiveConversationId] = useState('default')

  // Init 3: Load conversations from IndexedDB on mount and migrate localStorage
  useEffect(() => {
    let cancelled = false
    import('@/services/chatStorageService').then(async ({ loadConversations, loadLastActiveId, finalizeMigration }) => {
      try {
        const stored = await loadConversations()
        if (cancelled) return
        if (stored.length > 0) {
          setConversations(stored)
          const lastId = await loadLastActiveId()
          if (lastId && stored.some(c => c.id === lastId)) setActiveConversationId(lastId)
          else if (stored.length > 0) setActiveConversationId(stored[stored.length - 1].id)
        }
        finalizeMigration()
      } catch (e) { logError('IndexedDB 加载对话失败', e) }
      setConvsLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  // M1→I3: Persist conversations via IndexedDB (auto-debounced by chatStorageService)
  const persistConversations = useCallback(async (convs: Conversation[]) => {
    try {
      const { saveConversations, saveLastActiveId } = await import('@/services/chatStorageService')
      await saveConversations(convs)
      await saveLastActiveId(activeConversationId)
    } catch (e) { logError('保存对话历史失败', e) }
  }, [activeConversationId])

  // V9.5.2: 加载完成前禁止保存，防止默认对话覆盖 IndexedDB 中的真实数据
  useEffect(() => {
    if (!convsLoaded) return
    persistConversations(conversations)
  }, [conversations, persistConversations, convsLoaded])
  useEffect(() => {
    import('@/services/chatStorageService').then(m => m.saveLastActiveId(activeConversationId)).catch(() => {})
  }, [activeConversationId])
  // Token reset handled directly in switchConversation/handleNewConversation/handleClearConversation
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const abortRef = useRef(false)
  const conversationToolNames = useRef(new Set<string>())  // persists across messages within conversation
  const pendingCorrection = useRef<string | null>(null)  // hallucination auto-correction for next send
  const autoRetryRef = useRef(false)  // prevent infinite auto-retry loops
  const [attachment, setAttachment] = useState<{ type: 'file' | 'image'; name: string; content: string; previewUrl?: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<DangerousTool[] | null>(null)
  const approvalResolveRef = useRef<((approved: boolean) => void) | null>(null)


  const [showConvList, setShowConvList] = useState(false)
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set())
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set())
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set())
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ msgId: string; x: number; y: number } | null>(null)
  const [breakdownModal, setBreakdownModal] = useState<{ inputBreakdown: { label: string; chars: number }[]; outputBreakdown: { label: string; tokens: number }[]; totalPromptTokens?: number; totalCompletionTokens?: number; totalTokens?: number } | null>(null)
  const [compressing, setCompressing] = useState(false)
  // H3: Stable callback references for React.memo optimization
  const toggleExpand = useCallback((id: string) => setExpandedMsgs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }), [])
  const toggleThinking = useCallback((id: string) => setExpandedThinking(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }), [])
  const togglePlan = useCallback((id: string) => setExpandedPlans(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }), [])
  const handleContextMenu = useCallback((msgId: string, x: number, y: number) => setContextMenu({ msgId, x, y }), [])
  const scrollRef = useRef<HTMLDivElement>(null)

  const toggleSelectMsg = useCallback((id: string) => setSelectedMsgIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }), [])

  const deleteSelectedMsgs = () => {
    setMessages(prev => prev.filter(m => !selectedMsgIds.has(m.id)))
    setSelectedMsgIds(new Set())
  }

  const deleteSingleMsg = (msgId: string) => {
    setMessages(prev => prev.filter(m => m.id !== msgId))
  }

  const compressMessages = async (upToMsgId: string) => {
    if (!activeConfigId) { alert('请先配置AI模型'); return }
    const currentMsgs = activeConversation.messages
    const upToIndex = currentMsgs.findIndex(m => m.id === upToMsgId)
    if (upToIndex <= 0) return
    const toCompress = currentMsgs.slice(1, upToIndex + 1)
    const toKeep = currentMsgs.slice(upToIndex + 1)
    if (toCompress.length === 0) return

    setCompressing(true)
    try {
      // v4: Unified compression — ContextCompressor.buildCompressPrompt + aiService
      const compressor = new ContextCompressor()
      const { summaryContent, compressedCount, estimatedInputTokens } =
        await compressor.compressWithLLM(
          toCompress,
          (msgs, cid) => aiService.chatWithUsage(msgs, cid),
          activeConfigId!,
        )

      const summaryMsg: Message = {
        id: `compressed_${Date.now()}`,
        role: 'system',
        content: summaryContent,
        timestamp: Date.now(),
        compressedSummary: true,
        compressedCount,
        compressedTokens: estimatedInputTokens,
      }

      setMessages([currentMsgs[0], summaryMsg, ...toKeep])
    } catch (err) { logError('压缩对话失败', err); alert('压缩失败，请重试') }
    setCompressing(false)
    setContextMenu(null)
  }

  const activeConversation = conversations.find(c => c.id === activeConversationId) || conversations[0]
  const messages = activeConversation.messages

  const setMessages = (updater: Message[] | ((prev: Message[]) => Message[])) => {
    setConversations(prev => prev.map(c => {
      if (c.id !== activeConversationId) return c
      const newMessages = typeof updater === 'function' ? updater(c.messages) : updater
      const title = c.title === '新对话' ? getConvTitle(newMessages) : c.title
      return { ...c, messages: newMessages, title }
    }))
  }

  function getConvTitle(msgs: Message[]): string {
    const firstUser = msgs.find(m => m.role === 'user')
    return firstUser ? firstUser.content.slice(0, 30) + (firstUser.content.length > 30 ? '...' : '') : '新对话'
  }

  // Build history messages for the bridge: include user/assistant, and strip tool_calls without matching tool results
  function buildHistoryMessages(msgs: Message[]) {
    // Exclude welcome message, compression summaries, and display-only messages
    // displayOnly: 软件功能/能力自述 → 仅显示，不入 AI 上下文
    let filtered = msgs.filter(m =>
      (m.role === 'user' || m.role === 'assistant')
      && m.id !== 'welcome'
      && !(m as any).compressedSummary
      && !(m as any).displayOnly
    )
    // I6: Keep only last 20 user messages to prevent history bloat
    if (filtered.length > 40) {
      const userIndices: number[] = []
      filtered.forEach((m, i) => { if (m.role === 'user') userIndices.push(i) })
      if (userIndices.length > 20) filtered = filtered.slice(userIndices[userIndices.length - 20])
    }
    // If an assistant message has tool_calls, strip them (tool results are not in history)
    return filtered.map(m => {
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        return { role: m.role, content: m.content }
      }
      return { role: m.role, content: m.content }
    })
  }

  const abortToolLoop = () => { abortRef.current = true; bridgeRef.current?.abort(); aiService.abortStream(); setLoading(false) }
  const switchConversation = (convId: string) => { if (convId !== activeConversationId) { abortToolLoop(); bridgeRef.current?.destroy(); bridgeRef.current = null; useAgentStore.getState().endRun(); setActiveConversationId(convId); const conv = conversations.find(c => c.id === convId); setCumulativeTokens(conv?.totalTokens || 0); conversationToolNames.current = new Set(); pendingCorrection.current = null; autoRetryRef.current = false } }
  const handleNewConversation = () => { abortToolLoop(); const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; setConversations(prev => [...prev, makeConversation(id, '新对话')]); setActiveConversationId(id); setShowConvList(false); useAgentStore.getState().addTokens(-useAgentStore.getState().totalTokensUsed); setCumulativeTokens(0); conversationToolNames.current = new Set(); pendingCorrection.current = null; autoRetryRef.current = false }
  const handleClearConversation = () => { abortToolLoop(); const showWelcome = useSettingsStore.getState().aiSettings.showWelcome !== false; setMessages(showWelcome ? [{ ...WELCOME_MSG, id: `welcome_${activeConversationId}` }] : []); useAgentStore.getState().addTokens(-useAgentStore.getState().totalTokensUsed); setCumulativeTokens(0); conversationToolNames.current = new Set(); pendingCorrection.current = null; autoRetryRef.current = false; setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, totalTokens: 0, lastPromptTokens: 0, peakPromptTokens: 0 } : c)) }
  const handleDeleteConversation = (convId: string) => { abortToolLoop(); setConversations(prev => { const r = prev.filter(c => c.id !== convId); if (r.length === 0) { setActiveConversationId('default'); return [makeConversation('default', '新对话')] } if (convId === activeConversationId) setActiveConversationId(r[0].id); return r }) }

  // Dismiss context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = () => setContextMenu(null)
    window.addEventListener('click', dismiss)
    return () => window.removeEventListener('click', dismiss)
  }, [contextMenu])

  // Scroll to bottom when messages change, conversation switches, or window opens
  useEffect(() => {
    if (!isOpen) return
    // Double rAF ensures DOM layout is complete before measuring scrollHeight
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      })
    })
  }, [messages, isOpen])


  // ══════════════════════════════════════════════════════════════════
  // 文件上传系统 (三入口·一流程)
  // ══════════════════════════════════════════════════════════════════
  //
  // 三处入口看似重复，实为三种交互路径，共用一个 attachment 状态：
  //   1. handleDrop     — 拖拽文件/图片到输入框
  //   2. 文件按钮点击   — 点击"文件"按钮选择 TXT/MD
  //   3. 图片按钮点击   — 点击"图片"按钮选择图片
  //
  // 三者分别实现 Reader 逻辑是因为：拖拽的 file 对象来自 dataTransfer，
  // 按钮的 file 对象来自 input.files，API 不同但最终都设 attachment state。
  // 图片需额外 writeBinary 写 base64 到磁盘，文件直接写文本。
  // 合并为一个函数需处理两种来源×两种类型=4个分支，反而更乱。
  //
  // 附件存储流程（handleSend 中）：
  //   attachment.content → prepended to user message (发给 API)
  //   attachment.name   → preserved in message history summary only
  //   发送后 setAttachment(null) 清空
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.type.startsWith('image/')) {
      const r = new FileReader()
      r.onload = async () => {
        const base = (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, '')
        const uploadsDir = `${base}/uploads`
        try {
          await fileService.ensureDir(uploadsDir)
          const base64 = (r.result as string).split(',')[1] || r.result as string
          const ext = file.name.includes('.') ? file.name.split('.').pop()! : 'png'
          const fn = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}.${ext}`
          await fileService.writeBinary(`${uploadsDir}/${fn}`, base64)
          setAttachment({ type: 'image', name: fn, content: `[上传图片: ${fn}]`, previewUrl: r.result as string })
        } catch (e) { console.error('上传图片失败', e) }
      }
      r.readAsDataURL(file)
    } else {
      // Text file — save to uploads/files/ so AI can search and read_file
      // No truncation: full content preserved. fileService.write auto-caches via fileReadCache.
      const r = new FileReader()
      r.onload = async () => {
        const text = r.result as string
        if (!text.trim()) return
        try {
          await fileService.ensureDir('uploads/files')
          await fileService.write(`uploads/files/${file.name}`, text)
        } catch (e) { console.error('上传文件失败', e) }
        setAttachment({ type: 'file', name: file.name, content: text })
      }
      r.readAsText(file, 'UTF-8')
    }
  }

  // ── Agent mode refs ──
  const bridgeRef = useRef<V4AgentChatBridge | null>(null)

  // Cleanup bridge on component unmount
  useEffect(() => {
    return () => { bridgeRef.current?.destroy(); bridgeRef.current = null }
  }, [])

  // V9.5.2: 软件功能/能力自述消息不入上下文 — 仅显示，不发送给 API
  const pendingDisplayOnlyRef = useRef(false)
  // Patterns matching "软件功能" or "AI 能力" queries (same as selectDomainModules in V4SystemPrompt)
  const DISPLAY_ONLY_PATTERN = /你能做什么|你会什么|你有什么能力|AI助手能做什么|AI能做什么|软件有什么功能|软件说明|功能介绍|软件能做什么|这个软件是什么|软件功能/
  const isDisplayOnlyQuery = (msg: string) => DISPLAY_ONLY_PATTERN.test(msg)

  // Double-send guard — prevents race between async checkApiConnection and setLoading
  const sendLockRef = useRef(false)

  const handleSend = async () => {
    const isRetry = !!pendingCorrection.current
    if (!isRetry && (!input.trim() || !activeConfigId || loading)) return
    if (sendLockRef.current) return  // H8: prevent double-send during async gap
    sendLockRef.current = true

    // Pre-flight: verify API connectivity
    const connected = await checkApiConnection()
    if (!connected) { sendLockRef.current = false; return }

    setFileEditNotify(null)
    let attachText = ''
    if (attachment) {
      if (attachment.type === 'file') {
        // 文件保存到 uploads/files/，AI 通过 read_file 工具读取后分析
        const filePath = `uploads/files/${attachment.name}`
        try {
          await fileService.ensureDir('uploads/files')
          await fileService.write(filePath, attachment.content)
          attachText = `[上传文件: ${attachment.name}]\n文件已保存到 ${filePath}。请用 read_file 读取内容后分析。`
        } catch {
          attachText = `[上传文件: ${attachment.name}]\n${attachment.content.slice(0, 3000)}`
        }
      } else {
        // Save uploaded image to disk: uploads/images/
        const imgPath = `uploads/images/${attachment.name}`
        try {
          await fileService.ensureDir('uploads/images')
          const base64 = (attachment.previewUrl || '').split(',')[1]
          if (base64) {
            await fileService.writeBinary(imgPath, base64)
            attachText = `[上传图片: ${attachment.name}]\n图片已保存到 uploads/images/${attachment.name}。`
          } else {
            attachText = attachment.content
          }
        } catch {
          attachText = attachment.content
        }
      }
    }

    // Auto-save pasted text (>200 chars with no attachment) to disk
    // fileService.write auto-caches via shared fileReadCache
    // This ensures AI can reference it later even if conversation context is compressed
    let pasteClipPath = ''
    if (!attachment && input.trim().length > 200) {
      try {
        const ts = Date.now().toString(36)
        pasteClipPath = `uploads/clips/clip_${ts}.txt`
        await fileService.ensureDir('uploads/clips')
        await fileService.write(pasteClipPath, input.trim())
      } catch { pasteClipPath = '' }
    }

    const capturedInputLength = input.trim().length
    const pasteRef = pasteClipPath ? `[粘贴文本已保存: ${pasteClipPath}。要精准修改内容，使用 read_file("${pasteClipPath}") 读取后用 edit_file 替换。]\n\n` : ''
    const fullContent = isRetry ? pendingCorrection.current! : (attachText ? `${attachText}\n\n${input.trim()}` : pasteRef + input.trim())

    // V9.5.2: 软件功能/能力自述 → 仅显示，不入上下文
    const isDisplayOnly = !isRetry && !attachment && isDisplayOnlyQuery(input.trim())
    pendingDisplayOnlyRef.current = isDisplayOnly

    const msgId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const userMsg: Message = { id: msgId, role: 'user', content: fullContent, timestamp: Date.now(), ...(isDisplayOnly ? { displayOnly: true } : {}) }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setAttachment(null)
    setLoading(true)

    try {
      // H2: Read latest state from stores, not render closure
      const latestConfigId = useSettingsStore.getState().activeConfigId || activeConfigId
      const latestProjectId = useStore.getState().activeProjectId
      const latestKbEnabled = kbEnabled
      const latestWebSearch = webSearchEnabled
      const latestFileIds = latestKbEnabled ? (currentSelections[useStore.getState().activePage] || []) : []

      // ── Agent Runtime (replaces old while-loop + tool dispatch) ──
      if (!bridgeRef.current) {
        bridgeRef.current = new V4AgentChatBridge(latestProjectId)
        bridgeRef.current.init({ configId: latestConfigId!, projectId: latestProjectId, maxIterations: 30, historyMessages: buildHistoryMessages(messages), contextWindow: activeConfig?.contextWindow ?? 128000 })
      } else {
        bridgeRef.current.updateProject(latestProjectId)
        bridgeRef.current.updateHistory(buildHistoryMessages(messages))
      }
      let collectedText = ''
      const result = await bridgeRef.current.sendMessage(fullContent, {
        kbEnabled: latestKbEnabled, webSearchEnabled: latestWebSearch, selectedKbFileIds: latestFileIds,
        onResponse: (chunk) => { collectedText = chunk.accumulated },
        onComplete: (runResult) => {
          const fallbackText = runResult.toolsUsed.length > 0
            ? `已完成 ${runResult.toolsUsed.length} 个工具操作（${runResult.toolsUsed.join('、')}），但 AI 未生成文字回复。请说"继续"获取回复。`
            : `AI 未生成回复（可能 API 超时或模型未响应）。请重试或说"继续"。`
          // Token breakdown — initial context only (first API call).
          // Cumulative total = promptTokens across all iterations (includes tool results + assistant msgs)
          if (runResult.contextBreakdown && runResult.contextBreakdown.length > 0) {
            setTokenBreakdown([
              ...runResult.contextBreakdown.map(b => ({ label: b.domain, chars: b.tokens })),
              { label: `API输入 (${runResult.iterationCount || 1}轮)`, chars: runResult.promptTokens || 0 },
            ])
          }

          const ctxBreakdown = runResult.contextBreakdown?.map(b => ({ label: b.domain, chars: b.tokens * 2 })) || []
          // Show context composition + API-reported actuals (not double-counted)
          const inputBreakdown = [
            ...ctxBreakdown,
            { label: `API输入 (${runResult.iterationCount}轮)`, chars: (runResult.promptTokens || 0) * 2 },
            { label: 'API输出', chars: (runResult.completionTokens || 0) * 2 },
          ].filter(b => b.chars > 0)

          const outputBreakdown: { label: string; tokens: number }[] = []
          outputBreakdown.push({ label: 'AI 输出', tokens: runResult.completionTokens || 0 })
          // V9.5.2: 软件功能/能力自述 → 仅显示，不入上下文
          const markDisplayOnly = pendingDisplayOnlyRef.current
          pendingDisplayOnlyRef.current = false

          setMessages(prev => [...prev, {
            id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_r`, role: 'assistant', content: collectedText || runResult.text || fallbackText, timestamp: Date.now(),
            toolsUsed: runResult.toolsUsed,
            breakdown: inputBreakdown,
            outputBreakdown,
            iterationCount: runResult.iterationCount || 1,
            usage: runResult.totalTokens > 0 ? { prompt_tokens: runResult.promptTokens || 0, completion_tokens: runResult.completionTokens || 0, total_tokens: runResult.totalTokens, cost: 0 } : undefined,
            totalIterations: runResult.iterationCount || 1,
            ...(markDisplayOnly ? { displayOnly: true } : {}),
          }])
        },
        onApprovalRequired: async (tools) => {
          return new Promise<boolean>((resolve) => {
            approvalResolveRef.current = resolve
            setPendingApproval(tools)
          })
        },
      })
      // C1: Use functional updater to avoid stale closure on cumulativeTokens
      setCumulativeTokens(prev => {
        const newTotal = prev + (result.totalTokens || 0)
        setConversations(innerPrev => innerPrev.map(c => c.id === activeConversationId ? { ...c, totalTokens: newTotal } : c))
        return newTotal
      })
      useAgentStore.getState().addTokens(result.totalTokens)
    } catch (err) {
      const errDisplayOnly = pendingDisplayOnlyRef.current
      pendingDisplayOnlyRef.current = false
      setMessages(prev => [...prev, { id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_e`, role: 'assistant', content: `错误: ${err instanceof Error ? err.message : 'Unknown'}`, timestamp: Date.now(), ...(errDisplayOnly ? { displayOnly: true } : {}) }])
    } finally {
      setLoading(false)
      sendLockRef.current = false
    }
  }

  // @ reference handling

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
    <>
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          style={{
            position: 'fixed', bottom: winPos.bottom, right: winPos.right, width: winSize.width, height: winSize.height,
            borderRadius: 24, background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.6)', boxShadow: '0 16px 64px rgba(0,0,0,0.12)',
            display: 'flex', flexDirection: 'column', zIndex: 101, overflow: 'hidden',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(0,0,0,0.1)' }}>
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
                  {[...conversations].reverse().map(conv => (
                    <div key={conv.id} onClick={(e) => { e.stopPropagation(); switchConversation(conv.id) }} style={{
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
          <div style={{ display: 'flex', gap: 6, padding: '8px 18px', borderBottom: '1px solid rgba(0,0,0,0.04)', background: 'rgba(0,0,0,0.1)', flexWrap: 'wrap', alignItems: 'center' }}>
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
            {/* Plan/Action toggle */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <div style={{ display: 'inline-flex', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                <button onClick={() => useSettingsStore.getState().setAISettings({ workMode: 'plan' })} style={{ padding: '4px 10px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: aiSettings.workMode === 'plan' ? 700 : 400, background: aiSettings.workMode === 'plan' ? 'rgba(22,163,74,0.12)' : 'transparent', color: aiSettings.workMode === 'plan' ? '#16a34a' : '#9b8e84', fontFamily: 'inherit' }}>Plan</button>
                <button onClick={() => useSettingsStore.getState().setAISettings({ workMode: 'action' })} style={{ padding: '4px 10px', border: 'none', borderLeft: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', fontSize: 11, fontWeight: aiSettings.workMode === 'action' ? 700 : 400, background: aiSettings.workMode === 'action' ? 'rgba(217,119,6,0.12)' : 'transparent', color: aiSettings.workMode === 'action' ? '#d97706' : '#d4ccc4', fontFamily: 'inherit' }}>Action</button>
              </div>
            </div>
            {/* Temperature quick control — adjusts model creativity. API reads from electron-store on each call. */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 4px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', background: '#fff' }}
              title={`温度: ${activeConfig?.temperature?.toFixed(1) ?? '0.8'} — 越高回复越随机/有创意，越低越确定/保守`}>
              <button onClick={async () => {
                if (!activeConfig) return
                const newTemp = Math.max(0, +(activeConfig.temperature || 0.8).toFixed(1) - 0.1)
                useSettingsStore.getState().updateConfig(activeConfig.id, { temperature: newTemp })
                await settingsService.saveConfigs(useSettingsStore.getState().configs) // API keys encrypted via safeStorage before disk write
              }} style={{ padding: '1px 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10, color: '#9b8e84', fontFamily: 'inherit', lineHeight: 1 }}>−</button>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', minWidth: 36, textAlign: 'center', cursor: 'default' }}>
                {activeConfig?.temperature?.toFixed(1) ?? '0.8'}°C
              </span>
              <button onClick={async () => {
                if (!activeConfig) return
                const newTemp = Math.min(2, +(activeConfig.temperature || 0.8).toFixed(1) + 0.1)
                useSettingsStore.getState().updateConfig(activeConfig.id, { temperature: newTemp })
                await settingsService.saveConfigs(useSettingsStore.getState().configs) // API keys encrypted via safeStorage before disk write
              }} style={{ padding: '1px 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10, color: '#9b8e84', fontFamily: 'inherit', lineHeight: 1 }}>+</button>
            </div>
            <ToggleButton icon={<GlobeAltIcon style={{ width: 12, height: 12 }} />} label="联网搜索" active={webSearchEnabled} onClick={() => setWebSearchEnabled(!webSearchEnabled)} />
            <ToggleButton
              icon={<span style={{ fontSize: 12 }}>🔧</span>}
              label={`调用工具${conversationToolNames.current.size > 0 ? ` · ${conversationToolNames.current.size}` : ''}`}
              active={toolInvokeEnabled}
              onClick={() => { setToolInvokeEnabled(!toolInvokeEnabled); if (!toolInvokeEnabled) setShowToolHint(false) }}
            />
            {/* 上传入口②：按钮 → 文本文件。存到 uploads/files/，fileService.write 自动缓存。 */}
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.txt,.md,.text'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = async () => { const text = r.result as string; if (!text.trim()) return; try { await fileService.ensureDir('uploads/files'); await fileService.write(`uploads/files/${f.name}`, text) } catch (e) { console.error('上传文件失败', e) }; setAttachment({ type: 'file', name: f.name, content: text }) }; r.readAsText(f, 'UTF-8') }; inp.click() }} title="上传文本文件" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 8, border: attachment?.type === 'file' ? '1px solid rgba(124,58,237,0.25)' : '1px solid rgba(0,0,0,0.06)', background: attachment?.type === 'file' ? 'rgba(124,58,237,0.06)' : '#fff', color: '#6b5e54', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><DocumentTextIcon style={{ width: 11, height: 11 }} /> 文件</button>
            {/* 上传入口③：按钮 → 图片。流程同 handleDrop 的图片分支，见上方注释 */}
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = async () => { const base = (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, ''); const uploadsDir = `${base}/uploads`; try { await fileService.ensureDir(uploadsDir); const base64 = (r.result as string).split(',')[1] || r.result as string; const ext = f.name.includes('.') ? f.name.split('.').pop()! : 'png'; const fn = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}.${ext}`; await fileService.writeBinary(`${uploadsDir}/${fn}`, base64); setAttachment({ type: 'image', name: fn, content: `[上传图片: ${fn}]`, previewUrl: r.result as string }) } catch (e) { console.error('上传图片失败', e) } }; r.readAsDataURL(f) }; inp.click() }} title="上传图片" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 8, border: attachment?.type === 'image' ? '1px solid rgba(124,58,237,0.25)' : '1px solid rgba(0,0,0,0.06)', background: attachment?.type === 'image' ? 'rgba(124,58,237,0.06)' : '#fff', color: '#6b5e54', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><PhotoIcon style={{ width: 11, height: 11 }} /> 图片</button>
            {/* Model switcher */}
            <select
              value={activeConfigId || ''}
              onChange={e => {
                const newId = e.target.value
                if (newId) useSettingsStore.getState().setActiveConfig(newId)
              }}
              style={{
                padding: '3px 6px', borderRadius: 6,
                border: '1px solid rgba(0,0,0,0.1)', fontSize: 10,
                color: '#4a3f38', background: '#fff', cursor: 'pointer',
                fontFamily: 'inherit', maxWidth: 150,
              }}
              title="切换模型配置"
            >
              {configs.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name || c.model}
                </option>
              ))}
            </select>
          </div>

          <ContextUsageBar
            usedTokens={cumulativeTokens}
            contextWindow={activeConfig?.contextWindow ?? 128000}
            breakdown={tokenBreakdown}
            onCompress={() => {
              // Compress oldest messages, keeping last 20
              const msgs = activeConversation.messages
              if (msgs.length <= 21) return // welcome + 20 messages
              const targetMsg = msgs[msgs.length - 21] // keep last 20 messages
              compressMessages(targetMsg.id)
            }}
          />

          {/* Delete bar */}
          {selectedMsgIds.size > 0 && (
            <div style={{ padding: '4px 18px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(239,68,68,0.15)', background: 'rgba(239,68,68,0.04)' }}>
              <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>已选 {selectedMsgIds.size} 条</span>
              <button onClick={deleteSelectedMsgs} style={{ padding: '3px 12px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)', background: '#fff', color: '#dc2626', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>删除选中</button>
              <button onClick={() => setSelectedMsgIds(new Set())} style={{ padding: '3px 8px', borderRadius: 6, border: 'none', background: 'transparent', color: '#9b8e84', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>取消</button>
            </div>
          )}

          {/* Messages */}
          <VirtualMessageList
            messages={messages}
            renderMessage={(msg, i, prevMsg) => {
              // prevMsg is passed by VirtualMessageList when virtualized, or null otherwise
              const prev = prevMsg ?? (i > 0 ? messages[i - 1] : null)
              const isFirst = i === 0
              const hasGap = msg.timestamp && prev?.timestamp && (msg.timestamp - prev.timestamp > 3 * 60 * 1000)
              const showTime = msg.timestamp && (isFirst || hasGap)
              const timeStr = fmtTime(msg.timestamp!)
              const timeSep = showTime ? (
                <div key={`t_${msg.id}`} style={{ textAlign: 'center', padding: '14px 0 10px', fontSize: 12, color: '#b0a89e', letterSpacing: 0.5 }}>
                  {fmtTime(msg.timestamp!)}
                </div>
              ) : null

              // Format tool messages as Chinese summary instead of raw JSON
              let displayContent = msg.content
              const toolLabel = msg.toolName || ''
              if (msg.role === 'tool') {
                try {
                  const parsed = JSON.parse(msg.content)
                  const statusIcon = parsed.status === 'error' ? '✗' : '✓'
                  displayContent = `${statusIcon} [${toolLabel}] ${parsed.summary || '操作完成'}`
                  if (parsed.detail) displayContent += `\n${parsed.detail}`
                } catch { /* keep raw content if not valid JSON */ }
              }
              // Show tool call names for assistant messages that only contain tool_calls
              const isToolCallOnly = msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0 && !msg.content?.trim()

              // Compressed summary card — rendered instead of regular bubble
              if (msg.compressedSummary) {
                const timeSep = showTime ? (
                  <div key={`ts_${msg.id}`} style={{ textAlign: 'center', margin: '10px 0' }}>
                    <span style={{ fontSize: 10, color: '#9b8e84', background: 'rgba(0,0,0,0.03)', padding: '2px 10px', borderRadius: 10 }}>
                      {fmtTime(msg.timestamp!)}
                    </span>
                  </div>
                ) : null
                return (
                  <div key={`w_${msg.id}`}>
                    {timeSep}
                    <div onContextMenu={e => { e.preventDefault(); handleContextMenu(msg.id, e.clientX, e.clientY) }}
                      style={{ background: selectedMsgIds.has(msg.id) ? 'rgba(124,58,237,0.04)' : 'transparent', borderRadius: 8 }}>
                      <div style={{
                        margin: '0 18px 10px', padding: '12px 16px', borderRadius: 12,
                        background: 'rgba(124,58,237,0.04)', border: '1px solid rgba(124,58,237,0.12)',
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', marginBottom: 6 }}>
                          📦 已压缩 {msg.compressedCount || '?'} 条消息
                          {msg.compressedTokens ? `（节省约 ${(msg.compressedTokens / 1000).toFixed(1)}K tokens）` : ''}
                        </div>
                        <div style={{ fontSize: 12, color: '#4a3f38', lineHeight: 1.7 }}>{msg.content}</div>
                      </div>
                    </div>
                  </div>
                )
              }

              return (
              <div key={`w_${msg.id}`}>
                {timeSep}
                {/* Compressed summary card — msg.compressedSummary already handled above, this is for context menu on body */}
              <div onContextMenu={e => { e.preventDefault(); handleContextMenu(msg.id, e.clientX, e.clientY) }}
                style={{ background: (selectedMsgIds.has(msg.id) || contextMenu?.msgId === msg.id) ? 'rgba(124,58,237,0.04)' : 'transparent', borderRadius: 8, transition: 'background 0.15s' }}>
                {/* Tool call indicator for assistant messages with tool_calls but no text */}
                {isToolCallOnly && (
                  <div style={{ padding: '4px 0 4px 36px' }}>
                    {msg.tool_calls!.map((tc: any, i: number) => (
                      <span key={i} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 6, marginBottom: 4,
                        padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 600,
                        background: 'rgba(124,58,237,0.06)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.12)',
                      }}>🔧 {tc.function?.name || '工具调用'}</span>
                    ))}
                  </div>
                )}

                {/* Regular message bubble (hide for tool-call-only assistant msgs) */}
                {!isToolCallOnly && (
                <div style={{ display: 'flex', gap: 8, marginBottom: msg.role === 'assistant' ? 4 : 14, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, overflow: 'hidden' }}>
                    {msg.role === 'user'
                      ? (aiSettings.userAvatar ? <img src={aiSettings.userAvatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '✍️')
                      : msg.role === 'tool' ? '🔧'
                      : (aiSettings.assistantAvatar ? <img src={aiSettings.assistantAvatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '📖')
                    }
                  </div>
                  <div className="msg-bubble" style={{
                    maxWidth: '82%', padding: '10px 14px', borderRadius: 16,
                    background: msg.role === 'user' ? 'rgba(124,58,237,0.08)'
                      : msg.role === 'tool' ? 'rgba(22,163,74,0.04)'
                      : (msg.toolsUsed && msg.toolsUsed.length > 0) ? 'rgba(22,163,74,0.06)'
                      : msg.role === 'assistant' ? 'rgba(22,163,74,0.04)'  // API调用，无工具
                      : '#ffffff',
                    border: msg.role === 'tool' ? '1px solid rgba(22,163,74,0.1)'
                      : (msg.toolsUsed && msg.toolsUsed.length > 0) ? '1px solid rgba(22,163,74,0.15)'
                      : msg.role === 'assistant' ? '1px solid rgba(22,163,74,0.08)'  // API调用标记
                      : undefined,
                    fontSize: msg.role === 'tool' ? 11 : 13, lineHeight: 1.6, color: '#2d2520', whiteSpace: 'pre-wrap',
                  }}>
                    {/* Hallucination warning banner */}
                    {msg.hallucinationWarning && (
                      <div style={{
                        marginBottom: 10, padding: '10px 14px', borderRadius: 10,
                        background: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(234,179,8,0.06))',
                        border: '1px solid rgba(239,68,68,0.2)',
                        fontSize: 12, lineHeight: 1.6, color: '#dc2626',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 16 }}>⚠️</span>
                          <span style={{ fontWeight: 700 }}>检测到 AI 可能未执行操作</span>
                        </div>
                        <div style={{ color: '#991b1b', marginBottom: 6 }}>{msg.hallucinationWarning}</div>
                        <button onClick={() => { if (!toolInvokeEnabled) setToolInvokeEnabled(true); pendingCorrection.current = `[纠错指令] 你上一条回复中声称执行了操作但实际没有调用工具。现在请立即调用对应工具完成。`; setTimeout(() => handleSend(), 200) }} style={{
                          padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                          background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer',
                        }}>🔄 重试（开启调用工具模式）</button>
                      </div>
                    )}
                    {/* Collapsible long content */}
                    {(() => {
                      const isLong = (msg.role === 'assistant' && !msg.tool_calls || msg.role === 'tool') && displayContent.length > 550
                      if (!isLong) return displayContent
                      const isExpanded = expandedMsgs.has(msg.id)
                      return (
                        <div>
                          <div style={{ marginBottom: isExpanded ? 8 : 0, maxHeight: isExpanded ? 400 : undefined, overflowY: isExpanded ? 'auto' : undefined }}>
                            {isExpanded ? displayContent : displayContent.slice(0, 380) + '...'}
                          </div>
                          <button onClick={() => toggleExpand(msg.id)} style={{
                            background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#7c3aed', fontWeight: 600,
                            padding: '2px 0', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3,
                          }}>
                            {isExpanded ? '收起 ▲' : '展开全文 ▼'}
                          </button>
                        </div>
                      )
                    })()}
                  </div>
                </div>
                )}
                {/* === reasoning_content: DeepSeek native chain-of-thought (collapsed by default) === */}
                {msg.reasoningContent && msg.role === 'assistant' && (
                  <div style={{ marginLeft: 52, marginBottom: 4 }}>
                    <button onClick={() => toggleThinking(msg.id)} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '5px 10px', borderRadius: 8,
                      border: '1px solid rgba(124,58,237,0.12)',
                      background: expandedThinking.has(msg.id) ? 'rgba(124,58,237,0.04)' : 'rgba(0,0,0,0.02)',
                      color: '#7c3aed', fontSize: 10, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                      <span style={{ fontSize: 12 }}>{expandedThinking.has(msg.id) ? '🧠' : '💭'}</span>
                      思考过程 {expandedThinking.has(msg.id) ? '▾' : '▸'}
                    </button>
                    {expandedThinking.has(msg.id) && (
                      <div style={{
                        marginTop: 3, padding: '8px 12px', borderRadius: 8,
                        background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.08)',
                        fontSize: 11, color: '#6b5e54', lineHeight: 1.7,
                        maxHeight: 260, overflowY: 'auto', whiteSpace: 'pre-wrap',
                      }} className="custom-scrollbar">
                        {msg.reasoningContent}
                      </div>
                    )}
                  </div>
                )}

                {/* === thinkingPlan: parsed plan block (collapsed by default) === */}
                {msg.thinkingPlan && msg.role === 'assistant' && (
                  <div style={{ marginLeft: 52, marginBottom: 5 }}>
                    <button onClick={() => togglePlan(msg.id)} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '5px 10px', borderRadius: 8,
                      border: '1px solid rgba(22,163,74,0.15)',
                      background: expandedPlans.has(msg.id) ? 'rgba(22,163,74,0.04)' : 'rgba(0,0,0,0.02)',
                      color: '#16a34a', fontSize: 10, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                      <span style={{ fontSize: 12 }}>📋</span>
                      执行计划 ({msg.thinkingPlan.steps.length}步)
                      {msg.thinkingPlan.intent ? ` · ${msg.thinkingPlan.intent.slice(0, 30)}${msg.thinkingPlan.intent.length > 30 ? '...' : ''}` : ''}
                      {' '}{expandedPlans.has(msg.id) ? '▾' : '▸'}
                    </button>
                    {expandedPlans.has(msg.id) && (
                      <div style={{
                        marginTop: 3, padding: '10px 14px', borderRadius: 8,
                        background: 'rgba(22,163,74,0.03)', border: '1px solid rgba(22,163,74,0.08)',
                        fontSize: 12, color: '#2d2520', lineHeight: 1.8,
                      }}>
                        {msg.thinkingPlan.intent && (
                          <div style={{ marginBottom: 8, fontSize: 11, color: '#6b5e54', fontStyle: 'italic' }}>
                            意图: {msg.thinkingPlan.intent}
                          </div>
                        )}
                        {msg.thinkingPlan.files.length > 0 && (
                          <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                            <span style={{ fontSize: 10, color: '#9b8e84' }}>涉及:</span>
                            {msg.thinkingPlan.files.map((f: string) => (
                              <span key={f} style={{ padding: '1px 7px', borderRadius: 6, fontSize: 10, background: 'rgba(0,0,0,0.04)', color: '#4a3f38', fontFamily: 'monospace' }}>{f}</span>
                            ))}
                          </div>
                        )}
                        {msg.thinkingPlan.steps.map((step: { tool: string; action: string }, i: number) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 8,
                            padding: i > 0 ? '3px 0' : '0',
                          }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 18, height: 18, borderRadius: '50%',
                              background: 'rgba(22,163,74,0.1)', color: '#16a34a',
                              fontSize: 9, fontWeight: 700, flexShrink: 0, marginTop: 1,
                            }}>{i + 1}</span>
                            <span>
                              {step.tool ? (
                                <span style={{
                                  display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                                  fontSize: 10, fontWeight: 700, marginRight: 6,
                                  background: 'rgba(124,58,237,0.08)', color: '#7c3aed',
                                }}>{step.tool}</span>
                              ) : null}
                              {step.action}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Usage footer — only on assistant messages */}
                {msg.role === 'assistant' && msg.usage && (
                  <div style={{ marginLeft: 36, marginTop: 2, marginBottom: 2, display: 'flex', gap: 10, fontSize: 10, color: '#9b8e84' }}>
                    <span>入 {msg.usage.prompt_tokens?.toLocaleString()} | 出 {msg.usage.completion_tokens?.toLocaleString()} | 合计 {msg.usage.total_tokens?.toLocaleString()}</span>
                    {(msg.usage as any).cacheHitTokens > 0 && (
                      <span style={{ color: '#16a34a', fontWeight: 600 }}>
                        🟢 缓存命中 {(msg.usage as any).cacheHitTokens.toLocaleString()} tok
                      </span>
                    )}
                    {msg.usage.cost > 0 && <span>花费 {activeConfig?.currency === 'CNY' ? '¥' : '$'}{msg.usage.cost.toFixed(4)}</span>}
                  </div>
                )}
                {/* Tool usage summary — shows which tools were called in this response */}
                {msg.role === 'assistant' && msg.toolsUsed && msg.toolsUsed.length > 0 && (
                  <div style={{ marginLeft: 36, marginTop: 4, marginBottom: 4, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 9, color: '#9b8e84', marginRight: 2 }}>使用:</span>
                    {msg.toolsUsed.map((name: string) => (
                      <span key={name} style={{
                        padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                        background: 'rgba(124,58,237,0.06)', color: '#7c3aed',
                        border: '1px solid rgba(124,58,237,0.1)',
                      }}>{name}</span>
                    ))}
                  </div>
                )}
                {/* Images */}
                {msg.images && msg.images.map((img: string, i: number) => (
                  <div key={i} style={{ marginLeft: 36, marginTop: 4, marginBottom: 4 }}>
                    <img src={img} alt={`AI图片${i+1}`}
                      onClick={() => setLightboxImage(img)}
                      style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)', cursor: 'pointer' }} />
                  </div>
                ))}
                {/* Plan reminder banner */}
                {msg.role === 'assistant' && aiSettings.workMode === 'plan' && msg.content.length > 400 && /文件|修改|编辑|写入|创建|删除|章节|大纲|细纲|替换|改写|目录|备份|项目/.test(msg.content) && (
                  <div style={{ marginLeft: 36, marginBottom: 8, padding: '6px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', fontSize: 11, color: '#b45309', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ExclamationTriangleIcon style={{ width: 14, height: 14, flexShrink: 0 }} />
                    <span>Plan 模式 — 如需执行上述建议，请切换到</span>
                    <button onClick={() => useSettingsStore.getState().setAISettings({ workMode: 'action' })} style={{ fontWeight: 700, color: '#7c3aed', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 11 }}>Action 执行模式</button>
                  </div>
                )}

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
              </div>
            )
          }}
        />

          {/* Hook feedback + streaming + loading — rendered outside virtualizer (always visible) */}
          {agentHookFeedback && (
            <div style={{ padding: '4px 12px', borderRadius: 6, margin: '8px 18px', fontSize: 11, background: agentHookFeedback.passed ? 'rgba(22,163,74,0.06)' : 'rgba(220,38,38,0.06)', border: `1px solid ${agentHookFeedback.passed ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.15)'}`, color: agentHookFeedback.passed ? '#16a34a' : '#dc2626', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12 }}>{agentHookFeedback.passed ? '✓' : '✗'}</span>
              <span style={{ fontWeight: 600 }}>{agentHookFeedback.hookName}</span>
              <span style={{ color: '#6b5e54' }}>{agentHookFeedback.feedback}</span>
            </div>
          )}
          {agentIsStreaming && <StreamingMessage content={agentStreamingText} />}
          {loading && (
            <div style={{ textAlign: 'center', padding: 6 }}>
              <button onClick={abortToolLoop} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 20, border: '1px solid rgba(220,38,38,0.25)', background: '#fff', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#dc2626' }} />
                停止生成
              </button>
            </div>
          )}

          <AgentStatusBar />
          <DiagnosticPanel />

          {/* Input */}
          <div className="glass" style={{ padding: '10px 14px', borderTop: '1px solid rgba(0,0,0,0.06)', position: 'relative' }}>
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
            {attachment && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 12, background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', fontSize: 12, color: '#7c3aed' }}>
                {attachment.previewUrl
                  ? <img src={attachment.previewUrl} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />
                  : (attachment.type === 'file' ? <DocumentTextIcon style={{ width: 14, height: 14 }} /> : <PhotoIcon style={{ width: 14, height: 14 }} />)
                }
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{attachment.name}</span>
                <button onClick={() => setAttachment(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', padding: 0, fontSize: 16, lineHeight: 1, flexShrink: 0 }}>×</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, position: 'relative' }}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {dragOver && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 5, borderRadius: 14, border: '2px dashed #7c3aed', background: 'rgba(124,58,237,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#7c3aed', fontWeight: 600, pointerEvents: 'none' }}>
                  松手以上传文件或图片
                </div>
              )}
              <textarea value={input} onChange={e => handleInputChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder={activeConfigId ? '输入消息...' : '请先在设置中配置模型'}
              disabled={!activeConfigId} rows={2}
              className="focus-ring"
              style={{ flex: 1, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, outline: 'none', resize: 'none', padding: '8px 12px', fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit', color: '#2d2520', background: 'rgba(0,0,0,0.02)' }}
            />
            <button onClick={handleSend} disabled={!input.trim() || !activeConfigId || loading}
              style={{ width: 38, height: 38, borderRadius: 12, border: 'none', background: input.trim() && activeConfigId ? '#7c3aed' : '#e5e0da', color: '#fff', cursor: input.trim() && activeConfigId ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-end' }}>
              <PaperAirplaneIcon style={{ width: 17, height: 17 }} />
            </button>
          </div>
            {/* API connection error banner */}
            {apiError && (
              <div style={{
                marginBottom: 8, padding: '8px 14px', borderRadius: 10,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                fontSize: 11, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ fontSize: 14 }}>⚠️</span>
                <span style={{ flex: 1 }}>{apiError}</span>
                <button onClick={() => setApiError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', fontSize: 14 }}>✕</button>
              </div>
            )}
            {/* Smart tool hint */}
            {showToolHint && (
              <div style={{
                padding: '4px 12px', fontSize: 11, color: '#b45309',
                background: 'rgba(245,158,11,0.06)', borderRadius: 8,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span>💡 你的消息包含操作意图，但AI近期未调用工具。</span>
                <button onClick={() => setToolInvokeEnabled(true)} style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                  background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer',
                }}>开启🔧</button>
                <span style={{ color: '#9b8e84' }}>或输入"调用工具"</span>
              </div>
            )}
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
          {/* 4 edges + 4 corners resize handles */}
          {(['top','bottom','left','right','top-left','top-right','bottom-left','bottom-right'] as const).map(corner => {
            const isEdge = corner === 'top' || corner === 'bottom' || corner === 'left' || corner === 'right'
            return (
            <div key={corner} onMouseDown={handleResizeStart(corner)} style={{
              position: 'absolute',
              top: corner.includes('top') ? 0 : undefined,
              bottom: corner.includes('bottom') ? 0 : undefined,
              left: corner.includes('left') ? 0 : undefined,
              right: corner.includes('right') ? 6 : undefined,
              // Edge handles don't cover scrollbar area (right side 6px offset for scrollbar)
              width: isEdge ? (corner === 'top' || corner === 'bottom' ? 'calc(100% - 16px)' : (corner === 'right' ? 4 : 8)) : 16,
              height: isEdge ? (corner === 'left' || corner === 'right' ? 'calc(100% - 16px)' : (corner === 'bottom' ? 4 : 8)) : 16,
              marginTop: (corner === 'left' || corner === 'right') ? 8 : 0,
              cursor: corner === 'top' || corner === 'bottom' ? 'ns-resize'
                : corner === 'left' || corner === 'right' ? 'ew-resize'
                : corner === 'top-left' || corner === 'bottom-right' ? 'nwse-resize' : 'nesw-resize',
              // Edge handles low z-index to not block scrollbar; corners high for grip indicator
              zIndex: isEdge ? 1 : 10,
            }}>
              {!isEdge && <svg width="12" height="12" viewBox="0 0 14 14"><path d="M0 14L14 0V3L3 14H0Z" fill="#9b8e84" opacity="0.3"/></svg>}
            </div>
          )})}
        </motion.div>
      )}
    </AnimatePresence>
    {lightboxImage && <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />}
    {/* Right-click context menu */}
    {breakdownModal && (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(2px)',
      }} onClick={() => setBreakdownModal(null)}>
        <div style={{
          background: '#fff', borderRadius: 16, boxShadow: '0 16px 48px rgba(0,0,0,0.15)',
          padding: 24, maxWidth: 420, width: '90vw', maxHeight: '70vh', overflow: 'auto',
        }} onClick={e => e.stopPropagation()} className="custom-scrollbar">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>Token 分解</h3>
            <span style={{ fontSize: 10, color: '#9b8e84' }}>
              {breakdownModal.totalTokens && breakdownModal.totalTokens > (breakdownModal.inputBreakdown.reduce((s, b) => s + Math.round(b.chars / 2), 0) + (breakdownModal.outputBreakdown || []).reduce((s, b) => s + b.tokens, 0)) * 1.5
                ? '⚠ 含多轮 API 调用（Agent 反复思考+执行）'
                : '单轮 API 调用'}
            </span>
            <button onClick={() => setBreakdownModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
          </div>
          {/* ── 📥 INPUT ── */}
          <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', marginBottom: 6 }}>📥 输入 (Prompt)</div>
          {breakdownModal.inputBreakdown.map((b, i) => {
            const est = Math.round(b.chars / 2)
            const pct = breakdownModal.inputBreakdown.reduce((s, x) => s + Math.round(x.chars / 2), 0)
            const barW = pct > 0 ? Math.max(2, (est / pct) * 100) : 0
            return (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                  <span style={{ color: '#4a3f38' }}>{b.label}</span>
                  <span style={{ fontWeight: 600, color: '#2d2520' }}>~{est.toLocaleString()} tokens</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${barW}%`, borderRadius: 2, background: i === 0 ? '#7c3aed' : i === 1 ? '#16a34a' : i === 2 ? '#d97706' : '#6b5e54', transition: 'width 0.3s' }} />
                </div>
              </div>
            )
          })}
          <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
            <span style={{ color: '#7c3aed' }}>输入合计（估算）</span>
            <span>~{breakdownModal.inputBreakdown.reduce((s, b) => s + Math.round(b.chars / 2), 0).toLocaleString()} tokens</span>
          </div>
          {breakdownModal.totalPromptTokens !== undefined && breakdownModal.totalPromptTokens > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, marginTop: 2, color: '#7c3aed' }}>
              <span>API 实际 Prompt</span>
              <span>{breakdownModal.totalPromptTokens.toLocaleString()} tokens</span>
            </div>
          )}
          {/* ── 📤 OUTPUT ── */}
          <div style={{ marginTop: 16, borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#16a34a', marginBottom: 6 }}>📤 输出 (Completion)</div>
            {breakdownModal.outputBreakdown && breakdownModal.outputBreakdown.length > 0 ? breakdownModal.outputBreakdown.map((b, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
                <span style={{ color: '#4a3f38' }}>{b.label}</span>
                <span style={{ fontWeight: 600, color: '#16a34a' }}>~{b.tokens.toLocaleString()} t</span>
              </div>
            )) : (
              <div style={{ fontSize: 10, color: '#9b8e84' }}>（流式输出，无独立统计）</div>
            )}
            <div style={{ borderTop: '1px solid rgba(22,163,74,0.15)', paddingTop: 6, marginTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
              <span style={{ color: '#16a34a' }}>输出合计（估算）</span>
              <span style={{ color: '#16a34a' }}>~{breakdownModal.outputBreakdown.reduce((s, b) => s + b.tokens, 0).toLocaleString()} tokens</span>
            </div>
            {breakdownModal.totalCompletionTokens != null && breakdownModal.totalCompletionTokens > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginTop: 1, color: '#9b8e84' }}>
                <span>API 实际 Completion</span>
                <span>{breakdownModal.totalCompletionTokens.toLocaleString()} tokens</span>
              </div>
            )}
          </div>

          {/* ── 💰 TOTAL ── */}
          {(() => {
            const estInput = breakdownModal.inputBreakdown.reduce((s, b) => s + Math.round(b.chars / 2), 0)
            const estOutput = (breakdownModal.outputBreakdown || []).reduce((s, b) => s + b.tokens, 0)
            return (
              <>
                <div style={{ marginTop: 16, borderTop: '2px solid rgba(0,0,0,0.1)', paddingTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                    <span style={{ color: '#2d2520' }}>💰 本轮估算</span>
                    <span>~{(estInput + estOutput).toLocaleString()} tokens</span>
                  </div>
                  {breakdownModal.totalTokens != null && breakdownModal.totalTokens > 0 && (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800,
                      marginTop: 6, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.08)',
                    }}>
                      <span style={{ color: '#2d2520' }}>📊 全轮次实际消耗</span>
                      <span style={{ color: '#7c3aed' }}>{breakdownModal.totalTokens.toLocaleString()} tokens</span>
                    </div>
                  )}
                  {breakdownModal.totalTokens != null && breakdownModal.totalTokens > 0 && (
                    <div style={{ marginTop: 2, fontSize: 9, color: '#9b8e84' }}>
                      含全部 Agent 迭代的 {breakdownModal.totalTokens > 30000 ? '多轮' : ''} API 调用 + 对话历史
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 6, fontSize: 9, color: '#9b8e84' }}>
                  换算: 中~1.5字符/token, 英~4字符/token。本轮输入字符: {breakdownModal.inputBreakdown.reduce((s, b) => s + b.chars, 0).toLocaleString()}
                </div>
              </>
            )
          })()}
        </div>
      </div>
    )}
    {contextMenu && (
      <div style={{
        position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 200,
        background: '#fff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        border: '1px solid rgba(0,0,0,0.08)', padding: 4, minWidth: 180,
      }} onClick={e => e.stopPropagation()}>
        <button onClick={() => { deleteSingleMsg(contextMenu.msgId); setContextMenu(null) }} style={ctxMenuBtn}>
          <TrashIcon style={{ width: 13, height: 13 }} /> 删除此消息
        </button>
        <button onClick={() => compressMessages(contextMenu.msgId)} disabled={compressing} style={{ ...ctxMenuBtn, opacity: compressing ? 0.5 : 1 }}>
          <SparklesIcon style={{ width: 13, height: 13 }} /> {compressing ? '压缩中...' : '从此处向上压缩'}
        </button>
        <button onClick={() => { toggleSelectMsg(contextMenu.msgId); setContextMenu(null) }} style={ctxMenuBtn}>
          <Square2StackIcon style={{ width: 13, height: 13 }} /> 选择消息
        </button>
        {(() => {
          const msg = messages.find(m => m.id === contextMenu.msgId)
          if (msg?.breakdown) {
            return <button onClick={() => { setBreakdownModal({ inputBreakdown: (msg as any).breakdown || [], outputBreakdown: (msg as any).outputBreakdown || [], totalPromptTokens: msg.usage?.prompt_tokens, totalCompletionTokens: msg.usage?.completion_tokens, totalTokens: msg.usage?.total_tokens }); setContextMenu(null) }} style={ctxMenuBtn}>
              <MagnifyingGlassIcon style={{ width: 13, height: 13 }} /> 查看Token分解
            </button>
          }
          return null
        })()}
      </div>
    )}
    {/* Dangerous tool approval modal — replaces window.confirm() */}
    {pendingApproval && (
      <DangerousToolModal
        tools={pendingApproval}
        onResolve={(approved) => {
          approvalResolveRef.current?.(approved)
          approvalResolveRef.current = null
          setPendingApproval(null)
        }}
      />
    )}
    </>
  )
}

const ctxMenuBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  padding: '7px 12px', borderRadius: 8, border: 'none',
  background: 'transparent', cursor: 'pointer',
  fontSize: 12, color: '#2d2520', fontFamily: 'inherit',
  textAlign: 'left' as const, transition: 'background 0.1s',
}

const convBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)',
  background: '#fff', cursor: 'pointer', fontSize: 11, flexShrink: 0,
}


