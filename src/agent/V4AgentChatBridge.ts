// ── V4 Agent Chat Bridge ──
// Integration layer between V4AgentRuntime and the React chat UI.
// Wires 5 subsystems (down from V3's 20): Runtime, SecurityFence, AuditTrail,
// LearningEngine.
// ~180 lines (down from V3's 962).

import { V4AgentRuntime } from './V4AgentRuntime'
import { V4SecurityFence } from './V4SecurityFence'
import { buildSystemPrompt, CHARACTER_DOMAIN_MODULE, OUTLINE_DOMAIN_MODULE, CHAPTER_DOMAIN_MODULE, STYLE_DOMAIN_MODULE, SCENE_DOMAIN_MODULE, KB_DOMAIN_MODULE } from './V4SystemPrompt'
import { AuditTrail } from './audit/AuditTrail'
import { LearningEngine } from './learning/LearningEngine'
import { toolRegistry } from './tools/ToolRegistry'
import { contextAssembler } from './context/ContextAssembler'
import { ALL_TOOLS } from './tools/definitions'
import { ALL_PROVIDERS } from './context/providers'
import { useAgentStore } from './store/AgentStore'
import { diagnosticLogger } from './diagnostics/DiagnosticLogger'
import { estimateTokens } from './utils/tokenEstimation'
import type { Message } from './state/types'
import type { V4AgentRunResult, ToolExecutorFn } from './V4AgentRuntime'

// ── Init ──

let toolsRegistered = false
let providersRegistered = false

function ensureInitialized() {
  if (!toolsRegistered) {
    toolRegistry.registerAll(ALL_TOOLS)
    toolsRegistered = true
  }
  if (!providersRegistered) {
    for (const p of ALL_PROVIDERS) {
      if (!contextAssembler.getProviders().some(ex => ex.domain === p.domain)) {
        contextAssembler.register(p)
      }
    }
    providersRegistered = true
  }
}

// ── Types ──

export interface BridgeOptions {
  configId: string
  projectId: string | null
  maxIterations?: number
  historyMessages?: Message[]
}

export interface SendOptions {
  kbEnabled?: boolean
  webSearchEnabled?: boolean
  selectedKbFileIds?: string[]
  planMode?: boolean  // Enable plan-first prompting via ThinkingEngine
  onResponse?: (chunk: { text: string; accumulated: string; timestamp: number }) => void
  onComplete?: (result: V4AgentRunResult) => void
  onToolProgress?: (event: { callId: string; toolName: string; phase: string; progress: number; message: string; timestamp: number }) => void
  onApprovalRequired?: (tools: Array<{ name: string; args: Record<string, unknown> }>) => Promise<boolean>
}

export interface BridgeSendResult {
  success: boolean
  text: string
  toolCalls: number
  totalTokens: number
  phase: string
  contextBreakdown?: Array<{ domain: string; tokens: number }>
}

// ── Bridge ──

export class V4AgentChatBridge {
  private runtime: V4AgentRuntime | null = null
  private securityFence: V4SecurityFence
  private auditTrail = new AuditTrail()
  private learningEngine = new LearningEngine()

  private initialized = false
  private configId = ''
  private projectId: string | null = null
  private maxIterations = 30
  private history: Message[] = []
  private abortController = new AbortController()
  private runId = ''
  private _toolCache: { key: string; tools: any[] } | null = null  // v4: reuse identical tool arrays for caching

  constructor(projectId: string | null) {
    this.securityFence = new V4SecurityFence(projectId)
    ensureInitialized()
  }

  init(options: BridgeOptions): void {
    this.configId = options.configId
    this.projectId = options.projectId
    this.maxIterations = options.maxIterations ?? 8
    this.history = options.historyMessages || []
    this.securityFence = new V4SecurityFence(this.projectId)
    this.initialized = true
  }

  updateProject(projectId: string | null): void {
    this.projectId = projectId
    this.securityFence = new V4SecurityFence(projectId)
  }

  updateHistory(messages: Message[]): void {
    this.history = messages
  }

  async sendMessage(userMessage: string, options: SendOptions = {}): Promise<BridgeSendResult> {
    if (!this.initialized) throw new Error('V4AgentChatBridge not initialized')

    // Guard: abort any in-progress run before starting a new one
    if (this.runtime) {
      this.abortController.abort()
      this.runtime.abort()
      // Dynamic import for abort stream — fire-and-forget
      import('@/services/fileService').then(m => m.aiService?.abortStream?.()).catch(() => {})
    }

    this.runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    this.abortController = new AbortController()
    const store = useAgentStore.getState()

    this.auditTrail.startSession(this.runId)
    this.learningEngine.startSession()
    await this.learningEngine.load()
    diagnosticLogger.clearRecent()  // 🔧 Clear stale diagnostic events from previous runs

    // Collect emitter unsubscribe functions for cleanup
    const unsubscribes: Array<() => void> = []

    try {
      // ── 0.5 Agent 1 + Agent 2: Classify intent and select tools ──
      const { classifyIntent } = await import('./IntentClassifier')
      const intent = await classifyIntent(userMessage, this.configId)
      intent !== 'complex' && diagnosticLogger.recordInfo(`Agent1: intent=${intent}`)

      // v4: Scoped + cached tools — same intent → same array → DeepSeek caches → 10%
      const allTools = toolRegistry.getAllSchemas()
      const READ = new Set(['read_file','list_directory','search_files','search_content'])
      const NOTE = new Set(['list_notes','read_note','write_note','append_note'])
      const KB = new Set(['kb_list','kb_create_file','kb_index_file'])
      const WRITE = new Set(['create_file','edit_file','rename_file','delete_file'])

      // v4: Reuse identical tool arrays → DeepSeek caches → 10% billing
      let scopedTools: any[]
      const toolKey = `${intent}:${/写|创建|生成/.test(userMessage)?'c':/修改|编辑/.test(userMessage)?'m':'r'}`
      if (this._toolCache && this._toolCache.key === toolKey) {
        scopedTools = this._toolCache.tools
      } else {
        let tools: any[]
        if (intent === 'chat') { tools = [] }
        else if (intent === 'simple') {
          const SIMPLE = new Set([...READ, 'kb_list', 'list_notes', 'read_note'])
          tools = allTools.filter((t: any) => SIMPLE.has(t.function.name))
        }
        else if (/写|创建|生成|续写|新建/.test(userMessage) && !/修改|编辑|删除/.test(userMessage)) {
          tools = allTools.filter((t: any) => new Set([...READ,...NOTE,...KB,'create_file','rename_file']).has(t.function.name))
        } else if (/修改|编辑|改/.test(userMessage)) {
          tools = allTools.filter((t: any) => new Set([...READ,...WRITE]).has(t.function.name))
        } else { tools = allTools }
        this._toolCache = { key: toolKey, tools }
        scopedTools = tools
      }
      let planInstruction = ''
      if (intent === 'complex') {
        planInstruction = '\n## 执行方案\n这是一个复杂任务。请先在思考中规划步骤，然后按步骤调用工具。完成后汇报结果。'
      }

      // ── 1. Create Runtime ──
      this.runtime = new V4AgentRuntime({
        configId: this.configId,
        projectId: this.projectId,
        maxIterations: this.maxIterations,
        abortSignal: this.abortController.signal,
      })

      // ── 2. Wire AI Service ──
      const { aiService } = await import('@/services/fileService')
      this.runtime.setAIService({
        chatWithTools: async (msgs, cid, pid, tools) => {
          const result = await aiService.chatWithTools(msgs, cid, pid, tools)
          return {
            text: result.text,
            toolCalls: result.toolCalls?.map(tc => ({
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            })) || null,
            finishReason: result.finishReason,
            usage: result.usage,
            reasoning_content: result.reasoning_content,
          }
        },
        abortStream: () => aiService.abortStream(),
      })

      // ── 3. Wire Context Assembler ──
      // v4: Split System Prompt — core (locked, cached) + dynamic (index + providers)
      // Core never changes → DeepSeek prefix caching → 10% billing
      // Dynamic rebuilt per message → fresh project index + relevant providers
      const coreDomainModules = [
        CHARACTER_DOMAIN_MODULE, OUTLINE_DOMAIN_MODULE, CHAPTER_DOMAIN_MODULE,
        STYLE_DOMAIN_MODULE, SCENE_DOMAIN_MODULE, KB_DOMAIN_MODULE,
      ]
      const CORE_PROMPT = buildSystemPrompt(coreDomainModules, '', '') + planInstruction
      const coreSystemMsg = { role: 'system' as const, content: CORE_PROMPT }
      const coreTokens = estimateTokens(CORE_PROMPT)

      this.runtime.setContextAssembler(async (msg, hist, pid) => {
        // Dynamic: project index + provider content (fresh per message)
        let projectIndex = ''
        if (pid) {
          try {
            const { buildMemoryIndex } = await import('./context/MemoryIndex')
            projectIndex = await buildMemoryIndex(pid)
          } catch {}
        }
        // KB search
        let searchContext = ''
        if (options.kbEnabled && this.projectId) {
          try {
            const { kbService } = await import('@/services/fileService')
            const results = await kbService.search(msg, this.projectId, this.configId, 3, options.selectedKbFileIds)
            if (Array.isArray(results) && results.length > 0) {
              searchContext += '\n[知识库]\n' + results.map((r: any) => r.content || r.text || '').join('\n---\n')
            }
          } catch { /* unavailable */ }
        }
        if (options.webSearchEnabled) {
          try {
            const { kbService } = await import('@/services/fileService')
            const results = await kbService.webSearch(msg.slice(0, 500), 3)
            if (Array.isArray(results) && results.length > 0) {
              searchContext += '\n[网络搜索]\n' + results.map((r: any) => r.snippet || r.title || '').join('\n---\n')
            }
          } catch { /* unavailable */ }
        }

        const base = await contextAssembler.assemble(msg, hist, pid)

        // Plan mode: inject plan-first instruction before the user message
        let planPrompt: string | null = null
        if (options.planMode) {
          try {
            const { ThinkingEngine } = await import('./thinking/ThinkingEngine')
            planPrompt = new ThinkingEngine().generatePlanPrompt()
          } catch { /* planPrompt stays null; no impact */ }
        }

        // Token accounting: core (cached) + dynamic (per-message)
        const searchTokens = searchContext ? estimateTokens(searchContext) : 0
        const planTokens = planPrompt ? estimateTokens(planPrompt) : 0
        const projectIndexTokens = estimateTokens(projectIndex || '')
        const historyTokens = hist.reduce((s, m) => s + estimateTokens(m.content || '') + 4, 0)
        const userMsgTokens = estimateTokens(msg)

        const fullTotal = coreTokens + base.totalTokens + searchTokens + planTokens + projectIndexTokens + historyTokens + userMsgTokens

        const fullBreakdown: Array<{ domain: string; tokens: number }> = [
          { domain: '核心法则(缓存)', tokens: coreTokens },
          { domain: '项目索引+Provider', tokens: projectIndexTokens + (base.totalTokens || 0) },
          ...(searchContext ? [{ domain: '知识库', tokens: searchTokens }] : []),
          ...(planPrompt ? [{ domain: '执行规划', tokens: planTokens }] : []),
          { domain: '对话历史', tokens: historyTokens },
          { domain: '当前消息', tokens: userMsgTokens },
        ].filter(b => b.tokens > 0)

        // v4: Split architecture — [0] core (cached) + [1] dynamic (per-message)
        const dynamicContent = [
          searchContext,
          ...base.systemMessages.map(m => m.content),
          planPrompt,
        ].filter(Boolean).join('\n\n')

        const systemMessages = [
          coreSystemMsg,                                          // [0] 核心提示词 — 永远不变, DeepSeek缓存
          { role: 'system' as const, content: dynamicContent },   // [1] 索引+Provider — 每次动态构建
        ]

        return {
          systemMessages,
          totalTokens: fullTotal,
          domains: ['core-prompt', ...(searchContext ? ['kb-web-search'] : []), ...(planPrompt ? ['plan-mode'] : []), ...base.domains],
          breakdown: fullBreakdown,
        }
      })

      // ── 4. Wire Tool Executor (SecurityFence → execute → audit → learning) ──
      const toolExecutor: ToolExecutorFn = async (args, ctx) => {
        // Security fence check
        const secCheck = this.securityFence.check(ctx.toolName, args)
        if (!secCheck.allowed) {
          this.auditTrail.recordToolResult(ctx.toolName, 'blocked', secCheck.reason || '')
          return { status: 'error', summary: secCheck.reason || '操作被安全围栏拦截' }
        }

        // Dangerous tool → user confirmation
        if (secCheck.needsApproval && options.onApprovalRequired) {
          const timeoutMs = 180_000
          const timeoutPromise = new Promise<boolean>(r => setTimeout(() => r(false), timeoutMs))
          const approved = await Promise.race([
            options.onApprovalRequired([{ name: ctx.toolName, args }]),
            timeoutPromise,
          ])
          if (!approved) {
            return { status: 'error', summary: '用户拒绝了此操作' }
          }
        }

        // Execute
        const result = await toolRegistry.execute(ctx.toolName, args, ctx)

        // Audit + learning
        this.auditTrail.recordToolResult(ctx.toolName, result.status, result.summary)
        this.learningEngine.onToolResult(ctx.toolName, result, this.projectId)

        // File change notification
        if (result.status === 'success' && /^(create_file|edit_file|delete_file|rename_file)$/.test(ctx.toolName)) {
          const { useStore } = await import('@/store')
          useStore.getState().setFileEditNotify({
            filePath: String(args.file_path || ''),
            newContent: '__AI_EDITED__',
          })
        }

        return result
      }
      this.runtime.setToolExecutor(toolExecutor)

      // ── 5. Set all tools ──
      this.runtime.setTools(scopedTools)

      // ── 7. Set history ──
      this.runtime.setHistory(this.history)

      // ── 8. Wire events to store ──
      const emitter = this.runtime.getEmitter()
      store.startRun(this.runId)

      unsubscribes.push(emitter.on('thinking:start', (data) => { store.setThinking(data) }))
      unsubscribes.push(emitter.on('tool:started', (data) => { store.addToolExecution(data.callId, data.toolName) }))
      unsubscribes.push(emitter.on('tool:completed', (data) => {
        store.completeTool(data.callId, 'success', data.summary, data.detail)
        options.onToolProgress?.({ callId: data.callId, toolName: data.toolName, phase: 'done', progress: 1, message: data.summary, timestamp: Date.now() })
      }))
      unsubscribes.push(emitter.on('tool:failed', (data) => {
        store.completeTool(data.callId, 'error', data.summary, data.detail)
      }))
      unsubscribes.push(emitter.on('agent:state', (data) => {
        store.setPhase(data.to)
        store.setIteration(data.state?.iteration || 0)
      }))

      let collectedText = ''
      unsubscribes.push(emitter.on('response:streaming', (data) => {
        collectedText = data.accumulated
        store.setStreamingText(data.accumulated)
        store.setIsStreaming(true)
        options.onResponse?.(data)
      }))

      // ── 9. Run ──
      const result = await this.runtime.run({
        userMessage,
        attachments: [],
      })

      store.setIsStreaming(false)
      options.onComplete?.(result)
      store.endRun()

      // ── 10. Post-session learning ──
      this.learningEngine.endSession().catch(() => {})

      return {
        success: result.success,
        text: result.text || collectedText,
        toolCalls: result.toolCalls,
        totalTokens: result.totalTokens,
        phase: result.phase,
        contextBreakdown: result.contextBreakdown,
      }

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      store.setLastError(errMsg)
      store.endRun()
      return { success: false, text: `错误: ${errMsg}`, toolCalls: 0, totalTokens: 0, phase: 'ERROR' }
    } finally {
      // Clean up all emitter listeners to prevent leaks on re-send
      for (const unsub of unsubscribes) {
        try { unsub() } catch { /* defensive */ }
      }
    }
  }

  abort(): void {
    this.abortController.abort()
    this.runtime?.abort()
    // Dynamic import for abort stream — fire-and-forget
    import('@/services/fileService').then(m => m.aiService?.abortStream?.()).catch(() => {})
  }

  destroy(): void {
    this.abort()
    this.runtime = null
  }
}
