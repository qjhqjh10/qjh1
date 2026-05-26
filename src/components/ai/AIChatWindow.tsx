import { useState, useRef, useEffect } from 'react'
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
import { FILE_TOOLS, READ_ONLY_TOOLS, DANGEROUS_TOOLS, buildToolInvokePrompt } from '@/types/fileOps'
import { ContextUsageBar } from '@/components/ai/ContextUsageBar'
import { WELCOME_MSG, FILE_OP_SYSTEM_PROMPT, STORAGE_KEY, LAST_ACTIVE_KEY, WINDOW_KEY } from '@/components/ai/chatConstants'
import type { Message, Conversation } from '@/components/ai/chatConstants'
import ImageLightbox from '@/components/common/ImageLightbox'

function makeConversation(id: string, title: string): Conversation {
  const showWelcome = useSettingsStore.getState().aiSettings.showWelcome !== false
  return { id, title, messages: showWelcome ? [{ ...WELCOME_MSG, id: `welcome_${id}` }] : [], createdAt: Date.now(), totalTokens: 0, lastPromptTokens: 0, peakPromptTokens: 0 }
}

function parsePopupCommand(text: string): { text: string; popup?: { type: 'outline' | 'worldbuilding' | 'draft' | 'kb'; title: string; documentKey?: string }; genTrigger?: string } {
  // Check for chapter gen trigger first
  const genMatch = text.match(/【生成(?:第(\S+?)章|本章)】/)
  if (genMatch) {
    const chapId = genMatch[1] // undefined for "生成本章" (current chapter)
    return { text: text.replace(genMatch[0], '').trim(), genTrigger: chapId || '__current__' }
  }

  const patterns: { pattern: RegExp; type: 'outline' | 'worldbuilding' | 'draft' | 'kb'; title: string; documentKey?: string }[] = [
    { pattern: /【打开大纲】/, type: 'outline', title: '大纲' },
    { pattern: /【打开世界观】/, type: 'worldbuilding', title: '世界观' },
    { pattern: /【打开草稿(?:[：:]\s*(.+?))?】/, type: 'draft', title: '草稿本', documentKey: '草稿本.md' },
    { pattern: /【打开知识库】/, type: 'kb', title: '知识库' },
  ]
  for (const p of patterns) {
    const match = text.match(p.pattern)
    if (match) {
      const docKey = p.type === 'draft' ? (match[1]?.trim() || '草稿本.md') : undefined
      return { text: text.replace(p.pattern, '').trim(), popup: { type: p.type, title: p.title, documentKey: docKey } }
    }
  }
  return { text }
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

/**
 * Detect when the AI claims it performed an action (e.g. "已创建", "已修改")
 * but didn't actually call the corresponding tool. Returns a warning string
 * or null if no hallucination detected.
 */
function detectHallucination(text: string, toolsCalled: Set<string>): string | null {
  if (!text) return null

  const checks: { pattern: RegExp; tools: string[]; label: string }[] = [
    { pattern: /(?:已经|已).{0,10}(创建|新建|生成|写入|写好|做好|添加了)/, tools: ['create_file', 'create_project', 'create_style_template', 'create_scene_template', 'generate_image', 'kb_create_file'], label: '创建/生成' },
    { pattern: /(?:已经|已).{0,10}(修改|编辑|更新|替换|改写|改成|调整了|调整好)/, tools: ['edit_file', 'rename_file', 'create_file'], label: '修改/编辑' },
    { pattern: /(?:已经|已).{0,10}(读取|查看|读过|看过|查阅)/, tools: ['read_file', 'list_directory'], label: '读取/查看' },
    { pattern: /(?:已经|已).{0,10}(删除|移除|去掉)/, tools: ['delete_file'], label: '删除' },
    { pattern: /(?:已经|已).{0,10}(保存|存储)/, tools: ['create_file', 'edit_file', 'kb_create_file', 'kb_append_file'], label: '保存/写入' },
    { pattern: /(?:已经|已).{0,10}(搜索|检索|查找|找到)/, tools: ['search_files', 'search_content'], label: '搜索' },
    { pattern: /(?:已经|已).{0,10}(追加|写入)/, tools: ['edit_file', 'create_file', 'kb_append_file'], label: '追加/写入' },
  ]

  for (const check of checks) {
    if (check.pattern.test(text)) {
      const hasTool = check.tools.some(t => toolsCalled.has(t))
      if (!hasTool) {
        return `[系统提示] AI回复中声称"${check.label}"操作，但在本轮对话中未实际调用对应工具。以下内容可能不准确，建议要求AI重新执行并确认工具调用结果。`
      }
    }
  }
  return null
}

/**
 * Parse the AI's thinking plan from [思考计划]...[/思考计划] block.
 * Extracts user intent, file list, and numbered steps with tool names.
 * Returns cleaned text (without the plan block) and the structured plan.
 */
function parseThinkingPlan(text: string): {
  plainText: string
  plan?: { intent: string; files: string[]; steps: { tool: string; action: string }[] }
} {
  if (!text) return { plainText: text }

  const match = text.match(/\[思考计划\]\s*([\s\S]*?)\s*\[\/思考计划\]/)
  if (!match) return { plainText: text }

  const planContent = match[1].trim()
  const plainText = text.replace(match[0], '').trim()

  // Extract user intent
  let intent = ''
  const intentMatch = planContent.match(/用户意图[：:]\s*(.+)/)
  if (intentMatch) intent = intentMatch[1].trim()

  // Extract file list
  const files: string[] = []
  const filesMatch = planContent.match(/涉及文件[：:]\s*(.+)/)
  if (filesMatch) {
    const raw = filesMatch[1].trim()
    if (raw !== '无' && raw !== '无。') {
      files.push(...raw.split(/[,，、\s]+/).map(f => f.trim()).filter(Boolean))
    }
  }

  // Extract numbered steps with tool names
  const steps: { tool: string; action: string }[] = []
  const stepBlock = planContent.match(/计划步骤[：:]\s*([\s\S]*)/)
  if (stepBlock) {
    const stepLines = stepBlock[1].split('\n')
    for (const line of stepLines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // Match "第N步: [tool] → action" or "N. [tool] → action"
      const stepMatch = trimmed.match(/第\s*(\d+)\s*步[：:]\s*\[(.*?)\]\s*[→>]\s*(.+)/)
      if (stepMatch) {
        steps.push({ tool: stepMatch[2].trim(), action: stepMatch[3].trim() })
        continue
      }
      // Fallback: match bare numbered line
      const bareMatch = trimmed.match(/^(\d+)[\.\)、]\s*(.+)/)
      if (bareMatch) {
        steps.push({ tool: '', action: bareMatch[2].trim() })
      }
    }
  }

  // If no structured steps found, store the raw plan content as one step
  if (steps.length === 0) {
    steps.push({ tool: '', action: planContent })
  }

  return { plainText, plan: { intent, files, steps } }
}

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

  // Search toggles
  const prompts = useSettingsStore(s => s.prompts)
  const updatePromptStore = useSettingsStore(s => s.updatePrompt)
  const aiSettings = useSettingsStore(s => ({ ...DEFAULT_AI_SETTINGS, ...s.aiSettings }))
  const [kbEnabled, setKbEnabled] = useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = useState(aiSettings.webSearchDefault)
  const [toolInvokeEnabled, setToolInvokeEnabled] = useState(false)
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
  const currentSelections = aiSettings.kbFileSelections || {}
  const selectedFileIds: string[] = currentSelections[activePage] || []

  const loadKBFileList = async () => {
    try {
      const meta = await kbService.list() as { files: { id: string; originalName: string; projects: string[] }[] }
      setKbFiles(meta.files.filter(f => f.projects.includes(activeProjectId || '')))
    } catch (e) { logError('加载知识库文件列表失败', e); setKbFiles([]) }
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
  const [winSize, setWinSize] = useState(() => {
    try { const s = localStorage.getItem(WINDOW_KEY + '-size'); if (s) return JSON.parse(s) } catch {}
    return { width: 500, height: 700 }
  })
  const [winPos, setWinPos] = useState(() => {
    try { const s = localStorage.getItem(WINDOW_KEY + '-pos'); if (s) return JSON.parse(s) } catch {}
    return { right: 28, bottom: 96 }
  })
  // Persist window position/size
  useEffect(() => { try { localStorage.setItem(WINDOW_KEY + '-size', JSON.stringify(winSize)) } catch {} }, [winSize])
  useEffect(() => { try { localStorage.setItem(WINDOW_KEY + '-pos', JSON.stringify(winPos)) } catch {} }, [winPos])
  const resizeRef = useRef({ startX: 0, startY: 0, startW: 0, startH: 0, startR: 0, startB: 0, corner: '' })
  const dragRef = useRef({ startX: 0, startY: 0, startR: 0, startB: 0 })
  const cleanupDragRef = useRef<(() => void) | null>(null)

  // Cleanup drag/resize listeners on unmount
  useEffect(() => {
    return () => { cleanupDragRef.current?.() }
  }, [])

  const [cumulativeTokens, setCumulativeTokens] = useState(0)
  const [lastPromptTokens, setLastPromptTokens] = useState(0)
  const [peakPromptTokens, setPeakPromptTokens] = useState(0)
  const [tokenBreakdown, setTokenBreakdown] = useState<{ label: string; chars: number }[]>([])

  const handleResizeStart = (corner: string) => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: winSize.width, startH: winSize.height, startR: winPos.right, startB: winPos.bottom, corner }
    const handleMove = (ev: MouseEvent) => {
      const { startX, startY, startW, startH, startR, startB, corner } = resizeRef.current
      const dx = ev.clientX - startX; const dy = ev.clientY - startY
      let w = startW, h = startH, r = startR, b = startB
      const isEdge = /^(top|bottom|left|right)$/.test(corner)
      // Edge resize: dragged edge follows mouse, opposite edge stays fixed
      // Corner resize: anchored at opposite corner
      if (isEdge) {
        if (corner === 'right')  { w = Math.max(360, Math.min(1200, startW + dx)); r = startR - dx }
        if (corner === 'left')   { w = Math.max(360, Math.min(1200, startW - dx)) }
        if (corner === 'bottom') { h = Math.max(360, Math.min(window.innerHeight - 60, startH + dy)); b = startB - dy }
        if (corner === 'top')    { h = Math.max(360, Math.min(window.innerHeight - 60, startH - dy)) }
      } else {
        // Corner: anchor at bottom-right
        if (corner.includes('right'))  { w = Math.max(360, Math.min(1200, startW + dx)) }
        if (corner.includes('left'))   { w = Math.max(360, Math.min(1200, startW - dx)); r = startR + dx }
        if (corner.includes('bottom')) { h = Math.max(360, Math.min(window.innerHeight - 60, startH + dy)) }
        if (corner.includes('top'))    { h = Math.max(360, Math.min(window.innerHeight - 60, startH - dy)); b = startB + dy }
      }
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

  // Load conversations and set active to newest in one shot
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) { const p = JSON.parse(s) as Conversation[]; if (Array.isArray(p) && p.length > 0) return p } } catch (e) { logError('加载对话历史失败', e) }
    return [makeConversation('default', '新对话')]
  })
  const [activeConversationId, setActiveConversationId] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) { const p = JSON.parse(s) as Conversation[]; if (Array.isArray(p) && p.length > 0) {
      const newest = p[p.length - 1]
      if (newest && newest.id !== 'default') return newest.id
    } } } catch {}
    try { const la = localStorage.getItem(LAST_ACTIVE_KEY); if (la && la !== 'default') return la } catch {}
    return 'default'
  })
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations)) } catch (e) { logError('保存对话历史失败', e) } }, [conversations])
  useEffect(() => { try { localStorage.setItem(LAST_ACTIVE_KEY, activeConversationId) } catch (e) { logError('保存活动对话ID失败', e) } }, [activeConversationId])
  // Restore token counts from persisted conversation on mount/switch
  useEffect(() => {
    const conv = conversations.find(c => c.id === activeConversationId)
    setCumulativeTokens(conv?.totalTokens || 0)
    setLastPromptTokens(conv?.lastPromptTokens || 0)
    setPeakPromptTokens(conv?.peakPromptTokens || conv?.lastPromptTokens || 0)
  }, [activeConversationId])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const abortRef = useRef(false)
  const conversationToolNames = useRef(new Set<string>())  // persists across messages within conversation
  const pendingCorrection = useRef<string | null>(null)  // hallucination auto-correction for next send
  const autoRetryRef = useRef(false)  // prevent infinite auto-retry loops
  const [attachment, setAttachment] = useState<{ type: 'file' | 'image'; name: string; content: string; previewUrl?: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)


  const [showConvList, setShowConvList] = useState(false)
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set())
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set())
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set())
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ msgId: string; x: number; y: number } | null>(null)
  const [breakdownModal, setBreakdownModal] = useState<{ breakdown: { label: string; chars: number }[]; completionTokens?: number } | null>(null)
  const [compressing, setCompressing] = useState(false)
  // Batch approval gate state
  const pendingBatchRef = useRef<{
    toolCalls: Array<{ tc: any; routeArgs: Record<string, unknown> }>
    summary: { reads: string[]; writes: string[]; creates: string[]; deletes: string[]; lists: string[] }
    thinkingPlan: string
    onResolve: (approved: boolean, feedback?: string) => void
  } | null>(null)
  const [batchCard, setBatchCard] = useState<BatchCard | null>(null)
  const [batchFeedback, setBatchFeedback] = useState('')
  const [showBatchFeedback, setShowBatchFeedback] = useState(false)

  const PROJECT_DIR_PREFIXES = ['outline/', 'detailed_outline/', 'characters/', 'chapters/', 'summaries/']

  function isProjectFilePath(p: string): boolean {
    if (!p) return false
    const clean = p.replace(/\\/g, '/')
    return PROJECT_DIR_PREFIXES.some(prefix => clean.startsWith(prefix))
  }

  function checkBatch(toolCalls: any[], rawArgs: Record<string, unknown>[]): {
    needsApproval: boolean
    summary: { reads: string[]; writes: string[]; creates: string[]; deletes: string[]; lists: string[]; settings: string[]; templates: string[]; images: string[] }
    previews: { editDiffs: Array<{ path: string; old: string; new: string }>; createPreviews: Array<{ path: string; content: string }> }
  } {
    let readCount = 0, hasProjectFile = false
    const reads: string[] = [], writes: string[] = [], creates: string[] = [], deletes: string[] = [], lists: string[] = []
    const settings: string[] = [], templates: string[] = [], images: string[] = []
    const editDiffs: Array<{ path: string; old: string; new: string }> = []
    const createPreviews: Array<{ path: string; content: string }> = []

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
      const args = rawArgs[i] || {}
      const fp = (args.file_path as string || '').replace(/\\/g, '/')
      const dp = (args.dir_path as string || '').replace(/\\/g, '/')
      const fn = tc.function?.name || ''

      if (fn === 'read_file') {
        readCount++
        if (isProjectFilePath(fp)) hasProjectFile = true
        reads.push(fp || '(unknown)')
      } else if (fn === 'edit_file') {
        writes.push(fp || '(unknown)')
        editDiffs.push({ path: fp, old: String(args.old_string || '').slice(0, 100), new: String(args.new_string || '').slice(0, 100) })
      } else if (fn === 'create_file') {
        creates.push(fp || '(unknown)')
        createPreviews.push({ path: fp, content: String(args.content || '').slice(0, 200) })
      } else if (fn === 'delete_file') {
        deletes.push(fp || '(unknown)')
      } else if (fn === 'rename_file') {
        const np = (args.new_path as string || '').replace(/\\/g, '/')
        writes.push(`${fp} → ${np}`)
      } else if (fn === 'list_directory') {
        readCount++
        lists.push(dp || '(root)')
      } else if (fn === 'generate_image') {
        images.push(String(args.prompt || '').slice(0, 80))
      } else if (fn === 'toggle_prompt' || fn === 'update_prompt') {
        settings.push(`${fn}: ${String(args.title || args.id || '')}`)
      } else if (fn === 'create_style_template' || fn === 'create_scene_template') {
        templates.push(`${fn}: ${String(args.name || '')}`)
      }
    }

    const hasModifications = writes.length > 0 || creates.length > 0 || deletes.length > 0
      || settings.length > 0 || templates.length > 0 || images.length > 0
    const needsApproval = hasModifications || hasProjectFile || readCount > 3

    return { needsApproval, summary: { reads, writes, creates, deletes, lists, settings, templates, images }, previews: { editDiffs, createPreviews } }
  }

  const handleBatchApprove = () => {
    const batch = pendingBatchRef.current
    pendingBatchRef.current = null
    setBatchCard(null)
    if (!batch) {
      // Batch was already resolved (timeout, race condition) — clean up UI
      setMessages(prev => prev.filter(m => !m.batchPending))
      return
    }
    batch.onResolve(true)
  }

  const handleBatchDeny = (feedback?: string) => {
    const batch = pendingBatchRef.current
    pendingBatchRef.current = null
    setBatchCard(null)
    setShowBatchFeedback(false)
    setBatchFeedback('')
    setMessages(prev => prev.filter(m => !m.batchPending))
    if (!batch) return
    batch.onResolve(false, feedback || undefined)
  }

  type BatchCard = {
    id: string
    summary: { reads: string[]; writes: string[]; creates: string[]; deletes: string[]; lists: string[]; settings: string[]; templates: string[]; images: string[] }
    previews: { editDiffs: Array<{ path: string; old: string; new: string }>; createPreviews: Array<{ path: string; content: string }> }
    thinkingPlan: string
  }

  // ── Batch approval panel (rendered above input area) ──
  function BatchApprovalPanel({ batchCard, showFeedback, feedback, onFeedbackChange, onShowFeedback, onApprove, onDeny }: {
    batchCard: BatchCard
    showFeedback: boolean; feedback: string
    onFeedbackChange: (v: string) => void; onShowFeedback: (v: boolean) => void
    onApprove: () => void; onDeny: (feedback?: string) => void
  }) {
    const [showDetail, setShowDetail] = useState(false)
    const hasOps = batchCard.summary.reads.length > 0 || batchCard.summary.writes.length > 0
      || batchCard.summary.creates.length > 0 || batchCard.summary.deletes.length > 0
      || batchCard.summary.lists.length > 0 || batchCard.summary.templates.length > 0
      || batchCard.summary.settings.length > 0 || batchCard.summary.images.length > 0

    return (
      <div style={{ margin: '0 18px 8px', padding: '12px 16px', borderRadius: 14, background: 'rgba(245,158,11,0.05)', border: '2px solid rgba(245,158,11,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: hasOps && showDetail ? 8 : 4 }}>
          <span style={{ fontSize: 18 }}>📋</span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#92400e' }}>AI 操作计划（待审批）</span>
          {hasOps && (
            <button onClick={() => setShowDetail(!showDetail)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>
              {showDetail ? '收起 ▲' : '查看详情 ▼'}
            </button>
          )}
        </div>

        {/* Thinking plan */}
        {batchCard.thinkingPlan && (
          <div style={{ marginBottom: 8, fontSize: 12, color: '#6b5e54', lineHeight: 1.5 }}>
            {batchCard.thinkingPlan.slice(0, 100)}{batchCard.thinkingPlan.length > 100 ? '...' : ''}
          </div>
        )}

        {/* Detail view */}
        {showDetail && (
          <div style={{ marginBottom: 8, maxHeight: 200, overflowY: 'auto' }} className="custom-scrollbar">
            {batchCard.summary.reads.length > 0 && <FileGroup icon="📖" color="#3b82f6" label="读取文件" items={batchCard.summary.reads} />}
            {batchCard.summary.lists.length > 0 && <FileGroup icon="📂" color="#6366f1" label="列出目录" items={batchCard.summary.lists} />}
            {batchCard.summary.writes.length > 0 && <FileGroup icon="✏️" color="#7c3aed" label="编辑文件" items={batchCard.summary.writes} />}
            {batchCard.summary.creates.length > 0 && <FileGroup icon="📁" color="#16a34a" label="创建文件" items={batchCard.summary.creates} />}
            {batchCard.summary.deletes.length > 0 && <FileGroup icon="🗑️" color="#dc2626" label="删除文件" items={batchCard.summary.deletes} />}
            {batchCard.summary.templates.length > 0 && <FileGroup icon="🎨" color="#8b5cf6" label="模板操作" items={batchCard.summary.templates} />}
            {batchCard.summary.settings.length > 0 && <FileGroup icon="⚙️" color="#f59e0b" label="修改设置" items={batchCard.summary.settings} />}
            {batchCard.summary.images.length > 0 && <FileGroup icon="🖼️" color="#ec4899" label="生成图片" items={batchCard.summary.images.map((i: string) => i.slice(0, 60))} />}
          </div>
        )}

        {/* Quick summary when collapsed */}
        {!showDetail && hasOps && (
          <div style={{ fontSize: 11, color: '#92400e', marginBottom: 8 }}>
            {[
              batchCard.summary.reads.length > 0 && `📖 ${batchCard.summary.reads.length}个文件`,
              batchCard.summary.writes.length > 0 && `✏️ ${batchCard.summary.writes.length}个文件`,
              batchCard.summary.creates.length > 0 && `📁 ${batchCard.summary.creates.length}个文件`,
              batchCard.summary.deletes.length > 0 && `🗑️ ${batchCard.summary.deletes.length}个文件`,
            ].filter(Boolean).join(' · ')}
          </div>
        )}

        {/* Feedback input */}
        {showFeedback && (
          <textarea value={feedback} onChange={e => onFeedbackChange(e.target.value)}
            placeholder="告诉 AI 哪里不对、应该怎么改..."
            className="custom-scrollbar"
            style={{ width: '100%', border: '1px solid rgba(220,38,38,0.15)', borderRadius: 8, outline: 'none', resize: 'vertical', fontSize: 12, lineHeight: 1.6, fontFamily: 'inherit', color: '#4a3f38', background: 'rgba(255,255,255,0.8)', padding: 8, minHeight: 50, marginBottom: 8 }}
          />
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {!showFeedback ? (
            <>
              <button onClick={() => onShowFeedback(true)} style={batchBtnStyle('#fff', '#dc2626')}>✗ 拒绝</button>
              <button onClick={onApprove} style={batchBtnStyle('#16a34a', '#fff')}>✓ 批准全部</button>
            </>
          ) : (
            <>
              <button onClick={() => onShowFeedback(false)} style={batchBtnStyle('#fff', '#6b5e54')}>取消</button>
              <button onClick={() => onDeny()} style={batchBtnStyle('rgba(220,38,38,0.04)', '#dc2626')}>直接拒绝</button>
              <button onClick={() => onDeny(feedback)} style={batchBtnStyle(feedback.trim() ? '#7c3aed' : '#9ca3af', '#fff')}>提交反馈并拒绝</button>
            </>
          )}
        </div>
      </div>
    )
  }

  function FileGroup({ icon, color, label, items }: { icon: string; color: string; label: string; items: string[] }) {
    return (
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color, marginBottom: 2 }}>{icon} {label} ({items.length}):</div>
        {items.map((item, i) => <div key={i} style={{ fontSize: 10, color: '#4a3f38', paddingLeft: 12, lineHeight: 1.6 }}>• {item}</div>)}
      </div>
    )
  }

  const batchBtnStyle = (bg: string, fg: string): React.CSSProperties => ({
    padding: '6px 16px', borderRadius: 10, border: bg === '#fff' ? '1px solid rgba(0,0,0,0.08)' : 'none',
    background: bg, color: fg, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  })

  const toggleExpand = (id: string) => setExpandedMsgs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleThinking = (id: string) => setExpandedThinking(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const togglePlan = (id: string) => setExpandedPlans(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const scrollRef = useRef<HTMLDivElement>(null)

  const toggleSelectMsg = (id: string) => setSelectedMsgIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

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
      // Build summary prompt
      const conversationText = toCompress
        .filter(m => m.role !== 'tool')
        .map(m => {
          const roleLabel = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role
          const text = (m.content || '').slice(0, 600).replace(/\n/g, ' ')
          return `[${roleLabel}]: ${text}`
        })
        .join('\n')

      // Estimate tokens saved (rough: 3 chars ≈ 1 token for Chinese)
      const compressedChars = toCompress.reduce((s, m) => s + (m.content || '').length, 0)
      const estimatedTokens = Math.round(compressedChars / 3)

      const result = await aiService.chatWithUsage([
        { role: 'user', content: `请将以下对话历史压缩为一段简洁的上下文摘要（200-400字），保留关键信息：用户的核心需求和目标、已做出的重要决策、创建/修改了哪些文件及原因、当前任务的进展和下一步、用户的偏好和习惯。\n\n对话历史：\n${conversationText}\n\n只输出摘要文本，不要加前缀或解释。` }
      ], activeConfigId!)

      const summaryMsg: Message = {
        id: `compressed_${Date.now()}`,
        role: 'system',
        content: result.text || '（压缩摘要生成失败）',
        timestamp: Date.now(),
        compressedSummary: true,
        compressedCount: toCompress.length,
        compressedTokens: estimatedTokens,
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

  const abortToolLoop = () => { abortRef.current = true; aiService.abortStream(); setLoading(false) }
  const switchConversation = (convId: string) => { if (convId !== activeConversationId) { abortToolLoop(); setActiveConversationId(convId); conversationToolNames.current = new Set(); pendingCorrection.current = null; autoRetryRef.current = false } }
  const handleNewConversation = () => { abortToolLoop(); const id = Date.now().toString(); setConversations(prev => [...prev, makeConversation(id, '新对话')]); setActiveConversationId(id); setShowConvList(false); conversationToolNames.current = new Set(); pendingCorrection.current = null; autoRetryRef.current = false }
  const handleClearConversation = () => { abortToolLoop(); const showWelcome = useSettingsStore.getState().aiSettings.showWelcome !== false; setMessages(showWelcome ? [{ ...WELCOME_MSG, id: `welcome_${activeConversationId}` }] : []); setCumulativeTokens(0); setLastPromptTokens(0); setPeakPromptTokens(0); conversationToolNames.current = new Set(); pendingCorrection.current = null; autoRetryRef.current = false; setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, totalTokens: 0, lastPromptTokens: 0, peakPromptTokens: 0 } : c)) }
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
      // Text file — save to global uploads/ so AI can search and read_file
      const r = new FileReader()
      r.onload = async () => {
        const text = r.result as string
        if (!text.trim()) return
        const base = (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, '')
        const uploadsDir = `${base}/uploads`
        try { await fileService.ensureDir(uploadsDir); await fileService.write(`${uploadsDir}/${file.name}`, text.slice(0, 50000)) } catch (e) { console.error('上传文件失败', e) }
        setAttachment({ type: 'file', name: file.name, content: text.slice(0, 50000) })
      }
      r.readAsText(file, 'UTF-8')
    }
  }

  const handleSend = async () => {
    // Allow retry when pendingCorrection is set (from hallucination retry button)
    const isRetry = !!pendingCorrection.current
    if (!isRetry && (!input.trim() || !activeConfigId || loading)) return
    if (!activeConfigId || loading) return
    // Pre-flight: verify API connectivity before sending
    const connected = await checkApiConnection()
    if (!connected) return  // don't send if connection is known bad

    // Block new requests while a batch approval card is pending
    if (pendingBatchRef.current) return

    // Clear stale notifications before starting new request
    setFileEditNotify(null)
    // Attach pending file/image if any.
    // File saved to uploads/, AI reads it via read_file on demand.
    // Image saved to images/, reference sent inline.
    let attachText = ''
    if (attachment) {
      if (attachment.type === 'file') {
        attachText = `[上传文件: ${attachment.name}]\n文件已保存到全局 uploads 目录。如需读取内容，请用 read_file("${attachment.name}")。`
      } else {
        attachText = attachment.content
      }
    }
    const fullContent = isRetry ? '[系统指令] 请执行上述纠错指令中的操作。' : (attachText ? `${attachText}\n\n${input.trim()}` : input.trim())
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: fullContent, timestamp: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setAttachment(null)
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

      // Page context: no longer auto-injected. AI reads files on demand via tools.


      // Style injection: only when user explicitly requests chapter generation, not just chatting.
      // The AI can read style templates via read_file if needed. Removed automatic injection.

      // System messages — FILE_OP_SYSTEM_PROMPT only on first call of conversation.
      // Check actual message count, not just ref (more robust against remounts).
      // setMessages is async — current msg not in state yet. 0 = no prior user msgs = first send.
      const existingUserMsgs = messages.filter(m => m.role === 'user').length
      const isFirstMessage = existingUserMsgs === 0
      const promptStatus = prompts.map(p =>
        `  [${p.enabled ? '✓' : ' '}] ${p.id}: ${p.title} (${p.type})${p.enabled ? ' ← 当前使用' : ''}`
      ).join('\n')
      const systemMessages: Array<{ role: string; content: string }> = []
      if (isFirstMessage) {
        systemMessages.push({ role: 'system', content: FILE_OP_SYSTEM_PROMPT })
        // config.systemPrompt now sent once with FILE_OP_SYSTEM_PROMPT instead of every API call
        const cfgSysPrompt = activeConfig?.systemPrompt
        if (cfgSysPrompt) systemMessages.push({ role: 'system', content: cfgSysPrompt })
        systemMessages.push(
          { role: 'system', content: aiSettings.workMode === 'plan'
            ? `[Plan分析模式] 只读: list_directory/read_file/search_files/search_content + 草稿笔记。分析后说明方案，需写入时提醒切换Action。`
            : `[Action执行模式] 全部工具可用。` },
          { role: 'system', content: `【当前提示词库状态 — 每种类型只有一个启用，生成内容时参考对应启用模板的格式要求】\n${promptStatus}\n\n提示词管理工具: list_prompts(查看全部) / toggle_prompt(prompt_id, enabled)(切换启用) / update_prompt(prompt_id, title?, content?, type?)(修改模板)。同类型只能启用一个，启用新模板会自动关闭旧的。` },
        )
      }

      // Periodic tool reminder: re-inject compact tool rules every 5 user messages.
      // Long conversations cause the model to "forget" it has tools (attention dilution).
      if (existingUserMsgs > 0 && existingUserMsgs % 5 === 0) {
        systemMessages.push({
          role: 'system',
          content: `[强制工具提醒] 你此刻正运行在一个具备完整工具调用能力的AI助手中。用户说的"创建/修改/删除/生成/查看/写"等操作，你必须调用对应的 create_file / edit_file / delete_file / read_file 等工具来执行。在文字中描述操作不等于操作——只有函数调用返回 success 才算完成。如果你不确定用哪个工具，告诉用户你不确定，但绝对不要说"已完成"除非你真的调用了工具并收到了 success。这条规则优先于其他所有生成策略。`,
        })
      }

      // Comprehensive rules refresh: re-inject key rules at configurable interval.
      // After ~100 messages, the original system prompt has fallen out of the history window.
      // This compact summary keeps critical rules alive without the full 25K token cost.
      // Set to 0 to disable (only the compact tool reminder every 5 messages will run).
      // Default 31 (prime, avoids overlapping with the every-5-msg tool reminder at LCM=30)
      const refreshInterval = aiSettings.rulesRefreshInterval ?? 31
      if (refreshInterval > 0 && existingUserMsgs > 0 && existingUserMsgs % refreshInterval === 0) {
        systemMessages.push({
          role: 'system',
          content: [
            '[规则复述] 以下是必须始终遵守的核心规则（完整版见对话开头的系统提示词）：',
            '',
            '1. 执行前思考协议：需要调用工具时，必须先在回复顶部输出 [思考计划] 块——用户意图、涉及文件、第1/2/3步各用什么工具。',
            '2. 【最高优先级】工具铁律：文字中说"已创建/已修改/已完成"等于零，只有函数调用返回 status:success 才算真的完成。用户让你创建/修改/删除/生成任何内容，你必须立刻调用对应的 create_file/edit_file/delete_file 工具。不确定用哪个工具时告诉用户，但绝对禁止口头承诺。',
            '3. 角色格式：15个平铺字段(image可选)，禁止嵌套对象(basicInfo/appearance等)。role必须是 男主|女主|男配|女配|反派|其他。',
            '4. 细纲格式：JSON文件，必须字段 id/title/order(数字)/status/plotOverview/characters/location/keyEvents。禁止创建.md。',
            '5. Markdown编辑：追加用末尾原文做old_string、修改用完整段落做old_string。先read_file确认再edit_file。',
            '6. 项目文件路径（严禁混淆）：故事剧情=outline/plot.md、世界观=outline/worldbuilding.md、角色=characters/{拼音id}.json、细纲=detailed_outline/{id}.json。大纲文件夹是outline/，细纲文件夹是detailed_outline/——两者完全不同！细纲JSON绝对不能放入outline/！',
            '7. 写入前自检：JSON文件会被系统自动校验格式，格式错误会拒绝写入并返回具体原因。创建角色前先read_file参考已有角色。',
            '8. edit_file替换失败应对：如果返回"未找到要替换的文本"，不要反复尝试微调old_string——直接用 edit_file(old_string="__FULL_REPLACE__", new_string="完整的新文件内容") 全量覆盖整个文件。',
            '9. 读取文件约束：如果需要读取超过3个文件才能完成任务，必须先向用户简要说明原因并征得同意。查看章节列表用list_directory而非逐个read_file。查看细纲时只读用户指定的章节，不要全部读取。',
          ].join('\n'),
        })
      }

      // Auto-correction: if previous response hallucinated, inject corrective instruction
      if (pendingCorrection.current) {
        systemMessages.push({
          role: 'system',
          content: pendingCorrection.current,
        })
        pendingCorrection.current = null
      }

      // Keyword "调用工具": inject full tool invoke prompt
      const hasToolKeyword = /\b调用工具\b/.test(input.trim())
      if (hasToolKeyword || toolInvokeEnabled) {
        systemMessages.push({
          role: 'system',
          content: buildToolInvokePrompt(),
        })
        if (hasToolKeyword) setShowToolHint(false) // keyword detected, dismiss hint
      }

      // Smart intent detection: suggest tool invoke if user asks for actions but AI hasn't used tools
      const actionKeywords = /创建|新建|修改|编辑|删除|生成|写入|写一|改一|添加|追加/
      const recentToolCount = [...conversationToolNames.current].length
      if (!toolInvokeEnabled && !hasToolKeyword && actionKeywords.test(input.trim()) && recentToolCount === 0) {
        setShowToolHint(true)
      } else if (hasToolKeyword || toolInvokeEnabled || recentToolCount > 0) {
        setShowToolHint(false)
      }

      // ══════════════════════════════════════════════════════════════════
      // 对话历史精简 (History Pruning)
      // ══════════════════════════════════════════════════════════════════
      //
      // 过滤规则：
      //   1. 排除 welcome / system / tool / compressedSummary 消息
      //   2. user/assistant 消息限制（可配置，默认 100 条）
      //
      // 注意：tool 消息和 tool_calls 不跨轮——它们仅在当前 handleSend 的
      // while 循环内通过 messagesForApi 传递。跨轮的 tool 消息因缺少配对的
      // tool_calls/tool_call_id 会导致 API 400 错误。
      const MAX_HISTORY = aiSettings.maxHistory ?? 100

      const compressedMsgs = messages.filter(m => m.compressedSummary)
      const filteredMessages = messages.filter(m =>
        !m.id.startsWith('welcome') && String(m.role) !== 'system' && !m.compressedSummary && m.role !== 'tool',
      )
      const recentMessages = filteredMessages.slice(-MAX_HISTORY)
      const historyMessages = recentMessages.map(m => ({
        role: m.role as string,
        content: m.content,
      }))
      // Inject compressed summaries as extra system messages
      for (const cm of compressedMsgs) {
        systemMessages.push({ role: 'system', content: `[对话历史摘要 — ${cm.compressedCount || '?'}条消息已压缩]\n${cm.content}` })
      }

      // Build the full message array: system prompts + conversation history + current user message
      const messagesForApi: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> = [
        ...systemMessages,
        ...historyMessages,
        { role: 'user' as const, content: (kbContext + webContext + refContext || '') + '\n\n[用户输入]\n' + fullContent },
      ]

      // ══════════════════════════════════════════════════════════════════
      // 工具按需选择 (Smart Tool Selection)
      // ══════════════════════════════════════════════════════════════════
      //
      // 设计意图：28个工具的完整 JSON Schema 约消耗 5,000 tokens/轮。
      // 闲聊（"你好"）不需要任何工具，任务型对话也只需相关子集。
      //
      // 三级策略：
      //   纯闲聊 → toolsForApi = undefined → 省 ~5,000 tokens
      //   普通任务 → 仅核心8个文件工具 → ~1,500 tokens
      //   特定领域 → 核心+领域工具 → ~2,000-3,000 tokens
      //
      // 关键词匹配用于判断领域，所有工具通过 FILE_TOOLS 注册的真实函数名筛选。
      // Plan 模式下进一步限制为 READ_ONLY_TOOLS 子集。
      const allTools = aiSettings.workMode === 'plan'
        ? FILE_TOOLS.filter((t: any) => READ_ONLY_TOOLS.has(t.function.name))
        : FILE_TOOLS
      const isFileTask   = /(大纲|细纲|章节|角色|世界观|文件|道具|地点|势力|等级|伏笔|故事线|情绪|场景|统计|导出|配置|创建|新建|修改|编辑|删除|读取|帮|改|写|读|删|加|换|设定|生成|添加|整理|查看|看看|浏览|打开|项目|剧情|故事|列表|列出|目录|内容)/i.test(userMsg.content)
      const isNoteTask   = /(笔记|草稿|记下来|灵感|想法|保存|备忘)/i.test(userMsg.content)
      const isKbTask     = /(知识库|资料库|索引|语义|搜索|KB|查.*资料|素材)/i.test(userMsg.content)
      const isImageTask  = /(图片|生成.*图|插图|配图|形象图|照片|画像)/i.test(userMsg.content)
      const isTmplTask   = /(模板|风格工坊|场景工坊|风格分析|场景模板|场景编排|文风|风格模板)/i.test(userMsg.content)
      const isPromptTask = /(提示词|prompt|模板.*格式)/i.test(userMsg.content)
      const isProjTask   = /(创建.*项目|新建.*项目|删除.*项目|新建项目|创建项目)/i.test(userMsg.content)
      const anyTask = isFileTask || isNoteTask || isKbTask || isImageTask || isTmplTask || isPromptTask || isProjTask

      let toolsForApi: unknown[] | undefined
      if (!anyTask) {
        toolsForApi = undefined // pure chat — no tools
      } else {
        // Core file tools (always included for any task)
        const core = ['list_directory','read_file','search_files','search_content','edit_file','create_file','delete_file','rename_file']
        // Domain tools — only added when user mentions relevant keywords
        const noteTools   = ['list_notes','read_note','write_note','append_note','delete_note']
        const kbTools     = ['kb_list','kb_create_file','kb_append_file','kb_index_file']
        const imageTools  = ['search_images','generate_image']
        const promptTools = ['list_prompts','toggle_prompt','update_prompt']
        const tmplTools   = ['create_style_template','create_scene_template']
        const projTools   = ['create_project','delete_project']

        const needed = new Set(core)
        if (isNoteTask)   noteTools.forEach(t => needed.add(t))
        if (isKbTask)     kbTools.forEach(t => needed.add(t))
        if (isImageTask)  imageTools.forEach(t => needed.add(t))
        if (isTmplTask)   tmplTools.forEach(t => needed.add(t))
        if (isPromptTask) promptTools.forEach(t => needed.add(t))
        if (isProjTask)   projTools.forEach(t => needed.add(t))

        toolsForApi = allTools.filter((t: any) => needed.has(t.function.name))
      }

      // Token breakdown for debugging
      const breakdown: { label: string; chars: number }[] = []
      let sysChars = 0; for (const sm of systemMessages) sysChars += (sm.content || '').length
      if (sysChars > 0) breakdown.push({ label: '系统提示词', chars: sysChars })
      let histChars = 0; for (const hm of historyMessages) histChars += (hm.content || '').length
      if (histChars > 0) breakdown.push({ label: `对话历史 (${historyMessages.length}条)`, chars: histChars })
      if (kbContext) breakdown.push({ label: '知识库上下文', chars: kbContext.length })
      if (webContext) breakdown.push({ label: '网络搜索上下文', chars: webContext.length })
      if (refContext) breakdown.push({ label: '引用文件', chars: refContext.length })
      breakdown.push({ label: '用户输入', chars: userMsg.content.length + 11 })  // +11 for \n\n[用户输入]\n prefix
      // Tools definition (sent every API call, often the hidden token hog)
      if (toolsForApi) {
        const toolsJson = JSON.stringify(toolsForApi)
        breakdown.push({ label: `工具定义 (${toolsForApi.length}个)`, chars: toolsJson.length })
      }
      // JSON structure overhead: role/content keys, brackets, quotes (~25 chars per message)
      const structOverhead = (systemMessages.length + historyMessages.length + 1) * 25
      breakdown.push({ label: `消息结构开销 (${systemMessages.length + historyMessages.length + 1}条)`, chars: structOverhead })
      setTokenBreakdown(breakdown)

      let iteration = 0; const MAX_ITER = 8; let isDone = false
      let sessionTokens = 0; let lastPrompt = 0
      // Accumulate called tools across entire conversation for hallucination check
      const thisSendTools = new Set<string>()  // tools used in this specific handleSend
      abortRef.current = false
      while (iteration < MAX_ITER && !isDone && !abortRef.current) {
        iteration++
        // AI chat with tools. In Action mode, the AI can call file operations; in Plan mode, only read-only tools.
        // Safety: backend enforces path isolation (isSafePath), file size limits, and dangerous tool confirmation.
        const response = await aiService.chatWithTools(messagesForApi, activeConfigId!, activeProjectId || undefined, toolsForApi)
        const { text, toolCalls, finishReason, images, usage, reasoning_content } = response
        sessionTokens = usage?.total_tokens || sessionTokens
        if (usage?.prompt_tokens) { lastPrompt = usage.prompt_tokens; setLastPromptTokens(usage.prompt_tokens); setPeakPromptTokens(prev => Math.max(prev, usage.prompt_tokens)) }

        if (!toolCalls || toolCalls.length === 0) {
          // Parse thinking plan before popup/insertion parsing (plan block may interfere)
          const planParsed = parseThinkingPlan(text || '')
          const textAfterPlan = planParsed.plainText || text || ''

          const popupParsed = parsePopupCommand(textAfterPlan)
          const displayText = popupParsed.popup ? popupParsed.text : textAfterPlan
          const { plainText, insertion } = parseInsertionSuggestion(displayText)
          // Auto-open popup if AI included the command
          if (popupParsed.popup) {
            const id = Date.now().toString()
            openPopup({ id: `ai_${id}`, type: popupParsed.popup.type, title: popupParsed.popup.title, documentKey: popupParsed.popup.documentKey })
          }
          // Trigger chapter generation via store if AI included 【生成本章】or【生成第X章】
          if (popupParsed.genTrigger) {
            const targetId = popupParsed.genTrigger === '__current__' ? (currentChapterId || '') : popupParsed.genTrigger
            if (targetId) useStore.getState().setChapterGenTrigger(targetId)
          }
          // Runtime hallucination check: did AI claim an action without calling the tool?
          const finalText = plainText || displayText
          const hw = detectHallucination(finalText, conversationToolNames.current)
          // If hallucination detected, queue auto-correction for immediate retry
          if (hw) {
            pendingCorrection.current = `[纠错指令] 你在上一条回复中声称执行了操作但系统检测到你实际没有调用任何工具。这是不允许的——只有 tool_call 返回 success 才算完成。请现在立即调用对应工具完成你刚才声称的操作。${hw}`
            // Auto-retry once: inject correction and re-send immediately
            if (!autoRetryRef.current) {
              autoRetryRef.current = true
              setTimeout(() => {
                if (pendingCorrection.current) handleSend()
              }, 300)
            }
          } else {
            autoRetryRef.current = false
          }

          const assistantMsg: Message = {
            id: Date.now().toString() + '_r', role: 'assistant', content: finalText, timestamp: Date.now(), insertion,
            hallucinationWarning: hw || undefined,
            toolsUsed: thisSendTools.size > 0 ? [...thisSendTools] : undefined,
            thinkingPlan: planParsed.plan,
            reasoningContent: reasoning_content || undefined,
            usage: usage ? { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens, cost: usage.cost } : undefined,
            wordCount: plainText ? plainText.replace(/\s/g, '').length : 0,
            breakdown,
            sources: { kb: kbSources, web: webSources }, images,
          }
          setMessages(prev => [...prev, assistantMsg])
          isDone = true
        } else {
          // Process tool calls
          // Parse thinking plan from this round's text before popup parsing
          const planParsed2 = parseThinkingPlan(text || '')
          const textAfterPlan2 = planParsed2.plainText || text || ''

          // Also parse popup commands from text (may be mixed with tool calls)
          const popupParsed2 = parsePopupCommand(textAfterPlan2)
          const displayText2 = popupParsed2.popup ? popupParsed2.text : textAfterPlan2
          if (popupParsed2.popup) {
            const pid = Date.now().toString()
            openPopup({ id: `ai_${pid}`, type: popupParsed2.popup.type, title: popupParsed2.popup.title, documentKey: popupParsed2.popup.documentKey })
          }
          if (popupParsed2.genTrigger) {
            const targetId = popupParsed2.genTrigger === '__current__' ? (currentChapterId || '') : popupParsed2.genTrigger
            if (targetId) useStore.getState().setChapterGenTrigger(targetId)
          }
          // Track all tool names called (for runtime hallucination detection + UI summary)
          toolCalls.forEach((tc: any) => { conversationToolNames.current.add(tc.function.name); thisSendTools.add(tc.function.name) })

          const assistantMsgForApi: Record<string, unknown> = { role: 'assistant', content: displayText2, tool_calls: toolCalls }
          if (reasoning_content) assistantMsgForApi.reasoning_content = reasoning_content
          messagesForApi.push(assistantMsgForApi as any)
          // Persist assistant message with tool_calls. Strip note content to save tokens.
          const strippedCalls = toolCalls.map((tc: any) => {
            if (tc.function.name === 'write_note' || tc.function.name === 'append_note') {
              const args = JSON.parse(tc.function.arguments)
              const stripped = { ...args, content: `(${String(args.content || '').length}字符，已自动省略。用read_note读取)` }
              return { ...tc, function: { ...tc.function, arguments: JSON.stringify(stripped) } }
            }
            return tc
          })
          setMessages(prev => [...prev, {
            id: `${Date.now()}_tc`, role: 'assistant' as const, content: displayText2, timestamp: Date.now(),
            tool_calls: strippedCalls,
            thinkingPlan: planParsed2.plan,
            reasoningContent: reasoning_content || undefined,
          }])
          const resultMsgs: Message[] = []
          const readCounts = { read_file: 0, list_directory: 0 }
          const MAX_READS = 10, MAX_LISTS = 3

          // ── Batch approval gate: check all tool calls before executing ──
          const allRawArgs = toolCalls.map(tc => { try { return JSON.parse(tc.function.arguments) } catch { return {} } })
          const batchCheck = checkBatch(toolCalls, allRawArgs)

          if (batchCheck.needsApproval) {
            // Pause and wait for user approval via Promise
            const batchApproved = await new Promise<boolean>((resolve) => {
              const timeoutId = setTimeout(() => {
                // Auto-deny after 30s timeout
                pendingBatchRef.current = null
                setBatchCard(null)
                setMessages(prev => prev.filter(m => !m.batchPending))
                const timeoutContent = JSON.stringify({ status: 'denied', summary: '操作超时（30秒未响应），自动拒绝' })
                for (const tc of toolCalls) {
                  messagesForApi.push({ role: 'tool' as const, tool_call_id: tc.id, content: timeoutContent })
                  resultMsgs.push({ id: `${tc.id}_r`, role: 'tool' as const, content: timeoutContent, tool_call_id: tc.id, toolName: tc.function.name, timestamp: Date.now() })
                }
                resolve(false)
              }, 30_000)
              pendingBatchRef.current = {
                toolCalls: toolCalls.map((tc, i) => ({ tc, routeArgs: allRawArgs[i] })),
                summary: batchCheck.summary,
                thinkingPlan: typeof planParsed2.plan === 'string' ? planParsed2.plan : (planParsed2.plan?.intent || ''),
                onResolve: (approved: boolean, feedback?: string) => {
                  clearTimeout(timeoutId)
                  pendingBatchRef.current = null
                  if (approved) {
                    resolve(true)
                  } else {
                    // Create denied tool results for all tool calls
                    const deniedContent = JSON.stringify({
                      status: 'denied',
                      summary: '用户拒绝了此操作计划',
                      detail: feedback ? `用户反馈: ${feedback}` : ''
                    })
                    for (const tc of toolCalls) {
                      messagesForApi.push({ role: 'tool' as const, tool_call_id: tc.id, content: deniedContent })
                      resultMsgs.push({
                        id: `${tc.id}_r`, role: 'tool' as const, content: deniedContent,
                        tool_call_id: tc.id, toolName: tc.function.name, timestamp: Date.now(),
                      })
                    }
                    // Remove batch card from messages
                    setMessages(prev => prev.filter(m => !m.batchPending))
                    resolve(false)
                  }
                },
              }
              setBatchCard({
                id: `batch_${Date.now()}`,
                summary: batchCheck.summary,
                previews: batchCheck.previews,
                thinkingPlan: typeof planParsed2.plan === 'string' ? planParsed2.plan : (planParsed2.plan?.intent || ''),
              })
              // Batch card is rendered in the input area, not in message stream
            })

            if (!batchApproved) {
              // User denied — push all denied results to message list and return
              setMessages(prev => [...prev, ...resultMsgs])
              setLoading(false)
              return
            }
            // User approved — remove batch card and continue execution
            setMessages(prev => prev.filter(m => !m.batchPending))
          }

          for (const tc of toolCalls) {
            try {
              const args = JSON.parse(tc.function.arguments)
              let r: { status: string; summary: string; detail?: string; confirmArgs?: Record<string, unknown> } | undefined

              // ══════════════════════════════════════════════════════════════
              // 工具分发架构 (Tool Dispatch Architecture)
              // ══════════════════════════════════════════════════════════════
              //
              // AI 返回的 tool_calls 按以下 3 条路由分发执行:
              //
              // 路由A: 知识库专用工具 (前端直接调用 kbService)
              //   kb_list / kb_create_file / kb_index_file / kb_append_file
              //   原因: KB 文件在 knowledge_base/ 目录，不在项目目录内，
              //         无法通过 executeFileTools(projectPath) 访问
              //
              // 路由B: 前端直接调用的工具 (模板创建 / 图片生成)
              //   create_style_template → styleTemplateService → 风格工坊+模板库
              //   create_scene_template  → templateService      → 场景工坊
              //   generate_image        → aiService            → DALL-E API
              //   原因: 需要构建完整对象或调用特定 API，逻辑在前端更合适
              //
              // 路由C: 项目文件工具 (IPC 后端 executeFileTools)
              //   其余22个工具 → aiService.executeFileTools() → electron/ipc/
              //   原因: 需要访问项目目录+安全验证+备份管理，必须在主进程执行
              // ══════════════════════════════════════════════════════════════

              // ── 路由A: 知识库工具 ──
              // 知识库文件存储在 knowledge_base/files/，与项目目录隔离
              // 这些工具直接调用 kbService，成功后会触 fileEditNotify 让 KB 页刷新

              // kb_list: 列出知识库所有文件 → 连接 KnowledgeBasePage / KbPopup
              if (tc.function.name === 'kb_list') {
                try {
                  const meta = await kbService.list() as { files: { id: string; originalName: string; type: string }[] }
                  const fileList = meta.files.map(f => `${f.originalName} (id: ${f.id}, 类型: ${f.type})`).join('\n')
                  r = { status: 'success', summary: `${meta.files.length} 个文件`, detail: fileList || '(知识库为空)' }
                } catch (e: any) { r = { status: 'error', summary: `列出失败: ${e.message}` } }

              // kb_create_file: 创建知识库文件 → 连接 KnowledgeBasePage
              } else if (tc.function.name === 'kb_create_file') {
                try {
                  const result = await kbService.create(args.name || '未命名.md', args.content || '', activeProjectId || undefined)
                  r = { status: 'success', summary: `已创建知识库文件: ${result.name}`, detail: `文件ID: ${result.id}\n可在知识库页面查看和索引。` }
                  // 通知 KnowledgeBasePage + KbPopup 刷新文件列表
                  setFileEditNotify({ filePath: 'knowledge_base/metadata.json', newContent: '__AI_EDITED__' })
                } catch (e: any) { r = { status: 'error', summary: `创建失败: ${e.message}` } }

              // kb_index_file: 对KB文件建立embedding语义索引 → 连接 KnowledgeBasePage
              } else if (tc.function.name === 'kb_index_file') {
                try {
                  const fileId = String(args.file_id || '')
                  if (!fileId) throw new Error('缺少 file_id 参数')
                  const result = await kbService.index(fileId, activeConfigId!)
                  r = { status: 'success', summary: `索引完成: ${result.chunkCount} 个片段`, detail: `文件已被索引，支持语义搜索。` }
                } catch (e: any) { r = { status: 'error', summary: `索引失败: ${e.message}` } }

              // kb_append_file: 追加内容到KB文件 → 连接 KnowledgeBasePage
              } else if (tc.function.name === 'kb_append_file') {
                try {
                  await kbService.append(args.file_id, args.content || '')
                  r = { status: 'success', summary: '已追加到知识库文件', detail: '内容已追加。可在知识库页面查看。' }
                  // 通知 KnowledgeBasePage + KbPopup 刷新
                  setFileEditNotify({ filePath: 'knowledge_base/metadata.json', newContent: '__AI_EDITED__' })
                } catch (e: any) { r = { status: 'error', summary: `追加失败: ${e.message}` } }

              // ── 路由B: 模板创建工具 ──
              // 这些工具构建完整模板对象后调用 service 保存

              // create_style_template: 创建风格模板 → 连接 StyleWorkshopPage（风格模板Tab）
              } else if (tc.function.name === 'create_style_template') {
                try {
                  // Fix AI double-stringifying dimensions/tone — parse if string
                  let dims = args.dimensions || {}
                  if (typeof dims === 'string') { try { dims = JSON.parse(dims) } catch { /* keep as-is */ } }
                  let tone = args.tone || {}
                  if (typeof tone === 'string') { try { tone = JSON.parse(tone) } catch { /* keep as-is */ } }
                  // Fix writingRules items that are accidentally arrays instead of strings
                  const rules = (args.writingRules || []).map((r: any) => Array.isArray(r) ? r[0] || '' : String(r))
                  const tmpl: any = {
                    name: args.name || '未命名模板', type: args.type || '普通小说',
                    worldType: args.worldType || '', description: args.description || '',
                    dimensions: dims, vocabularyList: args.vocabularyList || [],
                    writingRules: rules, tone,
                    source: 'ai-generated', createdAt: '', updatedAt: '', id: `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`,
                  }
                  const saved = await styleTemplateService.save(tmpl) as any
                  r = { status: 'success', summary: `已创建风格模板: ${saved.name || tmpl.name}`, detail: `模板ID: ${saved.id}\n可在风格工坊→模板库查看和编辑。` }
                  // 通知风格工坊+模板库刷新
                  setFileEditNotify({ filePath: 'style_templates/updated', newContent: '__AI_EDITED__' })
                } catch (e: any) { r = { status: 'error', summary: `创建失败: ${e.message}` } }

              // ══════════════════════════════════════════════════════════════
              // create_scene_template: 创建场景模板 (Route B — 前端直调)
              // ══════════════════════════════════════════════════════════════
              //
              // AI 通过工具参数传入各字段值。Handler 负责：
              //   1. 解析 AI 传入的参数（字符串→数组、角色行解析等）
              //   2. 区分"AI 已提供"和"AI 未提供"的字段
              //   3. 未提供字段自动标记为 autoFields（生成时 AI 自主决定）
              //   4. 构建标准 SceneTemplate JSON 并写入 scene_templates/
              //
              // 注意：isEmpty() 函数将空数组 []、空对象 {}、空字符串 "" 均视为未提供。
              // 这避免了 AI 传 `bodyFluidFocus: []` 时被错误当作"已提供"的 bug。
              } else if (tc.function.name === 'create_scene_template') {
                try {
                  const isErotic = String(args.type || '').includes('情色')

                  // Parse characters from "角色名-情绪" lines
                  const charLines = String(args.characters || '').split('\n').filter(Boolean)
                  const charObjs = charLines.map((line: string) => {
                    const parts = line.split(/[-—–·]/)
                    return { characterId: '', characterName: parts[0]?.trim() || line.trim(), emotion: parts[1]?.trim() || '' }
                  })

                  // Track which fields AI explicitly provided with actual content.
                  // Empty strings and empty arrays count as NOT provided → auto.
                  const aiProvided = new Set<string>()
                  const isEmpty = (v: any) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)
                  const argKeys = Object.keys(args).filter(k => k !== 'name' && k !== 'type' && k !== 'autoFields')
                  for (const k of argKeys) {
                    if (!isEmpty(args[k])) aiProvided.add(k)
                  }
                  // Also add explicit autoFields entries
                  if (Array.isArray(args.autoFields)) args.autoFields.forEach((f: string) => aiProvided.add(f))

                  const allFieldKeys = [
                    'sceneType','scenePurpose','conflictType','characters','location','time','weather','atmosphere',
                    'senses','dialogueRatio','subtextLevel','sentenceStyle','paragraphDensity',
                    'wordTarget','narrativePOV','narrativeStyle','timeCompression','introspection',
                    'emotionStart','emotionEnd','dominantEmotion','pacing','foreshadowUse','sceneTurningPoint',
                    'props','appearance','bodyLanguage','propList','worldRules','costumeList','sensoryAnchors',
                    // Erotic-specific fields
                    'intensity','selectedKinks','opening','mainPose','mainRhythm','poseChanges',
                    'climax','aftermath','soundDensity','moanStyle','degradeLangs','bannedWords',
                    'consentDynamic','aftercareDetail',
                    // Extra
                    'detail','extraNote','plotOverview','kinkNote','publicity',
                    'bodyFluidFocus','bodyPartFocus','tactileFocus','emotionCurveInput','triggerWords',
                  ]
                  // Auto-set all fields AI didn't provide
                  const autoFields: Record<string, boolean> = {}
                  for (const fk of allFieldKeys) {
                    if (!aiProvided.has(fk)) autoFields[fk] = true
                  }

                  const config: any = {
                    sceneType: args.sceneType || '日常',
                    scenePurpose: Array.isArray(args.scenePurpose) ? args.scenePurpose : ['推进剧情'],
                    conflictType: args.conflictType || '无冲突',
                    povCharacterId: '', povCharacterName: '',
                    characters: charObjs,
                    location: args.location || '',
                    time: args.time || '不限',
                    weather: args.weather || '不限',
                    atmosphere: args.atmosphere || '不限',
                    senses: Array.isArray(args.senses) ? args.senses : ['视觉'],
                    dialogueRatio: args.dialogueRatio || '适量(30%)',
                    subtextLevel: args.subtextLevel || '一般',
                    sentenceStyle: args.sentenceStyle || '混合',
                    paragraphDensity: args.paragraphDensity || '适中',
                    wordTarget: args.wordTarget || 3000,
                    narrativePOV: args.narrativePOV || '第三人称',
                    narrativeStyle: args.narrativeStyle || '沉浸式长镜',
                    timeCompression: args.timeCompression || '实时',
                    introspection: args.introspection || '中',
                    emotionStart: args.emotionStart || '',
                    emotionEnd: args.emotionEnd || '',
                    dominantEmotion: args.dominantEmotion || '',
                    pacing: args.pacing || '渐进',
                    props: args.props || '', appearance: args.appearance || '', bodyLanguage: args.bodyLanguage || '',
                    foreshadowUse: args.foreshadowUse || '无',
                    sceneTurningPoint: args.sceneTurningPoint || '',
                    intensity: args.eroticIntensity || args.intensity || 3,  // accept both param names
                    selectedKinks: Array.isArray(args.selectedKinks) ? args.selectedKinks : [],
                    opening: Array.isArray(args.opening) ? args.opening : [],
                    mainPose: args.mainPose || '无偏好',
                    mainRhythm: '无偏好', poseChanges: '2-3次转换',
                    climax: Array.isArray(args.climax) ? args.climax : [],
                    aftermath: Array.isArray(args.aftermath) ? args.aftermath : [],
                    soundDensity: args.soundDensity || '中等', moanStyle: args.moanStyle || '含蓄',
                    degradeLangs: Array.isArray(args.degradeLangs) ? args.degradeLangs : [], bannedWords: args.bannedWords || '',
                    consentDynamic: args.consentDynamic || '默认', aftercareDetail: args.aftercareDetail || '',
                    worldRules: args.worldRules || '', propList: args.propList || '', costumeList: args.costumeList || '',
                    // Body focus & sensory (commonly missed)
                    bodyFluidFocus: Array.isArray(args.bodyFluidFocus) ? args.bodyFluidFocus : [],
                    bodyPartFocus: Array.isArray(args.bodyPartFocus) ? args.bodyPartFocus : [],
                    tactileFocus: Array.isArray(args.tactileFocus) ? args.tactileFocus : [],
                    sensoryAnchors: args.sensoryAnchors || '',
                    emotionCurveInput: args.emotionCurveInput || '', triggerWords: args.triggerWords || '',
                    plotOverview: args.plotOverview || '',
                    detail: args.detail || '',
                    extraNote: args.extraNote || '',
                    autoFields,
                    useStyleProfile: true,
                    useChapterOutline: true,
                  }

                  const tmpl: any = {
                    id: `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`,
                    name: args.name || '场景模板',
                    type: isErotic ? '情色小说' : (args.type || '普通小说'),
                    config,
                    createdAt: new Date().toISOString(),
                  }
                  await templateService.save(tmpl)
                  const autoCount = Object.keys(autoFields).length
                  r = { status: 'success', summary: `已创建场景模板: ${tmpl.name}${autoCount > 0 ? ` (${autoCount}项AI自动)` : ''}`, detail: `模板ID: ${tmpl.id}\n可在场景工坊查看和编辑。` }
                  setFileEditNotify({ filePath: 'scene_templates/updated', newContent: '__AI_EDITED__' })
                } catch (e: any) { r = { status: 'error', summary: `创建失败: ${e.message}` } }

              // ── generate_image: AI 图片生成 ──
              } else if (tc.function.name === 'generate_image') {
                try {
                  const prompt = String(args.prompt || '').slice(0, 1000)
                  if (!prompt) throw new Error('图片描述不能为空')
                  const size = String(args.size || '1024x1024')
                  const style = String(args.style || 'vivid')
                  const result = await aiService.generateImage(prompt, activeConfigId!, activeProjectId || undefined, size, style)
                  r = { status: 'success', summary: '已生成图片', detail: `图片路径: ${result.path}\n提示词: ${prompt}\n花费: ${activeConfig?.currency === 'CNY' ? '¥' : '$'}${result.cost.toFixed(2)}` }
                  // Load image binary and convert to data URL for display
                  let imgSrc = ''
                  if (activeProjectId) {
                    try {
                      const proj = useStore.getState().projects.find(p => p.id === activeProjectId)
                      if (proj?.path) {
                        const imgPath = `${proj.path}/${result.path}`.replace(/\\/g, '/')
                        const b64 = await fileService.readBinary(imgPath)
                        const ext = result.path.split('.').pop()?.toLowerCase() || 'png'
                        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
                        if (b64) imgSrc = `data:${mime};base64,${b64}`
                      }
                    } catch { /* fallback to path */ }
                  }
                  if (!imgSrc) imgSrc = result.path
                  // Add image to current message for display
                  setMessages(prev => {
                    const last = prev[prev.length - 1]
                    if (last && last.role === 'assistant') {
                      return [...prev.slice(0, -1), { ...last, images: [...(last.images || []), imgSrc] }]
                    }
                    return prev
                  })
                } catch (e: any) { r = { status: 'error', summary: `图片生成失败: ${e.message}` } }

              // ── list_prompts: 列出提示词库 ──
              } else if (tc.function.name === 'list_prompts') {
                const lines = prompts.map(p => `[${p.enabled ? '✓启用' : '  关闭'}] ${p.id} | ${p.title} | 类型:${p.type}`)
                const detail = lines.join('\n')
                r = { status: 'success', summary: `${prompts.length} 个提示词模板`, detail }

              // ── toggle_prompt: 切换提示词启用状态 ──
              } else if (tc.function.name === 'toggle_prompt') {
                const pid = String(args.prompt_id || '')
                const enable = args.enabled !== false
                const target = prompts.find(p => p.id === pid)
                if (!target) { r = { status: 'error', summary: `未找到提示词: ${pid}` } }
                else if (enable) {
                  // Disable other enabled prompts of same type
                  const sameType = prompts.filter(p => p.type === target.type && p.id !== pid && p.enabled)
                  for (const p of sameType) updatePromptStore(p.id, { enabled: false })
                  updatePromptStore(pid, { enabled: true })
                  const disabled = sameType.map(p => p.title).join('、')
                  r = { status: 'success', summary: `已启用「${target.title}」${disabled ? `（自动关闭: ${disabled})` : ''}`, detail: `${target.type}类型现在使用「${target.title}」模板。` }
                } else {
                  updatePromptStore(pid, { enabled: false })
                  r = { status: 'success', summary: `已关闭「${target.title}」`, detail: `${target.type}类型现在没有启用的模板，将使用默认格式。` }
                }

              // ── update_prompt: 修改提示词 ──
              } else if (tc.function.name === 'update_prompt') {
                const pid = String(args.prompt_id || '')
                const updates: Record<string, any> = {}
                if (args.title) updates.title = String(args.title)
                if (args.content) updates.content = String(args.content)
                if (args.type) updates.type = String(args.type)
                if (Object.keys(updates).length === 0) { r = { status: 'error', summary: '没有提供要修改的字段' } }
                else {
                  updatePromptStore(pid, updates)
                  const fields = Object.keys(updates).map(k => k === 'title' ? '标题' : k === 'content' ? '内容' : k === 'type' ? '类型' : k).join('、')
                  r = { status: 'success', summary: `已更新提示词 ${fields}`, detail: `模板ID: ${pid}` }
                }

              // ── 路由 D: 草稿笔记工具 (全局存储) ──
              } else if (tc.function.name === 'list_notes') {
                try {
                  const dir = (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, '/notes')
                  const files = await fileService.listDir(dir)
                  const mdFiles = files.filter((f: string) => f.endsWith('.md'))
                  r = { status: 'success', summary: `${mdFiles.length} 个草稿`, detail: mdFiles.join('\n') || '(无草稿)' }
                } catch (e: any) { r = { status: 'error', summary: `列出失败: ${e.message}` } }

              } else if (tc.function.name === 'read_note') {
                try {
                  const noteName = String(args.note_name || '').replace(/\.\./g, '').replace(/[\\/]/g, '')
                  if (!noteName) { r = { status: 'error', summary: '草稿名称无效' } }
                  else {
                    const dir = (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, '/notes')
                    const content = await fileService.read(`${dir}/${noteName}`)
                    r = { status: 'success', summary: `已读取: ${noteName}`, detail: content || '(草稿为空)' }
                  }
                } catch (e: any) { r = { status: 'error', summary: `读取失败: ${e.message}` } }

              } else if (tc.function.name === 'write_note' || tc.function.name === 'append_note') {
                try {
                  const noteName = String(args.note_name || '').replace(/\.\./g, '').replace(/[\\/]/g, '')
                  if (!noteName) { r = { status: 'error', summary: '草稿名称无效' } }
                  else {
                    const newContent = String(args.content || '')
                    const dir = (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, '/notes')
                    const filePath = `${dir}/${noteName}`.replace(/\\/g, '/')
                    if (tc.function.name === 'append_note') {
                      let existing = ''
                      try { existing = await fileService.read(filePath) } catch { /* */ }
                      const combined = existing ? existing + '\n\n' + newContent : newContent
                      await fileService.write(filePath, combined)
                      r = { status: 'success', summary: `已追加到草稿: ${noteName} (+${newContent.length} 字符)` }
                    } else {
                      await fileService.write(filePath, newContent)
                      r = { status: 'success', summary: `已写入草稿: ${noteName} (${newContent.length} 字符)` }
                    }
                    setFileEditNotify({ filePath, newContent: '__AI_EDITED__' })
                  }
                } catch (e: any) { r = { status: 'error', summary: `操作失败: ${e.message}` } }

              } else if (tc.function.name === 'delete_note') {
                try {
                  const noteName = String(args.note_name || '').replace(/\.\./g, '').replace(/[\\/]/g, '')
                  if (!noteName) { r = { status: 'error', summary: '草稿名称无效' } }
                  else {
                    const dir = (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, '/notes')
                    const filePath = `${dir}/${noteName}`.replace(/\\/g, '/')
                    await fileService.deleteFile(filePath)
                    r = { status: 'success', summary: `已删除草稿: ${noteName}` }
                    setFileEditNotify({ filePath, newContent: '__AI_EDITED__' })
                  }
                } catch (e: any) { r = { status: 'error', summary: `删除失败: ${e.message}` } }

              // ── 路由C: 项目文件工具 (IPC 后端) ──
              // 所有对项目目录内文件的 CRUD 操作，通过 executeFileTools 发送到主进程
              } else {
                // Prepend active project ID to paths so AI-relative paths
                // (like "characters/test.json") resolve to the correct project folder.
                const projPrefix = activeProjectId ? activeProjectId + '/' : ''
                const routeArgs = { ...args }
                if (projPrefix && typeof routeArgs.file_path === 'string' && !routeArgs.file_path.startsWith(projPrefix)) {
                  routeArgs.file_path = projPrefix + routeArgs.file_path
                }
                if (projPrefix && typeof routeArgs.dir_path === 'string' && !routeArgs.dir_path.startsWith(projPrefix)) {
                  routeArgs.dir_path = projPrefix + routeArgs.dir_path
                }
                if (projPrefix && typeof routeArgs.new_path === 'string' && !routeArgs.new_path.startsWith(projPrefix)) {
                  routeArgs.new_path = projPrefix + routeArgs.new_path
                }

                // All tools execute directly (batch approval gate already passed)
                if (tc.function.name === 'edit_file') {
                const results = await aiService.executeFileTools([{ callId: tc.id, toolName: tc.function.name, args: { ...routeArgs, _confirmed: true } }])
                r = results[0]
                // Add diff summary for outline/worldbuilding edits
                if (r?.status === 'success') {
                  const ep = String(args.file_path || '').replace(/\\/g, '/')
                  if (ep === 'outline/plot.md' || ep === 'outline/worldbuilding.md' || ep.endsWith('/outline/plot.md') || ep.endsWith('/outline/worldbuilding.md')) {
                    const oldS = (args.old_string as string || '').slice(0, 80)
                    const newS = (args.new_string as string || '').slice(0, 80)
                    const isAppend = newS.includes(oldS) && newS.length > oldS.length
                    const action = isAppend ? '追加' : '修改'
                    const preview = isAppend
                      ? newS.slice(oldS.length).slice(0, 60)
                      : `${oldS.slice(0, 30)} → ${newS.slice(0, 30)}`
                    r.detail = (r.detail || '') + `\n${action}预览: ${preview}${preview.length >= 60 ? '...' : ''}`
                  }
                }
              } else if (DANGEROUS_TOOLS.has(tc.function.name)) {
                const results = await aiService.executeFileTools([{ callId: tc.id, toolName: tc.function.name, args: routeArgs }])
                r = results[0]
              } else {
                // Batch read limits for read-only tools
                if (tc.function.name === 'read_file') {
                  readCounts.read_file++
                  if (readCounts.read_file > MAX_READS) {
                    r = { status: 'error', summary: `本轮已读取 ${MAX_READS} 个文件（上限），请分析已读内容后再继续。` }
                  }
                } else if (tc.function.name === 'list_directory') {
                  readCounts.list_directory++
                  if (readCounts.list_directory > MAX_LISTS) {
                    r = { status: 'error', summary: `本轮已列出 ${MAX_LISTS} 个目录（上限），请按需查询。` }
                  }
                }
                if (!r) {
                  const results = await aiService.executeFileTools([{ callId: tc.id, toolName: tc.function.name, args: routeArgs }])
                  r = results[0]
                }
              }
              } // end Route C
              const content = JSON.stringify({ status: r?.status || 'error', summary: r?.summary || '', detail: r?.detail || '' })
              messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content })
              resultMsgs.push({ id: `${tc.id}_r`, role: 'tool', content, tool_call_id: tc.id, toolName: tc.function.name, timestamp: Date.now() })
              // ══════════════════════════════════════════════════════════════
              // 界面刷新通知机制 (fileEditNotify)
              // ══════════════════════════════════════════════════════════════
              //
              // 每次 AI 工具成功执行后，设置 fileEditNotify 通知相关页面刷新。
              // 通知路径决定哪些页面会响应:
              //   {projectPath}/outline/*.json  → OutlinePage, OutlinePopup
              //   {projectPath}/detailed_outline/* → DetailedOutlinePage
              //   {projectPath}/chapters/*.txt  → ChapterWritingPage
              //   {projectPath}/summaries/*.md  → ChapterWritingPage (summary refresh)
              //   {projectPath}/characters/*.json → CharactersPanel
              //   {projectPath}/notes/*.md       → ScratchpadPage, DraftPopup
              //   {projectPath}                   → HomePage (项目级变更)
              //   knowledge_base/*               → KnowledgeBasePage, KbPopup
              //   style_templates/*              → StyleWorkshopPage（风格模板Tab）
              //   scene_templates/*              → SceneWorkshopPage
              //
              // __AI_EDITED__ 哨兵值: 通知页面从磁盘重新加载，而非使用内存缓存。
              // 通知持续存活，直到下次 handleSend 时统一清除（用户切Tab/页面时可看到新内容）。
              //
              // 消费者注意（各页面 fileEditNotify handler）：
              //   1. 路径比较前务必 .toLowerCase() — Windows 路径大小写不敏感但字符串比较敏感
              //   2. setFileEditNotify(null) 只在匹配成功时调用 — 不匹配就不要清除
              //   3. 遵循 handled 标志模式 — 多个 if/else 分支中只有命中的才 setFileEditNotify(null)
              const fileModifyingTools = ['edit_file', 'create_file', 'delete_file', 'rename_file', 'create_project', 'delete_project']
              if (r?.status === 'success' && activeProjectId) {
                const pp = useStore.getState().projects.find(p => p.id === activeProjectId)?.path
                if (pp) {
                  let targetPath: string
                  if (tc.function.name === 'delete_project') {
                    targetPath = pp
                  } else if (fileModifyingTools.includes(tc.function.name)) {
                    let relPath = String(args.file_path || '').replace(/\\/g, '/')
                    // Strip project prefix if AI accidentally included it (e.g. "1/outline/plot.md")
                    if (activeProjectId && relPath.startsWith(activeProjectId + '/')) {
                      relPath = relPath.slice(activeProjectId.length + 1)
                    }
                    // For notes/, use global notes path instead of project path
                    if (relPath.startsWith('notes/')) {
                      const globalDir = (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, '/notes')
                      targetPath = `${globalDir}/${relPath.replace(/^notes\//, '')}`.replace(/\\/g, '/')
                    } else {
                      targetPath = `${pp}/${relPath}`.replace(/\\/g, '/')
                    }
                  } else if (tc.function.name === 'search_images') {
                    targetPath = `${pp}/images/`  // 图片保存目录
                  } else {
                    targetPath = ''
                  }
                  if (targetPath) {
                    setFileEditNotify({ filePath: targetPath, newContent: '__AI_EDITED__' })
                    // Auto-promote project scene/style templates to global dir
                    if (tc.function.name === 'create_file' || tc.function.name === 'edit_file') {
                      const tgt = targetPath.replace(/\\/g, '/')
                      if (tgt.includes('/scene_templates/') && tgt.endsWith('.json')) {
                        try {
                          const raw = await fileService.read(targetPath)
                          const obj = JSON.parse(raw) as any
                          // Normalize to SceneTemplate format: ensure id/name/type/config exist
                          const tpl: any = {
                            id: obj.id || `proj_${Date.now().toString(36)}`,
                            name: obj.name || obj.templateName || '未命名模板',
                            type: obj.type || '普通小说',
                            createdAt: obj.createdAt || obj.created_at || new Date().toISOString(),
                            // Wrap all AI output as config so editor can read it
                            config: obj.config || obj,
                          }
                          await templateService.save(tpl)
                        } catch { /* best-effort */ }
                      }
                      if (tgt.includes('/style_templates/') && tgt.endsWith('.json')) {
                        try {
                          const raw = await fileService.read(targetPath)
                          const tpl = JSON.parse(raw) as any
                          if (!tpl.id) tpl.id = `proj_${Date.now().toString(36)}`
                          await styleTemplateService.save(tpl)
                        } catch { /* best-effort */ }
                      }
                    }
                  }
                }
              }
            } catch {
              const content = JSON.stringify({ status: 'error', summary: '工具执行异常' })
              messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content })
              resultMsgs.push({ id: `${tc.id}_r`, role: 'tool', content, tool_call_id: tc.id, toolName: tc.function.name, timestamp: Date.now() })
            }
          }
          // Merge tool results into single summary message
          if (resultMsgs.length > 0) {
            const successCount = resultMsgs.filter(m => {
              try { return JSON.parse(m.content).status === 'success' } catch { return false }
            }).length
            const failCount = resultMsgs.length - successCount
            const summaryContent = JSON.stringify({
              status: failCount > 0 ? 'partial' : 'success',
              summary: `执行完毕 — ${successCount}/${resultMsgs.length} 成功${failCount > 0 ? `, ${failCount} 失败` : ''}`,
            })
            const summaryMsg: Message = {
              id: `summary_${Date.now()}`, role: 'tool', content: summaryContent,
              tool_call_id: resultMsgs[0].tool_call_id, toolName: 'batch_summary', timestamp: Date.now(),
            }
            setMessages(prev => [...prev, summaryMsg])
          }
          if (finishReason !== 'tool_calls') isDone = true
        }
      }
      const newTotal = cumulativeTokens + sessionTokens
      setCumulativeTokens(newTotal)
      setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, totalTokens: newTotal, lastPromptTokens: lastPrompt || c.lastPromptTokens, peakPromptTokens: Math.max(c.peakPromptTokens || 0, lastPrompt || 0) } : c))
    } catch (err) {
      const errMsg = parseAiErrorMessage(err)
      setApiError(errMsg)

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
            {/* 上传入口②：按钮 → 文本文件。流程同 handleDrop 的文件分支，见上方注释 */}
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.txt,.md,.text'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = async () => { const text = r.result as string; if (!text.trim()) return; const base = (useStore.getState().projectsBasePath || '').replace(/[/\\]projects[/\\]?$/, ''); const uploadsDir = `${base}/uploads`; try { await fileService.ensureDir(uploadsDir); await fileService.write(`${uploadsDir}/${f.name}`, text.slice(0, 50000)) } catch (e) { console.error('上传文件失败', e) }; setAttachment({ type: 'file', name: f.name, content: text.slice(0, 50000) }) }; r.readAsText(f, 'UTF-8') }; inp.click() }} title="上传文本文件" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 8, border: attachment?.type === 'file' ? '1px solid rgba(124,58,237,0.25)' : '1px solid rgba(0,0,0,0.06)', background: attachment?.type === 'file' ? 'rgba(124,58,237,0.06)' : '#fff', color: '#6b5e54', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><DocumentTextIcon style={{ width: 11, height: 11 }} /> 文件</button>
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
                  {c.model}
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
          <div ref={scrollRef} className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
            {messages.map((msg, i) => {
              // WeChat-style time separator
              const prevMsg = i > 0 ? messages[i - 1] : null
              const isFirst = i === 0
              const hasGap = msg.timestamp && prevMsg?.timestamp && (msg.timestamp - prevMsg.timestamp > 3 * 60 * 1000)
              const showTime = msg.timestamp && (isFirst || hasGap)
              const fmtTime = (ts: number) => {
                const d = new Date(ts)
                const now = new Date()
                const timeStr = d.toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' })
                if (d.toDateString() === now.toDateString()) return timeStr
                const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
                if (d.toDateString() === yesterday.toDateString()) return `昨天 ${timeStr}`
                return `${d.getMonth() + 1}月${d.getDate()}日 ${timeStr}`
              }
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
                    <div onContextMenu={e => { e.preventDefault(); setContextMenu({ msgId: msg.id, x: e.clientX, y: e.clientY }) }}
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
                {/* Compressed summary card */}
              <div onContextMenu={e => { e.preventDefault(); setContextMenu({ msgId: msg.id, x: e.clientX, y: e.clientY }) }}
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
                  <div style={{
                    maxWidth: '82%', padding: '10px 14px', borderRadius: 16,
                    background: msg.role === 'user' ? 'rgba(124,58,237,0.08)'
                      : msg.role === 'tool' ? 'rgba(22,163,74,0.04)'
                      : 'rgba(0,0,0,0.03)',
                    border: msg.role === 'tool' ? '1px solid rgba(22,163,74,0.1)' : undefined,
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
                        <button onClick={() => { setToolInvokeEnabled(true); pendingCorrection.current = `[纠错指令] 你上一条回复中声称执行了操作但实际没有调用工具。现在请立即调用对应工具完成。`; setTimeout(() => handleSend(), 200) }} style={{
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
                    <span>Token: {msg.usage.total_tokens.toLocaleString()}</span>
                    {msg.usage.cost > 0 && <span>花费 {activeConfig?.currency === 'CNY' ? '¥' : '$'}{msg.usage.cost.toFixed(4)}</span>}
                    {msg.wordCount && msg.wordCount > 0 && <span>{msg.wordCount.toLocaleString()} 字</span>}
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
            )})}
            {loading && (
              <div style={{ textAlign: 'center', padding: 6 }}>
                <button onClick={abortToolLoop} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px',
                  borderRadius: 20, border: '1px solid rgba(220,38,38,0.25)', background: '#fff',
                  color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.15s',
                }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#dc2626' }} />
                  停止生成
                </button>
              </div>
            )}
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
              {/* ── Batch approval panel (floating above input) ── */}
              {batchCard && (
                <BatchApprovalPanel
                  batchCard={batchCard}
                  showFeedback={showBatchFeedback}
                  feedback={batchFeedback}
                  onFeedbackChange={setBatchFeedback}
                  onShowFeedback={setShowBatchFeedback}
                  onApprove={handleBatchApprove}
                  onDeny={handleBatchDeny}
                />
              )}
              <textarea value={input} onChange={e => handleInputChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder={batchCard ? '请先审批 AI 的操作计划...' : activeConfigId ? '输入消息...' : '请先在设置中配置模型'}
              disabled={!activeConfigId || !!batchCard} rows={2}
              style={{ flex: 1, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14, outline: 'none', resize: 'none', padding: '8px 12px', fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit', color: batchCard ? '#9b8e84' : '#2d2520', background: batchCard ? 'rgba(0,0,0,0.03)' : 'rgba(0,0,0,0.02)' }}
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
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#2d2520' }}>Prompt Token 分解</h3>
            <button onClick={() => setBreakdownModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9b8e84', fontSize: 18, padding: 0, lineHeight: 1 }}>×</button>
          </div>
          {breakdownModal.breakdown.map((b, i) => {
            const est = Math.round(b.chars / 2)
            const pct = breakdownModal.breakdown.reduce((s, x) => s + Math.round(x.chars / 2), 0)
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
            <span>输入 Prompt（估算）</span>
            <span>~{breakdownModal.breakdown.reduce((s, b) => s + Math.round(b.chars / 2), 0).toLocaleString()} tokens</span>
          </div>
          {breakdownModal.completionTokens !== undefined && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginTop: 4 }}>
              <span style={{ color: '#16a34a' }}>输出 Completion</span>
              <span style={{ color: '#16a34a' }}>{breakdownModal.completionTokens.toLocaleString()} tokens</span>
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 10, color: '#9b8e84' }}>估算公式: 字符数 ÷ 2 ≈ tokens。实际以 API 返回为准。</div>
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
            return <button onClick={() => { setBreakdownModal({ breakdown: msg.breakdown!, completionTokens: msg.usage?.completion_tokens }); setContextMenu(null) }} style={ctxMenuBtn}>
              <MagnifyingGlassIcon style={{ width: 13, height: 13 }} /> 查看Token分解
            </button>
          }
          return null
        })()}
      </div>
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


