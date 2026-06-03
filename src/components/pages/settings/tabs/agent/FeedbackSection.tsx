import { useState, useEffect, useCallback, useRef } from 'react'
import { fileService, aiService } from '@/services/fileService'
import { SkeletonList } from '@/components/common/Skeleton'
import { PlayIcon, SparklesIcon, PaperAirplaneIcon, TrashIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { useSettingsStore } from '@/store'

interface LearningEntry {
  id: string
  problem: string
  solution: string
  category: string
  createdAt: string
  applied: boolean
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  toolCallId?: string
  toolCalls?: any[]
}

const CATEGORY_LABELS: Record<string, string> = {
  file: '文件', character: '角色', outline: '大纲',
  chapter: '章节', style: '风格', kb: '知识库', general: '通用',
}

const PERSIST_PATH = '.aiharness/learnings.json'

const OPTIMIZE_SYSTEM_PROMPT = `你是青剑的自我优化引擎。你可以全面检查和修改源码文件。

## 能力
- 读取任何源码文件，搜索代码模式
- 用 edit_file 精确修改源码
- 修改系统提示词、工具描述、核心规则

## 工作流程
1. 先全面了解软件现状：读取关键文件，理解当前架构
2. 分析学习经验，找到根因
3. 精准修改——最小改动、最大预防
4. 反馈：改了哪些文件、为什么这样改、预期效果

## 修改范围
- src/agent/V4SystemPrompt.ts — 核心规则
- src/agent/skills/tools/*.ts — 工具描述
- src/types/settings.ts — 配置
- electron/ipc/*.ts — IPC 处理
- 以及任何需要修改的源码文件

## 原则
- 修改前先 read_file 确认当前内容
- 最小的改动，最精准的预防
- 不修改不需要改的地方`

/** 加载软件上下文供模型参考 */
async function loadSoftwareContext(): Promise<string> {
  const parts: string[] = []
  try {
    // Core system prompt
    const { CORE_SYSTEM_PROMPT } = await import('@/agent/V4SystemPrompt')
    parts.push(`## 当前系统提示词\n\`\`\`\n${CORE_SYSTEM_PROMPT.slice(0, 800)}\n...\n\`\`\``)
  } catch {}
  try {
    // Tool count
    const { toolRegistry } = await import('@/agent/tools/ToolRegistry')
    const names = toolRegistry.getNames()
    parts.push(`## 已注册工具 (${names.length}个)\n${names.join(', ')}`)
  } catch {}
  try {
    // Learning entries
    const { fileService } = await import('@/services/fileService')
    const raw = await fileService.read('.aiharness/learnings.json')
    if (raw?.trim()) {
      const entries = JSON.parse(raw)
      if (entries.length > 0) {
        const summary = entries.slice(-10).map((e: any) =>
          `- [${e.applied ? '已应用' : '待处理'}] ${e.problem} → ${e.solution}`
        ).join('\n')
        parts.push(`## 学习经验 (${entries.length}条)\n${summary}`)
      }
    }
  } catch {}
  return parts.join('\n\n')
}

function buildOptimizePrompt(selected: LearningEntry[], softwareContext: string): string {
  const items = selected.length > 0
    ? selected.map((e, i) => `${i + 1}. 问题: ${e.problem}\n   解决: ${e.solution}`).join('\n\n')
    : ''

  return `[自我优化任务]

## 软件现状
${softwareContext}

${selected.length > 0 ? `## 选中的学习经验 (${selected.length}条)\n${items}\n` : ''}

请根据以上信息自主判断需要做什么:
1. 检查系统提示词是否有可改进之处（规则缺失、描述不清、可能导致错误的指引）
2. 检查工具描述是否准确（参数说明、使用场景、警告提示）
3. 根据学习经验，修改相关文件防止问题再次发生
4. 如果一切合理，回复"经检查，当前系统无需修改"并说明理由

完成后请汇报:
- 检查了哪些文件
- 做了什么修改（如有）
- 为什么这样改
- 建议的后续优化（如有）`
}

/** Build a simple tool-calling chat loop (no Agent runtime, direct API) */
async function runOptimizeChat(
  messages: ChatMessage[],
  configId: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const MAX_ITERS = 8
  let collected = ''
  const apiMessages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> = [
    { role: 'system', content: OPTIMIZE_SYSTEM_PROMPT },
  ]

  for (const m of messages) {
    if (m.role === 'assistant' && (m as any).toolCalls) {
      apiMessages.push({
        role: 'assistant',
        content: m.content,
        tool_calls: (m as any).toolCalls,
      })
    } else if (m.role === 'tool') {
      apiMessages.push({
        role: 'tool',
        content: m.content,
        tool_call_id: (m as any).toolCallId,
      })
    } else {
      apiMessages.push({ role: m.role as 'user' | 'assistant', content: m.content })
    }
  }

  // Simple tools for optimization - full codebase access, no project isolation
  const tools = [
    {
      type: 'function' as const,
      function: {
        name: 'read_file',
        description: '读取项目中的任意文件。路径相对于项目根目录。',
        parameters: {
          type: 'object' as const,
          properties: { file_path: { type: 'string', description: '文件路径' } },
          required: ['file_path'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'edit_file',
        description: '精确字符串替换编辑文件。old_string 必须与文件内容逐字匹配。用 __FULL_REPLACE__ 做全量替换。',
        parameters: {
          type: 'object' as const,
          properties: {
            file_path: { type: 'string', description: '文件路径' },
            old_string: { type: 'string', description: '要替换的原文或 __FULL_REPLACE__' },
            new_string: { type: 'string', description: '替换后的新文本' },
          },
          required: ['file_path', 'old_string', 'new_string'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'search_content',
        description: '在文件中搜索文本内容。',
        parameters: {
          type: 'object' as const,
          properties: {
            pattern: { type: 'string', description: '搜索的文本或正则' },
            file_pattern: { type: 'string', description: '限定文件类型，如"*.ts"' },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'list_directory',
        description: '列出目录内容。',
        parameters: {
          type: 'object' as const,
          properties: { dir_path: { type: 'string', description: '目录路径' } },
          required: ['dir_path'],
        },
      },
    },
  ]

  let iteration = 0
  while (iteration < MAX_ITERS) {
    if (signal.aborted) break
    iteration++

    const result = await aiService.chatWithTools(apiMessages, configId, undefined, tools)
    if (signal.aborted) break

    if (!result.toolCalls || result.toolCalls.length === 0) {
      collected = result.text || ''
      onChunk(collected)
      break
    }

    // Add assistant message
    const asstMsg: any = {
      role: 'assistant' as const,
      content: result.text,
      tool_calls: result.toolCalls.map(tc => ({
        type: 'function',
        id: tc.id,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    }
    apiMessages.push(asstMsg)

    // Execute each tool
    for (const tc of result.toolCalls) {
      if (signal.aborted) break
      let args: Record<string, unknown>
      try { args = JSON.parse(tc.function.arguments) } catch { continue }

      let toolResult: string
      const tcName = tc.function.name
      try {
        if (tcName === 'read_file') {
          const fp = String(args.file_path || '')
          const content = await fileService.read(fp)
          toolResult = JSON.stringify({ status: 'success', summary: `${content.length} 字符`, detail: content.slice(0, 5000) })
        } else if (tcName === 'edit_file') {
          const results = await aiService.executeFileTools([{
            callId: tc.id, toolName: 'edit_file',
            args: { file_path: args.file_path, old_string: args.old_string, new_string: args.new_string },
          }])
          const r = results[0]
          toolResult = JSON.stringify(r || { status: 'error', summary: '无响应' })
        } else if (tcName === 'search_content') {
          const results = await aiService.executeFileTools([{
            callId: tc.id, toolName: 'search_content',
            args: { pattern: args.pattern, file_pattern: args.file_pattern, dir_path: args.dir_path },
          }])
          const r = results[0]
          toolResult = JSON.stringify(r || { status: 'error', summary: '无响应' })
        } else if (tcName === 'list_directory') {
          const files = await fileService.listDir(String(args.dir_path || 'src'))
          toolResult = JSON.stringify({ status: 'success', summary: `${files.length} 个条目`, detail: files.join('\n') })
        } else {
          toolResult = JSON.stringify({ status: 'error', summary: `未知工具: ${tcName}` })
        }
        onChunk(`\n🔧 ${tcName}: ${JSON.parse(toolResult).summary || '完成'}`)
      } catch (e: any) {
        toolResult = JSON.stringify({ status: 'error', summary: e.message || '执行失败' })
      }

      apiMessages.push({ role: 'tool', content: toolResult, tool_call_id: tc.id })
    }
  }

  return collected
}

export function FeedbackSection() {
  const [entries, setEntries] = useState<LearningEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const activeConfigId = useSettingsStore(s => s.activeConfigId)
  const configs = useSettingsStore(s => s.configs)
  const activeConfig = configs.find(c => c.id === activeConfigId)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const raw = await fileService.read(PERSIST_PATH)
      if (raw?.trim()) {
        setEntries(JSON.parse(raw).map((e: any) => ({ ...e, applied: e.applied === true })).reverse())
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamingText])

  // Only show un-applied entries for selection
  const pendingEntries = entries.filter(e => !e.applied)
  const appliedEntries = entries.filter(e => e.applied)
  const selectedList = pendingEntries.filter(e => selected.has(e.id))
  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectAll = () => setSelected(new Set(pendingEntries.map(e => e.id)))
  const deselectAll = () => setSelected(new Set())

  const addMessage = (role: 'user' | 'assistant' | 'system', content: string, extra?: Record<string, any>) => {
    setMessages(prev => [...prev, { id: `m_${Date.now().toString(36)}`, role, content, timestamp: Date.now(), ...extra }])
  }

  const handleExecute = async () => {
    if (!activeConfigId) return
    setRunning(true)
    setStreamingText('')

    addMessage('system', '⏳ 正在加载软件现状信息...')
    const softwareContext = await loadSoftwareContext()
    // Remove loading message
    setMessages(prev => prev.filter(m => m.id !== prev[prev.length - 1]?.id || m.content !== '⏳ 正在加载软件现状信息...'))

    const prompt = buildOptimizePrompt(selectedList, softwareContext)
    addMessage('user', selectedList.length > 0
      ? `请根据软件现状和 ${selectedList.length} 条学习经验进行自主检查和修正。`
      : '请全面检查软件现状，自主判断是否需要修改。')

    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      const result = await runOptimizeChat(messages.concat([
        { id: 'u', role: 'user', content: prompt, timestamp: Date.now() },
      ]), activeConfigId, (text) => {
        setStreamingText(text)
      }, abortController.signal)

      if (result) {
        addMessage('assistant', result)
      }
      setStreamingText('')

      // Mark as applied
      const updated = entries.map(e => selected.has(e.id) ? { ...e, applied: true } : e)
      await fileService.ensureDir('.aiharness')
      await fileService.write(PERSIST_PATH, JSON.stringify(updated, null, 2))
      loadData()
      deselectAll()
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        addMessage('assistant', `❌ 优化执行失败: ${e.message || '未知错误'}`)
      }
      setStreamingText('')
    }
    setRunning(false)
    abortRef.current = null
  }

  const handleSend = async () => {
    if (!input.trim() || !activeConfigId || running) return
    const text = input.trim()
    setInput('')
    setRunning(true)
    setStreamingText('')
    addMessage('user', text)

    // Load software context and build augmented message for the model
    const softwareContext = await loadSoftwareContext()
    const fullPrompt = `## 软件现状\n${softwareContext}\n\n## 用户指令\n${text}\n\n请根据以上信息自主判断并执行。完成后汇报改了什么。`

    const abortController = new AbortController()
    abortRef.current = abortController

    try {
      // Send full context to the model (UI shows original text)
      const result = await runOptimizeChat(messages.concat([
        { id: 'u', role: 'user', content: fullPrompt, timestamp: Date.now() },
      ]), activeConfigId, (chunk) => {
        setStreamingText(chunk)
      }, abortController.signal)

      if (result) addMessage('assistant', result)
      setStreamingText('')
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        addMessage('assistant', `❌ 错误: ${e.message || '未知错误'}`)
      }
      setStreamingText('')
    }
    setRunning(false)
    abortRef.current = null
  }

  const handleAbort = () => {
    abortRef.current?.abort()
    setRunning(false)
    setStreamingText('')
  }

  const handleClearChat = () => setMessages([])

  if (loading) return <div style={{ padding: 12 }}><SkeletonList count={3} /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      {/* ── Top: Learning entry selection ── */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#2d2520' }}>自我修正</span>
          <span style={{ fontSize: 10, color: '#9b8e84' }}>选择经验 → 执行修正 → 在下方对话框查看结果</span>
        </div>

        {pendingEntries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 16, color: '#9b8e84', fontSize: 11, background: 'rgba(0,0,0,0.015)', borderRadius: 10 }}>
            {entries.length === 0 ? '暂无学习经验。AI 遇到错误并解决后会自动记录。' : '所有经验已处理完毕 ✅'}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <button onClick={selectAll} style={miniBtn}>全选</button>
              <button onClick={deselectAll} style={miniBtn}>清空</button>
              <span style={{ fontSize: 10, color: '#9b8e84' }}>待处理 {pendingEntries.length} · 已选 {selected.size}</span>
              <div style={{ flex: 1 }} />
              <button onClick={handleExecute} disabled={selected.size === 0 || running}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 8,
                  border: 'none', background: selected.size > 0 ? '#7c3aed' : '#d4ccc4', color: '#fff',
                  fontSize: 11, fontWeight: 600, cursor: selected.size > 0 ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit', opacity: running ? 0.7 : 1,
                }}>
                <PlayIcon style={{ width: 13, height: 13 }} />
                {running ? '执行中...' : `执行修正 (${selected.size})`}
              </button>
              {running && <button onClick={handleAbort} style={{ ...miniBtn, color: '#dc2626' }}>停止</button>}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto', marginBottom: 4 }} className="custom-scrollbar">
              {pendingEntries.map(e => (
                <div key={e.id} onClick={() => toggleSelect(e.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
                    background: selected.has(e.id) ? 'rgba(124,58,237,0.05)' : 'transparent',
                    border: `1px solid ${selected.has(e.id) ? 'rgba(124,58,237,0.12)' : 'transparent'}`,
                    fontSize: 11,
                  }}>
                  <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)} onClick={e => e.stopPropagation()}
                    style={{ width: 14, height: 14, accentColor: '#7c3aed', flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: '#7c3aed', fontWeight: 600, flexShrink: 0 }}>{CATEGORY_LABELS[e.category] || e.category}</span>
                  <span style={{ color: '#dc2626', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.problem}</span>
                  <span style={{ fontSize: 9, color: '#9b8e84', flexShrink: 0 }}>{e.createdAt?.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Optimization Results ── */}
      {appliedEntries.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <CheckCircleIcon style={{ width: 14, height: 14, color: '#059669' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#059669' }}>优化结果</span>
              <span style={{ fontSize: 10, color: '#9b8e84' }}>已解决 {appliedEntries.length} 个问题</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 100, overflowY: 'auto' }} className="custom-scrollbar">
              {appliedEntries.slice(-5).map(e => (
                <div key={e.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6,
                  background: 'rgba(5,150,105,0.04)', border: '1px solid rgba(5,150,105,0.1)', fontSize: 10, color: '#2d2520',
                }}>
                  <span style={{ color: '#059669', flexShrink: 0 }}>✓</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.problem}</span>
                  <span style={{ fontSize: 9, color: '#9b8e84', flexShrink: 0 }}>{e.createdAt?.slice(0, 10)}</span>
                </div>
              ))}
            </div>
          </div>
        )
      }

      {/* ── Divider ── */}
      <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }} />

      {/* ── Bottom: Independent chat ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#2d2520' }}>优化对话框</span>
          <span style={{ fontSize: 9, color: '#9b8e84' }}>独立会话 · 可访问全部源码 · 不与写作助手冲突</span>
          <div style={{ flex: 1 }} />
          {messages.length > 0 && <button onClick={handleClearChat} style={{ ...miniBtn, fontSize: 9 }}>清空对话</button>}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120, background: 'rgba(0,0,0,0.015)', borderRadius: 10, padding: '8px 10px' }} className="custom-scrollbar">
          {messages.length === 0 && !streamingText && (
            <div style={{ textAlign: 'center', padding: 20, color: '#9b8e84', fontSize: 11 }}>
              <SparklesIcon style={{ width: 18, height: 18, marginBottom: 4 }} />
              <div>选择上方的学习经验点击「执行修正」</div>
              <div style={{ fontSize: 9, marginTop: 2 }}>或直接在下方输入指令让 AI 检查并修改源码</div>
            </div>
          )}
          {messages.map(m => (
            <div key={m.id} style={{
              padding: '6px 10px', borderRadius: 8, fontSize: 11, lineHeight: 1.5,
              background: m.role === 'user' ? 'rgba(124,58,237,0.06)' : 'rgba(5,150,105,0.04)',
              border: `1px solid ${m.role === 'user' ? 'rgba(124,58,237,0.1)' : 'rgba(5,150,105,0.1)'}`,
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              color: '#2d2520',
            }}>
              {m.content.length > 800 ? m.content.slice(0, 800) + '\n...(内容过长，已截断)' : m.content}
            </div>
          ))}
          {streamingText && (
            <div style={{
              padding: '6px 10px', borderRadius: 8, fontSize: 11, lineHeight: 1.5,
              background: 'rgba(5,150,105,0.04)', border: '1px solid rgba(5,150,105,0.1)',
              alignSelf: 'flex-start', maxWidth: '90%', color: '#2d2520',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {streamingText.length > 800 ? streamingText.slice(-800) : streamingText}
              <span style={{ display: 'inline-block', width: 6, height: 12, background: '#7c3aed', marginLeft: 2, animation: 'blink 1s infinite' }} />
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSend() }}
            placeholder={activeConfigId ? '输入优化指令，如"检查所有工具描述的错误提示是否清晰"...' : '请先配置模型'}
            disabled={!activeConfigId || running}
            style={{
              flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)',
              fontSize: 11, fontFamily: 'inherit', color: '#2d2520',
              background: (!activeConfigId || running) ? 'rgba(0,0,0,0.02)' : '#fff',
            }}
          />
          <button onClick={handleSend} disabled={!input.trim() || !activeConfigId || running}
            style={{
              width: 34, height: 34, borderRadius: 8, border: 'none',
              background: input.trim() && activeConfigId ? '#7c3aed' : '#e5e0da',
              color: '#fff', cursor: input.trim() && activeConfigId ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
            <PaperAirplaneIcon style={{ width: 15, height: 15 }} />
          </button>
        </div>
      </div>
    </div>
  )
}

const miniBtn: React.CSSProperties = {
  padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)',
  background: '#fff', cursor: 'pointer', fontSize: 10, color: '#6b5e54',
  fontFamily: 'inherit',
}
