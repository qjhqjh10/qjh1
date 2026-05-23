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
} from '@heroicons/react/24/outline'
import { DEFAULT_AI_SETTINGS } from '@/types/settings'
import { logError } from '@/utils/logger'
import { parseAiErrorMessage } from '@/utils/textUtils'
import { getStyleInjection } from '@/utils/styleInjector'
import { FILE_TOOLS, READ_ONLY_TOOLS, DANGEROUS_TOOLS } from '@/types/fileOps'
import { ContextUsageBar } from '@/components/ai/ContextUsageBar'
import { WELCOME_MSG, FILE_OP_SYSTEM_PROMPT, STORAGE_KEY, LAST_ACTIVE_KEY, WINDOW_KEY } from '@/components/ai/chatConstants'
import type { Message, Conversation } from '@/components/ai/chatConstants'
import ImageLightbox from '@/components/common/ImageLightbox'

function makeConversation(id: string, title: string): Conversation {
  return { id, title, messages: [{ ...WELCOME_MSG, id: `welcome_${id}` }], createdAt: Date.now(), totalTokens: 0, lastPromptTokens: 0 }
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

export default function AIChatWindow() {
  const isOpen = useStore(s => s.isAIChatOpen)
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
  const characters = useStore(s => s.characters)
  const outlineContent = useStore(s => s.outlineContent)
  const rewriteContent = useStore(s => s.rewriteContent)
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
  const prompts = useSettingsStore(s => s.prompts)
  const updatePromptStore = useSettingsStore(s => s.updatePrompt)
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

  // Auto-switch to Plan when leaving a project (no project = no Action)
  useEffect(() => {
    if (!activeProjectId && aiSettings.workMode === 'action') {
      useSettingsStore.getState().setAISettings({ workMode: 'plan' })
    }
  }, [activeProjectId])

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
  }, [activeConversationId])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const abortRef = useRef(false)
  const [showConvList, setShowConvList] = useState(false)
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set())
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) => setExpandedMsgs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const scrollRef = useRef<HTMLDivElement>(null)

  const toggleSelectMsg = (id: string) => setSelectedMsgIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const deleteSelectedMsgs = () => {
    setMessages(prev => prev.filter(m => !selectedMsgIds.has(m.id)))
    setSelectedMsgIds(new Set())
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
  const switchConversation = (convId: string) => { if (convId !== activeConversationId) { abortToolLoop(); setActiveConversationId(convId) } }
  const handleNewConversation = () => { abortToolLoop(); const id = Date.now().toString(); setConversations(prev => [...prev, makeConversation(id, '新对话')]); setActiveConversationId(id); setShowConvList(false) }
  const handleClearConversation = () => { abortToolLoop(); setMessages([{ ...WELCOME_MSG, id: `welcome_${activeConversationId}` }]); setCumulativeTokens(0); setLastPromptTokens(0); setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, totalTokens: 0, lastPromptTokens: 0 } : c)) }
  const handleDeleteConversation = (convId: string) => { abortToolLoop(); setConversations(prev => { const r = prev.filter(c => c.id !== convId); if (r.length === 0) { setActiveConversationId('default'); return [makeConversation('default', '新对话')] } if (convId === activeConversationId) setActiveConversationId(r[0].id); return r }) }

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

  const contextPriority = aiSettings.contextPriority

  // Inject custom AI role if matching
  const customRole = (aiSettings.customRoles || []).find(r => r.id === aiSettings.defaultRole)

  const buildContextPrefix = (kbContext: string, webContext: string): string => {
    const cg = aiSettings.chapterGen
    const parts: string[] = []
    if (customRole?.prompt) {
      parts.push(`[AI角色: ${customRole.name}]\n${customRole.prompt}`)
    }

    if (activePage === 'chapter' && currentChapter) {
      parts.push(`[当前章节标题: ${currentDetailedChapter?.title || '未命名'}，${currentChapter.content?.length || 0}字]`)
      if (currentDetailedChapter?.plotOverview) parts.push(`[本章剧情概述:\n${currentDetailedChapter.plotOverview.slice(0, 5000)}]`)
      if (currentDetailedChapter?.description) parts.push(`[本章细纲:\n${currentDetailedChapter.description.slice(0, 5000)}]`)
      // Do NOT inject full chapter body — read_file if user asks to see/edit it
      parts.push(`
当用户要求修改章节某段/某句/某词时 → read_file 找到原文 → edit_file 精确替换
**禁止将完整章节内容输出到对话框**，只输出简短摘要（如"已将第3段修改为..."）
用户明确要求"查看""显示""输出"完整内容时才输出全文

**章节生成设置** (用户已在"AI生成"按钮中配置，生成章节正文时使用):
- 字数目标: ${cg.wordTarget}字
- 输出模式: ${cg.replaceMode ? '替换当前正文' : '追加到末尾'}
- 关联上下文: ${[
    cg.outlineTabs.plot && '故事剧情', cg.outlineTabs.worldbuilding && '世界观', cg.outlineTabs.characters && '角色',
    cg.outlineTabs.items && '道具', cg.outlineTabs.locations && '地点', cg.outlineTabs.factions && '势力',
    cg.outlineTabs.powerSystem && '等级', cg.outlineTabs.foreshadowing && '伏笔', cg.outlineTabs.emotion && '情绪',
    cg.outlineTabs.plotThreads && '故事线',
    cg.detailedOutlineFields.plotOverview && '本章剧情概述', cg.detailedOutlineFields.chapterCharacters && '出现角色',
    cg.detailedOutlineFields.location && '场景地点', cg.detailedOutlineFields.keyEvents && '关键事件',
    cg.detailedOutlineFields.eroticContent && '情色剧情',
  ].filter(Boolean).join('、') || '无'}`)
    }

    if (activePage === 'outline' && outlineContent) {
      parts.push(`[当前故事剧情记录:\n${outlineContent.slice(0, 8000)}]`)
      parts.push(`用户正在大纲页面。大纲包含10个Tab，你可通过 edit_file 编辑对应的JSON文件来修改各个Tab的数据。

**核心Tab — 故事剧情 (outline/plot.json) 和 世界观（设定） (outline/worldbuilding.json):**
纯文本文件，用 Markdown 格式 (# 标题, - 列表)。写入: read_file 确认内容 → edit_file(old_string="原文", new_string="原文\n新增")。若文件为空则 old_string=""。绝不写JSON。

**其他大纲Tab与对应文件（完整字段，创建时必须全部包含）：**
- 世界观（设定） → outline/worldbuilding.json（纯文本，同故事剧情）
- 角色 → characters/{nanoid}.json（创建时 generate_nanoid:true）字段: id,name,role(必须是:男主|女主|男配|女配|反派|其他之一),gender,age,occupation(必填,职业/身份/社会地位,不可为空),background,appearance,personality,**abilities(纯文本字符串,不可为对象!)**,weaknesses,relationships,relationshipTags(字符串数组),arc,importance(1-100),image
- 道具 → outline/items.json: {"items":[{"id":"nanoid","name":"","type":"武器|法宝|丹药|功法|道具|其他","grade":"","ability":"","owner":"","description":""}]}
- 地点 → outline/locations.json: {"locations":[{"id":"nanoid","name":"","description":"","type":"门派|城池|秘境|自然|其他"}]}
- 势力 → outline/factions.json: {"factions":[{"id":"nanoid","name":"","description":"","type":"正道|邪道|中立|皇朝|其他"}]}
- 等级 → outline/power_system.json: {"name":"","levels":[{"name":"","description":""}],"description":""}
- 伏笔 → outline/outline_meta.json foreshadowing: [{"id":"nanoid","description":"","plantChapterId":"","payoffChapterId":"","status":"planted|resolved"}]
- 情绪 → outline/emotion.json: {"segments":[{"chapterStart":1,"chapterEnd":1,"dominantEmotion":""}]}
- 故事线 → outline/outline_meta.json plotThreads: [{"id":"nanoid","name":"","type":"main|sub|hidden","color":"#7c3aed","**chapterIds**:[]"}] ← chapterIds 必须存在,至少是空数组[]!

修改文件后界面会自动刷新。用 read_file 查看当前数据，edit_file 精确修改。分析建议和文本改写可直接在聊天中输出。`)
    }

    if (activePage === 'worldbuilding' && worldbuildingContent) {
      parts.push(`[当前世界观设定:\n${worldbuildingContent.slice(0, 10000)}]`)
      parts.push('用户正在编辑世界观设定。你可以分析世界观逻辑一致性、设定漏洞，提出扩展建议。如果用户要求改写，直接输出内容。')
    }

    if (activePage === 'rewrite' && rewriteContent) {
      parts.push(`[当前章节正文(剧情改写):\n${rewriteContent.slice(0, 20000)}]`)
      parts.push(`
如果用户要求改写润色，请用以下格式（原文将被标红，改写将被标蓝插入其后，由使用者手动替换）：
【改写参考】
原文: <需要改写的原文句子（尽量完整引用）>

【改写内容】
<改写后的文字>

如果用户要求生成新内容，请用以下格式：
【插入参考】
原文关键词: <引述原文中要插入位置的上下文句子>
建议位置: 该段之后

【生成内容】
<你的创作内容>`)
    }

    if (activePage === 'detailed-outline' && detailedChapters.length > 0) {
      const chapterList = detailedChapters.map(c => `[${c.status === 'completed' ? '✓' : '○'}] ${c.title} (id: ${c.id})`).join('\n')
      parts.push(`[当前细纲列表(${detailedChapters.length}章):\n${chapterList}]`)
      parts.push(`用户正在细纲页面。细纲的每个章节是独立的JSON文件，存储在 detailed_outline/{id}.json。

**字段结构:**
- id: 唯一标识
- title: 章节标题（如"章节 3"）
- order: 排序序号
- status: 'incomplete' | 'completed'
- plotOverview: 剧情概述（150-250字）
- characters: 出场角色（每行一个角色名）
- location: 场景地点
- keyEvents: 关键事件（每行一个）
- eroticContent: 情色内容（仅情色小说）

**操作规则（重要）:**
1. 查看细纲：用户需指定具体章节（如"查看章节3的细纲"）。如果没说哪一章，提醒用户选择。
2. 修改细纲：先用 read_file 查看该章JSON，给出分析建议，用户确认后用 edit_file 修改。
3. 新建细纲：用 create_file 创建 detailed_outline/{新id}.json，然后问用户要填什么内容（剧情概述/角色/地点/事件）。
4. 删除细纲：用 delete_file 删除对应JSON文件（需用户确认）。
5. 一次只操作一个章节的细纲，不要把全部细纲内容一起读出来。
6. 创建场景模板：如果用户要求根据某章细纲创建场景模板，先 read_file 读该章JSON，分析剧情概述/角色/地点/事件/情绪基调，然后调用 create_scene_template 工具保存。`)
    }

    if (activePage === 'characters' && characters.length > 0) {
      const cs = characters.map(c => `${c.name}(${c.role || '未分类'}): ${c.personality?.slice(0, 200) || ''}`).join('\n')
      parts.push(`[角色列表(${characters.length}个):\n${cs}]\n角色数据存储在 characters/*.json，你可读取/编辑角色文件。`)
    }

    if (activePage === 'scene-workshop') {
      parts.push('用户正在场景工坊配置场景参数。你可帮助分析场景结构、推荐配置、优化叙事技法和情绪设计。')
    }

    if (activePage === 'continuation-workspace' || activePage === 'continuation-writing') {
      parts.push('用户正在进行小说续写。你可帮助分析原文、提取角色和设定、规划剧情走向、生成续写大纲和细纲。续写数据存储在 continuation_projects/ 目录。')
    }

    if (activePage === 'story-map') {
      parts.push('用户正在故事脉络页面分析小说结构。你可帮助分析时间线、检测设定冲突、解读情绪曲线和节奏。故事数据存储在 story_workspace/ 目录。')
    }

    if (activePage === 'scratchpad') {
      parts.push('用户正在草稿本。草稿全局存储，不绑定项目。你可使用 read_note/write_note/append_note 操作草稿。')
    }

    if (activePage === 'style-workshop') {
      parts.push('用户正在风格工坊分析文风。你可帮助分析 26 维文风特征、总结风格档案、填充风格模板。风格数据存储在 style_projects/ 目录。')
    }

    if (activePage === 'imitation') {
      parts.push('用户正在进行小说仿写。你可帮助提取原作特征、生成模仿大纲和细纲。仿写数据存储在项目 extraction.json 文件中。')
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
    // Clear stale notifications from previous AI operations before starting new ones
    setFileEditNotify(null)
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input.trim(), timestamp: Date.now() }
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

      // System messages
      const promptStatus = prompts.map(p =>
        `  [${p.enabled ? '✓' : ' '}] ${p.id}: ${p.title} (${p.type})${p.enabled ? ' ← 当前使用' : ''}`
      ).join('\n')
      const systemMessages: Array<{ role: string; content: string }> = [
        { role: 'system', content: FILE_OP_SYSTEM_PROMPT },
        { role: 'system', content: aiSettings.workMode === 'plan'
          ? `[Plan分析模式] 只读: list_directory/read_file/search_files/search_content/list_backups + 草稿笔记。分析后说明方案，需写入时提醒切换Action。`
          : `[Action执行模式] 全部工具可用。` },
        { role: 'system', content: `【当前提示词库状态 — 每种类型只有一个启用，生成内容时参考对应启用模板的格式要求】\n${promptStatus}\n\n提示词管理工具: list_prompts(查看全部) / toggle_prompt(prompt_id, enabled)(切换启用) / update_prompt(prompt_id, title?, content?, type?)(修改模板)。同类型只能启用一个，启用新模板会自动关闭旧的。` },
      ]

      // History with tool support — maps stored UI messages back to API format
      const historyMessages = messages
        .filter(m => !m.id.startsWith('welcome') && String(m.role) !== 'system')
        .map(m => ({
          role: m.role as string, content: m.content,
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        }))

      // Build the full message array: system prompts + conversation history + current user message
      const messagesForApi: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> = [
        ...systemMessages,
        ...historyMessages,
        { role: 'user' as const, content: stylePrefix + contextPrefix + '\n\n[用户输入]\n' + userMsg.content },
      ]

      // Tools
      const activeTools = aiSettings.workMode === 'plan'
        ? FILE_TOOLS.filter((t: any) => READ_ONLY_TOOLS.has(t.function.name))
        : FILE_TOOLS
      const toolsForApi = activeTools

      let iteration = 0; const MAX_ITER = 8; let isDone = false
      let sessionTokens = 0; let lastPrompt = 0
      abortRef.current = false
      while (iteration < MAX_ITER && !isDone && !abortRef.current) {
        iteration++
        // AI chat with tools. In Action mode, the AI can call file operations; in Plan mode, only read-only tools.
        // Safety: backend enforces path isolation (isSafePath), file size limits, and dangerous tool confirmation.
        const response = await aiService.chatWithTools(messagesForApi, activeConfigId!, activeProjectId || undefined, toolsForApi)
        const { text, toolCalls, finishReason, images, usage, reasoning_content } = response
        sessionTokens = usage?.total_tokens || sessionTokens
        if (usage?.prompt_tokens) { lastPrompt = usage.prompt_tokens; setLastPromptTokens(usage.prompt_tokens) }

        if (!toolCalls || toolCalls.length === 0) {
          const popupParsed = parsePopupCommand(text)
          const displayText = popupParsed.popup ? popupParsed.text : text
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
          const assistantMsg: Message = {
            id: Date.now().toString() + '_r', role: 'assistant', content: plainText || displayText, timestamp: Date.now(), insertion,
            usage: usage ? { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens, cost: usage.cost } : undefined,
            wordCount: plainText ? plainText.replace(/\s/g, '').length : 0,
            sources: { kb: kbSources, web: webSources }, images,
          }
          setMessages(prev => [...prev, assistantMsg])
          isDone = true
        } else {
          // Process tool calls
          const assistantMsgForApi: Record<string, unknown> = { role: 'assistant', content: text || '', tool_calls: toolCalls }
          if (reasoning_content) assistantMsgForApi.reasoning_content = reasoning_content
          messagesForApi.push(assistantMsgForApi as any)
          // Persist assistant message with tool_calls so conversation history retains context
          setMessages(prev => [...prev, {
            id: `${Date.now()}_tc`, role: 'assistant' as const, content: text || '', timestamp: Date.now(),
            tool_calls: toolCalls,
          }])
          const resultMsgs: Message[] = []
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
                  const tmpl: any = {
                    name: args.name || '未命名模板', type: args.type || '普通小说',
                    worldType: args.worldType || '', description: args.description || '',
                    dimensions: args.dimensions || {}, vocabularyList: args.vocabularyList || [],
                    writingRules: args.writingRules || [], tone: args.tone || {},
                    source: 'ai-generated', createdAt: '', updatedAt: '', id: '',
                  }
                  const saved = await styleTemplateService.save(tmpl) as any
                  r = { status: 'success', summary: `已创建风格模板: ${saved.name || tmpl.name}`, detail: `模板ID: ${saved.id}\n可在风格工坊→模板库查看和编辑。` }
                  // 通知风格工坊+模板库刷新
                  setFileEditNotify({ filePath: 'style_templates/updated', newContent: '__AI_EDITED__' })
                } catch (e: any) { r = { status: 'error', summary: `创建失败: ${e.message}` } }

              // create_scene_template: 创建场景模板 → 连接 SceneWorkshopPage
              } else if (tc.function.name === 'create_scene_template') {
                try {
                  const isErotic = String(args.type || '').includes('情色')

                  // Build characters array
                  const charLines = String(args.characters || '').split('\n').filter(Boolean)
                  const charObjs = charLines.map((line: string) => {
                    const parts = line.split(/[-—–·]/)
                    return { characterId: '', characterName: parts[0]?.trim() || line.trim(), emotion: parts[1]?.trim() || '' }
                  })

                  // Track which fields AI explicitly provided (non-empty, non-default)
                  const aiProvided = new Set<string>()
                  const argKeys = Object.keys(args).filter(k => k !== 'name' && k !== 'type' && k !== 'autoFields')
                  for (const k of argKeys) {
                    const v = args[k]
                    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) {
                      aiProvided.add(k)
                    }
                  }
                  // Also add explicit autoFields entries
                  if (Array.isArray(args.autoFields)) args.autoFields.forEach((f: string) => aiProvided.add(f))

                  const allFieldKeys = [
                    'sceneType','scenePurpose','conflictType','characters','location','time','weather','atmosphere',
                    'senses','dialogueRatio','subtextLevel','sentenceStyle','paragraphDensity',
                    'wordTarget','narrativePOV','narrativeStyle','timeCompression','introspection',
                    'emotionStart','emotionEnd','dominantEmotion','pacing','foreshadowUse','sceneTurningPoint',
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
                    props: '', appearance: '', bodyLanguage: '',
                    foreshadowUse: args.foreshadowUse || '无',
                    sceneTurningPoint: args.sceneTurningPoint || '',
                    intensity: args.eroticIntensity || 3,
                    selectedKinks: Array.isArray(args.selectedKinks) ? args.selectedKinks : [],
                    opening: Array.isArray(args.opening) ? args.opening : [],
                    mainPose: args.mainPose || '无偏好',
                    mainRhythm: '无偏好', poseChanges: '2-3次转换',
                    climax: Array.isArray(args.climax) ? args.climax : [],
                    aftermath: Array.isArray(args.aftermath) ? args.aftermath : [],
                    soundDensity: '中等', moanStyle: '含蓄',
                    degradeLangs: [], bannedWords: '',
                    consentDynamic: '默认', aftercareDetail: '',
                    worldRules: '', propList: '', costumeList: '',
                    plotOverview: args.plotOverview || '',
                    detail: args.detail || '',
                    extraNote: args.extraNote || '',
                    autoFields,
                    useStyleProfile: true,
                    useChapterOutline: true,
                  }

                  const tmpl: any = {
                    id: `ai_${Date.now().toString(36)}`,
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
              // 后端 handler: electron/ipc/fileToolHandlers.ts 的 executeFileTool()
              // 支持的工具: list_directory, read_file, search_files, search_content,
              //   edit_file, create_file, delete_file, rename_file, restore_backup,
              //   list_backups, create_project, delete_project,
              //   search_images 等
              // edit_file: auto-apply directly (auto-backup in backend)
              } else if (tc.function.name === 'edit_file') {
                const results = await aiService.executeFileTools([{ callId: tc.id, toolName: tc.function.name, args: { ...args, _confirmed: true } }])
                r = results[0]
              // create/delete dangerous tools: auto-confirmed
              } else if (DANGEROUS_TOOLS.has(tc.function.name)) {
                const results = await aiService.executeFileTools([{ callId: tc.id, toolName: tc.function.name, args, confirmed: true }])
                r = results[0]
              } else {
                const results = await aiService.executeFileTools([{ callId: tc.id, toolName: tc.function.name, args }])
                r = results[0]
              }
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
              //   {projectPath}/characters/*.json → CharactersPanel
              //   {projectPath}/notes/*.md       → ScratchpadPage, DraftPopup
              //   {projectPath}                   → HomePage (项目级变更)
              //   knowledge_base/*               → KnowledgeBasePage, KbPopup
              //   style_templates/*              → StyleWorkshopPage（风格模板Tab）
              //   scene_templates/*              → SceneWorkshopPage
              //
              // __AI_EDITED__ 哨兵值: 通知页面从磁盘重新加载，而非使用内存缓存
              // 通知持续存活，直到下次 handleSend 时统一清除（用户切Tab/页面时可看到新内容）
              const fileModifyingTools = ['edit_file', 'create_file', 'delete_file', 'rename_file', 'restore_backup', 'create_project', 'delete_project']
              if (r?.status === 'success' && activeProjectId) {
                const pp = useStore.getState().projects.find(p => p.id === activeProjectId)?.path
                if (pp) {
                  let targetPath: string
                  if (tc.function.name === 'delete_project') {
                    targetPath = pp
                  } else if (fileModifyingTools.includes(tc.function.name)) {
                    targetPath = `${pp}/${String(args.file_path || '').replace(/\\/g, '/')}`.replace(/\\/g, '/')
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
          // Store tool results in conversation history
          if (resultMsgs.length > 0) setMessages(prev => [...prev, ...resultMsgs])
          if (finishReason !== 'tool_calls') isDone = true
        }
      }
      const newTotal = cumulativeTokens + sessionTokens
      setCumulativeTokens(newTotal)
      setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, totalTokens: newTotal, lastPromptTokens: lastPrompt || c.lastPromptTokens } : c))
      setLoading(false)
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
            {/* Plan/Action toggle — Action requires entering a project first */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <div style={{ display: 'inline-flex', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden' }}
                title={activeProjectId ? '' : '请先进入一个项目，才能使用 Action 模式'}>
                <button onClick={() => useSettingsStore.getState().setAISettings({ workMode: 'plan' })} style={{ padding: '4px 10px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: aiSettings.workMode === 'plan' ? 700 : 400, background: aiSettings.workMode === 'plan' ? 'rgba(22,163,74,0.12)' : 'transparent', color: aiSettings.workMode === 'plan' ? '#16a34a' : '#9b8e84', fontFamily: 'inherit' }}>Plan</button>
                <button onClick={() => { if (activeProjectId) useSettingsStore.getState().setAISettings({ workMode: 'action' }) }} style={{ padding: '4px 10px', border: 'none', borderLeft: '1px solid rgba(0,0,0,0.06)', cursor: activeProjectId ? 'pointer' : 'not-allowed', fontSize: 11, fontWeight: aiSettings.workMode === 'action' ? 700 : 400, background: aiSettings.workMode === 'action' ? 'rgba(217,119,6,0.12)' : 'transparent', color: aiSettings.workMode === 'action' ? '#d97706' : '#d4ccc4', fontFamily: 'inherit', opacity: activeProjectId ? 1 : 0.5 }}>Action</button>
              </div>
              {!activeProjectId && (
                <span style={{ fontSize: 9, color: '#d97706', fontWeight: 600 }}>进入项目后可用</span>
              )}
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
            {/* Upload file (TXT/MD) */}
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.txt,.md,.text'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { const text = r.result as string; if (text.trim()) { setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: `[上传文件: ${f.name}]\n\n${text.slice(0, 50000)}` }]); setTimeout(() => handleSend(), 100) } }; r.readAsText(f, 'UTF-8') }; inp.click() }} title="上传文本文件" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', color: '#6b5e54', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><DocumentTextIcon style={{ width: 11, height: 11 }} /> 文件</button>
            {/* Upload image */}
            <button onClick={() => { if (!activeProjectId) return; const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = async () => { const pp = useStore.getState().projects.find(p => p.id === activeProjectId)?.path; if (!pp) return; try { const fn = await fileService.saveImageUrl(r.result as string, pp); if (fn) { setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: `[上传图片: images/${fn}]` }]); setTimeout(() => handleSend(), 100) } } catch {} }; r.readAsDataURL(f) }; inp.click() }} title="上传图片" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', color: '#6b5e54', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><PhotoIcon style={{ width: 11, height: 11 }} /> 图片</button>
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

          <ContextUsageBar usedTokens={lastPromptTokens} contextWindow={activeConfig?.contextWindow ?? 128000} />

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
              const toolLabel = (msg as any).toolName || ''
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

              return (
              <div key={`w_${msg.id}`}>
                {timeSep}
              <div onContextMenu={e => { e.preventDefault(); toggleSelectMsg(msg.id) }}
                style={{ background: selectedMsgIds.has(msg.id) ? 'rgba(124,58,237,0.04)' : 'transparent', borderRadius: 8, transition: 'background 0.15s' }}>
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
                    {/* Collapsible long content */}
                    {(() => {
                      const isLong = msg.role === 'assistant' && !msg.tool_calls && displayContent.length > 550
                      if (!isLong) return displayContent
                      const isExpanded = expandedMsgs.has(msg.id)
                      return (
                        <div>
                          <div style={{ marginBottom: isExpanded ? 8 : 0 }}>{isExpanded ? displayContent : displayContent.slice(0, 380) + '...'}</div>
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
                {/* Usage footer — only on assistant messages */}
                {msg.role === 'assistant' && msg.usage && (
                  <div style={{ marginLeft: 36, marginTop: 2, marginBottom: 2, display: 'flex', gap: 10, fontSize: 10, color: '#9b8e84' }}>
                    <span>Token: {msg.usage.total_tokens.toLocaleString()}</span>
                    {msg.usage.cost > 0 && <span>花费 {activeConfig?.currency === 'CNY' ? '¥' : '$'}{msg.usage.cost.toFixed(4)}</span>}
                    {msg.wordCount && msg.wordCount > 0 && <span>{msg.wordCount.toLocaleString()} 字</span>}
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
    </>
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


