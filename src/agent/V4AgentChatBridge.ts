// ── V4 Agent Chat Bridge ──
// Integration layer between V4AgentRuntime and the React chat UI.
// Wires 5 subsystems (down from V3's 20): Runtime, SecurityFence, AuditTrail,
// LearningEngine.
// ~180 lines (down from V3's 962).

import { V4UnifiedRuntime } from './runtime/V4UnifiedRuntime'
import { OpenAIAdapter } from './runtime/adapters/OpenAIAdapter'
import { V4SecurityFence } from './V4SecurityFence'
import { buildSystemPrompt } from './V4SystemPrompt'
import { AuditTrail } from './audit/AuditTrail'
import { toolRegistry } from './skills/ToolRegistry'
import { BridgeContextBuilder } from './context/BridgeContextBuilder'
import { createToolExecutor } from './bridge/toolExecutorFactory'
import { contextAssembler } from './context/ContextAssembler'
import { ALL_TOOLS } from './skills/tools'
import { useAgentStore } from './store/AgentStore'
import { diagnosticLogger } from './diagnostics/DiagnosticLogger'
import type { Message } from './state/types'
import type { V4AgentRunResult } from './runtime/RuntimeTypes'

// ── Init ──

let toolsRegistered = false

function ensureInitialized() {
  if (!toolsRegistered) {
    toolRegistry.registerAll(ALL_TOOLS as any)
    toolsRegistered = true
  }
}

// ── Types ──

export interface BridgeOptions {
  configId: string
  projectId: string | null
  maxIterations?: number
  historyMessages?: Message[]
  contextWindow?: number  // 模型上下文窗口大小, 传递给 ContextCompressor 做阈值计算
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
  toolsUsed: string[]
  toolCallSteps: Array<{ tool: string; status: string; summary: string; durationMs: number; iteration: number }>
  contextBreakdown?: Array<{ domain: string; tokens: number }>
  /** v11.7.0: prompt caching 命中的 tokens 数 */
  cacheHitTokens?: number
  /** v11.7.0: cache 创建 tokens（首轮，仍计费但显示为缓存） */
  cacheCreationTokens?: number
  /** v11.7.0: API 调用成本 */
  cost?: number
}

// ── Bridge ──

export class V4AgentChatBridge {
  private runtime: V4UnifiedRuntime | null = null
  private securityFence: V4SecurityFence
  private auditTrail = new AuditTrail()

  private initialized = false
  private configId = ''
  private projectId: string | null = null
  private maxIterations = 30  // v11.5.1: 60→30，nudge上限+写优先已消除死锁，30足够
  private contextWindow = 128_000
  private history: Message[] = []
  private abortController = new AbortController()
  private runId = ''
  private _toolCache: { key: string; tools: any[] } | null = null  // v4: reuse identical tool arrays for caching
  // v11.7.1: 首条消息全量注入跟踪
  private _fullPromptSent = false

  constructor(projectId: string | null) {
    this.securityFence = new V4SecurityFence(projectId)
    ensureInitialized()
  }

  init(options: BridgeOptions): void {
    this.configId = options.configId
    this.projectId = options.projectId
    this.maxIterations = options.maxIterations ?? 30
    this.contextWindow = options.contextWindow ?? 128_000
    this.history = options.historyMessages || []
    this.securityFence = new V4SecurityFence(this.projectId)
    this._fullPromptSent = false
    this.initialized = true
  }

  updateProject(projectId: string | null): void {
    if (this.projectId && this.projectId !== projectId) {
      contextAssembler.clearProject(this.projectId)
      import('./context/FileCache').then(m => m.invalidateProjectFilesReexport(this.projectId!))
    }
    this.projectId = projectId
    // 索引是全局的（含所有项目），切换项目无需重发
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
    diagnosticLogger.clearRecent()  // 🔧 Clear stale diagnostic events from previous runs

    // Collect emitter unsubscribe functions for cleanup
    const unsubscribes: Array<() => void> = []

    try {
      // ── 0. 加载模型配置 (v12.5.1: 阶段感知温度需要 temperature/toolTemperature) ──
      const { useSettingsStore } = await import('@/store')
      const settingsConfigs = useSettingsStore.getState().configs
      const modelConfig = settingsConfigs.find(c => c.id === this.configId)
      const creativeTemp = (modelConfig as any)?.temperature ?? 1.0
      const toolTemp = (modelConfig as any)?.toolTemperature ?? 0.5

      // ── 1. Create Runtime (via V4UnifiedRuntime + OpenAIAdapter — no setAIService needed) ──
      // Note: Skill scoping below may override maxIterations via this.runtime.setMaxIterations()
      const { aiService } = await import('@/services/fileService')
      const adapter = new OpenAIAdapter({
        chatWithTools: async (msgs, cid, pid, tools, temperature) => {
          const result = await aiService.chatWithTools(msgs, cid, pid, tools, temperature)
          return {
            text: result.text,
            toolCalls: result.toolCalls?.map(tc => ({
              id: tc.id, name: tc.function.name, arguments: tc.function.arguments,
            })) || null,
            finishReason: result.finishReason,
            usage: result.usage,
            reasoning_content: result.reasoning_content,
          }
        },
        abortStream: () => aiService.abortStream(),
      })
      this.runtime = new V4UnifiedRuntime({
        configId: this.configId,
        projectId: this.projectId,
        maxIterations: this.maxIterations,
        abortSignal: this.abortController.signal,
        contextWindow: this.contextWindow,
        temperature: creativeTemp,
        toolTemperature: toolTemp,
      }, adapter)

      // ── 2. 工具: 首条全量，后续按消息类型选择（闲聊0个，有意图10个）──
      const { CORE_TOOL_NAMES, SUBSEQUENT_TOOL_NAMES } = await import('./skills/tools/toolSearchTools')
      const { isPureGreeting } = await import('./utils/taskDetection')
      const schemas = toolRegistry.getAllSchemas()
      const coreTools = schemas.filter(s => CORE_TOOL_NAMES.has(s.function.name))
      const subsequentTools = schemas.filter(s => SUBSEQUENT_TOOL_NAMES.has(s.function.name))

      let toolsToSend: unknown[]
      if (!this._fullPromptSent) {
        toolsToSend = schemas
      } else if (isPureGreeting(userMessage)) {
        toolsToSend = []
      } else {
        toolsToSend = subsequentTools
      }
      this.runtime.setTools(toolsToSend)
      diagnosticLogger.recordInfo(`Agent2: ${toolsToSend.length} tools (full=${!this._fullPromptSent})`)

      // ── 3. Wire Context Assembler ──
      const CORE_PROMPT = buildSystemPrompt()
      const isFirst = !this._fullPromptSent
      const contextBuilder = new BridgeContextBuilder({
        projectId: this.projectId,
        configId: this.configId,
        kbEnabled: !!options.kbEnabled,
        webSearchEnabled: !!options.webSearchEnabled,
        selectedKbFileIds: options.selectedKbFileIds,
        enableThinkingPlan: true,
      })

      this.runtime.setContextAssembler(async (msg, hist, pid) => {
        const result = await contextBuilder.buildContext(msg, hist, pid, CORE_PROMPT, isFirst)
        return result
      })

      // ── 5. Wire Tool Executor (SecurityFence → execute → audit → learning) ──
      // ── 5. Wire Tool Executor (shared factory: SecurityFence → Approval → Execute → Audit → Cache)
      const toolExecutor = createToolExecutor({
        securityFence: this.securityFence,
        auditTrail: this.auditTrail,
        projectId: this.projectId,
        onApprovalRequired: options.onApprovalRequired,
      })
      this.runtime.setToolExecutor(toolExecutor)

      // ── 6. Set history ──
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
      store.setPeakPromptTokens(result.promptTokens)
      store.endRun()
      // v12.10.0: 纯闲聊不消耗全量Prompt名额，留给真正有任务的消息
      if (!isPureGreeting(userMessage)) {
        this._fullPromptSent = true
      }
      // V9.5.2: 会话结束时持久化审计数据到磁盘
      this.auditTrail.persist().catch(() => {})


      return {
        success: result.success,
        text: result.text || collectedText,
        toolCalls: result.toolCalls,
        totalTokens: result.totalTokens,
        phase: result.phase,
        toolsUsed: result.toolsUsed,
        toolCallSteps: result.toolCallSteps,
        contextBreakdown: result.contextBreakdown,
        cacheHitTokens: result.cacheHitTokens || 0,
      }

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      store.setLastError(errMsg)
      store.endRun()
      this.auditTrail.persist().catch(() => {})
      return { success: false, text: `错误: ${errMsg}`, toolCalls: 0, totalTokens: 0, phase: 'ERROR', toolsUsed: [], toolCallSteps: [] }
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
    // Persist audit trail before aborting (best-effort)
    this.auditTrail.persist().catch(() => {})
    // Dynamic import for abort stream — fire-and-forget
    import('@/services/fileService').then(m => m.aiService?.abortStream?.()).catch(() => {})
  }

  destroy(): void {
    this.auditTrail.persist().catch(() => {})
    this.abort()
    this.runtime = null
  }
}
