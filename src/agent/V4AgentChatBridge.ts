// ── V4 Agent Chat Bridge ──
// Integration layer between V4AgentRuntime and the React chat UI.
// Wires 5 subsystems (down from V3's 20): Runtime, SecurityFence, AuditTrail,
// LearningEngine, HookEngine.
// ~180 lines (down from V3's 962).

import { V4AgentRuntime } from './V4AgentRuntime'
import { V4SecurityFence } from './V4SecurityFence'
import { buildSystemPrompt, selectDomainModules } from './V4SystemPrompt'
import { AuditTrail } from './audit/AuditTrail'
import { LearningEngine } from './learning/LearningEngine'
import { toolRegistry } from './tools/ToolRegistry'
import { contextAssembler } from './context/ContextAssembler'
import { ALL_TOOLS } from './tools/definitions'
import { ALL_PROVIDERS } from './context/providers'
import { useAgentStore } from './store/AgentStore'
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

  constructor(projectId: string | null) {
    this.securityFence = new V4SecurityFence(projectId)
    ensureInitialized()
  }

  init(options: BridgeOptions): void {
    this.configId = options.configId
    this.projectId = options.projectId
    this.maxIterations = options.maxIterations ?? 30
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

    this.runId = Date.now().toString(36)
    this.abortController = new AbortController()
    const store = useAgentStore.getState()

    this.auditTrail.startSession(this.runId)
    this.learningEngine.startSession()
    await this.learningEngine.load()

    try {
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
      this.runtime.setContextAssembler(async (msg, hist, pid) => {
        // Inject domain-specific modules based on user message
        const domainModules = selectDomainModules(msg)

        // Always inject project index so AI knows the project structure
        let projectIndex = ''
        let projectContext = ''
        if (pid) {
          try {
            const { buildMemoryIndex } = await import('./context/MemoryIndex')
            projectIndex = await buildMemoryIndex(pid)
          } catch { /* may not exist yet */ }
        }

        const systemPrompt = buildSystemPrompt(domainModules, projectIndex, projectContext)

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
            const results = await kbService.webSearch(msg, 3)
            if (Array.isArray(results) && results.length > 0) {
              searchContext += '\n[网络搜索]\n' + results.map((r: any) => r.snippet || r.title || '').join('\n---\n')
            }
          } catch { /* unavailable */ }
        }

        const base = await contextAssembler.assemble(msg, hist, pid)

        return {
          systemMessages: [
            { role: 'system' as const, content: systemPrompt },
            ...(searchContext ? [{ role: 'system' as const, content: searchContext }] : []),
            ...base.systemMessages,
          ],
          totalTokens: base.totalTokens + Math.ceil(systemPrompt.length / 3),
          domains: ['core-prompt', ...(searchContext ? ['kb-web-search'] : []), ...base.domains],
          breakdown: [
            { domain: 'core-prompt', tokens: Math.ceil(systemPrompt.length / 3) },
            ...(searchContext ? [{ domain: 'kb-web-search', tokens: Math.ceil(searchContext.length / 3) }] : []),
            ...(base.breakdown || []),
          ],
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
      this.runtime.setTools(toolRegistry.getAllSchemas())

      // ── 7. Set history ──
      this.runtime.setHistory(this.history)

      // ── 8. Wire events to store ──
      const emitter = this.runtime.getEmitter()
      store.startRun(this.runId)

      emitter.on('thinking:start', (data) => { store.setThinking(data) })
      emitter.on('tool:started', (data) => { store.addToolExecution(data.callId, data.toolName) })
      emitter.on('tool:completed', (data) => {
        store.completeTool(data.callId, 'success', data.summary, data.detail)
        options.onToolProgress?.({ callId: data.callId, toolName: data.toolName, phase: 'done', progress: 1, message: data.summary, timestamp: Date.now() })
      })
      emitter.on('tool:failed', (data) => {
        store.completeTool(data.callId, 'error', data.summary, data.detail)
      })
      emitter.on('agent:state', (data) => {
        store.setPhase(data.to)
        store.setIteration(data.state?.iteration || 0)
      })

      let collectedText = ''
      emitter.on('response:streaming', (data) => {
        collectedText = data.accumulated
        store.setStreamingText(data.accumulated)
        store.setIsStreaming(true)
        options.onResponse?.(data)
      })

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
