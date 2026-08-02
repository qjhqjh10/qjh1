import React, { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, useSettingsStore } from '@/store'
import { aiService, kbService, fileService, settingsService } from '@/services/fileService'
import {
  XMarkIcon, PaperAirplaneIcon, SparklesIcon,
  BookOpenIcon, GlobeAltIcon,
  MagnifyingGlassIcon, ClipboardIcon, ArrowRightIcon,
  PlusIcon, ArrowPathIcon, ListBulletIcon,
  DocumentTextIcon, PhotoIcon,
  TrashIcon, Square2StackIcon, WrenchScrewdriverIcon, FolderOpenIcon,
} from '@heroicons/react/24/outline'
import { DEFAULT_AI_SETTINGS } from '@/types/settings'
import { logError } from '@/utils/logger'
import { debugApiError } from '@/services/debugLogService'
import { ContextUsageBar } from '@/components/ai/ContextUsageBar'
import ConfirmModal from '@/components/common/ConfirmModal'
import { useToast } from '@/components/common/Toast'
import { WELCOME_MSG, STORAGE_KEY, WINDOW_KEY } from '@/components/ai/chatConstants'
import type { Message, Conversation } from '@/components/ai/chatConstants'
import ImageLightbox from '@/components/common/ImageLightbox'
import { loadAvatar } from '@/utils/imageCompress'

import { makeConversation, parsePopupCommand, maybeInjectResume, maybeInjectSubagentSummaries, buildHistoryMessages, detectHallucination } from "./utils";
import { useWindowDrag } from "./hooks/useWindowDrag";
import type { IChatBridge } from '@/agent/ChatBridgeInterface'
import { createChatBridge } from '@/agent/ChatBridgeInterface'
import { ContextCompressor } from '@/agent/context/ContextCompressor'
import { estimateMessages } from '@/agent/utils/tokenEstimation'
import { useAgentStore } from '@/agent/store/AgentStore'
import { AgentStateBar } from './components/AgentStateBar'
import { DiagnosticPanel } from './components/DiagnosticPanel'
import { ToolDetailPanel } from './components/ToolDetailPanel'
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

// ── 文件引用提取：从消息的工具调用步骤中解析生成/修改过的文件 ──
const FILE_TOOLS = new Set(['create_file', 'edit_file', 'batch_replace', 'rename_file', 'kb_append_file'])

interface FileRef { path: string; tool: string }

function extractFileRefs(
  msg: { toolCallSteps?: any[] },
  activeProjectId: string | null,
  projectsBasePath: string,
): FileRef[] {
  const steps = msg?.toolCallSteps
  if (!Array.isArray(steps) || !projectsBasePath) return []
  const seen = new Set<string>()
  const refs: FileRef[] = []
  for (const step of steps) {
    const s = step as { tool?: string; status?: string; arguments?: string }
    if (!FILE_TOOLS.has(s.tool || '') || s.status !== 'success') continue
    let args: Record<string, unknown> | null = null
    try { args = s.arguments ? JSON.parse(s.arguments) : null } catch { /* 参数非 JSON */ }
    const rel = typeof args?.file_path === 'string' ? args.file_path
      : typeof args?.filePath === 'string' ? args.filePath
      : typeof args?.path === 'string' ? args.path
      : typeof args?.targetPath === 'string' ? args.targetPath
      : ''
    if (!rel) continue
    // 相对路径 → 绝对路径：已带项目前缀直接用，否则拼当前项目
    const abs = activeProjectId && rel.startsWith(activeProjectId + '/')
      ? `${projectsBasePath}/${rel}`
      : activeProjectId
        ? `${projectsBasePath}/${activeProjectId}/${rel}`
        : `${projectsBasePath}/${rel}`
    if (seen.has(abs)) continue
    seen.add(abs)
    refs.push({ path: abs, tool: s.tool || '' })
  }
  return refs
}

// ── Component ──

export default function AIChatWindow() {
  const isOpen = useStore(s => s.isAIChatOpen)
  const { toast } = useToast()

  const pendingMessage = useStore(s => s.pendingMessage)
  const setPendingMessage = useStore(s => s.setPendingMessage)

  // Check API connection when chat window opens
  useEffect(() => { if (isOpen) checkApiConnection() }, [isOpen])

  // 消费来自编辑器右键的 pendingMessage（发送到 AI 写作助手）
  useEffect(() => {
    if (isOpen && pendingMessage) {
      setInput(pendingMessage)
      setPendingMessage(null)
    }
  }, [isOpen, pendingMessage, setPendingMessage])
  const setAIChatOpen = useStore(s => s.setAIChatOpen)
  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)
  const activeProjectId = useStore(s => s.activeProjectId)
  const projectsBasePath = useStore(s => s.projectsBasePath)
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
  // v14.8: 选中态三态语义 — [] = 全部；['__none__'] = 不使用；其余 = 勾选的具体文件。
  // 外层"文件"按钮的选中样式必须区分这三态（此前 [] 与 ['__none__'] 均按 length 判断导致显示反了）
  const isKbNone = selectedFileIds.length === 1 && selectedFileIds[0] === '__none__'
  const isKbAll = selectedFileIds.length === 0
  const hasKbFileSelection = selectedFileIds.length > 0 && !isKbNone

  const loadKBFileList = async () => {
    try {
      setKbLoadError(false)
      const meta = await kbService.list() as { files: { id: string; originalName: string; projects: string[] }[] }
      // v13.x: 显示全部知识库文件，无需在项目内
      if (Array.isArray(meta?.files)) {
        setKbFiles(meta.files.map(f => ({ id: f.id, originalName: f.originalName })))
      } else { setKbFiles([]) }
    } catch (e) { logError('加载知识库文件列表失败', e); setKbLoadError(true); setKbFiles([]) }
  }

  // Action mode now works without a project (global notes, templates, KB)

  const toggleKBFile = (fileId: string) => {
    // v14.8: '不使用' 状态下勾选文件 → 从空集开始（此前残留 '__none__' 会传入 kb:search 使检索恒为空）
    const cur = (currentSelections[activePage] || []).filter(id => id !== '__none__')
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
  const [currentContextTokens, setCurrentContextTokens] = useState(0)  // v11.5.1: 当前消息的上下文用量（非累计）
  const [tokenBreakdown, setTokenBreakdown] = useState<{ label: string; chars: number }[]>([])

  const { winSize, setWinSize, winPos, setWinPos, handleResizeStart, handleDragStart, winStyle } = useWindowDrag(WINDOW_KEY);

  const [conversations, setConversations] = useState<Conversation[]>(() => {
    // Synchronous init: try localStorage as bootstrap fallback while IndexedDB loads async
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) { const p = JSON.parse(s) as Conversation[]; if (Array.isArray(p) && p.length > 0) return p } } catch { /* */ }
    return [makeConversation('default', '新对话')]
  })
  const [convsLoaded, setConvsLoaded] = useState(false)
  // v14.5.0: IndexedDB 写入失败提示节流（每会话至多一次）
  const idbFailNotifiedRef = useRef(false)
  const [activeConversationId, setActiveConversationId] = useState('default')
  const [convToDelete, setConvToDelete] = useState<string | null>(null)

  // Init 3: Load conversations from IndexedDB on mount and migrate localStorage
  useEffect(() => {
    let cancelled = false
    import('@/services/chatStorageService').then(async ({ loadConversations, loadLastActiveId, finalizeMigration, mergeConversations }) => {
      try {
        const stored = await loadConversations()
        if (cancelled) return
        if (stored.length > 0) {
          // v14.5.0: 合并而非覆盖——保留加载完成前用户已新建/更新的对话（原实现会丢失）
          setConversations(prev => mergeConversations(stored, prev))
          const lastId = await loadLastActiveId()
          const activeId = (lastId && stored.some(c => c.id === lastId)) ? lastId : stored[stored.length - 1].id
          setActiveConversationId(activeId)
          // v13.2.0: 恢复累计 token 和上下文估算（修复启动后进度条归零问题）
          const activeConv = stored.find(c => c.id === activeId)
          if (activeConv) {
            const savedTokens = activeConv.totalTokens || 0
            setCumulativeTokens(savedTokens)
            // 基于对话消息估算当前上下文占用（不含 system prompt，后续首次 API 调用后会更新为精确值）
            const msgEstimate = estimateMessages(activeConv.messages.filter(m => m.role !== 'tool'))
            // 加上系统提示词和工具定义的大致开销 (~3500 tokens)
            setCurrentContextTokens(msgEstimate > 0 ? msgEstimate + 3500 : savedTokens || 0)
          }
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
      const { idbOk } = await saveConversations(convs)
      // v14.5.0: IndexedDB 写入失败 → 每会话至多一次提示（文件镜像仍在写，数据不丢）
      if (!idbOk && !idbFailNotifiedRef.current) {
        idbFailNotifiedRef.current = true
        alert('对话已保存到本地镜像文件，但 IndexedDB 写入失败（存储配额可能已满）。对话不会丢失，但请在设置中清理空间。')
      }
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
  const conversationToolNames = useRef(new Set<string>())  // persists across messages within conversation
  const pendingCorrection = useRef<string | null>(null)  // hallucination auto-correction for next send
  const autoRetryRef = useRef(false)  // prevent infinite auto-retry loops
  const [attachment, setAttachment] = useState<{ type: 'file' | 'image'; name: string; content: string; previewUrl?: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<DangerousTool[] | null>(null)
  const approvalResolveRef = useRef<((approved: boolean) => void) | null>(null)
  // v14.5.0 审查修复: 审批超时（toolExecutorFactory 侧 60s 拒绝）后自动关闭弹窗——
  // 原实现弹窗残留，用户之后点"批准"会串扰下一个审批请求
  useEffect(() => {
    if (!pendingApproval) return
    const t = setTimeout(() => {
      approvalResolveRef.current?.(false)
      approvalResolveRef.current = null
      setPendingApproval(null)
    }, 60_000)
    return () => clearTimeout(t)
  }, [pendingApproval])


  const [showConvList, setShowConvList] = useState(false)
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set())
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set())
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set())
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ msgId: string; x: number; y: number } | null>(null)
  const [breakdownModal, setBreakdownModal] = useState<{ inputBreakdown: { label: string; chars: number }[]; outputBreakdown: { label: string; tokens: number }[]; totalPromptTokens?: number; totalCompletionTokens?: number; totalTokens?: number; cacheHitTokens?: number; cacheCreationTokens?: number } | null>(null)
  const [toolDetailPanel, setToolDetailPanel] = useState<{ toolsUsed: string[]; toolCallSteps?: Array<{ tool: string; status: string; summary: string; durationMs: number; iteration: number }>; breakdown?: { label: string; chars: number }[]; outputBreakdown?: { label: string; tokens: number }[]; iterationCount?: number; totalIterations?: number; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } } | null>(null)
  // 消息文件图标右键菜单（打开文件夹 / 打开文件）
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [charAvatarMap, setCharAvatarMap] = useState<Record<string, string>>({})
  const [compressing, setCompressing] = useState(false)
  // H3: Stable callback references for React.memo optimization
  const toggleExpand = useCallback((id: string) => setExpandedMsgs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }), [])
  const toggleThinking = useCallback((id: string) => setExpandedThinking(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }), [])
  const togglePlan = useCallback((id: string) => setExpandedPlans(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }), [])
  const handleContextMenu = useCallback((msgId: string, x: number, y: number) => setContextMenu({ msgId, x, y }), [])

  const toggleSelectMsg = useCallback((id: string) => setSelectedMsgIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }), [])

  const deleteSelectedMsgs = () => {
    setMessages(prev => prev.filter(m => !selectedMsgIds.has(m.id)))
    setSelectedMsgIds(new Set())
  }

  const deleteSingleMsg = (msgId: string) => {
    setMessages(prev => prev.filter(m => m.id !== msgId))
  }

  const compressMessages = async (upToMsgId: string) => {
    if (!activeConfigId) { toast('请先在系统设置中配置AI模型', 'warning'); return }
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
    } catch (err) { logError('压缩对话失败', err); toast('压缩失败，请重试', 'error') }
    setCompressing(false)
    setContextMenu(null)
  }

  const activeConversation = conversations.find(c => c.id === activeConversationId) || conversations[0]
  const messages = activeConversation.messages

  // v13.0: 预加载角色头像
  useEffect(() => {
    const tplId = activeConversation.roleTemplateId || useSettingsStore.getState().aiSettings.activeRoleTemplateId
    const tpl = tplId ? useSettingsStore.getState().aiSettings.roleTemplates?.find(t => t.id === tplId) : undefined
    if (!tpl) { setCharAvatarMap({}); return }
    const map: Record<string, string> = {}
    Promise.all(tpl.characters.map(async (c) => { if (c.avatar) try { map[c.id] = await loadAvatar(c.avatar) } catch { map[c.id] = "" } })).then(() => setCharAvatarMap({ ...map }))
  }, [activeConversation.roleTemplateId, useSettingsStore.getState().aiSettings.activeRoleTemplateId])

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


  const abortToolLoop = () => { bridgeRef.current?.abort(); aiService.abortStream(); setLoading(false) }
  const switchConversation = (convId: string) => { if (convId !== activeConversationId) { abortToolLoop(); bridgeRef.current?.destroy(); bridgeRef.current = null; useAgentStore.getState().endRun(); setActiveConversationId(convId); activeConvIdRef.current = convId; const conv = conversations.find(c => c.id === convId); const savedTokens = conv?.totalTokens || 0; setCumulativeTokens(savedTokens); const msgEstimate = conv ? estimateMessages(conv.messages.filter(m => m.role !== 'tool')) : 0; setCurrentContextTokens(msgEstimate > 0 ? msgEstimate + 3500 : savedTokens || 0); conversationToolNames.current = new Set(); pendingCorrection.current = null; if (conv?.roleTemplateId) { useSettingsStore.getState().setActiveRoleTemplate(conv.roleTemplateId) } } }
  const handleNewConversation = () => { abortToolLoop(); bridgeRef.current?.destroy(); bridgeRef.current = null; useAgentStore.getState().endRun(); const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; setConversations(prev => [...prev, makeConversation(id, '新对话')]); setActiveConversationId(id); activeConvIdRef.current = id; setShowConvList(false); useAgentStore.getState().addTokens(-useAgentStore.getState().totalTokensUsed); setCumulativeTokens(0); setCurrentContextTokens(0); conversationToolNames.current = new Set(); pendingCorrection.current = null }
  const handleClearConversation = () => { abortToolLoop(); bridgeRef.current?.destroy(); bridgeRef.current = null; useAgentStore.getState().endRun(); const showWelcome = useSettingsStore.getState().aiSettings.showWelcome !== false; setMessages(showWelcome ? [{ ...WELCOME_MSG, id: `welcome_${activeConversationId}` }] : []); useAgentStore.getState().addTokens(-useAgentStore.getState().totalTokensUsed); setCumulativeTokens(0); setCurrentContextTokens(0); conversationToolNames.current = new Set(); pendingCorrection.current = null; setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, totalTokens: 0, lastPromptTokens: 0, peakPromptTokens: 0 } : c)) }
  const handleDeleteConversation = (convId: string) => { abortToolLoop(); sendLockRef.current = false; conversationToolNames.current = new Set(); pendingCorrection.current = null; autoRetryRef.current = false; if (convId === activeConversationId) { bridgeRef.current?.destroy(); bridgeRef.current = null; useAgentStore.getState().endRun(); const remaining = conversations.filter(c => c.id !== convId); if (remaining.length === 0) { const newConv = makeConversation('default', '新对话'); setConversations([newConv]); setActiveConversationId('default'); activeConvIdRef.current = 'default'; setCumulativeTokens(0); setCurrentContextTokens(0); return }; setActiveConversationId(remaining[0].id); activeConvIdRef.current = remaining[0].id; setConversations(remaining); // v14.5.0: 删除活动会话后重置 token 条（原实现残留被删会话的累计值）
      setCumulativeTokens(remaining[0]?.totalTokens || 0); const msgEstimate = remaining[0] ? estimateMessages(remaining[0].messages.filter(m => m.role !== 'tool')) : 0; setCurrentContextTokens(msgEstimate > 0 ? msgEstimate + 3500 : (remaining[0]?.totalTokens || 0)) } else { setConversations(prev => prev.filter(c => c.id !== convId)) } }

  // Dismiss context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = () => setContextMenu(null)
    window.addEventListener('click', dismiss)
    return () => window.removeEventListener('click', dismiss)
  }, [contextMenu])

  // v14.5.0: 自动滚动逻辑移入 VirtualMessageList（原 scrollRef 从未挂载到 DOM，
  // 此 effect 是死代码——新回复溢出视口后用户必须手动滚动才能看到）


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
      // Text file — store in attachment only, write once in handleSend
      const r = new FileReader()
      r.onload = () => {
        const text = r.result as string
        if (!text.trim()) return
        setAttachment({ type: 'file', name: file.name, content: text })
      }
      r.readAsText(file, 'UTF-8')
    }
  }

  // ── Agent mode refs ──
  const bridgeRef = useRef<IChatBridge | null>(null)

  // Cleanup bridge on component unmount
  useEffect(() => {
    return () => { bridgeRef.current?.destroy(); bridgeRef.current = null }
  }, [])

  // V9.5.2 P0-5: 软件功能/能力自述 — 本地回复，零API调用
  // Patterns matching "软件功能" or "AI 能力" queries (本地回复，零 API 调用)
  const DISPLAY_ONLY_PATTERN = /你能做什么|你会什么|你有什么能力|AI助手能做什么|AI能做什么|软件有什么功能|软件说明|功能介绍|软件能做什么|这个软件是什么|软件功能/
  const isDisplayOnlyQuery = (msg: string) => DISPLAY_ONLY_PATTERN.test(msg)

  // Double-send guard — prevents race between async checkApiConnection and setLoading
  const sendLockRef = useRef(false)
  // v14.5.0: 发起 run 时的会话 id（ref 同步）——onComplete 的 token 状态更新只在仍是该会话时应用，
  // 防止切换会话后旧 run 的 token 累计污染新会话显示
  const activeConvIdRef = useRef(activeConversationId)

  const handleSend = async () => {
    const isRetry = !!pendingCorrection.current
    // H10: prevent cascading auto-retry loops
    if (isRetry && autoRetryRef.current) return
    autoRetryRef.current = isRetry
    if (!isRetry && (!input.trim() || !activeConfigId || loading)) return
    if (sendLockRef.current || loading) return  // H8: prevent double-send during async gap
    sendLockRef.current = true
    // v14.5.0: 记录发起会话——onComplete 的 token 更新只在仍是该会话时应用
    const runStartConvId = activeConversationId
    setLoading(true)  // H8: sync UI guard with lock — eliminates gap where button appears clickable

    // Pre-flight: verify API connectivity
    const connected = await checkApiConnection()
    if (!connected) { setLoading(false); sendLockRef.current = false; return }

    setFileEditNotify(null)
    let attachText = ''
    if (attachment) {
      // 统一使用根目录 uploads/（与 handleDrop 图片路径一致，不在项目目录内）
      const base = (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, '')
      if (attachment.type === 'file') {
        const filePath = `${base}/uploads/files/${attachment.name}`
        try {
          await fileService.ensureDir(`${base}/uploads/files`)
          await fileService.write(filePath, attachment.content)
          // v14.6.1: 路径修正——文件在 appRoot/uploads/files，主进程以 projectsPath 为基准
          // 解析，`../../` 多上一级 → AI 读取必然失败；`../` 恰好 appRoot 一级
          attachText = `[上传文件: ${attachment.name}]\n文件已保存到 ../uploads/files/${attachment.name}。请用 read_file("../uploads/files/${attachment.name}") 读取内容后分析。`
        } catch {
          attachText = `[上传文件: ${attachment.name}]\n${attachment.content.slice(0, 3000)}`
        }
      } else {
        const imgPath = `${base}/uploads/images/${attachment.name}`
        try {
          await fileService.ensureDir(`${base}/uploads/images`)
          const preview = attachment.previewUrl || ''
          const imgData = preview.startsWith('data:') ? preview.split(',')[1] : ''
          if (imgData) {
            await fileService.writeBinary(imgPath, imgData)
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
    if (input.trim().length > 3000) {
      try {
        const ts = Date.now().toString(36)
        const b2 = (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, '') || 'user_data'
        pasteClipPath = `${b2}/uploads/clips/clip_${ts}.txt`
        await fileService.ensureDir(`${b2}/uploads/clips`)
        await fileService.write(pasteClipPath, input.trim())
      } catch { pasteClipPath = '' }
    }

    const capturedInputLength = input.trim().length
    // v14.6.1: 路径修正——文件实际在 appRoot/uploads/clips（projects 上一级），
    // 主进程以 projectsPath 为基准解析，`../../` 会多上一级到 appRoot 的父目录 →
    // AI 按提示 read_file 必然"文件不存在"。`../` 恰好一级。
    const pasteRef = pasteClipPath ? `[粘贴文本已保存: ../uploads/clips/${pasteClipPath.replace(/\\/g, '/').split('/').pop()}。要精准修改内容，使用 read_file("../uploads/clips/${pasteClipPath.replace(/\\/g, '/').split('/').pop()}") 读取后用 edit_file 替换。]\n\n` : ''
    const fullContent = isRetry ? `${attachText || ''}${pasteRef}${pendingCorrection.current!}` : `${attachText || ''}${pasteRef}${input.trim()}`

    // V9.5.2: 软件功能/能力自述 → 仅显示，不入上下文
    const isDisplayOnly = !isRetry && !attachment && isDisplayOnlyQuery(input.trim())

    // V9.5.2 P0-5: displayOnly queries served locally, zero API cost
    if (isDisplayOnly) {
      const localText = input.trim().includes('软件')
        ? '青剑是 AI 辅助小说创作桌面软件。主要功能模块：\n\n📁 项目管理 — 支持普通写作/仿写/续写三种项目类型\n💬 AI 写作助手 — 多工具（核心+扩展，tool_search按需发现），悬浮聊天窗\n📋 大纲 — 10 个 Tab（剧情/世界观/角色/道具/地点/势力/等级/伏笔/情绪/故事线）\n👤 角色 — 12 字段卡片 + 自定义条块 + AI 一键生成\n✍️ 章节写作 — TipTap 富文本编辑器 + AI 生成/改写/审稿 + 版本管理 + 风格/场景模板注入\n📖 仿写 — 13 种类型 → 维度风格分析 → 大纲/细纲模仿\n⏩ 续写 — 7 步向导 → 13 维度逐章分析\n🎨 风格/场景工坊 — 风格模板(21+维度) + 场景模板\n📚 知识库 — PDF/DOCX/TXT 上传 → 语义搜索\n🔄 改写 — 选中文字 → 改写/续写（右键菜单，可插入本章原文参考）\n📕 导出 — EPUB 3.0 + 自动目录\n⚙️ 设置 — 多模型管理 + Token 统计 + 温度调节 + 双协议切换\n\n需要了解哪个功能的详细信息？'
        : '我是青剑内置的 AI 写作助手。我能直接操作项目文件完成：\n\n📝 文件操作 — 读取/创建/编辑/删除项目文件\n👤 角色管理 — 创建 12 字段完整角色卡片（可自定义条块）\n📋 大纲创作 — 编写故事剧情和世界观\n📑 细纲创作 — 生成详细细纲 JSON\n✍️ 章节生成 — 根据大纲+细纲+角色+模板生成章节正文\n📖 小说仿写 — 导入 TXT → 风格分析 → 模仿创作\n⏩ 小说续写 — 7 步向导：分析原作 → 续写新章\n🔄 小说改写 — 选中段落 → 改写/续写（可插入本章原文参考）\n🎨 风格模板 — 注入风格约束到章节生成\n🎬 场景模板 — 注入场景描写指导\n📚 知识库 — 管理参考文档，语义搜索\n\n需要我帮你做什么？'
      const msgId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
      setMessages(prev => [...prev,
        { id: msgId, role: 'user', content: fullContent, timestamp: Date.now(), displayOnly: true },
        { id: `${msgId}_r`, role: 'assistant', content: localText, timestamp: Date.now(), displayOnly: true },
      ])
      setInput('')
      setAttachment(null)
      setLoading(false)
      sendLockRef.current = false
      return
    }

    const msgId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const userMsg: Message = { id: msgId, role: 'user', content: fullContent, timestamp: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setAttachment(null)
    // setLoading(true) already called at entry — loading indicator is already active

    try {
      // H2: Read latest state from stores, not render closure
      const latestConfigId = useSettingsStore.getState().activeConfigId || activeConfigId
      const latestProjectId = useStore.getState().activeProjectId
      const latestKbEnabled = kbEnabled
      const latestWebSearch = webSearchEnabled
      const latestFileIds = latestKbEnabled ? (currentSelections[useStore.getState().activePage] || []) : []

      // ── Agent Runtime (工厂创建：OpenAI 旧方案 or Anthropic 新方案) ──
      // v14.2.0: 跨 run 续跑 — 构建历史后检测上一条 assistant 消息的 taskProgress
      // 中断未完成 → 追加 [续跑] system 提示（提示模型继续剩余任务而非重新开始）
      // v14.3: 子代理快照注入在前（[子代理快照]），[续跑] 在后（续跑指令更接近用户消息，操作性最强）
      const builtHistory = buildHistoryMessages(messages)
      const snapHistory = maybeInjectSubagentSummaries(builtHistory, messages)
      const resumeHistory = maybeInjectResume(snapHistory, messages)
      if (!bridgeRef.current) {
        bridgeRef.current = await createChatBridge(latestProjectId)
        bridgeRef.current.init({ configId: latestConfigId!, projectId: latestProjectId, maxIterations: 30, historyMessages: resumeHistory, contextWindow: activeConfig?.contextWindow ?? 128000 })
      } else {
        bridgeRef.current.updateProject(latestProjectId)
        bridgeRef.current.updateHistory(resumeHistory)
      }
      let collectedText = ''
      // v14.5.0: 跨 run 续跑 — 只取**最后一条** assistant 消息的中断快照（v14.5.0 审查修复：
      // 原向前扫描会复活已完成 run 之前的陈旧中断快照，导致模型重复执行已完成的剩余任务）
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant')
      const lastProgressMsg = (lastAssistantMsg?.taskProgress?.interrupted && !lastAssistantMsg?.taskProgress?.allDone)
        ? lastAssistantMsg
        : undefined
      const result = await bridgeRef.current.sendMessage(fullContent, {
        kbEnabled: latestKbEnabled, webSearchEnabled: latestWebSearch, selectedKbFileIds: latestFileIds,
        // v14.8: 跨 run KB 去重 — 上一条 assistant 消息持久化的已注入文件 id 传给 buildContext 排除，
        // 避免同一知识库文件跨 run 反复注入（内容已在历史中，模型可按需 kb_search/read_file 深入）
        excludeKbFileIds: lastAssistantMsg?.kbInjectedFileIds,
        resumeTaskProgress: lastProgressMsg?.taskProgress,
        // v14.6.1: 工具开关接通（此前只驱动按钮样式，从未传给 bridge——死开关）
        toolsEnabled: toolInvokeEnabled,
        onResponse: (chunk) => { collectedText = chunk.accumulated },
        onComplete: (runResult) => {
          // Parse popup commands from AI response (【打开草稿】, 【生成本章】, etc.)
          const popupResult = parsePopupCommand(collectedText)
          if (popupResult?.genTrigger) {
            const chapId = popupResult.genTrigger === '__current__' ? null : popupResult.genTrigger
            useStore.getState().setChapterGenTrigger(chapId)
            collectedText = popupResult.text || collectedText
          }
          if (popupResult?.popup) {
            const p = popupResult.popup
            useStore.getState().openPopup({ id: `${p.type}_${Date.now()}`, type: p.type, title: p.title, documentKey: p.documentKey })
            collectedText = popupResult.text || collectedText
          }

          // v14.5.0: 用户主动停止生成 → 显示"已停止"而非误导性失败文案
          // （runtime 中止时返回 phase:'ABORTED'，此前被 fallbackText 误显示为 API 超时）
          const fallbackText = runResult.phase === 'ABORTED'
            ? '已停止生成。'
            : (runResult.toolsUsed.length > 0
              ? `已完成 ${runResult.toolsUsed.length} 个工具操作（${runResult.toolsUsed.join('、')}），但 AI 未生成文字回复。请说"继续"获取回复。`
              : `AI 未生成回复（可能 API 超时或模型未响应）。请重试或说"继续"。`)
          // Token breakdown — initial context only (first API call).
          // v13.2.0: 直接用 tokens 字段，避免 chars→tokens 重复转换导致低估 45%
          if (runResult.contextBreakdown && runResult.contextBreakdown.length > 0) {
            setTokenBreakdown([
              ...runResult.contextBreakdown.map(b => ({ label: b.domain, tokens: b.tokens, chars: 0 })),
              { label: `API输入 (${runResult.iterationCount || 1}轮)`, tokens: runResult.promptTokens || 0, chars: 0 },
            ])
          }
          // v11.5.1: 本轮用量将在累积更新后再设置（见下方 billedTokens 计算处）

          const ctxBreakdown = runResult.contextBreakdown?.map(b => ({ label: b.domain, chars: b.tokens * 2 })) || []
          // Show context composition + API-reported actuals (not double-counted)
          const inputBreakdown = [
            ...ctxBreakdown,
            { label: `API输入 (${runResult.iterationCount}轮)`, chars: (runResult.promptTokens || 0) * 2 },
            { label: 'API输出', chars: (runResult.completionTokens || 0) * 2 },
          ].filter(b => b.chars > 0)

          const outputBreakdown: { label: string; tokens: number }[] = []
          outputBreakdown.push({ label: 'AI 输出', tokens: runResult.completionTokens || 0 })
          setMessages(prev => [...prev, {
            id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_r`, role: 'assistant', content: collectedText || runResult.text || fallbackText, timestamp: Date.now(),
            toolsUsed: runResult.toolsUsed,
            toolCallSteps: (runResult as any).toolCallSteps || [],
            breakdown: inputBreakdown,
            outputBreakdown,
            iterationCount: runResult.iterationCount || 1,
            // usage: 入/出/合计 为本次消息的原始值，缓存另显
            usage: runResult.totalTokens > 0 ? {
              prompt_tokens: runResult.promptTokens || 0,
              completion_tokens: runResult.completionTokens || 0,
              total_tokens: runResult.totalTokens,
              cost: runResult.cost || 0,
              cacheHitTokens: runResult.cacheHitTokens || 0,
              cacheCreationTokens: (runResult as any).cacheCreationTokens || 0,
              // v15: 子 agent 委托用量（主/子分开统计）
              subAgentUsage: (runResult as any).subAgentUsage,
            } : undefined,
            totalIterations: runResult.iterationCount || 1,
            // v14.5.0: 幻觉检测接线（此前 detectHallucination 无调用点——banner/重试按钮是死代码）：
            // AI 声称执行了操作但未调对应工具 → 显示警告 + 纠错重试入口
            // 续跑场景跳过（toolsUsed 仅含本次 run，模型文本常引用早前 run 的成果 → 误报）
            hallucinationWarning: lastProgressMsg
              ? undefined
              : (detectHallucination(collectedText || runResult.text || '', new Set(runResult.toolsUsed)) || undefined),
            // v14.2.0: 跨 run 续跑 — 任务清单进度快照随消息持久化（IndexedDB），
            // 中断未完成时下一条消息注入 [续跑] 提示
            taskProgress: (runResult as any).taskProgress,
            // v14.3: 子代理执行快照随消息持久化（chatStorageService 全量 JSON 序列化，自动生效）；
            // 下轮 maybeInjectSubagentSummaries 注入 [子代理快照] 供跨 run 复用。
            // 持久化截断：只保留最近 5 条（防 IndexedDB/镜像膨胀）
            subagentSummaries: (runResult as any).subagentSummaries?.slice(-5),
            // v14.6.1: 推理链持久化（"思考过程"折叠面板数据源——原从未写入，面板恒不显示）
            reasoningContent: (runResult as any).reasoningContent,
            // v14.8: 本轮 KB 预注入文件 id 随消息持久化（下轮 sendMessage 读回做跨 run 排除）
            kbInjectedFileIds: (runResult as any).kbInjectedFileIds?.slice(-20),
          }])
        },
        onApprovalRequired: async (tools) => {
          return new Promise<boolean>((resolve) => {
            approvalResolveRef.current = resolve
            setPendingApproval(tools)
          })
        },
      })
      // C1: 累计 tokens（预算统计）用实际计费值（总 - cacheRead）
      // v13.x: 计算移出 updater——updater 必须纯函数（StrictMode 双调用 + 避免过期闭包）
      const billedTokens = Math.max(0, (result.totalTokens || 0) - (result.cacheHitTokens || 0))
      const newTotal = cumulativeTokens + billedTokens
      // v14.5.0: 仅当仍在发起会话时更新 token 条——切换会话后旧 run 的累计不再污染新会话显示
      // （assistant 消息落库与 totalTokens 回写不加守卫：闭包捕获发起会话 id，语义正确）
      if (activeConvIdRef.current === runStartConvId) {
        setCumulativeTokens(newTotal)
        // v13.2.0: 进度条用 Runtime 估算的下次请求上下文 token 数（非累计计费值）
        // 累计值会因每轮重复计入历史而虚高；estimatedContextTokens 基于 messagesForApi 真实大小
        setCurrentContextTokens(result.estimatedContextTokens ?? newTotal)
      }
      setConversations(innerPrev => innerPrev.map(c => c.id === activeConversationId ? { ...c, totalTokens: newTotal, lastPromptTokens: result.promptTokens || 0, peakPromptTokens: Math.max(c.peakPromptTokens || 0, result.promptTokens || 0) } : c))
      useAgentStore.getState().addTokens(billedTokens)
    } catch (err) {
      setMessages(prev => [...prev, { id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_e`, role: 'assistant', content: `错误: ${err instanceof Error ? err.message : 'Unknown'}`, timestamp: Date.now() }])
    } finally {
      setLoading(false)
      sendLockRef.current = false
      autoRetryRef.current = false
      pendingCorrection.current = null
    }
  }

  // @ reference handling

  // @ reference handling
  const handleInputChange = async (value: string) => {
    setInput(value)
    // 用户手动输入 → 清除待处理的重试状态，防止手动消息被重试文本覆盖
    pendingCorrection.current = null
    autoRetryRef.current = false
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
                        <button onClick={(e) => { e.stopPropagation(); setConvToDelete(conv.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d4ccc4', padding: 0, display: 'flex' }} title="删除对话"
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
                  border: hasKbFileSelection ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(0,0,0,0.06)',
                  background: hasKbFileSelection ? 'rgba(124,58,237,0.04)' : '#fff',
                  color: hasKbFileSelection ? '#7c3aed' : '#9b8e84', fontSize: 11, fontWeight: hasKbFileSelection ? 600 : 400,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <ListBulletIcon style={{ width: 11, height: 11 }} />
                  文件 {isKbAll ? '(全部)' : hasKbFileSelection ? `(${selectedFileIds.length})` : ''}
                </button>
                {showKBFileList && (
                  <div className="custom-scrollbar" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 4, minWidth: 220, maxHeight: 260, overflowY: 'auto', background: '#fff', borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', padding: 4 }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      <button onClick={selectAllKBFiles} style={{ flex: 1, padding: '3px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', background: 'transparent', fontWeight: isKbAll ? 600 : 400, color: isKbAll ? '#7c3aed' : '#6b5e54' }}>全部</button>
                      <button onClick={() => useSettingsStore.getState().setAISettings({ kbFileSelections: { ...currentSelections, [activePage]: ['__none__'] } })} style={{ flex: 1, padding: '3px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', background: 'transparent', fontWeight: isKbNone ? 600 : 400, color: isKbNone ? '#7c3aed' : '#6b5e54' }}>不使用</button>
                    </div>
                    {kbFiles.length > 0 ? kbFiles.map(f => (
                      <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', cursor: 'pointer', borderRadius: 6, fontSize: 11, color: '#2d2520' }}>
                        <input type="checkbox" checked={isKbAll || selectedFileIds.includes(f.id)} onChange={() => toggleKBFile(f.id)} style={{ width: 13, height: 13, accentColor: '#7c3aed' }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.originalName}</span>
                      </label>
                    )) : <div style={{ fontSize: 11, color: '#9b8e84', textAlign: 'center', padding: 8 }}>暂无知识库文件</div>}
                  </div>
                )}
              </div>
            )}
            {/* Temperature quick control — adjusts model creativity. API reads from electron-store on each call. */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 4px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', background: '#fff' }}
              title={`温度: ${activeConfig?.temperature?.toFixed(1) ?? '0.8'} — 越高回复越随机/有创意，越低越确定/保守`}>
              <button onClick={async () => {
                if (!activeConfig) return
                const newTemp = Math.max(0, +(activeConfig.temperature || 0.8).toFixed(1) - 0.1)
                useSettingsStore.getState().updateConfig(activeConfig.id, { temperature: newTemp })
                await settingsService.saveConfigs(useSettingsStore.getState().configs) // 明文存储到 electron-store（v13.x 决策）；MASKED_KEY 占位符由主进程保留旧密钥
              }} style={{ padding: '1px 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10, color: '#9b8e84', fontFamily: 'inherit', lineHeight: 1 }}>−</button>
              <span style={{ fontSize: 10, fontWeight: 600, color: '#6b5e54', minWidth: 36, textAlign: 'center', cursor: 'default' }}>
                {activeConfig?.temperature?.toFixed(1) ?? '0.8'}°C
              </span>
              <button onClick={async () => {
                if (!activeConfig) return
                const newTemp = Math.min(2, +(activeConfig.temperature || 0.8).toFixed(1) + 0.1)
                useSettingsStore.getState().updateConfig(activeConfig.id, { temperature: newTemp })
                await settingsService.saveConfigs(useSettingsStore.getState().configs) // 明文存储到 electron-store（v13.x 决策）；MASKED_KEY 占位符由主进程保留旧密钥
              }} style={{ padding: '1px 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10, color: '#9b8e84', fontFamily: 'inherit', lineHeight: 1 }}>+</button>
            </div>
            <span title={activeConfig?.nativeWebSearch ? '该模型已启用原生联网搜索（Responses API 服务端搜索），软件内置联网搜索自动停用' : '软件内置联网搜索（DuckDuckGo）'}>
              <ToggleButton icon={<GlobeAltIcon style={{ width: 12, height: 12 }} />} label={activeConfig?.nativeWebSearch ? '联网搜索(原生)' : '联网搜索'} active={activeConfig?.nativeWebSearch || webSearchEnabled} onClick={() => { if (!activeConfig?.nativeWebSearch) setWebSearchEnabled(!webSearchEnabled) }} />
            </span>
            {/* v14.6.1: 工具开关接通双协议——原 Anthropic 协议下按钮被禁用（行为恒开），
                且开关状态从未传给 bridge（死开关）；现在 sendMessage 透传 toolsEnabled 真正门控 */}
            <ToggleButton
              icon={<span style={{ fontSize: 12 }}>🔧</span>}
              label={`调用工具${conversationToolNames.current.size > 0 ? ` · ${conversationToolNames.current.size}` : ''}`}
              active={toolInvokeEnabled}
              onClick={() => setToolInvokeEnabled(!toolInvokeEnabled)}
            />
            {/* 上传入口②：按钮 → 文本文件。存到 uploads/files/，fileService.write 自动缓存。 */}
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.txt,.md,.text'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = async () => { const text = r.result as string; if (!text.trim()) return; try { const b = (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, ''); await fileService.ensureDir(`${b}/uploads/files`); await fileService.write(`${b}/uploads/files/${f.name}`, text) } catch (e) { console.error('上传文件失败', e) }; setAttachment({ type: 'file', name: f.name, content: text }) }; r.readAsText(f, 'UTF-8') }; inp.click() }} title="上传文本文件" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 8, border: attachment?.type === 'file' ? '1px solid rgba(124,58,237,0.25)' : '1px solid rgba(0,0,0,0.06)', background: attachment?.type === 'file' ? 'rgba(124,58,237,0.06)' : '#fff', color: '#6b5e54', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><DocumentTextIcon style={{ width: 11, height: 11 }} /> 文件</button>
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

            {/* v13.0: 角色模板选择器 */}
            {(() => {
              const roleTemplates = useSettingsStore.getState().aiSettings.roleTemplates || []
              const isLocked = !!activeConversation.roleTemplateId && activeConversation.messages.some(m => m.role === "user" && !m.displayOnly)
              if (roleTemplates.length === 0) return null
              return (
                <select value={isLocked ? activeConversation.roleTemplateId : (useSettingsStore.getState().aiSettings.activeRoleTemplateId || "")}
                  disabled={isLocked}
                  onChange={e => { if (e.target.value) useSettingsStore.getState().setActiveRoleTemplate(e.target.value) }}
                  style={{ padding: "3px 6px", borderRadius: 6, border: isLocked ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(0,0,0,0.1)", fontSize: 10, color: isLocked ? "#d97706" : "#4a3f38", background: isLocked ? "rgba(245,158,11,0.04)" : "#fff", cursor: isLocked ? "not-allowed" : "pointer", fontFamily: "inherit", maxWidth: 130 }}
                  title={isLocked ? "角色模板已锁定" : "切换角色模板"}>
                  {roleTemplates.map(tpl => <option key={tpl.id} value={tpl.id}>🎭 {tpl.name}</option>)}
                </select>
              )
            })()}
          </div>

          <ContextUsageBar
            usedTokens={currentContextTokens}
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
                  <div style={{ marginLeft: 36, marginTop: 2, marginBottom: 2, display: 'flex', gap: 10, fontSize: 10, color: '#9b8e84', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>入 {(msg.usage.prompt_tokens || 0).toLocaleString()} | 出 {(msg.usage.completion_tokens || 0).toLocaleString()} | 合计 {(msg.usage.total_tokens || 0).toLocaleString()}</span>
                    {(msg.usage as any).cacheCreationTokens > 0 && (
                      <span style={{ color: '#d97706', fontWeight: 600 }}>📥 已缓存 {((msg.usage as any).cacheCreationTokens || 0).toLocaleString()}</span>
                    )}
                    {(msg.usage.cacheHitTokens || 0) > 0 && (
                      <span style={{ color: '#16a34a', fontWeight: 600 }}>📦 缓存命中 {(msg.usage.cacheHitTokens || 0).toLocaleString()}</span>
                    )}
                    {msg.usage.cost > 0 && <span> {activeConfig?.currency === 'CNY' ? '¥' : '$'}{msg.usage.cost.toFixed(4)}</span>}
                    {/* v15: 子 agent 委托用量（独立上下文窗口，主/子分开显示） */}
                    {(msg.usage as any).subAgentUsage?.totalTokens > 0 && (
                      <span style={{ color: '#7c3aed', fontWeight: 600 }}>
                        子代理 入 {((msg.usage as any).subAgentUsage.promptTokens || 0).toLocaleString()} | 出 {((msg.usage as any).subAgentUsage.completionTokens || 0).toLocaleString()} | 合计 {((msg.usage as any).subAgentUsage.totalTokens || 0).toLocaleString()}
                      </span>
                    )}
                  </div>
                )}
                {/* v14.3.1: 任务清单进度卡片（taskProgress 此前只用于续跑注入，聊天窗口无可视化） */}
                {msg.role === 'assistant' && msg.taskProgress && msg.taskProgress.tasks.length > 0 && (
                  <div style={{ marginLeft: 36, marginTop: 6, marginBottom: 2, padding: '8px 12px', borderRadius: 10, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.08)', fontSize: 11 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: '#4a3f38' }}>📋 任务进度</span>
                      <span style={{ color: '#7c3aed', fontWeight: 700 }}>
                        {msg.taskProgress.tasks.filter(t => t.done).length}/{msg.taskProgress.tasks.length}
                      </span>
                      {msg.taskProgress.interrupted && !msg.taskProgress.allDone && (
                        <span style={{ color: '#dc2626', fontSize: 10 }}>· 中断未完成，下条消息将提示续跑</span>
                      )}
                    </div>
                    {msg.taskProgress.tasks.map((t, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, color: t.done ? '#16a34a' : '#9b8e84', padding: '1px 0' }}>
                        <span>{t.done ? '✅' : '○'}</span>
                        <span style={{ textDecoration: t.done ? 'none' : 'none' }}>{t.desc.length > 44 ? t.desc.slice(0, 44) + '…' : t.desc}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* v14.3.1: 子代理简报（快照内容可视化——此前快照只用于跨 run 注入，用户看不到内容） */}
                {msg.role === 'assistant' && msg.subagentSummaries && msg.subagentSummaries.length > 0 && (
                  <div style={{ marginLeft: 36, marginTop: 6, marginBottom: 2, padding: '8px 12px', borderRadius: 10, background: 'rgba(124,58,237,0.03)', border: '1px solid rgba(124,58,237,0.08)', fontSize: 11 }}>
                    <div style={{ fontWeight: 700, color: '#4a3f38', marginBottom: 4 }}>🤖 子代理简报</div>
                    {msg.subagentSummaries.map((s, i) => (
                      <div key={i} style={{ padding: '3px 0', borderTop: i > 0 ? '1px dashed rgba(0,0,0,0.05)' : 'none' }}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span>{s.tool === 'verify_task' ? (s.status === 'success' ? '✅' : '❌') : s.tool === 'subagent_ask' ? '💬' : '🔍'}</span>
                          <span style={{ fontWeight: 600, color: s.tool === 'verify_task' ? (s.status === 'success' ? '#16a34a' : '#dc2626') : '#7c3aed' }}>
                            {s.tool === 'analyze_file' ? '分析' : s.tool === 'edit_file_task' ? '修改' : s.tool === 'verify_task' ? '验收' : '追问'}: {s.filePath || '(无路径)'}
                          </span>
                          <span style={{ color: '#6b5e54' }}>{s.summary}</span>
                        </div>
                        {s.detail && (
                          <div style={{ color: '#9b8e84', whiteSpace: 'pre-wrap', marginTop: 2, fontSize: 10 }}>
                            {s.detail.length > 400 ? s.detail.slice(0, 400) + '…' : s.detail}
                          </div>
                        )}
                      </div>
                    ))}
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
                {/* File refs — 生成/修改的文件，左键打开，右键打开文件夹 */}
                {msg.role === 'assistant' && extractFileRefs(msg, activeProjectId, projectsBasePath).length > 0 && (
                  <div style={{ marginLeft: 36, marginTop: 4, marginBottom: 4, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 9, color: '#9b8e84', marginRight: 2 }}>文件:</span>
                    {extractFileRefs(msg, activeProjectId, projectsBasePath).map(r => (
                      <span
                        key={r.path}
                        onClick={(e) => { e.stopPropagation(); (window as any).electron.app.openFile(r.path) }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setFileMenu({ x: e.clientX, y: e.clientY, path: r.path }) }}
                        title={`${r.path}\n左键打开文件 · 右键打开文件夹`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10,
                          fontSize: 10, fontWeight: 600, cursor: 'pointer',
                          background: 'rgba(16,163,74,0.06)', color: '#16a34a',
                          border: '1px solid rgba(16,163,74,0.15)',
                        }}
                      >
                        📄 {r.path.split('/').pop()}
                      </span>
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

          <AgentStateBar maxIterations={30} />
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
              <textarea id="ai-chat-input" value={input} onChange={e => handleInputChange(e.target.value)}
              onKeyDown={e => {
                // v14.5.0: IME 组合期确认候选的 Enter 不发送（中文输入法误发半截消息）
                if ((e.nativeEvent as any).isComposing) return
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
              }}
              placeholder={activeConfigId ? '输入消息...（Enter 发送，Shift+Enter 换行）' : '请先在设置中配置模型'}
              disabled={!activeConfigId} rows={3}
              className="focus-ring"
              ref={el => {
                if (!el) return
                const saved = localStorage.getItem('ai-input-height')
                if (saved) el.style.height = saved
              }}
              style={{ flex: 1, border: '1px solid rgba(0,0,0,0.08)', borderRadius: '10px 10px 0 0', outline: 'none', resize: 'none', minHeight: 48, padding: '8px 12px', fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit', color: '#2d2520', background: 'rgba(0,0,0,0.02)', transition: 'height 0.15s ease' }}
            />
            {/* Custom resize handle — smooth, saves height */}
            <div
              onMouseDown={e => {
                const ta = (e.currentTarget.previousElementSibling || document.getElementById('ai-chat-input')) as HTMLTextAreaElement
                if (!ta) return
                const startY = e.clientY
                const startH = ta.offsetHeight
                let raf = 0
                const hm = (ev: MouseEvent) => {
                  if (!raf) raf = requestAnimationFrame(() => {
                    const h = Math.max(48, startH + (ev.clientY - startY))
                    ta.style.height = h + 'px'
                    localStorage.setItem('ai-input-height', ta.style.height)
                    raf = 0
                  })
                }
                const hu = () => { window.removeEventListener('mousemove', hm); window.removeEventListener('mouseup', hu) }
                window.addEventListener('mousemove', hm)
                window.addEventListener('mouseup', hu)
              }}
              style={{ height: 6, cursor: 'ns-resize', background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.04))', borderRadius: '0 0 10px 10px', flexShrink: 0 }}
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
                {/* v11.7.0: prompt caching info */}
                {(breakdownModal.cacheCreationTokens || 0) > 0 && (
                  <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 8, background: 'rgba(217,119,6,0.06)', border: '1px solid rgba(217,119,6,0.12)', fontSize: 11 }}>
                    <span style={{ color: '#d97706', fontWeight: 600 }}>📥 已缓存 {(breakdownModal.cacheCreationTokens || 0).toLocaleString()} tokens</span>
                    <span style={{ color: '#9b8e84', marginLeft: 6 }}>首轮建立缓存（仍按创建价计费），后续轮次自动命中</span>
                  </div>
                )}
                {(breakdownModal.cacheHitTokens || 0) > 0 && (
                  <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.12)', fontSize: 11 }}>
                    <span style={{ color: '#16a34a', fontWeight: 600 }}>📦 缓存命中 {(breakdownModal.cacheHitTokens || 0).toLocaleString()} tokens</span>
                    <span style={{ color: '#9b8e84', marginLeft: 6 }}>从缓存读取，仅收 ~10% 读取费</span>
                  </div>
                )}
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
            return <button onClick={() => { setBreakdownModal({ inputBreakdown: (msg as any).breakdown || [], outputBreakdown: (msg as any).outputBreakdown || [], totalPromptTokens: msg.usage?.prompt_tokens, totalCompletionTokens: msg.usage?.completion_tokens, totalTokens: msg.usage?.total_tokens, cacheHitTokens: msg.usage?.cacheHitTokens, cacheCreationTokens: (msg.usage as any)?.cacheCreationTokens }); setContextMenu(null) }} style={ctxMenuBtn}>
              <MagnifyingGlassIcon style={{ width: 13, height: 13 }} /> 查看Token分解
            </button>
          }
          return null
        })()}
        {(() => {
          const msg = messages.find(m => m.id === contextMenu.msgId)
          if (msg?.toolsUsed && msg.toolsUsed.length > 0) {
            return <button onClick={() => { setToolDetailPanel({ toolsUsed: msg.toolsUsed!, toolCallSteps: (msg as any).toolCallSteps, breakdown: (msg as any).breakdown, outputBreakdown: (msg as any).outputBreakdown, iterationCount: (msg as any).iterationCount, totalIterations: (msg as any).totalIterations, usage: msg.usage }); setContextMenu(null) }} style={ctxMenuBtn}>
              <WrenchScrewdriverIcon style={{ width: 13, height: 13 }} /> 查看工具详情
            </button>
          }
          return null
        })()}
      </div>
    )}
    {/* 文件图标右键菜单 — 打开文件夹 / 打开文件 */}
    {fileMenu && (
      <>
        <div onClick={() => setFileMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 199 }} />
        <div style={{
          position: 'fixed', left: fileMenu.x, top: fileMenu.y, zIndex: 200,
          background: '#fff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
          border: '1px solid rgba(0,0,0,0.08)', padding: 4, minWidth: 180,
        }} onClick={e => e.stopPropagation()}>
          <button onClick={() => { (window as any).electron.app.openFolder(fileMenu.path.slice(0, fileMenu.path.lastIndexOf('/'))); setFileMenu(null) }} style={ctxMenuBtn}>
            <FolderOpenIcon style={{ width: 13, height: 13 }} /> 打开文件夹
          </button>
          <button onClick={() => { (window as any).electron.app.openFile(fileMenu.path); setFileMenu(null) }} style={ctxMenuBtn}>
            <DocumentTextIcon style={{ width: 13, height: 13 }} /> 打开文件
          </button>
          <div style={{ padding: '6px 12px 2px', fontSize: 10, color: '#9b8e84', wordBreak: 'break-all' }}>{fileMenu.path}</div>
        </div>
      </>
    )}
    {toolDetailPanel && (
      <ToolDetailPanel
        toolsUsed={toolDetailPanel.toolsUsed}
        toolCallSteps={toolDetailPanel.toolCallSteps}
        breakdown={toolDetailPanel.breakdown}
        outputBreakdown={toolDetailPanel.outputBreakdown}
        iterationCount={toolDetailPanel.iterationCount}
        totalIterations={toolDetailPanel.totalIterations}
        usage={toolDetailPanel.usage}
        onClose={() => setToolDetailPanel(null)}
      />
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
    {/* 对话删除确认弹窗 */}
    {convToDelete && (
      <ConfirmModal
        isOpen={true}
        title="删除对话"
        message={`确定要删除此对话「${conversations.find(c => c.id === convToDelete)?.title || ''}」吗？此操作不可撤销。`}
        confirmLabel="删除"
        danger
        onConfirm={() => { handleDeleteConversation(convToDelete); setConvToDelete(null) }}
        onCancel={() => setConvToDelete(null)}
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


