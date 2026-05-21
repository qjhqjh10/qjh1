import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore, useSettingsStore } from '@/store'
import { aiService, kbService, fileService } from '@/services/fileService'
import {
  XMarkIcon, PaperAirplaneIcon, UserIcon, SparklesIcon,
  ArrowDownTrayIcon, BookOpenIcon, GlobeAltIcon,
  MagnifyingGlassIcon, ClipboardIcon, ArrowRightIcon,
  PlusIcon, ArrowPathIcon, ListBulletIcon,
  ExclamationTriangleIcon, DocumentTextIcon, PhotoIcon,
} from '@heroicons/react/24/outline'
import { DEFAULT_AI_SETTINGS } from '@/types/settings'
import { logError } from '@/utils/logger'
import { parseAiErrorMessage } from '@/utils/textUtils'
import { getStyleInjection } from '@/utils/styleInjector'
import { FILE_TOOLS, READ_ONLY_TOOLS } from '@/types/fileOps'
import { ContextUsageBar } from '@/components/ai/ContextUsageBar'
import { WELCOME_MSG, FILE_OP_SYSTEM_PROMPT, STORAGE_KEY, LAST_ACTIVE_KEY } from '@/components/ai/chatConstants'
import type { Message, Conversation } from '@/components/ai/chatConstants'

function makeConversation(id: string, title: string): Conversation {
  return { id, title, messages: [{ ...WELCOME_MSG, id: `welcome_${id}` }], createdAt: Date.now() }
}

function parsePopupCommand(text: string): { text: string; popup?: { type: 'outline' | 'worldbuilding' | 'draft'; title: string; documentKey?: string } } {
  const patterns: { pattern: RegExp; type: 'outline' | 'worldbuilding' | 'draft'; title: string; documentKey?: string }[] = [
    { pattern: /【打开大纲】/, type: 'outline', title: '大纲' },
    { pattern: /【打开世界观】/, type: 'worldbuilding', title: '世界观' },
    { pattern: /【打开草稿(?:[：:]\s*(.+?))?】/, type: 'draft', title: '草稿本', documentKey: '草稿本.md' },
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

  // Cleanup drag/resize listeners on unmount
  useEffect(() => {
    return () => { cleanupDragRef.current?.() }
  }, [])

  const [cumulativeTokens, setCumulativeTokens] = useState(0)

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

  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) { const p = JSON.parse(s) as Conversation[]; if (Array.isArray(p) && p.length > 0) return p } } catch (e) { logError('加载对话历史失败', e) }
    return [makeConversation('default', '新对话')]
  })
  const [activeConversationId, setActiveConversationId] = useState(() => {
    try { const la = localStorage.getItem(LAST_ACTIVE_KEY); const s = localStorage.getItem(STORAGE_KEY); if (s && la) { const p = JSON.parse(s) as Conversation[]; if (Array.isArray(p) && p.find(c => c.id === la)) return la } } catch (e) { logError('加载活动对话ID失败', e) }
    return 'default'
  })
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations)) } catch (e) { logError('保存对话历史失败', e) } }, [conversations])
  useEffect(() => { try { localStorage.setItem(LAST_ACTIVE_KEY, activeConversationId) } catch (e) { logError('保存活动对话ID失败', e) } }, [activeConversationId])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showConvList, setShowConvList] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

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

  const abortToolLoop = () => { setLoading(false) }
  const switchConversation = (convId: string) => { if (convId !== activeConversationId) { abortToolLoop(); setActiveConversationId(convId); setCumulativeTokens(0) } }
  const handleNewConversation = () => { abortToolLoop(); const id = Date.now().toString(); setConversations(prev => [...prev, makeConversation(id, '新对话')]); setActiveConversationId(id); setCumulativeTokens(0); setShowConvList(false) }
  const handleClearConversation = () => { abortToolLoop(); setMessages([{ ...WELCOME_MSG, id: `welcome_${activeConversationId}` }]); setCumulativeTokens(0) }
  const handleDeleteConversation = (convId: string) => { abortToolLoop(); setConversations(prev => { const r = prev.filter(c => c.id !== convId); if (r.length === 0) { setActiveConversationId('default'); return [makeConversation('default', '新对话')] } if (convId === activeConversationId) setActiveConversationId(r[0].id); return r }); setCumulativeTokens(0) }

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
      parts.push(`[当前大纲/基础设定:\n${outlineContent.slice(0, 8000)}]`)
      parts.push(`用户正在大纲页面。大纲包含10个Tab，你可通过 edit_file 编辑对应的JSON文件来修改各个Tab的数据。

**大纲各Tab与对应文件：**
- 基础设定 → outline/outline.json (JSON: {content, updatedAt})
- 世界观 → outline/worldbuilding.json (JSON: {content, updatedAt})
- 角色 → characters/*.json (每个角色一个文件)
- 道具 → outline/items.json (JSON: {items: [{id,name,type,grade,ability,owner,description}]})
- 地点 → outline/locations.json (JSON: {locations: [{id,name,description,type}]})
- 势力 → outline/factions.json (JSON: {factions: [{id,name,description,type}]})
- 等级 → outline/power_system.json (JSON: {name,levels:[{name,description}],description})
- 伏笔 → outline/outline_meta.json (foreshadowing数组: [{id,description,status}])
- 情绪 → outline/emotion.json (JSON: {segments:[{chapterStart,chapterEnd,dominantEmotion}]})
- 故事线 → outline/outline_meta.json (plotThreads数组: [{id,name,type,color}])

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
5. 一次只操作一个章节的细纲，不要把全部细纲内容一起读出来。`)
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

      // System messages
      const systemMessages: Array<{ role: string; content: string }> = [
        { role: 'system', content: FILE_OP_SYSTEM_PROMPT },
        { role: 'system', content: aiSettings.workMode === 'plan'
          ? `[Plan分析模式] 只读: list_directory/read_file/search_files/search_content/list_backups + 草稿笔记。分析后说明方案，需写入时提醒切换Action。`
          : `[Action执行模式] 全部工具可用。` },
      ]

      // History with tool support
      const historyMessages = messages
        .filter(m => !m.id.startsWith('welcome') && String(m.role) !== 'system')
        .map(m => ({
          role: m.role as string, content: m.content,
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
        }))

      // Tools
      const activeTools = aiSettings.workMode === 'plan'
        ? FILE_TOOLS.filter((t: any) => READ_ONLY_TOOLS.has(t.function.name))
        : FILE_TOOLS
      const toolsForApi = activeProjectId ? activeTools : activeTools.filter((t: any) => !['list_notes','read_note','write_note','append_note','delete_note'].includes(t.function.name))

      const messagesForApi: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> = [
        ...systemMessages,
        { role: 'user' as const, content: stylePrefix + contextPrefix + '\n\n[用户输入]\n' + userMsg.content },
      ]

      let iteration = 0; const MAX_ITER = 8; let isDone = false
      let sessionTokens = 0
      while (iteration < MAX_ITER && !isDone) {
        iteration++
        const response = await aiService.chatWithTools(messagesForApi, activeConfigId!, activeProjectId || undefined, toolsForApi)
        const { text, toolCalls, finishReason, images, usage } = response
        sessionTokens += usage?.total_tokens || 0

        if (!toolCalls || toolCalls.length === 0) {
          const popupParsed = parsePopupCommand(text)
          const displayText = popupParsed.popup ? popupParsed.text : text
          const { plainText, insertion } = parseInsertionSuggestion(displayText)
          // Auto-open popup if AI included the command
          if (popupParsed.popup) {
            const id = Date.now().toString()
            openPopup({ id: `ai_${id}`, type: popupParsed.popup.type, title: popupParsed.popup.title, documentKey: popupParsed.popup.documentKey })
          }
          const assistantMsg: Message = {
            id: Date.now().toString() + '_r', role: 'assistant', content: plainText || displayText, insertion,
            sources: { kb: kbSources, web: webSources }, images,
          }
          setMessages(prev => [...prev, assistantMsg])
          isDone = true
        } else {
          // Process tool calls
          messagesForApi.push({ role: 'assistant', content: text || '', tool_calls: toolCalls })
          const resultMsgs: Message[] = []
          for (const tc of toolCalls) {
            try {
              const args = JSON.parse(tc.function.arguments)
              let r: { status: string; summary: string; detail?: string } | undefined
              // Route KB creation/append tools to kbService directly
              if (tc.function.name === 'kb_create_file') {
                try {
                  const result = await kbService.create(args.name || '未命名.md', args.content || '', activeProjectId || undefined)
                  r = { status: 'success', summary: `已创建知识库文件: ${result.name}`, detail: `文件ID: ${result.id}\n可在知识库页面查看和索引。` }
                } catch (e: any) { r = { status: 'error', summary: `创建失败: ${e.message}` } }
              } else if (tc.function.name === 'kb_append_file') {
                try {
                  await kbService.append(args.file_id, args.content || '')
                  r = { status: 'success', summary: '已追加到知识库文件', detail: '内容已追加。可在知识库页面查看。' }
                } catch (e: any) { r = { status: 'error', summary: `追加失败: ${e.message}` } }
              } else {
                const results = await aiService.executeFileTools([{ callId: tc.id, toolName: tc.function.name, args }])
                r = results[0]
              }
              const content = JSON.stringify({ status: r?.status || 'error', summary: r?.summary || '', detail: r?.detail || '' })
              messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content })
              resultMsgs.push({ id: `${tc.id}_r`, role: 'tool', content, tool_call_id: tc.id })
              // Notify components when files are modified by AI tools
              const fileModifyingTools = ['edit_file', 'create_file', 'delete_file', 'rename_file', 'restore_backup']
              if (fileModifyingTools.includes(tc.function.name) && r?.status === 'success' && args.file_path && activeProjectId) {
                const pp = useStore.getState().projects.find(p => p.id === activeProjectId)?.path
                if (pp) {
                  const absPath = `${pp}/${String(args.file_path).replace(/\\/g, '/')}`.replace(/\\/g, '/')
                  setFileEditNotify({ filePath: absPath, newContent: '__AI_EDITED__' })
                  setTimeout(() => setFileEditNotify(null), 100)
                }
              }
            } catch {
              const content = JSON.stringify({ status: 'error', summary: '工具执行异常' })
              messagesForApi.push({ role: 'tool', tool_call_id: tc.id, content })
              resultMsgs.push({ id: `${tc.id}_r`, role: 'tool', content, tool_call_id: tc.id })
            }
          }
          // Store tool results in conversation history
          if (resultMsgs.length > 0) setMessages(prev => [...prev, ...resultMsgs])
          if (finishReason !== 'tool_calls') isDone = true
        }
      }
      setCumulativeTokens(prev => prev + sessionTokens)
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
            {/* Plan/Action toggle */}
            <div style={{ display: 'inline-flex', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', overflow: 'hidden' }}>
              <button onClick={() => useSettingsStore.getState().setAISettings({ workMode: 'plan' })} style={{ padding: '4px 10px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: aiSettings.workMode === 'plan' ? 700 : 400, background: aiSettings.workMode === 'plan' ? 'rgba(22,163,74,0.12)' : 'transparent', color: aiSettings.workMode === 'plan' ? '#16a34a' : '#9b8e84', fontFamily: 'inherit' }}>Plan</button>
              <button onClick={() => useSettingsStore.getState().setAISettings({ workMode: 'action' })} style={{ padding: '4px 10px', border: 'none', borderLeft: '1px solid rgba(0,0,0,0.06)', cursor: 'pointer', fontSize: 11, fontWeight: aiSettings.workMode === 'action' ? 700 : 400, background: aiSettings.workMode === 'action' ? 'rgba(217,119,6,0.12)' : 'transparent', color: aiSettings.workMode === 'action' ? '#d97706' : '#9b8e84', fontFamily: 'inherit' }}>Action</button>
            </div>
            <ToggleButton icon={<GlobeAltIcon style={{ width: 12, height: 12 }} />} label="联网搜索" active={webSearchEnabled} onClick={() => setWebSearchEnabled(!webSearchEnabled)} />
            {/* Upload file (TXT/MD) */}
            <button onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.txt,.md,.text'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { const text = r.result as string; if (text.trim()) { setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: `[上传文件: ${f.name}]\n\n${text.slice(0, 50000)}` }]); setTimeout(() => handleSend(), 100) } }; r.readAsText(f, 'UTF-8') }; inp.click() }} title="上传文本文件" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', color: '#6b5e54', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><DocumentTextIcon style={{ width: 11, height: 11 }} /> 文件</button>
            {/* Upload image */}
            <button onClick={() => { if (!activeProjectId) return; const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = async () => { const pp = useStore.getState().projects.find(p => p.id === activeProjectId)?.path; if (!pp) return; try { const fn = await fileService.saveImageUrl(r.result as string, pp); if (fn) { setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: `[上传图片: images/${fn}]` }]); setTimeout(() => handleSend(), 100) } } catch {} }; r.readAsDataURL(f) }; inp.click() }} title="上传图片" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.06)', background: '#fff', color: '#6b5e54', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}><PhotoIcon style={{ width: 11, height: 11 }} /> 图片</button>
            {kbEnabled && (
              <span style={{ fontSize: 10, color: '#ca8a04', marginLeft: 4 }} title="知识库内容可能触发AI内容安全策略，如遇拦截请关闭此开关">
                含敏感内容时建议关闭
              </span>
            )}
          </div>

          <ContextUsageBar usedTokens={cumulativeTokens} contextWindow={activeConfig?.contextWindow ?? 128000} />

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
                {/* Images */}
                {msg.images && msg.images.map((img: string, i: number) => (
                  <div key={i} style={{ marginLeft: 36, marginTop: 4, marginBottom: 4 }}>
                    <img src={img} alt={`AI图片${i+1}`} style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 12, border: '1px solid rgba(0,0,0,0.08)' }} />
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


